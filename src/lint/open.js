import { assumptionsOf } from './interview.js';

// `(open)` in a brief or a PRD (unit 44, decision 4; 36's decision 8 extended). A decision only the
// owner can make is never answered by the author: she writes `(open)` where the answer goes, with
// the question and where it's asked:
//   Tax rules apply for (open) — EU only, or EU and US? Asked in interview.md Q-7.
// The lint warns on each, naming the question; at approval it's an error, listed with its Q-n.
// "Leave it open and accept it" (decision 5) turns it into a reference to the document's own Open
// questions line, `(Q-7)`, with that line marked "Accepted open (<who>, <date>)".

const OPEN = /\(open\)/i;
const QREF = /\bQ-([0-9]{1,4})\b/;

// The `(open)` marks in the document's text (outside code and comments): [{ line, question }],
// `question` the Q-n the line names, or null.
export function openMarks(doc) {
  const out = [];
  for (const l of doc.scan.lines) {
    if (l.kind !== 'text') continue;
    const t = l.visible ?? l.text;
    if (!OPEN.test(t)) continue;
    const q = QREF.exec(t.slice(t.search(OPEN)));
    out.push({ line: l.line, question: q ? `Q-${Number(q[1])}` : null, text: t.trim() });
  }
  return out;
}

export function checkOpenMarks(doc, ctx, add, kind) {
  for (const m of openMarks(doc)) {
    const what = m.question ? `asked in interview.md ${m.question}` : 'it names no question';
    if (ctx.approving) add({ code: `${kind}-open-decision`, line: m.line, column: 1, reason: `an (open) decision can't be approved (${what})`, hint: m.question ? `answer ${m.question} in your session; the author writes the answer in (or, to leave it open, accept it: it then points to the Open questions line instead)` : 'name the question it waits for: "(open) — <the question>? Asked in interview.md Q-n."' });
    else add({ code: `${kind}-open-decision`, severity: 'warning', line: m.line, column: 1, reason: `(open): a decision waiting for the owner, ${what}`, hint: m.question ? `it blocks approval until ${m.question} is answered` : 'name the question it waits for: "(open) — <the question>? Asked in interview.md Q-n."' });
  }
}

// An Open questions line the owner accepted as open (decision 5): "Accepted open (Jet, 2026-11-22)".
export const ACCEPTED_OPEN = /\bAccepted open \([^)]*\b[0-9]{4}-[0-9]{2}-[0-9]{2}\)/;

// ---- The look-ahead's assumptions in the PRD (unit 44, item 3) ---------------------------------
// The interview's approved assumptions are answers. The PRD carries each one under its own
// Assumptions with the same number, saying it was approved in the interview ("A-2: … Approved in
// the interview."), so a requirement that rests on it cites (A-2) as today (32's prd-trace). Its own
// guesses come after them. The lint checks the carry, when the interview is beside the PRD.
const PRD_ASSUMPTION = /^ *[-*+][ \t]+(?:\*\*)?A-([0-9]+)(?:\*\*)?:[ \t]*(.*)$/;
export function checkCarriedAssumptions(doc, ctx, add) {
  const found = ctx.readDocument ? ctx.readDocument('interview.md') : { problem: 'unavailable' };
  if (!found || found.problem || found.value?.type !== 'interview' || !found.scan) return;
  // The templates' own samples (the interview template's A-1 beside the PRD template's): not a carry.
  if (found.value.id === 'initiative-interview') return;
  const approved = assumptionsOf(found).filter((a) => a.ok);
  if (!approved.length) return;
  const own = new Map();
  for (const l of doc.scan.lines) {
    if (l.kind !== 'text') continue;
    const m = PRD_ASSUMPTION.exec(l.text);
    if (m) own.set(`A-${Number(m[1])}`, { line: l.line, text: m[2] });
  }
  const top = { line: doc.scan.headings.find((h) => h.level === 2 && h.text === 'Assumptions')?.line ?? doc.bodyLine ?? 1, column: 1 };
  for (const a of approved) {
    const p = own.get(a.id);
    if (!p) add({ code: 'prd-interview-assumption', ...top, reason: `${a.id}, approved in the interview ("${a.text.slice(0, 80)}"), isn't under Assumptions as ${a.id}`, hint: `carry it with the same number: "${a.id}: ${a.corrected ?? a.text} Approved in the interview." Your own guesses come after the interview's` });
    else if (!/\binterview\b/i.test(p.text)) add({ code: 'prd-interview-assumption', line: p.line, column: 1, reason: `${a.id} is the interview's approved assumption ("${a.text.slice(0, 80)}"), but this line doesn't say so`, hint: `end it with "Approved in the interview.", and number your own guesses after the interview's` });
  }
}
