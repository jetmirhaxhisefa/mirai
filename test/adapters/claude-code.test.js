import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, rmSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { init, FRAMEWORK_PARTS, PACKAGE_ROOT } from '../../src/install/init.js';
import { render } from '../../src/install/render.js';
import { readLock, checkLock, sha256, lockText as lockTextFor, LOCK_FILE } from '../../src/install/lock.js';
import { BLOCK_BEGIN, BLOCK_END, blockOf } from '../../src/install/agents-block.js';
import { loadRegistry } from '../../src/config/registry.js';
import { buildBundle } from '../../src/adapters/bundle.js';
import { AGENT_NOTE, hashOnDisk, renderAgent, writePluginDir } from '../../src/adapters/claude-code.js';
import { readFrontmatter } from '../../src/lint/frontmatter.js';
import { ConfigError } from '../../src/cli/errors.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/registry-agents/', import.meta.url));
const MODELS = { light: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5', deep: 'claude-opus-5-5' };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tempDir = (name) => {
  const d = mkdtempSync(join(tmpdir(), `mirai-${name}-`));
  temps.push(d);
  return d;
};

// A copy of MIRAI's package with the fixture agent and skill added to its registry, so an
// install carries them the way it will carry Kai and Rex. `version` changes package.json.
function fakePackage({ fixtures = true, version } = {}) {
  const dir = tempDir('pkg');
  for (const part of FRAMEWORK_PARTS) cpSync(join(PACKAGE_ROOT, part), join(dir, part), { recursive: true });
  if (fixtures) cpSync(FIXTURES, join(dir, 'registry'), { recursive: true });
  if (version) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
  }
  return dir;
}

function repo(files = {}) {
  const root = tempDir('repo');
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), '# App\n');
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'first');
  return { root, env: { PATH: process.env.PATH, HOME: tempDir('home') } };
}

const PKG = fakePackage();
const install = (r, opts = {}) => init({ cwd: r.root, env: r.env, branch: 'main', packageRoot: PKG, ...opts });
const read = (root, p) => readFileSync(join(root, p), 'utf8');

test('T1: the bundle is deterministic, and changes only with what it\'s made of', () => {
  const registry = loadRegistry(join(PKG, 'registry'));
  const a = buildBundle(registry, { models: MODELS, renderAgent });
  const b = buildBundle(loadRegistry(join(PKG, 'registry')), { models: { ...MODELS }, renderAgent });
  assert.equal(a.sharedHash, b.sharedHash);
  assert.deepEqual(a.files.map((f) => f.path), ['agents/mirai-fixture-reviewer.md', 'skills/mirai-docs/SKILL.md', 'skills/mirai-fixture-skill/SKILL.md', 'skills/mirai-fixture-skill/references/more.md']);
  // The tier the agent uses changes it; another tier doesn't.
  assert.notEqual(buildBundle(registry, { models: { ...MODELS, standard: 'claude-opus-5-5' }, renderAgent }).sharedHash, a.sharedHash);
  assert.equal(buildBundle(registry, { models: { ...MODELS, light: 'claude-sonnet-5-5' }, renderAgent }).sharedHash, a.sharedHash);
  // A changed prompt or description changes it.
  const pkg = fakePackage();
  writeFileSync(join(pkg, 'registry/prompts/reviewer.md'), '# Fixture reviewer\n\nChanged.\n');
  assert.notEqual(buildBundle(loadRegistry(join(pkg, 'registry')), { models: MODELS, renderAgent }).sharedHash, a.sharedHash);
  writeFileSync(join(pkg, 'registry/agents/reviewer.toml'), read(pkg, 'registry/agents/reviewer.toml').replace('for the adapter tests', 'for tests'));
  assert.notEqual(buildBundle(loadRegistry(join(pkg, 'registry')), { models: MODELS, renderAgent }).sharedHash, a.sharedHash);
  // A tier with no usable model name is refused, not written.
  assert.throws(() => buildBundle(registry, { models: { light: 'x' }, renderAgent }), /\[models\] standard is not a model name/);
  assert.throws(() => buildBundle(registry, { models: { ...MODELS, standard: 'a"\nb' }, renderAgent }), /\[models\] standard/);
});

test('T2: the interactive and headless bundles have the same content hash', () => {
  const r = repo();
  install(r);
  const registry = loadRegistry(join(r.root, '.mirai/framework/registry'));
  const profile = registry.adapters['claude-code'];
  const bundle = buildBundle(registry, { models: MODELS, renderAgent });
  const plugin = tempDir('plugin');
  writePluginDir(bundle, profile, plugin);
  assert.ok(existsSync(join(plugin, 'skills/mirai-docs/SKILL.md')) && existsSync(join(plugin, 'agents/mirai-fixture-reviewer.md')));
  const interactive = hashOnDisk(r.root, profile.interactive);
  assert.equal(interactive, hashOnDisk(plugin, profile.headless));
  assert.equal(interactive, bundle.sharedHash);
  // The lock records it once, per tool.
  assert.deepEqual(readLock(r.root).bundles, { 'claude-code': bundle.sharedHash });
  // A file added to one placement changes that placement's hash.
  writeFileSync(join(plugin, 'skills/mirai-docs/extra.md'), 'x');
  assert.notEqual(hashOnDisk(plugin, profile.headless), interactive);
});

test('T3: init renders CLAUDE.md, the skills and the agents, all rendered in the lock', () => {
  const r = repo();
  const out = install(r);
  assert.equal(read(r.root, 'CLAUDE.md'), `${BLOCK_BEGIN}\n@AGENTS.md\n${BLOCK_END}\n`);
  assert.equal(read(r.root, '.claude/skills/mirai-docs/SKILL.md'), read(PACKAGE_ROOT, 'registry/skills/mirai-docs/SKILL.md'));
  assert.equal(read(r.root, '.claude/skills/mirai-fixture-skill/references/more.md'), '# More\n\nA second file in the skill folder.\n');
  const agent = readFrontmatter(read(r.root, '.claude/agents/mirai-fixture-reviewer.md'));
  assert.deepEqual({ ...agent.value }, {
    name: 'mirai-fixture-reviewer',
    description: `Reviews one ticket's change for the adapter tests. ${AGENT_NOTE}`,
    tools: 'Read, Grep, Glob',
    model: 'claude-sonnet-5-5',
  });
  assert.equal(agent.body, '# Fixture reviewer\n\nRead the diff and report findings.\n');
  assert.ok(out.wrote.includes('CLAUDE.md') && out.wrote.includes('.claude/agents/mirai-fixture-reviewer.md'));

  const lock = readLock(r.root);
  const plain = (p) => JSON.parse(JSON.stringify(lock.files.get(p)));
  assert.deepEqual(plain('CLAUDE.md'), {
    path: 'CLAUDE.md', mark: 'rendered', block: 'mirai', sha256: sha256('@AGENTS.md'),
    from: [{ path: '.mirai/framework/registry/adapters/claude-code.toml', sha256: sha256(readFileSync(join(r.root, '.mirai/framework/registry/adapters/claude-code.toml'))) }],
  });
  const agentEntry = plain('.claude/agents/mirai-fixture-reviewer.md');
  assert.equal(agentEntry.sha256, sha256(readFileSync(join(r.root, '.claude/agents/mirai-fixture-reviewer.md'))));
  assert.deepEqual(agentEntry.from.map((f) => f.path), ['.mirai/config.toml', '.mirai/framework/registry/agents/reviewer.toml', '.mirai/framework/registry/prompts/reviewer.md']);
  assert.deepEqual(plain('.claude/skills/mirai-docs/SKILL.md').from.map((f) => f.path), ['.mirai/framework/registry/skills/mirai-docs/SKILL.md']);
  assert.deepEqual(checkLock(r.root), { changed: [], missing: [], added: [] });
  writeFileSync(join(r.root, '.claude/skills/mirai-docs/SKILL.md'), 'edited\n');
  assert.deepEqual(checkLock(r.root).changed, ['.claude/skills/mirai-docs/SKILL.md']);
});

test('T4: your CLAUDE.md, skills and agents stay yours; links and unlisted MIRAI names are refused', () => {
  const mine = '# Ours\n\n@AGENTS.md\n\nUse pnpm.\n';
  const r = repo({ 'CLAUDE.md': mine, '.claude/skills/ours/SKILL.md': '---\nname: ours\ndescription: "x"\n---\n', '.claude/agents/helper.md': '# helper\n', '.claude/settings.json': '{"theme":"dark","permissions":{"allow":["Bash(npm test)"],"deny":["Read(./secrets/**)"]}}\n' });
  const out = install(r);
  assert.equal(read(r.root, 'CLAUDE.md'), `${BLOCK_BEGIN}\n@AGENTS.md\n${BLOCK_END}\n\n${mine}`);
  assert.ok(out.warnings.some((w) => /CLAUDE\.md already has its own @AGENTS\.md line/.test(w)));
  assert.equal(read(r.root, '.claude/skills/ours/SKILL.md'), '---\nname: ours\ndescription: "x"\n---\n');
  assert.equal(read(r.root, '.claude/agents/helper.md'), '# helper\n');
  // Unit 13c merges MIRAI's denies into your settings; everything of yours stays.
  const settings = JSON.parse(read(r.root, '.claude/settings.json'));
  assert.equal(settings.theme, 'dark');
  assert.deepEqual(settings.permissions.allow, ['Bash(npm test)']);
  assert.equal(settings.permissions.deny[0], 'Read(./secrets/**)');
  assert.ok(settings.permissions.deny.includes('Read(~/.config/mirai/**)'));
  assert.ok(![...readLock(r.root).files.keys()].some((p) => /ours|helper/.test(p)));
  // The lock lists MIRAI's entries in it, not the whole file.
  const entry = readLock(r.root).files.get('.claude/settings.json');
  assert.equal(entry.block, 'mirai-settings');
  assert.ok(!entry.entries.includes('Read(./secrets/**)'));

  // A MIRAI-named file the lock doesn't list: refused, nothing written.
  const taken = repo({ '.claude/agents/mirai-mine.md': '# mine\n' });
  assert.throws(() => install(taken), (err) => err.code === 'conflict' && /mirai-mine\.md isn't listed/.test(err.message));
  assert.ok(!existsSync(join(taken.root, '.mirai')) && !existsSync(join(taken.root, 'CLAUDE.md')));
  assert.equal(read(taken.root, '.claude/agents/mirai-mine.md'), '# mine\n');

  // CLAUDE.md linked to AGENTS.md is left alone: Claude Code reads AGENTS.md through it.
  const linked = repo({ 'AGENTS.md': '# Ours\n' });
  symlinkSync('AGENTS.md', join(linked.root, 'CLAUDE.md'));
  install(linked);
  assert.ok(lstatSync(join(linked.root, 'CLAUDE.md')).isSymbolicLink());
  assert.ok(read(linked.root, 'CLAUDE.md').startsWith(BLOCK_BEGIN));
  assert.ok(!readLock(linked.root).files.has('CLAUDE.md'));
  assert.equal(render({ cwd: linked.root, env: linked.env }).files.find((f) => f.path === 'CLAUDE.md'), undefined);

  // Any other link is refused.
  const other = repo({ 'NOTES.md': '# notes\n' });
  symlinkSync('NOTES.md', join(other.root, 'CLAUDE.md'));
  assert.throws(() => install(other), (err) => err.code === 'symlink' && /CLAUDE\.md is a symbolic link/.test(err.message));
  const linkedDir = repo();
  mkdirSync(join(linkedDir.root, '.claude'));
  symlinkSync(tempDir('elsewhere'), join(linkedDir.root, '.claude/skills'));
  assert.throws(() => install(linkedDir), (err) => err.code === 'lock-symlink' && /\.claude\/skills is a symbolic link/.test(err.message));
  assert.ok(!existsSync(join(linkedDir.root, '.mirai')));
});

test('T5: mirai render follows the config, re-renders edits, and changes nothing twice', () => {
  const r = repo();
  install(r);
  // A changed [models] re-renders the agent file and its lock entry.
  writeFileSync(join(r.root, '.mirai/config.toml'), `${read(r.root, '.mirai/config.toml')}\n[models]\nstandard = "claude-opus-5-5"\n`);
  const first = render({ cwd: r.root, env: r.env });
  assert.deepEqual(first.files.filter((f) => f.changed).map((f) => f.path), ['.claude/agents/mirai-fixture-reviewer.md']);
  assert.equal(readFrontmatter(read(r.root, '.claude/agents/mirai-fixture-reviewer.md')).value.model, 'claude-opus-5-5');
  assert.deepEqual(checkLock(r.root), { changed: [], missing: [], added: [] });
  // Twice: nothing changes, not even the lock's bytes.
  const lockBytes = read(r.root, LOCK_FILE);
  const again = render({ cwd: r.root, env: r.env });
  assert.ok(again.files.every((f) => !f.changed && !f.edited));
  assert.equal(read(r.root, LOCK_FILE), lockBytes);
  // A hand-edited skill is rendered again, and said so.
  const skill = read(r.root, '.claude/skills/mirai-docs/SKILL.md');
  writeFileSync(join(r.root, '.claude/skills/mirai-docs/SKILL.md'), 'mine now\n');
  assert.deepEqual(render({ cwd: r.root, env: r.env }).files.find((f) => f.path === '.claude/skills/mirai-docs/SKILL.md'), { path: '.claude/skills/mirai-docs/SKILL.md', changed: true, edited: true });
  assert.equal(read(r.root, '.claude/skills/mirai-docs/SKILL.md'), skill);
  // A definition gone from the registry (a refresh to a MIRAI without it): its files and lock
  // entries go too, and its now-empty folders.
  const out = init({ cwd: r.root, env: r.env, refresh: true, packageRoot: fakePackage({ fixtures: false }) });
  assert.ok(out.wrote.includes('.claude/agents/mirai-fixture-reviewer.md (removed)'));
  assert.ok(!existsSync(join(r.root, '.claude/agents/mirai-fixture-reviewer.md')));
  assert.ok(!existsSync(join(r.root, '.claude/skills/mirai-fixture-skill')));
  assert.ok(existsSync(join(r.root, '.claude/skills/mirai-docs/SKILL.md')));
  assert.ok(![...readLock(r.root).files.keys()].some((p) => p.includes('fixture')));
  assert.deepEqual(checkLock(r.root), { changed: [], missing: [], added: [] });
});

test('T6: skill, agent and adapter definitions are checked, with file, line and column', () => {
  const problems = (setup) => {
    const dir = tempDir('reg');
    cpSync(join(PKG, 'registry'), dir, { recursive: true });
    setup(dir);
    try {
      loadRegistry(dir);
    } catch (err) {
      assert.ok(err instanceof ConfigError, String(err));
      return err.errors;
    }
    return assert.fail('expected registry problems');
  };
  const skill = (dir, name, text) => {
    mkdirSync(join(dir, 'skills', name), { recursive: true });
    writeFileSync(join(dir, 'skills', name, 'SKILL.md'), text);
  };
  const one = (errors, re) => {
    const e = errors.find((x) => re.test(x.reason));
    assert.ok(e, `${re}: ${errors.map((x) => x.reason).join(' | ')}`);
    assert.ok(e.source && e.line >= 1 && e.column >= 1, JSON.stringify(e));
    return e;
  };
  one(problems((d) => skill(d, 'Mirai_Bad', '---\nname: Mirai_Bad\ndescription: "x"\n---\n')), /a skill's name is "mirai-"/);
  assert.equal(one(problems((d) => skill(d, 'mirai-a', '---\nname: mirai-b\ndescription: "x"\n---\n')), /doesn't match its folder/).line, 2);
  one(problems((d) => skill(d, 'mirai-a', `---\nname: mirai-a\ndescription: "${'x'.repeat(1025)}"\n---\n`)), /description is not valid/);
  // At most 500 lines: exactly 500 passes, 501 doesn't.
  const lines = (n) => `---\nname: mirai-a\ndescription: "x"\n---\n${'line\n'.repeat(n - 4)}`;
  const ok = tempDir('reg');
  cpSync(join(PKG, 'registry'), ok, { recursive: true });
  skill(ok, 'mirai-a', lines(500));
  assert.ok(loadRegistry(ok).skills['mirai-a']);
  one(problems((d) => skill(d, 'mirai-a', lines(501))), /has 501 lines; at most 500/);
  one(problems((d) => skill(d, 'mirai-a', '---\nname: mirai-a\ndescription: "a\u0085b"\n---\n')), /not allowed|description is not valid/);
  one(problems((d) => { skill(d, 'mirai-a', '---\nname: mirai-a\ndescription: "x"\n---\n'); writeFileSync(join(d, 'skills/mirai-a/bad name.md'), 'x'); }), /a file name in a skill uses only/);
  // Hidden files aren't part of a skill.
  const hidden = tempDir('reg');
  cpSync(join(PKG, 'registry'), hidden, { recursive: true });
  writeFileSync(join(hidden, 'skills/mirai-docs/.DS_Store'), 'x');
  assert.deepEqual(loadRegistry(hidden).skills['mirai-docs'].files, ['SKILL.md']);
  // An agent lists its tools, never none; a read-only one gets no tool that writes.
  one(problems((d) => writeFileSync(join(d, 'agents/reviewer.toml'), read(d, 'agents/reviewer.toml').replace('allowed = ["Read", "Grep", "Glob"]', 'allowed = []'))), /must list at least one tool/);
  one(problems((d) => writeFileSync(join(d, 'agents/reviewer.toml'), read(d, 'agents/reviewer.toml').replace(/\n\[tools\]\nallowed = .*\n/, '\n'))), /tools is required/);
  one(problems((d) => writeFileSync(join(d, 'agents/reviewer.toml'), read(d, 'agents/reviewer.toml').replace('"Glob"]', '"Glob", "Edit", "Bash"]'))), /a read-only agent can't have Edit, Bash/);
  one(problems((d) => writeFileSync(join(d, 'agents/reviewer.toml'), read(d, 'agents/reviewer.toml').replace(/^description = .*$/m, `description = "${'x'.repeat(951)}"`))), /description is not valid/);
  one(problems((d) => writeFileSync(join(d, 'adapters/claude-code.toml'), read(d, 'adapters/claude-code.toml').replace('skills = ".claude/skills"', 'skills = ".mirai/skills"'))), /can't be AGENTS\.md or a path under \.mirai/);
  one(problems((d) => skill(d, 'mirai-a', '---\nname: mirai-a\ndescription: "x"\nlicense: MIT\n---\n')), /license/);
  one(problems((d) => skill(d, 'mirai-a', '# no frontmatter\n')), /has no frontmatter/);
  one(problems((d) => { skill(d, 'mirai-a', '---\nname: mirai-a\ndescription: "x"\n---\n'); symlinkSync('/etc/hosts', join(d, 'skills/mirai-a/hosts')); }), /not a regular file/);
  one(problems((d) => writeFileSync(join(d, 'agents/reviewer.toml'), read(d, 'agents/reviewer.toml').replace(/^description = .*\n/m, ''))), /description is required/);
  one(problems((d) => writeFileSync(join(d, 'adapters/claude-code.toml'), `${read(d, 'adapters/claude-code.toml')}\n[extra]\nx = 1\n`)), /extra/);
});

test('T7: the skill MIRAI ships passes its own checks and uses only the portable fields', () => {
  const registry = loadRegistry(join(PACKAGE_ROOT, 'registry'));
  assert.deepEqual(Object.keys(registry.skills), ['mirai-docs']);
  assert.deepEqual(Object.keys(registry.adapters), ['claude-code']);
  const fm = readFrontmatter(readFileSync(join(PACKAGE_ROOT, 'registry/skills/mirai-docs/SKILL.md')));
  assert.deepEqual(Object.keys(fm.value), ['name', 'description']);
  assert.ok(fm.value.description.length <= 1024);
  // It tells agents not to run mirai, and not to edit MIRAI's files.
  assert.match(fm.body, /You don't run `mirai`/);
  assert.match(fm.body, /Don't edit\*\* `\.mirai\/`, `AGENTS\.md` or `CLAUDE\.md`/);
});

test('T9: init --refresh gives an installed repo this MIRAI\'s copy, keeps your files, and undoes a failure', () => {
  const r = repo();
  // Not installed: nothing to refresh.
  assert.throws(() => install(r, { refresh: true }), (err) => err.code === 'not-installed');
  init({ cwd: r.root, env: r.env, branch: 'main', packageRoot: fakePackage({ version: '0.0.9' }) });
  writeFileSync(join(r.root, '.mirai/context/agents-local.md'), 'Use pnpm.\n');
  writeFileSync(join(r.root, 'AGENTS.md'), `${read(r.root, 'AGENTS.md')}\n# Ours\n`);
  const store = readdirSync(join(r.env.HOME, 'Library/Application Support/mirai'));

  // A refresh that fails (git ignores .claude/) leaves everything as it was.
  writeFileSync(join(r.root, '.gitignore'), '.claude/\n');
  const before = snapshotOf(r.root);
  assert.throws(() => install(r, { refresh: true }), (err) => err.code === 'ignored');
  assert.deepEqual(snapshotOf(r.root), before);
  rmSync(join(r.root, '.gitignore'));

  const out = install(r, { refresh: true });
  assert.equal(out.previous, '0.0.9');
  assert.equal(readLock(r.root).miraiVersion, JSON.parse(read(PKG, 'package.json')).version);
  assert.equal(read(r.root, '.mirai/framework/package.json'), read(PKG, 'package.json'));
  assert.equal(read(r.root, '.mirai/context/agents-local.md'), 'Use pnpm.\n');
  assert.match(blockOf(read(r.root, 'AGENTS.md')), /Use pnpm\.$/);
  assert.ok(read(r.root, 'AGENTS.md').endsWith('\n# Ours\n'));
  assert.deepEqual(readdirSync(join(r.env.HOME, 'Library/Application Support/mirai')), store);
  assert.deepEqual(checkLock(r.root), { changed: [], missing: [], added: [] });
  assert.ok(!readdirSync(join(r.root, '.mirai')).some((n) => n.startsWith('.init-')));

  // A changed framework file would be lost, so the refresh is refused and nothing changes.
  writeFileSync(join(r.root, '.mirai/framework/src/cli/main.js'), '// mine\n');
  const lock = read(r.root, LOCK_FILE);
  assert.throws(() => install(r, { refresh: true }), (err) => err.code === 'framework-changed' && /src\/cli\/main\.js/.test(err.message));
  assert.equal(read(r.root, '.mirai/framework/src/cli/main.js'), '// mine\n');
  assert.equal(read(r.root, LOCK_FILE), lock);
  // mirai render refuses too, and points to the refresh.
  assert.throws(() => render({ cwd: r.root, env: r.env }), (err) => err.code === 'framework-changed' && /git checkout -- \.mirai/.test(err.hint));
  // An older MIRAI never replaces a newer copy.
  writeFileSync(join(r.root, '.mirai/framework/src/cli/main.js'), readFileSync(join(PKG, 'src/cli/main.js')));
  assert.throws(() => init({ cwd: r.root, env: r.env, refresh: true, packageRoot: fakePackage({ version: '0.0.1' }) }), (err) => err.code === 'downgrade');
});

test('T10: the edge cases from the review', () => {
  // Case: macOS disks are case-insensitive, so your MIRAI-DOCS is MIRAI's mirai-docs folder.
  const upper = repo({ '.claude/skills/MIRAI-DOCS/SKILL.md': 'MY OWN SKILL\n' });
  assert.throws(() => install(upper), (err) => err.code === 'conflict' && /MIRAI-DOCS/.test(err.message));
  assert.equal(read(upper.root, '.claude/skills/MIRAI-DOCS/SKILL.md'), 'MY OWN SKILL\n');

  // Links: .claude itself, .claude/agents, and a listed file turned into a link before a removal.
  for (const where of ['.claude', '.claude/agents']) {
    const r = repo();
    mkdirSync(join(r.root, '.claude'), { recursive: true });
    if (where === '.claude') rmSync(join(r.root, '.claude'), { recursive: true });
    symlinkSync(tempDir('elsewhere'), join(r.root, where));
    assert.throws(() => install(r), (err) => err.code === 'lock-symlink', where);
  }
  const linkedFile = repo();
  install(linkedFile);
  const secret = join(tempDir('outside'), 'secret.txt');
  writeFileSync(secret, 'SECRET\n');
  rmSync(join(linkedFile.root, '.claude/skills/mirai-fixture-skill/references/more.md'));
  symlinkSync(secret, join(linkedFile.root, '.claude/skills/mirai-fixture-skill/references/more.md'));
  assert.throws(() => init({ cwd: linkedFile.root, env: linkedFile.env, refresh: true, packageRoot: fakePackage({ fixtures: false }) }), (err) => err.code === 'lock-symlink');
  assert.ok(lstatSync(join(linkedFile.root, '.claude/skills/mirai-fixture-skill/references/more.md')).isSymbolicLink());

  // .claude/skills as a file is refused plainly.
  const notDir = repo({ '.claude/skills': 'x' });
  assert.throws(() => install(notDir), (err) => err.code === 'not-folder' && /\.claude\/skills is not a folder/.test(err.message));
  assert.ok(!existsSync(join(notDir.root, '.mirai')));

  // A dangling CLAUDE.md -> AGENTS.md link is fine on a first install: AGENTS.md is about to exist.
  const dangling = repo();
  symlinkSync('AGENTS.md', join(dangling.root, 'CLAUDE.md'));
  install(dangling);
  assert.ok(read(dangling.root, 'CLAUDE.md').startsWith(BLOCK_BEGIN));

  // Render removes a lock entry that no longer applies (CLAUDE.md turned into a link), and a
  // hand-edited file that MIRAI no longer ships is removed with a warning.
  const r = repo();
  install(r);
  rmSync(join(r.root, 'CLAUDE.md'));
  symlinkSync('AGENTS.md', join(r.root, 'CLAUDE.md'));
  const out = render({ cwd: r.root, env: r.env });
  assert.deepEqual(out.removed, ['CLAUDE.md']);
  assert.ok(!readLock(r.root).files.has('CLAUDE.md'));
  writeFileSync(join(r.root, '.claude/skills/mirai-fixture-skill/SKILL.md'), 'mine\n');
  const gone = init({ cwd: r.root, env: r.env, refresh: true, packageRoot: fakePackage({ fixtures: false }) });
  assert.ok(gone.warnings.some((w) => /mirai-fixture-skill\/SKILL\.md: edited by hand, and removed/.test(w)));

  // A write failing partway through render undoes the files already written, and the lock.
  const p = repo();
  install(p);
  writeFileSync(join(p.root, '.mirai/config.toml'), `${read(p.root, '.mirai/config.toml')}\n[models]\nstandard = "claude-opus-5-5"\n`);
  writeFileSync(join(p.root, '.mirai/context/agents-local.md'), 'New rule.\n');
  const before = snapshotOf(p.root);
  chmodSync(join(p.root, '.claude/agents'), 0o555);
  try {
    assert.throws(() => render({ cwd: p.root, env: p.env }), (err) => err.code === 'EACCES' && !/undoing it failed/.test(err.message));
  } finally {
    chmodSync(join(p.root, '.claude/agents'), 0o755);
  }
  assert.deepEqual(snapshotOf(p.root), before);

  // A teammate's CRLF checkout of the rendered files isn't an edit.
  const crlf = repo();
  install(crlf);
  const skillPath = join(crlf.root, '.claude/skills/mirai-docs/SKILL.md');
  writeFileSync(skillPath, read(crlf.root, '.claude/skills/mirai-docs/SKILL.md').replace(/\n/g, '\r\n'));
  assert.deepEqual(checkLock(crlf.root), { changed: [], missing: [], added: [] });
  assert.ok(render({ cwd: crlf.root, env: crlf.env }).files.every((f) => !f.edited && !f.changed));

  // A lock this MIRAI can't read, written by a newer one, says so.
  const lockText = JSON.parse(read(crlf.root, LOCK_FILE));
  writeFileSync(join(crlf.root, LOCK_FILE), JSON.stringify({ ...lockText, mirai_version: '9.0.0', future_field: 1 }));
  assert.throws(() => readLock(crlf.root), (err) => err.code === 'lock-newer' && /9\.0\.0/.test(err.message));

  // An install whose registry has no adapter (older than this unit): render points to the refresh.
  const old = repo();
  install(old);
  const lock = JSON.parse(read(old.root, LOCK_FILE));
  rmSync(join(old.root, '.mirai/framework/registry/adapters/claude-code.toml'));
  lock.files = lock.files.filter((f) => f.path !== '.mirai/framework/registry/adapters/claude-code.toml');
  delete lock.framework_sha256;
  writeFileSync(join(old.root, LOCK_FILE), lockTextOf(lock));
  assert.throws(() => render({ cwd: old.root, env: old.env }), (err) => err.code === 'no-adapter' && /--refresh/.test(err.hint));
});

// Every path under `dir` (outside .git) with its bytes' hash.
function snapshotOf(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (p === '.git') continue;
      if (e.isDirectory()) { out.push(`${p}/`); walk(p); } else out.push(`${p} ${sha256(readFileSync(join(dir, p)))}`);
    }
  };
  walk('');
  return out.sort();
}

// A lock's text from its parsed form (recomputing framework_sha256).
const lockTextOf = (lock) => lockTextFor({ miraiVersion: lock.mirai_version, source: lock.source, bundles: lock.bundles, files: lock.files });

test('T11 (unit 13c): MIRAI\'s hard denies are merged into .claude/settings.json; yours stay; removing one of MIRAI\'s is noticed and put back', () => {
  const r = repo({ '.claude/settings.json': '{\n  "permissions": {\n    "deny": ["Bash(rm -rf *)"]\n  },\n  "model": "sonnet"\n}\n' });
  install(r);
  const settings = () => JSON.parse(read(r.root, '.claude/settings.json'));
  const s = settings();
  assert.equal(s.model, 'sonnet');
  assert.equal(s.permissions.deny[0], 'Bash(rm -rf *)');
  for (const e of ['Read(~/.config/mirai/**)', 'Edit(~/.config/mirai/**)', 'Read(~/Library/Application Support/mirai/**)', 'Edit(/.git/**)', 'Edit(**/.git/**)',
    'Edit(/.mirai/keys/**)', 'Edit(/.mirai/records/**)', 'Bash(mirai approve *)', 'Bash(mirai token)', 'Agent(mirai-fixture-reviewer)']) {
    assert.ok(s.permissions.deny.includes(e), e);
  }
  // Rendering again changes nothing.
  assert.ok(render({ cwd: r.root, env: r.env }).files.every((f) => !f.changed));
  // Your own edits elsewhere in the file aren't a change to MIRAI's part.
  writeFileSync(join(r.root, '.claude/settings.json'), JSON.stringify({ ...settings(), theme: 'dark' }, null, 2));
  assert.deepEqual(checkLock(r.root).changed, []);
  // Removing one of MIRAI's denies is noticed, and render puts it back (keeping your edit).
  const edited = settings();
  edited.permissions.deny = edited.permissions.deny.filter((e) => e !== 'Read(~/.config/mirai/**)');
  writeFileSync(join(r.root, '.claude/settings.json'), JSON.stringify(edited, null, 2));
  assert.deepEqual(checkLock(r.root).changed, ['.claude/settings.json']);
  const out = render({ cwd: r.root, env: r.env });
  assert.deepEqual(out.files.find((f) => f.path === '.claude/settings.json'), { path: '.claude/settings.json', changed: true, edited: true });
  assert.ok(settings().permissions.deny.includes('Read(~/.config/mirai/**)'));
  assert.equal(settings().theme, 'dark');
  // A settings file that isn't a JSON object is refused, not overwritten.
  writeFileSync(join(r.root, '.claude/settings.json'), '{ not json');
  assert.throws(() => render({ cwd: r.root, env: r.env }), (err) => err.code === 'bad-settings');
  assert.equal(read(r.root, '.claude/settings.json'), '{ not json');
  // A deny that isn't a list is refused, not dropped; a leading byte-order mark is fine.
  writeFileSync(join(r.root, '.claude/settings.json'), '{"permissions":{"deny":"Bash(rm *)"}}');
  assert.throws(() => render({ cwd: r.root, env: r.env }), (err) => err.code === 'bad-settings' && /isn't a list/.test(err.message));
  writeFileSync(join(r.root, '.claude/settings.json'), '\uFEFF{"permissions":{"deny":["Bash(rm *)"]}}');
  render({ cwd: r.root, env: r.env });
  assert.equal(settings().permissions.deny[0], 'Bash(rm *)');
  assert.ok(settings().permissions.deny.includes('Edit(**/.mirai/keys/**)'));
  // No settings file yet: MIRAI makes one with only its denies.
  const fresh = repo();
  install(fresh);
  assert.deepEqual(Object.keys(JSON.parse(read(fresh.root, '.claude/settings.json'))), ['permissions']);
});
