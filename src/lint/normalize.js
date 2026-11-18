import { CHANGES, symbolsIn } from './checks.js';

// The plan normalizer (unit 30c, Jet's decision 1): format slips whose meaning is certain are
// fixed by MIRAI before the lint, so a plan isn't parked for them. Each fix is one line in the
// plan's Implementation log. Nothing else changes: no meaning, no new rows. What isn't certain is
// left for the lint, which quotes the cell and names the fix.
//
// `files`: the repo's files at the plan's base (a Set of repo-relative paths), or null to skip the
// Test ID rule.
export function normalizePlan(text, { files = null } = {}) {
  const lines = text.split('\n');
  const changes = [];
  const note = (line, what) => changes.push({ line, what });

  const map = tableAt(lines, 'Code map');
  const added = new Set();
  if (map) {
    const ci = map.columns.indexOf('change');
    const si = map.columns.indexOf('symbols');
    const pi = map.columns.indexOf('path');
    for (const r of map.rows) {
      if (ci >= 0) {
        const cell = r.cells[ci];
        const word = cell.replace(/`/g, '').trim();
        if (!CHANGES.includes(word.toLowerCase())) {
          const m = /^(add|change|remove|read)\b\s*[:,;—–-]?\s*(.*)$/is.exec(word);
          if (m) {
            r.cells[ci] = m[1].toLowerCase();
            note(r.line, `Code map Change "${clip(cell)}" → "${r.cells[ci]}"${m[2] ? ` (the rest: ${clip(m[2], 120)})` : ''}`);
          }
        }
      }
      if (si >= 0) {
        const cell = r.cells[si];
        const fixed = symbolsCell(cell);
        if (fixed !== null && fixed !== cell) {
          r.cells[si] = fixed;
          note(r.line, `Code map Symbols "${clip(cell)}" → "${clip(fixed)}"`);
        }
      }
      if (pi >= 0 && ci >= 0 && r.cells[ci] === 'add') for (const p of codeSpans(r.cells[pi])) added.add(p);
      if (pi >= 0 && ci >= 0 && r.cells[ci] === 'add' && !codeSpans(r.cells[pi]).length) added.add(r.cells[pi].trim());
    }
    rewrite(lines, map);
  }
  const symbols = map ? [...new Set(map.rows.flatMap((r) => symbolsIn(r.cells[map.columns.indexOf('symbols')] ?? '')))] : [];

  const tests = tableAt(lines, 'Test list');
  if (tests) {
    const yi = tests.columns.indexOf('symbol');
    const ti = tests.columns.indexOf('test id');
    for (const r of tests.rows) {
      if (yi >= 0 && r.cells[yi].trim()) {
        const cell = r.cells[yi];
        const names = namesIn(cell);
        let changed = false;
        const out = names.map((n) => {
          if (symbols.includes(n)) return n;
          const m = matchSymbol(n, symbols);
          if (m) changed = true;
          return m ?? n;
        });
        // Rewritten when a name was matched, or when every name is a Code map symbol but the
        // cell isn't in the form the lint reads (quotes, "test ..."): the lint must see the same.
        const readable = symbolsIn(cell);
        if (!changed && out.every((n) => symbols.includes(n)) && (readable.length !== out.length || readable.some((n, k) => n !== out[k]))) changed = true;
        if (changed) {
          r.cells[yi] = out.map((n) => `\`${n}\``).join(', ');
          note(r.line, `Test list Symbol "${clip(cell)}" → "${clip(r.cells[yi])}"`);
        }
      }
      if (ti >= 0 && files && r.cells[ti].trim()) {
        const cell = r.cells[ti];
        const id = cell.replace(/`/g, '').trim();
        const [path, ...rest] = id.split('::');
        const dir = path && path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
        const dirKnown = dir === '' || [...files, ...added].some((f) => f.startsWith(dir));
        if (path && !files.has(path) && !added.has(path) && !path.includes('*') && !dirKnown) {
          // The one folder of the repo that ends in this path's folder: an existing file there,
          // or the folder of a new one.
          const roots = new Set([...files, ...added].filter((f) => f.includes(`/${dir}`)).map((f) => f.slice(0, f.indexOf(`/${dir}`) + 1)));
          const known = [...roots].map((r) => `${r}${path}`);
          if (known.length === 1) {
            r.cells[ti] = `\`${[known[0], ...rest].join('::')}\``;
            note(r.line, `Test list Test ID "${clip(cell)}" → "${clip(r.cells[ti])}" (the path from the repo root)`);
          }
        }
      }
    }
    rewrite(lines, tests);
  }

  if (!changes.length) return { text, changes };
  return { text: withLog(lines, changes).join('\n'), changes };
}

const clip = (s, n = 80) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const codeSpans = (cell) => [...String(cell).matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);

// A Symbols cell the lint can't read: prose first (F19), or quoted names (F24). Returns the cell as
// code spans, or null when nothing is certain.
function symbolsCell(cell) {
  const t = cell.trim();
  if (!t || t.startsWith('`')) return null;
  // Prose, a colon, then code spans: the spans after the colon are the symbols. Prose with a code
  // span inside it ("render test using `composeStories`") is a name as it is.
  const colon = /:\s*((?:`[^`]+`\s*,?\s*(?:and\s+)?)+)\.?$/s.exec(t);
  if (colon) {
    const spans = codeSpans(colon[1]);
    if (spans.length) return spans.map((x) => `\`${x}\``).join(', ');
  }
  if (codeSpans(t).length) return null;
  const quoted = [...t.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).filter(Boolean);
  if (quoted.length) return quoted.map((x) => `\`${x}\``).join(', ');
  return null;
}

// The names a test row's Symbol cell gives: as the lint reads them, without quotes or a leading
// "test"/"tests".
function namesIn(cell) {
  const spans = codeSpans(cell);
  if (spans.length) return spans;
  const quoted = [...String(cell).matchAll(/"([^"]+)"/g)].map((m) => m[1].trim());
  if (quoted.length) return quoted;
  return symbolsIn(cell).map((n) => n.replace(/^tests?\s+/i, '').replace(/^["']|["']$/g, '').trim()).filter(Boolean);
}

// The one Code map symbol a name means: the same but for case, quotes or "test(s)", or the only
// symbol it starts at a word boundary. Null when none or more than one.
export function matchSymbol(name, symbols) {
  const n = name.replace(/^["'`]|["'`]$/g, '').replace(/^tests?\s+/i, '').trim();
  const lower = n.toLowerCase();
  const same = symbols.filter((s) => s.toLowerCase() === lower);
  if (same.length === 1) return same[0];
  const prefix = symbols.filter((s) => s.toLowerCase().startsWith(`${lower} `) || s.toLowerCase().startsWith(`${lower}(`));
  if (prefix.length === 1) return prefix[0];
  return null;
}

// The one GFM table in a "## <section>": its columns (lower-cased) and rows with their cells,
// split as the lint splits them (on unescaped pipes).
function tableAt(lines, section) {
  const start = lines.findIndex((l) => l.trim() === `## ${section}`);
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  let h = -1;
  for (let i = start + 1; i < end - 1; i++) {
    if (lines[i].includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      h = i;
      break;
    }
  }
  if (h < 0) return null;
  const columns = split(lines[h]).map((c) => c.replace(/`/g, '').toLowerCase());
  const rows = [];
  for (let i = h + 2; i < end && lines[i].trim() && lines[i].includes('|'); i++) {
    rows.push({ index: i, line: i + 1, cells: split(lines[i]), original: lines[i] });
  }
  return { columns, rows };
}

const split = (text) => text.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

function rewrite(lines, table) {
  for (const r of table.rows) {
    const line = `| ${r.cells.join(' | ')} |`;
    if (split(r.original).join('\u0000') !== r.cells.join('\u0000')) lines[r.index] = line;
  }
}

// The changes, one line each, at the end of "## Implementation log" (or a new one at the end).
function withLog(lines, changes) {
  const entries = changes.map((c) => `- MIRAI normalized (line ${c.line}): ${c.what}`);
  const at = lines.findIndex((l) => l.trim() === '## Implementation log');
  if (at < 0) return [...lines, '', '## Implementation log', '', ...entries, ''];
  let end = lines.findIndex((l, i) => i > at && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  let insert = end;
  while (insert > at + 1 && lines[insert - 1].trim() === '') insert--;
  return [...lines.slice(0, insert), ...(insert === at + 1 ? [''] : []), ...entries, ...lines.slice(insert)];
}
