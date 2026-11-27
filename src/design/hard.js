// Unit 65 (decision 1; P2's finding): the early pause asks you about a hard-to-reverse ADR in the
// initiative's interview.md, which the brief's signed approval binds. Your answer there settles a
// design question, not a requirement, so the binding reads the interview without MIRAI's own design
// questions: the Q-n blocks its hard pauses wrote (their ids are in the design_run lines), and the
// state line as you confirmed it. Anything else you change in the interview still counts.

export function hardQuestionIds(events, initiative) {
  return events.filter((e) => e.type === 'design_run' && e.item === initiative && e.hard === true && typeof e.question_id === 'string').map((e) => e.question_id);
}

export function withoutDesignQuestions(text, ids) {
  let out = String(text);
  for (const id of ids) {
    const esc = id.replace(/[-]/g, '\\-');
    out = out.replace(new RegExp(`^### ${esc}: [^\\n]*hard to reverse\\)\\n[^]*?(?=^### |^## |(?![^]))`, 'm'), '');
  }
  return out;
}

// The interview's bytes as the brief's approval reads them: `bytes` without MIRAI's design questions.
export function interviewAsBound(bytes, events, initiative) {
  const ids = hardQuestionIds(events, initiative);
  if (!ids.length) return bytes;
  return Buffer.from(withoutDesignQuestions(bytes.toString('utf8'), ids), 'utf8');
}
