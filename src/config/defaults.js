// Framework defaults (layer 1) and the two presets (unit 03b). The model IDs are provisional
// until calibration (unit 57) sets them from measurements.

// Gate stages (design/01 §16, D-34). The first list can never be automatic.
export const NEVER_AUTO_STAGES = Object.freeze([
  'track', 'brief', 'prd', 'design', 'tickets', 'instruction-files', 'merge', 'new-budget',
  'unpark', 'context', 'clean', 'production',
]);
export const MAY_BE_AUTO_STAGES = Object.freeze(['plan', 'build', 'review', 'qa', 'docs-merge', 'final-e2e']);
export const GATE_STAGES = Object.freeze([...NEVER_AUTO_STAGES, ...MAY_BE_AUTO_STAGES]);

const humanOnly = Object.fromEntries(NEVER_AUTO_STAGES.map((stage) => [stage, 'human']));

export const PRESETS = Object.freeze({
  supervised: Object.freeze({ ...humanOnly, plan: 'human', build: 'auto', review: 'auto', qa: 'auto', 'docs-merge': 'auto', 'final-e2e': 'auto' }),
  autonomous: Object.freeze({ ...humanOnly, plan: 'auto', build: 'auto', review: 'auto', qa: 'auto', 'docs-merge': 'auto', 'final-e2e': 'auto' }),
});

// The steps that have a model tier (D-14). Provisional until the launcher (unit 19) and
// calibration (unit 57); a typo in [models.steps] is refused.
export const STEPS = Object.freeze([
  'prd', 'design', 'tickets', 'verify', 'plan', 'replan', 'build', 'review', 'review-high-risk', 'qa',
  'commit-message', 'mr-description', 'report-summary', 'parking-note',
]);

// The usual model family of each tier. Any model may be set (D-58); a model outside its tier's
// family is shown as a warning, never refused.
export const TIER_FAMILIES = Object.freeze({
  light: Object.freeze({ pattern: /haiku/i, label: 'a Haiku model' }),
  standard: Object.freeze({ pattern: /sonnet/i, label: 'a Sonnet model' }),
  deep: Object.freeze({ pattern: /opus|fable/i, label: 'an Opus or Fable model' }),
});

// Judgement steps are never run below the deep tier (D-14).
export const JUDGEMENT_STEPS = Object.freeze(['prd', 'design', 'review-high-risk']);

// Returns a fresh copy each time, so callers can merge into it.
export function frameworkDefaults() {
  return {
    preset: 'supervised',
    git: { branch_pattern: 'feature/{ticket}-{slug}', trailer: 'Mirai-Ticket' },
    models: { light: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5', deep: 'claude-opus-5-5' },
    testing: { tdd: 'auto', tests: 'required', e2e_budget_minutes: 15 },
    repos: [{ name: '.', path: '.' }],
    workspace: { e2e: 'none' },
    gate: { code_paths: ['**', '!docs/mirai/**', '!.mirai/**'], risk: { high: [] } },
    docs: { root: 'docs/mirai' },
    retention: { days: 90, auto: false },
    usage: { night_max: 15, week_max: 60, reserve: 40 },
  };
}
