import { test } from 'node:test';
import assert from 'node:assert/strict';

import { familyNote, pickTier, pickVerifier, STEP_DEFAULTS, TIERS } from '../../src/agent/tiers.js';
import { JUDGEMENT_STEPS, STEPS } from '../../src/config/defaults.js';

// Unit 19b: which model runs a step (D-14, D-58).

const config = { models: { light: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5', deep: 'claude-opus-5-5' } };

test('T4: every step at each risk and size; judgement steps always deep; one up only; --tier only raises', () => {
  assert.deepEqual(Object.keys(STEP_DEFAULTS).sort(), [...STEPS].sort());
  for (const step of STEPS) {
    for (const risk of [null, 'high']) {
      for (const size of [null, 'L']) {
        const { tier } = pickTier({ config, step, risk, size });
        const base = STEP_DEFAULTS[step];
        const raised = risk || size ? TIERS[Math.min(TIERS.indexOf(base) + 1, 2)] : base;
        assert.equal(tier, JUDGEMENT_STEPS.includes(step) ? 'deep' : raised, `${step} ${risk} ${size}`);
      }
    }
  }
  assert.equal(pickTier({ config, step: 'commit-message', risk: 'high', size: 'L' }).tier, 'standard', 'once, not twice');
  assert.throws(() => pickTier({ config, step: 'design', asked: 'light' }), (e) => e.code === 'tier-lowered');
  assert.throws(() => pickTier({ config, step: 'build', asked: 'light' }), (e) => e.code === 'tier-lowered');
  assert.match(pickTier({ config, step: 'build', asked: 'deep' }).why, /raised to deep by you/);
  assert.equal(pickTier({ config: { models: { steps: { build: 'light' } } }, step: 'build' }).tier, 'light', 'a project\'s step default wins');
  assert.throws(() => pickTier({ config, step: 'nope' }), (e) => e.code === 'unknown-step');
  assert.throws(() => pickTier({ config, step: 'constructor', asked: 'deep' }), (e) => e.code === 'unknown-step');
  const hr = pickTier({ config: { models: { steps: { review: 'light' } } }, step: 'review', risk: 'high' });
  assert.deepEqual([hr.step, hr.tier], ['review-high-risk', 'deep'], 'a high-risk review is a judgement step');
});

test('T5: the verifier ladder: rung 2 with a different model, rung 3 when there is none, never the author\'s on rung 2', () => {
  const alt = { models: { ...config.models, alternates: { deep: 'claude-fable-5-1' } } };
  assert.deepEqual(pickVerifier({ config: alt, tier: 'deep', authorModel: 'claude-opus-5-5' }), { model: 'claude-fable-5-1', rung: 2, tier: 'deep' });
  assert.deepEqual(pickVerifier({ config, tier: 'deep', authorModel: 'claude-sonnet-5-5' }), { model: 'claude-opus-5-5', rung: 2, tier: 'deep' });
  assert.deepEqual(pickVerifier({ config, tier: 'deep', authorModel: 'claude-opus-5-5' }), { model: 'claude-opus-5-5', rung: 3, tier: 'deep' });
  assert.deepEqual(pickVerifier({ config: { models: { ...config.models, alternates: { deep: 'claude-opus-5-5' } } }, tier: 'deep', authorModel: 'claude-opus-5-5' }), { model: 'claude-opus-5-5', rung: 3, tier: 'deep' });
  // Never down: a deep author is checked at deep, and a dated or suffixed id is the same model.
  assert.deepEqual(pickVerifier({ config, tier: 'standard', authorModel: 'claude-opus-5-5', authorTier: 'deep' }), { model: 'claude-opus-5-5', rung: 3, tier: 'deep' });
  assert.equal(pickVerifier({ config, tier: 'deep', authorModel: 'claude-opus-5-5[1m]' }).rung, 3);
  assert.equal(pickVerifier({ config, tier: 'deep', authorModel: 'claude-opus-5-5-20261001' }).rung, 3);
  assert.throws(() => pickVerifier({ config: { models: { deep: '' } }, tier: 'deep', authorModel: 'x' }), (e) => e.code === 'no-model');
});

test('T7: a model outside its tier\'s family is a note, never a refusal (D-58)', () => {
  assert.match(familyNote('deep', 'claude-haiku-5-5'), /outside the deep tier/);
  assert.equal(familyNote('deep', 'claude-fable-5-1'), null);
});
