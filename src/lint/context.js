import { tableIn } from './checks.js';
import { documentWords } from './prd.js';
import { repoPath } from './repo.js';

// The context files' lints (unit 36; Jet's decisions 2026-11-20). Five files in .mirai/context/
// that every agent run loads:
// - business.md: every bullet ends with its source, (S-n); a Sources table defines each S-n once,
//   with a link, a file or "you said", and a date; about two pages (warn past 800 words, fail
//   past 1,000, the Sources table not counted); a claim no source says yet ends with (open)
//   instead: a warning that names it as a question for you, and a failure at approval (Jet's
//   decision 8, from P2 on Thudos);
// - journeys.md: the critical journeys, ### J-n: <name>, numbered with no gap, each with steps,
//   a "Why critical:" line with its source and an "E2E test:" line (a file, or "none yet");
// - feature-map.md: one row per screen, with its route and stable handles, found in the code;
// - project-<service>.md: stack, commands, layout, test levels and instructions; its paths
//   exist and its commands' scripts are in the manifest (the stacks' [[scripts]] data);
// - conventions-<service>.md: rules, each tagged (enforced by <check>), a named check in the
//   config, or (judgment), with an example.
// The checks against the code and the config run only where the file is a real context file
// (`ctx.repo`: in .mirai/context/, or a text linted for approval); a template or an example where
// it lives is checked for its shape only.

export const CONTEXT_DIR = '.mirai/context';
// The five kinds, in the order `mirai show context` lists them: the file name ({service} for a
// file per service) and whether you approve it (decisions 1, 4 and 5).
export const CONTEXT_KINDS = Object.freeze([
  { type: 'business', file: 'business.md', approved: true },
  { type: 'journeys', file: 'journeys.md', approved: true },
  { type: 'feature-map', file: 'feature-map.md', approved: false },
  { type: 'project', file: 'project-{service}.md', approved: false },
  { type: 'conventions', file: 'conventions-{service}.md', approved: true },
]);
const NAME = /^(business|journeys|feature-map|project-[a-z0-9][a-z0-9-]*|conventions-[a-z0-9][a-z0-9-]*)\.md$/;

// Whether a repo path is one of the context files (a direct child of .mirai/context/ named as
// one of the five kinds): those are MIRAI documents, linted like the docs root's. Others there
// (agents-local.md, sources/) aren't.
export function isContextFile(rel) {
  const parts = String(rel).split('/');
  return parts.length === 3 && parts[0] === '.mirai' && parts[1] === 'context' && NAME.test(parts[2]);
}
// The kind a context file name is: { type, approved, service? }, or null.
export function contextKindOf(name) {
  const m = NAME.exec(name);
  if (!m) return null;
  const base = m[1];
  for (const k of CONTEXT_KINDS) {
    if (!k.file.includes('{service}') && k.file === name) return { ...k };
    const prefix = k.file.split('{service}')[0];
    if (k.file.includes('{service}') && base.startsWith(prefix)) return { ...k, service: base.slice(prefix.length) };
  }
  return null;
}

const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
function realDate(text) {
  const m = DATE.exec(String(text ?? '').trim());
  if (!m) return false;
  const t = new Date(0);
  t.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return t.getUTCFullYear() === Number(m[1]) && t.getUTCMonth() === Number(m[2]) - 1 && t.getUTCDate() === Number(m[3]);
}
const clip = (x, n = 60) => {
  const t = String(x ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const LIST_ITEM = /^( *)(?:[-*+]|[0-9]{1,9}[.)])(?:[ \t]+|$)/;
const NOT_APPLICABLE = /^Not applicable — \S/;
const SOURCE_IDS = /\((S-[0-9]+(?:,[ \t]*S-[0-9]+)*)\)\.?[ \t]*$/;
// A claim no source says yet (decision 8): it ends with (open) in place of its source ID.
const OPEN = /\(open\)\.?[ \t]*$/;
const S_ID = /(?<![\p{L}\p{N}_-])S-[0-9]+(?![\p{L}\p{N}_]|[.-][\p{L}\p{N}])/gu;
const textOf = (l) => (l.visible ?? l.text ?? '');

// The ## section's range: { h, end } (end: the next ## or #'s line, or Infinity), or null.
function sectionOf(scan, name) {
  const h = scan.headings.find((x) => x.level === 2 && x.text === name);
  if (!h) return null;
  return { h, end: scan.headings.find((x) => x.line > h.line && x.level <= 2)?.line ?? Infinity };
}
const sectionAt = (scan) => {
  const h2 = scan.headings.filter((h) => h.level <= 2);
  return (line) => {
    const h = h2.filter((x) => x.line <= line).at(-1);
    return h?.level === 2 ? h.text : null;
  };
};

// The blocks of text lines between `from` and `to` (exclusive): list items (each with the lines
// that continue it: indented ones, nested items included when `nested`) and plain paragraphs.
// Returns [{ kind: 'item' | 'text', line, indent, text, lines }].
function blocks(scan, from, to, { nested = false } = {}) {
  const out = [];
  let cur = null;
  for (const l of scan.lines) {
    if (l.line <= from || l.line >= to) continue;
    if (l.kind === 'comment') continue;
    if (l.kind === 'blank') {
      if (cur) cur.gap = true;
      continue;
    }
    if (l.kind !== 'text') {
      cur = null;
      continue;
    }
    const raw = textOf(l);
    if (/^ *\|/.test(raw)) {
      cur = null;
      continue;
    }
    const item = LIST_ITEM.exec(raw);
    const indent = raw.length - raw.trimStart().length;
    // A line continues the block: a plain line right after it, or an indented line (a nested
    // item too, when `nested`) under an item, even after a blank line.
    const deeper = cur?.kind === 'item' && indent > cur.indent;
    const continues = cur && ((!item && (!cur.gap || deeper)) || (item && nested && deeper));
    if (continues) {
      cur.text += ` ${raw.trim()}`;
      cur.lines.push(l);
      continue;
    }
    cur = { kind: item ? 'item' : 'text', line: l.line, indent: item ? item[1].length : indent, text: item ? raw.slice(item[0].length).trim() : raw.trim(), lines: [l], gap: false };
    out.push(cur);
  }
  return out.map(({ gap: _g, ...b }) => b);
}

// ---- The Sources table (business and journeys) ---------------------------------------------

const SOURCE_COLUMNS = ['id', 'source', 'where', 'date'];

// The Sources table's rows: Map S-n → { line, used }. Each row has an ID, says what the source is,
// where it is (a link, a file from the repo's top folder, or "you said") and its date.
function readSources(doc, ctx, add, kind) {
  const ids = new Map();
  const sec = sectionOf(doc.scan, 'Sources');
  if (!sec) return ids;
  const t = tableIn(doc, 'Sources');
  if (!t) {
    add({ code: `${kind}-sources`, line: sec.h.line, column: 1, reason: '"Sources" has no table', hint: 'add | ID | Source | Where | Date |, one row per source' });
    return ids;
  }
  if (SOURCE_COLUMNS.some((c) => !t.columns.includes(c))) add({ code: `${kind}-sources`, line: t.line, column: 1, reason: 'the Sources table needs the columns ID, Source, Where and Date', hint: 'use | ID | Source | Where | Date |' });
  for (const p of t.problems) add({ code: `${kind}-sources`, line: p.line, column: 1, reason: p.reason });
  for (const row of t.rows) {
    const id = row.cells.id?.trim() ?? '';
    const at = { line: row.line, column: 1 };
    if (!/^S-[0-9]+$/.test(id)) {
      add({ code: `${kind}-sources`, ...at, reason: `a Sources row has no ID: "${clip(id || row.cells.source)}"`, hint: 'start the row with its ID, S-1, S-2 …' });
      continue;
    }
    if (ids.has(id)) {
      add({ code: `${kind}-sources`, ...at, reason: `${id} is in the Sources table twice`, hint: `first on line ${ids.get(id).line}; keep one row per source` });
      continue;
    }
    ids.set(id, { line: row.line, used: false });
    if (!row.cells.source?.trim()) add({ code: `${kind}-sources`, ...at, reason: `${id} doesn't say what the source is`, hint: 'name it in "Source": a page, a file, a talk with you' });
    const whereRaw = (row.raw.where ?? '').trim();
    const where = (row.cells.where ?? '').trim();
    const said = /^you said$/i.test(where);
    const link = /^https?:\/\/\S+$/i.test(where) || /^\[[^\]]+\]\((?:https?:\/\/)?[^)\s]+\)$/.test(whereRaw);
    const span = /^`([^`]+)`$/.exec(whereRaw);
    const file = span ? repoPath(span[1]) : null;
    if (!said && !link && !file) {
      add({ code: `${kind}-sources`, ...at, reason: `${id} has no link, file or "you said"`, hint: 'put a link, a file path in backticks from the repo\'s top folder, or "you said" in "Where"' });
    } else if (file && ctx.repo && !ctx.repo.exists(file)) {
      add({ code: `${kind}-sources`, ...at, reason: `${id}'s file ${clip(file)} doesn't exist`, hint: 'correct the path, from the repo\'s top folder' });
    }
    if (!realDate(row.cells.date)) {
      add({ code: `${kind}-sources`, ...at, reason: `${id} has no date${said ? ' for when you said it' : ''}`, hint: `write ${said ? 'the day you said it' : 'the day it was read'} in "Date", as YYYY-MM-DD` });
    }
  }
  return ids;
}

// Every S-n mentioned outside the Sources table must be one of its rows; a row nothing cites is a
// warning.
function citeSources(doc, ids, add, kind) {
  const sec = sectionOf(doc.scan, 'Sources');
  for (const l of doc.scan.lines) {
    if (l.kind !== 'text' && l.kind !== 'heading') continue;
    if (sec && l.line > sec.h.line && l.line < sec.end) continue;
    for (const m of (l.text ?? '').matchAll(S_ID)) {
      const row = ids.get(m[0]);
      if (row) row.used = true;
      else add({ code: `${kind}-source`, line: l.line, column: 1, reason: `${m[0]} isn't in the Sources table`, hint: `add a row for ${m[0]} under "Sources", or cite a source that's there` });
    }
  }
  for (const [id, row] of ids) {
    if (!row.used) add({ code: `${kind}-source`, severity: 'warning', line: row.line, column: 1, reason: `${id} isn't cited anywhere`, hint: 'cite it where it supports a claim, or remove its row' });
  }
}

// An open line (decision 8): while writing, a warning that names the question to ask you; at
// approval, a failure, so a file with a gap can't be approved.
function openLine(kind, line, text, ctx, add) {
  if (ctx.approving) add({ code: `${kind}-open`, line, column: 1, reason: `an open line can't be approved: "${clip(text)}"`, hint: 'answer it: write the answer with its source (a "you said" row with the date), or remove the line' });
  else add({ code: `${kind}-open`, severity: 'warning', line, column: 1, reason: `no source says this yet: "${clip(text)}"`, hint: 'ask the person, and write their answer with a "you said" source and its date' });
}

// A context file in .mirai/context/ has its kind's name (project-<service>.md for a service).
function checkName(doc, def, ctx, add) {
  const file = String(ctx.file ?? '');
  if (!file.startsWith(`${CONTEXT_DIR}/`)) return;
  const kind = CONTEXT_KINDS.find((k) => k.type === def.name);
  if (!kind) return;
  const service = typeof doc.value.service === 'string' ? doc.value.service : '<service>';
  const want = kind.file.replace('{service}', service);
  const name = file.slice(CONTEXT_DIR.length + 1);
  if (name !== want) add({ code: 'context-name', line: 1, column: 1, reason: `a ${def.name} file in ${CONTEXT_DIR}/ is named ${want}`, hint: `rename it to ${CONTEXT_DIR}/${want}${kind.file.includes('{service}') ? ', or correct "service"' : ''}` });
}

// ---- business.md ---------------------------------------------------------------------------

export function checkBusiness(doc, def, ctx, add) {
  checkName(doc, def, ctx, add);
  const { scan } = doc;
  const ids = readSources(doc, ctx, add, 'business');
  const sec = sectionAt(scan);
  const title = scan.headings.find((h) => h.level === 1);
  const first = scan.headings.find((h) => h.level === 2);
  // Every claim is a bullet that ends with its sources.
  for (const b of blocks(scan, first ? first.line - 1 : title?.line ?? 0, Infinity)) {
    const name = sec(b.line);
    if (name === null || name === 'Sources') continue;
    if (b.kind === 'text') {
      if (NOT_APPLICABLE.test(b.text)) continue;
      add({ code: 'business-claim', line: b.line, column: 1, reason: `a claim that isn't a bullet: "${clip(b.text)}"`, hint: 'write each claim as a bullet that ends with its source, such as (S-1)' });
      continue;
    }
    if (OPEN.test(b.text)) openLine('business', b.line, b.text, ctx, add);
    else if (!SOURCE_IDS.test(b.text)) add({ code: 'business-source', line: b.line, column: 1, reason: `this bullet has no source: "${clip(b.text)}"`, hint: 'end it with the ID of its source in the Sources table, such as (S-1), or (S-1, S-3); if no source says it, end it with (open) and ask the person' });
  }
  citeSources(doc, ids, add, 'business');
  // About two pages (decision 3): the Sources table isn't counted.
  const cap = ctx.project?.limits?.[`${def.name}_words`] ?? def.document_words;
  const warnAt = ctx.project?.limits?.[`${def.name}_warn_words`] ?? def.document_warn_words;
  if (cap) {
    const n = documentWords(doc, def);
    const at = { line: title?.line ?? doc.bodyLine, column: 1 };
    if (n > cap) add({ code: 'business-length', ...at, reason: `business.md has ${n} words; the cap is ${cap}, the Sources table not counted`, hint: 'agents load it on every run: keep what they need to judge a feature, and leave the detail in the linked sources' });
    else if (warnAt && n > warnAt) add({ code: 'business-length', severity: 'warning', ...at, reason: `business.md has ${n} words, past ${warnAt} (the cap is ${cap})`, hint: 'about two pages is the target: move detail to the linked sources' });
  }
}

// ---- journeys.md ---------------------------------------------------------------------------

const JOURNEY = /^J-([0-9]+):[ \t]+\S/;

export function checkJourneys(doc, def, ctx, add) {
  checkName(doc, def, ctx, add);
  const { scan } = doc;
  const ids = readSources(doc, ctx, add, 'journeys');
  const sec = sectionOf(scan, 'Journeys');
  // The screens the feature map beside it names, when it can be read.
  let screens = null;
  const map = ctx.readDocument ? ctx.readDocument('feature-map.md') : { problem: 'unavailable' };
  if (map && !map.problem && map.value?.type === 'feature-map') {
    const t = tableIn(map, 'Screens');
    if (t) screens = new Set(t.rows.map((r) => (r.cells.screen ?? '').trim().toLowerCase()).filter(Boolean));
  }
  if (sec) {
    const heads = scan.headings.filter((h) => h.level === 3 && h.line > sec.h.line && h.line < sec.end);
    if (!heads.length) add({ code: 'journeys-id', line: sec.h.line, column: 1, reason: 'no journeys yet', hint: 'add each critical journey as ### J-1: <what the person gets done>' });
    let expected = 1;
    const seen = new Set();
    heads.forEach((h, i) => {
      const m = JOURNEY.exec(h.text);
      if (!m) {
        add({ code: 'journeys-id', line: h.line, column: 1, reason: `the journey "${clip(h.text)}" has no J-n ID`, hint: `name it ### J-${expected}: ${clip(h.text.replace(/^J-[0-9]*:?\s*/, ''))}` });
        // It takes its place in the numbering, so the next journey isn't reported too.
        expected += 1;
        return;
      }
      const n = Number(m[1]);
      const id = `J-${n}`;
      if (seen.has(n)) add({ code: 'journeys-id', line: h.line, column: 1, reason: `${id} is used twice`, hint: 'each journey has its own ID; renumber the second' });
      else if (n !== expected) add({ code: 'journeys-id', line: h.line, column: 1, reason: `${id} should be J-${expected}: journeys run J-1, J-2, J-3 … with no gap`, hint: `renumber it J-${expected}, and the ones after it` });
      seen.add(n);
      expected = Math.max(expected, n + 1);
      const end = Math.min(heads[i + 1]?.line ?? Infinity, sec.end, scan.headings.find((x) => x.line > h.line && x.level <= 3)?.line ?? Infinity);
      checkJourney(id, h, end, { scan, screens, ctx, add });
    });
  }
  citeSources(doc, ids, add, 'journeys');
}

function checkJourney(id, h, end, { scan, screens, ctx, add }) {
  const lines = scan.lines.filter((l) => l.line > h.line && l.line < end && l.kind === 'text');
  const at = { line: h.line, column: 1 };
  const label = (re) => lines.find((l) => re.test(textOf(l).trim()));
  // Steps: "Steps:", then a list, one action per item.
  const stepsLine = label(/^Steps:\s*$/);
  const steps = stepsLine ? blocks(scan, stepsLine.line, end).filter((b) => b.kind === 'item') : [];
  const firstOther = stepsLine ? blocks(scan, stepsLine.line, end).findIndex((b) => b.kind !== 'item') : -1;
  const own = firstOther === -1 ? steps : steps.filter((s) => s.line < blocks(scan, stepsLine.line, end)[firstOther].line);
  if (!own.length) add({ code: 'journeys-steps', ...at, reason: `${id} has no steps`, hint: 'add "Steps:" and a numbered list: one action per step, each screen in bold as the feature map names it' });
  // Screens named in the steps, in bold, are the feature map's.
  if (screens) {
    for (const s of own) {
      for (const m of s.text.matchAll(/\*\*([^*]+)\*\*/g)) {
        if (!screens.has(m[1].trim().toLowerCase())) add({ code: 'journeys-screen', severity: 'warning', line: s.line, column: 1, reason: `${id}'s step names the screen "${clip(m[1], 40)}", which isn't in the feature map`, hint: 'use the name the feature map gives the screen, or add the screen to feature-map.md' });
      }
    }
  }
  const why = label(/^Why critical:/);
  const whyText = why ? textOf(why).trim().replace(/^Why critical:\s*/, '') : '';
  if (!why || whyText === '') add({ code: 'journeys-why', ...(why ? { line: why.line, column: 1 } : at), reason: `${id} has no "Why critical:" line`, hint: 'say who is stopped, or what money is lost, when it breaks, and end with its source, such as (S-1)' });
  else if (OPEN.test(whyText)) openLine('journeys', why.line, `${id}: ${whyText}`, ctx, add);
  else if (!SOURCE_IDS.test(whyText)) add({ code: 'journeys-source', line: why.line, column: 1, reason: `${id}'s "Why critical:" line has no source`, hint: 'end it with the ID of its source in the Sources table, such as (S-1); if no source says it, end it with (open) and ask the person' });
  const e2e = label(/^E2E test:/);
  if (!e2e) {
    add({ code: 'journeys-e2e', ...at, reason: `${id} has no "E2E test:" line`, hint: 'name its end-to-end test file from the repo\'s top folder, in backticks, or write "E2E test: none yet"' });
    return;
  }
  const value = textOf(e2e).trim().replace(/^E2E test:\s*/, '');
  if (/^none yet\.?$/i.test(value)) return;
  const span = /^`([^`]+)`\.?$/.exec(value);
  const path = span ? repoPath(span[1]) : null;
  if (!path) add({ code: 'journeys-e2e', line: e2e.line, column: 1, reason: `${id}'s "E2E test:" isn't a file or "none yet": "${clip(value, 40)}"`, hint: 'write the test file\'s path in backticks, from the repo\'s top folder, or "none yet"' });
  else if (ctx.repo && ctx.repo.exists(path) !== 'file') add({ code: 'journeys-e2e', line: e2e.line, column: 1, reason: `${id}'s E2E test ${clip(path)} doesn't exist`, hint: 'correct the path, from the repo\'s top folder, or write "none yet" until the test is written' });
}

// ---- feature-map.md ------------------------------------------------------------------------

// The ARIA roles a screen's handle may name (WAI-ARIA 1.2's widget, structure and landmark roles
// a test finds elements by), plus `label` for a labelled field (getByLabel).
export const ROLES = new Set(['alert', 'alertdialog', 'article', 'banner', 'button', 'cell', 'checkbox', 'columnheader', 'combobox', 'complementary', 'contentinfo', 'dialog', 'document', 'feed', 'figure', 'form', 'grid', 'gridcell', 'group', 'heading', 'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'meter', 'navigation', 'note', 'option', 'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem', 'label']);

// A handle as the feature map writes it: { kind: 'testid' | <role>, value }, or null.
export function parseHandle(text) {
  const t = String(text).trim();
  const id = /^data-testid="([^"]+)"$/.exec(t);
  if (id) return { kind: 'testid', value: id[1] };
  const role = /^([a-z]+) "([^"]+)"$/.exec(t);
  if (role) return { kind: role[1], value: role[2] };
  return null;
}
// The fixed parts of a handle or route: "task-<id>" → ["task-"], "/tasks/:id" → ["/tasks/"].
const fixedOf = (value) => value.split(/<[^<>]*>|\{[^{}]*\}|:[A-Za-z_][A-Za-z0-9_]*|\*/).map((s) => s.trim() ? s : '').filter(Boolean);
const found = (sources, parts) => parts.length > 0 && sources.some((f) => parts.every((p) => f.text.includes(p)));
// A handle is found only as a whole (review of 36, 2026-11-20: a plain substring let `data-testid="e"`
// match any file with an "e"). A test id's value starts right after a quote, and a fixed value also
// ends at one; a role's name is a whole string or an element's whole text.
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function handleFound(sources, h) {
  const parts = fixedOf(h.value);
  if (!parts.length) return false;
  const whole = parts.length === 1 && parts[0] === h.value;
  let re;
  if (h.kind === 'testid') re = new RegExp(`["'\`]${esc(parts[0])}${whole ? `["'\`]` : ''}`);
  // A role's name is a string or an element's text: it starts after a quote or ">" and, when
  // fixed, ends at a quote or "<" (`<button>Add</button>`, `aria-label="Tasks"`).
  else re = new RegExp(`["'\`>]\\s*${esc(parts[0])}${whole ? `\\s*["'\`<]` : ''}`);
  return sources.some((f) => re.test(f.text) && parts.slice(1).every((q) => f.text.includes(q)));
}

export function checkFeatureMap(doc, def, ctx, add) {
  checkName(doc, def, ctx, add);
  const sec = sectionOf(doc.scan, 'Screens');
  if (!sec) return;
  const t = tableIn(doc, 'Screens');
  if (!t) {
    add({ code: 'feature-map-table', line: sec.h.line, column: 1, reason: '"Screens" has no table', hint: 'add | Screen | Route | Handles |, one row per screen' });
    return;
  }
  if (['screen', 'route', 'handles'].some((c) => !t.columns.includes(c))) add({ code: 'feature-map-table', line: t.line, column: 1, reason: 'the Screens table needs the columns Screen, Route and Handles', hint: 'use | Screen | Route | Handles |' });
  for (const p of t.problems) add({ code: 'feature-map-table', line: p.line, column: 1, reason: p.reason });
  const code = Array.isArray(doc.value.code) ? doc.value.code.filter((c) => typeof c === 'string') : [];
  let sources = null;
  if (ctx.repo) {
    const codeAt = doc.positions?.get('code');
    for (const c of code) {
      const p = repoPath(c);
      if (p === null || ctx.repo.exists(p) !== 'dir') add({ code: 'feature-map-code', line: codeAt?.line ?? 1, column: 1, reason: `the code folder ${clip(c)} doesn't exist`, hint: 'list the folders that hold the screens\' code, from the repo\'s top folder' });
    }
    sources = ctx.repo.sources(code);
  }
  const where = code.join(', ');
  const names = new Map();
  for (const row of t.rows) {
    const at = { line: row.line, column: 1 };
    const screen = (row.cells.screen ?? '').trim();
    if (!screen) add({ code: 'feature-map-table', ...at, reason: 'a row has no screen name', hint: 'name the screen as people call it, such as "Tasks"' });
    else if (names.has(screen.toLowerCase())) add({ code: 'feature-map-table', ...at, reason: `the screen "${clip(screen, 40)}" is listed twice`, hint: `first on line ${names.get(screen.toLowerCase())}; one row per screen` });
    else names.set(screen.toLowerCase(), row.line);
    // The route: `/path`, its parameters as :id or <id>.
    const routeRaw = (row.raw.route ?? '').trim();
    const route = /^`(\/[^`]*)`$/.exec(routeRaw)?.[1];
    if (!route) add({ code: 'feature-map-route', ...at, reason: `${screen || 'the row'}'s route isn't a path such as \`/tasks\`: "${clip(routeRaw, 40)}"`, hint: 'write the route in backticks, starting with /' });
    else if (sources && route !== '/' && !found(sources, fixedOf(route))) add({ code: 'feature-map-route', severity: 'warning', ...at, reason: `the route ${clip(route, 40)} isn't in the code under ${where}`, hint: 'a route built at run time can\'t be found: check it by hand, or correct it' });
    // The handles: data-testid="…", or a role and its accessible name.
    const spans = [...(row.raw.handles ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (!spans.length) add({ code: 'feature-map-handle', ...at, reason: `${screen || 'the row'} has no handles`, hint: 'list how a test finds the screen\'s parts, each in backticks: button "Save", or data-testid="task-list"' });
    for (const s of spans) {
      const h = parseHandle(s);
      if (!h) {
        add({ code: 'feature-map-handle', ...at, reason: `"${clip(s, 40)}" isn't a handle MIRAI reads`, hint: 'write data-testid="<id>", or a role and its name: button "Log in", label "Email"' });
        continue;
      }
      if (h.kind !== 'testid' && !ROLES.has(h.kind)) {
        add({ code: 'feature-map-handle', ...at, reason: `"${h.kind}" in "${clip(s, 40)}" isn't an ARIA role`, hint: 'use a role such as button, link, heading, textbox, checkbox, form or list; label "<text>" for a labelled field' });
        continue;
      }
      if (sources && !handleFound(sources, h)) add({ code: 'feature-map-handle', ...at, reason: `${s} isn't in the code under ${where}`, hint: 'correct it to the handle the code has, or add it to the code in the same ticket; a part that changes is written <like-this>' });
    }
  }
}

// ---- project-<service>.md ------------------------------------------------------------------

const PATH_LIKE = /^(?![@-])[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)*\/?$/;
// A host name, not a path (36's P2 on Thudos: `api.thudos.test` was checked as a file): no slash,
// and it ends in a top-level domain no file is named with.
const HOST_LIKE = /^\.?(?:[A-Za-z0-9-]+\.)+(?:test|local|localhost|internal|example|invalid|com|org|net|io|dev|app|de|eu)$/i;
const spansIn = (text) => [...String(text ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());

// The scripts a command runs, by the stacks' [[scripts]] data: [{ script, rule }].
export function scriptsRun(command, stacks) {
  const words = command.split(/\s+/).filter(Boolean);
  const out = [];
  for (const stack of Object.values(stacks ?? {})) {
    for (const rule of stack.scripts ?? []) {
      const at = rule.command.indexOf('{script}');
      const before = rule.command.slice(0, at);
      for (let i = 0; i + before.length < words.length; i++) {
        if (!before.every((w, k) => words[i + k] === w)) continue;
        const script = words[i + before.length];
        if (rule.names && !rule.names.includes(script)) continue;
        if (/^[-&|;<>]/.test(script)) continue;
        out.push({ script, rule });
      }
    }
  }
  // One per script and manifest: `npm run x` matches the run form only.
  const seen = new Set();
  return out.filter((o) => {
    const k = `${o.rule.file} ${o.script}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function checkProject(doc, def, ctx, add) {
  checkName(doc, def, ctx, add);
  if (!ctx.repo) return;
  const root = repoPath(doc.value.root);
  const rootAt = doc.positions?.get('root');
  if (typeof doc.value.root === 'string' && (root === null || ctx.repo.exists(root) !== 'dir')) {
    add({ code: 'project-path', line: rootAt?.line ?? 1, column: 1, reason: `the service's folder ${clip(doc.value.root)} doesn't exist`, hint: 'set root to the service\'s folder, from the repo\'s top folder ("." for the top folder)' });
    return;
  }
  const checkPath = (p, line) => {
    if (!PATH_LIKE.test(p) || HOST_LIKE.test(p) || !/\/|\.[A-Za-z][A-Za-z0-9]*$/.test(p)) return;
    const n = repoPath(p);
    if (n === null || !ctx.repo.exists(n)) add({ code: 'project-path', line, column: 1, reason: `${clip(p)} doesn't exist`, hint: 'correct the path, from the repo\'s top folder, or remove the line' });
  };
  const checkCommand = (c, line) => {
    for (const { script, rule } of scriptsRun(c, ctx.registry?.stacks)) {
      const manifest = root === '.' ? rule.file : `${root}/${rule.file}`;
      const text = ctx.repo.text(manifest);
      let scripts = null;
      try {
        scripts = text === null ? null : JSON.parse(text)?.[rule.field];
      } catch {
        scripts = null;
      }
      if (text === null) add({ code: 'project-command', line, column: 1, reason: `"${clip(c)}" runs a script, but ${manifest} doesn't exist`, hint: 'correct the command, or set root to the folder that holds the manifest' });
      else if (!scripts || typeof scripts !== 'object' || !Object.hasOwn(scripts, script)) add({ code: 'project-command', line, column: 1, reason: `"${clip(c)}": ${manifest} has no script "${clip(script, 40)}"`, hint: scripts && typeof scripts === 'object' ? `its scripts are: ${Object.keys(scripts).slice(0, 12).join(', ') || 'none'}` : `add it to "${rule.field}" in ${manifest}, or correct the command` });
    }
  };
  // Paths: the Layout table's Path column, the Stack table's "Set in" column, and the code spans
  // in Instructions. Commands: the Commands and Test levels tables' Command column.
  for (const [section, column] of [['Layout', 'path'], ['Stack', 'set in']]) {
    for (const row of tableIn(doc, section)?.rows ?? []) for (const s of spansIn(row.raw[column])) checkPath(s, row.line);
  }
  const inst = sectionOf(doc.scan, 'Instructions');
  if (inst) {
    for (const l of doc.scan.lines) {
      if (l.kind === 'text' && l.line > inst.h.line && l.line < inst.end) for (const s of spansIn(textOf(l))) if (!/\s/.test(s)) checkPath(s, l.line);
    }
  }
  for (const section of ['Commands', 'Test levels']) {
    for (const row of tableIn(doc, section)?.rows ?? []) for (const s of spansIn(row.raw.command)) checkCommand(s, row.line);
  }
}

// ---- conventions-<service>.md --------------------------------------------------------------

const TAG = /\((enforced by[ \t]+`?([^`)]*?)`?|judgment)\)\.?[ \t]*$/i;
// Words in a check's command that are runners, not the tool (`npm run lint` → "lint").
const RUNNERS = new Set(['npm', 'npx', 'pnpm', 'yarn', 'bun', 'run', 'run-script', 'exec', 'composer', 'php', 'node', 'python', 'python3', 'bundle', 'go', 'cargo', 'docker', 'compose', 'sh', 'bash', 'make', 'uv', 'poetry', 'pipx', 'artisan', 'vendor', 'bin', 'test', 'tests', 'check', 'dlx']);
export function toolWords(argv) {
  const out = new Set();
  for (const a of Array.isArray(argv) ? argv : []) {
    if (typeof a !== 'string' || a.startsWith('-')) continue;
    const base = a.split('/').at(-1);
    if (/^[A-Za-z][A-Za-z0-9_.-]{1,40}$/.test(base) && !RUNNERS.has(base.toLowerCase())) out.add(base.toLowerCase());
  }
  return [...out];
}

export function checkConventions(doc, def, ctx, add) {
  checkName(doc, def, ctx, add);
  const sec = sectionOf(doc.scan, 'Rules');
  if (!sec) return;
  const checks = ctx.repo && ctx.project?.checks && typeof ctx.project.checks === 'object' ? ctx.project.checks : null;
  const rules = blocks(doc.scan, sec.h.line, sec.end, { nested: true });
  for (const b of rules) {
    if (b.kind === 'text') {
      if (/:\s*$/.test(b.text) || NOT_APPLICABLE.test(b.text)) continue;
      add({ code: 'conventions-rule', line: b.line, column: 1, reason: `a rule that isn't a bullet: "${clip(b.text)}"`, hint: 'write each rule as a bullet, tagged (enforced by <check>) or (judgment)' });
      continue;
    }
    // The rule is the item's own lines; an example is a line (or a nested item) starting "Example:".
    const own = [];
    let example = false;
    for (const l of b.lines) {
      const raw = textOf(l).trim().replace(LIST_ITEM, '');
      if (/^Example:/.test(raw) || (example && l !== b.lines[0])) example = true;
      else own.push(l === b.lines[0] ? textOf(l).trim().replace(LIST_ITEM, '') : raw);
    }
    const head = own.join(' ').trim();
    const tag = TAG.exec(head);
    if (!tag) {
      add({ code: 'conventions-tag', line: b.line, column: 1, reason: `this rule has no tag: "${clip(head)}"`, hint: 'end it with (enforced by <check>), naming a check in .mirai/config.toml, or with (judgment) and an example' });
      continue;
    }
    if (/^enforced by/i.test(tag[1])) {
      const name = tag[2].trim();
      if (!name) add({ code: 'conventions-check', line: b.line, column: 1, reason: '"enforced by" names no check', hint: 'name the check, as [checks] in .mirai/config.toml names it' });
      else if (checks && !Object.hasOwn(checks, name)) add({ code: 'conventions-check', line: b.line, column: 1, reason: `"${clip(name, 40)}" isn't a named check in the config`, hint: `the named checks are: ${Object.keys(checks).join(', ') || 'none yet'}; add it to [checks] in .mirai/config.toml, or tag the rule (judgment)` });
      continue;
    }
    if (!example) add({ code: 'conventions-example', severity: 'warning', line: b.line, column: 1, reason: `this judgment rule has no example: "${clip(head)}"`, hint: 'add an indented line under it, "Example: …", with a short case from this code' });
    if (checks) {
      const words = head.toLowerCase();
      for (const [name, argv] of Object.entries(checks)) {
        const tool = toolWords(argv).find((w) => new RegExp(`(?<![\\p{L}\\p{N}_-])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_-])`, 'u').test(words));
        if (tool) {
          add({ code: 'conventions-repeat', severity: 'warning', line: b.line, column: 1, reason: `this rule repeats the check "${name}" (${clip(argv.join(' '), 40)}) as prose`, hint: `the check already enforces it: write one line, (enforced by ${name}), or cut the rule` });
          break;
        }
      }
    }
  }
  if (!rules.some((b) => b.kind === 'item')) add({ code: 'conventions-rule', line: sec.h.line, column: 1, reason: 'no rules yet', hint: 'add each rule as a bullet, tagged (enforced by <check>) or (judgment)' });
}
