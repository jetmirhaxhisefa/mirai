import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Claude Code's own write staging (an empty `.claude/.cc-writes/`, made whenever it writes a file:
// 21b's walkthrough) is no change of the agent's. Only empty, and only that name directly inside a
// `.claude` folder: anything in it, or anything else under `.claude/`, still counts. Shared by Kai's
// build check (src/agent/build.js) and the document agents' after-launch checks (Nora's, Tess's;
// unit 42's P1 run: it passed there only because a global git ignore listed it).
export function isWriteStaging(root, path) {
  const p = String(path).replace(/\/+$/, '');
  if (!/(^|\/)\.claude\/\.cc-writes$/.test(p)) return false;
  try {
    const st = lstatSync(join(root, p));
    return st.isDirectory() && readdirSync(join(root, p)).length === 0;
  } catch {
    return false;
  }
}

// The changed paths with the empty write staging left out.
export const withoutStaging = (root, paths) => paths.filter((p) => !isWriteStaging(root, p));
