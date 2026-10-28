import { chmodSync, existsSync, lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { dirname, isAbsolute, join, posix } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { configValue, envFiles, lsTree } from '../store/git.js';
import { miraiHome } from '../store/home.js';
import { ensurePrivateDir } from '../store/files.js';
import { repoGuard } from '../store/repo-state.js';
import { protectionRules } from '../trust/protected.js';
import { readToken } from '../sign/token.js';
import { expand } from '../util/glob.js';
import { HOOKED_TOOLS, hookPolicy, policyText, WRITE_TOOLS } from './hook.js';

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

export const STRICT_SCHEMA = 'mirai-strict/3';
// A test call waits at most 30 minutes for its turn (one deadline for the repo's turn and a
// machine slot), runs at most 240, and cleans up: 6 hours leaves room.
export const MCP_TOOL_TIMEOUT_MS = 6 * 3600 * 1000;
// MIRAI's MCP server (unit 14d) and its tools, as Claude Code names them.
export const MCP_SERVER = 'mirai';
export const MCP_TOOLS = Object.freeze({ run_tests: 'mcp__mirai__run_tests', run_check: 'mcp__mirai__run_check' });
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
    // The secret shapes the hook refuses in what an agent writes (unit 13c).
    secrets: Object.values(registry.secrets ?? {}).flatMap((d) => d.patterns.map((p) => ({ name: p.name, regex: p.regex }))),
    // MIRAI's MCP server (unit 14d): the levels and checks it offers, or null for none. In the
    // template, so the trust root's manifest and the canonical hash cover the wiring. Every
    // template gets them (open point 5); an agent's definition decides whether it uses them.
    tests: testTools(config),
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
  if (typeof path !== 'string' || !isAbsolute(path) || /[*?[\]{}\\\n\r"`$]/.test(path)) throw new StrictError(`${what} (${JSON.stringify(path)}) can't be used in a sandbox rule`, { code: 'bad-path', hint: 'move it to a path without *, ?, [, ], {, } or \\' });
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
// (the readable_env candidates committed at the base), hooksPaths (core.hooksPath as set and as resolved),
// userDirs (your temp and cache folders), uid, hookCommand (unit 13c) }.
// With the hook, the write tools aren't allowed by the rules: the hook allows each call it
// checks, so a hook that fails to run refuses (13c's probe). Reads need no permission inside the
// project, so for them the hook only adds refusals.
export function renderStrict(template, facts) {
  if (template?.schema !== STRICT_SCHEMA) throw new StrictError('the strict template isn\'t one this MIRAI reads', { code: 'bad-template' });
  const known = ['schema', 'name', 'agent', 'mode', 'tools', 'deny_tools', 'deny_commands', 'deny_env', 'write_denied', 'readable_env', 'builtin', 'secrets', 'tests'];
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
  const hooks = (facts.hooksPaths ?? []).map((p) => plain(p, 'core.hooksPath'));
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

  if (typeof facts.hookCommand !== 'string' || facts.hookCommand === '') throw new StrictError('the settings need the hook command', { code: 'no-hook' });
  return {
    permissions: { allow: [...template.tools.filter((t) => !WRITE_TOOLS.includes(t)), ...mcpTools(template)], deny: [...new Set(deny)] },
    hooks: { PreToolUse: [{ matcher: HOOKED_TOOLS.join('|'), hooks: [{ type: 'command', command: facts.hookCommand, timeout: 30 }] }] },
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
    // MIRAI's MCP server (unit 14d): a test call may wait 30 minutes for its turn, run up to 240
    // and then clean up (a 12-minute call completed with the default in 14d's probes; the limit is
    // set, not relied on). The server must start within 30 s.
    MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS),
    MCP_TIMEOUT: '30000',
  });
  return out;
}

// The launch flags, without the prompt (unit 19 adds `-p <prompt>`).
export function launchArgs({ template, settingsFile, agentsJson, mcpConfig = null }) {
  return [
    '--restricted', '--tools', template.tools.join(','),
    '--settings', settingsFile,
    '--strict-mcp-config', ...(mcpConfig ? ['--mcp-config', mcpConfig] : []),
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
  envFiles: ['.env'], tracked: [], hooksPaths: [], userDirs: ['/private/var/folders/0/T', '/private/var/folders/0/C'], uid: 501,
  hookCommand: '"/usr/local/bin/node" "/Users/agent/Library/Application Support/mirai/project-000000000000/trust/0/tree/.mirai/framework/bin/hook.js" "/Users/agent/Library/Application Support/mirai/project-000000000000/launches/0/input/hook-policy.json" 0',
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

// The files whose content agents must never reach, under any name: every real .env* file and
// MIRAI's personal files (the token, the signing key). One list for the launch's checks and the
// hook's inode check.
export function protectedFiles(template, facts) {
  const { readable } = readableEnv(template, facts.tracked ?? []);
  const readableSet = new Set(readable.map((p) => p.toLowerCase()));
  const configDir = join(facts.home, '.config', 'mirai');
  return [
    ...facts.envFiles.filter((p) => !readableSet.has(posix.normalize(p).toLowerCase())).map((p) => join(facts.checkout, p)),
    join(configDir, 'claude-token'), join(configDir, 'signing.ed25519'),
  ];
}

// Protected files that have another name: { hardLinked, symlinked }. A hard link is a second name
// for the same data, and a protected name that is a symbolic link leaves its target readable under
// the target's own name. The sandbox and the permission rules both match paths (unit 13c's probes),
// so a launch refuses while either exists; agents can't make a hard link (the sandbox refuses
// `ln`).
export function secondNames(paths) {
  const out = { hardLinked: [], symlinked: [] };
  for (const p of paths) {
    let info;
    try {
      info = lstatSync(p);
    } catch {
      continue;
    }
    if (info.isSymbolicLink()) out.symlinked.push(p);
    else if (info.isFile() && info.nlink > 1) out.hardLinked.push(p);
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
  // core.hooksPath, as configured and as it really is (a symlinked hooks folder counts by both).
  const hooksPaths = [];
  const hp = configValue(co, 'core.hooksPath', env);
  if (hp) {
    const abs = isAbsolute(hp) ? hp : join(co, hp);
    hooksPaths.push(abs);
    try {
      hooksPaths.push(realpathSync(abs));
    } catch {
      // not there yet
    }
  }
  const facts = {
    checkout: co, home, homes, miraiHome: existsSync(mhome) ? realpathSync(mhome) : mhome, repoHome: realpathSync(dirname(dirname(trust.dir))), trustDir: realpathSync(trust.dir),
    launchDir, scratchDir, envFiles: envFiles(co, env), tracked, hooksPaths: [...new Set(hooksPaths)], userDirs: userDirs(), uid: process.getuid(),
  };
  const { hardLinked, symlinked } = secondNames(protectedFiles(template, facts));
  if (hardLinked.length) {
    throw new StrictError(`a protected file has a second name on disk (a hard link): ${hardLinked.join(', ')}`, {
      code: 'hard-link', hint: 'find the other name (ls -i, then find . -inum <number>) and remove it; agents could read the secret through it',
    });
  }
  if (symlinked.length) {
    throw new StrictError(`a protected file is a symbolic link, so its target is readable under its own name: ${symlinked.join(', ')}`, {
      code: 'symlinked-secret', hint: 'make it a real file, or move the target inside a denied place',
    });
  }
  return facts;
}

// The hook's policy for one launch, from the same facts as the settings.
export function launchPolicy(template, facts, trust) {
  const co = facts.checkout;
  const { readable } = readableEnv(template, facts.tracked ?? []);
  const configDir = join(facts.home, '.config', 'mirai');
  return hookPolicy({
    checkout: co,
    readRoots: [co, facts.trustDir, join(facts.launchDir, 'input'), facts.scratchDir],
    writeRoots: template.mode === 'read-only' ? [facts.scratchDir] : [co, facts.scratchDir],
    writeDenied: [...template.write_denied],
    hooksPaths: facts.hooksPaths ?? [],
    readableEnv: readable.map((p) => join(co, p)),
    protectedFiles: protectedFiles(template, facts),
    trust: { dir: facts.trustDir, manifestSha256: trust.manifestSha256 },
    tokenFile: join(configDir, 'claude-token'),
    secrets: template.secrets,
  });
}

// Everything unit 19 needs to start one agent run, without starting it: the launch folder
// (<repo-home>/launches/<id>/: input/ read-only once written, a fresh empty Claude config
// folder), its short scratch folder (/private/tmp/mirai-<8 hex>), the settings, the flags, the
// environment and the token for fd 3.
// `trust`: an open, verified trust root; `template`: its strict template (read with
// trustedStrict); `agentsJson`: the agent's definition for --agents (unit 19). A launch that
// fails half-way leaves nothing behind. The token is on `plan.fds[3]`, which isn't enumerable,
// so logging the plan can't print it.
// MIRAI's MCP server (unit 14d) is wired when the template has test levels or checks
// (`template.tests`). `probe` is for the probes only ({ home, dockerSocket }): their fixture's
// MIRAI home sits under a temporary HOME; it requires `miraiHomeDir`, which only they pass.
export function prepareLaunch({ trust, template, checkout, env, agentsJson = null, id = null, miraiHomeDir = null, probe = null }) {
  if (probe && !miraiHomeDir) throw new StrictError('probe settings are for the probes only', { code: 'bad-probe' });
  if (typeof trust?.manifestSha256 !== 'string') throw new StrictError('the launch needs a verified trust root (its manifest hash)', { code: 'no-trust' });
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
  let guard = null;
  try {
    for (const sub of ['input', 'claude-config']) ensurePrivateDir(join(launchDir, sub));
    scratchDir = makeScratch();
    const facts = launchFacts({ trust, checkout, env, launchDir: realpathSync(launchDir), scratchDir, miraiHomeDir, template });
    // D-54's integrity hash, from here until finishLaunch: every git call on the checkout checks
    // it first (unit 14b).
    guard = repoGuard(facts.checkout);
    // The hook's policy first, read-only in input/; the settings carry its hash (unit 13c).
    const hookScript = join(facts.trustDir, 'tree', '.mirai', 'framework', 'bin', 'hook.js');
    if (!existsSync(hookScript)) throw new StrictError('the trust root has no hook (a framework copy from before unit 13c)', { code: 'no-hook', hint: 'run: mirai init --refresh, and commit it' });
    const policy = launchPolicy(template, facts, trust);
    const policyFile = join(facts.launchDir, 'input', 'hook-policy.json');
    const policyBody = policyText(policy);
    writeReadOnly(policyFile, policyBody);
    const node = plain(realpathSync(process.execPath), 'node');
    if ([facts.checkout, facts.launchDir, facts.scratchDir, facts.miraiHome].some((d) => within(node, d))) throw new StrictError(`node (${node}) is inside a folder agents can write`, { code: 'bad-node' });
    // The hook runs with an empty environment: nothing from yours (NODE_OPTIONS, …) or Claude Code's.
    facts.hookCommand = `/usr/bin/env -i "HOME=${facts.home}" "PATH=/usr/bin:/bin" "${node}" "${hookScript}" "${policyFile}" ${sha256(policyBody)}`;
    const settings = renderStrict(template, facts);
    // MIRAI's MCP server (unit 14d): its policy and mcp.json, read-only in input/, and the allow
    // rules for its tools (under dontAsk an MCP tool without one is denied, 14d's M2).
    const tests = template.tests;
    let mcpConfig = null;
    if (tests) {
      const mcpScript = join(facts.trustDir, 'tree', '.mirai', 'framework', 'bin', 'mcp.js');
      if (!existsSync(mcpScript)) throw new StrictError('the trust root has no MCP server (a framework copy from before unit 14d)', { code: 'no-mcp', hint: 'run: mirai init --refresh, and commit it' });
      const mcpPolicy = {
        schema: 'mirai-mcp-policy/1', checkout: facts.checkout, trust_dir: facts.trustDir, manifest_sha256: trust.manifestSha256, home: probe?.home ?? facts.home,
        repo_state: guard.hash, launch_id: launchId, levels: [...tests.levels], checks: [...tests.checks],
        ...(probe?.dockerSocket ? { docker_socket: probe.dockerSocket } : {}),
      };
      const mcpPolicyFile = join(facts.launchDir, 'input', 'mcp-policy.json');
      const mcpPolicyBody = `${JSON.stringify(mcpPolicy, null, 2)}\n`;
      writeReadOnly(mcpPolicyFile, mcpPolicyBody);
      mcpConfig = join(facts.launchDir, 'input', 'mcp.json');
      // Like the hook, with an empty environment: Claude Code adds its own to `env` (14d's M3), and
      // node reads NODE_OPTIONS and the like before any of MIRAI's code runs.
      const server = { type: 'stdio', command: '/usr/bin/env', args: ['-i', `HOME=${facts.home}`, 'PATH=/usr/bin:/bin', node, mcpScript, mcpPolicyFile, sha256(mcpPolicyBody)], env: {} };
      writeReadOnly(mcpConfig, `${JSON.stringify({ mcpServers: { [MCP_SERVER]: server } }, null, 2)}\n`);
    }
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
      args: launchArgs({ template, settingsFile, agentsJson, mcpConfig }),
      env: launchEnv({ env, launchDir: facts.launchDir, scratchDir, configHome: join(facts.launchDir, 'claude-config'), gitconfig, checkout: facts.checkout, miraiHome: facts.miraiHome }),
      settingsSha256: sha256(settingsText),
      templateSha256: listed?.sha256 ?? sha256(templateText(template)),
      canonicalSha256: canonicalSha256(template),
      expectedInit: expectedInit(template, { cwd: facts.checkout }),
    };
    Object.defineProperty(plan, 'fds', { value: Object.freeze({ 3: token }), enumerable: false });
    Object.defineProperty(plan, 'guard', { value: guard, enumerable: false });
    return plan;
  } catch (err) {
    guard?.release();
    removeLaunch(launchDir, scratchDir);
    throw err;
  }
}

// After the agent's process group is gone: checks that `.git` is as it was before the launch
// (D-54; throws `repo-changed`, naming what changed), then ends the guard and removes the launch
// folders either way.
export function finishLaunch(plan) {
  try {
    plan.guard?.check();
  } finally {
    plan.guard?.release();
    removeLaunch(plan.launchDir, plan.scratchDir);
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
  const mcp = mcpTools(template);
  return {
    tools: [...template.tools, ...mcp].sort(), apiKeySource: 'none', memoryPaths: null, permissionMode: 'dontAsk', mcpServers: mcp.length ? [MCP_SERVER] : [],
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
  // MIRAI's own server must be up: a server that failed to start fails the launch, not the tool.
  for (const name of expected.mcpServers) {
    const m = (init.mcp_servers ?? []).find((x) => nameOf(x) === name);
    if (!m || (typeof m === 'object' && m.status !== 'connected')) problems.push(`MIRAI's MCP server ${name} isn't connected (${typeof m === 'object' ? m?.status ?? 'missing' : 'missing'})`);
  }
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

// The test levels and named checks MIRAI's MCP server offers for a trust-root config (unit 14d):
// only with [compose] files and env_file, and only the ones with a service. Null when none.
export function testTools(config) {
  if (!config.compose?.files?.length || !config.compose?.env_file) return null;
  const levels = (config.testing?.levels ?? []).filter((l) => l.service).map((l) => l.name);
  const checks = Object.entries(config.checks ?? {}).filter(([, c]) => !Array.isArray(c) && c?.service).map(([n]) => n);
  return levels.length || checks.length ? { levels, checks } : null;
}

// The MCP tools a template's launch gets, as Claude Code names them.
export function mcpTools(template) {
  const t = template.tests;
  return t ? [...(t.levels.length ? [MCP_TOOLS.run_tests] : []), ...(t.checks.length ? [MCP_TOOLS.run_check] : [])] : [];
}
