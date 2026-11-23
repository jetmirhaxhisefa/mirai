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

// Vera's result from the launch's structured output: { findings, dropped } or { problem }.
// `files`: the input files by name, { name: { text, path?, checked } }. A finding's `where` must
// be in a file she checks (the document, an epic's ticket), and `against` in one she was given
// as data (an upstream document or a context file). Each kept finding gets `where.path` (the
// file in the project) and its line as MIRAI found the quote; each dropped one is listed with why.
export function findingsFrom(structured, files) {
  if (structured === null || typeof structured !== 'object' || Array.isArray(structured)) return { problem: 'the run\'s structured output has no findings' };
  const c = checkVerifyFindings(JSON.stringify(structured));
  if (!c.ok) return { problem: `the findings don't match MIRAI's schema: ${c.problems.slice(0, 3).map((p) => `${p.path} ${p.reason}`).join('; ')}` };
  const findings = [];
  const dropped = [];
  const drop = (f, why) => dropped.push({ id: f.id, why, quote: normal(f.where.quote).slice(0, 200) });
  for (const f of c.value.findings) {
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
      const other = Object.hasOwn(files, f.against.file) ? files[f.against.file] : null;
      if (!other || other.checked) {
        drop(f, `${f.against.file} isn't an upstream document or context file she was given`);
        continue;
      }
      if (f.against.quote !== undefined && quoteLine(other.text, f.against.quote, f.against.line ?? 1) === null) {
        drop(f, `its quote of ${f.against.file} isn't there`);
        continue;
      }
      out.against = { ...f.against, path: other.path ?? f.against.file };
    }
    findings.push(out);
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
