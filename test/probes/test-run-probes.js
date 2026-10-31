#!/usr/bin/env node
import { mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { runTestProbes } from '../../src/redteam/probes/test-run.js';

// Unit 14c's probes of MIRAI's own test runs, by hand. Since unit 18c they live in
// src/redteam/probes/test-run.js and also run as part of the red team.
//
//   node test/probes/test-run-probes.js --yes [--workdir <dir>] [--only id,id] [--keep]

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, workdir: { type: 'string' }, only: { type: 'string' }, keep: { type: 'boolean' } } });
  if (!values.yes) {
    process.stderr.write('this runs local containers (nginx:1.27-alpine) on a throwaway fixture under your home folder; add --yes to run\n');
    return 2;
  }
  const workdir = values.workdir ? resolve(values.workdir) : mkdtempSync(join(process.env.HOME, '.mirai-probes-'));
  const report = await runTestProbes({ workdir, only: values.only?.split(',') ?? null, keep: values.keep === true, log: (l) => process.stdout.write(`${l}\n`) });
  process.stdout.write(`\ndistinct projects: ${report.distinctProjects}; outside folder unchanged: ${report.outsideUnchanged}; host server hits: ${report.serverHits}\nreport: ${join(workdir, 'out', 'test-run-results.json')}\n`);
  return report.results.some((r) => r.outcome === 'FAIL') || !report.distinctProjects || !report.outsideUnchanged || report.serverHits > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
