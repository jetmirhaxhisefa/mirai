// The architect's structured output (unit 64; as Tess's, src/tess/schema.js). Passed to the launcher
// with the launch, and checked again here, since a run's stream is data: MIRAI decides from its own
// check (what changed in the work tree), never from what the reply claims.
//
// { outcome: 'written' | 'paused', summary, template_gaps: [{ type, what, where }], adrs: [path],
//   question? (Q-n, paused) }

export const GAP_TYPES = Object.freeze(['hld', 'lld', 'tech-note', 'adr']);
const LINE = /^[^\n\r]{1,500}$/;
const QUESTION = /^Q-[0-9]{1,4}$/;
const PATH = /^[A-Za-z0-9._/-]{1,300}\.md$/;

export const DESIGN_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['outcome', 'summary', 'template_gaps', 'adrs'],
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
          what: { type: 'string', minLength: 1, maxLength: 500 },
          where: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
    adrs: { type: 'array', maxItems: 10, items: { type: 'string', pattern: PATH.source }, description: 'the ADR files you wrote or changed in this launch' },
    question: { type: 'string', pattern: QUESTION.source, description: 'when paused: the ID of the question you added to interview.md' },
  },
});

// The checked result: { value } or { problem }.
export function checkDesignResult(v) {
  const no = (why) => ({ problem: `his result ${why}` });
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return no('is missing (no structured output)');
  const extra = Object.keys(v).filter((k) => !Object.hasOwn(DESIGN_SCHEMA.properties, k));
  if (extra.length) return no(`has keys MIRAI doesn't read (${extra.slice(0, 3).join(', ')})`);
  if (!['written', 'paused'].includes(v.outcome)) return no('has no outcome (written or paused)');
  if (typeof v.summary !== 'string' || !v.summary.trim() || v.summary.length > 2000) return no('has no summary');
  if (!Array.isArray(v.template_gaps) || v.template_gaps.length > 20) return no('has no template_gaps list');
  for (const g of v.template_gaps) {
    if (g === null || typeof g !== 'object' || !GAP_TYPES.includes(g.type) || !LINE.test(g.what ?? '') || typeof g.where !== 'string' || !/^[^\n\r]{1,200}$/.test(g.where) || Object.keys(g).length !== 3) return no('has a template gap that isn\'t { type, what, where }');
  }
  if (!Array.isArray(v.adrs) || v.adrs.length > 10 || !v.adrs.every((p) => typeof p === 'string' && PATH.test(p))) return no('has no adrs list of paths');
  if (v.outcome === 'paused' && !QUESTION.test(v.question ?? '')) return no('says paused, but names no question (Q-n)');
  if (v.outcome !== 'paused' && v.question !== undefined) return no('names a question, but isn\'t paused');
  return { value: v };
}
