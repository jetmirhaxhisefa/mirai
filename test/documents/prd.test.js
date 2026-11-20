import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRegistry } from '../../src/config/registry.js';
import { loadConfig } from '../../src/config/load.js';
import { ConfigError } from '../../src/cli/errors.js';
import { REGISTRY_DIR, createLintCommand } from '../../src/cli/commands/lint.js';
import { lintText, parseDocument } from '../../src/lint/lint.js';
import { documentWords } from '../../src/lint/prd.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { documentApproval } from '../../src/cli/commands/approve.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { contentHash } from '../../src/sign/sign.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { installed } from '../tests/run-fixture.js';
import { passReader } from '../helpers/reader.js';

// Unit 32: the PRD (lite and full), read with its brief.
const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const PRD = read('examples/prd.md');
const BRIEF = read('examples/brief.md');
// Unit 35: the example brief links the interview it came from.
const INTERVIEW = read('examples/interview.md');
const TEMPLATE = read('templates/prd.md');
const DEF = REGISTRY.documentTypes.prd;

const lint = (text, { brief = BRIEF, ...o } = {}) => lintText(text, { source: 'docs/mirai/due-dates/prd.md', registry: REGISTRY, project: { repos: ['.'] }, linked: brief === null ? {} : { 'brief.md': brief }, ...o });
const errors = (text, o) => lint(text, o).filter((p) => p.severity === 'error');
const warnings = (text, o) => lint(text, o).filter((p) => p.severity === 'warning');
const codes = (ps) => ps.map((p) => p.code);
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.replace(from, to);
};
const one = (text, code, re, o) => {
  const ps = errors(text, o).filter((p) => p.code === code);
  assert.equal(ps.length, 1, JSON.stringify(errors(text, o)));
  if (re) assert.match(`${ps[0].reason} | ${ps[0].hint ?? ''}`, re);
  return ps[0];
};
const words = (text) => documentWords(parseDocument(text, 'prd.md'), DEF);

// The full sections, filled for the due-dates feature.
const KEY_FLOWS = '## Key flows\n\nUJ-1, the Monday plan: the lead dates each new task (FR-1), and a past date is refused (FR-6). Then the lead opens the overdue page (FR-2).\n\n';
const RISKS = '## Risks\n\nBesides the brief\'s R-1 and R-2:\n\n- R-3: The mail service could mark reminders as spam. Likelihood low, impact high; the counter-metric of SM-2 watches it.\n\n';
const DEPS = '## Dependencies\n\n- DEP-1: The mail service must accept 500 emails a day by January 2027. The reminders wait for it.\n\n';
const ROLLOUT = '## Rollout\n\n- PH-1: One team gets due dates first. It ends when SM-1 has been measured for a month.\n\n';
const full = ({ rollout = true } = {}) => swap(swap(swap(swap(PRD, 'track: standard', 'track: full'), 'variant: lite', 'variant: full'),
  '## Non-goals\n', `${KEY_FLOWS}## Non-goals\n`), '## Assumptions\n', `${RISKS}${DEPS}${rollout ? ROLLOUT : ''}## Assumptions\n`);

test('32 T1: the type and the template: left as it is it fails, both variants match the type, the example lints clean with its brief', () => {
  // The template, left as it is: every problem is leftover text.
  const left = errors(TEMPLATE, { brief: null });
  assert.ok(left.length > 0 && left.every((p) => p.code === 'template-text'), JSON.stringify(left.filter((p) => p.code !== 'template-text')));
  // Both variants: the template holds every section of the type, in its order, and nothing else
  // is wrong with it as a lite or as a full PRD.
  const h2 = TEMPLATE.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
  assert.deepEqual(h2, DEF.section_order);
  for (const variant of ['lite', 'full']) {
    const t = TEMPLATE.replace('variant: lite', `variant: ${variant}`).replace('track: standard', `track: ${variant === 'lite' ? 'standard' : 'full'}`);
    assert.deepEqual(lint(t, { brief: null }).filter((p) => p.code !== 'template-text'), [], variant);
  }
  assert.deepEqual(DEF.variants.full.required_sections, ['Key flows', 'Risks', 'Dependencies', 'Rollout']);
  // The example: clean with its brief, no warning either.
  assert.deepEqual(lint(PRD), []);
  assert.deepEqual(lint(full()), []);
});

test('32 T2: requirements: each problem names the FR and the fix; a shape only warns', () => {
  one(swap(PRD, 'covers every task they have. (BR-2)', 'covers every task they have.'), 'prd-trace', /FR-3 doesn't name the business requirement it serves \| end it with the brief's BR in brackets, then any assumptions it rests on/);
  // P2 (unit 32): assumptions cited after the BR are fine; anything else after it isn't.
  assert.deepEqual(errors(swap(PRD, 'covers every task they have. (BR-2)', 'covers every task they have. (BR-2) (A-2)')).filter((p) => p.code === 'prd-trace'), []);
  one(swap(PRD, 'covers every task they have. (BR-2)', 'covers every task they have. (BR-2) (see FR-1)'), 'prd-trace');
  one(swap(PRD, '  - AC-FR-3.1: Given Ana has turned reminders off, when a task of hers is due tomorrow, then she gets no email.\n', ''), 'prd-ac', /FR-3 has no acceptance criterion \| add AC-FR-3.1 under it/);
  one(swap(PRD, 'then she gets no email', 'and she gets no email'), 'prd-ac', /AC-FR-3.1 has no "Then" \| write it as: Given/);
  one(swap(PRD, '### Failures\n\n', ''), 'prd-groups', /"Functional requirements" has no "### Failures" \| the four groups, in order/);
  const noUnchanged = swap(PRD, '- FR-9: Where a task has no due date, the task list must show and sort it exactly as it does today. (BR-1)\n  - AC-FR-9.1: Given tasks with no due date, when the list opens after this change, then their order is unchanged.\n', '');
  one(noUnchanged, 'prd-groups', /"### Unchanged behaviour" has no requirement \| name what must stay as it is today as "Where …, … must …"; or write: None — /);
  assert.equal(errors(swap(noUnchanged, '### Unchanged behaviour\n', '### Unchanged behaviour\n\nNone — due dates are new, and nothing existing changes.\n')).filter((p) => p.code === 'prd-groups').length, 0);
  one(swap(noUnchanged, '### Unchanged behaviour\n', '### Unchanged behaviour\n\nNone.\n'), 'prd-groups', /has no requirement/);
  one(PRD.replaceAll('FR-9', 'FR-10'), 'prd-numbering', /FR-10 should be FR-9: FR IDs run 1, 2, 3 … in order, with no gap/);
  one(swap(PRD, 'AC-FR-3.1:', 'AC-FR-3.2:'), 'prd-numbering', /AC-FR-3.2 should be AC-FR-3.1: a requirement's ACs run .1, .2, .3/);
  one(swap(PRD, '  - AC-FR-9.1:', '  - AC-FR-12.1: Given a task, when it is opened, then it shows.\n  - AC-FR-9.1:'), 'missing-parent', /AC-FR-12.1 belongs to FR-12, which isn't defined/);
  // A Capabilities FR written as a trigger only warns (decision 2: until we've seen real PRDs).
  const shape = swap(PRD, 'An assignee can turn all of their own reminder emails off, and on again.', 'When an assignee asks, the system must stop their reminder emails.');
  assert.deepEqual(errors(shape), []);
  assert.deepEqual(codes(warnings(shape)), ['prd-shape']);
  assert.match(warnings(shape)[0].hint, /write it as "\[Actor\] can …", or move it to the group it belongs to/);
  one(swap(PRD, 'the system must email each assignee', 'the system shall email each assignee'), 'prd-must', /FR-4 says "shall" \| say "must"/);
});

test('32 T3: an NFR names how it is verified: an AC-NFR, or a Verified by line with a method', () => {
  one(swap(PRD, '  - Verified by: a measurement on the test data set of 500 open tasks, in the browser.\n', ''), 'prd-verify', /NFR-1 doesn't say how it's verified \| add AC-NFR-1.1 \(Given \/ When \/ Then\), or a line "Verified by:/);
  one(swap(PRD, 'Verified by: a measurement on the test data set of 500 open tasks, in the browser.', 'Verified by: the team looks at it.'), 'prd-verify', /NFR-1's "Verified by:" names no method: "the team looks at it\." \| name a test level/);
  assert.deepEqual(errors(swap(PRD, 'Verified by: a measurement on the test data set', 'Verified by: an end-to-end test on the test data set')), []);
});

test('32 T4: across the brief: every BR served, IDs resolve, the brief\'s IDs are cited not redefined, the link, the summary\'s no-gos', () => {
  const br3 = '- BR-3: A lead can see every overdue task of their team at once. Source: the November 2026 lead interviews.\n';
  one(PRD, 'prd-trace', /the brief's BR-4 isn't served by any FR or NFR \| add the requirement that delivers BR-4, ending with \(BR-4\)/, { brief: swap(BRIEF, br3, `${br3}- BR-4: A lead can export the team's deadlines. Source: the November 2026 lead interviews.\n`) });
  one(swap(PRD, 'covers every task they have. (BR-2)', 'covers every task they have. (BR-9)'), 'unknown-id', /BR-9 is mentioned but defined neither here nor in the brief/);
  one(swap(PRD, '- NG-4: Reminders', '- NG-2: Phone numbers. None are held.\n- NG-4: Reminders'), 'upstream-id', /NG-2 is already the brief's/);
  one(swap(PRD, '- NG-4: Reminders', '- NG-1: Reminders').replace('(NG-4)', '(NG-1)'), 'upstream-id', /NG-1 is already the brief's/);
  one(PRD.replaceAll('NG-4', 'NG-5'), 'prd-numbering', /NG-5 should be NG-4: the PRD's own NG IDs carry on after the brief's \(it ends at NG-3\)/);
  // The Brief: line: missing, or linking a brief that "upstream" doesn't name.
  one(swap(PRD, 'Brief: [Tasks with due dates that people finish on time](brief.md)\n\n', ''), 'upstream-link', /the line under the title must link the brief: "Brief: \[<its title>\]\(brief\.md\)"/);
  one(PRD, 'upstream-link', /the linked brief is "other-brief", which "upstream" doesn't name/, { brief: swap(BRIEF, 'id: due-dates-brief', 'id: other-brief') });
  // On standard the brief's no-gos are in the PRD's "Not in this".
  one(swap(PRD, '- Recurring tasks: they need their own rules (NG-1).\n', ''), 'summary-not-in', /NG-1/);
});

test('32 T4: a broken Brief: link fails through mirai lint', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mirai-32-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, 'docs', 'mirai', 'due-dates'), { recursive: true });
  writeFileSync(join(root, 'docs', 'mirai', 'due-dates', 'prd.md'), PRD);
  writeFileSync(join(root, 'docs', 'mirai', 'due-dates', 'brief.md'), BRIEF);
  writeFileSync(join(root, 'docs', 'mirai', 'due-dates', 'interview.md'), INTERVIEW);
  let out = '';
  const io = { stdout: { write: (s) => (out += s) }, stderr: { write: () => {} }, env: { PATH: process.env.PATH, HOME: root }, cwd: root };
  assert.equal(await main(['lint'], io, [createLintCommand()]), EXIT.OK, out);
  writeFileSync(join(root, 'docs', 'mirai', 'due-dates', 'prd.md'), swap(PRD, '](brief.md)', '](the-brief.md)'));
  out = '';
  assert.equal(await main(['lint', '--json'], io, [createLintCommand()]), EXIT.FAILURE);
  const problems = JSON.parse(out).problems.filter((p) => p.file === 'docs/mirai/due-dates/prd.md' && p.severity === 'error');
  const line = PRD.split('\n').indexOf('Brief: [Tasks with due dates that people finish on time](brief.md)') + 1;
  assert.deepEqual(problems.map((p) => `${p.line} ${p.code} ${p.reason}`), [`${line} missing-file a link points to a file that does not exist`]);
});

// Pads the PRD to exactly `target` words, with short sentences under "User journeys".
function padded(text, target) {
  let need = target - words(text);
  assert.ok(need >= 7, `${need}`);
  const parts = [];
  while (need >= 14) {
    parts.push('Leads plan the week on Monday morning.');
    need -= 7;
  }
  parts.push(`${'Leads plan the week on Monday morning and check each task with the team'.split(' ').slice(0, need).join(' ')}.`);
  // One sentence per line: a single line past the scanner's length limit isn't read.
  const out = swap(text, '## User journeys\n\n', `## User journeys\n\n${parts.join('\n')}\n\n`);
  assert.equal(words(out), target);
  return out;
}

const EXCEPTION = 'length_exception: "the reminders and the overdue page share one change to tasks"\n';
const DECISION = '2. This PRD is over the 3,000 words cap: reminders and the overdue page share one change to tasks. Options: approve it as one PRD, or ask for a split. Recommendation: one PRD; a split repeats the date rules.\n';

test('32 T5: the length cap: a warning near it, a failure over it with the split message, the exception, the config', () => {
  assert.deepEqual(codes(lint(padded(PRD, 2500))), ['prd-length']);
  assert.match(lint(padded(PRD, 2500))[0].reason, /the PRD has 2500 words, close to a lite PRD's cap of 3000/);
  const over = padded(PRD, 3100);
  one(over, 'prd-length', /the PRD has 3100 words; a lite PRD's cap is 3000 \| split the feature into two PRDs, each with its own BRs, or move it to the full track and put the "how" into the design; don't remove requirements or ACs to fit/);
  // With length_exception, it only warns, once "Decisions for you" asks you.
  const excepted = swap(over, 'variant: lite\n', `variant: lite\n${EXCEPTION}`);
  one(excepted, 'prd-length', /the length exception isn't under "Decisions for you" \| add an item: "This PRD is [0-9]+ words, over the 3000 cap/);
  const asked = swap(excepted, 'This PRD is written for email only (A-1).\n', `This PRD is written for email only (A-1).\n${DECISION}`);
  assert.deepEqual(errors(asked), []);
  assert.deepEqual(codes(warnings(asked)), ['prd-length']);
  assert.match(warnings(asked)[0].reason, /over its cap of 3000, with a length exception/);
  // Under the cap, the exception is an error, so it can't be left on by habit.
  one(swap(PRD, 'variant: lite\n', `variant: lite\n${EXCEPTION}`), 'prd-length', /length_exception is set, but the PRD has [0-9]+ words, within its cap of 3000 \| remove length_exception/);
  // The project config moves the cap (decision 6); the trusted config is what the lint reads.
  assert.deepEqual(errors(over, { project: { repos: ['.'], limits: { prd_lite_words: 3500 } } }), []);
  assert.deepEqual(codes(warnings(over, { project: { repos: ['.'], limits: { prd_lite_words: 3500 } } })), ['prd-length']);
  // The Glossary and Open questions aren't counted (Jet, 2026-11-20).
  const terms = Array.from({ length: 120 }, (_, i) => `- Term ${i}: a word the requirements use, defined once here for the reader.`).join('\n');
  assert.equal(documentWords(parseDocument(swap(PRD, '### Terms\n\n', `### Terms\n\n${terms}\n`), 'prd.md'), REGISTRY.documentTypes.prd), documentWords(parseDocument(PRD, 'prd.md'), REGISTRY.documentTypes.prd));
  assert.deepEqual(codes(errors(PRD, { project: { repos: ['.'], limits: { prd_lite_words: 900 } } })), ['prd-length']);
  const { config } = loadConfig(configFiles({ project: `${MINIMAL}[docs.limits]\nprd_lite_words = 2500\nprd_summary_words = 700\n` }));
  assert.deepEqual(config.docs.limits, { prd_lite_words: 2500, prd_summary_words: 700 });
  assert.match(configProblems({ project: `${MINIMAL}[docs.limits]\nprd_lite_words = 999999\n` }).join('\n'), /prd_lite_words/);
  assert.match(configProblems({ project: `${MINIMAL}[docs.limits]\nbrief_summary_words = 50\n` }).join('\n'), /brief_summary_words/);
  assert.match(configProblems({ personal: 'schema_version = 1\n[docs.limits]\nprd_lite_words = 2500\n' }).join('\n'), /docs\.limits can't be set in a personal file|docs can't be set in a personal file/);
});

const MINIMAL = 'schema_version = 1\n[git]\nintegration_branch = "main"\n';
function configFiles({ project = MINIMAL, personal } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mirai-32-config-'));
  mkdirSync(join(dir, 'repo', '.mirai'), { recursive: true });
  writeFileSync(join(dir, 'repo', '.mirai', 'config.toml'), project);
  const files = { projectRoot: join(dir, 'repo'), globalFile: join(dir, 'home', '.config', 'mirai', 'config.toml') };
  if (personal !== undefined) {
    files.personalRepoFile = join(dir, 'config.user.toml');
    writeFileSync(files.personalRepoFile, personal);
  }
  return files;
}
function configProblems(o) {
  try {
    loadConfig(configFiles(o));
  } catch (err) {
    assert.ok(err instanceof ConfigError, String(err));
    return (err.errors ?? [{ reason: err.reason }]).map((e) => `${e.reason} ${e.hint ?? ''}`);
  }
  return assert.fail('expected config problems');
}

test('32 T5: a full PRD\'s summary budget is 1,000 words; a lite one\'s stays 600 (Jet, after P1)', () => {
  // About 480 more words in "What changes": over the lite budget, under the full one.
  const extra = Array.from({ length: 34 }, () => '- A team lead sees every overdue task of the team on one page (FR-2).').join('\n');
  const pad = (text) => swap(text, '- Tasks without a date look and sort exactly as they do today (FR-9).\n', `- Tasks without a date look and sort exactly as they do today (FR-9).\n${extra}\n`);
  one(pad(PRD), 'writing-budget', /a prd's budget is 600/);
  assert.deepEqual(codes(errors(pad(full()))).filter((c) => c === 'writing-budget'), []);
  // The project moves the full budget with its own key; prd_summary_words leaves it alone.
  one(pad(full()), 'writing-budget', /a full prd's budget is 700/, { project: { repos: ['.'], limits: { prd_full_summary_words: 700 } } });
  assert.deepEqual(codes(errors(pad(full()), { project: { repos: ['.'], limits: { prd_summary_words: 700 } } })).filter((c) => c === 'writing-budget'), []);
  const { config } = loadConfig(configFiles({ project: `${MINIMAL}[docs.limits]\nprd_full_summary_words = 1200\n` }));
  assert.deepEqual(config.docs.limits, { prd_full_summary_words: 1200 });
  assert.match(configProblems({ project: `${MINIMAL}[docs.limits]\nprd_full_summary_words = 5000\n` }).join('\n'), /prd_full_summary_words/);
});

test('32 T6: the variant and the glossary', () => {
  one(full({ rollout: false }), 'missing-section', /"Rollout" is missing/);
  // A lite PRD may fill a full-only section.
  assert.deepEqual(lint(swap(PRD, '## Assumptions\n', `${RISKS}## Assumptions\n`)), []);
  const w = warnings(swap(PRD, 'variant: lite', 'variant: full').replace('## Non-goals\n', `${KEY_FLOWS}## Non-goals\n`).replace('## Assumptions\n', `${RISKS}${DEPS}${ROLLOUT}## Assumptions\n`));
  assert.deepEqual(codes(w), ['prd-variant']);
  assert.match(w[0].reason, /a full PRD on the standard track/);
  one(swap(PRD, '| PH | Rollout phase | PH-1: one team first |', '| PH | Rollout phase | PH-1: the first team |'), 'prd-glossary', /the glossary's ID prefixes differ from the template's \| copy "### ID prefixes" from the template word for word/);
  const noGlossary = PRD.slice(0, PRD.indexOf('## Glossary'));
  assert.ok(codes(errors(noGlossary)).includes('missing-section'), JSON.stringify(errors(noGlossary)));
  assert.match(errors(noGlossary).find((p) => p.code === 'missing-section').reason, /"Glossary" is missing/);
  one(swap(PRD, '### Terms\n', '### Words\n'), 'prd-glossary', /the glossary has no "### Terms"/);
});

// The pair, ready to approve: the brief's Q-1 answered (email only) in both files. The example
// keeps Q-1 open so it shows how the brief's decision reaches the PRD's summary (Scope 9's
// deviation, in test-results.md).
const BRIEF_READY = swap(swap(BRIEF,
  '1. How should reminders reach people (Q-1)? Options: email only, or email and an in-app notice. Recommendation: email only, because the app has no notification system yet; an in-app notice would double the work.\n',
  'None — the reminder channel was settled in review: email only (BR-2).\n'),
  '- Q-1: How should reminders reach people: email only, or email and an in-app notice? The approver answers; it blocks the PRD\'s notification requirements.\n', '');
const PRD_READY = swap(swap(PRD,
  '1. How should reminders reach people (Q-1)? Options: email only, or email and an in-app notice. Recommendation: email only, because the app has no notification system yet; an in-app notice would double the work. This PRD is written for email only (A-1).\n',
  'None — the reminder channel was settled in review: email only (A-1).\n'),
  'the recommendation for the brief\'s Q-1.', 'as settled in review.');

async function tty(argv, { cwd, env }, answers) {
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd });
  return { code, out, err };
}

function pairFixture() {
  const f = installed({ files: { 'docs/mirai/due-dates/brief.md': BRIEF, 'docs/mirai/due-dates/interview.md': INTERVIEW, 'docs/mirai/due-dates/prd.md': PRD_READY } });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  return { ...f, io: { cwd: f.root, env: f.env }, at: (rel) => join(f.root, rel) };
}

const APPROVE_PRD = ['approve', 'due-dates-prd', '--file', 'docs/mirai/due-dates/prd.md'];

test('32 T7: approving the PRD: on standard one decision signs both files; full needs the brief approved first', async () => {
  assert.deepEqual(errors(PRD_READY, { brief: BRIEF_READY, approving: true }), []);
  assert.deepEqual(lintText(BRIEF_READY, { source: 'brief.md', registry: REGISTRY, project: { repos: ['.'] }, approving: true }).filter((p) => p.severity === 'error'), []);
  const f = pairFixture();
  const store = openStore({ cwd: f.root, env: f.env });
  const lines = () => readJournal(store).events.length;
  // The brief has an open question: the pair is refused, the brief's problem listed, nothing written.
  const before = lines();
  const open = await tty(APPROVE_PRD, f.io, ['a', 'due-dates-prd']);
  assert.equal(open.code, EXIT.BLOCKED, open.out);
  assert.match(open.err, /^docs\/mirai\/due-dates\/brief\.md:[0-9]+: a brief with an open question can't be approved/m);
  assert.match(open.err, /^docs\/mirai\/due-dates\/prd\.md:[0-9]+: the brief's open question Q-1 isn't under "Decisions for you"/m);
  assert.match(open.err, /docs\/mirai\/due-dates\/brief\.md and docs\/mirai\/due-dates\/prd\.md can't be approved yet: 2 lint problems, listed above; nothing was written/);
  assert.equal(lines(), before);
  // An [ASSUMPTION] tag left in the body blocks it too.
  writeFileSync(f.at('docs/mirai/due-dates/brief.md'), BRIEF_READY);
  writeFileSync(f.at('docs/mirai/due-dates/prd.md'), swap(PRD_READY, 'the most overdue first. (BR-3)', 'the most overdue first [ASSUMPTION: by days]. (BR-3)'));
  const tagged = await tty(APPROVE_PRD, f.io, ['a', 'due-dates-prd']);
  assert.equal(tagged.code, EXIT.BLOCKED, tagged.out);
  assert.match(tagged.err, /^docs\/mirai\/due-dates\/prd\.md:[0-9]+: an \[ASSUMPTION\] tag is still in the body/m);
  assert.equal(lines(), before);
  // One decision, two signed lines, each on its own file's bytes. Unit 34: the PRD's summary has
  // passed the reader test first, and the PRD's line records that result.
  writeFileSync(f.at('docs/mirai/due-dates/prd.md'), PRD_READY);
  const reader = await passReader(f, 'docs/mirai/due-dates/prd.md');
  const ok = await tty(APPROVE_PRD, f.io, ['a', 'due-dates-prd']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.match(ok.out, /^prd: +due-dates-prd\nfile: +docs\/mirai\/due-dates\/prd\.md\nhash: +[0-9a-f:a-z]+\nbrief: +due-dates-brief\nfile: +docs\/mirai\/due-dates\/brief\.md\nhash: /);
  assert.match(ok.out, /approved: the brief due-dates-brief and the PRD due-dates-prd, as docs\/mirai\/due-dates\/brief\.md and docs\/mirai\/due-dates\/prd\.md are now \(accepted; signed with k-[0-9a-f]+, seq [0-9]+, [0-9]+\); a change to either needs a new approval/);
  const [b, p] = readJournal(store).events.slice(-2);
  assert.deepEqual([b.kind, b.item, b.path, b.content_hash, b.decision], ['brief', 'due-dates-brief', 'docs/mirai/due-dates/brief.md', contentHash(Buffer.from(BRIEF_READY)), 'accepted']);
  assert.deepEqual([p.kind, p.item, p.path, p.content_hash, p.decision], ['prd', 'due-dates-prd', 'docs/mirai/due-dates/prd.md', contentHash(Buffer.from(PRD_READY)), 'accepted']);
  assert.equal(p.reader_test, reader.entry.hash);
  assert.equal(b.reader_test, undefined, 'on standard the PRD\'s summary is the one tested');
  assert.equal(lines(), before + 2);
  assert.equal(documentApproval(store, 'due-dates-brief', Buffer.from(BRIEF_READY)).approved, true);
  assert.equal(documentApproval(store, 'due-dates-prd', Buffer.from(PRD_READY)).approved, true);
  // A changed brief is stale; the PRD, whose bytes didn't change, stays approved.
  const changed = swap(BRIEF_READY, 'two weeks of build time', 'three weeks of build time');
  writeFileSync(f.at('docs/mirai/due-dates/brief.md'), changed);
  assert.deepEqual(documentApproval(store, 'due-dates-brief', Buffer.from(changed)), { approved: false, stale: true, seq: b.seq });
  assert.deepEqual(documentApproval(store, 'due-dates-prd', Buffer.from(PRD_READY)), { approved: true, stale: false, seq: p.seq });
  // On full, the brief is approved at its own step first: refused while it isn't, as it is now.
  const fullPrd = swap(PRD_READY, 'track: standard', 'track: full');
  writeFileSync(f.at('docs/mirai/due-dates/prd.md'), fullPrd);
  const refused = await tty(APPROVE_PRD, f.io, ['a', 'due-dates-prd']);
  assert.equal(refused.code, EXIT.BLOCKED, refused.out);
  assert.match(refused.err, /the brief due-dates-brief isn't approved as it is now \(it changed since its approval\); on the full track it's approved before its PRD; nothing was written/);
  assert.match(refused.err, /mirai approve due-dates-brief --file docs\/mirai\/due-dates\/brief\.md/);
  // The brief alone, as in 31: one line, kind brief.
  const briefOk = await tty(['approve', 'due-dates-brief', '--file', 'docs/mirai/due-dates/brief.md'], f.io, ['a', 'due-dates-brief']);
  assert.equal(briefOk.code, EXIT.OK, briefOk.err);
  assert.equal(readJournal(store).events.at(-1).kind, 'brief');
  const n = lines();
  const fullOk = await tty(APPROVE_PRD, f.io, ['a', 'due-dates-prd']);
  assert.equal(fullOk.code, EXIT.OK, fullOk.err);
  assert.match(fullOk.out, /approved: the PRD due-dates-prd, as docs\/mirai\/due-dates\/prd\.md is now/);
  assert.equal(lines(), n + 1, 'on full only the PRD is signed');
  assert.equal(readJournal(store).events.at(-1).kind, 'prd');
  assert.equal(documentApproval(store, 'due-dates-prd', Buffer.from(fullPrd)).approved, true);
});

test('32 T8: mirai show <initiative>: each document with its type, id, state and full path; a ticket of the same name asks for --docs', async () => {
  const f = pairFixture();
  writeFileSync(f.at('docs/mirai/due-dates/brief.md'), BRIEF_READY);
  const store = openStore({ cwd: f.root, env: f.env });
  const dir = join(realpathSync(f.root), 'docs', 'mirai', 'due-dates');
  const show = async (...argv) => tty(['show', ...argv], f.io, []);
  const first = await show('due-dates');
  assert.equal(first.code, EXIT.OK, first.err);
  assert.match(first.out, /^due-dates {3}standard\n/);
  assert.match(first.out, new RegExp(`^  brief\\.md +brief +due-dates-brief +not approved +${esc(join(dir, 'brief.md'))}$`, 'm'));
  assert.match(first.out, new RegExp(`^  prd\\.md +prd +due-dates-prd +not approved +${esc(join(dir, 'prd.md'))}$`, 'm'));
  await passReader(f, 'docs/mirai/due-dates/prd.md');
  assert.equal((await tty(APPROVE_PRD, f.io, ['a', 'due-dates-prd'])).code, EXIT.OK);
  writeFileSync(f.at('docs/mirai/due-dates/prd.md'), swap(PRD_READY, 'within 2 seconds', 'within 3 seconds'));
  const before = readJournal(store).events.length;
  const after = await show('due-dates');
  assert.match(after.out, /^ {2}brief\.md +brief +due-dates-brief +approved +\//m);
  assert.match(after.out, /^ {2}prd\.md +prd +due-dates-prd +changed since approval +\//m);
  assert.equal(readJournal(store).events.length, before, 'show writes nothing');
  // A ticket of the same name: you choose with --docs.
  const t = await tty(['approve', 'due-dates', '--file', 'README.md'], f.io, ['a', 'due-dates']);
  assert.equal(t.code, EXIT.OK, t.err);
  const both = await show('due-dates');
  assert.equal(both.code, EXIT.USAGE);
  assert.match(both.err, /"due-dates" is both a ticket MIRAI knows and the initiative folder docs\/mirai\/due-dates\//);
  assert.match(both.err, /mirai show due-dates --docs/);
  const docs = await show('due-dates', '--docs');
  assert.equal(docs.code, EXIT.OK, docs.err);
  assert.match(docs.out, /^ {2}prd\.md +prd/m);
  assert.match((await show('due-dates', '--json')).out, /"ticket": "due-dates"/);
  // An unknown name says what was looked for.
  const unknown = await show('nothing-here');
  assert.equal(unknown.code, EXIT.USAGE);
  assert.match(unknown.err, /nothing named "nothing-here": no ticket nothing-here in MIRAI, and no initiative folder docs\/mirai\/nothing-here\//);
  const noDocs = await show('PMT-1', '--docs');
  assert.match(noDocs.err, /no initiative "PMT-1": there is no folder docs\/mirai\/PMT-1\//);
});

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
