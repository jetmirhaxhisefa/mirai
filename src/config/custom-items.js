import { createHash } from 'node:crypto';

import { ConfigError } from '../cli/errors.js';
import { parseToml } from './toml.js';
import { validate } from './schema.js';
import { matches } from '../util/glob.js';
import { SKILL_LIMITS } from './registry.js';

// A project's own items (unit 39; decision 1, the migrate table, and its re-check against 37 as
// built): kept in .mirai/custom/ beside 37's overlays, each with its own schema and its own signed
// approval record (approvals/<kind>-<name>.json), and used only once approved as it is now.
//
//   project-skills/<name>/SKILL.md (+ its files)   a skill of the project's own, for your sessions
//   hooks/<name>.toml                               an interactive-only hook: your sessions only
//   scripts/<name>.<sh|bash|js|mjs|py>              a script a hook, a check or a skill calls
//   mcp/<name>.toml                                 an MCP server for your sessions
//
// None of them reaches a MIRAI run: the strict launch reads no project skill, settings file or
// .mcp.json (units 13 and 21a; the red team's c-project-rules and c-custom-hook). A project skill
// isn't a 37 overlay: an overlay changes a MIRAI skill (skills/<mirai-skill>/overlay.toml).

export const CUSTOM_KINDS = Object.freeze(['project-skill', 'hook', 'script', 'mcp']);
export const CUSTOM_FOLDERS = Object.freeze(['project-skills', 'hooks', 'scripts', 'mcp']);
// A script's language, from its extension: what runs it.
export const SCRIPT_RUNNERS = Object.freeze({ sh: 'sh', bash: 'bash', js: 'node', mjs: 'node', py: 'python3' });
export const HOOK_EVENTS = Object.freeze(['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SubagentStop', 'SessionStart', 'SessionEnd', 'PreCompact']);
// What a project skill's frontmatter may hold. `allowed-tools` only for tools that read: anything
// else would run without Claude Code asking you.
const SKILL_KEYS = Object.freeze(['name', 'description', 'license', 'version', 'argument-hint', 'disable-model-invocation', 'user-invocable', 'model', 'allowed-tools']);
const SKILL_READ_TOOLS = Object.freeze(['Read', 'Grep', 'Glob']);
const NAME = /^[a-z][a-z0-9-]{0,62}$/;
const NAME_HINT = 'lowercase letters, digits and "-", starting with a letter';
const SKILL_FILE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const PREFIX = '.mirai/custom';

// Paths a custom script must never name: MIRAI's files, git's, your key and MIRAI's store, your
// sessions' settings. A static check (decision 3), so a script that only reads one is refused too.
const SCRIPT_PROTECTED = Object.freeze([
  { re: /(^|[\s"'`=(/])\.mirai\//, what: '.mirai/' },
  { re: /(^|[\s"'`=(])(\.\/)?\.git\//, what: '.git/' },
  { re: /\.config\/mirai/, what: '~/.config/mirai' },
  { re: /Application Support\/mirai/, what: 'MIRAI\'s store' },
  { re: /\.claude\/settings/, what: '.claude/settings*.json' },
  { re: /core\.hooksPath/, what: 'core.hooksPath' },
]);

// A Claude Code skill's, agent's or command's frontmatter, read leniently (unit 39): MIRAI's own
// YAML subset refuses keys such as `allowed-tools` and `argument-hint`, which these files use.
// Top-level `key: value` lines only; a value is a quoted string, a `[a, b]` list, a `- item` list
// under its key, or plain text; anything indented under a key is kept as its text. Returns
// { value, body, bodyLine }, null when the text has no frontmatter, or throws on a key MIRAI
// can't read.
export function toolFrontmatter(input) {
  const text = (Buffer.isBuffer(input) ? input.toString('utf8') : String(input)).replace(/^﻿/, '');
  const lines = text.split('\n');
  if (lines[0].replace(/\r$/, '') !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.replace(/\r$/, '') === '---');
  if (end < 0) throw new Error('the frontmatter has no closing ---');
  const value = {};
  let last = null;
  for (const raw of lines.slice(1, end)) {
    const l = raw.replace(/\r$/, '');
    if (!l.trim() || l.trim().startsWith('#')) continue;
    if (/^\s/.test(l)) {
      if (last === null) throw new Error(`an indented line before any key: ${l.trim().slice(0, 60)}`);
      const item = /^\s*-\s+(.*)$/.exec(l);
      if (item && (Array.isArray(value[last]) || value[last] === '')) value[last] = [...(Array.isArray(value[last]) ? value[last] : []), unquote(item[1])];
      else value[last] = `${value[last] === '' ? '' : `${value[last]}\n`}${l.trim()}`;
      continue;
    }
    const m = /^([A-Za-z][A-Za-z0-9_-]{0,63}):(?:\s+(.*))?$/.exec(l);
    if (!m) throw new Error(`a line MIRAI can't read as "key: value": ${l.slice(0, 60)}`);
    last = m[1];
    const v = (m[2] ?? '').trim();
    value[last] = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map((x) => unquote(x.trim())).filter(Boolean) : unquote(v);
  }
  return { value, body: lines.slice(end + 1).join('\n'), bodyLine: end + 2 };
}
function unquote(v) {
  if (/^"(.*)"$/.test(v)) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  return /^'(.*)'$/.test(v) ? v.slice(1, -1).replace(/''/g, '\'') : v;
}

// The name rules every kind shares: a name of its own, never MIRAI's (mirai, mirai-*), nor a MIRAI
// skill's, agent's or a built-in skill's of Claude Code.
export function nameClash(name, registry) {
  if (name === 'mirai' || name.startsWith('mirai-')) return `the name "${name}" is MIRAI's: mirai and mirai-* are MIRAI's own names`;
  if (Object.hasOwn(registry.skills ?? {}, name) || Object.hasOwn(registry.agents ?? {}, name)) return `the name "${name}" is one of MIRAI's skills or agents`;
  const builtin = Object.values(registry.adapters ?? {}).flatMap((a) => a.strict?.builtin_skills ?? []);
  if (builtin.includes(name)) return `the name "${name}" is one of Claude Code's own skills`;
  return null;
}

// A custom role's write scope against MIRAI's protected paths (decision 3, re-checked against 37:
// an agent's write scope is its role's): each `may_write` pattern whose fixed start lies in a
// protected or auto-run rule of the core pack. `**` (write anywhere MIRAI doesn't protect) passes:
// the strict bundle denies the protected paths in every launch.
export function roleProtectedWrites(roleDef, registry) {
  const rules = (registry.protectedPaths?.core?.rules ?? []).flatMap((r) => r.paths.map((p) => ({ rule: r.name, pattern: p })));
  const out = [];
  for (const p of roleDef?.may_write?.paths ?? []) {
    const fixed = p.split(/[*?[{]/)[0];
    if (!fixed || fixed === '/') continue;
    const probe = fixed.endsWith('/') ? `${fixed}x` : fixed;
    const hit = rules.find((r) => matches(r.pattern, probe.replace(/^\//, '')));
    if (hit) out.push({ pattern: p, rule: hit.rule, protected: hit.pattern });
  }
  return out;
}

// The custom items in `files` (a .mirai/custom folder's Map<relative path, Buffer|null>): the same
// shape as readOverlays' entries ({ path, kind, name, main, bound, hash, problems, result, value,
// flags }). `used` collects every file an item takes.
export function readCustomItems(files, registry, used, { flagScript = null } = {}) {
  const out = [];
  const full = (rel) => `${PREFIX}/${rel}`;
  const base = (kind, name, rel) => ({ path: full(rel), kind, name, main: files.get(rel) ?? null, bound: [], hash: files.get(rel) ? sha256(files.get(rel)) : null, problems: [], result: null, value: null, flags: [] });
  const bind = (o, rel) => {
    used.add(rel);
    const b = files.get(rel);
    o.bound.push({ path: full(rel), content_hash: b ? sha256(b) : null });
    if (b === null) o.problems.push(`${full(rel)} isn't a regular file of at most 256 KiB`);
    return b;
  };
  const scripts = new Map();
  for (const rel of files.keys()) {
    const m = /^scripts\/([^/]+)\.([a-z]+)$/.exec(rel);
    if (m && Object.hasOwn(SCRIPT_RUNNERS, m[2])) scripts.set(m[1], [...(scripts.get(m[1]) ?? []), rel]);
  }
  for (const rel of files.keys()) {
    let m;
    if ((m = /^project-skills\/([^/]+)\/SKILL\.md$/.exec(rel))) {
      used.add(rel);
      const o = base('project-skill', m[1], rel);
      const prefix = `project-skills/${m[1]}/`;
      const others = [...files.keys()].filter((r) => r.startsWith(prefix) && r !== rel).sort();
      const texts = [];
      for (const r of others) {
        const b = bind(o, r);
        if (!SKILL_FILE.test(r.slice(prefix.length))) o.problems.push(`${full(r)}: a file name in a skill uses only letters, digits, ".", "_" and "-"`);
        if (b) texts.push({ rel: r.slice(prefix.length), bytes: b });
      }
      projectSkill(o, registry, texts, others.length);
      out.push(o);
    } else if ((m = /^scripts\/([^/]+)\.([a-z]+)$/.exec(rel)) && Object.hasOwn(SCRIPT_RUNNERS, m[2])) {
      used.add(rel);
      const o = base('script', m[1], rel);
      script(o, registry, m[2], scripts.get(m[1]), flagScript);
      out.push(o);
    } else if ((m = /^hooks\/([^/]+)\.toml$/.exec(rel))) {
      used.add(rel);
      const o = base('hook', m[1], rel);
      hook(o, registry, scripts, bind);
      out.push(o);
    } else if ((m = /^mcp\/([^/]+)\.toml$/.exec(rel))) {
      used.add(rel);
      const o = base('mcp', m[1], rel);
      mcp(o, registry);
      out.push(o);
    }
  }
  return out;
}

// What a file in a custom folder that no item takes is: its problem line.
export function strayCustomProblem(rel) {
  if (rel.startsWith('project-skills/')) return 'it has no SKILL.md beside it: a project skill is project-skills/<name>/SKILL.md, with its other files in that folder';
  if (rel.startsWith('scripts/')) return `it isn't a script MIRAI takes: scripts/<name>.<${Object.keys(SCRIPT_RUNNERS).join('|')}>, one folder deep`;
  if (rel.startsWith('hooks/')) return 'it isn\'t a hook file: hooks/<name>.toml, which names a script in scripts/';
  if (rel.startsWith('mcp/')) return 'it isn\'t an MCP server file: mcp/<name>.toml';
  return null;
}

function checkName(o, registry) {
  if (!NAME.test(o.name)) o.problems.push(`the name "${o.name}" isn't a name MIRAI takes (${NAME_HINT})`);
  const clash = nameClash(o.name, registry);
  if (clash) o.problems.push(clash);
}

function utf8(bytes) {
  const text = bytes.toString('utf8');
  return Buffer.from(text, 'utf8').equals(bytes) && !text.includes('\0') ? text : null;
}

function projectSkill(o, registry, texts, count) {
  checkName(o, registry);
  if (!o.main) return o.problems.push('it isn\'t a regular file of at most 256 KiB');
  const all = [{ rel: 'SKILL.md', bytes: o.main }, ...texts];
  if (count + 1 > SKILL_LIMITS.files || all.reduce((n, t) => n + t.bytes.length, 0) > SKILL_LIMITS.bytes) o.problems.push(`the skill is too large (at most ${SKILL_LIMITS.files} files and ${SKILL_LIMITS.bytes} bytes)`);
  let fm;
  try {
    fm = toolFrontmatter(o.main);
  } catch (err) {
    return o.problems.push(`its frontmatter doesn't read: ${err.message}`);
  }
  if (!fm) return o.problems.push('SKILL.md has no frontmatter (name and description)');
  const v = fm.value ?? {};
  o.value = v;
  for (const k of Object.keys(v)) {
    if (k === 'hooks') o.problems.push('hooks: a skill\'s own hooks aren\'t taken; keep a hook as .mirai/custom/hooks/<name>.toml (mirai custom add)');
    else if (!SKILL_KEYS.includes(k)) o.problems.push(`${k}: not a key MIRAI takes in a project skill (it takes: ${SKILL_KEYS.join(', ')})`);
  }
  if (v.name !== o.name) o.problems.push(`name "${String(v.name ?? '')}" isn't its folder's name "${o.name}"`);
  if (typeof v.description !== 'string' || !v.description.trim() || v.description.length > 1024) o.problems.push('description: one to 1024 characters, saying what the skill does and when to use it');
  if (v['allowed-tools'] !== undefined) {
    const list = Array.isArray(v['allowed-tools']) ? v['allowed-tools'] : String(v['allowed-tools']).split(/[\s,]+/).filter(Boolean);
    for (const t of list) if (!SKILL_READ_TOOLS.includes(String(t))) o.problems.push(`allowed-tools: ${String(t).slice(0, 80)} would run without Claude Code asking you; a project skill may pre-approve only ${SKILL_READ_TOOLS.join(', ')}`);
  }
  const lines = fm.body.replace(/\r?\n$/, '').split('\n').length + fm.bodyLine - 1;
  if (lines > SKILL_LIMITS.lines) o.problems.push(`SKILL.md has ${lines} lines; at most ${SKILL_LIMITS.lines}`);
  if (!o.problems.length) o.result = { files: all.map((t) => ({ rel: t.rel, bytes: t.bytes })) };
  return undefined;
}

function script(o, registry, ext, same, flagScript) {
  checkName(o, registry);
  if ((same ?? []).length > 1) o.problems.push(`two scripts are named "${o.name}" (${same.map((r) => `${PREFIX}/${r}`).join(', ')}): keep one`);
  if (!o.main) return o.problems.push('it isn\'t a regular file of at most 256 KiB');
  const text = utf8(o.main);
  if (text === null) return o.problems.push('it isn\'t UTF-8 text');
  for (const p of SCRIPT_PROTECTED) {
    const line = text.split('\n').findIndex((l) => p.re.test(l));
    if (line >= 0) o.problems.push(`line ${line + 1} names ${p.what}, a path MIRAI protects: a custom script never reads or writes there`);
  }
  if (flagScript) o.flags = flagScript(o.path, text);
  if (!o.problems.length) o.result = { runner: SCRIPT_RUNNERS[ext], file: o.path };
  return undefined;
}

const HOOK = {
  type: 'table',
  fields: {
    kind: { type: 'enum', values: ['hook'] },
    schema_version: { type: 'integer', min: 1, max: 1 },
    name: { type: 'string', pattern: NAME, patternHint: NAME_HINT },
    description: { type: 'string', pattern: /^[^\n]{1,300}$/, patternHint: 'one line' },
    event: { type: 'enum', values: HOOK_EVENTS },
    matcher: { type: 'string', pattern: /^[A-Za-z0-9_|*.()^$ -]{1,200}$/, patternHint: 'a tool matcher such as "Edit|Write"' },
    script: { type: 'string', pattern: NAME, patternHint: 'a script\'s name in .mirai/custom/scripts/, without its extension' },
    timeout: { type: 'integer', min: 1, max: 600 },
  },
  required: ['kind', 'schema_version', 'name', 'event', 'script'],
};

const MCP = {
  type: 'table',
  fields: {
    kind: { type: 'enum', values: ['mcp-server'] },
    schema_version: { type: 'integer', min: 1, max: 1 },
    name: { type: 'string', pattern: NAME, patternHint: NAME_HINT },
    description: { type: 'string', pattern: /^[^\n]{1,300}$/, patternHint: 'one line' },
    transport: { type: 'enum', values: ['stdio', 'http', 'sse'] },
    command: { type: 'string', pattern: /^[^\0\n]{1,400}$/, patternHint: 'a program' },
    args: { type: 'array', items: { type: 'string', pattern: /^[^\0\n]{0,400}$/, patternHint: 'one argument' } },
    url: { type: 'string', pattern: /^https?:\/\/[^\s@]{1,400}$/, patternHint: 'an http(s) URL with no user or password in it' },
    env: { type: 'table', map: { type: 'string' }, keyPattern: /^[A-Z_][A-Z0-9_]{0,63}$/, keyHint: 'an environment variable\'s name' },
    headers: { type: 'table', map: { type: 'string' }, keyPattern: /^[A-Za-z][A-Za-z0-9-]{0,63}$/, keyHint: 'a header name' },
  },
  required: ['kind', 'schema_version', 'name', 'transport'],
};

function toml(o, schema) {
  if (!o.main) {
    o.problems.push('it isn\'t a regular file of at most 256 KiB');
    return null;
  }
  let parsed;
  try {
    parsed = parseToml(o.main, { source: o.path, positions: true });
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    o.problems.push(...(err.errors ?? [err]).map((e) => `line ${e.line ?? 1}: ${e.reason ?? e.message}`));
    return null;
  }
  const locate = (path) => {
    for (let p = path; ; p = p.slice(0, Math.max(p.lastIndexOf('.'), 0))) {
      const at = parsed.positions.get(p);
      if (at) return { source: o.path, ...at };
      if (p === '') return { source: o.path, line: 1, column: 1 };
    }
  };
  o.problems.push(...validate(parsed.value, schema, locate).map((i) => `line ${i.line}: ${i.reason}${i.hint ? ` (${i.hint})` : ''}`));
  if (typeof parsed.value.name === 'string' && parsed.value.name !== o.name) o.problems.push(`name "${parsed.value.name}" isn't the file's name "${o.name}"`);
  o.value = parsed.value;
  return parsed.value;
}

// An interactive-only hook (decision 4): your sessions run one script kept in scripts/, by its
// language's program, from the project's folder. Nothing else: no inline command, so what runs is
// the approved script (the hook's approval binds it).
function hook(o, registry, scripts, bind) {
  checkName(o, registry);
  const v = toml(o, HOOK);
  if (!v || typeof v.script !== 'string') return undefined;
  const found = scripts.get(v.script) ?? [];
  if (found.length !== 1) {
    o.problems.push(found.length ? `script "${v.script}" names ${found.length} files in ${PREFIX}/scripts/: keep one` : `script "${v.script}": ${PREFIX}/scripts/ has no ${v.script}.<${Object.keys(SCRIPT_RUNNERS).join('|')}> (mirai custom add moves it there)`);
    return undefined;
  }
  bind(o, found[0]);
  if (o.problems.length) return undefined;
  const ext = found[0].slice(found[0].lastIndexOf('.') + 1);
  const command = `${SCRIPT_RUNNERS[ext]} "$CLAUDE_PROJECT_DIR/${PREFIX}/${found[0]}"`;
  const group = { ...(v.matcher ? { matcher: v.matcher } : {}), hooks: [{ type: 'command', command, ...(v.timeout ? { timeout: v.timeout } : {}) }] };
  o.result = { event: v.event, group, script: `${PREFIX}/${found[0]}` };
  return undefined;
}

// A value MIRAI may keep in the repo: `${VAR}` references, around at most a short plain word
// ("Bearer "). A secret stays in your environment, never in .mirai/custom/.
const plainValue = (s) => s.replace(/\$\{[A-Z_][A-Z0-9_]{0,63}(?::-[^}]{0,40})?\}/g, '').length <= 20 && /^[A-Za-z :-]*$/.test(s.replace(/\$\{[A-Z_][A-Z0-9_]{0,63}(?::-[^}]{0,40})?\}/g, ''));

function mcp(o, registry) {
  checkName(o, registry);
  const v = toml(o, MCP);
  if (!v || o.problems.length) return undefined;
  if (v.transport === 'stdio' && (v.command === undefined || v.url !== undefined || v.headers !== undefined)) o.problems.push('transport = "stdio" runs a command: give command (and args, env), not url or headers');
  if (v.transport !== 'stdio' && (v.url === undefined || v.command !== undefined || v.args !== undefined)) o.problems.push(`transport = "${v.transport}" connects to a URL: give url (and headers), not command or args`);
  for (const [k, val] of [...Object.entries(v.env ?? {}).map(([k, x]) => [`env.${k}`, x]), ...Object.entries(v.headers ?? {}).map(([k, x]) => [`headers.${k}`, x])]) {
    if (!plainValue(val)) o.problems.push(`${k}: a value here is a \${VARIABLE} reference (and at most a short word such as "Bearer "): MIRAI keeps no secret in the repo`);
  }
  if (o.problems.length) return undefined;
  const server = v.transport === 'stdio'
    ? { command: v.command, ...(v.args ? { args: [...v.args] } : {}), ...(v.env ? { env: { ...v.env } } : {}) }
    : { type: v.transport, url: v.url, ...(v.headers ? { headers: { ...v.headers } } : {}) };
  o.result = { server };
  return undefined;
}
