import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runBuild, handoverFrom, testsAfter, HANDOVER_SCHEMA } from '../../src/agent/build.js';
import { ensureBranch, ticketSlug } from '../../src/agent/branch.js';
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

test('T2: the branch: made from the integration commit and checked out; one with its own commits, or a dirty tree, is refused', async () => {
  assert.equal(ticketSlug(TICKET), 'renaming-a-team-hides-its-members');
  assert.equal(ticketSlug('---\nid: x\n---\n# Ça marche: déjà vu!\n'), 'ca-marche-deja-vu');
  const f = await ready();
  const trust = snapshot({ cwd: f.root, env: f.env });
  const opts = { root: f.store.checkout, env: f.store.gitEnv, base: trust.baseSha, integration: 'main', pattern: 'feature/{ticket}-{slug}', ticket: 'PMT-31', ticketText: TICKET };
  writeFileSync(join(f.root, 'app/Team.php'), '<?php // mine\n');
  assert.throws(() => ensureBranch(opts), (e) => e.code === 'dirty-tree');
  f.git('checkout', '--', 'app/Team.php');
  assert.deepEqual(ensureBranch(opts), { branch: 'feature/PMT-31-renaming-a-team-hides-its-members', created: true });
  assert.equal(symbolicBranch(f.store.checkout, 'HEAD', f.store.gitEnv), 'feature/PMT-31-renaming-a-team-hides-its-members');
  assert.deepEqual(ensureBranch(opts), { branch: 'feature/PMT-31-renaming-a-team-hides-its-members', created: false });
  writeFileSync(join(f.root, 'app/Team.php'), '<?php // a commit of its own\n');
  f.git('commit', '-qam', 'own');
  f.git('checkout', '-q', 'main');
  assert.throws(() => ensureBranch(opts), (e) => e.code === 'branch-has-commits');
  assert.throws(() => ensureBranch({ ...opts, pattern: '{ticket}..x' }), (e) => e.code === 'bad-branch');
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
  assert.ok(workTreeChanges(f.root, f.store.gitEnv).length > 0, 'the changes stay for you');
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
