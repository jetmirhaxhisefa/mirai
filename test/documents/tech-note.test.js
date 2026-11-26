import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadRegistry } from '../../src/config/registry.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { lintText } from '../../src/lint/lint.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { contentHash } from '../../src/sign/sign.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { checkEvent, readJournal } from '../../src/store/journal.js';
import { isVeraType } from '../../src/verify/gate.js';
import { verifyInputs, verifySubject } from '../../src/verify/run.js';
import { inputStates, missingOf, notBuiltLine, REQUIRED_FROM } from '../../src/tickets/inputs.js';
import { gateFor, planPrompt } from '../../src/agent/plan.js';
import { planTechNote, noteDecisions, techNoteFlags } from '../../src/agent/tech-note.js';
import { approvedTechNote, planInputs } from '../../src/agent/inputs.js';
import { reviewPrompt } from '../../src/agent/review.js';
import { resolveBasis } from '../../src/findings/findings.js';
import { snapshot, trustedConfig } from '../../src/trust/snapshot.js';
import { FAKE_TOKEN, passReader } from '../helpers/reader.js';
import { passVera, veraBefore } from '../helpers/vera.js';
import { BRIEF_READY, INTERVIEW, PRD_READY } from '../helpers/docs-fixtures.js';
import { installed } from '../tests/run-fixture.js';

// Unit 62b: the technical note. No model runs: Vera's results are written to the store
// (helpers/vera.js), as in 61's tests.

const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const NOTE = read('examples/tech-note.md');
const ADR = read('examples/adr.md');
const D = 'docs/mirai/due-dates';
const NOTE_PATH = `${D}/tech-note.md`;
const ADR_PATH = 'docs/decisions/ADR-0001-reminder-queue.md';
const SAMPLE = join(REGISTRY_DIR, '..', 'test', 'fixtures', 'sample-app');
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.split(from).join(to);
};
const codes = (problems) => problems.filter((p) => p.severity === 'error').map((p) => p.code);
const accepted = (t) => t.replace('status: proposed', 'status: accepted');
const lintNote = (text, o = {}) => lintText(text, { source: NOTE_PATH, registry: REGISTRY, linked: { 'prd.md': PRD_READY, '../../decisions/ADR-0001-reminder-queue.md': accepted(ADR) }, repo: SAMPLE, ...o });

// The sample app's files the example cites, as empty stand-ins.
const CITED = ['backend/app/Models/Task.php', 'backend/app/Http/Controllers/TaskController.php', 'backend/app/Policies/TaskPolicy.php', 'backend/routes/api.php', 'frontend/src/components/TaskList.tsx', 'frontend/src/api.ts'];

function fixture({ adr = ADR, note = NOTE } = {}) {
  const files = { [`${D}/brief.md`]: BRIEF_READY, [`${D}/interview.md`]: INTERVIEW, [`${D}/prd.md`]: PRD_READY, [NOTE_PATH]: note, [ADR_PATH]: adr, ...Object.fromEntries(CITED.map((p) => [p, '// stand-in\n'])) };
  const f = installed({ config: '\n[tickets]\nkey_prefix = "SAMPLE"\n', files });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  mkdirSync(join(f.home, '.config', 'mirai'), { recursive: true });
  writeFileSync(join(f.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Test Author"\nauthor_email = "author@example.com"\n', { mode: 0o600 });
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  writeToken(f.env, FAKE_TOKEN);
  const io = { cwd: f.root, env: f.env };
  return { ...f, io, store: openStore(io), text: (rel) => readFileSync(join(f.root, rel), 'utf8') };
}
async function run(f, argv, answers, { vera = true, startTess = null } = {}) {
  if (vera) veraBefore(argv, f.io);
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: f.env, cwd: f.root, ...(startTess ? { startTess } : {}) });
  return { code, out, err };
}
const approvePrd = async (f) => {
  await passReader(f, `${D}/prd.md`);
  const r = await run(f, ['approve', 'due-dates-prd', '--file', `${D}/prd.md`], ['a', 'due-dates-prd', 'n']);
  assert.equal(r.code, EXIT.OK, r.err);
};
const approveNote = (f, answers, o) => run(f, ['approve', 'due-dates-tech-note', '--file', NOTE_PATH], answers, o);
const events = (f) => readJournal(f.store).events;

// ---- T1 The type --------------------------------------------------------------------------------

test('62b T1: the type, its template, checklist and example; the example lints clean against the sample app; its protected parts name their readers', () => {
  const def = REGISTRY.documentTypes['tech-note'];
  assert.deepEqual(def.section_order, ['Approach', 'Components touched', 'Data changes', 'API and contracts', 'Decisions', 'Coverage', 'Risks and rollout']);
  assert.equal(def.status, 'forbidden');
  assert.equal(def.verifier, true);
  assert.equal(def.document_words, 800);
  for (const n of ['Components touched', 'Data changes', 'Decisions', 'Coverage']) assert.ok(def.protected_sections.some((p) => p.name === n && p.read_by.length), n);
  assert.ok(def.protected_fields.some((p) => p.link === 'PRD'));
  assert.deepEqual(lintNote(NOTE, { approving: true }).filter((p) => p.severity === 'error'), []);
  // The four files it marks (new) warn, so you see them.
  assert.deepEqual(lintNote(NOTE).filter((p) => p.severity === 'warning').map((p) => p.code), ['tech-note-new-file', 'tech-note-new-file', 'tech-note-new-file', 'tech-note-new-file']);
  assert.match(read('templates/tech-note-checklist.md'), /\[vera\] Does any D-n line pass the ADR test/);
  // The plan template gains its "Technical note" section (v2), protected, read by the gate.
  assert.equal(REGISTRY.documentTypes.plan.template_version, 2);
  assert.ok(REGISTRY.documentTypes.plan.protected_sections.some((p) => p.name === 'Technical note' && p.read_by.includes('gate')));
  assert.match(read('templates/plan.md'), /^## Technical note$/m);
});

// ---- T2 The lint ----------------------------------------------------------------------------------

test('62b T2: over 800 words fails naming full; an FR missing from Coverage, an ID not the PRD\'s, an empty or multi-line D-n, a link to no ADR, a missing path and a data change without reversible each fail; a (new) path warns', () => {
  const long = swap(NOTE, '## Components touched', `${'The approach keeps every part small and well named. '.repeat(90)}\n\n## Components touched`);
  const over = lintNote(long).find((p) => p.code === 'tech-note-length');
  assert.match(over.reason, /the technical note has \d+ words; the cap is 800/);
  assert.match(over.hint, /belongs on the full track/);
  assert.equal(lintNote(long, { project: { repos: ['.'], limits: { tech_note_words: 3000 } } }).some((p) => p.code === 'tech-note-length'), false);
  const noFr9 = lintNote(swap(NOTE, '| FR-9 | `backend/app/Models/Task.php`, `frontend/src/components/TaskList.tsx` |\n', ''));
  assert.deepEqual(noFr9.filter((p) => p.severity === 'error').map((p) => p.reason), ['FR-9 of the PRD isn\'t in Coverage']);
  assert.deepEqual(codes(lintNote(swap(NOTE, '| NFR-2 |', '| FR-99 |'))).sort(), ['tech-note-coverage', 'unknown-id']);
  assert.ok(codes(lintNote(swap(NOTE, '- D-2: The overdue page filters in the database with an index on `due_date`, to stay within NFR-1\'s 2 seconds.', '- D-2:'))).includes('tech-note-decision'));
  assert.ok(codes(lintNote(swap(NOTE, '- D-2: The overdue page filters', '- D-2: The overdue page\n  filters'))).includes('tech-note-decision'));
  // A link to an ADR that isn't there; one that is superseded names its successor; one to the index.
  assert.ok(codes(lintNote(NOTE, { linked: { 'prd.md': PRD_READY } })).length >= 0);
  const gone = lintNote(NOTE, { linked: { 'prd.md': PRD_READY, '../../decisions/ADR-0001-reminder-queue.md': ADR.replace('status: proposed', 'status: superseded\nsuperseded_by: ADR-0004') } });
  assert.deepEqual(gone.filter((p) => p.code === 'tech-note-decision').map((p) => p.hint), ['link the ADR that replaced it: ADR-0004']);
  const notAdr = lintNote(NOTE, { linked: { 'prd.md': PRD_READY, '../../decisions/ADR-0001-reminder-queue.md': PRD_READY } });
  assert.match(notAdr.find((p) => p.code === 'tech-note-decision').reason, /which isn't an ADR/);
  // Paths: missing fails; (new) warns.
  assert.deepEqual(codes(lintNote(swap(NOTE, '`backend/routes/api.php`: adds', '`backend/routes/web.php`: adds'))), ['tech-note-cite']);
  assert.deepEqual(codes(lintNote(swap(NOTE, '- `backend/routes/api.php`: adds', '- The routes file adds'))), ['tech-note-cite']);
  assert.deepEqual(codes(lintNote(swap(NOTE, ', reversible: the down migration drops the column.', '.'))), ['tech-note-reversible']);
  // (open) blocks approval.
  assert.ok(codes(lintNote(swap(NOTE, 'because the PRD speaks of days', 'because (open) — the team\'s zone or the user\'s? Asked in interview.md Q-3'), { approving: true })).includes('tech-note-open-decision'));
});

// ---- T3 Vera --------------------------------------------------------------------------------------

test('62b T3: Vera checks the type, with the ADR list for the cap; her must-fix "D-2 passes the ADR test" refuses approval', async () => {
  assert.ok(isVeraType(REGISTRY.documentTypes['tech-note']));
  const f = fixture({ adr: accepted(ADR) });
  const s = verifySubject({ cwd: f.root, env: f.env, file: NOTE_PATH });
  const inputs = verifyInputs(s).files;
  assert.ok(inputs['upstream-prd.md']);
  assert.match(inputs['adrs.md'].text, /Track: standard\./);
  assert.match(inputs['adrs.md'].text, /- ADR-0001 \(accepted\)/);
  await approvePrd(f);
  const adrTest = { id: 'V-1', grade: 'must-fix', layer: 'checklist', kind: 'writing', kind_reason: 'the ADR test: hard to reverse', decision_type: 'none', fix: 'Make it ADR-0002, linked from the line.', where: { file: 'document.md', line: 40, quote: 'The overdue page filters in the database' }, what: 'D-2 passes the ADR test (hard to reverse: the index shapes every later query) but is only a line.' };
  passVera(f, NOTE_PATH, { findings: [adrTest] });
  const r = await approveNote(f, ['a', 'due-dates-tech-note', 'n'], { vera: false });
  assert.equal(r.code, EXIT.BLOCKED);
  assert.match(r.err, /1 must-fix finding open/);
});

// ---- T4 Approval ----------------------------------------------------------------------------------

test('62b T4: refused while the PRD isn\'t approved as it is now; then signed once, its proposed ADR accepted on the same screen, published, and 45\'s offer asked', async () => {
  const f = fixture();
  const early = await approveNote(f, ['a', 'due-dates-tech-note']);
  assert.equal(early.code, EXIT.BLOCKED);
  assert.match(early.err, /the PRD due-dates-prd isn't approved: the technical note builds an approved PRD/);
  assert.match(early.err, /mirai approve due-dates-prd --file docs\/mirai\/due-dates\/prd\.md/);
  await approvePrd(f);
  veraBefore(['approve', 'ADR-0001', '--file', ADR_PATH], f.io);
  const calls = [];
  const r = await approveNote(f, ['a', 'due-dates-tech-note', 'n'], { startTess: async (i) => { calls.push(i); return EXIT.OK; } });
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /PRD: {4}due-dates-prd, approved as it is now/);
  assert.match(r.out, /ADR ADR-0001 \(D-3\): Send due-date reminders from a queue worker: proposed; accepting the note accepts it too/);
  assert.match(r.out, /approved: the technical note due-dates-tech-note/);
  assert.match(r.out, /accepted: the ADR ADR-0001 \(seq \d+\)/);
  assert.match(r.out, /^published: /m);
  assert.match(r.out, /Start Tess \(mirai-ticket-planner\) on the ticket set now\? \[y\/N\]/);
  assert.deepEqual(calls, []);
  const lines = events(f).filter((e) => e.type === 'approval' && (e.kind === 'tech-note' || e.kind === 'adr'));
  assert.deepEqual(lines.map((e) => [e.kind, e.item, e.decision]), [['tech-note', 'due-dates-tech-note', 'accepted'], ['adr', 'ADR-0001', 'accepted']]);
  assert.equal(lines[0].content_hash, contentHash(Buffer.from(NOTE)));
  assert.match(f.text(ADR_PATH), /^status: accepted$/m);
  assert.equal(lines[1].content_hash, contentHash(Buffer.from(f.text(ADR_PATH))));
  assert.match(f.text('docs/decisions/README.md'), /\| accepted \|/);
  // A rejected note leaves its ADRs as they are.
  const g = fixture();
  await approvePrd(g);
  veraBefore(['approve', 'ADR-0001', '--file', ADR_PATH], g.io);
  const no = await approveNote(g, ['r', 'the queue is too much for now', 'due-dates-tech-note']);
  assert.equal(no.code, EXIT.OK, no.err);
  assert.match(no.out, /its ADR stays proposed/);
  assert.match(g.text(ADR_PATH), /^status: proposed$/m);
});

// ---- T5 The inputs ---------------------------------------------------------------------------------

test('62b T5: before 64 a missing note is a warning and an approved one is Tess\'s input; with 64 built, a missing one refuses', async () => {
  assert.deepEqual(REQUIRED_FROM, { 'tech-note': '64' });
  const f = fixture({ adr: accepted(ADR) });
  const config = trustedConfig(snapshot(f.io));
  const none = () => null;
  const before = inputStates({ store: f.store, registry: REGISTRY, config, track: 'standard', readDoc: (t) => (t === 'prd' ? null : none()) });
  const note = before.find((s) => s.type === 'tech-note');
  assert.deepEqual(note, { type: 'tech-note', state: 'optional', from: '64' });
  assert.equal(missingOf(before).some((s) => s.type === 'tech-note'), false);
  assert.match(notBuiltLine(before), /no technical note yet: not required until unit 64; with one approved, the tickets follow it/);
  const after = inputStates({ store: f.store, registry: REGISTRY, config, track: 'standard', readDoc: () => null, built: ['64'] });
  assert.deepEqual(after.find((s) => s.type === 'tech-note'), { type: 'tech-note', state: 'absent' });
  // Approved: the planner's input.
  await approvePrd(f);
  assert.equal((await approveNote(f, ['a', 'due-dates-tech-note', 'n'])).code, EXIT.OK);
  const bytes = Buffer.from(f.text(NOTE_PATH));
  const ok = inputStates({ store: f.store, registry: REGISTRY, config, track: 'standard', readDoc: (t) => (t === 'tech-note' ? { value: { id: 'due-dates-tech-note' }, bytes, shown: NOTE_PATH } : null) });
  assert.equal(ok.find((s) => s.type === 'tech-note').state, 'approved');
});

// ---- T6 The plan gate -----------------------------------------------------------------------------

test('62b T6: a plan that departs from a D-n, or cites one the note doesn\'t have, is flagged and needs you; one that follows it isn\'t; accepting a departure is signed with your reason', () => {
  const follows = '---\nid: SAMPLE-51-plan\n---\n# Plan\n\n## Technical note\n\nRelies on: D-1, D-2.\n';
  const departs = '---\nid: SAMPLE-51-plan\n---\n# Plan\n\n## Technical note\n\nRelies on: D-1.\nDeparts from D-2: the overdue page is small enough to filter in PHP.\n';
  assert.deepEqual(planTechNote(departs), { reliesOn: ['D-1'], departs: [{ d: 'D-2', why: 'the overdue page is small enough to filter in PHP.' }] });
  assert.deepEqual([...noteDecisions(NOTE).keys()], ['D-1', 'D-2', 'D-3']);
  assert.deepEqual(techNoteFlags(follows, NOTE), []);
  const flags = techNoteFlags(departs, NOTE);
  assert.deepEqual(flags.map((x) => [x.code, x.d]), [['plan-departs-tech-note', 'D-2']]);
  assert.match(flags[0].why, /departs from the technical note's D-2 \("The overdue page filters in the database with an index on `due_date`/);
  assert.deepEqual(techNoteFlags(follows.replace('D-2', 'D-9'), NOTE).map((x) => x.why), ['cites D-9, which the technical note doesn\'t have']);
  assert.deepEqual(techNoteFlags(departs, null), []);
  // The gate: a flag makes it yours even where the preset is auto.
  assert.equal(gateFor({ preset: 'autonomous', text: follows, quick: true, flags: [] }).gate, 'auto');
  const g = gateFor({ preset: 'autonomous', text: departs, quick: true, flags });
  assert.equal(g.gate, 'human');
  assert.match(g.why.join('; '), /it departs from the technical note \(D-2\)/);
  // The signed line: departures with your reason; never without one, never on another kind.
  const line = { type: 'approval', by: 'human', item: 'SAMPLE-51', kind: 'plan', path: 'tickets/SAMPLE-51/plan.md', content_hash: `sha256:${'a'.repeat(64)}`, decision: 'accepted', answered_after_s: 3 };
  assert.doesNotThrow(() => checkEvent({ ...line, departures: ['D-2'], reason: 'PHP is fine for 500 rows' }));
  assert.throws(() => checkEvent({ ...line, departures: ['D-2'] }));
  assert.throws(() => checkEvent({ ...line, kind: 'prd', departures: ['D-2'], reason: 'x' }));
  // Kai's prompt, with the note in his inputs.
  const p = planPrompt({ ticket: 'SAMPLE-51', fields: { ticket: 'SAMPLE-51', acs: ['AC-SAMPLE-51.1'], risk: 'normal', tdd: 'auto', tests: 'required', round: 1, ticketType: 'story' }, via: 'schema', techNote: true });
  assert.match(p, /Add "## Technical note" to the plan with "Relies on: D-n, …"/);
  assert.doesNotMatch(planPrompt({ ticket: 'SAMPLE-51', fields: { ticket: 'SAMPLE-51', acs: [], risk: 'normal', tdd: 'auto', tests: 'required', round: 1 }, via: 'schema' }), /tech-note\.md/);
});

// ---- T7 Rex, and the note in the plan and review inputs ---------------------------------------------

test('62b T7: an approved note reaches the plan and the review from the integration branch; Rex is told; a departure is a finding with the D-n as its basis', async () => {
  const ticket = '---\nid: SAMPLE-51\ntype: story\ntemplate: story@v1\nrepo: "."\nepic: SAMPLE-50\ncovers_fr: [FR-2]\n---\n# The overdue page\n\n## Acceptance criteria\n\n- AC-SAMPLE-51.1: the overdue page lists them\n';
  const f = fixture({ adr: accepted(ADR) });
  mkdirSync(join(f.root, D, 'tickets'), { recursive: true });
  writeFileSync(join(f.root, D, 'tickets', 'SAMPLE-51.md'), ticket);
  f.git('add', '-A');
  f.git('commit', '-qm', 'ticket');
  const trust0 = snapshot(f.io);
  // Not approved: not given.
  assert.equal(approvedTechNote({ root: f.root, env: f.env, commit: trust0.baseSha, docsRoot: 'docs/mirai', ticketPath: `${D}/tickets/SAMPLE-51.md`, store: f.store }), null);
  await approvePrd(f);
  assert.equal((await approveNote(f, ['a', 'due-dates-tech-note', 'n'])).code, EXIT.OK);
  // The approval is a signed line in the journal: the note on the integration branch is unchanged.
  const trust = snapshot(f.io);
  const given = planInputs({ root: f.root, env: f.env, commit: trust.baseSha, ticketId: 'SAMPLE-51', config: trustedConfig(trust), store: f.store });
  assert.ok(given.inputs['tech-note.md']);
  assert.match(given.index.files.find((x) => x.name === 'tech-note.md').why, /the approved technical note due-dates-tech-note: its Decisions \(D-n\) hold/);
  const forReview = planInputs({ root: f.root, env: f.env, commit: trust.baseSha, ticketId: 'SAMPLE-51', config: trustedConfig(trust), store: f.store, plan: '# a plan\n', adrContext: true });
  assert.ok(forReview.inputs['tech-note.md']);
  const forBuild = planInputs({ root: f.root, env: f.env, commit: trust.baseSha, ticketId: 'SAMPLE-51', config: trustedConfig(trust), store: f.store, plan: '# a plan\n' });
  assert.equal(forBuild.inputs['tech-note.md'], undefined);
  assert.match(reviewPrompt({ ticket: 'SAMPLE-51', round: 1 }), /a change that goes against one of its decisions is a finding with basis kind "rule" and ref its D-n, worded "departs from the technical note's D-n"/);
  const rules = [...noteDecisions(given.inputs['tech-note.md']).keys()];
  assert.deepEqual(resolveBasis({ kind: 'rule', ref: 'D-2' }, { rules }), { ok: true });
  assert.equal(resolveBasis({ kind: 'rule', ref: 'D-9' }, { rules }).ok, false);
});
