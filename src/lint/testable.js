import { VAGUE } from './words.js';

// The testability lint for a ticket's acceptance criteria (unit 42, Scope 3; the roadmap's "an AC
// nobody could test fails the lint"). Each AC (AC-<key>.n under "## Acceptance criteria") is a
// "Given … when … then …" criterion, or a plain sentence whose outcome can be observed. Its
// outcome (the "then" part, or the whole sentence) names no vague word without a number: the
// writing lint's vague words, plus the ones below. A system-facing AC ("the log entries in GCP
// use the structure in ADR-12") passes: the reviewer can read it. Vera's checklist keeps the
// judgement: could the reviewer test it with what the ticket says?

export const UNTESTABLE = Object.freeze([...VAGUE, 'reliably', 'properly', 'correctly', 'as expected', 'appropriately', 'smoothly', 'seamlessly', 'quickly']);
export const TESTABLE_HINT = 'say what the reviewer sees: a value, a screen, a record, a log line';

const SECTION = 'Acceptance criteria';
const AC = /^\s*[-*+][ \t]+(?:\*\*)?(AC-[A-Za-z0-9._-]+\.[0-9]+)(?:\*\*)?(?::|[ \t]+—[ \t])?[ \t]*(.*)$/;
const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The ticket's ACs: [{ id, line, name, text }].
export function acceptanceCriteria(doc, def) {
  const { scan } = doc;
  const name = def?.renames?.[SECTION] ?? SECTION;
  const h = scan.headings.find((x) => x.level === 2 && x.text === name);
  if (!h) return [];
  const end = scan.headings.find((x) => x.line > h.line && x.level <= 2)?.line ?? Infinity;
  const out = [];
  for (const l of scan.lines) {
    if (l.line <= h.line || l.line >= end || l.kind !== 'text') continue;
    const t = (l.visible ?? l.text).replace(/’/g, '\'');
    const m = AC.exec(t);
    if (m) {
      out.push({ id: m[1], line: l.line, name: m[2].trim(), body: '' });
      continue;
    }
    // A sub-line (Given / When / Then) or a wrapped line belongs to the AC above; a line that
    // isn't indented closes it ("These deliver … from the PRD").
    const last = out.at(-1);
    if (last && !last.closed && /^\s+\S/.test(t)) last.body += ` ${t.trim().replace(/^[-*+][ \t]+/, '')}`;
    else if (last) last.closed = true;
  }
  // The criterion's text: its sub-lines (Given / When / Then, or a plain sentence) when it has any,
  // else the bullet's own words after its ID.
  return out.map(({ closed, name, body, ...a }) => ({ ...a, name, text: body.trim() || name }));
}

// The outcome a reviewer checks: what follows the last "then", else the whole criterion.
export function outcomeOf(text) {
  const m = /(?:^|[\s,;])then\b[\s:,]*((?:(?!(?:^|[\s,;])then\b).)*)$/is.exec(text);
  return (m ? m[1] : text).trim();
}

// One criterion's text against the rule: the reason it fails, or null.
export function untestableReason(id, text) {
  const outcome = outcomeOf(text);
  if (!outcome) return `${id} says nothing a reviewer could observe`;
  if (/[0-9]/.test(outcome)) return null;
  const vague = UNTESTABLE.find((w) => new RegExp(`(?<![\\w-])${escape(w)}(?![\\w-])`, 'i').test(outcome));
  return vague ? `${id}'s outcome "${outcome.slice(0, 80)}" says "${vague}" with no number: nobody could test it` : null;
}

// The problems: [{ code, line, column, reason, hint }].
export function testabilityProblems(doc, def) {
  const out = [];
  for (const ac of acceptanceCriteria(doc, def)) {
    const reason = untestableReason(ac.id, ac.text);
    if (reason) out.push({ code: 'ac-untestable', line: ac.line, column: 1, reason, hint: TESTABLE_HINT });
  }
  return out;
}

// The PRD's ACs (unit 42, P2's first run, Jet's "A", 2026-11-24): the same rule on every AC-FR-n.m
// and AC-NFR-n.m, wherever it is defined, so a vague AC can't reach approval and then Tess. A bullet
// with no ID under an AC (indented below it, or beside it in the same list) is part of that AC and
// is held to the rule on its own: a vague line can't hide beside a testable one.
const PRD_AC = /^(\s*)[-*+][ \t]+(?:\*\*)?(AC-N?FR-[0-9]+\.[0-9]+)(?:\*\*)?(?::|[ \t]+—[ \t])?[ \t]*(.*)$/;
const BULLET = /^(\s*)[-*+][ \t]+(.*)$/;
const REQUIREMENT = /^(?:\*\*)?(?:N?FR|AC-N?FR)-[0-9]/;

export function prdTestabilityProblems(doc) {
  const out = [];
  let ac = null;
  for (const l of doc.scan.lines) {
    if (l.kind === 'heading') {
      ac = null;
      continue;
    }
    if (l.kind !== 'text') continue;
    const t = (l.visible ?? l.text).replace(/’/g, '\'');
    const m = PRD_AC.exec(t);
    if (m) {
      ac = { id: m[2], indent: m[1].length };
      const reason = untestableReason(m[2], m[3].trim());
      if (reason) out.push({ code: 'prd-ac-untestable', line: l.line, column: 1, reason, hint: TESTABLE_HINT });
      continue;
    }
    const b = BULLET.exec(t);
    if (!ac || !b) {
      if (!/^\s+\S/.test(t)) ac = null; // a plain line not indented ends the list
      continue;
    }
    if (b[1].length < ac.indent || REQUIREMENT.test(b[2])) {
      ac = null;
      continue;
    }
    const reason = untestableReason(`${ac.id} (its line "${b[2].trim().slice(0, 60)}")`, b[2].trim());
    if (reason) out.push({ code: 'prd-ac-untestable', line: l.line, column: 1, reason, hint: TESTABLE_HINT });
  }
  return out;
}
