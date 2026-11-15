import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWrite } from '../store/files.js';

// Your user-level Claude Code deny rules for MIRAI's files (unit 29b, Jet's decision 5): no
// session reads or edits your keys and token (~/.config/mirai) or MIRAI's home. Written into each
// of your Claude configs that's there (claude-priv's ~/.claude-private, linked to your synced
// ~/claude-config, and ~/.claude), at `mirai key new`, `key protect` and `token set`. Only these
// rules, added when missing; nothing else in the file is touched. A branch can't remove them (18e).
export const MIRAI_DENIES = Object.freeze([
  'Read(~/.config/mirai/**)', 'Edit(~/.config/mirai/**)',
  'Read(~/Library/Application Support/mirai/**)', 'Edit(~/Library/Application Support/mirai/**)',
]);

// The settings files: [{ dir, file (the link resolved), missing: [rules] }].
export function userSettings(env) {
  const out = [];
  for (const d of ['.claude-private', '.claude']) {
    const dir = join(env.HOME, d);
    if (!existsSync(dir)) continue;
    const path = join(dir, 'settings.json');
    let file = path;
    try {
      file = realpathSync(path);
    } catch {
      file = path;
    }
    let json = {};
    try {
      json = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    } catch {
      out.push({ dir, file, unreadable: true, missing: [...MIRAI_DENIES] });
      continue;
    }
    const have = new Set(json?.permissions?.deny ?? []);
    out.push({ dir, file, missing: MIRAI_DENIES.filter((r) => !have.has(r)) });
  }
  return out;
}

// Adds the missing rules to each file. Returns [{ file, added }] (an unreadable file is skipped,
// named, and left as it is).
export function writeUserDenies(env) {
  const done = [];
  for (const s of userSettings(env)) {
    if (s.unreadable) {
      done.push({ file: s.file, added: 0, skipped: 'not readable JSON; left as it is' });
      continue;
    }
    if (!s.missing.length) {
      done.push({ file: s.file, added: 0 });
      continue;
    }
    const json = existsSync(s.file) ? JSON.parse(readFileSync(s.file, 'utf8')) : {};
    const permissions = json.permissions && typeof json.permissions === 'object' ? json.permissions : {};
    const deny = Array.isArray(permissions.deny) ? permissions.deny : [];
    const next = { ...json, permissions: { ...permissions, deny: [...deny, ...s.missing] } };
    atomicWrite(s.file, `${JSON.stringify(next, null, 2)}\n`);
    done.push({ file: s.file, added: s.missing.length });
  }
  return done;
}
