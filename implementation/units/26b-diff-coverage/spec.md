---
unit: "26b"
name: diff-coverage
status: approved (2026-11-10; Jet's four decisions taken in the interview, the defaults as written)
roadmap: design/07-implementation-roadmap.md, row 26 (split, Jet's decision 2026-11-09: **26a** the `pre-push` hook, built; **26b** the diff-coverage warning with trusted `coverage_paths`); D-45 point 3 (diff coverage, not file coverage); G7 (design/05: diff coverage per stack); the row's notes from 16b's and 17b's reviews (the baseline's measured files, a trusted `coverage_paths` per level, renames, the record fields)
depends_on: ["16b", "17b", "25a", "26a"]
---

# Unit 26b: the diff-coverage warning

## Why

D-45 says only the lines a ticket changes need tests. 16b built the arithmetic (`diffCoverage`: changed, measurable, covered, unmeasured) and `mirai test --coverage --against <ref>`; 17b's baseline records each level's coverage and **the files it measures**. Nothing in the ship path uses them: the build's test run and `gate record` run without coverage, and the gate proof says nothing about it. So a ticket can ship new code no test ran, and nobody is told.

Milestone A **warns** (the PM and tech-lead reviews: advisory until G7 is settled); unit 54 makes it blocking, in CI. One weakness to close now, so 54 can build on it: the runner's coverage config (`phpunit.xml`, `vite.config.ts`) is the branch's, so a branch can stop a file from being measured and look covered. The integration branch's `coverage_paths` and its baseline decide which files must be measured.

Already built and waiting:

- `diffCoverage(changed, coverage, { paths })` (`src/tests/diff-coverage.js`, 16b): one level's numbers, per file.
- `changedLines(root, from, to, env, { text })` (`src/store/git.js`): git's added lines, pinned, renames off.
- Coverage on a test run (`runTest({ coverage: true })`, 16b): `coverage.json` beside the signed result; a passing run that leaves none is an environment fault, a failing run keeps its outcome.
- The baseline's `levels.<name>.measured = { files, sha256 }` (17b).
- The gate proof (25a) and the push check that reads it (26a).

## Decisions (Jet, 2026-11-09, in the interview)

1. **Where:** `mirai gate record` runs each level whose adapter has coverage **with coverage** (as `mirai baseline` already does), computes diff coverage from the merge-base to HEAD, prints it, and **signs the numbers into the gate proof**. The pre-push hook prints a warning from the proof; it never re-runs anything and never blocks. Not in the build loop (unit 21's fix rounds can use it later).
2. **Which lines count:** a changed line is covered when **any** level ran it. Each test level may set a **trusted `coverage_paths`** (globs), read only from the integration branch's config, so a branch can't narrow it. A changed file inside a level's `coverage_paths` that no level's coverage lists counts as **wholly uncovered** (every added line). A level without `coverage_paths` falls back to **the files its baseline measured**: a file the baseline measured that no level lists now is uncovered, and a new file outside them is shown apart, not counted. Only files inside `gate.code_paths` (the proof's own scope). The sample app gets `coverage_paths` for `unit` (`backend/app/**`) and `frontend` (`frontend/src/**`).
3. **When it warns:** whenever any counted line didn't run. The numbers are always printed and signed, even at 100%. No threshold now: unit 54 decides what blocks, with the pilot's numbers.
4. **Renames: exact moves only.** Diff coverage asks git for renames with identical content (`--find-renames=100%`): a pure move adds no lines. A moved file with any edit stays wholly added. Exact matches don't depend on git's similarity heuristic, so CI's git (54) finds the same. The proof's code hash is untouched (renames off, 25a).

Defaults taken with the decisions (not asked; say if you want them otherwise):

- **A level whose run didn't give coverage** (its tests didn't load, so no `coverage.json`) leaves its files unknown: the warning names the level and counts its scope's lines as unmeasured, never covered.
- **`coverage_paths` on a level whose adapter has no coverage** (Playwright): `gate record` says so as a gap line and ignores it; `config check` can't know the adapter's coverage (the adapter is read at run time).
- **A 25a gate proof without the new field** still passes `gate check` and the push; the push says "no diff coverage in this proof (recorded before unit 26b)". Nothing else changes in the proof format (`mirai/proof/1`: a new field, signed with the rest).
- **Capped lists:** the proof keeps up to 200 files with their uncovered line ranges; the push prints the first 5 files, then "and N more: mirai gate check <ticket>".

## Scope

**In.**

1. **Config** (`src/config/config-schema.js`): `[[testing.levels]] coverage_paths = [ … ]`, globs as `gate.code_paths` (`!` excludes; at least one including pattern). Read by `gate record` from the trusted config (`trustedConfig`, the integration branch's), never the work tree's.
2. **Exact renames** (`src/store/git.js`, `src/tests/diff.js`): `changedLines(…, { renames: 'exact' })` runs `--find-renames=100%` (pinned, with `--text`); `parseDiff` accepts a `rename from`/`rename to` pair only with `similarity index 100%` and only when asked, and gives the new path with no added lines. Anything else with two paths is still refused.
3. **The combined numbers** (`src/tests/diff-coverage.js`, `combinedCoverage`): from the changed lines and each level's `coverage.json`, per file inside `gate.code_paths`:
   - listed by any level → measurable = the lines any level lists, covered = any level's hit;
   - listed by none, inside a level's scope (its `coverage_paths`, or else its baseline's measured files) → uncovered, every added line (`not-measured`);
   - listed by none and outside every scope → apart (`outside`), shown, not counted;
   - binary or too large → apart, as 16b.
   Returns `{ total: { changed, measurable, covered }, files: [{ path, changed, measurable, covered, uncovered: [ranges], why? }], apart: [{ path, why }], levels: { name: { coverage: 'ok' | <state>, scope: 'coverage_paths' | 'baseline', measured_sha256 } } }`.
4. **`mirai gate record`** (`src/proofs/record.js`): the levels with a coverage adapter run with `coverage: true`; after the verdict, `combinedCoverage` from the merge-base (the proof's `base_sha`) to HEAD; printed as `diff coverage: 41 of 45 changed lines ran (91%)`, then the files with lines that didn't run. A pass still records whatever the numbers are (decision 3).
5. **The gate proof's new field** `diff_coverage`: `{ base_sha, renames: 'exact', changed_sha256 (the changed lines, path by path, as sorted JSON), total, files (capped), apart (capped), levels (each level's coverage result digest, scope and the baseline's measured-files hash) }`.
6. **The push** (`src/hooks/pre-push.js`, `src/cli/commands/hook.js`): a MIRAI branch that passes reads its gate proof's `diff_coverage` and adds `warning: diff coverage 41 of 45 changed lines ran (91%); didn't run: <file> 12-14, …` under its `pass` line when anything is uncovered or not measured, or `diff coverage: all 45 changed lines ran` when everything ran. Exit status unchanged. `mirai gate check <ticket>` prints the same, in full.
7. **Docs:** `docs/pre-push.md` (the warning), `docs/test-adapters.md` (`coverage_paths`; exact renames), `docs/test-baseline.md` (the measured files now used), D-45 "Update (unit 26b)", G7's row (the gate measures it end to end; blocking stays 54), roadmap row 26 (26b built), the sample app's `coverage_paths` lines for you to commit with its refresh.

**Out.**

- **Blocking** on diff coverage, a threshold, and CI recomputing it: unit 54.
- **Coverage in the build loop** (the agent told which lines no test ran, before handover): a later fix-round unit; say if you want it noted on the roadmap.
- **Branch and function coverage:** lines only (16b).
- **Characterization tests** (D-45 point 4): the plan and Rex (units 08 and 24).

## Probes (with your OK)

One manual run on the sample app (yours, about 12 minutes, one Sonnet review as in 25a's and 26a's P1), in a probe clone with a probe home; the clone's `main` gets the `coverage_paths` lines before the baseline:

- **P1.** SAMPLE-1 built, reviewed by Rex, `gate record` with coverage: the numbers printed and in the gate proof, PHPUnit's coverage through its adapter end to end (G7's open item); the push to a bare repo prints the warning or "all ran". Then, no model: a branch from that state with a new untested method in `TaskController.php` → `mirai test unit --coverage --against main` lists its lines as not run; a pure `git mv` of a file → no changed lines.

## Files

- **New:** tests in `test/tests/diff-coverage-combined.test.js` and `test/proofs/coverage.test.js`; `test/probes/coverage-probes.js`.
- **Changed:** `src/config/config-schema.js`, `src/store/git.js`, `src/tests/diff.js`, `src/tests/diff-coverage.js`, `src/proofs/record.js`, `src/proofs/check.js` (print the field), `src/hooks/pre-push.js`, `src/cli/commands/hook.js` and `gate.js`, docs.

## Tests (`npm test`, no model; the stand-in test runner with coverage files)

- Config: `coverage_paths` accepted on a level, refused when it has only excludes; the work tree's value ignored in favour of the integration branch's.
- Renames: a pure `git mv` → no changed lines; a move plus one edited line → the whole file added; a rename header that isn't 100% → refused, as now.
- Combining: a line run by one level and not another → covered; a changed file inside `coverage_paths` that no level lists (the branch's `phpunit.xml` excludes it) → every line uncovered; a file the baseline measured that the branch's run doesn't list → uncovered; a new file outside every scope → apart; outside `gate.code_paths` → not in it at all; a level with no coverage this run → unmeasured, named.
- `gate record`: levels run with coverage; the proof carries `diff_coverage`, its `changed_sha256` and numbers match a recomputation; 100% → no warning; the known failure in `unit` still gives coverage.
- The push: a branch with uncovered lines → pushed, with the warning; fully covered → pushed, "all ran"; a 25a proof without the field → pushed, "no diff coverage in this proof".

## Done when

- The tests pass, P1 is recorded in `test-results.md`, and after the sample app's refresh (with its `coverage_paths`) the red team is green and the baseline signed. The row's done-when for 26b: diff coverage warns (and doesn't block) in Milestone A, from the signed gate proof; a file the branch stops measuring counts as uncovered; renames decided (exact moves only).

## Open points for you

The four decisions are taken (above), and four defaults are named. Approve the spec, or say which default to change.

## Changes during the build (2026-11-10)

1. **Binary files are told apart by their bytes, not by git.** The changed lines are read with `--text`, so a branch's `.gitattributes` (`-diff`, `binary`) can't hide a file's lines from the warning; a file whose new content is binary (a NUL byte in its first 8,000 bytes, the review's rule) or over 4 MiB is listed apart. Spec item 3 said "as 16b", which trusts git's binary call.
2. **The git probe covers the new calls:** `git-probes.js --mirai` gained 26a's `rangeCommits`, `hasTrackingRefs` and `pushLog` (PROGRESS's open item from 26a) and 26b's `changedLines` with exact renames; every case passed (2026-11-10).
3. **Test files:** the combining rules, renames, the text and `gate record` are in `test/proofs/coverage.test.js`; the push's warning in `test/hooks/pre-push.test.js`; `coverage_paths` in `test/config/config.test.js`'s T17. The stand-in covering run and the coverage config are in the shared `test/proofs/fixture.js`.
4. **`gate check` always prints the coverage lines** of the gate proof it matched (all files); `gate record` prints up to 20, the push 5.
