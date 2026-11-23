import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadRegistry } from '../../src/config/registry.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { applyOverlays, checklistTextOf, readOverlays } from '../../src/config/overlays.js';
import { lintText } from '../../src/lint/lint.js';

// Unit 37, P1's findings (2026-11-21): the rename reaches MIRAI's guidance; an added section brings
// its own guidance and checklist lines and names its variants; "Verified by:" takes plurals (32).
const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const BRIEF = read('examples/brief.md');
const PRD = read('examples/prd.md');
const INTERVIEW = read('examples/interview.md');
const files = (obj) => new Map(Object.entries(obj).map(([k, v]) => [k, Buffer.from(v)]));
const approveAll = (fs) => readOverlays(fs, REGISTRY).map((o) => ({ type: 'approval', by: 'human', kind: 'overlay', path: o.path, content_hash: o.hash, ...(o.bound.length ? { files: o.bound } : {}), decision: 'accepted', seq: 1 }));
const problemsOf = (fs) => readOverlays(fs, REGISTRY).flatMap((o) => o.problems);
const applied = (fs) => applyOverlays(REGISTRY, fs, approveAll(fs)).registry;
const lint = (registry, text) => lintText(text, { source: 'docs/mirai/due-dates/prd.md', registry, project: { repos: ['.'] }, linked: { 'brief.md': BRIEF, 'interview.md': INTERVIEW } }).filter((p) => p.severity === 'error');
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.split(from).join(to);
};
const HEAD = (type) => `kind = "document-type-overlay"\nschema_version = 1\nname = "${type}"\n`;
const BRIEF_OVERLAY = `${HEAD('brief')}\n[[add]]\nname = "Data privacy"\nafter = "Problem"\n`;
const BRIEF_FRAGMENT = '## Data privacy\n\n<!-- done when: each kind of personal data is named, with who may see it -->\nWhat personal data the feature reads or keeps, and who may see it.\n';

test('37 P1 findings: the rename reaches MIRAI\'s guidance and checklist', () => {
  const named = files({ 'document-types/prd.toml': `${HEAD('prd')}\n[[rename]]\nfrom = "Summary for approval"\nto = "Executive summary"\n\n[[rename]]\nfrom = "Decisions for you"\nto = "Your decisions"\n` });
  const def = applied(named).documentTypes.prd;
  assert.ok(read('templates/prd.md').includes('"Summary for approval"') && read('templates/prd-checklist.md').includes('"Decisions for you"'));
  assert.doesNotMatch(def.template_text, /"Summary for approval"|"Decisions for you"/);
  assert.match(def.template_text, /"Executive summary" is for the person who approves/);
  assert.match(def.template_text, /under "Your decisions"/);
  assert.doesNotMatch(def.checklist_text, /"Decisions for you"/);
  assert.match(def.checklist_text, /Is every real choice under "Your decisions"/);
});

test('37 P1 findings: an added section needs a "done when:" comment, and may add checklist lines', () => {
  const noBlock = problemsOf(files({ 'document-types/brief.toml': BRIEF_OVERLAY }));
  assert.ok(noBlock.some((p) => /add "Data privacy": \.mirai\/custom\/templates\/brief\.md has no "## Data privacy" block; each added section needs one, with a <!-- done when: … --> comment/.test(p)), JSON.stringify(noBlock));
  const noDone = problemsOf(files({ 'document-types/brief.toml': BRIEF_OVERLAY, 'templates/brief.md': '## Data privacy\n\nWhat personal data the feature keeps.\n' }));
  assert.ok(noDone.some((p) => /add "Data privacy": its block in \.mirai\/custom\/templates\/brief\.md has no <!-- done when: … --> comment/.test(p)), JSON.stringify(noDone));
  assert.deepEqual(problemsOf(files({ 'document-types/brief.toml': BRIEF_OVERLAY, 'templates/brief.md': BRIEF_FRAGMENT })), []);

  const withChecks = files({ 'document-types/brief.toml': `${BRIEF_OVERLAY}checklist = ["Does every kind of personal data name who may see it?", "Is the retention period stated?"]\n`, 'templates/brief.md': BRIEF_FRAGMENT });
  const b = applied(withChecks);
  const list = checklistTextOf(b, b.documentTypes.brief);
  assert.ok(list.startsWith(read('templates/brief-checklist.md').replace(/\n+$/, '')));
  // Unit 40: an overlay's added checklist lines are Vera's.
  assert.ok(list.endsWith('\n\n## Data privacy\n\n- [vera] Does every kind of personal data name who may see it?\n- [vera] Is the retention period stated?\n'), list.slice(-200));
  assert.equal(checklistTextOf(REGISTRY, REGISTRY.documentTypes.brief), read('templates/brief-checklist.md'), 'no overlay: MIRAI\'s file');
});

test('37 P1 findings: an added section names its variants, both by default, and the lint follows', () => {
  const ROLLBACK = '## Rollback plan\n\n<!-- done when: it says how the change is undone, and who decides -->\nHow the change is undone if it goes wrong.\n';
  const fullOnly = applied(files({ 'document-types/prd.toml': `${HEAD('prd')}\n[[add]]\nname = "Rollback plan"\nafter = "Rollout"\nvariants = ["full"]\n`, 'templates/prd.md': ROLLBACK }));
  const def = fullOnly.documentTypes.prd;
  assert.ok(def.optional_sections.includes('Rollback plan'));
  assert.ok(def.variants.full.required_sections.includes('Rollback plan'));
  assert.ok(!(def.variants.lite.required_sections ?? []).includes('Rollback plan'));
  assert.deepEqual(lint(fullOnly, PRD), [], 'the lite PRD needs no rollback plan');
  const both = applied(files({ 'document-types/prd.toml': `${HEAD('prd')}\n[[add]]\nname = "Rollback plan"\nafter = "Rollout"\n`, 'templates/prd.md': ROLLBACK }));
  assert.ok(lint(both, PRD).some((p) => p.code === 'missing-section' && /Rollback plan/.test(p.reason)), 'both variants by default');
  assert.ok(problemsOf(files({ 'document-types/prd.toml': `${HEAD('prd')}\n[[add]]\nname = "Rollback plan"\nvariants = ["huge"]\n`, 'templates/prd.md': ROLLBACK })).some((p) => /variants names "huge", which the prd type doesn't have \(lite, full\)/.test(p)));
  assert.ok(problemsOf(files({ 'document-types/brief.toml': `${BRIEF_OVERLAY}variants = ["full"]\n`, 'templates/brief.md': BRIEF_FRAGMENT })).some((p) => /variants is for a type with variants; the brief type has none/.test(p)));
});

test('32 fix (37 P1 finding): "Verified by:" takes the plural of each method and level', () => {
  const line = '  - Verified by: a measurement on the test data set of 500 open tasks, in the browser.';
  for (const how of ['API tests that load 500 open tasks', 'unit tests of the sort', 'integration tests against the database', 'E2E tests in the browser', 'end-to-end tests of the overdue page', 'measurements on the test data set', 'manual checks by the team lead', 'tests that time the page']) {
    assert.deepEqual(lint(REGISTRY, swap(PRD, line, `  - Verified by: ${how}.`)).filter((p) => p.code === 'prd-verify'), [], how);
  }
  assert.ok(lint(REGISTRY, swap(PRD, line, '  - Verified by: the team lead.')).some((p) => p.code === 'prd-verify'), 'still no method');
});
