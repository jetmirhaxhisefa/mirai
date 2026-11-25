import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildRecordPath, runBuild } from '../../src/agent/build.js';
import { gateFor, planPath, runPlan } from '../../src/agent/plan.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { floorGuard, rowVerdict, testRows, redRows, tddOf, markersOf } from '../../src/agent/tdd.js';
import { writeBaseline } from '../../src/baseline/store.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { loadRegistry } from '../../src/config/registry.js';
import { lintText } from '../../src/lint/lint.js';
import { tddEvidence } from '../../src/proofs/record.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { loadSigner } from '../../src/sign/signer.js';
import { writeToken } from '../../src/sign/token.js';
import { commitOf } from '../../src/store/git.js';
import { openStore } from '../../src/store/home.js';
import { readRunLog, runIds } from '../../src/store/run-log.js';
import { readTicketStatus } from '../../src/store/tickets.js';
import { snapshot } from '../../src/trust/snapshot.js';
import { installed, tempDir } from '../tests/run-fixture.js';
import { needsTest } from '../helpers/needs.js';
import { veraBefore } from '../helpers/vera.js';

// Unit 30a: tests of macOS-only code, left out (and listed) where it can't run.
const launchTest = needsTest('macos', 'an agent launch: its scratch folder is macOS\'s /private/tmp (src/launch/strict.js; P01)');

// Unit 23: test-first, proven. A stand-in `claude` (with sessions, as 21c's), a stand-in test run,
// no model.

const TOKEN = `sk-ant-oat01-${'Td3_-k'.repeat(16)}`;
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
// The registry's example plan: one characterization row (unit), three red rows (feature).
const PLAN = readFileSync(join(REGISTRY_DIR, 'examples', 'plan.md'), 'utf8');
const CONFIG = '\n[[testing.levels]]\nname = "unit"\ncommand = ["run-tests"]\nservice = "app"\n\n[[testing.levels]]\nname = "feature"\ncommand = ["run-tests"]\nservice = "app"\n\n[compose]\nfiles = ["compose.yml"]\nenv_file = ".env.test"\n';
const doc = (fm, body) => `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`).join('\n')}\n---\n${body}`;
const ticket = (tdd) => doc({ id: 'PMT-31', type: 'story', template: 'story@v1', repo: '"."', risk: 'normal', size: 'M', verify: '"Rename a team on staging."', tdd },
  '# Renaming a team hides its members\n\n## Acceptance criteria\n\n- AC-PMT-31.1: the members stay after a rename\n- AC-PMT-31.2: the old slug redirects\n');
const EXISTING = '<?php\nclass RenameTeamTest {\n  public function test_keeps_name() { $this->assertSame("a", "a"); }\n}\n';
const files = (tdd) => ({ 'docs/mirai/tickets/PMT-31.md': ticket(tdd), 'package.json': '{\n  "name": "app"\n}\n', 'app/Team.php': '<?php\n', 'tests/Unit/RenameTeamTest.php': EXISTING, 'tests/Feature/.gitkeep': '' });
const PASSED = { state: 'pass', known_failures: [], tests: { total: 3, skipped: 0 } };

async function tty(argv, { cwd, env }, answers) {
  // Unit 42 (Jet's answer 3): a lone ticket's approval needs Vera's result; these tests aren't about her.
  veraBefore(argv, { cwd, env });
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd });
  return { code, out, err };
}

// A stand-in claude answering each launch with the next result after running `before[n]`, keeping
// its session like Claude Code (so a resume shows as --resume <id>), and copying red.json.
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
if [ -n "$prev" ] && [ -f "$CLAUDE_CONFIG_DIR/projects/p/$prev.jsonl" ]; then sid=$prev; fi
mkdir -p "$CLAUDE_CONFIG_DIR/projects/p" && echo "{\\"launch\\":$n}" >> "$CLAUDE_CONFIG_DIR/projects/p/$sid.jsonl"
inputs=$(sed -n '/^--add-dir$/{n;p;}' ${dir}/args$n)
[ -f "$inputs/red.json" ] && cp "$inputs/red.json" ${dir}/red$n.json
. ${dir}/b$n.sh
echo '{"type":"system","subtype":"init","permissionMode":"dontAsk","session_id":"'$sid'"}'; cat ${dir}/r$n.json
`, { mode: 0o755 });
  const read = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : null);
  return { path, args: (n) => readFileSync(join(dir, `args${n}`), 'utf8').split('\n'), red: (n) => JSON.parse(read(`red${n}.json`) ?? 'null'), launches: () => Number(readFileSync(join(dir, 'n'), 'utf8')) };
}
const watch = (claude) => ({ claude: claude.path, status: green, check: () => [] });

// A repo with the ticket and its plan approved, ready to build.
async function ready({ tdd = 'auto', plan = PLAN } = {}) {
  const f = installed({ config: CONFIG, files: files(tdd) });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  writeToken(f.env, TOKEN);
  writeFileSync(join(f.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Test Author"\nauthor_email = "author@example.com"\n', { mode: 0o600 });
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  const io = { cwd: f.root, env: f.env };
  assert.equal((await tty(['approve', 'PMT-31', '--file', 'docs/mirai/tickets/PMT-31.md'], io, ['a', 'PMT-31'])).code, EXIT.OK);
  const sessions = claudeSessions([{ plan }]);
  const r = await runPlan({ cwd: f.root, env: f.env, ticket: 'PMT-31', launchTokens: [mintLaunchToken(), mintLaunchToken()], launchOptions: watch(sessions) });
  assert.equal(r.outcome, 'waiting', JSON.stringify(r.problems));
  assert.equal((await tty(['approve', 'PMT-31', '--plan'], io, ['a', 'PMT-31'])).code, EXIT.OK);
  const store = openStore(io);
  writeBaseline(store, { schema_version: 1, sha: snapshot(io).baseSha, levels: { unit: PASSED, feature: PASSED } }, loadSigner(f.env, store));
  return { ...f, store };
}
const build = (f, claude, testRun) => runBuild({ cwd: f.root, env: f.env, ticket: 'PMT-31', launchToken: mintLaunchToken(), nextToken: mintLaunchToken, launchOptions: watch(claude), testRun });

const RED_IDS = ['tests/Feature/TeamRenameTest.php::test_members_stay', 'tests/Feature/TeamRenameTest.php::test_old_slug_redirects', 'tests/Feature/TeamRenameTest.php::test_two_renames'];
// A stand-in test run: a whole level passes (its cases in `caseFiles`); a red row's run answers
// `red(id)` (default: fails by an assertion); the characterization file passes.
function runner({ red = () => 'assertion', caseFiles = ['tests/Unit/RenameTeamTest.php', 'tests/Feature/TeamRenameTest.php'] } = {}) {
  const calls = [];
  const fn = async ({ name, path = null, test: id = null }) => {
    calls.push({ name, path, test: id });
    if (path === null && id === null) return { outcome: 'pass', id: `t-${name}`, tests: { total: 3, passed: 3, failed: 0, errors: 0, skipped: 0 }, case_files: caseFiles };
    if (path === 'tests/Unit/RenameTeamTest.php') return { outcome: 'pass', id: 't-char', tests: { total: 1, passed: 1, failed: 0, errors: 0, skipped: 0 }, failing: [], case_files: [path] };
    const v = red(id);
    if (v === 'passes') return { outcome: 'pass', id: 't-red', tests: { total: 1, passed: 1, failed: 0, errors: 0, skipped: 0 }, failing: [], case_files: [id.split('::')[0]] };
    return { outcome: 'fail', id: 't-red', tests: { total: 1, passed: 0, failed: 1, errors: 0, skipped: 0 }, failing: [{ id, kind: v, message: v === 'assertion' ? 'Failed asserting that 0 matches expected 2.' : 'Call to undefined method' }], case_files: [id.split('::')[0]] };
  };
  return Object.assign(fn, { calls });
}
const RED = { status: 'red', summary: 'Wrote the three red tests and a stub for TeamSlugRedirect::handle.' };
const DONE = { status: 'done', summary: 'Implemented the redirect.' };
const writeRedTests = 'mkdir -p tests/Feature && printf "<?php\\nclass TeamRenameTest {\\n  public function test_members_stay() { $this->assertSame(2, 0); }\\n}\\n" > tests/Feature/TeamRenameTest.php && echo "// stub" >> app/Team.php';
const writeCode = 'echo "// the code" >> app/Team.php';

test('23: the rows and their verdicts: an assertion is red, an error or nothing found is the wrong reason, a pass passes already', () => {
  const rows = testRows(PLAN);
  assert.deepEqual(rows.map((r) => r.kind), ['characterization', 'red', 'red', 'red']);
  assert.equal(rows[1].path, 'tests/Feature/TeamRenameTest.php');
  assert.equal(rows[1].name, 'test_members_stay');
  assert.equal(redRows(rows, 'after').length, 0, 'tdd: after has no red check');
  assert.equal(redRows(rows, 'auto').length, 4);
  assert.equal(tddOf({ tdd: 'first' }, {}), 'first');
  const red = rows[1];
  const fail = (kind) => ({ outcome: 'fail', tests: { passed: 0 }, failing: [{ id: red.id, kind, message: 'm' }] });
  assert.equal(rowVerdict(red, fail('assertion')).verdict, 'ok');
  assert.equal(rowVerdict(red, fail('load')).verdict, 'wrong-reason');
  assert.equal(rowVerdict(red, fail('not-found')).verdict, 'wrong-reason');
  assert.equal(rowVerdict(red, fail('error')).verdict, 'wrong-reason');
  assert.equal(rowVerdict(red, { outcome: 'pass', tests: { passed: 1 }, failing: [] }).verdict, 'passes');
  assert.equal(rowVerdict(red, { outcome: 'env-fault', message: 'docker' }).verdict, 'unknown');
  // A known failure of the baseline isn't the row's.
  assert.equal(rowVerdict(red, fail('error'), new Set([red.id])).verdict, 'passes');
  const ch = rows[0];
  assert.equal(rowVerdict(ch, { outcome: 'pass', tests: { passed: 2 }, failing: [] }).verdict, 'ok');
  assert.equal(rowVerdict(ch, { outcome: 'fail', tests: { passed: 0 }, failing: [{ kind: 'assertion', message: 'x' }] }).verdict, 'fails');
  // `after: <reason>`.
  const after = testRows(PLAN.replace('| feature | red |', '| feature | after: a redirect is glue |'));
  assert.deepEqual([after[1].kind, after[1].reason], ['after', 'a redirect is glue']);
});

test('23: the plan lint: test-change rows, a bug needs a red row, new logic needs a red row or a reason; a test-change brings the plan to you', () => {
  const registry = loadRegistry(REGISTRY_DIR);
  const project = { levels: ['unit', 'feature'] };
  const codes = (text) => lintText(text, { source: 'tickets/PMT-31/plan.md', registry, project }).filter((p) => p.severity === 'error').map((p) => `${p.code}: ${p.reason}`);
  const auto = PLAN.replace('tdd: first', 'tdd: auto');
  assert.deepEqual(codes(auto), []);
  // A bug's plan with no red row.
  const bug = auto.replace('round: 1', 'round: 1\nticket_type: bug').replace(/\| red \|$/gm, '| after: no |');
  assert.ok(codes(bug).some((c) => c.startsWith('plan-tdd: a bug')), codes(bug).join('\n'));
  // An after row for new code with no reason.
  const noReason = auto.replace(/\| red \|$/gm, '| after |');
  assert.ok(codes(noReason).some((c) => c.startsWith('plan-tdd:') && c.includes('TeamSlugRedirect::handle')), codes(noReason).join('\n'));
  assert.deepEqual(codes(auto.replace(/\| red \|$/gm, '| after: glue, proven at feature level |')), []);
  assert.ok(codes(auto.replace('| feature | red |', '| feature | red: why |')).some((c) => c.includes('only an after row takes a reason')));
  // tdd: after: no rule asks for red.
  assert.deepEqual(codes(auto.replace('tdd: auto', 'tdd: after').replace(/\| (red|characterization) \|$/gm, '| after |')), []);
  // test-change: one exact path, with why.
  const tc = (item) => auto.replace('| none | | |', `| test-change | ${item} | the redirect's old expectation was wrong |`);
  assert.deepEqual(codes(tc('tests/Unit/RenameTeamTest.php')), []);
  assert.ok(codes(tc('tests/**/*.php')).some((c) => c.includes('one exact test file path')));
  assert.ok(gateFor({ preset: 'autonomous', text: tc('tests/Unit/RenameTeamTest.php') }).why.includes('it changes existing tests'));
});

test('23: the floor guard: an existing test only grows unless declared; a skip marker stops either way; a red test is locked', () => {
  const root = realpathSync(tempDir('floor'));
  const env = { PATH: '/usr/bin:/bin', HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { cwd: root, env }).toString().trim();
  git('init', '-q', '-b', 'main');
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(join(root, 'tests/A.php'), EXISTING);
  git('add', '-A');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  const markers = markersOf({ testing: { levels: [{ name: 'unit', adapter: 'phpunit' }] } }, loadRegistry(REGISTRY_DIR).testAdapters);
  const guard = (o = {}) => floorGuard({ root, env, base, testFiles: ['tests/A.php', 'tests/B.php'], markers, ...o });
  // New lines only: fine.
  writeFileSync(join(root, 'tests/A.php'), `${EXISTING.slice(0, -2)}  public function test_new() { $this->assertTrue(true); }\n}\n`);
  assert.deepEqual(guard(), []);
  // A changed expectation: stopped, unless declared.
  writeFileSync(join(root, 'tests/A.php'), EXISTING.replace('assertSame("a", "a")', 'assertSame("a", $x)'));
  assert.match(guard()[0].why, /an existing test changed/);
  assert.deepEqual(guard({ declared: ['tests/A.php'] }), []);
  // A new skip marker: stopped, declared or not.
  writeFileSync(join(root, 'tests/A.php'), `${EXISTING}// and\n`);
  writeFileSync(join(root, 'tests/B.php'), '<?php\nfunction t() { $this->markTestSkipped("later"); }\n');
  assert.ok(guard({ declared: ['tests/A.php'] }).some((s) => /skips or focuses/.test(s.why) && s.path === 'tests/B.php'));
  // The red lock: a red file changed after the red commit stops, declared or not.
  writeFileSync(join(root, 'tests/B.php'), '<?php\nfunction t() { assert(2 === 0); }\n');
  git('add', '-A');
  git('commit', '-qm', 'red');
  const red = { commit: git('rev-parse', 'HEAD'), files: ['tests/B.php'] };
  writeFileSync(join(root, 'tests/B.php'), '<?php\nfunction t() { assert(true); }\n');
  assert.ok(guard({ red, declared: ['tests/B.php'] }).some((s) => s.path === 'tests/B.php' && /locked/.test(s.why)));
});

launchTest('23: the red handover: tests and stubs committed as red, MIRAI\'s red check confirms each row, the same session goes green; the evidence is in the record, the run log and the proof', async () => {
  const f = await ready();
  const claude = claudeSessions([RED, DONE], [writeRedTests, writeCode]);
  const run = runner();
  const r = await build(f, claude, run);
  assert.equal(r.outcome, 'handed-over', r.why);
  assert.equal(claude.launches(), 2, 'red, then green');
  assert.equal(claude.args(1)[claude.args(1).indexOf('--resume') + 1], '0000000a-0000-4000-8000-000000000000', 'green resumes the red session');
  // The red check ran each red row by its test ID and the characterization row by its file.
  assert.deepEqual(run.calls.filter((c) => c.path || c.test).map((c) => c.test ?? c.path), ['tests/Unit/RenameTeamTest.php', ...RED_IDS]);
  // Two commits: red, then green.
  const log = f.git('log', '--format=%s', '-3').trim().split('\n');
  assert.match(log[1], /red: the tests and stubs, before the code/);
  assert.match(log[0], /green: the code, from the approved plan/);
  const record = JSON.parse(readFileSync(buildRecordPath(f.store, 'PMT-31'), 'utf8'));
  assert.equal(record.red.commit, commitOf(f.root, 'HEAD~1', f.store.gitEnv));
  assert.deepEqual(record.red.rows.map((x) => x.verdict), ['ok', 'ok', 'ok', 'ok']);
  assert.equal(record.red.rows[1].message, 'Failed asserting that 0 matches expected 2.');
  assert.deepEqual(record.tdd.rows, { red: 3, after: 0, characterization: 1, no_test: 0 });
  // The run log: the red check, and tdd applied first.
  const lines = runIds(f.store).flatMap((id) => readRunLog(f.store, id).lines);
  assert.equal(lines.find((l) => l.event === 'red_check').verdict, 'ok');
  assert.equal(lines.find((l) => l.event === 'checks').tdd_applied, 'first');
  // The proof's test-first facts.
  const ev = tddEvidence(record);
  assert.equal(ev.red.rows.length, 4);
  assert.equal(ev.red.rows[1].kind, 'red');
  assert.equal(readTicketStatus(f.store, 'PMT-31').status.state, 'in-review');
});

launchTest('23: a red row that passes already, or fails with an error, goes back to Kai with why (a red round); three failed checks stop for you', async () => {
  const f = await ready();
  // Round 0: one red row passes already, one fails with a load error; round 1 fixes them.
  let attempt = 0;
  const red = (id) => (attempt === 0 ? (id === RED_IDS[0] ? 'passes' : id === RED_IDS[1] ? 'load' : 'assertion') : 'assertion');
  const run = runner({ red });
  const claude = claudeSessions([RED, RED, DONE], [`${writeRedTests}`, 'echo "// stub fixed" >> app/Team.php', writeCode]);
  const counting = Object.assign(async (o) => {
    const out = await run(o);
    if (o.test === RED_IDS[2]) attempt++;
    return out;
  }, { calls: run.calls });
  const r = await build(f, claude, counting);
  assert.equal(r.outcome, 'handed-over', r.why);
  assert.equal(claude.launches(), 3);
  const sent = claude.red(1);
  assert.equal(sent.round, 1);
  assert.deepEqual(sent.rows.map((x) => x.test), [RED_IDS[0], RED_IDS[1]]);
  assert.match(sent.rows[0].problem, /passes already/);
  assert.match(sent.rows[1].problem, /load or compile error/);
  assert.equal(JSON.parse(readFileSync(buildRecordPath(f.store, 'PMT-31'), 'utf8')).red.rounds, 1);

  // Never red: three checks, then the ticket stops for you, still in progress.
  const g = await ready();
  const never = claudeSessions([RED, RED, RED, DONE], [writeRedTests]);
  const r2 = await build(g, never, runner({ red: () => 'passes' }));
  assert.equal(r2.outcome, 'needs-you');
  assert.match(r2.why, /the red check failed 3 times/);
  assert.equal(never.launches(), 3, 'no green launch');
  assert.equal(readTicketStatus(g.store, 'PMT-31').status.state, 'in-progress');
});

launchTest('23: a locked red test edited in green stops the ticket, uncommitted; tdd: after is one handover with no red check', async () => {
  const f = await ready();
  const claude = claudeSessions([RED, DONE], [writeRedTests, 'sed -i.bak "s/assertSame(2, 0)/assertSame(0, 0)/" tests/Feature/TeamRenameTest.php && rm tests/Feature/TeamRenameTest.php.bak']);
  const r = await build(f, claude, runner());
  assert.equal(r.outcome, 'needs-you');
  assert.match(r.why, /tests\/Feature\/TeamRenameTest\.php: a test from the red commit changed/);
  assert.match(f.git('log', '--format=%s', '-1'), /red: the tests and stubs/, 'the green work isn\'t committed');

  const g = await ready({ tdd: 'after', plan: PLAN.replace(/\| (characterization|red) \|$/gm, '| after |') });
  const one = claudeSessions([DONE], [writeCode]);
  const run = runner();
  const r2 = await build(g, one, run);
  assert.equal(r2.outcome, 'handed-over', r2.why);
  assert.equal(one.launches(), 1);
  assert.equal(run.calls.filter((c) => c.path || c.test).length, 0, 'no red check');
  const lines = runIds(g.store).flatMap((id) => readRunLog(g.store, id).lines);
  assert.equal(lines.find((l) => l.event === 'checks').tdd_applied, 'after');
  assert.equal(lines.some((l) => l.event === 'red_check'), false);
});

launchTest('23: an existing test weakened in the build stops it; declared, it passes', async () => {
  const weaken = 'sed -i.bak "s/assertSame(\\"a\\", \\"a\\")/assertTrue(true)/" tests/Unit/RenameTeamTest.php && rm tests/Unit/RenameTeamTest.php.bak';
  const plan = PLAN.replace(/\| (characterization|red) \|$/gm, '| after: not about red |');
  const f = await ready({ plan });
  const r = await build(f, claudeSessions([DONE], [`${writeCode} && ${weaken}`]), runner());
  assert.equal(r.outcome, 'needs-you');
  assert.match(r.why, /tests\/Unit\/RenameTeamTest\.php: an existing test changed/);
  const g = await ready({ plan: plan.replace('| none | | |', '| test-change | tests/Unit/RenameTeamTest.php | the old name check is replaced by AC-PMT-31.1 |') });
  const r2 = await build(g, claudeSessions([DONE], [`${writeCode} && ${weaken}`]), runner());
  assert.equal(r2.outcome, 'handed-over', r2.why);
  assert.ok(planPath);
});
