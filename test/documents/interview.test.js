import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRegistry } from '../../src/config/registry.js';
import { readFrontmatter } from '../../src/lint/frontmatter.js';
import { REGISTRY_DIR, createLintCommand } from '../../src/cli/commands/lint.js';
import { lintText } from '../../src/lint/lint.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { installed } from '../tests/run-fixture.js';
import { passReader } from '../helpers/reader.js';

// Unit 35: the mirai-interview skill, the interview record and its gate on the brief.
const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const SKILL = read('skills/mirai-interview/SKILL.md');
const CREDITS = read('skills/mirai-interview/CREDITS.md');
const INTERVIEW = read('examples/interview.md');
const TEMPLATE = read('templates/interview.md');
const BRIEF = read('examples/brief.md');
const PRD = read('examples/prd.md');
const D = 'docs/mirai/due-dates';

const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.replace(from, to);
};
const lint = (text, o = {}) => lintText(text, { source: `${D}/interview.md`, registry: REGISTRY, project: { repos: ['.'] }, ...o });
const errors = (text, o) => lint(text, o).filter((p) => p.severity === 'error');
const codes = (ps) => ps.map((p) => p.code);
const one = (text, code, re) => {
  const ps = errors(text).filter((p) => p.code === code);
  assert.equal(ps.length, 1, JSON.stringify(errors(text)));
  if (re) assert.match(`${ps[0].reason} | ${ps[0].hint ?? ''}`, re);
  return ps[0];
};

// The interview paused after five answers: Q-6 and Q-7 open, no restatement yet.
const PAUSED = swap(swap(swap(INTERVIEW, 'state: confirmed', 'state: paused'),
  'Answer: A. Past two weeks, the spreadsheet is good enough.', 'Answer:'),
  'Answer: A.\n\n## Restatement', 'Answer:\n\n## Restatement').replace(/## Restatement\n[\s\S]*$/, '## Restatement\n');
// The brief with no interview: the "Interview:" line gone.
const BRIEF_ALONE = swap(BRIEF, 'Interview: [Interview: due dates on tasks](interview.md)\n\n', '');

test('35 T1: the skill: the five rules, pause, resume, autonomous mode, the stuck check, the 95% stop and the six lines; it points to mirai-write; CREDITS names both sources', () => {
  assert.ok(REGISTRY.skills['mirai-interview'], 'listed with the other skills, so every author agent gets it');
  const fm = readFrontmatter(SKILL);
  assert.deepEqual(Object.keys(fm.value), ['name', 'description']);
  assert.equal(fm.value.name, 'mirai-interview');
  const body = fm.body;
  // One question per message, lettered options, a guess with its reason.
  assert.match(body, /Ask \*\*one question per message\*\*/);
  assert.match(body, /\*\*two or three lettered options\*\*\. Mark one as your guess and give its reason/);
  // Facts are looked up, decisions are asked.
  assert.match(body, /\*\*Look the facts up yourself\.\*\*/);
  // The five rules, in order.
  const rules = [/1\. \*\*A header\*\* naming what it's about/, /2\. \*\*A confidence line\*\* with what's still open/, /3\. \*\*"explain" gets plain words and an example\*\*, then the same question again/, /4\. \*\*One short "Your step" at the end:\*\*/, /5\. \*\*The restatement before the owner's "yes" names what's not included\*\*/];
  let at = 0;
  for (const r of rules) {
    const m = r.exec(body.slice(at));
    assert.ok(m, `rule ${r}`);
    at += m.index;
  }
  assert.match(body, /if you didn't have to justify this to anyone, what\s+would you want\?/i);
  assert.match(body, /## When to stop: the 95% test\n\nStop asking when you can predict the owner's reaction to your next three questions/);
  assert.match(body, /\*\*The stuck check:\*\* after three answered questions with no rise in your confidence, stop asking/);
  for (const label of ['Outcome', 'Who it\'s for', 'Why now', 'Success', 'Limits', 'Not included']) assert.match(body, new RegExp(`- \\*\\*${label}:\\*\\*`), label);
  assert.match(body, /Only an explicit "yes" closes the interview\. "Sounds good", "whatever you think"/);
  assert.match(body, /\*\*Pause\.\*\* When the owner says "pause" \(or "draft it"\), write every question you still have into\s+`interview\.md`, each with its options and your guess/);
  assert.match(body, /\*\*Resume\.\*\* A new session reads `interview\.md` first\. It starts at the first open question, and\s+never asks an answered one again/);
  assert.match(body, /## Autonomous mode\n\nWith no one to ask .*don't guess and don't draft\. Write your questions into\s+`interview\.md`.*set `state: paused`, and stop/s);
  assert.match(body, /Write it as you go: each question when you ask it, each answer as soon as it comes/);
  assert.match(body, /\[`mirai-write`\]\(\.\.\/mirai-write\/SKILL\.md\)/);
  assert.match(body, /You don't run `mirai`/);
  // CREDITS: both sources, each at its commit, MIT, with its notice.
  assert.match(CREDITS, /https:\/\/github\.com\/addyosmani\/agent-skills, file `skills\/interview-me\/SKILL\.md`, read at commit\s+`[0-9a-f]{40}`/);
  assert.match(CREDITS, /https:\/\/github\.com\/mattpocock\/skills, file `skills\/productivity\/grilling\/SKILL\.md`, read at\s+commit `[0-9a-f]{40}`/);
  assert.equal(CREDITS.match(/^- License: MIT\. Its notice:$/gm).length, 2);
  assert.match(CREDITS, /Copyright \(c\) 2025 Addy Osmani/);
  assert.match(CREDITS, /Copyright \(c\) 2026 Matt Pocock/);
  assert.equal(CREDITS.match(/The above copyright notice and this permission notice shall be included in all/g).length, 2);
});

test('35 T2: the interview type: the template fails as leftover text only; the example lints clean, with no warning, in state confirmed', () => {
  const def = REGISTRY.documentTypes.interview;
  assert.deepEqual(def.required_sections, ['Questions', 'Restatement']);
  assert.ok(!def.lint_checks.includes('summary'), 'no summary for approval: it isn\'t approved on its own');
  const left = errors(TEMPLATE);
  assert.ok(left.length > 0 && left.every((p) => p.code === 'template-text'), JSON.stringify(left.filter((p) => p.code !== 'template-text')));
  assert.equal(readFrontmatter(INTERVIEW).value.state, 'confirmed');
  assert.deepEqual(lint(INTERVIEW), []);
  // The example is the interview behind unit 31's example brief, which links it.
  assert.match(BRIEF, /^# Tasks with due dates that people finish on time\n\nInterview: \[Interview: due dates on tasks\]\(interview\.md\)\n\n## Summary for approval$/m);
});

test('35 T3: the interview lint names the question and the fix', () => {
  one(swap(INTERVIEW, 'Answer: C. Aim for 70% of dated tasks done on time. Check the spreadsheets with the six leads in March.', 'Answer:'), 'interview-answer', /^Q-2 isn't answered \| ask it in the session and write the owner's reply after "Answer:"/);
  assert.deepEqual(codes(errors(swap(INTERVIEW, 'Answer: C. Aim for 70% of dated tasks done on time. Check the spreadsheets with the six leads in March.', 'Answer:'))), ['interview-answer']);
  one(swap(INTERVIEW, 'Answer: B.\n', 'Answer: explain\n'), 'interview-answer', /Q-5 isn't answered \("explain" isn't an answer\)/);
  one(swap(INTERVIEW, 'Guess: B, because leads said chasing people is the work they want gone, and C needs settings nobody asked for.\n', ''), 'interview-guess', /^Q-3 has no guess \| add "Guess: A, because …"/);
  one(swap(INTERVIEW, 'Guess: B, because four leads', 'Guess: D, because four leads'), 'interview-guess', /Q-5's guess doesn't name one of its options/);
  one(swap(INTERVIEW, 'Guess: A, because it changes one app and needs no new service.', 'Guess: A.'), 'interview-guess', /Q-6's guess has no reason/);
  one(swap(INTERVIEW, '- B: six weeks\n- C: as long as it takes\n', ''), 'interview-options', /Q-6 has only one option \| list two or three lettered options/);
  // Q-4 after Q-2: the gap is named at the first question out of place.
  const start = INTERVIEW.indexOf('### Q-3:');
  const gap = INTERVIEW.slice(0, start) + INTERVIEW.slice(INTERVIEW.indexOf('### Q-4:'));
  const numbering = errors(gap).filter((p) => p.code === 'interview-numbering');
  assert.match(numbering[0].reason, /^Q-4 should be Q-3: questions run Q-1, Q-2, Q-3 … with no gap$/);
  // The restatement, in a confirmed interview.
  one(swap(INTERVIEW, '- Not included: recurring tasks, reminders by text message, and a new sort order for the task list.\n', ''), 'interview-restatement', /the restatement has no "Not included" line/);
  one(swap(INTERVIEW, '- Not included: recurring tasks, reminders by text message, and a new sort order for the task list.', '- Not included: None.'), 'interview-restatement', /"Not included" says None with no reason \| write: None\. <why nothing is left out>/);
  assert.deepEqual(errors(swap(INTERVIEW, '- Not included: recurring tasks, reminders by text message, and a new sort order for the task list.', '- Not included: None. Every part of the request is in.')), []);
  one(swap(INTERVIEW, 'Confirmed: yes (2026-11-19)', 'Confirmed: sounds good'), 'interview-yes', /^"Confirmed: sounds good" isn't a yes \| only an explicit "yes" closes the interview/);
  one(swap(INTERVIEW, 'Confirmed: yes (2026-11-19)', 'Confirmed: yes'), 'interview-yes', /^"Confirmed: yes" has no date/);
  one(swap(INTERVIEW, 'Confirmed: yes (2026-11-19)', 'Confirmed: yes (2026-02-30)'), 'interview-yes', /isn't a real date/);
  one(swap(INTERVIEW, '\nConfirmed: yes (2026-11-19)\n', '\n'), 'interview-yes', /a confirmed interview needs "Confirmed: yes \(YYYY-MM-DD\)"/);
  // Paused with two open questions: both are named, on the state and on each question.
  const paused = errors(PAUSED);
  assert.deepEqual(codes(paused).sort(), ['interview-answer', 'interview-answer', 'interview-state']);
  const state = paused.find((p) => p.code === 'interview-state');
  assert.equal(state.reason, 'the interview is paused: Q-6 and Q-7 are open');
  assert.match(state.hint, /answer them in the session/);
  assert.deepEqual(paused.filter((p) => p.code === 'interview-answer').map((p) => p.reason), ['Q-6 isn\'t answered', 'Q-7 isn\'t answered']);
  // Open, with every question answered and no yes yet: still not finished.
  one(swap(INTERVIEW, 'state: confirmed', 'state: open').replace('\nConfirmed: yes (2026-11-19)\n', '\n'), 'interview-state', /the interview is open, with no question left open \| write the restatement, get the owner's explicit "yes"/);
});

// A git repo holding `files` (path → text) under docs/mirai/due-dates/, linted with mirai lint.
async function lintRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'mirai-35-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, D), { recursive: true });
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, D, path), text);
  let out = '';
  const io = { stdout: { write: (s) => (out += s) }, stderr: { write: () => {} }, env: { PATH: process.env.PATH, HOME: root }, cwd: root };
  const code = await main(['lint', '--json'], io, [createLintCommand()]);
  rmSync(root, { recursive: true, force: true });
  return { code, result: JSON.parse(out) };
}

test('35 T4: the brief\'s link, through mirai lint: unlinked fails, a paused interview fails the brief, a confirmed one passes, no interview passes', async () => {
  const briefErrors = (r) => r.result.problems.filter((p) => p.file === `${D}/brief.md` && p.severity === 'error');
  // An interview.md beside the brief that the brief doesn't link.
  const unlinked = await lintRepo({ 'brief.md': BRIEF_ALONE, 'interview.md': INTERVIEW });
  assert.equal(unlinked.code, EXIT.FAILURE);
  assert.deepEqual(briefErrors(unlinked).map((p) => `${p.code} ${p.reason}`), ['brief-interview interview.md beside the brief isn\'t linked']);
  assert.match(briefErrors(unlinked)[0].hint, /add "Interview: \[<its title>\]\(interview\.md\)" right under the # title/);
  // A linked paused interview: the brief fails, naming its open questions.
  const paused = await lintRepo({ 'brief.md': BRIEF, 'interview.md': PAUSED });
  assert.equal(paused.code, EXIT.FAILURE);
  const [b] = briefErrors(paused);
  assert.equal(briefErrors(paused).length, 1);
  assert.equal(`${b.code} ${b.reason} (${b.hint})`, 'brief-interview the interview interview.md has open questions: Q-6 and Q-7 (answer them in your session, then run mirai lint)');
  assert.ok(paused.result.problems.some((p) => p.file === `${D}/interview.md` && p.code === 'interview-state'), 'the interview fails on its own too');
  // Confirmed: both clean.
  const ok = await lintRepo({ 'brief.md': BRIEF, 'interview.md': INTERVIEW });
  assert.equal(ok.code, EXIT.OK, JSON.stringify(ok.result.problems));
  assert.equal(ok.result.files, 2);
  // No interview at all (the request wasn't thin): the brief passes.
  const alone = await lintRepo({ 'brief.md': BRIEF_ALONE });
  assert.equal(alone.code, EXIT.OK, JSON.stringify(alone.result.problems));
  // A linked interview that isn't there is a broken link.
  const missing = await lintRepo({ 'brief.md': BRIEF });
  assert.equal(missing.code, EXIT.FAILURE);
  assert.ok(briefErrors(missing).length > 0);
});

// The pair, ready to approve (as in 32): the brief's Q-1 answered in both files.
const BRIEF_READY = swap(swap(BRIEF,
  '1. How should reminders reach people (Q-1)? Options: email only, or email and an in-app notice. Recommendation: email only, because the app has no notification system yet; an in-app notice would double the work.\n',
  'None — the reminder channel was settled in review: email only (BR-2).\n'),
  '- Q-1: How should reminders reach people: email only, or email and an in-app notice? The approver answers; it blocks the PRD\'s notification requirements.\n', '');
const PRD_READY = swap(swap(PRD,
  '1. How should reminders reach people (Q-1)? Options: email only, or email and an in-app notice. Recommendation: email only, because the app has no notification system yet; an in-app notice would double the work. This PRD is written for email only (A-1).\n',
  'None — the reminder channel was settled in review: email only (A-1).\n'),
  'the recommendation for the brief\'s Q-1.', 'as settled in review.');
// A brief on full, in its own initiative folder: approved at its own step.
const FULL = 'docs/mirai/due-dates-full';
const FULL_BRIEF = swap(swap(swap(BRIEF_READY, 'track: standard', 'track: full'), 'Track: standard, because', 'Track: full, because'), 'id: due-dates-brief', 'id: due-dates-full-brief');

async function tty(argv, { cwd, env }, answers) {
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd });
  return { code, out, err };
}

function fixture() {
  const f = installed({ files: { [`${D}/brief.md`]: BRIEF_READY, [`${D}/interview.md`]: PAUSED, [`${D}/prd.md`]: PRD_READY, [`${FULL}/brief.md`]: FULL_BRIEF, [`${FULL}/interview.md`]: PAUSED } });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  return { ...f, io: { cwd: f.root, env: f.env } };
}
const approvals = (f) => readJournal(openStore(f.io)).events.filter((e) => e.type === 'approval');

test('35 T5: approval through the CLI: a brief on full, and the pair on standard, are refused while the interview is paused; confirmed, approval goes on as before', async () => {
  const f = fixture();
  const APPROVE_FULL = ['approve', 'due-dates-full-brief', '--file', `${FULL}/brief.md`];
  const APPROVE_PAIR = ['approve', 'due-dates-prd', '--file', `${D}/prd.md`];
  // Paused: refused before you're asked anything, the open questions listed, nothing written.
  for (const [argv, path, id] of [[APPROVE_FULL, `${FULL}/brief.md`, 'due-dates-full-brief'], [APPROVE_PAIR, `${D}/brief.md`, 'due-dates-prd']]) {
    const r = await tty(argv, f.io, ['a', id]);
    assert.equal(r.code, EXIT.BLOCKED, r.out);
    assert.ok(r.err.includes(`${path}:12: the interview interview.md has open questions: Q-6 and Q-7 (answer them in your session, then run mirai lint)\n`), r.err);
    assert.match(r.err, /can't be approved yet: 1 lint problem, listed above; nothing was written/);
    assert.doesNotMatch(r.out, /accepted as is/);
  }
  assert.deepEqual(approvals(f), []);
  // An unlinked interview beside the brief refuses it too.
  writeFileSync(join(f.root, FULL, 'brief.md'), swap(FULL_BRIEF, 'Interview: [Interview: due dates on tasks](interview.md)\n\n', ''));
  const unlinked = await tty(APPROVE_FULL, f.io, ['a', 'due-dates-full-brief']);
  assert.equal(unlinked.code, EXIT.BLOCKED);
  assert.match(unlinked.err, /interview\.md beside the brief isn't linked/);
  // A linked interview that isn't a file: refused, nothing written.
  writeFileSync(join(f.root, FULL, 'brief.md'), swap(FULL_BRIEF, '](interview.md)', '](gone.md)'));
  const gone = await tty(APPROVE_FULL, f.io, ['a', 'due-dates-full-brief']);
  assert.equal(gone.code, EXIT.BLOCKED);
  assert.match(gone.err, /links its interview gone\.md, which isn't a file in the repo; nothing was written/);
  assert.deepEqual(approvals(f), []);
  // Confirmed: approval goes on as before, the reader test from 34 included.
  writeFileSync(join(f.root, FULL, 'brief.md'), FULL_BRIEF);
  writeFileSync(join(f.root, FULL, 'interview.md'), INTERVIEW);
  writeFileSync(join(f.root, D, 'interview.md'), INTERVIEW);
  const noReader = await tty(APPROVE_FULL, f.io, ['a', 'due-dates-full-brief']);
  assert.equal(noReader.code, EXIT.BLOCKED);
  assert.match(noReader.err, /has no reader-test result for its summary as it is now/);
  await passReader(f, `${FULL}/brief.md`);
  const full = await tty(APPROVE_FULL, f.io, ['a', 'due-dates-full-brief']);
  assert.equal(full.code, EXIT.OK, full.err);
  assert.match(full.out, /approved: the brief due-dates-full-brief/);
  await passReader(f, `${D}/prd.md`);
  const pair = await tty(APPROVE_PAIR, f.io, ['a', 'due-dates-prd']);
  assert.equal(pair.code, EXIT.OK, pair.err);
  assert.match(pair.out, /approved: the brief due-dates-brief and the PRD due-dates-prd/);
  assert.deepEqual(approvals(f).map((e) => `${e.kind} ${e.item}`), ['brief due-dates-full-brief', 'brief due-dates-brief', 'prd due-dates-prd']);
});

test('35 T6: mirai show due-dates lists the interview with its state and full path', async () => {
  const f = fixture();
  const dir = join(realpathSync(f.root), D);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = (state) => new RegExp(`^  interview\\.md +interview +due-dates-interview +${state} +${esc(join(dir, 'interview.md'))}$`, 'm');
  const paused = await tty(['show', 'due-dates'], f.io, []);
  assert.equal(paused.code, EXIT.OK, paused.err);
  assert.match(paused.out, line('paused'));
  assert.match(paused.out, /^ {2}brief\.md +brief +due-dates-brief +not approved +\//m);
  writeFileSync(join(dir, 'interview.md'), INTERVIEW);
  assert.match((await tty(['show', 'due-dates'], f.io, [])).out, line('confirmed'));
  writeFileSync(join(dir, 'interview.md'), swap(INTERVIEW, 'state: confirmed', 'state: open'));
  assert.match((await tty(['show', 'due-dates'], f.io, [])).out, line('open'));
});
