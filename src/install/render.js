import { accessSync, constants, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { PROJECT_CONFIG, readConfigFile, checkConfig } from '../config/load.js';
import { loadRegistry } from '../config/registry.js';
import { topLevel } from '../store/git.js';
import { buildBundle } from '../adapters/bundle.js';
import { ADAPTER, instructionBlock, interactiveDenies, interactivePath, isManaged, isMiraiName, renderAgent } from '../adapters/claude-code.js';
import { LOCK_FILE, checkLock, entriesHash, filesUnder, readLock, renderedHash, settingsHash, updateLock, replaceFile, noLinks, sha256 } from './lock.js';
import { AGENTS_WARN_BYTES, BlockError, blockOf, localInstructions, renderBlock, withBlock } from './agents-block.js';

// The rendered files (units 10 and 11; D-37): made from the framework copy plus your own files,
// and listed in the lock as `rendered`, with the hash of what MIRAI owns and of each input:
// - AGENTS.md's MIRAI block (unit 10);
// - CLAUDE.md's MIRAI block, which imports AGENTS.md, and the launch bundle's skills and agents
//   under .claude/ (unit 11);
// - MIRAI's hard denies in .claude/settings.json, merged into yours (unit 13c).
// `init` renders them first; `mirai render` renders them again from the installed framework
// copy, after you changed `.mirai/config.toml` or `.mirai/context/agents-local.md`.

export const AGENTS_FILE = 'AGENTS.md';
export const LOCAL_FILE = '.mirai/context/agents-local.md';
export const REGISTRY_DIR = '.mirai/framework/registry';
export const AGENTS_TEMPLATE = `${REGISTRY_DIR}/templates/agents-block.md`;
const CONFIG_FILE = PROJECT_CONFIG.split('\\').join('/');

// An instruction file as it is: { bytes, text, mode }, or null when there is none. Refused
// before anything is written: a symbolic link (except, with `linkTo`, one to that file, which
// gives { linked: true }), not a file, text that isn't UTF-8 (it couldn't be written back byte
// for byte), and a file or folder MIRAI can't write.
export function readInstructions(root, file, { linkTo, hint } = {}) {
  const path = join(root, file);
  let info;
  try {
    info = lstatSync(path);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    writable(root, '.');
    return null;
  }
  if (info.isSymbolicLink()) {
    // A link to `linkTo` is accepted even before that file exists (init is about to write it).
    if (linkTo && resolve(dirname(path), readlinkSync(path)) === join(root, linkTo)) return { linked: true };
    if (linkTo && existsSync(path) && existsSync(join(root, linkTo)) && realpathSync(path) === realpathSync(join(root, linkTo))) return { linked: true };
    throw new BlockError(`${file} is a symbolic link`, { code: 'symlink', hint });
  }
  if (!info.isFile()) throw new BlockError(`${file} is not a file`, { code: 'not-file' });
  const bytes = readFileSync(path);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new BlockError(`${file} is not UTF-8 text`, { code: 'not-utf8', hint: 'save it as UTF-8' });
  writable(root, '.');
  writable(root, file);
  return { bytes, text, mode: info.mode & 0o777 };
}

export const readAgents = (root) => readInstructions(root, AGENTS_FILE, { hint: 'if it points to CLAUDE.md, make AGENTS.md the real file and CLAUDE.md the link' });

function writable(root, rel) {
  try {
    accessSync(join(root, rel), constants.W_OK);
  } catch {
    throw new BlockError(`${rel === '.' ? 'the repo folder' : rel} can't be written`, { code: 'not-writable', hint: 'check its permissions' });
  }
}

// AGENTS.md with MIRAI's block rendered: { text, entry, warning? }. `template` and `local` are
// the inputs' bytes (`local` null when there is no agents-local.md); `config` the checked
// config, with its file's bytes as `configBytes`.
export function renderAgents({ template, local, config, configBytes, existing }) {
  const docsRoot = config.docs.root;
  // The docs root is shown in a code span; a backtick in it would end the span early.
  if (docsRoot.includes('`')) throw new BlockError('the docs root has a backtick in it, which the AGENTS.md block can\'t show', { code: 'docs-root-backtick', hint: 'rename the folder in [docs] root' });
  const frame = template.toString('utf8').replaceAll('{docs_root}', () => docsRoot);
  const body = renderBlock(frame, local === null ? '' : localInstructions(local.toString('utf8')));
  const text = withBlock(existing === null ? null : existing.text, body);
  const from = sortByPath([
    { path: AGENTS_TEMPLATE, sha256: sha256(template) },
    { path: CONFIG_FILE, sha256: sha256(configBytes) },
    ...(local === null ? [] : [{ path: LOCAL_FILE, sha256: sha256(local) }]),
  ]);
  const size = Buffer.byteLength(text, 'utf8');
  return {
    text,
    entry: { path: AGENTS_FILE, mark: 'rendered', block: 'mirai', sha256: sha256(blockOf(text)), from },
    warning: size > AGENTS_WARN_BYTES ? `${AGENTS_FILE} is ${size} bytes; some tools read only the first ${AGENTS_WARN_BYTES} (Codex), so keep it shorter` : undefined,
  };
}

const sortByPath = (list) => list.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

// What rendering would do, without doing it: { writes: [{ path, data, existing }], removes:
// [{ path, existing }], entries, removed (lock paths), files: [{ path, changed, edited }],
// warnings }. `registryDir` is the registry to render from (the staged copy during `init`, the
// installed one for `mirai render`); `lock` the current lock, or null on a first install.
export function renderPlan({ root, registryDir, config, configBytes, local, lock }) {
  const registry = loadRegistry(registryDir);
  const profile = registry.adapters[ADAPTER];
  if (!profile) throw new BlockError(`the framework copy's registry has no ${ADAPTER} adapter (it's older than unit 11)`, { code: 'no-adapter', hint: 'run: mirai init --refresh' });
  const inRegistry = (rel) => ({ path: `${REGISTRY_DIR}/${rel}`, sha256: sha256(readFileSync(join(registryDir, rel))) });
  const plan = { writes: [], removes: [], entries: [], removed: [], files: [], warnings: [], bundles: {} };
  const listed = (path) => lock?.files.get(path);
  // `same`: whether the file on disk already is what MIRAI would write.
  const add = (path, data, entry, existing, editedHash, same = existing !== null && Buffer.from(data).equals(existing.bytes)) => {
    const before = listed(path);
    plan.writes.push({ path, data, existing, changed: !same });
    plan.entries.push(entry);
    plan.files.push({ path, changed: !same, edited: Boolean(before && existing && editedHash !== null && editedHash !== before.sha256) });
  };

  // AGENTS.md.
  const agentsNow = readAgents(root);
  const agents = renderAgents({ template: readFileSync(join(registryDir, 'templates', 'agents-block.md')), local, config, configBytes, existing: agentsNow });
  add(AGENTS_FILE, agents.text, agents.entry, agentsNow, agentsNow && blockOf(agentsNow.text) !== null ? sha256(blockOf(agentsNow.text)) : null);
  if (agents.warning) plan.warnings.push(agents.warning);

  // CLAUDE.md: MIRAI's block imports AGENTS.md. A CLAUDE.md that links to AGENTS.md is left
  // alone: Claude Code then reads AGENTS.md itself.
  const file = profile.instructions.file;
  const claudeNow = readInstructions(root, file, { linkTo: AGENTS_FILE, hint: 'MIRAI accepts a CLAUDE.md that links to AGENTS.md; any other link is refused' });
  if (claudeNow?.linked) {
    if (listed(file)) plan.removed.push(file);
  } else {
    const text = withBlock(claudeNow === null ? null : claudeNow.text, instructionBlock(profile), { file });
    if (claudeNow) {
      const outside = claudeNow.text.split(/\r?\n/).filter((l) => l.trim() === profile.instructions.import);
      const inBlock = blockOf(claudeNow.text, { file })?.split('\n').filter((l) => l.trim() === profile.instructions.import) ?? [];
      if (outside.length > inBlock.length) plan.warnings.push(`${file} already has its own ${profile.instructions.import} line, so AGENTS.md is imported twice; remove yours`);
    }
    const entry = { path: file, mark: 'rendered', block: 'mirai', sha256: sha256(blockOf(text, { file })), from: [inRegistry(registry.adapterFiles[ADAPTER])] };
    add(file, text, entry, claudeNow, claudeNow && blockOf(claudeNow.text, { file }) !== null ? sha256(blockOf(claudeNow.text, { file })) : null);
  }

  // Your interactive sessions' settings (unit 13c): MIRAI's hard denies merged into the file, the
  // rest of it left as it is. Denies MIRAI added before and no longer ships are taken out; yours
  // are never touched. The lock lists MIRAI's entries, not the whole file's hash.
  const settingsPath = profile.later?.settings;
  if (settingsPath) {
    noLinks(root, settingsPath);
    const abs = join(root, settingsPath);
    let existing = null;
    let value = {};
    if (existsSync(abs)) {
      if (!lstatSync(abs).isFile()) throw new BlockError(`${settingsPath} is not a file`, { code: 'not-file' });
      const bytes = readFileSync(abs);
      try {
        value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      } catch {
        throw new BlockError(`${settingsPath} isn't valid JSON, so MIRAI can't add its rules to it`, { code: 'bad-settings', hint: 'fix it, then run: mirai render' });
      }
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new BlockError(`${settingsPath} isn't a JSON object`, { code: 'bad-settings', hint: 'fix it, then run: mirai render' });
      if (value.permissions !== undefined && (value.permissions === null || typeof value.permissions !== 'object' || Array.isArray(value.permissions))) {
        throw new BlockError(`${settingsPath}: permissions isn't an object`, { code: 'bad-settings', hint: 'fix it, then run: mirai render' });
      }
      if (value.permissions?.deny !== undefined && !Array.isArray(value.permissions.deny)) {
        throw new BlockError(`${settingsPath}: permissions.deny isn't a list`, { code: 'bad-settings', hint: 'fix it, then run: mirai render' });
      }
      existing = { bytes };
    }
    const entries = interactiveDenies(registry);
    const before = listed(settingsPath)?.entries ?? [];
    const kept = Array.isArray(value.permissions?.deny) ? value.permissions.deny.filter((e) => !before.includes(e) || entries.includes(e)) : [];
    const deny = [...kept, ...entries.filter((e) => !kept.includes(e))];
    const next = { ...value, permissions: { ...(value.permissions ?? {}), deny } };
    const text = `${JSON.stringify(next, null, 2)}\n`;
    const same = existing !== null && JSON.stringify(value) === JSON.stringify(next);
    const from = sortByPath([inRegistry(registry.adapterFiles[ADAPTER]), ...Object.values(registry.agentFiles).map(inRegistry)]);
    const editedHash = existing && before.length ? settingsHash(existing.bytes.toString('utf8'), before) : null;
    add(settingsPath, text, { path: settingsPath, mark: 'rendered', block: 'mirai-settings', sha256: entriesHash(entries), entries, from }, existing, editedHash, same);
  }

  // The launch bundle's skills and agents, under .claude/.
  for (const dir of [profile.interactive.skills, profile.interactive.agents]) noLinks(root, dir);
  const bundle = buildBundle(registry, { models: config.models, renderAgent });
  plan.bundles[ADAPTER] = bundle.sharedHash;
  const paths = new Set();
  for (const f of bundle.files) {
    const path = interactivePath(profile, f.path);
    paths.add(path);
    noLinks(root, path);
    const existing = existsSync(join(root, path)) ? { bytes: readFileSync(join(root, path)) } : null;
    if (existing && !lstatSync(join(root, path)).isFile()) throw new BlockError(`${path} is not a file`, { code: 'not-file' });
    const from = sortByPath(f.from.map((rel) => (rel === 'config' ? { path: CONFIG_FILE, sha256: sha256(configBytes) } : inRegistry(rel))));
    // Hashed with CRLF read as LF, so a teammate's converted checkout isn't an edit.
    const now = existing ? renderedHash(existing.bytes) : null;
    add(path, f.bytes, { path, mark: 'rendered', sha256: renderedHash(f.bytes), from }, existing, now, now === renderedHash(f.bytes));
  }
  // A MIRAI-named file the lock doesn't list isn't MIRAI's to overwrite.
  for (const path of managedOnDisk(root, profile)) {
    if (!listed(path)) throw new BlockError(`${path} isn't listed in ${LOCK_FILE}, so MIRAI won't overwrite or remove it`, { code: 'conflict', hint: 'rename it (mirai-* names are MIRAI\'s), or remove it' });
  }
  // A rendered file no longer in the bundle goes, with its lock entry.
  for (const f of lock?.files.values() ?? []) {
    if (f.mark !== 'rendered' || !isManaged(profile, f.path) || paths.has(f.path)) continue;
    plan.removed.push(f.path);
    noLinks(root, f.path);
    if (!existsSync(join(root, f.path))) continue;
    if (!lstatSync(join(root, f.path)).isFile()) throw new BlockError(`${f.path} is not a file`, { code: 'not-file' });
    const bytes = readFileSync(join(root, f.path));
    if (renderedHash(bytes) !== f.sha256) plan.warnings.push(`${f.path}: edited by hand, and removed (MIRAI no longer ships it); git has your version`);
    plan.removes.push({ path: f.path, existing: { bytes } });
  }
  plan.folders = [profile.interactive.skills, profile.interactive.agents];
  return plan;
}

// MIRAI-named files under the interactive folders, as they are on disk.
function managedOnDisk(root, profile) {
  const out = [];
  for (const dir of [profile.interactive.skills, profile.interactive.agents]) {
    let names = [];
    try {
      names = readdirSync(join(root, dir));
    } catch (err) {
      if (err.code === 'ENOTDIR') throw new BlockError(`${dir} is not a folder`, { code: 'not-folder' });
      if (err.code !== 'ENOENT') throw err;
    }
    for (const name of names.filter(isMiraiName).sort()) {
      const rel = `${dir}/${name}`;
      noLinks(root, rel);
      if (lstatSync(join(root, rel)).isDirectory()) out.push(...filesUnder(root, rel));
      else out.push(rel);
    }
  }
  return out;
}

// Carries out a plan. Returns the undo steps, newest last; on a failure partway it undoes what
// it did and rethrows.
export function applyPlan(root, plan, undo = []) {
  const start = undo.length;
  const stops = new Set(plan.folders ?? []);
  try {
    for (const w of plan.writes) {
      if (!w.changed) continue;
      makeParents(root, w.path, undo);
      const path = join(root, w.path);
      // The undo step goes in once the write is done: replaceFile is all or nothing.
      replaceFile(path, w.data, w.existing?.mode);
      undo.push(step(w.path, w.existing === null ? () => rmSync(path, { force: true }) : () => replaceFile(path, w.existing.bytes, w.existing.mode)));
    }
    for (const r of plan.removes) {
      const path = join(root, r.path);
      rmSync(path);
      undo.push(step(r.path, () => { mkdirSync(dirname(path), { recursive: true }); replaceFile(path, r.existing.bytes); }));
      pruneEmpty(root, dirname(r.path), stops);
    }
  } catch (err) {
    undoAll(undo.splice(start), err);
    throw err;
  }
  return undo;
}

// An undo step, named by the path it puts back.
const step = (label, fn) => Object.assign(fn, { label });

// Runs undo steps newest first; one failing doesn't stop the others. The first error stays the
// one reported, naming what's left.
export function undoAll(steps, err) {
  const failed = [];
  for (const step of steps.reverse()) {
    try {
      step();
    } catch (undoErr) {
      failed.push(step.label ?? undoErr.message);
    }
  }
  if (failed.length) err.message = `${err.message} (undoing it failed for ${failed.join(', ')}; remove what's left by hand)`;
}

function makeParents(root, rel, undo) {
  const parts = rel.split('/').slice(0, -1);
  let p = root;
  for (const part of parts) {
    p = join(p, part);
    if (existsSync(p)) continue;
    mkdirSync(p);
    const made = p;
    undo.push(step(made, () => rmSync(made, { recursive: true, force: true })));
  }
}

// Removes now-empty folders left by a removed file, up to (not including) the tool's own folders
// (`stops`).
function pruneEmpty(root, rel, stops) {
  for (let dir = rel; dir !== '.' && !stops.has(dir); dir = dirname(dir)) {
    try {
      rmdirSync(join(root, dir));
    } catch {
      return;
    }
  }
}

// `mirai render`: renders the rendered files again from the installed framework copy and your
// files, and updates their lock entries. Returns { root, lockFile, files: [{ path, changed,
// edited }], removed, warnings }: `edited` when MIRAI's part had been changed by hand (it's
// replaced).
export function render({ cwd, env }) {
  const top = topLevel(cwd, env);
  if (!top) throw new MiraiError('this folder is not inside a git repository', EXIT.BLOCKED);
  const root = realpathSync(top);
  const lock = readLock(root);
  if (!lock) throw new BlockError('MIRAI is not installed here (no lock)', { code: 'no-lock', hint: 'run: mirai init' });

  // Everything is rendered from the framework copy, so it must be the framework's, as listed.
  const check = checkLock(root);
  const framework = [...check.changed, ...check.missing].filter((p) => lock.files.get(p)?.mark === 'framework').concat(check.added);
  if (framework.length) {
    throw new BlockError(`the framework copy isn't MIRAI's as listed (${framework.slice(0, 3).join(', ')}${framework.length > 3 ? ', …' : ''})`, { code: 'framework-changed', hint: 'restore it from git: git checkout -- .mirai' });
  }
  const { configBytes, config, local } = projectInputs(root);
  const plan = renderPlan({ root, registryDir: join(root, REGISTRY_DIR), config, configBytes, local, lock });
  const undo = [];
  try {
    applyPlan(root, plan, undo);
    const changed = plan.files.some((f) => f.changed) || plan.removed.length > 0;
    const entriesChanged = plan.entries.some((e) => JSON.stringify(lock.files.get(e.path)) !== JSON.stringify(e));
    const bundlesChanged = Object.entries(plan.bundles).some(([k, v]) => lock.bundles[k] !== v);
    if (changed || entriesChanged || bundlesChanged) updateLock(root, plan.entries, { remove: plan.removed, bundles: plan.bundles });
  } catch (err) {
    undoAll(undo, err);
    throw err;
  }
  return { root, lockFile: LOCK_FILE, files: plan.files, removed: plan.removed, warnings: plan.warnings };
}

// Your files that rendering reads: the config (checked) and agents-local.md (null when absent).
export function projectInputs(root, configPath = join(root, CONFIG_FILE)) {
  noLinks(root, CONFIG_FILE);
  const configBytes = readFileSync(configPath);
  const config = checkConfig([{ kind: 'project', file: readConfigFile(configPath, { trust: 'project', source: CONFIG_FILE, within: root }) }]).config;
  noLinks(root, LOCAL_FILE);
  const local = existsSync(join(root, LOCAL_FILE)) ? readFileSync(join(root, LOCAL_FILE)) : null;
  return { configBytes, config, local };
}
