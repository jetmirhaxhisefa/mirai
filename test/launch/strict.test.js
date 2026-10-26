import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, linkSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';

import { init } from '../../src/install/init.js';
import { openStore } from '../../src/store/home.js';
import { loadRegistry } from '../../src/config/registry.js';
import { snapshot, trustedConfig, trustedRegistry, trustedStrict } from '../../src/trust/snapshot.js';
import { anchored, checkInit, expectedInit, finishLaunch, looseKeys, prepareLaunch, readableEnv, removeLaunch, renderStrict, strictTemplate, strictTemplates } from '../../src/launch/strict.js';
import { writeToken } from '../../src/sign/token.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';

// Unit 13b: the strict bundle.

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const temps = [];
// Every launch a test makes is removed afterwards, even when an assertion fails half-way: a
// launch's scratch folder lives in /private/tmp, outside the temp folders removed below.
const launches = [];
const launch = (opts) => {
  const plan = prepareLaunch(opts);
  launches.push(plan);
  return plan;
};
after(() => {
  for (const p of launches) removeLaunch(p.launchDir, p.scratchDir);
  for (const d of temps) {
    makeWritable(d);
    rmSync(d, { recursive: true, force: true });
  }
});
function makeWritable(d) {
  try {
    chmodSync(d, 0o755);
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) makeWritable(join(d, e.name)); else chmodSync(join(d, e.name), 0o644);
  } catch { /* gone */ }
}
const tempDir = (name) => {
  const d = mkdtempSync(join(tmpdir(), `mirai-${name}-`));
  temps.push(d);
  return d;
};
const TOKEN = `sk-ant-oat01-${'Qw7_-z'.repeat(16)}`;
const REPO = new URL('../../registry', import.meta.url).pathname;
const FIXTURE_AGENTS = new URL('../fixtures/registry-agents', import.meta.url).pathname;

// A repo with MIRAI installed and committed on main, with a real .env, a dummy env file named by
// [compose] env_file, and a nested .env.
function installed() {
  const root = tempDir('strict');
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), '# App\n');
  writeFileSync(join(root, '.gitignore'), '.env\nsub/.env\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'first');
  const env = { PATH: process.env.PATH, HOME: tempDir('home') };
  init({ cwd: root, env, branch: 'main' });
  const cfg = join(root, '.mirai', 'config.toml');
  chmodSync(cfg, 0o644);
  writeFileSync(cfg, `${readFileSync(cfg, 'utf8')}\n[compose]\nenv_file = ".env.test"\n`);
  writeFileSync(join(root, '.env.test'), 'APP_KEY=dummy\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'Install MIRAI');
  writeFileSync(join(root, '.env'), 'APP_KEY=real\n');
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', '.env'), 'X=real\n');
  return { root, env };
}

// A registry with the real profile and protected paths plus the fixture agent.
function registryWithAgent() {
  const real = loadRegistry(REPO);
  const fixture = loadRegistry(FIXTURE_AGENTS);
  return { ...real, agents: fixture.agents };
}

// The production layout: the launch folder inside this repo's MIRAI folder.
const FACTS = {
  checkout: '/Users/dev/Projects/app', home: '/Users/dev', miraiHome: '/Users/dev/Library/Application Support/mirai',
  repoHome: '/Users/dev/Library/Application Support/mirai/app-0123456789ab', trustDir: '/Users/dev/Library/Application Support/mirai/app-0123456789ab/trust/abc',
  launchDir: '/Users/dev/Library/Application Support/mirai/app-0123456789ab/launches/L1', scratchDir: '/private/tmp/mirai-0a1b2c3d', envFiles: ['.env', 'sub/.env', '.env.test'], tracked: ['.env.test'],
  hooksPaths: [], userDirs: ['/private/var/folders/xy/abc/T', '/private/var/folders/xy/abc/C'], uid: 501,
  hookCommand: '"/usr/local/bin/node" "/x/hook.js" "/x/policy.json" abc',
};
const within = (p, dir) => p === dir || p.startsWith(`${dir}/`);
const template = (config = { compose: { env_file: '.env.test' } }, mode = 'read-write') => strictTemplate({ registry: loadRegistry(REPO), config, mode });

test('T1: the trust root holds one machine-free template per access mode and per agent', () => {
  const r = installed();
  const trust = snapshot({ cwd: r.root, env: r.env });
  assert.equal(trust.manifest.format, 2);
  for (const name of ['read-write', 'read-only']) {
    assert.ok(trust.manifest.files.some((f) => f.path === `strict/${name}.json`), name);
    const t = trustedStrict(trust, name);
    assert.equal(t.mode, name);
    assert.ok(!JSON.stringify(t).includes(r.env.HOME) && !JSON.stringify(t).includes(r.root), 'a machine path in a template');
  }
  assert.throws(() => trustedStrict(trust, 'nobody'), /no strict template/);
  // An agent's template follows its definition.
  const templates = strictTemplates({ registry: registryWithAgent(), config: trustedConfig(trust) });
  const agent = templates.get('mirai-fixture-reviewer');
  assert.equal(agent.mode, 'read-only');
  assert.deepEqual(agent.tools, ['Glob', 'Grep', 'Read']);
  assert.equal(agent.agent, 'mirai-fixture-reviewer');
  // A format-1 snapshot is built again.
  const manifestPath = join(trust.dir, 'manifest.json');
  const old = JSON.parse(readFileSync(manifestPath, 'utf8'));
  chmodSync(trust.dir, 0o755);
  chmodSync(manifestPath, 0o644);
  const text = `${JSON.stringify({ ...old, format: 1 }, null, 2)}\n`;
  writeFileSync(manifestPath, text);
  const store = openStore({ cwd: r.root, env: r.env });
  const recordPath = join(store.dir, 'trust.json');
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  record.snapshots[trust.baseSha].manifest_sha256 = execFileSync('shasum', ['-a', '256'], { input: text }).toString().split(' ')[0];
  writeFileSync(recordPath, JSON.stringify(record));
  const again = snapshot({ cwd: r.root, env: r.env });
  assert.equal(again.reused, false);
  assert.equal(again.manifest.format, 2);
});

test('T2: reads: home denied; the checkout, input, scratch, trust root and committed dummy env readable; secrets denied again; all absolute', () => {
  const s = renderStrict(template(), FACTS);
  const fs = s.sandbox.filesystem;
  const co = FACTS.checkout;
  for (const p of [FACTS.home, `${FACTS.home}/Library/Keychains`, `${FACTS.home}/.config/mirai`, `${FACTS.repoHome}/store`, `${co}/.env`, `${co}/sub/.env`, `${co}/**/.env*`,
    '/private/tmp/claude-501', ...FACTS.userDirs, '/Users/Shared', '/Volumes', '/usr/local/var', '/opt/homebrew/var']) assert.ok(fs.denyRead.includes(p), p);
  for (const p of [co, FACTS.trustDir, `${FACTS.launchDir}/input`, FACTS.scratchDir, `${co}/.env.test`]) assert.ok(fs.allowRead.includes(p), p);
  assert.ok(!fs.denyRead.includes(`${co}/.env.test`));
  for (const p of Object.values(fs).filter(Array.isArray).flat()) assert.ok(p.startsWith('/'), `${p} is not absolute`);
  // The file tools aren't sandboxed: their denies are globs, so nested repos and later files count.
  for (const d of [`Read(/${co}/**/.env*)`, `Read(/${co}/.env*)`, `Read(/${co}/.env)`, 'Read(//private/tmp/claude-501/**)']) assert.ok(s.permissions.deny.includes(d), d);
});

test('T2b: a readable env file must be a committed .env* file that isn\'t personal; anything else stays denied', () => {
  const co = FACTS.checkout;
  const t = template({ compose: { env_file: '.env' }, sandbox: { readable_env: ['backend/.env.example', 'backend/.env.local', 'config', '.ENV.TEST'] } });
  const { readable, refused } = readableEnv(t, ['backend/.env.example', '.env.test', 'config']);
  assert.deepEqual(readable.sort(), ['.ENV.TEST', 'backend/.env.example']);
  assert.deepEqual(Object.fromEntries(refused.map((r) => [r.path, r.why])), {
    '.env': 'a personal file (.env or *.local)', 'backend/.env.local': 'a personal file (.env or *.local)', config: 'not a .env* file',
  });
  const s = renderStrict(t, { ...FACTS, envFiles: ['.env', 'backend/.env.example', 'backend/.env.local'], tracked: ['backend/.env.example', '.env.test'] });
  assert.ok(s.sandbox.filesystem.denyRead.includes(`${co}/.env`));
  assert.ok(!s.sandbox.filesystem.allowRead.includes(`${co}/.env`));
  assert.ok(s.sandbox.filesystem.allowRead.includes(`${co}/backend/.env.example`));
  assert.ok(s.sandbox.filesystem.denyRead.includes(`${co}/backend/.env.local`));
  // Named in the config but ignored by git (not committed): stays denied.
  const ignored = renderStrict(template({ compose: { env_file: 'backend/.env.testing' } }), { ...FACTS, envFiles: ['backend/.env.testing'], tracked: [] });
  assert.ok(ignored.sandbox.filesystem.denyRead.includes(`${co}/backend/.env.testing`));
});

test('T3: writes: no allowWrite inside a denyWrite; read-only agents never write the checkout; nobody writes .git at any depth, .mirai, auto-run or hook paths, the store, trust or Claude\'s shared temp', () => {
  const registry = loadRegistry(REPO);
  const rw = renderStrict(strictTemplate({ registry, config: { gate: { packs: ['node'] } }, mode: 'read-write' }), { ...FACTS, hooksPaths: ['/Users/dev/Projects/app/.githooks'] });
  const ro = renderStrict(strictTemplate({ registry, config: {}, mode: 'read-only' }), FACTS);
  const co = FACTS.checkout;
  for (const s of [rw, ro]) {
    for (const w of s.sandbox.filesystem.allowWrite) for (const d of s.sandbox.filesystem.denyWrite) assert.ok(!within(w, d), `${w} is inside ${d} (research/10 G20: the deny wins)`);
  }
  assert.ok(ro.sandbox.filesystem.denyWrite.includes(co));
  assert.ok(!rw.sandbox.filesystem.denyWrite.includes(co));
  assert.ok(!rw.sandbox.filesystem.denyWrite.includes(FACTS.miraiHome), 'the whole MIRAI home would hold the scratch folder');
  for (const p of [`${co}/.git`, `${co}/**/.git`, `${co}/.mirai`, `${co}/.envrc`, `${co}/**/.envrc`, `${co}/**/.vscode/**`, `${co}/.vscode`, `${co}/.npmrc`, `${co}/.githooks`, `${co}/.githooks/**`,
    `${FACTS.repoHome}/store`, `${FACTS.repoHome}/trust`, `${FACTS.miraiHome}/launcher.json`, `${FACTS.home}/.config/mirai`, '/private/tmp/claude-501']) {
    assert.ok(rw.sandbox.filesystem.denyWrite.includes(p), p);
  }
  assert.ok(!ro.sandbox.filesystem.denyWrite.includes(`${co}/.npmrc`), 'a pack the project didn\'t choose');
  assert.deepEqual(rw.sandbox.filesystem.allowWrite, [FACTS.scratchDir]);
  for (const p of [`Edit(/${co}/.git)`, `Edit(/${co}/.git/**)`, `Edit(/${co}/**/.git)`, `Edit(/${co}/**/.git/**)`, `Edit(/${co}/.mirai)`, `Edit(/${co}/.mirai/**)`, `Edit(/${co}/.envrc)`,
    `Edit(/${co}/.githooks/**)`, `Edit(/${co}/**/.env*)`, `Edit(/${FACTS.trustDir}/**)`]) assert.ok(rw.permissions.deny.includes(p), p);
  // A layout with the scratch folder under a write-denied folder is refused, not rendered.
  assert.throws(() => renderStrict(template(), { ...FACTS, scratchDir: `${FACTS.repoHome}/store/L1` }), /inside a write-denied folder/);
  assert.throws(() => renderStrict(template(), { ...FACTS, scratchDir: '/private/tmp/claude-501/x' }), /inside a write-denied folder/);
});

test('T3b: MIRAI patterns become the sandbox\'s absolute patterns: any depth, rooted, trailing slash, braces; an exclusion is refused', () => {
  const co = '/c';
  assert.deepEqual(anchored(co, '.envrc'), ['/c/.envrc', '/c/**/.envrc']);
  assert.deepEqual(anchored(co, '.vscode/'), ['/c/.vscode', '/c/.vscode/**', '/c/**/.vscode', '/c/**/.vscode/**']);
  assert.deepEqual(anchored(co, '.husky/**'), ['/c/.husky/**', '/c/.husky']);
  assert.deepEqual(anchored(co, '**/.claude/**'), ['/c/**/.claude/**', '/c/**/.claude', '/c/.claude/**', '/c/.claude']);
  assert.deepEqual(anchored(co, '/CODEOWNERS'), ['/c/CODEOWNERS']);
  assert.deepEqual(anchored(co, '{.a,.b}rc'), ['/c/.arc', '/c/**/.arc', '/c/.brc', '/c/**/.brc']);
  assert.throws(() => anchored(co, '!keep'), /can't exclude/);
});

test('T4: no weakening key is ever loose; the deny floors hold; a bad template, path or checkout is refused', () => {
  const t = template();
  const s = renderStrict(t, FACTS);
  assert.deepEqual(looseKeys(s), []);
  assert.equal(s.sandbox.filesystem.allowGitConfig, false);
  assert.equal(s.sandbox.filesystem.disabled, false);
  assert.deepEqual(s.sandbox.credentials.envVars.map((v) => v.name), ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']);
  for (const d of ['WebFetch', 'WebSearch', 'Task', 'Agent', 'Bash(git push *)', 'Bash(claude)', 'Bash(env)']) assert.ok(s.permissions.deny.includes(d), d);
  // Data that drops a floor entry can't loosen it.
  const registry = loadRegistry(REPO);
  const thin = { ...registry, adapters: { 'claude-code': { ...registry.adapters['claude-code'], strict: { ...registry.adapters['claude-code'].strict, deny_tools: ['WebFetch'], deny_env: ['X_TOKEN'] } } } };
  const floor = strictTemplate({ registry: thin, config: {}, mode: 'read-write' });
  for (const d of ['WebSearch', 'Task', 'Agent']) assert.ok(floor.deny_tools.includes(d), d);
  for (const v of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'X_TOKEN']) assert.ok(floor.deny_env.includes(v), v);
  // looseKeys notices each loosening.
  const loose = structuredClone(s);
  loose.sandbox.allowAppleEvents = true;
  loose.sandbox.network.allowMachLookup = ['com.apple.x'];
  loose.sandbox.network.allowedDomains = ['example.com'];
  loose.sandbox.filesystem.allowGitConfig = true;
  loose.sandbox.ripgrep = { command: '/tmp/rg' };
  loose.sandbox.network.httpProxyPort = 8080;
  assert.deepEqual(looseKeys(loose).sort(), ['sandbox.allowAppleEvents', 'sandbox.filesystem.allowGitConfig', 'sandbox.network.allowMachLookup', 'sandbox.network.allowedDomains', 'sandbox.network.httpProxyPort', 'sandbox.ripgrep']);
  assert.throws(() => renderStrict({ ...t, sandbox: { enabled: false } }, FACTS), /fields MIRAI doesn't know/);
  assert.throws(() => renderStrict({ ...t, mode: 'admin' }, FACTS), /mode/);
  assert.throws(() => renderStrict(t, { ...FACTS, checkout: '/Users/dev/Projects/a*b' }), /can't be used in a sandbox rule/);
  assert.throws(() => renderStrict(t, { ...FACTS, checkout: 'relative/app' }), /can't be used/);
  // A checkout that is, or holds, something the bundle protects.
  assert.throws(() => renderStrict(t, { ...FACTS, checkout: `${FACTS.miraiHome}/x` }), /inside the MIRAI home/);
  assert.throws(() => renderStrict(t, { ...FACTS, checkout: FACTS.home }), /contains your home folder/);
  assert.throws(() => renderStrict(t, { ...FACTS, checkout: '/Users' }), /contains your home folder/);
  assert.throws(() => renderStrict(t, { ...FACTS, checkout: '/' }), /contains/);
  assert.throws(() => renderStrict(t, { ...FACTS, checkout: '/private/tmp/app' }), /inside the shared temp folder/);
});

test('T5, T6: the launch: production layout, a private folder, read-only input, the environment exactly, PATH filtered, the token only on fd 3 and never enumerable', () => {
  const r = installed();
  const trust = snapshot({ cwd: r.root, env: r.env });
  const t = trustedStrict(trust, 'read-write');
  const env = { ...r.env, LANG: 'en_US.UTF-8', ANTHROPIC_API_KEY: 'sk-ant-api03-parent', CLAUDE_CODE_OAUTH_TOKEN: 'from-parent', SSH_AUTH_SOCK: '/tmp/agent',
    PATH: `node_modules/.bin:.::${r.root}/bin:${process.env.PATH}` };
  assert.throws(() => prepareLaunch({ trust, template: t, checkout: r.root, env }), /no Claude login token/);
  writeToken(env, TOKEN);
  const plan = launch({ trust, template: t, checkout: r.root, env });
  const mode = (p) => statSync(p).mode & 0o777;
  assert.deepEqual(Object.keys(plan.env).sort(), ['CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'CLAUDE_CODE_TMPDIR', 'CLAUDE_CONFIG_DIR', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'HOME', 'LANG', 'PATH', 'TMPDIR']);
  for (const d of plan.env.PATH.split(':')) assert.ok(d.startsWith('/') && !d.startsWith(plan.cwd), `PATH keeps ${d}`);
  assert.equal(plan.fds[3], TOKEN);
  assert.ok(!JSON.stringify(plan).includes(TOKEN), 'the token is in the plan\'s JSON');
  assert.ok(!plan.args.join(' ').includes(TOKEN));
  // Short enough for Claude Code to put Bash's TMPDIR inside it (else it falls back to the shared
  // /tmp/claude-<uid>), private, and fresh per launch.
  assert.equal(plan.env.TMPDIR, plan.scratchDir);
  assert.equal(plan.env.CLAUDE_CODE_TMPDIR, plan.scratchDir);
  assert.match(plan.scratchDir, /^\/private\/tmp\/mirai-[0-9a-f]{8}$/);
  assert.ok(Buffer.byteLength(plan.scratchDir) <= 30);
  assert.equal(mode(plan.scratchDir), 0o700);
  assert.ok(plan.env.CLAUDE_CONFIG_DIR.startsWith(plan.launchDir));
  assert.deepEqual(readdirSync(plan.env.CLAUDE_CONFIG_DIR), []);
  assert.equal(mode(plan.launchDir), 0o700);
  assert.equal(mode(join(plan.launchDir, 'input')), 0o500);
  assert.equal(mode(join(plan.launchDir, 'input', 'settings.json')), 0o400);
  const text = readFileSync(join(plan.launchDir, 'input', 'settings.json'), 'utf8');
  const settings = JSON.parse(text);
  const fs = settings.sandbox.filesystem;
  // The real layout: the scratch folder is writable, nothing that holds it is write-denied.
  for (const d of fs.denyWrite) assert.ok(!within(plan.scratchDir, d), `scratch is inside ${d}`);
  assert.ok(fs.denyRead.includes(join(plan.cwd, '.env')));
  assert.ok(fs.denyRead.includes(join(plan.cwd, 'sub', '.env')));
  assert.ok(fs.allowRead.includes(join(plan.cwd, '.env.test')), 'the committed dummy file');
  assert.ok(!text.includes(TOKEN));
  assert.deepEqual(plan.args.slice(0, 3), ['--restricted', '--tools', 'Bash,Edit,Glob,Grep,Read,Write']);
  assert.ok(plan.args.includes('--strict-mcp-config'));
  assert.equal(plan.args[plan.args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(plan.templateSha256, trust.manifest.files.find((f) => f.path === 'strict/read-write.json').sha256);
  assert.match(plan.canonicalSha256, /^[0-9a-f]{64}$/);
  assert.equal(plan.expectedInit.cwd, plan.cwd);
  // The hook (unit 13c): the write tools are allowed only by the hook, which runs from the trust
  // root with the launch's read-only policy, checked by its hash.
  assert.deepEqual(settings.permissions.allow, ['Bash', 'Glob', 'Grep', 'Read']);
  const hook = settings.hooks.PreToolUse[0];
  assert.equal(hook.matcher, 'Read|Glob|Grep|Edit|Write|MultiEdit|NotebookEdit');
  const policyFile = join(plan.launchDir, 'input', 'hook-policy.json');
  assert.equal(mode(policyFile), 0o400);
  const policyText = readFileSync(policyFile, 'utf8');
  const trustReal = realpathSync(trust.dir);
  assert.equal(hook.hooks[0].command, `/usr/bin/env -i "HOME=${realpathSync(r.env.HOME)}" "PATH=/usr/bin:/bin" "${realpathSync(process.execPath)}" "${join(trustReal, 'tree', '.mirai', 'framework', 'bin', 'hook.js')}" "${policyFile}" ${execFileSync('shasum', ['-a', '256'], { input: policyText }).toString().split(' ')[0]}`);
  const policy = JSON.parse(policyText);
  assert.deepEqual(policy.trust, { dir: trustReal, manifestSha256: trust.manifestSha256 });
  assert.ok(policy.protectedInodes.some(([, , p]) => p === join(plan.cwd, '.env')));
  assert.ok(!policyText.includes(TOKEN));
  assert.ok(policy.secrets.length >= 5);
  // Two launches never share a folder; a launch that fails leaves nothing behind.
  const second = launch({ trust, template: t, checkout: r.root, env });
  assert.notEqual(second.launchDir, plan.launchDir);
  assert.notEqual(second.scratchDir, plan.scratchDir);
  removeLaunch(second.launchDir, second.scratchDir);
  const launchesDir = dirname(plan.launchDir);
  const before = readdirSync(launchesDir).length;
  const scratches = () => readdirSync('/private/tmp').filter((n) => /^mirai-[0-9a-f]{8}$/.test(n)).length;
  const scratchBefore = scratches();
  assert.throws(() => prepareLaunch({ trust, template: { ...t, mode: 'admin' }, checkout: r.root, env }), /mode/);
  assert.equal(readdirSync(launchesDir).length, before);
  assert.equal(scratches(), scratchBefore, 'a failed launch left its scratch folder');
  removeLaunch(plan.launchDir, plan.scratchDir);
  assert.ok(!existsSync(plan.launchDir) && !existsSync(plan.scratchDir));
  // A hard link to a real .env file (unit 13c): the launch is refused, and leaves nothing.
  linkSync(join(r.root, '.env'), join(r.root, 'notes.txt'));
  const now = readdirSync(launchesDir).length;
  assert.throws(() => prepareLaunch({ trust, template: t, checkout: r.root, env }), /second name on disk.*\.env/);
  assert.equal(readdirSync(launchesDir).length, now);
  rmSync(join(r.root, 'notes.txt'));
  // A .env that is a symbolic link: its target is readable under its own name, so refused too.
  mkdirSync(join(r.root, 'config'), { recursive: true });
  writeFileSync(join(r.root, 'config', 'app.secrets'), 'X=real\n');
  symlinkSync('config/app.secrets', join(r.root, '.env.prod'));
  assert.throws(() => prepareLaunch({ trust, template: t, checkout: r.root, env }), /is a symbolic link.*\.env\.prod/);
  rmSync(join(r.root, '.env.prod'));
  // A trust root without its verified manifest hash is refused.
  assert.throws(() => prepareLaunch({ trust: { ...trust, manifestSha256: undefined }, template: t, checkout: r.root, env }), /verified trust root/);
  const again = launch({ trust, template: t, checkout: r.root, env });
  removeLaunch(again.launchDir, again.scratchDir);
});

test('T7: checkInit passes what was asked for and names every difference; the version is required', () => {
  const t = template();
  const expected = expectedInit({ ...t, tools: ['Bash', 'Read'], agent: 'mirai-dev' }, { cwd: '/Users/dev/app', model: 'claude-x' });
  const builtin = t.builtin.plugins.map((name) => ({ name, path: 'builtin', source: `${name}@builtin` }));
  const good = {
    type: 'system', subtype: 'init', tools: ['Read', 'Bash'], apiKeySource: 'none', memory_paths: null, permissionMode: 'dontAsk', mcp_servers: [], plugins: builtin,
    skills: [...t.builtin.skills], agents: [...t.builtin.agents, 'mirai-dev'], cwd: '/Users/dev/app', model: 'claude-x', claude_code_version: '2.1.310',
  };
  assert.deepEqual(checkInit(good, expected, { version: '2.1.310' }), []);
  assert.throws(() => checkInit(good, expected), /needs the Claude Code version/);
  const cases = [
    [{ tools: ['Read', 'Bash', 'WebFetch'] }, /tools are/],
    [{ apiKeySource: 'ANTHROPIC_API_KEY' }, /apiKeySource/],
    [{ memory_paths: { auto: '/x' } }, /memory/],
    [{ permissionMode: 'bypassPermissions' }, /permission mode/],
    [{ mcp_servers: [{ name: 'playwright', status: 'connected' }] }, /MCP servers MIRAI didn't pass: playwright/],
    [{ mcp_servers: [{ status: 'connected' }] }, /\(no name\)/],
    [{ plugins: [...builtin, { name: 'evil', path: '/x' }] }, /plugins that aren't Claude Code's own: evil/],
    [{ plugins: [{ name: 'impostor', path: 'builtin' }] }, /impostor/],
    [{ skills: [...t.builtin.skills, 'probe-skill'] }, /skills that aren't Claude Code's own: probe-skill/],
    [{ agents: [...t.builtin.agents, 'mirai-dev', 'project-agent'] }, /agents MIRAI didn't pass: project-agent/],
    [{ agents: ['Explore'] }, /isn't loaded/],
    [{ cwd: '/elsewhere' }, /the folder is/],
    [{ model: 'claude-y' }, /the model is/],
    [{ claude_code_version: '2.1.311' }, /Claude Code is 2\.1\.311/],
  ];
  for (const [change, re] of cases) assert.match(checkInit({ ...good, ...change }, expected, { version: '2.1.310' }).join('; '), re);
  assert.deepEqual(checkInit(null, expected, { version: '2.1.310' }), ['no init event']);
});

test('T8: mirai sandbox show prints the resolved settings and flags, starts nothing, shows no token, names refused env files', async () => {
  const r = installed();
  const cfg = join(r.root, '.mirai', 'config.toml');
  chmodSync(cfg, 0o644);
  writeFileSync(cfg, `${readFileSync(cfg, 'utf8')}\n[sandbox]\nreadable_env = [".env"]\n`);
  git(r.root, 'commit', '-qam', 'readable_env');
  writeToken(r.env, TOKEN);
  let out = '';
  let err = '';
  const stdin = Readable.from([]);
  const io = { stdin, stdout: { isTTY: false, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: r.env, cwd: r.root };
  assert.equal(await main(['sandbox', 'show'], io), EXIT.OK, err);
  assert.match(out, /mode read-write/);
  assert.match(out, /--restricted --tools Bash,Edit,Glob,Grep,Read,Write/);
  assert.match(out, /"denyRead"/);
  assert.match(out, /\.env: a personal file/);
  assert.match(out, /canonical bundle hash/);
  assert.ok(out.includes(join(r.env.HOME, 'Library', 'Keychains')));
  assert.ok(!out.includes(TOKEN));
  const store = openStore({ cwd: r.root, env: r.env });
  assert.ok(!existsSync(join(store.repoHome, 'launches')), 'a launch folder was made');
  out = '';
  assert.equal(await main(['sandbox', 'show', '--mode', 'read-only'], io), EXIT.OK, err);
  assert.match(out, /mode read-only/);
  assert.equal(await main(['sandbox', 'show', '--mode', 'admin'], io), EXIT.USAGE);
  assert.notEqual(await main(['sandbox', 'show', 'mirai-nobody'], io), EXIT.OK);
});

test('14b T11: a launch guards .git: a hook planted during it is caught by finishLaunch, which cleans up either way', () => {
  const r = installed();
  const trust = snapshot({ cwd: r.root, env: r.env });
  const t = trustedStrict(trust, 'read-write');
  writeToken(r.env, TOKEN);
  const clean = prepareLaunch({ trust, template: t, checkout: r.root, env: r.env });
  assert.ok(clean.guard && !Object.keys(clean).includes('guard'));
  finishLaunch(clean);
  assert.ok(!existsSync(clean.launchDir) && !existsSync(clean.scratchDir));
  const plan = prepareLaunch({ trust, template: t, checkout: r.root, env: r.env });
  writeFileSync(join(r.root, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\n', { mode: 0o755 });
  assert.throws(() => finishLaunch(plan), (err) => err.code === 'repo-changed' && /\(hooks\)/.test(err.message));
  assert.ok(!existsSync(plan.launchDir) && !existsSync(plan.scratchDir));
});
