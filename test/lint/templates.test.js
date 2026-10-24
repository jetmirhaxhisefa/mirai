import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { loadRegistry, BUILT_IN_CHECKS } from '../../src/config/registry.js';
import { CHECKS } from '../../src/lint/checks.js';
import { readFrontmatter } from '../../src/lint/frontmatter.js';
import { scanMarkdown } from '../../src/lint/markdown.js';
import { lintPaths } from '../../src/lint/lint.js';
import { createLintCommand, REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { main } from '../../src/cli/main.js';
import { ConfigError } from '../../src/cli/errors.js';
import { EXIT } from '../../src/cli/exit-codes.js';

// MIRAI's own registry, as shipped.
const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const STORY = read('examples/story.md');
const BUG = read('examples/bug.md');

const replace = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.replace(from, to);
};

// Lints `files` (path -> text) in a temporary repo's docs/mirai/ (or, for paths starting with
// "/", at that place in the repo), with these repo names.
function lintDocs(files, repos = ['.', 'api']) {
  const root = mkdtempSync(join(tmpdir(), 'mirai-tickets-'));
  for (const [path, text] of Object.entries(files)) {
    const full = path.startsWith('/') ? join(root, path) : join(root, 'docs', 'mirai', path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return lintPaths({ root, paths: [root], registry: REGISTRY, docsRoot: 'docs/mirai', project: { repos } }).problems;
}
const codes = (text, path = 'tickets/PMT-12.md', repos) => lintDocs({ [path]: text }, repos).map((p) => `${p.line}:${p.column} ${p.code}`);

test('T1: MIRAI\'s registry: story, bug and plan, templates that match their types, and known checks', () => {
  assert.deepEqual(Object.keys(REGISTRY.documentTypes).sort(), ['bug', 'plan', 'story']);
  assert.deepEqual([...BUILT_IN_CHECKS].sort(), Object.keys(CHECKS).sort());
  for (const [name, def] of Object.entries(REGISTRY.documentTypes)) {
    const template = read(def.template);
    const fm = readFrontmatter(template);
    assert.equal(fm.value.type, name);
    assert.equal(fm.value.template, `${name}@v${def.template_version}`);
    assert.ok(!Object.hasOwn(fm.value, 'status'), `${name}: tickets have no status`);
    const h2 = scanMarkdown(fm.body).headings.filter((h) => h.level === 2).map((h) => h.text);
    assert.deepEqual(h2, def.section_order ?? [...def.required_sections, ...def.optional_sections], name);
    // A template is a valid document of its type where it lives, outside the docs root.
    assert.deepEqual(lintDocs({ [`/registry/templates/${name}.md`]: template }), [], `${name} template`);
    assert.ok(read(def.checklist).startsWith('# '));
  }
});

test('T2: the filled examples lint clean through mirai lint', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mirai-examples-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, 'docs', 'mirai', 'tickets'), { recursive: true });
  writeFileSync(join(root, 'docs', 'mirai', 'tickets', 'PMT-12.md'), STORY);
  writeFileSync(join(root, 'docs', 'mirai', 'tickets', 'PMT-31.md'), BUG);
  let out = '';
  const io = { stdout: { write: (s) => (out += s) }, stderr: { write: () => {} }, env: { PATH: process.env.PATH, HOME: root }, cwd: root };
  const code = await main(['lint'], io, [createLintCommand()]);
  assert.equal(out, '2 files, 0 problems, 0 warnings, 0 skipped\n');
  assert.equal(code, EXIT.OK);

  // The repo names come from .mirai/config.toml once there is one.
  mkdirSync(join(root, '.mirai'));
  writeFileSync(join(root, '.mirai', 'config.toml'), 'schema_version = 1\n[git]\nintegration_branch = "main"\n[[repos]]\nname = "api"\npath = "api"\n');
  out = '';
  assert.equal(await main(['lint', '--json'], io, [createLintCommand()]), EXIT.FAILURE);
  assert.deepEqual(JSON.parse(out).problems.map((p) => `${p.file} ${p.code}`), ['docs/mirai/tickets/PMT-12.md unknown-repo', 'docs/mirai/tickets/PMT-31.md unknown-repo']);
  writeFileSync(join(root, 'docs', 'mirai', 'tickets', 'PMT-12.md'), STORY.replace('repo: "."', 'repo: api'));
  writeFileSync(join(root, 'docs', 'mirai', 'tickets', 'PMT-31.md'), BUG.replace('repo: "."', 'repo: api'));
  out = '';
  assert.equal(await main(['lint'], io, [createLintCommand()]), EXIT.OK);
});

test('T3: a ticket without its own AC IDs or a repo is flagged; so are an unknown repo and a status', () => {
  // No own ACs: the criteria are written without IDs.
  const noIds = STORY.replace(/- AC-PMT-12\.(\d): /g, '- ');
  assert.deepEqual(codes(noIds), [`${noIds.split('\n').indexOf('# A staff member signs in with company SSO') + 1}:1 missing-id`]);
  const [missing] = lintDocs({ 't/PMT-12.md': noIds });
  assert.equal(missing.hint, 'add a list item such as - AC-PMT-12.1: …');
  assert.deepEqual(codes(replace(STORY, 'repo: "."\n', '')), ['1:1 required']);
  assert.deepEqual(codes(replace(STORY, 'repo: "."', 'repo: web')), ['5:7 unknown-repo']);
  assert.deepEqual(codes(replace(STORY, 'repo: "."', 'repo: api')), []);
  assert.deepEqual(codes(replace(STORY, 'template: story@v1\n', 'template: story@v1\nstatus: ready-for-dev\n')), ['5:1 status-forbidden']);
  assert.deepEqual(codes(replace(BUG, 'repo: "."\n', ''), 'tickets/PMT-31.md'), ['1:1 required']);
  const bugNoIds = BUG.replace(/- AC-PMT-31\.(\d): /g, '- ');
  assert.deepEqual(codes(bugNoIds, 'tickets/PMT-31.md').map((c) => c.split(' ')[1]), ['missing-id']);
  // Without a usable id there's no "missing-id" (the id problem says it all), and the hint
  // never shows a token-shaped id.
  assert.deepEqual(codes(replace(STORY, 'id: PMT-12\n', ''), 'notes/x.md').map((c) => c.split(' ')[1]), ['required']);
  assert.deepEqual(codes(replace(STORY, 'id: PMT-12', 'id: 123'), 'notes/x.md').map((c) => c.split(' ')[1]), ['type']);
  const token = `ghp_${'a'.repeat(36)}`;
  const tokenNoIds = noIds.replace('id: PMT-12', `id: ${token}`);
  const [hidden] = lintDocs({ 'notes/x.md': tokenNoIds });
  assert.equal(hidden.code, 'missing-id');
  assert.doesNotMatch(JSON.stringify(hidden), /ghp_/);
});

test('T4: ticket fields: sizes, risk, AC and FR lists, after, e2e, tdd; PRD ACs in the text are fine', () => {
  const cases = [
    ['size: M', 'size: XL', ['7:7 enum']],
    ['risk: normal', 'risk: low', ['6:7 enum']],
    ['covers_ac: [AC-FR-2.1, AC-FR-2.2]', 'covers_ac: [AC-FR-2.1, FR-2.2]', ['10:24 pattern']],
    ['covers_fr: [FR-2]', 'covers_fr: [FR-2, NFR-1]', []],
    ['governed_by: [ADR-3]', 'governed_by: [adr-3]', ['11:15 pattern']],
    ['after: [PMT-11]', 'after: [PMT-11, PMT-12]', ['12:17 after-self']],
    ['e2e: true', 'e2e: "yes"', ['15:6 type']],
    ['e2e: true', 'e2e: true\ntdd: after\ntests: optional', []],
    ['e2e: true', 'e2e: true\ntdd: on', ['16:6 frontmatter-ambiguous']],
    ['files_likely: [app/Http/Controllers/Auth/SsoController.php, resources/js/pages/Login.tsx]', 'files_likely: [../outside.php]', ['14:16 pattern']],
    ['files_likely: [app/Http/Controllers/Auth/SsoController.php, resources/js/pages/Login.tsx]', 'files_likely: ["C:/x.php"]', ['14:16 pattern']],
    ['files_likely: [app/Http/Controllers/Auth/SsoController.php, resources/js/pages/Login.tsx]', 'files_likely: ["docs/My File.md", "src/**/*.ts", "pages/[id].tsx"]', []],
    ['after: [PMT-11]', 'after: [PMT-11, pmt-11]', ['12:17 duplicate']],
    ['after: [PMT-11]', 'after: [pmt-12]', ['12:9 after-self']],
    ['after: [PMT-11]', 'after: [11]', ['12:9 type']],
    ['e2e: true', 'e2e: true\ntests: sometimes', ['16:8 enum']],
    ['covers_fr: [FR-2]', 'covers_fr: [BR-1]', ['9:13 pattern']],
    ['epic: PMT-10', 'epic: "the sign-in epic"', ['13:7 pattern']],
    ['verify: "A staff member signs in with SSO on the staging stack and lands on their team page."\n', '', ['1:1 required']],
  ];
  for (const [from, to, want] of cases) assert.deepEqual(codes(replace(STORY, from, to)), want, to);
  // The example mentions AC-FR-2.1 and AC-FR-2.2 in its text: they're the PRD's, not unknown.
  assert.match(STORY, /These deliver AC-FR-2\.1/);
});

test('T5: {id}: a ticket\'s own AC kind is its own id', () => {
  // Another ticket's AC, like a PRD's, is not this ticket's kind: it's left to mirai trace.
  const other = replace(STORY, 'These deliver AC-FR-2.1', 'Like AC-PMT-13.1, these deliver AC-FR-2.1');
  assert.deepEqual(codes(other), []);
  // An own AC mentioned but not defined is unknown.
  assert.deepEqual(codes(replace(STORY, 'These deliver', 'With AC-PMT-12.9, these deliver')).map((c) => c.split(' ')[1]), ['unknown-id']);
  // The same text under another id: its ACs no longer match the kind, so it has none.
  // Its AC-PMT-12.n definitions are now another ticket's: each is a foreign-id problem.
  assert.deepEqual(codes(replace(STORY, 'id: PMT-12', 'id: PMT-99'), 'tickets/PMT-99.md').map((c) => c.split(' ')[1]), ['missing-id', 'foreign-id', 'foreign-id', 'foreign-id']);
  // Ids with pattern characters are escaped: in PMT.12, "AC-PMTx12.9" is not an own AC (it
  // would be, if the "." were left as "any character").
  const dotted = replace(STORY, 'id: PMT-12', 'id: PMT.12').replace(/AC-PMT-12\./g, 'AC-PMT.12.');
  assert.deepEqual(codes(dotted, 'tickets/PMT.12.md'), []);
  assert.deepEqual(codes(replace(dotted, 'These deliver', 'With AC-PMTx12.9, these deliver'), 'tickets/PMT.12.md'), []);
  assert.deepEqual(codes(replace(dotted, 'These deliver', 'With AC-PMT.12.9, these deliver'), 'tickets/PMT.12.md').map((c) => c.split(' ')[1]), ['unknown-id']);
});

// Writes a registry with one definition and returns its problems as "line code".
function registryProblems(toml) {
  const dir = mkdtempSync(join(tmpdir(), 'mirai-registry-'));
  mkdirSync(join(dir, 'document-types'));
  mkdirSync(join(dir, 'templates'));
  writeFileSync(join(dir, 'templates', 't.md'), '# T\n');
  writeFileSync(join(dir, 'document-types', 'x.toml'), toml);
  try {
    loadRegistry(dir);
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    return err.errors.map((e) => `${e.line} ${e.code}`).sort();
  }
  return [];
}

test('T6: registry: {id} only in ID patterns, known checks only, required kinds', () => {
  const head = 'kind = "document-type"\nschema_version = 1\nname = "x"\ntemplate = "templates/t.md"\nchecklist = "templates/t.md"\nrequired_sections = ["A"]\nstatus = "forbidden"\n';
  assert.deepEqual(registryProblems(`${head}[[ids]]\nprefix = "AC"\npattern = "AC-{id}\\\\.[0-9]+"\ndefined_by = "bullet"\nrequired = true\n`), []);
  assert.deepEqual(registryProblems(`${head}id_pattern = "x-{id}"\n`), ['8 pattern']);
  assert.deepEqual(registryProblems(`${head}[frontmatter.fields.ref]\ntype = "string"\npattern = "{id}-x"\n`), ['10 pattern']);
  assert.deepEqual(registryProblems(`${head}lint_checks = ["tickets"]\n`), ['8 enum']);
  assert.deepEqual(registryProblems(`${head}lint_checks = ["ticket", "ticket"]\n`), ['8 duplicate']);
  assert.deepEqual(registryProblems(`${head}checks = ["ticket"]\n`), ['8 unknown-key']);
  assert.deepEqual(registryProblems(`${head}[[ids]]\nprefix = "AC"\npattern = "AC-{id}\\\\.[0-9]+"\ndefined_by = "bullet"\nsection = "Criteria"\n`), ['12 unknown-section']);
  assert.deepEqual(registryProblems(`${head}[[ids]]\nprefix = "AC"\npattern = "AC-{id}\\\\.[0-9]+"\ndefined_by = "bullet"\nrequired = "yes"\n`), ['12 type']);
});

test('T7: from review: ACs under another id or outside their section, leftover template text, file names', () => {
  // A definition under another id (a stale copy, a typo) is a problem, not silently ignored.
  const stale = replace(STORY, '- AC-PMT-12.3:', '- AC-PMT-13.3:');
  assert.deepEqual(codes(stale), [`${stale.split('\n').findIndex((l) => l.startsWith('- AC-PMT-13.3')) + 1}:3 foreign-id`]);
  assert.deepEqual(codes(replace(STORY, '- AC-PMT-12.2:', '- AC-PTM-12.2:')).map((c) => c.split(' ')[1]), ['foreign-id']);
  assert.deepEqual(codes(replace(STORY, '- AC-PMT-12.2:', '- AC-FR-2.1:')).map((c) => c.split(' ')[1]), ['foreign-id']);
  // Own ACs count only in "Acceptance criteria".
  const moved = replace(STORY, '- Assumption: the eight-hour', '- AC-PMT-12.4: Sessions end at eight hours\n- Assumption: the eight-hour');
  assert.deepEqual(codes(moved).map((c) => c.split(' ')[1]), ['misplaced-id']);

  // A ticket copied from the template and not filled in: every leftover is flagged.
  const copied = read('templates/story.md').replace('id: PMT-1', 'id: PMT-40').replace(/AC-PMT-1\./g, 'AC-PMT-40.');
  const left = lintDocs({ 'tickets/PMT-40.md': copied }).map((p) => p.code);
  assert.ok(left.length >= 8, left.join(' '));
  assert.deepEqual([...new Set(left)], ['template-text']);
  // The template's example id is a leftover too (it could collide with a real ticket).
  assert.deepEqual(codes(replace(STORY, 'id: PMT-12', 'id: PMT-1').replace(/AC-PMT-12\./g, 'AC-PMT-1.'), 'tickets/PMT-1.md'), ['2:5 template-text']);
  // Outside the docs root, template text isn't checked: that's where the templates live.
  assert.deepEqual(lintDocs({ '/notes/PMT-40.md': copied }), []);

  // Under tickets/, the file name is the id, compared without regard to case.
  assert.deepEqual(codes(STORY, 'tickets/PMT-99.md'), ['2:5 file-name']);
  assert.deepEqual(codes(STORY, 'tickets/pmt-12.md'), []);
  assert.deepEqual(codes(STORY, 'epics/login/PMT-99.md'), []);
});

