import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { integrationRef } from '../sign/keys.js';
import { blobAt } from './git.js';

// A warning for your own sessions (unit 18e). Claude Code reads .claude/settings.json and .mcp.json
// from whatever branch you have checked out, so a branch can remove MIRAI's denies, add allow rules
// or add a hook that runs on your machine, before any review sees it (probed). This compares the
// work tree with the integration branch and says what's weaker. It blocks nothing, and it can't
// stop a hook on the first session after a checkout: it only speaks when you ask for a status.

// Changing these gives a session no new reach.
const HARMLESS = new Set(['model', 'outputStyle', '$schema', 'theme', 'language', 'includeCoAuthoredBy', 'cleanupPeriodDays']);
const SETTINGS = '.claude/settings.json';
const LOCAL = '.claude/settings.local.json';
const MCP = '.mcp.json';
const CANT = 'couldn\'t compare your Claude Code settings with the integration branch';

function workFile(root, rel) {
  const path = join(root, rel);
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return { missing: true };
  }
  if (!st.isFile() || st.size > 256 * 1024) return { odd: true };
  return { text: readFileSync(path, 'utf8') };
}

const parse = (text) => {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

// What's weaker in `work` than in `base`, both parsed settings: text for each finding.
export function compareSettings(base, work) {
  const out = [];
  const bp = base.permissions ?? {};
  const wp = work.permissions ?? {};
  const gone = list(bp.deny).filter((d) => !list(wp.deny).includes(d));
  if (gone.length) out.push(`${SETTINGS} here lacks ${gone.length} deny rule(s) the integration branch has, such as ${gone[0]}`);
  const allowed = list(wp.allow).filter((a) => !list(bp.allow).includes(a));
  if (allowed.length) out.push(`${SETTINGS} here adds allow rule(s): ${allowed.slice(0, 5).join(', ')}`);
  for (const k of new Set([...Object.keys(bp), ...Object.keys(wp)])) {
    if (k !== 'deny' && k !== 'allow' && !same(bp[k], wp[k])) out.push(`${SETTINGS} here changes permissions.${k}`);
  }
  for (const k of new Set([...Object.keys(base), ...Object.keys(work)])) {
    if (k !== 'permissions' && !HARMLESS.has(k) && !same(base[k], work[k])) {
      out.push(k === 'hooks' ? `${SETTINGS} here changes hooks, commands that run on your machine` : `${SETTINGS} here changes ${k}`);
    }
  }
  return out;
}

// The warnings for this checkout; [] when all is as on the integration branch. One that can't check
// says so: a status must never fail because of this, and silence would read as "all clear".
export function sessionSettingsWarnings(store) {
  try {
    const root = store.checkout;
    const env = store.gitEnv;
    const ref = integrationRef(root, store.branch, env);
    if (!ref) return [CANT];
    const at = (rev, rel) => blobAt(root, rev, rel, env)?.toString('utf8') ?? null;
    const out = [];
    const baseText = at(ref, SETTINGS);
    const work = workFile(root, SETTINGS);
    if (work.odd) out.push(`${SETTINGS} here isn't a plain file`);
    else if (work.missing) {
      if (baseText !== null) out.push(`${SETTINGS} is missing here, and with it MIRAI's deny rules`);
    } else if (work.text === baseText) {
      // A branch can't weaken what's already on the integration branch, but it's still worth a word (15b).
      const b = parse(baseText);
      if (b?.enableAllProjectMcpServers || b?.enabledMcpjsonServers?.length) out.push(`${SETTINGS} on the integration branch enables project MCP servers: any branch's .mcp.json can offer tools to your sessions`);
    } else {
      const w = parse(work.text);
      if (!w) out.push(`${SETTINGS} here can't be read as settings`);
      else out.push(...compareSettings(parse(baseText ?? '{}') ?? {}, w));
    }
    const mcp = workFile(root, MCP);
    if (mcp.odd) out.push(`${MCP} here isn't a plain file`);
    else if (!mcp.missing && mcp.text !== at(ref, MCP)) out.push(`${MCP} here differs from the integration branch: it can start servers in your sessions`);
    // Yours when git-ignored, and none of MIRAI's business; committed on a branch, it isn't yours.
    if (at('HEAD', LOCAL) !== null && at('HEAD', LOCAL) !== at(ref, LOCAL)) out.push(`${LOCAL} is committed on this branch: that file is meant to be yours alone`);
    return out;
  } catch {
    return [CANT];
  }
}
