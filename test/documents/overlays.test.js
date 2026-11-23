import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BUILT_IN_CHECKS, loadRegistry } from '../../src/config/registry.js';
import { ConfigError } from '../../src/cli/errors.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { lintText } from '../../src/lint/lint.js';
import { applyOverlays, readOverlays, renderTemplate } from '../../src/config/overlays.js';
import { checkAnswers, summarySection, summaryText } from '../../src/write/reader.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { contentHash } from '../../src/sign/sign.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { snapshot } from '../../src/trust/snapshot.js';
import { overlaysCheck } from '../../src/doctor/checks.js';
import { installed } from '../tests/run-fixture.js';
import { passReader, quotesFrom } from '../helpers/reader.js';
import { veraBefore } from '../helpers/vera.js';

// Unit 37: the protected parts of each document type, section overlays, replacement templates,
// their approval, and what reads them only from the trust root.
const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const BRIEF = read('examples/brief.md');
const PRD = read('examples/prd.md');
const INTERVIEW = read('examples/interview.md');
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.split(from).join(to);
};
const files = (obj) => new Map(Object.entries(obj).map(([k, v]) => [k, Buffer.from(v)]));
// An approval line as `mirai approve --file` writes it for overlay `o` (the tests that don't sign).
const approvedLine = (o, extra = {}) => ({ type: 'approval', by: 'human', kind: 'overlay', path: o.path, content_hash: o.hash, ...(o.bound.length ? { files: o.bound } : {}), decision: 'accepted', seq: 1, ...extra });
const approveAll = (fs, registry = REGISTRY) => readOverlays(fs, registry).map((o) => approvedLine(o));
const problemsOf = (fs, registry = REGISTRY) => readOverlays(fs, registry).flatMap((o) => o.problems);

// The overlays the tests use: the brief gains "Data privacy" after "Problem"; the PRD calls its
// summary "Executive summary" and its "Not in this" part "Out of scope", and gains two sections.
const HEAD = (type) => `kind = "document-type-overlay"\nschema_version = 1\nname = "${type}"\n`;
const BRIEF_OVERLAY = `${HEAD('brief')}\n[[add]]\nname = "Data privacy"\nafter = "Problem"\n`;
const BRIEF_FRAGMENT = '## Data privacy\n\n<!-- done when: each kind of personal data is named, with who may see it -->\nWhat personal data the feature reads or keeps, and who may see it.\n';
const PRIVACY = '## Data privacy\n\nDue dates hold no personal data. Reminder emails go to the task owner only, from the address the app already has.\n\n';
const PRD_OVERLAY = `${HEAD('prd')}\n[[rename]]\nfrom = "Summary for approval"\nto = "Executive summary"\n\n[[rename]]\nfrom = "Not in this"\nto = "Out of scope"\n\n[[add]]\nname = "Data privacy"\nafter = "User journeys"\n\n[[add]]\nname = "Security sign-off"\nafter = "Glossary"\n`;
const PRD_FRAGMENT = '## Data privacy\n\n<!-- done when: each kind of personal data is named, with who may see it -->\nWhat personal data the feature reads or keeps.\n\n## Security sign-off\n\n<!-- done when: the reviewer and the date are named -->\nWho signed off the security review, and when.\n';
const renamed = (text) => swap(swap(text, '## Summary for approval', '## Executive summary'), '### Not in this', '### Out of scope');
const SIGN_OFF = '\n\n## Security sign-off\n\nThe security lead signed off the reminder emails on 2026-11-20.\n';
const COMPANY_PRD = (text) => `${swap(renamed(text), '## Functional requirements', `${PRIVACY}## Functional requirements`).replace(/\n+$/, '')}${SIGN_OFF}`;
const lintWith = (registry, text, file = 'docs/mirai/due-dates/prd.md', o = {}) => lintText(text, { source: file, registry, project: { repos: ['.'] }, linked: { 'brief.md': BRIEF, 'interview.md': INTERVIEW }, ...o }).filter((p) => p.severity === 'error');

// A copy of MIRAI's registry to change, as a MIRAI update would.
function registryCopy(change = () => {}) {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'mirai-37-'))), 'registry');
  cpSync(REGISTRY_DIR, dir, { recursive: true });
  change(dir);
  return dir;
}
const edit = (path, from, to) => writeFileSync(path, swap(readFileSync(path, 'utf8'), from, to));

test('37 T1: every built-in type declares its protected parts; a type whose check reads an unprotected section is refused', () => {
  for (const [name, def] of Object.entries(REGISTRY.documentTypes)) {
    assert.ok(def.protected_sections?.length > 0, `${name} declares protected sections`);
    for (const p of [...def.protected_sections, ...(def.protected_fields ?? [])]) assert.ok(p.read_by.length > 0, `${name}: ${p.name ?? p.link} names what reads it`);
  }
  const names = (type) => REGISTRY.documentTypes[type].protected_sections.map((p) => p.name);
  const fields = (type) => REGISTRY.documentTypes[type].protected_fields.map((p) => p.name ?? `link:${p.link}`);
  // Decision 5, for a PRD: the summary, the FR, AC and NFR sections, "Not in this", the Brief: link,
  // track and variant. The reader test's parts (34) and the brief's Interview: link (35).
  for (const n of ['Summary for approval', 'Functional requirements', 'Non-functional requirements', 'Not in this', 'Decisions for you']) assert.ok(names('prd').includes(n), n);
  assert.deepEqual(fields('prd'), ['track', 'variant', 'link:Brief']);
  assert.ok(fields('brief').includes('link:Interview'));
  assert.ok(REGISTRY.documentTypes.prd.protected_sections.find((p) => p.name === 'Not in this').read_by.includes('reader-test'));
  assert.ok(names('story').includes('Acceptance criteria') && names('bug').includes('Acceptance criteria'));
  assert.deepEqual(names('plan').slice(0, 3), ['Intent', 'Boundaries', 'Edge cases']);
  // The context types, as 36 built them.
  assert.ok(['Sources', 'What the product does', 'Business rules'].every((n) => names('business').includes(n)));
  assert.deepEqual(names('journeys'), ['Journeys', 'Sources']);
  assert.deepEqual(names('feature-map'), ['Screens']);
  assert.deepEqual([...names('project')].sort(), ['Commands', 'Instructions', 'Layout', 'Stack', 'Test levels']);
  assert.deepEqual(names('conventions'), ['Rules']);
  assert.ok(BUILT_IN_CHECKS.every((c) => typeof c === 'string'));

  // A copy whose PRD no longer protects "Not in this": refused, naming it and what reads it.
  const dir = registryCopy((d) => edit(join(d, 'document-types/prd.toml'), '[[protected_sections]]\nname = "Not in this"\nread_by = ["approval", "reader-test", "lint"]\n', ''));
  assert.throws(() => loadRegistry(dir), (e) => e instanceof ConfigError && e.errors.some((x) => x.code === 'unprotected' && /"Not in this" is read by the summary check, so it must be in protected_sections/.test(x.reason)));
  // A protected entry that names nothing the type has is refused too.
  const odd = registryCopy((d) => edit(join(d, 'document-types/journeys.toml'), 'name = "Journeys"\nread_by = ["lint"]', 'name = "Journeys"\nread_by = ["lint"]\n\n[[protected_sections]]\nname = "Nowhere"\nread_by = ["lint"]'));
  assert.throws(() => loadRegistry(odd), (e) => e.errors.some((x) => x.code === 'unknown-section'));
});

test('37 T2: a section overlay: added, reordered and renamed sections reach the template, the lint, the summary check, the reader test and approval; a MIRAI template bump still reaches the project', async () => {
  // Added after "Problem": in the rendered template, and the lint requires it.
  const brief = files({ 'document-types/brief.toml': BRIEF_OVERLAY, 'templates/brief.md': BRIEF_FRAGMENT });
  const b = applyOverlays(REGISTRY, brief, approveAll(brief));
  assert.deepEqual(b.skipped, []);
  const t = b.registry.documentTypes.brief.template_text;
  assert.ok(t.indexOf('## Problem') < t.indexOf('## Data privacy') && t.indexOf('## Data privacy') < t.indexOf('## Who it is for'), t);
  assert.match(t, /## Data privacy\n\n<!-- done when: each kind of personal data is named, with who may see it -->\nWhat personal data the feature reads or keeps/);
  assert.deepEqual(lintWith(REGISTRY, BRIEF, 'docs/mirai/due-dates/brief.md'), []);
  const missing = lintWith(b.registry, BRIEF, 'docs/mirai/due-dates/brief.md');
  assert.deepEqual(missing.map((p) => p.code), ['missing-section'], JSON.stringify(missing));
  assert.match(missing[0].reason, /Data privacy/);
  assert.deepEqual(lintWith(b.registry, swap(BRIEF, '## Who it is for', `${PRIVACY}## Who it is for`), 'docs/mirai/due-dates/brief.md'), []);

  // Reordered: "Why now" before "Who it is for", in the template and the lint.
  const order = ['Summary for approval', 'Problem', 'Why now', 'Who it is for', 'Success', 'Business requirements', 'Appetite and track', 'No-gos', 'Rabbit holes', 'Hard questions', 'Sources', 'Open questions'];
  const ord = files({ 'document-types/brief.toml': `${HEAD('brief')}order = ${JSON.stringify(order)}\n` });
  const o = applyOverlays(REGISTRY, ord, approveAll(ord)).registry;
  assert.ok(o.documentTypes.brief.template_text.indexOf('## Why now') < o.documentTypes.brief.template_text.indexOf('## Who it is for'));
  assert.ok(lintWith(o, BRIEF, 'docs/mirai/due-dates/brief.md').some((p) => p.code === 'section-order'));

  // Renamed: "Executive summary" passes the summary check and the whole lint; MIRAI's own name now
  // fails; the template shows the project's names.
  const prd = files({ 'document-types/prd.toml': PRD_OVERLAY, 'templates/prd.md': PRD_FRAGMENT });
  const p = applyOverlays(REGISTRY, prd, approveAll(prd)).registry;
  const def = p.documentTypes.prd;
  assert.deepEqual(def.renames, { 'Summary for approval': 'Executive summary', 'Not in this': 'Out of scope' });
  assert.match(def.template_text, /^## Executive summary$/m);
  assert.match(def.template_text, /^### Out of scope$/m);
  assert.doesNotMatch(def.template_text, /^## Summary for approval$/m);
  assert.ok(def.template_text.indexOf('## Glossary') < def.template_text.indexOf('## Security sign-off'));
  assert.deepEqual(lintWith(p, COMPANY_PRD(PRD)), []);
  const old = lintWith(p, `${swap(PRD, '## Functional requirements', `${PRIVACY}## Functional requirements`).replace(/\n+$/, '')}${SIGN_OFF}`);
  assert.ok(old.some((x) => x.code === 'renamed-section' && /"Summary for approval" is called "Executive summary" in this project/.test(x.reason)), JSON.stringify(old));
  // A problem names the section as the project calls it.
  const empty = lintWith(p, swap(COMPANY_PRD(PRD), /### Out of scope\n\n([\s\S]*?)\n## User journeys/.exec(COMPANY_PRD(PRD))[0], '### Out of scope\n\n## User journeys'));
  assert.ok(empty.some((x) => /"### Out of scope" is empty/.test(x.reason)), JSON.stringify(empty));
  // The reader test's section lookup reads the project's names.
  const summary = summaryText(COMPANY_PRD(PRD), def.renames);
  assert.match(summary, /^### Out of scope$/m);
  assert.equal(summaryText(COMPANY_PRD(PRD)), null, 'without the map there is no summary for approval');
  assert.ok(summarySection(summary, 'Not in this', def.renames).trim().length > 0);
  const answers = quotesFrom(summary.replace('### Out of scope', '### Not in this'));
  assert.equal(checkAnswers(summary, answers, def.renames).pass, true);
  assert.equal(checkAnswers(summary, answers).pass, false, 'MIRAI\'s name alone doesn\'t find the part');

  // A MIRAI template version bump (a new section in MIRAI's PRD) reaches the project, overlay applied.
  const bumped = loadRegistry(registryCopy((d) => {
    edit(join(d, 'document-types/prd.toml'), 'template_version = 1', 'template_version = 2');
    edit(join(d, 'document-types/prd.toml'), 'optional_sections = ["Key flows", "Risks", "Dependencies", "Rollout"]', 'optional_sections = ["Key flows", "Risks", "Dependencies", "Rollout", "Rollback"]');
    edit(join(d, 'document-types/prd.toml'), '"Rollout", "Assumptions"', '"Rollout", "Rollback", "Assumptions"');
    edit(join(d, 'templates/prd.md'), '## Assumptions', '## Rollback\n\nHow the change is undone if it goes wrong.\n\n## Assumptions');
  }));
  const after = applyOverlays(bumped, prd, approveAll(prd, bumped)).registry.documentTypes.prd;
  for (const h of ['## Executive summary', '### Out of scope', '## Data privacy', '## Rollback', '## Security sign-off']) assert.ok(after.template_text.includes(`${h}\n`), h);
  assert.equal(after.template_version, 2);
  assert.ok(after.section_order.includes('Rollback') && after.section_order.includes('Data privacy'));

  // Approval of a renamed PRD through the CLI: the reader test and the PRD's approval read the
  // renamed summary.
  const f = fixture({ 'docs/mirai/due-dates/brief.md': BRIEF_READY, 'docs/mirai/due-dates/interview.md': INTERVIEW, 'docs/mirai/due-dates/prd.md': COMPANY_PRD(PRD_READY) }, { 'document-types/prd.toml': PRD_OVERLAY, 'templates/prd.md': PRD_FRAGMENT });
  assert.equal((await tty(['approve', '--file', '.mirai/custom/document-types/prd.toml'], f.io, ['a', 'overlay-prd'])).code, EXIT.OK);
  await passReader(f, 'docs/mirai/due-dates/prd.md', (s) => quotesFrom(s.replace('### Out of scope', '### Not in this')));
  const ok = await tty(['approve', 'due-dates-prd', '--file', 'docs/mirai/due-dates/prd.md'], f.io, ['a', 'due-dates-prd']);
  assert.equal(ok.code, EXIT.OK, ok.err + ok.out);
  assert.match(ok.out, /reader test: pass/);
  assert.equal(readJournal(openStore(f.io)).events.at(-1).kind, 'prd');
});

test('37 T3: an overlay that drops or reorders away a protected section, a rename of two names to one, and a lint_checks removal are refused, naming the part and what reads it', () => {
  const prdOrder = REGISTRY.documentTypes.prd.section_order;
  const dropped = problemsOf(files({ 'document-types/prd.toml': `${HEAD('prd')}order = ${JSON.stringify(prdOrder.filter((n) => n !== 'Functional requirements'))}\n` }));
  assert.ok(dropped.some((p) => /order leaves out the protected section "Functional requirements" \(read by lint, trace, epic-coverage, graph-lint\): it can't be dropped/.test(p)), JSON.stringify(dropped));
  const moved = problemsOf(files({ 'document-types/prd.toml': `${HEAD('prd')}order = ${JSON.stringify([...prdOrder.slice(1), prdOrder[0]])}\n` }));
  assert.ok(moved.some((p) => /order moves "Summary for approval" from first: the summary check, approval and the reader test read it there/.test(p)), JSON.stringify(moved));
  const twoToOne = problemsOf(files({ 'document-types/prd.toml': `${HEAD('prd')}\n[[rename]]\nfrom = "Non-goals"\nto = "Out of scope"\n\n[[rename]]\nfrom = "Not in this"\nto = "Out of scope"\n` }));
  assert.ok(twoToOne.some((p) => /rename maps both "Non-goals" and "Not in this" to "Out of scope".*the protected section "Non-goals" \(read by trace\).*the protected part "Not in this" \(read by approval, reader-test, lint\)/.test(p)), JSON.stringify(twoToOne));
  const onto = problemsOf(files({ 'document-types/prd.toml': `${HEAD('prd')}\n[[rename]]\nfrom = "Risks"\nto = "Glossary"\n` }));
  assert.ok(onto.some((p) => /"Glossary" is already another prd section's name/.test(p)));
  const checks = problemsOf(files({ 'document-types/prd.toml': `${HEAD('prd')}lint_checks = ["summary", "writing"]\n` }));
  assert.ok(checks.some((p) => /lint_checks leaves out MIRAI's "prd" check: a project may add a check, never remove one/.test(p)), JSON.stringify(checks));
  // Adding a check is allowed.
  assert.deepEqual(problemsOf(files({ 'document-types/story.toml': `${HEAD('story')}lint_checks = ["ticket", "writing"]\n` })), []);
  // A stray template, an unknown type and an unknown section are named too.
  assert.match(problemsOf(files({ 'templates/prd.md': '## X\n' }))[0], /has no \.mirai\/custom\/document-types\/prd\.toml beside it/);
  assert.match(problemsOf(files({ 'document-types/memo.toml': HEAD('memo') }))[0], /there's no document type "memo"/);
  assert.match(problemsOf(files({ 'document-types/prd.toml': `${HEAD('prd')}\n[[add]]\nname = "X"\nafter = "Nowhere"\n` }))[0], /after "Nowhere" isn't one of the prd type's sections/);
  // A context type: a protected section may be renamed, never dropped (36's lints then read the new name).
  const journeys = files({ 'document-types/journeys.toml': `${HEAD('journeys')}\n[[rename]]\nfrom = "Sources"\nto = "References"\n` });
  assert.deepEqual(problemsOf(journeys), []);
  assert.ok(problemsOf(files({ 'document-types/journeys.toml': `${HEAD('journeys')}order = ["Journeys"]\n` })).some((p) => /the protected section "Sources" \(read by lint\)/.test(p)));
});

// The PRD template, as a company team would write its own: MIRAI's parts under the project's
// names, plus its own sections.
const COMPANY_TEMPLATE = (cut = null) => {
  let t = renamed(read('templates/prd.md'));
  t = swap(t, '## Functional requirements', '## Data privacy\n\nWhat personal data the feature reads or keeps.\n\n## Functional requirements');
  t = `${t.replace(/\n+$/, '')}\n\n## Security sign-off\n\nWho signed off, and when.\n`;
  return cut ? swap(t, cut, '') : t;
};
const REPLACE = `${HEAD('prd')}replace = true\n\n[[rename]]\nfrom = "Summary for approval"\nto = "Executive summary"\n\n[[rename]]\nfrom = "Not in this"\nto = "Out of scope"\n`;

test('37 T4: a replacement template with every protected part passes; without "Not in this" it is refused; after a MIRAI PRD template bump, doctor warns', () => {
  const fs = files({ 'document-types/prd.toml': REPLACE, 'templates/prd.md': COMPANY_TEMPLATE() });
  const [o] = readOverlays(fs, REGISTRY);
  assert.deepEqual(o.problems, []);
  assert.equal(o.result.replace, true);
  assert.equal(o.result.template, COMPANY_TEMPLATE(), 'used as it is');
  assert.deepEqual([o.result.coreTemplate.version, o.result.coreTemplate.hash], [1, contentHash(Buffer.from(read('templates/prd.md')))]);
  const r = applyOverlays(REGISTRY, fs, [approvedLine(o)]).registry;
  assert.ok(r.documentTypes.prd.required_sections.includes('Data privacy'));
  assert.deepEqual(lintWith(r, COMPANY_PRD(PRD)), []);
  // Without "Not in this" (the project's "Out of scope"): refused, naming the part and its readers.
  const cut = readOverlays(files({ 'document-types/prd.toml': REPLACE, 'templates/prd.md': COMPANY_TEMPLATE(/### Out of scope\n[\s\S]*?(?=## User journeys)/.exec(COMPANY_TEMPLATE())[0]) }), REGISTRY)[0];
  assert.ok(cut.problems.some((p) => /the template has no "### Out of scope": the protected part "Not in this" \(read by approval, reader-test, lint\), renamed to "Out of scope", can't be dropped/.test(p)), JSON.stringify(cut.problems));
  // Without the Brief: line, or the track field: refused too.
  const noLink = readOverlays(files({ 'document-types/prd.toml': REPLACE, 'templates/prd.md': COMPANY_TEMPLATE(/\nBrief: [^\n]*\n/.exec(COMPANY_TEMPLATE())[0]) }), REGISTRY)[0];
  assert.ok(noLink.problems.some((p) => /no "Brief:" line under its title/.test(p)), JSON.stringify(noLink.problems));
  const noTrack = readOverlays(files({ 'document-types/prd.toml': REPLACE, 'templates/prd.md': COMPANY_TEMPLATE(/\ntrack: [^\n]*/.exec(COMPANY_TEMPLATE())[0]) }), REGISTRY)[0];
  assert.ok(noTrack.problems.some((p) => /frontmatter has no "track"/.test(p)));

  // MIRAI's PRD template moves to version 2: doctor warns, naming both versions.
  const bumped = loadRegistry(registryCopy((d) => edit(join(d, 'document-types/prd.toml'), 'template_version = 1', 'template_version = 2')));
  const f = fixture({}, { 'document-types/prd.toml': REPLACE, 'templates/prd.md': COMPANY_TEMPLATE() });
  const store = openStore(f.io);
  const trust = snapshot(f.io);
  const line = { ...approvedLine(o), template_version: 1, template_hash: o.result.coreTemplate.hash };
  const fresh = overlaysCheck({ store, trust, events: [line] });
  assert.doesNotMatch(fresh.detail, /template is at version/);
  const warned = overlaysCheck({ store, trust, events: [line], registry: bumped });
  assert.equal(warned.state, 'yellow');
  assert.match(warned.detail, /MIRAI's prd template is at version 2; your replacement \.mirai\/custom\/document-types\/prd\.toml was approved against version 1/);
  assert.match(warned.hint, /mirai approve --file \.mirai\/custom\/document-types\/prd\.toml/);
});

// Unit 40: these approvals aren't about the verifier; her pass for the file as it is now first
// (test/documents/verify.test.js tests the gate itself).
async function tty(argv, { cwd, env }, answers, { vera = true } = {}) {
  if (vera) veraBefore(argv, { cwd, env });
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd });
  return { code, out, err };
}

// A repo with MIRAI installed, a committed key, `docs` and the overlay files `custom` (paths under
// .mirai/custom/) committed on main.
function fixture(docs = {}, custom = {}) {
  const f = installed({ files: { ...docs, ...Object.fromEntries(Object.entries(custom).map(([k, v]) => [`.mirai/custom/${k}`, v])) } });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  const at = (rel) => join(f.root, rel);
  const put = (rel, text) => {
    mkdirSync(join(at(rel), '..'), { recursive: true });
    writeFileSync(at(rel), text);
  };
  return { ...f, io: { cwd: f.root, env: f.env }, at, put, commit: (m = 'change') => { f.git('add', '-A'); f.git('commit', '-qm', m); } };
}

// The example brief and PRD with the brief's open question settled, as 32's T7 has them.
const BRIEF_READY = swap(swap(BRIEF,
  '1. How should reminders reach people (Q-1)? Options: email only, or email and an in-app notice. Recommendation: email only, because the app has no notification system yet; an in-app notice would double the work.\n',
  'None — the reminder channel was settled in review: email only (BR-2).\n'),
'- Q-1: How should reminders reach people: email only, or email and an in-app notice? The approver answers; it blocks the PRD\'s notification requirements.\n', '');
const PRD_READY = swap(swap(PRD,
  '1. How should reminders reach people (Q-1)? Options: email only, or email and an in-app notice. Recommendation: email only, because the app has no notification system yet; an in-app notice would double the work. This PRD is written for email only (A-1).\n',
  'None — the reminder channel was settled in review: email only (A-1).\n'),
'the recommendation for the brief\'s Q-1.', 'as settled in review.');

const approvals = (f) => readJournal(openStore(f.io)).events.filter((e) => e.type === 'approval');
const BRIEF_PATH = 'docs/mirai/due-dates/brief.md';
const lintCli = (f) => tty(['lint', BRIEF_PATH], f.io, []);

test('37 T6: approval and the trust root: unapproved and changed overlays are skipped with their line; one only on a branch isn\'t read; approval refuses an overlay that drops a protected part', async () => {
  const f = fixture({ [BRIEF_PATH]: BRIEF, 'docs/mirai/due-dates/interview.md': INTERVIEW }, { 'document-types/brief.toml': BRIEF_OVERLAY, 'templates/brief.md': BRIEF_FRAGMENT });
  // Not approved: skipped with one line naming it and the command; MIRAI's brief type is used.
  const before = await lintCli(f);
  assert.equal(before.code, EXIT.OK, before.out);
  assert.equal(before.err, 'note: .mirai/custom/document-types/brief.toml is not approved, so MIRAI\'s brief type is used; to use it: mirai approve --file .mirai/custom/document-types/brief.toml\n');
  // Approved: one signed line, kind overlay, over the type overlay and its template.
  const ok = await tty(['approve', '--file', '.mirai/custom/document-types/brief.toml'], f.io, ['a', 'overlay-brief']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.match(ok.out, /^overlay: \.mirai\/custom\/document-types\/brief\.toml \(the brief type, a section overlay\)\nhash: {4}sha256:[0-9a-f]{64}\nwith: {4}\.mirai\/custom\/templates\/brief\.md {3}sha256:[0-9a-f]{64}, signed with it\n/);
  assert.match(ok.out, /approved: \.mirai\/custom\/document-types\/brief\.toml, as it is now \(accepted; signed with k-[0-9a-f]+, seq \d+\); MIRAI uses it once it's on main/);
  const [line] = approvals(f);
  assert.deepEqual([line.kind, line.item, line.path, line.content_hash, line.files], ['overlay', 'overlay-brief', '.mirai/custom/document-types/brief.toml', contentHash(Buffer.from(BRIEF_OVERLAY)), [{ path: '.mirai/custom/templates/brief.md', content_hash: contentHash(Buffer.from(BRIEF_FRAGMENT)) }]]);
  assert.ok(line.signature);
  const used = await lintCli(f);
  assert.equal(used.code, EXIT.FAILURE, used.out);
  assert.equal(used.err, '');
  assert.match(used.out, /the section "Data privacy" is missing|"Data privacy"/);
  // The template file alone is approved with its overlay.
  const md = await tty(['approve', '--file', '.mirai/custom/templates/brief.md'], f.io, ['a']);
  assert.equal(md.code, EXIT.USAGE);
  assert.match(md.err, /is approved with its overlay \.mirai\/custom\/document-types\/brief\.toml/);

  // Changed after approval (the template's text), on main: skipped again, "changed since its approval".
  f.put('.mirai/custom/templates/brief.md', BRIEF_FRAGMENT.replace('who may see it', 'who may read it'));
  f.commit();
  const changed = await lintCli(f);
  assert.equal(changed.code, EXIT.OK, changed.out);
  assert.match(changed.err, /^note: \.mirai\/custom\/document-types\/brief\.toml is changed since its approval, so MIRAI's brief type is used; to use it: mirai approve --file \.mirai\/custom\/document-types\/brief\.toml\n$/);

  // Only on a branch: not read (the integration branch has no such overlay), and nothing said.
  const g = fixture({ [BRIEF_PATH]: BRIEF, 'docs/mirai/due-dates/interview.md': INTERVIEW });
  g.git('checkout', '-qb', 'feature/privacy');
  g.put('.mirai/custom/document-types/brief.toml', BRIEF_OVERLAY);
  g.put('.mirai/custom/templates/brief.md', BRIEF_FRAGMENT);
  g.commit();
  assert.equal((await tty(['approve', '--file', '.mirai/custom/document-types/brief.toml'], g.io, ['a', 'overlay-brief'])).code, EXIT.OK, 'approved on the branch');
  const branch = await lintCli(g);
  assert.deepEqual([branch.code, branch.err], [EXIT.OK, ''], branch.out);
  // mirai show overlays says it isn't on main yet.
  const shown = await tty(['show', 'overlays'], g.io, []);
  assert.match(shown.out, /^ {2}document-type {3}brief {3}approved \(not on main yet\) {3}\/.*\/\.mirai\/custom\/document-types\/brief\.toml$/m);

  // Approval refuses an overlay that drops a protected part, listing the problem; nothing written.
  const h = fixture({}, { 'document-types/prd.toml': REPLACE, 'templates/prd.md': COMPANY_TEMPLATE(/### Out of scope\n[\s\S]*?(?=## User journeys)/.exec(COMPANY_TEMPLATE())[0]) });
  const refused = await tty(['approve', '--file', '.mirai/custom/document-types/prd.toml'], h.io, ['a', 'overlay-prd']);
  assert.equal(refused.code, EXIT.BLOCKED, refused.out);
  assert.match(refused.err, /^\.mirai\/custom\/document-types\/prd\.toml: the template has no "### Out of scope": the protected part "Not in this"/m);
  assert.match(refused.err, /can't be approved: 1 problem, listed above; nothing was written/);
  assert.doesNotMatch(refused.out, /accepted as is/);
  assert.deepEqual(approvals(h), []);
});

test('37 T7: every agent definition and role validates with and without overlays; doctor and mirai show overlays list each state', async () => {
  // Without overlays: MIRAI's registry loads (Kai, Rex, Vera (unit 40) and every role pass the schema).
  assert.deepEqual(Object.keys(REGISTRY.agents).sort(), ['mirai-developer', 'mirai-reviewer', 'mirai-verifier']);
  assert.deepEqual(Object.keys(REGISTRY.roles).sort(), ['developer', 'planner', 'qa', 'reviewer', 'verifier']);
  // With: an instruction-only, a narrowing and a widening overlay on each agent validate.
  const agent = (name, extra = '') => `kind = "agent-overlay"\nschema_version = 1\nname = "${name}"\n${extra}`;
  for (const name of Object.keys(REGISTRY.agents)) {
    const tools = REGISTRY.agents[name].tools.allowed;
    const cases = {
      instructions: files({ [`agents/${name}.toml`]: agent(name), [`agents/${name}.md`]: 'Name the AC each change serves.\n' }),
      narrowing: files({ [`agents/${name}.toml`]: agent(name, `[tools]\nallowed = ${JSON.stringify(tools.filter((t) => t !== 'Glob'))}\n`) }),
      // Kai keeps his tools under the read-only reviewer role: Edit, Write and Bash are beyond it.
      widening: files({ [`agents/${name}.toml`]: agent(name, `${REGISTRY.agents[name].read_only ? '' : 'role = "reviewer"\nread_only = true\n'}[tools]\nallowed = ${JSON.stringify([...new Set([...tools, 'Bash'])])}\n`) }),
    };
    for (const [change, fs] of Object.entries(cases)) {
      const [o] = readOverlays(fs, REGISTRY);
      assert.deepEqual(o.problems, [], `${name} ${change}`);
      assert.equal(o.result.change, change, `${name} ${change}: ${o.result.why}`);
    }
  }
  // Refused: a tool no launch gets, a role that doesn't exist, the agent's own write scope.
  const bad = readOverlays(files({ 'agents/mirai-reviewer.toml': agent('mirai-reviewer', 'role = "janitor"\n[tools]\nallowed = ["Read", "WebFetch"]\n[may_write]\npaths = ["src/**"]\n') }), REGISTRY)[0].problems.join('\n');
  assert.match(bad, /role "janitor" isn't a role/);
  assert.match(bad, /WebFetch is never an agent's tool/);
  assert.match(bad, /may_write: an agent's own write scope isn't applied by MIRAI; give it a role of its own/);
  // A skill overlay validates against MIRAI's skill.
  const skill = readOverlays(files({ 'skills/mirai-write/overlay.toml': 'kind = "skill-overlay"\nschema_version = 1\nname = "mirai-write"\n[instructions]\nmode = "append"\n', 'skills/mirai-write/overlay.md': 'Use the company glossary.\n' }), REGISTRY)[0];
  assert.deepEqual(skill.problems, []);
  assert.match(skill.result.text, /Use the company glossary\.\n$/);

  // In a repo: doctor's item and mirai show overlays, for each state.
  const f = fixture({}, {
    'agents/mirai-reviewer.toml': agent('mirai-reviewer', '[tools]\nallowed = ["Read", "Grep", "Glob", "Bash"]\n'),
    'agents/mirai-developer.toml': agent('mirai-developer'), 'agents/mirai-developer.md': 'Name the AC each change serves.\n',
  });
  const check = () => overlaysCheck({ store: openStore(f.io), trust: snapshot(f.io), events: readJournal(openStore(f.io)).events });
  assert.match(check().detail, /^agents: mirai-developer overlay \(not approved\), mirai-reviewer overlay \(not approved\), mirai-verifier MIRAI's$/);
  assert.equal(check().state, 'yellow');
  assert.equal((await tty(['approve', '--file', '.mirai/custom/agents/mirai-developer.toml'], f.io, ['a', 'overlay-mirai-developer'])).code, EXIT.OK);
  const widen = await tty(['approve', '--file', '.mirai/custom/agents/mirai-reviewer.toml'], f.io, ['a', 'overlay-mirai-reviewer']);
  assert.equal(widen.code, EXIT.OK, widen.err);
  assert.match(widen.out, /it widens mirai-reviewer \(adds Bash\): its launches are refused until a red-team run covers this overlay \(mirai redteam run\)/);
  const now = check();
  assert.match(now.detail, /^agents: mirai-developer overlay \(approved\), mirai-reviewer widened: red team needed, mirai-verifier MIRAI's$/);
  assert.match(now.hint, /mirai redteam run/);
  // With no overlays at all, every agent is MIRAI's.
  const plain = fixture();
  assert.deepEqual(overlaysCheck({ store: openStore(plain.io), trust: snapshot(plain.io), events: [] }), { state: 'ok', detail: 'agents: mirai-developer MIRAI\'s, mirai-reviewer MIRAI\'s, mirai-verifier MIRAI\'s; 0 overlays, each approved as it is now' });
  // mirai show overlays: kind, name, state, full path; an invalid one with its problem.
  f.put('.mirai/custom/document-types/prd.toml', `${HEAD('prd')}lint_checks = ["summary"]\n`);
  const shown = await tty(['show', 'overlays'], f.io, []);
  assert.equal(shown.code, EXIT.OK, shown.err);
  const dir = join(realpathSync(f.root), '.mirai/custom');
  assert.match(shown.out, new RegExp(`^overlays {3}${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.match(shown.out, /^ {2}agent {11}mirai-developer {3}approved; instructions only {3}\/\S+\/\.mirai\/custom\/agents\/mirai-developer\.toml$/m);
  assert.match(shown.out, /^ {2}agent {11}mirai-reviewer {4}approved; widens it \(adds Bash\) {3}\/\S+\/\.mirai\/custom\/agents\/mirai-reviewer\.toml$/m);
  assert.match(shown.out, /^ {2}document-type {3}prd {15}doesn't validate \(not on main yet\) {3}\/\S+\/\.mirai\/custom\/document-types\/prd\.toml\n {6}lint_checks leaves out MIRAI's "writing" check/m);
});
