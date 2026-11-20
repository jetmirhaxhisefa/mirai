#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { redact } from '../../src/redteam/claude.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { readToken } from '../../src/sign/token.js';
import { QUESTIONS, runReaderTest } from '../../src/write/reader.js';
import { recordingLaunch, setupHome } from './reader-probes.js';

// Unit 34's P3: a fresh agent wrote a PRD with the mirai-write skill (implementation/units/34-write/
// p3/prd.md). Pass when its summary passes the reader test on the first run, on the default tier
// (`standard`), through the same path `mirai reader-test` takes, in a probe home of its own.
//   node test/probes/reader-p3-probes.js --yes        (one Sonnet run)

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PRD = 'implementation/units/34-write/p3/prd.md';

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  if (!values.yes) {
    process.stderr.write('--yes: one Sonnet run on your Claude subscription\n');
    return 2;
  }
  const token = readToken(process.env);
  if (!token) throw new Error('no Claude login token: mirai token set');
  const claude = resolveClaude(process.env);
  const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
  try {
    const home = await setupHome({ workdir, tier: 'standard', claude, token });
    const file = 'docs/mirai/p3/prd.md';
    mkdirSync(dirname(join(home.root, file)), { recursive: true });
    writeFileSync(join(home.root, file), readFileSync(join(ROOT, PRD), 'utf8'));
    const rec = recordingLaunch();
    const r = await runReaderTest({ cwd: home.root, env: home.env, file, launch: rec.launch });
    log(`P3 reader test on ${PRD}: ${r.entry.result.toUpperCase()} (round ${r.entry.round ?? 1}, model ${r.entry.model})`);
    for (const q of QUESTIONS) {
      const a = r.entry.answers?.[q.key];
      const clean = (t) => redact(String(t ?? ''), token).replace(/\s+/g, ' ').slice(0, 300);
      log(`- ${q.label}: ${r.entry.failed.includes(q.key) ? 'FAIL' : 'ok'}; answer ${JSON.stringify(clean(a?.answer))}; quote ${JSON.stringify(clean(a?.quote))}${a?.why ? `; ${clean(a.why)}` : ''}`);
    }
    const cost = rec.runs.map((x) => x.result?.total_cost_usd).filter((c) => typeof c === 'number').reduce((n, c) => n + c, 0);
    log(`run cost: $${cost.toFixed(4)}`);
    return r.entry.result === 'pass' ? 0 : 1;
  } finally {
    spawnSync('/bin/chmod', ['-R', 'u+rwX', workdir]);
    rmSync(workdir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
