import { join } from 'node:path';

import { ConfigError } from '../cli/errors.js';
import { checkPrivateFile } from '../store/files.js';
import { JUDGEMENT_STEPS, STEPS, TIER_FAMILIES } from './defaults.js';
import { readConfigFile } from './load.js';

// Your personal models for your own launches (unit 45b, Scope 6; Jet's answer 2 "A"). Launches read
// main's config (the trust root); on top of it, for launches you start on this machine, your
// per-repo personal file (`<store>/config.user.toml`, 05a) may set the three tiers' models and step
// tiers (`[models]`, `[models.steps]`). Main's snapshot and the lock don't change: the launch passes
// its picked model, as pickTier does. Checked as a project change is: a judgement step stays deep
// (D-14), a tier's model is of its family, and a model is on MIRAI's known list for the tool.

const TIERS = ['light', 'standard', 'deep'];
export const PERSONAL_FILE = 'config.user.toml';
export const PERSONAL_SOURCE = 'your personal file';

export const personalFileOf = (store) => join(store.dir, PERSONAL_FILE);

// { models: { light?, standard?, deep?, steps? }, path } or null when the file is absent or sets no
// model. Refused (a ConfigError naming the key) for a value that breaks a rule.
export function personalModels(store, { known = null } = {}) {
  const path = personalFileOf(store);
  if (!checkPrivateFile(path)) return null;
  const file = readConfigFile(path, { trust: 'personal', source: `~/.mirai/…/${PERSONAL_FILE}`, optional: true });
  const m = file?.value?.models;
  if (!m || typeof m !== 'object') return null;
  const problems = [];
  const out = {};
  for (const tier of TIERS) {
    if (m[tier] === undefined) continue;
    if (typeof m[tier] !== 'string') problems.push(`models.${tier} must be a model id`);
    else if (!TIER_FAMILIES[tier].pattern.test(m[tier])) problems.push(`models.${tier} = "${m[tier]}" isn't ${TIER_FAMILIES[tier].label}`);
    else if (known && !known(m[tier])) problems.push(`models.${tier} = "${m[tier]}" isn't a model MIRAI knows (mirai models set ${tier} <model> --mine --check proves one)`);
    else out[tier] = m[tier];
  }
  if (m.steps !== undefined) {
    out.steps = {};
    for (const [step, tier] of Object.entries(m.steps ?? {})) {
      if (!STEPS.includes(step)) problems.push(`models.steps.${step}: there's no such step`);
      else if (!TIERS.includes(tier)) problems.push(`models.steps.${step} must be light, standard or deep`);
      else if (JUDGEMENT_STEPS.includes(step) && tier !== 'deep') problems.push(`models.steps.${step} must stay "deep": judgement steps are never run on a lower tier (D-14)`);
      else out.steps[step] = tier;
    }
  }
  if (problems.length) throw new ConfigError(`your personal file ${path} has ${problems.length} problem${problems.length === 1 ? '' : 's'}: ${problems.join('; ')}`, { code: 'personal-models', path });
  return Object.keys(out).length ? { models: out, path } : null;
}

// The config a launch of yours uses: main's, with your personal models on top. Returns { config,
// personal } where `personal` names what came from your file ({ tiers: [...], steps: [...] }) or null.
export function withPersonalModels(config, store, options = {}) {
  let mine;
  try {
    mine = personalModels(store, options);
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    return { config, personal: null };
  }
  if (!mine) return { config, personal: null };
  const models = { ...config.models, ...Object.fromEntries(TIERS.filter((t) => mine.models[t]).map((t) => [t, mine.models[t]])) };
  if (mine.models.steps) models.steps = { ...(config.models?.steps ?? {}), ...mine.models.steps };
  return { config: { ...config, models }, personal: { tiers: TIERS.filter((t) => mine.models[t]), steps: Object.keys(mine.models.steps ?? {}) } };
}

// The run line's words for what your file changed in this launch's pick, or null.
export function personalWhy(personal, { step, tier, model }) {
  if (!personal) return null;
  const parts = [];
  if (personal.steps.includes(step)) parts.push(`${step}: ${tier} from ${PERSONAL_SOURCE}`);
  if (personal.tiers.includes(tier)) parts.push(`${tier}: ${model} from ${PERSONAL_SOURCE}`);
  return parts.length ? parts.join('; ') : null;
}
