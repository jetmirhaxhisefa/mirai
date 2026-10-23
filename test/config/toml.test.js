import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseToml, LIMITS } from '../../src/config/toml.js';
import { ConfigError } from '../../src/cli/errors.js';
import { EXIT } from '../../src/cli/exit-codes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, 'corpus');
const SUITE = join(HERE, '..', 'vendor', 'toml-test');

const names = (dir, ext) => readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)).sort();

// Plain JSON shape, so null-prototype objects compare with JSON.parse output.
const plain = (v) => JSON.parse(JSON.stringify(v));

// Parses and returns the thrown error (or fails the test if nothing is thrown).
function rejects(input, source = 'test.toml') {
  try {
    parseToml(input, { source });
  } catch (err) {
    return err;
  }
  return assert.fail(`expected ${source} to be rejected`);
}

test('T1: every valid corpus file parses to its expected JSON', () => {
  const files = names(join(CORPUS, 'valid'), '.toml');
  assert.ok(files.length >= 20);
  for (const name of files) {
    const bytes = readFileSync(join(CORPUS, 'valid', `${name}.toml`));
    const want = JSON.parse(readFileSync(join(CORPUS, 'valid', `${name}.json`), 'utf8'));
    assert.deepEqual(plain(parseToml(bytes, { source: name })), want, `${name} (bytes)`);
    assert.deepEqual(plain(parseToml(bytes.toString('utf8'), { source: name })), want, `${name} (string)`);
  }
});

test('T2: every invalid corpus file fails at its expected position and message', () => {
  const files = names(join(CORPUS, 'invalid'), '.toml');
  assert.ok(files.length >= 40);
  for (const name of files) {
    const bytes = readFileSync(join(CORPUS, 'invalid', `${name}.toml`));
    const want = readFileSync(join(CORPUS, 'invalid', `${name}.err`), 'utf8').trim();
    const err = rejects(bytes, `${name}.toml`);
    assert.ok(err instanceof ConfigError, `${name}: ${err}`);
    assert.ok(err.message.startsWith(`${name}.toml:${want}`), `${name}: got "${err.message}", want "${want}"`);
    if (name === 'invalid-utf8') continue; // a string can't hold invalid UTF-8
    const again = rejects(bytes.toString('utf8'), `${name}.toml`);
    assert.equal(again.message, err.message, `${name}: string input gives a different error`);
  }
});

test('T3: the corpus covers every row of the subset table', () => {
  const valid = names(join(CORPUS, 'valid'), '.toml');
  const invalid = names(join(CORPUS, 'invalid'), '.toml');
  const accepted = ['comments', 'bare-keys', 'tables', 'array-of-tables', 'basic-strings', 'literal-strings',
    'integers', 'floats', 'booleans', 'arrays', 'inline-tables'];
  const refused = ['no-dotted-keys', 'no-quoted-keys', 'no-multiline', 'no-dates', 'no-hex-oct-bin',
    'no-exponents', 'no-inf-nan'];
  for (const f of accepted) assert.ok(valid.some((n) => n.startsWith(f)), `no valid corpus file for "${f}"`);
  for (const f of refused) assert.ok(invalid.some((n) => n.startsWith(f)), `no invalid corpus file for "${f}"`);
});

test('T4: duplicate keys and tables are refused', () => {
  const cases = {
    'a = 1\na = 2\n': '"a" is already defined',
    '[a]\n[a]\n': '"a" is already defined',
    '[a]\nb = 1\n[a.b]\n': '"a.b" is already defined',
    '[a]\n[[a]]\n': 'not an array of tables',
    '[[a]]\n[a]\n': '"a" is already defined',
    '[a.b]\n[a]\n[a]\n': '"a" is already defined',
    't = { x = 1, x = 2 }\n': '"x" is already defined',
  };
  for (const [text, msg] of Object.entries(cases)) {
    assert.match(rejects(text).message, new RegExp(msg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), text);
  }
});

test('T5: prototype keys are refused everywhere, and Object.prototype stays clean', () => {
  const cases = ['__proto__ = 1', 'constructor = 1', 'prototype = 1', '[__proto__]', '[a.constructor]',
    '[[prototype]]', 'x = { __proto__ = { polluted = true } }', 'x = [{ constructor = 1 }]'];
  for (const text of cases) assert.match(rejects(text).message, /is not allowed/, text);
  assert.equal(Object.prototype.polluted, undefined);
  // Accepted tables inherit nothing: no toString, no hasOwnProperty, no __proto__ accessor.
  const t = parseToml('x = { a = 1 }\n[y]\nb = 2\n');
  for (const table of [t, t.x, t.y]) {
    for (const name of ['toString', 'hasOwnProperty', 'constructor', '__proto__', 'valueOf']) {
      assert.equal(name in table, false, `${name} is visible on a parsed table`);
    }
  }
});

test('T6: each limit passes just under and fails just over', () => {
  // File size (padding with a comment line).
  const fits = `a = 1\n#${'x'.repeat(LIMITS.bytes - 8)}\n`;
  assert.equal(Buffer.byteLength(fits), LIMITS.bytes);
  assert.equal(parseToml(fits).a, 1);
  assert.match(rejects(`${fits}#`).message, /larger than/);
  assert.match(rejects(Buffer.from(`${fits}#`)).message, /larger than/);

  // Nesting depth: arrays and inline tables, and table headers.
  const nest = (n) => `a = ${'['.repeat(n)}${']'.repeat(n)}\n`;
  assert.doesNotThrow(() => parseToml(nest(LIMITS.depth)));
  assert.match(rejects(nest(LIMITS.depth + 1)).message, /nested deeper/);
  const header = (n) => `[${Array.from({ length: n }, (_, i) => `k${i}`).join('.')}]\n`;
  assert.doesNotThrow(() => parseToml(header(LIMITS.depth)));
  assert.match(rejects(header(LIMITS.depth + 1)).message, /nested deeper/);
  // Header depth and value depth add up.
  assert.match(rejects(`${header(LIMITS.depth)}y = []\n`).message, /nested deeper/);
  assert.doesNotThrow(() => parseToml(`${header(LIMITS.depth - 1)}y = []\n`));

  // String length, basic and literal.
  const s = (n) => `s = "${'x'.repeat(n)}"\n`;
  assert.equal(parseToml(s(LIMITS.stringLength)).s.length, LIMITS.stringLength);
  assert.match(rejects(s(LIMITS.stringLength + 1)).message, /longer than/);
  assert.match(rejects(`s = '${'x'.repeat(LIMITS.stringLength + 1)}'\n`).message, /longer than/);

  // Key count.
  const keys = (n) => Array.from({ length: n }, (_, i) => `k${i} = 1`).join('\n');
  assert.equal(Object.keys(parseToml(keys(LIMITS.keys))).length, LIMITS.keys);
  assert.match(rejects(keys(LIMITS.keys + 1)).message, /more than/);
});

test('T7: text rules (UTF-8, control characters, surrogates, BOM, CRLF)', () => {
  assert.match(rejects(Buffer.from([0x61, 0x20, 0x3d, 0x20, 0x22, 0xc3, 0x22])).message, /not valid UTF-8/);
  assert.match(rejects(Buffer.from([0x61, 0x3d, 0x22, 0xed, 0xa0, 0x80, 0x22])).message, /not valid UTF-8/, 'encoded surrogate');
  assert.match(rejects(Buffer.from([0x61, 0x3d, 0x22, 0xc0, 0x80, 0x22])).message, /not valid UTF-8/, 'overlong');
  assert.match(rejects('a = "x\u0000"').message, /U\+0000/);
  assert.match(rejects('a = 1 # \u001f').message, /U\+001F/);
  assert.match(rejects('a = 1\rb = 2').message, /carriage return/);
  assert.match(rejects('a = "\ud800"').message, /unpaired surrogate/);
  const lone = rejects('a = "😀"\nb = "\ud800"');
  assert.deepEqual([lone.line, lone.column], [2, 6], 'a correct pair before it must not move the position');
  assert.match(rejects('a = "\\uDFFF"').message, /not a Unicode scalar value/);
  assert.match(rejects('a = "\\U00110000"').message, /not a Unicode scalar value/);
  assert.equal(parseToml('﻿a = 1').a, 1);
  assert.equal(parseToml(Buffer.from('﻿a = 1')).a, 1);
  assert.match(rejects('﻿﻿a = 1').message, /expected a key/, 'only one BOM, only at the start');
  assert.deepEqual(plain(parseToml('a = 1\r\nb = 2\r\n')), { a: 1, b: 2 });
  assert.equal(parseToml('s = "tab\there"').s, 'tab\there', 'a raw tab is allowed in strings');
  assert.equal(parseToml('s = "\u0085"').s, '\u0085', 'C1 characters are allowed, as in TOML');
});

test('T8: a realistic config and a definition file parse to the expected objects', () => {
  const config = plain(parseToml(readFileSync(join(CORPUS, 'valid', 'realistic-config.toml')), { source: '.mirai/config.toml' }));
  assert.equal(config.git.integration_branch, 'mirai/pilot');
  assert.deepEqual(config.testing.levels.map((l) => l.name), ['unit', 'e2e']);
  assert.deepEqual(config.repos, [{ name: 'platform', path: '.' }]);
  const def = plain(parseToml(readFileSync(join(CORPUS, 'valid', 'realistic-definition.toml'))));
  assert.equal(def.kind, 'agent');
  assert.ok(def.tools.allowed.includes('mcp__mirai__run_tests'));
});

test('T9: errors are ConfigErrors with exit code 3 and source:line:column', () => {
  const err = rejects('a = 1\n[git]\nbranch.name = "x"\n', '.mirai/config.toml');
  assert.ok(err instanceof ConfigError);
  assert.equal(err.exitCode, EXIT.CONFIG);
  assert.equal(err.source, '.mirai/config.toml');
  assert.equal(err.line, 3);
  assert.equal(err.column, 1);
  assert.equal(err.message, '.mirai/config.toml:3:1: dotted keys are not supported');
  assert.equal(err.reason, 'dotted keys are not supported');
  assert.equal(err.hint, 'use a [git.branch] table, then name = …');
  assert.equal(err.message.split('\n').length, 1);
});

test('T10: every table in the output has no prototype', () => {
  const out = parseToml(readFileSync(join(CORPUS, 'valid', 'realistic-config.toml')));
  const tables = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') { tables.push(v); Object.values(v).forEach(walk); }
  };
  walk(out);
  assert.ok(tables.length >= 8);
  for (const t of tables) assert.equal(Object.getPrototypeOf(t), null);
});

// toml-test values are {type, value} leaves; floats compare by number, the rest by text.
function sameTagged(got, want) {
  if (Array.isArray(want)) return Array.isArray(got) && got.length === want.length && want.every((w, i) => sameTagged(got[i], w));
  if (want && typeof want.type === 'string' && 'value' in want && Object.keys(want).length === 2) {
    if (!got || got.type !== want.type) return false;
    return want.type === 'float' ? Object.is(Number(got.value), Number(want.value)) : got.value === want.value;
  }
  if (!got || typeof got !== 'object' || Array.isArray(got)) return false;
  const a = Object.keys(got).sort();
  const b = Object.keys(want).sort();
  return a.length === b.length && a.every((k, i) => k === b[i]) && b.every((k) => sameTagged(got[k], want[k]));
}

// File -> expected reason, for every valid suite file outside the subset (reviewed by hand).
const OUTSIDE_SUBSET = JSON.parse(readFileSync(join(HERE, 'toml-test-outside-subset.json'), 'utf8'));

test('T11: the official TOML 1.0 suite (toml-test, vendored data)', () => {
  const list = readFileSync(join(SUITE, 'files-toml-1.0.0'), 'utf8').split('\n').filter((l) => l.endsWith('.toml'));
  const counts = { accepted: 0, outsideSubset: 0, rejectedInvalid: 0 };
  for (const file of list) {
    const bytes = readFileSync(join(SUITE, file));
    let out;
    let err;
    try {
      out = parseToml(bytes, { source: file, tagged: true });
    } catch (e) {
      err = e;
    }
    if (err) assert.ok(err instanceof ConfigError, `${file}: crashed with ${err}`);
    if (file.startsWith('invalid/')) {
      // A subset of TOML must reject everything TOML rejects.
      assert.ok(err, `${file}: invalid TOML was accepted`);
      counts.rejectedInvalid += 1;
    } else if (err) {
      // Valid TOML may be rejected only for its known feature outside the subset.
      assert.equal(err.reason, OUTSIDE_SUBSET[file], `${file}: rejected for the wrong reason`);
      counts.outsideSubset += 1;
    } else {
      // Anything accepted must mean exactly what TOML says.
      const want = JSON.parse(readFileSync(join(SUITE, file.replace(/\.toml$/, '.json')), 'utf8'));
      assert.ok(sameTagged(out, want), `${file}: value differs from the TOML 1.0 suite`);
      counts.accepted += 1;
    }
  }
  // Pinned to toml-test ff49d10: update these with the pin.
  assert.equal(counts.rejectedInvalid, 501);
  assert.equal(counts.outsideSubset, Object.keys(OUTSIDE_SUBSET).length);
  assert.equal(counts.outsideSubset, 106);
  assert.equal(counts.accepted, 102);
});

test('T12: the vendored suite matches its provenance, with nothing added', () => {
  const prov = JSON.parse(readFileSync(join(SUITE, 'PROVENANCE.json'), 'utf8'));
  const list = readFileSync(join(SUITE, 'files-toml-1.0.0'), 'utf8').split('\n').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const f of list) {
    const fileHash = createHash('sha256').update(readFileSync(join(SUITE, f))).digest('hex');
    hash.update(`${f}\0${fileHash}\n`);
  }
  assert.equal(hash.digest('hex'), prov.sha256);
  assert.equal(prov.commit, 'ff49d109861c1ad25af53f687f2aef19ab650600');
  const onDisk = [];
  const walk = (dir, rel = '') => {
    for (const entry of readdirSync(join(SUITE, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(dir, p);
      else onDisk.push(p);
    }
  };
  walk(SUITE);
  assert.deepEqual(onDisk.sort(), [...list, 'LICENSE', 'PROVENANCE.json', 'files-toml-1.0.0'].sort());
});

test('T13: positions give line, column and type for every key path', () => {
  const text = 'retention_days = 90\nratio = 0.5\n[git]\nbranch = "main"\n[[repos]]\nname = "api"\n[[repos]]\nname = "ui"\nflags = [1, { x = "😀" }]\n';
  const { value, positions } = parseToml(text, { positions: true });
  assert.equal(value.git.branch, 'main');
  const at = (p) => positions.get(p);
  assert.deepEqual(at('retention_days'), { line: 1, column: 1, type: 'integer' });
  assert.deepEqual(at('ratio'), { line: 2, column: 1, type: 'float' });
  assert.deepEqual(at('git'), { line: 3, column: 1, type: 'table' });
  assert.deepEqual(at('git.branch'), { line: 4, column: 1, type: 'string' });
  assert.deepEqual(at('repos'), { line: 5, column: 1, type: 'array' });
  assert.deepEqual(at('repos[1].name'), { line: 8, column: 1, type: 'string' });
  assert.deepEqual(at('repos[1].flags'), { line: 9, column: 1, type: 'array' });
  assert.deepEqual(at('repos[1].flags[0]'), { line: 9, column: 10, type: 'integer' });
  assert.deepEqual(at('repos[1].flags[1].x'), { line: 9, column: 15, type: 'string' });
  // Without the option the result is the plain value.
  assert.equal(parseToml(text).git.branch, 'main');
});

test('T14: hints name the concrete fix', () => {
  const hint = (text) => rejects(text).hint;
  assert.equal(hint('retention.days = 90'), 'use a [retention] table, then days = …');
  assert.equal(hint('[run]\nstop_by = 06:30'), 'write the time as a string, for example "06:30"');
  assert.equal(hint('d = 2026-10-23'), 'write the date as a string, for example "2026-10-23"');
  assert.equal(hint('x = nope'), 'strings need quotes');
});
