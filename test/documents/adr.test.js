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
import { lintPaths, lintText, projectOf } from '../../src/lint/lint.js';
import { adrSettings, adrState, listAdrs, nextAdr, renderIndex, signedCopyOf, typoFixOnly, withFields, workTreeReader } from '../../src/adr/adr.js';
import { adrInputs, relevantAdrs } from '../../src/adr/context.js';
import { recordAdrTests, readAdrTests } from '../../src/adr/evidence.js';
import { adrFolderOf } from '../../src/detect/adr.js';
import { documentsPreCommit } from '../../src/hooks/pre-commit.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { contentHash } from '../../src/sign/sign.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { traceDocuments } from '../../src/trace/documents.js';
import { planInputs } from '../../src/agent/inputs.js';
import { ADR_CONFLICT, planFrom, planPrompt } from '../../src/agent/plan.js';
import { PARK_REASONS } from '../../src/status/machines.js';
import { unparkCommand } from '../../src/run/drive.js';
import { snapshot, trustedConfig } from '../../src/trust/snapshot.js';
import { verifyInputs, verifySubject } from '../../src/verify/run.js';
import { fingerprintOf } from '../../src/docs/route.js';
import { adrInputState } from '../../src/tickets/inputs.js';
import { FAKE_TOKEN } from '../helpers/reader.js';
import { passVera, veraBefore } from '../helpers/vera.js';
import { installed } from '../tests/run-fixture.js';

// Unit 61: the ADR. No model runs: Vera's results are written to the store (helpers/vera.js), and
// a stand-in plays the planner's answer.

const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const ADR = read('examples/adr.md');
const PRD = read('examples/prd.md');
const D = 'docs/decisions';
const A1 = `${D}/ADR-0001-reminder-queue.md`;
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.split(from).join(to);
};
const codes = (problems) => problems.filter((p) => p.severity === 'error').map((p) => p.code);
const lintAdr = (text, o = {}) => lintText(text, { source: A1, registry: REGISTRY, linked: { '../mirai/due-dates/prd.md': PRD }, ...o });

// A second ADR of the same initiative, as `n` with its own title and decision.
const adrN = (n, { supersedes = null, title = `Decision number ${n} for the reminders` } = {}) => {
  let t = swap(swap(ADR, 'id: ADR-0001', `id: ADR-000${n}`), '# Send due-date reminders from a queue worker', `# ${title}`);
  if (supersedes) t = swap(t, 'initiative: due-dates\n', `initiative: due-dates\nsupersedes: ${supersedes}\n`);
  return t;
};

// An installed repo with the PRD, the ADR (proposed), your key and git name.
function fixture({ config = '', adrs = { [A1]: ADR }, extra = {} } = {}) {
  const f = installed({ config, files: { 'docs/mirai/due-dates/prd.md': PRD, ...adrs, ...extra } });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  mkdirSync(join(f.home, '.config', 'mirai'), { recursive: true });
  writeFileSync(join(f.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Test Author"\nauthor_email = "author@example.com"\n', { mode: 0o600 });
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  writeToken(f.env, FAKE_TOKEN);
  const io = { cwd: f.root, env: f.env };
  return { ...f, io, store: openStore(io), at: (rel) => join(f.root, rel), text: (rel) => readFileSync(join(f.root, rel), 'utf8') };
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
const approve = (f, id, path, answers, o) => run(f, ['approve', id, '--file', path], answers, o);
const events = (f) => readJournal(f.store).events;

// ---- T1 The lint ----------------------------------------------------------------------------------

test('61 T1: a good ADR passes; one option, no bad consequence, no gate, no Confirmation, an unknown FR: each named', () => {
  assert.deepEqual(lintAdr(ADR, { approving: true }), []);
  const one = ADR.replace(/### A nightly cron command[^]*?### A queue worker/, '### A queue worker').replace(/### Do nothing[^]*?## Decision/, '## Decision');
  assert.deepEqual(codes(lintAdr(one)), ['adr-options']);
  assert.deepEqual(codes(lintAdr(swap(ADR, '- Bad, because the deployment gains a worker process, with its own logs and its own restart.\n', ''))), ['adr-no-bad']);
  assert.deepEqual(codes(lintAdr(swap(ADR, 'gate: [hard-to-reverse, nfr]', 'gate: []'))), ['adr-gate']);
  assert.ok(codes(lintAdr(swap(ADR, 'gate: [hard-to-reverse, nfr]', 'gate: [nice-to-have]'))).includes('enum'));
  const noConf = ADR.replace(/## Confirmation\n\n[^\n]*\n\n/, '');
  assert.ok(codes(lintAdr(noConf)).includes('missing-section'));
  assert.deepEqual(codes(lintAdr(swap(ADR, 'review: each change to the reminders', 'Somebody looks at each change to the reminders'))), ['adr-confirmation']);
  assert.deepEqual(codes(lintAdr(swap(ADR, 'review: each change to the reminders sends emails as queued jobs, one per assignee, never from a request or the cron command itself.', 'check: arch-rules'))), ['adr-confirmation']);
  // A check the project has is fine.
  assert.deepEqual(codes(lintAdr(swap(ADR, 'review: each change to the reminders sends emails as queued jobs, one per assignee, never from a request or the cron command itself.', 'check: arch-rules'), { project: projectOf({ checks: { 'arch-rules': ['depcruise'] } }) })), []);
  const unknown = lintAdr(swap(ADR, 'and recorded (FR-7)', 'and recorded (FR-7, FR-99)'));
  assert.deepEqual(codes(unknown), ['unknown-id']);
  assert.match(unknown[0].reason, /FR-99 is mentioned but defined neither here nor in the prd/);
  // The Y-statement, the PRD line with an initiative, the reason a rejected ADR keeps, the length.
  assert.deepEqual(codes(lintAdr(swap(ADR, 'In the context of the daily reminder emails, facing', 'For the daily reminder emails, facing'))), ['adr-y-statement']);
  assert.deepEqual(codes(lintAdr(swap(ADR, 'PRD: [Tasks with due dates that people finish on time](../mirai/due-dates/prd.md)\n\n', ''))), ['adr-prd-link']);
  assert.deepEqual(codes(lintAdr(swap(ADR, 'status: proposed', 'status: rejected'))), ['adr-reason']);
  assert.deepEqual(codes(lintAdr(swap(ADR, 'status: proposed', 'status: superseded'))), ['adr-superseded']);
  const long = swap(ADR, '## Decision\n\n', `## Decision\n\n${'We weigh this with care. '.repeat(70)}\n\n`);
  assert.deepEqual(lintAdr(long).filter((p) => p.code === 'adr-length').map((p) => p.severity), ['warning']);
  // The id is the file's number; (open) can't be approved.
  assert.deepEqual(codes(lintAdr(ADR, { source: `${D}/ADR-0002-reminder-queue.md` })), ['adr-number']);
  assert.ok(codes(lintAdr(swap(ADR, 'because it retries each email on its own', 'because (open) — queue or cron? Asked in interview.md Q-3.'), { approving: true })).includes('adr-open-decision'));
});

// ---- T2 Immutability and superseding --------------------------------------------------------------

test('61 T2: accepted, the status is written into the file and signed; a changed Decision is refused naming "supersede it", a typo fix passes; a hand-set status is refused; a superseding ADR marks the old one superseded, both in one signed line', async () => {
  const f = fixture();
  const r = await approve(f, 'ADR-0001', A1, ['a', 'ADR-0001']);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /accepted: the ADR ADR-0001 .*it is final/);
  const accepted = f.text(A1);
  assert.match(accepted, /^status: accepted$/m);
  const line = events(f).filter((e) => e.type === 'approval' && e.kind === 'adr').at(-1);
  assert.equal(line.content_hash, contentHash(Buffer.from(accepted)));
  assert.equal(line.decision, 'accepted');
  assert.ok(line.verifier);
  assert.match(f.text(`${D}/README.md`), /\| \[ADR-0001\]\(ADR-0001-reminder-queue\.md\) \| Send due-date reminders from a queue worker \| accepted \| 2026-11-26 \| — \|/);
  f.git('add', '-A');
  f.git('commit', '-qm', 'ADR-0001 accepted', '--no-verify');
  // Approving it again is refused: it isn't proposed.
  const again = await approve(f, 'ADR-0001', A1, ['a', 'ADR-0001']);
  assert.equal(again.code, EXIT.BLOCKED);
  assert.match(again.err, /is accepted, not proposed/);

  const pre = () => documentsPreCommit({ root: f.root, env: f.env, store: f.store });
  // A changed decision: refused, naming the way out.
  writeFileSync(f.at(A1), swap(accepted, 'We chose the queue worker because', 'We chose the cron command because'));
  f.git('add', A1);
  let p = pre();
  assert.equal(p.refused.length, 1);
  assert.match(p.refused[0].why, /is accepted in HEAD, and this changes it beyond typo and link fixes/);
  assert.match(p.refused[0].hint, /supersede it, with a new ADR that has supersedes: ADR-0001/);
  assert.equal(typoFixOnly(accepted, swap(accepted, 'We chose the queue worker because', 'We chose the cron command because')).ok, false);
  // A typo fix (and a link's target) passes; it doesn't make the signature stale for the docs merge.
  const typo = swap(swap(accepted, 'operations run and watch', 'operatons run and watch'), '](../mirai/due-dates/prd.md)\n\n## Summary', '](../mirai/due-dates/prd.md#summary-for-approval)\n\n## Summary');
  writeFileSync(f.at(A1), typo);
  f.git('add', A1);
  p = pre();
  assert.deepEqual(p.refused, []);
  assert.equal(adrState({ events: events(f), path: A1, bytes: Buffer.from(typo), approvedTextOf: signedCopyOf(f.store) }).state, 'typo-fix');
  writeFileSync(f.at(A1), accepted);
  f.git('add', A1);

  // A status set by hand: refused (Jet's "A": only MIRAI writes it).
  const A2 = `${D}/ADR-0002-reminder-cron.md`;
  writeFileSync(f.at(A2), swap(adrN(2, { title: 'Send due-date reminders from the cron command' }), 'status: proposed', 'status: accepted'));
  f.git('add', A2);
  p = pre();
  assert.equal(p.refused.length, 1);
  assert.match(p.refused[0].why, /an ADR's status is written only by MIRAI, at your signature \(status: accepted\)/);
  assert.match(p.refused[0].hint, /write status: proposed/);

  // Superseding: the new ADR, approved, marks the old one superseded, in one signed line.
  writeFileSync(f.at(A2), adrN(2, { supersedes: 'ADR-0001', title: 'Send due-date reminders from the cron command' }));
  f.git('add', A2);
  assert.deepEqual(pre().refused, []);
  const s = await approve(f, 'ADR-0002', A2, ['a', 'ADR-0002']);
  assert.equal(s.code, EXIT.OK, s.err);
  assert.match(s.out, /supersedes: ADR-0001 \(Send due-date reminders from a queue worker\): accepting this marks it superseded/);
  assert.match(s.out, /ADR-0001 is now superseded by it/);
  const old = f.text(A1);
  assert.match(old, /^status: superseded$/m);
  assert.match(old, /^superseded_by: ADR-0002$/m);
  const two = events(f).filter((e) => e.type === 'approval' && e.kind === 'adr').at(-1);
  assert.equal(two.item, 'ADR-0002');
  assert.deepEqual(two.files, [{ path: A1, content_hash: contentHash(Buffer.from(old)) }]);
  assert.match(f.text(`${D}/README.md`), /\| \[ADR-0001\]\(ADR-0001-reminder-queue\.md\) \| Send due-date reminders from a queue worker \| superseded \| 2026-11-26 \| \[ADR-0002\]\(ADR-0002-reminder-cron\.md\) \|/);
  // Both files are as you signed them: the pre-commit hook lets them through.
  f.git('add', '-A');
  assert.deepEqual(pre().refused, []);
  // The lint: a supersedes that names a proposed ADR is refused.
  const s3 = await run(f, ['adr', 'new', 'third', '--initiative', 'due-dates', '--supersedes', 'ADR-0001'], []);
  assert.equal(s3.code, EXIT.BLOCKED);
  assert.match(s3.err, /ADR-0001 is superseded: only an accepted ADR is superseded/);
});

test('61 T2b: a rejection needs a reason, which stays in the file; the rejected ADR stays in the folder and the index', async () => {
  const f = fixture();
  const empty = await approve(f, 'ADR-0001', A1, ['r', '']);
  assert.equal(empty.code, EXIT.USAGE);
  assert.match(empty.err, /a rejected ADR keeps your reason; nothing was written/);
  const r = await approve(f, 'ADR-0001', A1, ['r', 'the worker is too much to run for now', 'ADR-0001']);
  assert.equal(r.code, EXIT.OK, r.err);
  const text = f.text(A1);
  assert.match(text, /^status: rejected$/m);
  assert.match(text, /^status_reason: the worker is too much to run for now$/m);
  assert.deepEqual(lintAdr(text, { source: A1 }), []);
  const line = events(f).filter((e) => e.type === 'approval' && e.kind === 'adr').at(-1);
  assert.equal(line.decision, 'rejected');
  assert.equal(line.reason, 'the worker is too much to run for now');
  assert.match(f.text(`${D}/README.md`), /\| rejected \|/);
});

// ---- T3 The cap -----------------------------------------------------------------------------------

test('61 T3: three ADRs on one standard initiative: Vera sees them with the track; her must-fix scope decision naming one lets you sign, and the signed line names it in vera_open', async () => {
  const A2 = `${D}/ADR-0002-two.md`;
  const A3 = `${D}/ADR-0003-three.md`;
  const f = fixture({ adrs: { [A1]: ADR, [A2]: adrN(2), [A3]: adrN(3) } });
  const s = verifySubject({ cwd: f.root, env: f.env, file: A3 });
  const adrs = verifyInputs(s).files['adrs.md'].text;
  assert.match(adrs, /Track: standard\. The cap: 2 ADRs on standard, 3 on full, this one included\./);
  assert.match(adrs, /- ADR-0001 \(proposed\)/);
  assert.match(adrs, /- ADR-0003 \(proposed, the one you check\)/);
  assert.match(verifyInputs(s).files['checklist.md'].text, /\[vera\] The cap/);
  const cap = { id: 'V-1', grade: 'must-fix', layer: 'checklist', kind: 'decision', decision_type: 'scope', kind_reason: 'the owner decides whether a third ADR is worth it', fix: 'Make it a line in the technical note, or keep it.', where: { file: 'document.md', line: 16, quote: 'Decision number 3 for the reminders' }, what: 'The initiative has 3 ADRs on standard, past the cap of 2: ADR-0003 could be a line in the technical note.' };
  passVera(f, A3, { findings: [cap] });
  const r = await approve(f, 'ADR-0003', A3, ['a', 'ADR-0003'], { vera: false });
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /a decision only you can make/i);
  const line = events(f).filter((e) => e.type === 'approval' && e.kind === 'adr').at(-1);
  assert.deepEqual(line.vera_open, [fingerprintOf(cap)]);
});

// ---- T4 Confirmation in trace ---------------------------------------------------------------------

test('61 T4: trace follows each Confirmation: a check that isn\'t in [checks] is missing, one that is links; a test is pending until a ticket ships, then missing or linked; review links', () => {
  const s = adrSettings({});
  const with_ = (line) => {
    const text = swap(swap(ADR, 'status: proposed', 'status: accepted'), 'review: each change to the reminders sends emails as queued jobs, one per assignee, never from a request or the cron command itself.', line);
    return listAdrs({ list: () => ['ADR-0001-reminder-queue.md'], read: () => Buffer.from(text) }, s);
  };
  const trace = (adrs, o = {}) => traceDocuments({ initiative: 'due-dates', registry: REGISTRY, prd: { path: 'docs/mirai/due-dates/prd.md', text: PRD }, adrs, ...o });
  const adrLinks = (t) => t.links.filter((l) => l.from === 'ADR-0001').map((l) => [l.state, l.to ?? l.what]);
  // check:
  let t = trace(with_('check: arch-rules'), { checks: [] });
  assert.deepEqual(adrLinks(t), [['missing', 'ADR-0001\'s Confirmation names the check arch-rules, which isn\'t in the project\'s [checks]']]);
  t = trace(with_('check: arch-rules'), { checks: ['arch-rules'] });
  assert.deepEqual(adrLinks(t), [['pass', 'check: arch-rules']]);
  // test: nothing shipped yet → pending, never missing; shipped without the test → missing; with it → linked.
  t = trace(with_('test: ADR-0001'), { checks: [], adrTests: { shipped: [], names: [] } });
  assert.deepEqual(adrLinks(t), [['pending', 'ADR-0001\'s test isn\'t seen yet: no ticket of the initiative has passed the gate']]);
  assert.equal(t.missing.some((m) => m.id === 'ADR-0001'), false);
  t = trace(with_('test: ADR-0001'), { checks: [], adrTests: { shipped: ['SAMPLE-51'], names: ['test_adr_0002_other'] } });
  assert.match(adrLinks(t)[0][1], /no test named for ADR-0001 passed in the gate's results \(1 ticket shipped\): name one test_adr_0001_…/);
  t = trace(with_('test: ADR-0001'), { checks: [], adrTests: { shipped: ['SAMPLE-51'], names: ['Tests\\ReminderTest::test_adr_0001_each_email_is_its_own_job'] } });
  assert.deepEqual(adrLinks(t), [['pass', 'test: Tests\\ReminderTest::test_adr_0001_each_email_is_its_own_job']]);
  // review:
  t = trace(with_('review: each change keeps the emails in the queue worker'), { checks: [] });
  assert.deepEqual(adrLinks(t), [['pass', 'review: each change keeps the emails in the queue worker (the reviewer checks it)']]);
  // The "no ADRs yet" note is gone; without the ADRs read, trace says so.
  assert.equal(trace([]).notes.some((n) => /no ADRs yet/.test(n)), false);
  assert.ok(trace(null).notes.some((n) => /the ADRs weren't read here/.test(n)));
  // The gate's side: only passed tests that name an ADR are kept.
  const f = fixture();
  recordAdrTests(f.store, 'SAMPLE-51', 'a'.repeat(40), [{ name: 'test_adr_0001_queue', outcome: 'pass', level: 'unit' }, { name: 'test_adr_0001_fails', outcome: 'fail' }, { name: 'test_other', outcome: 'pass' }]);
  assert.deepEqual(readAdrTests(f.store, ['SAMPLE-51', 'SAMPLE-52']), { shipped: ['SAMPLE-51'], names: ['test_adr_0001_queue'] });
});

// ---- T5 The index ---------------------------------------------------------------------------------

test('61 T5: the index is rendered from the files; a hand edit is a lint problem; mirai adr index renders it again; a superseded ADR shows its successor', async () => {
  const f = fixture();
  const s = adrSettings({});
  const index = renderIndex(listAdrs(workTreeReader(f.root), s));
  assert.match(index, /^<!-- MIRAI renders this file/);
  assert.match(index, /\| \[ADR-0001\]\(ADR-0001-reminder-queue\.md\) \| Send due-date reminders from a queue worker \| proposed \| 2026-11-26 \| — \|/);
  const lint = () => lintPaths({ root: f.root, paths: [f.at(D)], registry: REGISTRY, docsRoot: 'docs/mirai' }).problems.filter((p) => p.code?.startsWith('adr-index'));
  assert.deepEqual(lint().map((p) => p.code), ['adr-index-missing']);
  const r = await run(f, ['adr', 'index'], []);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /wrote: docs\/decisions\/README\.md/);
  assert.deepEqual(lint(), []);
  writeFileSync(f.at(`${D}/README.md`), `${f.text(`${D}/README.md`)}| [ADR-0009](x.md) | made up | accepted | — | — |\n`);
  assert.deepEqual(lint().map((p) => [p.code, p.hint]), [['adr-index', 'MIRAI renders it: mirai adr index']]);
  assert.match((await run(f, ['adr', 'index'], [])).out, /rendered again/);
  assert.deepEqual(lint(), []);
  // A superseded ADR links its successor.
  const sup = listAdrs({ list: () => ['ADR-0001-a.md', 'ADR-0002-b.md'], read: (p) => Buffer.from(p.endsWith('0001-a.md') ? withFields(ADR, { status: 'superseded', superseded_by: 'ADR-0002' }) : adrN(2, { supersedes: 'ADR-0001' })) }, s);
  assert.match(renderIndex(sup), /\| superseded \| 2026-11-26 \| \[ADR-0002\]\(ADR-0002-b\.md\) \|/);
});

// ---- T6 The project's own ADRs ---------------------------------------------------------------------

test('61 T6: a repo with its own docs/decisions/adr-0001-x.md: detect drafts the folder and numbering; the next ADR is adr-0002-…; the old one is indexed as it is, never changed', async () => {
  // Thudos's shapes: the number in the title, the status as a bullet, and the folder's own README.
  const OWN = '# ADR-0001: Use PostgreSQL\n\n- Status: Accepted\n- Date: 2026-08-05\n\n## Context\n\nWe need a database.\n\n## Decision\n\nPostgreSQL.\n';
  const README = '# Engineering Decisions\n\nStore accepted ADRs here.\n';
  assert.deepEqual(adrFolderOf(new Map([['docs/decisions/adr-0001-use-postgres.md', {}], ['docs/decisions/README.md', {}], ['src/a.js', {}]])), { folder: 'docs/decisions', numbering: 'adr-0001', files: 1 });
  assert.equal(adrFolderOf(['src/a.js']), null);
  const f = fixture({ config: '\n[adr]\nfolder = "docs/decisions"\nnumbering = "adr-0001"\n', adrs: { 'docs/decisions/adr-0001-use-postgres.md': OWN, 'docs/decisions/README.md': README } });
  const s = adrSettings(trustedConfig(snapshot(f.io)));
  assert.deepEqual([s.folder, s.prefix, s.width], ['docs/decisions', 'adr-', 4]);
  const adrs = listAdrs(workTreeReader(f.root), s);
  assert.deepEqual(adrs.map((a) => [a.id, a.title, a.status, a.mirai]), [['adr-0001', 'Use PostgreSQL', 'accepted', false]]);
  assert.equal(nextAdr(adrs, s, 'reminder-queue').path, 'docs/decisions/adr-0002-reminder-queue.md');
  const r = await run(f, ['adr', 'new', 'reminder-queue', '--initiative', 'due-dates'], []);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /wrote: docs\/decisions\/adr-0002-reminder-queue\.md \(adr-0002, proposed\), for the initiative due-dates/);
  const made = f.text('docs/decisions/adr-0002-reminder-queue.md');
  assert.match(made, /^id: adr-0002$/m);
  assert.match(made, /^status: proposed$/m);
  assert.match(made, /^upstream: \[due-dates-prd\]$/m);
  assert.match(made, /^PRD: \[Tasks with due dates that people finish on time\]\(\.\.\/mirai\/due-dates\/prd\.md\)$/m);
  // The old one is untouched, and indexed as it is.
  assert.equal(f.text('docs/decisions/adr-0001-use-postgres.md'), OWN);
  // Its README is its own: the index goes to index.md, and the README is never rewritten.
  const idx = await run(f, ['adr', 'index'], []);
  assert.match(idx.out, /wrote: docs\/decisions\/index\.md; commit it with the ADRs \(the folder's README\.md is your own, so MIRAI leaves it as it is\)/);
  assert.equal(f.text('docs/decisions/README.md'), README);
  assert.match(f.text('docs/decisions/index.md'), /\| \[adr-0001\]\(adr-0001-use-postgres\.md\) \| Use PostgreSQL \| accepted \| 2026-08-05 \| — \|/);
  // The lint leaves a project's own ADR alone (no MIRAI frontmatter), and the new one is linted.
  const problems = lintPaths({ root: f.root, paths: [f.at('docs/decisions')], registry: REGISTRY, docsRoot: 'docs/mirai', project: projectOf(trustedConfig(snapshot(f.io))) }).problems;
  assert.equal(problems.some((p) => p.file === 'docs/decisions/adr-0001-use-postgres.md'), false);
  assert.ok(problems.some((p) => p.file === 'docs/decisions/adr-0002-reminder-queue.md' && p.code === 'template-text'));
});

// ---- T7 Agents' context ---------------------------------------------------------------------------

test('61 T7: a ticket\'s plan inputs hold the index, the accepted ADRs that touch it and the last three, never a rejected or superseded one in full; a plan that goes against one parks adr-conflict', () => {
  const s = adrSettings({});
  const mk = (n, status, o = {}) => {
    let t = withFields(adrN(n, { title: `Decision ${n}` }), { status, ...(status === 'superseded' ? { superseded_by: 'ADR-0007' } : {}), ...(status === 'rejected' ? { status_reason: 'not now' } : {}), initiative: o.initiative ?? 'other' });
    if (o.components) t = withFields(t, { components: null }).replace('initiative:', `components: [${o.components}]\ninitiative:`);
    return t;
  };
  const files = {
    'ADR-0001-a.md': mk(1, 'accepted', { components: 'billing' }),
    'ADR-0002-b.md': mk(2, 'accepted', { initiative: 'due-dates' }),
    'ADR-0003-c.md': mk(3, 'rejected', { initiative: 'due-dates' }),
    'ADR-0004-d.md': mk(4, 'superseded'),
    'ADR-0005-e.md': mk(5, 'accepted'),
    'ADR-0006-f.md': mk(6, 'accepted'),
    'ADR-0007-g.md': mk(7, 'accepted'),
    'ADR-0008-h.md': mk(8, 'proposed'),
  };
  const adrs = listAdrs({ list: () => Object.keys(files), read: (p) => Buffer.from(files[p.split('/').at(-1)]) }, s);
  const picked = (o) => relevantAdrs(adrs, o).map((x) => x.adr.id);
  // The initiative's accepted one, the one whose component the ticket names, the last three.
  assert.deepEqual(picked({ initiative: 'due-dates', text: 'Bill the team for reminders: billing' }), ['ADR-0001', 'ADR-0002', 'ADR-0005', 'ADR-0006', 'ADR-0007']);
  assert.deepEqual(picked({ initiative: 'x', governedBy: ['ADR-0001'] }), ['ADR-0001', 'ADR-0005', 'ADR-0006', 'ADR-0007']);
  const inputs = adrInputs(adrs, { initiative: 'due-dates' });
  assert.equal(inputs[0].name, 'adr-index.md');
  assert.match(inputs[0].text, /\| \[ADR-0003\]\(ADR-0003-c\.md\) \| Decision 3 \| rejected \|/);
  const full = inputs.slice(1).map((x) => x.name);
  for (const never of ['adr-adr-0003.md', 'adr-adr-0004.md', 'adr-adr-0008.md']) assert.equal(full.includes(never), false, never);
  // From the integration branch's commit, in a real ticket's plan inputs.
  const ticket = `---\nid: SAMPLE-51\ntype: story\ntemplate: story@v1\nrepo: "."\nepic: SAMPLE-50\ncovers_fr: [FR-4]\ngoverned_by: [ADR-0001]\n---\n# Reminders go out\n\n## Acceptance criteria\n\n- AC-SAMPLE-51.1: one email\n`;
  const f = fixture({ adrs: Object.fromEntries(Object.entries(files).map(([n, t]) => [`${D}/${n}`, t])), extra: { 'docs/mirai/due-dates/tickets/SAMPLE-51.md': ticket } });
  const trust = snapshot(f.io);
  const given = planInputs({ root: f.root, env: f.env, commit: trust.baseSha, ticketId: 'SAMPLE-51', config: trustedConfig(trust), store: f.store });
  const names = given.index.files.map((x) => x.name);
  for (const n of ['adr-index.md', 'adr-adr-0001.md', 'adr-adr-0002.md', 'adr-adr-0005.md', 'adr-adr-0006.md', 'adr-adr-0007.md']) assert.ok(names.includes(n), n);
  for (const n of ['adr-adr-0003.md', 'adr-adr-0004.md', 'adr-adr-0008.md']) assert.equal(names.includes(n), false, n);
  assert.equal(given.index.left_out.some((x) => x.id === 'ADR-0001'), false);
  // The rules in Kai's prompt, and the conflict line: parked adr-conflict, with the way out.
  const prompt = planPrompt({ ticket: 'SAMPLE-51', fields: { ticket: 'SAMPLE-51', acs: ['AC-SAMPLE-51.1'], risk: 'normal', tdd: 'auto', tests: 'required', round: 1, ticketType: 'story' }, via: 'schema' });
  assert.match(prompt, /An accepted ADR is binding/);
  assert.match(prompt, /ADR-CONFLICT: <the ADR's id>: <why/);
  assert.deepEqual(planFrom({ structured: { plan: 'ADR-CONFLICT: ADR-0002: the ticket asks for a cron job, and ADR-0002 chose the queue worker' } }).conflict, { adr: 'ADR-0002', why: 'the ticket asks for a cron job, and ADR-0002 chose the queue worker' });
  assert.ok(ADR_CONFLICT.test('ADR-CONFLICT: adr-0002: why'));
  assert.ok(PARK_REASONS.includes('adr-conflict'));
  assert.match(unparkCommand('SAMPLE-51', 'adr-conflict'), /mirai unpark SAMPLE-51 --retry \(back to ready-for-dev, after you change the ticket or supersede the ADR/);
});

// ---- T8 Review ------------------------------------------------------------------------------------

test('61 T8: mirai adr review lists the ADRs in force with their triggers; marks one deprecated with your reason, written into it, signed and logged; another still true', async () => {
  const A2 = `${D}/ADR-0002-two.md`;
  const f = fixture({ adrs: { [A1]: ADR, [A2]: adrN(2) } });
  for (const [id, p] of [['ADR-0001', A1], ['ADR-0002', A2]]) assert.equal((await approve(f, id, p, ['a', id])).code, EXIT.OK);
  const list = await run(f, ['adr', 'review', '--list'], []);
  assert.equal(list.code, EXIT.OK, list.err);
  assert.match(list.out, /the ADRs in force \(2\)/);
  assert.match(list.out, /revisit when: The queue's backlog stays over 1,000 jobs for a day\./);
  const r = await run(f, ['adr', 'review'], ['d', 'the reminders moved to the mail provider', 'k', 'ADR-0001']);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /deprecated: ADR-0001 \(signed with /);
  assert.match(r.out, /^still true: ADR-0002 \(signed with /m);
  const text = f.text(A1);
  assert.match(text, /^status: deprecated$/m);
  assert.match(text, /^status_reason: the reminders moved to the mail provider$/m);
  const lines = events(f).filter((e) => e.type === 'adr_review');
  assert.deepEqual(lines.map((e) => [e.item, e.verdict, e.reason ?? null]), [['ADR-0001', 'deprecated', 'the reminders moved to the mail provider'], ['ADR-0002', 'still-true', null]]);
  assert.equal(lines[0].content_hash, contentHash(Buffer.from(text)));
  assert.match(f.text(`${D}/README.md`), /\| \[ADR-0001\]\(ADR-0001-reminder-queue\.md\) \| Send due-date reminders from a queue worker \| deprecated \|/);
  // Its bytes are signed: the pre-commit hook lets the deprecated file through.
  f.git('add', '-A');
  assert.deepEqual(documentsPreCommit({ root: f.root, env: f.env, store: f.store }).refused, []);
  // A deprecation needs a reason.
  const none = await run(f, ['adr', 'review', 'ADR-0002'], ['d', '']);
  assert.equal(none.code, EXIT.USAGE);
});

// ---- T9 Overlay -----------------------------------------------------------------------------------

test('61 T9: a project\'s ADR overlay with a rename map ("Validation" for "Confirmation") is linted by its local names', () => {
  const fs = new Map([['document-types/adr.toml', Buffer.from('kind = "document-type-overlay"\nschema_version = 1\nname = "adr"\n\n[[rename]]\nfrom = "Confirmation"\nto = "Validation"\n')]]);
  const overlays = readOverlays(fs, REGISTRY);
  assert.deepEqual(overlays.flatMap((o) => o.problems), []);
  const registry = applyOverlays(REGISTRY, fs, overlays.map((o) => ({ type: 'approval', by: 'human', kind: 'overlay', path: o.path, content_hash: o.hash, decision: 'accepted', seq: 1 }))).registry;
  const local = swap(ADR, '## Confirmation', '## Validation');
  assert.deepEqual(lintText(local, { source: A1, registry, linked: { '../mirai/due-dates/prd.md': PRD } }).filter((p) => p.severity === 'error'), []);
  // The renamed section's checks still run under its local name.
  const bad = swap(local, 'review: each change to the reminders sends', 'Somebody checks that each change sends');
  assert.deepEqual(codes(lintText(bad, { source: A1, registry, linked: { '../mirai/due-dates/prd.md': PRD } })), ['adr-confirmation']);
  // MIRAI's own name is now the project's mistake.
  assert.ok(codes(lintText(ADR, { source: A1, registry, linked: { '../mirai/due-dates/prd.md': PRD } })).length > 0);
});

// ---- The ticket planner's input, the docs merge's gaps ------------------------------------------------

test('61: the initiative\'s ADRs as the ticket planner\'s input: none needs none; a proposed one blocks, naming it; decided ones pass', async () => {
  const f = fixture();
  const config = trustedConfig(snapshot(f.io));
  assert.deepEqual(adrInputState({ store: f.store, config, initiative: 'other' }), { type: 'adr', state: 'approved', id: null, shown: null, none: true });
  assert.deepEqual(adrInputState({ store: f.store, config, initiative: 'due-dates' }), { type: 'adr', state: 'unapproved', id: 'ADR-0001', shown: A1, stale: false });
  assert.equal((await approve(f, 'ADR-0001', A1, ['a', 'ADR-0001'])).code, EXIT.OK);
  assert.equal(adrInputState({ store: f.store, config, initiative: 'due-dates' }).state, 'approved');
});

// ---- T10 The docs check -------------------------------------------------------------------------------

test('61 T10: the docs name the adr command, its session commands, the [adr] keys and the type (34b\'s check runs in test/docs)', () => {
  const docs = readFileSync(join(REGISTRY_DIR, '..', 'docs', 'adr.md'), 'utf8');
  for (const s of ['mirai adr new', 'mirai adr review', 'mirai adr index', 'mirai approve <adr-id>', '`[adr] folder`', 'ADR-CONFLICT']) assert.ok(docs.includes(s), s);
  const config = readFileSync(join(REGISTRY_DIR, '..', 'docs', 'config.md'), 'utf8');
  assert.match(config, /\| `adr\.folder` \| project \| `docs\/decisions` \|/);
});
