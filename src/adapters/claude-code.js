import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { sharedHash } from './bundle.js';
import { filesUnder } from '../install/lock.js';

// The Claude Code adapter (unit 11; 03 "Adapter: Claude Code"). It places one launch bundle in
// two ways, both read from the tool profile (`registry/adapters/claude-code.toml`):
// - interactive: `skills/…` under `.claude/skills/`, `agents/…` under `.claude/agents/`, in the
//   work tree, plus MIRAI's block in CLAUDE.md that imports AGENTS.md;
// - headless: a plugin folder (`skills/`, `agents/`), which unit 19 builds in the trust root.

export const ADAPTER = 'claude-code';

// Told to Claude in every rendered agent's description (unit 11, open point 3): MIRAI's agents
// run through its launcher, which logs them and keeps them inside the caps (D-12). Unit 15
// points it at the broker's launch.
export const AGENT_NOTE = 'Started by MIRAI\'s launcher; don\'t start it as a subagent yourself.';

// An agent's file for Claude Code: frontmatter (name, description with the note, tools as
// Claude spells them, model), then the prompt as the body. The registry allows only printable
// characters in a description, and the model name is checked by buildBundle, so a JSON string
// is a valid YAML double-quoted string here, for MIRAI's reader and any other.
export function renderAgent(def, prompt, model) {
  const head = [
    '---',
    `name: ${def.name}`,
    `description: ${JSON.stringify(`${def.description} ${AGENT_NOTE}`)}`,
    `tools: ${JSON.stringify(def.tools.allowed.join(', '))}`,
    `model: ${JSON.stringify(model)}`,
    '---',
    '',
  ].join('\n');
  return Buffer.concat([Buffer.from(head, 'utf8'), prompt]);
}

// Where a bundle file goes in the work tree.
export function interactivePath(profile, bundlePath) {
  return placed(profile.interactive, bundlePath);
}

// Where a bundle file goes in a headless run's plugin folder.
export function headlessPath(profile, bundlePath) {
  return placed(profile.headless, bundlePath);
}

function placed(dirs, bundlePath) {
  const slash = bundlePath.indexOf('/');
  const top = bundlePath.slice(0, slash);
  if (top !== 'skills' && top !== 'agents') throw new Error(`not a bundle path: ${bundlePath}`);
  return `${dirs[top]}/${bundlePath.slice(slash + 1)}`;
}

// The paths MIRAI owns in the work tree: `mirai-*` entries in the two interactive folders.
// Anything else there is yours.
// Names are compared ignoring case: macOS disks are case-insensitive, so `MIRAI-DOCS` and
// `mirai-docs` are one folder there.
export function isManaged(profile, path) {
  for (const dir of [profile.interactive.skills, profile.interactive.agents]) {
    if (path.startsWith(`${dir}/`) && isMiraiName(path.slice(dir.length + 1))) return true;
  }
  return false;
}

export const isMiraiName = (name) => name.toLowerCase().startsWith('mirai-');

// The body of MIRAI's block in the instruction file.
export const instructionBlock = (profile) => profile.instructions.import;

// Writes the bundle as a plugin folder under `dir` (for unit 19; used by the tests now).
export function writePluginDir(bundle, profile, dir) {
  for (const f of bundle.files) {
    const to = join(dir, headlessPath(profile, f.path));
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, f.bytes, { mode: 0o644 });
    chmodSync(to, 0o644);
  }
}

// The shared hash of MIRAI's files as they are on disk under `root`, in one placement (`dirs`:
// the profile's `interactive` or `headless` folders). It lists the folders itself, so a file
// added or missing on disk changes the hash too.
export function hashOnDisk(root, dirs) {
  const files = [];
  for (const top of ['skills', 'agents']) {
    for (const rel of filesUnder(root, dirs[top]).map((p) => p.slice(dirs[top].length + 1))) {
      if (isMiraiName(rel)) files.push({ path: `${top}/${rel}`, bytes: readFileSync(join(root, dirs[top], rel)) });
    }
  }
  return sharedHash(files);
}
