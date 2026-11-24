import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';

import { MiraiError, UsageError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { loadCustomRoles, loadRegistry } from '../config/registry.js';
import { CUSTOM_DIR, overlayFilesIn, readOverlays, recordPathOf } from '../config/overlays.js';
import { HOOK_EVENTS, SCRIPT_RUNNERS, toolFrontmatter } from '../config/custom-items.js';
import { noLinks } from '../install/lock.js';
import { REGISTRY_DIR } from '../install/render.js';

// `mirai custom add <path>` (unit 39, Scope 6; decision 6's second layer): moves one AI item into
// its place under .mirai/custom/, deletes the original, and ends with the next steps: your approval
// (`mirai approve --file`), then `mirai render`, which puts it into your sessions' folders. 37
// renders only an item whose committed record verifies, so .claude/ changes after the approval,
// never at the move. The item is checked first, as it would be read from its new place (the
// static checks of decision 3); one that fails is refused, naming the check, and nothing moves.

export const AS_VALUES = Object.freeze(['skill', 'mirai-developer', 'mirai-reviewer', 'mirai-verifier', 'mirai-product-manager', 'interactive', 'check', 'both']);
const NAME = /^[a-z][a-z0-9-]{0,62}$/;
const SCRIPT_EXT = Object.keys(SCRIPT_RUNNERS);

export class CustomError extends MiraiError {
  constructor(message, { code = 'custom-refused', hint } = {}) {
    super(message, EXIT.BLOCKED);
    this.name = 'CustomError';
    this.code = code;
    this.hint = hint;
  }
}

const tomlString = (s) => JSON.stringify(String(s));
const tomlList = (list) => `[${list.map(tomlString).join(', ')}]`;
// A file name as a custom item's name: lower case, "-" for anything else.
const asName = (s) => String(s).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/^([0-9])/, 's-$1').slice(0, 63);

// What `path` (repo-relative, with an optional "#…" part for a hook or a server) is, and how it
// moves: { kind, name, writes: Map<rel under .mirai/custom, Buffer>, removes: [repo path],
// edits: [{ path, text|null }], main, checkLine? }.
function planMove(root, spec, opts) {
  const [file, part = null] = spec.split('#');
  const abs = join(root, file);
  noLinks(root, file);
  if (!existsSync(abs)) throw new UsageError(`${file} isn't there`, 'give a path in this repo, as mirai setup status or the ledger names it');
  const isDir = lstatSync(abs).isDirectory();
  const base = basename(file);
  // A hook in a settings file, as the ledger names it: .claude/settings.json#hooks.<Event>.<n>.
  if (/(^|\/)\.claude\/settings(\.local)?\.json$/.test(file)) return hookFromSettings(root, file, part, opts);
  if (base === '.mcp.json') return mcpFrom(root, file, part ?? opts.server ?? null);
  if (opts.event) return hookFromScript(root, file, opts);
  // A skill folder (or its SKILL.md).
  const skillDir = isDir && existsSync(join(abs, 'SKILL.md')) ? file : base === 'SKILL.md' ? dirname(file) : null;
  if (skillDir && /(^|\/)\.(claude|agents|cursor|codex)\/skills\/[^/]+$/.test(skillDir)) return skillFrom(root, skillDir);
  // Unit 39, P1's F11: a new skill drafted outside the agent folders (the rule: never directly in
  // .claude/), as a folder holding its SKILL.md; the same checks and the same move. Not the repo's
  // root folder, nor anything under .mirai/ or an agent folder.
  if (skillDir && isDraftDir(skillDir)) return skillFrom(root, skillDir);
  if (/(^|\/)\.claude\/agents\/[^/]+\.md$/.test(file)) return agentFrom(root, file, opts);
  if (/(^|\/)\.claude\/commands\/.+\.md$/.test(file) || /^\.codex\/prompts\/.+\.md$/.test(file)) return commandFrom(root, file);
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
  if (!isDir && SCRIPT_EXT.includes(ext)) return scriptFrom(root, file, opts);
  if (['CLAUDE.md', 'AGENTS.md', 'CLAUDE.local.md', 'GEMINI.md', '.cursorrules', '.windsurfrules'].includes(base) || /(^|\/)\.cursor\/rules\//.test(file)) {
    throw new CustomError(`${file} is instruction text, which isn't a custom item`, { hint: 'setup puts its rules in conventions-<service>.md, its facts in project-<service>.md and the rest in .mirai/context/agents-local.md (stage 3)' });
  }
  throw new CustomError(`${file} isn't an item mirai custom add moves`, { hint: `it moves a skill folder (under .claude/skills/, or a draft folder with its SKILL.md anywhere outside the agent folders), an agent or a command (.claude/…), a script (.${SCRIPT_EXT.join(', .')}), a hook (--hook <event>, or .claude/settings.json#hooks.<Event>.<n>) and an MCP server (.mcp.json#<name>)` });
}

const AGENT_DIRS = /(^|\/)\.(claude|agents|cursor|codex|windsurf)(\/|$)/;
function isDraftDir(dir) {
  const d = dir.replace(/^\.\/+/, '').replace(/\/+$/, '');
  return d !== '' && d !== '.' && !d.startsWith('.mirai/') && d !== '.mirai' && !AGENT_DIRS.test(d) && !d.split('/').some((x) => x === 'node_modules' || x === '..');
}

function readText(root, file) {
  const bytes = readFileSync(join(root, file));
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new CustomError(`${file} isn't UTF-8 text`);
  return text;
}

function skillFrom(root, dir) {
  const name = basename(dir);
  const writes = new Map();
  const walk = (rel) => {
    for (const e of readdirSync(join(root, dir, rel)).sort()) {
      if (e.startsWith('.')) continue;
      const r = rel ? `${rel}/${e}` : e;
      noLinks(root, `${dir}/${r}`);
      if (lstatSync(join(root, dir, r)).isDirectory()) walk(r);
      else writes.set(`project-skills/${name}/${r}`, readFileSync(join(root, dir, r)));
    }
  };
  walk('');
  return { kind: 'project-skill', name, writes, removes: [dir], edits: [], main: `project-skills/${name}/SKILL.md` };
}

// A command becomes a project skill of the same name: its description and its text.
function commandFrom(root, file) {
  const name = asName(basename(file));
  const text = readText(root, file);
  let fm = null;
  try {
    fm = toolFrontmatter(text);
  } catch {
    fm = null;
  }
  const body = fm ? fm.body : text;
  const description = typeof fm?.value?.description === 'string' ? fm.value.description : (body.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) ?? name);
  const skill = `---\nname: ${name}\ndescription: ${JSON.stringify(description.slice(0, 1000))}\n---\n\n<!-- Moved from ${file} by mirai custom add (unit 39). -->\n\n${body.replace(/^\s+/, '')}`;
  return { kind: 'project-skill', name, writes: new Map([[`project-skills/${name}/SKILL.md`, Buffer.from(skill, 'utf8')]]), removes: [file], edits: [], main: `project-skills/${name}/SKILL.md` };
}

// An agent is kept as an overlay of one of MIRAI's agents (its write scope a role of the project's
// own, in .mirai/custom/roles/), or as a skill; any other agent is dropped.
function agentFrom(root, file, opts) {
  const text = readText(root, file);
  let fm = null;
  try {
    fm = toolFrontmatter(text);
  } catch {
    fm = null;
  }
  if (opts.as === 'skill') {
    const name = asName(basename(file));
    const description = typeof fm?.value?.description === 'string' ? fm.value.description : name;
    const skill = `---\nname: ${name}\ndescription: ${JSON.stringify(description.slice(0, 1000))}\n---\n\n<!-- Moved from ${file} (an agent) by mirai custom add (unit 39). -->\n\n${(fm ? fm.body : text).replace(/^\s+/, '')}`;
    return { kind: 'project-skill', name, writes: new Map([[`project-skills/${name}/SKILL.md`, Buffer.from(skill, 'utf8')]]), removes: [file], edits: [], main: `project-skills/${name}/SKILL.md` };
  }
  // Unit 40: a project's own document checker can become an overlay of the verifier, too.
  if (!['mirai-developer', 'mirai-reviewer', 'mirai-verifier', 'mirai-product-manager'].includes(opts.as)) {
    throw new CustomError(`${file} is an agent: say which MIRAI agent it becomes an overlay of, or keep it as a skill`, { code: 'custom-agent-as', hint: `mirai custom add ${file} --as mirai-developer|mirai-reviewer|mirai-verifier|mirai-product-manager --role <a role in .mirai/custom/roles/>, or --as skill; any other agent is dropped (a new agent comes with its own unit)` });
  }
  const tools = fm?.value?.tools === undefined ? null : (Array.isArray(fm.value.tools) ? fm.value.tools : String(fm.value.tools).split(/[\s,]+/)).map(String).filter(Boolean);
  const lines = ['kind = "agent-overlay"', 'schema_version = 1', `name = ${tomlString(opts.as)}`, `# From ${file}, moved by mirai custom add (unit 39).`];
  if (opts.role) lines.push(`role = ${tomlString(opts.role)}`);
  if (tools) lines.push('', '[tools]', `allowed = ${tomlList(tools)}`);
  lines.push('', '[instructions]', 'mode = "append"');
  return {
    kind: 'agent', name: opts.as,
    writes: new Map([[`agents/${opts.as}.toml`, Buffer.from(`${lines.join('\n')}\n`, 'utf8')], [`agents/${opts.as}.md`, Buffer.from(`${(fm ? fm.body : text).replace(/^\s+/, '')}`, 'utf8')]]),
    removes: [file], edits: [], main: `agents/${opts.as}.toml`,
  };
}

function scriptFrom(root, file, opts = {}) {
  const ext = file.slice(file.lastIndexOf('.') + 1);
  const name = asName(basename(file));
  if (!NAME.test(name)) throw new CustomError(`${file}: no name MIRAI can give it`, { hint: 'rename it with letters, digits and "-", then add it again' });
  const out = { kind: 'script', name, writes: new Map([[`scripts/${name}.${ext}`, readFileSync(join(root, file))]]), removes: [file], edits: [], main: `scripts/${name}.${ext}` };
  if (opts.as === 'check' || opts.as === 'both') out.checkLine = checkLine(name, ext, opts);
  return out;
}

// The [checks] line a hook kept as a check needs (decision 4): it runs in the sandbox, in your test
// service, at the build's checks step. The config is yours, so MIRAI prints it for you to add.
function checkLine(name, ext, opts) {
  if (!opts.service) throw new UsageError('a hook kept as a check runs in a compose service: give --service <service>', 'for example --service app');
  return `${name} = { command = ${tomlList([SCRIPT_RUNNERS[ext], `${CUSTOM_DIR}/scripts/${name}.${ext}`])}, service = ${tomlString(opts.service)}${opts.workdir ? `, workdir = ${tomlString(opts.workdir)}` : ''} }`;
}

// A hook whose script is `file`: the script moves to scripts/, the hook goes to hooks/<name>.toml
// (unless it's kept only as a check), and every group in .claude/settings*.json that runs it goes.
function hookFromScript(root, file, opts) {
  if (!HOOK_EVENTS.includes(opts.event)) throw new UsageError(`--hook takes one of: ${HOOK_EVENTS.join(', ')}`);
  const s = scriptFrom(root, file, opts);
  const edits = [];
  for (const settings of ['.claude/settings.json', '.claude/settings.local.json']) {
    const e = withoutHooks(root, settings, (cmd) => cmd.includes(file));
    if (e) edits.push(e);
  }
  return hookPlan(s, opts.event, opts.matcher ?? null, opts.as ?? 'interactive', edits, `${file}`);
}

function hookPlan(s, event, matcher, as, edits, from) {
  const writes = new Map(s.writes);
  if (as !== 'check') {
    const lines = ['kind = "hook"', 'schema_version = 1', `name = ${tomlString(s.name)}`, `# From ${from}, moved by mirai custom add (unit 39). Your sessions only, never a MIRAI run.`, `event = ${tomlString(event)}`];
    if (matcher) lines.push(`matcher = ${tomlString(matcher)}`);
    lines.push(`script = ${tomlString(s.name)}`);
    writes.set(`hooks/${s.name}.toml`, Buffer.from(`${lines.join('\n')}\n`, 'utf8'));
  }
  return { kind: as === 'check' ? 'script' : 'hook', name: s.name, writes, removes: s.removes, edits, main: as === 'check' ? s.main : `hooks/${s.name}.toml`, script: s.main, checkLine: s.checkLine };
}

// A settings file without the hook groups `drop` picks (by their commands): { path, text } or
// null when it has none.
function withoutHooks(root, file, drop) {
  if (!existsSync(join(root, file))) return null;
  noLinks(root, file);
  let v;
  try {
    v = JSON.parse(readText(root, file));
  } catch {
    return null;
  }
  if (!v?.hooks || typeof v.hooks !== 'object') return null;
  let changed = false;
  const hooks = {};
  for (const [event, groups] of Object.entries(v.hooks)) {
    const left = (Array.isArray(groups) ? groups : []).filter((g) => {
      const hit = (g?.hooks ?? []).some((h) => typeof h?.command === 'string' && drop(h.command, event, g));
      if (hit) changed = true;
      return !hit;
    });
    if (left.length) hooks[event] = left;
  }
  if (!changed) return null;
  const next = { ...v, hooks };
  if (!Object.keys(hooks).length) delete next.hooks;
  return { path: file, text: `${JSON.stringify(next, null, 2)}\n` };
}

// A hook as the ledger names it (.claude/settings.json#hooks.<Event>.<n>). It's kept only when it
// has a sandbox-safe form: one command that runs one script the repo holds, by its language's
// program or directly. Anything else (a pipe, an inline command, a script outside the repo) is
// refused, naming the check (decision 3).
function hookFromSettings(root, file, part, opts) {
  const m = /^hooks\.([A-Za-z]+)\.([0-9]+)$/.exec(part ?? '');
  if (!m) throw new UsageError(`name the hook: ${file}#hooks.<Event>.<n>, as the ledger lists it`);
  const v = JSON.parse(readText(root, file));
  const group = v?.hooks?.[m[1]]?.[Number(m[2])];
  if (!group) throw new UsageError(`${file} has no hook ${part}`);
  if (!HOOK_EVENTS.includes(m[1])) throw new CustomError(`${file}#${part}: ${m[1]} isn't a hook event MIRAI keeps (${HOOK_EVENTS.join(', ')})`, { code: 'hook-not-safe' });
  const cmds = (group.hooks ?? []).map((h) => h?.command);
  const script = cmds.length === 1 && typeof cmds[0] === 'string' ? scriptOfCommand(root, cmds[0]) : null;
  if (!script) {
    throw new CustomError(`${file}#${part} has no sandbox-safe form: a kept hook runs one script kept in ${CUSTOM_DIR}/scripts/, and this one runs ${JSON.stringify(String(cmds.join('; ')).slice(0, 160))}`, { code: 'hook-not-safe', hint: 'put what it does in a script in the repo, point the hook at it, then add it again; or drop it' });
  }
  const s = scriptFrom(root, script, opts);
  const edits = [];
  const e = withoutHooks(root, file, (cmd, event, g) => event === m[1] && g === group);
  if (e) edits.push(e);
  return hookPlan(s, m[1], typeof group.matcher === 'string' && group.matcher ? group.matcher : null, opts.as ?? 'interactive', edits, `${file}#${part}`);
}

// The repo script a hook command runs, or null: `[sh|bash|node|python3|python] <path>` or `<path>`,
// with "$CLAUDE_PROJECT_DIR"/ in front or not, and nothing else.
export function scriptOfCommand(root, command) {
  const m = /^\s*(?:(?:sh|bash|node|python3?)\s+)?"?(?:\$CLAUDE_PROJECT_DIR\/|\$\{CLAUDE_PROJECT_DIR\}\/|\.\/)?([A-Za-z0-9_./-]+)"?\s*$/.exec(command);
  if (!m) return null;
  const p = m[1].replace(/^\.\//, '');
  if (p.startsWith('/') || p.split('/').includes('..') || !SCRIPT_EXT.includes(p.slice(p.lastIndexOf('.') + 1))) return null;
  try {
    return lstatSync(join(root, p)).isFile() ? p : null;
  } catch {
    return null;
  }
}

function mcpFrom(root, file, name) {
  const v = JSON.parse(readText(root, file));
  const servers = Object.keys(v?.mcpServers ?? {});
  if (!name && servers.length === 1) [name] = servers;
  if (!name || !Object.hasOwn(v?.mcpServers ?? {}, name)) throw new UsageError(`name the server: ${file}#<name> (it has: ${servers.join(', ') || 'none'})`);
  const s = v.mcpServers[name];
  const item = asName(name);
  const lines = ['kind = "mcp-server"', 'schema_version = 1', `name = ${tomlString(item)}`, `# From ${file} (${name}), moved by mirai custom add (unit 39). Your sessions only, never a MIRAI run.`];
  if (s.url) {
    lines.push(`transport = ${tomlString(s.type === 'sse' ? 'sse' : 'http')}`, `url = ${tomlString(s.url)}`);
    if (s.headers) lines.push('', '[headers]', ...Object.entries(s.headers).map(([k, x]) => `${k} = ${tomlString(x)}`));
  } else {
    lines.push('transport = "stdio"', `command = ${tomlString(s.command ?? '')}`);
    if (Array.isArray(s.args)) lines.push(`args = ${tomlList(s.args)}`);
    if (s.env) lines.push('', '[env]', ...Object.entries(s.env).map(([k, x]) => `${k} = ${tomlString(x)}`));
  }
  const rest = { ...v, mcpServers: { ...v.mcpServers } };
  delete rest.mcpServers[name];
  const empty = !Object.keys(rest.mcpServers).length && Object.keys(rest).length === 1;
  return { kind: 'mcp', name: item, writes: new Map([[`mcp/${item}.toml`, Buffer.from(`${lines.join('\n')}\n`, 'utf8')]]), removes: empty ? [file] : [], edits: empty ? [] : [{ path: file, text: `${JSON.stringify(rest, null, 2)}\n` }], main: `mcp/${item}.toml` };
}

// Moves the item. `path`: as you typed it (relative to `cwd`, or repo-relative); `opts`: { as,
// role, event, matcher, server, service, workdir }. Returns what was done, for the output.
export function customAdd({ root, cwd = root, path, opts = {} }) {
  if (opts.as !== undefined && !AS_VALUES.includes(opts.as)) throw new UsageError(`--as takes one of: ${AS_VALUES.join(', ')}`);
  const [given, part] = String(path).split('#');
  const abs = isAbsolute(given) ? given : join(cwd, given);
  const rel = relative(root, abs).split('\\').join('/');
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new UsageError(`${given} isn't inside this repo`);
  if (rel === CUSTOM_DIR || rel.startsWith(`${CUSTOM_DIR}/`)) throw new UsageError(`${rel} is already in ${CUSTOM_DIR}/`, `approve it: mirai approve --file ${rel}`);
  if (rel === '.mirai' || rel.startsWith('.mirai/')) throw new UsageError(`${rel} is MIRAI's; nothing there is a custom item`);
  const plan = planMove(root, part ? `${rel}#${part}` : rel, opts);
  const customAbs = join(root, CUSTOM_DIR);
  for (const r of plan.writes.keys()) {
    if (existsSync(join(customAbs, r))) throw new CustomError(`${CUSTOM_DIR}/${r} is already there; nothing was moved`, { code: 'custom-exists', hint: `compare the two, keep one, then add it again (mirai approve --file ${CUSTOM_DIR}/${r} approves the one there)` });
  }
  // The static checks, on the item as it would be read from its new place (decision 3).
  const registry = loadRegistry(join(root, REGISTRY_DIR));
  let roles = registry.roles;
  try {
    roles = { ...roles, ...loadCustomRoles(customAbs, roles) };
  } catch (err) {
    throw new CustomError(`the project's roles in ${CUSTOM_DIR}/roles/ don't read: ${err.message}`);
  }
  if (plan.kind === 'agent' && opts.role && !Object.hasOwn(roles, opts.role)) throw new CustomError(`role "${opts.role}" isn't a role (roles: ${Object.keys(roles).sort().join(', ')})`, { code: 'custom-role', hint: `a project's role goes in ${CUSTOM_DIR}/roles/<name>.toml` });
  const files = new Map([...overlayFilesIn(customAbs), ...plan.writes]);
  const items = readOverlays(files, registry, { roles });
  const mainPath = `${CUSTOM_DIR}/${plan.main}`;
  const item = items.find((o) => o.path === mainPath);
  const others = plan.kind === 'hook' ? items.filter((o) => o.path === `${CUSTOM_DIR}/${plan.script}`) : [];
  const problems = [...(item?.problems ?? ['it doesn\'t read as a custom item']), ...others.flatMap((o) => o.problems.map((p) => `${o.path}: ${p}`))];
  if (problems.length) {
    throw Object.assign(new CustomError(`${rel}${part ? `#${part}` : ''} is refused: ${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more: ${problems.slice(1, 4).join('; ')})` : ''}; nothing was moved`, { code: 'custom-check' }), { problems });
  }
  // The move: the new files first, then the originals go.
  for (const [r, bytes] of plan.writes) {
    mkdirSync(dirname(join(customAbs, r)), { recursive: true });
    writeFileSync(join(customAbs, r), bytes, { flag: 'wx' });
  }
  for (const e of plan.edits) writeFileSync(join(root, e.path), e.text);
  for (const r of plan.removes) rmSync(join(root, r), { recursive: true, force: true });
  return {
    kind: plan.kind, name: plan.name, item, from: part ? `${rel}#${part}` : rel,
    to: [...plan.writes.keys()].map((r) => `${CUSTOM_DIR}/${r}`), removed: plan.removes, edited: plan.edits.map((e) => e.path),
    main: mainPath, record: recordPathOf(item), checkLine: plan.checkLine ?? null, widening: item.kind === 'agent' && item.result?.change === 'widening' ? item.result.why : null,
  };
}
