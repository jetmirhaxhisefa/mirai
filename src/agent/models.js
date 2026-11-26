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

// MIRAI's shipped list for a tool: { models, aliases }.
export function shippedModels(registryDir, tool = DEFAULT_TOOL) {
  const t = parseToml(readFileSync(join(registryDir, 'models.toml'), 'utf8'), { source: 'registry/models.toml' })[tool] ?? {};
  return { models: [...(t.models ?? [])], aliases: [...(t.aliases ?? [])] };
}

// The tool's list: { models, aliases }. Claude Code's is MIRAI's shipped list (it has no command that
// lists full IDs); Cursor (71) and Codex (73) bring live lists through their own `listModels`.
export const listModels = ({ registryDir, tool = DEFAULT_TOOL }) => shippedModels(registryDir, tool);

// The pinned full ID an alias stands for today, for the refusal's words: the shipped model whose name
// has the alias's family word (the newest listed first), or null.
export function pinnedFor(list, alias) {
  const word = String(alias).toLowerCase();
  return list.models.find((m) => m.includes(`-${word}-`)) ?? null;
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
