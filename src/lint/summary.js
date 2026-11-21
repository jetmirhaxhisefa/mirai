import { SUMMARY_PARTS, SUMMARY_SECTION } from '../config/registry.js';
import { linkLinesOf } from './rules.js';

// The summary for approval (unit 31; PM-03, research/13 §9a): the same five parts at the top of
// every document type that lists the `summary` check. It's written for the approver, last, from
// the finished detail, and says nothing the detail doesn't hold.
//
// What this check owns: the summary's place and its five parts, "The ask", and that open
// questions, proposed ADRs and non-goals reach the summary. An ID in the summary that the detail
// doesn't define is the generic ID rule's `unknown-id` (rules.js). Numbers only warn (Jet's
// decision 3, 2026-11-19), until they've been seen on real documents.

export { SUMMARY_PARTS };
export const ASK_WORDS = 30;
const ASK_START = /^(Approve|Decide|Note)\b/;
const ID_TOKEN = /\b[A-Z][A-Z0-9]{0,15}-[0-9][0-9A-Za-z.-]*\b/g;

// The summary's lines and parts, read from the scan: { h2, end, parts: [{ heading, lines }],
// lines } or null when the document has no summary section.
export function summaryOf(scan) {
  const h2s = scan.headings.filter((h) => h.level === 2);
  const h2 = h2s.find((h) => h.text === SUMMARY_SECTION);
  if (!h2) return null;
  const end = h2s.find((h) => h.line > h2.line)?.line ?? Infinity;
  const lines = scan.lines.filter((l) => l.line > h2.line && l.line < end);
  const h3s = scan.headings.filter((h) => h.level === 3 && h.line > h2.line && h.line < end);
  const parts = h3s.map((heading, i) => {
    const stop = h3s[i + 1]?.line ?? end;
    return { heading, lines: lines.filter((l) => l.line > heading.line && l.line < stop) };
  });
  return { h2, end, parts, lines };
}

const words = (text) => (String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’.%-]*/gu) ?? []).length;
const prose = (lines) => lines.filter((l) => l.kind === 'text').map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim();

export function checkSummary(doc, def, ctx, add) {
  const { scan } = doc;
  const s = summaryOf(scan);
  if (!s) return; // the missing section is the generic section rule's (required_sections)

  // Right after the title: nothing that renders between the # title and the summary.
  const title = scan.headings.find((h) => h.level === 1);
  if (title) {
    // Unit 32: the line linking the upstream document ("Brief: [title](brief.md)") may sit there;
    // unit 33: the type's link lines, such as an epic's "PRD:" and "Design:".
    const rendered = scan.lines.filter((l) => l.line > title.line && l.line < s.h2.line && (l.kind === 'text' || l.kind === 'fence' || l.kind === 'heading'));
    const linkLines = new Set(linkLinesOf(scan, def).map((f) => f.line));
    const between = rendered.find((l) => !linkLines.has(l.line));
    if (between) add({ code: 'summary', line: between.line, column: 1, reason: `text sits between the # title and "## ${SUMMARY_SECTION}"`, hint: 'the summary comes right after the title; move this text into the detail' });
  }

  // The five parts, in order, each with something in it.
  const names = s.parts.map((p) => p.heading.text);
  for (const name of SUMMARY_PARTS) {
    if (!names.includes(name)) add({ code: 'summary-part', line: s.h2.line, column: 1, reason: `the summary has no "### ${name}"`, hint: `add "### ${name}" in this order: ${SUMMARY_PARTS.join(', ')}` });
  }
  for (const p of s.parts) {
    if (!SUMMARY_PARTS.includes(p.heading.text)) add({ code: 'summary-part', line: p.heading.line, column: p.heading.column, reason: `"### ${p.heading.text}" is not one of the summary's parts`, hint: `the parts are: ${SUMMARY_PARTS.join(', ')}; anything else belongs in the detail` });
  }
  const known = names.filter((n) => SUMMARY_PARTS.includes(n));
  const expected = SUMMARY_PARTS.filter((n) => known.includes(n));
  if (known.join('\n') !== expected.join('\n')) {
    const p = s.parts.find((x, i) => SUMMARY_PARTS.includes(x.heading.text) && known[i] !== expected[i]) ?? s.parts[0];
    add({ code: 'summary-order', line: p.heading.line, column: 1, reason: `the summary's parts are out of order (${known.join(', ')})`, hint: `put them in this order: ${SUMMARY_PARTS.join(', ')}` });
  }
  const before = s.lines.find((l) => (l.kind === 'text' || l.kind === 'fence') && l.line < (s.parts[0]?.heading.line ?? s.end));
  if (before) add({ code: 'summary', line: before.line, column: 1, reason: `text before "### ${SUMMARY_PARTS[0]}" isn't in any part`, hint: 'put it in one of the five parts' });
  for (const p of s.parts) {
    if (SUMMARY_PARTS.includes(p.heading.text) && !p.lines.some((l) => l.kind === 'text' || l.kind === 'fence')) {
      add({ code: 'summary-empty', line: p.heading.line, column: 1, reason: `"### ${p.heading.text}" is empty`, hint: p.heading.text === 'Decisions for you' ? 'list the decisions, or write: None — <why nothing needs your call>' : 'fill it from the finished detail' });
    }
  }

  // The ask: the bottom line first, one sentence.
  const ask = s.parts.find((p) => p.heading.text === 'The ask');
  if (ask) {
    const text = prose(ask.lines);
    const first = ask.lines.find((l) => l.kind === 'text');
    if (text && !ASK_START.test(text)) add({ code: 'summary-ask', line: first.line, column: 1, reason: `"The ask" starts "${clip(text, 40)}"`, hint: 'start with Approve, Decide or Note: what you ask the approver to do' });
    if (words(text) > ASK_WORDS) add({ code: 'summary-ask', line: first.line, column: 1, reason: `"The ask" has ${words(text)} words, more than ${ASK_WORDS}`, hint: 'one sentence: what is approved and the outcome it buys; the reasons go in "Why"' });
  }

  // What the summary must show: every open question and proposed ADR under "Decisions for you",
  // and the non-goals under "Not in this", both ways.
  const detail = scan.lines.filter((l) => l.line >= s.end || l.line < s.h2.line);
  const decisions = s.parts.find((p) => p.heading.text === 'Decisions for you');
  const notIn = s.parts.find((p) => p.heading.text === 'Not in this');
  const idsIn = (lines) => new Set(lines.filter((l) => l.kind === 'text' || l.kind === 'heading').flatMap((l) => l.text.match(ID_TOKEN) ?? []));
  const definedIn = (prefix) => {
    const out = [];
    const re = new RegExp(`^ *(?:[-*+]|[0-9]{1,9}[.)]|\\|)?[ \\t]*(?:\\*\\*)?(${prefix}-[0-9]+)(?:\\*\\*)?(?::|[ \\t]+—[ \\t]|[ \\t]*\\|)`);
    for (const l of detail) {
      if (l.kind !== 'text' && l.kind !== 'heading') continue;
      const m = re.exec(l.text.replace(/^ {0,3}#{1,6}[ \t]+/, ''));
      if (m) out.push({ id: m[1], line: l.line });
    }
    return out;
  };
  if (decisions) {
    const shown = idsIn(decisions.lines);
    for (const q of definedIn('Q')) {
      if (!shown.has(q.id)) add({ code: 'summary-decision', line: q.line, column: 1, reason: `the open question ${q.id} isn't under "Decisions for you"`, hint: `add it there with its options and your recommendation, or answer it in the detail and remove ${q.id}` });
    }
    for (const l of detail) {
      if (l.kind !== 'text' || !/\bproposed\b/i.test(l.text)) continue;
      for (const adr of l.text.match(/\bADR-[0-9]+\b/g) ?? []) {
        if (!shown.has(adr)) add({ code: 'summary-decision', line: l.line, column: 1, reason: `the proposed ${adr} isn't under "Decisions for you"`, hint: 'a proposed decision is yours to take: list it there' });
      }
    }
  }
  // Unit 32 (Jet's decision 7): on `standard` the PRD's summary is the one you read for both
  // documents, so the brief's open questions and no-gos reach it too.
  const up = ctx.upstream?.status === 'ok' && ctx.upstream.def.name === 'brief' && doc.value.track === 'standard' ? ctx.upstream : null;
  if (up) {
    const upName = up.def.name;
    const where = { line: s.h2.line, column: 1 };
    const shownDecisions = idsIn(decisions?.lines ?? []);
    for (const id of up.ids.get('Q')?.keys() ?? []) {
      if (!shownDecisions.has(id)) add({ code: 'summary-decision', ...where, reason: `the ${upName}'s open question ${id} isn't under "Decisions for you"`, hint: `on standard you approve both documents here: add ${id} with its options and your recommendation, or answer it in the ${upName}` });
    }
    const shownNotIn = idsIn(notIn?.lines ?? []);
    for (const id of up.ids.get('NG')?.keys() ?? []) {
      if (!shownNotIn.has(id)) add({ code: 'summary-not-in', ...where, reason: `the ${upName}'s non-goal ${id} isn't under "Not in this"`, hint: `on standard this summary covers both documents: add ${id} with its reason` });
    }
  }
  if (notIn) {
    const shown = idsIn(notIn.lines);
    const defined = definedIn('NG');
    for (const ng of defined) {
      if (!shown.has(ng.id)) add({ code: 'summary-not-in', line: ng.line, column: 1, reason: `the non-goal ${ng.id} isn't under "Not in this"`, hint: `add it there with its reason` });
    }
    for (const l of notIn.lines) {
      if (l.kind === 'text' && /^ *[-*+] /.test(l.text) && !/\bNG-[0-9]+\b/.test(l.text)) add({ code: 'summary-not-in', line: l.line, column: 1, reason: `"${clip(l.text.replace(/^ *[-*+] /, ''), 60)}" has no NG-n`, hint: 'define it as a non-goal in the detail and end the bullet with its (NG-n)' });
    }
  }

  // Numbers (warn): a number the summary states that the detail doesn't.
  const detailText = detail.filter((l) => l.kind === 'text' || l.kind === 'heading' || l.kind === 'fence').map((l) => (l.visible ?? l.text)).join('\n').replace(ID_TOKEN, ' ');
  // Unit 32: a number may come from the upstream document (a PRD's summary quotes the brief).
  const upText = ctx.upstream?.status === 'ok' ? ctx.upstream.doc.scan.lines.filter((l) => l.kind === 'text' || l.kind === 'heading' || l.kind === 'fence').map((l) => (l.visible ?? l.text)).join('\n').replace(ID_TOKEN, ' ') : '';
  const detailNumbers = new Set([...(detailText.match(NUMBER) ?? []), ...(upText.match(NUMBER) ?? [])]);
  // Unit 32 (decision 5): the length-exception item gives the word count and the cap, which the
  // lint computes rather than the detail stating; that line's numbers aren't checked.
  const exception = typeof doc.value?.length_exception === 'string' && doc.value.length_exception.trim() !== '';
  for (const l of s.lines) {
    if (l.kind !== 'text') continue;
    if (exception && /\bwords\b/.test(l.text) && /\bcap\b/.test(l.text)) continue;
    const text = l.text.replace(ID_TOKEN, ' ').replace(/^ *(?:[-*+]|[0-9]{1,9}[.)])[ \t]+/, '');
    for (const n of text.match(NUMBER) ?? []) {
      if (!detailNumbers.has(n)) add({ code: 'summary-number', severity: 'warning', line: l.line, column: 1, reason: `the summary says ${n}, which the detail doesn't`, hint: 'every number in the summary comes from the detail; add its source there, or correct it' });
    }
  }
}

const NUMBER = /(?<![\p{L}\p{N}_.-])[0-9](?:[0-9,]*[0-9])?(?:\.[0-9]+)?%?(?![\p{L}\p{N}_])/gu;
export const clip = (text, n = 80) => {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
