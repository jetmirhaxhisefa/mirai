import { EXIT } from '../exit-codes.js';
import { escapeInvisible } from '../../status/text.js';
import { openStore } from '../../store/home.js';
import { loadSigner } from '../../sign/signer.js';
import { gateCheck } from '../../tests/gate.js';
import { runTest } from '../../tests/run.js';

// mirai test <name> [--path <p> | --test <id>] [--gate --branch <b>] (units 14c, 14d, 16a): runs
// one test level or named check now, in the project's own containers, from a copy of the project
// (src/tests/run.js), and prints the result. For you; agents get the same through run_tests.
// --test runs one test by its ID (<file>::<test name>), on a level with a test adapter.
//
// --gate signs the result with your key, bound to what ran (the tree hash, HEAD, the frozen
// compose file, the trust root): only on a clean tree with HEAD on the named branch, checked
// before the run, after the copy and before signing (src/tests/gate.js), and only for the whole
// level or check (no --path). Unit 25 builds the gate-result record from these.

export { gateCheck };

export default {
  name: 'test',
  summary: 'Run one test level or check in the project\'s containers',
  usage: 'mirai test <name> [--path <file or folder> | --test <file>::<test name>] [--gate --branch <branch>]',
  positionals: { min: 1, max: 1 },
  options: {
    path: { type: 'string', description: 'one file or folder, relative to the project\'s top' },
    test: { type: 'string', description: 'one test, as <file>::<test name> (a level with a test adapter)' },
    gate: { type: 'boolean', description: 'sign the result (a clean tree on --branch only)' },
    branch: { type: 'string', description: 'with --gate: the branch HEAD must be on' },
  },
  async run(args, io) {
    const [name] = args.positionals;
    let gate = null;
    if (args.values.gate || args.values.branch !== undefined) {
      if (!args.values.gate || !args.values.branch) {
        io.stderr.write('mirai test: --gate and --branch go together\n');
        return EXIT.USAGE;
      }
      if (args.values.path !== undefined || args.values.test !== undefined) {
        io.stderr.write('mirai test: --gate runs the whole level or check, so it takes no --path or --test\n');
        return EXIT.USAGE;
      }
      const store = openStore({ cwd: io.cwd, env: io.env });
      gate = { ...gateCheck(store.checkout, args.values.branch, io.env), signer: loadSigner(io.env, store) };
    }
    io.stderr.write(`running ${name} in a copy of the project…\n`);
    // Ctrl-C, a kill or a closed terminal cancels the run: the Docker call under way is killed (it
    // runs in its own process group, so the signal doesn't reach it), then the run still removes
    // its containers and copy before exiting. A SIGKILL can't be caught: what it leaves is swept
    // by the project's next test run.
    const controller = new AbortController();
    const ignore = () => controller.abort();
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    for (const sig of signals) process.on(sig, ignore);
    let r;
    try {
      // `io.docker`: a test's stand-in for Docker Desktop (never set by the CLI itself).
      r = await runTest({
        ...(io.testRun ?? {}), ...(io.docker ? { docker: io.docker } : {}),
        cwd: io.cwd, env: io.env, name, path: args.values.path ?? null, test: args.values.test ?? null, gate, signal: controller.signal,
        onWait: () => io.stderr.write('waiting for another test run to finish…\n'),
      });
    } finally {
      for (const sig of signals) process.off(sig, ignore);
    }
    const head = r.outcome === 'timeout'
      ? `${name}: timed out after ${Math.round(r.duration_ms / 1000)} s (an environment fault, not a failing test)`
      : `${name}: ${r.outcome === 'pass' ? 'passed' : `failed (exit ${r.exit_code})`} in ${Math.round(r.duration_ms / 1000)} s`;
    // A level with an adapter: the counts, and the failing tests by ID, kind and message.
    const t = r.tests;
    const counts = t ? `  tests: ${t.total} (${t.passed} passed, ${t.failed} failed, ${t.errors} errors, ${t.skipped} skipped)${t.outside ? `; ${t.outside} more ran outside what was asked` : ''}` : null;
    // Report text, escaped as JSON escapes it (no control character reaches the terminal).
    const plain = (text) => escapeInvisible(JSON.stringify(String(text)).slice(1, -1));
    const failing = (r.failing ?? []).map((f) => `  ${f.kind.padEnd(9)} ${plain(f.id ?? f.name ?? r.name)}${f.message ? `\n            ${plain(f.message)}` : ''}`);
    if (r.failing_total > failing.length) failing.push(`  … and ${r.failing_total - failing.length} more`);
    io.stdout.write([
      r.output.tail.trimEnd(),
      r.output.truncated ? '(earlier output cut; only the last 64 KiB is kept)' : null,
      '',
      head,
      counts,
      ...failing,
      `  service ${r.service}, ${r.tree.files} files copied (tree ${r.tree.hash.slice(0, 12)}), base ${r.base_sha.slice(0, 12)}`,
      r.out_files.length ? `  output files: ${r.out_files.length} in ${r.dir}/out` : null,
      r.signature ? `  signed with ${r.signature.key_id} for ${r.gate.branch} at ${r.gate.head.slice(0, 12)}: ${r.dir}/result.json` : null,
      '',
    ].filter((l) => l !== null).join('\n'));
    // A refusal or environment fault throws (its message and hint are printed by the CLI; the
    // result is stored all the same).
    return r.outcome === 'pass' ? EXIT.OK : r.outcome === 'timeout' ? EXIT.NEEDS_HUMAN : EXIT.FAILURE;
  },
};
