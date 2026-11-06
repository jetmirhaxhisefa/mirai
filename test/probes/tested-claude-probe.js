#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { runAgent } from '../../src/agent/run.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { keepTested, readTested, stageTested } from '../../src/redteam/tested.js';
import { loadSigner } from '../../src/sign/signer.js';
import { openStore } from '../../src/store/home.js';
import { setup } from './fix-probes.js';

// Unit 18g's R1 (one Haiku launch, on a sample-app clone with a probe home; the gate stubbed green):
// does Claude Code run from MIRAI's own read-only copy, outside its install folder, under MIRAI's
// flags with the auto-updater off? The copy is kept as a green red-team run would keep it; the
// launch names no claude, so it takes the kept one.
//   node test/probes/tested-claude-probe.js --yes [--app <sample app>]

async function r1({ root, env, log }) {
  const store = openStore({ cwd: root, env });
  const staged = await stageTested({ env, claude: resolveClaude(process.env) });
  keepTested({ env, store, staged, signer: loadSigner(env, store) });
  const kept = readTested(store).current;
  const v = spawnSync(kept.path, ['--version'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: env.HOME, DISABLE_AUTOUPDATER: '1' } });
  log(`r1-copy: ${kept.path.replace(env.HOME, '~')}; --version: ${String(v.stdout).trim() || `failed (${v.status})`}`);
  let judged = null;
  const status = async (o) => {
    judged = o.claude;
    return { state: 'green', blocker_seen: null, changed: [] };
  };
  const r = await runAgent({ launchToken: mintLaunchToken(), cwd: root, env, status, role: 'reviewer', step: 'commit-message', maxTurns: 3, item: 'SAMPLE-1', prompt: 'Use no tools. Reply only OK.' });
  log(`r1-launch: ${r.outcome}${r.why ? ` (${r.why})` : ''}; the gate judged the kept copy: ${judged === kept.path ? 'yes' : `no (${judged})`}; model ${r.line?.model_used ?? '?'}; reply ${JSON.stringify(String(r.text).slice(0, 40))}`);
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, app: { type: 'string' } } });
  if (!values.yes) {
    process.stderr.write('--yes: one Haiku launch on your Claude subscription\n');
    return 2;
  }
  const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
  const log = (l) => process.stdout.write(`${l}\n`);
  try {
    const ctx = setup({ app: resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app')), workdir });
    await r1({ ...ctx, log });
  } finally {
    spawnSync('/bin/chmod', ['-R', 'u+rwX', workdir]);
    rmSync(workdir, { recursive: true, force: true });
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
