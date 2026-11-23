import { checkVerifyFindings } from '../findings/verdicts.js';

// Vera's findings (unit 40, Scope 2; unit 44's decision 3). Each finding has a grade (`must-fix`
// or `suggestion`), a layer (`checklist`, `top-vs-detail`, `context`), `where` (the file, the line
// and the exact quoted text), `against` for a context finding (the context file and its line or
// source ID), `what` and `fix` in one sentence each, and `kind` (`writing` or `decision`) with
// `kind_reason`, a decision with its `decision_type`. The schema is registry/schemas/
// verify-findings.json; the rules it can't say are checkVerifyFindings's.
//
// MIRAI checks every quote by text match, as 34 does (whitespace and line breaks normalized,
// nothing else): a finding whose quote isn't in its file is dropped and logged, never shown. A
// reply that isn't the schema records nothing.

export const GRADES = Object.freeze(['must-fix', 'suggestion']);
export const LAYERS = Object.freeze(['checklist', 'top-vs-detail', 'context']);
export const KINDS = Object.freeze(['writing', 'decision']);
export const DECISION_TYPES = Object.freeze(['scope', 'audience', 'money-legal', 'number', 'conflict', 'trade-off', 'other', 'invented']);

const ZWSP = /​/g;
export const normal = (s) => String(s ?? '').replace(ZWSP, '').replace(/\s+/g, ' ').trim();

// The text with whitespace runs collapsed to one space, and for each character of it the line
// (1-based) it came from: { text, lineAt }.
function indexed(text) {
  const src = String(text).replace(/\r\n?/g, '\n').replace(ZWSP, '');
  let out = '';
  const lineAt = [];
  let line = 1;
  let space = false;
  for (const ch of src) {
    if (/\s/.test(ch)) {
      if (!space && out.length) {
        out += ' ';
        lineAt.push(line);
      }
      space = true;
    } else {
      out += ch;
      lineAt.push(line);
      space = false;
    }
    if (ch === '\n') line++;
  }
  return { text: out, lineAt };
}

// Where `quote` is in `text`: the line its nearest occurrence starts on (nearest to `near`), or
// null when it isn't there.
export function quoteLine(text, quote, near = 1) {
  const q = normal(quote);
  if (!q) return null;
  const { text: t, lineAt } = indexed(text);
  let best = null;
  for (let at = t.indexOf(q); at >= 0; at = t.indexOf(q, at + 1)) {
    const line = lineAt[at];
    if (best === null || Math.abs(line - near) < Math.abs(best - near)) best = line;
  }
  return best;
}

// The grade MIRAI holds her to (P2's first run, 2026-11-23: Sonnet graded a money-legal decision
// the approver wasn't shown, and a context contradiction, as suggestions). Decision 5's must-fix
// covers anything that contradicts the context, and a decision the top part hides: so a `context`
// finding, and a decision of these types, is a must-fix whatever grade she gave. Her own grade is
// kept beside it (`vera_grade`). The other rules of her list (an upstream commitment dropped, a
// builder left asking) need judgement, and stay hers.
export const MUST_FIX_TYPES = Object.freeze(['scope', 'audience', 'money-legal', 'conflict', 'invented']);
export function regraded(f) {
  if (f.grade === 'must-fix') return f;
  // P2's third run: a top-vs-detail finding graded suggestion (the summary claimed more than FR-36
  // held); decision 5 makes a top part that hides or adds something must-fix, which is that layer.
  const rule = f.layer === 'context' ? 'a context finding' : f.layer === 'top-vs-detail' ? 'a top-vs-detail finding' : f.kind === 'decision' && MUST_FIX_TYPES.includes(f.decision_type) ? `a ${f.decision_type} decision` : null;
  return rule ? { ...f, grade: 'must-fix', vera_grade: f.grade, graded_by: rule } : f;
}

// Vera's result from the launch's structured output: { findings, dropped } or { problem }.
// `files`: the input files by name, { name: { text, path?, checked } }. A finding's `where` must
// be in a file she checks (the document, an epic's ticket), and `against` in one she was given
// as data (an upstream document or a context file). Each kept finding gets `where.path` (the
// file in the project) and its line as MIRAI found the quote; each dropped one is listed with why.
// Jet, 2026-11-23 (P1's first run, "B"): a reply that isn't the schema's shape (not an object, no
// `findings` list, another key, more than the schema allows) records nothing; a finding that breaks
// a rule of the schema on its own (a `context` finding without `against`, a bad grade, an id used
// twice) is dropped and logged, as a finding whose quote isn't in its file is, and the others count.
const shown = (v) => (typeof v === 'string' ? normal(v).slice(0, 200) : '');
export function findingsFrom(structured, files) {
  if (structured === null || typeof structured !== 'object' || Array.isArray(structured)) return { problem: 'the run\'s structured output has no findings' };
  const list = structured.findings;
  if (!Array.isArray(list)) return { problem: 'the findings don\'t match MIRAI\'s schema: / has no findings list' };
  const shape = checkVerifyFindings(JSON.stringify({ ...structured, findings: [] }));
  if (!shape.ok) return { problem: `the findings don't match MIRAI's schema: ${shape.problems.slice(0, 3).map((p) => `${p.path} ${p.reason}`).join('; ')}` };
  if (list.length > 100) return { problem: 'the findings don\'t match MIRAI\'s schema: /findings has more than 100 items' };
  const findings = [];
  const dropped = [];
  // P2's second run: a dropped finding keeps its `what`, so a lost must-fix is visible in the
  // dropped list (never counted, never shown as a finding).
  const drop = (f, why) => dropped.push({ id: typeof f?.id === 'string' ? f.id.slice(0, 64) : '?', why, quote: shown(f?.where?.quote), ...(typeof f?.what === 'string' ? { what: shown(f.what) } : {}) });
  const valid = [];
  const ids = new Set();
  list.forEach((raw, i) => {
    const c = checkVerifyFindings(JSON.stringify({ findings: [raw] }));
    if (!c.ok) {
      drop(raw, `it breaks the schema: ${c.problems.slice(0, 2).map((p) => `${p.path.replace('/findings/0', `/findings/${i}`)} ${p.reason}`).join('; ')}`);
      return;
    }
    const f = c.value.findings[0];
    // `decision_type` is required, `none` for a writing finding (P2's second run: a decision without
    // one was lost); the record keeps a type only for a decision.
    if (f.decision_type === 'none') delete f.decision_type;
    if (ids.has(f.id)) {
      drop(f, 'its id is used by an earlier finding');
      return;
    }
    ids.add(f.id);
    valid.push(f);
  });
  for (const f of valid) {
    const own = Object.hasOwn(files, f.where.file) ? files[f.where.file] : null;
    if (!own?.checked) {
      drop(f, `${f.where.file} isn't a file the verifier checks here`);
      continue;
    }
    const line = quoteLine(own.text, f.where.quote, f.where.line);
    if (line === null) {
      drop(f, `its quote isn't in ${f.where.file}`);
      continue;
    }
    const out = { ...f, where: { ...f.where, line, path: own.path ?? f.where.file } };
    if (f.against) {
      // Any file she was given: a context file, an upstream document, or the document itself (or an
      // epic's ticket) for a contradiction inside it (P2's second run: `against: document.md`).
      const other = Object.hasOwn(files, f.against.file) ? files[f.against.file] : null;
      if (!other) {
        drop(f, `${f.against.file} isn't a file she was given`);
        continue;
      }
      if (f.against.quote !== undefined && quoteLine(other.text, f.against.quote, f.against.line ?? 1) === null) {
        drop(f, `its quote of ${f.against.file} isn't there`);
        continue;
      }
      out.against = { ...f.against, path: other.path ?? f.against.file };
      // A `context` finding is one against a context file; against anything else it's a checklist
      // finding (a contradiction inside the document, or with its upstream), her layer kept.
      if (f.layer === 'context' && !/^context-/.test(f.against.file)) Object.assign(out, { layer: 'checklist', vera_layer: 'context' });
    }
    findings.push(regraded(out));
  }
  return { findings, dropped };
}

export const mustFix = (findings) => findings.filter((f) => f.grade === 'must-fix');
export const suggestions = (findings) => findings.filter((f) => f.grade === 'suggestion');

// One finding as lines for you: grade, layer and kind, where, the quote, what and fix.
export function findingLines(f) {
  const kind = f.kind === 'decision' ? `decision: ${f.decision_type}` : 'writing';
  const out = [`  ${f.grade}  ${f.id}  ${f.layer}, ${kind}  ${f.where.path ?? f.where.file}:${f.where.line}`];
  out.push(`        "${normal(f.where.quote).slice(0, 200)}"`);
  if (f.against) out.push(`        against ${f.against.path ?? f.against.file}${f.against.line ? `:${f.against.line}` : ''}${f.against.source ? ` (${f.against.source})` : ''}${f.against.quote ? `: "${normal(f.against.quote).slice(0, 160)}"` : ''}`);
  out.push(`        ${f.what}`, `        fix: ${f.fix}`);
  return out;
}
