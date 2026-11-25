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
import { snapshot, trustedConfig, trustedRegistry } from '../../src/trust/snapshot.js';
import { needsTest } from '../helpers/needs.js';
import { CASES, casesFolder, claudeWith, done, passed, passing, tty, watch } from './fixture.js';

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
