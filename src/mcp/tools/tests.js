import { checkPathForm, PATH_MAX } from '../args.js';
import { runTest } from '../../tests/run.js';

// run_tests(level, path?) and run_check(name) (unit 14d): 14c's executor, as the agent's run
// (`by: "agent"`, never signed). D-54's .git hash is checked before the call, once the run's turn
// comes (before the executor's first git call on the checkout) and after; a change stops the
// server.

export const INLINE_TAIL_BYTES = 32 * 1024;

// What an agent sees of a result: no store paths (agents can't read the store anyway).
export function inlineResult(r) {
  const tailText = r.output?.tail ?? '';
  const cut = Buffer.byteLength(tailText) > INLINE_TAIL_BYTES;
  return {
    id: r.id,
    outcome: r.outcome,
    ...(r.code ? { code: r.code } : {}),
    ...(r.message ? { message: r.message } : {}),
    exit_code: r.exit_code ?? null,
    duration_s: Math.round((r.duration_ms ?? 0) / 1000),
    [r.kind === 'check' ? 'check' : 'level']: r.name,
    path: r.path ?? null,
    output_tail: cut ? Buffer.from(tailText).subarray(-INLINE_TAIL_BYTES).toString('utf8') : tailText,
    output_truncated: cut || Boolean(r.output?.truncated),
    out_files: r.out_files ?? [],
    isolated_binds: r.isolated_binds ?? [],
    tree_hash: r.tree?.hash ?? null,
  };
}

async function execute({ name, path }, ctx) {
  const { policy, sameRepo, stop, clean, signal, note } = ctx;
  if (!sameRepo()) return stop('the repo\'s .git changed since the launch');
  let started = true;
  try {
    let r;
    try {
      r = await (ctx.deps.runTest ?? runTest)({
        cwd: policy.checkout, env: ctx.env, name, path, trust: ctx.trust, by: 'agent', signal, launchId: policy.launch_id,
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
    const outcome = err.code === 'unknown-test' || err.code === 'bad-path' ? 'refused' : 'env-fault';
    return { body: { outcome, code: err.code ?? 'error', message: clean(err.message), ...(err.hint ? { hint: clean(err.hint) } : {}) }, isError: true };
  }
}

const named = (value, list, what) => (typeof value === 'string' && list.includes(value)
  ? null
  : `${JSON.stringify(value)} isn't a configured ${what}; configured: ${list.join(', ') || 'none'}`);

export const runTests = Object.freeze({
  name: 'run_tests',
  description: 'Run one of the project\'s test levels in its own containers (a copy of the project, no network out), optionally for one file or folder. Returns the outcome, exit code and the end of the output.',
  exclusive: true,
  contexts: Object.freeze(['headless']),
  enabled: (policy) => Boolean(policy.tools.run_tests),
  schema: (policy) => ({
    type: 'object',
    properties: {
      level: { type: 'string', enum: [...policy.tools.run_tests.levels], description: 'the test level' },
      path: { type: 'string', maxLength: PATH_MAX, pattern: '^[A-Za-z0-9_][A-Za-z0-9_./@-]*$', description: 'optional: one file or folder, relative to the project\'s top' },
    },
    required: ['level'],
    additionalProperties: false,
  }),
  check(args, policy) {
    const bad = named(args.level, policy.tools.run_tests.levels, 'test level');
    if (bad) return { refused: bad };
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
  contexts: Object.freeze(['headless']),
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
