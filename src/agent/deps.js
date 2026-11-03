import { lstatSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { blobAt } from '../store/git.js';

// New dependencies (unit 21b; R3-C2, design/01 §7): a build may add or change only the dependencies
// its approved plan declares (`<ecosystem>:<name>` rows in Declared changes). Which files declare
// dependencies, under which keys, and which keys say where they come from is stack data
// (`[[dependencies]]` in registry/stacks/), so MIRAI names no stack here. A manifest is compared
// between the base commit and the work tree, at any depth (backend/composer.json,
// frontend/package.json):
// - a name under none of the manifest's keys at base is new (moving one between keys isn't);
// - an existing name whose spec changed (a version, a URL, an alias) is a change, declared the same
//   way, since a new spec can be another package;
// - a change to a `sources` key (overrides, repositories) needs you, always;
// - a change to the scripts the stack's named checks run (package.json's `scripts`) needs you,
//   always: a check whose script changed checks nothing;
// - a changed marker file of a stack with no dependency data (pyproject.toml, go.mod) can't be
//   checked, and needs you.
// A manifest whose every change is a declared dependency, and is otherwise as it was, is `covered`:
// the protected-path check then takes its dependency rows as declaring that path (never its lock
// files, which the plan declares itself).

const MANIFEST_MAX = 1024 * 1024;

function parsed(bytes) {
  try {
    const v = JSON.parse(bytes.toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// [[field, name, spec]] under `fields` of a manifest object, or null when one of them isn't an
// object. Per field: npm lets one key override another for the same name (21b re-review).
function specs(manifest, fields) {
  const out = [];
  for (const f of fields) {
    const v = manifest[f];
    if (v === undefined) continue;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    for (const [k, spec] of Object.entries(v)) out.push([f, k, JSON.stringify(spec)]);
  }
  return out;
}

// The manifest without its dependency keys: what must stay as it was for a covered manifest.
const without = (manifest, fields) => Object.fromEntries(Object.entries(manifest).filter(([k]) => !fields.includes(k)));

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// The work tree's copy of a manifest: a regular file at most 1 MiB, or null; `gone` when missing.
function workTreeFile(root, path) {
  try {
    const st = lstatSync(join(root, path));
    if (!st.isFile() || st.size > MANIFEST_MAX) return { bytes: null, gone: false };
    return { bytes: readFileSync(join(root, path)), gone: false };
  } catch {
    return { bytes: null, gone: true };
  }
}

// `changed`: the paths the build changed (changeOf's); `stacks`: the trust root's stack data;
// `declared`: the plan's dependency rows ("npm:left-pad"). Returns { added, changedSpecs, undeclared
// (each [{ path, dependency }]), sources, scripts (manifests whose source keys or check scripts
// changed), unreadable (manifests MIRAI can't compare), unchecked (markers of stacks with no
// dependency data), lockOnly (lock files changed with no manifest change beside them), covered
// (manifests every change of which is a declared dependency) }.
export function newDependencies({ root, env, base, changed, stacks, declared = [] }) {
  const all = Object.values(stacks);
  const entries = all.flatMap((s) => (s.dependencies ?? []).map((d) => ({ ...d, checks: (s.checks ?? []).filter((c) => c.file === d.file && c.field) })));
  const known = new Set(declared.map((d) => d.toLowerCase()));
  const out = { added: [], changedSpecs: [], undeclared: [], sources: [], scripts: [], unreadable: [], unchecked: [], lockOnly: [], covered: [] };
  const manifestsChanged = new Set();
  for (const path of changed) {
    const name = posix.basename(path);
    for (const e of entries.filter((x) => x.file === name)) {
      manifestsChanged.add(posix.dirname(path));
      const now = workTreeFile(root, path);
      if (now.gone) continue; // a manifest removed adds nothing
      const after = now.bytes && parsed(now.bytes);
      const was = blobAt(root, base, path, env, { maxBytes: MANIFEST_MAX });
      const before = was === null ? {} : parsed(was);
      const a = after && specs(after, e.fields);
      const b = before && specs(before, e.fields);
      if (!a || !b) {
        out.unreadable.push(path);
        continue;
      }
      // Each name under each key: unchanged when the same key held the same spec; moved when another
      // key held exactly that spec; else new (no key held the name) or changed.
      const mine = [];
      const seen = new Set();
      for (const [field, dep, spec] of a) {
        if (b.some(([f, n, sp]) => f === field && n === dep && sp === spec)) continue;
        if (b.some(([, n, sp]) => n === dep && sp === spec)) continue;
        const key = `${e.ecosystem}:${dep}`;
        if (seen.has(key)) continue;
        seen.add(key);
        (b.some(([, n]) => n === dep) ? out.changedSpecs : out.added).push({ path, dependency: key });
        mine.push({ path, dependency: key });
      }
      const undeclared = mine.filter((m) => !known.has(m.dependency.toLowerCase()));
      out.undeclared.push(...undeclared);
      const sourceKeys = (e.sources ?? []).filter((k) => !same(after[k], before[k]));
      if (sourceKeys.length) out.sources.push(`${path} (${sourceKeys.join(', ')})`);
      const scriptKeys = [...new Set(e.checks.map((c) => c.field))].filter((k) => !same(after[k], before[k]));
      if (scriptKeys.length) out.scripts.push(`${path} (${scriptKeys.join(', ')})`);
      // Covered only when every change is a declared dependency: the rest of the manifest is as it
      // was (21b re-review: packageManager, config, autoload). Lock files are never covered: the
      // plan declares them as protected paths, so a rewritten lock is seen.
      if (!undeclared.length && mine.length && same(without(after, e.fields), without(before, e.fields))) out.covered.push(path);
    }
  }
  const withData = new Set(all.filter((s) => (s.dependencies ?? []).length).flatMap((s) => s.dependencies.map((d) => d.file)));
  const blind = new Set(all.filter((s) => !(s.dependencies ?? []).length).flatMap((s) => s.markers ?? []).filter((m) => !withData.has(m)));
  out.unchecked = changed.filter((p) => blind.has(posix.basename(p)));
  const locks = new Set(entries.flatMap((e) => e.locks ?? []));
  out.lockOnly = changed.filter((p) => locks.has(posix.basename(p)) && !manifestsChanged.has(posix.dirname(p)));
  out.unreadable = [...new Set(out.unreadable)];
  out.covered = [...new Set(out.covered)];
  return out;
}
