import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRegistry } from '../../src/config/registry.js';
import { loadConfig } from '../../src/config/load.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { ConfigError } from '../../src/cli/errors.js';
import { main } from '../../src/cli/main.js';
import { MIRAI_COMMAND, MIRAI_NEW_COMMAND, MIRAI_PRD_COMMAND, commandPaths } from '../../src/adapters/claude-code.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { PAUSE_PLACE } from '../../src/agent/pause.js';
import { lintText, parseDocument } from '../../src/lint/lint.js';
import { answerTypeOf, assumptionsOf, intakeOf, questionsOf } from '../../src/lint/interview.js';
import { fingerprintOf, inventedDecisions, routeFindings, routedHandoff } from '../../src/docs/route.js';
import { addCost, bookKey, changeBooks, countCheck, freshBooks, readBooks, versionOf } from '../../src/loop/docs.js';
import { readLoop } from '../../src/loop/guard.js';
import { runNora } from '../../src/nora/run.js';
import { noraStateLines, waitingLine } from '../../src/nora/state.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { writeToken } from '../../src/sign/token.js';
import { DOCUMENT } from '../../src/status/machines.js';
import { openStore } from '../../src/store/home.js';
import { appendEvent, readJournal } from '../../src/store/journal.js';
import { readVerifyResults } from '../../src/store/verify-results.js';
import { findingsFrom } from '../../src/verify/findings.js';
import { incrementalInputs, verifyInputs, verifySubject } from '../../src/verify/run.js';
import { hooksState, installHooks, plannedFiles } from '../../src/hooks/install.js';
import { stagedChanges } from '../../src/hooks/pre-commit.js';
import { FAKE_CLAUDE, FAKE_TOKEN, fakeReader, passReader } from '../helpers/reader.js';
import { passVera } from '../helpers/vera.js';
import { installed } from '../tests/run-fixture.js';

// Unit 44: the mirai-prd workflow. No model runs: fake launchers stand in for Nora's and Vera's
// launches and for the reader, as 41's tests do. The documents are the sample app's (a personal task
// list: no teams, no email), in test/fixtures/sample-due-dates/.

const REGISTRY = loadRegistry(REGISTRY_DIR);
const FIX = fileURLToPath(new URL('../fixtures/sample-due-dates/', import.meta.url));
const fx = (n) => readFileSync(join(FIX, n), 'utf8');
const INTERVIEW = fx('interview.md');
const BRIEF = fx('brief.md');
const PRD = fx('prd.md');
const BUSINESS = fx('business.md');
const I = 'own-due-dates';
const D = `docs/mirai/${I}`;
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');

function fixture({ config = '', docs = true, interview = INTERVIEW } = {}) {
  const files = { [`${D}/interview.md`]: interview, '.mirai/context/business.md': BUSINESS, ...(docs ? { [`${D}/brief.md`]: BRIEF, [`${D}/prd.md`]: PRD } : {}) };
  const f = installed({ files, ...(config ? { config } : {}) });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  mkdirSync(join(f.home, '.config', 'mirai'), { recursive: true });
  writeFileSync(join(f.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Test Author"\nauthor_email = "author@example.com"\n', { mode: 0o600 });
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  f.git('switch', '-q', '-c', `docs-${I}`);
  writeToken(f.env, FAKE_TOKEN);
  return { ...f, key, store: openStore({ cwd: f.root, env: f.env }) };
}
const put = (f, rel, text) => {
  mkdirSync(join(f.root, rel, '..'), { recursive: true });
  writeFileSync(join(f.root, rel), text);
};
const get = (f, rel) => readFileSync(join(f.root, rel), 'utf8');
const indexOf = (o) => JSON.parse(o.inputs['index.json']).nora;
const result = (o = {}) => ({ outcome: 'written', summary: 'Did it.', template_gaps: [], documents: [], ...o });
function fakeNora(f, step) {
  const calls = [];
  const launch = async (o) => {
    calls.push(o);
    return { outcome: 'ok', why: null, launchId: `2026112510000${calls.length % 10}-0123abcd`, structured: step(o, calls.length), line: { model: 'claude-opus-5-5', model_used: 'claude-opus-5-5', tier: 'deep', turns: 3, cost_usd: 0.5 } };
  };
  return { launch, calls };
}
// Vera: the brief always passes; the PRD's findings come from `prd(call)` (its nth check).
function fakeVera(prd = () => []) {
  const calls = [];
  let n = 0;
  const launch = async (o) => {
    calls.push(o);
    const findings = o.item === 'own-due-dates-prd' ? prd(++n, o) : [];
    return { outcome: 'ok', why: null, launchId: `2026112511000${calls.length % 10}-0123abcd`, structured: { findings }, line: { model: 'claude-sonnet-5-5', tier: 'standard', turns: 2, cost_usd: 0.25 } };
  };
  return { launch, calls };
}
async function nora(f, step, vera = fakeVera()) {
  const n = fakeNora(f, step);
  const events = [];
  const r = await runNora({ cwd: f.root, env: f.env, initiative: I, nextToken: () => mintLaunchToken(), launch: n.launch, verifyLaunch: vera.launch, readerLaunch: fakeReader().launch, readerClaude: FAKE_CLAUDE, onStep: (e) => events.push(e) });
  return { r, n, vera, events };
}
const journal = (f, type) => readJournal(openStore({ cwd: f.root, env: f.env })).events.filter((e) => e.type === type);
const commitAll = (f, m) => {
  f.git('add', '-A');
  f.git('commit', '-qm', m);
};

// The seeded findings (the spec's F1–F3, on the sample app's PRD).
const finding = (o) => ({ grade: 'must-fix', layer: 'checklist', decision_type: 'none', fix: 'Fix it.', ...o, where: { file: 'document.md', line: 1, ...o.where } });
const F1 = finding({ id: 'F1', kind: 'writing', kind_reason: 'the interview gives it: late is the day after (Q-1)', where: { quote: 'the list must mark it as late' }, what: 'FR-3 doesn\'t say from which day a task is late.' });
const F2 = finding({ id: 'F2', kind: 'decision', decision_type: 'audience', kind_reason: 'users: no source says who besides the owner may date a task', where: { quote: 'A task\'s owner can set, change or remove its due date.' }, what: 'No source says whether anyone besides the owner may set a due date.' });
const F3 = finding({ id: 'F3', kind: 'decision', decision_type: 'scope', kind_reason: 'scope', where: { quote: 'A page of late tasks: the mark on the list is enough' }, what: 'A page of late tasks is missing.' });
const FR1 = '- FR-1: A task\'s owner can set, change or remove its due date. (BR-1)';
// The PRD carrying the interview's two approved assumptions (the look-ahead's).
const CARRIED = PRD.replace('- A-1: A task is late from the day after its due date, in the owner\'s own time zone. If it is late on the due date itself, FR-3 changes.', '- A-1: Only the task\'s owner sees its due date. Approved in the interview.\n- A-2: A task is late from the day after its due date, in the owner\'s own time zone. Approved in the interview.');
const FR1_OPEN = '- FR-1: A task\'s owner can set, change or remove its due date; whether others can is (open) — the owner only, or others too? Asked in interview.md Q-4. (BR-1)';

// A decision question from a finding, in interview.md's format (the four answers as options).
function findingQuestion(n, f, { title = 'Who sets the date', kind = f.decision_type, answer = '', type = null } = {}) {
  return [`### Q-${n}: ${title}`, '', `Finding: ${f.id} (${fingerprintOf(f)}): "${f.where.quote}"`, `Kind: ${kind}`, '', 'Confidence: about 50%. Still open: this decision.', '', 'Which way should it go?', '',
    '- A: the owner only', '- B: the verifier is wrong', '- C: not a decision, just fix it', '- D: leave it open and accept it', '', 'Guess: A, because business.md says only the owner changes a task.', '', `Answer: ${answer}`, ...(type ? [`Answer type: ${type}`] : []), '', ''].join('\n');
}
const withQuestions = (interview, blocks, state = 'paused') => interview.replace('state: confirmed', `state: ${state}`).replace('## Restatement', `${blocks.join('')}## Restatement`);
function answerAll(f, answers) {
  let t = get(f, `${D}/interview.md`);
  for (const [q, letter, type] of answers) {
    const re = new RegExp(`(### ${q}:[\\s\\S]*?)Answer: \\n`);
    t = t.replace(re, `$1Answer: ${letter}\nAnswer type: ${type}\n`);
  }
  put(f, `${D}/interview.md`, t.replace('state: paused', 'state: confirmed'));
  commitAll(f, 'answered');
}

// ---- T1 Intake and routing ----------------------------------------------------------------------

test('44 T1: /mirai-new and /mirai-prd are command files beside /mirai, and on its session list; the intake asks at most 2 questions; quick is one ticket, standard and full an initiative', () => {
  assert.deepEqual(commandPaths({ interactive: { commands: '.claude/commands' } }), ['.claude/commands/mirai.md', '.claude/commands/mirai-new.md', '.claude/commands/mirai-prd.md']);
  for (const text of [MIRAI_NEW_COMMAND, MIRAI_PRD_COMMAND]) {
    assert.match(text, /^allowed-tools: mcp__mirai__mirai_status$/m);
    assert.match(text, /^disable-model-invocation: true$/m);
    assert.match(text, /The intake \(\/mirai-new, \/mirai-prd\)/);
    assert.match(text, /`write` and the initiative's folder as `initiative`/);
    assert.doesNotMatch(text.split('---')[1], /: [^\n]*: /, 'no second colon in a frontmatter value');
  }
  assert.match(MIRAI_NEW_COMMAND, /at most 2 intake questions/);
  assert.match(MIRAI_NEW_COMMAND, /`quick`: it's one ticket[^\n]*`tickets`, the folder as `initiative` and `one` set to true/);
  assert.match(MIRAI_NEW_COMMAND, /Never propose `quick` for a request your intake found unclear/);
  assert.match(MIRAI_NEW_COMMAND, /offer the `standard` track[^\n]*never `\/mirai-new` again/);
  assert.match(MIRAI_PRD_COMMAND, /it is `standard`, unless the person said "full"/);
  assert.match(MIRAI_COMMAND, /If the command is `new` or `prd` followed by a request in quotes/);
  // The intake in interview.md: at most 2 questions, the track with its reason, and your yes.
  const intake = (qs, track, extra = '') => `## Intake\n\n${qs.map((n) => `### I-${n}: Size ${n}\n\nHow big is it?\n\n- A: one rule\n- B: a screen and a rule\n\nGuess: B, because of the code.\n\nAnswer: B.\n\n`).join('')}Track: ${track}, because a new screen and a new rule; no new service.\n\nTrack confirmed: yes (2026-11-25)\n\n${extra}`;
  const lint = (text) => lintText(text, { source: `${D}/interview.md`, registry: REGISTRY }).filter((p) => p.severity === 'error').map((p) => `${p.code}: ${p.reason}`);
  const standard = INTERVIEW.replace('## Questions', `${intake([1, 2], 'standard')}## Questions`);
  assert.deepEqual(lint(standard), []);
  assert.deepEqual(intakeOf(parseDocument(standard, 'i.md')).track, 'standard');
  assert.ok(lint(INTERVIEW.replace('## Questions', `${intake([1, 2, 3], 'standard')}## Questions`)).some((l) => /interview-intake: the intake asks at most 2 questions; this one has 3/.test(l)));
  assert.ok(lint(INTERVIEW.replace('## Questions', `${intake([1], 'quick')}## Questions`)).some((l) => /track quick is one ticket by hand: its interview has for: ticket/.test(l)));
  const quick = INTERVIEW.replace('state: confirmed', 'state: confirmed\nfor: ticket').replace('## Questions', `${intake([1], 'quick')}## Questions`);
  assert.deepEqual(lint(quick), []);
  // The 42 re-check: a quick ticket interview from /mirai-new that needs a fourth question offers
  // the standard track, never /mirai-new again.
  const more = quick.replace('## Restatement', '### Q-4: More\n\nAnd?\n\n- A: yes\n- B: no\n\nGuess: A, because of the code.\n\nAnswer: A.\n\n## Restatement');
  const cap = lintText(more, { source: `${D}/interview.md`, registry: REGISTRY }).find((p) => p.code === 'interview-cap');
  assert.match(cap.hint, /take the standard track instead/);
  assert.doesNotMatch(cap.hint, /mirai-new/);
  // The brief's track is the intake's.
  const brief = lintText(BRIEF.replace('track: standard', 'track: full').replace('Track: standard,', 'Track: full,'), { source: `${D}/brief.md`, registry: REGISTRY, linked: { 'interview.md': standard } });
  assert.ok(brief.some((p) => p.code === 'brief-track' && /intake confirmed track standard, the brief says full/.test(p.reason)));
  // The skill carries the steps.
  const skill = read('skills/mirai-interview/SKILL.md');
  for (const w of ['## The intake (/mirai-new, /mirai-prd)', 'At most 2 intake questions', 'Never propose `quick` for a request your intake found unclear', 'never\n     `/mirai-new` again']) assert.ok(skill.includes(w), w);
});

// ---- T2 Labels ----------------------------------------------------------------------------------

test('44 T2: Vera\'s labels: F1 writing, F2 a decision (audience), F3 a decision (scope), each with its kind_reason; a finding without kind is dropped and logged, the others count', () => {
  const s = { 'document.md': { text: PRD, path: `${D}/prd.md`, checked: true } };
  const got = findingsFrom({ findings: [F1, F2, F3] }, s);
  assert.deepEqual(got.findings.map((f) => [f.id, f.kind, f.decision_type ?? null, f.kind_reason]), [['F1', 'writing', null, F1.kind_reason], ['F2', 'decision', 'audience', F2.kind_reason], ['F3', 'decision', 'scope', 'scope']]);
  const { kind: _k, ...noKind } = F1;
  const without = findingsFrom({ findings: [noKind, F2] }, s);
  assert.deepEqual(without.findings.map((f) => f.id), ['F2']);
  assert.match(without.dropped[0].why, /it breaks the schema/);
  // The checklists carry the backstop line, and Vera's prompt the rule.
  for (const c of ['templates/prd-checklist.md', 'templates/brief-checklist.md']) assert.match(read(c), /invented decision/);
  const vera = read('agents/mirai-verifier.md');
  for (const w of ['**When in doubt: `decision`.**', '`invented`']) assert.ok(vera.includes(w), w);
});

// ---- T3 Rounds only for writing -----------------------------------------------------------------

test('44 T3: rounds only for writing: a result holding only decisions uses no round, and F2 is asked at once (round 1); F1 open uses one', async () => {
  // The rule on the books.
  const b = freshBooks('own-due-dates-prd', 1);
  assert.equal(countCheck(b, { check: 'verify', hash: 'h1', writingOpen: 0 }).counted, false);
  assert.equal(countCheck(b, { check: 'verify', hash: 'h2', writingOpen: 1 }).counted, false, 'the first after a decision-only result');
  assert.equal(countCheck(b, { check: 'verify', hash: 'h3', writingOpen: 0 }).counted, true, 'after a result with writing open');
  assert.equal(countCheck(b, { check: 'verify', hash: 'h3', writingOpen: 0 }).counted, false, 'the same text again');
  // F2 alone: asked in round 1; she writes (open) and the question, and pauses.
  const f = fixture({ config: '\n[docs]\nverify_fix_rounds = 2\n' });
  const first = await nora(f, (o) => {
    assert.equal(indexOf(o).step, 'fix');
    const handoff = o.inputs['findings.md'];
    assert.match(handoff, /"ask_these": \[\n\s+\{\n\s+"id": "F2"/);
    assert.match(handoff, /"fix_these": \[\]/);
    put(f, `${D}/prd.md`, PRD.replace(FR1, FR1_OPEN));
    put(f, `${D}/interview.md`, withQuestions(INTERVIEW, [findingQuestion(4, F2)]));
    return result({ outcome: 'paused', question: 'Q-4' });
  }, fakeVera(() => [F2]));
  assert.equal(first.r.state, 'paused', first.r.why);
  assert.equal(first.r.question_id, 'Q-4');
  const books = readBooks(f.store, 'own-due-dates-prd', 1);
  assert.equal(books.rounds_used.verify, 0, 'no round for a decision');
  assert.deepEqual(books.asked.map((a) => [a.finding_id, a.question_id, a.decision_type]), [['F2', 'Q-4', 'audience']]);
  assert.deepEqual(journal(f, 'decision_question').map((e) => [e.item, e.version, e.round, e.question_id, e.decision_type, e.fingerprint, e.source]), [['own-due-dates-prd', 1, 1, 'Q-4', 'audience', fingerprintOf(F2), 'verifier']]);
  // F1 alone: fixed in one round.
  const g = fixture();
  const second = await nora(g, () => {
    put(g, `${D}/prd.md`, PRD.replace('the list must mark it as late.', 'the list must mark it as late from the day after its due date.'));
    return result();
  }, fakeVera((n) => (n === 1 ? [F1] : [])));
  assert.equal(second.r.state, 'done', second.r.why);
  assert.equal(readBooks(g.store, 'own-due-dates-prd', 1).rounds_used.verify, 1);
});

// ---- T4 (open) at approval ----------------------------------------------------------------------

const tty = async (f, argv, answers = []) => {
  let out = '';
  let err = '';
  const { Readable } = await import('node:stream');
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: f.env, cwd: f.root });
  return { code, out, err };
};
const ready = async (f, { findings = [], round = null } = {}) => {
  await passReader({ root: f.root, env: f.env }, `${D}/prd.md`);
  passVera(f, `${D}/brief.md`);
  passVera(f, `${D}/prd.md`, { findings, round });
};

test('44 T4: (open) in the PRD warns naming Q-4, and approval refuses it; the same line after "leave it open" (the Open questions line, accepted) is approved', async () => {
  const opened = PRD.replace(FR1, FR1_OPEN);
  const w = lintText(opened, { source: `${D}/prd.md`, registry: REGISTRY, linked: { 'brief.md': BRIEF } });
  assert.deepEqual(w.filter((p) => p.severity === 'error'), []);
  assert.ok(w.some((p) => p.code === 'prd-open-decision' && p.severity === 'warning' && /asked in interview.md Q-4/.test(p.reason)));
  const f = fixture();
  put(f, `${D}/prd.md`, opened);
  commitAll(f, 'open');
  await ready(f);
  const refused = await tty(f, ['approve', 'own-due-dates-prd', '--file', `${D}/prd.md`], ['a', 'own-due-dates-prd']);
  assert.equal(refused.code, EXIT.BLOCKED, refused.out);
  assert.match(refused.err, /an \(open\) decision can't be approved \(asked in interview.md Q-4\)/);
  // Left open and accepted: the text points to the PRD's own Q-1, accepted by you.
  const accepted = PRD.replace(FR1, '- FR-1: A task\'s owner can set, change or remove its due date; whether others can is open (Q-1). (BR-1)').replace('## Open questions\n', '## Open questions\n\n- Q-1: May anyone besides its owner date a task? Owner: the product owner. Accepted open (the product owner, 2026-11-25). Blocks: sharing tasks.\n');
  put(f, `${D}/prd.md`, accepted);
  commitAll(f, 'left open');
  await ready(f);
  const ok = await tty(f, ['approve', 'own-due-dates-prd', '--file', `${D}/prd.md`], ['a', 'own-due-dates-prd']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.match(ok.out, /approved: the brief own-due-dates-brief and the PRD own-due-dates-prd/);
  // An Open questions line not accepted still blocks approval.
  const notAccepted = lintText(accepted.replace(' Accepted open (the product owner, 2026-11-25).', ''), { source: `${D}/prd.md`, registry: REGISTRY, approving: true, linked: { 'brief.md': BRIEF } });
  assert.ok(notAccepted.some((p) => p.code === 'prd-open'));
});

// ---- T5 Invented decision -----------------------------------------------------------------------

test('44 T5: an invented decision: F2\'s quoted text replaced with no answer gets MIRAI\'s invented-decision finding, must-fix, routed as a decision; Vera\'s own `invented` is routed the same way', async () => {
  const f = fixture();
  const invented = '- FR-1: A task\'s owner or an admin can set, change or remove its due date. (BR-1)';
  const r = await nora(f, (o, n) => {
    if (n === 1) {
      put(f, `${D}/prd.md`, PRD.replace(FR1, invented));
      return result();
    }
    const h = JSON.parse(/BEGINS\n([\s\S]*)\nFINDINGS-[0-9a-f]+ ENDS/.exec(o.inputs['findings.md'])[1].replace(/@​/g, '@'));
    assert.deepEqual(h.ask_these.map((x) => [x.decision_type, x.found_by, x.kind]), [['invented', 'mirai', 'decision']]);
    assert.match(h.ask_these[0].what, /changed without an answer: it said "A task's owner can set, change or remove its due date\."/);
    put(f, `${D}/prd.md`, PRD.replace(FR1, FR1_OPEN));
    put(f, `${D}/interview.md`, withQuestions(INTERVIEW, [findingQuestion(4, { ...h.ask_these[0], where: { quote: h.ask_these[0].where.quote } }, { kind: 'invented' })]));
    return result({ outcome: 'paused', question: 'Q-4' });
  }, fakeVera((n) => (n === 1 ? [F2] : [])));
  assert.equal(r.r.state, 'paused', r.r.why);
  assert.ok(r.events.some((e) => e.kind === 'invented' && e.from === fingerprintOf(F2)));
  // A second invented answer to the same decision ends the run.
  const once = inventedDecisions({ asked: [{ fingerprint: fingerprintOf(F2), finding_id: 'F2', quote: F2.where.quote, question_id: null }], text: PRD.replace(FR1, invented), added: [{ line: 60, text: invented }], path: `${D}/prd.md` });
  assert.equal(once.length, 1);
  assert.deepEqual([once[0].grade, once[0].kind, once[0].decision_type], ['must-fix', 'decision', 'invented']);
  // Kept: an (open) at its place, or its answer cited.
  assert.deepEqual(inventedDecisions({ asked: [{ fingerprint: 'fp-0', quote: F2.where.quote, question_id: 'Q-4' }], text: PRD.replace(FR1, `${invented.slice(0, -7)} (interview Q-4). (BR-1)`), added: [], path: 'p' }), []);
  // Vera's own invented finding is a decision, asked.
  const vi = routeFindings([{ ...F2, decision_type: 'invented' }]);
  assert.deepEqual([vi.ask.length, vi.fix.length], [1, 0]);
});

// ---- T6 The four answers ------------------------------------------------------------------------

test('44 T6: the four answers: answered is written in, vera-wrong drops F3 for @v1 (logged) but @v2 raises it, not-a-decision comes back as writing, left-open goes to Open questions; each writes its decision-answer line', async () => {
  const f = fixture();
  const F4 = finding({ id: 'F4', kind: 'decision', decision_type: 'number', kind_reason: 'a number no source gives', where: { quote: 'then it is refused: "Due dates can\'t be in the past."' }, what: 'No source says whether today is allowed.' });
  const F5 = finding({ id: 'F5', kind: 'decision', decision_type: 'other', kind_reason: 'unsure', where: { quote: 'A task is late from the day after its due date' }, what: 'Is late counted in the owner\'s time zone?' });
  const first = await nora(f, () => {
    put(f, `${D}/prd.md`, PRD.replace(FR1, FR1_OPEN));
    put(f, `${D}/interview.md`, withQuestions(INTERVIEW, [findingQuestion(4, F2), findingQuestion(5, F3, { title: 'A page of late tasks' }), findingQuestion(6, F4, { title: 'Today' }), findingQuestion(7, F5, { title: 'Time zone' })]));
    return result({ outcome: 'paused', question: 'Q-4' });
  }, fakeVera(() => [F2, F3, F4, F5]));
  assert.equal(first.r.state, 'paused', first.r.why);
  assert.equal(journal(f, 'decision_question').length, 4);
  answerAll(f, [['Q-4', 'A. The owner only.', 'answered'], ['Q-5', 'B. NG-4 says a page is left out.', 'vera-wrong'], ['Q-6', 'C.', 'not-a-decision'], ['Q-7', 'D.', 'left-open']]);
  const lint = lintText(get(f, `${D}/interview.md`), { source: `${D}/interview.md`, registry: REGISTRY }).filter((p) => p.severity === 'error');
  assert.deepEqual(lint, [], 'the answered interview lints clean');
  const seen = [];
  const second = await nora(f, (o, n) => {
    seen.push({ step: indexOf(o).step, decisions: o.inputs['decisions.json'] ? JSON.parse(o.inputs['decisions.json']) : null, findings: o.inputs['findings.md'] ?? null });
    if (n === 1) put(f, `${D}/prd.md`, PRD.replace(FR1, '- FR-1: A task\'s owner can set, change or remove its due date; nobody else can (interview Q-4). (BR-1)').replace('## Open questions\n', '## Open questions\n\n- Q-1: Is late counted in the owner\'s time zone? Owner: the product owner. Accepted open (the product owner, 2026-11-25). Blocks: travel.\n'));
    else put(f, `${D}/prd.md`, get(f, `${D}/prd.md`).replace('then it is refused: "Due dates can\'t be in the past."', 'then it is refused: "Due dates can\'t be in the past." Today itself is allowed.'));
    return result();
  }, fakeVera((n) => (n === 1 ? [F3, F4] : n === 2 ? [F3] : [])));
  assert.equal(second.r.state, 'done', second.r.why);
  assert.deepEqual(seen[0].decisions.answers.map((a) => [a.question, a.answer_type]), [['Q-4', 'answered'], ['Q-5', 'vera-wrong'], ['Q-6', 'not-a-decision'], ['Q-7', 'left-open']]);
  assert.match(seen[0].decisions.answers[3].do, /Accepted open/);
  // not-a-decision: F4 came back as a writing finding to fix; F3 dismissed, never sent.
  const h = JSON.parse(/BEGINS\n([\s\S]*)\nFINDINGS-[0-9a-f]+ ENDS/.exec(seen[1].findings)[1]);
  assert.deepEqual(h.fix_these.map((x) => [x.id, x.kind]), [['F4', 'writing']]);
  assert.deepEqual(h.ask_these, []);
  assert.ok(second.events.some((e) => e.kind === 'dismissed' && e.id === 'F3'), 'the drop is logged');
  assert.deepEqual(journal(f, 'decision_answer').map((e) => [e.question_id, e.answer_type, e.version]), [['Q-4', 'answered', 1], ['Q-5', 'vera-wrong', 1], ['Q-6', 'not-a-decision', 1], ['Q-7', 'left-open', 1]]);
  const books = readBooks(f.store, 'own-due-dates-prd', 1);
  assert.deepEqual(books.dismissed.map((d) => d.fingerprint), [fingerprintOf(F3)]);
  assert.ok(books.drops.some((d) => d.fingerprint === fingerprintOf(F3)));
  // @v2 has its own books: F3 is raised again.
  const v2 = routeFindings([F3], { books: freshBooks('own-due-dates-prd', 2) });
  assert.deepEqual(v2.ask.map((x) => x.id), ['F3']);
  assert.deepEqual(routeFindings([F3], { books }).dropped.map((x) => x.id), ['F3']);
});

// ---- T7 Too many --------------------------------------------------------------------------------

const MINIMAL = 'schema_version = 1\n[git]\nintegration_branch = "main"\n';
function configProblems({ project = MINIMAL, personal } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mirai-44-config-'));
  mkdirSync(join(dir, 'repo', '.mirai'), { recursive: true });
  writeFileSync(join(dir, 'repo', '.mirai', 'config.toml'), project);
  const files = { projectRoot: join(dir, 'repo'), globalFile: join(dir, 'home', '.config', 'mirai', 'config.toml') };
  if (personal !== undefined) {
    files.personalRepoFile = join(dir, 'config.user.toml');
    writeFileSync(files.personalRepoFile, personal);
  }
  try {
    return { config: loadConfig(files).config };
  } catch (err) {
    assert.ok(err instanceof ConfigError, String(err));
    return { problems: (err.errors ?? [{ reason: err.reason }]).map((e) => `${e.reason} ${e.hint ?? ''}`).join('\n') };
  }
}

test('44 T7: too many: with max_decision_questions = 5, a sixth decision makes MIRAI ask one "reopen the brief interview?" question; both choices are recorded; out of range, or in a personal file, is refused', async () => {
  assert.equal(configProblems({ project: `${MINIMAL}[docs]\nmax_decision_questions = 3\n` }).config.docs.max_decision_questions, 3);
  for (const bad of ['max_decision_questions = 0', 'max_decision_questions = 21']) assert.match(configProblems({ project: `${MINIMAL}[docs]\n${bad}\n` }).problems, /max_decision_questions/);
  assert.match(configProblems({ personal: 'schema_version = 1\n[docs]\nmax_decision_questions = 4\n' }).problems, /personal file/);
  const six = Array.from({ length: 6 }, (_, i) => finding({ id: `D${i + 1}`, kind: 'decision', decision_type: 'scope', kind_reason: 'scope', where: { quote: 'A task\'s owner can set, change or remove its due date.' }, what: `Decision number ${i + 1}.` }));
  for (const choice of ['A', 'B']) {
    const f = fixture({ config: '\n[docs]\nmax_decision_questions = 5\n' });
    const r = await nora(f, () => assert.fail('no launch: MIRAI asks the one question itself'), fakeVera(() => six));
    assert.equal(r.r.state, 'paused', r.r.why);
    assert.equal(r.n.calls.length, 0);
    const i = get(f, `${D}/interview.md`);
    assert.match(i, /### Q-4: Reopen the brief interview\?\n\nKind: reopen/);
    assert.match(i, /found 6 decisions only you can make, more than 5 on one version/);
    assert.match(i, /^state: paused$/m);
    assert.deepEqual(journal(f, 'decision_question').map((e) => [e.question_id, e.decision_type, e.source]), [['Q-4', 'reopen', 'too-many']]);
    let t = i.replace(/(### Q-4:[\s\S]*?)Answer:\n/, `$1Answer: ${choice}.\n`).replace('state: paused', 'state: confirmed');
    put(f, `${D}/interview.md`, t);
    assert.deepEqual(lintText(t, { source: `${D}/interview.md`, registry: REGISTRY }).filter((p) => p.severity === 'error'), []);
    commitAll(f, 'choice');
    const again = await nora(f, () => {
      put(f, `${D}/prd.md`, `${get(f, `${D}/prd.md`)}\n`);
      return result();
    }, fakeVera(() => []));
    assert.equal(again.r.state, 'done', again.r.why);
    assert.deepEqual(journal(f, 'decision_answer').map((e) => [e.question_id, e.answer_type]), [['Q-4', choice === 'A' ? 'reopen' : 'go-on']]);
    assert.equal(readBooks(f.store, 'own-due-dates-prd', 1).too_many.choice, choice === 'A' ? 'reopen' : 'go-on');
  }
});

// ---- T8 Rounds out ------------------------------------------------------------------------------

test('44 T8: rounds out: F1 still open after 2 rounds: she sorts it into a question; after your answer one answer run (not a round) and one more check, then approval shows what is left', async () => {
  const f = fixture();
  let k = 0;
  const first = await nora(f, (o) => {
    if (indexOf(o).step === 'sort') {
      assert.match(o.inputs['findings.md'], /The rounds for fixing are used/);
      put(f, `${D}/interview.md`, withQuestions(INTERVIEW, [findingQuestion(4, F1, { title: 'From which day', kind: 'number' })]));
      return result({ outcome: 'paused', question: 'Q-4' });
    }
    put(f, `${D}/prd.md`, `${PRD}${'\n'.repeat(++k)}`);
    return result();
  }, fakeVera(() => [F1]));
  assert.equal(first.r.state, 'paused', first.r.why);
  assert.deepEqual(first.n.calls.map((c) => indexOf(c).step), ['fix', 'fix', 'sort']);
  let books = readBooks(f.store, 'own-due-dates-prd', 1);
  assert.equal(books.rounds_used.verify, 2);
  assert.equal(books.rounds_out.asked, true);
  assert.deepEqual(journal(f, 'decision_question').map((e) => [e.question_id, e.source, e.decision_type]), [['Q-4', 'rounds-out', 'number']]);
  answerAll(f, [['Q-4', 'A. The day after.', 'answered']]);
  const second = await nora(f, (o) => {
    assert.equal(indexOf(o).step, 'continue');
    put(f, `${D}/prd.md`, `${get(f, `${D}/prd.md`)}\n`);
    return result();
  }, fakeVera(() => [F1]));
  assert.equal(second.r.state, 'done', second.r.why);
  assert.equal(second.n.calls.length, 1, 'one answer run, no fix round');
  assert.deepEqual(second.r.open, [{ document: 'prd', vera: 1 }]);
  books = readBooks(f.store, 'own-due-dates-prd', 1);
  assert.equal(books.answer_runs, 1);
  assert.equal(books.rounds_used.verify, 2, 'the answer run is not a round');
  const results = readVerifyResults(f.store, 'own-due-dates-prd');
  assert.equal(results.at(-1).round, 4, 'Vera once more, in the same cycle');
  await passReader({ root: f.root, env: f.env }, `${D}/prd.md`);
  passVera(f, `${D}/brief.md`);
  const shown = await tty(f, ['approve', 'own-due-dates-prd', '--file', `${D}/prd.md`], ['r', 'probe']);
  assert.match(shown.out, /1 finding open after the last round \(round 4/);
});

// ---- T9 Approve anyway --------------------------------------------------------------------------

test('44 T9: approve anyway: with 2 must-fix open after the last round approval shows "2 findings open", and the signed line holds both fingerprints in vera_open', async () => {
  const f = fixture();
  await ready(f, { findings: [F1, { ...F2, grade: 'must-fix', kind: 'writing', decision_type: undefined }], round: 3 });
  const r = await tty(f, ['approve', 'own-due-dates-prd', '--file', `${D}/prd.md`], ['a', 'own-due-dates-prd']);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /2 findings open after the last round/);
  const line = journal(f, 'approval').find((e) => e.kind === 'prd');
  assert.deepEqual(line.vera_open, [fingerprintOf(F1), fingerprintOf(F2)]);
  assert.ok(line.signature, 'signed');
  // A result whose open findings are all decisions is yours to decide at once.
  const g = fixture();
  await ready(g, { findings: [F2], round: 1 });
  const d = await tty(g, ['approve', 'own-due-dates-prd', '--file', `${D}/prd.md`], ['a', 'own-due-dates-prd']);
  assert.equal(d.code, EXIT.OK, d.err);
  assert.match(d.out, /1 finding open, each a decision only you can make/);
});

// ---- T10 and T13 Publish and links ---------------------------------------------------------------

test('44 T10/T13: approval publishes: on the local store it says there is nothing to do; with no host it says so, names mirai docs publish, and the approval stands; each line ends with the full path', async () => {
  const f = fixture();
  await ready(f);
  const r = await tty(f, ['approve', 'own-due-dates-prd', '--file', `${D}/prd.md`], ['a', 'own-due-dates-prd']);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /published: not yet: [^\n]*; your approval stands\. Publish it when that's fixed: mirai docs publish own-due-dates/);
  assert.ok(r.out.includes(join(f.root, D, 'prd.md')), 'the full path');
  assert.ok(journal(f, 'approval').some((e) => e.kind === 'prd' && e.decision === 'accepted'));
});

// ---- T11 pre-commit -----------------------------------------------------------------------------

async function hook(f) {
  let out = '';
  let err = '';
  const code = await main(['hook', 'pre-commit'], { stdin: { isTTY: false }, stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: f.env, cwd: f.root });
  return { code, out, err };
}

test('44 T11: pre-commit: a hand-added status is refused; a record with a bad signature is refused; an edit to an approved PRD warns with the seq and both ways out, and goes through; a repo\'s own pre-commit runs first', async () => {
  const f = fixture();
  put(f, `${D}/prd.md`, PRD.replace('variant: lite', 'variant: lite\nstatus: approved'));
  f.git('add', '-A');
  const st = await hook(f);
  assert.equal(st.code, EXIT.BLOCKED, st.err);
  assert.match(st.err, /refused: docs\/mirai\/own-due-dates\/prd\.md:7: a prd keeps no status in its frontmatter \(status: approved\)/);
  f.git('reset', '-q', '--hard');
  // A record under .mirai/records/ that doesn't verify.
  put(f, '.mirai/records/SAMPLE-1/gate-r1-0123456789ab.json', '{"schema":"mirai-proof/1"}\n');
  f.git('add', '-A');
  const rec = await hook(f);
  assert.equal(rec.code, EXIT.BLOCKED);
  assert.match(rec.err, /refused: \.mirai\/records\/SAMPLE-1\/gate-r1-0123456789ab\.json:1: its signature doesn't verify against the committed keys/);
  f.git('reset', '-q', '--hard');
  put(f, '.mirai/records/SAMPLE-1/notes.txt', 'mine\n');
  f.git('add', '-A');
  assert.match((await hook(f)).err, /isn't a record MIRAI writes/);
  f.git('reset', '-q', '--hard');
  f.git('clean', '-qfd');
  // An approved PRD changed: a warning, and the commit goes through.
  await ready(f);
  const ok = await tty(f, ['approve', 'own-due-dates-prd', '--file', `${D}/prd.md`], ['a', 'own-due-dates-prd']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  const seq = journal(f, 'approval').find((e) => e.kind === 'prd').seq;
  put(f, `${D}/prd.md`, `${PRD}\n`);
  f.git('add', '-A');
  const warn = await hook(f);
  assert.equal(warn.code, EXIT.OK, warn.err);
  assert.match(warn.err, new RegExp(`warning: docs/mirai/own-due-dates/prd\\.md: this commit makes your approval of the prd own-due-dates-prd \\(seq ${seq}\\) stale`));
  assert.match(warn.err, /write a new draft beside it \(prd\.v2\.draft\.md\), or approve it again: mirai approve own-due-dates-prd --file docs\/mirai\/own-due-dates\/prd\.md/);
  assert.deepEqual(stagedChanges(['1 M. N... 100644 100644 100644 a b x.md', '1 .M N... 100644 100644 100644 a b y.md', '1 D. N... 100644 000000 000000 a b z.md']).map((c) => c.path), ['x.md']);
  // The installer: MIRAI's pre-commit beside pre-push, checked; a repo's own pre-commit forwarded and run first.
  const own = join(f.root, '.git', 'hooks');
  mkdirSync(own, { recursive: true });
  writeFileSync(join(own, 'pre-commit'), '#!/bin/sh\necho "own hook ran"\nexit 1\n');
  chmodSync(join(own, 'pre-commit'), 0o755);
  const store = openStore({ cwd: f.root, env: f.env });
  installHooks({ store, env: f.env, node: process.execPath, launcher: join(f.root, 'bin', 'mirai.js'), forward: { from: own, names: ['pre-commit'] } });
  const planned = plannedFiles({ node: process.execPath, launcher: join(f.root, 'bin', 'mirai.js'), pre_commit: true, hooks: ['pre-commit'], forwarded_from: own });
  assert.ok(planned.has('pre-commit') && planned.has('pre-push'));
  assert.equal(hooksState({ store, env: f.env }).state, 'ok');
  const refusedByOwn = await hook(f);
  assert.equal(refusedByOwn.code, EXIT.FAILURE);
  assert.match(refusedByOwn.err, /your own pre-commit \([^)]*pre-commit\) refused the commit/);
  writeFileSync(join(own, 'pre-commit'), '#!/bin/sh\nexit 0\n');
  const after = await hook(f);
  assert.equal(after.code, EXIT.OK);
  assert.match(after.err, /warning: docs\/mirai\/own-due-dates\/prd\.md: this commit makes your approval/, 'MIRAI\'s checks ran after it');
});

// ---- T12 The books ------------------------------------------------------------------------------

test('44 T12: the books: @v1 and @v2 keep separate rounds; a ticket\'s doc-PRD-1 and a document PRD-1 don\'t share a file; the cost lands in the ledger fields; a file that can\'t be read refuses, never resets', () => {
  const f = fixture();
  assert.equal(versionOf('docs/mirai/x/prd.md'), 1);
  assert.equal(versionOf('docs/mirai/x/prd.v2.draft.md'), 2);
  assert.equal(bookKey('prd-guest-checkout', 2), 'prd-guest-checkout@v2');
  assert.throws(() => bookKey('a/b', 1), /not a document id/);
  changeBooks(f.store, 'prd-guest-checkout', 1, (b) => countCheck(countCheck(b, { check: 'verify', hash: 'a', writingOpen: 1 }).books, { check: 'verify', hash: 'b', writingOpen: 0 }).books);
  changeBooks(f.store, 'prd-guest-checkout', 2, (b) => addCost(b, { turns: 4, cost_usd: 1.5, tokens_in: 10, tokens_out: 5 }));
  assert.equal(readBooks(f.store, 'prd-guest-checkout', 1).rounds_used.verify, 1);
  assert.equal(readBooks(f.store, 'prd-guest-checkout', 2).rounds_used.verify, 0);
  assert.deepEqual([readBooks(f.store, 'prd-guest-checkout', 2).budget.cost_usd, readBooks(f.store, 'prd-guest-checkout', 2).budget.tokens, readBooks(f.store, 'prd-guest-checkout', 2).launches], [1.5, 15, 1]);
  assert.ok(existsSync(join(f.store.dir, 'loop', 'docs', 'prd-guest-checkout@v1.json')));
  changeBooks(f.store, 'PRD-1', 1, (b) => addCost(b, { turns: 1 }));
  assert.equal(readLoop(f.store, 'doc-PRD-1').rounds_used, 0, 'the ticket\'s counters are fresh');
  assert.ok(existsSync(join(f.store.dir, 'loop', 'docs', 'PRD-1@v1.json')));
  assert.ok(!existsSync(join(f.store.dir, 'loop', 'doc-PRD-1.json')));
  writeFileSync(join(f.store.dir, 'loop', 'docs', 'PRD-1@v1.json'), '{"schema":1');
  assert.throws(() => readBooks(f.store, 'PRD-1', 1), (e) => e.code === 'docs-loop-unreadable' && /never reset by guessing/.test(e.message));
});

// ---- T14 Show -----------------------------------------------------------------------------------

test('44 T14: mirai show <initiative> shows "waiting for you" with the open Q-ns; no DOCUMENT state changes', async () => {
  assert.deepEqual(DOCUMENT.states, ['draft', 'in-review', 'changes-requested', 'approved', 'superseded', 'obsolete', 'dropped'], 'the DOCUMENT machine as 07 built it');
  const paused = withQuestions(INTERVIEW, [findingQuestion(4, F2), findingQuestion(5, F3), findingQuestion(6, F1, { kind: 'number' })]);
  assert.equal(waitingLine(paused), 'waiting for you: 3 questions in interview.md (Q-4…Q-6): answer them in your session, then start the writer again');
  assert.equal(waitingLine(INTERVIEW), null);
  const f = fixture();
  put(f, `${D}/interview.md`, paused);
  appendEvent(f.store, { type: 'nora_run', by: 'script', item: I, run_id: 'r-20261125-010203-abcd', state: 'running' });
  appendEvent(f.store, { type: 'nora_run', by: 'script', item: I, run_id: 'r-20261125-010203-abcd', state: 'paused', document: 'prd', question_id: 'Q-4', question: 'Q-4: Who sets the date', rounds: { lint: 0, verify: 1, reader: 0 }, launches: 1, template_gaps: 0 });
  const r = await tty(f, ['show', I]);
  assert.match(r.out, /waiting for you: 3 questions in interview\.md \(Q-4…Q-6\)/);
  assert.ok(noraStateLines(readJournal(f.store).events, I).some((l) => /paused on the PRD, waiting for your answer to Q-4/.test(l)));
});

// ---- T15 The docs -------------------------------------------------------------------------------

test('44 T15: the docs name /mirai-new, the tracks, writing vs decision, the four answers, the rounds-out step, publishing, the pre-commit hook and max_decision_questions', () => {
  const docs = (n) => readFileSync(join(REGISTRY_DIR, '..', 'docs', n), 'utf8');
  const documents = docs('documents.md').replace(/\s+/g, ' ');
  for (const w of ['/mirai-new', 'quick', 'writing', 'decision', 'Vera is wrong', 'not a decision, just fix it', 'leave it open and accept it', 'rounds-out', 'mirai docs publish', '## Assumptions']) assert.ok(documents.includes(w), w);
  assert.match(docs('pre-commit.md'), /status/);
  assert.match(docs('config.md'), /docs\.max_decision_questions/);
  assert.match(docs('loop-rules.md'), /loop\/docs\/<id>@v<n>\.json/);
});

// ---- The look-ahead (interview with Jet, 2026-11-25) -----------------------------------------------

test('44 look-ahead: the interview\'s Assumptions: approved together or corrected by number; a confirmed interview with one not approved is refused; the PRD carries each under its A-n; Nora and Vera are told', () => {
  const lint = (text) => lintText(text, { source: `${D}/interview.md`, registry: REGISTRY }).filter((p) => p.severity === 'error').map((p) => `${p.code}: ${p.reason}`);
  const list = (a2) => `## Assumptions\n\n- A-1: Only the task's owner sees its due date. Source: business.md (S-1). Approved: yes\n- A-2: A task is late from the day after its due date. Source: Q-1. ${a2}\n\n## Restatement`;
  const ok = INTERVIEW.replace('## Restatement', list('Approved: corrected: in the owner\'s own time zone'));
  assert.deepEqual(lint(ok), []);
  const as = assumptionsOf(parseDocument(ok, 'i.md'));
  assert.deepEqual(as.map((a) => [a.id, a.ok, a.corrected, a.source]), [['A-1', true, null, 'business.md (S-1)'], ['A-2', true, 'in the owner\'s own time zone', 'Q-1']]);
  assert.ok(lint(INTERVIEW.replace('## Restatement', list('Approved:'))).some((l) => /interview-assumption: A-2 isn't approved, and the interview is confirmed/.test(l)));
  assert.ok(lint(INTERVIEW.replace('## Restatement', list('Approved: maybe'))).some((l) => /A-2's "Approved: maybe" isn't a yes or a correction/.test(l)));
  assert.ok(lint(INTERVIEW.replace('## Restatement', '## Assumptions\n\n- A-1: Something. Approved: yes\n\n## Restatement')).some((l) => /A-1 has no source/.test(l)));
  // Paused, an unapproved one is fine (the owner hasn't seen the list yet).
  assert.ok(!lint(INTERVIEW.replace('state: confirmed', 'state: paused').replace('## Restatement', list('Approved:'))).some((l) => /interview-assumption/.test(l)));
  // The PRD carries them, under the same numbers, saying so.
  const carried = CARRIED;
  const prd = (text) => lintText(text, { source: `${D}/prd.md`, registry: REGISTRY, linked: { 'brief.md': BRIEF, 'interview.md': ok } }).filter((p) => p.code === 'prd-interview-assumption');
  assert.deepEqual(prd(carried), []);
  assert.ok(prd(PRD).some((p) => /A-1 is the interview's approved assumption/.test(p.reason)));
  assert.ok(prd(PRD).some((p) => /A-2, approved in the interview/.test(p.reason)));
  // Nora and Vera.
  const nora = read('agents/mirai-product-manager.md');
  for (const w of ['**The interview\'s approved assumptions**', 'never pause on one', 'Approved in the interview.']) assert.ok(nora.includes(w), w);
  assert.match(read('templates/prd-checklist.md'), /\[vera\] Is every assumption the owner approved in the interview/);
  const skill = read('skills/mirai-interview/SKILL.md');
  for (const w of ['## The look-ahead (before the restatement)', 'prd-checklist.md', '"ok, or correct any by number"', 'Approved: corrected:']) assert.ok(skill.includes(w), w);
  // Vera gets the interview beside a PRD.
  const f = fixture();
  const s = verifySubject({ cwd: f.root, env: f.env, file: `${D}/prd.md` });
  assert.ok(Object.hasOwn(verifyInputs(s).inputs, 'upstream-interview.md'));
});

// ---- Re-checks: 40's P3 (the incremental re-check), 42, 43 --------------------------------------

test('44 (40\'s P3, Jet\'s "B"): Vera\'s later rounds are incremental: her previous findings and the diff since her last check; a new finding on unchanged text is dropped and logged', async () => {
  const f = fixture();
  const seen = [];
  const r = await nora(f, () => {
    put(f, `${D}/prd.md`, PRD.replace('the list must mark it as late.', 'the list must mark it as late from the day after its due date.'));
    return result();
  }, fakeVera((n, o) => {
    seen.push(o);
    // Her second check raises a new must-fix on FR-5, which didn't change.
    return n === 1 ? [F1] : [finding({ id: 'N1', kind: 'writing', kind_reason: 'x', where: { quote: 'the list must show and sort it exactly as it does today' }, what: 'A new finding on old text.' })];
  }));
  assert.equal(r.r.state, 'done', r.r.why);
  const second = seen[1];
  const idx = JSON.parse(second.inputs['index.json']);
  assert.equal(idx.verify.incremental, true);
  assert.match(second.inputs['previous-findings.json'], /"id": "F1"/);
  assert.match(second.inputs['changes.diff'], /\+ \d+: - FR-3: While a task is past its due date and not done, the list must mark it as late from the day after its due date\./);
  assert.match(second.prompt, /This is a re-check/);
  const last = readVerifyResults(f.store, 'own-due-dates-prd').at(-1);
  assert.equal(last.must_fix, 0);
  assert.match(last.dropped[0].why, /on text checked before and unchanged since/);
  const inc = incrementalInputs({ text: PRD, entry: { round: 1, findings: [] } }, PRD);
  assert.equal(inc.diff, '(no line changed)\n');
});

test('44 (the 43 and 42 re-checks): Nora\'s prompt retires an ID instead of deleting it; the decision question uses the shared pause place; the hand-off lists both kinds with fingerprints', () => {
  const nora = read('agents/mirai-product-manager.md');
  assert.ok(nora.includes('`- FR-4: Retired — <why>`'));
  assert.ok(nora.includes(PAUSE_PLACE));
  const h = routedHandoff(routeFindings([F1, F2]), { file: `${D}/prd.md`, round: 1 });
  assert.match(h, /"fix_these": \[\n\s+\{\n\s+"id": "F1",\n\s+"fingerprint": "fp-[0-9a-f]{16}"/);
  assert.match(h, /"ask_these": \[\n\s+\{\n\s+"id": "F2"/);
  assert.match(h, /never yours to answer/);
  // Answer types come from the option chosen when the line is missing.
  const q = questionsOf(parseDocument(withQuestions(INTERVIEW, [findingQuestion(4, F2, { answer: 'B.' })], 'confirmed'), 'i.md')).find((x) => x.id === 'Q-4');
  assert.equal(answerTypeOf(q), 'vera-wrong');
});

// ---- The probes' tooling (test/probes/prd-probes.js), with no model -----------------------------

test('44 probes: --check builds every home clean; --auto runs each side of the look-ahead comparison and P1 with stand-in launches, printing pauses and Vera\'s must-fix count and kinds; nothing in src/ imports the probe', async () => {
  const probes = await import('../probes/prd-probes.js');
  const lines = [];
  assert.equal(await probes.checkAll((l) => lines.push(l)), 0, lines.join('\n'));
  assert.equal(lines.length, 4);
  assert.match(lines.find((l) => l.startsWith('p2')), /8 seeds, a hand-set status refused at commit/);
  const run = async (key, lookahead) => {
    const workdir = mkdtempSync(join(tmpdir(), 'mirai-u44-auto-'));
    const home = await probes.prdHome({ workdir, key, claude: null, token: FAKE_TOKEN });
    const write = async (o) => {
      const doc = JSON.parse(o.inputs['index.json']).nora?.document;
      const carry = /## Assumptions/.test(readFileSync(join(home.root, D, 'interview.md'), 'utf8'));
      if (doc) put({ root: home.root }, `${D}/${doc}.md`, doc === 'brief' ? BRIEF : carry ? CARRIED : PRD);
      return { outcome: 'ok', why: null, launchId: '20261125120000-0123abcd', structured: result(), line: {} };
    };
    const vera = fakeVera(() => []);
    const log = [];
    const r = await probes.runProbe(home, key, { log: (l) => log.push(l), launches: { ...(lookahead ? { lookahead } : {}), nora: { launch: write, verifyLaunch: vera.launch, readerLaunch: fakeReader().launch, readerClaude: FAKE_CLAUDE } } });
    return { r, log, home };
  };
  const without = await run('lookahead-without');
  assert.equal(without.r.pass, true, without.r.why);
  assert.ok(without.log.includes('pauses: 0'));
  assert.ok(without.log.includes('Vera on own-due-dates-prd: round 1, 0 must-fix'));
  // The "with" side: the stand-in look-ahead adds two assumptions and a question; the probe approves
  // the list and answers the question with its guess.
  const lookahead = async (o) => {
    const abs = join(o.cwd, D, 'interview.md');
    const t = readFileSync(abs, 'utf8').replace('state: confirmed', 'state: open').replace('## Restatement', '### Q-4: Removing a date\n\nConfidence: about 80%. Still open: removing a date.\n\nMay a person remove a due date once set?\n\n- A: yes, at any time\n- B: no\n\nGuess: A, because the request says nothing against it.\n\nAnswer:\n\n## Assumptions\n\n- A-1: Only a task\'s owner sees its due date. Source: business.md (S-1). Approved:\n- A-2: A task is late from the day after its due date. Source: Q-1. Approved:\n\n## Restatement');
    writeFileSync(abs, t);
    return { outcome: 'ok', why: null, launchId: '20261125110000-0123abcd', structured: result(), line: {} };
  };
  const withIt = await run('lookahead-with', lookahead);
  assert.equal(withIt.r.pass, true, withIt.r.why);
  assert.ok(withIt.log.some((l) => /^look-ahead: 2 assumption\(s\) \(A-1, A-2\), 1 new question\(s\) \(Q-4\)$/.test(l)), withIt.log.join('\n'));
  assert.match(readFileSync(join(withIt.home.root, D, 'interview.md'), 'utf8'), /A-2: A task is late from the day after its due date\. Source: Q-1\. Approved: yes/);
  // P1: the approval publishes (no host here: it says so), and the forged status is refused at commit.
  const p1 = await run('p1', lookahead);
  assert.equal(p1.r.pass, true, `${p1.r.why}\n${p1.log.join('\n')}`);
  assert.ok(p1.log.some((l) => /^ {2}published: not yet/.test(l)));
  assert.ok(p1.log.some((l) => /^pre-commit: refused docs\/mirai\/own-due-dates\/prd\.md:\d+: a prd keeps no status/.test(l)));
  // Test tooling only.
  const { spawnSync } = await import('node:child_process');
  const hits = spawnSync('/usr/bin/grep', ['-rl', 'prd-probes', join(REGISTRY_DIR, '..', 'src')], { encoding: 'utf8' });
  assert.deepEqual([hits.status, hits.stdout.trim()], [1, '']);
});

test('44 probes: P2\'s rules are checked from the home (a seed left in, a decision never asked, an invented number in NFR-2), and the evidence is kept', async () => {
  const probes = await import('../probes/prd-probes.js');
  const workdir = mkdtempSync(join(tmpdir(), 'mirai-u44-p2check-'));
  const home = await probes.prdHome({ workdir, key: 'p2', claude: null, token: FAKE_TOKEN });
  const log = [];
  const seeded = probes.p2Check(home, (l) => log.push(l));
  assert.equal(seeded.filter((p) => p.startsWith('writing seed still in the PRD')).length, 3, seeded.join('\n'));
  assert.deepEqual(seeded.filter((p) => p.startsWith('decision seed')).map((p) => p.match(/\((\w+)\)/)[1]), ['audience', 'number', 'scope']);
  assert.ok(seeded.every((p) => !p.startsWith('decision seed') || /still holds it$/.test(p)), seeded.join('\n'));
  assert.ok(log.some((l) => /^p2: NFR-2 invents no number: "- NFR-2: The list must show the late marks quickly/.test(l)), log.join('\n'));
  assert.ok(log.some((l) => /the seeded wrong finding \(reminders\) wasn't raised/.test(l)));
  // A number no source gives, written into NFR-2, is a failed rule.
  const prd = join(home.root, D, 'prd.md');
  writeFileSync(prd, readFileSync(prd, 'utf8').replace('show the late marks quickly', 'show the late marks within 300 ms'));
  assert.ok(probes.p2Check(home).some((p) => /^NFR-2 holds a number the interview doesn't give: 300\b/.test(p)));
  const kept = probes.keepEvidence(home, 'p2', join(workdir, 'evidence'));
  for (const f of ['interview.md', 'brief.md', 'prd.md', 'docs.diff', 'journal.jsonl']) assert.ok(existsSync(join(kept, f)), f);
});

test('44 T7b: too many counts every question asked on the version, answered or not (Jet, 2026-11-26, Q1 "A"): after 5 answered, the 6th decision makes MIRAI ask "reopen the brief interview?"', async () => {
  const f = fixture({ config: '\n[docs]\nmax_decision_questions = 5\n' });
  changeBooks(f.store, 'own-due-dates-prd', 1, (b) => {
    for (let n = 4; n <= 8; n += 1) b.asked.push({ fingerprint: `fp-${String(n).padStart(16, '0')}`, finding_id: `V-${n}`, quote: 'q', kind: 'decision', decision_type: 'scope', question_id: `Q-${n}`, round: 1, source: 'verifier' });
    b.answered.push('Q-4', 'Q-5', 'Q-6', 'Q-7', 'Q-8');
    return b;
  });
  const one = [finding({ id: 'D9', kind: 'decision', decision_type: 'scope', kind_reason: 'scope', where: { quote: 'A task\'s owner can set, change or remove its due date.' }, what: 'A sixth decision.' })];
  const r = await nora(f, () => assert.fail('no launch: MIRAI asks the one question itself'), fakeVera(() => one));
  assert.equal(r.r.state, 'paused', r.r.why);
  assert.match(get(f, `${D}/interview.md`), /Reopen the brief interview\?\n\nKind: reopen[\s\S]*found 6 decisions only you can make, more than 5 on one version/);
  assert.deepEqual(journal(f, 'decision_question').map((e) => [e.decision_type, e.source]), [['reopen', 'too-many']]);
});

test('44 Q2 "A" (2026-11-26): Vera grades an unnamed market or group as an audience decision, never writing; Nora\'s writing fix adds no new choice (she asks it)', () => {
  const vera = readFileSync(join(REGISTRY_DIR, 'agents', 'mirai-verifier.md'), 'utf8');
  assert.match(vera, /A market or a group of people no source names is `audience`, never `writing`/);
  assert.match(vera, /date format of people in the EU and the US/);
  const nora = readFileSync(join(REGISTRY_DIR, 'agents', 'mirai-product-manager.md'), 'utf8');
  assert.match(nora, /A writing fix adds no new choice/);
  assert.match(nora, /write `\(open\)` and ask it as below, with the choice's `Kind:`/);
});

test('44 Q3 "B" (2026-11-26): a number decision is must-fix in a commitment (Success, an SM-n, an NFR, the appetite), and stays a suggestion in an example', async () => {
  const { inCommitment, regraded } = await import('../../src/verify/findings.js');
  const brief = ['# B', '', '## Success', '', '| SM-1 | Share done | UNKNOWN | 70% | data | Tasks added per weekly user must not fall below the month before |', '', '## Problem', '', 'For example, 3 tasks a day.'].join('\n');
  assert.equal(inCommitment(brief, 5, 'must not fall below the month before'), true);
  assert.equal(inCommitment(brief, 9, 'For example, 3 tasks a day.'), false);
  assert.equal(inCommitment('## Key flows\n\n- see NFR-2 for 500 tasks', 3, 'NFR-2 for 500 tasks'), true);
  const f = { id: 'V-1', grade: 'suggestion', layer: 'checklist', kind: 'decision', decision_type: 'number' };
  assert.deepEqual([regraded(f, { commitment: true }).grade, regraded(f, { commitment: true }).graded_by], ['must-fix', 'a number decision in a commitment']);
  assert.equal(regraded(f).grade, 'suggestion');
  assert.match(readFileSync(join(REGISTRY_DIR, 'agents', 'mirai-verifier.md'), 'utf8'), /a `number` decision in a commitment: a success\n {3}metric or counter-metric, an NFR, or the appetite/);
});
