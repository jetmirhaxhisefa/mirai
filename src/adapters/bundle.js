import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { STEP_DEFAULTS } from '../config/defaults.js';
import { sha256 } from '../install/lock.js';

// The launch bundle (unit 11; D-12, R2-M12): MIRAI's skills and agents for one tool, rendered
// from the registry plus the project config. It's one list of files in plugin layout
// (`skills/<name>/…`, `agents/<name>.md`), sorted by path. Your interactive `.claude/` files and
// a headless run's plugin folder (unit 19) are two placements of this same list, so they share
// `sharedHash`. Settings and the MCP config aren't part of it: their permission modes differ
// between the two by design (D-37).

// The bundle for `registry` (loaded by loadRegistry), with `renderAgent(def, prompt, model)`
// from the tool's adapter writing each agent's file, and the project's `models` ([models], from
// the project config and MIRAI's defaults only, so the files are the same on every machine).
// Returns { files: [{ path, bytes, from }], sharedHash }; `from` lists the registry files each
// one was rendered from (paths relative to the registry folder), plus `config` when the project
// config shaped it.
// Unit 37: a registry with overlays applied (src/config/overlays.js, sessionOverlays) gives an
// agent's prompt (`agentPrompts`) and a skill's SKILL.md (`skillTexts`) as the overlay makes them;
// their `from` then names the overlay's files too, as "repo:<path>".
export function buildBundle(registry, { models, renderAgent }) {
  const files = [];
  const overlayFrom = (kind, name) => (registry.overlays ?? []).filter((o) => o.kind === kind && o.name === name).flatMap((o) => o.files.map((f) => `repo:${f}`));
  for (const skill of Object.values(registry.skills)) {
    for (const rel of skill.files) {
      const text = rel === 'SKILL.md' ? registry.skillTexts?.[skill.name] : undefined;
      files.push({ path: `skills/${skill.name}/${rel}`, bytes: typeof text === 'string' ? Buffer.from(text, 'utf8') : readFileSync(join(registry.dir, skill.folder, rel)), from: [`${skill.folder}/${rel}`, ...(typeof text === 'string' ? overlayFrom('skill', skill.name) : [])] });
    }
  }
  for (const def of Object.values(registry.agents)) {
    // The tier of its role's step (unit 21a; D-14): the file's model is a default, and every
    // launch picks its own (unit 19b's pickTier).
    const step = (registry.roles[def.role] ?? registry.roles[def.overlay?.core_role]).step;
    const tier = Object.hasOwn(models.steps ?? {}, step) ? models.steps[step] : STEP_DEFAULTS[step];
    const model = models[tier];
    if (typeof model !== 'string' || !MODEL.test(model)) {
      throw new MiraiError(`[models] ${tier} (the ${step} step's tier) is not a model name MIRAI can write into ${def.name}'s file`, EXIT.CONFIG);
    }
    const own = registry.agentPrompts?.[def.name];
    const prompt = typeof own === 'string' ? Buffer.from(own, 'utf8') : readFileSync(join(registry.dir, def.prompt));
    files.push({ path: `agents/${def.name}.md`, bytes: renderAgent(def, prompt, model), from: [registry.agentFiles[def.name], def.prompt, 'config', ...(typeof own === 'string' || def.overlay ? overlayFrom('agent', def.name) : [])] });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, sharedHash: sharedHash(files) };
}

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

// SHA-256 over "<sha256> <path>\n" per file, in path order (plugin-layout paths).
export function sharedHash(files) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256(sorted.map((f) => `${sha256(f.bytes)} ${f.path}\n`).join(''));
}
