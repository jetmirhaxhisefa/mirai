import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { MiraiError } from '../../cli/errors.js';
import { EXIT } from '../../cli/exit-codes.js';
import { checkConfig, readConfigFile, PROJECT_CONFIG } from '../../config/load.js';
import { frameworkDefaults } from '../../config/defaults.js';
import { snapshot, trustedConfig } from '../../trust/snapshot.js';
import { atomicWrite } from '../files.js';
import { loadConnectors, checkHomes } from './contract.js';
import { filesOf } from './common.js';
import { fenceUntrusted } from './fence.js';
import { localStore } from './local.js';
import { repoStore } from './repo.js';

// The project's document store (unit 38, Scope 2–3). `[docs] store` in .mirai/config.toml, read
// from the integration branch like `docs.root` (personal files can't set docs.*), picks one of
// the built-in stores: `repo` (the default) or `local`. Every document path resolves through it
// (pathOf), so the lint, approval, `mirai show <initiative>`, the reader test and `mirai epic
// render` find the documents in either place.

const FACTORIES = Object.freeze({ repo: repoStore, local: localStore });
export const STORE_NAMES = Object.freeze(Object.keys(FACTORIES));
const MARKER = 'docs-store.json';

let defs = null;
export function connectorDefs() {
  defs ??= loadConnectors();
  return defs;
}

// The config the store setting is read from: the trust root's (the integration branch), or before
// one exists (a fresh project, a repo with nothing pushed yet), the work tree's project file, or
// MIRAI's defaults. Only the project layer: the setting is team policy. `trusted: false` reads the
// work tree's project file only, as `mirai lint` reads docs.root (it never builds a trust root).
export function docsConfig({ cwd, env, root, trusted = true }) {
  if (trusted) {
    try {
      return trustedConfig(snapshot({ cwd, env }));
    } catch {
      // no trust root yet
    }
  }
  try {
    if (root && existsSync(join(root, PROJECT_CONFIG))) {
      return checkConfig([{ kind: 'project', file: readConfigFile(join(root, PROJECT_CONFIG), { trust: 'project', source: PROJECT_CONFIG, within: root }) }]).config;
    }
  } catch {
    // a broken project file: the defaults (the lint and doctor report the file itself)
  }
  return frameworkDefaults();
}

// The store for `config`: { name, kind, def, base, docsRoot, pathOf, relOf, read, write, setup, … }.
// `check` (the default): a store change on a project that already has documents is refused.
export function openDocsStore({ store, config, check = true }) {
  const name = config.docs?.store ?? 'repo';
  const all = connectorDefs();
  if (!Object.hasOwn(FACTORIES, name) || !all[name]) throw Object.assign(new MiraiError(`[docs] store is "${name}", which isn't a store MIRAI has`, EXIT.CONFIG), { code: 'unknown-store', hint: `use one of: ${STORE_NAMES.join(', ')}` });
  // D5: one source of truth per type. One store holds the documents; the check is here so that a
  // later per-type setting can't give a type two homes.
  checkHomes([{ name, holds: all[name].holds }]);
  const conn = FACTORIES[name]({ def: all[name], store, config });
  if (check) checkStoreChange({ store, config, conn });
  return conn;
}

// The store and its config, from a command's cwd: { conn, config }.
export function docsStoreFor({ cwd, env, store, check = true, trusted = true }) {
  const config = docsConfig({ cwd, env, root: store.checkout, trusted });
  return { conn: openDocsStore({ store, config, check }), config };
}

const markerPath = (store) => join(store.dir, MARKER);
function recordedStore(store) {
  try {
    const v = JSON.parse(readFileSync(markerPath(store), 'utf8'));
    return STORE_NAMES.includes(v.store) ? v.store : 'repo';
  } catch {
    // Before unit 38 every project kept its documents in the repo.
    return 'repo';
  }
}

// Whether a store holds any document: a Markdown file under its docs folder.
export function hasDocuments(conn) {
  const root = join(conn.base, conn.docsRoot);
  if (!existsSync(root)) return false;
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try {
      entries = readdirSyncSafe(d);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile() && /\.md$/i.test(e.name)) return true;
      if (e.isDirectory()) stack.push(join(d, e.name));
    }
  }
  return false;
}

const readdirSyncSafe = (d) => readdirSync(d, { withFileTypes: true });

// A changed `[docs] store` on a project whose old store has documents is refused: moving them is
// later work (`mirai docs move`). An empty old store may change, and the change is written down in
// MIRAI's store (docs-store.json), so the next change is checked against it.
export function checkStoreChange({ store, config, conn }) {
  const was = recordedStore(store);
  if (was === conn.name) return;
  const old = FACTORIES[was]({ def: connectorDefs()[was], store, config });
  if (hasDocuments(old)) {
    throw Object.assign(new MiraiError(`[docs] store changed from ${was} to ${conn.name}, and the ${was} store already has documents (${join(old.base, old.docsRoot)}); nothing was changed`, EXIT.BLOCKED), {
      code: 'store-change',
      hint: `put [docs] store = "${was}" back. Moving documents between stores is later work (mirai docs move, not built yet): until then, a project keeps the store it started with`,
    });
  }
  atomicWrite(markerPath(store), `${JSON.stringify({ schema_version: 1, store: conn.name }, null, 2)}\n`);
}

// The folder a document argument is read from: the local store's base when the file is inside
// it, else the repo checkout. `arg` as the user typed it, relative to `cwd`.
export function baseForArg(conn, cwd, arg) {
  if (conn.kind === 'repo' || typeof arg !== 'string') return conn.checkout;
  const full = isAbsolute(arg) ? arg : resolve(cwd, arg);
  let real;
  try {
    real = realpathSync(full);
  } catch {
    real = full;
  }
  let base;
  try {
    base = realpathSync(conn.base);
  } catch {
    return conn.checkout;
  }
  return real.startsWith(base + sep) ? base : conn.checkout;
}

// The initiative folders a store has, sorted.
export function initiativesIn(conn) {
  try {
    return readdirSync(join(conn.base, conn.docsRoot), { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'tickets').map((e) => e.name).sort();
  } catch {
    return [];
  }
}

// The documents of an initiative as files: [{ abs, rel, file }].
export const initiativeFiles = (conn, initiative) => filesOf(conn.dir(initiative), conn.base);

// The text an agent gets from a store (Scope 6): an external store's text inside the untrusted
// fence, with its source; MIRAI's own stores' files as they are.
export function agentText(conn, type, initiative, name) {
  const bytes = conn.read(type, initiative, name);
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  if (conn.def.kind !== 'external') return text;
  return fenceUntrusted(text, { source: `the ${conn.name} store, ${conn.relOf(conn.pathOf(type, initiative, name)) ?? type}` });
}

// A store's status of an initiative's documents, as MIRAI shows it (Scope 6; D-36): advisory, a
// cache with its last sync. `stale` when the sync is older than the connector's window (an
// external store; MIRAI's own stores read their files now, so never stale). No gate reads this.
export function statusView(conn, initiative, { now = () => new Date() } = {}) {
  const s = conn.status(initiative);
  const windowMs = (conn.def.sync_window_minutes ?? 0) * 60_000;
  const synced = s.synced_at ? Date.parse(s.synced_at) : null;
  const stale = conn.def.kind === 'external' && (synced === null || now().getTime() - synced > windowMs);
  return {
    synced_at: s.synced_at ?? null,
    stale,
    documents: s.documents.map((d) => ({ ...d, mirai: conn.def.status_map[d.state] ?? null, ...(stale ? { note: `stale: last synced ${s.synced_at ?? 'never'}` } : {}) })),
  };
}
