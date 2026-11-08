import { createHash } from 'node:crypto';

import { expand, included, matches } from '../util/glob.js';
import { changedNames, proofPatch } from '../store/git.js';

// The code hash a proof is bound to (unit 25a; D-16, R3-M11, AR3-6, G14): SHA-256 over a
// normalized patch of `base..head` over the code paths.
// - The patch: src/store/git.js proofPatch, every output-changing flag pinned, `--text` (a binary
//   file's bytes as lines: no delta encoding that could differ between git versions, and no
//   `.gitattributes` can change the patch).
// - The paths: the files that differ between the commits and match the trust root's
//   `gate.code_paths`; `.mirai/records/**` never (D-22's update: the proofs themselves live there).
// - Normalized: `index` lines dropped (no blob ids), every hunk header made `@@` (no line numbers,
//   no function label), sections sorted by their `diff --git` line. So a rebase onto a base that
//   changed other lines of a touched file keeps the hash; any change to what the branch adds or
//   removes, its context lines, a mode or a binary file's bytes changes it. Accepted limit (Jet's
//   decision 4): an identical hunk moved within one file, with identical context, keeps it.

export const HASH_VERSION = 'mirai-proof-patch/1';
const RECORDS = '.mirai/records/';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const badPatch = (message) => Object.assign(new Error(message), { code: 'bad-patch' });

// The changed files a proof covers, sorted.
export function codeFiles(root, base, head, codePaths, env) {
  const list = Array.isArray(codePaths) ? codePaths.filter((p) => typeof p === 'string' && p !== '') : [];
  return (changedNames(root, base, head, env) ?? []).filter((p) => !p.startsWith(RECORDS) && included(list, p));
}

// { hash: 'sha256:<hex>', files, bytes } for base..head over codePaths. `files` empty: nothing to prove.
export function codeHash({ root, env, base, head, codePaths }) {
  const files = codeFiles(root, base, head, codePaths, env);
  const normal = normalizePatch(proofPatch(root, base, head, files, env));
  return { hash: `sha256:${sha256(Buffer.concat([Buffer.from(`${HASH_VERSION}\n`), normal]))}`, files, bytes: normal.length };
}

// The normalized patch (bytes). Lines are handled as latin1, so every byte comes back as it was.
export function normalizePatch(patch) {
  const text = Buffer.isBuffer(patch) ? patch.toString('latin1') : String(patch);
  if (text === '') return Buffer.alloc(0);
  const sections = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { key: line, lines: [line], head: true };
      sections.push(current);
      continue;
    }
    if (!current) {
      if (line === '') continue;
      throw badPatch('the patch doesn\'t start with a diff --git line');
    }
    if (current.head) {
      if (/^index [0-9a-f]+\.\.[0-9a-f]+(?: [0-7]{6})?$/.test(line)) continue;
      // With --text git never prints these; one would mean a patch MIRAI didn't ask for.
      if (/^Binary files .* differ$/.test(line) || line.startsWith('GIT binary patch')) throw badPatch('a binary patch MIRAI didn\'t ask for');
      if (line.startsWith('@@ ')) {
        current.head = false;
        current.lines.push('@@');
        continue;
      }
      current.lines.push(line);
      continue;
    }
    // In a hunk every line starts with " ", "+", "-" or "\", so only a header starts with "@@ ".
    current.lines.push(line.startsWith('@@ ') ? '@@' : line);
  }
  // The patch's final newline leaves one empty line at the end of the last section.
  for (const s of sections) while (s.lines.length > 1 && s.lines.at(-1) === '') s.lines.pop();
  sections.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return Buffer.from(sections.map((s) => `${s.lines.join('\n')}\n`).join(''), 'latin1');
}

// Jet's default (25a): `gate.code_paths` may not leave a protected path out of the hash, besides
// MIRAI's own `.mirai/**` and the docs root (03b's open note), or a project could hide a
// `.claude/**` change from its proof. Checked against a sample path for every protected rule (a
// pattern with its wildcards filled in, at the top and one folder down): [{ rule, path }] for each
// one `code_paths` doesn't include. `rules`: protectionRules(...).rules, from the trust root.
export function codePathsHide(codePaths, rules, docsRoot) {
  const own = (p) => p.toLowerCase().startsWith('.mirai/') || p.toLowerCase().startsWith(`${String(docsRoot).toLowerCase()}/`);
  const out = [];
  for (const rule of rules) {
    for (const pattern of rule.paths) {
      for (const one of expand(pattern.startsWith('/') ? pattern.slice(1) : pattern)) {
        const filled = one.replace(/\/$/, '/x').replace(/(^|\/)\*\*\/?/g, '$1').replace(/\/\*\*$/, '/x').replace(/\*+/g, 'x').replace(/\?/g, 'x').replace(/\/$/, '/x') || 'x';
        for (const path of [filled, `sub/${filled}`]) {
          if (own(path) || !matches(pattern, path)) continue;
          if (!included(codePaths, path)) out.push({ rule: rule.name, path });
        }
      }
    }
  }
  return out;
}
