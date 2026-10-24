#!/usr/bin/env node
import { checkNodeVersion } from '../src/cli/node-version.js';

// The `mirai` command on your PATH (unit 12b): it runs the MIRAI pinned in the repo you're in,
// and only a copy it may trust (src/launch/launch.js). Hooks, CI, the broker and the trust root
// call a copy's bin/mirai.js directly instead, which never hands over to another copy.
const tooOld = checkNodeVersion(process.versions.node);
if (tooOld) {
  process.stderr.write(tooOld);
  process.exit(1);
}

const { spawn } = await import('node:child_process');
const { fileURLToPath } = await import('node:url');
const { join } = await import('node:path');
const { decide } = await import('../src/launch/launch.js');
const { copyDigest, sealedCopy } = await import('../src/launch/runtime.js');
const argv = process.argv.slice(2);
const env = Object.freeze({ ...process.env });
const SELF_ENTRY = fileURLToPath(new URL('./mirai.js', import.meta.url));

let decision;
try {
  decision = decide({ cwd: process.cwd(), env, argv: argv[0] === 'which' ? argv.slice(1) : argv });
} catch (err) {
  process.stderr.write(`mirai: ${err.message}\n${err.hint ? `${err.hint}\n` : ''}`);
  process.exit(err.exitCode ?? 1);
}

if (argv[0] === 'which') {
  // `mirai which [<command>]`: which MIRAI would run here, and why.
  if (decision.refuse) process.stdout.write(`none may run here: ${decision.refuse}\n${decision.hint}\n`);
  else process.stdout.write(`runs: ${decision.run === 'self' ? SELF_ENTRY : join(decision.storeDir, 'runtime', copyDigest(decision.files), 'bin', 'mirai.js')}\nwhy: ${decision.why}\n`);
  process.exit(decision.refuse ? decision.exitCode : 0);
}
if (decision.refuse && (argv[0] === '--version' || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help' || argv.length === 0)) {
  // Asking about MIRAI itself still works: the launcher answers, and says why the repo's copy
  // didn't.
  process.stderr.write(`mirai: this repo's copy may not run (${decision.refuse}); this is the launcher's own answer\n`);
  decision = { run: 'self' };
}
if (decision.refuse) {
  process.stderr.write(`mirai: ${decision.refuse}\n${decision.hint}\n`);
  process.exit(decision.exitCode);
}
if (decision.run === 'self') {
  await import('./mirai.js');
} else {
  let sealed;
  try {
    sealed = sealedCopy({ root: process.cwd(), env, storeDir: decision.storeDir, commit: decision.commit, files: decision.files });
  } catch (err) {
    process.stderr.write(`mirai: ${err.message}\n${err.hint ? `${err.hint}\n` : ''}`);
    process.exit(err.exitCode ?? 1);
  }
  // The child shares the terminal, so Ctrl-C reaches it directly: the launcher waits for it to
  // finish instead of exiting first. Signals sent to the launcher alone are passed on.
  let child = null;
  process.on('SIGINT', () => {});
  for (const sig of ['SIGTERM', 'SIGHUP']) process.on(sig, () => child?.kill(sig));
  child = spawn(process.execPath, [join(sealed.dir, 'bin', 'mirai.js'), ...argv], { stdio: 'inherit', env });
  child.on('error', (err) => {
    process.stderr.write(`mirai: ${sealed.dir} couldn't be started (${err.code})\n`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}
