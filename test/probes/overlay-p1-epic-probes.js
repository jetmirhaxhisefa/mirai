#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from './overlay-p1-probes.js';

// Unit 37's P1, the lint with the graph lint and the coverage of the PRD by an epic and its
// tickets, for the build runner (which passes only --yes; no model runs): on the folder the last
// `overlay-p1-probes.js --setup <dir>` wrote to ~/.mirai-probes/u37-p1-dir (or $MIRAI_P1_DIR). The
// runner keeps a passing probe's result by this file's text, so running it again after a pass needs
// an edit here.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(['--epic']);
