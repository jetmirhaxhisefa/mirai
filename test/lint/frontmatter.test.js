import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { readFrontmatter, parseYamlSubset, LIMITS } from '../../src/lint/frontmatter.js';
import { ConfigError } from '../../src/cli/errors.js';
import { EXIT } from '../../src/cli/exit-codes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, 'corpus');
const SUITE = join(HERE, '..', 'vendor', 'yaml-test-suite');

const names = (dir, ext) => readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)).sort();

// Plain JSON shape, so null-prototype objects compare with JSON.parse output.
const plain = (v) => JSON.parse(JSON.stringify(v));

// Runs `fn` and returns the ConfigError it throws (or fails the test).
function refused(fn, label = 'input') {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ConfigError, `${label}: threw ${err}`);
    return err;
  }
  return assert.fail(`expected ${label} to be refused`);
}

const codeOf = (text) => refused(() => parseYamlSubset(text), JSON.stringify(text)).code;

test('T1: the corpus: valid files give their JSON, invalid ones fail at their line, column and code', () => {
  const valid = names(join(CORPUS, 'valid'), '.yaml');
  assert.ok(valid.length >= 9);
  for (const name of valid) {
    const text = readFileSync(join(CORPUS, 'valid', `${name}.yaml`), 'utf8');
    const want = JSON.parse(readFileSync(join(CORPUS, 'valid', `${name}.json`), 'utf8'));
    const got = parseYamlSubset(text, { source: name });
    assert.deepEqual(plain(got), want, name);
    // Key order is kept.
    assert.deepEqual(Object.keys(got), Object.keys(want), `${name}: key order`);
  }

  const invalid = names(join(CORPUS, 'invalid'), '.yaml');
  const codes = new Set();
  for (const name of invalid) {
    const text = readFileSync(join(CORPUS, 'invalid', `${name}.yaml`), 'utf8');
    const want = readFileSync(join(CORPUS, 'invalid', `${name}.err`), 'utf8').trim();
    const err = refused(() => parseYamlSubset(text, { source: `${name}.yaml` }), name);
    assert.equal(`${err.line}:${err.column}: ${err.code}`, want, `${name}: ${err.message}`);
    assert.ok(err.message.startsWith(`${name}.yaml:${err.line}:${err.column}: `), name);
    assert.equal(err.exitCode, EXIT.CONFIG);
    codes.add(err.code);
  }
  // Every refusal row of the subset table has at least one corpus file (too-large and unclosed
  // are in T2 and T3).
  const rows = ['ambiguous', 'anchor', 'alias', 'tag', 'block-scalar', 'nested', 'flow-mapping', 'continuation',
    'indent', 'list', 'key', 'duplicate', 'forbidden-key', 'tab', 'escape', 'control', 'directive', 'document', 'syntax'];
  assert.deepEqual([...codes].sort(), rows.sort());
});

test('T2: edge cases: text stays text, prototype keys, escapes, CRLF, BOM and the size limit', () => {
  // Text that only looks special stays text; dates and 1.2.3 must be quoted, because YAML 1.1
  // tools read them as a date and a float.
  const v = parseYamlSubset('updated: "2026-10-24"\nver: v1.2.3\nid: 12abc\nrange: 2026-10\n');
  assert.deepEqual(plain(v), { updated: '2026-10-24', ver: 'v1.2.3', id: '12abc', range: '2026-10' });
  assert.equal(codeOf('ver: 1.2.3\n'), 'ambiguous');
  assert.equal(codeOf('updated: 2026-10-24\n'), 'ambiguous');
  assert.equal(refused(() => parseYamlSubset('updated: 2026-10-24\n')).hint, 'quote it: "2026-10-24"');

  // No key reaches Object.prototype; the value has none.
  const before = Object.getOwnPropertyNames(Object.prototype).sort();
  for (const key of ['constructor', 'prototype']) assert.equal(codeOf(`${key}: x\n`), 'forbidden-key');
  assert.equal(codeOf('__proto__: x\n'), 'key');
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), before);
  assert.equal(Object.getPrototypeOf(parseYamlSubset('a: 1\n')), null);

  // \u escapes: a scalar value is fine; a surrogate half or a control character isn't.
  assert.equal(parseYamlSubset('a: "\\u00e9\\u4e2d"\n').a, 'é中');
  assert.equal(codeOf('a: "\\udc00"\n'), 'control');
  assert.equal(codeOf('a: "\\u001b[31m"\n'), 'control');
  assert.equal(codeOf('a: x\ud800\n'), 'control');

  // CRLF and LF read the same; a lone CR is refused.
  const lf = 'id: x\ntags:\n  - a\n  - b\nnum: 1\n';
  assert.deepEqual(plain(parseYamlSubset(lf.replaceAll('\n', '\r\n'))), plain(parseYamlSubset(lf)));
  assert.equal(codeOf('a: b\rc: d'), 'control');

  // No final newline is fine.
  assert.deepEqual(plain(parseYamlSubset('a: b')), { a: 'b' });

  // The size limit counts bytes: just under passes, just over fails.
  const head = 'a: "';
  const fits = `${head}${'x'.repeat(LIMITS.bytes - head.length - 2)}"\n`;
  assert.equal(Buffer.byteLength(fits), LIMITS.bytes);
  assert.equal(parseYamlSubset(fits).a.length, LIMITS.bytes - head.length - 2);
  assert.equal(codeOf(`${head}${'x'.repeat(LIMITS.bytes - head.length - 1)}"\n`), 'too-large');
  assert.equal(codeOf(`${head}${'é'.repeat(LIMITS.bytes / 2)}"\n`), 'too-large');
  // A huge frontmatter is refused while it's being found, before it's read.
  const huge = refused(() => readFrontmatter(`---\na: "${'x'.repeat(LIMITS.bytes * 64)}"\n---\n`));
  assert.equal(huge.code, 'too-large');

  // A BOM is ignored at the start of the document only.
  assert.deepEqual(plain(readFrontmatter('\uFEFF---\nid: x\n---\n').value), { id: 'x' });
  assert.equal(codeOf('\uFEFFid: x\n'), 'control');

  // Errors carry a hint where there's a concrete fix, and the key path once it's known.
  const err = refused(() => parseYamlSubset('draft: no\n'));
  assert.match(err.hint, /quote it/);
  assert.equal(err.path, 'draft');
  assert.equal(refused(() => parseYamlSubset('tags:\n  - a\n  - off\n')).path, 'tags[1]');
  assert.equal(refused(() => parseYamlSubset('tags: [a, b, y]\n')).path, 'tags[2]');
  assert.match(refused(() => parseYamlSubset('files:\n  - **/*.md\n')).hint, /quote the value/);

  // Other whitespace is content, as in YAML: only spaces indent or end a value.
  assert.equal(parseYamlSubset('a: x\u00a0\n').a, 'x\u00a0');
  assert.equal(parseYamlSubset('a: \u3000x\n').a, '\u3000x');
  assert.equal(codeOf('a:\n \u00a0- x\n'), 'continuation');
});

test('T3: readFrontmatter: none, unclosed, empty, the body and file line numbers', () => {
  assert.equal(readFrontmatter('# Title\n\ntext\n'), null);
  assert.equal(readFrontmatter(''), null);
  assert.equal(readFrontmatter('--- \nid: x\n---\n'), null);
  assert.equal(readFrontmatter('----\n'), null);

  const unclosed = refused(() => readFrontmatter('---\nid: x\n# Title\n', { source: 'doc.md' }));
  assert.equal(unclosed.code, 'unclosed');
  assert.equal(unclosed.line, 1);
  assert.match(unclosed.message, /^doc\.md:1:1: /);

  // An empty frontmatter is an empty mapping.
  const empty = readFrontmatter('---\n---\nbody\n');
  assert.deepEqual(plain(empty.value), {});
  assert.equal(empty.bodyLine, 3);
  assert.equal(empty.body, 'body\n');
  assert.deepEqual(plain(readFrontmatter('---\n# only a comment\n---').value), {});

  // The body starts after the closing line; positions and errors count from the top of the file.
  const doc = '---\nid: prd-login\ntype: prd\n---\n# Login\n\nText.\n';
  const read = readFrontmatter(doc, { source: 'prd.md', positions: true });
  assert.deepEqual(plain(read.value), { id: 'prd-login', type: 'prd' });
  assert.deepEqual(read.positions.get('type'), { line: 3, column: 1, valueColumn: 7 });
  assert.equal(read.bodyLine, 5);
  assert.equal(read.body, '# Login\n\nText.\n');
  const bad = refused(() => readFrontmatter('---\nid: x\ndraft: yes\n---\n', { source: 'prd.md' }));
  assert.equal(bad.message.split(' ')[0], 'prd.md:3:8:');

  // CRLF documents work the same.
  const crlf = readFrontmatter(doc.replaceAll('\n', '\r\n'), { positions: true });
  assert.deepEqual(plain(crlf.value), { id: 'prd-login', type: 'prd' });
  assert.equal(crlf.bodyLine, 5);
  assert.equal(crlf.body, '# Login\r\n\r\nText.\r\n');

  // A closing line that is almost `---` is pointed at.
  const near = refused(() => readFrontmatter('---\nid: x\n--- \n# T\n'));
  assert.equal(`${near.line}:${near.code}`, '3:unclosed');
  assert.match(near.hint, /exactly ---/);
  assert.equal(refused(() => readFrontmatter('---\nid: x\n...\n')).line, 3);

  // Bytes: valid UTF-8 reads like the string; invalid bytes are refused at their position.
  const bytes = Buffer.from(doc, 'utf8');
  assert.deepEqual(plain(readFrontmatter(bytes).value), plain(read.value));
  const broken = Buffer.concat([Buffer.from('---\nid: x\ntitle: a'), Buffer.from([0xc3, 0x28]), Buffer.from('\n---\n')]);
  const enc = refused(() => readFrontmatter(broken, { source: 'bad.md' }));
  assert.equal(`${enc.line}:${enc.column}: ${enc.code}`, '3:9: encoding');
  assert.throws(() => readFrontmatter(42), TypeError);

  // A `---` inside a quoted value isn't the end; a line that is exactly `---` is.
  assert.deepEqual(plain(readFrontmatter('---\na: "---"\n---\n').value), { a: '---' });
  // The size limit applies to the frontmatter, not the body.
  const longBody = `---\nid: x\n---\n${'x'.repeat(LIMITS.bytes * 2)}\n`;
  assert.equal(readFrontmatter(longBody).value.id, 'x');
});

test('T4: positions give the line and column of every key and list item', () => {
  const ok = 'id: x\r\ntitle: "😀 hi"\r\ntags: [a, "😀", b]\r\ndown:\r\n  - one\r\n\r\n  - two\r\n';
  const { value, positions } = parseYamlSubset(ok, { positions: true, firstLine: 2 });
  assert.deepEqual(plain(value), { id: 'x', title: '😀 hi', tags: ['a', '😀', 'b'], down: ['one', 'two'] });
  assert.deepEqual(Object.fromEntries(positions), {
    id: { line: 2, column: 1, valueColumn: 5 },
    title: { line: 3, column: 1, valueColumn: 8 },
    tags: { line: 4, column: 1, valueColumn: 7 },
    'tags[0]': { line: 4, column: 8 },
    'tags[1]': { line: 4, column: 11 },
    'tags[2]': { line: 4, column: 16 },
    down: { line: 5, column: 1 },
    'down[0]': { line: 6, column: 5 },
    'down[1]': { line: 8, column: 5 },
  });
  // Columns count characters, not UTF-16 units: the error after an emoji points at the right one.
  const err = refused(() => parseYamlSubset('a: "😀" x\n'));
  assert.equal(err.column, 8);
  // Without the option the result is the plain value.
  assert.equal(parseYamlSubset(ok).id, 'x');
  // Positions stay linear on long lines with characters above U+FFFF.
  const items = Array.from({ length: 3000 }, (_, k) => (k % 2 ? 'x' : '😀')).join(', ');
  const long = parseYamlSubset(`tags: [${items}]\n`, { positions: true });
  assert.equal(long.positions.get('tags[2999]').column, 8 + 2999 * 3);
});

// Every case folder of the vendored suite (some have numbered sub-cases).
function suiteCases() {
  const out = [];
  for (const entry of readdirSync(SUITE)) {
    const dir = join(SUITE, entry);
    if (!statSync(dir).isDirectory()) continue;
    if (existsSync(join(dir, 'in.yaml'))) out.push(entry);
    else for (const sub of readdirSync(dir)) out.push(`${entry}/${sub}`);
  }
  return out.sort();
}

// The suite's in.json holds zero or more JSON documents, one after another.
function jsonDocuments(text) {
  const docs = [];
  let rest = text.trim();
  while (rest) {
    let end = rest.length;
    for (;;) {
      try {
        docs.push(JSON.parse(rest.slice(0, end)));
        break;
      } catch {
        end = rest.lastIndexOf('\n', end - 1);
        if (end <= 0) throw new Error('unreadable in.json');
      }
    }
    rest = rest.slice(end).trim();
  }
  return docs;
}

// Case -> "line:column: code" it's refused with, for every valid suite case outside the subset (reviewed by
// hand).
const OUTSIDE_SUBSET = JSON.parse(readFileSync(join(HERE, 'yaml-test-suite-outside-subset.json'), 'utf8'));

test('T5: the YAML test suite (yaml-test-suite, vendored data)', () => {
  const counts = { refusedErrors: 0, outsideSubset: 0, accepted: 0, emptyStreams: 0 };
  for (const c of suiteCases()) {
    const dir = join(SUITE, c);
    const yaml = readFileSync(join(dir, 'in.yaml'), 'utf8');
    let value;
    let err;
    try {
      value = parseYamlSubset(yaml, { source: c });
    } catch (e) {
      err = e;
    }
    if (err) assert.ok(err instanceof ConfigError, `${c}: crashed with ${err}`);
    if (existsSync(join(dir, 'error'))) {
      // A subset of YAML must refuse everything YAML refuses.
      assert.ok(err, `${c}: invalid YAML was accepted`);
      counts.refusedErrors += 1;
    } else if (err) {
      // Valid YAML may be refused only for its known feature outside the subset, at its place.
      assert.equal(`${err.line}:${err.column}: ${err.code}`, OUTSIDE_SUBSET[c], `${c}: refused for the wrong reason (${err.message})`);
      counts.outsideSubset += 1;
    } else {
      // Anything accepted must mean exactly what YAML says, key order included.
      assert.ok(existsSync(join(dir, 'in.json')), `${c}: accepted, but the suite has no JSON for it`);
      const docs = jsonDocuments(readFileSync(join(dir, 'in.json'), 'utf8'));
      if (docs.length === 0) {
        // The one allowed difference: an empty stream is an empty mapping.
        assert.deepEqual(plain(value), {}, c);
        counts.emptyStreams += 1;
      } else {
        assert.equal(docs.length, 1, `${c}: accepted a stream of ${docs.length} documents`);
        assert.equal(JSON.stringify(value), JSON.stringify(docs[0]), `${c}: value differs from the suite`);
      }
      counts.accepted += 1;
    }
  }
  assert.deepEqual(Object.keys(OUTSIDE_SUBSET).length, counts.outsideSubset, 'the outside-subset list has stale entries');
  // Pinned to yaml-test-suite data-2022-01-17: update these with the pin.
  assert.deepEqual(counts, { refusedErrors: 94, outsideSubset: 299, accepted: 9, emptyStreams: 3 });
});

test('T6: the vendored suite matches its provenance, with nothing added', () => {
  const prov = JSON.parse(readFileSync(join(SUITE, 'PROVENANCE.json'), 'utf8'));
  const files = [];
  const walk = (rel) => {
    for (const entry of readdirSync(join(SUITE, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${entry.name}` : entry.name;
      assert.ok(entry.isDirectory() || entry.isFile(), `${p}: not a plain file`);
      if (entry.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk('');
  const data = files.filter((f) => f !== 'LICENSE' && f !== 'PROVENANCE.json').sort();
  assert.equal(files.length, data.length + 2);
  for (const f of data) assert.match(f, /^[0-9A-Z]{4}(?:\/[0-9]{2,3})?\/(?:in\.yaml|in\.json|error|===)$/, f);
  const hash = createHash('sha256');
  for (const f of data) {
    const fileHash = createHash('sha256').update(readFileSync(join(SUITE, f))).digest('hex');
    hash.update(`${f}\0${fileHash}\n`);
  }
  assert.equal(data.length, prov.files);
  assert.equal(hash.digest('hex'), prov.sha256);
  assert.equal(prov.commit, '6e6c296ae9c9d2d5c4134b4b64d01b29ac19ff6f');
});

// The implicit types of YAML 1.1 (yaml.org/type: bool, null, int, float, timestamp, value,
// merge) and of the YAML 1.2.2 core schema (§10.3.2), as full-match patterns. A plain word the
// reader returns as a string must match none of them; an integer, boolean or null must be the
// same type in both. Patterns are listed in resolution order (1.2.2 resolves int before float,
// whose pattern also matches integers), so the first match is the type.
const YAML11 = {
  bool: /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/,
  null: /^(?:~|null|Null|NULL|)$/,
  int: /^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$/,
  float: /^(?:[-+]?(?:[0-9][0-9_]*)?\.[0-9.]*(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/,
  timestamp: /^(?:[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:[Tt]|[ \t]+)[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]*)?(?:[ \t]*Z|[-+][0-9]{1,2}(?::[0-9]{2})?)?)$/,
  value: /^=$/,
  merge: /^<<$/,
};
const YAML12 = {
  null: /^(?:null|Null|NULL|~|)$/,
  bool: /^(?:true|True|TRUE|false|False|FALSE)$/,
  int: /^(?:[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+)$/,
  float: /^(?:[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/,
};
const typesOf = (schema, word) => Object.keys(schema).filter((t) => schema[t].test(word));
const typeOf = (schema, word) => typesOf(schema, word)[0] ?? 'str';

test('T7: every plain word reads as the same type in YAML 1.1, YAML 1.2 and MIRAI', () => {
  // Words from the vendored suite and the corpus, plus generated number-, date- and
  // boolean-like ones.
  const words = new Set();
  const addWords = (text) => {
    for (const w of text.split(/[\s,[\]{}]+/)) if (w) words.add(w);
  };
  for (const c of suiteCases()) addWords(readFileSync(join(SUITE, c, 'in.yaml'), 'utf8'));
  for (const dir of ['valid', 'invalid']) {
    for (const f of readdirSync(join(CORPUS, dir))) if (f.endsWith('.yaml')) addWords(readFileSync(join(CORPUS, dir, f), 'utf8'));
  }
  const parts = ['', '-', '+', '0', '1', '7', '9', '00', '017', '10', '0x', '0o', '0b', '_', '.', ':', 'e', 'E', '1e3', 'inf', 'nan', 'T', 'Z'];
  for (const a of parts) for (const b of parts) for (const c of ['', ...parts.slice(0, 12)]) words.add(a + b + c);
  for (const w of ['yes', 'no', 'on', 'off', 'y', 'n', 'true', 'false', 'null', '~', '=', '<<']) {
    for (const v of [w, w.toUpperCase(), w[0].toUpperCase() + w.slice(1)]) words.add(v);
  }
  for (const d of ['2026-10-24', '2026-1-5', '2026-10-24T10:00:00Z', '2026-10-24t10:00:00.5+02:00', '2026-10', '20261024', '2026-10-24x']) words.add(d);

  let strings = 0;
  let others = 0;
  for (const word of words) {
    if (word.startsWith('#')) continue; // a comment, not a word
    let value;
    try {
      value = parseYamlSubset(`a: ${word}\n`).a;
    } catch (err) {
      assert.ok(err instanceof ConfigError, `${word}: ${err}`);
      continue;
    }
    if (typeof value === 'string' && value !== word) continue; // quoted, not a plain word
    if (typeof value !== 'string') {
      const t11 = typeOf(YAML11, word);
      const t12 = typeOf(YAML12, word);
      const ours = value === null ? 'null' : typeof value === 'boolean' ? 'bool' : 'int';
      assert.ok(Number.isSafeInteger(value) || value === null || typeof value === 'boolean', `${word}: read as ${JSON.stringify(value)}`);
      assert.deepEqual([t11, t12], [ours, ours], `${word}: ${ours} for MIRAI, ${t11} in 1.1, ${t12} in 1.2`);
      others += 1;
    } else {
      assert.deepEqual([typesOf(YAML11, word), typesOf(YAML12, word)], [[], []], `${word}: a string for MIRAI only`);
      strings += 1;
    }
  }
  assert.ok(strings > 500 && others > 20, `${strings} strings, ${others} others`);

  // Keys: an accepted key is a string in both.
  for (const word of [...words].filter((w) => /^[a-z][a-z0-9_]*$/.test(w))) {
    try {
      parseYamlSubset(`${word}: x\n`);
    } catch {
      continue;
    }
    assert.deepEqual([typesOf(YAML11, word), typesOf(YAML12, word)], [[], []], `key ${word}`);
  }
});
