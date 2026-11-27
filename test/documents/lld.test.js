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
import { lldItemIds } from '../../src/lint/lld-items.js';
import { documentsPreCommit } from '../../src/hooks/pre-commit.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { contentHash } from '../../src/sign/sign.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { appendEvent, readJournal } from '../../src/store/journal.js';
import { inputStates, notBuiltLine } from '../../src/tickets/inputs.js';
import { snapshot, trustedConfig } from '../../src/trust/snapshot.js';
import { isVeraType } from '../../src/verify/gate.js';
import { planPrompt } from '../../src/agent/plan.js';
import { reviewPrompt } from '../../src/agent/review.js';
import { FAKE_TOKEN, passReader } from '../helpers/reader.js';
import { veraBefore } from '../helpers/vera.js';
import { BRIEF_READY, INTERVIEW, PRD_READY } from '../helpers/docs-fixtures.js';
import { installed } from '../tests/run-fixture.js';

// Unit 63: the LLD. No model runs (Vera's and the reader's results are seeded, helpers/).

const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const LLD = read('examples/lld.md');
const HLD = read('examples/hld.md');
const ADR = read('examples/adr.md');
const PRD = read('examples/prd.md');
const D = 'docs/mirai/due-dates';
const LLD_PATH = `${D}/lld.md`;
const HLD_PATH = `${D}/hld.md`;
const ADR_PATH = 'docs/decisions/ADR-0001-reminder-queue.md';
const SAMPLE = join(REGISTRY_DIR, '..', 'test', 'fixtures', 'sample-app');
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.split(from).join(to);
};
const codes = (problems) => problems.filter((p) => p.severity === 'error').map((p) => p.code);
const LINKED = { 'hld.md': HLD, 'prd.md': PRD };
const lintLld = (text, o = {}) => lintText(text, { source: LLD_PATH, registry: REGISTRY, linked: LINKED, ...o });

// ---- T1 -------------------------------------------------------------------------------------------

test('63 T1: the type, template, checklist and example: the example lints clean; protected, Vera\'s, no status', () => {
  assert.deepEqual(lintLld(LLD, { approving: true }), []);
  const def = REGISTRY.documentTypes.lld;
  assert.equal(def.status, 'forbidden');
  assert.ok(isVeraType(def));
  for (const n of ['Scope', 'Names', 'Failures', 'Test map', 'Open questions']) assert.ok(def.protected_sections.some((p) => p.name === n), n);
  assert.match(read('templates/lld-checklist.md'), /\[vera\]/);
  assert.deepEqual(lldItemIds(LLD), ['C-1', 'C-2', 'S-1']);
});

// ---- T2 -------------------------------------------------------------------------------------------

test('63 T2: the lint: failures, retry, schema, names, the test map, D-n, an Alternatives section, Not applicable, the caps', () => {
  // A contract with no failure rows.
  const noFail = LLD.replace(/\| Failure \| Status \| Code \| Retryable \|\n\|---\|---\|---\|---\|\n(\|[^\n]*\n)+/g, '');
  assert.ok(codes(lintLld(noFail)).includes('lld-failures'));
  // A write with no retry line.
  assert.deepEqual(codes(lintLld(swap(LLD, 'Retry: the same request twice sets the same date, so a repeat is harmless.\n', ''))), ['lld-retry']);
  // A schema change with no rollback.
  assert.deepEqual(codes(lintLld(swap(LLD, '| adds the column and the index | drops both |', '| adds the column and the index | |'))), ['lld-schema']);
  // A duplicate name.
  assert.deepEqual(codes(lintLld(swap(LLD, '| `days_overdue` |', '| `due_date` |'))), ['lld-names']);
  // An AC not in the test map; a failure with no test.
  assert.deepEqual(codes(lintLld(swap(LLD, '| AC-FR-1.2 | feature | C-1 | null clears the date |\n', ''))), ['lld-test-map']);
  assert.deepEqual(codes(lintLld(swap(LLD, '| a non-lead opens the overdue list | feature | C-2 | a member\'s request answers 403 |\n', ''))), ['lld-test-map']);
  // A D-n the HLD doesn't have.
  assert.deepEqual(codes(lintLld(swap(LLD, 'The column is the HLD\'s D-1', 'The column is the HLD\'s D-42'))), ['lld-decision']);
  // An Alternatives section is refused as unknown; a trigger section neither filled nor Not applicable.
  assert.ok(codes(lintLld(swap(LLD, '## Open questions', '## Alternatives\n\nA nightly job.\n\n## Open questions'))).length);
  assert.ok(codes(lintLld(swap(LLD, 'Not applicable — a task\'s lateness is a comparison of two days, with no state of its own.', ''))).length);
  // Open questions at approval.
  assert.deepEqual(codes(lintLld(`${LLD}- Is the date a day or a time?\n`, { approving: true })), ['lld-open-questions']);
  // The caps: prose only; the project's override.
  const long = swap(LLD, '## Names\n', `${Array.from({ length: 300 }, () => 'The list shows each late task with its days.').join('\n')}\n\n## Names\n`);
  assert.equal(lintLld(long).find((p) => p.code === 'lld-length')?.severity, 'warning');
  assert.equal(lintLld(long, { project: { repos: ['.'], limits: { lld_warn_words: 5000, lld_words: 6000 } } }).some((p) => p.code === 'lld-length'), false);
  assert.equal(lintLld(long, { project: { repos: ['.'], limits: { lld_warn_words: 500, lld_words: 1000 } } }).find((p) => p.code === 'lld-length')?.severity, 'error');
});

// ---- T3 -------------------------------------------------------------------------------------------

test('63 T3: the HLD\'s lld line: required with no LLD keeps Tess waiting; not-required doesn\'t', () => {
  const { store } = fixture();
  const states = (hld, lld = null) => inputStates({ store, registry: REGISTRY, config: {}, track: 'full', initiative: null, readDoc: (t) => (t === 'hld' ? hld : t === 'lld' ? lld : null) });
  const hldReq = { value: { id: 'due-dates-hld', lld: 'required' }, bytes: Buffer.from(HLD), shown: HLD_PATH };
  assert.equal(states(hldReq).find((s) => s.type === 'lld').state, 'absent');
  const hldNot = { value: { id: 'due-dates-hld', lld: 'not-required' }, bytes: Buffer.from(HLD), shown: HLD_PATH };
  const not = states(hldNot);
  assert.equal(not.find((s) => s.type === 'lld').state, 'not-needed');
  assert.match(notBuiltLine(not), /no LLD needed: the HLD says lld: not-required/);
});

// ---- T4, T6, T7 -----------------------------------------------------------------------------------

const CITED = ['backend/app/Http/Controllers/TaskController.php', 'backend/app/Policies/TaskPolicy.php', 'backend/database/migrations/2026_10_23_100000_create_tasks_table.php', 'frontend/src/components/TaskList.tsx'];
function fixture({ hld = HLD } = {}) {
  const files = { [`${D}/brief.md`]: BRIEF_READY, [`${D}/interview.md`]: INTERVIEW, [`${D}/prd.md`]: PRD_READY, [HLD_PATH]: hld, [LLD_PATH]: LLD, [ADR_PATH]: ADR };
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
async function approveUpstream(f) {
  await passReader(f, `${D}/prd.md`);
  assert.equal((await run(f, ['approve', 'due-dates-prd', '--file', `${D}/prd.md`], ['a', 'due-dates-prd', 'n'])).code, EXIT.OK);
  await passReader(f, HLD_PATH);
  veraBefore(['approve', 'ADR-0001', '--file', ADR_PATH], f.io);
  const h = await run(f, ['approve', 'due-dates-hld', '--file', HLD_PATH], ['a', 'due-dates-hld', 'n']);
  assert.equal(h.code, EXIT.OK, h.err);
}

test('63 T4: approval: refused while the HLD isn\'t approved or says not-required; then one signed line', async () => {
  const f = fixture();
  const early = await run(f, ['approve', 'due-dates-lld', '--file', LLD_PATH], ['a', 'due-dates-lld']);
  assert.equal(early.code, EXIT.BLOCKED);
  assert.match(early.err, /the HLD due-dates-hld isn't approved: the LLD builds an approved HLD/);
  await approveUpstream(f);
  const r = await run(f, ['approve', 'due-dates-lld', '--file', LLD_PATH], ['a', 'due-dates-lld', 'n']);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /^HLD:\s+due-dates-hld, approved as it is now/m);
  assert.match(r.out, /approved: the LLD due-dates-lld/);
  const lines = readJournal(f.store).events.filter((e) => e.type === 'approval' && e.kind === 'lld');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].content_hash, contentHash(Buffer.from(LLD)));
  // A hand-set status is refused at commit.
  writeFileSync(join(f.root, LLD_PATH), LLD.replace('template: lld@v1', 'template: lld@v1\nstatus: approved'));
  f.git('add', LLD_PATH);
  assert.match(documentsPreCommit({ root: f.root, env: f.env, store: f.store }).refused[0].why, /a lld keeps no status in its frontmatter/);
});

test('63 T4: approval is refused when the approved HLD says lld: not-required', async () => {
  const f = fixture({ hld: swap(HLD, 'lld: required\nlld_triggers: [entity, contract]', 'lld: not-required\nlld_reason: one table column and no new contract') });
  await approveUpstream(f);
  const r = await run(f, ['approve', 'due-dates-lld', '--file', LLD_PATH], ['a', 'due-dates-lld', 'n']);
  assert.equal(r.code, EXIT.BLOCKED);
  assert.match(r.err, /the HLD due-dates-hld says `lld: not-required`: an LLD is approved only where its HLD says it is required/);
});

test('63 T7: frozen after the ship: once every ticket is merged, a change to lld.md is refused at commit', () => {
  const f = fixture();
  const ticket = read('examples/tickets/SAMPLE-51.md');
  mkdirSync(join(f.root, D, 'tickets'), { recursive: true });
  writeFileSync(join(f.root, D, 'tickets', 'SAMPLE-51.md'), ticket);
  f.git('add', '-A');
  f.git('commit', '-qm', 'ticket');
  const change = () => {
    writeFileSync(join(f.root, LLD_PATH), `${f.text(LLD_PATH)}\n`);
    f.git('add', LLD_PATH);
    return documentsPreCommit({ root: f.root, env: f.env, store: f.store }).refused;
  };
  assert.deepEqual(change(), []);
  appendEvent(f.store, { type: 'mr_merged', by: 'script', ticket: 'SAMPLE-51', target: 'integration' });
  const refused = change();
  assert.equal(refused.length, 1);
  assert.match(refused[0].why, /a shipped initiative's LLD is frozen: all 1 of its tickets are merged/);
});

// ---- T5 ---------------------------------------------------------------------------------------------

test('63 T5: uses: an unknown ID fails the ticket lint; an item no ticket uses fails the epic', () => {
  const ticket = read('examples/tickets/SAMPLE-51.md').replace(/^type: story$/m, 'type: story\nuses: [C-1, C-9]');
  const t = lintText(ticket, { source: `${D}/tickets/SAMPLE-51.md`, registry: REGISTRY, project: { repos: ['.'] }, linked: { '../lld.md': LLD } });
  assert.deepEqual(t.filter((p) => p.code === 'ticket-uses').map((p) => p.reason), ['uses names C-9, which the initiative\'s LLD doesn\'t have']);
  const ok = lintText(ticket.replace('[C-1, C-9]', '[C-1, S-1]'), { source: `${D}/tickets/SAMPLE-51.md`, registry: REGISTRY, project: { repos: ['.'] }, linked: { '../lld.md': LLD } });
  assert.equal(ok.some((p) => p.code === 'ticket-uses'), false);
  const tickets = { 'tickets/SAMPLE-51.md': ticket.replace('[C-1, C-9]', '[C-1, S-1]') };
  for (const n of ['52', '53', '54', '55', '56', '57']) tickets[`tickets/SAMPLE-${n}.md`] = read(`examples/tickets/SAMPLE-${n}.md`);
  const epic = (linked) => lintText(read('examples/epic.md'), { source: `${D}/epic-due-dates.md`, registry: REGISTRY, project: { repos: ['.'] }, linked: { 'prd.md': PRD, ...linked }, tickets });
  assert.deepEqual(epic({ 'lld.md': LLD }).filter((p) => p.code === 'epic-lld-unused').map((p) => p.reason), ['C-2 of the LLD is in no ticket\'s uses']);
  assert.equal(epic({}).some((p) => p.code === 'epic-lld-unused'), false);
});

// ---- T6 ---------------------------------------------------------------------------------------------

test('63 T6: Kai\'s prompt with the LLD; Rex\'s prompt and bases name its items', () => {
  const p = planPrompt({ ticket: 'SAMPLE-51', fields: { ticket: 'SAMPLE-51', acs: ['AC-SAMPLE-51.1'], risk: 'normal', tdd: 'auto', tests: 'required', round: 1, ticketType: 'story' }, via: 'schema', lld: true });
  assert.match(p, /lld\.md is the approved LLD: build the contracts \(C-n\) and schema changes \(S-n\) the ticket's `uses` names exactly/);
  assert.doesNotMatch(planPrompt({ ticket: 'SAMPLE-51', fields: { ticket: 'SAMPLE-51', acs: ['AC-SAMPLE-51.1'], risk: 'normal', tdd: 'auto', tests: 'required', round: 1, ticketType: 'story' }, via: 'schema' }), /lld\.md/);
  assert.match(reviewPrompt({ ticket: 'SAMPLE-51', round: 1 }), /When lld\.md is in the input folder[^\n]*basis kind "rule" and ref that C-n or S-n, worded "differs from the LLD's C-n"/);
  // Rex's rule bases: the LLD's items, read from its text.
  assert.deepEqual(lldItemIds(LLD), ['C-1', 'C-2', 'S-1']);
  assert.deepEqual(lldItemIds('## Contracts\n\n```\n| C-7 | x |\n```\n'), []);
});

// ---- T8 ---------------------------------------------------------------------------------------------

test('63 T8: the docs name the type, uses, the freeze and the keys (34b\'s check runs in test/docs)', () => {
  const docs = readFileSync(join(REGISTRY_DIR, '..', 'docs', 'lld.md'), 'utf8');
  for (const s of ['`uses`', 'Test map', 'Retry:', 'Not applicable', 'Frozen after the ship', 'lld: required']) assert.ok(docs.includes(s), s);
  assert.match(readFileSync(join(REGISTRY_DIR, '..', 'docs', 'config.md'), 'utf8'), /`docs\.limits\.lld_words`/);
  assert.match(readFileSync(join(REGISTRY_DIR, '..', 'docs', 'pre-commit.md'), 'utf8'), /A shipped initiative's LLD/);
});

// ---- 63's P2 finding: the epic's Design decisions link each ADR at its file -----------------------

test('63 P2 fix: the epic links each ADR at its file in the ADR folder (61), and its lint agrees', async () => {
  const { adrPathFor } = await import('../../src/adr/adr.js');
  const { renderSections } = await import('../../src/lint/epic.js');
  const f = fixture();
  const path = adrPathFor({ repo: f.root, fromDir: join(f.root, D), config: {} });
  assert.equal(path('ADR-0001'), '../../decisions/ADR-0001-reminder-queue.md');
  assert.equal(path('ADR-0042'), null);
  const tickets = [{ value: { id: 'SAMPLE-51', governed_by: ['ADR-0001'], covers_fr: [] } }];
  const lines = renderSections({ track: 'full', tickets, items: [], adrPath: path }).get('Design decisions');
  assert.ok(lines.includes('- [ADR-0001](../../decisions/ADR-0001-reminder-queue.md): governs SAMPLE-51.'), lines.join('\n'));
  // Without the folder's file, the old form stays (a project with no ADR folder).
  assert.ok(renderSections({ track: 'full', tickets, items: [] }).get('Design decisions').includes('- [ADR-0001](adr/ADR-0001.md): governs SAMPLE-51.'));
});
