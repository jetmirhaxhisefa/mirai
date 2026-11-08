import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHECK_SCHEMA, lensesFor, lensInputs, mergeLenses, riskPathsTouched } from '../../src/review/lenses.js';
import { checkFrom } from '../../src/agent/review.js';

// Unit 24b: the high-risk review's lenses, their merge and the risk paths.

const f = (o = {}) => ({ id: 'A1', severity: 'blocking', category: 'correctness', file: 'app/Team.php', line: 4, symbol: 'rename', basis: { kind: 'ac', ref: 'AC-1.1' }, claim: 'Drops members.', ...o });

test('24b: five lenses always, the architecture lens only with an ADR to check against', () => {
  assert.deepEqual(lensesFor({ adrs: [] }), ['blind-hunter', 'edge-cases', 'verification-gap', 'intent-alignment', 'security']);
  assert.deepEqual(lensesFor({ adrs: ['ADR-3'] }).at(-1), 'architecture');
});

test('24b: each lens gets its own files: the blind hunter the diff alone, intent alignment the frozen block; index.json names exactly what is there', () => {
  const plan = 'x\n<!-- frozen:start -->\n## Intent\nKeep members.\n<!-- frozen:end -->\n';
  const all = { 'review.diff': 'd', 'review-files.json': '{}', 'plan.md': plan, 'ticket.md': 't', 'adr-adr-3.md': 'a', 'index.json': '{"old":true}' };
  const blind = lensInputs('blind-hunter', all, { plan });
  assert.deepEqual(Object.keys(blind).sort(), ['index.json', 'review-files.json', 'review.diff']);
  assert.deepEqual(JSON.parse(blind['index.json']).files.map((x) => x.name), ['review.diff', 'review-files.json']);
  const intent = lensInputs('intent-alignment', all, { plan });
  assert.equal(intent['intent.md'], '## Intent\nKeep members.\n');
  assert.ok(intent['plan.md']);
  assert.equal(lensInputs('security', all, { plan })['intent.md'], undefined);
});

test('24b: the merge: same file, symbol and basis is one finding (every lens named, the highest severity); uncited ones never merge; ids are new', () => {
  const m = mergeLenses([
    { lens: 'blind-hunter', verdict: { verdict: 'changes', findings: [f(), f({ id: 'A2', severity: 'nit', file: undefined, line: undefined, symbol: undefined, basis: undefined, claim: 'Naming.' })] } },
    { lens: 'security', verdict: { verdict: 'changes', findings: [f({ id: 'S1', line: 5, claim: 'Same thing.' }), f({ id: 'S2', severity: 'nit', file: undefined, line: undefined, symbol: undefined, basis: undefined, claim: 'Naming too.' })] } },
    { lens: 'edge-cases', verdict: { verdict: 'pass', findings: [f({ id: 'E1', severity: 'should-fix', symbol: 'slug' })] } },
  ]);
  assert.equal(m.verdict, 'changes');
  assert.deepEqual(m.findings.map((x) => x.id), ['F1', 'F2', 'F3', 'F4']);
  assert.deepEqual(m.findings[0].lenses, ['blind-hunter', 'security']);
  assert.deepEqual(m.findings[0].lens_ids, ['blind-hunter:A1', 'security:S1']);
  assert.equal(m.findings[0].line, 4, 'the first lens\'s line stays at the same severity');
  // The two uncited nits stay two findings.
  assert.equal(m.findings.filter((x) => x.severity === 'nit').length, 2);
  // A should-fix raised later as blocking takes the higher severity.
  const up = mergeLenses([
    { lens: 'edge-cases', verdict: { verdict: 'pass', findings: [f({ severity: 'should-fix' })] } },
    { lens: 'security', verdict: { verdict: 'changes', findings: [f({ id: 'S1', line: 6 })] } },
  ]);
  assert.equal(up.findings.length, 1);
  assert.equal(up.findings[0].severity, 'blocking');
  assert.equal(up.findings[0].line, 6);
  assert.equal(mergeLenses([{ lens: 'security', verdict: { verdict: 'pass', findings: [] } }]).verdict, 'pass');
});

test('24b: the check: its schema has no $id for Claude Code; one verdict per finding sent, none for another', () => {
  assert.equal(CHECK_SCHEMA.$id, undefined);
  assert.deepEqual(CHECK_SCHEMA.required, ['checks']);
  assert.ok(checkFrom({ checks: [{ id: 'F1', verdict: 'high' }] }, ['F1']).value);
  assert.match(checkFrom({ checks: [] }, ['F1']).problem, /schema/);
  assert.match(checkFrom({ checks: [{ id: 'F1', verdict: 'high' }, { id: 'F9', verdict: 'low' }] }, ['F1']).problem, /schema/);
  assert.match(checkFrom(null, ['F1']).problem, /no checks/);
});

test('24b: gate.risk.high: the changed files that match; none without patterns', () => {
  const files = [{ path: 'app/Policies/TaskPolicy.php' }, { path: 'README.md' }, { path: 'src/auth/login.js' }];
  assert.deepEqual(riskPathsTouched(['app/Policies/**', '**/auth/**'], files), ['app/Policies/TaskPolicy.php', 'src/auth/login.js']);
  assert.deepEqual(riskPathsTouched(['app/**', '!app/Policies/**'], files), []);
  assert.deepEqual(riskPathsTouched([], files), []);
  assert.deepEqual(riskPathsTouched(undefined, files), []);
});
