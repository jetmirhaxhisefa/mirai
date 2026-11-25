import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRegistry } from '../../src/config/registry.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { lintText } from '../../src/lint/lint.js';
import { readJunit } from '../../src/tests/junit.js';
import { overlap } from '../../src/lint/ids.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { runTess } from '../../src/tess/run.js';
import { traceDocuments } from '../../src/trace/documents.js';
import { QA_NEEDED, namedIds, traceTicket } from '../../src/trace/ticket.js';
import { checkCommand, COMMANDS } from '../../src/mcp/tools/commands.js';
import { MIRAI_COMMAND } from '../../src/adapters/claude-code.js';
import { BRIEF_READY, INTERVIEW, PRD_READY, tty } from '../helpers/docs-fixtures.js';
import { FAKE_TOKEN, passReader } from '../helpers/reader.js';
import { installed } from '../tests/run-fixture.js';
import { P3_TICKET, REMOVED, p3Auto, setHome, setTrace, shipVerdict, takeOutTest, twoAcs } from '../probes/trace-probes.js';

// Unit 43: `mirai trace`, the documents' scope and the code's, as pure functions and through the
// CLI, Tess's run and the epic's approval. No model runs. The ship-time half (the gate, the fix
// loop, the proofs, the broker tool) is in test/proofs/trace.test.js, on 25a's fixture.

const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const D = 'docs/mirai/due-dates';
const EPIC = read('examples/epic.md');
const TICKETS = Object.fromEntries(readdirSync(join(REGISTRY_DIR, 'examples', 'tickets')).sort().map((f) => [`tickets/${f}`, read(`examples/tickets/${f}`)]));
const JOURNEYS = read('examples/context/journeys.md');
const PREFIX = '\n[tickets]\nkey_prefix = "SAMPLE"\n';
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.replace(from, to);
};
const docs = ({ brief = BRIEF_READY, prd = PRD_READY, epic = EPIC, tickets = TICKETS, interview = INTERVIEW } = {}) => ({
  initiative: 'due-dates', registry: REGISTRY,
  brief: brief && { path: `${D}/brief.md`, text: brief }, prd: prd && { path: `${D}/prd.md`, text: prd }, epic: epic && { path: `${D}/epic-due-dates.md`, text: epic },
  interview: interview && { path: `${D}/interview.md`, text: interview },
  tickets: Object.entries(tickets).map(([p, text]) => ({ path: `${D}/${p}`, text })),
});
// A brief with a fourth BR, which no FR cites.
const BRIEF_BR4 = swap(BRIEF_READY, '- BR-3: A lead can see every overdue task of their team at once. Source: the November 2026 lead interviews.\n', '- BR-3: A lead can see every overdue task of their team at once. Source: the November 2026 lead interviews.\n- BR-4: A lead gets a weekly summary of the team\'s overdue tasks. Source: the November 2026 lead interviews.\n');
// SAMPLE-53 without AC-FR-4.5 in its covers_ac.
const NO_45 = { ...TICKETS, 'tickets/SAMPLE-53.md': swap(TICKETS['tickets/SAMPLE-53.md'], 'AC-FR-4.4, AC-FR-4.5,', 'AC-FR-4.4,') };

async function fixture({ files = {}, approve = true } = {}) {
  const f = installed({ config: PREFIX, files: { [`${D}/brief.md`]: BRIEF_READY, [`${D}/interview.md`]: INTERVIEW, [`${D}/prd.md`]: PRD_READY, '.mirai/context/journeys.md': JOURNEYS, ...files } });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  mkdirSync(join(f.home, '.config', 'mirai'), { recursive: true });
  writeFileSync(join(f.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Test Author"\nauthor_email = "author@example.com"\n', { mode: 0o600 });
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  writeToken(f.env, FAKE_TOKEN);
  const io = { cwd: f.root, env: f.env };
  if (approve) {
    await passReader({ ...f, io }, `${D}/prd.md`);
    const ok = await tty(['approve', 'due-dates-prd', '--file', `${D}/prd.md`], io, ['a', 'due-dates-prd']);
    assert.equal(ok.code, 0, ok.err);
  }
  f.git('switch', '-q', '-c', 'tickets-due-dates');
  return { ...f, io, store: openStore(io) };
}
const put = (f, rel, text) => {
  mkdirSync(join(f.root, rel, '..'), { recursive: true });
  writeFileSync(join(f.root, rel), text);
};
const cli = async (f, argv) => tty(argv, f.io);

// ---- T1 The documents -------------------------------------------------------------------------

test('43 T1: the documents: a BR no FR cites and an AC no ticket covers are named with their files; fixed, it passes', () => {
  const ok = traceDocuments(docs());
  assert.equal(ok.result, 'pass', JSON.stringify(ok.missing));
  assert.ok(ok.links.some((l) => l.from === 'BR-2' && l.to === 'FR-3, FR-4, FR-7, FR-8' && l.state === 'pass'));
  assert.ok(ok.links.some((l) => l.from === 'AC-FR-4.5' && l.to === 'SAMPLE-53'));
  const bad = traceDocuments(docs({ brief: BRIEF_BR4, tickets: NO_45 }));
  assert.equal(bad.result, 'fail');
  assert.deepEqual(bad.missing.map((m) => [m.id, m.kind, m.where]), [
    ['BR-4', 'br', `${D}/prd.md`],
    ['AC-FR-4.5', 'coverage', `${D}/tickets/ (add it to the covers_ac of the ticket that builds it)`],
  ]);
  assert.match(bad.missing[0].what, /the brief's BR-4 isn't cited by any FR or NFR/);
  assert.match(bad.missing[1].what, /AC-FR-4\.5 isn't covered by any ticket/);
  // 62–65 and 62b aren't built: no-ops, said as such.
  assert.deepEqual(ok.notes, ['no ADRs yet: their "Confirmation" checks are traced once ADRs exist (units 62–65)', 'no technical note yet: the FR → component links are traced once it exists (unit 62b)']);
});

test('43 T1: mirai approve <epic-id> refuses while the documents\' trace fails, naming each link; mirai trace and mirai show say the same', async () => {
  const files = Object.fromEntries([[`${D}/epic-due-dates.md`, EPIC], ['e2e/tests/smoke.spec.ts', '// the smoke test\n'], ...Object.entries(TICKETS).map(([p, t]) => [`${D}/${p}`, t])]);
  const f = await fixture({ files });
  const t0 = await cli(f, ['trace', 'due-dates']);
  assert.equal(t0.code, EXIT.OK, t0.err);
  assert.match(t0.out, /^trace due-dates \(the documents\): pass\n/);
  assert.match(t0.out, /ok {7}AC-FR-4\.5 → SAMPLE-53/);
  // The brief gains BR-4 after the PRD's approval: the epic's own lint is clean, the trace isn't.
  put(f, `${D}/brief.md`, BRIEF_BR4);
  f.git('commit', '-qam', 'brief: BR-4');
  await passReader(f, `${D}/epic-due-dates.md`);
  const refused = await tty(['approve', 'SAMPLE-50', '--file', `${D}/epic-due-dates.md`], f.io, ['a', 'SAMPLE-50']);
  assert.equal(refused.code, EXIT.BLOCKED, refused.out);
  assert.match(refused.err, /trace: the brief's BR-4 isn't cited by any FR or NFR \(docs\/mirai\/due-dates\/prd\.md\)/);
  assert.match(refused.err, /mirai trace finds 1 missing link, listed above; nothing was written/);
  assert.equal(readFileSync(join(f.root, '.mirai/context/journeys.md'), 'utf8'), JOURNEYS);
  const t1 = await cli(f, ['trace', 'due-dates']);
  assert.equal(t1.code, EXIT.FAILURE);
  assert.match(t1.out, /missing {2}the brief's BR-4 isn't cited by any FR or NFR \(fix in: docs\/mirai\/due-dates\/prd\.md\)/);
  const show = await cli(f, ['show', 'due-dates']);
  assert.match(show.out, /trace: 1 missing link, such as "the brief's BR-4 isn't cited by any FR or NFR": mirai trace due-dates/);
  // Fixed (BR-4 gone again): the set is approved.
  put(f, `${D}/brief.md`, BRIEF_READY);
  f.git('commit', '-qam', 'brief: back');
  const ok = await tty(['approve', 'SAMPLE-50', '--file', `${D}/epic-due-dates.md`], f.io, ['a', 'SAMPLE-50']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.match(ok.out, /approved: the epic SAMPLE-50 and its 7 tickets/);
});

// ---- The re-check against 42 (2026-11-25) --------------------------------------------------------

test('43 (re-check, Q1 "A"): trace runs inside Tess\'s run with the lint: a missing link goes to her next launch in lint.json, and the fixed set is done', async () => {
  const f = await fixture();
  const calls = [];
  const write = (tickets) => {
    put(f, `${D}/epic-due-dates.md`, EPIC);
    for (const [p, t] of Object.entries(tickets)) put(f, `${D}/${p}`, t);
    return { outcome: 'written', summary: 'The set.', template_gaps: [], documents: [] };
  };
  const steps = [() => write(NO_45), () => write(TICKETS)];
  const launch = async (o) => {
    calls.push(o);
    return { outcome: 'ok', why: null, launchId: `2026112510000${calls.length}-0123abcd`, structured: steps[calls.length - 1](o), line: { model: 'claude-sonnet-5-5', tier: 'standard' } };
  };
  const vera = async (o) => ({ outcome: 'ok', why: null, launchId: '20261125110001-0123abcd', structured: { findings: [] }, line: { model: 'claude-sonnet-5-5', tier: 'standard' }, inputs: o.inputs });
  const events = [];
  const r = await runTess({ cwd: f.root, env: f.env, initiative: 'due-dates', nextToken: () => mintLaunchToken(), launch, verifyLaunch: vera, onStep: (e) => events.push(e) });
  assert.equal(r.state, 'done', r.why);
  assert.equal(calls.length, 2);
  const lint = JSON.parse(calls[1].inputs['lint.json']);
  // The epic's graph lint also finds it; trace's entry stands for it, with where to fix it.
  assert.deepEqual(lint.problems.map((p) => [p.code, p.file]), [['trace-coverage', `${D}/tickets/ (add it to the covers_ac of the ticket that builds it)`]]);
  assert.match(lint.problems[0].reason, /AC-FR-4\.5 isn't covered by any ticket/);
  assert.deepEqual(events.filter((e) => e.kind === 'lint').map((e) => [e.errors, e.trace, e.missing]), [[1, 'fail', 1], [0, 'pass', 0]]);
});

test('43 (re-check): NFRs reach tickets through covers_fr; trace keys on covers_fr and covers_ac, as the coverage check does', () => {
  const without = { ...TICKETS, 'tickets/SAMPLE-53.md': swap(swap(TICKETS['tickets/SAMPLE-53.md'], 'covers_fr: [FR-4, NFR-2]', 'covers_fr: [FR-4]'), ', AC-NFR-2.1]', ']') };
  const t = traceDocuments(docs({ tickets: without }));
  assert.deepEqual(t.missing.map((m) => m.id), ['NFR-2', 'AC-NFR-2.1']);
  const byFr = { ...TICKETS, 'tickets/SAMPLE-53.md': swap(TICKETS['tickets/SAMPLE-53.md'], ', AC-NFR-2.1]', ']') };
  const u = traceDocuments(docs({ tickets: byFr }));
  assert.ok(u.links.some((l) => l.from === 'NFR-2' && l.to === 'SAMPLE-53' && l.state === 'pass'), 'NFR-2 through covers_fr');
  assert.deepEqual(u.missing.map((m) => m.id), ['AC-NFR-2.1']);
  // An NFR's verification method: NFR-1 is measured, NFR-2 is verified by its own AC.
  assert.ok(u.links.some((l) => l.from === 'NFR-1' && /^verified by: a measurement/.test(l.to)));
  assert.ok(u.links.some((l) => l.from === 'NFR-2' && l.to === 'verified by its ACs (AC-NFR-2.1)'));
});

test('43 (re-check): a lone ticket\'s interview folder has no documents\' scope; an investigation has no code scope; trace keys on runs_as, never the type\'s name', async () => {
  const lone = { path: 'docs/mirai/log-format/interview.md', text: INTERVIEW.replace(/^type: interview$/m, 'type: interview\nfor: ticket') };
  const t = traceDocuments({ initiative: 'log-format', registry: REGISTRY, interview: lone });
  assert.equal(t.result, 'n/a');
  assert.match(t.why, /log-format is a lone ticket's interview folder: it has no PRD, so the documents' scope doesn't apply; trace its ticket instead: mirai trace <KEY>/);
  const inv = read('examples/investigation.md');
  const i = traceTicket({ ticket: { fm: { id: 'PMT-14', type: 'investigation', ticket_type: 'Investigation' }, text: inv } });
  assert.deepEqual([i.result, i.runs_as], ['n/a', 'investigation']);
  assert.match(i.why, /PMT-14 is an investigation: research and a written finding, with no code merge, so it has no tests to trace/);
  // A project's "Spike" written as a story still runs as an investigation; a "Chore" that runs as a
  // change is traced, whatever its name.
  const config = { tickets: { types: [{ name: 'Spike', description: 'x', runs_as: 'investigation' }, { name: 'Chore', description: 'y', runs_as: 'change' }] } };
  const story = { fm: { id: 'SAMPLE-9', type: 'story', ticket_type: 'Spike' }, text: '- AC-SAMPLE-9.1: Given a, when b, then c\n' };
  assert.equal(traceTicket({ ticket: story, config }).result, 'n/a');
  assert.equal(traceTicket({ ticket: { ...story, fm: { ...story.fm, ticket_type: 'Chore' } }, config }).result, 'fail');
  // The CLI says so and exits 0 for the lone folder.
  const f = await fixture({ approve: false, files: { 'docs/mirai/log-format/interview.md': lone.text } });
  const r = await cli(f, ['trace', 'log-format']);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /trace log-format \(the documents\): n\/a: log-format is a lone ticket's interview folder/);
});

// ---- T2, T4, T5 The code (pure) -------------------------------------------------------------------

const TICKET = (fm = {}, extra = '') => {
  const t = TICKETS['tickets/SAMPLE-53.md'].replace('e2e: true\n', '');
  return { path: `${D}/tickets/SAMPLE-53.md`, fm: { id: 'SAMPLE-53', type: 'story', ticket_type: 'Story', ...fm }, text: `${t}${extra}` };
};
const pass = (name, id = `tests/Feature/RemindersTest.php::${name}`) => ({ level: 'feature', id, name, outcome: 'pass' });
const ALL = [1, 2, 3, 4, 5].map((n) => pass(`AC-SAMPLE-53.${n}: case ${n}`));

test('43 T2: a ticket AC counts only with a passing test whose name starts with its ID; a list covers each; a failed or a trailing ID doesn\'t', () => {
  assert.equal(traceTicket({ ticket: TICKET(), cases: ALL }).result, 'pass');
  const cases = [pass('AC-SAMPLE-53.1: one email per assignee'), pass('AC-SAMPLE-53.4, AC-SAMPLE-53.5: done tasks are left out'), pass('retries once (AC-SAMPLE-53.2)'), { ...pass('AC-SAMPLE-53.2: a day is sent once'), outcome: 'fail' }, pass('AC-SAMPLE-53.3: a moved date is reminded again')];
  const t = traceTicket({ ticket: TICKET(), cases });
  assert.equal(t.result, 'fail');
  assert.deepEqual(t.missing.map((m) => [m.id, m.where]), [['AC-SAMPLE-53.2', 'plan.md, Test list']]);
  assert.match(t.missing[0].what, /AC-SAMPLE-53\.2 has no passing test: tests\/Feature\/RemindersTest\.php::AC-SAMPLE-53\.2: a day is sent once failed in the gate's run/);
  assert.deepEqual(t.links.filter((l) => l.state === 'pass').map((l) => l.from), ['AC-SAMPLE-53.1', 'AC-SAMPLE-53.3', 'AC-SAMPLE-53.4', 'AC-SAMPLE-53.5']);
  const none = traceTicket({ ticket: TICKET(), cases: cases.filter((c) => !/53\.2: a day/.test(c.name)) });
  assert.match(none.missing[0].what, /AC-SAMPLE-53\.2 has no passing test named with its ID in the gate's run; and no QA evidence/);
  // How names are read: the leading list, also after a runner's describe prefix.
  assert.deepEqual(namedIds('AC-53.2, AC-53.3: retried'), ['AC-53.2', 'AC-53.3']);
  assert.deepEqual(namedIds('Reminders › AC-53.2: retried'), ['AC-53.2']);
  assert.deepEqual(namedIds('J-1, AC-53.1: end to end'), ['J-1', 'AC-53.1']);
  assert.deepEqual(namedIds('retried (AC-53.2)'), []);
});

test('43 T2: the plan\'s test list: each row is a test in the results, named with its AC and passing; one missing or renamed is a missing link', () => {
  const plan = `---\nid: SAMPLE-53-plan\ntype: plan\nticket: SAMPLE-53\nacs: [AC-SAMPLE-53.1]\nrisk: high\ntdd: auto\ntests: required\nround: 1\n---\n## Test list\n\n| Test | Test ID | Symbol | AC | Level | Kind |\n|---|---|---|---|---|---|\n| one email | \`tests/Feature/RemindersTest.php::AC-SAMPLE-53.1: case 1\` | \`X\` | AC-SAMPLE-53.1 | feature | red |\n| sent once | \`tests/Feature/RemindersTest.php::sends once\` | \`X\` | AC-SAMPLE-53.2 | feature | red |\n| no-test row | | | AC-SAMPLE-53.3 | | |\n`;
  const t = traceTicket({ ticket: TICKET(), cases: ALL, plan });
  assert.deepEqual(t.missing.map((m) => [m.id, m.kind, m.where]), [['AC-SAMPLE-53.2', 'plan', 'plan.md, Test list, line 16']]);
  assert.match(t.missing[0].what, /the plan's test "sent once" \(tests\/Feature\/RemindersTest\.php::sends once, for AC-SAMPLE-53\.2\) isn't in the gate's results: missing, or renamed/);
  const named = traceTicket({ ticket: TICKET(), cases: [...ALL, pass('sends once')], plan });
  assert.match(named.missing[0].what, /doesn't start its name with its AC \(AC-SAMPLE-53\.2\): name it "AC-SAMPLE-53\.2: …"/);
});

test('43 T4: an e2e ticket with AC tests but no test carrying its journey fails; with one, it passes', () => {
  const e2e = { ...TICKET({ e2e: true }) };
  const t = traceTicket({ ticket: e2e, cases: ALL, journeys: JOURNEYS });
  assert.deepEqual(t.missing.map((m) => [m.id, m.kind]), [['SAMPLE-53 (e2e)', 'e2e']]);
  assert.match(t.missing[0].what, /SAMPLE-53 is e2e: true, but no passing test is named with its journey \(one of J-1, J-2\) and an AC ID, such as "J-1, AC-SAMPLE-53\.1: …"/);
  const ok = traceTicket({ ticket: e2e, cases: [...ALL, pass('J-1, AC-SAMPLE-53.1: the reminder end to end', 'e2e/tests/reminder.spec.ts::J-1, AC-SAMPLE-53.1: the reminder end to end')], journeys: JOURNEYS });
  assert.equal(ok.result, 'pass', JSON.stringify(ok.missing));
  // A ticket that names its journey needs that one.
  const named = { ...TICKET({ e2e: true }, '\nThe journey: J-2.\n') };
  assert.equal(traceTicket({ ticket: named, cases: [...ALL, pass('J-1, AC-SAMPLE-53.1: x')], journeys: JOURNEYS }).result, 'fail');
  assert.equal(traceTicket({ ticket: named, cases: [...ALL, pass('J-2, AC-SAMPLE-53.1: x')], journeys: JOURNEYS }).result, 'pass');
});

test('43 T5: before unit 50, a tests: optional ticket fails with "QA evidence is needed; QA isn\'t built yet (unit 50)", never for a missing test', () => {
  const t = traceTicket({ ticket: TICKET({ tests: 'optional' }), cases: [] });
  assert.equal(t.result, 'fail');
  assert.equal(t.missing.length, 5);
  assert.ok(t.missing.every((m) => m.kind === 'qa' && m.what.endsWith(QA_NEEDED)), JSON.stringify(t.missing));
  assert.equal(QA_NEEDED, 'QA evidence is needed; QA isn\'t built yet (unit 50)');
  assert.equal(t.qa, 'not built yet');
  assert.ok(!t.missing.some((m) => /passing test/.test(m.what)), 'not flagged for a missing test');
});

test('43 (P1\'s finding): PHPUnit names a test by its method in its JUnit report, never by its TestDox text: test_ac_sample_1_1_… counts for AC-SAMPLE-1.1 (a real report from P1)', () => {
  const xml = readFileSync(join(REGISTRY_DIR, '..', 'test', 'fixtures', 'junit', 'phpunit-trace-p1.xml'));
  const r = readJunit(xml, { file: 'file' });
  assert.equal(r.report, 'ok');
  // As src/tests/results.js maps them: the project's path, then ::<the case's name>.
  const cases = r.cases.map((c) => ({ level: 'feature', id: `${c.file.replace('/var/www/html/', 'backend/')}::${c.name}`, file: c.file.replace('/var/www/html/', 'backend/'), name: c.name, outcome: c.outcome }));
  assert.deepEqual(cases.map((c) => c.name), ['test_ac_sample_1_1_deleting_your_own_task_removes_it', 'test_ac_sample_1_2_another_users_task_cannot_be_deleted']);
  const ticket = { path: 'docs/mirai/tickets/SAMPLE-1.md', fm: { id: 'SAMPLE-1', type: 'story' }, text: '## Acceptance criteria\n\n- AC-SAMPLE-1.1: deleting your own task removes it\n- AC-SAMPLE-1.2: another user\'s task can\'t be deleted\n' };
  // Kai's plan as P1 had it: the Test IDs written with the TestDox text.
  const plan = '---\nid: SAMPLE-1-plan\ntype: plan\nticket: SAMPLE-1\nacs: [AC-SAMPLE-1.1, AC-SAMPLE-1.2]\nrisk: normal\ntdd: auto\ntests: required\nround: 1\n---\n## Test list\n\n| Test | Test ID | Symbol | AC | Level | Kind |\n|---|---|---|---|---|---|\n| one | `backend/tests/Feature/TaskDeleteAcTest.php::AC-SAMPLE-1.1: deleting your own task removes it` | `X` | AC-SAMPLE-1.1 | feature | red |\n| two | `backend/tests/Feature/TaskDeleteAcTest.php::AC-SAMPLE-1.2: another user\'s task can\'t be deleted` | `X` | AC-SAMPLE-1.2 | feature | red |\n';
  const t = traceTicket({ ticket, plan, cases });
  assert.equal(t.result, 'pass', JSON.stringify(t.missing));
  assert.deepEqual(t.links.filter((l) => /^AC-/.test(l.from)).map((l) => [l.from, l.to]), [['AC-SAMPLE-1.1', cases[0].id], ['AC-SAMPLE-1.2', cases[1].id]]);
  // The method's IDs: only the ticket's own (and its plan's), with a boundary after each.
  const ids = ['AC-SAMPLE-1.1', 'AC-SAMPLE-1.2', 'AC-SAMPLE-1.12', 'J-1'];
  assert.deepEqual(namedIds('test_ac_sample_1_12_x', ids), ['AC-SAMPLE-1.12']);
  assert.deepEqual(namedIds('test_ac_sample_1_1_and_ac_sample_1_2_both', ids), ['AC-SAMPLE-1.1', 'AC-SAMPLE-1.2']);
  assert.deepEqual(namedIds('test_j_1_ac_sample_1_1_end_to_end', ids), ['J-1', 'AC-SAMPLE-1.1']);
  assert.deepEqual(namedIds('ac_sample_1_2', ids), ['AC-SAMPLE-1.2'], 'a #[Test] method needs no test_ prefix');
  assert.deepEqual(namedIds('test_deleting_ac_sample_1_1', ids), [], 'the ID comes first');
  assert.deepEqual(namedIds('testAcSample11Deleting', ids), [], 'camel case is ambiguous: snake case only');
  assert.deepEqual(namedIds('test_ac_sample_1_1_x'), [], 'no candidates, no method names');
  // A method that names no AC doesn't count, and a failed one doesn't either.
  assert.equal(traceTicket({ ticket, cases: [{ ...cases[0], name: 'test_deleting_your_own_task', id: 'x::test_deleting_your_own_task' }, cases[1]] }).result, 'fail');
  assert.equal(traceTicket({ ticket, cases: [{ ...cases[0], outcome: 'fail' }, cases[1]] }).result, 'fail');
});

// ---- T9 ID stability --------------------------------------------------------------------------

test('43 T9: ID stability: an approved PRD\'s FR-4 removed and a different FR-4 added in the next version fails the lint; a rewording doesn\'t', () => {
  const lint = (text, previous) => lintText(text, { source: `${D}/prd.md`, registry: REGISTRY, project: { repos: ['.'] }, approving: false, previous }).filter((p) => p.code === 'id-stability');
  const fr4 = '- FR-4: When a day ends, the system must email each assignee once, listing their tasks due next day that aren\'t done. (BR-2)';
  const other = swap(PRD_READY, fr4, '- FR-4: When a lead opens the team page, the system must show a weekly chart of finished work per member. (BR-2)');
  const p = lint(other, PRD_READY);
  assert.equal(p.length, 1);
  assert.match(p[0].reason, /^FR-4 meant "When a day ends, the system must email each assignee once, listing their tasks due next day that aren't done\." in the version you approved; it now says "When a lead opens the team page/);
  assert.match(p[0].hint, /keep FR-4 for what it meant .* give the new item its own new ID/);
  const reworded = swap(PRD_READY, fr4, '- FR-4: When a day ends, the system must email each assignee one time, listing the tasks due the next day that are not done. (BR-2)');
  assert.deepEqual(lint(reworded, PRD_READY), []);
  assert.deepEqual(lint(other, null), [], 'without an approved version, nothing to compare');
  assert.ok(overlap('the reminder email is sent', 'a weekly chart is shown') < 1 / 3);
  // A ticket's key and its own ACs too.
  const t = TICKETS['tickets/SAMPLE-53.md'];
  const changed = swap(t, '- AC-SAMPLE-53.2: A day is sent once', '- AC-SAMPLE-53.2: The admin page lists every failed email');
  const tp = lintText(changed, { source: `${D}/tickets/SAMPLE-53.md`, registry: REGISTRY, project: { repos: ['.'] }, previous: t }).filter((x) => x.code === 'id-stability');
  assert.deepEqual(tp.map((x) => x.reason.slice(0, 14)), ['AC-SAMPLE-53.2']);
  // Its CHECK_READS entry: the sections that define IDs.
  assert.ok(REGISTRY.documentTypes.prd.lint_checks.includes('id-stability'));
  assert.ok(REGISTRY.documentTypes.story.lint_checks.includes('id-stability'));
});

// ---- The registry (the 37 re-check) and the session list ---------------------------------------

test('43 (37 re-check): trace reads the plan\'s test list; story and bug protect e2e, tests and tdd, read by trace (folded into v2)', () => {
  const plan = REGISTRY.documentTypes.plan.protected_sections.find((p) => p.name === 'Test list');
  assert.deepEqual(plan.read_by, ['lint', 'gate', 'trace']);
  for (const type of ['story', 'bug']) {
    const def = REGISTRY.documentTypes[type];
    assert.equal(def.template_version, 2);
    for (const name of ['e2e', 'tests', 'tdd']) assert.deepEqual(def.protected_fields.find((f) => f.name === name)?.read_by, ['trace', 'gate'], `${type}.${name}`);
  }
});

test('43 Scope 6: mirai trace is on the /mirai session list (21f), with the item as `ticket`', () => {
  assert.deepEqual(COMMANDS.trace.argv({ ticket: 'due-dates' }), ['trace', 'due-dates']);
  assert.equal(COMMANDS.trace.quick, true);
  assert.deepEqual(checkCommand({ command: 'trace', ticket: 'SAMPLE-53' }).args, { command: 'trace', ticket: 'SAMPLE-53' });
  assert.match(checkCommand({ command: 'trace', ticket: '../x' }).refused, /ticket/);
  assert.match(MIRAI_COMMAND, /for `trace`, the initiative's folder name or the ticket key, as `ticket`/);
});

// ---- The probes' tooling (no model) ------------------------------------------------------------

test('43 (probes): P3 --auto on a temp home: the probe key approves the PRD, the set\'s approval refuses naming AC-FR-4.5, trace says where; P1\'s ticket and P2\'s hand edit; nothing in src/ imports the probe', async () => {
  const workdir = realpathSync(mkdtempSync(join(tmpdir(), 'mirai-u43-p3-')));
  const home = await setHome({ workdir, token: FAKE_TOKEN });
  assert.deepEqual(setTrace(home).missing.map((m) => m.id), ['AC-FR-4.5']);
  const lines = [];
  assert.equal(await p3Auto(home, (l) => lines.push(l)), true, lines.join('\n'));
  assert.match(lines.join('\n'), /AUTO: approved due-dates-prd with the probe key/);
  assert.match(lines.join('\n'), /p3: PASS/);
  assert.throws(() => P3_TICKET('no such line'), /isn't the example/);
  // P1's ticket: SAMPLE-1 cut to two ACs.
  const three = '# T\n\n## Acceptance criteria\n\n- AC-SAMPLE-1.1: a\n  - Given x\n- AC-SAMPLE-1.2: b\n  - Given y\n- AC-SAMPLE-1.3: c\n  - Given z\n';
  assert.equal(twoAcs(three), '# T\n\n## Acceptance criteria\n\n- AC-SAMPLE-1.1: a\n  - Given x\n- AC-SAMPLE-1.2: b\n  - Given y\n');
  // P2's hand edit: the branch's test files lose AC-SAMPLE-1.2 from their test names.
  const rel = 'tests/Feature/DeleteTaskTest.php';
  assert.deepEqual(takeOutTest({ root: workdir, git: () => `${rel}\n` }), [], 'a file that isn\'t there is skipped');
  put({ root: workdir }, rel, "test('AC-SAMPLE-1.2: another user\\'s task stays')\n");
  put({ root: workdir }, 'app/x.php', 'AC-SAMPLE-1.2\n');
  assert.deepEqual(takeOutTest({ root: workdir, git: () => `${rel}\napp/x.php\n` }), [rel]);
  assert.equal(readFileSync(join(workdir, rel), 'utf8'), `test('${REMOVED}: another user\\'s task stays')\n`);
  assert.equal(readFileSync(join(workdir, 'app/x.php'), 'utf8'), 'AC-SAMPLE-1.2\n', 'not a test file');
  const importers = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? importers(join(dir, e.name)) : e.name.endsWith('.js') && /trace-probes/.test(readFileSync(join(dir, e.name), 'utf8')) ? [join(dir, e.name)] : []));
  assert.deepEqual(importers(join(REGISTRY_DIR, '..', 'src')), []);
});

test('43 (P1 and P2\'s first runs): the probe says PASS only when its pass line holds, else FAIL with why (and exits 1)', () => {
  const ok = { outcome: 'recorded', trace: { result: 'pass', links: [{ from: 'AC-SAMPLE-1.1', state: 'pass' }, { from: 'AC-SAMPLE-1.2', state: 'pass' }] } };
  const failed = { outcome: 'trace-failed', trace: { result: 'fail', missing: [{ id: 'AC-SAMPLE-1.2' }] } };
  assert.deepEqual(shipVerdict({ p2: false, gates: [ok], check: 'pass', mr: 'https://github.com/x/y/pull/9' }), { pass: true, why: null });
  assert.equal(shipVerdict({ p2: false, gates: [], check: 'nothing-to-prove', mr: null }).why, 'the ticket never reached the gate');
  assert.match(shipVerdict({ p2: false, gates: [ok], check: 'no-trace', mr: 'u' }).why, /gate check says no-trace/);
  assert.match(shipVerdict({ p2: false, gates: [ok], check: 'pass', mr: null }).why, /no PR/);
  assert.equal(shipVerdict({ p2: true, gates: [failed, ok], fixes: [{ outcome: 'handed-over' }], check: 'pass', mr: 'u' }).pass, true);
  assert.match(shipVerdict({ p2: true, gates: [{ outcome: 'review changes' }, ok], fixes: [{ outcome: 'handed-over' }], check: 'pass', mr: 'u' }).why, /not a trace failure naming AC-SAMPLE-1\.2/);
  assert.match(shipVerdict({ p2: true, gates: [failed], fixes: [], check: 'no-proof', mr: null }).why, /no fix round handed over/);
});
