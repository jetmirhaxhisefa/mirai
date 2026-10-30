import { toProjectPath } from './paths.js';
import { parseXml, XmlError } from './xml.js';

// Line coverage as test runners write it (unit 16b; D-48 item 5, D-40): lcov and Cobertura, read
// with no dependency, into one shape that doesn't depend on the stack:
//   { files: { <project path>: { <line>: hits } }, unmapped }
// Each file's path is mapped to the project through the service's mounts (src/tests/paths.js); a
// file outside them (a library, the runner's own code) is counted in `unmapped`, never guessed.
// A line listed twice (several classes or records for one file) keeps its highest count: only
// "ran or not" matters for diff coverage. Lines only; branches and functions are ignored.

// Elements bound a Cobertura file's memory, as XML_LIMITS do JUnit's.
export const COVERAGE_LIMITS = Object.freeze({ bytes: 64 * 1024 * 1024, files: 100_000, lines: 10_000_000, line: 10_000_000, elements: 3_000_000 });

export class CoverageError extends Error {
  constructor(message, at) {
    super(at === undefined ? message : `${message} (line ${at})`);
    this.code = 'malformed';
  }
}

function collector(mounts, base, limits) {
  const files = Object.create(null);
  let count = 0;
  let unmapped = 0;
  let lines = 0;
  return {
    file(reported) {
      const path = toProjectPath(mounts, reported, base);
      if (path === null) {
        unmapped++;
        return null;
      }
      if (!files[path]) {
        if (++count > limits.files) throw new CoverageError(`more than ${limits.files} files`);
        files[path] = Object.create(null);
      }
      return files[path];
    },
    line(file, n, hits, at) {
      if (!Number.isSafeInteger(n) || n < 1 || n > limits.line) throw new CoverageError('a line number out of range', at);
      if (!Number.isSafeInteger(hits) || hits < 0) throw new CoverageError('a hit count that isn\'t a whole number', at);
      if (file === null) return;
      if (!(n in file)) {
        if (++lines > limits.lines) throw new CoverageError(`more than ${limits.lines} lines`);
        file[n] = hits;
      } else file[n] = Math.max(file[n], hits);
    },
    done: () => ({ files, unmapped }),
  };
}

const int = (text) => (/^\d{1,15}$/.test(text) ? Number(text) : Number.NaN);

// lcov's tracefile: SF, DA, LF, LH and end_of_record count; TN, FN, FNDA, FNF, FNH, BRDA, BRF and
// BRH are read and ignored; anything else is malformed. A DA's optional checksum is ignored.
const LCOV_IGNORED = /^(?:TN|FN|FNDA|FNF|FNH|BRDA|BRF|BRH|VER|FNL|FNA):/;
export function parseLcov(input, { mounts, base, limits = COVERAGE_LIMITS }) {
  const size = typeof input === 'string' ? Buffer.byteLength(input) : input.length;
  if (size > limits.bytes) throw new CoverageError(`the file is larger than ${limits.bytes} bytes`);
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: false }).decode(input);
  const c = collector(mounts, base, limits);
  let file;
  let open = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const at = i + 1;
    const l = raw.trim();
    if (l === '') return;
    if (l.startsWith('SF:')) {
      if (open) throw new CoverageError('SF inside a record', at);
      if (l.length === 3) throw new CoverageError('an SF without a path', at);
      file = c.file(l.slice(3));
      open = true;
    } else if (l === 'end_of_record') {
      if (!open) throw new CoverageError('end_of_record outside a record', at);
      open = false;
    } else if (l.startsWith('DA:')) {
      if (!open) throw new CoverageError('DA outside a record', at);
      const [n, hits] = l.slice(3).split(',');
      c.line(file, int(n ?? ''), int(hits ?? ''), at);
    } else if (/^L[FH]:/.test(l)) {
      if (!open) throw new CoverageError(`${l.slice(0, 2)} outside a record`, at);
      if (Number.isNaN(int(l.slice(3)))) throw new CoverageError(`${l.slice(0, 2)} isn't a whole number`, at);
    } else if (!LCOV_IGNORED.test(l)) throw new CoverageError('a record lcov doesn\'t have', at);
  });
  if (open) throw new CoverageError('the last record has no end_of_record');
  return c.done();
}

// Cobertura XML, on 16a's XML reader (which lets through the DOCTYPE naming Cobertura's DTD, and
// fetches nothing): each <class filename> is relative to one of <sources>' <source> folders, and
// its own <lines> count; <methods>' copies of them don't. With several sources, the one where the
// file exists in the run's copy (`exists`, given a project path), else the first that maps.
export function parseCobertura(input, { mounts, base, exists = () => false, limits = COVERAGE_LIMITS }) {
  let root;
  try {
    root = parseXml(input, { bytes: limits.bytes, depth: 64, elements: limits.elements }, { externalDoctype: true });
  } catch (err) {
    if (err instanceof XmlError) throw new CoverageError(err.message);
    throw err;
  }
  if (root.name !== 'coverage') throw new CoverageError(`the root element is <${root.name.slice(0, 40)}>, not <coverage>`);
  const sources = root.children.filter((e) => e.name === 'sources').flatMap((e) => e.children.filter((s) => s.name === 'source').map((s) => s.text.trim()));
  const c = collector(mounts, base, limits);
  const classes = [];
  const walk = (el) => {
    for (const e of el.children) {
      if (e.name === 'class') classes.push(e);
      else if (e.name === 'packages' || e.name === 'package' || e.name === 'classes') walk(e);
    }
  };
  walk(root);
  for (const cls of classes) {
    const name = cls.attrs.filename;
    if (typeof name !== 'string' || name === '') throw new CoverageError('a <class> without a filename');
    // Absolute, or the first source it maps from; with no source, from the base.
    const candidates = name.startsWith('/') ? [name] : sources.length ? sources.map((s) => `${s.replace(/\/+$/, '')}/${name}`) : [name];
    const mapped = candidates.filter((p) => toProjectPath(mounts, p, base) !== null);
    const hit = mapped.find((p) => exists(toProjectPath(mounts, p, base))) ?? mapped[0] ?? candidates[0];
    const file = c.file(hit);
    for (const lines of cls.children.filter((e) => e.name === 'lines')) {
      for (const line of lines.children) {
        if (line.name !== 'line') continue;
        c.line(file, int(line.attrs.number ?? ''), int(line.attrs.hits ?? ''));
      }
    }
  }
  return c.done();
}

// Reads a coverage file by its adapter's format: { coverage: 'ok', files, unmapped } or
// { coverage: 'malformed', reason }.
export function readCoverage(format, bytes, options) {
  try {
    const parsed = format === 'cobertura' ? parseCobertura(bytes, options) : parseLcov(bytes, options);
    return { coverage: 'ok', ...parsed };
  } catch (err) {
    if (err instanceof CoverageError) return { coverage: 'malformed', reason: err.message };
    throw err;
  }
}
