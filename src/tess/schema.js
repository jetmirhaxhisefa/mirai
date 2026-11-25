// The ticket planner's structured output (unit 42; as 41's, src/nora/schema.js). Passed to the
// launcher with the launch (inlined: no $ref), and checked again here, since a run's stream is
// data: MIRAI decides from its own check, never from what the reply claims.
//
// { outcome: 'written' | 'paused', summary, template_gaps: [{ type, what, where }],
//   documents: [{ name, text }] (the local store only: MIRAI writes them), question? (Q-n, paused) }

export const GAP_TYPES = Object.freeze(['epic', 'story', 'bug', 'investigation']);
// epic.md, interview.md (a pause), or tickets/<KEY>.md.
export const DOC_NAME = /^(?:epic\.md|interview\.md|tickets\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.md)$/;
const TEXT_MAX = 400_000;
const DOCS_MAX = 30;
const LINE = /^[^\n\r]{1,500}$/;
const QUESTION = /^Q-[0-9]{1,4}$/;

export const TESS_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['outcome', 'summary', 'template_gaps', 'documents'],
  properties: {
    outcome: { type: 'string', enum: ['written', 'paused'], description: 'written: this launch\'s work is done; paused: you asked the owner a question in interview.md' },
    summary: { type: 'string', minLength: 1, maxLength: 2000, description: 'what you did, in a few sentences' },
    template_gaps: {
      type: 'array',
      maxItems: 20,
      description: 'what a template had no section for, and where you put it instead',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'what', 'where'],
        properties: {
          type: { type: 'string', enum: [...GAP_TYPES] },
          what: { type: 'string', minLength: 1, maxLength: 500, description: 'what didn\'t fit, in one line' },
          where: { type: 'string', minLength: 1, maxLength: 200, description: 'the existing section you put it in' },
        },
      },
    },
    documents: {
      type: 'array',
      maxItems: DOCS_MAX,
      description: 'on the local store only: each document you wrote or changed, whole (epic.md, tickets/<KEY>.md, interview.md); on the repo store an empty list',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'text'],
        properties: {
          name: { type: 'string', pattern: DOC_NAME.source },
          text: { type: 'string', minLength: 1, maxLength: TEXT_MAX },
        },
      },
    },
    question: { type: 'string', pattern: QUESTION.source, description: 'when paused: the ID of the question you added to interview.md' },
  },
});

// The checked result: { value } or { problem }. `local`: whether the documents come back here;
// `one`: a lone ticket (no epic, no pause).
export function checkTessResult(v, { local, one = false }) {
  const no = (why) => ({ problem: `her result ${why}` });
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return no('is missing (no structured output)');
  const extra = Object.keys(v).filter((k) => !Object.hasOwn(TESS_SCHEMA.properties, k));
  if (extra.length) return no(`has keys MIRAI doesn't read (${extra.slice(0, 3).join(', ')})`);
  if (!['written', 'paused'].includes(v.outcome)) return no('has no outcome (written or paused)');
  if (typeof v.summary !== 'string' || !v.summary.trim() || v.summary.length > 2000) return no('has no summary');
  if (!Array.isArray(v.template_gaps) || v.template_gaps.length > 20) return no('has no template_gaps list');
  for (const g of v.template_gaps) {
    if (g === null || typeof g !== 'object' || !GAP_TYPES.includes(g.type) || !LINE.test(g.what ?? '') || typeof g.where !== 'string' || !/^[^\n\r]{1,200}$/.test(g.where) || Object.keys(g).length !== 3) return no('has a template gap that isn\'t { type, what, where }');
  }
  if (!Array.isArray(v.documents) || v.documents.length > DOCS_MAX) return no('has no documents list');
  const names = new Set();
  for (const d of v.documents) {
    if (d === null || typeof d !== 'object' || typeof d.name !== 'string' || !DOC_NAME.test(d.name) || typeof d.text !== 'string' || !d.text || d.text.length > TEXT_MAX || Object.keys(d).length !== 2) return no('has a document that isn\'t { name, text }');
    if (names.has(d.name.toLowerCase())) return no(`returns ${d.name} twice`);
    names.add(d.name.toLowerCase());
  }
  if (!local && v.documents.length) return no('returns documents, but on the repo store she writes the files herself');
  if (one && v.documents.some((d) => !d.name.startsWith('tickets/'))) return no('returns an epic or the interview for a lone ticket');
  if (one && v.outcome === 'paused') return no('says paused, but a ticket asked for by hand doesn\'t pause (its open points go in its Notes)');
  if (v.outcome === 'paused' && !QUESTION.test(v.question ?? '')) return no('says paused, but names no question (Q-n)');
  if (v.outcome !== 'paused' && v.question !== undefined) return no('names a question, but isn\'t paused');
  return { value: v };
}
