import { blobAt, changedLines, reviewPatch } from '../store/git.js';

// The diff a review reads (unit 24a; design/01 §9, TL3-12, TL2-23). MIRAI builds it from two
// commits with its pinned git and `--text`, so a branch's `.gitattributes` (`-diff`, `binary`)
// can't hide a file's code from Rex: whether a file is binary is decided here, by its bytes (git's
// own test, a NUL in the first 8,000), never by an attribute. A real binary file, or one larger
// than BLOB_MAX_BYTES, is listed with a one-line note instead of its patch. The diff is never cut
// short: past `maxBytes` the review refuses, so nothing is reviewed in part.
//
// Each hunk line carries the file's line number in front (numberLines below), so Rex cites the
// file's line, not the diff's.
//
// Returns { patch, files: [{ path, status, binary, note }], changedLines: { path: [n…] }, bytes }.
// `changedLines` is what triage() takes (src/findings/findings.js): each text file's added lines
// (new-file numbers) and the lines beside each removal.

export const BLOB_MAX_BYTES = 4 * 1024 * 1024;
const SNIFF_BYTES = 8000;

export class ReviewDiffError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export const isBinary = (bytes) => bytes.subarray(0, SNIFF_BYTES).includes(0);

// Whether a changed file is text: both its sides (the one that exists, for an added or deleted
// file) read as text and fit. { text: true } or { text: false, note }.
function textFile(root, env, { from, to, path, status }) {
  const sides = [...(status === 'added' ? [] : [from]), ...(status === 'deleted' ? [] : [to])];
  for (const rev of sides) {
    const bytes = blobAt(root, rev, path, env, { maxBytes: BLOB_MAX_BYTES });
    if (bytes === null) return { text: false, note: `not shown: larger than ${BLOB_MAX_BYTES / (1024 * 1024)} MiB, or not a file` };
    if (isBinary(bytes)) return { text: false, note: 'not shown: a binary file' };
  }
  return { text: true };
}

// The patch split by file, at git's own "diff --git " headers. A header can't appear inside a hunk:
// every hunk line starts with " ", "+", "-" or "\".
function byFile(patch) {
  const text = patch.toString('utf8');
  const sections = [];
  let start = -1;
  const re = /^diff --git /gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (start >= 0) sections.push(text.slice(start, m.index));
    start = m.index;
  }
  if (start >= 0) sections.push(text.slice(start));
  else if (text.trim() !== '') throw new ReviewDiffError('the review diff has text before its first file', 'malformed-diff');
  return sections;
}

// One file's patch with the file's own line number in front of each hunk line (24a, probe r3:
// Rex cited a line of review.diff itself, counted from the top, and triage rightly called the
// finding pre-existing). Context and added lines get their new-file number; a removed line, which
// isn't in the file any more, gets none; the header lines and each `@@` line are left as they are.
// The text is for Rex to read, not a patch to apply.
const NUM_WIDTH = 6;
export function numberLines(section) {
  const out = [];
  let line = null;
  const lines = section.split('\n');
  const last = lines.pop(); // '' after the final newline
  for (const l of lines) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (hunk) {
      line = Number(hunk[1]);
      out.push(l);
    } else if (line === null || l.startsWith('\\')) {
      out.push(l);
    } else if (l.startsWith('-')) {
      out.push(`${' '.repeat(NUM_WIDTH)} ${l}`);
    } else {
      out.push(`${String(line).padStart(NUM_WIDTH)} ${l}`);
      line++;
    }
  }
  out.push(last);
  return out.join('\n');
}

export function reviewDiff({ root, env, from, to, maxBytes, context = 3 }) {
  if (!from || !to) throw new ReviewDiffError('a review diff needs two commits', 'no-commits');
  const lines = changedLines(root, from, to, env, { text: true, near: true }).files;
  const patch = reviewPatch(root, from, to, env, { context });
  const sections = byFile(patch);
  if (sections.length !== lines.length) throw new ReviewDiffError(`the review diff has ${sections.length} files, its line count ${lines.length}`, 'diff-mismatch');
  const files = [];
  const changed = {};
  const parts = [];
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i];
    // The same two commits and pins give the same files in the same order; a path git quoted is
    // checked by that order alone.
    if (!sections[i].startsWith(`diff --git a/${f.path} b/${f.path}\n`) && !sections[i].startsWith('diff --git "')) throw new ReviewDiffError(`the review diff's file ${i + 1} isn't ${f.path}`, 'diff-mismatch');
    const t = textFile(root, env, { from, to, path: f.path, status: f.status });
    files.push({ path: f.path, status: f.status, binary: !t.text, note: t.note ?? null });
    if (t.text) {
      changed[f.path] = [...new Set([...f.added, ...(f.near ?? [])])].sort((a, b) => a - b);
      parts.push(numberLines(sections[i]));
    } else {
      parts.push(`diff --git a/${f.path} b/${f.path}\n# MIRAI: ${f.status}, ${t.note}\n`);
    }
  }
  const out = parts.join('');
  const bytes = Buffer.byteLength(out);
  if (Number.isInteger(maxBytes) && bytes > maxBytes) throw new ReviewDiffError(`the change is ${Math.ceil(bytes / 1024)} KiB as a diff, more than a review takes (${Math.floor(maxBytes / 1024)} KiB); MIRAI never reviews part of a change`, 'diff-too-large');
  return { patch: out, files, changedLines: changed, bytes };
}
