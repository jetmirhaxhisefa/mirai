import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, readdirSync, statSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';

import { scanMarkdown, headingSlugs } from '../../src/lint/markdown.js';
import { lintPaths } from '../../src/lint/lint.js';
import { loadRegistry } from '../../src/config/registry.js';
import { createLintCommand } from '../../src/cli/commands/lint.js';
import { main } from '../../src/cli/main.js';
import { ConfigError } from '../../src/cli/errors.js';
import { EXIT } from '../../src/cli/exit-codes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const REGISTRY_DIR = join(FIXTURES, 'registry');
const REGISTRY = loadRegistry(REGISTRY_DIR);
const LOGIN = readFileSync(join(FIXTURES, 'docs', 'login', 'prd.md'), 'utf8');
const TICKET = readFileSync(join(FIXTURES, 'docs', 'login', 'tickets', 'T-1.md'), 'utf8');

// A temporary repo with the sample doc set in docs/mirai/, plus `files` (path -> text).
function repo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mirai-lint-'));
  cpSync(join(FIXTURES, 'docs'), join(root, 'docs', 'mirai'), { recursive: true });
  cpSync(join(FIXTURES, 'README.md'), join(root, 'docs', 'README.md'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

// Lints `paths` (repo-relative), or the whole folder, walked without git.
const lint = (root, paths = [], docsRoot = 'docs/mirai') => lintPaths({ root, paths: paths.length ? paths.map((p) => join(root, p)) : [root], registry: REGISTRY, docsRoot });

// Lints one changed copy of the login PRD and returns its problems as "line:column code".
function problemsOf(text, path = 'docs/mirai/login/prd.md') {
  const root = repo({ [path]: text });
  return lint(root, [path]).problems.map((p) => `${p.line}:${p.column} ${p.code}${p.severity === 'warning' ? ' (warning)' : ''}`);
}

const replace = (text, from, to) => {
  assert.ok(text.includes(from), `fixture has no ${JSON.stringify(from)}`);
  return text.replace(from, to);
};
const lineOf = (text, needle) => text.slice(0, text.indexOf(needle)).split('\n').length;

test('T1: scanner: fences and comments are opaque; setext and unclosed blocks are flagged; positions', () => {
  const text = [
    '# Title', //                                 1
    '```js', //                                   2
    '# not a heading [x](in-fence.md)', //       3
    '```', //                                     4
    '<!--', //                                    5
    '## hidden [y](in-comment.md)', //            6
    '-->', //                                     7
    '## Real `## code [z](in-code.md)` [a](b.md "t") <https://e.x/y>', // 8
    'Paragraph', //                               9
    '===', //                                     10
    '- item', //                                  11
    '---', //                                     12
    '[ref]: ./ref.md', //                         13
    '😀 [e](emoji.md) <!-- [c](inline-comment.md) --> after', // 14
  ].join('\n');
  const scan = scanMarkdown(text, { firstLine: 5 });
  assert.deepEqual(scan.headings.map((h) => [h.level, h.text, h.line, h.column]), [
    [1, 'Title', 5, 1],
    [2, 'Real `## code [z](in-code.md)` [a](b.md "t") <https://e.x/y>', 12, 1],
  ]);
  assert.deepEqual(scan.links.map((l) => [l.kind, l.target, l.line, l.column]), [
    ['inline', 'b.md', 12, 39],
    ['autolink', 'https://e.x/y', 12, 50],
    ['reference', './ref.md', 17, 8],
    ['inline', 'emoji.md', 18, 7],
  ]);
  // Only the underline after a paragraph is setext; `---` after a list item is a rule.
  assert.deepEqual(scan.problems.map((p) => `${p.line}:${p.column} ${p.code}`), ['14:1 setext']);
  assert.deepEqual(scan.fences.map((f) => [f.info, f.line, f.endLine, f.body.length]), [['js', 6, 8, 1]]);
  assert.deepEqual(scan.lines.filter((l) => l.kind === 'comment').map((l) => l.line), [9, 10, 11]);

  const unclosed = scanMarkdown('# T\n\n~~~~\ntext\n~~~\n');
  assert.deepEqual(unclosed.problems.map((p) => `${p.line} ${p.code}`), ['3 unclosed-fence']);
  assert.deepEqual(scanMarkdown('# T\n<!-- open\n').problems.map((p) => p.code), ['unclosed-comment']);
  assert.deepEqual(scanMarkdown('#\n').problems.map((p) => p.code), ['empty-heading']);
  // `#hashtag` is not a heading; trailing #s are not part of the text.
  assert.deepEqual(scanMarkdown('#tag\n## Done ##\n').headings.map((h) => h.text), ['Done']);

  // GitHub-style anchors, with repeats numbered.
  const slugs = headingSlugs([{ text: 'FR-1: Sign in' }, { text: 'Über `code` & **bold**' }, { text: 'FR-1: Sign in' }, { text: 'See [docs](x.md)' }]);
  assert.deepEqual([...slugs], ['fr-1-sign-in', 'über-code--bold', 'fr-1-sign-in-1', 'see-docs']);
});

test('T2: the sample doc set lints clean', () => {
  const root = repo();
  const r = lint(root);
  assert.deepEqual(r.problems, []);
  assert.equal(r.files, 3); // two PRDs and a ticket-like note
  assert.equal(r.skipped, 1); // docs/README.md: outside the docs root, no frontmatter
});

test('T3: sections: an extra heading, a missing, duplicate, misordered or empty section', () => {
  const extra = replace(LOGIN, '## Risks', '## Extras\n\nSomething.\n\n## Risks');
  assert.deepEqual(problemsOf(extra), [`${lineOf(extra, '## Extras')}:1 unknown-section`]);
  const root = repo({ 'docs/mirai/x/prd.md': replace(LOGIN, '## Summary', '## Sumary') });
  const [typo] = lint(root, ['docs/mirai/x/prd.md']).problems.filter((p) => p.code === 'unknown-section');
  assert.equal(typo.hint, 'did you mean "Summary"?');
  assert.match(typo.reason, /"Sumary" is not a sample section/);

  const missing = LOGIN.slice(0, LOGIN.indexOf('## Requirements')) + LOGIN.slice(LOGIN.indexOf('## Risks'));
  // The Summary's link to #requirements breaks too.
  assert.deepEqual(problemsOf(missing), [`${lineOf(missing, '# Login')}:1 missing-section`, `${lineOf(missing, '[the requirements]')}:47 missing-anchor`]);

  const twice = replace(LOGIN, '## Risks', '## Summary\n\nAgain.\n\n## Risks');
  assert.deepEqual(problemsOf(twice), [`${lineOf(twice, '## Summary\n\nAgain')}:1 duplicate-section`]);

  const risksAt = LOGIN.indexOf('## Risks');
  const swapped = `${LOGIN.slice(0, LOGIN.indexOf('## Summary'))}${LOGIN.slice(risksAt)}\n${LOGIN.slice(LOGIN.indexOf('## Summary'), risksAt)}`;
  // One moved section is one problem, at the moved heading.
  assert.deepEqual(problemsOf(swapped), [`${lineOf(swapped, '## Risks')}:1 section-order`]);

  const empty = replace(LOGIN, 'Not applicable — an internal tool with no outside users.', '<!-- nothing yet -->');
  assert.deepEqual(problemsOf(empty), [`${lineOf(empty, '## Risks')}:1 empty-section`]);

  // ### and deeper are free; exactly one # title, first.
  assert.deepEqual(problemsOf(replace(LOGIN, '### FR-2: Sign out', '#### FR-2: Sign out\n\n### Any heading')), []);
  const two = replace(LOGIN, '## Risks', '# Another title\n\n## Risks');
  assert.deepEqual(problemsOf(two), [`${lineOf(two, '# Another')}:1 title`]);
  assert.deepEqual(problemsOf(replace(LOGIN, '# Login\n', '')).map((p) => p.split(' ')[1]), ['title']);
});

test('T4: optional sections: Not applicable needs a reason and must stand alone; required ones can\'t use it', () => {
  const NA = 'Not applicable — an internal tool with no outside users.';
  const bare = replace(LOGIN, NA, 'Not applicable');
  assert.deepEqual(problemsOf(bare), [`${lineOf(bare, 'Not applicable')}:1 not-applicable`]);
  const plusText = replace(LOGIN, NA, `${NA}\n\nBut also this.`);
  assert.deepEqual(problemsOf(plusText).map((p) => p.split(' ')[1]), ['not-applicable']);
  const required = replace(LOGIN, 'Staff log in with SSO. See', 'Not applicable — none.\n\nSee');
  assert.deepEqual(problemsOf(required), [`${lineOf(required, 'Not applicable — none')}:1 not-applicable`]);
  assert.deepEqual(problemsOf(replace(LOGIN, NA, 'Real risks: an SSO outage.')), []);
});

test('T5: the template version: missing, wrong type, older (a warning) and newer (an error)', () => {
  assert.deepEqual(problemsOf(replace(LOGIN, 'template: sample@v2\n', '')), ['1:1 required']);
  const root = repo({ 'docs/mirai/x/prd.md': replace(LOGIN, 'template: sample@v2\n', '') });
  assert.equal(lint(root, ['docs/mirai/x/prd.md']).problems[0].hint, 'add template: sample@v2');
  assert.deepEqual(problemsOf(replace(LOGIN, 'sample@v2', 'note@v2')), ['4:11 template']);
  assert.deepEqual(problemsOf(replace(LOGIN, 'sample@v2', 'sample-v2')), ['4:11 template']);
  assert.deepEqual(problemsOf(replace(LOGIN, 'sample@v2', 'sample@v1')), ['4:11 template-older (warning)']);
  assert.deepEqual(problemsOf(replace(LOGIN, 'sample@v2', 'sample@v3')), ['4:11 template-newer']);
});

test('T6: frontmatter fields, status rules and reader errors', () => {
  const cases = [
    ['area: auth\n', '', ['1:1 required']],
    ['owner: jet\n', 'owner: jet\ncolour: blue\n', ['8:1 unknown-field']],
    ['area: auth\n', 'area: auth\npoints: "five"\n', ['13:9 type']],
    ['priority: high', 'priority: urgent', ['9:11 enum']],
    ['updated: "2026-10-24"', 'updated: "2026-02-30"', ['8:10 date']],
    ['area: auth\n', 'area: auth\ndue: "2026-13-01"\n', ['13:6 date']],
    ['area: auth\n', 'area: auth\ninternal: "yes"\n', ['13:11 type']],
    ['reviewers: [ana, ben]', 'reviewers: [ana, Ben]', ['10:18 pattern']],
    ['reviewers: [ana, ben]', 'reviewers: ana', ['10:12 type']],
    ['status: draft', 'status: done', ['5:9 enum']],
    ['status: draft\n', '', ['1:1 required']],
    ['version: 1\n', '', ['1:1 required']],
    ['version: 1', 'version: 0', ['6:10 type']],
    ['id: sample-login', 'id: Login', ['2:5 pattern']],
    ['owner: jet', 'owner:', ['7:1 type']],
    ['derived_from: [brief-login]', 'derived_from: [brief login]', ['11:16 pattern']],
  ];
  for (const [from, to, want] of cases) assert.deepEqual(problemsOf(replace(LOGIN, from, to)), want, `${from} -> ${to}`);

  // A reader error is one problem with its position, and the other rules are skipped.
  assert.deepEqual(problemsOf(replace(LOGIN, 'priority: high', 'priority: yes')), ['9:11 frontmatter-ambiguous']);
  assert.deepEqual(problemsOf(replace(LOGIN, 'updated: "2026-10-24"', 'updated: 2026-10-24')), ['8:10 frontmatter-ambiguous']);

  // Ticket-like types have no status (D-06) and no version.
  assert.deepEqual(problemsOf(replace(TICKET, 'template: note@v1\n', 'template: note@v1\nstatus: ready\n'), 'docs/mirai/login/tickets/T-1.md'), ['5:1 status-forbidden']);
  assert.deepEqual(problemsOf(replace(TICKET, 'template: note@v1\n', 'template: note@v1\nversion: 2\n'), 'docs/mirai/login/tickets/T-1.md'), ['5:1 unknown-field']);
  assert.deepEqual(problemsOf(TICKET, 'docs/mirai/login/tickets/T-1.md'), []);
});

test('T6b: the docs root: every .md in it is a document; outside, only known types are linted', () => {
  const broken = replace(LOGIN, 'priority: high', 'priority: yes');
  const root = repo({
    'docs/mirai/plain.md': '# Just text\n',
    'docs/mirai/other.md': '---\nid: x\ntype: memo\n---\n# X\n',
    'docs/mirai/untyped.md': '---\nid: x\n---\n# X\n',
    'docs/mirai/broken.md': broken,
    'notes/plain.md': '# Just text\n',
    'notes/other.md': '---\nid: x\ntype: memo\n---\n# X\n',
    'notes/broken.md': broken,
    'notes/rule.md': '---\n\nA horizontal rule, then text.\n',
    'notes/known.md': replace(LOGIN, 'status: draft\n', ''),
    'notes/not-markdown.txt': '---\ntype: sample\n',
    '.mirai/skip.md': broken,
    'node_modules/skip.md': broken,
  });
  symlinkSync(join(root, 'docs', 'mirai', 'login', 'prd.md'), join(root, 'docs', 'mirai', 'link.md'));
  const r = lint(root);
  assert.deepEqual(r.problems.map((p) => `${p.file}:${p.line}:${p.column} ${p.code} ${p.severity}`), [
    'docs/mirai/broken.md:9:11 frontmatter-ambiguous error',
    'docs/mirai/link.md:1:1 symlink error',
    'docs/mirai/other.md:3:7 unknown-type error',
    'docs/mirai/plain.md:1:1 no-frontmatter error',
    'docs/mirai/untyped.md:1:1 required error',
    'notes/broken.md:9:11 frontmatter-ambiguous warning',
    'notes/known.md:1:1 required error',
    'notes/known.md:20:19 missing-file error', // ../billing/prd.md doesn't exist from notes/
  ]);
  // 3 fixture files, 5 bad ones inside, and notes/known.md; skipped: docs/README.md and
  // notes/{plain,other,broken,rule}.md. notes/rule.md names no known type, so it's silent.
  assert.equal(r.files, 9);
  assert.equal(r.skipped, 5);
  assert.match(r.problems.find((p) => p.file === 'notes/broken.md').reason, /\(not linted\)$/);
});

test('T7: IDs: duplicates, unknown mentions, a dependent ID without its parent; code doesn\'t count', () => {
  const dup = replace(LOGIN, '### FR-2: Sign out', '### FR-1: Sign out');
  assert.deepEqual(problemsOf(dup).filter((p) => !p.endsWith('missing-parent')), [`${lineOf(dup, '### FR-1: Sign out')}:5 duplicate-id`]);
  const unknown = replace(LOGIN, 'as in FR-1.', 'as in FR-5.');
  assert.deepEqual(problemsOf(unknown), [`${lineOf(unknown, 'as in FR-5')}:52 unknown-id`]);
  const orphan = replace(LOGIN, '- AC-FR-2.1:', '- AC-FR-3.1:');
  assert.deepEqual(problemsOf(orphan), [`${lineOf(orphan, 'AC-FR-3.1')}:3 missing-parent`]);
  const dupAc = replace(LOGIN, '- AC-FR-1.2:', '- AC-FR-1.1:');
  assert.deepEqual(problemsOf(dupAc), [`${lineOf(dupAc, '- AC-FR-1.1: a wrong')}:3 duplicate-id`]);
  const table = replace(LOGIN, '| R-1 | SSO outage |', '| R-1 | SSO outage |\n| R-1 | again |');
  assert.deepEqual(problemsOf(table), [`${lineOf(table, '| R-1 | again')}:3 duplicate-id`]);
  // Mentions inside code spans, fences and comments don't count (the fixture has all three).
  assert.deepEqual(problemsOf(replace(LOGIN, '<!-- done when', '<!-- FR-404 done when')), []);
});

test('T8: links: missing files and anchors, out of the repo, absolute, credentials and schemes', () => {
  const cases = [
    ['[a](nope.md)', 'missing-file'],
    ['[a](../billing/prd.md#nope)', 'missing-anchor'],
    ['[a](#nope)', 'missing-anchor'],
    ['[a](../../../../outside.md)', 'link-outside'],
    ['[a](/etc/passwd)', 'link-absolute'],
    ['[a](//evil.example/x)', 'link-absolute'],
    ['[a](https://jet:ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/x)', 'link-credential'],
    ['[a](file:///etc/hosts)', 'link-scheme'],
    ['[a](javascript:alert(1))', 'link-scheme'],
    ['<file:///etc/hosts>', 'link-scheme'],
    ['[r]: ../nope.md', 'missing-file'],
    ['[a](bad%zz.md)', 'link'],
  ];
  for (const [link, code] of cases) {
    const text = replace(LOGIN, 'Staff sign in to the people tool.', `Staff sign in to the people tool.\n\n${link}`);
    assert.deepEqual(problemsOf(text).map((p) => p.split(' ')[1]), [code], link);
  }
  // The reason never repeats the credential.
  const root = repo({ 'docs/mirai/x/prd.md': replace(LOGIN, 'Staff sign in', '[a](https://x:ghp_abcdefghijklmnopqrstuvwxyz0123456789@h.example) Staff sign in') });
  const [cred] = lint(root, ['docs/mirai/x/prd.md']).problems;
  assert.doesNotMatch(JSON.stringify(cred), /ghp_/);

  // Good links pass: anchors here and in another file, folders, mailto and http(s).
  const good = '[a](#summary) [b](../billing/prd.md#summary) [c](../billing/) [d](mailto:a@b.example) [e](./prd.md?x=1#fr-2-sign-out) [f](<../billing/prd.md>)';
  assert.deepEqual(problemsOf(replace(LOGIN, 'Staff sign in to the people tool.', good)), []);

  // A symbolic link in the repo that leads outside it is outside.
  const out = mkdtempSync(join(tmpdir(), 'mirai-outside-'));
  writeFileSync(join(out, 'secret.md'), '# Secret\n');
  const root2 = repo({ 'docs/mirai/x/prd.md': replace(LOGIN, 'Staff sign in', '[s](escape/secret.md) Staff sign in') });
  symlinkSync(out, join(root2, 'docs', 'mirai', 'x', 'escape'));
  assert.deepEqual(lint(root2, ['docs/mirai/x/prd.md']).problems.map((p) => p.code), ['link-outside']);
  rmSync(out, { recursive: true });
});

test('T9: Mermaid: a known diagram type, balanced brackets outside strings and comments', () => {
  const block = (body) => replace(LOGIN, '<!-- done when', `\`\`\`mermaid\n${body}\n\`\`\`\n\n<!-- done when`);
  assert.deepEqual(problemsOf(block('flowchartt LR\n  A --> B')).map((p) => p.split(' ')[1]), ['mermaid']);
  assert.deepEqual(problemsOf(block('flowchart LR\n  A[open --> B')).map((p) => p.split(' ')[1]), ['mermaid']);
  assert.deepEqual(problemsOf(block('graph LR; A[open --> B')).map((p) => p.split(' ')[1]), ['mermaid']);
  assert.deepEqual(problemsOf(block('classDiagram\n  class A {\n    +run()\n')).map((p) => p.split(' ')[1]), ['mermaid']);
  assert.deepEqual(problemsOf(block('')).map((p) => p.split(' ')[1]), ['mermaid']);
  // Strings, comments, config blocks and diagrams whose syntax doesn't pair brackets pass.
  assert.deepEqual(problemsOf(block('%%{init: {"theme": "dark"}}%%\nflowchart TD\n  A["text ( with ["] --> B')), []);
  assert.deepEqual(problemsOf(block('---\ntitle: Login (draft\n---\nflowchart TD\n  A --> B')), []);
  assert.deepEqual(problemsOf(block('erDiagram\n  CUSTOMER ||--o{ ORDER : places')), []);
  assert.deepEqual(problemsOf(block('mindmap\n  root)Cloud(')), []);
  // Ordinary diagrams: labels with HTML, the async arrow, free text in notes and titles.
  assert.deepEqual(problemsOf(block('flowchart LR\n  A[line one<br>line two] --> B[This is <b>bold</b>]')), []);
  assert.deepEqual(problemsOf(block('sequenceDiagram\n  Alice-)John: See you\n  Note right of John: (draft')), []);
  assert.deepEqual(problemsOf(block('gantt\n  title Plan (v2\n  section A\n  Task :a1, 2026-10-24, 3d')), []);
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

test('T10: registry: the new fields validate, with positions', () => {
  const head = 'kind = "document-type"\nschema_version = 1\nname = "x"\ntemplate = "templates/t.md"\nchecklist = "templates/t.md"\nrequired_sections = ["A", "B"]\n';
  const states = '[states]\nnames = ["draft"]\ninitial = "draft"\ntransitions = []\n';
  assert.deepEqual(registryProblems(head + states), []);
  assert.deepEqual(registryProblems(head), ['1 required']); // states, unless status = "forbidden"
  assert.deepEqual(registryProblems(`${head}status = "forbidden"\n`), []);
  assert.deepEqual(registryProblems(`${head}status = "forbidden"\n${states}`), ['8 invalid']);
  assert.deepEqual(registryProblems(`${head}section_order = ["B", "C"]\n${states}`), ['7 range', '7 unknown-section']);
  assert.deepEqual(registryProblems(`${head}optional_sections = ["A"]\n${states}`), ['7 duplicate']);
  assert.deepEqual(registryProblems(`${head}id_pattern = "x-["\n${states}`), ['7 pattern']);
  assert.deepEqual(registryProblems(`${head}id_pattern = ".*"\n${states}`), ['7 pattern']);
  assert.deepEqual(registryProblems(`${head}template_version = 0\n${states}`), ['7 range']);
  const ids = (kinds) => `${head}${states}${kinds}`;
  assert.deepEqual(registryProblems(ids('[[ids]]\nprefix = "FR"\npattern = "FR-[0-9"\ndefined_by = "heading"\n')), ['13 pattern']);
  assert.deepEqual(registryProblems(ids('[[ids]]\nprefix = "AC"\npattern = "AC-[0-9]+"\ndefined_by = "bullet"\nparent = "FR"\n')), ['13 pattern', '15 unknown-id']);
  assert.deepEqual(registryProblems(ids('[[ids]]\nprefix = "FR"\npattern = "(FR)-[0-9]+"\ndefined_by = "list"\n')), ['13 pattern', '14 enum']);
  assert.deepEqual(registryProblems(`${head}${states}[frontmatter.fields.status]\ntype = "string"\n`), ['11 duplicate']);
  assert.deepEqual(registryProblems(`${head}${states}[frontmatter.fields.size]\ntype = "enum"\n`), ['11 required']);
  assert.deepEqual(registryProblems(`${head}${states}[frontmatter.fields.size]\ntype = "integer"\npattern = "[0-9]"\n`), ['13 invalid']);
  // The fixture registry loads, with its own fields.
  assert.equal(REGISTRY.documentTypes.sample.template_version, 2);
  assert.equal(REGISTRY.documentTypes.note.status, 'forbidden');
});

// Runs `mirai lint` in memory, in `cwd`, with the fixture registry (or `registryDir`).
async function mirai(cwd, argv, registryDir = REGISTRY_DIR) {
  let out = '';
  let err = '';
  const io = { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: { PATH: process.env.PATH, HOME: cwd }, cwd };
  const code = await main(['lint', ...argv], io, [createLintCommand({ registryDir })]);
  return { code, out, err };
}

// Every file under `dir` with its size and modification time, to show nothing was written.
function snapshot(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(`${p} ${statSync(p).size} ${statSync(p).mtimeMs}`);
    }
  };
  walk(dir);
  return out.sort();
}

test('T11: mirai lint: exit codes, output, --json, paths, the docs root from config, and no writes', async () => {
  const root = repo();
  execFileSync('git', ['init', '-q'], { cwd: root }); // the repo's top folder is the root, wherever lint runs
  // Runs mirai lint and checks that no file anywhere in the repo (.git included) was added,
  // removed or changed.
  const unchanged = async (cwd, argv, registryDir) => {
    const before = snapshot(root);
    const r = await mirai(cwd, argv, registryDir);
    assert.deepEqual(snapshot(root), before, `mirai lint ${argv.join(' ')} wrote something`);
    return r;
  };
  const clean = await unchanged(root, []);
  assert.equal(clean.code, EXIT.OK, clean.err);
  assert.equal(clean.out, '3 files, 0 problems, 0 warnings, 1 skipped\n');

  writeFileSync(join(root, 'docs', 'mirai', 'login', 'bad.md'), replace(LOGIN, 'priority: high', 'priority: urgent').replace('sample@v2', 'sample@v1'));
  const bad = await unchanged(root, []);
  assert.equal(bad.code, EXIT.FAILURE);
  assert.equal(bad.out, [
    'docs/mirai/login/bad.md:4:11: warning: written for an older template (v1; the current one is v2)',
    '  hint: bring the document up to date when you next edit it',
    'docs/mirai/login/bad.md:9:11: "priority" must be one of: low, normal, high',
    '4 files, 1 problem, 1 warning, 1 skipped',
    '',
  ].join('\n'));

  const json = await unchanged(root, ['--json']);
  assert.equal(json.code, EXIT.FAILURE);
  const data = JSON.parse(json.out);
  assert.deepEqual({ ...data, problems: data.problems.map((p) => `${p.file}:${p.line}:${p.column} ${p.code} ${p.severity}`) }, {
    schema_version: 1, files: 4, skipped: 1, errors: 1, warnings: 1,
    problems: ['docs/mirai/login/bad.md:4:11 template-older warning', 'docs/mirai/login/bad.md:9:11 enum error'],
  });

  // Paths: a file, a folder, relative to the current folder; outside the repo is a usage error.
  const one = await unchanged(join(root, 'docs', 'mirai'), ['login/prd.md', 'billing']);
  assert.equal(one.out, '2 files, 0 problems, 0 warnings, 0 skipped\n');
  assert.equal((await mirai(root, ['/'])).code, EXIT.USAGE);
  assert.equal((await mirai(root, ['missing.md'])).code, EXIT.USAGE);
  assert.equal((await mirai(root, ['--strict'])).code, EXIT.USAGE);

  // Only warnings: exit 0.
  rmSync(join(root, 'docs', 'mirai', 'login', 'bad.md'));
  writeFileSync(join(root, 'docs', 'mirai', 'login', 'old.md'), replace(LOGIN, 'sample@v2', 'sample@v1'));
  assert.equal((await mirai(root, [])).code, EXIT.OK);

  // A broken registry is exit 3.
  const broken = mkdtempSync(join(tmpdir(), 'mirai-registry-'));
  mkdirSync(join(broken, 'document-types'));
  writeFileSync(join(broken, 'document-types', 'x.toml'), 'kind = "document-type"\n');
  const r3 = await mirai(root, [], broken);
  assert.equal(r3.code, EXIT.CONFIG);
  assert.match(r3.err, /problems? in the registry/);

  // [docs] root comes from the project config; a broken config is exit 3.
  mkdirSync(join(root, '.mirai'));
  writeFileSync(join(root, '.mirai', 'config.toml'), 'schema_version = 1\n[git]\nintegration_branch = "main"\n[docs]\nroot = "notes"\n');
  writeFileSync(join(root, 'notes.md'), '# not a document\n');
  mkdirSync(join(root, 'notes'));
  writeFileSync(join(root, 'notes', 'plain.md'), '# Just text\n');
  const moved = await mirai(root, ['--json']);
  // docs/mirai is now outside the docs root: its known types are still linted (old.md's warning);
  // notes/ is the docs root, so its plain file is a problem.
  assert.deepEqual(JSON.parse(moved.out).problems.map((p) => `${p.file} ${p.code}`), ['docs/mirai/login/old.md template-older', 'notes/plain.md no-frontmatter']);
  writeFileSync(join(root, '.mirai', 'config.toml'), 'schema_version = 1\n[git]\nintegration_branch = "main"\n[docs]\nroot = "../outside"\n');
  assert.equal((await mirai(root, [])).code, EXIT.CONFIG);

  // Hostile text in a reason is shown escaped.
  rmSync(join(root, '.mirai'), { recursive: true });
  writeFileSync(join(root, 'docs', 'mirai', 'login', 'odd.md'), replace(LOGIN, '## Summary', '## Sum‮mary'));
  const odd = await mirai(root, []);
  assert.doesNotMatch(odd.out, /‮/);
  assert.match(odd.out, /\\u202e/);

  // --json is escaped too.
  const oddJson = await unchanged(root, ['--json']);
  assert.doesNotMatch(oddJson.out, /\u202e/);
  assert.ok(JSON.parse(oddJson.out).problems.some((p) => p.reason.includes('\u202e')));

  // git's list: what .gitignore excludes isn't linted, unless... it's never listed.
  rmSync(join(root, 'docs', 'mirai', 'login', 'odd.md'));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist', 'page.md'), replace(LOGIN, 'priority: high', 'priority: yes'));
  writeFileSync(join(root, '.gitignore'), 'dist/\n');
  // dist/page.md isn't listed: the one warning is old.md's; skipped are docs/README.md,
  // notes.md and notes/plain.md (the docs root is docs/mirai again).
  assert.match((await unchanged(root, [])).out, /\n4 files, 0 problems, 1 warning, 3 skipped\n$/);
  assert.doesNotMatch((await mirai(root, [])).out, /dist/);
  writeFileSync(join(root, '.gitignore'), '');
  assert.match((await mirai(root, [])).out, /dist\/page\.md:9:11: warning/);

  // Outside git, the files must be named.
  const plain = repo();
  assert.equal((await mirai(plain, [])).code, EXIT.USAGE);
  assert.equal((await mirai(plain, ['docs'])).code, EXIT.OK);
});

test('T12: scanner fixes from review: code spans vs comments, long lines, linear time, bare URLs, prose that looks like a link', () => {
  // A `<!--` inside a code span is not a comment; a backtick inside a comment is not code.
  const withSpan = replace(LOGIN, 'Staff sign in to the people tool.', 'Start a hidden note with `<!--`.');
  assert.deepEqual(problemsOf(withSpan), []);
  assert.deepEqual(scanMarkdown('# T\n<!-- a `b -->\n## C\n').headings.map((h) => h.text), ['T', 'C']);

  // Lines over the limit aren't scanned and are a problem; lines under it scan in linear time.
  const long = scanMarkdown(`# T\n${'x'.repeat(10_001)}\n`);
  assert.deepEqual(long.problems.map((p) => `${p.line} ${p.code}`), ['2 long-line']);
  const started = process.hrtime.bigint();
  scanMarkdown([`${'['.repeat(9_999)}`, `# a${' '.repeat(9_990)}b`, `${'[a]('.repeat(2_499)}`, `${'`'.repeat(9_999)}`, `${'<a:'.repeat(3_333)}`].join('\n'));
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 1000, `took ${ms} ms`);

  // Bare URLs are links (for the credential check); link targets and HTML don't hold IDs.
  const bare = scanMarkdown('# T\nSee https://example.com/a, then <span title="FR-9">x</span> [y](https://e.x/FR-8).\n');
  assert.deepEqual(bare.links.map((l) => `${l.kind} ${l.target} ${l.column}`), ['inline https://e.x/FR-8 65', 'bare https://example.com/a 5']);
  assert.doesNotMatch(bare.lines[1].text, /FR-/);

  // `[TODO]: fix it` is prose, not a reference definition; a real one may have a title.
  assert.deepEqual(scanMarkdown('[TODO]: fix the login flow\n[ref]: ./x.md "Title"\n').links.map((l) => `${l.kind} ${l.target}`), ['reference ./x.md']);

  // A fence closes only with its own indentation (or up to 3 more); setext needs a plain paragraph.
  assert.deepEqual(scanMarkdown('```\n    ```\n# x\n```\n').headings, []);
  assert.deepEqual(scanMarkdown('- a\n  continued\n---\n<details>\n---\n| a |\n---\n').problems, []);
  assert.deepEqual(scanMarkdown('# T\n[a]()\n').links.map((l) => `"${l.target}"`), ['""']);
});

test('T13: the docs root can\'t be escaped by links, letter case, extensions or special files', () => {
  const broken = replace(LOGIN, 'priority: high', 'priority: yes');
  const root = repo({ 'elsewhere/x.md': broken, 'real/docs/prd.md': broken });
  // A named path through a link, a linked folder, and letter case all stay inside.
  symlinkSync(join(root, 'docs', 'README.md'), join(root, 'docs', 'mirai', 'evil.md'));
  symlinkSync(join(root, 'elsewhere'), join(root, 'docs', 'mirai', 'sub'));
  assert.deepEqual(lint(root, ['docs/mirai/evil.md']).problems.map((p) => `${p.file} ${p.code}`), ['docs/mirai/evil.md symlink']);
  assert.deepEqual(lint(root, ['docs/mirai/sub/x.md']).problems.map((p) => `${p.file} ${p.code}`), ['docs/mirai/sub symlink']);
  assert.deepEqual(lint(root, ['docs/mirai']).problems.map((p) => `${p.file} ${p.code}`), ['docs/mirai/evil.md symlink', 'docs/mirai/sub symlink']);
  writeFileSync(join(root, 'docs', 'mirai', 'Broken.MD'), broken);
  writeFileSync(join(root, 'docs', 'mirai', 'b.markdown'), broken);
  writeFileSync(join(root, 'docs', 'mirai', 'diagram.png'), 'not text');
  const cased = lint(root, ['docs/mirai']).problems.map((p) => `${p.file} ${p.code}`);
  assert.ok(cased.includes('docs/mirai/Broken.MD frontmatter-ambiguous'), cased.join('\n'));
  assert.ok(cased.includes('docs/mirai/b.markdown frontmatter-ambiguous'));
  assert.ok(!cased.some((c) => c.includes('diagram.png')));
  // Letter case in a named path (on a case-insensitive file system it's the same file).
  let insensitive = true;
  try { statSync(join(root, 'DOCS')); } catch { insensitive = false; }
  if (insensitive) {
    assert.deepEqual(lint(root, ['DOCS/MIRAI/Broken.MD']).problems.map((p) => `${p.file} ${p.severity}`), ['docs/mirai/Broken.MD error']);
  }
  // The docs root itself as a link.
  const root2 = repo();
  rmSync(join(root2, 'docs', 'mirai'), { recursive: true });
  mkdirSync(join(root2, 'real'));
  symlinkSync(join(root2, 'real'), join(root2, 'docs', 'mirai'));
  assert.deepEqual(lint(root2).problems.map((p) => `${p.file} ${p.code}`), ['docs/mirai symlink']);

  // A FIFO named in the docs root is a problem, and never hangs the lint.
  const root3 = repo();
  execFileSync('mkfifo', [join(root3, 'docs', 'mirai', 'pipe.md')]);
  assert.deepEqual(lint(root3, ['docs/mirai/pipe.md']).problems.map((p) => p.code), ['not-a-file']);
  assert.ok(lint(root3).problems.some((p) => p.file === 'docs/mirai/pipe.md' && p.code === 'not-a-file'));

  // An unreadable folder: a problem inside, a warning outside; the rest is still linted.
  if (process.getuid?.() !== 0) {
    const root4 = repo({ 'data/db/x.md': 'x', 'docs/mirai/locked/y.md': 'y' });
    execFileSync('chmod', ['000', join(root4, 'data', 'db'), join(root4, 'docs', 'mirai', 'locked')]);
    try {
      const r = lint(root4);
      assert.deepEqual(r.problems.map((p) => `${p.file} ${p.code} ${p.severity}`), ['data/db unreadable warning', 'docs/mirai/locked unreadable error']);
      assert.equal(r.files, 3);
    } finally {
      execFileSync('chmod', ['755', join(root4, 'data', 'db'), join(root4, 'docs', 'mirai', 'locked')]);
    }
  }

  // Outside the root: a known type needs `template:` too, else it's left alone.
  const root5 = repo({ 'blog/post.md': '---\nid: post\ntype: sample\n---\n# Post\n' });
  assert.deepEqual(lint(root5).problems, []);
});

test('T14: IDs and links from review: definition forms, word ends, secrets in anchors and queries, the outside oracle', () => {
  // Only the definition form defines: later references in bullets and headings are mentions.
  const refs = replace(LOGIN, 'Not applicable — an internal tool with no outside users.', '- AC-FR-1.1 is the riskiest.\n\n### FR-1 under load\n\nFR-1-b and FR-1.5 are other things.');
  assert.deepEqual(problemsOf(refs), []);
  assert.deepEqual(problemsOf(replace(LOGIN, '### FR-2: Sign out', '### FR-2 — Sign out')), []);
  // Without the form, FR-2 is only mentioned: unknown, and its AC has no parent.
  assert.deepEqual(problemsOf(replace(LOGIN, '### FR-2: Sign out', '### FR-2 Sign out')).map((p) => p.split(' ')[1]), ['unknown-id', 'missing-parent']);

  // Secrets in a relative link's query or anchor are caught and never echoed; heading-like
  // anchors such as #session-timeout are not secrets.
  for (const link of ['[a](#password=hunter2)', '[a](../billing/prd.md#access_token=s3cr3tvalue)', '[a](../billing/prd.md?token=s3cr3tvalue)', 'See https://x:ghp_abcdefghijklmnopqrstuvwxyz0123456789@h.example/x']) {
    const root = repo({ 'docs/mirai/x/prd.md': replace(LOGIN, 'Staff sign in to the people tool.', link) });
    const problems = lint(root, ['docs/mirai/x/prd.md']).problems;
    assert.deepEqual(problems.map((p) => p.code), ['link-credential'], link);
    assert.doesNotMatch(JSON.stringify(problems), /hunter2|s3cr3t|ghp_/);
  }
  assert.deepEqual(problemsOf(replace(LOGIN, 'Staff sign in to the people tool.', '[a](#session-timeout)')).map((p) => p.split(' ')[1]), ['missing-anchor']);
  const odd = repo({ 'docs/mirai/x/prd.md': replace(LOGIN, 'Staff sign in to the people tool.', '[a](#<b>x</b>)') });
  assert.doesNotMatch(lint(odd, ['docs/mirai/x/prd.md']).problems.map((p) => p.reason).join(' '), /<b>/);
  // A query alone is not an anchor.
  assert.deepEqual(problemsOf(replace(LOGIN, 'Staff sign in to the people tool.', '[a](?x=1)')), []);

  // Through a link to a folder outside the repo, existing and missing files look the same.
  const root = repo();
  symlinkSync(tmpdir(), join(root, 'docs', 'mirai', 'tmp'));
  const exists = mkdtempSync(join(tmpdir(), 'mirai-oracle-'));
  writeFileSync(join(exists, 'there.md'), '# There\n');
  const name = exists.split(sep).at(-1);
  for (const target of [`tmp/${name}/there.md`, `tmp/${name}/missing.md`]) {
    writeFileSync(join(root, 'docs', 'mirai', 'login', 'prd.md'), replace(LOGIN, 'Staff sign in to the people tool.', `[a](../${target})`));
    const codes = lint(root, ['docs/mirai/login/prd.md']).problems.map((p) => p.code);
    assert.deepEqual(codes, ['link-outside'], target);
  }
  rmSync(exists, { recursive: true });
});

test('T15: Not applicable may wrap; dates before year 100; problems in an empty body point at the file', () => {
  const NA = 'Not applicable — an internal tool with no outside users.';
  assert.deepEqual(problemsOf(replace(LOGIN, NA, 'Not applicable — an internal tool with\nno outside users.')), []);
  assert.deepEqual(problemsOf(replace(LOGIN, 'updated: "2026-10-24"', 'updated: "0099-02-29"')), ['8:10 date']);
  assert.deepEqual(problemsOf(replace(LOGIN, 'updated: "2026-10-24"', 'updated: "0096-02-29"')), []);
  const head = LOGIN.slice(0, LOGIN.indexOf('# Login'));
  const lines = head.split('\n').length - 1;
  assert.ok(problemsOf(head).every((p) => Number(p.split(':')[0]) <= lines), problemsOf(head).join(' '));
  assert.deepEqual(problemsOf(replace(LOGIN, '# Login\n', 'Intro first.\n\n# Login\n')).map((p) => p.split(' ')[1]), ['title']);
});

test('T16: config: docs.root has one spelling; the gate default follows it', async () => {
  const { checkConfig } = await import('../../src/config/load.js');
  const { parseToml } = await import('../../src/config/toml.js');
  const layer = (text) => [{ kind: 'project', file: { ...parseToml(text, { positions: true }), source: '.mirai/config.toml' } }];
  const base = 'schema_version = 1\n[git]\nintegration_branch = "main"\n';
  for (const bad of ['.', './docs/mirai', 'docs//mirai', 'docs/./mirai', 'docs/mirai/', '/docs', '../docs', 'docs/../x']) {
    assert.throws(() => checkConfig(layer(`${base}[docs]\nroot = "${bad}"\n`)), (err) => err.errors.some((e) => e.path === 'docs.root'), bad);
  }
  assert.deepEqual(checkConfig(layer(base)).config.gate.code_paths, ['**', '!docs/mirai/**', '!.mirai/**']);
  assert.deepEqual(checkConfig(layer(`${base}[docs]\nroot = "documentation"\n`)).config.gate.code_paths, ['**', '!documentation/**', '!.mirai/**']);
  assert.deepEqual(checkConfig(layer(`${base}[docs]\nroot = "documentation"\n[gate]\ncode_paths = ["src/**"]\n`)).config.gate.code_paths, ['src/**']);
});
