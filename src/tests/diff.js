// A unified diff as git writes it (unit 16b; D-40, TL2-21): no dependency, and only git's own
// output with MIRAI's pinned flags (src/store/git.js changedLines: --no-renames, --no-ext-diff,
// --no-textconv, --no-color, a/ and b/ prefixes). Each file's added lines (new line numbers) and
// removed lines (old line numbers); a binary file has neither. Anything else is malformed:
// MIRAI never guesses what a diff meant. It keeps line numbers, not content: unit 25's proof
// hash can build on it, but needs content, binary patches and a fixed file order besides.

export const DIFF_LIMITS = Object.freeze({ bytes: 64 * 1024 * 1024, files: 100_000 });

export class DiffError extends Error {
  constructor(message, line) {
    super(line === undefined ? message : `${message} (line ${line})`);
    this.code = 'malformed-diff';
  }
}

const ESCAPES = Object.freeze({ a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 });

// A path git quoted ("…" with C escapes, and octal for each byte of a non-ASCII character).
function unquote(text, line) {
  if (!text.startsWith('"')) return text;
  if (!text.endsWith('"') || text.length < 2) throw new DiffError('a quoted path that isn\'t closed', line);
  const bytes = [];
  const body = text.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') {
      // A whole character (a surrogate pair stays together).
      const cp = body.codePointAt(i);
      if (cp > 0xffff) i++;
      bytes.push(...Buffer.from(String.fromCodePoint(cp), 'utf8'));
      continue;
    }
    const next = body[++i];
    if (next !== undefined && /[0-7]/.test(next)) {
      const oct = body.slice(i, i + 3);
      if (!/^[0-7]{3}$/.test(oct)) throw new DiffError('a bad octal escape in a quoted path', line);
      bytes.push(Number.parseInt(oct, 8));
      i += 2;
    } else if (next !== undefined && Object.hasOwn(ESCAPES, next)) bytes.push(ESCAPES[next]);
    else throw new DiffError('a bad escape in a quoted path', line);
  }
  return Buffer.from(bytes).toString('utf8');
}

// "a/<p> b/<p>": with renames off both sides name the same path, so it splits in the middle even
// when the path holds spaces; quoted paths are read one by one.
function headerPath(rest, line) {
  if (rest.startsWith('"')) {
    let i = 1;
    for (; i < rest.length; i++) {
      if (rest[i] === '\\') i++;
      else if (rest[i] === '"') break;
    }
    if (i >= rest.length || rest[i + 1] !== ' ') throw new DiffError('a diff header git didn\'t write', line);
    const a = unquote(rest.slice(0, i + 1), line);
    const b = unquote(rest.slice(i + 2), line);
    if (!a.startsWith('a/') || !b.startsWith('b/') || a.slice(2) !== b.slice(2)) throw new DiffError('a diff header with two different paths (renames are off)', line);
    return a.slice(2);
  }
  const len = (rest.length - 5) / 2;
  const a = rest.slice(0, 2 + len);
  const b = rest.slice(3 + len);
  if (!Number.isInteger(len) || len < 1 || !a.startsWith('a/') || !b.startsWith('b/') || a.slice(2) !== b.slice(2) || rest[2 + len] !== ' ') {
    throw new DiffError('a diff header with two different paths (renames are off)', line);
  }
  return a.slice(2);
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;

// Parses `input` (a Buffer or string): { files: [{ path, status: 'added' | 'deleted' | 'modified',
// added: [n…], removed: [n…], binary }] }, in the diff's order. Throws DiffError.
export function parseDiff(input, limits = DIFF_LIMITS) {
  const bytes = typeof input === 'string' ? Buffer.byteLength(input) : input.length;
  if (bytes > limits.bytes) throw new DiffError(`the diff is larger than ${limits.bytes} bytes`);
  const text = typeof input === 'string' ? input : input.toString('utf8');
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const files = [];
  let file = null;
  // Lines still to come in the current hunk, on each side.
  let oldLeft = 0;
  let newLeft = 0;
  let oldAt = 0;
  let newAt = 0;
  const inHunk = () => oldLeft > 0 || newLeft > 0;
  for (let n = 0; n < lines.length; n++) {
    const l = lines[n];
    const at = n + 1;
    if (file && inHunk()) {
      const c = l[0];
      if (c === '+' && newLeft > 0) {
        file.added.push(newAt++);
        newLeft--;
      } else if (c === '-' && oldLeft > 0) {
        file.removed.push(oldAt++);
        oldLeft--;
      } else if (c === ' ' && oldLeft > 0 && newLeft > 0) {
        oldAt++;
        newAt++;
        oldLeft--;
        newLeft--;
      } else if (l === '\\ No newline at end of file') {
        // About the line before it; nothing to count.
      } else throw new DiffError('a hunk shorter than its header says', at);
      continue;
    }
    if (l.startsWith('diff --git ')) {
      if (files.length >= limits.files) throw new DiffError(`more than ${limits.files} files`, at);
      file = { path: headerPath(l.slice(11), at), status: 'modified', added: [], removed: [], binary: false, hunks: 0, sawHeader: false };
      files.push(file);
    } else if (!file) {
      throw new DiffError('text before the first "diff --git"', at);
    } else if (l === '\\ No newline at end of file') {
      // After a hunk's last line.
    } else if (/^new file mode [0-7]{6}$/.test(l)) file.status = 'added';
    else if (/^deleted file mode [0-7]{6}$/.test(l)) file.status = 'deleted';
    else if (/^(?:old|new) mode [0-7]{6}$/.test(l) || /^index [0-9a-f]+\.\.[0-9a-f]+(?: [0-7]{6})?$/.test(l)) {
      // Modes and blob ids: nothing to count.
    } else if (l.startsWith('--- ') || l.startsWith('+++ ')) {
      // Git adds a tab after a path that holds a space.
      const p = l.slice(4).replace(/\t$/, '');
      if (p !== '/dev/null') {
        const q = unquote(p, at);
        const want = l.startsWith('---') ? 'a/' : 'b/';
        if (!q.startsWith(want) || q.slice(2) !== file.path) throw new DiffError(`a "${l.slice(0, 3)}" path that isn't the header's`, at);
      }
      file.sawHeader = true;
    } else if (l.startsWith('Binary files ') && l.endsWith(' differ')) {
      file.binary = true;
    } else if (l.startsWith('@@')) {
      const m = HUNK.exec(l);
      if (!m || !file.sawHeader) throw new DiffError('a hunk header git didn\'t write', at);
      oldAt = Number(m[1]);
      oldLeft = m[2] === undefined ? 1 : Number(m[2]);
      newAt = Number(m[3]);
      newLeft = m[4] === undefined ? 1 : Number(m[4]);
      file.hunks++;
    } else throw new DiffError('a line git didn\'t write', at);
  }
  if (inHunk()) throw new DiffError('the diff ends inside a hunk');
  return { files: files.map(({ path, status, added, removed, binary }) => ({ path, status, added, removed, binary })) };
}
