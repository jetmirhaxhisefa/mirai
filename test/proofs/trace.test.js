import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fixFrom, runFix } from '../../src/agent/fix.js';
import { buildRecordPath } from '../../src/agent/build.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { runReview } from '../../src/agent/review.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { beforeLaunch, readLoop } from '../../src/loop/guard.js';
import { checkArgs, toolNamed } from '../../src/mcp/tools.js';
import { mcpPolicyTools, mcpTools, strictTemplate } from '../../src/launch/strict.js';
import { proofProblem, proofText, signProof, TRACE_CUTOFF, traceAccepted } from '../../src/proofs/records.js';
import { signObject } from '../../src/sign/sign.js';
import { loadSigner } from '../../src/sign/signer.js';
import { readTicketStatus } from '../../src/store/tickets.js';
import { resultContext } from '../../src/tests/run.js';
import { readTraceRecord } from '../../src/trace/gate.js';
import { recordProofs } from '../../src/proofs/record.js';
import { driveTicket, STEPS } from '../../src/run/drive.js';
import { appendEvent } from '../../src/store/journal.js';
import { commitOf } from '../../src/store/git.js';
import { openStore } from '../../src/store/home.js';
import { snapshot, trustedConfig, trustedRegistry } from '../../src/trust/snapshot.js';
import { needsTest } from '../helpers/needs.js';
import { approvedTicket, CASES, casesFolder, claudeWith, done, PASSED, passed, passing, PLAN_TEXT, tty, watch } from './fixture.js';
import { runPlan } from '../../src/agent/plan.js';
import { writeBaseline } from '../../src/baseline/store.js';
import { takeOutWrapper } from '../probes/trace-probes.js';
import { realpathSync, mkdtempSync, readdirSync as readDir } from 'node:fs';
import { tmpdir } from 'node:os';

// Unit 43 at ship time, on 25a's fixture (PMT-31, built by Kai and passed by Rex, with stand-in
// claude and test runs): trace on the gate's own results before any proof is minted (T3, T6), the
// proofs' trace field and the gate check (T7), and the broker tool trace(item) (T8).

const launchTest = needsTest('macos', 'an agent launch: its scratch folder is macOS\'s /private/tmp (src/launch/strict.js; P01)');

// A gate run whose results hold only AC-PMT-31.1's tests: AC-PMT-31.2 and its two plan rows are missing.
const only31 = async ({ name }) => ({ ...(await passing({ name })), ...casesFolder(CASES[name].filter((c) => c.id.includes('AC-PMT-31.1'))) });
// A test file in the repo that does test AC-PMT-31.2, by name, which the gate's results don't hold.
const TREE_TEST = { 'tests/Feature/TeamRenameTest.php': '<?php\n// test(\'AC-PMT-31.2: an old slug redirects to the new one\')\n' };
const proofsIn = (f) => f.git('ls-files', '.mirai/records/PMT-31').split('\n').filter((p) => /\/(review|gate)-/.test(p));

launchTest('43 T3 and T6: a passing test in the work tree that isn\'t in the gate\'s results doesn\'t count; a failing trace mints no proof, writes one must-fix per missing link, and sends PMT-31 back to Kai, counted', async () => {
  const f = await passed({ extra: TREE_TEST });
  const before = readLoop(f.store, 'PMT-31');
  const r = await f.record({ run: only31 });
  assert.equal(r.outcome, 'trace-failed', r.why);
  assert.deepEqual(proofsIn(f), [], 'no proof minted');
  assert.deepEqual(r.trace.missing.map((m) => [m.id, m.kind]), [['AC-PMT-31.2', 'test'], ['AC-PMT-31.2', 'plan'], ['AC-PMT-31.2', 'plan']]);
  assert.match(r.trace.missing[0].what, /AC-PMT-31\.2 has no passing test named with its ID in the gate's run/);
  // One must-fix per missing link, in 09a's fields, kept for the fix round.
  const record = readTraceRecord(f.store, 'PMT-31');
  assert.equal(record.findings.length, 3);
  assert.ok(record.findings.every((x) => x.severity === 'blocking' && x.category === 'trace' && x.basis.kind === 'ac' && x.basis.ref === 'AC-PMT-31.2' && x.file === 'plan.md'));
  assert.equal(record.commit, f.git('rev-parse', 'HEAD'));
  // The loop guard judged it (a round of its own), and the ticket is back with Kai.
  assert.equal(readLoop(f.store, 'PMT-31').reviews, before.reviews + 1);
  assert.equal(readTicketStatus(f.store, 'PMT-31').status.state, 'in-progress');
  const last = JSON.parse(readFileSync(buildRecordPath(f.store, 'PMT-31'), 'utf8'));
  const from = fixFrom(f.store, 'PMT-31', last);
  assert.deepEqual([from.trace, from.findings.length, from.commit], [record.round, 3, record.commit]);
  // The CLI's words.
  // Kai's fix round gets trace.json and counts as a round; MIRAI's checks pass, so it's handed over.
  const claude = claudeWith([done, { verdict: 'pass', findings: [] }], ['printf "// AC-PMT-31.2 tests named\\n" >> app/Team.php']);
  const usedBefore = readLoop(f.store, 'PMT-31').rounds_used;
  const fx = await runFix({ cwd: f.root, env: f.env, ticket: 'PMT-31', nextToken: mintLaunchToken, launchOptions: watch(claude), testRun: passing });
  assert.equal(fx.outcome, 'handed-over', fx.why);
  assert.equal(readLoop(f.store, 'PMT-31').rounds_used, usedBefore + 1, 'the fix round counts');
  const after = JSON.parse(readFileSync(buildRecordPath(f.store, 'PMT-31'), 'utf8'));
  assert.equal(after.review_from.trace, record.round);
  // Rex again, then the gate with every test: the proofs carry the trace, signed.
  const rv = await runReview({ cwd: f.root, env: f.env, ticket: 'PMT-31', launchToken: mintLaunchToken(), launchOptions: watch(claude) });
  assert.equal(rv.outcome, 'pass', rv.why);
  const ok = await f.record();
  assert.equal(ok.outcome, 'recorded', ok.why);
  const gate = JSON.parse(readFileSync(join(f.root, ok.written.find((p) => p.includes('/gate-'))), 'utf8'));
  assert.deepEqual(gate.trace, { result: 'pass', scope: 'ticket', links: 6, qa: 'not built yet' });
  assert.equal(f.check().outcome, 'pass');
  // Changing the trace in the signed proof breaks its signature.
  const name = ok.written.find((p) => p.includes('/gate-'));
  writeFileSync(join(f.root, name), proofText({ ...gate, trace: { ...gate.trace, links: 7 } }));
  f.git('commit', '-qam', 'edit the trace');
  assert.equal(f.check().outcome, 'bad-record');
});

launchTest('43 T6: after its rounds, a failing trace parks the ticket with the trace result as the reason', async () => {
  const f = await passed();
  const caps = trustedConfig(snapshot(f.io)).loop ?? {};
  for (let i = 0; i < (caps.rounds ?? 2); i++) assert.equal(beforeLaunch(f.store, 'PMT-31', { round: true }).go, true);
  const r = await f.record({ run: only31 });
  assert.equal(r.outcome, 'parked');
  const s = readTicketStatus(f.store, 'PMT-31').status;
  assert.deepEqual([s.state, s.park_reason], ['blocked', 'cap']);
  assert.match(s.note, /Its rounds are used up\. its 2 rounds are used; trace: AC-PMT-31\.2 has no passing test named with its ID/);
  assert.deepEqual(proofsIn(f), []);
  // The gate's CLI says what happened, through the terminal.
  const g = await passed();
  const out = await tty(['gate', 'record', 'PMT-31'], g.io);
  assert.equal(out.code, EXIT.OK, out.err);
  assert.match(out.out, /trace: pass, 6 links \(qa: not built yet\)/);
});

// The proofs re-signed with your key with another trace (and minting time), committed: what CI and
// the gate check see.
function resign(f, written, change) {
  const signer = loadSigner(f.env, f.store);
  for (const p of written) {
    const proof = JSON.parse(readFileSync(join(f.root, p), 'utf8'));
    const { signature: _s, ...body } = proof;
    writeFileSync(join(f.root, p), proofText(signProof({ ...body, ...change }, signer, { repoId: f.store.repoId })));
  }
  f.git('commit', '-qam', 'proofs re-signed');
}

launchTest('43 T7: the gate check accepts a proof only with a trace result of pass; "n/a" before the cut-off is accepted and named, after it refused', async () => {
  const f = await passed();
  const r = await f.record();
  assert.equal(r.outcome, 'recorded', r.why);
  resign(f, r.written, { trace: { result: 'fail', scope: 'ticket', links: 0, qa: 'not built yet' } });
  const fail = f.check();
  assert.equal(fail.outcome, 'no-trace');
  assert.match(fail.trace.why, /its trace result is fail, not pass/);
  resign(f, r.written, { trace: 'n/a', minted_at: '2026-11-20T10:00:00.000Z' }); // before any cut-off: 43 was built on 2026-11-25
  const old = f.check();
  assert.equal(old.outcome, 'pass');
  assert.equal(old.trace.old, true);
  const cli = await tty(['gate', 'check', 'PMT-31'], f.io);
  assert.equal(cli.code, EXIT.OK);
  const day = TRACE_CUTOFF.slice(0, 10);
  assert.ok(cli.out.includes(`trace: n/a, accepted: minted before ${day}, when mirai trace was built`), cli.out);
  resign(f, r.written, { trace: 'n/a', minted_at: new Date(Date.parse(TRACE_CUTOFF) + 86_400_000).toISOString() });
  assert.equal(f.check().outcome, 'no-trace');
  const after = await tty(['gate', 'check', 'PMT-31'], f.io);
  assert.equal(after.code, EXIT.FAILURE);
  assert.ok(after.out.includes(`its trace is "n/a", which only a proof minted before ${day}`), after.out);
  // A proof with no trace at all isn't a proof: MIRAI won't sign one, and a check refuses it.
  const one = JSON.parse(readFileSync(join(f.root, r.written[1]), 'utf8'));
  assert.equal(proofProblem({ ...one, trace: undefined }), 'no trace');
  writeFileSync(join(f.root, r.written[1]), proofText({ ...one, trace: undefined }));
  f.git('commit', '-qam', 'no trace');
  assert.equal(f.check().outcome, 'bad-record');
  assert.match(TRACE_CUTOFF, /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/, 'a day, at midnight UTC');
  assert.deepEqual(traceAccepted({ trace: { result: 'pass' } }), { ok: true });
});

// A kept, signed gate result of the ticket's branch head with its cases.json, as `mirai gate record`
// leaves it in the store (src/tests/run.js), for the CLI and the tool, which read the kept ones.
function keepGateResult(f, { name, cases, id }) {
  const head = f.git('rev-parse', 'HEAD');
  const branch = f.git('rev-parse', '--abbrev-ref', 'HEAD');
  const dir = join(f.store.dir, 'tests', id);
  mkdirSync(dir, { recursive: true });
  const text = `${JSON.stringify({ schema_version: 1, cases })}\n`;
  writeFileSync(join(dir, 'cases.json'), text);
  const result = { schema_version: 1, id, name, kind: 'level', outcome: 'pass', by: 'you', cases_sha256: createHash('sha256').update(text).digest('hex'), gate: { branch, head } };
  mkdirSync(join(f.store.dir, 'tests', 'gate'), { recursive: true });
  writeFileSync(join(f.store.dir, 'tests', 'gate', `${id}.json`), `${JSON.stringify(signObject(result, loadSigner(f.env, f.store), { context: resultContext(f.store.repoId) }), null, 2)}\n`);
}
const listing = (dir) => readdirSync(dir, { recursive: true }).sort().map((p) => {
  const st = statSync(join(dir, p));
  return `${p} ${st.size} ${st.mtimeMs}`;
});

launchTest('43 T8: trace(item) is a read-only broker tool in every launch; it returns the trace as data and changes nothing', async () => {
  const f = await passed();
  const trust = snapshot(f.io);
  const registry = trustedRegistry(trust);
  const config = trustedConfig(trust);
  for (const mode of ['read-write', 'read-only']) {
    const t = strictTemplate({ registry, config, mode });
    assert.deepEqual(mcpPolicyTools(t).trace, {}, mode);
    assert.ok(mcpTools(t).includes('mcp__mirai__trace'), mode);
  }
  const policy = { kind: 'headless', checkout: f.root, home: f.home, store: { dir: f.store.dir, repo_id: f.store.repoId }, tools: { trace: {} } };
  const tool = toolNamed(policy, 'trace');
  assert.ok(tool);
  for (const bad of [{}, { item: '../outside' }, { item: '/etc/passwd' }, { item: 'a;touch /tmp/x' }, { item: 'PMT-31', paths: ['.env'] }]) assert.ok(checkArgs(policy, tool, bad).refused, JSON.stringify(bad));
  keepGateResult(f, { name: 'unit', cases: CASES.unit, id: 't-20261125-120000-aaaaaa' });
  keepGateResult(f, { name: 'feature', cases: CASES.feature.filter((c) => c.id.includes('AC-PMT-31.1')), id: 't-20261125-120001-bbbbbb' });
  const tree = f.git('status', '--porcelain');
  const storeBefore = listing(f.store.dir);
  const { args } = checkArgs(policy, tool, { item: 'PMT-31' });
  const r = await tool.run(args, { policy, trust, env: f.env, clean: (s) => s });
  assert.equal(r.isError, false);
  assert.deepEqual([r.body.outcome, r.body.scope, r.body.item, r.body.gate_run, r.body.qa], ['fail', 'ticket', 'PMT-31', true, 'not built yet']);
  assert.deepEqual(r.body.missing.map((m) => m.id), ['AC-PMT-31.2', 'AC-PMT-31.2', 'AC-PMT-31.2']);
  assert.ok(r.body.links.some((l) => l.from === 'AC-PMT-31.1' && l.state === 'pass'));
  assert.equal(f.git('status', '--porcelain'), tree, 'the work tree is unchanged');
  assert.deepEqual(listing(f.store.dir), storeBefore, 'the store is unchanged');
  // The CLI reads the same kept results.
  const cli = await tty(['trace', 'PMT-31'], f.io);
  assert.equal(cli.code, EXIT.FAILURE);
  assert.match(cli.out, /^trace PMT-31 \(the code\): fail\n/);
  assert.match(cli.out, /ok {7}AC-PMT-31\.1 → tests\/Unit\/RenameTeamTest\.php::AC-PMT-31\.1: renaming keeps the team's name and slug rules \(unit\)/);
});

// P2's sequence under `mirai run`'s one lock (P2 at e8cf212 stopped on "this process already holds
// …/run.lock"): the run's proofs step with a failing trace sends the ticket to Kai's fix round, then
// Rex, then the gate records the proofs with trace pass, and the run ships. Stand-ins: claude, the
// test runs, the host. Every step here runs inside the run, so a lock taken twice would throw.
launchTest('43 (P2 at e8cf212): under mirai run\'s lock, a failing trace at the proofs step goes to Kai\'s fix round, then Rex, then the proofs with trace pass, then the MR', async () => {
  const f = await passed();
  let gate = 0;
  const steps = {
    ...STEPS,
    probeUsage: async () => ({ outcome: 'ok' }),
    recordBaseline: async () => ({ baseline: { complete: true }, reused: true }),
    runFix: (o) => runFix({ ...o, testRun: passing }),
    recordProofs: (o) => recordProofs({ ...o, run: (gate++ === 0 ? only31 : passing) }),
    writeRunReport: async () => ({}),
    shipTicket: async ({ cwd, env, ticket }) => {
      const store = openStore({ cwd, env });
      const branch = JSON.parse(readFileSync(buildRecordPath(store, ticket), 'utf8')).branch;
      const head = commitOf(store.checkout, `refs/heads/${branch}`, store.gitEnv);
      appendEvent(store, { type: 'pushed', by: 'script', ticket, branch, sha: head, proofs: 'pass' });
      appendEvent(store, { type: 'mr_opened', by: 'script', ticket, head, target: 'main', number: 7, url: 'https://github.com/acme/app/pull/7' });
      return { ticket, outcome: 'opened', mr: { number: 7, url: 'https://github.com/acme/app/pull/7' }, head, pushed: true, branch };
    },
  };
  const claude = claudeWith([done, { verdict: 'pass', findings: [] }], ['printf "// AC-PMT-31.2 tests named\\n" >> app/Team.php']);
  const r = await driveTicket({ cwd: f.root, env: f.env, ticket: 'PMT-31', steps, launchOptions: watch(claude), caffeinate: () => ({ stop: () => {}, note: null }) });
  assert.equal(r.outcome, 'finished', JSON.stringify(r.stop));
  assert.deepEqual(r.steps.map((x) => [x.step, x.outcome]), [['proofs', 'trace-failed'], ['fix', 'handed-over'], ['review', 'pass'], ['proofs', 'recorded'], ['ship', 'opened']]);
  assert.equal(r.mr, 'https://github.com/acme/app/pull/7');
  assert.equal(readTraceRecord(f.store, 'PMT-31').missing[0].id, 'AC-PMT-31.2');
  const branch = JSON.parse(readFileSync(buildRecordPath(f.store, 'PMT-31'), 'utf8')).branch;
  assert.equal(f.check(f.git('rev-parse', branch)).outcome, 'pass');
});

// P2 from where the probe starts (its run at 167278b: a hand commit after Kai's hand-over isn't a
// green step, and Rex's review rightly refuses it). The probe now takes AC-PMT-31.2 out inside Kai's
// build, through a stand-in claude (the probe's takeOutWrapper) that runs his launch and then edits
// the tree his launch left, before MIRAI's checks and commit; from there every step is MIRAI's own,
// under `mirai run`'s one lock. Stand-ins: claude, the test runs (they report the tree's PHPUnit
// methods, as the real report does), the host.
const FEATURE = (ids) => `<?php\nclass TeamRenameTest extends TestCase\n{\n${ids.map((m) => `    public function ${m}(): void {}\n`).join('')}}\n`;
const WRITE_BUILD = [
  'printf "// renamed\\n" >> app/Team.php',
  `printf '%s' '${FEATURE(['test_ac_pmt_31_1_keeps_the_name_and_slug_rules'])}' > tests/Unit/RenameTeamTest.php`,
  `printf '%s' '${FEATURE(['test_ac_pmt_31_1_a_renamed_team_still_lists_its_members', 'test_ac_pmt_31_2_an_old_slug_redirects', 'test_ac_pmt_31_2_two_renames_both_redirect'])}' > tests/Feature/TeamRenameTest.php`,
].join('\n');
// Kai's fix round names the tests with AC-PMT-31.2 again (the probe's stand-in edits only once).
const WRITE_FIX = `printf '%s' '${FEATURE(['test_ac_pmt_31_1_a_renamed_team_still_lists_its_members', 'test_ac_pmt_31_2_an_old_slug_redirects', 'test_ac_pmt_31_2_two_renames_both_redirect'])}' > tests/Feature/TeamRenameTest.php\nprintf "// named\\n" >> app/Team.php`;
const treeRun = async ({ name, cwd }) => {
  const dir = name === 'unit' ? 'tests/Unit' : 'tests/Feature';
  const cases = [];
  for (const file of readDir(join(cwd, dir)).filter((n) => n.endsWith('.php'))) {
    for (const m of readFileSync(join(cwd, dir, file), 'utf8').matchAll(/function (test_[A-Za-z0-9_]+)\(/g)) cases.push({ id: `${dir}/${file}::${m[1]}`, outcome: 'pass' });
  }
  return { outcome: 'pass', id: `t-${name}`, tests: { total: cases.length, passed: cases.length, failed: 0, errors: 0, skipped: 0 }, ...casesFolder(cases) };
};

launchTest('43 (P2 at 167278b): from P2\'s start (AC-PMT-31.2 taken out inside Kai\'s build, before MIRAI\'s checks): trace stops the ship, Kai\'s fix names the test again, Rex, the proofs with trace pass, the MR', async () => {
  const f = await approvedTicket();
  const io = f.io;
  const p = await runPlan({ cwd: f.root, env: f.env, ticket: 'PMT-31', launchTokens: [mintLaunchToken(), mintLaunchToken()], launchOptions: watch(claudeWith([{ plan: PLAN_TEXT }])) });
  assert.equal(p.outcome, 'waiting');
  assert.equal((await tty(['approve', 'PMT-31', '--plan'], io, ['a', 'PMT-31'])).code, EXIT.OK);
  const store = openStore(io);
  writeBaseline(store, { schema_version: 1, sha: snapshot(io).baseSha, levels: { unit: { ...PASSED, tests: { total: 1, skipped: 0 } }, feature: PASSED } }, loadSigner(f.env, store));
  const kai = claudeWith([done, { verdict: 'pass', findings: [] }, done, { verdict: 'pass', findings: [] }], [WRITE_BUILD, ':', WRITE_FIX, ':']);
  const wrapper = takeOutWrapper({ dir: realpathSync(mkdtempSync(join(tmpdir(), 'mirai-43-p2-'))), real: kai.path, root: f.root, id: 'AC-PMT-31.2' });
  const steps = {
    ...STEPS,
    probeUsage: async () => ({ outcome: 'ok' }),
    recordBaseline: async () => ({ baseline: { complete: true }, reused: true }),
    runBuild: (o) => STEPS.runBuild({ ...o, testRun: treeRun }),
    runFix: (o) => runFix({ ...o, testRun: treeRun }),
    recordProofs: (o) => recordProofs({ ...o, run: treeRun }),
    writeRunReport: async () => ({}),
    shipTicket: async ({ cwd, env, ticket }) => {
      const s2 = openStore({ cwd, env });
      const branch = JSON.parse(readFileSync(buildRecordPath(s2, ticket), 'utf8')).branch;
      const head = commitOf(s2.checkout, `refs/heads/${branch}`, s2.gitEnv);
      appendEvent(s2, { type: 'pushed', by: 'script', ticket, branch, sha: head, proofs: 'pass' });
      appendEvent(s2, { type: 'mr_opened', by: 'script', ticket, head, target: 'main', number: 8, url: 'https://github.com/acme/app/pull/8' });
      return { ticket, outcome: 'opened', mr: { number: 8, url: 'https://github.com/acme/app/pull/8' }, head, pushed: true, branch };
    },
  };
  const r = await driveTicket({ cwd: f.root, env: f.env, ticket: 'PMT-31', steps, launchOptions: { ...watch(kai), claude: wrapper.path }, caffeinate: () => ({ stop: () => {}, note: null }) });
  assert.equal(r.outcome, 'finished', JSON.stringify(r.stop));
  assert.deepEqual(r.steps.map((x) => [x.step, x.outcome]), [['build', 'handed-over'], ['review', 'pass'], ['proofs', 'trace-failed'], ['fix', 'handed-over'], ['review', 'pass'], ['proofs', 'recorded'], ['ship', 'opened']]);
  // The edit was made once, inside Kai's build, to the files that named the AC.
  assert.equal(readFileSync(wrapper.done, 'utf8').trim(), 'tests/Feature/TeamRenameTest.php');
  const record = readTraceRecord(store, 'PMT-31');
  assert.ok(record.missing.length && record.missing.every((m) => m.id === 'AC-PMT-31.2'), JSON.stringify(record.missing));
  const branch = JSON.parse(readFileSync(buildRecordPath(store, 'PMT-31'), 'utf8')).branch;
  assert.match(f.git('log', '--format=%s', `main..${branch}`), /PMT-31: proofs/);
  const head = f.git('rev-parse', branch);
  const gate = JSON.parse(f.git('show', `${head}:${f.git('ls-tree', '-r', '--name-only', head, '.mirai/records/PMT-31').split('\n').find((x) => x.includes('/gate-'))}`));
  assert.equal(gate.trace.result, 'pass');
});
