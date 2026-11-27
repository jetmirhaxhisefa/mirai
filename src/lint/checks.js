import { checkSummary } from './summary.js';
import { checkWriting } from './writing.js';
import { checkBrief } from './brief.js';
import { checkPrd } from './prd.js';
import { checkEpic } from './epic.js';
import { checkInterview } from './interview.js';
import { checkAdr } from './adr.js';
import { checkTechNote } from './tech-note.js';
import { checkHld } from './hld.js';
import { checkLld } from './lld.js';
import { lldItems } from './lld-items.js';
import { testabilityProblems } from './testable.js';
import { idStabilityProblems } from './ids.js';
import { DOC_OF_RUNS_AS, ticketTypesOf } from '../tickets/types.js';
import { checkBusinessChange, checkRequirements } from './requirements.js';
import { checkBusiness, checkConventions, checkFeatureMap, checkJourneys, checkProject } from './context.js';
import { DEPENDENCY_KINDS, installData, parseDependency } from '../agent/dependency-rows.js';

// Built-in checks a document type switches on by name (`lint_checks = ["ticket"]`, unit 08a).
// They cover what the generic rules can't express. Each adds problems like the rules do. The
// names must match BUILT_IN_CHECKS in src/config/registry.js (a test pins it).

// Trackers compare ticket keys without regard to case, so MIRAI does too.
export const sameKey = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

const SEPARATOR = /^ {0,3}\|?(?: *:?-+:? *\|)+ *:?-*:? *$|^ {0,3}\|? *:?-+:? *$/;

// The symbols a Code map or test row's cell names: its comma-separated parts (a comma inside a
// code span or parentheses doesn't split), each the code span it starts with, or else its text up
// to a parenthesis. So "`A::b`, `A::c` (inherited from `B`)" names A::b and A::c (unit 28's
// session check: the note in parentheses made "A::c" look missing).
export function symbolsIn(raw) {
  const parts = [];
  let cur = '';
  let code = false;
  let depth = 0;
  for (const ch of String(raw ?? '')) {
    if (ch === '`') code = !code;
    else if (!code && ch === '(') depth++;
    else if (!code && ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && !code && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => {
    const t = p.trim();
    const span = /^`([^`]+)`/.exec(t);
    return (span ? span[1] : t.replace(/\s*\(.*$/s, '').replace(/`/g, '')).trim();
  }).filter(Boolean);
}

// The one table in a ## section, read as GFM renders it: a header row, a separator row with
// dashes, then the run of non-blank lines after it (with or without a leading pipe). Returns
// { columns, rows: [{ line, cells, raw }], line, problems } with cells by lower-cased column name
// (code-span backticks removed; `raw` keeps them), or null when the section has no table. `problems` lists rows
// an HTML comment could hide and pipe lines outside the one table, so nothing slips past a rule
// by being written oddly.
export function tableIn(doc, section) {
  const { headings, lines } = doc.scan;
  const h = headings.find((x) => x.level === 2 && x.text === section);
  if (!h) return null;
  const next = headings.find((x) => x.line > h.line && x.level <= 2);
  const inSection = lines.filter((l) => l.line > h.line && (!next || l.line < next.line));
  const problems = [];
  let start = -1;
  for (let i = 0; i + 1 < inSection.length; i++) {
    const head = inSection[i];
    const sep = inSection[i + 1];
    if (head.kind === 'text' && head.visible.includes('|') && sep.kind === 'text' && SEPARATOR.test(sep.visible) && sep.line === head.line + 1) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  const splitRaw = (text) => text.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
  const split = (text) => splitRaw(text).map((c) => c.replace(/`/g, ''));
  const columns = split(inSection[start].visible).map((c) => c.toLowerCase());
  const rows = [];
  let i = start + 2;
  for (; i < inSection.length; i++) {
    const l = inSection[i];
    if (l.kind !== 'text' || /^\s*$/.test(l.visible) || l.line !== inSection[i - 1].line + 1) break;
    // A comment can hide a row from the rendered table (or turn the line into an HTML block):
    // a problem, never a silent skip.
    if (l.hadComment && l.visible.includes('|')) {
      problems.push({ line: l.line, reason: 'a table row holds an HTML comment, which can hide it' });
      continue;
    }
    if (/^ {4}/.test(l.visible)) break;
    const raw = splitRaw(l.visible);
    const cells = raw.map((c) => c.replace(/`/g, ''));
    rows.push({ line: l.line, cells: Object.fromEntries(columns.map((c, k) => [c, cells[k] ?? ''])), raw: Object.fromEntries(columns.map((c, k) => [c, raw[k] ?? ''])) });
  }
  for (const l of inSection.slice(i)) {
    if (l.kind === 'text' && (/^ {0,3}\S/.test(l.visible) || l.hadComment) && l.visible.includes('|')) {
      problems.push({ line: l.line, reason: `"${section}" has one table; this line looks like another table's row` });
      break;
    }
  }
  return { columns, rows, line: inSection[start].line, problems };
}

const KINDS = ['red', 'after', 'characterization'];
export const CHANGES = ['add', 'change', 'remove', 'read'];

const clip = (x, n = 80) => {
  const t = String(x ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// The file types each test adapter runs (unit 30c, F20: a frontend test at the PHPUnit level).
const ADAPTER_TYPES = Object.freeze({
  phpunit: ['.php'], pest: ['.php'],
  vitest: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.vue'], jest: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'],
  playwright: ['.ts', '.tsx', '.js', '.mjs', '.cjs'], pytest: ['.py'], go: ['.go'],
});
const globRe = (g) => new RegExp(`^${g.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);

// A Test ID's file (unit 30c, F18): it exists at the plan's base or a Code map row adds it, and
// it's a file type its level's adapter runs. Skipped where MIRAI has no file list (mirai lint).
function testIdProblem(cell, level, { files, added, adapters }, report) {
  const path = cell.replace(/`/g, '').split('::')[0].trim();
  if (!path || path.includes('*')) return;
  if (files) {
    // A new test file is fine, but its folder must be in the repo (or a Code map row adds files
    // there): a path from a service's own folder (BKT-49's src/test/…) names a folder the repo
    // root doesn't have.
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const known = files.has(path) || added.some((a) => a === path || (a.includes('*') && globRe(a).test(path)))
      || dir === '' || [...files].some((f) => f.startsWith(dir)) || added.some((a) => a.startsWith(dir));
    if (!known) {
      const near = [...files, ...added].filter((f) => f.endsWith(`/${path}`) || f.includes(`/${dir}`)).map((f) => (f.endsWith(`/${path}`) ? f : `${f.slice(0, f.indexOf(`/${dir}`) + 1)}${path}`));
      const unique = [...new Set(near)].slice(0, 2);
      report(`the Test ID's folder ${dir} isn't in the repo (it says ${path})`, unique.length ? `the path from the repo root: ${unique.join(' or ')}` : 'name the test file by its path from the repo root');
      return;
    }
  }
  const types = ADAPTER_TYPES[adapters[level] ?? ''];
  const ext = (/\.[A-Za-z0-9]+$/.exec(path) ?? [''])[0].toLowerCase();
  if (types && ext && !types.includes(ext)) {
    const fits = Object.entries(adapters).filter(([, a]) => (ADAPTER_TYPES[a] ?? []).includes(ext)).map(([l]) => l);
    report(`the level ${level} (${adapters[level]}) doesn't run ${ext} files like ${path}`, fits.length ? `use the level ${fits.join(' or ')}` : 'pick the level whose runner runs this file');
  }
}
const DECLARED = ['protected-path', 'dependency', 'dev-dependency', 'test-change', 'none'];
// A protected path is a repo-relative path or glob; a dependency is <ecosystem>:<name>, so the
// broker can match an install exactly (npm:left-pad, composer:guzzlehttp/guzzle).
const REPO_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\u0000-\u001f]+$/;

export const CHECKS = Object.freeze({
  // Unit 31: the summary for approval, the writing rules, the brief.
  summary: (...a) => checkSummary(...a),
  writing: (...a) => checkWriting(...a),
  brief: (...a) => checkBrief(...a),
  // Unit 32: the PRD.
  prd: (...a) => checkPrd(...a),
  // Unit 33: the epic, with the ticket graph lint.
  epic: (...a) => checkEpic(...a),
  // Unit 35: the interview, the record beside the brief.
  interview: (...a) => checkInterview(...a),
  // Unit 36: the five context files in .mirai/context/.
  business: (...a) => checkBusiness(...a),
  journeys: (...a) => checkJourneys(...a),
  'feature-map': (...a) => checkFeatureMap(...a),
  project: (...a) => checkProject(...a),
  conventions: (...a) => checkConventions(...a),
  // Unit 41: your own requirements list, and a proposal to change business.md.
  requirements: (...a) => checkRequirements(...a),
  'business-change': (...a) => checkBusinessChange(...a),
  // Unit 43 (Scope 8): retired IDs are never reused; only where the last approved version is known
  // (approval passes it as `previous`).
  // Unit 61: the architecture decision record.
  adr: (...a) => checkAdr(...a),
  // Unit 62b: the technical note.
  'tech-note': (...a) => checkTechNote(...a),
  // Unit 62: the HLD.
  hld: (...a) => checkHld(...a),
  // Unit 63: the LLD.
  lld: (...a) => checkLld(...a),
  'id-stability': (doc, def, ctx, add) => {
    for (const p of idStabilityProblems(doc, ctx.previous)) add(p);
  },
  // A ticket (story or bug): its repo is one of the config's repos (D-42); it doesn't wait
  // for itself or name a prerequisite twice; under a tickets/ folder its file is <id>.md
  // (design/03, the repo layout).
  ticket(doc, def, ctx, add) {
    const { value, positions } = doc;
    const at = (key) => {
      const p = positions.get(key);
      return p ? { line: p.line, column: p.valueColumn ?? p.column } : { line: 1, column: 1 };
    };
    // Unit 63: `uses` names items of the initiative's LLD (../lld.md, beside the epic).
    if (Array.isArray(value.uses) && value.uses.length) {
      const lld = ctx.readDocument ? ctx.readDocument('../lld.md') : { problem: 'unavailable' };
      if (lld && !lld.problem && lld.value?.type === 'lld') {
        const items = lldItems(lld);
        value.uses.forEach((id, i) => {
          if (typeof id === 'string' && !items.has(id)) add({ code: 'ticket-uses', ...at(`uses[${i}]`), reason: `uses names ${id}, which the initiative's LLD doesn't have`, hint: items.size ? `its items: ${[...items].join(', ')}` : 'the LLD lists no contract or schema change' });
        });
      } else if (lld?.problem === 'missing') add({ code: 'ticket-uses', ...at('uses'), reason: 'uses names LLD items, but the initiative has no lld.md', hint: 'take uses out, or write the LLD first' });
    }
    const repos = ctx.project?.repos ?? [];
    if (typeof value.repo === 'string' && value.repo !== '' && !repos.includes(value.repo)) {
      add({ code: 'unknown-repo', ...at('repo'), reason: '"repo" is not one of the repos in the config', hint: `use one of: ${repos.join(', ')}` });
    }
    if (Array.isArray(value.after)) {
      value.after.forEach((item, i) => {
        const p = positions.get(`after[${i}]`);
        const where = { line: p?.line ?? 1, column: p?.column ?? 1 };
        if (sameKey(item, value.id)) add({ code: 'after-self', ...where, reason: "a ticket can't wait for itself" });
        else if (value.after.slice(0, i).some((earlier) => sameKey(earlier, item))) add({ code: 'duplicate', ...where, reason: `after[${i}] repeats an earlier entry` });
      });
    }
    const parts = (ctx.file ?? '').split('/');
    if (parts.length >= 2 && parts.at(-2).toLowerCase() === 'tickets' && typeof value.id === 'string') {
      const stem = parts.at(-1).replace(/\.(?:md|markdown)$/i, '');
      if (!sameKey(stem, value.id)) add({ code: 'file-name', ...at('id'), reason: "the file name doesn't match the ticket's id", hint: 'name ticket files <id>.md' });
    }
    // Unit 42 (Scope 3): every AC is one a reviewer could test.
    for (const p of testabilityProblems(doc, def)) add(p);
    // Unit 42 (decisions 6 and 7): the ticket's type is one of the project's, and runs as this
    // document's type (Story as a story, Bug as a bug, Spike as an investigation).
    if (value.ticket_type !== undefined) {
      const types = ticketTypesOf(ctx.project);
      const t = typeof value.ticket_type === 'string' ? types.find((x) => x.name.toLowerCase() === value.ticket_type.toLowerCase()) : null;
      if (!t) add({ code: 'ticket-type', ...at('ticket_type'), reason: `"${String(value.ticket_type).slice(0, 40)}" isn't one of the project's ticket types`, hint: `use one of: ${types.map((x) => x.name).join(', ')} ([[tickets.types]] in .mirai/config.toml)` });
      else if (DOC_OF_RUNS_AS[t.runs_as ?? 'change'] !== def.name) add({ code: 'ticket-type', ...at('ticket_type'), reason: `a ${t.name} runs as ${t.runs_as ?? 'change'}, so it is written as a ${DOC_OF_RUNS_AS[t.runs_as ?? 'change']}, not a ${def.name}`, hint: `set type: ${DOC_OF_RUNS_AS[t.runs_as ?? 'change']}, or pick a ${def.name} type` });
    }
  },

  // A plan (unit 08b, design/01 §6–§7): every AC it must prove has a test row with a level and
  // a test the runner can select; a characterization test is only for a symbol the code map
  // changes (D-45); tdd decides which kinds may appear; a new dependency makes the ticket high
  // risk (R3-C2); declared changes have a fixed format, for the broker and the floor guard.
  plan(doc, def, ctx, add) {
    const { value, positions } = doc;
    const at = (key) => {
      const p = positions.get(key);
      return p ? { line: p.line, column: p.valueColumn ?? p.column } : { line: 1, column: 1 };
    };
    const row = (r) => ({ line: r.line, column: 1 });
    if (typeof value.ticket === 'string' && typeof value.id === 'string' && !sameKey(value.id, `${value.ticket}-plan`)) {
      add({ code: 'plan-id', ...at('id'), reason: '"id" must be <ticket>-plan', hint: `for this ticket: ${value.ticket}-plan` });
    }
    if (Number.isInteger(value.round) && value.round < 1) add({ code: 'plan-round', ...at('round'), reason: '"round" starts at 1' });
    const acs = Array.isArray(value.acs) ? value.acs.filter((a) => typeof a === 'string') : [];
    acs.forEach((ac, i) => {
      if (acs.indexOf(ac) !== i) add({ code: 'plan-test', ...posOf(positions, `acs[${i}]`), reason: `${ac} is listed twice in acs` });
    });
    const levels = ctx.project?.levels ?? [];

    const need = (section, columns) => {
      const t = tableIn(doc, section);
      const heading = doc.scan.headings.find((h) => h.level === 2 && h.text === section);
      if (!t || columns.some((c) => !t.columns.includes(c))) {
        if (heading) add({ code: 'plan-table', line: heading.line, column: 1, reason: `"${section}" needs a table with the columns: ${columns.join(', ')}` });
        return null;
      }
      for (const p of t.problems) add({ code: 'plan-table', line: p.line, column: 1, reason: p.reason });
      return t;
    };

    // The code map: which symbols each row adds, changes, removes or reads.
    const map = need('Code map', ['path', 'symbols', 'change']);
    const changesOf = new Map(); // symbol -> Set of changes
    const addedPaths = [];
    for (const r of map?.rows ?? []) {
      const change = r.cells.change.toLowerCase();
      if (!CHANGES.includes(change)) add({ code: 'plan-table', ...row(r), reason: `a Code map row's Change must be one of: ${CHANGES.join(', ')} (it says "${clip(r.raw.change)}")`, hint: 'the cell is that one word; what changes goes in Tasks' });
      if (change === 'add') {
        const spans = [...r.raw.path.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
        addedPaths.push(...(spans.length ? spans : [r.cells.path.trim()]));
      }
      const symbols = symbolsIn(r.raw.symbols);
      if (change === 'add' && symbols.length === 0) add({ code: 'plan-table', ...row(r), reason: 'a Code map row that adds code names its new symbols', hint: 'each new symbol gets a stub step before its red test' });
      for (const symbol of symbols) {
        if (!changesOf.has(symbol)) changesOf.set(symbol, new Set());
        changesOf.get(symbol).add(change);
      }
    }

    // The test list: every AC covered; each row a level, a kind tdd allows, a test the runner
    // can select; characterization rows name a changed symbol.
    const tests = need('Test list', ['test', 'test id', 'symbol', 'ac', 'level', 'kind']);
    const covered = new Set();
    const tddRows = [];
    for (const r of tests?.rows ?? []) {
      const where = row(r);
      const rowAcs = r.cells.ac.split(',').map((x) => x.trim()).filter(Boolean);
      if (rowAcs.length === 0) add({ code: 'plan-test', ...where, reason: 'a test row names no AC' });
      for (const ac of rowAcs) {
        if (!acs.includes(ac)) add({ code: 'plan-test', ...where, reason: `${ac} is not one of the plan's acs` });
        covered.add(ac);
      }
      const level = r.cells.level;
      // `after: <reason>` (unit 23): an after row that says why it isn't red.
      const kindCell = r.cells.kind.trim();
      const kind = kindCell.split(':')[0].trim().toLowerCase();
      const kindReason = kindCell.includes(':') ? kindCell.slice(kindCell.indexOf(':') + 1).trim() : null;
      if (kindReason !== null && (kind !== 'after' || kindReason === '')) add({ code: 'plan-test', ...where, reason: kind === 'after' ? '"after:" needs its reason' : 'only an after row takes a reason ("after: <why not red>")' });
      const noTest = /^no-test\b/i.test(level);
      if (level === '') {
        add({ code: 'plan-level', ...where, reason: 'a test row has no level', hint: 'name the lowest level that really proves the AC, or write no-test: <reason>' });
      } else if (noTest) {
        if (!/^no-test: ?\S/i.test(level)) add({ code: 'plan-level', ...where, reason: 'no-test needs a reason', hint: 'write no-test: <reason>' });
        if (kind !== '' || r.cells['test id'] !== '') add({ code: 'plan-test', ...where, reason: 'a no-test row has no Test ID and no Kind' });
        continue;
      } else if (levels.length > 0 && !levels.includes(level)) {
        add({ code: 'plan-level', ...where, reason: `"${level}" is not one of the project's test levels`, hint: `use one of: ${levels.join(', ')}` });
      }
      if (r.cells['test id'] === '') add({ code: 'plan-test', ...where, reason: 'a test row has no Test ID', hint: "the test file's path from the repo root, optionally ::<test name>" });
      else testIdProblem(r.cells['test id'], level, { files: ctx.files ?? null, added: addedPaths, adapters: ctx.project?.adapters ?? {} }, (reason, hint) => add({ code: 'plan-test', ...where, reason, hint }));
      if (!KINDS.includes(kind)) add({ code: 'plan-test', ...where, reason: `a test row's Kind must be one of: ${KINDS.join(', ')}` });
      if (kind === 'after' && value.tdd === 'first') add({ code: 'plan-test', ...where, reason: 'with tdd: first, tests come before the code, so no row is "after"' });
      if (kind === 'red' && value.tdd === 'after') add({ code: 'plan-test', ...where, reason: 'with tdd: after there is no red check, so no row is "red"', hint: 'use after' });
      const named = symbolsIn(r.raw.symbol);
      tddRows.push({ kind, reason: kindReason, symbols: named, where });
      if (kind === 'characterization') {
        if (named.length === 0 || named.some((x) => !changesOf.get(x)?.has('change'))) {
          add({ code: 'plan-characterization', ...where, reason: 'a characterization test must name, in Symbol, a symbol the Code map marks "change"', hint: 'characterization tests cover only the existing functions or methods this ticket changes (D-45)' });
        }
      } else {
        // The symbol by name, and the map's, so a fix launch can act on it.
        const missing = named.filter((x) => !changesOf.has(x));
        const known = [...changesOf.keys()].slice(0, 12).join(', ');
        if (missing.length) add({ code: 'plan-test', ...where, reason: `a test row's Symbol ${missing.map((x) => `"${x.slice(0, 80)}"`).join(', ')} is not in the Code map`, hint: `write it as a code span, exactly as a Code map row's Symbols do (${known || 'the Code map names none'}), or add it there` });
      }
    }
    // Unit 23, `tdd: auto` (Jet's decision 3): a bug's plan has a red row, its reproduction; a
    // symbol the Code map adds or changes, named by a test row, has a red row, or its after row
    // says why not.
    if (value.tdd !== 'after' && value.ticket_type === 'bug' && tests && !tddRows.some((t) => t.kind === 'red')) {
      const h = doc.scan.headings.find((x) => x.level === 2 && x.text === 'Test list');
      add({ code: 'plan-tdd', line: h?.line ?? 1, column: 1, reason: 'a bug\'s plan needs a red row: the test that reproduces the bug, failing before the fix', hint: 'mark the reproducing test\'s row red' });
    }
    if (value.tdd === 'auto') {
      const red = new Set(tddRows.filter((t) => t.kind === 'red').flatMap((t) => t.symbols));
      for (const t of tddRows) {
        if (t.kind !== 'after' || t.reason) continue;
        const logic = t.symbols.filter((x) => (changesOf.get(x)?.has('add') || changesOf.get(x)?.has('change')) && !red.has(x));
        if (logic.length) add({ code: 'plan-tdd', ...t.where, reason: `${logic.map((x) => `"${x.slice(0, 80)}"`).join(', ')} is new or changed code with no red row`, hint: 'make the row red (a stub first, then the test fails by its check), or write after: <why not red>' });
      }
    }
    acs.forEach((ac, i) => {
      if (acs.indexOf(ac) === i && !covered.has(ac)) add({ code: 'plan-level', ...posOf(positions, `acs[${i}]`), reason: `${ac} has no test row`, hint: 'add a row with its level, or no-test: <reason>' });
    });

    // Declared changes: a fixed format; a new dependency makes the ticket high risk.
    const declared = need('Declared changes', ['kind', 'item', 'why']);
    let dependency = false;
    for (const r of declared?.rows ?? []) {
      const where = row(r);
      const kind = r.cells.kind.toLowerCase();
      if (!DECLARED.includes(kind)) {
        add({ code: 'plan-table', ...where, reason: `a Declared changes row's Kind must be one of: ${DECLARED.join(', ')}` });
        continue;
      }
      if (kind === 'none') {
        if (declared.rows.length > 1) add({ code: 'plan-table', ...where, reason: '"none" must be the only row' });
        continue;
      }
      if (r.cells.item === '' || r.cells.why === '') add({ code: 'plan-table', ...where, reason: 'a declared change needs its Item and its Why' });
      else if (kind === 'protected-path' && (!REPO_PATH.test(r.cells.item) || /[*?[\]{}]/.test(r.cells.item))) add({ code: 'plan-table', ...where, reason: 'a protected path is one exact file path inside the repo (no patterns: a plan names each file, unit 12)', hint: 'no *, ?, [ ] or { }, no leading /, no drive letter, no ..' });
      else if (kind === 'test-change' && (!REPO_PATH.test(r.cells.item) || /[*?[\]{}]/.test(r.cells.item))) add({ code: 'plan-table', ...where, reason: 'a test-change is one exact test file path inside the repo (no patterns)', hint: 'name each existing test file whose lines change, with why' });
      else if (DEPENDENCY_KINDS.includes(kind)) {
        // Unit 30b: an exact version, for an ecosystem MIRAI can install; you approve exactly it.
        const d = parseDependency(r.cells.item);
        if (d.problem) add({ code: 'plan-table', ...where, reason: d.problem, hint: 'for example npm:left-pad@1.3.0 or composer:guzzlehttp/guzzle@7.9.2' });
        else if (ctx.registry?.stacks && !installData(ctx.registry.stacks, d.ecosystem)) add({ code: 'plan-table', ...where, reason: `MIRAI can't install ${d.ecosystem} packages`, hint: 'only npm and composer; add others on the integration branch yourself (docs/agents.md)' });
      }
      if (DEPENDENCY_KINDS.includes(kind)) dependency = true;
    }
    if (declared && declared.rows.length === 0) add({ code: 'plan-table', line: declared.line, column: 1, reason: '"Declared changes" needs a row, or one row "none"' });
    if (dependency && value.risk !== 'high') add({ code: 'plan-risk', ...at('risk'), reason: 'a new dependency makes the ticket high risk', hint: 'set risk: high; the plan then always goes to you (R3-C2)' });
  },
});

function posOf(positions, key) {
  const p = positions.get(key);
  return p ? { line: p.line, column: p.column } : { line: 1, column: 1 };
}
