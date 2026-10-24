import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { compileSchema, parseJsonStrict, SchemaError, LIMITS } from '../../src/findings/schema.js';
import { checkReviewVerdict, checkReplies, checkFindingCheck, checkQaVerdict, checkGateResult, SCHEMAS, SCHEMA_DIR } from '../../src/findings/verdicts.js';
import { findingFingerprint, failureSignature, resolveBasis, triage, basisForLog } from '../../src/findings/findings.js';
import { buildRunLine } from '../../src/store/run-log.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, 'corpus');
const CHECK = { 'review-verdict': checkReviewVerdict, 'finding-replies': checkReplies, 'finding-check': checkFindingCheck, 'qa-verdict': checkQaVerdict, 'gate-result': checkGateResult };
const files = (dir, ext) => readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)).sort();
const read = (...p) => readFileSync(join(CORPUS, ...p), 'utf8');

test('T1: the corpus: valid outputs pass their schema; invalid ones fail at their path with their code', () => {
  assert.deepEqual(Object.keys(CHECK).sort(), [...SCHEMAS].sort());
  let valid = 0;
  let invalid = 0;
  for (const schema of SCHEMAS) {
    for (const name of files(join(CORPUS, 'valid', schema), '.json')) {
      const r = CHECK[schema](read('valid', schema, `${name}.json`));
      assert.ok(r.ok, `${schema}/${name}: ${JSON.stringify(r.problems)}`);
      valid += 1;
    }
    const codes = new Set();
    for (const name of files(join(CORPUS, 'invalid', schema), '.json')) {
      const text = read('invalid', schema, `${name}.json`);
      // One case passes an object from JSON.parse, which must be refused: only text or a
      // strictly parsed value is checked.
      const r = CHECK[schema](name === 'parsed-object' ? JSON.parse(text) : text);
      const want = read('invalid', schema, `${name}.err`).trim();
      assert.equal(r.ok, false, `${schema}/${name} passed`);
      assert.ok(r.problems.some((p) => `${p.path} ${p.code}` === want), `${schema}/${name}: want ${want}, got ${JSON.stringify(r.problems)}`);
      // A reason never repeats the output's text.
      assert.doesNotMatch(JSON.stringify(r.problems), /Ignore the rules|opinion|hunter2|trust me|tset/);
      codes.add(want.split(' ')[1]);
      invalid += 1;
    }
    assert.ok(codes.size >= 2, `${schema}: the corpus covers only ${[...codes]}`);
  }
  assert.ok(valid >= 18 && invalid >= 69, `${valid} valid, ${invalid} invalid`);
  // A parse error says what went wrong.
  assert.match(checkReviewVerdict(read('invalid', 'review-verdict', 'duplicate-json-key.json')).problems[0].reason, /twice/);
  assert.match(checkReviewVerdict(read('invalid', 'review-verdict', 'lone-surrogate.json')).problems[0].reason, /surrogate/);
  assert.match(checkReviewVerdict(read('invalid', 'review-verdict', 'long-number.json')).problems[0].reason, /too long/);
  // Parsed output has no prototype.
  assert.equal(Object.getPrototypeOf(checkGateResult(read('valid', 'gate-result', 'pass.json')).value), null);
});

test('T2: the validator: the keywords it supports, the ones it refuses, strict JSON', () => {
  const v = compileSchema({
    type: 'object', additionalProperties: false, required: ['a'],
    properties: {
      a: { type: 'string', minLength: 2, maxLength: 3, pattern: '^[a-z]+$' },
      n: { type: 'integer', minimum: 1, maximum: 5 },
      x: { type: 'number' }, b: { type: 'boolean' }, z: { type: 'null' }, c: { const: 'k' }, e: { enum: [1, 'two'] },
      l: { type: 'array', minItems: 1, maxItems: 2, items: { $ref: '#/$defs/s' } },
    },
    $defs: { s: { type: 'string', maxLength: 1 } },
  });
  assert.deepEqual(v({ a: 'ok', n: 3, x: 1.5, b: true, z: null, c: 'k', e: 'two', l: ['q'] }), []);
  const codes = (value) => v(value).map((p) => `${p.path} ${p.code}`);
  assert.deepEqual(codes({}), ['/a required']);
  assert.deepEqual(codes({ a: 'a' }), ['/a length']);
  assert.deepEqual(codes({ a: 'abcd' }), ['/a length']);
  assert.deepEqual(codes({ a: 'AB' }), ['/a pattern']);
  assert.deepEqual(codes({ a: 'ok', n: 2.5 }), ['/n type']);
  assert.deepEqual(codes({ a: 'ok', n: 9 }), ['/n range']);
  assert.deepEqual(codes({ a: 'ok', x: '1' }), ['/x type']);
  assert.deepEqual(codes({ a: 'ok', c: 'q' }), ['/c const']);
  assert.deepEqual(codes({ a: 'ok', e: 3 }), ['/e enum']);
  assert.deepEqual(codes({ a: 'ok', l: [] }), ['/l items']);
  assert.deepEqual(codes({ a: 'ok', l: ['a', 'b', 'c'] }), ['/l items']);
  assert.deepEqual(codes({ a: 'ok', l: ['ab'] }), ['/l/0 length']);
  assert.deepEqual(codes({ a: 'ok', other: 1 }), ['/other unknown-key']);
  assert.deepEqual(codes({ a: 'ok', 'a/b~': 1 }), ['/<key> unknown-key']);
  assert.deepEqual(codes([]), ['/ type']);
  // Lengths count characters, not UTF-16 units.
  assert.deepEqual(codes({ a: '😀😀' }), ['/a pattern']);

  // A schema can't ask for a check the validator would skip.
  const obj = (properties) => ({ type: 'object', additionalProperties: false, properties });
  for (const bad of [{ type: 'object', additionalProperties: false, oneOf: [] }, { type: 'object', properties: {} }, { type: 'string' }, { type: 'array', items: { const: 1 } },
    { type: 'thing' }, { $ref: '#/$defs/none' }, { type: 'string', maxLength: 3, pattern: '(' }, { type: 'object', additionalProperties: true },
    obj({ x: {} }), { properties: {}, additionalProperties: false }, { $ref: '#/$defs/a', maxLength: 0, $defs: { a: { const: 1 } } },
    { enum: [{ a: 1 }] }, { type: 'object', additionalProperties: false, properties: {}, required: 'ab' }, { type: 'string', maxLength: '3' },
    { type: 'string', maxLength: 3, enum: ['a'] }, { type: 'string', maxLength: 3, minimum: 1 }, { type: 'array', maxItems: 2 },
    { $ref: '#/$defs/a', $defs: { a: { $ref: '#/$defs/a' } } }, obj({ x: { const: 1, $defs: {} } })]) {
    assert.throws(() => compileSchema(bad), (err) => err instanceof SchemaError || err instanceof SyntaxError, JSON.stringify(bad));
  }
  // MIRAI's own schemas compile and are valid JSON Schema documents for `claude --json-schema`.
  for (const name of SCHEMAS) {
    const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, `${name}.json`), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.$id, `mirai/${name}/1`);
    compileSchema(schema);
  }

  // Strict JSON: duplicate keys, trailing text, depth, size, non-finite numbers.
  assert.throws(() => parseJsonStrict('{"a": 1, "a": 2}'), /twice/);
  assert.throws(() => parseJsonStrict('{"a": 1} trailing'), /after the value/);
  assert.throws(() => parseJsonStrict(`${'['.repeat(LIMITS.depth + 2)}${']'.repeat(LIMITS.depth + 2)}`), /deeper/);
  assert.throws(() => parseJsonStrict(`"${'x'.repeat(LIMITS.bytes)}"`), /larger/);
  assert.throws(() => parseJsonStrict('1e999'), /out of range/);
  assert.throws(() => parseJsonStrict('{"a": "\u0001"}'), /control/);
  assert.throws(() => parseJsonStrict('"\\ud800"'), /surrogate/);
  assert.throws(() => parseJsonStrict(`1${'0'.repeat(70)}`), /too long/);
  assert.throws(() => parseJsonStrict('{"a": 1}', { maxBytes: 4 }), /larger than 4/);
  assert.equal(parseJsonStrict(`${'['.repeat(LIMITS.depth)}${']'.repeat(LIMITS.depth)}`).length, 1);
  // $ref chains resolve to the end.
  const chained = compileSchema({ ...obj({ x: { $ref: '#/$defs/a' } }), $defs: { a: { $ref: '#/$defs/b' }, b: { type: 'string', maxLength: 2 } } });
  assert.deepEqual(chained({ x: 'abc' }).map((p) => p.code), ['length']);
  assert.deepEqual(chained({ x: ['huge'] }).map((p) => p.code), ['type']);
  assert.deepEqual({ ...parseJsonStrict('{"a": [1, true, null, "\\u00e9"], "b": {}}') }, { a: [1, true, null, 'é'], b: parseJsonStrict('{}') });
});

const F = (over = {}) => ({ id: 'F1', severity: 'blocking', category: 'correctness', file: 'app/Actions/RenameTeam.php', line: 42, symbol: 'RenameTeam::handle', basis: { kind: 'ac', ref: 'AC-PMT-31.1' }, claim: 'x', ...over });
const CTX = { acs: ['AC-PMT-31.1', 'AC-PMT-31.2'], adrs: ['ADR-3'], rules: ['conv-no-raw-sql'] };
const verdict = (...findings) => ({ verdict: 'changes', findings });

test('T3: a finding without a citation or a resolvable basis is downgraded; changed lines make others pre-existing', () => {
  const cases = [
    [F(), null],
    [F({ basis: { kind: 'adr', ref: 'ADR-3' } }), null],
    [F({ basis: { kind: 'rule', ref: 'conv-no-raw-sql' } }), null],
    [F({ basis: { kind: 'repro', ref: 'php artisan test --filter=TeamRenameTest' } }), 'repro-not-run'],
    [F({ basis: { kind: 'repro', ref: 'trust me, this is wrong' } }), 'repro-not-run'],
    [F({ file: undefined }), 'no-citation'],
    [F({ line: undefined }), 'no-citation'],
    [F({ line: '42' }), 'no-citation'],
    [F({ symbol: undefined }), 'no-symbol'],
    [F({ basis: undefined }), 'no-basis'],
    [F({ basis: { kind: 'ac', ref: 'AC-PMT-99.1' } }), 'unresolved-basis'],
    [F({ basis: { kind: 'adr', ref: 'ADR-9' } }), 'unresolved-basis'],
    [F({ basis: { kind: 'rule', ref: 'conv-made-up' } }), 'unresolved-basis'],
    [F({ basis: { kind: 'repro', ref: 'echo a\necho b' } }), 'repro-not-run'],
  ];
  for (const [finding, reason] of cases) {
    const [out] = triage({ verdict: 'changes', findings: [finding] }, CTX).findings;
    assert.equal(out.downgraded, reason !== null, JSON.stringify(finding.basis ?? finding));
    assert.equal(out.severity, reason ? 'should-fix' : 'blocking');
    assert.equal(out.downgrade_reason, reason ?? undefined);
  }
  // Rules can't block until the project has convention rules.
  assert.equal(triage({ verdict: 'changes', findings: [F({ basis: { kind: 'rule', ref: 'conv-no-raw-sql' } })] }, { acs: CTX.acs }).blocking.length, 0);
  // With the changed lines known, a finding outside them is pre-existing.
  const changedLines = new Map([['app/Actions/RenameTeam.php', new Set([40, 41, 42])]]);
  const r = triage({ verdict: 'changes', findings: [F(), F({ id: 'F2', line: 7 }), F({ id: 'F3', file: 'app/Other.php' }), F({ id: 'F4', severity: 'nit', basis: undefined })] }, { ...CTX, changedLines });
  assert.deepEqual(r.findings.map((f) => f.downgrade_reason ?? f.severity), ['blocking', 'pre-existing', 'pre-existing', 'nit']);
  assert.deepEqual(r.blocking, ['F1']);
  assert.deepEqual(r.followups, ['F2', 'F3', 'F4']);
  // changedLines may be a plain object, with paths in any spelling.
  assert.deepEqual(triage(verdict(F()), { ...CTX, changedLines: { './app//Actions/RenameTeam.php': [42] } }).blocking, ['F1']);

  // Round 2 (L2): a carried-over blocker stands wherever it is; a new finding stands only if
  // it's blocking and inside the delta; the whole diff, not the delta, decides pre-existing.
  const round2 = { ...CTX, changedLines, round: 2, priorBlocking: ['F1'], delta: new Map([['app/Actions/RenameTeam.php', new Set([41])]]) };
  const r2 = triage(verdict(F({ id: 'R1', prior: 'F1' }), F({ id: 'R2', line: 41 }), F({ id: 'R3', line: 40 }), F({ id: 'R4', prior: 'F9', line: 41 }), F({ id: 'R5', severity: 'nit', line: 41 })), round2);
  assert.deepEqual(r2.findings.map((f) => f.downgrade_reason ?? f.severity), ['blocking', 'blocking', 'frozen', 'blocking', 'frozen']);
  assert.deepEqual(r2.blocking, ['R1', 'R2', 'R4']);
  // High risk: a blocking finding the per-finding check doesn't confirm is downgraded.
  const checked = triage(verdict(F(), F({ id: 'F2', line: 41 }), F({ id: 'F3', line: 40 })), { ...CTX, confirmations: { F1: 'medium', F2: 'maybe-false' } });
  assert.deepEqual(checked.findings.map((f) => f.downgrade_reason ?? f.severity), ['blocking', 'unconfirmed', 'unconfirmed']);
  // Two findings that share a fingerprint in one verdict are reported.
  assert.deepEqual(triage(verdict(F(), F({ id: 'F2', line: 99 }), F({ id: 'F3', symbol: 'Other::x' })), CTX).duplicates, [['F1', 'F2']]);
  // resolveBasis on its own.
  assert.deepEqual(resolveBasis({ kind: 'opinion', ref: 'x' }, CTX), { ok: false, code: 'unresolved-basis', reason: 'unknown basis kind' });
  assert.equal(resolveBasis(undefined).ok, false);
});

test('T4: fingerprints: file + symbol + basis, never the line; the run log takes them', () => {
  const a = findingFingerprint(F());
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(findingFingerprint(F({ line: 99, claim: 'said differently', id: 'F7', severity: 'nit' })), a);
  assert.equal(findingFingerprint(F({ file: './app/Actions/RenameTeam.php' })), a);
  assert.equal(findingFingerprint(F({ file: 'app//Actions/./RenameTeam.php' })), a);
  assert.equal(findingFingerprint(F({ symbol: '  RenameTeam::handle ' })), a);
  assert.equal(findingFingerprint(F({ symbol: 'RenameTeam::handle()' })), a);
  // A repro's wording isn't part of it, so rewording one doesn't dodge "the same failure twice".
  assert.equal(findingFingerprint(F({ basis: { kind: 'repro', ref: 'npm test' } })), findingFingerprint(F({ basis: { kind: 'repro', ref: 'npm test -- --run' } })));
  assert.notEqual(findingFingerprint(F({ symbol: 'RenameTeam::other' })), a);
  assert.notEqual(findingFingerprint(F({ file: 'app/Actions/Other.php' })), a);
  assert.notEqual(findingFingerprint(F({ basis: { kind: 'ac', ref: 'AC-PMT-31.2' } })), a);
  // The kind is part of it: an AC and a rule with the same ID don't collide.
  assert.notEqual(findingFingerprint(F({ basis: { kind: 'rule', ref: 'AC-PMT-31.1' } })), a);
  // The run log accepts the fingerprint and the basis as it stores it.
  const repro = F({ basis: { kind: 'repro', ref: 'php artisan test --filter="Team Rename"' } });
  // Boundary values the schema accepts are accepted by the run log too.
  const longest = F({ file: `${'😀'.repeat(255)}x`, symbol: 's'.repeat(256), id: 'x'.repeat(64) });
  assert.ok(checkReviewVerdict(JSON.stringify(verdict(longest))).ok);
  for (const f of [F(), repro, longest]) {
    const line = buildRunLine('r-20261024-010203-abc1', 5, {
      item: 'PMT-31', event: 'finding', id: f.id, round: 1, severity: f.severity, category: f.category, file: f.file, line: f.line, symbol: f.symbol,
      basis_ref: basisForLog(f.basis), fingerprint: findingFingerprint(f), text_ref: { ref: 'tickets/PMT-31/review-r1.json', sha256: 'b'.repeat(64) },
    });
    assert.match(line, /"event":"finding"/);
  }
  assert.equal(basisForLog(F().basis), 'ac:AC-PMT-31.1');
  assert.match(basisForLog(repro.basis), /^repro:sha256-[0-9a-f]{16}$/);
});

test('T5: failure signatures: runs that differ only in times, durations, ids and paths match; results don\'t', () => {
  const one = failureSignature({ test: 'TeamRenameTest::test_members_stay', message: 'Failed asserting that 0 matches expected 4.\n/Users/jet/work/app/tests/Feature/TeamRenameTest.php:31 (0.42s) at 2026-10-24T01:02:03Z run 7f3a9c2e1d' }, { root: '/Users/jet/work/app' });
  const two = failureSignature({ test: 'TeamRenameTest::test_members_stay', message: 'Failed asserting that 0 matches expected 4.\n/home/ci/build/tests/Feature/TeamRenameTest.php:33   (1.9s) at 2026-10-25T23:59:59+02:00 run 0b1c2d3e4f5a' }, { root: '/home/ci/build' });
  assert.equal(one, two);
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.notEqual(failureSignature({ test: 'TeamRenameTest::test_members_stay', message: 'Undefined index: slug' }), one);
  assert.notEqual(failureSignature({ test: 'TeamRenameTest::test_old_slug_redirects', message: 'Failed asserting that 0 matches expected 4.' }), failureSignature({ test: 'TeamRenameTest::test_members_stay', message: 'Failed asserting that 0 matches expected 4.' }));
  // Different results are different failures.
  const sig = (message, opts) => failureSignature({ test: 't', message }, opts);
  assert.notEqual(sig('expected 4, got 0'), sig('expected 0, got 4'));
  assert.notEqual(sig('expected status 200, got 500'), sig('expected status 200, got 404'));
  assert.notEqual(sig('0 matches expected 4'), sig('3 matches expected 4'));
  // UUIDs, request ids and words made of hex letters.
  assert.equal(sig('user 5f0c8a3e-1b2d-4c3e-9f8a-0123456789ab not found'), sig('user 00000000-aaaa-4bbb-8ccc-dddddddddddd not found'));
  assert.equal(sig('request 3fa9c2e17b'), sig('request 0b1c2d3e4f'));
  assert.notEqual(sig('the page was defaced'), sig('the page was effaced'));
  // The root matters: inside the repo, the path is kept.
  const root = '/Users/jet/work/app';
  assert.notEqual(sig(`${root}/app/A.php:3 failed`, { root }), sig(`${root}/lib/B.php:90 failed`, { root }));
  assert.equal(sig(`${root}/app/A.php:3 failed`, { root }), sig('/home/ci/app/app/A.php:12 failed', { root: '/home/ci/app' }));
  assert.notEqual(sig(`${root}/app/A.php failed`, { root }), sig(`${root}/app/A.php failed`));
  // A path that only starts with the root isn't inside it.
  assert.notEqual(sig('/home/ci/builder/x/y failed', { root: '/home/ci/build' }), sig('/home/ci/build/er/x/y failed', { root: '/home/ci/build' }));
  // The same test and message twice give the same signature; whitespace doesn't matter.
  assert.equal(failureSignature({ test: 't', message: 'a  b\n c' }), failureSignature({ test: 't', message: 'a b c' }));
});
