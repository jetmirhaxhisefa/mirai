#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { init } from '../../src/install/init.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { readToken } from '../../src/sign/token.js';
import { runSessions } from '../../src/redteam/sessions.js';
import { sessionReport } from '../../src/redteam/report.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { branchCases, controlCases, directCases, ruleCases, runsFor, sessionCases } from '../../src/redteam/cases-session.js';
import { ECHO_SERVER, realFolderFacts, removeFixture, runSessionCases, sessionState } from '../../src/redteam/session-run.js';

// Unit 18e's probes: the session cases on a sample-app clone, by group, with a fake home and a
// temporary Claude Code config. r5 and r3 use no model.
//   node test/probes/session-redteam-probe.js --probe r5|r3|r1|r3m|r4 [--yes] [--only id,id] [--workers n]

const GROUPS = {
  second: () => sessionCases().filter((k) => /^(control-)?(agent-general|mirai-)|^b-hook$|^sh-config@auto$/.test(k.id)),
  keys: () => sessionCases().filter((k) => k.moreAttempts),
  fix: () => [...controlCases().filter((k) => k.controls === 'agent-mirai'), ...ruleCases().filter((k) => k.group === 'agent-mirai')],
  r5: () => directCases().filter((k) => !/pty|piped/.test(k.id)),
  r3: () => directCases().filter((k) => /pty|piped/.test(k.id)),
  r3m: () => ruleCases().filter((k) => k.group.startsWith('approve-script')),
  r1: () => [...controlCases(), ...ruleCases().filter((k) => !k.group.startsWith('approve-script'))],
  r4: () => branchCases(),
};

// The whole suite through runSessions, on a probe clone with a probe key, as your own run would be.
async function suite(app, realHome, workers) {
  const workdir = realpathSync(mkdtempSync(join(realHome, '.mirai-probes-')));
  const root = join(workdir, 'repo');
  const home = join(workdir, 'home');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: root, env: gitEnv });
  execFileSync('/usr/bin/git', ['clone', '--quiet', '--no-local', app, root], { env: gitEnv });
  git('remote', 'remove', 'origin');
  const storeEnv = { PATH: '/usr/bin:/bin', HOME: home };
  init({ cwd: root, env: storeEnv, refresh: true });
  const key = createKeyPair(storeEnv);
  writePublicKeyFile(root, key.keyId, key.publicPem);
  git('add', '-A');
  git('commit', '-qm', 'probe: MIRAI refresh and a probe key (unit 18e)');
  const out = await runSessions({ cwd: root, env: process.env, storeEnv, consent: true, workers, onEvent: (e) => process.stdout.write(`${e.id}: ${e.run}  ${e.note ?? ''}\n`) });
  process.stdout.write(`\n${sessionReport(out.result, out)}\nrecorded: ${out.recorded}\n`);
  const keep = join(realHome, '.mirai-16a-corpus', '18e');
  mkdirSync(keep, { recursive: true });
  writeFileSync(join(keep, `suite-${Date.now()}.json`), `${JSON.stringify(out.result, null, 2)}\n`);
  removeFixture(workdir);
  return 0;
}

async function main() {
  const { values } = parseArgs({ options: { probe: { type: 'string' }, yes: { type: 'boolean' }, only: { type: 'string' }, workers: { type: 'string' }, app: { type: 'string' }, single: { type: 'boolean' } } });
  if (values.probe === 'suite') {
    if (!values.yes) throw new Error('the suite uses your Claude subscription (Haiku): add --yes');
    const home = realpathSync(process.env.HOME);
    return suite(resolve(values.app ?? join(home, 'Projects', 'mirai-sample-app')), home, Number(values.workers ?? 4));
  }
  const group = GROUPS[values.probe];
  if (!group) throw new Error('--probe r5|r3|r3m|r1|r4|keys|second|fix');
  let cases = group();
  if (values.only) cases = cases.filter((k) => values.only.split(',').includes(k.id) || values.only.split(',').includes(k.group));
  const needsModel = cases.some((k) => k.kind === 'model');
  if (needsModel && !values.yes) throw new Error(`${cases.length} cases use your Claude subscription (Haiku): add --yes`);
  const realHome = realpathSync(process.env.HOME);
  const app = resolve(values.app ?? join(realHome, 'Projects', 'mirai-sample-app'));
  const workdir = realpathSync(mkdtempSync(join(realHome, '.mirai-probes-')));
  const before = realFolderFacts(realHome);
  const claude = needsModel ? resolveClaude(process.env) : null;
  const token = needsModel ? readToken(process.env) : null;
  if (needsModel && !token) throw new Error('no login token');
  const addLocal = (fx) => {
    const entry = { type: 'stdio', command: '/usr/bin/env', args: ['-i', 'PATH=/usr/bin:/bin', process.execPath, ECHO_SERVER, 'LOCAL-marker'], env: {} };
    spawnSync(claude.real, ['mcp', 'add-json', 'mirai', JSON.stringify(entry), '--scope', 'local'], { cwd: fx.root, env: { ...fx.env, CLAUDE_CONFIG_DIR: fx.config }, timeout: 60_000 });
  };
  const started = Date.now();
  const results = await runSessionCases({
    cases, runsFor: values.single ? () => 1 : runsFor, checkout: app, branch: 'main', workdir, realHome, claude: claude?.real, token, workers: Number(values.workers ?? 4), addLocal,
    onEvent: (e) => process.stdout.write(`${e.id}: ${e.run}  ${e.note ?? ''}${e.calls ? `  calls=${e.calls.join(',')}  denials=${e.denials.join(',')}` : ''}${e.said ? `  said=${e.said.replace(/\s+/g, ' ').slice(0, 170)}` : ''}\n`),
  });
  const after = realFolderFacts(realHome);
  for (const x of results.problems) process.stdout.write(`PROBLEM: ${x}\n`);
  process.stdout.write(`\n== ${values.probe}: ${sessionState(results)}, ${Math.round((Date.now() - started) / 1000)} s\n`);
  for (const r of results) process.stdout.write(`${r.outcome.padEnd(12)} ${r.id}  (expected ${r.expect})\n`);
  process.stdout.write(`real ~/.config/mirai unchanged: ${before === after ? 'yes' : 'NO'}\n`);
  const keep = join(realHome, '.mirai-16a-corpus', '18e');
  mkdirSync(keep, { recursive: true });
  writeFileSync(join(keep, `${values.probe}-${Date.now()}.json`), `${JSON.stringify(results, null, 2)}\n`);
  removeFixture(workdir);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((c) => process.exit(c), (e) => { process.stderr.write(`${e.stack}\n`); process.exit(2); });
}
