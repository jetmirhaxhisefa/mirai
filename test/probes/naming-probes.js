#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';

import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { main } from '../../src/cli/main.js';
import { init } from '../../src/install/init.js';
import { findCli, hostFor, recordCli } from '../../src/ship/host.js';
import { openStore } from '../../src/store/home.js';

// Unit 38b's P1, second half: `mirai docs publish` prints GitHub's word ("pull request #N").
// The GitHub sample app's checkout is shared with the build runner, so this never works in it:
// --setup clones it into a work folder of its own, with a probe HOME (so a MIRAI store of its own:
// the sample app's store and its checkout are never touched), refreshes the clone's MIRAI from
// this checkout (38b) and commits that on the clone's main only (never pushed), and writes a small
// initiative, naming-38b (one brief, MIRAI's example), in the work tree. The clone's origin is the
// sample app's GitHub repo.
//   node <mirai>/test/probes/naming-probes.js --setup [--app ~/Projects/mirai-sample-app]
//       prints the work folder
//   node <mirai>/test/probes/naming-probes.js --publish --dir <work folder> --yes
//       runs `mirai docs publish naming-38b` there: pushes docs/naming-38b to GitHub and opens one
//       pull request (gh runs with your real HOME, so your login and keychain; nothing else of
//       yours is read). PASS when its output says "pull request #N" and never "merge request".
//   --publish --dry: the same against a stand-in gh over a local bare repo (no network): for
//       checking the probe itself.
// Afterwards: close the pull request and delete its branch (gh pr close <N> --delete-branch).

const INITIATIVE = 'naming-38b';
const { values: o } = parseArgs({ options: { setup: { type: 'boolean' }, publish: { type: 'boolean' }, dry: { type: 'boolean' }, yes: { type: 'boolean' }, dir: { type: 'string' }, app: { type: 'string', default: join(process.env.HOME, 'Projects', 'mirai-sample-app') }, 'no-fetch': { type: 'boolean' } } });
const REAL_HOME = process.env.HOME;

const HOST_MAIN = 'refs/probe/host-main';
// The host's main into HOST_MAIN (objects and that ref only), with your own git and SSH agent.
const fetchHostMain = (root) => execFileSync('/usr/bin/git', ['fetch', '--quiet', 'origin', `+refs/heads/main:${HOST_MAIN}`], { cwd: root, env: process.env });
const gitIn = (root, env) => (...a) => execFileSync('/usr/bin/git', a, { cwd: root, env, encoding: 'utf8' }).trim();
const probeEnv = (dir) => {
  const gh = findCli('gh', process.env, null);
  return { PATH: [...new Set([dirname(process.execPath), ...(gh ? [dirname(gh)] : []), '/usr/bin', '/bin'])].join(':'), HOME: join(dir, 'home'), USER: process.env.USER, LANG: 'C' };
};
// The probe home's git: no global or system config, an identity for the clone's own commits.
const cloneGit = (root, env) => gitIn(root, { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'MIRAI probe', GIT_AUTHOR_EMAIL: 'probe@example.invalid', GIT_COMMITTER_NAME: 'MIRAI probe', GIT_COMMITTER_EMAIL: 'probe@example.invalid' });

function setup() {
  const app = realpathSync(o.app);
  const appGit = gitIn(app, process.env);
  const origin = appGit('remote', 'get-url', 'origin');
  if (!/github\.com[:/]/.test(origin)) throw new Error(`${app}'s origin isn't on github.com (${origin})`);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mirai-38b-p1-')));
  const env = probeEnv(dir);
  mkdirSync(env.HOME, { mode: 0o700 });
  const root = join(dir, 'repo');
  // Objects and refs only: the runner's work tree and index in the sample app are never read.
  execFileSync('/usr/bin/git', ['clone', '--quiet', '--no-local', '--branch', 'main', app, root], { env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  const git = cloneGit(root, env);
  git('remote', 'set-url', 'origin', origin);
  // The host's main as it is now (the runner may have pushed since), kept as refs/probe/host-main:
  // the docs branch starts from it. Your own git, for the read.
  git('update-ref', HOST_MAIN, 'refs/remotes/origin/main');
  if (!o['no-fetch']) fetchHostMain(root);
  // Your name on the docs commit, as `mirai docs publish` takes it from your personal file.
  const name = appGit('config', 'user.name');
  const email = appGit('config', 'user.email');
  mkdirSync(join(env.HOME, '.config', 'mirai'), { recursive: true, mode: 0o700 });
  writeFileSync(join(env.HOME, '.config', 'mirai', 'config.toml'), `schema_version = 1\n[git]\nauthor_name = ${JSON.stringify(name)}\nauthor_email = ${JSON.stringify(email)}\n`, { mode: 0o600 });
  init({ cwd: root, env, refresh: true });
  git('add', '-A');
  git('commit', '-qm', 'probe: MIRAI refreshed from unit 38b (never pushed)');
  // MIRAI reads its trust root from main only when main is level with origin/main. This clone's
  // main carries 38b's refresh, which is never pushed, so its origin/main is set to it here. The
  // docs branch still starts from the host's real main (asked from GitHub at the publish), and its
  // documents-only check runs against that.
  git('update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
  const folder = join(root, 'docs', 'mirai', INITIATIVE);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'brief.md'), readFileSync(join(REGISTRY_DIR, 'examples', 'brief.md')));
  // gh's path, as `mirai init` records it (the library's init leaves that to the command).
  const store = openStore({ cwd: root, env });
  const tools = recordCli(store, env, root);
  if (!tools.github) throw new Error(`MIRAI found no gh on the probe PATH (${env.PATH})`);
  console.log(`setup: ${dir}`);
  console.log(`  clone ${root} (origin ${origin}), MIRAI from this checkout committed on its main only`);
  console.log(`  initiative docs/mirai/${INITIATIVE}/brief.md (not committed: publish takes the work tree)`);
  console.log(`  gh: ${tools.github}`);
  console.log(`next: node ${process.argv[1]} --publish --dir ${dir} --yes`);
}

async function publish() {
  if (!o.dir) throw new Error('--dir <work folder> (from --setup)');
  const dir = realpathSync(o.dir);
  const root = join(dir, 'repo');
  const env = probeEnv(dir);
  if (!existsSync(join(root, 'docs', 'mirai', INITIATIVE))) throw new Error(`no ${INITIATIVE} in ${root}: run --setup first`);
  let hostOf;
  if (o.dry) {
    const { fakeGh } = await import('../helpers/fake-hosts.js');
    const bare = join(dir, 'host.git');
    if (!existsSync(bare)) {
      execFileSync('/usr/bin/git', ['init', '-q', '--bare', '-b', 'main', bare]);
      execFileSync('/usr/bin/git', ['--git-dir', bare, 'fetch', '-q', root, `${HOST_MAIN}:refs/heads/main`]);
    }
    const gh = fakeGh(bare);
    const store = openStore({ cwd: root, env });
    writeFileSync(join(store.dir, 'host-tools.json'), JSON.stringify({ schema_version: 1, github: gh.path }));
    hostOf = (a) => ({ ...hostFor(a), pushUrl: bare });
  } else {
    if (!o.yes) throw new Error('--publish pushes docs/naming-38b to GitHub and opens a pull request: add --yes');
    // The runner may have pushed the sample app's main since the setup: the docs branch's base
    // must be in this clone.
    fetchHostMain(root);
    // gh with your real HOME: on macOS its token is in the keychain, found through HOME.
    hostOf = (a) => hostFor({ ...a, cliHome: REAL_HOME });
  }
  let out = '';
  let err = '';
  const stdin = Readable.from(['\n']);
  stdin.isTTY = true;
  const code = await main(['docs', 'publish', INITIATIVE], { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd: root, hostOf });
  process.stdout.write(out);
  if (err) process.stderr.write(err);
  const line = /^ {2}pull request #(\d+): (https:\/\/\S+)$/m.exec(out);
  const pass = code === 0 && line && !/merge request|\bMR\b/.test(out);
  console.log(`${pass ? 'PASS' : 'FAIL'}${o.dry ? ' (dry: a stand-in gh)' : ''}: ${line ? `pull request #${line[1]} ${line[2]}` : `no "pull request #N" line (exit ${code})`}`);
  if (pass && !o.dry) console.log(`cleanup: gh pr close ${line[1]} --repo ${new URL(line[2]).pathname.split('/').slice(1, 3).join('/')} --delete-branch, then chmod -R u+w ${dir} && rm -rf ${dir}`);
  process.exitCode = pass ? 0 : 1;
}

if (o.setup) setup();
else if (o.publish) await publish();
else console.log('use --setup, or --publish --dir <work folder> (--dry | --yes)');
