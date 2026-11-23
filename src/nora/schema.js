// Nora's structured output (unit 41; Scope 6, Jet's B1). Passed to Claude Code with --json-schema
// (inlined: no $ref), and checked again here, since a run's stream is data: MIRAI decides from its
// own check, never from what the reply claims.
//
// { outcome: 'written' | 'paused', summary, template_gaps: [{ type, what, where }],
//   documents: [{ name, text }] (the local store only: MIRAI writes them), question? (Q-n, paused) }

export const DOC_NAMES = Object.freeze(['brief.md', 'prd.md', 'interview.md']);
const TEXT_MAX = 400_000;
const LINE = /^[^\n\r]{1,500}$/;
const QUESTION = /^Q-[0-9]{1,4}$/;

export const NORA_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['outcome', 'summary', 'template_gaps', 'documents'],
  properties: {
    outcome: { type: 'string', enum: ['written', 'paused'], description: 'written: this launch\'s work is done; paused: you asked the owner a question in interview.md' },
    summary: { type: 'string', minLength: 1, maxLength: 2000, description: 'what you did, in a few sentences' },
    template_gaps: {
      type: 'array',
      maxItems: 20,
      description: 'what the template had no section for, and where you put it instead',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'what', 'where'],
        properties: {
          type: { type: 'string', enum: ['brief', 'prd'] },
          what: { type: 'string', minLength: 1, maxLength: 500, description: 'what didn\'t fit, in one line' },
          where: { type: 'string', minLength: 1, maxLength: 200, description: 'the existing section you put it in' },
        },
      },
    },
    documents: {
      type: 'array',
      maxItems: 3,
      description: 'on the local store only: each document you wrote or changed, whole; on the repo store an empty list',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'text'],
        properties: {
          name: { type: 'string', enum: [...DOC_NAMES] },
          text: { type: 'string', minLength: 1, maxLength: TEXT_MAX },
        },
      },
    },
    question: { type: 'string', pattern: QUESTION.source, description: 'when paused: the ID of the question you added to interview.md' },
  },
});

// The checked result: { value } or { problem }. `local`: whether the documents come back here.
export function checkNoraResult(v, { local }) {
  const no = (why) => ({ problem: `her result ${why}` });
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return no('is missing (no structured output)');
  const extra = Object.keys(v).filter((k) => !Object.hasOwn(NORA_SCHEMA.properties, k));
  if (extra.length) return no(`has keys MIRAI doesn't read (${extra.slice(0, 3).join(', ')})`);
  if (!['written', 'paused'].includes(v.outcome)) return no('has no outcome (written or paused)');
  if (typeof v.summary !== 'string' || !v.summary.trim() || v.summary.length > 2000) return no('has no summary');
  if (!Array.isArray(v.template_gaps) || v.template_gaps.length > 20) return no('has no template_gaps list');
  for (const g of v.template_gaps) {
    if (g === null || typeof g !== 'object' || !['brief', 'prd'].includes(g.type) || !LINE.test(g.what ?? '') || typeof g.where !== 'string' || !/^[^\n\r]{1,200}$/.test(g.where) || Object.keys(g).length !== 3) return no('has a template gap that isn\'t { type, what, where }');
  }
  if (!Array.isArray(v.documents) || v.documents.length > 3) return no('has no documents list');
  const names = new Set();
  for (const d of v.documents) {
    if (d === null || typeof d !== 'object' || !DOC_NAMES.includes(d.name) || typeof d.text !== 'string' || !d.text || d.text.length > TEXT_MAX || Object.keys(d).length !== 2) return no('has a document that isn\'t { name, text }');
    if (names.has(d.name)) return no(`returns ${d.name} twice`);
    names.add(d.name);
  }
  if (!local && v.documents.length) return no('returns documents, but on the repo store she writes the files herself');
  if (v.outcome === 'paused' && !QUESTION.test(v.question ?? '')) return no('says paused, but names no question (Q-n)');
  if (v.outcome !== 'paused' && v.question !== undefined) return no('names a question, but isn\'t paused');
  return { value: v };
}
