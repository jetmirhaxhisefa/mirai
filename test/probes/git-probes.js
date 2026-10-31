#!/usr/bin/env node
import { mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { runGitProbes } from '../../src/redteam/probes/git.js';

// Units 14a and 14b's git probes, by hand. Since unit 18c they live in src/redteam/probes/git.js
// and also run as part of the red team.
//
//   node test/probes/git-probes.js --yes [--mirai] [--workdir <dir>] [--only id,id] [--keep]

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, mirai: { type: 'boolean' }, workdir: { type: 'string' }, only: { type: 'string' }, keep: { type: 'boolean' } } });
  if (!values.yes) {
    process.stderr.write('this plants hostile git config in a throwaway fixture under your home folder; add --yes to run\n');
    return 2;
  }
  const workdir = values.workdir ? resolve(values.workdir) : mkdtempSync(join(process.env.HOME, '.mirai-probes-'));
  const report = await runGitProbes({ workdir, only: values.only?.split(',') ?? null, keep: values.keep === true, mirai: values.mirai === true, log: (l) => process.stdout.write(`${l}\n`) });
  process.stdout.write(`\nreports: ${join(workdir, 'out')}\n`);
  return report.results.some((r) => r.outcome === 'FAIL') ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
