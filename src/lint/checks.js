// Built-in checks a document type switches on by name (`lint_checks = ["ticket"]`, unit 08a).
// They cover what the generic rules can't express. Each adds problems like the rules do. The
// names must match BUILT_IN_CHECKS in src/config/registry.js (a test pins it).

// Trackers compare ticket keys without regard to case, so MIRAI does too.
export const sameKey = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

const SEPARATOR = /^ {0,3}\|?(?: *:?-+:? *\|)+ *:?-*:? *$|^ {0,3}\|? *:?-+:? *$/;

// The one table in a ## section, read as GFM renders it: a header row, a separator row with
// dashes, then the run of non-blank lines after it (with or without a leading pipe). Returns
// { columns, rows: [{ line, cells }], line, problems } with cells by lower-cased column name
// (code-span backticks removed), or null when the section has no table. `problems` lists rows
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
  const split = (text) => text.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/`/g, ''));
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
    const cells = split(l.visible);
    rows.push({ line: l.line, cells: Object.fromEntries(columns.map((c, k) => [c, cells[k] ?? ''])) });
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
const CHANGES = ['add', 'change', 'remove', 'read'];
const DECLARED = ['protected-path', 'dependency', 'none'];
// A protected path is a repo-relative path or glob; a dependency is <ecosystem>:<name>, so the
// broker can match an install exactly (npm:left-pad, composer:guzzlehttp/guzzle).
const REPO_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\u0000-\u001f]+$/;
const DEPENDENCY = /^[a-z][a-z0-9+.-]{0,31}:\S+$/;

export const CHECKS = Object.freeze({
  // A ticket (story or bug): its repo is one of the config's repos (D-42); it doesn't wait
  // for itself or name a prerequisite twice; under a tickets/ folder its file is <id>.md
  // (design/03, the repo layout).
  ticket(doc, def, ctx, add) {
    const { value, positions } = doc;
    const at = (key) => {
      const p = positions.get(key);
      return p ? { line: p.line, column: p.valueColumn ?? p.column } : { line: 1, column: 1 };
    };
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
    for (const r of map?.rows ?? []) {
      const change = r.cells.change.toLowerCase();
      if (!CHANGES.includes(change)) add({ code: 'plan-table', ...row(r), reason: `a Code map row's Change must be one of: ${CHANGES.join(', ')}` });
      const symbols = r.cells.symbols.split(',').map((x) => x.trim()).filter(Boolean);
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
    for (const r of tests?.rows ?? []) {
      const where = row(r);
      const rowAcs = r.cells.ac.split(',').map((x) => x.trim()).filter(Boolean);
      if (rowAcs.length === 0) add({ code: 'plan-test', ...where, reason: 'a test row names no AC' });
      for (const ac of rowAcs) {
        if (!acs.includes(ac)) add({ code: 'plan-test', ...where, reason: `${ac} is not one of the plan's acs` });
        covered.add(ac);
      }
      const level = r.cells.level;
      const kind = r.cells.kind.toLowerCase();
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
      if (r.cells['test id'] === '') add({ code: 'plan-test', ...where, reason: 'a test row has no Test ID', hint: "the test's file or name, as the level's runner selects it" });
      if (!KINDS.includes(kind)) add({ code: 'plan-test', ...where, reason: `a test row's Kind must be one of: ${KINDS.join(', ')}` });
      if (kind === 'after' && value.tdd === 'first') add({ code: 'plan-test', ...where, reason: 'with tdd: first, tests come before the code, so no row is "after"' });
      if (kind === 'red' && value.tdd === 'after') add({ code: 'plan-test', ...where, reason: 'with tdd: after there is no red check, so no row is "red"', hint: 'use after' });
      const symbol = r.cells.symbol;
      if (kind === 'characterization') {
        if (!changesOf.get(symbol)?.has('change')) {
          add({ code: 'plan-characterization', ...where, reason: 'a characterization test must name, in Symbol, a symbol the Code map marks "change"', hint: 'characterization tests cover only the existing functions or methods this ticket changes (D-45)' });
        }
      } else if (symbol !== '' && !changesOf.has(symbol)) {
        add({ code: 'plan-test', ...where, reason: "a test row's Symbol is not in the Code map" });
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
      else if (kind === 'dependency' && !DEPENDENCY.test(r.cells.item)) add({ code: 'plan-table', ...where, reason: 'a dependency is written <ecosystem>:<name>', hint: 'for example npm:left-pad or composer:guzzlehttp/guzzle' });
      if (kind === 'dependency') dependency = true;
    }
    if (declared && declared.rows.length === 0) add({ code: 'plan-table', line: declared.line, column: 1, reason: '"Declared changes" needs a row, or one row "none"' });
    if (dependency && value.risk !== 'high') add({ code: 'plan-risk', ...at('risk'), reason: 'a new dependency makes the ticket high risk', hint: 'set risk: high; the plan then always goes to you (R3-C2)' });
  },
});

function posOf(positions, key) {
  const p = positions.get(key);
  return p ? { line: p.line, column: p.column } : { line: 1, column: 1 };
}
