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
