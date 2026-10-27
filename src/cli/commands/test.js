import { EXIT } from '../exit-codes.js';
import { runTest } from '../../tests/run.js';

// mirai test <name> [--path <p>] (unit 14c): runs one test level or named check now, in the
// project's own containers, from a copy of the project (src/tests/run.js), and prints the
// result. For you; agents get the same through run_tests (unit 14d).
export default {
  name: 'test',
  summary: 'Run one test level or check in the project\'s containers',
  usage: 'mirai test <name> [--path <file or test id>]',
  positionals: { min: 1, max: 1 },
  options: {
    path: { type: 'string', description: 'one file or test id, passed to the command after --' },
  },
  run(args, io) {
    const [name] = args.positionals;
    io.stderr.write(`running ${name} in a copy of the project…\n`);
    // Ctrl-C stops the Docker call under way (it gets the signal too); the run then still
    // removes its containers and copy before exiting, instead of dying with them left behind.
    const ignore = () => {};
    process.on('SIGINT', ignore);
    process.on('SIGTERM', ignore);
    let r;
    try {
      // `io.docker`: a test's stand-in for Docker Desktop (never set by the CLI itself).
      r = runTest({ cwd: io.cwd, env: io.env, name, path: args.values.path ?? null, ...(io.docker ? { docker: io.docker } : {}) });
    } finally {
      process.off('SIGINT', ignore);
      process.off('SIGTERM', ignore);
    }
    const head = r.outcome === 'timeout'
      ? `${name}: timed out after ${Math.round(r.duration_ms / 1000)} s (an environment fault, not a failing test)`
      : `${name}: ${r.outcome === 'pass' ? 'passed' : `failed (exit ${r.exit_code})`} in ${Math.round(r.duration_ms / 1000)} s`;
    io.stdout.write([
      r.output.tail.trimEnd(),
      r.output.truncated ? '(earlier output cut; only the last 64 KiB is kept)' : null,
      '',
      head,
      `  service ${r.service}, ${r.tree.files} files copied (tree ${r.tree.hash.slice(0, 12)}), base ${r.base_sha.slice(0, 12)}`,
      r.out_files.length ? `  output files: ${r.out_files.length} in ${r.dir}/out` : null,
      '',
    ].filter((l) => l !== null).join('\n'));
    // A refusal or environment fault throws (its message and hint are printed by the CLI; the
    // result is stored all the same).
    return r.outcome === 'pass' ? EXIT.OK : r.outcome === 'timeout' ? EXIT.NEEDS_HUMAN : EXIT.FAILURE;
  },
};
