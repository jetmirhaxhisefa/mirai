import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Line endings kept (unit 30c, F25; Jet's decision 2): an agent's editor writes LF, so a CRLF
// file it touched came back LF-only, and the MR showed a whole-file rewrite. Right after an agent's
// step, before MIRAI's checks (so the checks and the MR see the real change): a file that was CRLF
// throughout at the step's base and is LF-only now gets its CRLF back. A file with mixed endings
// is left as it is and named. New files and binary files are left alone.
// Returns { converted: [path], mixed: [path] }.
export function keepLineEndings({ root, env, base }) {
  const converted = [];
  const mixed = [];
  let names;
  try {
    names = execFileSync('git', ['diff', '--name-only', '-z', '--diff-filter=M', base, '--'], { cwd: root, env, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').split('\0').filter(Boolean);
  } catch {
    return { converted, mixed };
  }
  for (const path of names) {
    const abs = join(root, path);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > 8 * 1024 * 1024) continue;
    let before;
    try {
      before = execFileSync('git', ['show', `${base}:${path}`], { cwd: root, env, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      continue;
    }
    const now = readFileSync(abs);
    if (before.includes(0) || now.includes(0)) continue;
    const was = endings(before.toString('latin1'));
    const is = endings(now.toString('latin1'));
    if (was !== 'crlf') continue;
    if (is === 'lf') {
      writeFileSync(abs, now.toString('latin1').replace(/\n/g, '\r\n'), 'latin1');
      converted.push(path);
    } else if (is === 'mixed') {
      mixed.push(path);
    }
  }
  return { converted, mixed };
}

// 'crlf' (every line break is CRLF), 'lf' (none is), 'mixed', or 'none' (no line break).
export function endings(text) {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length;
  if (lf === 0) return 'none';
  if (crlf === lf) return 'crlf';
  if (crlf === 0) return 'lf';
  return 'mixed';
}
