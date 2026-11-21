import { join } from 'node:path';

import { ConfigError } from '../cli/errors.js';
import { applyOverlays, CUSTOM_DIR, hasOverlayFiles, overlayFilesFrom } from '../config/overlays.js';
import { loadCustomRoles } from '../config/registry.js';
import { catBlobs, lsTree } from '../store/git.js';
import { openStore, repoIdentity } from '../store/home.js';
import { committedKeys } from '../sign/keys.js';
import { readJournal } from '../store/journal.js';
import { baseCommit, trustedFile, trustedRegistry } from './snapshot.js';
import { agentTemplate } from '../launch/strict.js';

// Where MIRAI reads a project's overlays (unit 37, Scope 5): only from the trust root, the
// integration branch's commit, like the project's roles and stacks, and only those you approved as
// they are now. A branch's copy, or one changed since its approval, is never used.

// The overlay files in a trust root (each read through its manifest hash).
export function trustOverlayFiles(trust) {
  const prefix = `tree/${CUSTOM_DIR}/`;
  const entries = (trust.manifest?.files ?? []).filter((f) => f.path.startsWith(prefix)).map((f) => [f.path.slice(prefix.length), trustedFile(trust, f.path.slice(5))]);
  return overlayFilesFrom(entries);
}

// The roles an agent overlay may name: MIRAI's and the project's own, from the trust root.
function rolesOf(trust, registry) {
  try {
    return { ...registry.roles, ...loadCustomRoles(join(trust.dir, 'tree', CUSTOM_DIR), registry.roles) };
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    return registry.roles;
  }
}

// The trust root's registry with the approved overlays applied: { registry, overlays, skipped }
// (src/config/overlays.js, applyOverlays). `events`: the journal, when the caller has read it.
// Approvals: the committed records in the trust root, checked against the keys on its base
// commit, and your local journal (unit 37, Jet's answer to Q3).
export function trustedOverlays(trust, store, { registry = trustedRegistry(trust), events = null } = {}) {
  const keys = committedKeys(store.checkout, trust.baseSha, store.gitEnv);
  return applyOverlays(registry, trustOverlayFiles(trust), events ?? readJournal(store).events, { roles: rolesOf(trust, registry), keys, repoId: store.repoId });
}

// The registry a gate reads: the trust root's, with the approved overlays applied.
export const effectiveRegistry = (trust, store) => trustedOverlays(trust, store).registry;

// The overlay files on the integration branch's commit, read from git's objects (never the work
// tree): for the commands that don't build a trust root, such as mirai lint.
// `where`: { checkout, branch, gitEnv } (a store, or a repo identity when there's none). Returns
// { files, base }.
export function baseOverlayFiles(where) {
  const base = baseCommit(where.checkout, where.branch, where.gitEnv);
  const entries = (lsTree(where.checkout, base, CUSTOM_DIR, where.gitEnv, { recursive: true }) ?? []).filter((e) => e.type === 'blob');
  const plain = entries.filter((e) => e.mode !== '120000');
  const blobs = catBlobs(where.checkout, plain.map((e) => e.sha), where.gitEnv, { maxBytes: 256 * 1024, maxTotal: 16 * 1024 * 1024 });
  return { files: overlayFilesFrom(entries.map((e) => [e.path.slice(CUSTOM_DIR.length + 1), e.mode === '120000' ? null : blobs.get(e.sha) ?? null])), base };
}

// For mirai lint and mirai epic render: `registry` (MIRAI's) with the approved overlays on the
// integration branch applied: { registry, skipped, note }. An overlay counts as approved by its
// committed record (any checkout: a teammate before mirai join, CI) or, where MIRAI's store is set
// up, your journal. Where the repo can't be read as MIRAI's (no config, no integration branch), the
// registry as it is; a `note` says so when the work tree has overlay files.
export function projectOverlays({ cwd, env, registry, checkout = null }) {
  let where;
  let events = [];
  try {
    where = openStore({ cwd, env });
    events = null;
  } catch {
    try {
      where = { ...repoIdentity({ cwd, env }), gitEnv: Object.freeze({ PATH: env.PATH, HOME: env.HOME }) };
    } catch (err) {
      const note = checkout && hasOverlayFiles(checkout) ? `note: the overlays in ${CUSTOM_DIR}/ aren't used: ${String(err.message).slice(0, 200)}` : null;
      return { registry, skipped: [], note };
    }
  }
  let read;
  try {
    read = baseOverlayFiles(where);
  } catch (err) {
    return { registry, skipped: [], note: hasOverlayFiles(where.checkout) ? `note: the overlays in ${CUSTOM_DIR}/ aren't used: ${String(err.message).slice(0, 200)}` : null };
  }
  if (!read.files.size) return { registry, skipped: [], note: null };
  const keys = committedKeys(where.checkout, read.base, where.gitEnv);
  const r = applyOverlays(registry, read.files, events ?? readJournal(where).events, { keys, repoId: where.repoId });
  return { registry: r.registry, skipped: r.skipped, overlays: r.overlays, note: null };
}

// ---- Agents (unit 37, Scope 4) ------------------------------------------------------------

// The overlay for agent `name` in the trust root, as a launch takes it: null when there's none;
// else { state, path, overlay (readOverlays' record, with result.def, result.prompt,
// result.change, result.why) }. Only `state: 'approved'` with a result may launch.
export function agentOverlay(trust, store, name, { registry = trustedRegistry(trust), events = null } = {}) {
  const r = trustedOverlays(trust, store, { registry, events });
  const o = r.overlays.find((x) => x.kind === 'agent' && x.name === name) ?? null;
  return o ? { state: o.state, path: o.path, overlay: o } : null;
}

// The mode templates a widened agent may run under (unit 37): its own role's mode and, as every
// agent may run under a read-only role, read-only.
export function agentModes(def, roles) {
  return [...new Set([roles[def.role]?.mode ?? 'read-write', 'read-only'])];
}

// The red team's extra templates (unit 37): one per mode for every agent whose approved overlay
// widens it, from `modeTemplates` (name → the trust root's mode templates). Map name → template.
export function widenedTemplates(trust, store, modeTemplates, { registry = trustedRegistry(trust), events = null } = {}) {
  const r = trustedOverlays(trust, store, { registry, events });
  const out = new Map();
  const roles = { ...registry.roles, ...rolesOf(trust, registry) };
  for (const o of r.overlays) {
    if (o.kind !== 'agent' || o.state !== 'approved' || o.result?.change !== 'widening') continue;
    const def = o.result.def;
    for (const mode of agentModes(def, roles)) {
      const base = [...modeTemplates.values()].find((t) => t.mode === mode && !t.overlay);
      if (!base) continue;
      const t = agentTemplate(base, { agent: o.name, tools: def.tools.allowed, overlay: def.overlay });
      out.set(t.name, t);
    }
  }
  return out;
}
