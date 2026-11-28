import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';

import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { brief, logLine, withAnswer } from '../../src/brainstorm/engine.js';
import { approveQuestions, researchInputs, runResearch, skipResearch } from '../../src/design/research.js';
import { decide, exploreBrief, exploreSettled, exploreState } from '../../src/design/explore.js';
import { adrsFromPicks, decisionProblems, decisionsIn } from '../../src/design/decisions.js';
import { designInputs, designSubject, hardAdrsOpen, readDoc } from '../../src/design/run.js';
import { FAKE_TOKEN, passReader } from '../helpers/reader.js';
import { BRIEF_READY, INTERVIEW, PRD_READY, tty } from '../helpers/docs-fixtures.js';
import { installed } from '../tests/run-fixture.js';

// Unit 65b, T1 (the brainstorm engine), T2 (the explore step and the research run, with a stand-in
// launcher: no model runs), T6 (Arlo follows your decisions).

const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const D = 'docs/mirai/due-dates';
const QUESTIONS = read('examples/research-questions.md').replace(/csv-import/g, 'due-dates');
const RESEARCH = read('examples/research.md').replace(/csv-import/g, 'due-dates');
const ADR = read('examples/adr.md');
const ADR_PATH = 'docs/decisions/ADR-0001-reminder-queue.md';
const SOURCES = [
  ['https://laravel.com/docs/11.x/queues', 'Queues let you defer time consuming tasks, such as parsing a file.'],
  ['https://csv.thephpleague.com/9.0/reader/', 'The Reader class extends the general connections capabilities to read CSV documents.'],
  ['https://www.php.net/manual/en/info.configuration.php', 'This sets the maximum time in seconds a script is allowed to run.'],
  ['https://www.php.net/manual/en/function.fgetcsv.php', 'fgetcsv — Gets line from file pointer and parse for CSV fields'],
];
const RECORD = { listed: SOURCES.map(([u]) => u), evidence: SOURCES.map(([url, result]) => ({ url, code: 200, result })), searches: 4 };
const put = (f, rel, text) => {
  mkdirSync(join(f.root, rel, '..'), { recursive: true });
  writeFileSync(join(f.root, rel), text);
};

async function fixture({ track = 'full' } = {}) {
  const brief0 = BRIEF_READY.replace(/^track: standard$/m, `track: ${track}`).replace('Track: standard, because this changes one app and needs no new service.', track === 'full' ? 'Track: full, because reminders add a queue worker beside the app.' : 'Track: standard, because this changes one app and needs no new service.');
  const files = { [`${D}/brief.md`]: brief0, [`${D}/interview.md`]: INTERVIEW, [`${D}/prd.md`]: PRD_READY.replace('track: standard', `track: ${track}`) };
  const f = installed({ config: '\n[tickets]\nkey_prefix = "SAMPLE"\n', files });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  mkdirSync(join(f.home, '.config', 'mirai'), { recursive: true });
  writeFileSync(join(f.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Test Author"\nauthor_email = "author@example.com"\n', { mode: 0o600 });
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  writeToken(f.env, FAKE_TOKEN);
  const io = { cwd: f.root, env: f.env };
  const g = { ...f, io, store: openStore(io) };
  if (track === 'full') {
    await passReader(g, `${D}/brief.md`);
    const b = await tty(['approve', 'due-dates-brief', '--file', `${D}/brief.md`], io, ['a', 'due-dates-brief']);
    assert.equal(b.code, 0, b.err);
  }
  await passReader(g, `${D}/prd.md`);
  const p = await tty(['approve', 'due-dates-prd', '--file', `${D}/prd.md`], io, ['a', 'due-dates-prd', 'n']);
  assert.equal(p.code, 0, p.err);
  g.prdOffer = p.out;
  g.git('switch', '-q', '-c', 'design-due-dates');
  return g;
}
async function run(f, argv, answers = [], extra = {}) {
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: f.env, cwd: f.root, ...extra });
  return { code, out, err };
}
const events = (f, type) => readJournal(f.store).events.filter((e) => e.type === type);
// A stand-in research launch: what MIRAI would collect from the run's folders.
function researchFakes(texts) {
  const calls = [];
  const launch = async (o) => {
    calls.push(o);
    const text = texts[Math.min(calls.length - 1, texts.length - 1)];
    const got = typeof text === 'function' ? text(o) : { text, ...RECORD };
    return { outcome: 'ok', why: null, launchId: `2026112800000${calls.length}-0123abcd`, line: { model: 'claude-sonnet-5-5', tier: 'standard' }, collected: got };
  };
  return { launch, calls };
}
async function researched(f) {
  put(f, `${D}/research-questions.md`, QUESTIONS);
  approveQuestions({ cwd: f.root, env: f.env, initiative: 'due-dates' });
  const k = researchFakes([RESEARCH]);
  const r = await runResearch({ cwd: f.root, env: f.env, initiative: 'due-dates', nextToken: () => mintLaunchToken(), launch: k.launch });
  assert.equal(r.state, 'done', r.why);
  return { r, k };
}

// ---- T1 ------------------------------------------------------------------------------------------

test('65b T1: the brainstorm engine: a brief with one question at a time, settled ones marked, the caller\'s record command; answers written into the caller\'s file with a dated log, replaced in place', () => {
  const b = brief({
    topic: 'Product questions: x', persona: 'Nora', purpose: 'Decide the open product questions.',
    items: [{ id: 'Q-1', text: 'Who is it for?', options: [{ letter: 'A', text: 'teams' }, { letter: 'B', text: 'solo' }], recommendation: { letter: 'A', why: 'most users' }, settled: null }, { id: 'Q-2', text: 'Pricing?', options: [], recommendation: null, settled: 'B' }],
    record: 'mirai product decide …', after: 'Done.',
  });
  assert.match(b, /One question at a time, in the order below\. Never two in one message\./);
  assert.match(b, /Record each answer as soon as it is given: mirai product decide …/);
  assert.match(b, /## Still open \(1 of 2\)/);
  assert.match(b, /### Q-1: Who is it for\?\n\n- A: teams\n- B: solo\n\nRecommendation: A, most users/);
  assert.match(b, /### Q-2: Pricing\? \(settled: B\)/);
  assert.doesNotMatch(b, /design/i, 'the engine knows no topic');
  const start = '# Decisions\n\n## Decisions\n\n## Log\n';
  const one = withAnswer(start, { section: 'Decisions', id: 'Q-2', heading: 'Second?', entry: '- **Pick:** B', log: logLine('2026-11-28', 'Q-2', 'B') });
  const two = withAnswer(one, { section: 'Decisions', id: 'Q-1', heading: 'First?', entry: '- **Pick:** A', log: logLine('2026-11-28', 'Q-1', 'A, because') });
  assert.ok(two.indexOf('### Q-1') < two.indexOf('### Q-2'), 'kept in order');
  const again = withAnswer(two, { section: 'Decisions', id: 'Q-1', heading: 'First?', entry: '- **Pick:** B', log: logLine('2026-11-29', 'Q-1', 'B after all') });
  assert.equal((again.match(/### Q-1/g) ?? []).length, 1, 'an answer replaces the one there');
  assert.match(again, /### Q-1: First\?\n\n- \*\*Pick:\*\* B/);
  assert.deepEqual(again.split('## Log')[1].trim().split('\n'), ['- 2026-11-28 Q-2: B', '- 2026-11-28 Q-1: A, because', '- 2026-11-29 Q-1: B after all'], 'the log keeps every answer');
});

// ---- T2 ------------------------------------------------------------------------------------------

test('65b T2: the explore step on full: the offer points to it; questions → approve (a journal line, the file committed) → research → decide → done; Arlo waits until then', async () => {
  const f = await fixture();
  assert.match(f.prdOffer, /Next: the design questions, in your session: \/mirai design --explore due-dates\. Skip them and start Arlo \(mirai-architect\) now\? \[y\/N\] /);
  const st0 = exploreState({ cwd: f.root, env: f.env, initiative: 'due-dates' });
  assert.equal(st0.phase, 'questions');
  assert.equal(exploreSettled(st0), false);
  assert.match(exploreBrief(st0, { initiative: 'due-dates' }), /--approve-questions/);
  // Arlo waits on full.
  const wait = await run(f, ['design', 'due-dates']);
  assert.equal(wait.code, EXIT.NEEDS_HUMAN, wait.out);
  assert.match(wait.err, /design questions aren't settled yet \(questions\)/);
  // The questions, approved: recorded and committed.
  put(f, `${D}/research-questions.md`, QUESTIONS);
  const ap = await run(f, ['design', 'due-dates', '--approve-questions']);
  assert.equal(ap.code, EXIT.OK, ap.err);
  assert.match(ap.out, /approved: docs\/mirai\/due-dates\/research-questions\.md \(2 questions\); committed on your branch/);
  assert.equal(events(f, 'research_questions').length, 1);
  assert.equal(f.git('status', '--porcelain').trim(), '');
  assert.equal(exploreState({ cwd: f.root, env: f.env, initiative: 'due-dates' }).phase, 'research');
  // A changed list isn't approved any more: the run refuses it.
  writeFileSync(join(f.root, D, 'research-questions.md'), QUESTIONS.replace('Why it matters: the import must', 'Why it matters: it must'));
  f.git('commit', '-qam', 'changed');
  const k0 = researchFakes([RESEARCH]);
  await assert.rejects(runResearch({ cwd: f.root, env: f.env, initiative: 'due-dates', nextToken: () => mintLaunchToken(), launch: k0.launch }), /aren't approved as they are now/);
  approveQuestions({ cwd: f.root, env: f.env, initiative: 'due-dates' });
  // The research run: its inputs are the questions, the PRD and the template, nothing of the repo.
  const k = researchFakes([RESEARCH]);
  const r = await runResearch({ cwd: f.root, env: f.env, initiative: 'due-dates', nextToken: () => mintLaunchToken(), launch: k.launch });
  assert.equal(r.state, 'done', r.why);
  assert.equal(k.calls.length, 1);
  assert.equal(k.calls[0].agent, 'mirai-design-research');
  assert.equal(k.calls[0].role, 'design-research');
  assert.equal(k.calls[0].step, 'design-research');
  assert.deepEqual(Object.keys(k.calls[0].inputs).sort(), ['checklist-research.md', 'index.json', 'prd.md', 'research-questions.md', 'template-research.md']);
  assert.equal(typeof k.calls[0].collect, 'function');
  assert.equal(readFileSync(join(f.root, D, 'research.md'), 'utf8'), RESEARCH);
  assert.equal(f.git('status', '--porcelain').trim(), '', 'committed');
  const done = events(f, 'design_research').at(-1);
  assert.deepEqual([done.state, done.fetches, done.searches, done.suspicious], ['done', 4, 4, 0]);
  // Decide, one question at a time.
  const st = exploreState({ cwd: f.root, env: f.env, initiative: 'due-dates' });
  assert.equal(st.phase, 'decide');
  const b = exploreBrief(st, { initiative: 'due-dates' });
  assert.match(b, /Recommendation: A, because a 200 MB file takes longer/);
  const d1 = await run(f, ['design', 'due-dates', '--decide', 'Q-1', '--pick', 'A', '--reason', 'our files reach 150 MB', '--hard', 'yes']);
  assert.equal(d1.code, EXIT.OK, d1.out + d1.err);
  assert.match(d1.out, /recorded: Q-1 → A \(hard to reverse: it becomes a draft ADR\)/);
  assert.match(d1.out, /next: Q-2/);
  assert.equal(exploreState({ cwd: f.root, env: f.env, initiative: 'due-dates' }).phase, 'decide');
  const bad = await run(f, ['design', 'due-dates', '--decide', 'Q-2', '--pick', 'C', '--hard', 'no']);
  assert.notEqual(bad.code, EXIT.OK);
  const d2 = await run(f, ['design', 'due-dates', '--decide', 'Q-2', '--pick', 'arlo', '--hard', 'no']);
  assert.equal(d2.code, EXIT.OK, d2.out + d2.err);
  assert.match(d2.out, /every question is decided/);
  const dd = readFileSync(join(f.root, D, 'design-decisions.md'), 'utf8');
  assert.match(dd, /### Q-1: .*\n\n- \*\*Options:\*\* A: a queued job, reading the file in chunks\. \[S-1\]; B: the import inside the upload request\. \[S-3\]\n- \*\*Pick:\*\* A\n- \*\*Reason:\*\* our files reach 150 MB\n- \*\*Hard to reverse:\*\* yes/);
  assert.match(dd, /- \*\*Pick:\*\* \(Arlo's call\)/);
  assert.match(dd, /## Log\n\n- \d{4}-\d{2}-\d{2} Q-1: A, our files reach 150 MB\n- \d{4}-\d{2}-\d{2} Q-2: your call, Arlo/);
  const end = exploreState({ cwd: f.root, env: f.env, initiative: 'due-dates' });
  assert.equal(end.phase, 'done');
  assert.equal(exploreSettled(end), true);
});

test('65b T2: --no-explore is recorded and settles full; standard never waits; a research.md failing its lint goes back once, seeded with the record, then fails', async () => {
  const f = await fixture();
  skipResearch({ cwd: f.root, env: f.env, initiative: 'due-dates' });
  const skipped = events(f, 'design_research').at(-1);
  assert.equal(skipped.state, 'skipped');
  assert.equal(exploreSettled(exploreState({ cwd: f.root, env: f.env, initiative: 'due-dates' })), true);
  const std = await fixture({ track: 'standard' });
  assert.equal(exploreSettled(exploreState({ cwd: std.root, env: std.env, initiative: 'due-dates' })), true);
  assert.doesNotMatch(std.prdOffer, /design questions/);
  // A quote that isn't in what the fetch returned: one fix round, with the record as its seed.
  const g = await fixture();
  put(g, `${D}/research-questions.md`, QUESTIONS);
  approveQuestions({ cwd: g.root, env: g.env, initiative: 'due-dates' });
  const wrong = RESEARCH.replace('"time consuming tasks"', '"a quote no fetch returned"');
  const k = researchFakes([wrong, RESEARCH]);
  const r = await runResearch({ cwd: g.root, env: g.env, initiative: 'due-dates', nextToken: () => mintLaunchToken(), launch: k.launch });
  assert.equal(r.state, 'done', r.why);
  assert.equal(k.calls.length, 2);
  assert.match(k.calls[1].inputs['lint.json'], /quote isn't in what the run's fetch/);
  assert.deepEqual(k.calls[1].webSeed.listed, RECORD.listed);
  const h = await fixture();
  put(h, `${D}/research-questions.md`, QUESTIONS);
  approveQuestions({ cwd: h.root, env: h.env, initiative: 'due-dates' });
  const k2 = researchFakes([wrong]);
  const r2 = await runResearch({ cwd: h.root, env: h.env, initiative: 'due-dates', nextToken: () => mintLaunchToken(), launch: k2.launch });
  assert.equal(r2.state, 'failed');
  assert.match(r2.why, /still has 1 lint problem/);
  assert.equal(existsSync(join(h.root, D, 'research.md')), false, 'nothing failing is copied in');
  // No research.md at all, and a URL no search returned.
  const k3 = researchFakes([() => ({ text: null, ...RECORD })]);
  const r3 = await runResearch({ cwd: h.root, env: h.env, initiative: 'due-dates', nextToken: () => mintLaunchToken(), launch: k3.launch });
  assert.match(r3.why, /wrote no research\.md/);
  const k4 = researchFakes([() => ({ text: RESEARCH, ...RECORD, listed: RECORD.listed.slice(1) })]);
  const r4 = await runResearch({ cwd: h.root, env: h.env, initiative: 'due-dates', nextToken: () => mintLaunchToken(), launch: k4.launch });
  assert.equal(r4.state, 'failed');
  assert.ok(r4.problems.some((p) => p.code === 'research-source-outside'));
});

// ---- T6 ------------------------------------------------------------------------------------------

test('65b T6: Arlo\'s inputs hold research.md and design-decisions.md; a pick cited passes, one left uncited is found; a hard pick without its ADR is found, with it the early pause skips it', async () => {
  const f = await fixture();
  await researched(f);
  decide({ cwd: f.root, env: f.env, initiative: 'due-dates', question: 'Q-1', pick: 'A', reason: 'our files reach 150 MB', hard: 'yes' });
  decide({ cwd: f.root, env: f.env, initiative: 'due-dates', question: 'Q-2', pick: 'arlo', hard: 'no' });
  f.git('add', '-A');
  f.git('commit', '-qm', 'decisions');
  const s = designSubject({ cwd: f.root, env: f.env, initiative: 'due-dates' });
  const inputs = designInputs(s, { doc: 'hld', step: 'write', round: 1 });
  assert.ok(inputs['research.md'] && inputs['design-decisions.md']);
  assert.match(JSON.parse(inputs['index.json']).files.find((x) => x.name === 'design-decisions.md').why, /follow every pick/);
  const decisions = decisionsIn((t) => readDoc(s, t));
  assert.deepEqual(decisions.map((d) => [d.id, d.pick, d.hard, d.arlo]), [['Q-1', 'A', true, false], ['Q-2', '(Arlo\'s call)', false, true]]);
  const hldDoc = (decisionsText) => ({ shown: `${D}/hld.md`, doc: { scan: { headings: [{ level: 2, text: 'Decisions', line: 1 }], lines: decisionsText.map((t, i) => ({ kind: 'text', line: i + 2, text: t })) } } });
  const adrFromPick = { id: 'ADR-0001', path: ADR_PATH, text: `${ADR}\nDecided by the owner: design-decisions.md Q-1\n`, status: 'proposed', gate: ['hard-to-reverse'] };
  // Followed and cited, with the ADR: clean.
  assert.deepEqual(decisionProblems(decisions, hldDoc(['- D-1: a queued job (design-decisions.md Q-1)']), [adrFromPick]), []);
  // Left uncited: found.
  assert.match(decisionProblems(decisions, hldDoc(['- D-1: a queued job']), [adrFromPick])[0].reason, /your pick for Q-1 .* isn't cited in Decisions/);
  // Hard, with no ADR from it: found.
  assert.match(decisionProblems(decisions, hldDoc(['- D-1: a queued job (design-decisions.md Q-1)']), [])[0].reason, /hard to reverse, but no ADR of this initiative is written from it/);
  // The early pause: an ADR written from the hard pick is answered already.
  assert.deepEqual([...adrsFromPicks(decisions, [adrFromPick, { ...adrFromPick, id: 'ADR-0002', text: ADR }])], ['ADR-0001']);
  put(f, ADR_PATH, `${ADR.replace('gate: [hard-to-reverse, nfr]', 'gate: [hard-to-reverse, nfr]').replace(/^initiative: .*$/m, 'initiative: due-dates')}\nDecided by the owner: design-decisions.md Q-1\n`);
  const s2 = designSubject({ cwd: f.root, env: f.env, initiative: 'due-dates', clean: false });
  assert.equal(hardAdrsOpen(s2).length, 0, 'no second pause for a pick you made');
  // The research run's inputs never hold the repo's files.
  const r = researchInputs({ ...s, questions: { q: readDoc(s, 'research-questions'), questions: [{ id: 'Q-1' }, { id: 'Q-2' }] } }, { round: 1, caps: { maxSearches: 30, minutes: 20 }, today: '2026-11-28' });
  assert.deepEqual(Object.keys(r).sort(), ['checklist-research.md', 'index.json', 'prd.md', 'research-questions.md', 'template-research.md']);
});
