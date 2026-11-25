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

// Unit 42 (decision 2): a ticket asked for by hand gets a short interview.
export const TICKET_QUESTION_CAP = 3;
export const RESTATEMENT =Object.freeze(['Outcome', 'Who it\'s for', 'Why now', 'Success', 'Limits', 'Not included']);
const OPTION = /^[-*+][ \t]+(?:\*\*)?([A-Z])(?:\*\*)?:[ \t]*(\S.*)?$/;
const GUESS = /^Guess:[ \t]*(?:\*\*)?([A-Z])?(?:\*\*)?\b[ \t,.:;—-]*(.*)$/;
const ANSWER = /^Answer:[ \t]*(.*)$/;
const CONFIRMED = /^Confirmed:[ \t]*(.*)$/;
const YES = /^yes\b[ \t]*(?:\(([^)]*)\))?\.?[ \t]*$/i;
const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const NOT_ANSWERS = /^(explain|pause|draft it)\.?$/i;
const QUESTION = /^(?:\*\*)?Q-([0-9]+)(?:\*\*)?(?::|[ \t]+—[ \t])/;

const textOf = (l) => (l.visible ?? l.text).trim().replace(/’/g, '\'');

// The interview's questions, in order: [{ id, n, line, options: [{ letter, line, text }], guess,
// answer, finding, kind, answerType }]; `guess` and `answer` are { text, letter?, line } or null.
// Unit 44: a question from a verifier finding carries `Finding:`, `Kind:` and, once answered,
// `Answer type:` (each { text, line } or null). `section` and `prefix`: the intake's questions
// (`## Intake`, `### I-n`) are read the same way.
export function questionsOf(doc, { section: name = 'Questions', prefix = 'Q' } = {}) {
  const { scan } = doc;
  const section = sectionOf(scan, name);
  if (!section) return [];
  const heads = scan.headings.filter((h) => h.level === 3 && h.line > section.h.line && h.line < section.end);
  const re = prefix === 'Q' ? QUESTION : INTAKE_QUESTION;
  const out = [];
  heads.forEach((h, i) => {
    const m = re.exec(h.text);
    if (!m) return;
    const end = Math.min(heads[i + 1]?.line ?? Infinity, section.end, scan.headings.find((x) => x.line > h.line && x.level <= 3)?.line ?? Infinity);
    const q = { id: `${prefix}-${m[1]}`, n: Number(m[1]), line: h.line, end, options: [], guess: null, answer: null, finding: null, kind: null, answerType: null };
    for (const l of scan.lines) {
      if (l.line <= h.line || l.line >= end || l.kind !== 'text') continue;
      const t = textOf(l);
      const o = OPTION.exec(t);
      if (o) {
        q.options.push({ letter: o[1], line: l.line, text: (o[2] ?? '').trim() });
        continue;
      }
      const g = GUESS.exec(t);
      if (g && !q.guess) {
        q.guess = { letter: g[1] ?? null, reason: g[2].trim(), line: l.line };
        continue;
      }
      const at = ANSWER_TYPE.exec(t);
      if (at && !q.answerType) {
        q.answerType = { text: at[1].trim(), line: l.line };
        continue;
      }
      const a = ANSWER.exec(t);
      if (a && !q.answer) {
        q.answer = { text: a[1].trim(), line: l.line };
        continue;
      }
      const fi = FINDING.exec(t);
      if (fi && !q.finding) {
        q.finding = { text: fi[1].trim(), line: l.line, ...findingRef(fi[1]) };
        continue;
      }
      const k = KIND.exec(t);
      if (k && !q.kind) q.kind = { text: k[1].trim(), line: l.line };
    }
    out.push(q);
  });
  return out;
}

// ---- Unit 44: questions from a verifier finding -------------------------------------------------
// A decision the verifier found goes to the owner as an interview question (decisions 3–5). Its
// lines: `Finding: <finding id> (<fingerprint>): "<the quote>"`, `Kind: <decision type>`, and once
// answered `Answer type: answered | vera-wrong | not-a-decision | left-open`. The four answers are
// always its options: one or more answers in the owner's words, then "Vera is wrong", "not a
// decision, just fix it" and "leave it open and accept it" (the persona's name may differ: the
// option is read by its words "is wrong").
export const ANSWER_TYPES = Object.freeze(['answered', 'vera-wrong', 'not-a-decision', 'left-open']);
export const FINDING_KINDS = Object.freeze(['scope', 'audience', 'money-legal', 'number', 'conflict', 'trade-off', 'other', 'invented', 'reopen']);
const FINDING = /^Finding:[ \t]*(.*)$/;
const KIND = /^Kind:[ \t]*(.*)$/;
const ANSWER_TYPE = /^Answer type:[ \t]*(.*)$/;
const FINGERPRINT = /\((fp-[0-9a-f]{16})\)/;
function findingRef(text) {
  const fp = FINGERPRINT.exec(text)?.[1] ?? null;
  const id = /^([A-Za-z0-9][A-Za-z0-9._-]{0,63})\b/.exec(text.trim())?.[1] ?? null;
  return { fingerprint: fp, findingId: id };
}
// The answer type an option's words stand for: the three fixed options by their words, else an answer.
export function answerTypeOfOption(text) {
  const t = String(text ?? '').toLowerCase();
  if (/\bis wrong\b/.test(t)) return 'vera-wrong';
  if (/not a decision/.test(t)) return 'not-a-decision';
  if (/leave it open/.test(t)) return 'left-open';
  return 'answered';
}
// A question's answer type: its `Answer type:` line, else the one its chosen option stands for, or
// null while it's open.
export function answerTypeOf(q) {
  if (q.answerType && ANSWER_TYPES.includes(q.answerType.text)) return q.answerType.text;
  if (!q.answer?.text) return null;
  const letter = /^(?:\*\*)?([A-Z])(?:\*\*)?\b/.exec(q.answer.text)?.[1];
  const o = letter ? q.options.find((x) => x.letter === letter) : null;
  return o ? answerTypeOfOption(o.text) : 'answered';
}

// ---- Unit 44: the look-ahead's assumptions (Jet, 2026-11-25: Q3 "a mix of B and A", Q4 "A") ------
// Before the restatement, the interview reads the PRD's checklist and, for each item the answers
// leave open, asks (a shaky guess) or assumes (a confident one). The assumptions are one numbered
// list under `## Assumptions`, approved together with "ok" or corrected by number:
//   - A-1: <what is assumed>. Source: <business.md, the code, Q-n>. Approved: yes
//   - A-2: <…>. Source: <…>. Approved: corrected: <the owner's words>
// An assumption not approved ("Approved:" empty or missing) blocks a confirmed interview.
const ASSUMPTION = /^[-*+][ \t]+(?:\*\*)?A-([0-9]+)(?:\*\*)?:[ \t]*(.*)$/;
const APPROVED = /\bApproved:[ \t]*(.*?)\.?[ \t]*$/;
const SOURCE = /\bSource:[ \t]*(.+?)\.?[ \t]+Approved:|\bSource:[ \t]*(.+?)\.?[ \t]*$/;
export function assumptionsOf(doc) {
  const section = sectionOf(doc.scan, 'Assumptions');
  if (!section) return [];
  const out = [];
  for (const l of doc.scan.lines) {
    if (l.line <= section.h.line || l.line >= section.end || l.kind !== 'text') continue;
    const m = ASSUMPTION.exec(textOf(l));
    if (!m) continue;
    const rest = m[2];
    const ap = APPROVED.exec(rest);
    const approved = ap && ap[1].trim() !== '' ? ap[1].trim() : null;
    const ok = approved !== null && (/^yes$/i.test(approved) || /^corrected:\s*\S/i.test(approved));
    out.push({ id: `A-${m[1]}`, n: Number(m[1]), line: l.line, text: rest.slice(0, [rest.search(/\bSource:/), ap ? ap.index : -1].filter((x) => x >= 0).reduce((m, x) => Math.min(m, x), rest.length)).trim(), source: (() => { const m = SOURCE.exec(rest); return m ? (m[1] ?? m[2]).trim() : null; })(), approved, ok, corrected: ok && /^corrected:/i.test(approved) ? approved.replace(/^corrected:\s*/i, '') : null });
  }
  return out;
}

// ---- Unit 44: the intake (/mirai-new, /mirai-prd; decision 10) ---------------------------------
// At most 2 intake questions (### I-n, in the questions' format), then the track the session
// proposed with its reason, and the owner's yes to it:
//   Track: standard, because a new screen and a new rule; no new service.
//   Track confirmed: yes (2026-11-25)
export const INTAKE_QUESTION_CAP = 2;
export const TRACKS = Object.freeze(['quick', 'standard', 'full']);
const INTAKE_QUESTION = /^(?:\*\*)?I-([0-9]+)(?:\*\*)?(?::|[ \t]+—[ \t])/;
const TRACK = /^Track:[ \t]*([a-z]+)\b[ \t,.:;—-]*(.*)$/;
const TRACK_CONFIRMED = /^Track confirmed:[ \t]*(.*)$/;
// The intake: null when the interview has none, else { line, questions, track, reason, trackLine,
// confirmed: { text, line } | null }.
export function intakeOf(doc) {
  const section = sectionOf(doc.scan, 'Intake');
  if (!section) return null;
  const lines = doc.scan.lines.filter((l) => l.kind === 'text' && l.line > section.h.line && l.line < section.end);
  const t = lines.map((l) => ({ l, m: TRACK.exec(textOf(l)) })).find((x) => x.m);
  const c = lines.map((l) => ({ l, m: TRACK_CONFIRMED.exec(textOf(l)) })).find((x) => x.m);
  return {
    line: section.h.line,
    questions: questionsOf(doc, { section: 'Intake', prefix: 'I' }),
    track: t ? t.m[1] : null, reason: t ? t.m[2].trim() : null, trackLine: t?.l.line ?? null,
    confirmed: c ? { text: c.m[1].trim(), line: c.l.line } : null,
  };
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

  // ---- Unit 42 (decision 2): one ticket by hand asks at most 3 questions ---------------------
  // Unit 44 (the 42 re-check): a ticket interview entered from /mirai-new (it has an intake) offers
  // the standard track, never /mirai-new again, so the two paths can't send a request back and forth.
  const intake = intakeOf(doc);
  if (value.for === 'ticket' && questions.length > TICKET_QUESTION_CAP) {
    add({ code: 'interview-cap', line: questions[TICKET_QUESTION_CAP].line, column: 1, reason: `an interview for one ticket asks at most ${TICKET_QUESTION_CAP} questions; this one has ${questions.length}`, hint: intake ? 'keep the three that matter most, and put the rest in the ticket\'s Notes as "Open: …", or take the standard track instead (an initiative\'s interview, then Nora): change the intake\'s Track to standard and remove for: ticket' : 'keep the three that matter most, and put the rest in the ticket\'s Notes as "Open: …", or ask for an initiative instead (/mirai-new)' });
  }

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

  // ---- Unit 44: a question from a verifier finding -------------------------------------------
  for (const q of questions.filter((x) => x.finding || x.kind || x.answerType)) {
    const at = { line: q.line, column: 1 };
    if (!q.finding && q.kind?.text !== 'reopen') add({ code: 'interview-finding', ...at, reason: `${q.id} has a Kind: or Answer type: line but no Finding: line`, hint: 'name the finding it comes from: Finding: <id> (<fingerprint>): "<the quote>"' });
    else if (q.finding && !q.finding.fingerprint) add({ code: 'interview-finding', line: q.finding.line, column: 1, reason: `${q.id}'s Finding: line has no fingerprint`, hint: 'copy it from findings.md: Finding: F2 (fp-0123456789abcdef): "<the quote>"' });
    if (q.finding && !q.kind) add({ code: 'interview-finding', ...at, reason: `${q.id} comes from a finding but has no Kind: line`, hint: `add Kind: <one of ${FINDING_KINDS.join(', ')}>` });
    else if (q.kind && !FINDING_KINDS.includes(q.kind.text)) add({ code: 'interview-finding', line: q.kind.line, column: 1, reason: `${q.id}'s Kind: "${q.kind.text}" isn't a decision type`, hint: `one of ${FINDING_KINDS.join(', ')}` });
    if (q.finding && q.kind?.text !== 'reopen') {
      const types = new Set(q.options.map((o) => answerTypeOfOption(o.text)));
      const missing = ['vera-wrong', 'not-a-decision', 'left-open'].filter((t) => !types.has(t));
      const words = { 'vera-wrong': '<the verifier> is wrong', 'not-a-decision': 'not a decision, just fix it', 'left-open': 'leave it open and accept it' };
      if (!types.has('answered') || missing.length) add({ code: 'interview-finding', ...at, reason: `${q.id} comes from a finding, so its options are the four answers: ${!types.has('answered') ? 'an answer in the owner\'s words is missing' : `"${missing.map((t) => words[t]).join('", "')}" ${missing.length === 1 ? 'is' : 'are'} missing`}`, hint: 'list them: "- A: <an answer>", "- B: <the verifier> is wrong", "- C: not a decision, just fix it", "- D: leave it open and accept it"' });
    }
    const chosen = answerTypeOf({ ...q, answerType: null });
    if (q.answerType && !ANSWER_TYPES.includes(q.answerType.text)) add({ code: 'interview-finding', line: q.answerType.line, column: 1, reason: `${q.id}'s Answer type: "${q.answerType.text}" isn't one of ${ANSWER_TYPES.join(', ')}`, hint: 'write the type of the option the owner chose' });
    else if (q.answerType && answered(q) && q.kind?.text !== 'reopen' && q.answerType.text !== chosen) add({ code: 'interview-finding', line: q.answerType.line, column: 1, reason: `${q.id}'s Answer type: ${q.answerType.text} doesn't match the option chosen (${chosen})`, hint: 'write the type of the option the owner chose' });
  }

  // ---- Unit 44: the intake (decision 10) -------------------------------------------------------
  if (intake) {
    const at = { line: intake.line, column: 1 };
    if (intake.questions.length > INTAKE_QUESTION_CAP) add({ code: 'interview-intake', line: intake.questions[INTAKE_QUESTION_CAP].line, column: 1, reason: `the intake asks at most ${INTAKE_QUESTION_CAP} questions; this one has ${intake.questions.length}`, hint: 'keep the two that decide the track; the interview asks the rest' });
    intake.questions.forEach((q, i) => {
      const qa = { line: q.line, column: 1 };
      if (q.n !== i + 1) add({ code: 'interview-intake', ...qa, reason: `${q.id} should be I-${i + 1}: intake questions run I-1, I-2`, hint: 'renumber them' });
      if (q.options.length < 2) add({ code: 'interview-intake', ...qa, reason: `${q.id} has ${q.options.length ? 'only one option' : 'no options'}`, hint: 'list two or three lettered options under it' });
      if (!q.guess?.letter) add({ code: 'interview-intake', ...qa, reason: `${q.id} has no guess naming an option`, hint: 'add "Guess: A, because …"' });
      if (!answered(q)) add({ code: 'interview-intake', line: q.answer?.line ?? q.line, column: 1, reason: `${q.id} isn't answered`, hint: 'ask it in the session and write the owner\'s reply after "Answer:"' });
    });
    if (!intake.track) add({ code: 'interview-intake', ...at, reason: 'the intake has no "Track:" line', hint: 'add "Track: standard, because <one-line reason>." with the track you proposed' });
    else if (!TRACKS.includes(intake.track)) add({ code: 'interview-intake', line: intake.trackLine, column: 1, reason: `"${intake.track}" isn't a track`, hint: `one of ${TRACKS.join(', ')}` });
    else {
      if (!/\bbecause\b/i.test(intake.reason ?? '')) add({ code: 'interview-intake', line: intake.trackLine, column: 1, reason: 'the track has no reason', hint: `say why: Track: ${intake.track}, because …` });
      // quick is one ticket (42's one-ticket path); standard and full are an initiative's interview.
      if ((intake.track === 'quick') !== (value.for === 'ticket')) add({ code: 'interview-intake', line: intake.trackLine, column: 1, reason: intake.track === 'quick' ? 'track quick is one ticket by hand: its interview has for: ticket' : `track ${intake.track} is an initiative's interview, not one ticket's (for: ticket)`, hint: intake.track === 'quick' ? 'set for: ticket, or propose standard' : 'remove for: ticket, or propose quick' });
    }
    const yes = intake.confirmed ? YES.exec(intake.confirmed.text) : null;
    if (intake.confirmed && (!yes || !yes[1] || !realDate(yes[1].trim()))) add({ code: 'interview-intake', line: intake.confirmed.line, column: 1, reason: `"Track confirmed: ${intake.confirmed.text}" isn't a yes with its date`, hint: 'write Track confirmed: yes (YYYY-MM-DD) once the owner says yes to the track' });
    else if (!intake.confirmed && value.state === 'confirmed') add({ code: 'interview-intake', ...at, reason: 'the owner hasn\'t confirmed the track', hint: 'propose it, and write Track confirmed: yes (YYYY-MM-DD) when the owner says yes' });
  }

  // ---- Unit 44: the look-ahead's assumptions ----------------------------------------------------
  assumptionsOf(doc).forEach((a, i) => {
    const at = { line: a.line, column: 1 };
    if (a.n !== i + 1) add({ code: 'interview-assumption', ...at, reason: `${a.id} should be A-${i + 1}: assumptions run A-1, A-2, A-3 … with no gap`, hint: 'renumber them' });
    if (!a.source) add({ code: 'interview-assumption', ...at, reason: `${a.id} has no source`, hint: 'say what it rests on: Source: business.md (S-2), the code (<file>), or an answer (Q-3)' });
    if (value.state === 'confirmed' && !a.ok) add({ code: 'interview-assumption', ...at, reason: a.approved === null ? `${a.id} isn't approved, and the interview is confirmed` : `${a.id}'s "Approved: ${a.approved}" isn't a yes or a correction`, hint: 'show the owner the whole list; on "ok" write Approved: yes on each; a correction by number is Approved: corrected: <their words>' });
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
