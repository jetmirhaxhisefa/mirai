import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { ConfigError, MiraiError, UsageError } from '../errors.js';
import { plain, shown } from '../../status/text.js';
import { fullName } from '../../agent/names.js';
import { pickTier } from '../../agent/tiers.js';
import { checkModel, claudeAliases, DEFAULT_TOOL, inFamily, knownModel, listModels, NOT_PINNED, TOOLS } from '../../agent/models.js';
import { frameworkDefaults, JUDGEMENT_STEPS, STEP_DEFAULTS, STEPS, TIER_FAMILIES } from '../../config/defaults.js';
import { setKey } from '../../config/edit.js';
import { loadConfig, PROJECT_CONFIG } from '../../config/load.js';
import { PERSONAL_SOURCE, personalFileOf, personalModels, withPersonalModels } from '../../config/personal-models.js';
import { loadRegistry } from '../../config/registry.js';
import { render } from '../../install/render.js';
import { resolveClaude } from '../../redteam/key.js';
import { openStore } from '../../store/home.js';
import { checkPrivateFile } from '../../store/files.js';
import { snapshot, trustedConfig } from '../../trust/snapshot.js';
import { REGISTRY_DIR } from './lint.js';

// mirai models | mirai models set <step> <tier> | mirai models set <tier> <model> (unit 45b; Jet's
// interview 2026-11-23 and answers 1 "D", 2 "A"). One place to see which model runs each step, and
// to change it: a step's tier, or a tier's model, in the project config (a normal committed change,
// rendered at once) or with --mine in your personal file (your own launches). Nobody edits [models]
// by hand. D-14 holds: prd, design and review-high-risk stay deep; a tier's model is of its family;
// a model MIRAI doesn't know is refused unless --check proves it with one tiny real call.

const TIERS = ['light', 'standard', 'deep'];
// The agent that runs a step: from the registry's roles, and Kai for the plan steps (his planner
// role), Rex for the high-risk review; the light steps and the reader test are MIRAI's own.
const STEP_ROLE = Object.freeze({ plan: 'developer', replan: 'developer', 'review-high-risk': 'reviewer' });
const MIRAI_STEPS = new Set(['commit-message', 'mr-description', 'report-summary', 'parking-note', 'reader-test']);
const LATER = Object.freeze({ design: 'the architect, unit 64', qa: 'QA, unit 50' });

function agentOf(registry, step) {
  if (MIRAI_STEPS.has(step)) return 'MIRAI';
  if (LATER[step]) return `(${LATER[step]})`;
  const roleName = STEP_ROLE[step] ?? Object.values(registry.roles).find((r) => r.step === step)?.name;
  const agent = Object.values(registry.agents).find((a) => a.role === roleName);
  return agent ? fullName(agent.name) : '—';
}

const where = (s) => (!s ? 'default' : s.line ? `${s.source}:${s.line}` : s.source);

// What launches use (main's config, your personal models on top); the work tree's project file (no
// personal layers) for the sources, and a note when its [models] differ from main's.
function state(io) {
  const store = openStore({ cwd: io.cwd, env: io.env });
  const tree = loadConfig({ projectRoot: io.cwd, globalFile: join('/nonexistent', 'config.toml') });
  let main;
  let mainWhy = null;
  try {
    main = trustedConfig(snapshot({ cwd: io.cwd, env: io.env }));
  } catch (err) {
    main = null;
    mainWhy = String(err.message ?? err).split('\n')[0].slice(0, 200);
  }
  const registryDir = io.registryDir ?? REGISTRY_DIR;
  const listed = listModels({ registryDir });
  const { config, personal } = withPersonalModels(main ?? tree.config, store, { known: (m) => knownModel(listed, m).known });
  const behind = main !== null && JSON.stringify(projectModels(tree.config)) !== JSON.stringify(projectModels(main));
  return { store, tree, main, mainWhy, config, personal, behind, registry: loadRegistry(registryDir) };
}
const projectModels = (c) => ({ light: c.models.light, standard: c.models.standard, deep: c.models.deep, steps: c.models.steps ?? {}, alternates: c.models.alternates ?? {} });

function rows(s) {
  const steps = s.config.models.steps ?? {};
  return STEPS.map((step) => {
    const picked = pickTier({ config: s.config, step });
    const model = s.config.models[picked.tier];
    const mine = s.personal?.steps.includes(step);
    const fromProject = Object.hasOwn((s.main ?? s.tree.config).models.steps ?? {}, step);
    const from = mine ? PERSONAL_SOURCE : fromProject ? where(s.tree.sources[`models.steps.${step}`] ?? { source: PROJECT_CONFIG }) : 'default';
    return { step, agent: agentOf(s.registry, step), tier: picked.tier, model, tool: TOOLS[DEFAULT_TOOL], from: `${from}${JUDGEMENT_STEPS.includes(step) ? ' (must stay deep)' : ''}`, set: Object.hasOwn(steps, step) };
  });
}

function tierRows(s) {
  return TIERS.map((tier) => {
    const mine = s.personal?.tiers.includes(tier);
    const src = s.tree.sources[`models.${tier}`];
    const from = mine ? PERSONAL_SOURCE : src && src.source !== 'default' ? where(src) : 'default';
    return { tier, model: s.config.models[tier], from, alternate: s.config.models.alternates?.[tier] ?? null };
  });
}

function list(io, json) {
  const s = state(io);
  const r = rows(s);
  const t = tierRows(s);
  if (json) {
    io.stdout.write(`${JSON.stringify({ steps: r.map(({ set: _s, ...x }) => x), tiers: t, behind_main: Boolean(s.behind) }, null, 2)}\n`);
    return EXIT.OK;
  }
  const w = (k) => Math.max(k.length, ...r.map((x) => String(x[k]).length));
  const cols = ['step', 'agent', 'tier', 'model', 'tool', 'from'];
  const widths = Object.fromEntries(cols.map((c) => [c, w(c)]));
  io.stdout.write(`${cols.map((c) => c.padEnd(widths[c])).join('  ').trimEnd()}\n`);
  for (const x of r) io.stdout.write(`${cols.map((c) => plain(String(x[c])).padEnd(widths[c])).join('  ').trimEnd()}\n`);
  io.stdout.write('\ntier      model                 from\n');
  for (const x of t) io.stdout.write(`${x.tier.padEnd(9)} ${plain(x.model).padEnd(21)} ${plain(x.from)}${x.alternate ? `   alternate: ${plain(x.alternate)}` : ''}\n`);
  io.stdout.write('\none tier up for high risk or size L (not for steps that are already deep)\n');
  if (!s.main) io.stdout.write(`note: main's snapshot can't be read (${plain(s.mainWhy ?? 'unknown')}), so this shows the work tree's config\n`);
  if (s.behind) io.stdout.write('note: your .mirai/config.toml changes [models] and isn\'t on main yet; launches use main\'s until it is merged\n');
  return EXIT.OK;
}

// ---- set ---------------------------------------------------------------------------------------

function gitClean(io, path) {
  const out = execFileSync('git', ['status', '--porcelain', '--', path], { cwd: io.cwd, env: { ...io.env, PATH: io.env.PATH ?? '/usr/bin:/bin' }, encoding: 'utf8' });
  return out.trim() === '';
}

async function set(io, target, value, { mine, check }) {
  const registryDir = io.registryDir ?? REGISTRY_DIR;
  let table;
  let key;
  let remove = false;
  const notes = [];
  if (STEPS.includes(target)) {
    if (!TIERS.includes(value)) throw new UsageError(`${shown(value)} isn't a tier`, 'a step takes a tier: light, standard or deep');
    if (JUDGEMENT_STEPS.includes(target) && value !== 'deep') throw new MiraiError(`models.steps.${target} must stay "deep": judgement steps are never run on a lower tier (D-14); nothing was written`, EXIT.BLOCKED);
    table = 'models.steps';
    key = target;
    remove = value === STEP_DEFAULTS[target];
  } else if (TIERS.includes(target)) {
    const listed = listModels({ registryDir, live: io.modelsLive ?? null });
    if (listed.note) notes.push(listed.note);
    let k = knownModel(listed, value);
    if (!k.known && !io.modelsLive && !check) {
      // MIRAI's shipped list doesn't have it: Claude Code's own list (its aliases), live.
      const live = listModels({ registryDir, live: () => claudeAliases(resolveClaude(io.env).real, io.env) });
      if (live.note) notes.push(live.note);
      k = knownModel(live, value);
    }
    if (!inFamily(target, value)) throw new MiraiError(`${shown(value)} isn't ${TIER_FAMILIES[target].label}, so it can't be the ${target} tier's model; nothing was written`, EXIT.BLOCKED);
    if (!k.known) {
      if (!check) throw Object.assign(new MiraiError(`${shown(value)} isn't a model MIRAI knows for ${TOOLS[DEFAULT_TOOL]}; nothing was written`, EXIT.BLOCKED), { hint: `if it's real, prove it with one tiny call: mirai models set ${target} ${value} --check` });
      const r = checkModel({ claude: io.modelCheck ? null : resolveClaude(io.env).real, env: io.env, model: value, run: io.modelCheck ?? null });
      if (!r.ok) throw new MiraiError(`${TOOLS[DEFAULT_TOOL]} refused ${shown(value)}: ${plain(r.why)}; nothing was written`, EXIT.BLOCKED);
      notes.push(`checked: ${TOOLS[DEFAULT_TOOL]} answered with ${value}`);
    }
    if (k.alias) notes.push(`${value} is an alias, ${NOT_PINNED}`);
    table = 'models';
    key = target;
    remove = value === frameworkDefaults().models[target];
  } else {
    throw new UsageError(`${shown(target)} is neither a step nor a tier`, `steps: ${STEPS.join(', ')}; tiers: ${TIERS.join(', ')}`);
  }
  if (mine) return setMine(io, { table, key, value: remove ? null : value, notes, registryDir });
  return setProject(io, { table, key, value: remove ? null : value, notes, target, shownValue: value });
}

async function setProject(io, { table, key, value, notes, target, shownValue }) {
  const abs = join(io.cwd, PROJECT_CONFIG);
  if (!gitClean(io, PROJECT_CONFIG)) throw Object.assign(new MiraiError(`${PROJECT_CONFIG} has changes not committed; nothing was written`, EXIT.BLOCKED), { hint: 'commit or undo them first, so this change is the only one in it' });
  const before = readFileSync(abs, 'utf8');
  let edit;
  try {
    edit = setKey(before, { table, key, value, source: PROJECT_CONFIG });
  } catch (err) {
    throw new MiraiError(err.message, EXIT.BLOCKED);
  }
  if (!edit.changed) {
    io.stdout.write(`${table}.${key} is already ${value === null ? 'the default' : value}: nothing to change\n`);
    return EXIT.OK;
  }
  writeFileSync(abs, edit.text);
  try {
    loadConfig({ projectRoot: io.cwd, globalFile: join('/nonexistent', 'config.toml') });
    render({ cwd: io.cwd, env: io.env });
  } catch (err) {
    writeFileSync(abs, before);
    throw err;
  }
  const diff = execFileSync('git', ['diff', '--stat'], { cwd: io.cwd, env: { ...io.env, PATH: io.env.PATH ?? '/usr/bin:/bin' }, encoding: 'utf8' }).trimEnd();
  io.stdout.write(`set: ${table}.${key} = ${value === null ? `(removed: back to the default, ${shownValue})` : value} in ${PROJECT_CONFIG}; rendered\n`);
  for (const n of notes) io.stdout.write(`note: ${n}\n`);
  if (diff) io.stdout.write(`${diff}\n`);
  io.stdout.write(`commit it: git add .mirai && git commit -m "MIRAI models: ${target} ${shownValue}"\n`);
  io.stdout.write('Launches use it once it\'s on main (they run from main\'s snapshot).\n');
  return EXIT.OK;
}

function setMine(io, { table, key, value, notes, registryDir }) {
  const store = openStore({ cwd: io.cwd, env: io.env });
  const abs = personalFileOf(store);
  const exists = existsSync(abs);
  if (exists && !checkPrivateFile(abs)) throw new MiraiError(`${abs} isn't a private file of yours (it must be a regular file, mode 0600)`, EXIT.BLOCKED);
  const before = exists ? readFileSync(abs, 'utf8') : 'schema_version = 1\n';
  let edit;
  try {
    edit = setKey(before, { table, key, value, source: abs });
  } catch (err) {
    throw new MiraiError(err.message, EXIT.BLOCKED);
  }
  writeFileSync(abs, edit.text, { mode: 0o600 });
  try {
    const list = listModels({ registryDir });
    personalModels(store, { known: (m) => knownModel(list, m).known || m === value });
  } catch (err) {
    if (exists) writeFileSync(abs, before, { mode: 0o600 });
    else writeFileSync(abs, 'schema_version = 1\n', { mode: 0o600 });
    throw err instanceof ConfigError ? new MiraiError(`${err.message}; nothing was written`, EXIT.BLOCKED) : err;
  }
  io.stdout.write(`set: ${table}.${key} = ${value ?? '(removed)'} in your personal file (${abs}), for your own launches; the project config is unchanged\n`);
  for (const n of notes) io.stdout.write(`note: ${n}\n`);
  return EXIT.OK;
}

export default {
  name: 'models',
  summary: 'See which model runs each step, or change a step\'s tier or a tier\'s model',
  usage: 'mirai models [--json] | mirai models set <step> <tier> [--mine] | mirai models set <tier> <model> [--mine] [--check]',
  positionals: { min: 0, max: 3 },
  options: {
    json: { type: 'boolean', description: 'the listing as JSON' },
    mine: { type: 'boolean', description: 'with set: your personal file, for your own launches, not the project config' },
    check: { type: 'boolean', description: 'with set <tier> <model>: prove a model MIRAI doesn\'t know with one tiny real call' },
    tool: { type: 'string', description: 'the tool a model is for (one tool today: Claude Code)' },
  },
  async run(args, io) {
    const [action, target, value] = args.positionals;
    if (args.values.tool !== undefined && args.values.tool !== DEFAULT_TOOL) throw new UsageError('one tool today: Claude Code (claude-code); Cursor and Codex come with units 71 and 73');
    if (action === undefined) return list(io, Boolean(args.values.json));
    if (action !== 'set') throw new UsageError(`unknown action ${shown(action)}`, 'mirai models, or mirai models set <step|tier> <tier|model>');
    if (target === undefined || value === undefined) throw new UsageError('set takes a step and a tier, or a tier and a model', 'for example: mirai models set verify deep, or mirai models set standard claude-sonnet-5-5');
    return set(io, target, value, { mine: Boolean(args.values.mine), check: Boolean(args.values.check) });
  },
};
