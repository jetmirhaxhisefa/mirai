import { createHash } from 'node:crypto';

import { included } from '../util/glob.js';

// Diff coverage (unit 16b; D-45 point 3): of the lines a change added, the ones that can run, and
// of those, the ones that ran. Data only: whether it warns (unit 26) or blocks (unit 54) is
// decided there.
//   - changed: the added lines (a removed line can't be covered);
//   - measurable: the changed lines the coverage lists (lines that can run);
//   - covered: measurable lines with at least one hit;
//   - unmeasured: changed files with added lines that the coverage doesn't list at all (a new
//     file no test loaded, or a file the runner doesn't measure), apart, never counted as covered;
//     also files git called binary (a real binary, or a `-diff` attribute that hides a text
//     file's lines) and untracked files too large to read, with `changed: null`.
// Deleted files have no added lines and aren't listed.
//
// The coverage is the branch's evidence, not proof: the runner's config (include and exclude
// lists, ignore comments, the coverage provider) is the branch's, and decides what's listed and
// measurable. Units 17b, 26 and 54 compare it with the integration branch's baseline.

// `changed` is changedLines' { files }; `coverage` is { files } from src/tests/coverage.js;
// `paths` (optional) are path patterns (src/util/glob.js, `!` excludes) a file must match to count.
export function diffCoverage(changed, coverage, { paths = null } = {}) {
  const files = [];
  const unmeasured = [];
  const total = { changed: 0, measurable: 0, covered: 0 };
  for (const f of changed.files) {
    if (paths && !included(paths, f.path)) continue;
    if ((f.binary && f.status !== 'deleted') || f.too_large) {
      unmeasured.push({ path: f.path, changed: null, reason: f.too_large ? 'too-large' : 'binary' });
      continue;
    }
    if (f.added.length === 0) continue;
    const lines = Object.hasOwn(coverage.files, f.path) ? coverage.files[f.path] : null;
    if (!lines) {
      unmeasured.push({ path: f.path, changed: f.added.length, reason: 'not-listed' });
      continue;
    }
    const measurable = f.added.filter((n) => Object.hasOwn(lines, n));
    const uncovered = measurable.filter((n) => lines[n] === 0);
    const row = { path: f.path, changed: f.added.length, measurable: measurable.length, covered: measurable.length - uncovered.length, uncovered };
    files.push(row);
    total.changed += row.changed;
    total.measurable += row.measurable;
    total.covered += row.covered;
  }
  return { files, unmeasured, total };
}

// The lines a ticket's commits added (unit 26b), for the gate: `changedLines` between two commits
// with `--text` (so a branch's `.gitattributes` can't hide a file's lines) and exact renames (a
// pure move adds nothing; Jet's decision 4). A file whose new bytes are binary, or larger than
// `maxBytes`, has no lines and is marked, as 16b's unmeasured files.
export function gateChanges({ root, env, base, head, changedLines, blobAt, isBinary, maxBytes = 4 * 1024 * 1024 }) {
  const { files } = changedLines(root, base, head, env, { text: true, renames: 'exact' });
  return {
    files: files.map((f) => {
      if (f.status === 'deleted' || f.added.length === 0) return f;
      const bytes = blobAt(root, head, f.path, env, { maxBytes });
      if (bytes === null) return { ...f, added: [], too_large: true };
      if (isBinary(bytes)) return { ...f, added: [], binary: true };
      return f;
    }),
  };
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// Line numbers as ranges: [3, 4, 5, 9] → ["3-5", "9"].
export function lineRanges(lines) {
  const out = [];
  for (let i = 0; i < lines.length;) {
    let j = i;
    while (j + 1 < lines.length && lines[j + 1] === lines[j] + 1) j++;
    out.push(i === j ? `${lines[i]}` : `${lines[i]}-${lines[j]}`);
    i = j + 1;
  }
  return out;
}

export const COMBINED_LIMITS = Object.freeze({ files: 200, ranges: 50 });

// Diff coverage over every level (unit 26b; Jet's decisions 2 and 3). `changed`: gateChanges'
// { files }. `levels`: [{ name, coverage: { files } | null (this run gave none), state, scope }],
// where `scope` is { kind: 'coverage_paths', paths } (the integration branch's config) or
// { kind: 'baseline', files } (the files the level's baseline measured) or null. `codePaths`: the
// integration branch's `gate.code_paths` (the proof's own scope). Per changed file:
//   - listed by any level: its lines any level lists are measurable, the ones any level ran are
//     covered (a line counts covered when any level ran it);
//   - listed by none, but inside a level's scope: every added line uncovered (`not-measured`, or
//     `no-coverage` when a level in whose scope it is gave no coverage this run);
//   - listed by none, outside every scope: apart (`outside`), shown, not counted;
//   - binary or too large: apart.
// Returns { total, files (capped, with `uncovered` as line ranges), apart (capped), more,
// changed_sha256 }. `changed_sha256` binds the lines counted: [path, from?, added] sorted by path.
export function combinedCoverage(changed, levels, { codePaths, limits = COMBINED_LIMITS } = {}) {
  const total = { changed: 0, measurable: 0, covered: 0 };
  const rows = [];
  const apart = [];
  const bound = [];
  const inScope = (lv, path) => (lv.scope?.kind === 'coverage_paths' ? included(lv.scope.paths, path) : lv.scope?.kind === 'baseline' ? lv.scope.files.includes(path) : false);
  for (const f of [...changed.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (!included(codePaths, f.path)) continue;
    if (f.status === 'deleted') continue;
    if (f.binary || f.too_large) {
      apart.push({ path: f.path, why: f.too_large ? 'too-large' : 'binary' });
      bound.push([f.path, f.from ?? null, f.too_large ? 'too-large' : 'binary']);
      continue;
    }
    if (f.added.length === 0) continue;
    bound.push([f.path, f.from ?? null, f.added]);
    const listing = levels.filter((lv) => lv.coverage && Object.hasOwn(lv.coverage.files, f.path));
    if (listing.length > 0) {
      const measurable = f.added.filter((n) => listing.some((lv) => Object.hasOwn(lv.coverage.files[f.path], n)));
      const uncovered = measurable.filter((n) => !listing.some((lv) => (lv.coverage.files[f.path][n] ?? 0) > 0));
      rows.push({ path: f.path, changed: f.added.length, measurable: measurable.length, covered: measurable.length - uncovered.length, uncovered });
      total.changed += f.added.length;
      total.measurable += measurable.length;
      total.covered += measurable.length - uncovered.length;
      continue;
    }
    const scoped = levels.filter((lv) => inScope(lv, f.path));
    if (scoped.length === 0) {
      apart.push({ path: f.path, why: 'outside', changed: f.added.length });
      continue;
    }
    const silent = scoped.filter((lv) => !lv.coverage).map((lv) => lv.name);
    rows.push({ path: f.path, changed: f.added.length, measurable: f.added.length, covered: 0, uncovered: f.added, why: silent.length ? `no-coverage: ${silent.join(', ')}` : 'not-measured' });
    total.changed += f.added.length;
    total.measurable += f.added.length;
  }
  const short = (r) => ({ ...r, uncovered: lineRanges(r.uncovered).slice(0, limits.ranges) });
  const withGaps = rows.filter((r) => r.uncovered.length > 0);
  const full = rows.filter((r) => r.uncovered.length === 0);
  const files = [...withGaps, ...full].slice(0, limits.files).map(short);
  return {
    total,
    files,
    apart: apart.slice(0, limits.files),
    more: { files: Math.max(0, rows.length - files.length), apart: Math.max(0, apart.length - limits.files) },
    uncovered_files: withGaps.length,
    changed_sha256: sha256(JSON.stringify(bound)),
  };
}
