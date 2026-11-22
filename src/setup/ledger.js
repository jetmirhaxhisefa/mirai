import { blockOf } from '../install/agents-block.js';
import { hookEntry, renderedHash } from '../install/lock.js';
import { flagText, rulesOf } from '../detect/instructions.js';
import { blobReader, readTree } from '../detect/walk.js';
import { importsOf, INSTRUCTION_FILES } from '../trust/imports.js';
import { toolFrontmatter } from '../config/custom-items.js';

// The ledger (unit 39, Scope 3): every AI item the project has besides MIRAI's own, one row each,
// with its kind, one line on what it does, the commands 17a's patterns flag in it, and your
// decision (empty until stage 2). It's read from the commit you're on (HEAD), never the work tree,
// so it lists what the repo holds; .mirai/ isn't read (17a's walk). Nothing in it reaches a MIRAI
// run: the strict launch reads no project skill, agent, command, hook, settings or .mcp.json, and
// instruction files only through MIRAI's block (17a's rule, unchanged).

export const LEDGER_FILE = '.mirai/setup/ledger.md';
export const LEDGER_KINDS = Object.freeze(['skill', 'agent', 'command', 'hook', 'script', 'instruction', 'mcp', 'document', 'other']);
const MAX_ROWS = 1000;
// The files Claude Code, Cursor, Codex, Gemini, Copilot and Windsurf read as instructions.
const INSTRUCTION_NAMES = Object.freeze([...INSTRUCTION_FILES, 'GEMINI.md', '.cursorrules', '.windsurfrules']);
const INSTRUCTION_PATHS = Object.freeze(['.github/copilot-instructions.md']);
// BMAD's folders (any version), and the council's (Thudos: its markers are a council/ or
// .council/ folder; the .claude/ items it adds are found as any other).
const BMAD = /^(?:.*\/)?(bmad|_bmad|\.bmad-core|\.bmad-[a-z0-9-]+)\//;
const COUNCIL = /^(?:.*\/)?(council|\.council)\//;
const SCRIPT_REF = /(?:^|[\s"'`=(])((?:\.\/)?(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:sh|bash|py|js|mjs|ts|rb))(?=$|[\s"'`);])/g;

const clip = (s, n = 140) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// One line on what a text says it does: its frontmatter description, else its first heading or
// line of prose. Setup's research step replaces it (mirai setup decide --summary).
function summaryOf(text) {
  try {
    const fm = toolFrontmatter(text);
    if (fm && typeof fm.value?.description === 'string') return clip(fm.value.description);
    if (fm) text = fm.body;
  } catch {
    // not frontmatter MIRAI reads; the text it is
  }
  // A script's first comment after its #! line, a text's first heading or line.
  const line = text.split('\n').filter((l, i) => !(i === 0 && l.startsWith('#!'))).map((l) => l.replace(/^(#+|\/\/+)\s*/, '').trim()).find((l) => l && !l.startsWith('<!--') && !l.startsWith('---'));
  return clip(line ?? '');
}

// The rows for the project at `root` (HEAD): [{ id, path, kind, summary, flags: [pattern], files }].
// `registry`: MIRAI's (for 17a's patterns); `lock`: the lock's Map of path to entry (MIRAI's
// rendered files aren't items).
export function scanLedger({ root, env, registry, lock, ref = 'HEAD' }) {
  const tree = readTree(root, ref, env);
  const reader = blobReader(root, tree, env);
  const patterns = Object.values(registry.instructionFlags ?? {}).flatMap((d) => d.patterns.map((p) => ({ name: p.name, kind: p.kind, prose: p.prose === true, re: new RegExp(p.regex, 'iu') })));
  const rules = rulesOf(registry.instructionFlags ?? {});
  const paths = [...tree.files.keys()].sort();
  reader.prefetch(paths.filter((p) => isItem(p) && tree.files.get(p).size <= 256 * 1024));
  const text = (p) => {
    const b = reader.get(p);
    return b && !b.subarray(0, 8000).includes(0) ? b.toString('utf8') : null;
  };
  const flagsOf = (p, t) => (t === null ? [] : flagText(p, t, patterns, rules, { skipBlock: lock?.get(p)?.block === 'mirai' }).flags.map((f) => f.pattern));
  const rows = new Map();
  const row = (id, kind, summary, files, flags = []) => {
    const r = rows.get(id) ?? { id, path: id, kind, summary, flags: [], files: [] };
    r.files.push(...files);
    r.flags = [...new Set([...r.flags, ...flags])].sort();
    if (!r.summary && summary) r.summary = summary;
    rows.set(id, r);
    return r;
  };
  const mine = (p) => {
    const e = lock?.get(p);
    // A file with a MIRAI block or MIRAI's entries is the project's too: its branch below reads it.
    if (!e || e.mark !== 'rendered' || e.block) return false;
    const b = reader.get(p);
    return b !== null && renderedHash(b) === e.sha256;
  };
  const calls = [];
  for (const p of paths) {
    if (!isItem(p) || mine(p)) continue;
    const t = text(p);
    const f = flagsOf(p, t);
    let m;
    if ((m = /^(?:.*\/)?\.claude\/skills\/([^/]+)\//.exec(p)) || (m = /^\.agents\/skills\/([^/]+)\//.exec(p))) {
      const id = p.slice(0, p.indexOf(`/${m[1]}/`) + m[1].length + 1);
      row(id, 'skill', p.endsWith('/SKILL.md') && t ? summaryOf(t) : '', [p], f);
    } else if (/^(?:.*\/)?\.claude\/agents\/[^/]+\.md$/.test(p)) row(p, 'agent', t ? summaryOf(t) : '', [p], f);
    else if (/^(?:.*\/)?\.claude\/commands\/.+\.md$/.test(p) || /^\.codex\/prompts\/.+\.md$/.test(p)) row(p, 'command', t ? summaryOf(t) : '', [p], f);
    else if (/^(?:.*\/)?\.claude\/hooks\//.test(p)) row(p, 'script', t ? summaryOf(t) : '', [p], f);
    else if (/^(?:.*\/)?\.claude\/settings(\.local)?\.json$/.test(p)) settingsRows(p, t, row, patterns, rules, calls, lock);
    else if (/^(?:.*\/)?\.mcp\.json$/.test(p)) mcpRows(p, t, row, patterns, rules);
    else if (INSTRUCTION_NAMES.includes(p.slice(p.lastIndexOf('/') + 1)) || INSTRUCTION_PATHS.includes(p) || /^(?:.*\/)?\.cursor\/rules\//.test(p) || /^\.github\/instructions\//.test(p) || /^\.windsurf\/rules\//.test(p)) {
      if (t !== null && blockOf(t) !== null && withoutBlock(t).trim() === '') continue;
      row(p, 'instruction', t ? summaryOf(withoutBlockSafe(t)) : '', [p], f);
      if (t !== null && INSTRUCTION_FILES.includes(p.slice(p.lastIndexOf('/') + 1))) {
        for (const target of importsOf(t, p)) if (tree.files.has(target) && !target.startsWith('.mirai/')) {
          const it = text(target);
          // AGENTS.md holding only MIRAI's block (CLAUDE.md's import of it is MIRAI's own).
          if (it !== null && blockOf(it) !== null && withoutBlock(it).trim() === '') continue;
          row(target, 'instruction', `imported by ${p}${it ? `: ${summaryOf(it)}` : ''}`, [target], flagsOf(target, it));
        }
      }
    } else if (BMAD.test(p) || COUNCIL.test(p)) {
      const kind = /\/agents\//.test(p) ? 'agent' : /\/(tasks|workflows|commands)\//.test(p) ? 'command' : 'other';
      row(p, kind, t ? summaryOf(t) : '', [p], f);
    } else row(p, 'other', t ? summaryOf(t) : '', [p], f);
    if (t !== null) calls.push(t);
  }
  // BMAD's documents (a PRD, an architecture note): sources for stage 3 when the project has BMAD.
  if (paths.some((p) => BMAD.test(p))) {
    for (const p of paths) if (/^docs\/(?:.*\/)?(prd|architecture|brief|front-end-spec)[^/]*\.md$/i.test(p)) row(p, 'document', `${summaryOf(text(p) ?? '')}`.trim() || 'a BMAD document', [p]);
  }
  // Scripts the items call, that the repo holds.
  for (const t of calls) {
    for (const m of t.matchAll(SCRIPT_REF)) {
      const p = m[1].replace(/^\.\//, '');
      if (tree.files.has(p) && !rows.has(p) && !p.startsWith('.mirai/')) row(p, 'script', summaryOf(text(p) ?? ''), [p], flagsOf(p, text(p)));
    }
  }
  return [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, MAX_ROWS);
}

// Whether a path is an AI item's file (the scripts they call and BMAD's documents are found after).
function isItem(p) {
  return /(^|\/)\.(claude|cursor|codex|agents|windsurf)\//.test(p) || /(^|\/)\.mcp\.json$/.test(p) || /^\.github\/(copilot-instructions\.md|instructions\/)/.test(p)
    || INSTRUCTION_NAMES.includes(p.slice(p.lastIndexOf('/') + 1)) || BMAD.test(p) || COUNCIL.test(p);
}

function withoutBlock(t) {
  const b = blockOf(t);
  if (b === null) return t;
  const start = t.indexOf('<!-- mirai:begin -->');
  const end = t.indexOf('<!-- mirai:end -->');
  return `${t.slice(0, start)}${t.slice(end + '<!-- mirai:end -->'.length)}`;
}
function withoutBlockSafe(t) {
  try {
    return withoutBlock(t);
  } catch {
    return t;
  }
}

// A settings file: one row per hook it runs, one for the rest when it holds more than MIRAI's
// denies and hooks (allow rules, env, plugins).
function settingsRows(p, t, row, patterns, rules, calls, lock) {
  let v;
  try {
    v = JSON.parse(t ?? '');
  } catch {
    row(p, 'other', 'a settings file MIRAI can\'t read', [p]);
    return;
  }
  const flag = (s) => flagText(`${p}.txt`, s, patterns, rules).flags.map((f) => f.pattern);
  const mineHooks = new Set((lock?.get(p)?.entries ?? []).filter((e) => e.startsWith('hook:')));
  for (const [event, groups] of Object.entries(v?.hooks ?? {})) {
    (Array.isArray(groups) ? groups : []).forEach((g, i) => {
      // MIRAI's own rendered hooks aren't items (their entries are in the lock).
      if (mineHooks.has(hookEntry(event, g))) return;
      const cmds = (g?.hooks ?? []).map((h) => h?.command).filter((c) => typeof c === 'string');
      calls.push(cmds.join('\n'));
      row(`${p}#hooks.${event}.${i}`, 'hook', clip(`${event}${g?.matcher ? ` (${g.matcher})` : ''}: ${cmds.join('; ')}`), [p], cmds.flatMap(flag));
    });
  }
  const rest = Object.keys(v ?? {}).filter((k) => k !== 'hooks' && k !== '$schema' && !(k === 'permissions' && Object.keys(v.permissions ?? {}).every((x) => x === 'deny')));
  if (rest.length) row(p, 'other', `settings: ${rest.join(', ')}`, [p], flagText(p, t, patterns, rules).flags.map((f) => f.pattern));
}

function mcpRows(p, t, row, patterns, rules) {
  let v;
  try {
    v = JSON.parse(t ?? '');
  } catch {
    row(p, 'other', 'an .mcp.json MIRAI can\'t read', [p]);
    return;
  }
  for (const [name, s] of Object.entries(v?.mcpServers ?? {})) {
    const what = s?.url ? `${s.type ?? 'http'}: ${s.url}` : `stdio: ${[s?.command, ...(s?.args ?? [])].filter(Boolean).join(' ')}`;
    row(`${p}#${name}`, 'mcp', clip(what), [p], flagText(`${p}.txt`, what, patterns, rules).flags.map((f) => f.pattern));
  }
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

// The ledger's text: the rows with your decisions and the research's summaries from setup.json
// (`items`: id → { decision, place, summary }).
export function ledgerText(rows, items = {}) {
  const lines = [
    '# Setup ledger',
    '',
    'Every AI item this project had besides MIRAI\'s, from `mirai setup scan` (unit 39). Each is',
    'researched and decided in stage 2 (`/mirai setup`). Nothing here is used by a MIRAI run until',
    'it is decided, moved into `.mirai/custom/` and approved.',
    '',
    '| Path | Kind | What it does | Flagged | Decision |',
    '|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const d = items[r.id];
    const decision = !d?.decision ? '' : d.decision === 'keep' ? `keep: ${d.place ?? ''}` : d.decision === 'drop' ? 'drop' : d.decision;
    lines.push(`| \`${cell(r.id)}\` | ${r.kind} | ${cell(d?.summary ?? r.summary)} | ${cell(r.flags.join(', '))} | ${cell(decision)} |`);
  }
  if (!rows.length) lines.push('| (none) | | | | |');
  return `${lines.join('\n')}\n`;
}
