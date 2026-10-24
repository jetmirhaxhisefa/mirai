import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join, posix } from 'node:path';

import { changedNames, catBlobs, ignoredNames, lsFiles, lsTree, mergeBase } from '../store/git.js';
import { sha256 } from '../install/lock.js';
import { matches } from '../util/glob.js';
import { parseJsonStrict } from '../findings/schema.js';
import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { INSTRUCTION_FILES, importClosure } from './imports.js';

// Protected paths (unit 12; D-15, D-54, R3-M2). A change that touches a file able to change
// MIRAI's rules, hide code from review, or run on its own is forced to high risk:
// - `protected`: high risk; the ticket parks only when the plan didn't declare the path;
// - `auto-run`: runs by itself when you open or install the branch (.vscode/, .husky/, install
//   scripts, …): high risk, and always parks, in both presets (D-54).
// The rules are data (registry/protected-paths/: a core that's always on, and ecosystem packs a
// project switches on), read from the trust root, plus the project's additions in [gate]
// protected and its E2E paths ([testing] e2e_paths, changed only by QA).

// The registry role whose files the E2E tests are (D-44): only it may change them.
export const E2E_ROLE = 'qa';

// Every rule that applies, and the install-script checks: { rules: [{ name, class, paths,
// except? }], scripts: [{ name, file, field, keys }] }. The core is always on; a pack only when
// the project lists it in [gate] packs. `registry` and `config` come from the trust root, so a
// branch can't loosen them.
export function protectionRules(registry, config) {
  const defs = Object.values(registry.protectedPaths);
  const packs = config.gate?.packs ?? [];
  for (const name of packs) {
    if (!defs.some((d) => d.scope === 'pack' && d.name === name)) {
      throw new MiraiError(`[gate] packs names "${name}", which isn't one of MIRAI's packs (${defs.filter((d) => d.scope === 'pack').map((d) => d.name).join(', ')})`, EXIT.CONFIG);
    }
  }
  const used = defs.filter((d) => d.scope === 'core' || packs.includes(d.name));
  const rules = used.flatMap((d) => d.rules.map((r) => ({ name: r.name, class: r.class, paths: [...r.paths] })));
  if (config.gate?.protected?.length) rules.push({ name: 'project', class: 'protected', paths: [...config.gate.protected] });
  if (config.testing?.e2e_paths?.length) rules.push({ name: 'e2e', class: 'protected', paths: [...config.testing.e2e_paths], except: E2E_ROLE });
  const scripts = used.flatMap((d) => (d.scripts ?? []).map((c) => ({ name: `${d.name}-install-scripts`, file: c.file, field: c.field, keys: [...c.keys] })));
  return { rules, scripts };
}

// A file that exists but can't be read as content (a symbolic link, too large): never taken for
// "absent", so a check on its content counts it as changed.
export const UNREADABLE = Symbol('unreadable');
const MAX_READ = 1024 * 1024;

// What a change is made of: { from, changes (paths), read(side, path) -> Buffer | null (absent)
// | UNREADABLE, link(side, path) -> target | null, instructionFiles(side) -> paths }. The change
// runs from where it left `base` (the merge-base) to commit `head`, or to the work tree when
// `head` is omitted (after an agent launch), so later commits on the base don't count.
//
// In the work tree, files git ignores matter too (an agent could plant a `.vscode/` that git
// never shows): with `rules`, the ignored files and folders under a protected path are
// fingerprinted (`ignoredFingerprint`). Given `ignoredBefore` (taken before the agent's
// launch, unit 19), those that changed are part of the change; without it they're only
// listed, as `ignoredPresent`, since your own ignored files (an `.idea/`) are no agent's change.
export function changeOf({ root, env, base, head, rules, ignoredBefore }) {
  const from = mergeBase(root, base, head ?? 'HEAD', env) ?? base;
  const changes = changedNames(root, from, head, env);
  let ignored = new Set();
  let ignoredPresent = [];
  if (!head && rules) {
    const now = ignoredFingerprint({ root, env, rules });
    if (ignoredBefore) {
      for (const p of new Set([...Object.keys(now), ...Object.keys(ignoredBefore)])) if (now[p] !== ignoredBefore[p]) ignored.add(p);
      for (const p of ignored) if (!changes.includes(p)) changes.push(p);
      changes.sort();
    } else ignoredPresent = Object.keys(now).sort();
  }
  const entryAt = (rev) => {
    const cache = new Map();
    return (path) => {
      if (!cache.has(path)) cache.set(path, (lsTree(root, rev, path, env) ?? []).find((e) => e.path === path) ?? null);
      return cache.get(path);
    };
  };
  const atCommit = (rev) => {
    const entry = entryAt(rev);
    return {
      read(path) {
        const e = entry(path);
        if (!e) return null;
        if (e.type !== 'blob' || e.mode === '120000') return UNREADABLE;
        try {
          return catBlobs(root, [e.sha], env, { maxBytes: MAX_READ, maxTotal: 4 * MAX_READ }).get(e.sha) ?? UNREADABLE;
        } catch (err) {
          if (err.code === 'git-output-too-large') return UNREADABLE;
          throw err;
        }
      },
      link(path) {
        const e = entry(path);
        return e && e.mode === '120000' ? (catBlobs(root, [e.sha], env).get(e.sha)?.toString('utf8') ?? '') : null;
      },
    };
  };
  const onDisk = {
    read(path) {
      let info;
      try {
        info = lstatSync(join(root, path));
      } catch {
        return null;
      }
      return info.isFile() && info.size <= MAX_READ ? readFileSync(join(root, path)) : UNREADABLE;
    },
    link(path) {
      try {
        return lstatSync(join(root, path)).isSymbolicLink() ? readlinkSync(join(root, path)) : null;
      } catch {
        return null;
      }
    },
  };
  const sides = { base: atCommit(from), head: head ? atCommit(head) : onDisk };
  const listAt = (rev) => (lsTree(root, rev, '.', env, { recursive: true }) ?? []).map((e) => e.path);
  const instructionFiles = (side) => {
    const all = side === 'base' ? listAt(from) : head ? listAt(head) : lsFiles(root, ['.'], env) ?? [];
    return all.filter((p) => INSTRUCTION_FILES.some((f) => f.toLowerCase() === posix.basename(p).toLowerCase()));
  };
  return { from, changes, ignored, ignoredPresent, read: (side, path) => sides[side].read(path), link: (side, path) => sides[side].link(path), instructionFiles };
}

// The ignored files and folders of the work tree that a rule covers, with a fingerprint each:
// { path: hash }. A folder's fingerprint covers every name, link target and file inside it.
export function ignoredFingerprint({ root, env, rules: { rules } }) {
  const out = {};
  for (const entry of ignoredNames(root, env)) {
    const path = entry.replace(/\/$/, '');
    if (!rules.some((r) => r.paths.some((p) => matches(p, path)))) continue;
    out[path] = fingerprint(join(root, path));
  }
  return out;
}

function fingerprint(abs, budget = { files: 10_000 }) {
  let info;
  try {
    info = lstatSync(abs);
  } catch {
    return 'missing';
  }
  if (info.isSymbolicLink()) return `link:${readlinkSync(abs)}`;
  if (info.isFile()) return `file:${sha256(readFileSync(abs))}`;
  if (!info.isDirectory()) return 'other';
  const parts = [];
  for (const name of readdirSync(abs).sort()) {
    if (--budget.files < 0) return `too-large:${info.mtimeMs}`;
    parts.push(`${name}\0${fingerprint(join(abs, name), budget)}`);
  }
  return `dir:${sha256(parts.join('\n'))}`;
}

// Which changed paths are protected, and what follows: { risk ('high' or null), touched:
// [{ path, class, rules }], autoRun (paths), undeclared (paths), instructionFiles (paths among
// the touched that reach an agent's context: unit 24 blocks those in supervised mode too),
// needsYou }. `needsYou` is true when an auto-run path or an undeclared protected path is
// touched: units 20 and 23 park the ticket in autonomous mode and stop the run in supervised
// mode (D-15). `declared`: the paths the approved plan said it would touch (R3-M2); `actor`:
// the agent's registry role, for rules with an exception (E2E tests are `qa`'s).
export function classify({ change, rules: { rules, scripts }, declared = [], actor }) {
  const imported = new Set();
  for (const side of ['base', 'head']) {
    const read = (path) => {
      const bytes = change.read(side, path);
      return Buffer.isBuffer(bytes) ? bytes.toString('utf8') : null;
    };
    for (const path of importClosure(change.instructionFiles(side), read)) imported.add(path);
  }
  const autoRunRules = rules.filter((r) => r.class === 'auto-run');
  const touched = [];
  for (const path of change.changes) {
    const hits = rules.filter((r) => !(r.except && r.except === actor) && r.paths.some((p) => matches(p, path))).map((r) => ({ name: r.name, class: r.class }));
    for (const c of scripts) {
      if (posix.basename(path).toLowerCase() === c.file.toLowerCase() && scriptsChanged(change.read('base', path), change.read('head', path), c)) hits.push({ name: c.name, class: 'auto-run' });
    }
    if (change.ignored?.has(path)) hits.push({ name: 'ignored-file', class: hits.some((h) => h.class === 'auto-run') ? 'auto-run' : 'protected' });
    if (imported.has(path)) hits.push({ name: 'instruction-import', class: 'protected' });
    // A symbolic link can stand in for any protected folder or file, so every added, changed
    // or removed link counts; one that points into an auto-run path runs by itself too.
    for (const side of ['base', 'head']) {
      const target = change.link(side, path);
      if (target === null) continue;
      const resolved = posix.normalize(posix.join(posix.dirname(path), target));
      hits.push({ name: 'symbolic-link', class: autoRunRules.some((r) => r.paths.some((p) => matches(p, resolved))) ? 'auto-run' : 'protected' });
    }
    if (hits.length === 0) continue;
    touched.push({ path, class: hits.some((h) => h.class === 'auto-run') ? 'auto-run' : 'protected', rules: [...new Set(hits.map((h) => h.name))] });
  }
  // Declared paths are exact paths: a pattern would let a plan declare whole folders.
  const isDeclared = (path) => declared.includes(path);
  const autoRun = touched.filter((t) => t.class === 'auto-run').map((t) => t.path);
  const undeclared = touched.filter((t) => !isDeclared(t.path)).map((t) => t.path);
  const instructionFiles = touched.filter((t) => t.rules.some((r) => r === 'instruction-files' || r === 'instruction-import')).map((t) => t.path);
  return { risk: touched.length ? 'high' : null, touched, autoRun, undeclared, instructionFiles, ignoredPresent: change.ignoredPresent ?? [], needsYou: autoRun.length > 0 || undeclared.length > 0 };
}

// Whether a JSON file's install scripts (`field`'s `keys`) differ. A file that isn't readable
// JSON on either side, or can't be read at all, counts as changed: what would run can't be told.
export function scriptsChanged(before, after, { field, keys }) {
  const scripts = (bytes) => {
    if (bytes === null) return {};
    if (!Buffer.isBuffer(bytes)) return null;
    try {
      const value = parseJsonStrict(bytes.toString('utf8'));
      return value && typeof value[field] === 'object' && value[field] !== null ? value[field] : {};
    } catch {
      return null;
    }
  };
  const a = scripts(before);
  const b = scripts(after);
  if (a === null || b === null) return true;
  return keys.some((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
}
