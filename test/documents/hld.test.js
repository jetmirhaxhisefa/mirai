import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadRegistry } from '../../src/config/registry.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { applyOverlays, readOverlays } from '../../src/config/overlays.js';
import { lintText } from '../../src/lint/lint.js';
import { documentsPreCommit } from '../../src/hooks/pre-commit.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { contentHash } from '../../src/sign/sign.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { traceDocuments } from '../../src/trace/documents.js';
import { inputStates } from '../../src/tickets/inputs.js';
import { snapshot, trustedConfig } from '../../src/trust/snapshot.js';
import { isVeraType } from '../../src/verify/gate.js';
import { verifyInputs, verifySubject } from '../../src/verify/run.js';
import { FAKE_TOKEN, passReader } from '../helpers/reader.js';
import { veraBefore } from '../helpers/vera.js';
import { BRIEF_READY, INTERVIEW, PRD_READY } from '../helpers/docs-fixtures.js';
import { installed } from '../tests/run-fixture.js';

// Unit 62: the HLD. No model runs (Vera's and the reader's results are seeded, helpers/).

const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const HLD = read('examples/hld.md');
const ADR = read('examples/adr.md');
const D = 'docs/mirai/due-dates';
const HLD_PATH = `${D}/hld.md`;
const ADR_PATH = 'docs/decisions/ADR-0001-reminder-queue.md';
const SAMPLE = join(REGISTRY_DIR, '..', 'test', 'fixtures', 'sample-app');
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.split(from).join(to);
};
const codes = (problems) => problems.filter((p) => p.severity === 'error').map((p) => p.code);
const LINKED = { 'prd.md': PRD_READY, '../../decisions/ADR-0001-reminder-queue.md': ADR };
const lintHld = (text, o = {}) => lintText(text, { source: HLD_PATH, registry: REGISTRY, linked: LINKED, repo: SAMPLE, ...o });
const errorsOf = (text, o) => lintHld(text, o).filter((p) => p.severity === 'error');

const CITED = ['backend/app/Http/Controllers/TaskController.php', 'backend/app/Policies/TaskPolicy.php', 'backend/database/migrations/2026_10_23_100000_create_tasks_table.php', 'frontend/src/components/TaskList.tsx'];
function fixture() {
  const files = { [`${D}/brief.md`]: BRIEF_READY, [`${D}/interview.md`]: INTERVIEW, [`${D}/prd.md`]: PRD_READY, [HLD_PATH]: HLD, [ADR_PATH]: ADR };
  for (const p of CITED) files[p] = readFileSync(join(SAMPLE, p), 'utf8');
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
async function run(f, argv, answers, { vera = true } = {}) {
  if (vera) veraBefore(argv, f.io);
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: f.env, cwd: f.root });
  return { code, out, err };
}

// ---- T1, T2 -------------------------------------------------------------------------------------

test('62 T1: the example passes against the sample app; a missing core section, context or container diagram, or sequence diagram is each named', () => {
  assert.deepEqual(lintHld(HLD, { approving: true }), []);
  assert.ok(codes(lintHld(HLD.replace(/## Current state\n[^]*?(?=## Solution strategy)/, ''))).includes('missing-section'));
  assert.deepEqual(codes(lintHld(swap(HLD, '[Person: a team lead]', '[a team lead]').replace('[Person: an assignee]', '[an assignee]').replace('[External: the mail service]\n```\n\n- Outside', '[the mail service]\n```\n\n- Outside'))), ['hld-diagram']);
  assert.deepEqual(codes(lintHld(HLD.replace(/\[Container: (the task list|the task API|the database|the reminder worker)\]/g, '[$1]'))), ['hld-diagram']);
  assert.deepEqual(codes(lintHld(HLD.replace('sequenceDiagram', 'flowchart LR'))), ['hld-diagram']);
  // The template validates, and the type is protected and Vera's.
  const def = REGISTRY.documentTypes.hld;
  assert.equal(def.status, 'forbidden');
  assert.ok(isVeraType(def));
  for (const n of ['Summary for approval', 'Current state', 'Building blocks', 'Decisions', 'Trace table']) assert.ok(def.protected_sections.some((p) => p.name === n), n);
});

test('62 T2: an optional section absent and not marked is a problem; Omitted with a reason passes; Omitted with no reason is a problem', () => {
  assert.ok(codes(lintHld(HLD.replace(/## Constraints\n\nOmitted: [^\n]*\n\n/, ''))).includes('missing-section'));
  assert.deepEqual(codes(lintHld(swap(HLD, 'Omitted: the PRD names no constraint beyond its requirements.', 'Omitted:'))), ['hld-omitted']);
  assert.deepEqual(codes(lintHld(swap(HLD, 'Omitted: the PRD names no constraint beyond its requirements.', 'Omitted: none.'))), ['hld-omitted']);
});

// ---- T3, T4, T5 ---------------------------------------------------------------------------------

test('62 T3: the trace table: a PRD FR with no row, an ID the PRD lacks, an unknown component, an unknown D-n or ADR, deferred with no reason: each named; deferred with a reason passes', () => {
  assert.deepEqual(errorsOf(HLD.replace('| FR-9 | The task list | D-1 | |\n', '')).map((p) => p.reason), ['FR-9 of the PRD has no row in the trace table']);
  assert.ok(codes(lintHld(swap(HLD, '| NFR-2 | The reminder worker | D-3 | |', '| NFR-2 | The reminder worker | D-3 | |\n| FR-99 | The task API | D-1 | |'))).includes('unknown-id'));
  assert.match(errorsOf(swap(HLD, '| FR-5 | The task list | D-1 | |', '| FR-5 | The calendar | D-1 | |'))[0].reason, /FR-5's component "The calendar" isn't in the components table/);
  assert.match(errorsOf(swap(HLD, '| FR-5 | The task list | D-1 | |', '| FR-5 | The task list | D-9 | |'))[0].reason, /FR-5 cites D-9, which Decisions doesn't have/);
  assert.match(errorsOf(swap(HLD, '| FR-5 | The task list | D-1 | |', '| FR-5 | The task list | ADR-0007 | |'))[0].reason, /FR-5 cites ADR-0007, which Decisions doesn't link/);
  assert.match(errorsOf(swap(HLD, '| FR-5 | The task list | D-1 | |', '| FR-5 | deferred | | |'))[0].reason, /FR-5 is deferred without a reason/);
  assert.deepEqual(errorsOf(swap(HLD, '| FR-5 | The task list | D-1 | |', '| FR-5 | deferred: the list change ships with the next release | | |')), []);
  // A proposed ADR linked from Decisions passes (it is signed on the same screen), and is a decision for you.
  assert.deepEqual(errorsOf(HLD, { linked: { ...LINKED, '../../decisions/ADR-0001-reminder-queue.md': ADR } }), []);
});

test('62 T4: quality goals: one with no NFR, one with no number, each named; more than five warns', () => {
  assert.match(errorsOf(swap(HLD, '- 500 open tasks in a team → the overdue page shows within 2 seconds (NFR-1).', '- 500 open tasks in a team → the overdue page shows within 2 seconds.'))[0].reason, /cites no NFR/);
  assert.match(errorsOf(swap(HLD, '- 500 open tasks in a team → the overdue page shows within 2 seconds (NFR-1).', '- Many open tasks → the overdue page shows quickly (NFR-1).'))[0].reason, /has no number/);
  const six = swap(HLD, '- 500 open tasks in a team → the overdue page shows within 2 seconds (NFR-1).', Array.from({ length: 6 }, (_, i) => `- ${100 * (i + 1)} open tasks → the page shows within ${i + 1} seconds (NFR-1).`).join('\n'));
  assert.ok(lintHld(six).some((p) => p.code === 'hld-quality' && p.severity === 'warning'));
});

test('62 T5: the caps: a summary over 600 words fails; the HLD over 4,000 warns with the LLD hint; both from the project config', () => {
  const longSummary = swap(HLD, '### Not in this', `${Array.from({ length: 90 }, () => 'The design keeps each part small and named.').join('\n')}\n\n### Not in this`);
  assert.ok(lintHld(longSummary).some((p) => p.severity === 'error' && /summary|words/i.test(p.reason)));
  const longDoc = swap(HLD, '## Data\n', `## Data\n\n${Array.from({ length: 420 }, () => 'The worker sends each email once and records each failure.').join('\n')}\n\n`);
  const cap = lintHld(longDoc).find((p) => p.code === 'hld-length');
  assert.equal(cap.severity, 'warning');
  assert.match(cap.hint, /into an LLD \(unit 63\)/);
  assert.equal(lintHld(longDoc, { project: { repos: ['.'], limits: { hld_words: 15000 } } }).some((p) => p.code === 'hld-length'), false);
});

// ---- T6 Vera; the re-check's additions -----------------------------------------------------------

test('62 T6 and the re-check: Vera checks it with the ADR list; lld, Current state, lettered decisions and "(Arlo\'s call)"', () => {
  assert.match(read('templates/hld-checklist.md'), /\[vera\] Is every container in the diagrams in the components table/);
  assert.match(read('templates/hld-checklist.md'), /\[vera\] Does any D-n line pass the ADR test/);
  // lld: required needs triggers; not-required a reason.
  assert.deepEqual(codes(lintHld(swap(HLD, 'lld_triggers: [entity, contract]\n', ''))), ['hld-lld']);
  assert.deepEqual(codes(lintHld(swap(HLD, 'lld: required\nlld_triggers: [entity, contract]', 'lld: not-required'))), ['hld-lld']);
  assert.deepEqual(codes(lintHld(swap(HLD, 'lld: required\nlld_triggers: [entity, contract]', 'lld: not-required\nlld_reason: one table column and no new contract'))), []);
  // Current state: cited or unverified; a cited path that doesn't exist.
  assert.deepEqual(codes(lintHld(swap(HLD, ', `backend/app/Policies/TaskPolicy.php:12`.', '.'))), ['hld-current']);
  assert.deepEqual(codes(lintHld(swap(HLD, '`backend/app/Policies/TaskPolicy.php:12`', '`backend/app/Policies/TeamPolicy.php:12`'))), ['hld-current']);
  // Decisions for you: lettered, one recommended, written for one of them.
  const dfy = '1. How do reminder emails get sent (ADR-0001)? A: one queued job per assignee, with a worker process (recommended). B: one nightly command that sends them all. Written for: A.';
  assert.deepEqual(codes(lintHld(swap(HLD, dfy, '1. How do reminder emails get sent (ADR-0001)? A queue or a nightly command.'))), ['hld-decisions-for-you']);
  assert.deepEqual(codes(lintHld(swap(HLD, dfy, dfy.replace(' (recommended)', '')))), ['hld-decisions-for-you']);
  assert.deepEqual(codes(lintHld(swap(HLD, dfy, dfy.replace('Written for: A.', 'Written for: C.')))), ['hld-decisions-for-you']);
  // (Arlo's call) on a D-n line is fine.
  assert.match(HLD, /\(Arlo's call\)$/m);
});

// ---- T7 approval; T8 trace; T10 status --------------------------------------------------------------

test('62 T7: approval: refused while the PRD isn\'t approved; then one signed line with its proposed ADR on the same screen, the reader test, the publish', async () => {
  const f = fixture();
  await passReader(f, HLD_PATH);
  const early = await run(f, ['approve', 'due-dates-hld', '--file', HLD_PATH], ['a', 'due-dates-hld']);
  assert.equal(early.code, EXIT.BLOCKED);
  assert.match(early.err, /the PRD due-dates-prd isn't approved: the HLD builds an approved PRD/);
  await passReader(f, `${D}/prd.md`);
  assert.equal((await run(f, ['approve', 'due-dates-prd', '--file', `${D}/prd.md`], ['a', 'due-dates-prd', 'n'])).code, EXIT.OK);
  veraBefore(['approve', 'ADR-0001', '--file', ADR_PATH], f.io);
  const r = await run(f, ['approve', 'due-dates-hld', '--file', HLD_PATH], ['a', 'due-dates-hld', 'n']);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /^reader test: pass/m);
  assert.match(r.out, /ADR ADR-0001 \(D-3\): Send due-date reminders from a queue worker: proposed; accepting the HLD accepts it too/);
  assert.match(r.out, /approved: the HLD due-dates-hld/);
  const lines = readJournal(f.store).events.filter((e) => e.type === 'approval' && (e.kind === 'hld' || e.kind === 'adr'));
  assert.deepEqual(lines.map((e) => [e.kind, e.item]), [['hld', 'due-dates-hld'], ['adr', 'ADR-0001']]);
  assert.ok(lines[0].reader_test);
  assert.equal(lines[0].content_hash, contentHash(Buffer.from(HLD)));
  assert.match(f.text(ADR_PATH), /^status: accepted$/m);
  // On full, the HLD is the planner's input.
  const config = trustedConfig(snapshot(f.io));
  const states = inputStates({ store: f.store, registry: REGISTRY, config, track: 'full', readDoc: (t) => (t === 'hld' ? { value: { id: 'due-dates-hld' }, bytes: Buffer.from(f.text(HLD_PATH)), shown: HLD_PATH } : null), initiative: 'due-dates' });
  assert.equal(states.find((s) => s.type === 'hld').state, 'approved');
  // T10: a hand-set status is refused at commit.
  writeFileSync(join(f.root, HLD_PATH), HLD.replace('track: full', 'track: full\nstatus: approved'));
  f.git('add', HLD_PATH);
  assert.match(documentsPreCommit({ root: f.root, env: f.env, store: f.store }).refused[0].why, /a hld keeps no status in its frontmatter/);
});

test('62 T8: trace: the HLD\'s rows become FR → component links; a missing row is a missing link; the note\'s Coverage on standard', () => {
  const prd = { path: `${D}/prd.md`, text: PRD_READY };
  const ok = traceDocuments({ initiative: 'due-dates', registry: REGISTRY, prd, design: { path: HLD_PATH, text: HLD }, track: 'full', adrs: [] });
  assert.ok(ok.links.some((l) => l.from === 'FR-4' && l.state === 'pass' && /reminder worker/.test(l.to)));
  const gap = traceDocuments({ initiative: 'due-dates', registry: REGISTRY, prd, design: { path: HLD_PATH, text: HLD.replace('| FR-9 | The task list | D-1 | |\n', '') }, track: 'full', adrs: [] });
  assert.deepEqual(gap.missing.filter((m) => m.kind === 'design').map((m) => m.what), ['FR-9 has no component in the HLD\'s Trace table']);
  const none = traceDocuments({ initiative: 'due-dates', registry: REGISTRY, prd, track: 'standard', adrs: [] });
  assert.ok(none.notes.includes('no technical note yet: the FR → component links are traced once it is written'));
  // The note's Coverage on standard (62b's example).
  const note = traceDocuments({ initiative: 'due-dates', registry: REGISTRY, prd, design: { path: `${D}/tech-note.md`, text: read('examples/tech-note.md') }, track: 'standard', adrs: [] });
  assert.equal(note.missing.filter((m) => m.kind === 'design').length, 0);
});

// ---- T9 the pilot's template -------------------------------------------------------------------------

export const PILOT_OVERLAY = `kind = "document-type-overlay"
schema_version = 1
name = "hld"

[[rename]]
from = "Context and scope"
to = "Context and accepted requirements"

[[rename]]
from = "Solution strategy"
to = "Architecture overview"

[[rename]]
from = "Building blocks"
to = "Components and ownership"

[[rename]]
from = "Key flows"
to = "Request, event, and data flows"

[[rename]]
from = "Data"
to = "Data model and invariants"

[[rename]]
from = "Risks and rollout"
to = "Deployment, rollout, and rollback"

[[rename]]
from = "Failure modes"
to = "Failure modes and recovery"

[[rename]]
from = "Observability"
to = "Observability and operations"

[[add]]
name = "Transaction and consistency model"
after = "Data"
`;
export const PILOT_FRAGMENT = '## Transaction and consistency model\n\n<!-- done when: each write names its transaction boundary and what a reader sees meanwhile -->\nWhat each write commits together, and what a reader sees in between.\n';

export function pilotRegistry() {
  const fs = new Map([['document-types/hld.toml', Buffer.from(PILOT_OVERLAY)], ['templates/hld.md', Buffer.from(PILOT_FRAGMENT)]]);
  const overlays = readOverlays(fs, REGISTRY);
  assert.deepEqual(overlays.flatMap((o) => o.problems), []);
  return applyOverlays(REGISTRY, fs, overlays.map((o) => ({ type: 'approval', by: 'human', kind: 'overlay', path: o.path, content_hash: o.hash, ...(o.bound.length ? { files: o.bound } : {}), decision: 'accepted', seq: 1 }))).registry;
}
export function pilotHld(text = HLD) {
  let t = text;
  for (const [from, to] of [['## Context and scope', '## Context and accepted requirements'], ['## Solution strategy', '## Architecture overview'], ['## Building blocks', '## Components and ownership'], ['## Key flows', '## Request, event, and data flows'], ['## Data\n', '## Data model and invariants\n'], ['## Risks and rollout', '## Deployment, rollout, and rollback'], ['## Failure modes', '## Failure modes and recovery'], ['## Observability', '## Observability and operations']]) t = swap(t, from, to);
  return swap(t, '## Cross-cutting rules and conventions', '## Transaction and consistency model\n\nEach write commits the task and its date together; a reader sees the old date or the new one, never half.\n\n## Cross-cutting rules and conventions');
}

test('62 T9: the pilot\'s section names through a rename map lint clean, with the core\'s trace table and Decisions found', () => {
  const registry = pilotRegistry();
  const text = pilotHld();
  assert.deepEqual(lintText(text, { source: HLD_PATH, registry, linked: LINKED, repo: SAMPLE }).filter((p) => p.severity === 'error'), []);
  // The renamed context section still needs its context diagram, and the trace table is still read.
  assert.ok(lintText(text.replace('[Person: a team lead]', '[a team lead]').replace('[Person: an assignee]', '[an assignee]').replace('[External: the mail service]\n```\n\n- Outside', '[the mail service]\n```\n\n- Outside'), { source: HLD_PATH, registry, linked: LINKED, repo: SAMPLE }).some((p) => p.code === 'hld-diagram'));
  assert.ok(lintText(text.replace('| FR-9 | The task list | D-1 | |\n', ''), { source: HLD_PATH, registry, linked: LINKED, repo: SAMPLE }).some((p) => /FR-9 of the PRD has no row/.test(p.reason)));
});

// ---- T11 ---------------------------------------------------------------------------------------------

test('62 T11: the docs name the type, its keys and the HLD page (34b\'s check runs in test/docs)', () => {
  const docs = readFileSync(join(REGISTRY_DIR, '..', 'docs', 'hld.md'), 'utf8');
  for (const s of ['Current state', 'Trace table', '`lld`', 'Omitted:', 'Decisions for you', 'Written for:']) assert.ok(docs.includes(s), s);
  assert.match(readFileSync(join(REGISTRY_DIR, '..', 'docs', 'config.md'), 'utf8'), /`docs\.limits\.hld_words`/);
});
