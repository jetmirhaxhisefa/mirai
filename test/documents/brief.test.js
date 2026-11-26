import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRegistry } from '../../src/config/registry.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { lintText } from '../../src/lint/lint.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { documentApproval } from '../../src/cli/commands/approve.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { installed } from '../tests/run-fixture.js';
import { veraBefore } from '../helpers/vera.js';

// Unit 31: the summary for approval (PM-03), the writing rules and the business brief.
const REGISTRY = loadRegistry(REGISTRY_DIR);
const EXAMPLE = readFileSync(join(REGISTRY_DIR, 'examples', 'brief.md'), 'utf8');
const TEMPLATE = readFileSync(join(REGISTRY_DIR, 'templates', 'brief.md'), 'utf8');
// Unit 35: the example brief links the interview it came from.
const INTERVIEW = readFileSync(join(REGISTRY_DIR, 'examples', 'interview.md'), 'utf8');

const lint = (text, o = {}) => lintText(text, { source: 'docs/mirai/due-dates/brief.md', registry: REGISTRY, project: { repos: ['.'] }, ...o });
const errors = (text, o) => lint(text, o).filter((p) => p.severity === 'error');
const warnings = (text, o) => lint(text, o).filter((p) => p.severity === 'warning');
const codes = (ps) => ps.map((p) => p.code);
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.replace(from, to);
};
const one = (text, code, re) => {
  const ps = errors(text).filter((p) => p.code === code);
  assert.equal(ps.length, 1, JSON.stringify(errors(text)));
  if (re) assert.match(`${ps[0].reason} | ${ps[0].hint ?? ''}`, re);
  return ps[0];
};

test('31 T1: the summary for approval: its place, its five parts in order, none empty, and The ask', () => {
  assert.deepEqual(lint(EXAMPLE), []);
  const renamed = errors(swap(EXAMPLE, '### Why\n', '### Reasons\n'));
  assert.deepEqual(codes(renamed), ['summary-part', 'summary-part']);
  assert.match(renamed[0].reason, /the summary has no "### Why"/);
  assert.match(renamed[1].reason, /"### Reasons" is not one of the summary's parts/);
  assert.ok(codes(errors(swap(swap(EXAMPLE, '### Why\n', '### TMP\n'), '### What changes\n', '### Why\n').replace('### TMP\n', '### What changes\n'))).includes('summary-order'));
  one(swap(EXAMPLE, '1. How should reminders reach people (Q-1)? Options: email only, or email and an in-app notice. Recommendation: email only, because the app has no notification system yet; an in-app notice would double the work.\n', ''), 'summary-empty', /"### Decisions for you" is empty \| list the decisions, or write: None/);
  one(swap(EXAMPLE, 'Approve due dates', 'We propose due dates'), 'summary-ask', /starts "We propose.*Approve, Decide or Note/);
  one(swap(EXAMPLE, 'so that 70% of dated tasks are done by their date (SM-1).', 'so that 70% of dated tasks are done by their date, and leads stop keeping a spreadsheet of deadlines next to the app every single week (SM-1).'), 'summary-ask', /has 3[0-9] words, more than 30/);
  one(swap(EXAMPLE, '# Tasks with due dates that people finish on time\n', '# Tasks with due dates that people finish on time\n\nAn introduction.\n'), 'summary', /between the # title and "## Summary for approval"/);
});

test('31 T2: consistency: IDs resolve, open questions and non-goals reach the summary, numbers warn', () => {
  one(swap(EXAMPLE, '(BR-3)', '(BR-9)'), 'unknown-id', /BR-9 is mentioned but not defined/);
  one(swap(EXAMPLE, ' (Q-1)? Options', '? Options'), 'summary-decision', /open question Q-1 isn't under "Decisions for you"/);
  one(swap(EXAMPLE, '- Changing how tasks are sorted: leads asked to keep today\'s order (NG-3).\n', ''), 'summary-not-in', /non-goal NG-3 isn't under "Not in this"/);
  const w = warnings(swap(EXAMPLE, 'so that 70% of dated tasks', 'so that 80% of dated tasks'));
  assert.deepEqual(codes(w), ['summary-number']);
  assert.match(w[0].reason, /the summary says 80%, which the detail doesn't/);
  assert.deepEqual(errors(swap(EXAMPLE, 'so that 70% of dated tasks', 'so that 80% of dated tasks')), [], 'numbers only warn (decision 3)');
});

test('31 T3: the writing rules, each quoting the sentence and naming the fix; the detail gets rules 2, 3 and 5', () => {
  const longAsk = 'Leads lose track of deadlines because the dates live in a spreadsheet that nobody updates when a task in the app is moved to another person on the team.';
  one(swap(EXAMPLE, 'Team leads plan work in the task app, but a task has no date.', longAsk), 'writing-sentence', /a sentence of 2[6-9] words: "Leads lose track/);
  const warn = warnings(swap(EXAMPLE, 'Team leads plan work in the task app, but a task has no date.', 'Team leads plan all of their team\'s work in the task app every week, but a task there has no date.'));
  assert.ok(codes(warn).includes('writing-sentence'), JSON.stringify(warn));
  one(swap(EXAMPLE, 'They keep deadlines in a spreadsheet beside it.', 'They leverage a spreadsheet beside it.'), 'writing-word', /"leverage" .*say "use"/);
  one(swap(EXAMPLE, 'They keep deadlines in a spreadsheet beside it.', 'They keep deadlines in a spreadsheet, etc.'), 'writing-word', /"etc\./);
  one(swap(EXAMPLE, 'They keep deadlines in a spreadsheet beside it.', 'They want a fast way to keep deadlines.'), 'writing-vague', /"fast" with no number/);
  assert.equal(errors(swap(EXAMPLE, 'They keep deadlines in a spreadsheet beside it.', 'They want deadlines shown within 2 seconds, fast enough to check.')).length, 0, 'a vague word with a number is fine');
  one(swap(EXAMPLE, 'They keep deadlines in a spreadsheet beside it.', 'They keep deadlines in the PMO tracker.'), 'writing-acronym', /"PMO" isn't spelled out/);
  assert.equal(errors(swap(EXAMPLE, 'They keep deadlines in a spreadsheet beside it.', 'They keep deadlines in the project office (PMO) tracker.')).length, 0);
  const para = 'One. Two two. Three three. Four four. Five five. Six six.';
  one(swap(EXAMPLE, 'They keep deadlines in a spreadsheet beside it.', para), 'writing-paragraph', /a paragraph of [6-9] sentences/);
  one(swap(EXAMPLE, 'Once this is built:\n', 'Once this is built.\n'), 'writing-list', /no lead-in/);
  // The detail: sentences, words and acronyms, not the summary-only rules.
  one(swap(EXAMPLE, 'Each lead keeps deadlines in a separate spreadsheet.', 'Each lead will leverage a separate spreadsheet.'), 'writing-word', /leverage/);
  assert.equal(errors(swap(EXAMPLE, 'Each lead keeps deadlines in a separate spreadsheet.', 'One. Two two. Three three. Four four. Five five. Six six.')).filter((p) => p.code === 'writing-paragraph').length, 0);
  // Words inside code spans are never checked.
  assert.equal(errors(swap(EXAMPLE, 'Each lead keeps deadlines in a separate spreadsheet.', 'Each lead keeps deadlines in `leverage_etc.csv`.')).length, 0);
  // The budget: 400 words for a brief; over it fails, 80% warns.
  const filler = ' The leads said this again and again in every interview we ran.'.repeat(30);
  one(swap(EXAMPLE, 'The quarterly planning cycle starts in January, so this is the time to have dates in one place.', `The quarterly planning cycle starts in January.${filler}`), 'writing-budget', /the summary has [0-9]+ words; a brief's budget is 400/);
});

test('31 T4: the brief: numbering, success rows, outcomes, the track, and no open question at approval', () => {
  one(swap(EXAMPLE, '- BR-3: A lead', '- BR-4: A lead').replace('(BR-3)', '(BR-4)'), 'brief-numbering', /BR-4 should be BR-3/);
  one(swap(EXAMPLE, '| Asking the 6 leads in March 2027 | Reminder emails marked as spam |', '| Asking the 6 leads in March 2027 | |'), 'brief-success', /no a counter-metric|has no a counter-metric/);
  const sol = warnings(swap(EXAMPLE, 'can see which tasks are overdue. Source', 'can see which tasks are overdue on a new screen. Source'));
  assert.deepEqual(codes(sol), ['brief-outcome']);
  assert.match(sol[0].reason, /names "screen", a solution/);
  one(swap(EXAMPLE, 'track: standard\n', 'track: full\n'), 'brief-track', /says standard, the frontmatter says full/);
  assert.deepEqual(errors(EXAMPLE), [], 'an open question is fine in a draft');
  const atApproval = errors(EXAMPLE, { approving: true });
  assert.deepEqual(codes(atApproval), ['brief-open-question']);
  assert.match(atApproval[0].hint, /answer it in the detail/);
});

test('31 T5: the template: left as it is, it fails; a type with the summary check must open with it', () => {
  const left = errors(TEMPLATE.replace('id: initiative-brief', 'id: initiative-brief'));
  assert.ok(left.length > 0 && left.every((p) => p.code === 'template-text'), JSON.stringify(left.filter((p) => p.code !== 'template-text')));
  // A document without the summary fails the lint.
  const start = EXAMPLE.indexOf('## Summary for approval');
  const noSummary = EXAMPLE.slice(0, start) + EXAMPLE.slice(EXAMPLE.indexOf('## Problem'));
  assert.ok(codes(errors(noSummary)).includes('missing-section'));
  // A document type whose template leaves the summary out is refused by the registry.
  const dir = REGISTRY_DIR;
  const toml = readFileSync(join(dir, 'document-types', 'brief.toml'), 'utf8');
  const bad = toml.replace('required_sections = ["Summary for approval", ', 'required_sections = [');
  assert.notEqual(bad, toml);
  const probs = [];
  try {
    const tmp = cloneRegistry({ 'document-types/brief.toml': bad });
    loadRegistry(tmp);
  } catch (err) {
    probs.push(...err.errors);
  }
  assert.ok(probs.some((p) => p.code === 'summary' && /needs "Summary for approval" as its first, required section/.test(p.reason)), JSON.stringify(probs));
  // Every document type you approve from its summary has the check: all but tickets and plans
  // (decision 1), so a later type (PRD, HLD …) can't leave it out. Unit 35: an interview isn't
  // approved, so it has none. Unit 36: the context files are approved as whole files (Jet's
  // decision 1), so they have none either. Unit 45: ticket notes are your own notes, never approved.
  for (const [name, def] of Object.entries(REGISTRY.documentTypes)) {
    if (['story', 'bug', 'plan', 'interview', 'business', 'journeys', 'feature-map', 'project', 'conventions', 'requirements', 'business-change', 'investigation', 'ticket-notes'].includes(name)) continue;
    assert.ok(def.lint_checks?.includes('summary') && def.lint_checks.includes('writing'), `${name} needs the summary and writing checks`);
  }
});

function cloneRegistry(changes) {
  const dir = mkdtempSync(join(tmpdir(), 'mirai-31-registry-'));
  cpSync(REGISTRY_DIR, dir, { recursive: true });
  for (const [rel, text] of Object.entries(changes)) writeFileSync(join(dir, rel), text);
  return dir;
}

// A brief ready for approval: the reminder channel decided, no open question left.
const READY = swap(swap(EXAMPLE,
  '1. How should reminders reach people (Q-1)? Options: email only, or email and an in-app notice. Recommendation: email only, because the app has no notification system yet; an in-app notice would double the work.\n',
  'None — the reminder channel was settled in review: email only (BR-2).\n'),
  '- Q-1: How should reminders reach people: email only, or email and an in-app notice? The approver answers; it blocks the PRD\'s notification requirements.\n', '');

// Unit 40: these approvals aren't about the verifier; her pass for the file as it is now first
// (test/documents/verify.test.js tests the gate itself).
async function tty(argv, { cwd, env }, answers, { vera = true } = {}) {
  if (vera) veraBefore(argv, { cwd, env });
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd });
  return { code, out, err };
}

test('31 T6: approving a brief: lint first, signed on its bytes, a change needs a new approval', async () => {
  assert.deepEqual(errors(READY, { approving: true }), []);
  const f = installed({ files: { 'docs/mirai/due-dates/brief.md': EXAMPLE, 'docs/mirai/due-dates/interview.md': INTERVIEW } });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  const io = { cwd: f.root, env: f.env };
  const path = join(f.root, 'docs/mirai/due-dates/brief.md');
  // An open question: refused before you're asked anything.
  const open = await tty(['approve', 'due-dates-brief', '--file', 'docs/mirai/due-dates/brief.md'], io, ['a', 'due-dates-brief']);
  assert.equal(open.code, EXIT.BLOCKED, open.out);
  assert.match(open.err, /^docs\/mirai\/due-dates\/brief\.md:[0-9]+: a brief with an open question can't be approved \(answer it/m);
  assert.match(open.err, /can't be approved yet: 1 lint problem, listed above; nothing was written/);
  // The wrong id: refused, naming the right one.
  writeFileSync(path, READY);
  const wrong = await tty(['approve', 'other-brief', '--file', 'docs/mirai/due-dates/brief.md'], io, ['a', 'other-brief']);
  assert.equal(wrong.code, EXIT.USAGE);
  assert.match(wrong.err, /is the brief "due-dates-brief", not "other-brief"/);
  // Approved, signed, on its exact bytes.
  const ok = await tty(['approve', 'due-dates-brief', '--file', 'docs/mirai/due-dates/brief.md'], io, ['a', 'due-dates-brief']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.match(ok.out, /approved: the brief due-dates-brief, as docs\/mirai\/due-dates\/brief\.md is now \(accepted; signed with k-[0-9a-f]+, seq [0-9]+\); a change to it needs a new approval/);
  const store = openStore({ cwd: f.root, env: f.env });
  const line = readJournal(store).events.at(-1);
  assert.equal(line.kind, 'brief');
  assert.equal(line.item, 'due-dates-brief');
  assert.deepEqual(documentApproval(store, 'due-dates-brief', Buffer.from(READY)), { approved: true, stale: false, seq: line.seq });
  // Changed after approval: no longer approved until you approve it again.
  const changed = READY.replace('two weeks of build time', 'three weeks of build time');
  writeFileSync(path, changed);
  assert.deepEqual(documentApproval(store, 'due-dates-brief', Buffer.from(changed)), { approved: false, stale: true, seq: line.seq });
  const again = await tty(['approve', 'due-dates-brief', '--file', 'docs/mirai/due-dates/brief.md'], io, ['a', 'due-dates-brief']);
  assert.equal(again.code, EXIT.OK, again.err);
  assert.match(again.out, /^brief: due-dates-brief \(approved before; it or its interview has changed since\)/);
  assert.equal(documentApproval(store, 'due-dates-brief', Buffer.from(changed)).approved, true);
});
