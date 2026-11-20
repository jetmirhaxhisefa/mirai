// The interview's own lint (unit 35; Jet's decisions 2026-11-20). The record of an interview
// (`mirai-interview`) is interview.md beside the brief. What the generic rules can't say:
// - each question (### Q-n) has lettered options ("- A: …"), a guess naming one of them with its
//   reason ("Guess: A, because …"), and an answer ("Answer: …"); "explain" and "pause" aren't
//   answers;
// - questions run Q-1, Q-2, Q-3 … with no gap;
// - `state: confirmed` needs every question answered, the restatement's six lines ("Not
//   included" holds something, or "None." with a reason) and "Confirmed: yes (YYYY-MM-DD)";
// - a "Confirmed:" line that isn't an explicit yes fails ("sounds good" isn't one);
// - `state: open` or `paused` fails, naming the open questions: an unfinished interview never
//   passes the lint, so the brief beside it can't be approved (src/lint/brief.js).

export const RESTATEMENT = Object.freeze(['Outcome', 'Who it\'s for', 'Why now', 'Success', 'Limits', 'Not included']);
const OPTION = /^[-*+][ \t]+(?:\*\*)?([A-Z])(?:\*\*)?:[ \t]*(\S.*)?$/;
const GUESS = /^Guess:[ \t]*(?:\*\*)?([A-Z])?(?:\*\*)?\b[ \t,.:;—-]*(.*)$/;
const ANSWER = /^Answer:[ \t]*(.*)$/;
const CONFIRMED = /^Confirmed:[ \t]*(.*)$/;
const YES = /^yes\b[ \t]*(?:\(([^)]*)\))?\.?[ \t]*$/i;
const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const NOT_ANSWERS = /^(explain|pause|draft it)\.?$/i;
const QUESTION = /^(?:\*\*)?Q-([0-9]+)(?:\*\*)?(?::|[ \t]+—[ \t])/;

const textOf = (l) => (l.visible ?? l.text).trim().replace(/’/g, '\'');

// The interview's questions, in order: [{ id, n, line, options: [{ letter, line }], guess,
// answer }]; `guess` and `answer` are { text, letter?, line } or null.
export function questionsOf(doc) {
  const { scan } = doc;
  const section = sectionOf(scan, 'Questions');
  if (!section) return [];
  const heads = scan.headings.filter((h) => h.level === 3 && h.line > section.h.line && h.line < section.end);
  const out = [];
  heads.forEach((h, i) => {
    const m = QUESTION.exec(h.text);
    if (!m) return;
    const end = Math.min(heads[i + 1]?.line ?? Infinity, section.end, scan.headings.find((x) => x.line > h.line && x.level <= 3)?.line ?? Infinity);
    const q = { id: `Q-${m[1]}`, n: Number(m[1]), line: h.line, options: [], guess: null, answer: null };
    for (const l of scan.lines) {
      if (l.line <= h.line || l.line >= end || l.kind !== 'text') continue;
      const t = textOf(l);
      const o = OPTION.exec(t);
      if (o) {
        q.options.push({ letter: o[1], line: l.line });
        continue;
      }
      const g = GUESS.exec(t);
      if (g && !q.guess) {
        q.guess = { letter: g[1] ?? null, reason: g[2].trim(), line: l.line };
        continue;
      }
      const a = ANSWER.exec(t);
      if (a && !q.answer) q.answer = { text: a[1].trim(), line: l.line };
    }
    out.push(q);
  });
  return out;
}

const answered = (q) => Boolean(q.answer && q.answer.text !== '' && !NOT_ANSWERS.test(q.answer.text));

// The questions still open: no answer, an empty one, or "explain" or "pause".
export function openQuestions(doc) {
  return questionsOf(doc).filter((q) => !answered(q)).map((q) => q.id);
}

// "Q-3", "Q-3 and Q-4", "Q-2, Q-3 and Q-5".
export const listed = (ids) => (ids.length <= 1 ? ids.join('') : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`);

export function checkInterview(doc, def, ctx, add) {
  const { scan, value, positions } = doc;
  const title = scan.headings.find((h) => h.level === 1);
  const top = { line: title?.line ?? doc.bodyLine, column: 1 };
  const stateAt = positions?.get('state') ? { line: positions.get('state').line, column: 1 } : top;
  const questions = questionsOf(doc);

  // ---- Each question -----------------------------------------------------------------------
  questions.forEach((q, i) => {
    const at = { line: q.line, column: 1 };
    if (q.n !== i + 1) add({ code: 'interview-numbering', ...at, reason: `${q.id} should be Q-${i + 1}: questions run Q-1, Q-2, Q-3 … with no gap`, hint: 'renumber the questions, and every mention of them' });
    if (q.options.length < 2) add({ code: 'interview-options', ...at, reason: `${q.id} has ${q.options.length ? 'only one option' : 'no options'}`, hint: 'list two or three lettered options under it: "- A: …", "- B: …"' });
    if (!q.guess) add({ code: 'interview-guess', ...at, reason: `${q.id} has no guess`, hint: 'add "Guess: A, because …": the option you expect the owner to pick, and why' });
    else if (!q.guess.letter || (q.options.length && !q.options.some((o) => o.letter === q.guess.letter))) add({ code: 'interview-guess', line: q.guess.line, column: 1, reason: `${q.id}'s guess doesn't name one of its options`, hint: `start it with the option's letter: Guess: ${q.options[0]?.letter ?? 'A'}, because …` });
    else if (q.guess.reason.split(/\s+/).filter(Boolean).length < 2) add({ code: 'interview-guess', line: q.guess.line, column: 1, reason: `${q.id}'s guess has no reason`, hint: `say why: Guess: ${q.guess.letter}, because …` });
    if (!answered(q)) {
      const said = q.answer && q.answer.text !== '' ? ` ("${q.answer.text}" isn't an answer)` : '';
      add({ code: 'interview-answer', line: q.answer?.line ?? q.line, column: 1, reason: `${q.id} isn't answered${said}`, hint: q.answer ? 'ask it in the session and write the owner\'s reply after "Answer:"' : 'add an "Answer:" line under it, with the owner\'s reply' });
    }
  });

  // ---- The state -----------------------------------------------------------------------------
  const restatement = sectionOf(scan, 'Restatement');
  const lines = restatement ? scan.lines.filter((l) => l.kind === 'text' && l.line > restatement.h.line && l.line < restatement.end) : [];
  const confirmedLine = lines.find((l) => CONFIRMED.test(textOf(l)));
  const open = questions.filter((q) => !answered(q)).map((q) => q.id);
  const state = value.state;
  if (state === 'open' || state === 'paused') {
    const yes = confirmedLine && YES.test(CONFIRMED.exec(textOf(confirmedLine))[1]);
    add({
      code: 'interview-state', ...stateAt,
      reason: open.length ? `the interview is ${state}: ${listed(open)} ${open.length === 1 ? 'is' : 'are'} open` : `the interview is ${state}${yes ? ', but the restatement says "Confirmed: yes"' : ', with no question left open'}`,
      hint: open.length ? 'answer them in the session, then confirm the restatement' : yes ? 'set state: confirmed' : 'write the restatement, get the owner\'s explicit "yes", then set state: confirmed',
    });
  }

  // ---- The restatement and the yes ------------------------------------------------------------
  if (confirmedLine) {
    const said = CONFIRMED.exec(textOf(confirmedLine))[1].trim();
    const at = { line: confirmedLine.line, column: 1 };
    const yes = YES.exec(said);
    if (!yes) add({ code: 'interview-yes', ...at, reason: `"Confirmed: ${said}" isn't a yes`, hint: 'only an explicit "yes" closes the interview: ask once more, naming the choice, and write Confirmed: yes (YYYY-MM-DD) when the owner says it' });
    else if (!yes[1]) add({ code: 'interview-yes', ...at, reason: '"Confirmed: yes" has no date', hint: 'write the day the owner said yes: Confirmed: yes (YYYY-MM-DD)' });
    else if (!realDate(yes[1].trim())) add({ code: 'interview-yes', ...at, reason: `"${yes[1]}" isn't a real date`, hint: 'write it as YYYY-MM-DD: Confirmed: yes (2026-11-19)' });
  }
  if (state !== 'confirmed') return;
  const where = { line: restatement?.h.line ?? top.line, column: 1 };
  for (const label of RESTATEMENT) {
    const re = new RegExp(`^[-*+][ \\t]+(?:\\*\\*)?${label}:(?:\\*\\*)?[ \\t]*(.*)$`, 'i');
    const l = lines.find((x) => re.test(textOf(x)));
    if (!l) {
      add({ code: 'interview-restatement', ...where, reason: `the restatement has no "${label}" line`, hint: `add "- ${label}: …"; the six lines are ${RESTATEMENT.join(', ')}` });
      continue;
    }
    const text = re.exec(textOf(l))[1].trim();
    if (!text) add({ code: 'interview-restatement', line: l.line, column: 1, reason: `the restatement's "${label}" line is empty`, hint: label === 'Not included' ? 'name what is left out, or write: None. <why nothing is left out>' : `say it in one line, in the owner's words` });
    else if (label === 'Not included' && /^none\b[.:;,—-]*$/i.test(text)) add({ code: 'interview-restatement', line: l.line, column: 1, reason: '"Not included" says None with no reason', hint: 'write: None. <why nothing is left out>; half of all misunderstandings are about what isn\'t built' });
  }
  if (!confirmedLine) add({ code: 'interview-yes', ...where, reason: 'a confirmed interview needs "Confirmed: yes (YYYY-MM-DD)" under the restatement', hint: 'add it when the owner says "yes" to the restatement, with that day\'s date' });
}

function sectionOf(scan, name) {
  const h = scan.headings.find((x) => x.level === 2 && x.text === name);
  if (!h) return null;
  const next = scan.headings.find((x) => x.line > h.line && x.level <= 2);
  return { h, end: next?.line ?? Infinity };
}

function realDate(text) {
  const m = DATE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d);
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
