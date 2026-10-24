import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
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
export function buildBundle(registry, { models, renderAgent }) {
  const files = [];
  for (const skill of Object.values(registry.skills)) {
    for (const rel of skill.files) {
      files.push({ path: `skills/${skill.name}/${rel}`, bytes: readFileSync(join(registry.dir, skill.folder, rel)), from: [`${skill.folder}/${rel}`] });
    }
  }
  for (const def of Object.values(registry.agents)) {
    const model = models[def.default_tier];
    if (typeof model !== 'string' || !MODEL.test(model)) {
      throw new MiraiError(`[models] ${def.default_tier} is not a model name MIRAI can write into ${def.name}'s file`, EXIT.CONFIG);
    }
    const prompt = readFileSync(join(registry.dir, def.prompt));
    files.push({ path: `agents/${def.name}.md`, bytes: renderAgent(def, prompt, model), from: [registry.agentFiles[def.name], def.prompt, 'config'] });
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
