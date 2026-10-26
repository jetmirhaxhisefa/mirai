import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { checkWorkdir } from './fixture.js';

// The throwaway fixtures for unit 14a's Docker and git probes. Everything a probe may mount,
// read or plant lives under one work folder in your home folder (Docker Desktop shares it with
// its VM by default; the per-user temp folder is writable by sandboxed commands, so never there).
// Canaries are random per run, so a value seen in a probe's output can only have come from the
// file that holds it.
//
// <workdir>/
//   project/            a git repo the containers mount: canaries in .git/, .env, sub/.env, a
//                       nested sub/.git file; a fake .env.test; a canary compose.override.yml;
//                       links to .git and .env (relative and absolute)
//   trust/              what a trust root would hold: the dummy env file, the empty mask file
//   docker-config/      MIRAI's own DOCKER_CONFIG (no credentials, no proxies, no context)
//   plugins/            a fake Compose provider plugin that only writes a marker
//   bin/                fake git and ssh for the remote-include probe (markers only)
//   compose/            one compose file per probe, written by the harness (JSON, which Compose
//                       reads as YAML)
//   frozen/             resolved files (`config --format json`) for the frozen-file probes
//   markers/            what a fake plugin or tool wrote: a marker here means it ran on the host
//   git/                one folder per git probe and mode (repo, remote, payloads, marks)
//   out/                the reports

export const canary = (label) => `CANARY-${label}-${randomBytes(6).toString('hex')}`;

const NEUTRAL_GIT_ENV = {
  PATH: '/usr/bin:/bin',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Probe', GIT_AUTHOR_EMAIL: 'probe@example.invalid',
  GIT_COMMITTER_NAME: 'Probe', GIT_COMMITTER_EMAIL: 'probe@example.invalid',
};

// Plain git for building fixtures: no system or global config, no prompts.
export function fixtureGit(cwd, args, { input } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', input, env: { ...NEUTRAL_GIT_ENV, HOME: cwd } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

export function put(root, rel, text, mode) {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  if (mode) chmodSync(path, mode);
  return path;
}

// A script that writes one marker line (its own name, its arguments) and fails.
export const markerScript = (markFile) => `#!/bin/sh\necho "$(basename "$0") $*" >> "${markFile}"\nexit 1\n`;

export function buildComposeFixture(workdir, { home = process.env.HOME } = {}) {
  checkWorkdir(workdir, home);
  mkdirSync(workdir, { recursive: true });
  const root = realpathSync(workdir);
  const c = {
    git: canary('git'), env: canary('env'), subEnv: canary('subenv'), subGit: canary('subgit'), override: canary('override'),
    evil: canary('evil'), outside: canary('outside'), http: canary('http'),
  };
  const p = join(root, 'project');
  mkdirSync(p);
  fixtureGit(p, ['init', '-q', '-b', 'main']);
  put(p, 'README.md', 'probe fixture\n');
  put(p, 'app/index.txt', 'app source\n');
  put(p, '.env.test', 'APP_ENV=testing\nPROBE_VAR=from-env-test\n');
  put(p, '.gitignore', '.env\nsub/.env\n');
  fixtureGit(p, ['add', '-A']);
  fixtureGit(p, ['commit', '-q', '-m', 'fixture']);
  // Canaries git doesn't track: in .git itself, the real .env files (which also try to steer
  // Compose), a nested .git file (as a submodule has).
  put(p, '.git/CANARY', `${c.git}\n`);
  put(p, '.env', `CANARY_SECRET=${c.env}\nCOMPOSE_FILE=evil.json\nCOMPOSE_PROFILES=dbg\nCOMPOSE_PROJECT_NAME=mirai-probe-from-dotenv\nPROBE_VAR=from-dotenv\n`);
  put(p, 'sub/.env', `CANARY_SECRET=${c.subEnv}\n`);
  put(p, 'sub/.git', `gitdir: ${c.subGit}\n`);
  symlinkSync('.git', join(p, 'link-git'));
  symlinkSync('.env', join(p, 'link-env'));
  symlinkSync(join(p, '.env'), join(p, 'link-env-abs'));
  // What Compose would load if nothing stopped it: an override and the COMPOSE_FILE target.
  put(p, 'compose.override.yml', JSON.stringify({ services: { 'override-canary': { image: 'nginx:1.27-alpine', labels: { canary: c.override } } } }));
  put(p, 'evil.json', JSON.stringify({ services: { 'evil-canary': { image: 'nginx:1.27-alpine', labels: { canary: c.evil } } } }));
  put(p, 'included.json', JSON.stringify({ services: { 'included-svc': { image: 'nginx:1.27-alpine' } } }));
  put(p, 'base.json', JSON.stringify({ services: { basesvc: { image: 'nginx:1.27-alpine', environment: { FROM_BASE: 'yes' } } } }));

  const trust = join(root, 'trust');
  put(trust, '.env.test', 'APP_ENV=testing\nPROBE_VAR=from-trust-env\n');
  put(trust, 'empty', '');
  chmodSync(join(trust, 'empty'), 0o444);
  put(root, 'outside/secret.txt', `${c.outside}\n`);

  const markers = join(root, 'markers');
  mkdirSync(markers);
  // A fake provider plugin and fake git/ssh: if Compose runs any of them on the host, a marker
  // appears. They do nothing else.
  put(root, 'plugins/docker-mirai-probe', markerScript(join(markers, 'plugin')), 0o755);
  put(root, 'bin/git', markerScript(join(markers, 'git')), 0o755);
  put(root, 'bin/ssh', markerScript(join(markers, 'ssh')), 0o755);

  for (const d of ['compose', 'frozen', 'out', 'git']) mkdirSync(join(root, d));
  return { root, project: p, trust, markers, canaries: c, dockerConfig: join(root, 'docker-config') };
}

// MIRAI's own DOCKER_CONFIG: Compose found through Docker Desktop's plugin folder (and the probe
// plugin folder), nothing from yours: no credentials store, no proxies, no context.
export function writeDockerConfig(ctx, desktopPlugins) {
  put(ctx.dockerConfig, 'config.json', `${JSON.stringify({ cliPluginsExtraDirs: [desktopPlugins, join(ctx.root, 'plugins')] }, null, 2)}\n`);
}

export function removeComposeFixture(ctx, { keepOut = true } = {}) {
  spawnSync('chmod', ['-R', 'u+rwX', ctx.root]);
  for (const name of ['project', 'trust', 'outside', 'markers', 'plugins', 'bin', 'compose', 'frozen', 'git', 'docker-config']) {
    const path = join(ctx.root, name);
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  }
  if (!keepOut) rmSync(join(ctx.root, 'out'), { recursive: true, force: true });
}

// A canary HTTP server on 127.0.0.1 only (a random port), for "can a container reach the host".
// `status` 401 makes it the credential probe's server instead (git asks for credentials then).
// It runs in a child process: the harness calls git and docker synchronously, which would stop
// a server in its own process from answering. Each request appends a line to `hitsFile`.
const SERVER = `
const [status, body, hitsFile] = process.argv.slice(1);
const fs = require('node:fs');
const s = require('node:http').createServer((req, res) => {
  fs.appendFileSync(hitsFile, req.url + '\\n');
  if (status === '401') res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="mirai-probe"' });
  else res.writeHead(Number(status), { 'Content-Type': 'text/plain' });
  res.end(status === '401' ? 'no\\n' : body + '\\n');
});
s.listen(0, '127.0.0.1', () => process.stdout.write(s.address().port + '\\n'));
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
`;

export function startServer({ body = 'ok', status = 200, hitsFile }) {
  writeFileSync(hitsFile, '');
  const child = spawn(process.execPath, ['-e', SERVER, String(status), body, hitsFile], { stdio: ['pipe', 'pipe', 'inherit'] });
  return new Promise((resolveStart, reject) => {
    child.once('error', reject);
    child.stdout.once('data', (chunk) => {
      const handle = {
        port: Number(String(chunk).trim()),
        get hits() { return readFileSync(hitsFile, 'utf8').split('\n').filter(Boolean).length; },
        reset() { writeFileSync(hitsFile, ''); },
        close: () => new Promise((r) => { child.once('exit', r); child.stdin.end(); }),
      };
      resolveStart(handle);
    });
  });
}

// One git probe's folder per mode: a copy of the template repo, a bare remote, a payload script
// that writes a marker and fails, a filter payload that passes its input through.
export function gitProbeDir(ctx, template, id, mode) {
  const dir = join(ctx.root, 'git', id, mode);
  mkdirSync(dir, { recursive: true });
  cpSync(template, join(dir, 'repo'), { recursive: true });
  fixtureGit(dir, ['init', '-q', '--bare', 'remote.git']);
  fixtureGit(dir, ['init', '-q', '--bare', 'evil.git']);
  const marks = join(dir, 'marks');
  put(dir, 'payload', markerScript(marks), 0o755);
  put(dir, 'filter', `#!/bin/sh\necho "filter $*" >> "${marks}"\ncat\n`, 0o755);
  for (const d of ['pin/hooks', 'pin/home', 'elsewhere']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'pin', 'gitconfig'), '');
  return { dir, repo: join(dir, 'repo'), marks, payload: join(dir, 'payload'), filter: join(dir, 'filter') };
}

// The template repo the git probes copy: main with a.txt, a side branch that changes its first
// line (so a merge after the work commit is a real three-way merge of a.txt).
export function gitTemplate(ctx) {
  const t = join(ctx.root, 'git', '_template');
  mkdirSync(t, { recursive: true });
  fixtureGit(t, ['init', '-q', '-b', 'main']);
  put(t, 'a.txt', 'one\ntwo\nthree\nfour\nfive\n');
  fixtureGit(t, ['add', '-A']);
  fixtureGit(t, ['commit', '-q', '-m', 'base']);
  fixtureGit(t, ['switch', '-q', '-c', 'side']);
  put(t, 'a.txt', 'ONE\ntwo\nthree\nfour\nfive\n');
  fixtureGit(t, ['commit', '-q', '-am', 'side']);
  fixtureGit(t, ['switch', '-q', 'main']);
  return t;
}
