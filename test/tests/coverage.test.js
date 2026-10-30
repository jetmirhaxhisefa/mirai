import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { COVERAGE_LIMITS, parseCobertura, parseLcov, readCoverage } from '../../src/tests/coverage.js';
import { diffCoverage } from '../../src/tests/diff-coverage.js';
import { serviceMounts } from '../../src/tests/paths.js';

// Unit 16b T1, T2 and T5: lcov and Cobertura on the files the sample app's runners wrote (K1–K4,
// test/tests/corpus/) and hand-made ones, and diff coverage.

const CORPUS = new URL('./corpus/', import.meta.url).pathname;
const corpus = (name) => readFileSync(join(CORPUS, name));
const PHP = { mounts: serviceMounts({ volumes: [{ type: 'bind', source: '/c/backend', target: '/var/www/html' }, { type: 'volume', target: '/var/www/html/vendor' }] }, '/c'), base: '/var/www/html' };
const NODE = { mounts: serviceMounts({ volumes: [{ type: 'bind', source: '/c/frontend', target: '/app' }, { type: 'volume', target: '/app/node_modules' }] }, '/c'), base: '/app' };
const count = (f) => [Object.keys(f).length, Object.values(f).filter((h) => h > 0).length];

test('16b T2: Cobertura from PHPUnit: the DTD\'s DOCTYPE let through, <source> plus filename, class lines only', () => {
  const r = parseCobertura(corpus('phpunit-coverage.xml'), PHP);
  assert.equal(r.unmapped, 0);
  assert.deepEqual(count(r.files['backend/app/Http/Controllers/AuthController.php']), [13, 9]);
  assert.equal(r.files['backend/app/Http/Controllers/AuthController.php'][30], 0);
  assert.equal(r.files['backend/app/Http/Controllers/AuthController.php'][14], 2);
  // A file with no line that can run is listed, with no lines.
  assert.deepEqual(r.files['backend/app/Http/Controllers/Controller.php'], Object.create(null));
  // The sum matches the file's own lines-valid (35) and lines-covered (31).
  const all = Object.values(r.files).flatMap((f) => Object.values(f));
  assert.deepEqual([all.length, all.filter((h) => h > 0).length], [35, 31]);
  // K3: a one-file run lists every source file, most at 0.
  const one = parseCobertura(corpus('phpunit-coverage-file.xml'), PHP);
  assert.deepEqual(count(one.files['backend/app/Http/Controllers/AuthController.php']), [13, 0]);
});

test('16b T2: Cobertura refused: another DOCTYPE, an entity, a root that isn\'t <coverage>, a class without a filename, bad numbers; outside paths are unmapped', () => {
  const doc = (body, head = '') => `<?xml version="1.0"?>${head}<coverage><sources><source>/var/www/html/app</source></sources><packages><package><classes>${body}</classes></package></packages></coverage>`;
  const bad = (text, re) => assert.match(readCoverage('cobertura', Buffer.from(text), PHP).reason ?? 'accepted', re, text.slice(0, 80));
  bad(doc('', '<!DOCTYPE coverage [<!ENTITY x "y">]>'), /DOCTYPE/);
  bad(doc('<class filename="&x;"/>', '<!DOCTYPE coverage SYSTEM "x.dtd">'), /entity/);
  bad('<report/>', /not <coverage>/);
  bad(doc('<class><lines/></class>'), /without a filename/);
  bad(doc('<class filename="A.php"><lines><line number="0" hits="1"/></lines></class>'), /out of range/);
  bad(doc('<class filename="A.php"><lines><line number="3" hits="-1"/></lines></class>'), /whole number/);
  const r = parseCobertura(Buffer.from(doc('<class filename="A.php"><lines><line number="3" hits="1"/></lines></class><class filename="/usr/lib/x.php"><lines><line number="1" hits="1"/></lines></class>')), PHP);
  assert.deepEqual([Object.keys(r.files), r.unmapped], [['backend/app/A.php'], 1]);
});

test('16b T1: lcov: SF, DA, LF, LH, end_of_record; ignored records; malformed ones refused; relative and absolute paths', () => {
  const text = 'TN:\nSF:src/a.ts\nFN:1,f\nFNDA:1,f\nDA:1,1\nDA:2,0\nDA:3,5,abc\nBRDA:1,0,0,1\nLF:3\nLH:2\nend_of_record\nSF:/app/src/b.ts\nDA:1,0\nend_of_record\nSF:/app/node_modules/x/y.js\nDA:1,1\nend_of_record\n';
  const r = parseLcov(text, NODE);
  assert.deepEqual({ ...r.files['frontend/src/a.ts'] }, { 1: 1, 2: 0, 3: 5 });
  assert.deepEqual({ ...r.files['frontend/src/b.ts'] }, { 1: 0 });
  assert.equal(r.unmapped, 1);
  // The same file twice keeps the highest count.
  for (const [x, y] of [[0, 2], [2, 0]]) assert.equal(parseLcov(`SF:src/a.ts\nDA:1,${x}\nend_of_record\nSF:src/a.ts\nDA:1,${y}\nend_of_record\n`, NODE).files['frontend/src/a.ts'][1], 2);
  const bad = (t, re) => assert.match(readCoverage('lcov', Buffer.from(t), NODE).reason ?? 'accepted', re, t);
  bad('DA:1,1\n', /outside a record/);
  bad('SF:a\nSF:b\n', /inside a record/);
  bad('SF:a\nDA:1,1\n', /no end_of_record/);
  bad('SF:a\nDA:x,1\nend_of_record\n', /out of range/);
  bad('SF:a\nDA:1\nend_of_record\n', /whole number/);
  bad('SF:a\nZZ:1\nend_of_record\n', /doesn't have/);
  bad('end_of_record\n', /outside a record/);
  assert.match(readCoverage('lcov', Buffer.from('x'.repeat(100)), { ...NODE, limits: { ...COVERAGE_LIMITS, bytes: 50 } }).reason, /larger than/);
  assert.match(readCoverage('lcov', Buffer.from('SF:src/a\nDA:1,1\nDA:2,1\nend_of_record\n'), { ...NODE, limits: { ...COVERAGE_LIMITS, lines: 1 } }).reason, /more than 1 lines/);
});

test('16b T5: diff coverage: measurable lines, covered and not, unmeasured files apart, the path filter, an empty change', () => {
  const coverage = { files: { 'src/a.ts': { 1: 1, 2: 0, 3: 4, 7: 0 }, 'src/empty.ts': {} } };
  const changed = { files: [
    { path: 'src/a.ts', status: 'modified', added: [2, 3, 4, 7], removed: [5], binary: false },
    { path: 'src/new.ts', status: 'added', added: [1, 2, 3], removed: [], binary: false },
    { path: 'src/empty.ts', status: 'modified', added: [1], removed: [], binary: false },
    { path: 'img.png', status: 'modified', added: [], removed: [], binary: true },
    { path: 'src/gone.ts', status: 'deleted', added: [], removed: [1], binary: false },
  ] };
  const d = diffCoverage(changed, coverage);
  assert.deepEqual(d.files, [
    { path: 'src/a.ts', changed: 4, measurable: 3, covered: 1, uncovered: [2, 7] },
    { path: 'src/empty.ts', changed: 1, measurable: 0, covered: 0, uncovered: [] },
  ]);
  assert.deepEqual(d.unmeasured, [{ path: 'src/new.ts', changed: 3, reason: 'not-listed' }, { path: 'img.png', changed: null, reason: 'binary' }]);
  assert.deepEqual(d.total, { changed: 5, measurable: 3, covered: 1 });
  assert.deepEqual(diffCoverage(changed, coverage, { paths: ['src/**', '!src/new.ts'] }).unmeasured, []);
  assert.deepEqual(diffCoverage({ files: [] }, coverage).total, { changed: 0, measurable: 0, covered: 0 });
});

test('16b review: parsing is linear in files; Cobertura\'s element cap; several sources pick the file that exists; prototype names are files like any other', () => {
  const many = Array.from({ length: 20_000 }, (_, i) => `SF:src/f${i}.ts\nDA:1,1\nend_of_record`).join('\n');
  const t = Date.now();
  assert.equal(Object.keys(parseLcov(many, NODE).files).length, 20_000);
  assert.ok(Date.now() - t < 10_000, `${Date.now() - t} ms`);
  assert.match(readCoverage('cobertura', Buffer.from(`<coverage>${'<a/>'.repeat(50)}</coverage>`), { ...PHP, limits: { ...COVERAGE_LIMITS, elements: 20 } }).reason, /more than 20 elements/);
  const two = '<coverage><sources><source>/var/www/html/app</source><source>/var/www/html/lib</source></sources><packages><package><classes><class filename="util.php"><lines><line number="1" hits="1"/></lines></class></classes></package></packages></coverage>';
  assert.deepEqual(Object.keys(parseCobertura(two, PHP).files), ['backend/app/util.php']);
  assert.deepEqual(Object.keys(parseCobertura(two, { ...PHP, exists: (p) => p === 'backend/lib/util.php' }).files), ['backend/lib/util.php']);
  const changed = { files: ['__proto__', 'constructor', 'toString'].map((path) => ({ path, status: 'added', added: [1], removed: [], binary: false })) };
  const d = diffCoverage(changed, JSON.parse('{"files":{}}'));
  assert.deepEqual(d.unmeasured.map((f) => f.path), ['__proto__', 'constructor', 'toString']);
  // A binary file and a too-large one are apart, never left out.
  const b = diffCoverage({ files: [{ path: 'a.js', status: 'modified', added: [], removed: [], binary: true }, { path: 'big.js', status: 'added', added: [], removed: [], binary: false, too_large: true }, { path: 'gone.png', status: 'deleted', added: [], removed: [], binary: true }] }, { files: {} });
  assert.deepEqual(b.unmeasured, [{ path: 'a.js', changed: null, reason: 'binary' }, { path: 'big.js', changed: null, reason: 'too-large' }]);
});
