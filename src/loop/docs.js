import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { atomicWrite, ensurePrivateDir, withLock } from '../store/files.js';
import { BUDGET } from './guard.js';

// The books of a document's fix loop (unit 44, decision 1 and the build default): one file per
// document version in the store, `loop/docs/<id>@v<n>.json`, so each new version gets fresh
// rounds. The loop runs inside the author's run (41); these only count: the rounds each check used,
// the decision questions asked and answered, the answer runs, and the cost. They reuse the loop
// guard's lock and atomic write and its ledger fields (BUDGET), with none of its round mechanics
// (no L2, L4 or L5). A ticket key can't hold `@` or `/`, so a document's file never meets a
// ticket's (`loop/<ticket>.json`).
//
// A round is counted when a check (`verify`, `reader_test`) runs on a new content hash after a
// result that had open writing must-fix findings; a result with only decisions counts no round.
// Rounds count within a cycle (41's P4: your new answers start a new one), except after the
// rounds-out step, whose answer run continues the cycle it ran out in.

export const DOCS_LOOP_DIR = join('loop', 'docs');
export const DOCS_LOOP_SCHEMA = 1;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const CHECKS = Object.freeze(['verify', 'reader_test']);

// A document's version from its file name: prd.md is 1, prd.v2.draft.md is 2 (nextDraftName).
export function versionOf(path) {
  const m = /\.v([1-9][0-9]{0,3})\.draft\.md$/.exec(basename(String(path ?? '')));
  return m ? Number(m[1]) : 1;
}

export function bookKey(id, version) {
  if (!ID.test(String(id ?? '')) || !Number.isSafeInteger(version) || version < 1 || version > 9999) throw new TypeError('not a document id and version');
  return `${id}@v${version}`;
}
const pathOf = (store, id, version) => join(store.dir, DOCS_LOOP_DIR, `${bookKey(id, version)}.json`);
const lockOf = (store, id, version) => join(store.dir, DOCS_LOOP_DIR, `${bookKey(id, version)}.lock`);

export const freshBooks = (id, version) => ({
  schema: DOCS_LOOP_SCHEMA, id, version, cycle: null,
  rounds_used: { verify: 0, reader_test: 0 }, last: { verify: null, reader_test: null },
  asked: [], dismissed: [], writing_back: [], answered: [], drops: [], invented: {}, pending_invented: [],
  answer_runs: 0, rounds_out: null, too_many: null,
  budget: Object.fromEntries(BUDGET.map((k) => [k, 0])), launches: 0,
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v) => Number.isSafeInteger(v) && v >= 0;
function wellFormed(v, id, version) {
  return v?.schema === DOCS_LOOP_SCHEMA && v.id === id && v.version === version
    && isObject(v.rounds_used) && CHECKS.every((k) => count(v.rounds_used[k])) && isObject(v.last)
    && ['asked', 'dismissed', 'writing_back', 'answered', 'drops', 'pending_invented'].every((k) => Array.isArray(v[k])) && isObject(v.invented)
    && count(v.answer_runs) && count(v.launches) && isObject(v.budget) && BUDGET.every((k) => typeof v.budget[k] === 'number' && v.budget[k] >= 0)
    && (v.rounds_out === null || isObject(v.rounds_out)) && (v.too_many === null || isObject(v.too_many));
}

// The version's books: fresh when there are none; a file that isn't whole refuses, never resets.
export function readBooks(store, id, version) {
  let text;
  try {
    text = readFileSync(pathOf(store, id, version), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return freshBooks(id, version);
    throw err;
  }
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    v = null;
  }
  if (!wellFormed(v, id, version)) throw Object.assign(new MiraiError(`the books of ${bookKey(id, version)} (${pathOf(store, id, version)}) can't be read; they're never reset by guessing`, EXIT.BLOCKED), { code: 'docs-loop-unreadable', hint: 'look at the file; if you know why it broke, remove it (the rounds start again at 0), then run again' });
  return v;
}

// One change to the books, under their lock: read, change, write. `fn(books)` returns the new books
// (or nothing, to write none) and may return { books, result }.
export function changeBooks(store, id, version, fn) {
  ensurePrivateDir(join(store.dir, 'loop'));
  ensurePrivateDir(join(store.dir, DOCS_LOOP_DIR));
  return withLock(lockOf(store, id, version), `the books of ${bookKey(id, version)}`, () => {
    const books = readBooks(store, id, version);
    const out = fn(structuredClone(books));
    const next = out && Object.hasOwn(out, 'books') ? out.books : out;
    if (next) atomicWrite(pathOf(store, id, version), `${JSON.stringify(next, null, 2)}\n`);
    return out && Object.hasOwn(out, 'result') ? out.result : next ?? books;
  });
}

// A check's result in the books: { books, counted }. `hash`: the checked text's; `writingOpen`: the
// result's open writing must-fix findings; `cycle`: the run's cycle for the check.
export function countCheck(books, { check, hash, writingOpen, cycle = null, pinned = false }) {
  if (!CHECKS.includes(check)) throw new TypeError(`not a check: ${check}`);
  const b = books;
  if (!pinned && cycle !== null && b.cycle !== cycle) {
    if (b.cycle !== null) b.rounds_used = { verify: 0, reader_test: 0 };
    b.cycle = cycle;
    b.last = { verify: null, reader_test: null };
    b.rounds_out = null;
  }
  const last = b.last[check];
  // The rounds-out step's answer run (pinned) is no round: it's counted in answer_runs.
  const counted = Boolean(!pinned && last && last.hash !== hash && last.writing_open > 0);
  if (counted) b.rounds_used[check] += 1;
  b.last[check] = { hash, writing_open: writingOpen };
  return { books: b, counted };
}

// A launch's cost into the books' ledger fields (its run-log line, as the loop guard settles it).
export function addCost(books, line = {}) {
  const add = (k, v) => (Number.isFinite(v) && v > 0 ? books.budget[k] + v : books.budget[k]);
  books.budget = {
    turns: add('turns', line.turns), tokens: add('tokens', (line.tokens_in ?? 0) + (line.tokens_out ?? 0)), tokens_cached: add('tokens_cached', line.tokens_cached),
    minutes: add('minutes', line.minutes), cost_usd: add('cost_usd', line.cost_usd), limit_share: add('limit_share', line.limit_share),
  };
  books.launches += 1;
  return books;
}

// Unit 44 (decision 6): past this many open decision questions on one version, the one question
// "reopen the brief interview?" instead. `[docs] max_decision_questions`, 1–20, project file only.
export const DEFAULT_MAX_DECISIONS = 5;
export const maxDecisionQuestions = (config) => (Number.isInteger(config?.docs?.max_decision_questions) ? config.docs.max_decision_questions : DEFAULT_MAX_DECISIONS);

// Whether this run's check continues the cycle the rounds ran out in (the rounds-out step asked you
// something, and this is the run that applies your answers): the first run to check after it.
export const pinnedCycle = (books, runId) => Boolean(books.rounds_out?.asked && (books.rounds_out.pinned_run ?? runId) === runId);

// The decision questions still waiting for an answer on this version.
// Every decision question asked on this version, answered or not (Jet, 2026-11-26, 44's P2 rerun, Q1
// "A"): the cap counts these, so a drip of one or two per round still reaches "reopen?".
export const askedOn = (books) => books.asked.filter((a) => a.kind !== 'reopen' && a.source !== 'too-many');
