import { chmodSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { dirname, isAbsolute, join, posix } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { configValue, envFiles, lsTree } from '../store/git.js';
import { miraiHome } from '../store/home.js';
import { ensurePrivateDir } from '../store/files.js';
import { protectionRules } from '../trust/protected.js';
import { readToken } from '../sign/token.js';
import { expand } from '../util/glob.js';

// The strict bundle (unit 13b; D7, D-30, D-47; research/10). What every agent run gets: one
// settings file, one set of launch flags, one environment, built from the trust root, so neither
// a branch nor your own user settings can loosen them. Each rule is one 13a or 13b's probes
// showed holds on Claude Code 2.1.310 / macOS 26.7.
//
// Two steps:
// - strictTemplate: what doesn't depend on this machine or launch (tools, deny lists, the
//   write-denied patterns, what Claude Code brings in by itself), rendered into the trust root
//   as strict/<name>.json and hashed by its manifest;
// - renderStrict: the template plus this launch's facts -> the settings file. Absolute paths
//   only (13a: relative paths in --settings don't resolve against the project).
// The sandbox's safe values and the minimum deny lists are code here, never data, so no
// template or config can loosen them.
//
// Two facts shape the layout:
// - a denyWrite wins over an allowWrite inside it (research/10, G20). So nothing that holds the
//   launch's scratch folder is write-denied; the MIRAI home isn't writable to sandboxed commands
//   anyway (only the checkout, the temp folders and allowWrite are), and its parts that matter
//   are denied one by one;
// - Claude Code gives Bash a TMPDIR under CLAUDE_CODE_TMPDIR only when that path is short
//   (about 30 bytes, a Unix-socket limit); otherwise it falls back to /tmp/claude-<uid>, the
//   folder your own sessions share and the bundle write-denies (13b's bundle probes). So each
//   launch's scratch is a short private folder, /private/tmp/mirai-<8 hex>, not one inside the
//   launch folder.

export const STRICT_SCHEMA = 'mirai-strict/2';
export const MODES = Object.freeze(['read-write', 'read-only']);
const ADAPTER = 'claude-code';
// The floors: data can add to these, never take away.
const MIN_DENY_TOOLS = Object.freeze(['WebFetch', 'WebSearch', 'Task', 'Agent']);
const MIN_DENY_ENV = Object.freeze(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']);
// Protected-path rules whose files run by themselves, so agents may not write them: the
// `auto-run` class, and git hooks (they run on your next commit when the project points
// core.hooksPath at them).
const WRITE_DENIED_RULES = Object.freeze(['git-hooks']);
// Folders outside your home that sandboxed commands could read but have no business with
// (13b review): other apps' shared files, mounted disks, Homebrew's databases.
const OUTSIDE_HOME_DENIED = Object.freeze(['/Users/Shared', '/Volumes', '/usr/local/var', '/opt/homebrew/var']);

class StrictError extends MiraiError {
  constructor(message, { code, hint, exitCode = EXIT.BLOCKED } = {}) {
    super(message, exitCode);
    this.name = 'StrictError';
    this.code = code;
    this.hint = hint;
  }
}

const merge = (floor, data) => [...new Set([...floor, ...(data ?? [])])];

// The template for one agent (by its registry definition) or one access mode. `registry` and
// `config` are the trust root's.
export function strictTemplate({ registry, config, agent, mode }) {
  const profile = registry.adapters[ADAPTER]?.strict;
  if (!profile) throw new StrictError('this MIRAI copy has no strict bundle rules', { code: 'no-strict', hint: 'run: mirai init --refresh, and commit it' });
  let tools;
  let readOnly;
  if (agent) {
    const def = registry.agents[agent];
    if (!def) throw new StrictError(`there is no agent named ${agent}`, { code: 'no-agent' });
    tools = [...def.tools.allowed];
    readOnly = def.read_only === true;
  } else {
    if (!MODES.includes(mode)) throw new StrictError(`the mode is read-write or read-only, not ${mode}`, { code: 'bad-mode', exitCode: EXIT.USAGE });
    readOnly = mode === 'read-only';
    tools = [...(readOnly ? profile.read_only_tools : profile.read_write_tools)];
  }
  const rules = protectionRules(registry, config).rules;
  const writeDenied = rules.filter((r) => r.class === 'auto-run' || WRITE_DENIED_RULES.includes(r.name)).flatMap((r) => r.paths);
  const readable = [...(config.compose?.env_file ? [config.compose.env_file] : []), ...(config.sandbox?.readable_env ?? [])];
  return {
    schema: STRICT_SCHEMA,
    name: agent ?? mode,
    agent: agent ?? null,
    mode: readOnly ? 'read-only' : 'read-write',
    tools: [...new Set(tools)].sort(),
    deny_tools: merge(MIN_DENY_TOOLS, profile.deny_tools),
    deny_commands: [...profile.deny_commands],
    deny_env: merge(MIN_DENY_ENV, profile.deny_env),
    write_denied: [...new Set(writeDenied)].sort(),
    readable_env: [...new Set(readable)].sort(),
    builtin: { version: profile.builtin_version, plugins: [...profile.builtin_plugins], skills: [...profile.builtin_skills], agents: [...profile.builtin_agents] },
  };
}

export const templateText = (t) => `${JSON.stringify(t, null, 2)}\n`;

// The templates a trust root holds: one per agent and one per access mode.
export function strictTemplates({ registry, config }) {
  const out = new Map();
  for (const mode of MODES) out.set(mode, strictTemplate({ registry, config, mode }));
  for (const agent of Object.keys(registry.agents).sort()) out.set(agent, strictTemplate({ registry, config, agent }));
  return out;
}

// A path MIRAI writes into a rule must be absolute and plain: no glob characters, no newline,
// no backslash (a checkout path with a "*" would turn into a pattern).
function plain(path, what) {
  if (typeof path !== 'string' || !isAbsolute(path) || /[*?[\]{}\\\n\r]/.test(path)) throw new StrictError(`${what} (${JSON.stringify(path)}) can't be used in a sandbox rule`, { code: 'bad-path', hint: 'move it to a path without *, ?, [, ], {, } or \\' });
  return path.replace(/\/+$/, '') || '/';
}

const within = (p, dir) => p === dir || p.startsWith(dir === '/' ? '/' : `${dir}/`);

// A MIRAI path pattern (src/util/glob.js: no "/" except a trailing one = any depth; a trailing
// "/" or "/**" = the folder and inside it; {a,b} = either word) as the absolute patterns the
// sandbox and the permission rules take, under the checkout.
export function anchored(checkout, pattern) {
  if (pattern.startsWith('!')) throw new StrictError(`a write-denied pattern can't exclude (${pattern})`, { code: 'bad-pattern' });
  const out = [];
  for (const one of expand(pattern)) {
    const folder = one.endsWith('/');
    let p = one.replace(/\/+$/, '');
    const rooted = p.startsWith('/') || p.includes('/');
    p = p.replace(/^\/+/, '');
    const bases = rooted ? [`${checkout}/${p}`] : [`${checkout}/${p}`, `${checkout}/**/${p}`];
    if (rooted && p.startsWith('**/')) bases.push(`${checkout}/${p.slice(3)}`);
    for (const b of bases) {
      out.push(b);
      if (folder) out.push(`${b}/**`);
      if (b.endsWith('/**')) out.push(b.slice(0, -3));
    }
  }
  return [...new Set(out)];
}

// A permission rule's absolute path is written with a leading "//".
const rule = (tool, path) => `${tool}(/${path})`;

// Names that are a person's own secrets whatever a config says (13b review): `.env` itself and
// anything `.local`.
const PERSONAL_ENV = /^\.env$|\.local$/i;

// Which `.env*` files named readable by the config may really be read: only a committed one
// (`tracked`, checkout-relative paths at the base commit) whose name starts with `.env` and
// isn't a personal one. A git-ignored file named there is a real secret, so it stays denied.
// Returns { readable, refused: [{ path, why }] }; matching ignores case, as macOS disks do.
export function readableEnv(template, tracked) {
  const has = new Set([...tracked].map((p) => posix.normalize(p).toLowerCase()));
  const readable = [];
  const refused = [];
  for (const raw of template.readable_env) {
    const p = posix.normalize(raw);
    const name = posix.basename(p);
    if (!/^\.env/i.test(name)) refused.push({ path: p, why: 'not a .env* file' });
    else if (PERSONAL_ENV.test(name)) refused.push({ path: p, why: 'a personal file (.env or *.local)' });
    else if (!has.has(p.toLowerCase())) refused.push({ path: p, why: 'not committed on the integration branch' });
    else readable.push(p);
  }
  return { readable, refused };
}

// The settings file for one launch. `facts`: { checkout, home, homes (other spellings of your
// home folder), miraiHome, repoHome, trustDir, launchDir, scratchDir, envFiles (checkout-relative), tracked
// (the readable_env candidates committed at the base), hooksPath (core.hooksPath, or null),
// userDirs (your temp and cache folders), uid }.
export function renderStrict(template, facts) {
  if (template?.schema !== STRICT_SCHEMA) throw new StrictError('the strict template isn\'t one this MIRAI reads', { code: 'bad-template' });
  const known = ['schema', 'name', 'agent', 'mode', 'tools', 'deny_tools', 'deny_commands', 'deny_env', 'write_denied', 'readable_env', 'builtin'];
  const extra = Object.keys(template).filter((k) => !known.includes(k));
  if (extra.length) throw new StrictError(`the strict template has fields MIRAI doesn't know (${extra.join(', ')})`, { code: 'bad-template' });
  if (!MODES.includes(template.mode)) throw new StrictError('the strict template\'s mode is neither read-write nor read-only', { code: 'bad-template' });
  const co = plain(facts.checkout, 'the checkout');
  const home = plain(facts.home, 'your home folder');
  const homes = [...new Set([home, ...(facts.homes ?? []).map((h) => plain(h, 'your home folder'))])];
  const mhome = plain(facts.miraiHome, 'the MIRAI home');
  const repoHome = plain(facts.repoHome, 'this repo\'s MIRAI folder');
  const trustDir = plain(facts.trustDir, 'the trust root');
  const launch = plain(facts.launchDir, 'the launch folder');
  const scratch = plain(facts.scratchDir, 'the launch\'s scratch folder');
  const configDir = join(home, '.config', 'mirai');
  const keychains = join(home, 'Library', 'Keychains');
  const claudeTmp = `/private/tmp/claude-${facts.uid}`;
  // The checkout is readable and (for writers) writable: it must not hold, or sit in, anything
  // the bundle protects (a dotfiles repo at your home folder would re-open all of it).
  for (const [what, p] of [['your home folder', home], ['the MIRAI home', mhome], ['~/.config/mirai', configDir], ['the keychain folder', keychains], ['the shared temp folder', '/private/tmp']]) {
    if (within(co, p) && what !== 'your home folder') throw new StrictError(`the checkout is inside ${what}`, { code: 'bad-checkout' });
    if (within(p, co)) throw new StrictError(`the checkout (${co}) contains ${what}`, { code: 'bad-checkout', hint: 'agents run only in a project folder inside your home folder' });
  }
  const { readable } = readableEnv(template, facts.tracked ?? []);
  const readableAbs = readable.map((p) => plain(join(co, p), 'a readable env file'));
  const readableSet = new Set(readable.map((p) => p.toLowerCase()));
  const realEnv = facts.envFiles.filter((p) => !readableSet.has(posix.normalize(p).toLowerCase())).map((p) => plain(join(co, p), 'an env file'));
  const writeDenied = template.write_denied.flatMap((p) => anchored(co, p));
  const hooks = facts.hooksPath ? [plain(isAbsolute(facts.hooksPath) ? facts.hooksPath : join(co, facts.hooksPath), 'core.hooksPath')] : [];
  const readOnly = template.mode === 'read-only';
  const gitDirs = [join(co, '.git'), `${co}/**/.git`];

  const denyRead = [...homes, keychains, configDir, join(repoHome, 'store'), claudeTmp, ...(facts.userDirs ?? []).map((d) => plain(d, 'a temp folder')), ...OUTSIDE_HOME_DENIED, ...realEnv, `${co}/**/.env*`];
  // The launch's scratch is readable as well as writable: it's the run's temp folder, and tools
  // read back what they write there (13b's bundle probes: node and cat failed without it).
  const allowRead = [co, trustDir, join(launch, 'input'), scratch, ...readableAbs];
  const denyWrite = [...(readOnly ? [co] : []), ...gitDirs, join(co, '.mirai'), ...writeDenied, ...hooks, join(repoHome, 'store'), join(repoHome, 'trust'), join(mhome, 'launcher.json'), configDir, claudeTmp];
  const allowWrite = [scratch];
  for (const w of allowWrite) {
    const over = denyWrite.find((d) => !d.includes('*') && within(w, d));
    if (over) throw new StrictError(`the launch's scratch folder is inside a write-denied folder (${over})`, { code: 'bad-layout' });
  }

  // The file tools aren't sandboxed: their own deny rules match by pattern, so the .env* and .git
  // rules are globs, not only today's files.
  const envGlobs = [`${co}/**/.env*`, `${co}/.env*`];
  const deny = [
    ...template.deny_tools,
    ...template.deny_commands.flatMap((c) => [`Bash(${c})`, `Bash(${c} *)`]),
    ...[...envGlobs, ...realEnv, `${configDir}/**`, `${join(repoHome, 'store')}/**`, `${keychains}/**`, claudeTmp, `${claudeTmp}/**`].map((p) => rule('Read', p)),
    ...[...envGlobs, ...realEnv, ...gitDirs, ...gitDirs.map((g) => `${g}/**`), join(co, '.mirai'), `${co}/.mirai/**`, ...writeDenied, ...hooks, ...hooks.map((h) => `${h}/**`),
      `${trustDir}/**`, `${repoHome}/store/**`, `${configDir}/**`, join(mhome, 'launcher.json')].map((p) => rule('Edit', p)),
  ];

  return {
    permissions: { allow: [...template.tools], deny: [...new Set(deny)] },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      excludedCommands: [],
      allowAppleEvents: false,
      allowNestedUserNamespaces: false,
      enableWeakerNestedSandbox: false,
      enableWeakerNetworkIsolation: false,
      network: { allowedDomains: [], deniedDomains: [], strictAllowlist: true, allowUnixSockets: [], allowAllUnixSockets: false, allowLocalBinding: false, allowMachLookup: [] },
      filesystem: { disabled: false, allowGitConfig: false, denyRead: [...new Set(denyRead)], allowRead: [...new Set(allowRead)], denyWrite: [...new Set(denyWrite)], allowWrite },
      credentials: { envVars: template.deny_env.map((name) => ({ name, mode: 'deny' })) },
    },
  };
}

// Every sandbox key 2.1.310 has that could loosen it (research/10), checked on a rendered file.
// prepareLaunch refuses a file with any of them loose.
export function looseKeys(settings) {
  const s = settings.sandbox ?? {};
  const n = s.network ?? {};
  const f = s.filesystem ?? {};
  const loose = [];
  if (s.enabled !== true) loose.push('sandbox.enabled');
  if (s.allowUnsandboxedCommands !== false) loose.push('sandbox.allowUnsandboxedCommands');
  if ((s.excludedCommands ?? []).length) loose.push('sandbox.excludedCommands');
  for (const k of ['allowAppleEvents', 'allowNestedUserNamespaces', 'enableWeakerNestedSandbox', 'enableWeakerNetworkIsolation']) if (s[k] !== false) loose.push(`sandbox.${k}`);
  for (const k of ['ignoreViolations', 'ripgrep']) if (s[k] !== undefined) loose.push(`sandbox.${k}`);
  if (f.disabled !== false) loose.push('sandbox.filesystem.disabled');
  if (f.allowGitConfig !== false) loose.push('sandbox.filesystem.allowGitConfig');
  if ((n.allowedDomains ?? []).length || n.strictAllowlist !== true) loose.push('sandbox.network.allowedDomains');
  if ((n.allowUnixSockets ?? []).length || n.allowAllUnixSockets !== false) loose.push('sandbox.network.allowUnixSockets');
  if (n.allowLocalBinding !== false) loose.push('sandbox.network.allowLocalBinding');
  if ((n.allowMachLookup ?? []).length) loose.push('sandbox.network.allowMachLookup');
  for (const k of ['httpProxyPort', 'socksProxyPort', 'tlsTerminate']) if (n[k] !== undefined) loose.push(`sandbox.network.${k}`);
  return loose;
}

// PATH for an agent run: absolute folders only, none inside the checkout, the launch or the
// MIRAI home. Claude Code itself runs outside the sandbox in the checkout, so a relative entry
// (`node_modules/.bin`) would let it run a program an agent planted (13b review).
export function safePath(path, { checkout, launchDir, miraiHome: mhome }) {
  const keep = (path ?? '').split(':').filter((d) => isAbsolute(d) && ![checkout, launchDir, mhome].some((x) => within(posix.normalize(d), x)));
  return [...new Set(keep)].join(':') || '/usr/bin:/bin:/usr/sbin:/sbin';
}

// The environment an agent run gets: an allowlist, nothing else from yours.
export function launchEnv({ env, launchDir, scratchDir, configHome, gitconfig, checkout, miraiHome: mhome }) {
  const out = {};
  for (const name of ['LANG', 'TERM', 'USER', 'HOME']) if (env[name] !== undefined) out[name] = env[name];
  out.PATH = safePath(env.PATH, { checkout, launchDir, miraiHome: mhome });
  const tmp = scratchDir;
  Object.assign(out, {
    TMPDIR: tmp,
    CLAUDE_CODE_TMPDIR: tmp,
    CLAUDE_CONFIG_DIR: configHome,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: gitconfig,
    // The token is written on file descriptor 3 (research/10, G5/G9), never into the environment.
    CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '3',
  });
  return out;
}

// The launch flags, without the prompt (unit 19 adds `-p <prompt>`).
export function launchArgs({ template, settingsFile, agentsJson }) {
  return [
    '--restricted', '--tools', template.tools.join(','),
    '--settings', settingsFile,
    '--strict-mcp-config',
    ...(agentsJson ? ['--agents', agentsJson, '--agent', template.agent] : []),
    '--permission-mode', 'dontAsk', '--output-format', 'stream-json', '--verbose',
  ];
}

// MIRAI's global git config for agents: under the home deny, git can't read ~/.gitconfig or
// ~/.config/git/*, so it points those lookups at nothing.
export const GITCONFIG = '[user]\n\tname = MIRAI agent\n\temail = agent@mirai.invalid\n[core]\n\texcludesFile = /dev/null\n\tattributesFile = /dev/null\n';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// Fixed placeholder facts: the canonical render is the template through this renderer, so its
// hash changes exactly when the template or the renderer changes. The red-team result is keyed
// by it (unit 18), not by the template alone.
const CANONICAL = Object.freeze({
  checkout: '/Users/agent/project', home: '/Users/agent', miraiHome: '/Users/agent/Library/Application Support/mirai', repoHome: '/Users/agent/Library/Application Support/mirai/project-000000000000',
  trustDir: '/Users/agent/Library/Application Support/mirai/project-000000000000/trust/0', launchDir: '/Users/agent/Library/Application Support/mirai/project-000000000000/launches/0', scratchDir: '/private/tmp/mirai-00000000',
  envFiles: ['.env'], tracked: [], hooksPath: null, userDirs: ['/private/var/folders/0/T', '/private/var/folders/0/C'], uid: 501,
});
export const canonicalSha256 = (template) => sha256(JSON.stringify(renderStrict(template, CANONICAL)));

function writeReadOnly(path, text) {
  writeFileSync(path, text, { flag: 'wx', mode: 0o400 });
  chmodSync(path, 0o400);
}

// Your temp and cache folders (macOS gives each user their own under /private/var/folders).
function userDirs() {
  const out = [];
  for (const key of ['DARWIN_USER_TEMP_DIR', 'DARWIN_USER_CACHE_DIR']) {
    try {
      const dir = execFileSync('/usr/bin/getconf', [key], { encoding: 'utf8', timeout: 5000 }).trim();
      if (dir && isAbsolute(dir)) out.push(realpathSync(dir));
    } catch {
      // not macOS, or no such folder: nothing to deny
    }
  }
  return out;
}

// The facts renderStrict needs for this checkout and launch, read from this machine.
export function launchFacts({ trust, checkout, env, launchDir, scratchDir, miraiHomeDir, template }) {
  if (!env.HOME || !isAbsolute(env.HOME)) throw new StrictError('HOME is not set to an absolute path', { code: 'no-home' });
  const co = realpathSync(checkout);
  const home = realpathSync(env.HOME);
  const homes = [env.HOME, userInfo().homedir].filter((h) => h && isAbsolute(h));
  const tracked = template.readable_env.filter((p) => (lsTree(co, trust.baseSha, p, env) ?? []).some((e) => e.type === 'blob'));
  const mhome = miraiHomeDir ?? miraiHome(env);
  return {
    checkout: co, home, homes, miraiHome: existsSync(mhome) ? realpathSync(mhome) : mhome, repoHome: realpathSync(dirname(dirname(trust.dir))), trustDir: realpathSync(trust.dir),
    launchDir, scratchDir, envFiles: envFiles(co, env), tracked, hooksPath: configValue(co, 'core.hooksPath', env), userDirs: userDirs(), uid: process.getuid(),
  };
}

// Everything unit 19 needs to start one agent run, without starting it: the launch folder
// (<repo-home>/launches/<id>/: input/ read-only once written, a fresh empty Claude config
// folder), its short scratch folder (/private/tmp/mirai-<8 hex>), the settings, the flags, the
// environment and the token for fd 3.
// `trust`: an open, verified trust root; `template`: its strict template (read with
// trustedStrict); `agentsJson`: the agent's definition for --agents (unit 19). A launch that
// fails half-way leaves nothing behind. The token is on `plan.fds[3]`, which isn't enumerable,
// so logging the plan can't print it.
export function prepareLaunch({ trust, template, checkout, env, agentsJson = null, id = null, miraiHomeDir = null }) {
  const token = readToken(env);
  if (!token) throw new StrictError('there is no Claude login token for agent runs', { code: 'no-token', exitCode: EXIT.NEEDS_HUMAN, hint: 'in your terminal: claude setup-token, then mirai token set' });
  const repoHome = dirname(dirname(trust.dir));
  const launches = join(repoHome, 'launches');
  ensurePrivateDir(launches);
  const launchId = id ?? `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`;
  if (!/^[0-9]{14}-[0-9a-f]{8}$/.test(launchId)) throw new StrictError('bad launch id', { code: 'bad-id' });
  const launchDir = join(launches, launchId);
  ensurePrivateDir(launchDir);
  let scratchDir = null;
  try {
    for (const sub of ['input', 'claude-config']) ensurePrivateDir(join(launchDir, sub));
    scratchDir = makeScratch();
    const facts = launchFacts({ trust, checkout, env, launchDir: realpathSync(launchDir), scratchDir, miraiHomeDir, template });
    const settings = renderStrict(template, facts);
    const loose = looseKeys(settings);
    if (loose.length) throw new StrictError(`the rendered settings are loose (${loose.join(', ')})`, { code: 'loose' });
    const settingsText = `${JSON.stringify(settings, null, 2)}\n`;
    const settingsFile = join(facts.launchDir, 'input', 'settings.json');
    const gitconfig = join(facts.launchDir, 'input', 'gitconfig');
    writeReadOnly(settingsFile, settingsText);
    writeReadOnly(gitconfig, GITCONFIG);
    chmodSync(join(launchDir, 'input'), 0o500);
    const listed = trust.manifest?.files?.find((f) => f.path === `strict/${template.name}.json`);
    const plan = {
      launchId,
      launchDir: facts.launchDir,
      scratchDir,
      cwd: facts.checkout,
      args: launchArgs({ template, settingsFile, agentsJson }),
      env: launchEnv({ env, launchDir: facts.launchDir, scratchDir, configHome: join(facts.launchDir, 'claude-config'), gitconfig, checkout: facts.checkout, miraiHome: facts.miraiHome }),
      settingsSha256: sha256(settingsText),
      templateSha256: listed?.sha256 ?? sha256(templateText(template)),
      canonicalSha256: canonicalSha256(template),
      expectedInit: expectedInit(template, { cwd: facts.checkout }),
    };
    Object.defineProperty(plan, 'fds', { value: Object.freeze({ 3: token }), enumerable: false });
    return plan;
  } catch (err) {
    removeLaunch(launchDir, scratchDir);
    throw err;
  }
}

// A new private scratch folder for one launch, short enough for Claude Code to put Bash's TMPDIR
// in it: made fresh (never an existing one, which someone else could have planted in the shared
// /private/tmp), yours, 0700.
function makeScratch() {
  for (let i = 0; i < 5; i++) {
    const dir = `/private/tmp/mirai-${randomBytes(4).toString('hex')}`;
    try {
      mkdirSync(dir, { mode: 0o700 });
    } catch (err) {
      if (err.code === 'EEXIST') continue;
      throw err;
    }
    ensurePrivateDir(dir);
    return dir;
  }
  throw new StrictError('couldn\'t make a scratch folder in /private/tmp', { code: 'no-scratch' });
}

// Removes a launch folder (input/ is read-only, so modes are opened first) and its scratch folder.
export function removeLaunch(launchDir, scratchDir = null) {
  try {
    chmodSync(join(launchDir, 'input'), 0o700);
  } catch {
    // no input folder yet
  }
  rmSync(launchDir, { recursive: true, force: true });
  if (scratchDir && /^\/private\/tmp\/mirai-[0-9a-f]{8}$/.test(scratchDir)) rmSync(scratchDir, { recursive: true, force: true });
}

// What the run's init event must say, for checkInit.
export function expectedInit(template, { cwd = null, model = null } = {}) {
  return {
    tools: [...template.tools].sort(), apiKeySource: 'none', memoryPaths: null, permissionMode: 'dontAsk', mcpServers: [],
    builtin: template.builtin, agent: template.agent, cwd, model,
  };
}

// Compares a run's init event with what the launch asked for (research/10): the tools exactly,
// no API key, no memory, the permission mode, no MCP server MIRAI didn't pass, nothing beyond
// Claude Code's own built-in plugins, skills and agents (anything else means --restricted
// stopped keeping things out), the agent, the folder, the model, and the Claude Code version,
// which is required. Returns the differences; any one stops the run (unit 19). The agents list
// is checked for what's in it; starting one is denied anyway (Task/Agent).
export function checkInit(init, expected, { version } = {}) {
  if (!version) throw new StrictError('checkInit needs the Claude Code version the red-team result is for', { code: 'no-version' });
  if (!init || init.type !== 'system' || init.subtype !== 'init') return ['no init event'];
  const problems = [];
  const tools = [...(init.tools ?? [])].sort();
  if (JSON.stringify(tools) !== JSON.stringify(expected.tools)) problems.push(`tools are ${tools.join(', ') || 'none'}, expected ${expected.tools.join(', ')}`);
  if (init.apiKeySource !== expected.apiKeySource) problems.push(`apiKeySource is ${init.apiKeySource ?? 'missing'}, expected ${expected.apiKeySource}`);
  if ((init.memory_paths ?? null) !== null) problems.push('a memory is on');
  if (init.permissionMode !== expected.permissionMode) problems.push(`permission mode is ${init.permissionMode ?? 'missing'}`);
  const nameOf = (x) => (typeof x === 'string' ? x : x?.name);
  const mcp = (init.mcp_servers ?? []).filter((m) => !expected.mcpServers.includes(nameOf(m)));
  if (mcp.length) problems.push(`MCP servers MIRAI didn't pass: ${mcp.map((m) => nameOf(m) ?? '(no name)').join(', ')}`);
  const b = expected.builtin;
  const plugins = (init.plugins ?? []).filter((p) => !(typeof p === 'object' && p?.path === 'builtin' && b.plugins.includes(p.name)));
  if (plugins.length) problems.push(`plugins that aren't Claude Code's own: ${plugins.map((p) => nameOf(p) ?? '(no name)').join(', ')}`);
  const skills = (init.skills ?? []).filter((s) => !b.skills.includes(nameOf(s)));
  if (skills.length) problems.push(`skills that aren't Claude Code's own: ${skills.map(nameOf).join(', ')}`);
  const agents = (init.agents ?? []).filter((a) => !b.agents.includes(nameOf(a)) && nameOf(a) !== expected.agent);
  if (agents.length) problems.push(`agents MIRAI didn't pass: ${agents.map(nameOf).join(', ')}`);
  if (expected.agent && !(init.agents ?? []).map(nameOf).includes(expected.agent)) problems.push(`the agent ${expected.agent} isn't loaded`);
  if (expected.cwd && init.cwd !== expected.cwd) problems.push(`the folder is ${init.cwd ?? 'missing'}, expected ${expected.cwd}`);
  if (expected.model && init.model !== expected.model) problems.push(`the model is ${init.model ?? 'missing'}, expected ${expected.model}`);
  if (init.claude_code_version !== version) problems.push(`Claude Code is ${init.claude_code_version ?? 'unknown'}, expected ${version}`);
  return problems;
}
