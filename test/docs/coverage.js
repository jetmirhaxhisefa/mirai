import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseToml } from '../../src/config/toml.js';

// The docs check (unit 34b): everything you can use is named in docs/, or is on
// docs/internal-list.toml with a reason. It proves a mention, not quality (decision 4).
// Pure functions over plain inputs, so the seeded-gap tests run on fixtures, not the real docs.

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const LAYERS = Object.freeze({ project: 'project', 'personal-repo': 'personal repo', 'personal-global': 'personal global' });
export const KINDS = Object.freeze(['command', 'key', 'type']);
const LIST = 'docs/internal-list.toml';

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// What a page names: its code spans, its code blocks and its headings, each with its line.
export function namedIn(text) {
  const out = [];
  let fence = null;
  let block = [];
  text.split('\n').forEach((line, i) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) {
        out.push({ text: block.join('\n'), line: i + 1, kind: 'block' });
        fence = null;
        block = [];
      } else block.push(line);
      return;
    }
    if (marker) {
      fence = marker[1];
      return;
    }
    if (/^#{1,6}\s/.test(line)) out.push({ text: line.replace(/^#+\s*/, '').replace(/`/g, ''), line: i + 1, kind: 'heading' });
    for (const m of line.matchAll(/(`+)([^`]|[^`].*?[^`])\1(?!`)/g)) out.push({ text: m[2].trim(), line: i + 1, kind: 'code' });
  });
  return out;
}

// The commands and subcommands to name: each command, and each literal word or `<a|b>` choice
// that follows it in its usage string (`mirai redteam accept-blocker`, `mirai key new`).
export function commandNames(commands) {
  const out = [];
  for (const cmd of commands) {
    out.push(`mirai ${cmd.name}`);
    const subs = new Set();
    for (const form of String(cmd.usage ?? '').split(/\s\|\s(?=mirai\s)/)) {
      const words = form.trim().split(/\s+/);
      if (words[0] !== 'mirai' || words[1] !== cmd.name || words[2] === undefined) continue;
      const next = words[2];
      const choice = next.match(/^<([a-z][a-z0-9_-]*(?:\|[a-z][a-z0-9_-]*)+)>$/);
      if (choice) choice[1].split('|').forEach((s) => subs.add(s));
      else if (/^[a-z][a-z0-9_-]*$/.test(next)) subs.add(next);
    }
    for (const sub of subs) out.push(`mirai ${cmd.name} ${sub}`);
  }
  return out;
}

// Every key a config file may hold, from the schema: tables' fields, `<name>` for a map's keys,
// `[]` for a list of tables, and the leaves LAYER_KEYS names outside the schema (schema_version).
export function configKeys(schema, layerKeys) {
  const keys = [];
  const walk = (node, path) => {
    if (!node) return;
    if (node.type === 'choice') {
      walk(node.pick([]), path);
      const table = node.pick({});
      if (table?.type === 'table') walk(table, path);
      return;
    }
    if (node.type === 'table' && node.fields) {
      for (const [k, v] of Object.entries(node.fields)) walk(v, path ? `${path}.${k}` : k);
      return;
    }
    if (node.type === 'table' && node.map) return walk(node.map, `${path}.<name>`);
    if (node.type === 'array' && node.items?.type === 'table') return walk(node.items, `${path}[]`);
    if (!keys.includes(path)) keys.push(path);
  };
  walk(schema, '');
  for (const rules of Object.values(layerKeys)) {
    for (const rule of rules) if (!rule.includes('*') && !keys.some((k) => k === rule || k.startsWith(`${rule}.`) || k.startsWith(`${rule}[`))) keys.push(rule);
  }
  return keys;
}

// Who may set a key, as config.md's second column says it: the layers whose LAYER_KEYS allow it.
export function whoMaySet(key, layerKeys) {
  const path = key.split('[')[0];
  const allows = (rule) => rule === path || (rule.endsWith('.*') && (path === rule.slice(0, -2) || path.startsWith(rule.slice(0, -1))));
  const who = Object.entries(LAYERS).filter(([kind]) => (layerKeys[kind] ?? []).some(allows)).map(([, label]) => label);
  return who.length ? who.join(', ') : 'none';
}

// docs/config.md's rows: every table row whose first cell is one code span.
export function configRows(text) {
  const rows = [];
  text.split('\n').forEach((line, i) => {
    if (!line.startsWith('|')) return;
    const cells = line.replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
    const key = cells[0]?.match(/^`([^`]+)`$/)?.[1];
    if (key) rows.push({ key, cells, line: i + 1 });
  });
  return rows;
}

function readList(text) {
  if (text === undefined) return { entries: [], problems: [] };
  try {
    const value = parseToml(Buffer.from(text), { source: LIST });
    const entries = value.internal ?? [];
    if (!Array.isArray(entries)) return { entries: [], problems: [`${LIST}: [[internal]] must be a list of tables, each with name, kind and reason`] };
    return { entries, problems: [] };
  } catch (err) {
    return { entries: [], problems: [`${LIST} can't be read: ${err.message}`] };
  }
}

// The page that talks most about a word: a hint for where a missing mention belongs.
function likelyPage(pages, word) {
  const re = new RegExp(`(?<![\\w-])${escape(word)}(?![\\w-])`, 'g');
  let best = null;
  let most = 0;
  for (const [name, text] of Object.entries(pages)) {
    if (name === 'README.md' || name === 'config.md') continue;
    const n = (text.match(re) ?? []).length;
    if (n > most) [best, most] = [name, n];
  }
  return best ? ` (docs/${best}?)` : '';
}

// The check. `input`: { pages: { 'name.md': text }, files: [names in docs/], commands: [{ name,
// usage }], session: { commands, gates, notFromSession }, schema, layerKeys, types: [{ name, file }],
// list: text of docs/internal-list.toml }. Returns the problems, each a sentence for you.
export function checkDocs(input) {
  const problems = [];
  const { pages, layerKeys } = input;
  const named = Object.entries(pages).flatMap(([page, text]) => namedIn(text).map((n) => ({ ...n, page })));
  const codeTexts = named.map((n) => n.text);
  const says = (re) => codeTexts.some((t) => re.test(t));

  const list = readList(input.list);
  problems.push(...list.problems);
  const commands = commandNames(input.commands);
  const keys = configKeys(input.schema, layerKeys);
  const types = input.types.map((t) => t.name);
  const exists = { command: commands, key: keys, type: types };
  const excepted = { command: new Set(), key: new Set(), type: new Set() };
  for (const [i, entry] of list.entries.entries()) {
    const label = typeof entry?.name === 'string' ? `"${entry.name}"` : `number ${i + 1}`;
    if (typeof entry?.name !== 'string' || !entry.name.trim()) {
      problems.push(`${LIST}: entry ${label} has no name: add name = "…"`);
      continue;
    }
    if (!KINDS.includes(entry.kind)) {
      problems.push(`${LIST}: entry ${label} has kind ${JSON.stringify(entry.kind ?? null)}: use one of ${KINDS.join(', ')}`);
      continue;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 3) problems.push(`${LIST}: entry ${label} has no reason: add reason = "…" (why it isn't in docs/)`);
    if (!exists[entry.kind].includes(entry.name)) problems.push(`${LIST}: entry ${label} (${entry.kind}) names something that no longer exists: remove the entry`);
    excepted[entry.kind].add(entry.name);
  }

  // Commands and their subcommands, as `mirai <command> [<subcommand>]`.
  for (const name of commands) {
    const parent = name.split(' ').slice(0, 2).join(' ');
    if (excepted.command.has(name) || excepted.command.has(parent)) continue;
    if (says(new RegExp(`(?<![\\w/-])${escape(name)}(?![\\w-])`))) continue;
    const word = name.split(' ').slice(1).join(' ');
    problems.push(`${name} isn't named in docs/: add it to the page for its area${likelyPage(pages, word)} as \`${name}\`, or to ${LIST} with a reason`);
  }

  // /mirai: every command the session server runs is named as `/mirai <command>`; every gate and
  // every command kept out of the session is named in a `/mirai` section, which says why.
  for (const cmd of input.session.commands) {
    if (says(new RegExp(`/mirai ${escape(cmd)}(?![\\w-])`))) continue;
    problems.push(`/mirai ${cmd} isn't named in docs/: add \`/mirai ${cmd}\` to the session list in docs/agents.md ("\`/mirai\` in your Claude Code session") or to the page for its area`);
  }
  const sectionCode = [];
  for (const text of Object.values(pages)) {
    // A `/mirai` section runs from its heading to the next heading at its level or above.
    let level = 0;
    for (const line of text.split('\n')) {
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) level = h[2].includes('/mirai') ? h[1].length : level && h[1].length > level ? level : 0;
      else if (level) for (const m of line.matchAll(/`([^`]+)`/g)) sectionCode.push(m[1]);
    }
  }
  for (const [kind, names] of [['a gate', input.session.gates], ['not run from a session', input.session.notFromSession]]) {
    for (const cmd of names) {
      const re = new RegExp(`(?<![\\w-])${escape(cmd)}(?![\\w-])`);
      if (sectionCode.some((t) => re.test(t))) continue;
      problems.push(`${cmd} is ${kind}, but no \`/mirai\` section in docs/ names it: add \`${cmd}\` to the gates or "Not from a session" line in docs/agents.md ("\`/mirai\` in your Claude Code session")`);
    }
  }

  // Config keys: exactly one row each in docs/config.md, every column filled, who-may-set from LAYER_KEYS.
  const rows = configRows(pages['config.md'] ?? '');
  const seen = new Map();
  for (const row of rows) {
    if (!keys.includes(row.key)) {
      problems.push(`docs/config.md:${row.line} has a row for \`${row.key}\`, which the config schema doesn't know: remove the row, or fix the key's name`);
      continue;
    }
    if (seen.has(row.key)) problems.push(`docs/config.md:${row.line} has a second row for \`${row.key}\` (the first is line ${seen.get(row.key)}): keep one`);
    seen.set(row.key, row.line);
    const columns = ['key', 'who may set it', 'default', 'what it does'];
    if (row.cells.length !== columns.length) {
      problems.push(`docs/config.md:${row.line}, row \`${row.key}\`, has ${row.cells.length} columns: give it ${columns.length} (${columns.join(', ')})`);
      continue;
    }
    row.cells.forEach((c, i) => {
      if (!c) problems.push(`docs/config.md:${row.line}, row \`${row.key}\`: the "${columns[i]}" column is empty: fill it`);
    });
    const who = whoMaySet(row.key, layerKeys);
    if (row.cells[1] && row.cells[1] !== who) problems.push(`docs/config.md:${row.line}, row \`${row.key}\`: "who may set it" says "${row.cells[1]}", but LAYER_KEYS says "${who}": fix the row`);
  }
  for (const key of keys) {
    if (seen.has(key) || excepted.key.has(key)) continue;
    const table = key.split(/[.[]/)[0];
    problems.push(`config key \`${key}\` has no row in docs/config.md: add one under its table ([${table}]) with who may set it, the default and what it does, or add it to ${LIST} with a reason`);
  }

  // Document types: named in docs/documents.md or a page it links, as `<name>` or `<name>.toml`.
  const linked = new Set(['documents.md']);
  for (const m of (pages['documents.md'] ?? '').matchAll(/\]\(([a-z0-9-]+\.md)(?:#[^)]*)?\)/g)) if (pages[m[1]] !== undefined) linked.add(m[1]);
  const typeTexts = named.filter((n) => linked.has(n.page) && n.kind === 'code').map((n) => n.text);
  for (const t of input.types) {
    if (excepted.type.has(t.name)) continue;
    const forms = [t.name, `${t.name}.toml`, `${t.name}/`, t.file];
    if (typeTexts.some((x) => forms.includes(x) || x.endsWith(`/${t.name}.toml`))) continue;
    problems.push(`document type \`${t.name}\` (${t.file}) isn't named in docs/documents.md or a page it links: add it to the document types table in docs/documents.md, or to ${LIST} with a reason`);
  }

  // The index: every file in docs/ has a line in docs/README.md, as a link.
  const readme = pages['README.md'];
  if (readme === undefined) problems.push('docs/README.md is missing: add it, with one line per page in docs/');
  else {
    for (const file of input.files) {
      if (file === 'README.md') continue;
      if (!readme.includes(`](${file})`)) problems.push(`docs/${file} isn't listed in docs/README.md: add a line with a link to it and what it covers`);
    }
  }
  return problems;
}

// The real inputs, from the repo as it is.
export async function realInput(root = ROOT) {
  const { COMMANDS } = await import('../../src/cli/commands/index.js');
  const { createHelp } = await import('../../src/cli/commands/help.js');
  const session = await import('../../src/mcp/tools/commands.js');
  const { CONFIG_SCHEMA, LAYER_KEYS } = await import('../../src/config/config-schema.js');
  const docsDir = join(root, 'docs');
  const files = readdirSync(docsDir).filter((f) => statSync(join(docsDir, f)).isFile() && !f.startsWith('.'));
  const pages = Object.fromEntries(files.filter((f) => f.endsWith('.md')).map((f) => [f, readFileSync(join(docsDir, f), 'utf8')]));
  const typesDir = join(root, 'registry', 'document-types');
  const types = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir).sort()) {
      const full = join(dir, f);
      if (statSync(full).isDirectory()) {
        types.push({ name: f, file: `${relative(root, full)}/` });
        walk(full);
      } else if (f.endsWith('.toml')) types.push({ name: f.slice(0, -5), file: relative(root, full) });
    }
  };
  walk(typesDir);
  let list;
  try {
    list = readFileSync(join(root, LIST), 'utf8');
  } catch {
    list = undefined;
  }
  return {
    pages,
    files,
    commands: [createHelp(() => null), ...COMMANDS].map((c) => ({ name: c.name, usage: c.usage })),
    session: { commands: Object.keys(session.COMMANDS), gates: Object.keys(session.GATES), notFromSession: Object.keys(session.NOT_FROM_SESSION) },
    schema: CONFIG_SCHEMA,
    layerKeys: LAYER_KEYS,
    types,
    list,
  };
}
