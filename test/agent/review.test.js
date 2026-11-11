import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PACKAGE_ROOT } from '../../src/install/init.js';
import { loadRegistry } from '../../src/config/registry.js';
import { checkAgentRole, checkReviewAgent, REVIEW_AGENT } from '../../src/agent/run.js';
import { runBuild } from '../../src/agent/build.js';
import { runPlan } from '../../src/agent/plan.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { readDisputes, reviewPath, reviewsOf, runReview, REVIEW_SCHEMA, verdictFrom } from '../../src/agent/review.js';
import { runFix } from '../../src/agent/fix.js';
import { writeBaseline } from '../../src/baseline/store.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { readLoop } from '../../src/loop/guard.js';
import { recordReadings } from '../../src/loop/ledger.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { loadSigner } from '../../src/sign/signer.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { readRunLog, runIds } from '../../src/store/run-log.js';
import { readTicketStatus } from '../../src/store/tickets.js';
import { snapshot } from '../../src/trust/snapshot.js';
import { installed, tempDir } from '../tests/run-fixture.js';

// Unit 24a: the review step (Rex). These tests need no model: a stand-in `claude` and test run.

const registry = () => loadRegistry(join(PACKAGE_ROOT, 'registry'));
const reviewer = { name: 'reviewer', mode: 'read-only', step: 'review' };
const planner = { name: 'planner', mode: 'read-only', step: 'plan' };

test('24a: Rex is in the registry: the reviewer role, read-only, the read-only tools', () => {
  const r = registry();
  const rex = r.agents[REVIEW_AGENT];
  assert.ok(rex, 'mirai-reviewer is defined');
  assert.equal(rex.role, 'reviewer');
  assert.equal(rex.read_only, true);
  assert.deepEqual([...rex.tools.allowed].sort(), ['Glob', 'Grep', 'Read']);
  // The role is read-only, so the agent may run under it (21a's rule), and never under a writing one.
  assert.doesNotThrow(() => checkAgentRole(rex, r.roles.reviewer));
  assert.throws(() => checkAgentRole(rex, r.roles.author), (e) => e.code === 'agent-role' || e.code === 'agent-read-only');
});

test('24a: only Rex reviews: any other agent is refused for the review step, and Kai under the reviewer role', () => {
  // Rex, for the review step, normal or high risk.
  assert.doesNotThrow(() => checkReviewAgent({ agent: REVIEW_AGENT, role: reviewer, step: 'review' }));
  assert.doesNotThrow(() => checkReviewAgent({ agent: REVIEW_AGENT, role: reviewer, step: 'review-high-risk' }));
  // Kai, for the review step, under any role.
  assert.throws(() => checkReviewAgent({ agent: 'mirai-developer', role: reviewer, step: 'review' }), (e) => e.code === 'not-the-reviewer');
  assert.throws(() => checkReviewAgent({ agent: 'mirai-developer', role: planner, step: 'review-high-risk' }), (e) => e.code === 'not-the-reviewer');
  // Any other named agent for the review step.
  assert.throws(() => checkReviewAgent({ agent: 'mirai-fixture-reviewer', role: reviewer, step: 'review' }), (e) => e.code === 'not-the-reviewer');
  // Kai under the reviewer role, whatever the step.
  assert.throws(() => checkReviewAgent({ agent: 'mirai-developer', role: reviewer, step: 'commit-message' }), (e) => e.code === 'author-reviews');
  // Kai's own steps are untouched: the plan as planner.
  assert.doesNotThrow(() => checkReviewAgent({ agent: 'mirai-developer', role: planner, step: 'plan' }));
  // A plain role run names no agent (mirai agent run --role reviewer, the probes): not the review
  // step's launch, which always names Rex.
  assert.doesNotThrow(() => checkReviewAgent({ agent: null, role: reviewer, step: 'review' }));
});

// ---- The step, end to end (as the build tests do: a stand-in claude, a stand-in test run) ----

const TOKEN = `sk-ant-oat01-${'Ag3_-k'.repeat(16)}`;
const INIT = '{"type":"system","subtype":"init","permissionMode":"dontAsk"}';
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const PLAN = readFileSync(join(REGISTRY_DIR, 'examples', 'plan.md'), 'utf8');
const CONFIG = '\n[[testing.levels]]\nname = "unit"\ncommand = ["run-tests"]\nservice = "app"\n\n[[testing.levels]]\nname = "feature"\ncommand = ["run-tests"]\nservice = "app"\n\n[compose]\nfiles = ["compose.yml"]\nenv_file = ".env.test"\n';
const doc = (fm, body) => `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`).join('\n')}\n---\n${body}`;
const ticketDoc = (risk) => doc({ id: 'PMT-31', type: 'story', template: 'story@v1', repo: '"."', risk, size: 'M', verify: '"Rename a team on staging."', tdd: 'first' },
  '# Renaming a team hides its members\n\n## Acceptance criteria\n\n- AC-PMT-31.1: the members stay after a rename\n- AC-PMT-31.2: the old slug redirects\n');
const files = (risk = 'normal') => ({ 'docs/mirai/tickets/PMT-31.md': ticketDoc(risk), 'package.json': '{\n  "name": "app",\n  "dependencies": { "express": "^4" }\n}\n', 'app/Team.php': '<?php\n// one\n// two\n' });
const PASSED = { state: 'pass', known_failures: [], tests: { total: 3, skipped: 0 } };
const passing = async ({ name }) => ({ outcome: 'pass', id: `t-${name}`, tests: { total: 3, passed: 3, failed: 0, errors: 0, skipped: 0 } });

async function tty(argv, { cwd, env }, answers) {
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd });
  return { code, out, err };
}

// A stand-in claude answering each launch with the next of `results`, after `before[n]` (shell) in the
// project; it keeps each launch's arguments and the review's input files it was given.
function claudeWith(results, before = []) {
  const dir = realpathSync(tempDir('claude'));
  results.forEach((r, i) => {
    writeFileSync(join(dir, `r${i}.json`), `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 3, usage: { input_tokens: 5, output_tokens: 6 }, result: 'done', structured_output: r })}\n`);
    writeFileSync(join(dir, `b${i}.sh`), `${before[i] ?? ':'}\n`);
  });
  writeFileSync(join(dir, 'n'), '0');
  const path = join(dir, 'claude');
  writeFileSync(path, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2.1.316 (Claude Code)"; exit 0; fi
n=$(cat ${dir}/n); echo $((n+1)) > ${dir}/n
for a in "$@"; do printf '%s\\n' "$a"; done > ${dir}/args$n
inputs=$(sed -n '/^--add-dir$/{n;p;}' ${dir}/args$n)
for f in index.json review.diff delta.diff prior-findings.json review-files.json findings.json failures.json plan.md ticket.md intent.md findings-to-check.json; do [ -f "$inputs/$f" ] && cp "$inputs/$f" ${dir}/$n-$f; done
. ${dir}/b$n.sh
echo '${INIT}'; cat ${dir}/r$n.json
`, { mode: 0o755 });
  const read = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : null);
  return { path, args: (n) => readFileSync(join(dir, `args${n}`), 'utf8').split('\n'), input: (n, name) => read(`${n}-${name}`), launches: () => Number(readFileSync(join(dir, 'n'), 'utf8')) };
}
const watch = (claude) => ({ claude: claude.path, status: green, check: () => [] });
const done = { status: 'done', summary: 'Changed app/Team.php.', tests_run: ['unit: pass'], checks_run: [] };

// A ticket built green by Kai (in-review, MIRAI's commit): the change is one line in app/Team.php.
async function built({ risk = 'normal', results = [], before = [], buildTests = passing, expect = 'handed-over', config = CONFIG } = {}) {
  const f = installed({ config, files: files(risk) });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  writeToken(f.env, TOKEN);
  writeFileSync(join(f.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Test Author"\nauthor_email = "author@example.com"\n', { mode: 0o600 });
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  const io = { cwd: f.root, env: f.env };
  assert.equal((await tty(['approve', 'PMT-31', '--file', 'docs/mirai/tickets/PMT-31.md'], io, ['a', 'PMT-31'])).code, EXIT.OK);
  const plan = risk === 'high' ? PLAN.replace('risk: normal', 'risk: high') : PLAN;
  const p = await runPlan({ cwd: f.root, env: f.env, ticket: 'PMT-31', launchTokens: [mintLaunchToken(), mintLaunchToken()], launchOptions: watch(claudeWith([{ plan }])) });
  assert.equal(p.outcome, 'waiting', JSON.stringify(p.problems));
  assert.equal((await tty(['approve', 'PMT-31', '--plan'], io, ['a', 'PMT-31'])).code, EXIT.OK);
  const store = openStore(io);
  writeBaseline(store, { schema_version: 1, sha: snapshot(io).baseSha, levels: { unit: PASSED, feature: PASSED } }, loadSigner(f.env, store));
  // Kai's build (launch 0), then whatever the test gives Rex.
  const claude = claudeWith([done, ...results], ['printf "// renamed\\n" >> app/Team.php', ...before]);
  const b = await runBuild({ cwd: f.root, env: f.env, ticket: 'PMT-31', launchToken: mintLaunchToken(), launchOptions: watch(claude), testRun: buildTests });
  assert.equal(b.outcome, expect, b.why);
  return { ...f, store, claude };
}
const review = (f, o = {}) => runReview({ cwd: f.root, env: f.env, ticket: 'PMT-31', launchToken: mintLaunchToken(), launchOptions: watch(f.claude), ...o });
const state = (f) => readTicketStatus(f.store, 'PMT-31').status.state;
// The added line in app/Team.php (line 4, after the fixture's three).
const ADDED = 4;
const finding = (o = {}) => ({ id: 'F1', severity: 'blocking', category: 'correctness', file: 'app/Team.php', line: ADDED, symbol: 'rename', basis: { kind: 'ac', ref: 'AC-PMT-31.1' }, claim: 'The rename drops the members.', ...o });
// A recent weekly usage reading: at night MIRAI starts no ticket without one (unit 20).
const reading = (f) => recordReadings(f.env, [{ window: 'seven_day', utilization: 0.1, resets_at: Math.floor(Date.now() / 1000) + 86_400, status: 'allowed' }], { repoId: f.store.repoId, runId: 'r-20261108-010203-abc1' });
const runLines = (f) => runIds(f.store).flatMap((id) => readRunLog(f.store, id).lines);

test('24a: the review schema Claude Code gets is 09a\'s, inlined; a verdict is checked against the file, never taken as it comes', () => {
  assert.equal(JSON.stringify(REVIEW_SCHEMA).includes('$ref'), false);
  assert.deepEqual(REVIEW_SCHEMA.required, ['verdict', 'findings']);
  assert.ok(verdictFrom({ verdict: 'pass', findings: [] }).value);
  assert.match(verdictFrom(null).problem, /no verdict/);
  assert.match(verdictFrom({ verdict: 'pass', findings: [finding()] }).problem, /pass can't carry a blocking finding/);
  assert.match(verdictFrom({ verdict: 'ok', findings: [] }).problem, /schema/);
});

test('24a: a pass: Rex is launched read-only with the pinned diff as input; the ticket stays in-review; the record is complete', async () => {
  const f = await built({ results: [{ verdict: 'pass', findings: [{ id: 'N1', severity: 'nit', category: 'style', file: 'app/Team.php', line: ADDED, claim: 'A comment could say why.' }] }] });
  const r = await review(f);
  assert.equal(r.outcome, 'pass', r.why);
  assert.equal(state(f), 'in-review');
  assert.deepEqual(r.followups, ['N1']);
  // Launch 1 is Rex's: the reviewer agent, the read-only tools, a JSON schema, and MIRAI's diff.
  const args = f.claude.args(1).join('\n');
  assert.match(args, /mirai-reviewer/);
  assert.match(args, /--json-schema/);
  const tools = f.claude.args(1)[f.claude.args(1).indexOf('--tools') + 1];
  assert.equal(/Edit|Write|Bash/.test(tools), false, `Rex's tools: ${tools}`);
  assert.match(f.claude.input(1, 'review.diff'), /\+\/\/ renamed/);
  assert.equal(f.claude.input(1, 'prior-findings.json'), null, 'round 1 has no prior findings');
  // index.json names every file in the folder, the diff included (27b's P2: Rex read an index that
  // listed only plan.md and ticket.md, and reviewed the checkout instead).
  const listed = JSON.parse(f.claude.input(1, 'index.json')).files.map((x) => x.name);
  for (const name of ['plan.md', 'ticket.md', 'review.diff', 'review-files.json']) assert.ok(listed.includes(name), `${name} in index.json: ${listed}`);
  const rec = JSON.parse(readFileSync(reviewPath(f.store, 'PMT-31', 1), 'utf8'));
  assert.equal(rec.complete, true);
  assert.equal(rec.decision, 'done');
  assert.equal(rec.depth, 'normal');
  // The finding's structured part is in the run log, its text in the review file (Q9).
  const line = runLines(f).find((l) => l.event === 'finding' && l.id === 'N1');
  assert.equal(line.text_ref.ref, 'tickets/PMT-31/review-r1.json');
  // A second review of the same commit is refused.
  await assert.rejects(review(f), (e) => e.code === 'already-reviewed');
});

test('24a: MIRAI triages the findings: an uncited or off-basis blocking finding is downgraded, an untouched line is pre-existing, a real one sends the ticket back', async () => {
  const findings = [
    finding(),
    finding({ id: 'F2', basis: undefined }),
    finding({ id: 'F3', basis: { kind: 'ac', ref: 'AC-OTHER.1' } }),
    finding({ id: 'F4', line: 2, symbol: 'old' }),
  ].map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)));
  const f = await built({ results: [{ verdict: 'changes', findings }] });
  const r = await review(f);
  assert.equal(r.outcome, 'changes', r.why);
  assert.deepEqual(r.blocking, ['F1']);
  assert.equal(state(f), 'in-progress', 'blocking findings send it back to Kai');
  const rec = JSON.parse(readFileSync(reviewPath(f.store, 'PMT-31', 1), 'utf8'));
  const by = Object.fromEntries(rec.findings.map((x) => [x.id, x]));
  assert.equal(by.F2.downgrade_reason, 'no-basis');
  assert.equal(by.F3.downgrade_reason, 'unresolved-basis');
  assert.equal(by.F4.downgrade_reason, 'pre-existing');
  // A review launch isn't a round; the loop guard judged it once.
  assert.equal(readLoop(f.store, 'PMT-31').rounds_used, 0);
  assert.equal(readLoop(f.store, 'PMT-31').reviews, 1);
});

test('24a: refusals: before a green step, Kai for the review step; a verdict MIRAI can\'t read fails in your terminal and parks at night', async () => {
  const f = await built({ results: [{ nonsense: true }, { verdict: 'pass', findings: [] }] });
  // Not a verdict: agent-failed, the ticket stays in-review, the record says why; it can run again.
  const bad = await review(f);
  assert.equal(bad.outcome, 'agent-failed');
  assert.equal(state(f), 'in-review');
  assert.equal(reviewsOf(f.store, 'PMT-31')[0].record.outcome, 'agent-failed');
  const again = await review(f);
  assert.equal(again.outcome, 'pass', again.why);
  assert.equal(again.review, 2);
  // At night, the same bad verdict parks.
  const g = await built({ results: [{ nonsense: true }] });
  reading(g);
  const night = await review(g, { unattended: true });
  assert.equal(night.outcome, 'parked');
  assert.equal(readTicketStatus(g.store, 'PMT-31').status.park_reason, 'bad-verdict');
});

// ---- Unit 24b: the high-risk depth ----

const LENS_ORDER = ['blind-hunter', 'edge-cases', 'verification-gap', 'intent-alignment', 'security'];
const clean = { verdict: 'pass', findings: [] };
const highReview = (f, o = {}) => review(f, { launchToken: null, nextToken: () => mintLaunchToken(), ...o });
const record = (f, n) => JSON.parse(readFileSync(reviewPath(f.store, 'PMT-31', n), 'utf8'));

test('24b: a high-risk round 1 runs the five lenses one after another, each with its own inputs, on deep; nothing blocking, so no check, and it passes', async () => {
  const f = await built({ risk: 'high', results: LENS_ORDER.map(() => clean) });
  // One token isn't enough for a high-risk review.
  await assert.rejects(review(f), (e) => e.code === 'needs-tokens');
  const r = await highReview(f);
  assert.equal(r.outcome, 'pass', r.why);
  assert.equal(r.depth, 'high');
  assert.equal(state(f), 'in-review');
  // Launch 0 was Kai's build (the one-token review was refused before any launch); then 1–5.
  assert.equal(f.claude.launches(), 6, 'no check launch without a blocking finding');
  LENS_ORDER.forEach((lens, i) => {
    const args = f.claude.args(i + 1);
    assert.ok(args.some((a) => a.includes(`yours is **${lens}**`)), `launch ${i + 1} is the ${lens} lens`);
    assert.equal(args[args.indexOf('--model') + 1], 'claude-opus-5-5', `${lens} runs on deep`);
    assert.match(f.claude.input(i + 1, 'review.diff'), /\+\/\/ renamed/);
  });
  // The blind hunter gets the diff alone; intent alignment gets the frozen block verbatim.
  assert.equal(f.claude.input(1, 'plan.md'), null);
  assert.equal(f.claude.input(1, 'ticket.md'), null);
  assert.ok(f.claude.input(2, 'plan.md'));
  assert.match(f.claude.input(4, 'intent.md'), /Intent/);
  const rec = record(f, 1);
  assert.equal(rec.depth, 'high');
  assert.equal(rec.complete, true);
  assert.deepEqual(Object.keys(rec.passes), LENS_ORDER);
  assert.ok(Object.values(rec.passes).every((p) => p.state === 'returned'));
});

test('24b: the lenses\' findings are merged; one check launch judges every blocking one; a false one never reaches Kai and is logged; round 2 is one combined pass', async () => {
  const same = finding({ id: 'E1', claim: 'Members go missing after the rename.' });
  const other = finding({ id: 'E2', symbol: 'slug', basis: { kind: 'ac', ref: 'AC-PMT-31.2' }, claim: 'The old slug no longer redirects.' });
  const lenses = [{ verdict: 'changes', findings: [finding()] }, { verdict: 'changes', findings: [same, other] }, clean, clean, clean];
  const check = { checks: [{ id: 'F1', verdict: 'high' }, { id: 'F2', verdict: 'false', note: 'The redirect is in routes, untouched.' }] };
  const fixDone = handover([{ id: 'F1', outcome: 'fixed' }]);
  const f = await built({ risk: 'high', results: [...lenses, check, fixDone, clean], before: ['', '', '', '', '', '', 'printf "// members kept\\n" >> app/Team.php'] });
  const r = await highReview(f);
  assert.equal(r.outcome, 'changes', r.why);
  assert.deepEqual(r.blocking, ['F1']);
  assert.equal(state(f), 'in-progress');
  // The check (launch 6) got both blocking findings, merged, under the review's own ids.
  const sent = JSON.parse(f.claude.input(6, 'findings-to-check.json')).findings;
  assert.deepEqual(sent.map((x) => x.id), ['F1', 'F2']);
  const rec = record(f, 1);
  const by = Object.fromEntries(rec.findings.map((x) => [x.id, x]));
  assert.deepEqual(by.F1.lenses, ['blind-hunter', 'edge-cases'], 'the same file, symbol and basis from two lenses is one finding');
  assert.equal(by.F2.severity, 'should-fix');
  assert.equal(by.F2.downgrade_reason, 'unconfirmed');
  assert.equal(rec.check.state, 'returned');
  assert.ok(runLines(f).some((l) => l.event === 'finding_outcome' && l.id === 'F2' && l.outcome === 'false'), 'M5: the false positive is logged');
  // Kai gets only F1.
  const fx = await fixRound(f);
  assert.equal(fx.outcome, 'handed-over', fx.why);
  assert.deepEqual(JSON.parse(f.claude.input(7, 'findings.json')).findings.map((x) => x.id), ['F1']);
  // Round 2: one combined pass, on deep, with the delta and F1; no lens and no check.
  const r2 = await highReview(f);
  assert.equal(r2.outcome, 'pass', r2.why);
  assert.equal(r2.round, 2);
  assert.equal(f.claude.launches(), 9);
  const args = f.claude.args(8);
  assert.equal(args.some((a) => a.includes('yours is **')), false, 'no lens in round 2');
  assert.equal(args[args.indexOf('--model') + 1], 'claude-opus-5-5');
  assert.ok(f.claude.input(8, 'delta.diff'));
  assert.deepEqual(Object.keys(record(f, 2).passes), ['combined']);
});

test('24b: a lens that fails leaves the review incomplete (never a pass); mirai review again runs only what\'s missing; at night it parks', async () => {
  const f = await built({ risk: 'high', results: [clean, { nonsense: true }, clean, clean, clean, clean] });
  const bad = await highReview(f);
  assert.equal(bad.outcome, 'agent-failed');
  assert.equal(state(f), 'in-review');
  const first = record(f, 1);
  assert.equal(first.incomplete, true);
  assert.equal(first.passes['blind-hunter'].state, 'returned');
  assert.equal(first.passes['edge-cases'].state, 'failed');
  assert.equal(first.passes.security, undefined, 'a failed pass stops the rest');
  assert.equal(f.claude.launches(), 3);
  // Again: edge cases and the three after it, never the blind hunter a second time.
  const again = await highReview(f);
  assert.equal(again.outcome, 'pass', again.why);
  assert.equal(f.claude.launches(), 7);
  assert.ok(f.claude.args(3).some((a) => a.includes('yours is **edge-cases**')));
  const second = record(f, 2);
  assert.equal(second.resumes, 1);
  assert.equal(second.complete, true);
  // A check MIRAI can't read is incomplete too; at night, a park.
  const g = await built({ risk: 'high', results: [{ verdict: 'changes', findings: [finding()] }, clean, clean, clean, clean, { checks: [] }] });
  reading(g);
  const night = await highReview(g, { unattended: true });
  assert.equal(night.outcome, 'parked');
  assert.equal(readTicketStatus(g.store, 'PMT-31').status.park_reason, 'bad-verdict');
  assert.equal(record(g, 1).check.state, 'failed');
});

test('24b: after a full pass only a protected path stops for you (parks at night); gate.risk.high raises a normal ticket to high', async () => {
  const f = await built({ risk: 'high', results: LENS_ORDER.map(() => clean) });
  // The build found a protected path touched (declared in the plan, as the build requires).
  const bp = join(f.store.dir, 'tickets', 'PMT-31', 'build.json');
  const b = JSON.parse(readFileSync(bp, 'utf8'));
  writeFileSync(bp, `${JSON.stringify({ ...b, protectedPaths: { ...(b.protectedPaths ?? {}), touched: ['CLAUDE.md'] } }, null, 2)}\n`);
  reading(f);
  const night = await highReview(f, { unattended: true });
  assert.equal(night.outcome, 'parked');
  assert.match(night.why, /CLAUDE\.md/);
  assert.equal(readTicketStatus(f.store, 'PMT-31').status.park_reason, 'high-risk-review');
  // A normal ticket whose change matches the trust root's gate.risk.high.
  const g = await built({ config: `${CONFIG}\n[gate.risk]\nhigh = ["app/**"]\n`, results: LENS_ORDER.map(() => clean) });
  const r = await highReview(g);
  assert.equal(r.risk, 'high');
  assert.equal(r.outcome, 'pass', r.why);
  assert.deepEqual(record(g, 1).risk_paths, ['app/Team.php']);
  assert.equal(g.claude.launches(), 6, 'the five lenses');
});

test('24a: /mirai review is a step from your session (21f\'s rule); /mirai unpark is a gate that names both terminal commands', async () => {
  const { checkCommand, COMMANDS, GATES } = await import('../../src/mcp/tools/commands.js');
  assert.deepEqual(checkCommand({ command: 'review', ticket: 'PMT-31' }), { args: { command: 'review', ticket: 'PMT-31' } });
  assert.deepEqual(COMMANDS.review.argv({ ticket: 'PMT-31' }), ['review', 'PMT-31']);
  assert.equal(COMMANDS.review.tty, true);
  assert.ok(checkCommand({ command: 'review' }).refused, 'a review needs its ticket');
  const unpark = GATES.unpark({ ticket: 'PMT-31' });
  assert.match(unpark, /mirai unpark PMT-31 --retry/);
  assert.match(unpark, /mirai unpark PMT-31 --accept <finding-id>/);
});

// ---- The loop: review → fix → review (decisions 3 and 4) ----

const fixRound = (f, o = {}) => runFix({ cwd: f.root, env: f.env, ticket: 'PMT-31', nextToken: () => mintLaunchToken(), launchOptions: watch(f.claude), testRun: passing, ...o });
const handover = (replies) => ({ status: 'done', summary: 'Fixed what Rex found.', replies });
const blockingVerdict = { verdict: 'changes', findings: [finding()] };

test('24a: review → fix → review: Kai gets Rex\'s blocking findings, replies, MIRAI commits; round 2 sees the delta and the old finding', async () => {
  const f = await built({
    results: [blockingVerdict, handover([{ id: 'F1', outcome: 'fixed' }]), { verdict: 'pass', findings: [] }],
    before: [':', 'printf "// members kept\\n" >> app/Team.php', ':'],
  });
  assert.equal((await review(f)).outcome, 'changes');
  // mirai fix starts from the review: findings.json, never failures.json; the fix schema has replies.
  const fx = await fixRound(f);
  assert.equal(fx.outcome, 'handed-over', JSON.stringify(fx.rounds));
  assert.deepEqual(f.claude.input(2, 'findings.json').findings ?? JSON.parse(f.claude.input(2, 'findings.json')).findings.map((x) => x.id), ['F1']);
  assert.equal(f.claude.input(2, 'failures.json'), null);
  assert.match(f.claude.args(2).join('\n'), /"replies"/);
  assert.deepEqual(fx.rounds[0].replies, [{ id: 'F1', outcome: 'fixed' }]);
  assert.equal(state(f), 'in-review');
  assert.ok(runLines(f).some((l) => l.event === 'finding_outcome' && l.id === 'F1' && l.outcome === 'fixed'));
  // Round 2: the delta (the fix's line) and the earlier blocking finding go to Rex; a pass.
  const r2 = await review(f);
  assert.equal(r2.outcome, 'pass', r2.why);
  assert.equal(r2.round, 2);
  assert.match(f.claude.input(3, 'delta.diff'), /\+\/\/ members kept/);
  assert.deepEqual(JSON.parse(f.claude.input(3, 'prior-findings.json')).findings.map((x) => x.id), ['F1']);
  const listed2 = JSON.parse(f.claude.input(3, 'index.json')).files.map((x) => x.name);
  for (const name of ['review.diff', 'delta.diff', 'prior-findings.json']) assert.ok(listed2.includes(name), `${name} in round 2's index.json: ${listed2}`);
  // One fix round was used; mirai fix after a pass has nothing to start from.
  assert.equal(readLoop(f.store, 'PMT-31').rounds_used, 1);
});

test('24a: L4 across reviews: a finding Rex raises again after a fix round is a plan problem (the one re-plan)', async () => {
  // Round 1's findings: two. The fix's tests go green. Round 2 raises F2 again.
  const two = { verdict: 'changes', findings: [finding(), finding({ id: 'F2', symbol: 'redirect', basis: { kind: 'ac', ref: 'AC-PMT-31.2' } })] };
  const f = await built({
    results: [two, handover([{ id: 'F1', outcome: 'fixed' }, { id: 'F2', outcome: 'fixed' }]), { verdict: 'changes', findings: [finding({ id: 'F9', prior: 'F2', symbol: 'redirect', basis: { kind: 'ac', ref: 'AC-PMT-31.2' } })] }],
    before: [':', 'printf "// fix\\n" >> app/Team.php', ':'],
  });
  await review(f);
  assert.equal((await fixRound(f)).outcome, 'handed-over');
  const r2 = await review(f);
  // F2 came back (the same file + symbol + basis): L4's repeat, so the ticket's one re-plan.
  assert.equal(r2.outcome, 'replan', r2.why);
  assert.equal(state(f), 'ready-for-dev');
});

test('24a: a dispute parks (decision 3); --accept drops the finding and Rex reviews again; the finding is never raised again', async () => {
  const f = await built({
    results: [blockingVerdict, handover([{ id: 'F1', outcome: 'disputed', reason: 'The members are kept by the cascade in Team::rename.' }]), { verdict: 'pass', findings: [] }],
    before: [':', ':', ':'],
  });
  await review(f);
  const fx = await fixRound(f);
  assert.equal(fx.outcome, 'parked', fx.why);
  assert.match(fx.why, /F1/);
  const st = readTicketStatus(f.store, 'PMT-31').status;
  assert.equal(st.state, 'blocked');
  assert.equal(st.park_reason, 'disputed');
  assert.equal(readDisputes(f.store, 'PMT-31').disputes[0].id, 'F1');
  // Your ruling, signed, in a terminal: F1 is dropped; none stand, so back to in-review.
  const io = { cwd: f.root, env: f.env };
  const bad = await tty(['unpark', 'PMT-31', '--accept', 'F7'], io, ['x', 'PMT-31']);
  assert.notEqual(bad.code, EXIT.OK);
  assert.match(bad.err, /F7 isn't an open disputed finding/);
  const ok = await tty(['unpark', 'PMT-31', '--accept', 'F1'], io, ['the cascade keeps them', 'PMT-31']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.equal(state(f), 'in-review');
  // Kai changed nothing, so Rex reviews the same commit again, without F1.
  const r2 = await review(f);
  assert.equal(r2.outcome, 'pass', r2.why);
  assert.deepEqual(JSON.parse(f.claude.input(3, 'prior-findings.json')).findings, []);
});

test('24a: --retry on a dispute: it stands; Kai gets it back as yours and can\'t dispute it again', async () => {
  const f = await built({
    results: [blockingVerdict, handover([{ id: 'F1', outcome: 'disputed', reason: 'Not a bug.' }]), handover([{ id: 'F1', outcome: 'disputed', reason: 'Still not.' }])],
    before: [':', ':', 'printf "// fixed for real\\n" >> app/Team.php'],
  });
  await review(f);
  assert.equal((await fixRound(f)).outcome, 'parked');
  const ok = await tty(['unpark', 'PMT-31', '--retry'], { cwd: f.root, env: f.env }, ['it stands', 'PMT-31']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.equal(state(f), 'in-progress');
  const fx = await fixRound(f);
  assert.equal(fx.outcome, 'handed-over', JSON.stringify(fx.rounds));
  assert.equal(JSON.parse(f.claude.input(3, 'findings.json')).upheld, true);
  // A second dispute of an upheld finding is taken as fixed: Rex looks at it again.
  assert.deepEqual(fx.rounds[0].replies, [{ id: 'F1', outcome: 'fixed' }]);
  assert.equal(state(f), 'in-review');
});

test('24a: L5 compares like with like: failures fixed to green, then Rex\'s findings, isn\'t "no progress"', async () => {
  const failing = async ({ name }) => (name === 'feature' ? { outcome: 'fail', failing: [{ id: 'tests/B.php::b', message: 'b failed', kind: 'assertion' }], failing_total: 1, tests: { total: 3, failed: 1, skipped: 0 }, output: { tail: 'FAIL b' } } : passing({ name }));
  const two = { verdict: 'changes', findings: [finding(), finding({ id: 'F2', symbol: 'redirect', basis: { kind: 'ac', ref: 'AC-PMT-31.2' } })] };
  // The build fails a test; one fix round makes it green (open: 0); Rex then finds two things.
  const f = await built({ buildTests: failing, expect: 'checks-failed', results: [{ status: 'done', summary: 'Fixed b.' }, two], before: ['printf "// b\\n" >> app/Team.php', ':'] });
  assert.equal((await fixRound(f)).outcome, 'handed-over');
  const r = await review(f);
  // Before 24a, the first review after a test-fixing round counted no finding (L2's delta was empty)
  // and passed; and 2 findings after an open count of 0 would have parked it (L5).
  assert.equal(r.outcome, 'changes', r.why);
  assert.equal(state(f), 'in-progress');
});
