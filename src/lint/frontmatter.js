import { ConfigError } from '../cli/errors.js';
import { firstInvalidUtf8 } from '../util/utf8.js';

// The YAML frontmatter reader (unit 07a). The grammar is in YAML-SUBSET.md next to this file.
// Everything accepted here is valid YAML 1.2 with the same meaning, and reads the same in
// YAML 1.1 tools (PyYAML, js-yaml); anything else is refused with a code and a hint, never
// guessed.

export const LIMITS = Object.freeze({
  bytes: 16 * 1024,
});

const KEY = /^[a-z][a-z0-9_]*$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const INTEGER = /^-?(?:0|[1-9][0-9]*)$/;

// Plain words some YAML tool reads as something other than the string we'd return: YAML 1.1
// booleans, its value and merge keys (= and <<), YAML 1.2 core spellings we don't accept,
// dates and timestamps (YAML 1.1 types), and anything number-like that isn't a plain decimal
// integer (floats, exponents, 0x/0o/0b, leading zeros, a sign, `_`, sexagesimal 1:30, .inf,
// .nan). test/lint/frontmatter.test.js T7 checks this against the YAML type patterns.
const AMBIGUOUS_WORD = /^(?:y|yes|n|no|on|off|=|<<)$/i;
const AMBIGUOUS_CORE = /^(?:True|TRUE|False|FALSE|Null|NULL|~)$/;
const TIMESTAMP = /^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:$|[Tt ])/;
const AMBIGUOUS_NUMBER = [
  /^[-+]?[0-9._:]+(?:[eE][-+]?[0-9]+)?$/,
  /^[-+]?\.(?:inf|nan)$/i,
  /^[-+]?0[xob]/i,
];
// Keys a YAML tool reads as a boolean or null (`on:` is True in PyYAML).
const AMBIGUOUS_KEY = /^(?:y|yes|n|no|on|off|true|false|null)$/;

// First characters a plain string may not start with (YAML indicators). `-` followed by a
// digit is allowed, for negative integers.
const INDICATOR = new Set(['-', '?', ':', ',', '[', ']', '{', '}', '#', '&', '*', '!', '|', '>', "'", '"', '%', '@', '`']);
const ESCAPES = { '"': '"', '\\': '\\', n: '\n', t: '\t' };
const PROPERTY_HINT = "anchors, aliases and tags aren't supported; quote the value if it's text";

// Finds the frontmatter at the top of a Markdown document and reads it.
// - `input` is a string or UTF-8 bytes; bytes that aren't valid UTF-8 are refused with a
//   position, so MIRAI never reads a value strict tools would refuse.
// - Returns null when the first line isn't `---`, else `{ value, positions?, bodyLine, body }`:
//   `bodyLine` is the 1-based line where the text after the closing `---` starts.
export function readFrontmatter(input, { source = '<input>', positions = false } = {}) {
  const text = decode(input, source);
  const doc = text.startsWith('﻿') ? text.slice(1) : text;
  const first = /^---\r?(?:\n|$)/.exec(doc);
  if (!first) return null;
  let at = first[0].length;
  let line = 2;
  let nearMiss = null;
  while (at <= doc.length) {
    // UTF-16 units never outnumber UTF-8 bytes, so this bound is safe and stops a huge
    // frontmatter before it's copied.
    if (at - first[0].length > LIMITS.bytes) throw tooLarge(source);
    const nl = doc.indexOf('\n', at);
    const end = nl === -1 ? doc.length : nl;
    const content = doc.slice(at, end);
    if (content === '---' || content === '---\r') {
      const yaml = doc.slice(first[0].length, at);
      const parsed = parseYamlSubset(yaml, { source, positions, firstLine: 2 });
      const bodyStart = nl === -1 ? doc.length : nl + 1;
      return {
        ...(positions ? parsed : { value: parsed }),
        bodyLine: line + 1,
        body: doc.slice(bodyStart),
      };
    }
    if (nearMiss === null && /^(?:---|\.\.\.)[ \t]*\r?$/.test(content)) nearMiss = line;
    if (nl === -1) break;
    at = nl + 1;
    line += 1;
  }
  if (nearMiss !== null) {
    throw new ConfigError(`${source}:${nearMiss}:1: the frontmatter isn't closed`, {
      source, line: nearMiss, column: 1, code: 'unclosed',
      reason: "the frontmatter isn't closed",
      hint: 'the closing line must be exactly ---, with nothing after it',
    });
  }
  throw new ConfigError(`${source}:1:1: the frontmatter isn't closed`, {
    source, line: 1, column: 1, code: 'unclosed',
    reason: "the frontmatter isn't closed",
    hint: 'end it with a line that is exactly ---',
  });
}

function decode(input, source) {
  if (typeof input === 'string') return input;
  if (!(input instanceof Uint8Array)) throw new TypeError('readFrontmatter expects a string or bytes');
  const bad = firstInvalidUtf8(input);
  if (bad !== -1) {
    const before = new TextDecoder('utf-8').decode(input.subarray(0, bad));
    const line = before.split('\n').length;
    const column = [...before.slice(before.lastIndexOf('\n') + 1)].length + 1;
    return failAt(source, line, column, 'encoding', 'the file is not valid UTF-8');
  }
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(input);
}

function failAt(source, line, column, code, reason, hint) {
  throw new ConfigError(`${source}:${line}:${column}: ${reason}`, { source, line, column, code, reason, hint });
}

function tooLarge(source) {
  return new ConfigError(`${source}:2:1: the frontmatter is larger than ${LIMITS.bytes} bytes`, {
    source, line: 2, column: 1, code: 'too-large',
    reason: `the frontmatter is larger than ${LIMITS.bytes} bytes`,
    hint: 'move long text into the document body',
  });
}

// Reads YAML text in the subset into a mapping without a prototype.
// - `positions: true` returns `{ value, positions }`: a Map from `key` or `key[n]` to
//   `{ line, column }`, 1-based; a key's entry also has `valueColumn` when the value is on
//   its line;
// - `firstLine` is the file line of the text's first line (2 for frontmatter after `---`).
// Errors carry the key as `path` once the key is known.
export function parseYamlSubset(text, { source = '<input>', positions = false, firstLine = 1 } = {}) {
  if (typeof text !== 'string') throw new TypeError('parseYamlSubset expects a string');
  const parser = new Parser(text, source, firstLine, positions);
  const value = parser.parse();
  return positions ? { value, positions: parser.positions } : value;
}

class Parser {
  constructor(text, source, firstLine, positions) {
    this.text = text;
    this.source = source;
    this.firstLine = firstLine;
    this.positions = positions ? new Map() : null;
    this.root = Object.create(null);
    this.pending = null; // { key, items } after `key:` with nothing after it
    this.lineNo = firstLine;
    this.line = '';
    this.path = undefined;
    this.lowSurrogates = null; // per line, only when it has characters above U+FFFF
  }

  // Columns count characters, not UTF-16 units. Lines without surrogates (nearly all) take the
  // fast path; others get a running count once per line, so positions stay linear.
  column(index) {
    if (!this.lowSurrogates) return index + 1;
    return index - this.lowSurrogates[index] + 1;
  }

  fail(code, reason, index = 0, hint) {
    const line = this.lineNo;
    const column = this.column(index);
    return new ConfigError(`${this.source}:${line}:${column}: ${reason}`, {
      source: this.source, line, column, code, reason, hint, path: this.path,
    });
  }

  record(path, index, extra) {
    if (this.positions) this.positions.set(path, { line: this.lineNo, column: this.column(index), ...extra });
  }

  parse() {
    const { text } = this;
    if (Buffer.byteLength(text, 'utf8') > LIMITS.bytes) {
      throw this.fail('too-large', `the frontmatter is larger than ${LIMITS.bytes} bytes`, 0, 'move long text into the document body');
    }
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    for (let i = 0; i < lines.length; i++) {
      this.lineNo = this.firstLine + i;
      let line = lines[i];
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.line = line;
      this.path = undefined;
      this.lowSurrogates = null;
      this.checkCharacters();
      this.parseLine();
    }
    return this.root;
  }

  // Tabs, control characters (C0, DEL, C1), invisible characters (isInvisible) and unpaired
  // surrogates are refused everywhere, inside quotes too.
  checkCharacters() {
    const { line } = this;
    for (let i = 0; i < line.length; i++) {
      const code = line.charCodeAt(i);
      if (code === 0x09) throw this.fail('tab', 'tabs are not allowed', i, 'use spaces, or \\t in a double-quoted string');
      if (code >= 0xd800 && code <= 0xdfff) {
        const pair = code <= 0xdbff && i + 1 < line.length && (line.charCodeAt(i + 1) & 0xfc00) === 0xdc00;
        if (!pair) throw this.fail('control', 'the text contains an unpaired surrogate', i);
        if (!this.lowSurrogates) this.countSurrogates();
        if (isInvisible(line.codePointAt(i))) throw this.fail('control', `the character U+${hex4(line.codePointAt(i))} is not allowed`, i, 'it is invisible; remove it');
        i += 1;
        continue;
      }
      if (isControl(code) || isInvisible(code)) {
        const name = code === 0x0d ? 'a carriage return not followed by a line feed' : `the character U+${hex4(code)}`;
        throw this.fail('control', `${name} is not allowed`, i, isControl(code) ? undefined : 'it is invisible; remove it');
      }
    }
  }

  countSurrogates() {
    const { line } = this;
    this.lowSurrogates = new Uint32Array(line.length + 1);
    for (let i = 0; i < line.length; i++) {
      const low = (line.charCodeAt(i) & 0xfc00) === 0xdc00 ? 1 : 0;
      this.lowSurrogates[i + 1] = this.lowSurrogates[i] + low;
    }
  }

  parseLine() {
    const { line } = this;
    if (/^ *$/.test(line) || /^ *#/.test(line)) return;
    if (line[0] === ' ') return this.indentedLine();
    if (line === '-' || line.startsWith('- ')) {
      if (this.pending) throw this.fail('indent', 'list items must be indented', 0, 'indent list items by two spaces');
      throw this.fail('list', 'a list item has no key above it', 0, 'put the list under a key with nothing after its colon');
    }
    this.pending = null;
    return this.keyLine();
  }

  indentedLine() {
    const { line } = this;
    // Only spaces indent in YAML; a no-break space after them is content, so it lands in
    // `continuation` below rather than looking like a list item.
    const indent = /^ */.exec(line)[0].length;
    const rest = line.slice(indent);
    if (rest === '-' || rest.startsWith('- ')) return this.listItem(indent);
    if (/^[^#'"][^#]*?:(?: |$)/.test(rest)) {
      throw this.fail('nested', 'nested mappings are not supported', indent, "nested mappings aren't supported; keep every key at the start of the line");
    }
    throw this.fail('continuation', 'a value continues on this line', indent, 'keep the value on one line');
  }

  listItem(indent) {
    const { line } = this;
    if (!this.pending) throw this.fail('list', 'a list item must follow a key with nothing after its colon', indent);
    const { key } = this.pending;
    this.path = key;
    if (indent !== 2) throw this.fail('indent', 'list items are indented by exactly two spaces', 0, 'indent list items by two spaces');
    const start = indent + 2;
    if (line[start - 1] !== ' ' || /^ *(?:#.*)?$/.test(line.slice(start))) {
      throw this.fail('list', 'a list item is empty', indent, 'write a value after "- ", or remove the line');
    }
    if (line[start] === ' ') throw this.fail('indent', 'use one space after "-"', start, 'write "  - value"');
    const items = this.pending.items ?? (this.pending.items = this.root[key] = []);
    this.path = `${key}[${items.length}]`;
    const { value, end } = this.scalar(start, 'item');
    this.endOfLine(end);
    this.record(this.path, start);
    items.push(value);
  }

  keyLine() {
    const { line } = this;
    const c = line[0];
    if (c === '%') throw this.fail('directive', 'YAML directives are not supported', 0);
    if (/^(?:---|\.\.\.)(?: |$)/.test(line)) throw this.fail('document', 'only one YAML document is allowed', 0, 'the frontmatter ends at the next ---');
    if (c === '&') throw this.fail('anchor', 'anchors are not supported', 0, PROPERTY_HINT);
    if (c === '*') throw this.fail('alias', 'aliases are not supported', 0, PROPERTY_HINT);
    if (c === '!') throw this.fail('tag', 'tags are not supported', 0, PROPERTY_HINT);
    const keyHint = 'keys are a–z, 0–9 and _, starting with a letter';
    if (c === '?' && (line.length === 1 || line[1] === ' ')) throw this.fail('key', 'complex keys are not supported', 0, keyHint);
    if (c === '"' || c === "'") throw this.fail('key', 'quoted keys are not supported', 0, keyHint);
    const colon = line.search(/:(?: |$)/);
    if (colon === -1) {
      const hint = line.includes(':') ? 'put a space after the colon' : 'write key: value';
      throw this.fail('syntax', 'expected "key: value"', 0, hint);
    }
    const key = line.slice(0, colon);
    if (key.endsWith(' ')) throw this.fail('key', 'a space before the colon', key.trimEnd().length, 'write key: value');
    if (!KEY.test(key)) throw this.fail('key', 'the key is not a plain lower-case key', 0, keyHint);
    if (AMBIGUOUS_KEY.test(key)) throw this.fail('key', `the key "${key}" is a boolean or null in some YAML tools`, 0, 'use another key name');
    if (FORBIDDEN_KEYS.has(key)) throw this.fail('forbidden-key', `the key "${key}" is not allowed`, 0);
    if (key in this.root) throw this.fail('duplicate', `"${key}" is already defined`, 0);
    this.path = key;

    let i = colon + 1;
    while (line[i] === ' ') i += 1;
    if (i === line.length || (line[i] === '#' && i > colon + 1)) {
      this.record(key, 0);
      this.root[key] = null;
      this.pending = { key, items: null };
      return;
    }
    this.record(key, 0, { valueColumn: this.column(i) });
    const { value, end } = line[i] === '[' ? this.flowList(i, key) : this.scalar(i, 'block');
    this.endOfLine(end);
    this.root[key] = value;
  }

  // After a value: spaces, then nothing or a comment that follows a space.
  endOfLine(end) {
    const { line } = this;
    let i = end;
    while (line[i] === ' ') i += 1;
    if (i === line.length) return;
    if (line[i] === '#' && i > end) return;
    throw this.fail('syntax', 'unexpected text after the value', i, 'one value per key; quote text that has ": " or " #" in it');
  }

  flowList(start, key) {
    const { line } = this;
    const out = [];
    let i = start + 1;
    const skip = () => { while (line[i] === ' ') i += 1; };
    const unclosed = () => this.fail('syntax', "the list isn't closed on this line", start, 'keep the list on one line, or use a block list');
    skip();
    if (line[i] === ']') return { value: out, end: i + 1 };
    for (;;) {
      skip();
      if (i >= line.length) throw unclosed();
      if (line[i] === ',') throw this.fail('list', 'a list item is empty', i);
      if (line[i] === ']') throw this.fail('list', 'a trailing comma in a list', i, 'remove the last comma');
      const at = i;
      this.path = `${key}[${out.length}]`;
      const { value, end } = this.scalar(i, 'flow');
      this.record(this.path, at);
      out.push(value);
      i = end;
      skip();
      if (line[i] === ',') { i += 1; continue; }
      if (line[i] === ']') { this.path = key; return { value: out, end: i + 1 }; }
      if (line[i] === '#') throw this.fail('syntax', 'comments are not allowed inside a list', i);
      if (i >= line.length) throw unclosed();
      throw this.fail('syntax', 'expected "," or "]" in the list', i);
    }
  }

  // One scalar starting at `start`, in a `block` value, a block list `item` or a `flow` list.
  // (A `[` in a block value never gets here: keyLine reads it as a flow list.)
  scalar(start, context) {
    const { line } = this;
    const c = line[start];
    if (c === '"') return this.doubleQuoted(start);
    if (c === "'") return this.singleQuoted(start);
    if (c === '[') throw this.fail('list', 'nested lists are not supported', start);
    if (c === '{') throw this.fail('flow-mapping', 'mappings in braces are not supported', start, "nested mappings aren't supported");
    if (c === '&') throw this.fail('anchor', 'anchors are not supported', start, PROPERTY_HINT);
    if (c === '*') throw this.fail('alias', 'aliases are not supported', start, PROPERTY_HINT);
    if (c === '!') throw this.fail('tag', 'tags are not supported', start, PROPERTY_HINT);
    if (c === '|' || c === '>') throw this.fail('block-scalar', 'block scalars (| and >) are not supported', start, 'use one line with \\n in a double-quoted string');
    if (c === '-' && (line[start + 1] === ' ' || start + 1 === line.length)) {
      if (context === 'block') throw this.fail('list', 'a list on the same line as its key', start, 'put each item on its own "  - " line');
      throw this.fail('list', 'nested lists are not supported', start);
    }
    return this.plain(start, context);
  }

  plain(start, context) {
    const { line } = this;
    const stops = context === 'flow' ? ',[]{}' : '';
    let end = start;
    while (end < line.length && !stops.includes(line[end]) && !(line[end] === '#' && line[end - 1] === ' ')) end += 1;
    // Only spaces end a plain value; other whitespace is content, as in YAML.
    const value = line.slice(start, end).replace(/ +$/, '');
    if (value === '') throw this.fail('syntax', 'expected a value', start);
    const c = value[0];
    if (INDICATOR.has(c) && !/^-[0-9]/.test(value)) {
      throw this.fail('syntax', `a plain value can't start with "${c}"`, start, 'quote it');
    }
    if (context === 'flow' && '[{}'.includes(line[end])) {
      throw this.fail('syntax', `"${line[end]}" inside a list item`, end, 'quote it');
    }
    // ` #x` ends the value in YAML, which silently cuts `Fix the #1 bug` to "Fix the". A real
    // comment has a space after the `#`.
    if (line[end] === '#' && end + 1 < line.length && line[end + 1] !== ' ') {
      throw this.fail('syntax', '" #" starts a comment here and cuts the value short', end, 'quote the value, or put a space after # for a comment');
    }
    const pair = value.search(/: /);
    if (pair !== -1 || value.endsWith(':')) {
      throw this.fail('nested', 'nested mappings are not supported', start + (pair === -1 ? value.length - 1 : pair), "nested mappings aren't supported; quote text that has \": \" in it");
    }
    return { value: this.resolve(value, start), end: start + value.length };
  }

  resolve(word, at) {
    if (word === 'null') return null;
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (INTEGER.test(word) && word !== '-0') {
      const n = Number(word);
      if (!Number.isSafeInteger(n)) throw this.fail('ambiguous', 'integer out of range', at, `quote it; MIRAI supports ±${Number.MAX_SAFE_INTEGER}`);
      return n;
    }
    if (AMBIGUOUS_WORD.test(word)) {
      const hint = /^(?:=|<<)$/.test(word) ? 'quote it' : 'quote it, or write true or false';
      throw this.fail('ambiguous', `"${word}" is not a string in some YAML tools`, at, hint);
    }
    if (AMBIGUOUS_CORE.test(word)) {
      const hint = /^(?:True|TRUE|False|FALSE)$/.test(word) ? 'write true or false' : 'write null, or quote it';
      throw this.fail('ambiguous', `"${word}" is not a string in YAML`, at, hint);
    }
    if (TIMESTAMP.test(word)) {
      throw this.fail('ambiguous', `"${word}" reads as a date in some YAML tools`, at, `quote it: "${word}"`);
    }
    if (AMBIGUOUS_NUMBER.some((re) => re.test(word))) {
      throw this.fail('ambiguous', `"${word}" reads as a number in some YAML tools`, at, 'quote it, or use a plain integer');
    }
    return word;
  }

  doubleQuoted(start) {
    const { line } = this;
    let out = '';
    let i = start + 1;
    for (;;) {
      if (i >= line.length) throw this.fail('syntax', "the string isn't closed on this line", start, 'keep the value on one line; use \\n for a line break');
      const c = line[i];
      if (c === '"') return { value: out, end: i + 1 };
      if (c !== '\\') { out += c; i += 1; continue; }
      const e = line[i + 1];
      if (Object.hasOwn(ESCAPES, e)) { out += ESCAPES[e]; i += 2; continue; }
      if (e === 'u') {
        const digits = line.slice(i + 2, i + 6);
        if (!/^[0-9A-Fa-f]{4}$/.test(digits)) throw this.fail('escape', '"\\u" needs 4 hex digits', i);
        const cp = parseInt(digits, 16);
        if (cp >= 0xd800 && cp <= 0xdfff) throw this.fail('control', `"\\u${digits}" is half of a surrogate pair`, i, 'write the character itself');
        if (isControl(cp) || isInvisible(cp)) throw this.fail('control', `"\\u${digits}" is a control or invisible character`, i, 'use \\n or \\t, or leave it out');
        out += String.fromCodePoint(cp);
        i += 6;
        continue;
      }
      throw this.fail('escape', 'invalid escape', i, 'use \\" \\\\ \\n \\t or \\uXXXX');
    }
  }

  singleQuoted(start) {
    const { line } = this;
    let out = '';
    let i = start + 1;
    for (;;) {
      if (i >= line.length) throw this.fail('syntax', "the string isn't closed on this line", start, 'keep the value on one line');
      if (line[i] === "'") {
        if (line[i + 1] === "'") { out += "'"; i += 2; continue; }
        return { value: out, end: i + 1 };
      }
      out += line[i];
      i += 1;
    }
  }
}

function isControl(code) {
  return (code < 0x20 && code !== 0x09) || (code >= 0x7f && code <= 0x9f);
}

// Characters that hide or reorder text, so a value can look like something it isn't (the set
// unit 05a escapes on output, in src/status/text.js), plus the noncharacters U+FFFE / U+FFFF.
// U+2028 / U+2029 are also line breaks in YAML 1.1 and not in 1.2.
function isInvisible(code) {
  return code === 0x00ad || code === 0x061c || (code >= 0x200b && code <= 0x200f)
    || code === 0x2028 || code === 0x2029 || (code >= 0x202a && code <= 0x202e)
    || (code >= 0x2060 && code <= 0x2069) || code === 0xfeff || code === 0xfffe || code === 0xffff
    || (code >= 0xe0000 && code <= 0xe007f);
}

const hex4 = (code) => code.toString(16).toUpperCase().padStart(4, '0');
