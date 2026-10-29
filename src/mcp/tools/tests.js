import { checkPathForm, checkTestId, PATH_MAX, TEST_ID_MAX } from '../args.js';
import { runTest } from '../../tests/run.js';

// run_tests(level, path? or test?) and run_check(name) (unit 14d): 14c's executor, as the agent's run
// (`by: "agent"`) or your session's (`by: "session"`, unit 15b), never signed. In an agent run,
// D-54's .git hash is checked before the call, once the run's turn comes (before the executor's
// first git call on the checkout) and after; a change stops the server. Unit 16a: one test by its
// ID (`test`), for a level with a test adapter, and the report's counts and failing tests.

export const INLINE_TAIL_BYTES = 32 * 1024;
// The failing tests take at most this much of the reply; the output's tail gets what's left of
// INLINE_TAIL_BYTES, so the whole reply stays within Claude Code's limit for an MCP result.
export const INLINE_FAILING_BYTES = 16 * 1024;
// And at most this many of them.
export const INLINE_FAILING = 50;

// What an agent sees of a result: no store paths (agents can't read the store anyway).
export function inlineResult(r) {
  const failing = [];
  let used = 0;
  for (const f of (r.failing ?? []).slice(0, INLINE_FAILING)) {
    const size = Buffer.byteLength(JSON.stringify(f, null, 2));
    if (used + size > INLINE_FAILING_BYTES) break;
    used += size;
    failing.push(f);
  }
  // Measured as the server sends it (JSON, where a quote or a control character takes more than
  // one byte), not as raw text.
  const tailMax = INLINE_TAIL_BYTES - used;
  const encoded = (t) => Buffer.byteLength(JSON.stringify(t));
  let tailText = r.output?.tail ?? '';
  const cut = encoded(tailText) > tailMax;
  while (encoded(tailText) > tailMax) tailText = Buffer.from(tailText).subarray(Math.max(1, encoded(tailText) - tailMax)).toString('utf8');
  return {
    id: r.id,
    outcome: r.outcome,
    ...(r.code ? { code: r.code } : {}),
    ...(r.message ? { message: r.message } : {}),
    exit_code: r.exit_code ?? null,
    duration_s: Math.round((r.duration_ms ?? 0) / 1000),
    [r.kind === 'check' ? 'check' : 'level']: r.name,
    path: r.path ?? null,
    ...(r.test ? { test: r.test } : {}),
    ...(r.report ? { report: r.report, ...(r.report_problem ? { report_problem: r.report_problem } : {}), tests: r.tests, failing, failing_total: r.failing_total ?? 0 } : {}),
    output_tail: tailText,
    output_truncated: cut || Boolean(r.output?.truncated),
    out_files: r.out_files ?? [],
    isolated_binds: r.isolated_binds ?? [],
    tree_hash: r.tree?.hash ?? null,
  };
}

async function execute({ name, path, test = null }, ctx) {
  const { policy, sameRepo, stop, clean, signal, note } = ctx;
  if (!sameRepo()) return stop('the repo\'s .git changed since the launch');
  let started = true;
  try {
    let r;
    try {
      r = await (ctx.deps.runTest ?? runTest)({
        cwd: policy.checkout, env: ctx.env, name, path, test, trust: ctx.trust, by: policy.kind === 'headless' ? 'agent' : 'session', signal, launchId: policy.launch_id ?? null,
        onWait: () => note(`waiting for another test run, then ${name}`),
        // The run's turn: .git is checked again before the executor's first git call.
        onTurn: () => {
          note(`running ${name}`);
          if (!sameRepo()) throw Object.assign(new Error('the repo\'s .git changed while the run waited'), { code: 'repo-changed' });
        },
        ...(policy.docker_socket ? { docker: { socket: policy.docker_socket } } : {}),
      });
    } catch (err) {
      if (!err.result) throw err;
      r = err.result;
    }
    if (!sameRepo()) return stop('the repo\'s .git changed during a test run');
    started = false;
    const out = inlineResult(r);
    return { body: { ...out, ...(out.message ? { message: clean(out.message) } : {}) }, isError: !['pass', 'fail'].includes(r.outcome) };
  } catch (err) {
    if (err.code === 'repo-changed') return stop(err.message);
    // The after check holds for every way a run ends.
    if (started && !sameRepo()) return stop('the repo\'s .git changed during a test run');
    const outcome = ['unknown-test', 'bad-path', 'no-adapter', 'unknown-adapter', 'bad-adapter'].includes(err.code) ? 'refused' : 'env-fault';
    return { body: { outcome, code: err.code ?? 'error', message: clean(err.message), ...(err.hint ? { hint: clean(err.hint) } : {}) }, isError: true };
  }
}

const named = (value, list, what) => (typeof value === 'string' && list.includes(value)
  ? null
  : `${JSON.stringify(value)} isn't a configured ${what}; configured: ${list.join(', ') || 'none'}`);

export const runTests = Object.freeze({
  name: 'run_tests',
  description: 'Run one of the project\'s test levels in its own containers (a copy of the project, no network out), optionally for one file or folder, or one test by its ID (<file>::<test name>, on levels with a test adapter). Returns the outcome, exit code and the end of the output, and on levels with a test adapter the test counts and the failing tests (ID, kind: assertion, error, not-found or load, and the first line of the message).',
  exclusive: true,
  contexts: Object.freeze(['headless', 'interactive']),
  enabled: (policy) => Boolean(policy.tools.run_tests),
  schema: (policy) => ({
    type: 'object',
    properties: {
      level: { type: 'string', enum: [...policy.tools.run_tests.levels], description: 'the test level' },
      path: { type: 'string', maxLength: PATH_MAX, pattern: '^[A-Za-z0-9_][A-Za-z0-9_./@-]*$', description: 'optional: one file or folder, relative to the project\'s top' },
      test: { type: 'string', maxLength: TEST_ID_MAX, description: 'optional, instead of path: one test, as <file>::<test name> with the file relative to the project\'s top and the name as the failing list shows it' },
    },
    required: ['level'],
    additionalProperties: false,
  }),
  check(args, policy) {
    const bad = named(args.level, policy.tools.run_tests.levels, 'test level');
    if (bad) return { refused: bad };
    if (args.path !== undefined && args.test !== undefined) return { refused: 'give path or test, not both' };
    if (args.test !== undefined) {
      try {
        checkTestId(args.test);
      } catch (err) {
        return { refused: err.message };
      }
      return { args: { name: args.level, path: null, test: args.test } };
    }
    if (args.path === undefined) return { args: { name: args.level, path: null } };
    if (typeof args.path !== 'string') return { refused: 'path must be a string' };
    try {
      return { args: { name: args.level, path: checkPathForm(args.path) } };
    } catch (err) {
      return { refused: err.message };
    }
  },
  run: execute,
});

export const runCheck = Object.freeze({
  name: 'run_check',
  description: 'Run one of the project\'s named checks (such as lint) in its own containers, on a copy of the project. Returns the outcome, exit code and the end of the output.',
  exclusive: true,
  contexts: Object.freeze(['headless', 'interactive']),
  enabled: (policy) => Boolean(policy.tools.run_check),
  schema: (policy) => ({
    type: 'object',
    properties: { name: { type: 'string', enum: [...policy.tools.run_check.checks], description: 'the check' } },
    required: ['name'],
    additionalProperties: false,
  }),
  check(args, policy) {
    const bad = named(args.name, policy.tools.run_check.checks, 'check');
    return bad ? { refused: bad } : { args: { name: args.name, path: null } };
  },
  run: execute,
});
