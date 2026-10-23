#!/usr/bin/env node
import { checkNodeVersion } from '../src/cli/node-version.js';

const tooOld = checkNodeVersion(process.versions.node);
if (tooOld) {
  process.stderr.write(tooOld);
  process.exit(1);
}

// Loaded only after the version check passed.
const { main } = await import('../src/cli/main.js');
// A frozen copy, so no command can change the environment for the rest of the process.
const env = Object.freeze({ ...process.env });
// stdin is there for the human-only commands, which ask in a real terminal (unit 06).
const io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, env, cwd: process.cwd() };
process.exitCode = await main(process.argv.slice(2), io);
