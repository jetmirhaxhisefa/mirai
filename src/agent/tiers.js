import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { JUDGEMENT_STEPS, STEP_DEFAULTS, STEPS, TIER_FAMILIES } from '../config/defaults.js';

// Which model runs a step (unit 19b; D-14, D-58, Q5, Q12).

export const TIERS = Object.freeze(['light', 'standard', 'deep']);
export { STEP_DEFAULTS };

const up = (tier) => TIERS[Math.min(TIERS.indexOf(tier) + 1, TIERS.length - 1)];
const higher = (a, b) => (TIERS.indexOf(a) >= TIERS.indexOf(b) ? a : b);
const usage = (message, code) => Object.assign(new MiraiError(message, EXIT.USAGE), { code });

// A review of high-risk work is a judgement step of its own (D-14, D-58): it runs on deep, and it's
// logged as such so the reports can find it.
export const stepFor = (step, risk) => (step === 'review' && risk === 'high' ? 'review-high-risk' : step);

// { step, tier, why }. One tier up for high risk or size L, once; judgement steps always deep;
// `asked` may only raise it.
export function pickTier({ config, step: given, risk = null, size = null, asked = null }) {
  if (!STEPS.includes(given)) throw usage(`there's no step ${JSON.stringify(String(given).slice(0, 40))}; steps: ${STEPS.join(', ')}`, 'unknown-step');
  const step = stepFor(given, risk);
  const why = [];
  const steps = config.models?.steps ?? {};
  let tier = Object.hasOwn(steps, step) ? steps[step] : STEP_DEFAULTS[step];
  why.push(`${step}: ${tier}`);
  if (step !== given) why.push('a high-risk review');
  if ((risk === 'high' || size === 'L') && step === given) {
    const raised = up(tier);
    if (raised !== tier) why.push(`one up for ${risk === 'high' ? 'high risk' : 'size L'}`);
    tier = raised;
  }
  if (JUDGEMENT_STEPS.includes(step) && tier !== 'deep') {
    tier = 'deep';
    why.push('a judgement step');
  }
  if (asked) {
    if (!TIERS.includes(asked)) throw usage(`there's no tier ${JSON.stringify(String(asked).slice(0, 20))}`, 'unknown-tier');
    if (TIERS.indexOf(asked) < TIERS.indexOf(tier)) {
      throw usage(JUDGEMENT_STEPS.includes(step) ? `${step} is a judgement step: it never runs below deep (D-14)` : `--tier ${asked} is below this step's ${tier}; a tier can only be raised`, 'tier-lowered');
    }
    if (asked !== tier) why.push(`raised to ${asked} by you`);
    tier = asked;
  }
  return { step, tier, why: why.join('; ') };
}

// Two ids name the same model if they differ only by a date or a context suffix.
export const sameModel = (a, b) => {
  const base = (m) => String(m ?? '').toLowerCase().replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
  return base(a) === base(b);
};

// The verifier ladder: { model, rung, tier }. The verifier runs at least at the author's tier (Q12:
// "comparable"). Rung 1 (another tool) isn't in the MVP. Rung 2: a different model at that tier, its
// alternate first. Rung 3: the same model, in fresh context.
export function pickVerifier({ config, tier: own, authorModel, authorTier = null }) {
  const tier = authorTier && TIERS.includes(authorTier) ? higher(own, authorTier) : own;
  const model = config.models?.[tier];
  if (!model) throw usage(`no model for the tier ${tier} in the trust root's config`, 'no-model');
  const alternate = config.models?.alternates?.[tier];
  if (alternate && !sameModel(alternate, authorModel)) return { model: alternate, rung: 2, tier };
  if (!sameModel(model, authorModel)) return { model, rung: 2, tier };
  return { model, rung: 3, tier };
}

// D-58: a note when a run's model is outside its tier's usual family.
export function familyNote(tier, model) {
  const family = TIER_FAMILIES[tier];
  return family && !family.pattern.test(model) ? `${model} is outside the ${tier} tier's usual family (${family.label})` : null;
}
