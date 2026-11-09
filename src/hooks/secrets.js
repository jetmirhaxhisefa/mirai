import { randomBytes } from 'node:crypto';

import { containsToken } from '../sign/token.js';
import { pushLog } from '../store/git.js';

// The push's secret scan (unit 26a; D-15, D-30 #10, D-49): what a push adds, on every branch.
// Read: each new commit's message and the lines its diff adds (against its first parent; a root
// commit against the empty tree), every path, `--text` so a binary file is read too. Matched: the
// trusted `registry/secrets` shapes (fixed prefixes only: Jet's decision 4, no entropy rule) and
// the Claude login token's exact value in every form `tokenForms` lists. A secret added and
// removed again in a later commit is still found: the push carries the history. A line a commit
// removes is never read. The value found is never returned: only the commit, the file and the
// pattern's name.

export const SCAN_MAX_BYTES = 64 * 1024 * 1024;

// `patterns`: [{ name, regex }]; `token`: the login token or null; `exclude`: what the remote
// already has (commit ids, or `--remotes=<name>`). Returns { findings: [{ commit, file, pattern }],
// commits, tooLarge }. `file` is null for a commit message.
export function scanPush({ root, env, head, exclude, patterns, token, maxBytes = SCAN_MAX_BYTES }) {
  const marker = `MIRAI-SCAN-${randomBytes(12).toString('hex')}`;
  let raw;
  try {
    raw = pushLog(root, head, exclude, env, { marker, maxBytes });
  } catch (err) {
    if (err.code === 'git-output-too-large') return { findings: [], commits: 0, tooLarge: true };
    throw err;
  }
  const compiled = patterns.map((p) => ({ name: p.name, re: new RegExp(p.regex, 'u') }));
  const findings = [];
  const seen = new Set();
  const check = (commit, file, text) => {
    if (!text) return;
    const hit = (pattern) => {
      const key = `${commit}\0${file}\0${pattern}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push({ commit, file, pattern });
    };
    if (token && containsToken(text, token)) hit('claude-login-token');
    for (const p of compiled) if (p.re.test(text)) hit(p.name);
  };
  const commits = parseLog(raw.toString('utf8'), marker);
  for (const c of commits) {
    check(c.sha, null, c.message);
    for (const [file, lines] of c.added) check(c.sha, file, lines.join('\n'));
  }
  return { findings, commits: commits.length, tooLarge: false };
}

// The log as [{ sha, message, added: Map(file -> [line]) }]. A commit is `<marker> <sha>`, its
// message, `<marker>`, then its diff. In the diff, a line at column 0 starting `diff --git` opens
// a file; its `+++ b/<path>` names it (or `+++ /dev/null` for a delete); after the first `@@`,
// a line starting `+` is added content.
export function parseLog(text, marker) {
  const out = [];
  let cur = null;
  let state = 'none'; // message | header | hunk
  let file = null;
  const head = `${marker} `;
  for (const line of text.split('\n')) {
    if (line.startsWith(head) && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(line.slice(head.length))) {
      cur = { sha: line.slice(head.length), message: [], added: new Map() };
      out.push(cur);
      state = 'message';
      file = null;
      continue;
    }
    if (!cur) continue;
    if (state === 'message') {
      if (line === marker) state = 'diff';
      else cur.message.push(line);
      continue;
    }
    if (line.startsWith('diff --git ')) {
      state = 'header';
      file = line.slice('diff --git '.length);
      continue;
    }
    if (state === 'header') {
      if (line.startsWith('+++ ')) {
        const p = line.slice(4);
        file = p === '/dev/null' ? file : p.replace(/^b\//, '');
      } else if (line.startsWith('@@')) state = 'hunk';
      continue;
    }
    if (state === 'hunk' && line.startsWith('+')) {
      if (!cur.added.has(file)) cur.added.set(file, []);
      cur.added.get(file).push(line.slice(1));
    }
  }
  return out.map((c) => ({ sha: c.sha, message: c.message.join('\n'), added: c.added }));
}
