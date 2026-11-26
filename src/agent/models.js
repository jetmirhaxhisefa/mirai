import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseToml } from '../config/toml.js';
import { TIER_FAMILIES } from '../config/defaults.js';

// The models MIRAI knows per tool (unit 45b; Jet's answer 1 "D"): each tool's adapter supplies its
// list, live where the tool can list them, else MIRAI's shipped list (registry/models.toml). Claude
// Code is the only tool today; Cursor (71) and Codex (73) add their own `listModels`.

export const TOOLS = Object.freeze({ 'claude-code': 'Claude Code' });
export const DEFAULT_TOOL = 'claude-code';
export const NOT_PINNED = 'not pinned: it moves to the newest model of its kind; probes and red-team results were measured on the pinned one';

// MIRAI's shipped list for a tool: { models, aliases }.
export function shippedModels(registryDir, tool = DEFAULT_TOOL) {
  const t = parseToml(readFileSync(join(registryDir, 'models.toml'), 'utf8'), { source: 'registry/models.toml' })[tool] ?? {};
  return { models: [...(t.models ?? [])], aliases: [...(t.aliases ?? [])] };
}

// The tool's list: { models, aliases, source: 'live' | 'shipped', note }. Claude Code's live part
// is its aliases from `claude -p "/model"`; a run that fails (not logged in, a changed command)
// falls back to the shipped list and says so. `live` is given in tests (a stand-in), or false.
export function listModels({ registryDir, tool = DEFAULT_TOOL, live = null }) {
  const shipped = shippedModels(registryDir, tool);
  if (!live) return { ...shipped, source: 'shipped', note: null };
  let aliases = null;
  try {
    aliases = live();
  } catch {
    aliases = null;
  }
  if (!Array.isArray(aliases) || !aliases.length) return { ...shipped, source: 'shipped', note: `${TOOLS[tool]}'s own list didn't answer, so MIRAI's shipped list is used` };
  return { models: shipped.models, aliases: [...new Set([...aliases, ...shipped.aliases.filter((a) => aliases.includes(a))])], source: 'live', note: null };
}

// Claude Code's live aliases: the words its /model menu shows that are aliases MIRAI knows the shape
// of; the 1M-context forms are left out (a launch takes a plain model id only).
export function claudeAliases(claude, env) {
  const r = spawnSync(claude, ['-p', '/model'], { env, encoding: 'utf8', timeout: 30_000 });
  if (r.status !== 0) throw new Error(r.stderr || 'claude -p /model failed');
  return [...new Set((r.stdout.match(/\b(haiku|sonnet|opus|fable|best|default|opusplan)\b(?!\[)/gi) ?? []).map((w) => w.toLowerCase()))];
}

// Is `model` on the tool's list? { known, alias }.
export function knownModel(list, model) {
  if (list.models.includes(model)) return { known: true, alias: false };
  if (list.aliases.includes(model)) return { known: true, alias: true };
  return { known: false, alias: false };
}

// A tier's family (TIER_FAMILIES): does the model (or an alias's name) belong to it? `best` and
// `default` and `opusplan` belong to no one family: refused for light and standard, allowed for deep
// only when the name says opus or fable.
export const inFamily = (tier, model) => TIER_FAMILIES[tier].pattern.test(model);

// `--check`: one tiny real call with the model; { ok, why }. `run` is given in tests.
export function checkModel({ claude, env, model, run = null }) {
  const r = run ? run(model) : spawnSync(claude, ['-p', '--model', model, '--max-turns', '1', 'Reply with the word ok.'], { env, encoding: 'utf8', timeout: 120_000 });
  if (r.status === 0) return { ok: true, why: null };
  return { ok: false, why: String(r.stderr || r.stdout || `exit ${r.status}`).trim().split('\n').slice(-3).join(' ').slice(0, 400) };
}
