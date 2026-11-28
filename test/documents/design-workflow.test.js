import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';

import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { appendEvent, readJournal } from '../../src/store/journal.js';
import { approvalGaps } from '../../src/store/connectors/state.js';
import { designSetProblems, designSubject, hardAdrsOpen, notesPending, runDesign } from '../../src/design/run.js';
import { decisionsForYou, designNotesNotSigned } from '../../src/design/sitting.js';
import { changedIds, ticketImpact } from '../../src/design/impact.js';
import { changeLines } from '../../src/design/state.js';
import { interviewAsBound } from '../../src/design/hard.js';
import { designChangePending, tessSubject } from '../../src/tess/run.js';
import { parseDocument } from '../../src/lint/lint.js';
import { FAKE_TOKEN, passReader } from '../helpers/reader.js';
import { passVera, veraBefore } from '../helpers/vera.js';
import { BRIEF_READY, INTERVIEW, PRD_READY, tty } from '../helpers/docs-fixtures.js';
import { installed } from '../tests/run-fixture.js';

// Unit 65: the design workflow. No model runs: stand-in launchers write the registry's examples.

const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const D = 'docs/mirai/due-dates';
const HLD = read('examples/hld.md');
const LLD = read('examples/lld.md');
const ADR_HARD = read('examples/adr.md');
const ADR = ADR_HARD.replace('gate: [hard-to-reverse, nfr]', 'gate: [nfr]');
const ADR_PATH = 'docs/decisions/ADR-0001-reminder-queue.md';
const SAMPLE = join(REGISTRY_DIR, '..', 'test', 'fixtures', 'sample-app');
const CITED = ['backend/app/Http/Controllers/TaskController.php', 'backend/app/Policies/TaskPolicy.php', 'backend/database/migrations/2026_10_23_100000_create_tasks_table.php', 'frontend/src/components/TaskList.tsx', 'backend/app/Models/Task.php', 'backend/routes/api.php', 'frontend/src/api.ts'];
const PREFIX = '\n[tickets]\nkey_prefix = "SAMPLE"\n';
const put = (f, rel, text) => {
  mkdirSync(join(f.root, rel, '..'), { recursive: true });
  writeFileSync(join(f.root, rel), text);
};
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.split(from).join(to);
};

// The repo with the brief, interview and PRD on `track`, your key; approved unless `approve` is false.
async function fixture({ track = 'full', approve = true } = {}) {
  const brief = BRIEF_READY.replace(/^track: standard$/m, `track: ${track}`).replace('Track: standard, because this changes one app and needs no new service.', track === 'full' ? 'Track: full, because reminders add a queue worker beside the app.' : `Track: ${track}, because this changes one app and needs no new service.`);
  const files = { [`${D}/brief.md`]: brief, [`${D}/interview.md`]: INTERVIEW, [`${D}/prd.md`]: PRD_READY.replace('track: standard', `track: ${track}`) };
  for (const p of CITED) files[p] = readFileSync(join(SAMPLE, p), 'utf8');
  const f = installed({ config: PREFIX, files });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  mkdirSync(join(f.home, '.config', 'mirai'), { recursive: true });
  writeFileSync(join(f.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Test Author"\nauthor_email = "author@example.com"\n', { mode: 0o600 });
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  writeToken(f.env, FAKE_TOKEN);
  const io = { cwd: f.root, env: f.env };
  const g = { ...f, io, store: openStore(io) };
  if (approve) await approveUpstream(g, track);
  return g;
}
async function approveUpstream(f, track, answers = ['a', 'due-dates-prd', 'n']) {
  if (track === 'full') {
    await passReader(f, `${D}/brief.md`);
    const b = await tty(['approve', 'due-dates-brief', '--file', `${D}/brief.md`], f.io, ['a', 'due-dates-brief']);
    assert.equal(b.code, 0, b.err);
  }
  await passReader(f, `${D}/prd.md`);
  return tty(['approve', 'due-dates-prd', '--file', `${D}/prd.md`], f.io, answers);
}
async function run(f, argv, answers, extra = {}) {
  veraBefore(argv, f.io);
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: f.env, cwd: f.root, ...extra });
  return { code, out, err };
}

const result = (o = {}) => ({ outcome: 'written', summary: 'Wrote the design.', template_gaps: [], adrs: [], ...o });
function fakes(steps) {
  const calls = [];
  const launch = async (o) => {
    calls.push(o);
    const structured = steps[Math.min(calls.length - 1, steps.length - 1)](o);
    return { outcome: 'ok', why: null, launchId: `2026112720000${calls.length}-0123abcd`, structured, line: { model: 'claude-opus-5-5', tier: 'deep' } };
  };
  const vera = async () => ({ outcome: 'ok', why: null, launchId: '20261127210001-0123abcd', structured: { findings: [] }, line: { model: 'claude-sonnet-5-5', tier: 'standard' } });
  return { launch, vera, calls };
}
async function arlo(f, steps, o = {}) {
  const k = fakes(steps);
  const r = await runDesign({ cwd: f.root, env: f.env, initiative: 'due-dates', nextToken: () => mintLaunchToken(), launch: k.launch, verifyLaunch: k.vera, ...o });
  return { r, calls: k.calls };
}
const writeSet = (adr = ADR, hld = HLD) => (o) => {
  const step = JSON.parse(o.inputs['index.json']).arlo.document;
  if (step === 'hld') {
    put(o.f, `${D}/hld.md`, hld);
    put(o.f, ADR_PATH, adr);
  } else put(o.f, `${D}/lld.md`, LLD);
  return result();
};
const bound = (f, fn) => (o) => fn({ ...o, f });

// ---- T1 ------------------------------------------------------------------------------------------

test('65 T1: the offer after the PRD\'s approval: on full, Arlo on the design; on standard with no note, Arlo on the note; y starts his run', async () => {
  const full = await fixture({ approve: false });
  const calls = [];
  const r = await approveUpstream(full, 'full', ['a', 'due-dates-prd', 'n']);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /Start Arlo \(mirai-architect\) on the design now\? \[y\/N\] /);
  const std = await fixture({ track: 'standard', approve: false });
  await passReader(std, `${D}/prd.md`);
  const no = await tty(['approve', 'due-dates-prd', '--file', `${D}/prd.md`], std.io, ['a', 'due-dates-prd', 'n']);
  assert.match(no.out, /Start Arlo \(mirai-architect\) on the technical note now\? \[y\/N\] \nnot started; when you're ready: mirai design due-dates \(\/mirai design due-dates in your session\)/);
  assert.doesNotMatch(no.out, /Start Tess/);
  // y starts his run (a stand-in here).
  const again = await run(std, ['approve', 'due-dates-prd', '--file', `${D}/prd.md`], ['a', 'due-dates-prd', 'y'], { startArlo: async (i) => { calls.push(i); return EXIT.OK; } });
  assert.equal(again.code, EXIT.OK, again.err);
  assert.deepEqual(calls, ['due-dates']);
});

// ---- T2 ------------------------------------------------------------------------------------------

test('65 T2: the early pause: a hard-to-reverse ADR waits for your pick, asked in interview.md, before the LLD; answered, his run continues; no pause without one', async () => {
  const f = await fixture();
  f.git('switch', '-q', '-c', 'design-due-dates');
  const first = await arlo(f, [bound(f, writeSet(ADR_HARD))]);
  assert.equal(first.r.state, 'paused', first.r.why);
  assert.equal(first.calls.length, 1, 'no LLD before your pick');
  const i = readFileSync(join(f.root, D, 'interview.md'), 'utf8');
  assert.match(i, /^state: paused$/m);
  assert.match(i, /### Q-8: Send due-date reminders from a queue worker \(ADR-0001, hard to reverse\)/);
  assert.match(i, /- B: A queue worker, one job per email/);
  assert.match(i, /Guess: B, because it is the option the architect's ADR chose/);
  const line = readJournal(f.store).events.filter((e) => e.type === 'design_run').at(-1);
  assert.deepEqual([line.state, line.hard, line.question_id], ['paused', true, 'Q-8']);
  // You answer and confirm: the PRD doesn't need to take it (the answer settles the ADR).
  writeFileSync(join(f.root, D, 'interview.md'), i.replace('state: paused', 'state: confirmed').replace(/(### Q-8:[^]*?Answer:)\n/, '$1 B.\n'));
  f.git('commit', '-qam', 'answered Q-8');
  // The brief's approval binds the interview without MIRAI's own design question (P2's finding).
  assert.equal(interviewAsBound(readFileSync(join(f.root, D, 'interview.md')), readJournal(f.store).events, 'due-dates').toString('utf8'), INTERVIEW);
  assert.deepEqual(hardAdrsOpen(designSubject({ cwd: f.root, env: f.env, initiative: 'due-dates' })), []);
  const second = await arlo(f, [bound(f, (o) => { assert.equal(JSON.parse(o.inputs['index.json']).arlo.step, 'continue'); return result(); }), bound(f, writeSet())]);
  assert.equal(second.r.state, 'done', second.r.why);
  assert.deepEqual(second.r.written, ['hld', 'lld']);
});

// ---- T3 ------------------------------------------------------------------------------------------

test('65 T3: the set check: an ADR no D-n links, a component no requirement uses, an LLD FR the HLD doesn\'t trace: each found', async () => {
  const f = await fixture();
  f.git('switch', '-q', '-c', 'design-due-dates');
  put(f, `${D}/hld.md`, HLD);
  put(f, ADR_PATH, ADR);
  put(f, `${D}/lld.md`, LLD);
  f.git('add', '-A');
  f.git('commit', '-qm', 'the set');
  const s = designSubject({ cwd: f.root, env: f.env, initiative: 'due-dates' });
  assert.deepEqual(designSetProblems(s), []);
  put(f, 'docs/decisions/ADR-0002-orphan.md', ADR.replace('id: ADR-0001', 'id: ADR-0002').replace('# Send due-date reminders from a queue worker', '# An orphan decision'));
  put(f, `${D}/lld.md`, swap(LLD, 'overdue list (FR-2)', 'overdue list (FR-2, FR-77)'));
  const hldDoc = parseDocument(HLD, 'hld.md');
  const component = hldDoc.scan.lines.find((l) => /^\| The reminder worker \|/.test(l.text));
  assert.ok(component);
  put(f, `${D}/hld.md`, HLD.replace(/^(\| (?:FR|NFR)-[0-9]+ \|) The reminder worker \|/gm, '$1 The task API |'));
  const reasons = designSetProblems(s).map((p) => p.reason).join('\n');
  assert.match(reasons, /ADR-0002 \(docs\/decisions\/ADR-0002-orphan\.md\) is proposed for this initiative, but no D-n line in Decisions links it/);
  assert.match(reasons, /the component "The reminder worker" carries no requirement in the trace table: an orphan/);
  assert.match(reasons, /the LLD's Scope cites FR-77, which the HLD's trace table gives no component/);
  // The judgement part is Vera's: the set checklist reaches her HLD and LLD checks (verify.test's pins).
  assert.match(read('templates/design-set-checklist.md'), /\[vera\] Construct two units of work that each obey every decision/);
});

// ---- T4 ------------------------------------------------------------------------------------------

async function setReady() {
  const f = await fixture();
  f.git('switch', '-q', '-c', 'design-due-dates');
  put(f, `${D}/hld.md`, HLD);
  put(f, ADR_PATH, ADR);
  put(f, `${D}/lld.md`, LLD);
  f.git('add', '-A');
  f.git('commit', '-qm', 'the design set');
  await passReader(f, `${D}/hld.md`);
  veraBefore(['approve', 'ADR-0001', '--file', ADR_PATH], f.io);
  veraBefore(['approve', 'due-dates-lld', '--file', `${D}/lld.md`], f.io);
  return f;
}

test('65 T4: the sitting: every answer as written → one signature for the HLD, its ADR and the LLD, your answers logged, Tess offered', async () => {
  const f = await setReady();
  assert.equal(decisionsForYou(parseDocument(HLD, 'hld.md')).length, 1);
  const r = await run(f, ['approve', 'due-dates-hld', '--file', `${D}/hld.md`], ['', '', 'a', 'due-dates-hld', 'n']);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /^LLD: {4}due-dates-lld, signed with the set$/m);
  assert.match(r.out, /Decision 1: How do reminder emails get sent \(ADR-0001\)\?/);
  assert.match(r.out, /approved: the LLD due-dates-lld, with the set/);
  const ev = readJournal(f.store).events;
  const approvals = ev.filter((e) => e.type === 'approval' && ['hld', 'adr', 'lld'].includes(e.kind));
  assert.deepEqual(approvals.map((e) => e.kind), ['hld', 'adr', 'lld']);
  assert.equal(new Set(approvals.map((e) => e.seq)).size, 3);
  assert.deepEqual(ev.filter((e) => e.type === 'design_decision').map((e) => [e.ref, e.decision, e.answer ?? null]), [['Decision 1', 'answer', 'A'], ['ADR-0001', 'accept', null]]);
  assert.match(readFileSync(join(f.root, ADR_PATH), 'utf8'), /^status: accepted$/m);
  assert.match(r.out, /Start Tess \(mirai-ticket-planner\) on the ticket set now\? \[y\/N\]/);
});

test('65 T4: an answer that differs, or an ADR rejected: nothing approved, your answers signed, design-notes.md written; his next run takes them; the docs merge checks each line', async () => {
  const f = await setReady();
  const r = await run(f, ['approve', 'due-dates-hld', '--file', `${D}/hld.md`], ['B', 'n', 'a nightly run is enough for a team this small', 'due-dates-hld']);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /nothing was approved: 2 of your answers differ from the set as written/);
  const ev = readJournal(f.store).events;
  assert.equal(ev.filter((e) => e.type === 'approval' && ['hld', 'adr', 'lld'].includes(e.kind)).length, 0);
  const notes = readFileSync(join(f.root, D, 'design-notes.md'), 'utf8');
  assert.match(notes, /^- Decision 1 \(answer, \d{4}-\d{2}-\d{2}\): B, where the HLD is written for A\.$/m);
  assert.match(notes, /^- ADR-0001 \(reject, \d{4}-\d{2}-\d{2}\): a nightly run is enough for a team this small$/m);
  assert.deepEqual(designNotesNotSigned(notes, ev), []);
  assert.equal(designNotesNotSigned(`${notes}- Decision 9 (answer, 2026-11-27): C, where the HLD is written for A.\n`, ev).length, 1);
  assert.deepEqual(approvalGaps({ store: f.store, docs: [{ rel: `${D}/design-notes.md`, bytes: Buffer.from(notes) }], events: ev }).filter((g) => /note/.test(g.gap)), []);
  f.git('add', '-A');
  f.git('commit', '-qm', 'design notes');
  const s = designSubject({ cwd: f.root, env: f.env, initiative: 'due-dates' });
  assert.equal(notesPending(s), true);
  const next = await arlo(f, [bound(f, (o) => {
    const idx = JSON.parse(o.inputs['index.json']).arlo;
    assert.equal(idx.step, 'notes');
    assert.ok(o.inputs['design-notes.md']);
    return result();
  })]);
  assert.equal(next.calls.length, 1);
});

// ---- T5 ------------------------------------------------------------------------------------------

test('65 T5: a change after approval: a superseding ADR, the HLD and LLD amended with a changelog line, the delta review, the impact (an unbuilt ticket re-cut by Tess, a built one flagged)', async () => {
  // The impact, alone.
  const ids = changedIds({ before: { hld: '- D-1: a\n- D-2: b\n', lld: '| C-1 | x |\n| S-1 | y |\n' }, after: { hld: '- D-1: a\n- D-2: changed\n', lld: '| C-1 | x |\n| S-1 | z |\n' }, superseded: ['ADR-0001'] });
  assert.deepEqual(ids, { decisions: ['D-2'], items: ['S-1'], adrs: ['ADR-0001'] });
  const impact = ticketImpact({ tickets: [{ id: 'SAMPLE-51', value: { uses: ['S-1'] } }, { id: 'SAMPLE-52', value: { governed_by: ['ADR-0001'] } }, { id: 'SAMPLE-53', value: { uses: ['C-1'] } }], ids, merged: new Set(['SAMPLE-52']) });
  assert.deepEqual(impact, { unbuilt: [{ id: 'SAMPLE-51', cites: ['S-1'] }], built: [{ id: 'SAMPLE-52', cites: ['ADR-0001'] }] });
  // The run: the set approved, then a change.
  const f = await setReady();
  const ok = await run(f, ['approve', 'due-dates-hld', '--file', `${D}/hld.md`], ['', '', 'a', 'due-dates-hld', 'n']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  const t = (key, extra) => read('examples/tickets/SAMPLE-51.md').replaceAll('SAMPLE-51', key).replace(/^governed_by: \[\]\n/m, '').replace(/^type: story$/m, `type: story\n${extra}`);
  put(f, `${D}/tickets/SAMPLE-51.md`, t('SAMPLE-51', 'uses: [S-1]'));
  put(f, `${D}/tickets/SAMPLE-52.md`, t('SAMPLE-52', 'governed_by: [ADR-0001]'));
  f.git('add', '-A');
  f.git('commit', '-qm', 'tickets');
  appendEvent(f.store, { type: 'mr_merged', by: 'script', ticket: 'SAMPLE-52', target: 'integration' });
  const newAdr = ADR.replace('id: ADR-0001', 'id: ADR-0002\nsupersedes: ADR-0001').replace('# Send due-date reminders from a queue worker', '# Send due-date reminders from one nightly command');
  const { r, calls } = await arlo(f, [bound(f, (o) => {
    assert.equal(JSON.parse(o.inputs['index.json']).arlo.step, 'change');
    assert.match(o.inputs['change.md'], /one nightly command/);
    put(o.f, 'docs/decisions/ADR-0002-nightly-command.md', newAdr);
    put(o.f, `${D}/hld.md`, swap(HLD, '(../../decisions/ADR-0001-reminder-queue.md)', '(../../decisions/ADR-0002-nightly-command.md)').replace('lld: required', 'changelog: ["2026-11-27: reminders from one nightly command (ADR-0002)"]\nlld: required'));
    put(o.f, `${D}/lld.md`, LLD.replace('| S-1 | `tasks.due_date` | date |', '| S-1 | `tasks.due_date` | date (not null for new tasks) |'));
    return result({ adrs: ['docs/decisions/ADR-0002-nightly-command.md'] });
  })], { change: 'Send the reminders from one nightly command instead of a queue worker.' });
  assert.equal(r.state, 'done', r.why);
  assert.equal(calls.length, 1);
  assert.deepEqual(r.impact.ids.adrs, ['ADR-0001']);
  assert.ok(r.impact.ids.items.includes('S-1'));
  assert.deepEqual(r.impact.unbuilt.map((x) => x.id), ['SAMPLE-51']);
  assert.deepEqual(r.impact.built.map((x) => x.id), ['SAMPLE-52']);
  const ev = readJournal(f.store).events;
  assert.match(changeLines(ev, 'due-dates').join('\n'), /built already, for you to decide: SAMPLE-52/);
  // Tess waits for the changed set's sitting; then her next run takes the change as her notes.
  assert.throws(() => tessSubject({ cwd: f.root, env: f.env, initiative: 'due-dates' }), (e) => e.code === 'input-not-approved' && /the HLD due-dates-hld isn't approved as it is now/.test(e.message));
  assert.deepEqual(designChangePending({ initiative: 'due-dates', store: f.store })?.unbuilt, ['SAMPLE-51']);
});

// ---- T6 ------------------------------------------------------------------------------------------

test('65 T6: the docs name the workflow (34b\'s check runs in test/docs)', () => {
  const docs = readFileSync(join(REGISTRY_DIR, '..', 'docs', 'design.md'), 'utf8');
  for (const s of ['## The workflow', 'hard to reverse', 'design-notes.md', '--change', 'changelog', 'the impact']) assert.ok(docs.includes(s), s);
  assert.ok(existsSync(join(REGISTRY_DIR, 'document-types', 'design-notes.toml')));
});
