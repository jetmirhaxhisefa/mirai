import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadRegistry } from '../../src/config/registry.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { gateFor } from '../../src/agent/plan.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { appendEvent, readJournal } from '../../src/store/journal.js';
import { lintText } from '../../src/lint/lint.js';
import { renderEpicFile } from '../../src/tess/render.js';
import { notesPending, runTess, tessInputs, tessSubject } from '../../src/tess/run.js';
import { DEFAULT_INPUTS, inputStates, inputsOf, missingLine, missingOf, notBuiltLine } from '../../src/tickets/inputs.js';
import { isQuickTicket } from '../../src/tickets/quick.js';
import { dependsOnDropped, releaseOf, ticketRows } from '../../src/tickets/set-screen.js';
import { BRIEF_READY, INTERVIEW, PRD_READY } from '../helpers/docs-fixtures.js';
import { FAKE_TOKEN, passReader } from '../helpers/reader.js';
import { veraBefore } from '../helpers/vera.js';
import { installed } from '../tests/run-fixture.js';

// Unit 45: from approved documents to an approved ticket set. No model runs: a fake stands in for
// the ticket planner's start, and Vera's pass is written before each approval (helpers/vera.js).

const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const D = 'docs/mirai/due-dates';
const EPIC = read('examples/epic.md');
const TICKETS = Object.fromEntries(readdirSync(join(REGISTRY_DIR, 'examples', 'tickets')).sort().map((f) => [`tickets/${f}`, read(`examples/tickets/${f}`)]));
const JOURNEYS = read('examples/context/journeys.md');
const PREFIX = '\n[tickets]\nkey_prefix = "SAMPLE"\n';
const APPROVE_PRD = ['approve', 'due-dates-prd', '--file', `${D}/prd.md`];
const APPROVE_EPIC = ['approve', 'SAMPLE-50', '--file', `${D}/epic-due-dates.md`];

// An installed repo with the brief, the interview and the PRD (and, with `set`, the epic and its
// tickets), your key and git name; on a feature branch unless `branch` is null.
function fixture({ config = PREFIX, set = false, extra = {}, branch = 'tickets-due-dates' } = {}) {
  const files = { [`${D}/brief.md`]: BRIEF_READY, [`${D}/interview.md`]: INTERVIEW, [`${D}/prd.md`]: PRD_READY, '.mirai/context/journeys.md': JOURNEYS };
  if (set) {
    files[`${D}/epic-due-dates.md`] = EPIC;
    for (const [p, t] of Object.entries(TICKETS)) files[`${D}/${p}`] = t;
  }
  for (const [p, t] of Object.entries(extra)) files[`${D}/${p}`] = t;
  const f = installed({ config, files });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  mkdirSync(join(f.home, '.config', 'mirai'), { recursive: true });
  writeFileSync(join(f.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Test Author"\nauthor_email = "author@example.com"\n', { mode: 0o600 });
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  writeToken(f.env, FAKE_TOKEN);
  if (branch) f.git('switch', '-q', '-c', branch);
  const io = { cwd: f.root, env: f.env };
  return { ...f, io, store: openStore(io), at: (rel) => join(f.root, D, rel) };
}

// `mirai …` in a terminal, with your answers; `startTess` stands in for her run.
async function run(f, argv, answers, { vera = true, startTess = null } = {}) {
  if (vera) veraBefore(argv, f.io);
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: f.env, cwd: f.root, ...(startTess ? { startTess } : {}) });
  return { code, out, err };
}
const approvePrd = async (f, answers, o = {}) => {
  await passReader(f, `${D}/prd.md`);
  return run(f, APPROVE_PRD, answers, o);
};
const approveSet = async (f, answers, o = {}) => {
  await passReader(f, `${D}/epic-due-dates.md`);
  return run(f, APPROVE_EPIC, answers, o);
};
const events = (f) => readJournal(f.store).events;
const starts = () => {
  const calls = [];
  return { calls, startTess: async (initiative) => { calls.push(initiative); return EXIT.OK; } };
};

// ---- T1 The offer ------------------------------------------------------------------------------

test('45 T1: approving the PRD on standard, with no technical-note type yet, asks to start Tess with the warning naming 62b; N starts nothing and prints the command; y starts her run', async () => {
  const f = fixture({ branch: null });
  const s = starts();
  const no = await approvePrd(f, ['a', 'due-dates-prd', 'n'], s);
  assert.equal(no.code, EXIT.OK, no.err);
  assert.match(no.out, /^tickets: not built yet, so not needed: no technical note yet \(unit 62b\)$/m);
  assert.match(no.out, /Start Tess \(mirai-ticket-planner\) on the ticket set now\? \[y\/N\] \nnot started; when you're ready: mirai tickets due-dates \(\/mirai tickets due-dates in your session\)\n/);
  assert.deepEqual(s.calls, []);
  // 38's rule holds: the documents' lines come last.
  assert.match(no.out.trimEnd().split('\n').at(-1), /docs\/mirai\/due-dates\/prd\.md$/);
  // The default is no: an empty answer, or the input closing, starts nothing.
  const empty = await approvePrd(f, ['a', 'due-dates-prd', ''], s);
  assert.equal(empty.code, EXIT.OK, empty.err);
  assert.deepEqual(s.calls, []);
  const closed = await approvePrd(f, ['a', 'due-dates-prd'], s);
  assert.equal(closed.code, EXIT.OK, closed.err);
  assert.deepEqual(s.calls, []);
  const yes = await approvePrd(f, ['a', 'due-dates-prd', 'y'], s);
  assert.equal(yes.code, EXIT.OK, yes.err);
  assert.deepEqual(s.calls, ['due-dates']);
  // A rejection never asks.
  const rejected = await approvePrd(f, ['r', 'not yet', 'due-dates-prd'], s);
  assert.equal(rejected.code, EXIT.OK, rejected.err);
  assert.doesNotMatch(rejected.out, /Start Tess/);
});

test('45 T1: each track\'s list: quick none, standard the PRD and the note, full the PRD, HLD, ADRs and LLD; a project only adds; types not built yet are skipped, each naming its unit', () => {
  assert.deepEqual(inputsOf({}, 'quick'), []);
  assert.deepEqual(inputsOf({}, 'standard'), ['prd', 'tech-note']);
  assert.deepEqual(inputsOf({}, 'full'), ['prd', 'hld', 'adr', 'lld']);
  assert.deepEqual(inputsOf({ tickets: { inputs: { standard: ['requirements', 'prd'] } } }, 'standard'), ['prd', 'tech-note', 'requirements']);
  assert.deepEqual(DEFAULT_INPUTS.full, ['prd', 'hld', 'adr', 'lld']);
  // On full with an approved PRD and no design types: the same offer, the warning naming each unit.
  const states = inputStates({ store: null, registry: { documentTypes: { prd: {} } }, config: {}, track: 'full', readDoc: () => null });
  assert.deepEqual(states.map((x) => [x.type, x.state]), [['prd', 'absent'], ['hld', 'no-type'], ['adr', 'no-type'], ['lld', 'no-type']]);
  assert.equal(notBuiltLine(states), 'not built yet, so not needed: no HLD yet (unit 62), no ADR yet (unit 61), no LLD yet (unit 63)');
  assert.deepEqual(missingOf(states).map(missingLine), ['the PRD isn\'t written yet']);
});

test('45 T1b: after Tess paused on the PRD, approving it again asks to continue her run, [Y/n], default yes', async () => {
  const f = fixture({ branch: null });
  const s = starts();
  assert.equal((await approvePrd(f, ['a', 'due-dates-prd', 'n'], s)).code, EXIT.OK);
  appendEvent(f.store, { type: 'tess_run', by: 'script', item: 'due-dates', run_id: 'r-20261126-100000-abcd', state: 'running', mode: 'set' });
  appendEvent(f.store, { type: 'tess_run', by: 'script', item: 'due-dates', run_id: 'r-20261126-100000-abcd', state: 'paused', mode: 'set', question_id: 'Q-8', question: 'Do reminders go to watchers too?' });
  const again = await approvePrd(f, ['a', 'due-dates-prd', ''], s);
  assert.equal(again.code, EXIT.OK, again.err);
  assert.match(again.out, /Tess \(mirai-ticket-planner\) paused on Q-8 for this; continue her run now\? \[Y\/n\] /);
  assert.deepEqual(s.calls, ['due-dates']);
  // n: not started, and the command to start her later.
  const no = await approvePrd(f, ['a', 'due-dates-prd', 'n'], s);
  assert.match(no.out, /not started; when you're ready: mirai tickets due-dates/);
  assert.deepEqual(s.calls, ['due-dates']);
});

// ---- T2 Required documents -----------------------------------------------------------------------

test('45 T2: a required document of an existing type that isn\'t approved as it is now refuses her run, naming it and its approval command; approved, it starts and is her input', async () => {
  // The project adds a type that is a source, never approved: refused while it isn't written.
  const absent = fixture({ config: `${PREFIX}[tickets.inputs]\nstandard = ["requirements"]\n`, branch: null });
  assert.equal((await approvePrd(absent, ['a', 'due-dates-prd', 'n'])).code, EXIT.OK);
  assert.match((await approvePrd(absent, ['a', 'due-dates-prd', 'n'])).out, /tickets: still needed before Tess \(mirai-ticket-planner\) cuts the set: the requirements isn't written yet/);
  absent.git('switch', '-q', '-c', 'tickets-due-dates');
  assert.throws(() => tessSubject({ cwd: absent.root, env: absent.env, initiative: 'due-dates' }), (e) => e.code === 'input-not-approved' && /the requirements isn't written yet, and the standard track cuts tickets from it too/.test(e.message));

  // The brief, approved with the PRD: her input; changed after it, she is refused, naming it.
  const f = fixture({ config: `${PREFIX}[tickets.inputs]\nstandard = ["brief"]\n`, branch: null });
  assert.equal((await approvePrd(f, ['a', 'due-dates-prd', 'n'])).code, EXIT.OK);
  f.git('switch', '-q', '-c', 'tickets-due-dates');
  const s = tessSubject({ cwd: f.root, env: f.env, initiative: 'due-dates' });
  assert.deepEqual(s.inputs.map((x) => [x.type, x.state]), [['prd', 'approved'], ['tech-note', 'no-type'], ['brief', 'approved']]);
  assert.equal(s.notBuilt, 'not built yet, so not needed: no technical note yet (unit 62b)');
  const index = JSON.parse(tessInputs(s, { step: 'write', round: 1 })['index.json']);
  assert.ok(index.files.some((x) => x.name === 'brief.md'));
  writeFileSync(f.at('brief.md'), `${BRIEF_READY}\nA line added after its approval.\n`);
  f.git('commit', '-qam', 'brief changed');
  assert.throws(() => tessSubject({ cwd: f.root, env: f.env, initiative: 'due-dates' }), (e) => e.code === 'input-not-approved' && /the brief due-dates-brief isn't approved as it is now/.test(e.message) && /mirai approve due-dates-brief --file docs\/mirai\/due-dates\/brief\.md/.test(e.message + e.hint));
});

// ---- T3 Drop -------------------------------------------------------------------------------------

// A set with an eighth ticket that covers what SAMPLE-52 covers, so dropping it leaves coverage as
// it was; the epic rendered for eight tickets.
function eightTickets() {
  const t52 = TICKETS['tickets/SAMPLE-52.md'];
  const t58 = t52.replaceAll('SAMPLE-52', 'SAMPLE-58').replace(/^order: \d+$/m, 'order: 8').replace(/^# .*$/m, '# A due date in the past is refused, again');
  const f = fixture({ set: true, extra: { 'tickets/SAMPLE-58.md': t58 }, branch: null });
  const r = renderEpicFile({ abs: f.at('epic-due-dates.md'), root: f.root, registry: REGISTRY });
  assert.ok(!r.problem, r.problem);
  f.git('add', '-A');
  f.git('commit', '-qm', 'eight');
  return f;
}
// Your keys, ticket by ticket in the screen's order (51, 53, 52, 54, 55, 56, 57, 58).
const ORDER = ['SAMPLE-51', 'SAMPLE-53', 'SAMPLE-52', 'SAMPLE-54', 'SAMPLE-55', 'SAMPLE-56', 'SAMPLE-57', 'SAMPLE-58'];
const keys = (picks) => ORDER.flatMap((k) => picks[k] ?? ['']);

test('45 T3: dropping a ticket with a reason removes its file, renders the epic, re-runs the lint and trace, and asks again; the signed set carries the drop and Vera\'s earlier result', async () => {
  const f = eightTickets();
  assert.equal((await approvePrd(f, ['a', 'due-dates-prd', 'n'])).code, EXIT.OK);
  // A drop without its reason is refused; nothing changes.
  const noReason = await approveSet(f, ['t', ...keys({ 'SAMPLE-58': ['d', ''] })]);
  assert.equal(noReason.code, EXIT.USAGE, noReason.err);
  assert.match(noReason.err, /a drop needs its reason; nothing was written/);
  assert.ok(existsSync(f.at('tickets/SAMPLE-58.md')));
  // A kept ticket that comes after the dropped one: refused, naming both.
  const after = await approveSet(f, ['t', ...keys({ 'SAMPLE-56': ['d', 'not needed'] }), '']);
  assert.equal(after.code, EXIT.BLOCKED, after.out);
  assert.match(after.err, /SAMPLE-57 comes after SAMPLE-56: dropping it would leave that ticket waiting on nothing; nothing was changed/);
  assert.ok(existsSync(f.at('tickets/SAMPLE-56.md')));
  // A drop that leaves an FR uncovered is shown before you can sign, and undone.
  const gap = await approveSet(f, ['t', ...keys({ 'SAMPLE-55': ['d', 'later'] }), '']);
  assert.equal(gap.code, EXIT.BLOCKED, gap.out);
  assert.match(gap.err, /FR-3|FR-8/);
  assert.match(gap.err, /the drop was undone: SAMPLE-55 is back, and the epic as it was/);
  assert.ok(existsSync(f.at('tickets/SAMPLE-55.md')));
  assert.equal(f.git('status', '--porcelain'), '');
  // A clean drop: the screen again with seven, then your signature.
  const ok = await approveSet(f, ['t', ...keys({ 'SAMPLE-58': ['d', 'a duplicate of SAMPLE-52'] }), '', 'a', 'SAMPLE-50']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.match(ok.out, /dropped on this screen: SAMPLE-58 \(MIRAI removed its file and rendered the epic again; lint clean, trace passes, coverage unchanged\)/);
  assert.match(ok.out, /approved: the epic SAMPLE-50 and its 7 tickets, as they are now \(accepted; signed with k-[0-9a-f]+, seq [0-9]+\)/);
  assert.match(ok.out, /^release: per-ticket, signed with the set; dropped: SAMPLE-58$/m);
  assert.equal(existsSync(f.at('tickets/SAMPLE-58.md')), false);
  assert.doesNotMatch(readFileSync(f.at('epic-due-dates.md'), 'utf8'), /SAMPLE-58/);
  const ev = events(f);
  const set = ev.filter((e) => e.type === 'approval' && e.kind === 'epic').at(-1);
  assert.deepEqual(set.dropped, ['SAMPLE-58']);
  assert.equal(set.files.length, 7);
  assert.equal(set.release_mode, 'per-ticket');
  assert.ok(set.verifier, 'Vera\'s result for the set before the drop');
  const d = ev.filter((e) => e.type === 'ticket_decision');
  assert.deepEqual(d.map((e) => [e.ticket, e.decision, e.reason, e.epic, e.round, e.by]), [['SAMPLE-58', 'drop', 'a duplicate of SAMPLE-52', 'SAMPLE-50', 1, 'human']]);
  assert.ok(d[0].signature);
  // mirai show lists it.
  const show = await run(f, ['show', 'due-dates'], [], { vera: false });
  assert.match(show.out, /your decision, round 1: SAMPLE-58 dropped: a duplicate of SAMPLE-52/);
});

test('45 T3: the screen\'s rows and the drop check, on their own', () => {
  const rows = ticketRows(Object.entries(TICKETS).map(([p, t]) => ({ path: `${D}/${p}`, bytes: Buffer.from(t), id: p.slice(8, -3) })));
  assert.deepEqual(rows.map((r) => r.key), ['SAMPLE-51', 'SAMPLE-53', 'SAMPLE-52', 'SAMPLE-54', 'SAMPLE-55', 'SAMPLE-56', 'SAMPLE-57']);
  assert.deepEqual(rows[0].blocks, ['SAMPLE-52', 'SAMPLE-53', 'SAMPLE-56']);
  assert.deepEqual(dependsOnDropped(rows, ['SAMPLE-51']).map((x) => x.kept).sort(), ['SAMPLE-52', 'SAMPLE-53', 'SAMPLE-56']);
  assert.deepEqual(dependsOnDropped(rows, ['SAMPLE-57']), []);
});

// ---- T4 Change -----------------------------------------------------------------------------------

test('45 T4: a split note writes ticket-notes.md, signs no set, logs ticket_decision, and her next run takes the notes as a new cycle', async () => {
  const f = fixture({ set: true, branch: null });
  assert.equal((await approvePrd(f, ['a', 'due-dates-prd', 'n'])).code, EXIT.OK);
  const before = events(f).filter((e) => e.type === 'approval' && e.kind === 'epic').length;
  const r = await approveSet(f, ['t', 'c', 's', 'Split the date picker from storing the date.', ...Array(6).fill(''), '', 'SAMPLE-50']);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /nothing was signed: 1 change logged \(signed with k-[0-9a-f]+\)/);
  assert.match(r.out, /next: Tess \(mirai-ticket-planner\) changes the set from your notes, .*: \/mirai tickets due-dates \(mirai tickets due-dates\)/);
  assert.equal(events(f).filter((e) => e.type === 'approval' && e.kind === 'epic').length, before);
  const notes = readFileSync(f.at('ticket-notes.md'), 'utf8');
  assert.match(notes, /^- SAMPLE-51 \(split, \d{4}-\d{2}-\d{2}\): Split the date picker from storing the date\.$/m);
  // T8: the notes lint clean as their own type.
  assert.deepEqual(lintText(notes, { source: `${D}/ticket-notes.md`, registry: REGISTRY, project: { repos: ['.'] } }).filter((p) => p.severity === 'error'), []);
  const d = events(f).filter((e) => e.type === 'ticket_decision');
  assert.deepEqual(d.map((e) => [e.ticket, e.decision, e.round]), [['SAMPLE-51', 'split', 1]]);
  // Her next run: the notes are an input, and the first launch's step is `notes`.
  f.git('add', '-A');
  f.git('commit', '-qm', 'notes');
  f.git('switch', '-q', '-c', 'tickets-due-dates');
  const s = tessSubject({ cwd: f.root, env: f.env, initiative: 'due-dates' });
  assert.ok(s.notes);
  assert.equal(notesPending(s), true);
  const calls = [];
  const launch = async (o) => {
    calls.push(o);
    return { outcome: 'ok', why: null, launchId: `2026112610000${calls.length}-0123abcd`, structured: { outcome: 'written', summary: 'Split SAMPLE-51.', template_gaps: [], documents: [] }, line: { model: 'claude-sonnet-5-5', tier: 'standard' } };
  };
  const vera = async () => ({ outcome: 'ok', why: null, launchId: '20261126110001-0123abcd', structured: { findings: [] }, line: { model: 'claude-sonnet-5-5', tier: 'standard' } });
  await runTess({ cwd: f.root, env: f.env, initiative: 'due-dates', nextToken: () => mintLaunchToken(), launch, verifyLaunch: vera });
  assert.ok(calls.length >= 1);
  const ix = JSON.parse(calls[0].inputs['index.json']);
  assert.equal(ix.tess.step, 'notes');
  assert.ok(ix.files.some((x) => x.name === 'ticket-notes.md'));
  assert.match(calls[0].prompt, /change the set as the owner's notes in ticket-notes\.md say/);
});

// ---- T5 Release mode -----------------------------------------------------------------------------

test('45 T5: Tess\'s release mode is shown with her reason; switching it asks a reason; the signed line carries it; mirai show lists it', async () => {
  const f = fixture({ set: true, branch: null });
  assert.equal(releaseOf(EPIC).mode, 'per-ticket');
  assert.match(releaseOf(EPIC).reason, /each ticket goes live on its own/);
  assert.equal((await approvePrd(f, ['a', 'due-dates-prd', 'n'])).code, EXIT.OK);
  // Switching with no reason is refused.
  const bare = await approveSet(f, ['t', ...Array(7).fill(''), 's', '']);
  assert.equal(bare.code, EXIT.USAGE);
  assert.match(bare.err, /switching the release mode needs its reason/);
  const r = await approveSet(f, ['t', ...Array(7).fill(''), 's', 'the old and new reminder jobs can\'t run side by side', 'a', 'SAMPLE-50']);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /^release: per-ticket \(Tess \(mirai-ticket-planner\): The release mode is `per-ticket`/m);
  assert.match(r.out, /^release: together \(you switched it from per-ticket: the old and new reminder jobs can't run side by side\)$/m);
  assert.match(r.out, /^release: together, signed with the set$/m);
  const set = events(f).filter((e) => e.type === 'approval' && e.kind === 'epic').at(-1);
  assert.deepEqual([set.release_mode, set.release_reason], ['together', 'the old and new reminder jobs can\'t run side by side']);
  const show = await run(f, ['show', 'due-dates'], [], { vera: false });
  assert.match(show.out, /release: together \(you switched it: the old and new reminder jobs can't run side by side\), signed with the set/);
  // Kept as Tess proposed it: the line carries her mode, no reason.
  const kept = await approveSet(f, ['a', 'SAMPLE-50']);
  assert.equal(kept.code, EXIT.OK, kept.err);
  const again = events(f).filter((e) => e.type === 'approval' && e.kind === 'epic').at(-1);
  assert.deepEqual([again.release_mode, again.release_reason], ['per-ticket', undefined]);
});

// ---- T7 Quick track ------------------------------------------------------------------------------

test('45 T7: the quick track: a lone ticket\'s plan gate is auto for normal risk and yours for high risk; an epic\'s ticket keeps the preset\'s gate', () => {
  const plan = (risk) => `---\nid: PMT-31-plan\ntype: plan\nrisk: ${risk}\n---\n# Plan\n`;
  const lone = [{ type: 'approval', by: 'human', kind: 'ticket', item: 'PMT-31', decision: 'accepted', path: 'docs/mirai/tickets/PMT-31.md' }];
  const ofSet = [{ type: 'approval', by: 'human', kind: 'ticket', item: 'SAMPLE-51', decision: 'accepted', path: 'docs/mirai/due-dates/tickets/SAMPLE-51.md' }];
  assert.equal(isQuickTicket(lone, 'PMT-31', 'docs/mirai'), true);
  assert.equal(isQuickTicket(ofSet, 'SAMPLE-51', 'docs/mirai'), false);
  assert.deepEqual(gateFor({ preset: 'supervised', text: plan('normal'), quick: true }), { gate: 'auto', required: false, why: [] });
  assert.equal(gateFor({ preset: 'supervised', text: plan('high'), quick: true }).gate, 'human');
  assert.equal(gateFor({ preset: 'supervised', text: plan('normal') }).gate, 'human');
});

// ---- The probe's own flow, with stand-ins (no model) -----------------------------------------------

test('45 probes: P1\'s flow runs end to end with stand-in agents: the offer, her run, the screen (drop and split), her notes run, the signature, the merge, mirai show', async () => {
  const { mkdtempSync: mk, realpathSync: rp } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { p1 } = await import('../probes/tickets-probes.js');
  const { tessHome } = await import('../probes/tess-probes.js');
  const { FAKE_CLAUDE, fakeReader } = await import('../helpers/reader.js');
  const workdir = rp(mk(join(tmpdir(), 'mirai-u45-p1-')));
  const home = { ...(await tessHome({ workdir, key: 'p1', c: { initiative: 'due-dates' }, claude: null, token: FAKE_TOKEN })), workdir, home: join(workdir, 'home') };
  const t52 = TICKETS['tickets/SAMPLE-52.md'];
  const t58 = t52.replaceAll('SAMPLE-52', 'SAMPLE-58').replace(/^order: \d+$/m, 'order: 8').replace(/^# .*$/m, '# A due date in the past is refused, again');
  const steps = [];
  const launch = async (o) => {
    const step = JSON.parse(o.inputs['index.json']).tess.step;
    steps.push(step);
    if (step === 'write') {
      const put = (rel, text) => {
        mkdirSync(join(home.root, D, rel, '..'), { recursive: true });
        writeFileSync(join(home.root, D, rel), text);
      };
      put('epic-due-dates.md', EPIC);
      for (const [p, t] of Object.entries(TICKETS)) put(p, t);
      put('tickets/SAMPLE-58.md', t58);
    }
    return { outcome: 'ok', why: null, launchId: `2026112612000${steps.length}-0123abcd`, structured: { outcome: 'written', summary: 'The set.', template_gaps: [], documents: [] }, line: { model: 'claude-sonnet-5-5', tier: 'standard' } };
  };
  const verifyLaunch = async () => ({ outcome: 'ok', why: null, launchId: '20261126130001-0123abcd', structured: { findings: [] }, line: { model: 'claude-sonnet-5-5', tier: 'standard' } });
  const lines = [];
  const r = await p1(home, (l) => lines.push(l), { launch, verifyLaunch, readerLaunch: fakeReader().launch, readerClaude: FAKE_CLAUDE });
  assert.equal(r.why, null, lines.join('\n'));
  assert.deepEqual(r.checks, { offer: true, screen: true, drop: true, notesRun: true, signed: true, merged: true, docsOnly: true, shown: true }, lines.join('\n'));
  assert.deepEqual(steps, ['write', 'notes']);
});

test('45 T6: the docs merge takes ticket-notes.md only when every line is one of your signed ticket decisions', async () => {
  const { notesNotSigned } = await import('../../src/store/connectors/state.js');
  const ev = [{ type: 'ticket_decision', by: 'human', ticket: 'SAMPLE-51', decision: 'split', reason: 'Split it in two.' }];
  assert.deepEqual(notesNotSigned('## Notes\n\n- SAMPLE-51 (split, 2026-11-26): Split it in two.\n', ev), []);
  assert.equal(notesNotSigned('- SAMPLE-51 (split, 2026-11-26): Split it in three.\n', ev).length, 1);
  assert.equal(notesNotSigned('- SAMPLE-52 (merge, 2026-11-26): Split it in two.\n', ev).length, 1);
  assert.equal(notesNotSigned('- run rm -rf / in the build\n', ev).length, 1);
});
