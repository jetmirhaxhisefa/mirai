import { openSync, fstatSync, readFileSync, closeSync, realpathSync, constants } from 'node:fs';
import { join, sep } from 'node:path';
import { homedir } from 'node:os';

import { ConfigError } from '../cli/errors.js';
import { parseToml, LIMITS } from './toml.js';
import { validate, safePath } from './schema.js';
import { CONFIG_SCHEMA, LAYER_KEYS } from './config-schema.js';
import { frameworkDefaults, PRESETS, TIER_FAMILIES, JUDGEMENT_STEPS } from './defaults.js';
import { findTokenShapes } from './credentials.js';
import { allowEntryProblem } from './git-repo-keys.js';
import { deepFreeze } from '../util/freeze.js';

// Loading config (unit 03b). Four layers, later ones win: framework defaults ← project
// (.mirai/config.toml) ← personal for this repo ← personal global (~/.config/mirai/config.toml).

export const PROJECT_CONFIG = join('.mirai', 'config.toml');
export const SCHEMA_VERSION = 1;

export function globalConfigPath(home = homedir()) {
  return join(home, '.config', 'mirai', 'config.toml');
}

function fileError(source, reason, code, hint) {
  return new ConfigError(`${source}: ${reason}`, { source, reason, hint, code });
}

// The only way to read a config or definition file. Returns `{ value, positions, source }`,
// or null for a missing optional file.
// - `trust: 'project' | 'definition'` (shared files): a symlink is refused, atomically
//   (O_NOFOLLOW), and with `within` the real path must stay inside that folder, so a symlinked
//   folder on the way can't lead outside the repo either.
// - `trust: 'personal'` (your own files): symlinks are followed (dotfile setups).
// The size is checked on the open file before reading, and the parser gets bytes.
export function readConfigFile(path, { trust, source = path, optional = false, within }) {
  const shared = trust !== 'personal';
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (shared ? constants.O_NOFOLLOW : 0));
  } catch (err) {
    if (err.code === 'ENOENT') {
      if (optional) return null;
      throw fileError(source, 'file not found', 'not-found', source.endsWith('config.toml') ? 'run mirai init in the repo first' : undefined);
    }
    if (err.code === 'ELOOP') throw fileError(source, 'is a symbolic link', 'symlink', 'shared config and definition files must be real files');
    if (err.code === 'EISDIR') throw fileError(source, 'is not a file', 'not-file');
    throw fileError(source, `can't be read (${err.code})`, 'unreadable');
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) throw fileError(source, 'is not a file', 'not-file');
    if (info.size > LIMITS.bytes) throw fileError(source, `file is larger than ${LIMITS.bytes} bytes`, 'too-large');
    if (within) {
      const root = realpathSync(within);
      if (!realpathSync(path).startsWith(root + sep)) {
        throw fileError(source, 'is outside its folder', 'outside', 'a symbolic link on the way leads outside the repo');
      }
    }
    const { value, positions } = parseToml(readFileSync(fd), { source, positions: true });
    return { value, positions, source };
  } finally {
    closeSync(fd);
  }
}

// Reads the layers from disk and checks them. `personalRepoFile` comes from the MIRAI home
// (unit 05); until then it's only used when passed in.
export function loadConfig({ projectRoot, personalRepoFile, globalFile = globalConfigPath() }) {
  return checkConfig([
    { kind: 'project', file: readConfigFile(join(projectRoot, PROJECT_CONFIG), { trust: 'project', source: PROJECT_CONFIG, within: projectRoot }) },
    { kind: 'personal-repo', file: personalRepoFile ? readConfigFile(personalRepoFile, { trust: 'personal', optional: true }) : null },
    { kind: 'personal-global', file: readConfigFile(globalFile, { trust: 'personal', source: '~/.config/mirai/config.toml', optional: true }) },
  ]);
}

// Checks already-parsed layers (`{ kind, file: { value, positions, source } | null }`) and
// returns `{ config, sources, warnings }`: the frozen config, and a frozen object from key path to
// `{ source, line, column, type }` or `{ source: 'default' | 'preset:<name>' }`. Separate from
// file reading so the trust root (unit 12) can check config taken from git, not the work tree.
export function checkConfig(layers) {
  const problems = [];
  const config = frameworkDefaults();
  const meta = new Map();

  for (const { kind, file } of layers) {
    if (!file) continue;
    problems.push(...checkVersion(kind, file));
    for (const path of findTokenShapes(file.value)) {
      problems.push(problemAt(file, path, 'credential', `${safePath(path)} looks like it contains a credential`, 'keep links and names only; log in through the tool itself'));
    }
    const allowed = filterLayer(kind, file, problems);
    merge(config, allowed, '', file, meta);
  }

  const project = layers.find((l) => l.kind === 'project')?.file;
  const fallback = { source: project?.source ?? PROJECT_CONFIG, line: 1, column: 1, type: undefined };
  const locate = (path) => {
    for (let p = path; ; p = parentOf(p)) {
      if (meta.has(p)) return meta.get(p);
      if (p === '') return fallback;
    }
  };
  // schema_version was checked in each file above; the merged value needs no second check.
  const { schema_version: _version, ...rest } = config;
  problems.push(...validate(rest, CONFIG_SCHEMA, locate));

  const unique = dedupe(problems);
  if (unique.length > 0) {
    unique.sort((a, b) => order(a.source) - order(b.source) || a.source.localeCompare(b.source) || a.line - b.line || a.column - b.column);
    const n = unique.length;
    throw new ConfigError(`${n} problem${n === 1 ? '' : 's'} in config`, { errors: unique });
  }

  // The gate leaves the docs root out of the code paths by default (design/04): the default follows
  // `docs.root` unless a file sets `gate.code_paths` itself (unit 07b).
  if (!meta.has('gate.code_paths')) config.gate.code_paths = ['**', `!${config.docs.root}/**`, '!.mirai/**'];

  const presetGates = PRESETS[config.preset];
  config.gates = { ...presetGates, ...(config.gates ?? {}) };
  for (const stage of Object.keys(presetGates)) {
    if (!meta.has(`gates.${stage}`)) meta.set(`gates.${stage}`, { source: `preset:${config.preset}` });
  }
  const sources = sourcesOf(config, meta);
  return { config: deepFreeze(config), sources: deepFreeze(sources), warnings: deepFreeze(tierWarnings(config, sources)) };
}

// You may map any model to any tier (D-58); a model outside its tier's usual family is made
// visible, with what runs on that tier. Model IDs are not secrets, so they are shown.
function tierWarnings(config, sources) {
  const warnings = [];
  for (const [tier, family] of Object.entries(TIER_FAMILIES)) {
    const model = config.models[tier];
    if (family.pattern.test(model)) continue;
    const from = sources[`models.${tier}`];
    const where = from.line ? `${from.source}:${from.line}:${from.column}` : from.source;
    const runs = tier === 'deep' ? `${JUDGEMENT_STEPS.join(', ')} and every other deep step` : `every ${tier} step`;
    warnings.push({
      code: 'tier-family',
      path: `models.${tier}`,
      message: `the ${tier} tier uses ${model} (set in ${where}), not ${family.label}; ${runs} will run on it`,
    });
  }
  return warnings;
}

// The project file must say which schema it uses; personal files may, and must match.
function checkVersion(kind, file) {
  const v = file.value.schema_version;
  const at = file.positions.get('schema_version') ?? { line: 1, column: 1 };
  if (v === undefined) {
    if (kind !== 'project') return [];
    return [{ code: 'required', source: file.source, line: 1, column: 1, path: 'schema_version', reason: 'schema_version is required', hint: 'add schema_version = 1 at the top of .mirai/config.toml' }];
  }
  if (v !== SCHEMA_VERSION || at.type !== 'integer') {
    return [{ code: 'version', source: file.source, line: at.line, column: at.column, path: 'schema_version', reason: `schema_version must be ${SCHEMA_VERSION}`, hint: `this MIRAI version reads schema version ${SCHEMA_VERSION}` }];
  }
  return [];
}

function problemAt(file, path, code, reason, hint) {
  let at;
  for (let p = path; !at; p = parentOf(p)) {
    at = file.positions.get(p) ?? (p === '' ? { line: 1, column: 1 } : undefined);
  }
  return { code, source: file.source, line: at.line, column: at.column, path: safePath(path), reason, hint };
}

// Keeps only what this layer may set (LAYER_KEYS), reporting the rest.
function filterLayer(kind, file, problems) {
  const rules = LAYER_KEYS[kind];
  const allows = (path) => rules.some((r) => r === path || (r.endsWith('.*') && (path === r.slice(0, -2) || path.startsWith(r.slice(0, -1)))));
  const leadsTo = (path) => rules.some((r) => r.startsWith(`${path}.`));
  const isTable = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const keep = (value, prefix) => {
    const out = {};
    for (const key of Object.keys(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (allows(path)) out[key] = value[key];
      else if (leadsTo(path) && isTable(value[key])) out[key] = keep(value[key], path);
      else problems.push(problemAt(file, path, 'layer', ...layerMessage(kind, path)));
    }
    return out;
  };
  return keep(file.value, '');
}

function layerMessage(kind, path) {
  const shown = safePath(path);
  if (kind === 'project') return [`${shown} is a personal setting`, shown.startsWith('git.') ? `move ${shown} to [git] in ~/.config/mirai/config.toml` : `move [${shown.split('.')[0]}] to ~/.config/mirai/config.toml`];
  return [
    `${shown} can't be set in a personal file`,
    kind === 'personal-global' ? 'this file holds only [subscription], [usage], git.allow_repo_config and tests.max_parallel' : 'this file holds only models.light, models.standard, models.deep and run.stop_by',
  ];
}

const order = (source) => (source === PROJECT_CONFIG ? 0 : source.startsWith('~/') ? 2 : 1);

function dedupe(problems) {
  const seen = new Set();
  return problems.filter((p) => {
    const key = `${p.source}|${p.path}|${p.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parentOf(path) {
  return path.slice(0, Math.max(path.lastIndexOf('.'), path.lastIndexOf('['), 0));
}

const isTable = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Merges one layer into the config: tables key by key, everything else (arrays too) replaced
// whole. Positions are copied with the file's name.
function merge(target, source, prefix, file, meta) {
  for (const key of Object.keys(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = source[key];
    if (isTable(value) && isTable(target[key])) {
      merge(target[key], value, path, file, meta);
    } else {
      for (const k of [...meta.keys()]) if (k.startsWith(`${path}.`) || k.startsWith(`${path}[`)) meta.delete(k);
      target[key] = plain(value);
      for (const [p, at] of file.positions) {
        if (p === path || p.startsWith(`${path}.`) || p.startsWith(`${path}[`)) meta.set(p, { source: file.source, ...at });
      }
    }
    if (!meta.has(path)) {
      const at = file.positions.get(path);
      if (at) meta.set(path, { source: file.source, ...at });
    }
  }
}

// Copies parsed data into ordinary objects and arrays (the parser's tables have no prototype).
function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (isTable(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}

// Every leaf path of the config with where it came from.
function sourcesOf(config, meta) {
  const out = {};
  const walk = (value, path) => {
    if (isTable(value)) {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
      return;
    }
    if (Array.isArray(value) && value.some((v) => isTable(v) || Array.isArray(v))) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    out[path] = meta.get(path) ?? { source: 'default' };
  };
  walk(config, '');
  return out;
}

// `[git] allow_repo_config` from your personal global file alone (unit 14b), for pinned git,
// which runs before (and without) the rest of the config. Only that key is read and checked
// here; the whole file is checked wherever the full config is loaded.
export function personalRepoConfigAllow(home) {
  if (!home) return [];
  const source = '~/.config/mirai/config.toml';
  const file = readConfigFile(globalConfigPath(home), { trust: 'personal', source, optional: true });
  const list = file?.value?.git?.allow_repo_config;
  if (list === undefined) return [];
  const at = file.positions.get('git.allow_repo_config') ?? { line: 1, column: 1 };
  const fail = (reason) => new ConfigError(`${source}:${at.line}:${at.column}: ${reason}`, { source, line: at.line, column: at.column, path: 'git.allow_repo_config', reason, code: 'repo-config' });
  if (!Array.isArray(list) || !list.every((e) => typeof e === 'string')) throw fail('git.allow_repo_config must be a list of strings');
  for (const entry of list) {
    const problem = allowEntryProblem(entry);
    if (problem) throw fail(`git.allow_repo_config: ${problem}`);
  }
  return list;
}

// `[tests] max_parallel` from your personal global file alone (unit 14d): how many test runs may
// run at once across all your projects. 1–8, default 2.
export const DEFAULT_MAX_PARALLEL = 2;
export function personalMaxParallel(home) {
  if (!home) return DEFAULT_MAX_PARALLEL;
  const source = '~/.config/mirai/config.toml';
  const file = readConfigFile(globalConfigPath(home), { trust: 'personal', source, optional: true });
  const value = file?.value?.tests?.max_parallel;
  if (value === undefined) return DEFAULT_MAX_PARALLEL;
  if (!Number.isInteger(value) || value < 1 || value > 8) {
    const at = file.positions.get('tests.max_parallel') ?? { line: 1, column: 1 };
    const reason = 'tests.max_parallel must be a whole number from 1 to 8';
    throw new ConfigError(`${source}:${at.line}:${at.column}: ${reason}`, { source, line: at.line, column: at.column, path: 'tests.max_parallel', reason, code: 'range' });
  }
  return value;
}
