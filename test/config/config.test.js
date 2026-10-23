import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig, readConfigFile, checkConfig } from '../../src/config/load.js';
import { parseToml } from '../../src/config/toml.js';
import { loadRegistry } from '../../src/config/registry.js';
import { PRESETS, NEVER_AUTO_STAGES, GATE_STAGES } from '../../src/config/defaults.js';
import { ConfigError } from '../../src/cli/errors.js';
import { EXIT } from '../../src/cli/exit-codes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'bin', 'mirai.js');
const MINIMAL = 'schema_version = 1\n[git]\nintegration_branch = "main"\n';

// A temporary repo with .mirai/config.toml, plus optional personal files.
function repo({ project = MINIMAL, personal, global } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mirai-03b-'));
  mkdirSync(join(dir, 'repo', '.mirai'), { recursive: true });
  if (project !== null) writeFileSync(join(dir, 'repo', '.mirai', 'config.toml'), project);
  const files = { projectRoot: join(dir, 'repo'), globalFile: join(dir, 'home', '.config', 'mirai', 'config.toml') };
  if (personal !== undefined) {
    files.personalRepoFile = join(dir, 'config.user.toml');
    writeFileSync(files.personalRepoFile, personal);
  }
  if (global !== undefined) {
    mkdirSync(dirname(files.globalFile), { recursive: true });
    writeFileSync(files.globalFile, global);
  }
  return { dir, files };
}

// Loads and returns the ConfigError (fails the test if loading succeeds).
function problems(options) {
  try {
    loadConfig(repo(options).files);
  } catch (err) {
    assert.ok(err instanceof ConfigError, String(err));
    return err;
  }
  return assert.fail('expected config problems');
}

const reasons = (err) => (err.errors ?? [{ reason: err.reason }]).map((e) => e.reason);

test('T1: layers merge in order, tables per key, arrays replaced, sources recorded', () => {
  const { files } = repo({
    project: `${MINIMAL}[models]\nlight = "project-light"\n[testing]\ntdd = "on"\n[[testing.levels]]\nname = "unit"\ncommand = ["npm", "test"]\n[[repos]]\nname = "api"\npath = "api"\n`,
    personal: 'schema_version = 1\n[models]\nlight = "my-light"\n[run]\nstop_by = "06:30"\n',
    global: 'schema_version = 1\n[subscription]\nplan = "max-20x"\n[usage]\nnight_max = 10\n',
  });
  const { config, sources } = loadConfig(files);
  assert.equal(config.models.light, 'my-light', 'personal wins over project');
  assert.equal(config.models.deep, 'claude-opus-5-5', 'defaults fill the rest of the table');
  assert.equal(config.testing.tdd, 'on');
  assert.equal(config.testing.tests, 'required', 'table merged per key');
  assert.deepEqual(config.repos, [{ name: 'api', path: 'api' }], 'array replaced whole, not merged with the default');
  assert.equal(config.usage.night_max, 10);
  assert.equal(config.usage.week_max, 60);
  assert.equal(config.subscription.plan, 'max-20x');
  assert.equal(config.run.stop_by, '06:30');
  assert.deepEqual(sources['models.light'], { source: files.personalRepoFile, line: 3, column: 1, type: 'string' });
  assert.equal(sources['git.integration_branch'].source, '.mirai/config.toml');
  assert.equal(sources['usage.week_max'].source, 'default');
  assert.equal(sources['gates.plan'].source, 'preset:supervised');
  assert.equal(sources['repos[0].name'].line, 12);
  assert.ok(Object.isFrozen(config) && Object.isFrozen(config.models), 'the config is frozen');
  assert.ok(Object.isFrozen(sources) && Object.isFrozen(sources['models.light']), 'the sources are frozen');
});

test('T2: a missing integration_branch is one clear error, and config check exits 3', () => {
  const err = problems({ project: 'schema_version = 1\n[git]\ntrailer = "X"\n' });
  assert.equal(err.exitCode, EXIT.CONFIG);
  assert.equal(err.errors.length, 1);
  assert.deepEqual(
    { ...err.errors[0] },
    { code: 'required', source: '.mirai/config.toml', line: 2, column: 1, path: 'git', reason: 'git.integration_branch is required', hint: 'add integration_branch = "main" under [git]' },
  );
  assert.match(reasons(problems({ project: 'schema_version = 1\n' }))[0], /git\.integration_branch is required/);
  assert.match(reasons(problems({ project: null }))[0], /file not found/);
});

test('T3: out-of-grammar TOML in any layer stops with that file\'s position', () => {
  const a = problems({ project: `${MINIMAL}git.trailer = "x"\n` });
  assert.match(a.message, /^\.mirai\/config\.toml:4:1: dotted keys are not supported/);
  const b = problems({ global: 'schema_version = 1\n[usage]\nnight_max = 1e1\n' });
  assert.match(b.message, /^~\/\.config\/mirai\/config\.toml:3:13: exponents are not supported/);
});

test('T4: credential-looking resources are refused, and the value is never echoed', () => {
  const secrets = [
    'https://user:hunter2@grafana.example.test/d/1',
    'https://user@grafana.example.test/d/1',
    'https://grafana.example.test/d/1?token=s3cr3tvalue',
    'https://grafana.example.test/d/1?api_key=s3cr3tvalue',
    'https://grafana.example.test/d/ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'https://example.test/sk-ant-abcdefghijklmnopqrstuvwxyz',
    'https://example.test/AKIAABCDEFGHIJKLMNOP',
    'https://example.test/github_pat_abcdefghijklmnopqrstuvwxyz',
    'https://example.test/glpat-abcdefghijklmnopqrstuvwxyz',
    'https://example.test/sk-proj-abcdefghijklmnopqrstuvwxyz',
    'https://example.test/xoxe-1234567890abc',
    'https://example.test/AIzaabcdefghijklmnopqrstuvwxyz012345678',
    'https://example.test/#access_token=s3cr3tvalue',
    'https://example.test/?X-Amz-Signature=s3cr3tvalue',
    'https://example.test/?private_token=s3cr3tvalue',
    'https://example.test/?Api-Key=s3cr3tvalue',
  ];
  for (const url of secrets) {
    const err = problems({ project: `${MINIMAL}[resources]\ngrafana = { name = "G", url = "${url}" }\n` });
    assert.match(reasons(err).join('\n'), /resources\.grafana\.url looks like it contains a credential/, url);
    const all = JSON.stringify({ message: err.message, errors: err.errors });
    for (const part of ['hunter2', 's3cr3tvalue', 'ghp_abc', 'sk-ant-abc', 'AKIAABC', 'github_pat_', 'glpat-', 'sk-proj', 'xoxe-', 'AIzaabc']) {
      assert.ok(!all.includes(part), `${part} echoed`);
    }
  }
  // Normal links stay allowed, including Google console links with ?authuser=.
  assert.doesNotThrow(() => loadConfig(repo({ project: `${MINIMAL}[resources]\ngcp = { url = "https://console.cloud.google.com/?authuser=0&project=p" }\n` }).files));
  // A token in any other field, or as a key name, is refused too, and never echoed.
  const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123';
  for (const project of [
    `${MINIMAL}[resources]\ngrafana = { name = "${token}", url = "https://g.example.test" }\n`,
    `${MINIMAL}[checks]\nlint = ["curl", "-H", "Authorization: ${token}"]\n`,
    `${MINIMAL}[[repos]]\nname = "api"\npath = "."\nstart = ["run", "${token}"]\n`,
    `${MINIMAL}[checks]\n${token} = ["x"]\n`,
  ]) {
    const err = problems({ project });
    assert.ok(err.errors.some((e) => e.code === 'credential'), project);
    assert.ok(!JSON.stringify({ m: err.message, e: err.errors }).includes(token), `token echoed for ${project}`);
  }
  // Remotes: only the conventional "git" user is allowed.
  for (const remote of ['https://s3cretvalue@github.com/o/r', 'oauth2:s3cret@gitlab.com:o/r', 'git+https://u:p@h.test/r']) {
    assert.match(reasons(problems({ project: `${MINIMAL}[[repos]]\nname = "api"\npath = "."\nremote = "${remote}"\n` })).join(), /credential/, remote);
  }
  for (const remote of ['git@github.com:o/r.git', 'ssh://git@github.com/o/r.git', 'https://github.com/o/r.git']) {
    assert.doesNotThrow(() => loadConfig(repo({ project: `${MINIMAL}[[repos]]\nname = "api"\npath = "."\nremote = "${remote}"\n` }).files), remote);
  }
  const ok = loadConfig(repo({ project: `${MINIMAL}[resources]\ngrafana = { name = "Grafana", url = "https://grafana.example.test/d/abc?orgId=1" }\n` }).files);
  assert.equal(ok.config.resources.grafana.name, 'Grafana');
  assert.match(reasons(problems({ project: `${MINIMAL}[[repos]]\nname = "api"\npath = "."\nremote = "https://u:p@github.com/o/r.git"\n` })).join(), /credential/);
});

test('T5: repos: the one-entry "." default validates; duplicates and ".." are refused', () => {
  assert.deepEqual(loadConfig(repo().files).config.repos, [{ name: '.', path: '.' }]);
  const explicit = loadConfig(repo({ project: `${MINIMAL}[[repos]]\nname = "."\npath = "."\n` }).files);
  assert.deepEqual(explicit.config.repos, [{ name: '.', path: '.' }]);
  const err = problems({ project: `${MINIMAL}[[repos]]\nname = "api"\npath = "../api"\n[[repos]]\nname = "api"\npath = "api"\n` });
  const r = reasons(err).join('\n');
  assert.match(r, /repos\[0\]\.path must be a relative path inside the repo/);
  assert.match(r, /repos\[1\]\.name repeats an earlier entry/);
});

test('T6: personal keys are refused in the project file, project keys in personal files', () => {
  const a = problems({ project: `${MINIMAL}[usage]\nnight_max = 10\n[subscription]\nplan = "max-20x"\n` });
  assert.deepEqual(reasons(a), ['usage is a personal setting', 'subscription is a personal setting']);
  assert.equal(a.errors[0].hint, 'move [usage] to ~/.config/mirai/config.toml');
  const b = problems({ personal: 'schema_version = 1\n[gates]\nplan = "auto"\n[checks]\nlint = ["true"]\n' });
  assert.deepEqual(reasons(b), ["gates can't be set in a personal file", "checks can't be set in a personal file"]);
  const steps = problems({ personal: 'schema_version = 1\n[models.steps]\nbuild = "light"\n' });
  assert.deepEqual(reasons(steps), ["models.steps can't be set in a personal file"]);
  const c = problems({ global: 'schema_version = 1\n[git]\nintegration_branch = "x"\n[models]\nlight = "y"\n' });
  assert.deepEqual(reasons(c), ["git can't be set in a personal file", "models can't be set in a personal file"]);
});

test('T7: never-auto gates refuse "auto"; presets fill every stage', () => {
  for (const stage of NEVER_AUTO_STAGES) {
    assert.deepEqual(reasons(problems({ project: `${MINIMAL}[gates]\n${stage} = "auto"\n` })), [`gates.${stage} can never be automatic`], stage);
  }
  for (const preset of Object.keys(PRESETS)) {
    const { config } = loadConfig(repo({ project: `preset = "${preset}"\n${MINIMAL}` }).files);
    assert.deepEqual(Object.keys(config.gates).sort(), [...GATE_STAGES].sort(), preset);
    for (const stage of NEVER_AUTO_STAGES) assert.equal(config.gates[stage], 'human', `${preset}.${stage}`);
  }
  assert.deepEqual(reasons(problems({ project: `gates = { merge = "auto" }\n${MINIMAL}` })), ['gates.merge can never be automatic']);
  const { config } = loadConfig(repo({ project: `preset = "autonomous"\n${MINIMAL}[gates]\nplan = "human"\n` }).files);
  assert.equal(config.gates.plan, 'human', 'a project can make an auto stage human');
  assert.equal(config.gates.build, 'auto');
  assert.equal(loadConfig(repo({ project: `preset = "autonomous"\n${MINIMAL}` }).files).config.gates.plan, 'auto');
});

test('T8: exact types, enums, times and unknown keys', () => {
  const err = problems({
    project: `${MINIMAL}[retention]\ndays = 90.0\n[testing]\ne2e_budget_minutes = "15"\ntdd = "sometimes"\n[run]\nstop_by = "25:00"\n[gate]\ncode_pathz = ["**"]\n`,
  });
  assert.deepEqual(err.errors.map((e) => [e.path, e.reason, e.hint]), [
    ['retention.days', 'retention.days must be a whole number', 'write it without a decimal point'],
    ['testing.e2e_budget_minutes', 'testing.e2e_budget_minutes must be a whole number', undefined],
    ['testing.tdd', 'testing.tdd must be one of: auto, on, off', undefined],
    ['run.stop_by', 'run.stop_by is not valid', 'a 24-hour time as a string, for example "06:30"'],
    ['gate.code_pathz', 'unknown key gate.code_pathz', 'did you mean "code_paths"?'],
  ]);
  assert.deepEqual(err.errors.map((e) => e.code), ['type', 'type', 'enum', 'pattern', 'unknown-key']);
  assert.match(reasons(problems({ project: 'schema_version = 2\n[git]\nintegration_branch = "main"\n' }))[0], /schema_version must be 1/);
  assert.match(reasons(problems({ project: `${MINIMAL}[models.steps]\nplna = "light"\n` }))[0], /unknown key models\.steps\.plna/);
  for (const branch of ['bad branch', '/main', 'feature/.hidden', '@', 'a..b', 'x.lock', '-x']) {
    assert.match(reasons(problems({ project: `schema_version = 1\n[git]\nintegration_branch = "${branch}"\n` }))[0], /integration_branch is not valid/, branch);
  }
  for (const branch of ['main', 'mirai/pilot', 'release-1.2']) {
    assert.doesNotThrow(() => loadConfig(repo({ project: `schema_version = 1\n[git]\nintegration_branch = "${branch}"\n` }).files), branch);
  }
  assert.match(reasons(problems({ project: 'schema_version = 1\n[git]\nintegration_branch = "bad branch"\n' }))[0], /integration_branch is not valid/);
  assert.match(reasons(problems({ project: `${MINIMAL}[models.steps]\nprd = "light"\n` }))[0], /models\.steps\.prd must stay "deep"/);
  assert.match(reasons(problems({ global: 'schema_version = 1\n[usage]\nnight_max = 70\nweek_max = 60\n' }))[0], /night_max must not be larger/);
});

test('T9: every schema problem in a file is collected, in file order', () => {
  const err = problems({
    project: 'schema_version = 1\npreset = "fast"\n[git]\nintegration_branch = "main"\ntrailer = "two words"\n[retention]\ndays = 0\n[gates]\nprod = "auto"\n[checks]\nLint = ["x"]\n',
  });
  assert.ok(err.errors.length >= 5, `only ${err.errors.length} problems collected`);
  const lines = err.errors.map((e) => e.line);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
  assert.equal(err.message, `${err.errors.length} problems in config`);
});

test('T10: readConfigFile: symlinks, size, encoding', () => {
  const { dir } = repo();
  const real = join(dir, 'real.toml');
  writeFileSync(real, MINIMAL);
  const link = join(dir, 'link.toml');
  symlinkSync(real, link);
  assert.throws(() => readConfigFile(link, { trust: 'project' }), /is a symbolic link/);
  assert.throws(() => readConfigFile(link, { trust: 'definition' }), /is a symbolic link/);
  assert.equal(readConfigFile(link, { trust: 'personal' }).value.schema_version, 1);
  const big = join(dir, 'big.toml');
  writeFileSync(big, `#${'x'.repeat(256 * 1024)}\n`);
  assert.throws(() => readConfigFile(big, { trust: 'project' }), /larger than/);
  const bad = join(dir, 'bad.toml');
  writeFileSync(bad, Buffer.from([0x61, 0x3d, 0x22, 0xc3, 0x22, 0x0a]));
  assert.throws(() => readConfigFile(bad, { trust: 'project' }), /not valid UTF-8/);
  assert.equal(readConfigFile(join(dir, 'missing.toml'), { trust: 'personal', optional: true }), null);
  assert.throws(() => readConfigFile(dir, { trust: 'project' }), /is not a file/);
  // A symlinked project config is refused through loadConfig too.
  const r = repo({ project: null });
  symlinkSync(real, join(r.files.projectRoot, '.mirai', 'config.toml'));
  assert.throws(() => loadConfig(r.files), /is a symbolic link/);
});

// A registry folder with one agent and one document type, plus their .md files.
function registry(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mirai-reg-'));
  for (const sub of ['agents', 'document-types', 'prompts', 'templates']) mkdirSync(join(dir, sub));
  writeFileSync(join(dir, 'prompts', 'developer.md'), '# Developer\n');
  writeFileSync(join(dir, 'templates', 'prd.md'), '# PRD\n');
  writeFileSync(join(dir, 'templates', 'prd-checklist.md'), '# Checklist\n');
  writeFileSync(join(dir, 'agents', 'developer.toml'), overrides.agent ?? [
    'kind = "agent"', 'schema_version = 1', 'name = "mirai-developer"', 'role = "developer"',
    'default_tier = "standard"', 'read_only = false', 'prompt = "prompts/developer.md"',
    '[may_write]', 'paths = ["src/**", "tests/**"]', '[tools]', 'allowed = ["Read", "Edit", "mcp__mirai__run_tests"]', '',
  ].join('\n'));
  writeFileSync(join(dir, 'document-types', 'prd.toml'), overrides.doc ?? [
    'kind = "document-type"', 'schema_version = 1', 'name = "prd"',
    'template = "templates/prd.md"', 'checklist = "templates/prd-checklist.md"',
    'required_sections = ["Problem", "Users", "Requirements"]',
    '[states]', 'names = ["draft", "in-review", "approved"]', 'initial = "draft"',
    '[[states.transitions]]', 'from = "draft"', 'to = "in-review"',
    '[[states.transitions]]', 'from = "in-review"', 'to = "approved"', 'human_only = true', '',
  ].join('\n'));
  return dir;
}

function registryProblems(dir) {
  try {
    loadRegistry(dir);
  } catch (err) {
    assert.ok(err instanceof ConfigError, String(err));
    return reasons(err).join('\n');
  }
  return assert.fail('expected registry problems');
}

test('T11: the registry loads valid definitions and refuses bad ones', () => {
  const reg = loadRegistry(registry());
  assert.equal(reg.agents['mirai-developer'].default_tier, 'standard');
  assert.equal(reg.documentTypes.prd.states.initial, 'draft');
  assert.ok(Object.isFrozen(reg.agents['mirai-developer']));

  const agent = (extra) => ['kind = "agent"', 'schema_version = 1', 'name = "mirai-developer"', 'role = "developer"', 'default_tier = "standard"', ...(extra.some((e) => e.startsWith('read_only')) ? [] : ['read_only = false']), ...extra, ''].join('\n');
  assert.match(registryProblems(registry({ agent: ['kind = "agent"', 'schema_version = 1', 'name = "mirai-x"', 'role = "x"', 'default_tier = "light"', 'prompt = "prompts/developer.md"', ''].join('\n') })), /read_only is required/);
  assert.match(registryProblems(registry({ agent: agent(['prompt = "prompts/developer.md"', '[may_write]', 'paths = ["../outside/**"]']) })), /may_write\.paths\[0\] is not valid/);
  assert.match(registryProblems(registry({ agent: agent(['prompt = "../outside.md"']) })), /prompt must stay inside the registry folder/);
  assert.match(registryProblems(registry({ agent: agent(['prompt = "/etc/passwd.md"']) })), /prompt must stay inside the registry folder/);
  assert.match(registryProblems(registry({ agent: agent(['prompt = "prompts/missing.md"']) })), /prompt points to a file that does not exist/);
  assert.match(registryProblems(registry({ agent: agent(['prompt = "prompts/developer.md"', 'read_only = true', '[may_write]', 'paths = ["src/**"]']) })), /read-only agent/);
  assert.match(registryProblems(registry({ agent: agent(['prompt = "prompts/developer.md"', 'default_tier = "huge"']) })), /already defined|default_tier/);

  const linked = registry();
  const outside = mkdtempSync(join(tmpdir(), 'mirai-out-'));
  writeFileSync(join(outside, 'x.md'), 'outside\n');
  symlinkSync(join(outside, 'x.md'), join(linked, 'prompts', 'linked.md'));
  writeFileSync(join(linked, 'agents', 'developer.toml'), agent(['prompt = "prompts/linked.md"']));
  assert.match(registryProblems(linked), /prompt is a symbolic link/);

  const viaDir = registry();
  symlinkSync(outside, join(viaDir, 'escape'));
  writeFileSync(join(viaDir, 'agents', 'developer.toml'), agent(['prompt = "escape/x.md"']));
  assert.match(registryProblems(viaDir), /prompt must stay inside the registry folder/);

  const dup = registry();
  writeFileSync(join(dup, 'agents', 'developer-2.toml'), readFileSync(join(dup, 'agents', 'developer.toml')));
  assert.match(registryProblems(dup), /name is already used by another agent definition/);

  const doc = (states) => ['kind = "document-type"', 'schema_version = 1', 'name = "prd"', 'template = "templates/prd.md"',
    'checklist = "templates/prd-checklist.md"', 'required_sections = ["Problem"]', '[states]', ...states, ''].join('\n');
  assert.match(registryProblems(registry({ doc: doc(['names = ["draft"]', 'initial = "approved"', 'transitions = []']) })), /initial is not one of/);
  assert.match(registryProblems(registry({ doc: doc(['names = ["draft", "done"]', 'initial = "draft"', '[[states.transitions]]', 'from = "draft"', 'to = "gone"']) })), /transitions\[0\]\.to is not one of/);
  const orphan = registryProblems(registry({ doc: doc(['names = ["draft", "orphan"]', 'initial = "draft"', 'transitions = []']) }));
  assert.match(orphan, /states\.names\[1\] can't be reached/);
  assert.ok(!orphan.includes('orphan'), 'state names are not echoed');

  const wrongKind = registry({ agent: ['kind = "document-type"', 'schema_version = 1', 'name = "mirai-x"', 'role = "x"', 'default_tier = "light"', 'prompt = "prompts/developer.md"', ''].join('\n') });
  assert.match(registryProblems(wrongKind), /kind must be one of: agent/);
});

function cli(args, cwd, home) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home }, timeout: 10_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('T12: mirai config check / show', () => {
  const { dir, files } = repo({ global: 'schema_version = 1\n[usage]\nnight_max = 12\n' });
  const home = join(dir, 'home');
  const ok = cli(['config', 'check'], files.projectRoot, home);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(ok.out, [
    'config OK (project + global)',
    'models: light = claude-haiku-5-5 (default), standard = claude-sonnet-5-5 (default), deep = claude-opus-5-5 (default)',
    '',
  ].join('\n'));

  const show = cli(['config', 'show'], files.projectRoot, home);
  assert.equal(JSON.parse(show.out).usage.night_max, 12);
  const withSources = JSON.parse(cli(['config', 'show', '--sources'], files.projectRoot, home).out);
  assert.equal(withSources.sources['git.integration_branch'], '.mirai/config.toml:3:1');
  assert.equal(withSources.sources['usage.night_max'], '~/.config/mirai/config.toml:3:1');
  assert.equal(withSources.sources['retention.days'], 'default');

  const bad = repo({ project: 'schema_version = 1\n[git]\n[usage]\nreserve = 5\n' });
  const r = cli(['config', 'check'], bad.files.projectRoot, join(bad.dir, 'home'));
  assert.equal(r.code, EXIT.CONFIG);
  assert.equal(r.err, [
    'mirai: 2 problems in config',
    '.mirai/config.toml:2:1: git.integration_branch is required',
    '  hint: add integration_branch = "main" under [git]',
    '.mirai/config.toml:3:1: usage is a personal setting',
    '  hint: move [usage] to ~/.config/mirai/config.toml',
    '',
  ].join('\n'));
  assert.equal(cli(['config', 'nope'], files.projectRoot, home).code, EXIT.USAGE);
  assert.equal(cli(['config', 'check', '--sources'], files.projectRoot, home).code, EXIT.USAGE);
  assert.equal(cli(['config'], files.projectRoot, home).code, EXIT.USAGE);
});

test('T13: the sample app\'s hand-written config validates', () => {
  const project = readFileSync(join(ROOT, 'test', 'config', 'fixtures', 'sample-app-config.toml'), 'utf8');
  const { config } = loadConfig(repo({ project }).files);
  assert.equal(config.git.integration_branch, 'main');
  assert.deepEqual(config.testing.levels.map((l) => l.name), ['unit', 'api', 'ui', 'e2e']);
  assert.deepEqual(Object.keys(config.checks), ['composer-validate', 'format', 'lint', 'types', 'build']);
  assert.equal(config.compose.env_file, 'backend/.env.testing');
});

test('T14: schema_version is checked in each file, before merging', () => {
  assert.deepEqual(problems({ project: '[git]\nintegration_branch = "main"\n', global: 'schema_version = 1\n' }).errors.map((e) => [e.source, e.code]),
    [['.mirai/config.toml', 'required']], 'a personal file can\'t supply the project\'s version');
  assert.deepEqual(problems({ project: 'schema_version = 2\n[git]\nintegration_branch = "main"\n', personal: 'schema_version = 1\n' }).errors.map((e) => e.code), ['version']);
  assert.deepEqual(problems({ personal: 'schema_version = 2\n' }).errors.map((e) => e.code), ['version']);
  assert.deepEqual(problems({ project: 'schema_version = 1.0\n[git]\nintegration_branch = "main"\n' }).errors.map((e) => e.code), ['version']);
});

test('T15: a symlinked .mirai folder or registry folder is refused', () => {
  const outside = mkdtempSync(join(tmpdir(), 'mirai-outside-'));
  writeFileSync(join(outside, 'config.toml'), `${MINIMAL}[gates]\nplan = "auto"\n`);
  const r = repo({ project: null });
  const mirai = join(r.files.projectRoot, '.mirai');
  spawnSync('rmdir', [mirai]);
  symlinkSync(outside, mirai);
  assert.throws(() => loadConfig(r.files), /is outside its folder/);

  const reg = registry();
  const elsewhere = mkdtempSync(join(tmpdir(), 'mirai-agents-'));
  writeFileSync(join(elsewhere, 'evil.toml'), readFileSync(join(reg, 'agents', 'developer.toml')));
  spawnSync('rm', ['-r', join(reg, 'agents')]);
  symlinkSync(elsewhere, join(reg, 'agents'));
  assert.match(registryProblems(reg), /agents must be a real folder inside the registry/);
});

test('T16: checkConfig works on parsed layers, without the file system (trust root, unit 12)', () => {
  const layer = (kind, text, source) => ({ kind, file: { ...parseToml(text, { source, positions: true }), source } });
  const { config } = checkConfig([layer('project', MINIMAL, '.mirai/config.toml (from git)')]);
  assert.equal(config.git.integration_branch, 'main');
  try {
    checkConfig([layer('project', `${MINIMAL}[usage]\nreserve = 1\n`, 'base:.mirai/config.toml')]);
    assert.fail('expected a problem');
  } catch (err) {
    assert.equal(err.errors[0].source, 'base:.mirai/config.toml');
    assert.equal(err.errors[0].code, 'layer');
  }
});

test('T17: checks, levels, code paths and errors keep one shape', () => {
  const ok = loadConfig(repo({ project: `${MINIMAL}[checks]\nlint = ["npm", "run", "lint"]\n[checks.e2e]\ncommand = ["npx", "playwright", "test"]\nservice = "playwright"\ntimeout_minutes = 20\n` }).files);
  assert.equal(ok.config.checks.e2e.timeout_minutes, 20);
  assert.deepEqual(problems({ project: `${MINIMAL}[checks.e2e]\nservice = "playwright"\n` }).errors.map((e) => e.reason), ['checks.e2e.command is required']);
  assert.match(reasons(problems({ project: `${MINIMAL}[[testing.levels]]\nname = "unit"\nrepo = "api"\ncommand = ["x"]\n` })).join(), /repo is not one of the repos/);
  assert.match(reasons(problems({ project: `${MINIMAL}[[testing.levels]]\nname = "unit"\ncommand = ["x"]\nrequired_for = ["sometimes"]\n` })).join(), /must be one of/);
  assert.match(reasons(problems({ project: `${MINIMAL}[gate]\ncode_paths = ["!**"]\n` })).join(), /needs at least one pattern that includes code/);
  // A single syntax error and a list of problems have the same shape.
  const single = problems({ project: 'a = \n' });
  assert.equal(single.errors.length, 1);
  assert.equal(single.errors[0].code, 'syntax');
  assert.equal(single.listed, false);
  assert.equal(problems({ project: 'schema_version = 1\n' }).listed, true);
});

test('T18: any model may be set for a tier, and a model outside its family is shown (D-58)', () => {
  const plain = loadConfig(repo().files);
  assert.deepEqual(plain.warnings, [], 'the defaults raise no warning');
  const fable = loadConfig(repo({ personal: 'schema_version = 1\n[models]\ndeep = "claude-fable-5-1"\n' }).files);
  assert.deepEqual(fable.warnings, [], 'Fable is in the deep family');

  const { dir, files } = repo({ personal: 'schema_version = 1\n[models]\ndeep = "claude-haiku-5-5"\n' });
  const { config, warnings } = loadConfig(files);
  assert.equal(config.models.deep, 'claude-haiku-5-5', 'your choice is kept');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'tier-family');
  assert.equal(warnings[0].message, `the deep tier uses claude-haiku-5-5 (set in ${files.personalRepoFile}:3:1), not an Opus or Fable model; prd, design, review-high-risk and every other deep step will run on it`);

  // The CLI shows the models and the warning (the project file here sets the model).
  const team = repo({ project: `${MINIMAL}[models]\nstandard = "claude-haiku-5-5"\n` });
  const out = cli(['config', 'check'], team.files.projectRoot, join(team.dir, 'home')).out;
  assert.match(out, /models: light = claude-haiku-5-5 \(default\), standard = claude-haiku-5-5 \(\.mirai\/config\.toml:5\)/);
  assert.match(out, /warning: the standard tier uses claude-haiku-5-5 \(set in \.mirai\/config\.toml:5:1\), not a Sonnet model; every standard step will run on it/);
  assert.ok(dir);
});
