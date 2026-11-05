import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildRecordPath, runBuild, handoverFrom, testsAfter, HANDOVER_SCHEMA } from '../../src/agent/build.js';
import { runFix } from '../../src/agent/fix.js';
import { launchInRun } from '../../src/agent/run.js';
import { agentSessionDir, forgetSession, keepSession, keptSession, restoreSession } from '../../src/agent/session.js';
import { MiraiError } from '../../src/cli/errors.js';
import { prepareBranch, ticketSlug } from '../../src/agent/branch.js';
import { newDependencies } from '../../src/agent/deps.js';
import { planPath, runPlan } from '../../src/agent/plan.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { againstBaseline } from '../../src/baseline/compare.js';
import { writeBaseline } from '../../src/baseline/store.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { loadRegistry } from '../../src/config/registry.js';
import { readLoop } from '../../src/loop/guard.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { loadSigner } from '../../src/sign/signer.js';
import { writeToken } from '../../src/sign/token.js';
import { symbolicBranch, workTreeChanges } from '../../src/store/git.js';
import { openStore } from '../../src/store/home.js';
import { readRunLog, runIds } from '../../src/store/run-log.js';
import { readTicketStatus } from '../../src/store/tickets.js';
import { snapshot } from '../../src/trust/snapshot.js';
import { installed, tempDir } from '../tests/run-fixture.js';

// Unit 21b: the build step, with a stand-in `claude`, a stand-in test run, and no model.

const TOKEN = `sk-ant-oat01-${'Ag3_-k'.repeat(16)}`;
const INIT = '{"type":"system","subtype":"init","permissionMode":"dontAsk"}';
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const PLAN = readFileSync(join(REGISTRY_DIR, 'examples', 'plan.md'), 'utf8');
const CONFIG = '\n[[testing.levels]]\nname = "unit"\ncommand = ["run-tests"]\nservice = "app"\n\n[[testing.levels]]\nname = "feature"\ncommand = ["run-tests"]\nservice = "app"\n\n[compose]\nfiles = ["compose.yml"]\nenv_file = ".env.test"\n';
const doc = (fm, body) => `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`).join('\n')}\n---\n${body}`;
const TICKET = doc({ id: 'PMT-31', type: 'story', template: 'story@v1', repo: '"."', risk: 'normal', size: 'M', verify: '"Rename a team on staging."', tdd: 'first' },
  '# Renaming a team hides its members\n\n## Acceptance criteria\n\n- AC-PMT-31.1: the members stay after a rename\n- AC-PMT-31.2: the old slug redirects\n');
const FILES = { 'docs/mirai/tickets/PMT-31.md': TICKET, 'package.json': '{\n  "name": "app",\n  "dependencies": { "express": "^4" }\n}\n', 'app/Team.php': '<?php\n' };

async function tty(argv, { cwd, env }, answers) {
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd });
  return { code, out, err };
}

// A stand-in claude answering each launch with the next of `results` ({ structured } or a raw
// result), after running `before[n]` (shell) in the project.
function claudeWith(results, before = []) {
  const dir = realpathSync(tempDir('claude'));
  results.forEach((r, i) => {
    writeFileSync(join(dir, `r${i}.json`), `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 9, usage: { input_tokens: 5, output_tokens: 6 }, result: 'done', structured_output: r })}\n`);
    writeFileSync(join(dir, `b${i}.sh`), `${before[i] ?? ':'}\n`);
  });
  writeFileSync(join(dir, 'n'), '0');
  const path = join(dir, 'claude');
  writeFileSync(path, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.316 (Claude Code)"; exit 0; fi\nn=$(cat ${dir}/n); echo $((n+1)) > ${dir}/n\nfor a in "$@"; do printf '%s\\n' "$a"; done > ${dir}/args$n\n. ${dir}/b$n.sh\necho '${INIT}'; cat ${dir}/r$n.json\n`, { mode: 0o755 });
  return { path, args: (n) => readFileSync(join(dir, `args${n}`), 'utf8').split('\n'), launches: () => Number(readFileSync(join(dir, 'n'), 'utf8')) };
}
const watch = (claude) => ({ claude: claude.path, status: green, check: () => [] });
const passing = async ({ name }) => ({ outcome: 'pass', id: `t-${name}`, tests: { total: 3, passed: 3, failed: 0, errors: 0, skipped: 0 } });
// A level as a baseline records it: passing, three tests.
const PASSED = { state: 'pass', known_failures: [], tests: { total: 3, skipped: 0 } };

// A repo with the ticket approved and its plan approved (21a), ready to build.
async function ready({ plan = PLAN, files = FILES, baseline = true } = {}) {
  const f = installed({ config: CONFIG, files });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  writeToken(f.env, TOKEN);
  // Your name and email, which MIRAI's commits credit (unit 22).
  writeFileSync(join(f.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Test Author"\nauthor_email = "author@example.com"\n', { mode: 0o600 });
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  const io = { cwd: f.root, env: f.env };
  assert.equal((await tty(['approve', 'PMT-31', '--file', 'docs/mirai/tickets/PMT-31.md'], io, ['a', 'PMT-31'])).code, EXIT.OK);
  const r = await runPlan({ cwd: f.root, env: f.env, ticket: 'PMT-31', launchTokens: [mintLaunchToken(), mintLaunchToken()], launchOptions: watch(claudeWith([{ plan }])) });
  assert.equal(r.outcome, 'waiting', JSON.stringify(r.problems));
  const ok = await tty(['approve', 'PMT-31', '--plan'], io, ['a', 'PMT-31']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  const store = openStore(io);
  // A signed baseline for the integration commit, every level passing: no baseline is never green.
  if (baseline) writeBaseline(store, { schema_version: 1, sha: snapshot(io).baseSha, levels: { unit: PASSED, feature: PASSED } }, loadSigner(f.env, store));
  return { ...f, store };
}
const build = (f, claude, o = {}) => runBuild({ cwd: f.root, env: f.env, ticket: 'PMT-31', launchToken: mintLaunchToken(), launchOptions: watch(claude), testRun: passing, ...o });
const done = { status: 'done', summary: 'Changed app/Team.php.', tests_run: ['unit: pass'], checks_run: [] };

test('T1: mirai build refuses a ticket not in progress, an unapproved plan, an edited plan; it builds from the verified text', async () => {
  const f = await ready();
  const text = readFileSync(planPath(f.store, 'PMT-31'), 'utf8');
  writeFileSync(planPath(f.store, 'PMT-31'), text.replace('**Problem:**', '**Problem (edited):**'));
  await assert.rejects(build(f, claudeWith([done])), (e) => e.code === 'plan-not-approved' && /changed after it was approved/.test(e.message));
  writeFileSync(planPath(f.store, 'PMT-31'), text);
  const claude = claudeWith([done], ['echo "// x" >> app/Team.php']);
  const r = await build(f, claude);
  assert.equal(r.outcome, 'handed-over', r.why);
  const args = claude.args(0);
  const inputs = args[args.indexOf('--add-dir') + 1];
  assert.ok(inputs);
  assert.equal(args[args.indexOf('--tools') + 1], 'Bash,Edit,Glob,Grep,Read,Write');
  assert.deepEqual(JSON.parse(args[args.indexOf('--json-schema') + 1]).required, ['status', 'summary']);
  // Not in progress any more: refused.
  await assert.rejects(build(f, claudeWith([done])), (e) => e.code === 'not-ready');
});

test('T2: the branch: made from the integration commit with its record, then reused; a dirty tree or a branch MIRAI didn\'t make is refused', async () => {
  assert.equal(ticketSlug(TICKET), 'renaming-a-team-hides-its-members');
  assert.equal(ticketSlug('---\nid: x\n---\n# Ça marche: déjà vu!\n'), 'ca-marche-deja-vu');
  const f = await ready();
  const trust = snapshot({ cwd: f.root, env: f.env });
  const config = (await import('../../src/trust/snapshot.js')).trustedConfig(trust);
  const signer = loadSigner(f.env, f.store);
  const opts = { store: f.store, env: f.env, trust, config, keys: signer.keys, signer: () => signer, ticket: 'PMT-31', ticketText: TICKET };
  writeFileSync(join(f.root, 'app/Team.php'), '<?php // mine\n');
  assert.throws(() => prepareBranch(opts), (e) => e.code === 'dirty-tree');
  f.git('checkout', '--', 'app/Team.php');
  const made = prepareBranch(opts);
  assert.equal(made.branch, 'feature/PMT-31-renaming-a-team-hides-its-members');
  assert.equal(made.created, true);
  assert.equal(made.base, trust.baseSha);
  assert.equal(symbolicBranch(f.store.checkout, 'HEAD', f.store.gitEnv), made.branch);
  const again = prepareBranch(opts);
  assert.deepEqual([again.created, again.head], [false, made.head]);
  // A commit MIRAI didn't make: refused.
  writeFileSync(join(f.root, 'app/Team.php'), '<?php // a commit of its own\n');
  f.git('commit', '-qam', 'own');
  f.git('checkout', '-q', 'main');
  assert.throws(() => prepareBranch(opts), (e) => e.code === 'branch-not-mirai');
  assert.throws(() => prepareBranch({ ...opts, config: { ...config, git: { ...config.git, branch_pattern: '{ticket}..x' } } }), (e) => e.code === 'bad-branch');
});

test('T3: the handover is the structured output only; blocked stays in-progress with its reason; a handover file is ignored', async () => {
  assert.deepEqual(handoverFrom({ status: 'done', summary: 's' }), { status: 'done', summary: 's', tests_run: [], checks_run: [], blocked_reason: null });
  for (const s of [null, [], {}, { status: 'finished', summary: 's' }, { status: 'done' }, { status: 'done', summary: 's', verdict: 'pass' }]) assert.ok(handoverFrom(s).problem, JSON.stringify(s));
  assert.deepEqual(Object.keys(HANDOVER_SCHEMA.properties), ['status', 'summary', 'tests_run', 'checks_run', 'blocked_reason']);
  const f = await ready();
  const r = await build(f, claudeWith([{ status: 'blocked', summary: 'stopped', blocked_reason: 'npm:left-pad is declared but not installed' }], ['echo \'{"status":"done"}\' > handover.json']));
  assert.equal(r.outcome, 'blocked');
  assert.match(r.why, /not installed/);
  assert.equal(readTicketStatus(f.store, 'PMT-31').status.state, 'in-progress');
  const g = await ready();
  const none = await build(g, { path: claudeWith([null]).path });
  assert.equal(none.outcome, 'agent-failed');
  assert.match(none.why, /no handover/);
});

test('T4: protected paths and new dependencies are checked against the plan', async () => {
  // An undeclared protected path stops for you; the files stay.
  const f = await ready();
  const r = await build(f, claudeWith([done], ['mkdir -p .github/workflows; echo "on: push" > .github/workflows/ci.yml']));
  assert.equal(r.outcome, 'needs-you');
  assert.match(r.why, /protected paths the plan didn't declare: \.github\/workflows\/ci\.yml/);
  assert.ok(existsSync(join(f.root, '.github/workflows/ci.yml')), 'left for you');
  assert.equal(readTicketStatus(f.store, 'PMT-31').status.state, 'in-progress');
  // Declared: it passes.
  const declaredPlan = PLAN.replace('| none | | |', '| protected-path | .github/workflows/ci.yml | runs the new test in CI |');
  const g = await ready({ plan: declaredPlan });
  assert.equal((await build(g, claudeWith([done], ['mkdir -p .github/workflows; echo "on: push" > .github/workflows/ci.yml']))).outcome, 'handed-over');
  // An auto-run path always stops.
  // An auto-run path parks the ticket, declared or not (D-15).
  const h = await ready({ plan: PLAN.replace('| none | | |', '| protected-path | .mirai/framework/x.js | no |') });
  const auto = await build(h, claudeWith([done], ['echo x > .mirai/framework/x.js']));
  assert.equal(auto.outcome, 'parked');
  assert.match(auto.why, /run by themselves/);
  const parked = readTicketStatus(h.store, 'PMT-31').status;
  assert.deepEqual([parked.state, parked.park_reason], ['blocked', 'scope']);
  // An undeclared dependency stops; a declared one passes.
  const add = ['sed -i "" \'s/"express": "\\^4"/"express": "^4", "left-pad": "^1"/\' package.json'];
  const i = await ready();
  const dep = await build(i, claudeWith([done], add));
  assert.equal(dep.outcome, 'needs-you');
  assert.match(dep.why, /dependencies the plan didn't declare: npm:left-pad \(package\.json\)/);
  const j = await ready({ plan: PLAN.replace('risk: normal', 'risk: high').replace('| none | | |', '| dependency | npm:left-pad | padding |') });
  assert.equal((await build(j, claudeWith([done], add))).outcome, 'handed-over');
});

test('T4b: dependencies from stack data: moved between keys isn\'t new; an unreadable manifest and a lock change alone are named', () => {
  const f = installed({ config: CONFIG, files: { ...FILES, 'backend/composer.json': '{"require": {"laravel/framework": "^11"}, "require-dev": {"phpunit/phpunit": "^11"}}\n' } });
  const stacks = loadRegistry(REGISTRY_DIR).stacks;
  const base = f.git('rev-parse', 'HEAD');
  writeFileSync(join(f.root, 'backend/composer.json'), '{"require": {"laravel/framework": "^11", "phpunit/phpunit": "^11"}, "require-dev": {"mockery/mockery": "^1"}}\n');
  writeFileSync(join(f.root, 'package.json'), '{ not json');
  mkdirSync(join(f.root, 'web'), { recursive: true });
  writeFileSync(join(f.root, 'web/package-lock.json'), '{}');
  const r = newDependencies({ root: f.root, env: { PATH: '/usr/bin:/bin', HOME: f.home }, base, changed: ['backend/composer.json', 'package.json', 'web/package-lock.json'], stacks, declared: ['composer:Mockery/Mockery'] });
  assert.deepEqual(r.added, [{ path: 'backend/composer.json', dependency: 'composer:mockery/mockery' }]);
  assert.deepEqual(r.undeclared, []);
  assert.deepEqual(r.unreadable, ['package.json']);
  assert.deepEqual(r.lockOnly, ['web/package-lock.json']);
});

test('T5: MIRAI\'s own test run decides: green moves to in-review, a new failure stays, a known one doesn\'t count, no baseline is unknown', async () => {
  // The comparison rule.
  const known = [{ id: 'tests/A.php::a', scope: 'test' }, { scope: 'level', kind: 'not-found' }];
  const fail = (failing, extra = {}) => ({ outcome: 'fail', failing, failing_total: failing.length, tests: { total: 3 }, ...extra });
  assert.equal(againstBaseline({ outcome: 'pass' }, null).verdict, 'pass');
  assert.equal(againstBaseline(fail([{ id: 'tests/A.php::a' }]), known).verdict, 'pass');
  assert.deepEqual(againstBaseline(fail([{ id: 'tests/A.php::a' }, { id: 'tests/B.php::b' }]), known).fresh, ['tests/B.php::b']);
  assert.equal(againstBaseline(fail([{ id: 'tests/A.php::a' }]), null).verdict, 'unknown');
  assert.equal(againstBaseline({ outcome: 'env-fault', code: 'docker' }, known).verdict, 'unknown');
  assert.equal(againstBaseline(fail([{ id: null, kind: 'not-found' }]), known).verdict, 'pass');
  assert.equal(againstBaseline(fail([{ id: null, kind: 'load' }]), known).verdict, 'fail');
  assert.equal(againstBaseline({ outcome: 'fail' }, [{ scope: 'level', kind: 'no-ids' }]).verdict, 'unknown');
  assert.equal(againstBaseline({ outcome: 'fail' }, []).verdict, 'fail');
  assert.equal(againstBaseline(fail([{ id: 'x' }], { failing_total: 2000 }), known).verdict, 'unknown');

  // Through testsAfter, with a signed baseline for the base commit.
  const f = await ready({ baseline: false });
  const trust = snapshot({ cwd: f.root, env: f.env });
  const keys = loadSigner(f.env, f.store).keys;
  const config = (await import('../../src/trust/snapshot.js')).trustedConfig(trust);
  const failingUnit = async ({ name }) => (name === 'unit' ? { outcome: 'fail', failing: [{ id: 'tests/A.php::a' }], failing_total: 1, tests: { passed: 2, failed: 1, errors: 0, skipped: 0, total: 3 } } : passing({ name }));
  const noBaseline = await testsAfter({ cwd: f.root, env: f.env, store: f.store, trust, config, keys, base: trust.baseSha, run: failingUnit });
  assert.equal(noBaseline.verdict, 'unknown');
  // No baseline is never green, even when every run passed.
  const allPass = await testsAfter({ cwd: f.root, env: f.env, store: f.store, trust, config, keys, base: trust.baseSha, run: passing });
  assert.equal(allPass.verdict, 'unknown');
  assert.match(allPass.why, /no baseline/);
  writeBaseline(f.store, { schema_version: 1, sha: trust.baseSha, levels: { unit: { state: 'fail', known_failures: [{ id: 'tests/A.php::a', scope: 'test', state: 'failing' }], tests: { total: 3, skipped: 0 } }, feature: PASSED } }, loadSigner(f.env, f.store));
  assert.equal((await testsAfter({ cwd: f.root, env: f.env, store: f.store, trust, config, keys, base: trust.baseSha, run: failingUnit })).verdict, 'pass');
  const newFailure = async ({ name }) => (name === 'feature' ? { outcome: 'fail', failing: [{ id: 'tests/B.php::b' }], failing_total: 1, tests: { total: 1, failed: 1 } } : passing({ name }));
  const t = await testsAfter({ cwd: f.root, env: f.env, store: f.store, trust, config, keys, base: trust.baseSha, run: newFailure });
  assert.equal(t.verdict, 'fail');
  assert.deepEqual(t.runs.find((r) => r.name === 'feature').fresh, ['tests/B.php::b']);

  // In the build: a new failure keeps it in progress, with the record kept; Docker down is unknown.
  const r = await build(f, claudeWith([done], ['echo "// x" >> app/Team.php']), { testRun: newFailure });
  assert.equal(r.outcome, 'checks-failed');
  assert.equal(readTicketStatus(f.store, 'PMT-31').status.state, 'in-progress');
  const kept = JSON.parse(readFileSync(join(f.store.dir, 'tickets', 'PMT-31', 'build.json'), 'utf8'));
  assert.equal(kept.tests.verdict, 'fail');
  // Past the safety checks: committed by MIRAI (unit 22), so the next step starts from a clean tree.
  assert.deepEqual(workTreeChanges(f.root, f.store.gitEnv), []);
  assert.match(kept.commit, /^[0-9a-f]{40}$/);
  const g = await ready();
  const down = await build(g, claudeWith([done], ['echo "// x" >> app/Team.php']), { testRun: async () => { throw Object.assign(new Error('Docker isn\'t running'), { code: 'no-docker' }); } });
  assert.equal(down.outcome, 'needs-you');
});

test('T6 + T7: the usage check and the loop guard first; a build session isn\'t a round; the run log has both lines', async () => {
  const f = await ready();
  const claude = claudeWith([done], ['echo "// x" >> app/Team.php']);
  await assert.rejects(build(f, claude, { unattended: true }), (e) => e.code === 'usage-unknown');
  assert.equal(claude.launches(), 0);
  const r = await build(f, claude);
  assert.equal(r.outcome, 'handed-over');
  assert.equal(readTicketStatus(f.store, 'PMT-31').status.state, 'in-review');
  const loop = readLoop(f.store, 'PMT-31');
  assert.equal(loop.rounds_used, 0);
  assert.equal(loop.launches, 2, 'the plan launch and the build');
  const { lines } = readRunLog(f.store, runIds(f.store).at(-1));
  const run = lines.find((l) => l.event === 'agent_run');
  assert.deepEqual([run.agent, run.role, run.step, run.tier], ['mirai-developer', 'author', 'build', 'standard']);
  const checks = lines.find((l) => l.event === 'checks');
  assert.deepEqual(checks.named, [{ name: 'unit', result: 'pass' }, { name: 'feature', result: 'pass' }]);
  assert.equal(checks.tdd, 'first');
});

test('review: the comparison matches a known level-wide error and unmapped failure; fewer tests or a bad baseline is never green', async () => {
  const fail = (failing) => ({ outcome: 'fail', failing, failing_total: failing.length, tests: { total: 3 } });
  assert.equal(againstBaseline(fail([{ id: null, kind: 'error' }]), [{ scope: 'level', kind: 'error' }]).verdict, 'pass');
  assert.equal(againstBaseline(fail([{ id: null, kind: 'error' }]), []).verdict, 'fail');
  assert.equal(againstBaseline(fail([{ id: null, name: 'outside', kind: 'assertion' }]), [{ scope: 'level', kind: 'unmapped' }]).verdict, 'pass');
  assert.equal(againstBaseline(fail([{ id: null, name: 'outside', kind: 'assertion' }]), []).verdict, 'fail');

  const f = await ready({ baseline: false });
  const trust = snapshot({ cwd: f.root, env: f.env });
  const keys = loadSigner(f.env, f.store).keys;
  const config = (await import('../../src/trust/snapshot.js')).trustedConfig(trust);
  writeBaseline(f.store, { schema_version: 1, sha: trust.baseSha, levels: { unit: { state: 'pass', known_failures: [], tests: { total: 10, skipped: 0 } }, feature: { state: 'pass', known_failures: [] } } }, loadSigner(f.env, f.store));
  const fewer = async ({ name }) => ({ outcome: 'pass', tests: name === 'unit' ? { total: 8, passed: 8, skipped: 0 } : { total: 1, passed: 1, skipped: 0 } });
  const t = await testsAfter({ cwd: f.root, env: f.env, store: f.store, trust, config, keys, base: trust.baseSha, run: fewer });
  assert.equal(t.verdict, 'unknown');
  assert.match(t.runs[0].why, /fewer tests ran \(8 against 10\)/);
  const skipping = async ({ name }) => ({ outcome: 'pass', tests: name === 'unit' ? { total: 10, passed: 9, skipped: 1 } : { total: 1, passed: 1, skipped: 0 } });
  assert.equal((await testsAfter({ cwd: f.root, env: f.env, store: f.store, trust, config, keys, base: trust.baseSha, run: skipping })).verdict, 'unknown');
  // A baseline that doesn't verify stops the build.
  writeFileSync(join(f.store.dir, 'baseline', `${trust.baseSha}.json`), '{"schema_version":1}');
  const r = await build(f, claudeWith([done], ['echo "// x" >> app/Team.php']));
  assert.equal(r.outcome, 'needs-you');
  assert.match(r.why, /doesn't verify|can't be read/);
});

test('review: a declared dependency covers its manifest with the node pack on; scripts, sources, spec changes and stacks with no data stop', async () => {
  const withPack = { ...FILES, 'package-lock.json': '{}\n' };
  const add = ['sed -i "" \'s/"express": "\\^4"/"express": "^4", "left-pad": "^1"/\' package.json; echo "{\\"x\\":1}" > package-lock.json'];
  // The lock file is never covered by a dependency row: the plan declares it (21b re-review).
  const plan = PLAN.replace('risk: normal', 'risk: high').replace('| none | | |', '| dependency | npm:left-pad | padding |\n| protected-path | package-lock.json | the lock for left-pad |');
  const f = await ready({ plan, files: withPack });
  const cfg = join(f.root, '.mirai/config.toml');
  writeFileSync(cfg, `${readFileSync(cfg, 'utf8')}\n[gate]\npacks = ["node"]\n`);
  f.git('commit', '-qam', 'the node pack');
  writeBaseline(f.store, { schema_version: 1, sha: snapshot({ cwd: f.root, env: f.env }).baseSha, levels: { unit: PASSED, feature: PASSED } }, loadSigner(f.env, f.store));
  const covered = await build(f, claudeWith([done], add));
  assert.equal(covered.outcome, 'handed-over', covered.why);
  // The same with an undeclared one: the manifest isn't covered, so it's also an undeclared protected path.
  const g = await ready({ files: withPack });
  writeFileSync(join(g.root, '.mirai/config.toml'), `${readFileSync(join(g.root, '.mirai/config.toml'), 'utf8')}\n[gate]\npacks = ["node"]\n`);
  g.git('commit', '-qam', 'the node pack');
  const not = await build(g, claudeWith([done], add));
  assert.equal(not.outcome, 'needs-you');
  assert.match(not.why, /npm:left-pad/);

  const h = installed({ config: CONFIG, files: { ...FILES, 'package.json': '{"scripts": {"lint": "eslint ."}, "dependencies": {"lodash": "^4"}, "overrides": {}}\n' } });
  const base = h.git('rev-parse', 'HEAD');
  writeFileSync(join(h.root, 'package.json'), '{"scripts": {"lint": "true"}, "dependencies": {"lodash": "npm:evil@1"}, "overrides": {"x": "1"}}\n');
  writeFileSync(join(h.root, 'pyproject.toml'), '[project]\n');
  const d = newDependencies({ root: h.root, env: { PATH: '/usr/bin:/bin', HOME: h.home }, base, changed: ['package.json', 'pyproject.toml'], stacks: loadRegistry(REGISTRY_DIR).stacks, declared: [] });
  assert.deepEqual(d.changedSpecs, [{ path: 'package.json', dependency: 'npm:lodash' }]);
  assert.deepEqual(d.undeclared, [{ path: 'package.json', dependency: 'npm:lodash' }]);
  assert.deepEqual(d.sources, ['package.json (overrides)']);
  assert.deepEqual(d.scripts, ['package.json (scripts)']);
  assert.deepEqual(d.unchecked, ['pyproject.toml']);
  assert.deepEqual(d.covered, []);

  // A second key for an existing name with another spec is a change, though the first key is untouched;
  // a covered manifest must be otherwise as it was (21b re-review).
  const k = installed({ config: CONFIG, files: { ...FILES, 'package.json': '{"dependencies": {"foo": "^1"}}\n' } });
  const kb = k.git('rev-parse', 'HEAD');
  const env = { PATH: '/usr/bin:/bin', HOME: k.home };
  const stacks = loadRegistry(REGISTRY_DIR).stacks;
  writeFileSync(join(k.root, 'package.json'), '{"dependencies": {"foo": "^1", "left-pad": "^1"}, "optionalDependencies": {"foo": "git+https://evil.invalid/foo"}}\n');
  const twice = newDependencies({ root: k.root, env, base: kb, changed: ['package.json'], stacks, declared: ['npm:left-pad'] });
  assert.deepEqual(twice.undeclared, [{ path: 'package.json', dependency: 'npm:foo' }]);
  assert.deepEqual(twice.covered, []);
  writeFileSync(join(k.root, 'package.json'), '{"dependencies": {"foo": "^1", "left-pad": "^1"}, "packageManager": "pnpm@9.0.0"}\n');
  assert.deepEqual(newDependencies({ root: k.root, env, base: kb, changed: ['package.json'], stacks, declared: ['npm:left-pad'] }).covered, []);
  writeFileSync(join(k.root, 'package.json'), '{"devDependencies": {"foo": "^1"}, "dependencies": {"left-pad": "^1"}}\n');
  const moved = newDependencies({ root: k.root, env, base: kb, changed: ['package.json'], stacks, declared: ['npm:left-pad'] });
  assert.deepEqual([moved.undeclared, moved.covered], [[], ['package.json']], 'moved between keys with the same spec is not new');
});

test('review: a deleted file the code map doesn\'t remove stops; --recheck runs the checks again on the same tree only; the pattern names the ticket', async () => {
  const f = await ready();
  const del = await build(f, claudeWith([done], ['rm app/Team.php']));
  assert.equal(del.outcome, 'needs-you');
  assert.match(del.why, /deleted files the plan's code map doesn't remove: app\/Team\.php/);

  // Docker down: needs you; once it's back, --recheck runs MIRAI's checks again, no agent.
  const g = await ready();
  const down = await build(g, claudeWith([done], ['echo "// x" >> app/Team.php']), { testRun: async () => { throw Object.assign(new Error('Docker isn\'t running'), { code: 'no-docker' }); } });
  assert.equal(down.outcome, 'needs-you');
  const kept = JSON.parse(readFileSync(join(g.store.dir, 'tickets', 'PMT-31', 'build.json'), 'utf8'));
  assert.match(kept.fingerprint, /^[0-9a-f]{64}$/);
  const again = await runBuild({ cwd: g.root, env: g.env, ticket: 'PMT-31', recheck: true, testRun: passing });
  assert.equal(again.outcome, 'handed-over');
  assert.equal(readTicketStatus(g.store, 'PMT-31').status.state, 'in-review');
  // A tree changed after the build isn't rechecked.
  const h = await ready();
  await build(h, claudeWith([done], ['echo "// x" >> app/Team.php']), { testRun: async () => { throw Object.assign(new Error('down'), { code: 'no-docker' }); } });
  writeFileSync(join(h.root, 'app/Team.php'), '<?php // mine\n');
  await assert.rejects(runBuild({ cwd: h.root, env: h.env, ticket: 'PMT-31', recheck: true, testRun: passing }), (e) => e.code === 'tree-changed');
  // Every outcome after the launch keeps a record, a blocked one too.
  const i = await ready();
  await build(i, claudeWith([{ status: 'blocked', summary: 's', blocked_reason: 'no' }]));
  assert.equal(JSON.parse(readFileSync(join(i.store.dir, 'tickets', 'PMT-31', 'build.json'), 'utf8')).outcome, 'blocked');

  // A recheck refuses a changed plan and a file git is told to look past.
  const j = await ready();
  await build(j, claudeWith([done], ['echo "// x" >> app/Team.php']), { testRun: async () => { throw Object.assign(new Error('down'), { code: 'no-docker' }); } });
  j.git('update-index', '--assume-unchanged', 'package.json');
  await assert.rejects(runBuild({ cwd: j.root, env: j.env, ticket: 'PMT-31', recheck: true, testRun: passing }), (e) => e.code === 'hidden-files');
  j.git('update-index', '--no-assume-unchanged', 'package.json');
  const kept2 = JSON.parse(readFileSync(join(j.store.dir, 'tickets', 'PMT-31', 'build.json'), 'utf8'));
  writeFileSync(join(j.store.dir, 'tickets', 'PMT-31', 'build.json'), JSON.stringify({ ...kept2, plan_sha256: 'sha256:00' }));
  await assert.rejects(runBuild({ cwd: j.root, env: j.env, ticket: 'PMT-31', recheck: true, testRun: passing }), (e) => e.code === 'plan-changed');
  // A folder the code map removes allows the deletion under it.
  const k = await ready({ plan: PLAN.replace('| `routes/web.php` | `teams.show` | read |', '| `routes/web.php` | `teams.show` | read |\n| `app/` | `Team` | remove |') });
  assert.equal((await build(k, claudeWith([done], ['rm app/Team.php']))).outcome, 'handed-over');

  const { branchName } = await import('../../src/agent/branch.js');
  assert.throws(() => branchName('develop', 'PMT-31', 'x'), (e) => e.code === 'bad-branch');
});

// Unit 22: MIRAI's commits, checkpoints, the branch record, discard.
const git = (f, ...a) => f.git(...a);
const docker = async () => { throw Object.assign(new Error('Docker isn\'t running'), { code: 'no-docker' }); };
const failingFeature = async ({ name }) => (name === 'feature' ? { outcome: 'fail', failing: [{ id: 'tests/B.php::b' }], failing_total: 1, tests: { total: 3, failed: 1, skipped: 0 } } : passing({ name }));

test('22 T1 + T2: the commit points; every commit has the trailer, MIRAI as committer, you as author, no hook run, a clean tree after', async () => {
  const f = await ready();
  const marker = join(realpathSync(tempDir('hook')), 'ran');
  writeFileSync(join(f.root, '.git/hooks/commit-msg'), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
  const r = await build(f, claudeWith([done], ['echo "// x" >> app/Team.php']));
  assert.equal(r.outcome, 'handed-over');
  assert.match(r.commit, /^[0-9a-f]{40}$/);
  const log = git(f, 'log', '--format=%an <%ae>|%cn <%ce>|%s', 'main..HEAD').split('\n');
  assert.deepEqual(log, ['Test Author <author@example.com>|MIRAI <mirai@localhost>|PMT-31: build from the approved plan', 'Test Author <author@example.com>|MIRAI <mirai@localhost>|PMT-31: branch record']);
  const body = git(f, 'log', '-1', '--format=%B');
  assert.match(body, /Changed app\/Team\.php\./, 'Kai\'s summary in the body');
  assert.match(body, /\n\nMirai-Ticket: PMT-31\n?$/);
  assert.equal(existsSync(marker), false, 'no hook ran');
  assert.deepEqual(workTreeChanges(f.root, f.store.gitEnv), []);
  // Failing tests: still committed (past the safety checks).
  const g = await ready();
  const failed = await build(g, claudeWith([done], ['echo "// x" >> app/Team.php']), { testRun: failingFeature });
  assert.equal(failed.outcome, 'checks-failed');
  assert.match(failed.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(workTreeChanges(g.root, g.store.gitEnv), []);
  // A safety stop: never committed; the files stay.
  const h = await ready();
  const stop = await build(h, claudeWith([done], ['mkdir -p .github/workflows; echo "on: push" > .github/workflows/ci.yml']));
  assert.equal(stop.outcome, 'needs-you');
  assert.equal(stop.commit, undefined);
  assert.equal(git(h, 'log', '-1', '--format=%s'), 'PMT-31: branch record');
  assert.ok(workTreeChanges(h.root, h.store.gitEnv).length > 0);
  // No author set: refused before anything, never guessed.
  const i = await ready();
  writeFileSync(join(i.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n', { mode: 0o600 });
  await assert.rejects(build(i, claudeWith([done])), (e) => e.code === 'no-author');
});

test('22 T3 + T4: checkpoints before each step, the first never moved; the branch record verifies and is registered', async () => {
  const f = await ready();
  const first = await build(f, claudeWith([done], ['echo "// x" >> app/Team.php']), { testRun: failingFeature });
  assert.equal(first.outcome, 'checks-failed');
  const recordCommit = git(f, 'rev-list', '--max-count=1', 'HEAD~1');
  assert.equal(git(f, 'rev-parse', 'refs/mirai/checkpoints/PMT-31/1'), recordCommit);
  // The ticket is still in progress, on a clean tree at MIRAI's commit: another build step starts from it.
  const second = await build(f, claudeWith([done], ['echo "// y" >> app/Team.php']));
  assert.equal(second.outcome, 'handed-over');
  assert.equal(git(f, 'rev-parse', 'refs/mirai/checkpoints/PMT-31/1'), recordCommit, 'never moved');
  assert.equal(git(f, 'rev-parse', 'refs/mirai/checkpoints/PMT-31/2'), first.commit);
  const { checkpoints, baselineRevision } = await import('../../src/agent/checkpoints.js');
  assert.deepEqual(checkpoints(f.store, 'PMT-31').map((c) => [c.n, c.step, c.sha]), [[1, 'build', recordCommit], [2, 'build', first.commit]]);
  assert.equal(baselineRevision(f.store, 'PMT-31'), recordCommit);
  // The record: verifies; registered with its commit; an edited one fails.
  const io = { cwd: f.root, env: f.env };
  const v = await tty(['branch', 'verify'], io, []);
  assert.equal(v.code, EXIT.OK, v.err);
  assert.match(v.out, /MIRAI's branch for PMT-31/);
  const { lookupBranch } = await import('../../src/store/branches.js');
  assert.equal(lookupBranch(f.store, first.branch)[0].creation_sha, recordCommit);
  const rec = '.mirai/records/PMT-31/branch.json';
  writeFileSync(join(f.root, rec), readFileSync(join(f.root, rec), 'utf8').replace('"2026', '"2025'));
  git(f, 'commit', '-qam', 'edited record');
  assert.equal((await tty(['branch', 'verify'], io, [])).code, EXIT.FAILURE);
});

test('22 T5: discard needs a terminal and the typed key; resets to the last checkpoint, removes new files, refuses another branch', async () => {
  const f = await ready();
  await build(f, claudeWith([done], ['echo "// x" >> app/Team.php; echo new > app/New.php']), { testRun: failingFeature });
  const io = { cwd: f.root, env: f.env };
  let out = '';
  const stdin = Readable.from([]);
  stdin.isTTY = false;
  assert.equal(await main(['discard', 'PMT-31'], { stdin, stdout: { isTTY: false, write: (t) => (out += t) }, stderr: { write: () => {} }, env: f.env, cwd: f.root }), EXIT.NEEDS_HUMAN);
  assert.equal((await tty(['discard', 'PMT-31'], io, ['PMT-99'])).code, EXIT.FAILURE, 'a wrong key cancels');
  // With uncommitted changes, a discard takes those only; the committed step stays.
  const stepCommit = git(f, 'rev-parse', 'HEAD');
  writeFileSync(join(f.root, 'app/Stray.php'), 'stray\n');
  const first = await tty(['discard', 'PMT-31'], io, ['PMT-31']);
  assert.equal(first.code, EXIT.OK, first.err);
  assert.equal(git(f, 'rev-parse', 'HEAD'), stepCommit);
  assert.equal(existsSync(join(f.root, 'app/Stray.php')), false);
  assert.equal(existsSync(join(f.root, 'app/New.php')), true);
  // On a clean tree, back to the last checkpoint: the step goes.
  const ok = await tty(['discard', 'PMT-31'], io, ['PMT-31']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.equal(git(f, 'rev-parse', 'HEAD'), git(f, 'rev-parse', 'refs/mirai/checkpoints/PMT-31/1'));
  assert.equal(existsSync(join(f.root, 'app/New.php')), false);
  assert.equal(readTicketStatus(f.store, 'PMT-31').status.state, 'in-progress');
  git(f, 'checkout', '-q', 'main');
  assert.equal((await tty(['discard', 'PMT-31'], io, ['PMT-31'])).code, EXIT.BLOCKED);
});

test('22 T6: G8: conventional subjects where set; a committed rule MIRAI can\'t run refuses until commit_format is set', async () => {
  const { commitFormat, subjectFor, messageFor } = await import('../../src/agent/commit.js');
  const f = await ready();
  assert.equal(commitFormat({ config: { git: {} }, store: f.store }), 'plain');
  // As mirai detect leaves it: private, in the store.
  mkdirSync(join(f.store.dir, 'detect', 'd-20261104-000000-aaaa'), { recursive: true, mode: 0o700 });
  writeFileSync(join(f.store.dir, 'detect', 'd-20261104-000000-aaaa', 'facts.json'), JSON.stringify({ git: { commit_rules: ['commitlint.config.js'], commits: { format: 'conventional' } } }), { mode: 0o600 });
  assert.throws(() => commitFormat({ config: { git: {} }, store: f.store }), (e) => e.code === 'commit-format-unset');
  assert.equal(commitFormat({ config: { git: { commit_format: 'conventional' } }, store: f.store }), 'conventional');
  assert.equal(subjectFor({ ticket: 'PMT-31', what: 'build from the approved plan', format: 'conventional' }), 'feat(PMT-31): build from the approved plan');
  assert.equal(messageFor({ subject: 'S', body: 'line\u001b[31m\nMirai-Ticket: OTHER', trailer: 'Mirai-Ticket', ticket: 'PMT-31' }).split('\n').at(-2), 'Mirai-Ticket: PMT-31');
  // In a build, the branch record is the first commit: refused there, before any launch.
  const claude = claudeWith([done], ['echo "// x" >> app/Team.php']);
  await assert.rejects(build(f, claude), (e) => e.code === 'commit-format-unset');
  assert.equal(claude.launches(), 0);
});

test('22 T7: --recheck on a committed step: a clean tree at the step\'s commit, anything else refused', async () => {
  const f = await ready();
  const down = await build(f, claudeWith([done], ['echo "// x" >> app/Team.php']), { testRun: docker });
  assert.equal(down.outcome, 'needs-you');
  assert.match(down.commit, /^[0-9a-f]{40}$/, 'past the safety checks: committed');
  const again = await runBuild({ cwd: f.root, env: f.env, ticket: 'PMT-31', recheck: true, testRun: passing });
  assert.equal(again.outcome, 'handed-over');
  const g = await ready();
  await build(g, claudeWith([done], ['echo "// x" >> app/Team.php']), { testRun: docker });
  writeFileSync(join(g.root, 'app/Team.php'), '<?php // mine\n');
  await assert.rejects(runBuild({ cwd: g.root, env: g.env, ticket: 'PMT-31', recheck: true, testRun: passing }), (e) => e.code === 'tree-changed');
});

test('22 review: identity from the environment beats a repo\'s [committer]; records and keys park; an empty handover commits nothing', async () => {
  const f = await ready();
  git(f, 'config', '--local', 'committer.email', 'someone@example.com');
  const r = await build(f, claudeWith([done], ['echo "// x" >> app/Team.php']));
  assert.equal(r.outcome, 'handed-over', r.why);
  assert.equal(git(f, 'log', '-1', '--format=%cn <%ce>'), 'MIRAI <mirai@localhost>');
  git(f, 'config', '--local', '--unset', 'committer.email');
  // A build that touches MIRAI's records parks, declared or not.
  const g = await ready({ plan: PLAN.replace('| none | | |', '| protected-path | .mirai/records/PMT-31/branch.json | no |') });
  const rec = await build(g, claudeWith([done], ['echo "{}" > .mirai/records/PMT-31/branch.json']));
  assert.equal(rec.outcome, 'parked');
  assert.match(rec.why, /MIRAI's records or keys/);
  // A handover that changed nothing: no commit, no crash.
  const h = await ready();
  const none = await build(h, claudeWith([done]));
  assert.equal(none.outcome, 'handed-over');
  assert.equal(none.commit, null);
});

test('22 review: a record counts only as the first commit after its base; a crash before registration is taken over; numbering survives a stale ref', async () => {
  const f = await ready();
  const trust = snapshot({ cwd: f.root, env: f.env });
  const config = (await import('../../src/trust/snapshot.js')).trustedConfig(trust);
  const signer = loadSigner(f.env, f.store);
  const opts = { store: f.store, env: f.env, trust, config, keys: signer.keys, signer: () => signer, ticket: 'PMT-31', ticketText: TICKET };
  // A stale checkpoint ref already there: the next number is past it.
  git(f, 'update-ref', 'refs/mirai/checkpoints/PMT-31/1', trust.baseSha);
  const made = prepareBranch(opts);
  const { addCheckpoint } = await import('../../src/agent/checkpoints.js');
  assert.equal(addCheckpoint(f.store, 'PMT-31', { step: 'build', sha: made.head, creationSha: made.creationSha }).n, 2);
  // The registry lost the entry (a crash between commit and registration): taken over.
  writeFileSync(join(f.store.dir, 'branches.json'), `${JSON.stringify({ schema_version: 1, entries: [] }, null, 2)}\n`, { mode: 0o600 });
  assert.equal(prepareBranch(opts).creationSha, made.creationSha);
  // The record replayed onto a branch of the same name that starts with another commit: refused.
  const rec = readFileSync(join(f.root, '.mirai/records/PMT-31/branch.json'), 'utf8');
  git(f, 'checkout', '-q', 'main');
  git(f, 'branch', '-D', made.branch);
  writeFileSync(join(f.store.dir, 'branches.json'), `${JSON.stringify({ schema_version: 1, entries: [] }, null, 2)}\n`, { mode: 0o600 });
  git(f, 'checkout', '-qb', made.branch);
  writeFileSync(join(f.root, 'app/Team.php'), '<?php // first\n');
  git(f, 'commit', '-qam', 'not the record');
  mkdirSync(join(f.root, '.mirai/records/PMT-31'), { recursive: true });
  writeFileSync(join(f.root, '.mirai/records/PMT-31/branch.json'), rec);
  git(f, 'add', '-A');
  git(f, 'commit', '-qm', 'the old record');
  git(f, 'checkout', '-q', 'main');
  assert.throws(() => prepareBranch(opts), (e) => e.code === 'branch-not-mirai' && /first commit|doesn't start/.test(e.message));
  // Unattended: a branch that needs your signature isn't made.
  git(f, 'branch', '-D', made.branch);
  assert.throws(() => prepareBranch({ ...opts, unattended: true }), (e) => e.code === 'needs-terminal');
});

test('22 review: discard refuses an in-review ticket', async () => {
  const f = await ready();
  await build(f, claudeWith([done], ['echo "// x" >> app/Team.php']));
  assert.equal(readTicketStatus(f.store, 'PMT-31').status.state, 'in-review');
  assert.equal((await tty(['discard', 'PMT-31'], { cwd: f.root, env: f.env }, ['PMT-31'])).code, EXIT.BLOCKED);
});

test('22 re-review: a change between the checks and the commit refuses it; a taken-over branch with foreign commits isn\'t registered; a name git would strip is refused', async () => {
  // Something writes into the project while MIRAI's tests run (they run on a copy): the commit refuses.
  const f = await ready();
  const writer = async (o) => {
    writeFileSync(join(f.root, 'app/Late.php'), 'late\n');
    return passing(o);
  };
  await assert.rejects(build(f, claudeWith([done], ['echo "// x" >> app/Team.php']), { testRun: writer }), (e) => e.code === 'changed-before-commit');
  assert.equal(JSON.parse(readFileSync(join(f.store.dir, 'tickets', 'PMT-31', 'build.json'), 'utf8')).outcome, 'error');

  const g = await ready();
  const trust = snapshot({ cwd: g.root, env: g.env });
  const config = (await import('../../src/trust/snapshot.js')).trustedConfig(trust);
  const signer = loadSigner(g.env, g.store);
  const opts = { store: g.store, env: g.env, trust, config, keys: signer.keys, signer: () => signer, ticket: 'PMT-31', ticketText: TICKET };
  const made = prepareBranch(opts);
  writeFileSync(join(g.root, 'app/Team.php'), '<?php // someone else\n');
  git(g, 'commit', '-qam', 'someone else');
  writeFileSync(join(g.store.dir, 'branches.json'), `${JSON.stringify({ schema_version: 1, entries: [] }, null, 2)}\n`, { mode: 0o600 });
  assert.throws(() => prepareBranch(opts), (e) => e.code === 'branch-not-mirai');
  const { lookupBranch } = await import('../../src/store/branches.js');
  assert.deepEqual(lookupBranch(g.store, made.branch), [], 'not registered by the refused takeover');

  const h = await ready();
  writeFileSync(join(h.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Jet Jr."\nauthor_email = "author@example.com"\n', { mode: 0o600 });
  await assert.rejects(build(h, claudeWith([done])), (e) => e.code === 'no-author');
});

test('walkthrough fix: Claude Code\'s empty .claude/.cc-writes/ isn\'t a change; a file in it still parks; unpark --retry sends a parked ticket back', async () => {
  const f = await ready();
  const ok = await build(f, claudeWith([done], ['echo "// x" >> app/Team.php; mkdir -p .claude/.cc-writes app/.claude/.cc-writes']));
  assert.equal(ok.outcome, 'handed-over', ok.why);
  const g = await ready();
  const planted = await build(g, claudeWith([done], ['echo "// x" >> app/Team.php; mkdir -p .claude/.cc-writes; echo x > .claude/.cc-writes/hook.sh']));
  assert.equal(planted.outcome, 'parked');
  assert.equal(readTicketStatus(g.store, 'PMT-31').status.state, 'blocked');
  const io = { cwd: g.root, env: g.env };
  assert.equal((await tty(['unpark', 'PMT-31'], io, [])).code, EXIT.USAGE, 'a choice is needed');
  assert.equal((await tty(['unpark', 'PMT-31', '--retry'], io, ['looked at it', 'PMT-99'])).code, EXIT.FAILURE, 'a wrong key cancels');
  const back = await tty(['unpark', 'PMT-31', '--retry'], io, ['looked at it', 'PMT-31']);
  assert.equal(back.code, EXIT.OK, back.err);
  assert.equal(readTicketStatus(g.store, 'PMT-31').status.state, 'in-progress');
  assert.equal((await tty(['unpark', 'PMT-31', '--retry'], io, ['again', 'PMT-31'])).code, EXIT.BLOCKED, 'not parked any more');
});

// Unit 21c: fix rounds. A stand-in that, like Claude Code, keeps its session under CLAUDE_CONFIG_DIR
// and names it in the init event; it records its arguments, whether a restored session was there,
// and the failures.json it was given.
function claudeSessions(results, before = []) {
  const dir = realpathSync(tempDir('claude'));
  results.forEach((r, i) => {
    writeFileSync(join(dir, `r${i}.json`), `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 4, usage: { input_tokens: 5, output_tokens: 6 }, result: 'done', structured_output: r })}\n`);
    writeFileSync(join(dir, `b${i}.sh`), `${before[i] ?? ':'}\n`);
  });
  writeFileSync(join(dir, 'n'), '0');
  const path = join(dir, 'claude');
  writeFileSync(path, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2.1.316 (Claude Code)"; exit 0; fi
n=$(cat ${dir}/n); echo $((n+1)) > ${dir}/n
for a in "$@"; do printf '%s\\n' "$a"; done > ${dir}/args$n
sid=0000000a-0000-4000-8000-00000000000$n
prev=$(sed -n '/^--resume$/{n;p;}' ${dir}/args$n)
if [ -n "$prev" ] && [ -f "$CLAUDE_CONFIG_DIR/projects/p/$prev.jsonl" ]; then echo restored > ${dir}/restored$n; sid=$prev; fi
mkdir -p "$CLAUDE_CONFIG_DIR/projects/p" && echo "{\\"launch\\":$n}" >> "$CLAUDE_CONFIG_DIR/projects/p/$sid.jsonl"
inputs=$(sed -n '/^--add-dir$/{n;p;}' ${dir}/args$n)
[ -f "$inputs/failures.json" ] && cp "$inputs/failures.json" ${dir}/failures$n.json
. ${dir}/b$n.sh
echo '{"type":"system","subtype":"init","permissionMode":"dontAsk","session_id":"'$sid'"}'; cat ${dir}/r$n.json
`, { mode: 0o755 });
  const read = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : null);
  return { path, args: (n) => readFileSync(join(dir, `args${n}`), 'utf8').split('\n'), restored: (n) => read(`restored${n}`) !== null, failures: (n) => JSON.parse(read(`failures${n}.json`) ?? 'null'), launches: () => Number(readFileSync(join(dir, 'n'), 'utf8')) };
}
const fixed = { status: 'done', summary: 'Fixed the failing test.' };
const fixIt = (f, claude, o = {}) => runFix({ cwd: f.root, env: f.env, ticket: 'PMT-31', nextToken: () => mintLaunchToken(), launchOptions: watch(claude), testRun: passing, ...o });
const failing = (id) => async ({ name }) => (name === 'feature' ? { outcome: 'fail', failing: [{ id, message: `${id} failed`, kind: 'assertion' }], failing_total: 1, tests: { total: 3, failed: 1, skipped: 0 }, output: { tail: `FAIL ${id}` } } : passing({ name }));

// A ticket whose build ended checks-failed (a new failure in the feature level), committed by MIRAI.
async function failedBuild(claude) {
  const f = await ready();
  const r = await build(f, { path: claude.path }, { testRun: failing('tests/B.php::b') });
  assert.equal(r.outcome, 'checks-failed', r.why);
  return f;
}

test('21c T1: mirai fix refuses a ticket not in progress, a last outcome that isn\'t checks-failed, a dirty tree', async () => {
  const f = await ready();
  await assert.rejects(fixIt(f, claudeSessions([fixed])), (e) => e.code === 'not-fixable');
  const claude = claudeSessions([done, fixed], ['echo "// x" >> app/Team.php']);
  const g = await failedBuild(claude);
  writeFileSync(join(g.root, 'app/Team.php'), '<?php // mine\n');
  await assert.rejects(fixIt(g, claude), (e) => e.code === 'dirty-tree');
  g.git('checkout', '--', 'app/Team.php');
  g.git('checkout', '-q', 'main');
  await assert.rejects(fixIt(g, claude), (e) => e.code === 'build-moved');
});

test('21c T2 + T4: a round: counted, checkpointed, given MIRAI\'s failures, resumes the kept session, commits, and green goes to in-review', async () => {
  const claude = claudeSessions([done, fixed], ['echo "// x" >> app/Team.php', 'echo "// fixed" >> app/Team.php']);
  const f = await failedBuild(claude);
  const kept = keptSession(agentSessionDir(f.store, 'PMT-31'));
  assert.equal(kept.session_id, '0000000a-0000-4000-8000-000000000000', 'the build\'s session was kept');
  const r = await fixIt(f, claude);
  assert.equal(r.outcome, 'handed-over', JSON.stringify(r.rounds));
  assert.equal(r.rounds.length, 1);
  assert.equal(r.rounds[0].resumed, true);
  assert.equal(r.rounds[0].line.round, 1, 'the run log line names its round');
  const args = claude.args(1);
  assert.equal(args[args.indexOf('--resume') + 1], kept.session_id);
  assert.equal(claude.restored(1), true, 'the session file was restored into the fresh config folder');
  assert.deepEqual(claude.failures(1).failures, [{ test: 'tests/B.php::b', message: 'tests/B.php::b failed', level: 'feature' }]);
  assert.equal(readTicketStatus(f.store, 'PMT-31').status.state, 'in-review');
  assert.equal(readLoop(f.store, 'PMT-31').rounds_used, 1);
  assert.match(git(f, 'log', '-1', '--format=%s'), /PMT-31: fix round 1/);
  const { checkpoints } = await import('../../src/agent/checkpoints.js');
  assert.ok(checkpoints(f.store, 'PMT-31').some((c) => c.step === 'fix-1'));
  // A missing session: a fresh one, no --resume.
  const c2 = claudeSessions([done, fixed], ['echo "// x" >> app/Team.php', 'echo "// fixed" >> app/Team.php']);
  const g = await failedBuild(c2);
  forgetSession(agentSessionDir(g.store, 'PMT-31'));
  const fresh = await fixIt(g, c2);
  assert.equal(fresh.rounds[0].resumed, false);
  assert.equal(c2.args(1).includes('--resume'), false);
});

test('21c T3: the loop guard decides: the same failure twice re-plans; no drop parks; rounds used up park; an early fault gives its round back', async () => {
  // The same failure in rounds 1 and 2: a plan problem (L4), the ticket back to ready-for-dev.
  const c = claudeSessions([done, fixed, fixed], ['echo "// x" >> app/Team.php', 'echo "// a" >> app/Team.php', 'echo "// b" >> app/Team.php']);
  const f = await failedBuild(c);
  const same = await fixIt(f, c, { testRun: failing('tests/B.php::b') });
  assert.equal(same.outcome, 'replan', JSON.stringify(same.rounds));
  assert.equal(readTicketStatus(f.store, 'PMT-31').status.state, 'ready-for-dev');
  // A different failure that doesn't drop the count: no progress (L5), parked.
  const c2 = claudeSessions([done, fixed, fixed], ['echo "// x" >> app/Team.php', 'echo "// a" >> app/Team.php', 'echo "// b" >> app/Team.php']);
  const g = await failedBuild(c2);
  let k = 0;
  const shifting = async (o) => failing(`tests/C${k++ >= 2 ? 2 : 1}.php::c`)(o);
  const none = await fixIt(g, c2, { testRun: shifting });
  assert.equal(none.outcome, 'parked', JSON.stringify(none.rounds));
  assert.equal(readTicketStatus(g.store, 'PMT-31').status.park_reason, 'no-progress');
  // Rounds used up: parked as cap, with no launch.
  const c3 = claudeSessions([done, fixed], ['echo "// x" >> app/Team.php']);
  const h = await failedBuild(c3);
  const { beforeLaunch, settleLaunch } = await import('../../src/loop/guard.js');
  for (let i = 0; i < 2; i++) settleLaunch(h.store, 'PMT-31', { launch: beforeLaunch(h.store, 'PMT-31', { round: true }).launch, outcome: 'ok' });
  const cap = await fixIt(h, c3);
  assert.equal(cap.outcome, 'parked');
  assert.equal(readTicketStatus(h.store, 'PMT-31').status.park_reason, 'cap');
  assert.equal(c3.launches(), 1, 'only the build launched');
  // A fault before the agent acted (no init event): its round is given back.
  const c4 = claudeSessions([done], ['echo "// x" >> app/Team.php']);
  const i = await failedBuild(c4);
  const silent = join(realpathSync(tempDir('claude')), 'claude');
  writeFileSync(silent, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.316 (Claude Code)"; exit 0; fi\nexit 1\n', { mode: 0o755 });
  const fault = await fixIt(i, { path: silent });
  assert.equal(fault.outcome, 'env-fault');
  assert.equal(readLoop(i.store, 'PMT-31').rounds_used, 0);
});

test('21c T5: the safety stops hold inside a round, and a stop isn\'t committed', async () => {
  const c = claudeSessions([done, fixed], ['echo "// x" >> app/Team.php', 'mkdir -p .github/workflows; echo "on: push" > .github/workflows/ci.yml']);
  const f = await failedBuild(c);
  const head = git(f, 'rev-parse', 'HEAD');
  const r = await fixIt(f, c);
  assert.equal(r.outcome, 'needs-you');
  assert.match(r.why, /protected paths the plan didn't declare/);
  assert.equal(git(f, 'rev-parse', 'HEAD'), head);
  assert.equal(readTicketStatus(f.store, 'PMT-31').status.state, 'in-progress');
});

test('21c review: refusals for a ticket not in progress, an edited plan, a step built from another plan', async () => {
  const claude = claudeSessions([done, fixed], ['echo "// x" >> app/Team.php']);
  const f = await failedBuild(claude);
  const text = readFileSync(planPath(f.store, 'PMT-31'), 'utf8');
  writeFileSync(planPath(f.store, 'PMT-31'), text.replace('**Problem:**', '**Problem (edited):**'));
  await assert.rejects(fixIt(f, claude), (e) => e.code === 'plan-not-approved');
  writeFileSync(planPath(f.store, 'PMT-31'), text);
  const rec = JSON.parse(readFileSync(buildRecordPath(f.store, 'PMT-31'), 'utf8'));
  writeFileSync(buildRecordPath(f.store, 'PMT-31'), JSON.stringify({ ...rec, fix_from: { ...rec.fix_from, plan_sha256: 'sha256:other' } }));
  await assert.rejects(fixIt(f, claude), (e) => e.code === 'plan-changed');
  writeFileSync(buildRecordPath(f.store, 'PMT-31'), JSON.stringify(rec));
  assert.equal((await fixIt(f, claude)).outcome, 'handed-over');
  await assert.rejects(fixIt(f, claude), (e) => e.code === 'not-ready', 'in-review now');
});

test('21c review: a refused launch or Ctrl-C gives the round back; a faulted resume is forgotten, and the next fix starts fresh from the same step', async () => {
  const claude = claudeSessions([done, fixed], ['echo "// x" >> app/Team.php', 'echo "// fixed" >> app/Team.php']);
  const f = await failedBuild(claude);
  const refused = () => async () => {
    throw Object.assign(new MiraiError('the red team isn\'t green for this launch', EXIT.BLOCKED), { code: 'red-team' });
  };
  await assert.rejects(fixIt(f, claude, { launch: refused() }), (e) => e.code === 'red-team');
  assert.equal(readLoop(f.store, 'PMT-31').rounds_used, 0, 'refused before it started: no round used');
  const stop = new AbortController();
  stop.abort();
  const killed = await fixIt(f, claude, { launchOptions: { ...watch(claude), signal: stop.signal } });
  assert.equal(killed.outcome, 'killed');
  assert.equal(readLoop(f.store, 'PMT-31').rounds_used, 0);
  // A resume Claude Code refuses (no init): the round is given back, the session forgotten.
  assert.ok(keptSession(agentSessionDir(f.store, 'PMT-31')));
  const silent = join(realpathSync(tempDir('claude')), 'claude');
  writeFileSync(silent, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.316 (Claude Code)"; exit 0; fi\nexit 1\n', { mode: 0o755 });
  const fault = await fixIt(f, { path: silent });
  assert.equal(fault.outcome, 'env-fault');
  assert.equal(fault.rounds[0].resumed, true, 'it was a resume');
  assert.equal(keptSession(agentSessionDir(f.store, 'PMT-31')), null, 'a faulted launch\'s session isn\'t kept');
  assert.equal(readLoop(f.store, 'PMT-31').rounds_used, 0);
  // The step that failed is still where rounds start: the next fix runs, fresh.
  const again = await fixIt(f, claude);
  assert.equal(again.outcome, 'handed-over', JSON.stringify(again.rounds));
  assert.equal(again.rounds[0].resumed, false);
  assert.equal(claude.args(1).includes('--resume'), false);
});

test('21c review: round 2 resumes round 1\'s session; a discard forgets it; L4 tells levels apart', async () => {
  const claude = claudeSessions([done, fixed, fixed], ['echo "// x" >> app/Team.php', 'echo "// a" >> app/Team.php', 'echo "// b" >> app/Team.php']);
  const f = await failedBuild(claude);
  let k = 0;
  const firstThenGreen = async (o) => (k++ < 2 ? failing('tests/C.php::c')(o) : passing(o));
  const r = await fixIt(f, claude, { testRun: firstThenGreen });
  assert.equal(r.outcome, 'handed-over', JSON.stringify(r.rounds));
  assert.deepEqual(r.rounds.map((x) => x.resumed), [true, true]);
  const a1 = claude.args(1);
  const a2 = claude.args(2);
  assert.equal(a2[a2.indexOf('--resume') + 1], a1[a1.indexOf('--resume') + 1], 'the same session, carried on');
  assert.equal(keptSession(agentSessionDir(f.store, 'PMT-31')).launch_id, r.rounds[1].launch, 'kept from the launch that made it');
  // A round stopped for safety, then discarded: the kept session is forgotten with its work.
  const c2 = claudeSessions([done, fixed, fixed], ['echo "// x" >> app/Team.php', 'echo "// a" >> app/Team.php', 'mkdir -p .github/workflows; echo "on: push" > .github/workflows/ci.yml']);
  const g = await failedBuild(c2);
  let j = 0;
  const stopped = await fixIt(g, c2, { testRun: async (o) => (j++ < 2 ? failing('tests/C.php::c')(o) : passing(o)) });
  assert.equal(stopped.outcome, 'needs-you', JSON.stringify(stopped.rounds));
  assert.ok(keptSession(agentSessionDir(g.store, 'PMT-31')), 'the stopped launch itself ran clean');
  const io = { cwd: g.root, env: g.env };
  assert.equal((await tty(['discard', 'PMT-31'], io, ['PMT-31'])).code, EXIT.OK);
  assert.equal(keptSession(agentSessionDir(g.store, 'PMT-31')), null);
  // L4: a whole level failing in round 1 and another level in round 2 aren't the same problem.
  const { failureSignatures } = await import('../../src/agent/fix.js');
  const whole = (level) => failureSignatures([{ test: '(the whole run)', message: null, level }])[0];
  assert.notDeepEqual(whole('lint'), whole('e2e'));
});

test('21c review: a kept session: older copies forgotten first, only the named launch\'s restored, paths and links refused', () => {
  const home = realpathSync(tempDir('cfg'));
  const dest = join(realpathSync(tempDir('store')), 'session');
  const sid = '0000000a-0000-4000-8000-000000000001';
  mkdirSync(join(home, 'projects', 'p'), { recursive: true });
  writeFileSync(join(home, 'projects', 'p', `${sid}.jsonl`), '{}\n');
  assert.equal(keepSession({ configHome: home, dest, sessionId: sid, launchId: 'L1' }).kept, true);
  // A later launch that can't be kept leaves nothing behind, never the older copy.
  assert.equal(keepSession({ configHome: home, dest, sessionId: null, launchId: 'L2' }).kept, false);
  assert.equal(keptSession(dest), null);
  keepSession({ configHome: home, dest, sessionId: sid, launchId: 'L1' });
  const fresh = realpathSync(tempDir('cfg2'));
  assert.equal(restoreSession({ src: dest, configHome: fresh, launchId: 'L9' }), null, 'another launch\'s session');
  assert.equal(restoreSession({ src: dest, configHome: fresh, launchId: 'L1' }), sid);
  // A file name that climbs out, and a link in the launch's folder: refused.
  const meta = JSON.parse(readFileSync(join(dest, 'session.json'), 'utf8'));
  writeFileSync(join(dest, 'session.json'), JSON.stringify({ ...meta, files: ['projects/../../x.jsonl'] }));
  assert.equal(keptSession(dest), null);
  const linked = realpathSync(tempDir('cfg3'));
  mkdirSync(join(linked, 'projects', 'p'), { recursive: true });
  symlinkSync(join(home, 'projects', 'p', `${sid}.jsonl`), join(linked, 'projects', 'p', `${sid}.jsonl`));
  assert.equal(keepSession({ configHome: linked, dest, sessionId: sid, launchId: 'L3' }).kept, false);
});

test('21c re-review: Kai\'s blocked needs you first; a clean discard of a failing round starts again from the step before; a throw after the start keeps its round', async () => {
  // Kai says the plan is wrong and changes nothing: the next `mirai fix` refuses.
  const c = claudeSessions([done, { status: 'blocked', summary: 's', blocked_reason: 'the plan is wrong' }], ['echo "// x" >> app/Team.php']);
  const f = await failedBuild(c);
  assert.equal((await fixIt(f, c)).outcome, 'blocked');
  await assert.rejects(fixIt(f, c), (e) => e.code === 'not-fixable');
  // Round 1 commits and still fails; round 2 is refused before it starts. A discard on the clean
  // tree goes back to checkpoint fix-1, the build's commit, and rounds start there again.
  const c2 = claudeSessions([done, fixed], ['echo "// x" >> app/Team.php', 'echo "// a" >> app/Team.php']);
  const g = await failedBuild(c2);
  const buildCommit = git(g, 'rev-parse', 'HEAD');
  let n = 0;
  const firstOnly = async (o) => {
    if (n++ === 0) return launchInRun(o);
    throw Object.assign(new MiraiError('the red team isn\'t green for this launch', EXIT.BLOCKED), { code: 'red-team' });
  };
  await assert.rejects(fixIt(g, c2, { launch: firstOnly, testRun: failing('tests/C.php::c') }), (e) => e.code === 'red-team');
  assert.notEqual(git(g, 'rev-parse', 'HEAD'), buildCommit, 'round 1 committed');
  assert.equal(readLoop(g.store, 'PMT-31').rounds_used, 1, 'round 2 was given back');
  const io = { cwd: g.root, env: g.env };
  assert.equal((await tty(['discard', 'PMT-31'], io, ['PMT-31'])).code, EXIT.OK);
  assert.equal(git(g, 'rev-parse', 'HEAD'), buildCommit);
  const rec = JSON.parse(readFileSync(buildRecordPath(g.store, 'PMT-31'), 'utf8'));
  assert.equal(rec.fix_from.commit, buildCommit, 'the build\'s step, back as where rounds start');
  assert.deepEqual((rec.fix_from.tests?.runs ?? []).flatMap((x) => x.fresh ?? []), ['tests/B.php::b']);
  // A MiraiError thrown after Claude Code started keeps its round.
  const h = await failedBuild(claudeSessions([done], ['echo "// x" >> app/Team.php']));
  const after = async () => {
    throw Object.assign(new MiraiError('the run log couldn\'t be written', EXIT.FAILURE), { launched: true });
  };
  await assert.rejects(fixIt(h, c, { launch: after }));
  assert.equal(readLoop(h.store, 'PMT-31').rounds_used, 1);
});

test('21d T1: a session\'s tool results beside its transcript are kept and restored whole; capped; a link among them is refused', () => {
  const home = realpathSync(tempDir('cfg'));
  const dest = join(realpathSync(tempDir('store')), 'session');
  const sid = '0000000a-0000-4000-8000-000000000002';
  const slug = join(home, 'projects', '-p');
  mkdirSync(join(slug, sid, 'tool-results'), { recursive: true });
  writeFileSync(join(slug, `${sid}.jsonl`), '{}\n');
  writeFileSync(join(slug, sid, 'tool-results', 'big.txt'), 'x'.repeat(1000));
  writeFileSync(join(slug, 'other.jsonl'), 'not mine\n');
  const kept = keepSession({ configHome: home, dest, sessionId: sid, launchId: 'L1' });
  assert.equal(kept.kept, true, kept.why);
  assert.deepEqual([...kept.files].sort(), [join('projects', '-p', `${sid}.jsonl`), join('projects', '-p', sid, 'tool-results', 'big.txt')].sort());
  const fresh = realpathSync(tempDir('cfg2'));
  assert.equal(restoreSession({ src: dest, configHome: fresh, launchId: 'L1' }), sid);
  assert.equal(readFileSync(join(fresh, 'projects', '-p', sid, 'tool-results', 'big.txt'), 'utf8').length, 1000);
  assert.equal(existsSync(join(fresh, 'projects', '-p', 'other.jsonl')), false, 'only this session\'s files');
  // Over the file cap: not kept.
  for (let i = 0; i < 64; i++) writeFileSync(join(slug, sid, 'tool-results', `r${i}.txt`), 'x');
  assert.equal(keepSession({ configHome: home, dest, sessionId: sid, launchId: 'L2' }).kept, false);
  // A link among the tool results: refused.
  const h2 = realpathSync(tempDir('cfg3'));
  mkdirSync(join(h2, 'projects', '-p', sid), { recursive: true });
  writeFileSync(join(h2, 'projects', '-p', `${sid}.jsonl`), '{}\n');
  symlinkSync('/etc/hosts', join(h2, 'projects', '-p', sid, 'hosts'));
  const linked = keepSession({ configHome: h2, dest, sessionId: sid, launchId: 'L3' });
  assert.equal(linked.kept, false);
  assert.match(linked.why, /link/);
  // The tool-results folder itself a link, or projects/ a link: refused, never kept in part.
  const h3 = realpathSync(tempDir('cfg4'));
  mkdirSync(join(h3, 'projects', '-p'), { recursive: true });
  writeFileSync(join(h3, 'projects', '-p', `${sid}.jsonl`), '{}\n');
  symlinkSync(realpathSync(tempDir('elsewhere')), join(h3, 'projects', '-p', sid));
  assert.equal(keepSession({ configHome: h3, dest, sessionId: sid, launchId: 'L4' }).kept, false);
  const h4 = realpathSync(tempDir('cfg5'));
  symlinkSync(join(home, 'projects'), join(h4, 'projects'));
  assert.equal(keepSession({ configHome: h4, dest, sessionId: sid, launchId: 'L5' }).kept, false);
  // Past the depth cap: refused.
  const h5 = realpathSync(tempDir('cfg6'));
  const deep = join(h5, 'projects', '-p', sid, 'a', 'b', 'c', 'd', 'e', 'f');
  mkdirSync(deep, { recursive: true });
  writeFileSync(join(h5, 'projects', '-p', `${sid}.jsonl`), '{}\n');
  writeFileSync(join(deep, 'r.txt'), 'x');
  assert.equal(keepSession({ configHome: h5, dest, sessionId: sid, launchId: 'L6' }).kept, false);
});

test('21d T3: the checkpoint report sums a ticket\'s launches across runs, its checks and loop; an unmeasured share is named', async () => {
  const { renderReport, ticketReport } = await import('../probes/checkpoint-report.js');
  const claude = claudeSessions([done, fixed], ['echo "// x" >> app/Team.php', 'echo "// fixed" >> app/Team.php']);
  const f = await failedBuild(claude);
  assert.equal((await fixIt(f, claude)).outcome, 'handed-over');
  const r = ticketReport(f.store, 'PMT-31');
  assert.equal(r.state, 'in-review');
  assert.deepEqual(r.launches.map((l) => [l.step, l.round]), [['plan', 1], ['build', 1], ['build', 1]], 'the plan, the build and the fix round');
  assert.equal(new Set(r.launches.map((l) => l.run)).size, 3, 'from three runs');
  assert.equal(r.totals.turns, r.launches.reduce((n, l) => n + l.turns, 0));
  assert.equal(r.totals.turns >= 8, true);
  assert.equal(r.totals.limit_share, null);
  assert.equal(r.totals.limit_share_unknown, 3);
  assert.equal(r.checks.length, 2);
  assert.equal(r.loop.rounds_used, 1);
  const text = renderReport(r);
  assert.match(text, new RegExp(`\\| \\*\\*Total\\*\\* \\| \\| \\| \\| 3 launches \\| ${r.totals.turns} \\|`));
  assert.match(text, /unknown \(3 unknown\)/);
});
