import { parseToml } from './toml.js';

// A small line edit of one key in `[models]` or `[models.steps]` (unit 45b, Scope 4). MIRAI has a
// TOML parser and no writer, so `mirai models set` changes one line and keeps every comment and the
// order. The edit is checked by parsing the result: the key holds the new value (or is gone), and
// every other key is exactly as it was; anything else is refused and nothing is written.

const HEADER = /^\s*\[([^\]\n]+)\]\s*(?:#.*)?$/;
const quote = (v) => JSON.stringify(v);

// Every leaf of a parsed TOML value, as path → JSON.
function leaves(value, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) leaves(v, path, out);
    else out.set(path, JSON.stringify(v));
  }
  return out;
}

// setKey(text, { table, key, value }): the text with `table.key = "value"` (value null: the key
// removed). Returns { text, changed } or throws { code, message }.
export function setKey(text, { table, key, value, source = '.mirai/config.toml' }) {
  const fail = (message, code) => Object.assign(new Error(message), { code });
  let before;
  try {
    before = parseToml(text, { source });
  } catch (err) {
    throw fail(`${source} doesn't parse (${String(err.message).split('\n')[0]}); nothing was written`, 'config-parse');
  }
  const path = `${table}.${key}`;
  const lines = text.split('\n');
  // The table's lines: from its header to the next header.
  const start = lines.findIndex((l) => HEADER.exec(l)?.[1].trim() === table);
  let end = lines.length;
  if (start >= 0) for (let i = start + 1; i < lines.length; i++) if (HEADER.test(lines[i])) { end = i; break; }
  const keyLine = start >= 0 ? lines.slice(start + 1, end).findIndex((l) => new RegExp(`^\\s*"?${key.replace(/[-.]/g, '\\$&')}"?\\s*=`).test(l)) : -1;
  const at = keyLine >= 0 ? start + 1 + keyLine : -1;
  const old = leaves(before).get(path);
  if (old !== undefined && at < 0) throw fail(`${path} is written in a form MIRAI can't change line by line (a dotted key or an inline table); change it by hand, then commit it`, 'config-form');
  if (value === null) {
    if (at < 0) return { text, changed: false };
    lines.splice(at, 1);
  } else if (at >= 0) {
    const comment = /\s+#.*$/.exec(lines[at].replace(/"(?:[^"\\]|\\.)*"/g, '""'))?.[0] ?? '';
    lines[at] = `${/^\s*/.exec(lines[at])[0]}${key} = ${quote(value)}${comment}`;
  } else if (start >= 0) {
    // After the table's last key line (blank lines and comments after it stay below).
    let last = start;
    for (let i = start + 1; i < end; i++) if (/^\s*[A-Za-z0-9_"-]+\s*=/.test(lines[i])) last = i;
    lines.splice(last + 1, 0, `${key} = ${quote(value)}`);
  } else {
    while (lines.length && lines.at(-1) === '') lines.pop();
    lines.push('', `[${table}]`, `${key} = ${quote(value)}`, '');
  }
  const out = lines.join('\n');
  let after;
  try {
    after = parseToml(out, { source });
  } catch (err) {
    throw fail(`the change would leave ${source} unreadable (${String(err.message).split('\n')[0]}); nothing was written`, 'config-edit');
  }
  const a = leaves(after);
  const b = leaves(before);
  const others = [...new Set([...a.keys(), ...b.keys()])].filter((p) => p !== path && a.get(p) !== b.get(p));
  if (others.length || (value === null ? a.has(path) : a.get(path) !== JSON.stringify(value))) {
    throw fail(`the change would touch more than ${path} (${others.slice(0, 3).join(', ') || path}); nothing was written`, 'config-edit');
  }
  return { text: out, changed: out !== text };
}
