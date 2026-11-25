import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseJsonStrict } from '../findings/schema.js';
import { readFrontmatter } from '../lint/frontmatter.js';
import { testRows } from '../agent/tdd.js';
import { ticketTypeNamed } from '../tickets/types.js';
import { verifySigned } from '../sign/sign.js';
import { resultContext } from '../tests/run.js';

// `mirai trace <ticket>`, the code's scope (unit 43; Jet's decisions 1–4, 2026-11-21). Every
// acceptance criterion of the ticket (AC-<ticket>.n) has a test that ran and passed in the gate's
// own run, named with its ID (decision 2); an `e2e: true` ticket also has a passing test named
// with its journey (J-n) and an AC ID; each row of the plan's test list is a test in the results,
// named with its AC. Read from the gate's results (the signed result and its cases.json, whose
// hash the result holds), never from the work tree. No model runs.
//
// `tests: optional` drops the test link, but then QA evidence is needed: until unit 50 (Ivy) builds
// QA, such a ticket can't ship (decision 3). The ticket's behaviour comes from its `runs_as` (its
// ticket_type's, or its document type's), never a type's name: an investigation has no code scope.

export const QA_NOT_BUILT = 'not built yet';
export const QA_NEEDED = 'QA evidence is needed; QA isn\'t built yet (unit 50)';
const ID = String.raw`(?:AC-[A-Za-z0-9][A-Za-z0-9._-]{0,63}?\.[0-9]+|J-[0-9]+)`;
// A name that starts with one ID or a list of them, then a colon: "AC-53.2: …", "AC-53.2, AC-53.3: …",
// "J-1, AC-53.1: …".
const LEADING = new RegExp(`^\\s*(${ID}(?:\\s*,\\s*${ID})*)\\s*:`);
const RUNS_AS_OF_DOC = Object.freeze({ story: 'change', bug: 'bug', investigation: 'investigation' });
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The IDs a test's name starts with: [] when it starts with none. A runner that prefixes the name
// with its describe blocks ("Reminders › AC-53.2: …", "file > AC-53.2: …") is read at its last part.
export function namedIds(name) {
  const text = String(name ?? '');
  const parts = [text, text.split(/\s+(?:›|>)\s+/).at(-1)];
  for (const p of parts) {
    const m = LEADING.exec(p);
    if (m) return m[1].split(',').map((x) => x.trim());
  }
  return [];
}

// The ticket's behaviour: its ticket_type's runs_as when the project names one, else its document type's.
export function runsAsOf(fm, config = null) {
  const t = ticketTypeNamed(config, fm?.ticket_type);
  return t?.runs_as ?? RUNS_AS_OF_DOC[fm?.type] ?? 'change';
}

// The ticket's own ACs (AC-<key>.n, bullets in its body), in order.
export function ownAcs(ticket) {
  const id = String(ticket.fm?.id ?? '');
  const re = new RegExp(`^\\s*[-*+]\\s+(?:\\*\\*)?(AC-${escapeRe(id)}\\.[0-9]+)\\b`, 'gim');
  const out = [];
  for (const m of String(ticket.text ?? '').matchAll(re)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// The journeys a ticket names (J-n in its text) that journeys.md defines; with none named, every
// journey journeys.md defines (the ticket's e2e test names the one it changes).
export function journeysOf(ticketText, journeysText) {
  const defined = [...String(journeysText ?? '').matchAll(/^ {0,3}###[ \t]+(J-[0-9]+)\b/gm)].map((m) => m[1]);
  const named = [...new Set([...String(ticketText ?? '').matchAll(/(?<![A-Za-z0-9-])(J-[0-9]+)(?![0-9])/g)].map((m) => m[1]))].filter((j) => defined.includes(j));
  return { defined, named, wanted: named.length ? named : defined };
}

// The gate's cases, from its results: { cases: [{ level, id, file, name, outcome }], problems,
// levels: [{ name, cases }] }. Each result: { name, signed result fields (cases_sha256), dir }; its
// cases.json is read beside it and must hash to the result's cases_sha256, so a case list can't be
// swapped after the run. A level with no test adapter has no cases: it can't name a test.
export function gateCases(results) {
  const cases = [];
  const problems = [];
  const levels = [];
  for (const r of results) {
    if (!r) continue;
    const level = r.level ?? r.name ?? null;
    if (typeof r.cases_sha256 !== 'string') {
      levels.push({ name: level, cases: null });
      continue;
    }
    let bytes = null;
    try {
      bytes = readFileSync(join(r.dir, 'cases.json'));
    } catch {
      bytes = null;
    }
    if (!bytes) {
      problems.push(`${level}'s case list (cases.json) isn't in the store any more: run the gate again (mirai gate record)`);
      levels.push({ name: level, cases: null });
      continue;
    }
    if (createHash('sha256').update(bytes).digest('hex') !== r.cases_sha256) {
      problems.push(`${level}'s case list doesn't match its signed result: it changed after the run`);
      levels.push({ name: level, cases: null });
      continue;
    }
    let list = [];
    try {
      list = parseJsonStrict(bytes.toString('utf8'), { maxBytes: 64 * 1024 * 1024 }).cases ?? [];
    } catch {
      problems.push(`${level}'s case list can't be read`);
      list = [];
    }
    let n = 0;
    for (const c of Array.isArray(list) ? list : []) {
      if (!c || typeof c !== 'object') continue;
      const id = typeof c.id === 'string' ? c.id : null;
      const sep = id ? id.indexOf('::') : -1;
      const name = sep >= 0 ? id.slice(sep + 2) : typeof c.name === 'string' ? c.name : id;
      cases.push({ level, id, file: sep >= 0 ? id.slice(0, sep) : null, name: name ?? '', outcome: c.outcome });
      n += 1;
    }
    levels.push({ name: level, cases: n });
  }
  return { cases, problems, levels };
}

// The trace of one ticket: { result: 'pass' | 'fail' | 'n/a', scope: 'ticket', item, runs_as,
// links: [{ from, to, state, where }], missing: [{ id, what, where, kind }], qa, why? }.
// `ticket`: { fm, text, path }; `plan`: the approved plan's text or null; `cases`: gateCases'
// cases (passing or not); `journeys`: journeys.md's text or null; `problems`: the results' own.
export function traceTicket({ ticket, plan = null, cases = [], journeys = null, problems = [], config = null, ranGate = true }) {
  const key = String(ticket.fm?.id ?? '');
  const where = ticket.path ?? `tickets/${key}.md`;
  const runsAs = runsAsOf(ticket.fm, config);
  const base = { scope: 'ticket', item: key, runs_as: runsAs, qa: QA_NOT_BUILT };
  if (runsAs === 'investigation') return { ...base, result: 'n/a', why: `${key} is an investigation: research and a written finding, with no code merge, so it has no tests to trace`, links: [], missing: [] };
  const links = [];
  const missing = [];
  const miss = (id, what, at, kind) => {
    missing.push({ id, what, where: at, kind });
    links.push({ from: id, to: null, state: 'missing', where: at, what });
  };
  let planFm = {};
  try {
    planFm = plan ? readFrontmatter(plan)?.value ?? {} : {};
  } catch {
    planFm = {};
  }
  const tests = ['required', 'optional'].includes(ticket.fm?.tests) ? ticket.fm.tests : ['required', 'optional'].includes(planFm.tests) ? planFm.tests : 'required';
  const acs = ownAcs(ticket);
  if (!acs.length) miss(key, `${key} has no acceptance criterion (AC-${key}.n) to trace`, where, 'ac');
  for (const p of problems) miss(key, p, 'the gate\'s results', 'results');
  const passed = cases.filter((c) => c.outcome === 'pass');
  const shown = (c) => c.id ?? c.name;
  if (tests === 'optional') {
    // Decision 3: no test link; QA evidence instead, which unit 50 switches on.
    for (const ac of acs) miss(ac, `${ac}: ${QA_NEEDED}`, where, 'qa');
    return { ...base, tests, result: missing.length ? 'fail' : 'pass', links, missing };
  }
  for (const ac of acs) {
    const hit = passed.find((c) => namedIds(c.name).includes(ac));
    if (hit) links.push({ from: ac, to: shown(hit), state: 'pass', where: hit.level });
    else {
      const failed = cases.find((c) => namedIds(c.name).includes(ac));
      miss(ac, failed ? `${ac} has no passing test: ${shown(failed)} ${failed.outcome === 'skip' ? 'was skipped' : 'failed'} in the gate's run` : `${ac} has no passing test named with its ID in the gate's run${ranGate ? '' : ' (no gate run yet)'}; and no QA evidence (QA isn't built yet, unit 50)`, 'plan.md, Test list', 'test');
    }
  }
  // An e2e ticket: a passing test named with its journey and one of its AC IDs.
  if (ticket.fm?.e2e === true) {
    const j = journeysOf(ticket.text, journeys);
    if (!j.defined.length) miss(key, `${key} is e2e: true, but .mirai/context/journeys.md defines no journey (J-n) to name its end-to-end test with`, '.mirai/context/journeys.md', 'e2e');
    else {
      const hit = passed.find((c) => {
        const ids = namedIds(c.name);
        return ids.some((x) => j.wanted.includes(x)) && ids.some((x) => acs.includes(x));
      });
      const label = j.wanted.length === 1 ? j.wanted[0] : `one of ${j.wanted.join(', ')}`;
      if (hit) links.push({ from: `${key} (e2e)`, to: shown(hit), state: 'pass', where: hit.level });
      else miss(`${key} (e2e)`, `${key} is e2e: true, but no passing test is named with its journey (${label}) and an AC ID, such as "${j.wanted[0]}, ${acs[0] ?? `AC-${key}.1`}: …"`, 'plan.md, Test list', 'e2e');
    }
  }
  // The plan's test list: each row's test is in the results, passing, named with its AC.
  if (plan) {
    for (const row of testRows(plan)) {
      if (row.kind === null || !row.id || !row.acs.length) continue;
      const found = cases.filter((c) => (row.name === null ? c.file === row.path : c.id === row.id));
      const at = `plan.md, Test list, line ${row.line}`;
      if (!found.length) {
        miss(row.acs[0], `the plan's test "${row.test || row.id}" (${row.id}, for ${row.acs.join(', ')}) isn't in the gate's results: missing, or renamed`, at, 'plan');
        continue;
      }
      const named = found.filter((c) => namedIds(c.name).some((x) => row.acs.includes(x)));
      if (!named.length) miss(row.acs[0], `the plan's test ${row.id} doesn't start its name with its AC (${row.acs.join(', ')}): name it "${row.acs[0]}: …"`, at, 'plan');
      else if (!named.some((c) => c.outcome === 'pass')) miss(row.acs[0], `the plan's test ${row.id} (${row.acs.join(', ')}) didn't pass in the gate's run`, at, 'plan');
      else links.push({ from: `plan: ${row.id}`, to: row.acs.join(', '), state: 'pass', where: at });
    }
  }
  return { ...base, tests, result: missing.length ? 'fail' : 'pass', links, missing };
}

// The proof's `trace` field for a pass (Scope 4): signed with the rest of the proof.
export function proofTrace(t) {
  return { result: t.result, scope: 'ticket', links: t.links.filter((l) => l.state === 'pass').length, qa: t.qa ?? QA_NOT_BUILT };
}

// One must-fix finding per missing link (09a's schema, a review finding's fields), for Kai's fix round.
export function traceFindings(t) {
  const file = (m) => (m.kind === 'plan' || m.kind === 'test' || m.kind === 'e2e' ? 'plan.md' : m.where && !/\s/.test(m.where) ? m.where : 'plan.md');
  return t.missing.map((m, i) => ({
    id: `trace-${i + 1}`,
    severity: 'blocking',
    category: 'trace',
    file: file(m),
    symbol: m.id,
    basis: { kind: 'ac', ref: String(m.id).replace(/ \(e2e\)$/, '') },
    claim: String(m.what).slice(0, 1000),
  }));
}

// The newest signed gate result of each level for a ticket's branch head, from the store's kept
// gate results (src/tests/run.js keeps them in tests/gate/): [{ name, ...result, dir }]. Each one's
// signature is checked with the integration branch's keys; one that doesn't verify is left out.
export function keptGateResults(store, { branch, head, keys }) {
  const kept = join(store.dir, 'tests', 'gate');
  let names = [];
  try {
    names = readdirSync(kept).filter((n) => /^t-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}\.json$/.test(n)).sort();
  } catch {
    names = [];
  }
  const byLevel = new Map();
  for (const n of names) {
    let r;
    try {
      r = JSON.parse(readFileSync(join(kept, n), 'utf8'));
    } catch {
      continue;
    }
    if (r?.gate?.branch !== branch || r.gate.head !== head) continue;
    if (!verifySigned({ ...r }, keys, { context: resultContext(store.repoId) }).ok) continue;
    byLevel.set(r.name ?? n, { ...r, level: r.name, dir: join(store.dir, 'tests', n.replace(/\.json$/, '')) });
  }
  return [...byLevel.values()];
}
