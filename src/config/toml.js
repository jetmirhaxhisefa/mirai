import { ConfigError } from '../cli/errors.js';

// The TOML subset reader (unit 03a). The grammar is in TOML-SUBSET.md next to this file.
// Everything accepted here is valid TOML 1.0 with the same meaning; features outside the
// subset are rejected with a hint, never guessed.

export const LIMITS = Object.freeze({
  bytes: 256 * 1024,
  depth: 16,
  stringLength: 16 * 1024, // UTF-16 code units
  keys: 10_000,
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const BARE_KEY_CHAR = /[A-Za-z0-9_-]/;
const VALUE_END = /[ \t\r\n#,\]}]/;
const INTEGER = /^[+-]?(?:0|[1-9](?:_?[0-9])*)$/;
const FLOAT = /^[+-]?(?:0|[1-9](?:_?[0-9])*)\.[0-9](?:_?[0-9])*$/;

// Parses TOML text (a string, or bytes that must be UTF-8) into plain data. Tables are
// objects without a prototype.
// - `positions: true` returns `{ value, positions }`: a Map from key path (`git.branch`,
//   `repos[0].name`, `checks[1]`) to `{ line, column, type }` of where it is defined, so later
//   checks can point at the right place. `type` keeps integer and float apart.
// - `tagged: true` returns leaves as `{ type, value }`, the toml-test form (conformance tests).
export function parseToml(input, { source = '<input>', positions = false, tagged = false } = {}) {
  const text = decode(input, source);
  const parser = new Parser(text, source, { positions, tagged });
  const value = parser.parse();
  return positions ? { value, positions: parser.positions } : value;
}

function decode(input, source) {
  let text;
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > LIMITS.bytes) throw tooLarge(source);
    if (!input.isWellFormed()) {
      throw positioned(input, input.search(/\p{Surrogate}/u), source, 'text contains an unpaired surrogate');
    }
    text = input;
  } else if (input instanceof Uint8Array) {
    if (input.length > LIMITS.bytes) throw tooLarge(source);
    const bad = firstInvalidUtf8(input);
    if (bad !== -1) {
      const prefix = new TextDecoder('utf-8').decode(input.subarray(0, bad));
      throw positioned(prefix, prefix.length, source, 'file is not valid UTF-8');
    }
    text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(input);
  } else {
    throw new TypeError('parseToml expects a string or bytes');
  }
  return text.startsWith('﻿') ? text.slice(1) : text;
}

function tooLarge(source) {
  return new ConfigError(`${source}: file is larger than ${LIMITS.bytes} bytes`, {
    source,
    reason: `file is larger than ${LIMITS.bytes} bytes`,
  });
}

// Byte offset of the first invalid UTF-8 sequence, or -1. Rejects overlong forms,
// surrogates and code points above U+10FFFF, as TOML requires.
function firstInvalidUtf8(bytes) {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) { i += 1; continue; }
    let need;
    let min;
    if (b >= 0xc2 && b <= 0xdf) { need = 1; min = 0x80; }
    else if (b >= 0xe0 && b <= 0xef) { need = 2; min = 0x800; }
    else if (b >= 0xf0 && b <= 0xf4) { need = 3; min = 0x10000; }
    else return i;
    let cp = b & (0xff >> (need + 2));
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return i;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return i;
    i += need + 1;
  }
  return -1;
}

function lineAndColumn(text, at) {
  const before = text.slice(0, at);
  const line = before.split('\n').length;
  const lineStart = before.lastIndexOf('\n') + 1;
  return { line, column: [...text.slice(lineStart, at)].length + 1 };
}

function positioned(text, at, source, reason, hint) {
  const { line, column } = lineAndColumn(text, at);
  return new ConfigError(`${source}:${line}:${column}: ${reason}`, { source, line, column, reason, hint });
}

const typeOf = (value) => (Array.isArray(value) ? 'array' : typeof value === 'object' ? 'table' : typeof value);

class Parser {
  constructor(text, source, { positions, tagged }) {
    this.text = text;
    this.source = source;
    this.tagged = tagged;
    this.positions = positions ? new Map() : null;
    this.i = 0;
    this.keys = 0;
    this.kind = new WeakMap(); // table -> 'implicit' | 'explicit' | 'inline'
    this.arraysOfTables = new WeakSet();
    this.root = this.newTable('explicit');
    this.current = this.root;
    this.currentPath = '';
    this.currentDepth = 0;
    if (positions) this.indexLines();
  }

  fail(reason, at = this.i, hint) {
    throw positioned(this.text, at, this.source, reason, hint);
  }

  // Line starts and a running count of low surrogates, so positions are O(log n) each.
  indexLines() {
    const { text } = this;
    this.lineStarts = [0];
    this.lowSurrogates = new Uint32Array(text.length + 1);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      this.lowSurrogates[i + 1] = this.lowSurrogates[i] + (code >= 0xdc00 && code <= 0xdfff ? 1 : 0);
      if (code === 0x0a) this.lineStarts.push(i + 1);
    }
  }

  record(path, at, type) {
    if (!this.positions) return;
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    const start = this.lineStarts[lo];
    const column = at - start - (this.lowSurrogates[at] - this.lowSurrogates[start]) + 1;
    this.positions.set(path, { line: lo + 1, column, type });
  }

  newTable(kind) {
    const table = Object.create(null);
    this.kind.set(table, kind);
    return table;
  }

  isTable(value) {
    return this.kind.has(value);
  }

  parse() {
    this.checkControlCharacters();
    const { text } = this;
    while (this.i < text.length) {
      this.skipWhitespace();
      const c = text[this.i];
      if (c === undefined) break;
      if (c === '\n' || c === '\r') { this.newline(); continue; }
      if (c === '#') { this.skipComment(); continue; }
      if (c === '[') this.header();
      else this.keyValue(this.current, this.currentDepth, this.currentPath);
      this.endOfLine();
    }
    return this.root;
  }

  // TOML forbids raw control characters everywhere, except tab and CRLF line endings.
  checkControlCharacters() {
    const { text } = this;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 0x09 || code === 0x0a) continue;
      if (code === 0x0d && text[i + 1] === '\n') continue;
      if (code < 0x20 || code === 0x7f) {
        const name = code === 0x0d ? 'a carriage return not followed by a line feed' : `control character U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
        this.fail(`${name} is not allowed`, i);
      }
    }
  }

  skipWhitespace() {
    const { text } = this;
    while (text[this.i] === ' ' || text[this.i] === '\t') this.i += 1;
  }

  skipComment() {
    const { text } = this;
    while (this.i < text.length && text[this.i] !== '\n' && text[this.i] !== '\r') this.i += 1;
  }

  newline() {
    if (this.text[this.i] === '\r') this.i += 1;
    this.i += 1;
  }

  // Whitespace, comments and newlines, as allowed between array elements.
  skipBlank() {
    for (;;) {
      this.skipWhitespace();
      const c = this.text[this.i];
      if (c === '#') this.skipComment();
      else if (c === '\n' || c === '\r') this.newline();
      else return;
    }
  }

  endOfLine() {
    this.skipWhitespace();
    if (this.text[this.i] === '#') this.skipComment();
    const c = this.text[this.i];
    if (c === undefined) return;
    if (c === '\n' || c === '\r') { this.newline(); return; }
    this.fail('expected the end of the line', this.i, 'one key or table per line');
  }

  bareKey() {
    const { text } = this;
    const start = this.i;
    const c = text[start];
    if (c === '"' || c === "'") {
      this.fail('quoted keys are not supported', start, 'use a bare key: letters, digits, "_" and "-"');
    }
    while (this.i < text.length && BARE_KEY_CHAR.test(text[this.i])) this.i += 1;
    if (this.i === start) this.fail('expected a key', start);
    const key = text.slice(start, this.i);
    if (FORBIDDEN_KEYS.has(key)) this.fail(`the key "${key}" is not allowed`, start);
    this.keys += 1;
    if (this.keys > LIMITS.keys) this.fail(`more than ${LIMITS.keys} keys`, start);
    return key;
  }

  header() {
    const { text } = this;
    const start = this.i;
    const isArray = text[start + 1] === '[';
    this.i += isArray ? 2 : 1;
    const parts = [];
    for (;;) {
      this.skipWhitespace();
      parts.push(this.bareKey());
      this.skipWhitespace();
      if (text[this.i] !== '.') break;
      this.i += 1;
    }
    if (text[this.i] !== ']') this.fail('expected "]" to close the table header');
    this.i += 1;
    if (isArray) {
      if (text[this.i] !== ']') this.fail('expected "]]" to close the array-of-tables header');
      this.i += 1;
    }
    if (parts.length > LIMITS.depth) this.fail(`tables are nested deeper than ${LIMITS.depth}`, start);
    const name = parts.join('.');

    let table = this.root;
    let path = '';
    for (const part of parts.slice(0, -1)) [table, path] = this.descend(table, part, path, name, start);
    const last = parts.at(-1);
    path = path ? `${path}.${last}` : last;
    const existing = table[last];

    if (isArray) {
      if (existing === undefined) {
        const list = [];
        this.arraysOfTables.add(list);
        table[last] = list;
        this.record(path, start, 'array');
      } else if (!this.arraysOfTables.has(existing)) {
        this.fail(`"${name}" is already defined and is not an array of tables`, start);
      }
      const element = this.newTable('explicit');
      table[last].push(element);
      path = `${path}[${table[last].length - 1}]`;
      this.current = element;
    } else {
      if (existing === undefined) {
        table[last] = this.newTable('explicit');
      } else if (this.isTable(existing) && this.kind.get(existing) === 'implicit') {
        this.kind.set(existing, 'explicit');
      } else {
        this.fail(`"${name}" is already defined`, start);
      }
      this.current = table[last];
    }
    this.record(path, start, 'table');
    this.currentPath = path;
    this.currentDepth = parts.length;
  }

  // Walks into a table on a header path, creating it if needed. Inline tables and plain
  // arrays are closed: a header can't extend them.
  descend(table, part, path, name, at) {
    const next = path ? `${path}.${part}` : part;
    if (table[part] === undefined) {
      table[part] = this.newTable('implicit');
      this.record(next, at, 'table');
    }
    const value = table[part];
    if (this.arraysOfTables.has(value)) return [value.at(-1), `${next}[${value.length - 1}]`];
    if (this.isTable(value) && this.kind.get(value) !== 'inline') return [value, next];
    return this.fail(`"${name}" can't be defined: "${part}" is already a value`, at);
  }

  keyValue(table, depth, basePath) {
    const start = this.i;
    const key = this.bareKey();
    this.skipWhitespace();
    if (this.text[this.i] === '.') {
      const rest = /^\.[ \t]*([A-Za-z0-9_-]+)/.exec(this.text.slice(this.i, this.i + 200));
      const tableName = basePath && !basePath.includes('[') ? `${basePath}.${key}` : key;
      const hint = rest ? `use a [${tableName}] table, then ${rest[1]} = …` : 'use a [table] header';
      this.fail('dotted keys are not supported', start, hint);
    }
    if (this.text[this.i] !== '=') this.fail('expected "=" after the key');
    this.i += 1;
    this.skipWhitespace();
    const path = basePath ? `${basePath}.${key}` : key;
    const value = this.value(depth, path);
    if (key in table) this.fail(`"${key}" is already defined`, start);
    table[key] = value;
    this.recordValue(path, start, value);
  }

  recordValue(path, at, value) {
    if (!this.positions) return;
    let type = typeOf(value);
    if (this.tagged && type === 'table' && typeof value.type === 'string' && 'value' in value) type = value.type;
    if (type === 'number') type = this.lastNumberType;
    this.record(path, at, type);
  }

  value(depth, path) {
    if (depth > LIMITS.depth) this.fail(`values are nested deeper than ${LIMITS.depth}`);
    const { text } = this;
    const c = text[this.i];
    if (c === '"') {
      if (text.startsWith('"""', this.i)) this.fail('multi-line strings are not supported', this.i, 'use "\\n" in a one-line string');
      return this.leaf('string', this.basicString());
    }
    if (c === "'") {
      if (text.startsWith("'''", this.i)) this.fail('multi-line strings are not supported', this.i, 'use "\\n" in a one-line string');
      return this.leaf('string', this.literalString());
    }
    if (c === '[') return this.array(depth + 1, path);
    if (c === '{') return this.inlineTable(depth + 1, path);
    if (c === 't' || c === 'f') return this.boolean();
    if (c !== undefined && /[0-9+-]/.test(c)) return this.number();
    if ((c === 'i' || c === 'n') && /^(inf|nan)(?![A-Za-z0-9_-])/.test(text.slice(this.i, this.i + 4))) {
      this.fail('inf and nan are not supported', this.i);
    }
    if (c === undefined || c === '\n' || c === '\r' || c === '#') return this.fail('expected a value');
    return this.fail('invalid value', this.i, 'strings need quotes');
  }

  leaf(type, value) {
    if (!this.tagged) return value;
    return { type, value: type === 'string' ? value : Object.is(value, -0) ? '-0' : String(value) };
  }

  checkValueEnd() {
    const c = this.text[this.i];
    if (c !== undefined && !VALUE_END.test(c)) this.fail('invalid value');
  }

  boolean() {
    const { text } = this;
    for (const word of ['true', 'false']) {
      if (text.startsWith(word, this.i)) {
        const start = this.i;
        this.i += word.length;
        if (this.text[this.i] !== undefined && !VALUE_END.test(this.text[this.i])) this.fail('invalid value', start, 'strings need quotes');
        return this.leaf('bool', word === 'true');
      }
    }
    return this.fail('invalid value', this.i, 'strings need quotes');
  }

  number() {
    const { text } = this;
    const start = this.i;
    while (this.i < text.length && /[0-9A-Za-z_.:+-]/.test(text[this.i])) this.i += 1;
    const token = text.slice(start, this.i);
    if (/^[+-]?(inf|nan)$/.test(token)) this.fail('inf and nan are not supported', start);
    if (/^[+-]?0[xobXOB]/.test(token)) this.fail('hexadecimal, octal and binary numbers are not supported', start, 'write the number in decimal');
    if (/^\d{2}:/.test(token)) this.fail('dates and times are not supported', start, 'write the time as a string, for example "06:30"');
    if (/^\d{4}-/.test(token)) this.fail('dates and times are not supported', start, 'write the date as a string, for example "2026-10-23"');
    if (/^[+-]?[0-9_.]+[eE]/.test(token)) this.fail('exponents are not supported', start, 'write the number in full');
    if (INTEGER.test(token)) {
      this.checkValueEnd();
      let n = Number(token.replaceAll('_', ''));
      if (!Number.isSafeInteger(n)) this.fail('integer out of range', start, `MIRAI supports ±${Number.MAX_SAFE_INTEGER}`);
      if (Object.is(n, -0)) n = 0;
      this.lastNumberType = 'integer';
      return this.leaf('integer', n);
    }
    if (FLOAT.test(token)) {
      this.checkValueEnd();
      const n = Number(token.replaceAll('_', ''));
      if (!Number.isFinite(n)) this.fail('float out of range', start);
      this.lastNumberType = 'float';
      return this.leaf('float', n);
    }
    return this.fail('invalid number', start);
  }

  basicString() {
    const { text } = this;
    const start = this.i;
    this.i += 1;
    let out = '';
    for (;;) {
      const c = text[this.i];
      if (c === undefined || c === '\n' || c === '\r') this.fail('unterminated string', start, 'strings must close on the same line');
      if (c === '"') { this.i += 1; break; }
      if (c === '\\') out += this.escape();
      else { out += c; this.i += 1; }
      if (out.length > LIMITS.stringLength) this.fail(`string longer than ${LIMITS.stringLength} UTF-16 code units`, start);
    }
    this.checkValueEnd();
    return out;
  }

  escape() {
    const { text } = this;
    const at = this.i;
    const e = text[at + 1];
    const simple = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
    if (e in simple) { this.i += 2; return simple[e]; }
    if (e === 'u' || e === 'U') {
      const len = e === 'u' ? 4 : 8;
      const hex = text.slice(at + 2, at + 2 + len);
      if (!new RegExp(`^[0-9A-Fa-f]{${len}}$`).test(hex)) this.fail(`"\\${e}" needs ${len} hex digits`, at);
      const cp = parseInt(hex, 16);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) this.fail(`"\\${e}${hex}" is not a Unicode scalar value`, at);
      this.i += 2 + len;
      return String.fromCodePoint(cp);
    }
    return this.fail('invalid escape', at, 'use \\b \\t \\n \\f \\r \\" \\\\ \\uXXXX or \\UXXXXXXXX');
  }

  literalString() {
    const { text } = this;
    const start = this.i;
    const end = text.indexOf("'", start + 1);
    const nl = text.slice(start + 1, end === -1 ? undefined : end).search(/[\r\n]/);
    if (end === -1 || nl !== -1) this.fail('unterminated string', start, 'strings must close on the same line');
    const out = text.slice(start + 1, end);
    if (out.length > LIMITS.stringLength) this.fail(`string longer than ${LIMITS.stringLength} UTF-16 code units`, start);
    this.i = end + 1;
    this.checkValueEnd();
    return out;
  }

  array(depth, path) {
    if (depth > LIMITS.depth) this.fail(`values are nested deeper than ${LIMITS.depth}`);
    const start = this.i;
    this.i += 1;
    const out = [];
    for (;;) {
      this.skipBlank();
      const c = this.text[this.i];
      if (c === undefined) this.fail('unterminated array', start);
      if (c === ']') { this.i += 1; break; }
      const at = this.i;
      const itemPath = `${path}[${out.length}]`;
      const item = this.value(depth, itemPath);
      out.push(item);
      this.recordValue(itemPath, at, item);
      this.skipBlank();
      const next = this.text[this.i];
      if (next === ',') { this.i += 1; continue; }
      if (next === ']') { this.i += 1; break; }
      if (next === undefined) this.fail('unterminated array', start);
      this.fail('expected "," or "]" in the array');
    }
    return out;
  }

  inlineTable(depth, path) {
    if (depth > LIMITS.depth) this.fail(`values are nested deeper than ${LIMITS.depth}`);
    const start = this.i;
    this.i += 1;
    const table = this.newTable('inline');
    const oneLine = () => {
      const c = this.text[this.i];
      if (c === '\n' || c === '\r') this.fail('inline tables must stay on one line', this.i, 'use a [table] header');
      if (c === undefined) this.fail('unterminated inline table', start);
    };
    this.skipWhitespace();
    oneLine();
    if (this.text[this.i] === '}') { this.i += 1; return table; }
    for (;;) {
      this.skipWhitespace();
      oneLine();
      this.keyValue(table, depth, path);
      this.skipWhitespace();
      oneLine();
      const c = this.text[this.i];
      if (c === '}') { this.i += 1; return table; }
      if (c !== ',') this.fail('expected "," or "}" in the inline table');
      this.i += 1;
      this.skipWhitespace();
      if (this.text[this.i] === '}') this.fail('trailing comma in an inline table', this.i);
    }
  }
}
