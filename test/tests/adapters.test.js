import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadCustomTestAdapters, loadRegistry } from '../../src/config/registry.js';
import { adapterRun, filterName, regexEscape } from '../../src/tests/adapters.js';
import { checkPathForm, checkTestId, TEST_NAME_MAX } from '../../src/mcp/args.js';

// Unit 16a T3 and T4: the test adapter contract (data only, checked when loaded) and test IDs.

const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'mirai-16a-')));
  temps.push(d);
  return d;
};
const REGISTRY = new URL('../../registry/', import.meta.url).pathname;
const core = loadRegistry(REGISTRY).testAdapters;

const VALID = `kind = "test-adapter"
schema_version = 1
name = "mine"
description = "a project's own runner"

[report]
format = "junit"
args = ["--junit", "{report}"]
file = "file"

[select]
file = ["{path}"]
test = ["{path}", "--only={name}"]
`;
function custom(files) {
  const dir = tempDir();
  mkdirSync(join(dir, 'test-adapters'));
  for (const [n, body] of Object.entries(files)) writeFileSync(join(dir, 'test-adapters', n), body);
  return dir;
}
const problems = (body) => {
  try {
    loadCustomTestAdapters(custom({ 'x.toml': body }), core);
    return [];
  } catch (err) {
    return err.errors.map((e) => `${e.path}: ${e.reason}`);
  }
};

test('16a T3: the shipped adapters load and are data only', () => {
  assert.deepEqual(Object.keys(core).sort(), ['phpunit', 'playwright', 'vitest']);
  for (const a of Object.values(core)) {
    assert.equal(a.report.format, 'junit');
    assert.ok(a.select.file.join(' ').includes('{path'));
    assert.ok(a.select.test.join(' ').includes('{name'));
  }
  assert.deepEqual(readdirSync(join(REGISTRY, 'test-adapters')).sort(), ['phpunit.toml', 'playwright.toml', 'vitest.toml']);
});

test('16a T3: a project adapter loads from its folder; known fields and placeholders only; no value can start an argument; core names are MIRAI\'s', () => {
  assert.deepEqual(Object.keys(loadCustomTestAdapters(custom({ 'mine.toml': VALID }), core)), ['mine']);
  assert.deepEqual(loadCustomTestAdapters(tempDir(), core), {});
  const bad = (body, re) => assert.ok(problems(body).some((p) => re.test(p)), `${re}: ${problems(body).join('; ')}`);
  bad(VALID.replace('name = "mine"', 'name = "phpunit"'), /already used/);
  bad(`${VALID}shell = "sh -c"\n`, /unknown key/);
  bad(VALID.replace('"{report}"]', '"{home}"]'), /placeholder \{home\}/);
  bad(VALID.replace('test = ["{path}", "--only={name}"]', 'test = ["{path}", "{name}"]'), /starts with \{name\}/);
  bad(VALID.replace('test = ["{path}", "--only={name}"]', 'test = ["{path}", "{name:regex}x"]'), /starts with \{name\}/);
  bad(VALID.replace('test = ["{path}", "--only={name}"]', 'test = ["--only", "{name}"]'), /must name the file/);
  bad(VALID.replace('test = ["{path}", "--only={name}"]', 'test = ["{path}"]'), /must name the test/);
  bad(VALID.replace('file = ["{path}"]', 'file = ["{name}"]'), /placeholder \{name\}/);
  bad(VALID.replace('args = ["--junit", "{report}"]', 'args = ["--junit", "{path}"]'), /placeholder \{path\}/);
  bad(VALID.replace('args = ["--junit", "{report}"]', 'args = ["--x{"]'), /isn't a placeholder/);
  bad(VALID.replace('args = ["--junit", "{report}"]\n', ''), /needs args or env/);
  bad(VALID.replace('file = "file"', 'file = "path"'), /must be one of/);
  bad(`${VALID}\n[classify]\nload_output = ["(a"]\n`, /valid regular expression/);
  bad(`${VALID}\n[classify]\nload_output = ["(a)\\\\1"]\n`, /back-references/);
  bad(`${VALID}\n[classify]\nload_exit_codes = [0]\n`, /between 1 and 255/);
  bad(VALID.replace('args = ["--junit", "{report}"]', 'env = { lower = "{report}" }'), /not a valid name/);
});

test('16a T3: argv from an adapter: one element per template, placeholders filled, nothing split or quoted', () => {
  const a = core.phpunit;
  assert.deepEqual(adapterRun(a, { report: '/mirai/out/junit.xml' }), { args: ['--log-junit', '/mirai/out/junit.xml'], env: {} });
  assert.deepEqual(adapterRun(a, { report: '/o/j.xml', select: { path: '/var/www/html/tests/Unit' } }).args, ['--log-junit', '/o/j.xml', '/var/www/html/tests/Unit']);
  const one = adapterRun(a, { report: '/o/j.xml', select: { path: '/w/t/A.php', name: 'test_data with data set "x y" $(id)' } }).args;
  assert.deepEqual(one, ['--log-junit', '/o/j.xml', '--filter', '/::test_data with data set "x y" \\$\\(id\\)(?: with data set .*)?$/', '/w/t/A.php']);
  // Playwright: a file or a folder, anchored at the end or a "/"; the twin a.spec.tsx stays out.
  const [pw] = adapterRun(core.playwright, { report: '/o/j.xml', select: { path: '/e2e/tests/a.spec.ts' } }).args;
  const re = new RegExp(pw, 'gi');
  assert.ok(re.test('/e2e/tests/a.spec.ts') && !new RegExp(pw, 'gi').test('/e2e/tests/a.spec.tsx'));
  const [dir] = adapterRun(core.playwright, { report: '/o/j.xml', select: { path: '/e2e/tests' } }).args;
  assert.ok(new RegExp(dir, 'gi').test('/e2e/tests/a.spec.ts') && !new RegExp(dir, 'gi').test('/e2e/testsx/a.spec.ts'));
  // Playwright's report file comes from an environment variable.
  assert.deepEqual(adapterRun(core.playwright, { report: '/o/j.xml' }).env, { PLAYWRIGHT_JUNIT_OUTPUT_FILE: '/o/j.xml' });
  // A nested name: the report's separator becomes the filter's join.
  assert.equal(filterName(core.vitest, 'probe > inner > a b'), 'probe inner a b');
  assert.equal(filterName(core.playwright, 'probe › a b'), 'probe a b');
  assert.equal(filterName(core.phpunit, 'a > b'), 'a > b');
});

test('16a T4: regex escaping: every special character, so the name matches only itself', () => {
  const name = 'a.b*c+d?e^f$g(h)i[j]k{l}m|n\\o/p';
  const escaped = regexEscape(name);
  assert.ok(new RegExp(`^${escaped}$`).test(name));
  assert.ok(new RegExp(`^${escaped}$`, 'u').test(name));
  assert.ok(!new RegExp(`^${escaped}$`).test(name.replace('.', 'x')));
  assert.equal(regexEscape('plain name 1'), 'plain name 1');
});

test('16a T4: test IDs: <path>::<name>; the path by 14d\'s rules, the name plain printable text', () => {
  assert.deepEqual(checkTestId('backend/tests/A.php::test_x'), { path: 'backend/tests/A.php', name: 'test_x' });
  assert.deepEqual(checkTestId('src/a.test.ts::probe > regex (x)+ "q" [y]'), { path: 'src/a.test.ts', name: 'probe > regex (x)+ "q" [y]' });
  // Only the first "::" splits: a name may hold more.
  assert.deepEqual(checkTestId('t/a.php::A::b'), { path: 't/a.php', name: 'A::b' });
  assert.equal(checkTestId(`t/a::${'n'.repeat(TEST_NAME_MAX)}`).name.length, TEST_NAME_MAX);
  const refused = (id, re) => assert.throws(() => checkTestId(id), (e) => e.code === 'bad-path' && re.test(e.message), JSON.stringify(id));
  refused('', /empty/);
  refused('t/a.php', /<file>::<test name>/);
  refused('t/a.php::', /1 to/);
  refused(`t/a::${'n'.repeat(TEST_NAME_MAX + 1)}`, /1 to/);
  for (const c of ['\n', '\t', '\u0000', '\u001b[31m', '‮', '⁦', '​', '­', ' ', '\ud800', '\u{e0041}']) refused(`t/a::x${c}y`, /control, format/);
  refused('t/a::   ', /control, format|invisible/);
  for (const p of ['-x::n', '/etc/passwd::n', '../a::n', 'a/./b::n', 'a b::n', '$(x)::n']) assert.throws(() => checkTestId(p), (e) => e.code === 'bad-path', p);
  assert.equal(checkPathForm('a/b/'), 'a/b');
});

test('16a T3: the adapters\' sources hold no code', () => {
  for (const f of readdirSync(join(REGISTRY, 'test-adapters'))) {
    const text = readFileSync(join(REGISTRY, 'test-adapters', f), 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n');
    assert.doesNotMatch(text, /\$\(|`|\bsh -c\b|\beval\b/, f);
  }
});

test('16a T8: the adapter probes stay local: the sample app\'s images only, never pulled, nothing pushed, and only with --yes', async () => {
  const src = readFileSync(new URL('../probes/adapter-probes.js', import.meta.url), 'utf8');
  const { LOCAL_IMAGES, scenarios, FILES, BROKEN } = await import('../probes/adapter-probes.js');
  assert.deepEqual([...LOCAL_IMAGES].sort(), ['mirai-sample/app:dev', 'mirai-sample/e2e:dev', 'mirai-sample/frontend:dev', 'mysql:8.4', 'nginx:1.27-alpine']);
  assert.doesNotMatch(src, /['"](?:pull|push|build)['"]/);
  assert.match(src, /'remote', 'remove', 'origin'/);
  assert.match(src, /add --yes to run/);
  // Every scenario runs a level of the clone; every probe file is under the app's own folders.
  for (const s of scenarios()) assert.ok(s.level || s.mirai || s.command, s.id);
  for (const p of [...Object.keys(FILES), ...Object.keys(BROKEN)]) assert.match(p, /^(backend\/tests|frontend\/src|e2e\/tests)\//);
});
