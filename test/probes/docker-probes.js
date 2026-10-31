#!/usr/bin/env node
import { mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { DESKTOP_DOCKER, runDockerProbes } from '../../src/redteam/probes/docker.js';

// Unit 14a's Docker and Compose probes, by hand. Since unit 18c they live in
// src/redteam/probes/docker.js and also run as part of the red team.
//
//   node test/probes/docker-probes.js --yes [--workdir <dir>] [--only id,id] [--keep] [--docker <path>]

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, workdir: { type: 'string' }, only: { type: 'string' }, keep: { type: 'boolean' }, docker: { type: 'string' } } });
  if (!values.yes) {
    process.stderr.write('this starts short-lived containers from local images (nothing is pulled); add --yes to run\n');
    return 2;
  }
  const workdir = values.workdir ? resolve(values.workdir) : mkdtempSync(join(process.env.HOME, '.mirai-probes-'));
  const report = await runDockerProbes({ workdir, only: values.only?.split(',') ?? null, keep: values.keep === true, docker: values.docker ?? DESKTOP_DOCKER, log: (l) => process.stdout.write(`${l}\n`) });
  process.stdout.write(`\nreports: ${join(workdir, 'out')}\n`);
  return report.results.some((r) => r.outcome === 'FAIL') ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
