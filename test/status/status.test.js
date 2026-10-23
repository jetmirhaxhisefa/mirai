import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MACHINES, TICKET, RUN, EPIC, DOCUMENT, PARK_REASONS, UNPARK_CHOICES } from '../../src/status/machines.js';
import { move, movesFrom } from '../../src/status/move.js';
import { deriveTicketState, isDependencySatisfied } from '../../src/status/derive.js';
import { parseStatusFile, serializeStatusFile } from '../../src/status/ticket-file.js';
import { checkDocumentState, nextDraftName } from '../../src/status/documents.js';
import { loadRegistry } from '../../src/config/registry.js';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StatusError, ConfigError } from '../../src/cli/errors.js';
import { EXIT } from '../../src/cli/exit-codes.js';

// Everything a rule could need, so T1 tests only "is this pair allowed".
function fullContext(rule) {
  return {
    by: rule.by[0],
    reason: 'plan-rejected',
    note: 'checked by hand',
    park_reason: 'cap',
    choice: rule.choice,
  };
}

function refused(fn, code) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof StatusError, String(err));
    if (code) assert.equal(err.code, code, err.message);
    return err;
  }
  return assert.fail('expected the move to be refused');
}

test('T1: every allowed move succeeds and every other pair is refused, in all four machines', () => {
  let allowed = 0;
  let refusedCount = 0;
  for (const machine of Object.values(MACHINES)) {
    for (const from of machine.states) {
      for (const to of machine.states) {
        const rules = machine.moves.filter((m) => m.from === from && m.to === to);
        if (rules.length > 0) {
          for (const rule of rules) {
            for (const by of rule.by) {
              const result = move(machine, from, to, { ...fullContext(rule), by });
              assert.equal(result.state, to, `${machine.name}: ${from} → ${to} by ${by}`);
            }
            allowed += 1;
          }
        } else {
          for (const by of ['human', 'script']) {
            const err = refused(() => move(machine, from, to, { by, reason: 'plan-rejected', note: 'x', park_reason: 'cap', choice: 'retry' }));
            assert.ok(['not-allowed', 'derived'].includes(err.code), `${machine.name}: ${from} → ${to} refused for ${err.code}`);
          }
          refusedCount += 1;
        }
      }
    }
  }
  assert.equal(allowed, Object.values(MACHINES).reduce((n, m) => n + m.moves.length, 0));
  assert.ok(refusedCount > 100, `only ${refusedCount} pairs refused`);
  // The machines are data that can't be changed at run time.
  assert.ok(Object.isFrozen(TICKET.moves) && Object.isFrozen(TICKET.moves[0]));
});

test('T2: human-only moves need a human; agents never move a status', () => {
  const humanOnly = Object.values(MACHINES).flatMap((m) => m.moves.filter((r) => r.by.length === 1 && r.by[0] === 'human').map((r) => [m, r]));
  assert.ok(humanOnly.length >= 15);
  for (const [machine, rule] of humanOnly) {
    for (const by of ['script', 'agent', undefined]) {
      refused(() => move(machine, rule.from, rule.to, { ...fullContext(rule), by }), 'human-only');
    }
  }
  for (const machine of Object.values(MACHINES)) {
    for (const rule of machine.moves) refused(() => move(machine, rule.from, rule.to, { ...fullContext(rule), by: 'agent' }));
  }
  const err = refused(() => move(DOCUMENT, 'in-review', 'approved', { by: 'script', item: 'prd' }));
  assert.equal(err.message, 'prd: in-review → approved needs a human (D-17)');
  assert.equal(err.exitCode, EXIT.BLOCKED);
});

test('T3: built, integrated and done can never be written', () => {
  for (const to of TICKET.derived) {
    for (const from of TICKET.states) {
      refused(() => move(TICKET, from, to, { by: 'human', note: 'x' }), 'derived');
    }
  }
  assert.equal(refused(() => move(TICKET, 'in-review', 'done', { by: 'script', item: 'T-12' })).message,
    'T-12: in-review → done is not allowed (done is derived from facts, never written)');
});

test('T4: unpark needs a note and a matching choice; parking needs a park reason', () => {
  for (const [choice, to] of Object.entries(UNPARK_CHOICES)) {
    assert.equal(move(TICKET, 'blocked', to, { by: 'human', note: 'raised the budget', choice }).state, to);
    refused(() => move(TICKET, 'blocked', to, { by: 'human', choice }), 'missing');
    refused(() => move(TICKET, 'blocked', to, { by: 'human', note: '   ', choice }), 'missing');
  }
  refused(() => move(TICKET, 'blocked', 'dropped', { by: 'human', note: 'x', choice: 'retry' }), 'missing');
  assert.equal(Object.keys(UNPARK_CHOICES).length, 3, 'three choices: re-plan, retry, drop');
  for (const from of ['in-progress', 'in-review', 'waiting']) {
    refused(() => move(TICKET, from, 'blocked', { by: 'script' }), 'missing');
    refused(() => move(TICKET, from, 'blocked', { by: 'script', park_reason: 'tired' }), 'missing');
    for (const park_reason of PARK_REASONS) assert.equal(move(TICKET, from, 'blocked', { by: 'script', park_reason }).record.park_reason, park_reason);
  }
});

test('T5: a bad plan gets one re-plan, then the ticket is parked', () => {
  assert.equal(move(TICKET, 'in-progress', 'ready-for-dev', { by: 'script', reason: 'bad-plan', replans: 0 }).state, 'ready-for-dev');
  refused(() => move(TICKET, 'in-progress', 'ready-for-dev', { by: 'script', reason: 'bad-plan', replans: 1 }), 'replan-limit');
  refused(() => move(TICKET, 'in-progress', 'ready-for-dev', { by: 'script', reason: 'plan-rejected', replans: 5 }), 'replan-limit');
  assert.equal(move(TICKET, 'in-progress', 'ready-for-dev', { by: 'human', reason: 'plan-rejected', replans: 1 }).state, 'ready-for-dev', 'you can always reject a plan');
  refused(() => move(TICKET, 'in-progress', 'ready-for-dev', { by: 'script' }), 'missing');
});

const status = (state, seq = 10, extra = {}) => ({ schema_version: 1, ticket: 'T-1', state, seq, written_at: '2026-10-23T20:00:00Z', written_by: 'script', ...extra });

test('T6: derived states win over the status file, ordered by journal seq', () => {
  assert.equal(deriveTicketState(status('blocked', 99, { park_reason: 'cap' }), { mr: 'merged', mergedInto: 'integration' }).state, 'done');
  assert.equal(deriveTicketState(status('in-progress'), { mr: 'merged', mergedInto: 'epic' }).state, 'integrated');
  assert.equal(deriveTicketState(status('in-progress'), { mr: 'merged', mergedInto: 'epic', epicMerged: true }).state, 'done');
  assert.deepEqual(deriveTicketState(status('in-review', 10), { mr: 'open', proofsValidAtHead: true, pushSeq: 20 }),
    { state: 'built', source: 'derived', why: 'MR open with valid proofs at its head' });
  for (const state of ['in-progress', 'in-review', 'waiting']) {
    assert.equal(deriveTicketState(status(state, 30), { mr: 'open', proofsValidAtHead: true, pushSeq: 20 }).state, state, `${state} written after the push`);
    assert.equal(deriveTicketState(status(state, 10), { mr: 'open', proofsValidAtHead: true, pushSeq: 20 }).state, 'built', `${state} before the push`);
  }
  assert.equal(deriveTicketState(status('blocked', 30, { park_reason: 'rebase-conflict' }), { mr: 'open', proofsValidAtHead: true, pushSeq: 20 }).state, 'blocked');
  assert.equal(deriveTicketState(status('in-review', 20), { mr: 'open', proofsValidAtHead: true, pushSeq: 20 }).state, 'built', 'equal seq: the push wins (no clock ties)');
  assert.equal(deriveTicketState(status('in-review'), { mr: 'open', proofsValidAtHead: false, pushSeq: 20 }).state, 'in-review', 'no valid proofs, no built');
  assert.equal(deriveTicketState(status('ready-for-dev'), { mr: 'none' }).source, 'written');
  assert.equal(deriveTicketState(null, {}).state, 'draft');
});

test('T6b: a closed MR waits for your decision, which then takes over', () => {
  const closed = deriveTicketState(status('in-review', 10), { mr: 'closed', closeSeq: 20 });
  assert.deepEqual(closed, { state: 'built', source: 'derived', why: 'MR closed, waiting for your decision (send back or drop)' });
  // From there your moves are possible, and once written they show.
  assert.equal(move(TICKET, closed.state, 'dropped', { by: 'human' }).state, 'dropped');
  assert.equal(move(TICKET, closed.state, 'ready-for-dev', { by: 'human', note: 'split it first' }).state, 'ready-for-dev');
  assert.equal(deriveTicketState(status('dropped', 30), { mr: 'closed', closeSeq: 20 }).state, 'dropped');
  assert.equal(deriveTicketState(status('ready-for-dev', 30), { mr: 'closed', closeSeq: 20 }).state, 'ready-for-dev');
});

test('T6c: malformed facts throw instead of falling back to a written state', () => {
  const blocked = status('blocked', 99, { park_reason: 'cap' });
  for (const facts of [
    { mr: 'merged' },
    { mr: 'merged', mergedInto: 'main' },
    { mr: 'MERGED', mergedInto: 'integration' },
    { mr: 'open', proofsValidAtHead: true },
    { mr: 'open', pushSeq: '20' },
    { mr: 'closed' },
    { mr: 'merged', mergedInto: 'epic', epicMerged: 'yes' },
  ]) {
    const err = refused(() => deriveTicketState(blocked, facts), 'bad-facts');
    assert.equal(err.exitCode, EXIT.BLOCKED, JSON.stringify(facts));
  }
  refused(() => deriveTicketState(status('dropped', 30), { mr: 'open', proofsValidAtHead: true, pushSeq: 20 }), 'bad-facts');
});

test('T7: a dependency is satisfied by done, or by integrated inside the same together epic', () => {
  assert.equal(isDependencySatisfied('done'), true);
  assert.equal(isDependencySatisfied('integrated', { sameTogetherEpic: true }), true);
  assert.equal(isDependencySatisfied('integrated'), false);
  for (const state of ['built', 'in-review', 'blocked', 'waiting']) assert.equal(isDependencySatisfied(state, { sameTogetherEpic: true }), false, state);
  // End to end: a together epic with one integrated ticket unblocks the next one.
  const first = deriveTicketState(status('in-review'), { mr: 'merged', mergedInto: 'epic' });
  assert.equal(isDependencySatisfied('integrated', { sameTogetherEpic: 'yes' }), false, 'only a real true counts');
  assert.equal(isDependencySatisfied(first.state, { sameTogetherEpic: true }), true);
});

test('T8: the run machine', () => {
  let s = 'running';
  for (const [to, by] of [['paused', 'script'], ['running', 'script'], ['stopped', 'human'], ['running', 'human'], ['finished', 'script']]) {
    s = move(RUN, s, to, { by }).state;
  }
  assert.equal(s, 'finished');
  for (const to of RUN.states) refused(() => move(RUN, 'finished', to, { by: 'human' }));
  refused(() => move(RUN, 'stopped', 'running', { by: 'script' }), 'human-only');
  assert.equal(move(RUN, 'paused', 'stopped', { by: 'script' }).state, 'stopped');
});

test('T9: the epic machine, with its human-only moves', () => {
  let s = 'open';
  for (const to of ['integrating', 'final-e2e', 'final-e2e-failed']) s = move(EPIC, s, to, { by: 'script' }).state;
  refused(() => move(EPIC, s, 'integrating', { by: 'script' }), 'human-only');
  s = move(EPIC, s, 'integrating', { by: 'human' }).state;
  s = move(EPIC, move(EPIC, s, 'final-e2e', { by: 'script' }).state, 'ready-to-merge', { by: 'script' }).state;
  refused(() => move(EPIC, s, 'done', { by: 'script' }), 'human-only');
  assert.equal(move(EPIC, s, 'done', { by: 'human' }).state, 'done');
});

test('T10: the status file round-trips and refuses bad content with positions', () => {
  const good = status('blocked', 12, { park_reason: 'repeat', replans: 1, note: 'same failure twice' });
  const text = serializeStatusFile(good);
  assert.deepEqual({ ...parseStatusFile(text) }, good);
  assert.equal(text.split('\n')[1], '  "schema_version": 1,', 'one key per line, fixed order');
  assert.ok(!serializeStatusFile({ ...status('in-progress'), note: null }).includes('note'), 'empty fields are left out');

  const bad = (obj) => {
    try {
      parseStatusFile(`${JSON.stringify(obj, null, 2)}\n`, { source: 'tickets/T-1/status.json' });
    } catch (err) {
      assert.ok(err instanceof ConfigError);
      return err.errors;
    }
    return assert.fail('expected the file to be refused');
  };
  assert.deepEqual(bad({ ...status('in-progress'), colour: 'red' }).map((e) => [e.code, e.line]), [['unknown-key', 8]]);
  assert.deepEqual(bad(status('blocked')).map((e) => e.code), ['required']);
  assert.deepEqual(bad(status('in-progress', 10, { park_reason: 'cap' })).map((e) => e.code), ['invalid']);
  assert.deepEqual(bad(status('done')).map((e) => [e.code, e.path]), [['enum', 'state']], 'a derived state is not writable');
  for (const t of ['2026-13-45T99:00:00Z', '2026-02-30T00:00:00Z', '2026-10-23T24:00:00Z']) {
    assert.deepEqual(bad({ ...status('in-progress'), written_at: t }).map((e) => e.path), ['written_at'], t);
  }
  assert.deepEqual(bad({ ...status('in-progress'), written_at: '23 Oct 2026' }).map((e) => e.code), ['pattern']);
  assert.deepEqual(bad({ ...status('in-progress'), seq: undefined }).map((e) => e.code), ['required']);
  // A value that contains a key name doesn't move the position.
  assert.deepEqual(bad({ ...status('done'), ticket: 'state' }).map((e) => [e.path, e.line]), [['state', 4]]);
  // null means "no note".
  assert.equal(parseStatusFile(`${JSON.stringify({ ...status('in-progress'), note: null }, null, 2)}\n`).note, undefined);
  assert.deepEqual(bad({ ...status('in-progress'), replans: 2 }).map((e) => e.code), ['range']);
  assert.throws(() => parseStatusFile('{ "state": ', { source: 's.json' }), /s\.json:1:\d+: not valid JSON/);
  assert.throws(() => serializeStatusFile(status('built')), ConfigError, 'serialize refuses what parse refuses');
  assert.throws(() => serializeStatusFile({ ...status('in-progress'), notes: 'typo' }), /unknown key "notes"/);
  const twice = '{\n  "schema_version": 1,\n  "ticket": "T-1",\n  "state": "done",\n  "seq": 1,\n  "written_at": "2026-10-23T20:00:00Z",\n  "written_by": "script",\n  "state": "in-progress"\n}\n';
  assert.throws(() => parseStatusFile(twice, { source: 's.json' }), /s\.json:8:3: the key "state" appears twice/);
  assert.throws(() => parseStatusFile(`${JSON.stringify({ ...status('in-progress'), schema_version: 2 }, null, 2)}\n`), /written by a newer MIRAI/);
  assert.throws(() => parseStatusFile(`{"note":"${'x'.repeat(17000)}"}`), /larger than/);
});

test('T11: documents: frontmatter matches history; frozen versions; no way back from approved', () => {
  const history = [{ from: 'draft', to: 'in-review' }, { from: 'in-review', to: 'approved' }];
  assert.equal(checkDocumentState('approved', history), 'approved');
  assert.equal(checkDocumentState('draft', []), 'draft');
  const mismatch = refused(() => checkDocumentState('draft', history, { item: 'prd' }), 'mismatch');
  assert.equal(mismatch.message, 'prd: the frontmatter says draft, but the history ends at approved');
  refused(() => checkDocumentState('approved', [{ from: 'draft', to: 'approved' }]), 'mismatch');
  refused(() => checkDocumentState('in-review', [{ from: 'in-review', to: 'in-review' }]), 'mismatch');
  assert.equal(nextDraftName('docs/mirai/payments/prd.md', 2), 'docs/mirai/payments/prd.v2.draft.md');
  assert.equal(nextDraftName('prd.v2.draft.md', 3), 'prd.v3.draft.md');
  assert.throws(() => nextDraftName('prd.md', 1), RangeError);
  assert.throws(() => nextDraftName('prd.v3.draft.md', 2), /not newer/);
  assert.throws(() => nextDraftName('.md', 2), RangeError);
  refused(() => checkDocumentState('approved', [{ from: 'draft', to: 'in-review', by: 'script' }, { from: 'in-review', to: 'approved', by: 'agent' }]), 'mismatch');
  refused(() => checkDocumentState('approved', [{ from: 'draft', to: 'in-review' }, { from: 'in-review', to: 'approved', by: 'script' }]), 'mismatch');
  assert.equal(checkDocumentState('approved', [{ from: 'draft', to: 'in-review', by: 'script' }, { from: 'in-review', to: 'approved', by: 'human' }]), 'approved');
  refused(() => checkDocumentState('draft', null), 'mismatch');
  refused(() => move(DOCUMENT, 'approved', 'draft', { by: 'human' }), 'not-allowed');
  refused(() => move(DOCUMENT, 'approved', 'in-review', { by: 'human' }), 'not-allowed');
});

test('T12: StatusError shape, and movesFrom for menus', () => {
  const err = refused(() => move(TICKET, 'ready-for-dev', 'in-review', { by: 'script', item: 'T-7' }), 'not-allowed');
  assert.equal(err.exitCode, EXIT.BLOCKED);
  assert.deepEqual([err.machine, err.item, err.from, err.to], ['ticket', 'T-7', 'ready-for-dev', 'in-review']);
  assert.equal(err.message, 'T-7: ready-for-dev → in-review is not allowed in the ticket machine');
  refused(() => move(TICKET, 'nowhere', 'draft', { by: 'human' }), 'unknown-state');
  assert.deepEqual(movesFrom(TICKET, 'blocked', 'human').map((m) => m.choice).sort(), ['drop', 're-plan', 'retry']);
  assert.deepEqual(movesFrom(TICKET, 'blocked', 'script'), []);
});

test('T13: text from files is shown safely in messages', () => {
  const err = refused(() => move(TICKET, 'ready-for-dev', 'in-review', { by: 'script', item: '\x1b[31mT-1' }));
  assert.ok(!err.message.includes('\x1b'), 'no raw escape character reaches the terminal');
  assert.match(err.message, /^"\\u001b\[31mT-1": /);
  refused(() => move(TICKET, 'ready-for-dev', 'in-progress', { by: Symbol('x') }), 'not-allowed');
  // The context is read once: a getter can't pass the check and then change the record.
  let reads = 0;
  const tricky = { by: 'human', choice: 'retry', get note() { reads += 1; return reads === 1 ? 'ok' : ''; } };
  assert.equal(move(TICKET, 'blocked', 'in-progress', tricky).record.note, 'ok');
});

test('T14: the document machine fits the registry\'s definition shape (unit 37 can move it to data)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mirai-04-reg-'));
  mkdirSync(join(dir, 'document-types'));
  mkdirSync(join(dir, 'templates'));
  writeFileSync(join(dir, 'templates', 'doc.md'), '# Doc\n');
  const transitions = DOCUMENT.moves.map((m) => `[[states.transitions]]\nfrom = "${m.from}"\nto = "${m.to}"\nhuman_only = ${m.by.length === 1 && m.by[0] === 'human'}\n`).join('');
  writeFileSync(join(dir, 'document-types', 'doc.toml'), [
    'kind = "document-type"', 'schema_version = 1', 'name = "doc"', 'template = "templates/doc.md"',
    'checklist = "templates/doc.md"', 'required_sections = ["Summary"]', '[states]',
    `names = [${DOCUMENT.states.map((x) => `"${x}"`).join(', ')}]`, `initial = "${DOCUMENT.initial}"`, transitions,
  ].join('\n'));
  const reg = loadRegistry(dir);
  assert.equal(reg.documentTypes.doc.states.transitions.length, DOCUMENT.moves.length);
});
