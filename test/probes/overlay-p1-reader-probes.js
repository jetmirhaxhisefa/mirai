#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from './overlay-p1-probes.js';

// Unit 37's P1, the reader test, for the build runner, which passes only --yes: on the folder the
// last `overlay-p1-probes.js --setup <dir>` wrote to ~/.mirai-probes/u37-p1-dir (or $MIRAI_P1_DIR).
// One Sonnet run. The runner keeps a passing probe's result by this file's text, so running it
// again after a pass needs an edit here.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--yes')) {
    process.stderr.write('--yes: one Sonnet run on your Claude subscription\n');
    process.exit(2);
  }
  run(['--reader', '--yes']);
}
