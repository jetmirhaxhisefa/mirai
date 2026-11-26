import { execFileSync } from 'node:child_process';

import { contentHash } from '../sign/sign.js';

// A line diff and the text of a file as it was at a hash (unit 42, decision 3; moved here by unit 44,
// which uses them for the verifier's incremental re-check and the pre-commit hook).

// The file's text at the newest commit where its bytes hash to `hash`, or null.
export function approvedText(store, path, hash) {
  try {
    const shas = execFileSync('git', ['log', '--format=%H', '-n', '50', '--', path], { cwd: store.checkout, env: store.gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean);
    for (const sha of shas) {
      const bytes = execFileSync('git', ['show', `${sha}:${path}`], { cwd: store.checkout, env: store.gitEnv, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
      if (contentHash(bytes) === hash) return bytes.toString('utf8');
    }
  } catch {
    return null;
  }
  return null;
}

// A line diff (longest common subsequence): [{ sign: '-' | '+', line, text }], `line` the old
// file's line for a removal and the new file's for an addition.
export function changedLines(before, after) {
  const a = before.replace(/\r\n?/g, '\n').split('\n');
  const b = after.replace(/\r\n?/g, '\n').split('\n');
  if (a.length * b.length > 4_000_000) return [{ sign: '+', line: 1, text: '(too long to compare line by line: read the whole file)' }];
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) out.push({ sign: '-', line: ++i, text: a[i - 1] });
    else out.push({ sign: '+', line: ++j, text: b[j - 1] });
  }
  return out;
}

