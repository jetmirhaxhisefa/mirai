import { questionsOf } from '../lint/interview.js';

// A document agent's pause (units 41 and 42: Nora's and Tess's): the one text both prompts carry on
// where the question goes, and MIRAI's check of it. One place, so the two can't drift (42's P2
// rerun, Jet's "A", 2026-11-25: Tess appended her question after "## Restatement", where nothing
// reads it).

// Each agent's prompt file holds this sentence word for word (test/documents/tess.test.js checks).
export const PAUSE_PLACE = 'Put the question last inside `## Questions`, right before `## Restatement`, as the next `### Q-n: <what it is about>`; never after the restatement or its "Confirmed:" line, where nothing reads it.';

// Why a pause on `id` isn't one interview.md shows: a reason, or null when it is (paused, the
// question open inside "## Questions"). `i`: { value, doc } as the agents' readDoc gives it.
export function pauseProblem(i, id) {
  if (i?.value?.state !== 'paused') return 'isn\'t paused';
  const q = i.doc ? questionsOf(i.doc).find((x) => x.id === id) : null;
  if (q) return q.answer?.text ? `has ${id} answered` : null;
  // Named, but outside "## Questions": say where, so the agent's next try (and you) can see it.
  const re = new RegExp(`^(?:\\*\\*)?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\*\\*)?(?::|\\s+—\\s|\\s*$)`);
  const h = i.doc?.scan.headings.find((x) => re.test(x.text));
  if (!h) return `has no ${id}`;
  const after = i.doc.scan.headings.filter((x) => x.level === 2 && x.line < h.line).at(-1);
  return `has ${id} outside ## Questions (line ${h.line}${after ? `, after ## ${after.text}` : ''}): it must be the last question inside ## Questions`;
}

// The paused end, or the failed one with the reason: { paused: true, q } | { why }.
export function checkPause(i, id) {
  const problem = pauseProblem(i, id);
  if (problem) return { why: `she says she paused on ${id}, but interview.md ${problem}` };
  return { q: questionsOf(i.doc).find((x) => x.id === id) };
}
