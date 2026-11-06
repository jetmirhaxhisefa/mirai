#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { progressLine } from '../../src/agent/progress.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { runAgent } from '../../src/agent/run.js';
import { progressPrinter } from '../../src/cli/progress.js';
import { setup } from './fix-probes.js';

// Unit 21e's R1 (one Haiku launch, pre-approved; a sample-app clone, the gate stubbed green): does
// a real launch's progress arrive while it runs, not only at the end, and carry only the tool, a
// project path or level, turns and minutes? The launch is told to make a few tool calls and to
// say a canary word, which must never appear in a progress line.
//   node test/probes/progress-probe.js --yes [--app <sample app>]

async function r1({ root, env, claude, log }) {
  const canary = `PROGRESS-CANARY-${Math.floor(Math.random() * 1e6)}`;
  const lines = [];
  const started = Date.now();
  const printer = progressPrinter({ stderr: { write: (s) => lines.push({ at: Date.now() - started, line: s.trimEnd() }) } });
  const events = [];
  const r = await runAgent({
    launchToken: mintLaunchToken(), cwd: root, env, claude, status: async () => ({ state: 'green', blocker_seen: null, changed: [] }),
    role: 'reviewer', step: 'commit-message', maxTurns: 8, item: 'SAMPLE-1', progressLabel: 'Haiku probe',
    prompt: `Read backend/composer.json, then run the Bash command \`echo ${canary} && ls backend\`, then read frontend/package.json. Then reply with the word ${canary}.`,
    onProgress: (p) => {
      events.push({ at: Date.now() - started, p });
      printer.onProgress(p);
    },
  });
  printer.stop();
  const total = Date.now() - started;
  for (const l of lines) log(`  +${(l.at / 1000).toFixed(1)} s  ${l.line}`);
  const tools = events.filter((e) => e.p.kind === 'tool');
  const leaked = [...events.map((e) => JSON.stringify(e.p)), ...lines.map((l) => l.line), ...events.map((e) => progressLine(e.p))].some((t) => t.includes(canary));
  const early = tools.length > 0 && tools[0].at < total - 2_000;
  log(`r1: ${r.outcome}${r.why ? ` (${r.why})` : ''}; ${tools.length} tool events; first at ${tools[0] ? (tools[0].at / 1000).toFixed(1) : '-'} s of ${(total / 1000).toFixed(1)} s; arrived while running: ${early ? 'yes' : 'NO'}; the canary in a progress line: ${leaked ? 'YES (a leak)' : 'no'}; reply had it: ${String(r.text).includes(canary) ? 'yes' : 'no'}`);
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
