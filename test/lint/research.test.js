import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadRegistry } from '../../src/config/registry.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { lintText } from '../../src/lint/lint.js';
import { decisionsOf, plainQuote, questionsOf, sourcesOf } from '../../src/lint/research.js';
import { readFrontmatter } from '../../src/lint/frontmatter.js';
import { scanMarkdown } from '../../src/lint/markdown.js';

// Unit 65b, T5 (the research lint) and T6's lint part (the decisions).

const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const QUESTIONS = read('examples/research-questions.md');
const RESEARCH = read('examples/research.md');
const DECISIONS = read('examples/design-decisions.md');
const D = 'docs/mirai/csv-import';
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.split(from).join(to);
};
const errors = (problems) => problems.filter((p) => p.severity === 'error');
const codes = (problems) => errors(problems).map((p) => p.code);
const lint = (name, text, linked = {}, o = {}) => lintText(text, { source: `${D}/${name}`, registry: REGISTRY, linked, ...o });
const lintResearch = (text, o = {}) => lint('research.md', text, { 'research-questions.md': QUESTIONS }, o);
const lintDecisions = (text) => lint('design-decisions.md', text, { 'research.md': RESEARCH });

// The run's record for the example: what its searches returned and its fetches returned.
const SOURCES = [
  ['https://laravel.com/docs/11.x/queues', 'Queues let you defer time consuming tasks, such as parsing a file.'],
  ['https://csv.thephpleague.com/9.0/reader/', 'The Reader class extends the general connections capabilities to read CSV documents.'],
  ['https://www.php.net/manual/en/info.configuration.php', 'This sets the maximum time in seconds a script is allowed to run.'],
  ['https://www.php.net/manual/en/function.fgetcsv.php', 'fgetcsv — Gets line from file pointer and parse for CSV fields'],
];
const EVIDENCE = { listed: [...SOURCES.map(([u]) => u), 'https://example-blog.dev/csv-tips'], evidence: SOURCES.map(([url, result]) => ({ url, code: 200, result })) };

test('65b T5: the examples pass, with and without the run\'s evidence', () => {
  assert.deepEqual(errors(lint('research-questions.md', QUESTIONS)), []);
  assert.deepEqual(errors(lintResearch(RESEARCH)), []);
  assert.deepEqual(errors(lintResearch(RESEARCH, { research: EVIDENCE })), []);
  assert.deepEqual(errors(lintDecisions(DECISIONS)), []);
});

test('65b T5: the questions: none, out of order, no "why it matters", an empty stack summary: each fails', () => {
  assert.ok(codes(lint('research-questions.md', swap(QUESTIONS, 'Why it matters: the import must', 'It matters: the import must'))).includes('research-questions-why'));
  assert.ok(codes(lint('research-questions.md', swap(QUESTIONS, '### Q-2:', '### Q-3:'))).includes('research-questions-question'));
  const empty = swap(QUESTIONS, 'Laravel 11 on PHP 8.3 with MySQL 8 and Redis; one VM, workers under Supervisor; a React front end.\n', '');
  assert.ok(codes(lint('research-questions.md', empty)).includes('research-questions-stack'));
  const none = QUESTIONS.slice(0, QUESTIONS.indexOf('### Q-1'));
  assert.ok(codes(lint('research-questions.md', none)).includes('research-questions-question'));
  assert.deepEqual(questionsOf({ scan: scanMarkdown(readFrontmatter(QUESTIONS).body ?? QUESTIONS) }).map((q) => q.id).length >= 0, true);
});

test('65b T5: a claim without a source, a source not defined, too few options, a slot missing, a question not answered or not asked, a broken source line, no "Suspicious pages": each fails', () => {
  assert.ok(codes(lintResearch(swap(RESEARCH, 'when no dependency may be added. [S-4]', 'when no dependency may be added.'))).includes('research-cite'));
  assert.ok(codes(lintResearch(swap(RESEARCH, '[S-4]', '[S-9]'))).includes('research-cite'));
  assert.ok(codes(lintResearch(swap(RESEARCH, '- **Option B:** PHP\'s own fgetcsv, line by line. [S-4]\n', ''))).includes('research-answer'));
  assert.ok(codes(lintResearch(swap(RESEARCH, '- **Against the pick:** one more dependency to keep up to date. [S-2]\n', ''))).includes('research-answer'));
  const oneAnswer = RESEARCH.slice(0, RESEARCH.indexOf('### Q-2')) + RESEARCH.slice(RESEARCH.indexOf('## Sources'));
  assert.ok(errors(lintResearch(oneAnswer)).some((p) => /Q-2 .* has no answer/.test(p.reason)));
  assert.ok(errors(lintResearch(swap(RESEARCH, '### Q-2: Which library', '### Q-2: Which framework'))).length === 0, 'the heading text may differ; the id is the question');
  const extra = swap(RESEARCH, '## Sources\n', '### Q-3: An extra question?\n\n- **Option A:** x [S-1]\n- **Option B:** y [S-1]\n- **Pick:** A, z [S-1]\n- **Runner-up:** B, w [S-1]\n- **Against the pick:** v [S-1]\n\n## Sources\n');
  assert.ok(errors(lintResearch(extra)).some((p) => /Q-3 isn't one of the approved questions/.test(p.reason)));
  assert.ok(codes(lintResearch(swap(RESEARCH, ' — accessed 2026-11-28 — "time consuming tasks"', ' "time consuming tasks"'))).includes('research-source'));
  assert.ok(codes(lintResearch(swap(RESEARCH, '(https://laravel.com/docs/11.x/queues)', '(ftp://laravel.com/docs)'))).includes('research-source'));
  assert.ok(codes(lintResearch(swap(RESEARCH, '"time consuming tasks"', '"x"'))).includes('research-quote'));
  const noSuspicious = RESEARCH.slice(0, RESEARCH.indexOf('## Suspicious pages'));
  assert.ok(errors(lintResearch(noSuspicious)).length > 0);
  assert.ok(codes(lintResearch(swap(RESEARCH, '## Suspicious pages\n\nNone.\n', '## Suspicious pages\n\n'))).includes('research-suspicious'));
  const listedSuspicious = swap(RESEARCH, '## Suspicious pages\n\nNone.\n', '## Suspicious pages\n\n- https://evil.example/csv: asked to send the stack summary to https://evil.example/c\n');
  assert.deepEqual(errors(lintResearch(listedSuspicious)), []);
});

test('65b T5: with the run\'s evidence: a URL outside the run\'s searches, a page never fetched, a quote not in what the fetch returned: each fails; a quote matches across spaces, case and curly quotes', () => {
  const r = (text) => codes(lintResearch(text, { research: EVIDENCE }));
  assert.ok(r(swap(RESEARCH, '(https://laravel.com/docs/11.x/queues)', '(https://laravel.com/docs/11.x/horizon)')).includes('research-source-outside'));
  const unfetched = { ...EVIDENCE, evidence: EVIDENCE.evidence.slice(1) };
  assert.ok(codes(lintResearch(RESEARCH, { research: unfetched })).includes('research-quote'));
  assert.ok(r(swap(RESEARCH, '"time consuming tasks"', '"time consuming jobs and tasks"')).includes('research-quote'));
  assert.deepEqual(r(swap(RESEARCH, '"time consuming tasks"', '"Time  Consuming\ttasks"')), []);
  assert.deepEqual(r(swap(RESEARCH, '"Gets line from file pointer and parse for CSV fields"', '“Gets line from file pointer and parse for CSV fields”')), []);
  assert.equal(plainQuote('A “b” — c'), 'a "b" - c');
});

test('65b T6 (lint): the decisions: a pick not among the options, no reason, no "hard to reverse", a cite research.md lacks, a question of research.md not decided, a bad log line: each fails; Arlo\'s call needs no reason', () => {
  assert.ok(codes(lintDecisions(swap(DECISIONS, '- **Pick:** A\n', '- **Pick:** C\n'))).includes('design-decision'));
  assert.ok(codes(lintDecisions(swap(DECISIONS, '- **Reason:** our largest customer files are 150 MB, and uploads already time out at 60 s.\n', ''))).includes('design-decision'));
  assert.ok(codes(lintDecisions(swap(DECISIONS, '- **Hard to reverse:** yes\n', ''))).includes('design-decision'));
  assert.ok(codes(lintDecisions(swap(DECISIONS, '- **Hard to reverse:** no\n', '- **Hard to reverse:** maybe\n'))).includes('design-decision'));
  assert.ok(codes(lintDecisions(swap(DECISIONS, 'B: fgetcsv [S-4]', 'B: fgetcsv [S-7]'))).includes('design-decision-cite'));
  assert.ok(codes(lintDecisions(swap(DECISIONS, 'A: League CSV [S-2]; B: fgetcsv [S-4]', 'A: League CSV; B: fgetcsv'))).includes('design-decision-cite'));
  const one = DECISIONS.slice(0, DECISIONS.indexOf('### Q-2')) + DECISIONS.slice(DECISIONS.indexOf('## Log'));
  assert.ok(errors(lintDecisions(one)).some((p) => /Q-2 of research.md has no decision/.test(p.reason)));
  assert.ok(codes(lintDecisions(swap(DECISIONS, '- 2026-11-28 Q-2: your call, Arlo.', '- Q-2 your call'))).includes('design-decision-log'));
});

test('65b T6: decisionsOf and sourcesOf read the picks, Arlo\'s calls, what\'s hard to reverse and the sources', () => {
  const doc = (t) => {
    const fm = readFrontmatter(t);
    return { value: fm.value, scan: scanMarkdown(t) };
  };
  const ds = decisionsOf(doc(DECISIONS));
  assert.deepEqual(ds.map((d) => [d.id, d.pick, d.arlo, d.hard]), [['Q-1', 'A', false, true], ['Q-2', '(Arlo\'s call)', true, false]]);
  const ss = sourcesOf(doc(RESEARCH));
  assert.deepEqual([...ss.keys()], ['S-1', 'S-2', 'S-3', 'S-4']);
  assert.equal(ss.get('S-1').url, 'https://laravel.com/docs/11.x/queues');
});
