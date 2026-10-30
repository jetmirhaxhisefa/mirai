---
unit: "16b"
name: coverage-diffs
status: approved (2026-10-30)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 16b; D-48 item 5, D-40, R2-M7 (TL2-21), G7, D-45 point 3 (diff coverage)
depends_on: ["16a"]
---

# Unit 16b: Coverage and diffs

## Why

The gate checks **diff coverage, not file coverage**: only the lines a ticket changes need tests
(D-45 point 3, "diff coverage, not file coverage"). Unit 26 warns on it, and unit 54 makes it
block. That needs three things MIRAI doesn't have yet:
- **the coverage a test run produced**, per file and line, in a form that doesn't depend on the
  stack;
- **the lines a change touched,** from a unified diff;
- **the two put together:** of the changed lines that can run, which ran.

D-48 item 5 and R2-M7 set the formats: **lcov or Cobertura** coverage and **unified diff**, each
read by a small zero-dependency parser (D-40). G7 asks whether diff coverage "can be produced for
each stack the pilot uses, inside its containers". This unit answers it on the sample app,
whose stacks are the pilot's.

**The same rules as 16a:**
- **Built in, the same for every stack:** the parsers, the mapping to project paths and the
  diff-coverage arithmetic.
- **Each runner's coverage options are data,** a new `[coverage]` section in its test adapter. A
  runner without one (Playwright: browser tests don't measure the app's code) simply can't be
  asked for coverage.

**Roadmap "done when" covered here:**
- coverage parses on the sample app's levels;
- a malformed coverage file is an environment fault.

## Scope

**In:**

1. **Facts first: coverage probes on the sample app** (`test/probes/adapter-probes.js`, new k-
   scenarios; Docker Desktop, the sample app's images; open point 3):
   - **K1:** the options that make each runner write coverage into the run's output folder, and
     the file:
     - PHPUnit: `--coverage-cobertura <file>`, with the pcov driver the image already has;
     - Vitest: `--coverage.enabled --coverage.reporter=lcov
       --coverage.reportsDirectory=<dir>`, with `@vitest/coverage-v8`, which the image already
       has. The probe also checks whether this replaces or adds to the config's reporters;
   - **K2:** the paths in each file (absolute, relative to what), and which lines count: lines
     that can run, versus lines of the file;
   - **K3:** coverage on a one-file or one-test run (only what ran, or every file at 0);
   - **K4:** what a run that fails, or doesn't load, leaves as coverage.

   Plus 16a's two open Playwright cases (open point 4): a folder, and a config without a junit
   reporter.

2. **The adapter's `[coverage]` section** (schema `test-adapter/1` gains an optional table):
   - `format = "lcov"` or `"cobertura"`;
   - `args` and/or `env` that ask for it, with the placeholders `{coverage}` (the file) and
     `{coverage_dir}` (a folder for runners that pick their own file name), both in the output
     folder;
   - `file`: the file's name in that folder, for runners that choose it (Vitest: `lcov.info`);
   - the same rules as 16a's templates: one argument each, no value starts an argument.

3. **Parsers** (zero dependencies):
   - **`src/tests/lcov.js`:** the records `SF`, `DA`, `LF`, `LH` and `end_of_record`. `TN`,
     `FN*` and `BR*` are read and ignored. Anything else is a malformed file, as is a `DA`
     outside its record or a number out of range. Limits: 64 MiB, 100,000 files, 10 million
     lines;
   - **`src/tests/cobertura.js`:** on 16a's XML reader: `<sources><source>`, and `<class
     filename>` with `<line number hits>` (`<methods>` and conditions ignored). The same limits;
   - **both give** `{ files: { <project path>: { lines: { <n>: hits } } }, unmapped }`. Each path
     is mapped to the project through the service's mounts (16a's `paths.js`): lcov's absolute
     or working-folder-relative paths, and Cobertura's `<source>` plus `filename`. A path
     outside the project's mounts (a library) is counted in `unmapped`, never guessed;
   - **`src/tests/diff.js`:** a unified diff as git writes it (`diff --git`, `---`/`+++`, `@@`
     hunks, `new file`, `deleted file`, `Binary files … differ`, `\ No newline at end of file`,
     quoted paths). It gives `{ files: [{ path, status, added: [<new line numbers>], removed: [<old
     line numbers>], binary }] }`. Limits: 64 MiB, 100,000 files.

4. **The changed lines** (`src/store/git.js`): `changedLines(root, from, to?, env)` runs the
   pinned git with the flags units 12 and 14b use (`--no-ext-diff --no-textconv --no-color
   --no-renames`), plus `-U0 --diff-algorithm=myers`, from a commit to a commit or to the work
   tree (untracked files count as wholly added, as `changedNames` does). Unit 25's proof hash
   will use the same parser on its own normalized diff.

5. **Diff coverage** (`src/tests/diff-coverage.js`): `diffCoverage(changed, coverage, { paths? })`
   → per file and in total:
   - `changed`: the added lines;
   - `measurable`: those the coverage file lists, so lines that can run;
   - `covered`: measurable with hits > 0;
   - `uncovered`: the line numbers;
   - `unmeasured` files: changed files the coverage doesn't list at all (a new file no test loaded,
     or a file the runner doesn't measure), reported apart, never counted as covered.

   `paths` limits it to given patterns (unit 25 passes `code_paths`). The result is data only:
   whether it warns (unit 26) or blocks (unit 54) isn't decided here.

6. **Runs with coverage:**
   - `runTest({ coverage: true })`, `mirai test <level> --coverage`, and `run_tests(…,
     coverage: true)`. Coverage slows a run, so it's never on by default;
   - only on a level whose adapter has `[coverage]`; otherwise refused (`no-coverage`);
   - **stored:** `coverage.json` beside the result (`{ files, unmapped }`), with its hash and the
     raw file's in the result, as 16a does for cases. The result gets a summary: `{ files, lines,
     covered }`;
   - **a run asked for coverage that leaves none, or a malformed file, is an environment fault**
     (`bad-coverage`), as with 16a's report: the roadmap's rule. A run whose tests didn't load
     stays a `load` failure;
   - the reply gets the summary only; the per-line data stays in the store.

7. **`mirai test <level> --coverage --against <ref>`** prints diff coverage for the work tree
   against the merge base with `<ref>` (such as `main`): per file, changed / measurable /
   covered, and the uncovered line numbers. It's for you to check the numbers on a real change
   (G7). Agents and the gate get diff coverage in their own units (21, 25, 26).

8. **The sample app's config** (your commit, as in 16a): nothing for coverage itself (the options
   are in the adapters). I'll give you the refresh command once this is pushed.

9. **Docs:**
   - `docs/test-adapters.md` gains `[coverage]`;
   - `docs/agent-safety.md` gains `coverage` in `run_tests`;
   - research/12 gets K1–K4 and the two Playwright cases;
   - G7 in design/05 gets its answer for the sample app's stacks.

**Out:**
- **The gate's use** (warn in unit 26, block in unit 54) and the normalized proof hash (unit 25).
- **Branch coverage.** Lines only: D-45's rule is about lines, and both formats have them.
- **Coverage of a browser test level** (Playwright): no adapter section, so refused.
- **A coverage baseline** (unit 17, "coverage if available").

## Files

- **New:**
  - `src/tests/lcov.js`, `src/tests/cobertura.js`, `src/tests/diff.js`,
    `src/tests/diff-coverage.js`;
  - `test/tests/coverage.test.js`, `test/tests/diff.test.js`, and corpus files under
    `test/tests/corpus/` (from K1–K4, and hand-made ones);
  - `implementation/units/16b-coverage-diffs/{spec,test-results,review}.md`.
- **Changed:**
  - `src/config/registry.js` (the adapter's `[coverage]`);
  - `registry/test-adapters/{phpunit,vitest}.toml`;
  - `src/tests/adapters.js` (coverage argv);
  - `src/tests/run.js` (coverage runs, `coverage.json`, `bad-coverage`);
  - `src/store/git.js` (`changedLines`);
  - `src/mcp/tools/tests.js` (`coverage`);
  - `src/cli/commands/test.js` (`--coverage`, `--against`);
  - `test/probes/adapter-probes.js` (k- scenarios);
  - docs, research/12, design/05 (G7).

## Tests

`npm test`, no Docker:
- **T1: lcov.** Real files (K1) and hand-made ones: records, ignored records, malformed lines,
  `DA` outside a record, the limits, paths mapped and unmapped.
- **T2: Cobertura.** Real files and hand-made ones: `<source>` plus `filename`, several sources,
  a DOCTYPE refused (16a's reader), the limits.
- **T3: the diff parser.** Real `git diff -U0` output from fixture repos:
  - added, removed and changed lines; a new file, a deleted file, a binary file; no newline at
    the end;
  - quoted paths, with spaces, quotes, tabs or non-ASCII characters;
  - an empty diff; malformed hunks; the limits.
- **T4: `changedLines`.** A fixture repo, commit to commit and commit to work tree:
  - untracked files count as added;
  - the pinned flags hold: a repo's `diff.external` or textconv is never used;
  - renames are two paths.
- **T5: diff coverage.** Changed lines against coverage:
  - a line that can't run isn't measurable;
  - an unmeasured file is reported apart, never counted as covered;
  - `paths` filters;
  - an empty change is `0 / 0`, which isn't a failure.
- **T6: runs** (16a's fake docker, which also leaves a coverage file):
  - the argv with coverage;
  - `coverage.json` and its hash;
  - a missing or malformed coverage file is `bad-coverage`;
  - `no-coverage` on a level whose adapter has no `[coverage]`;
  - without `coverage`, nothing changes.
- **T7: `run_tests` and `mirai test`:** `coverage` and `--against`, the summary inline, the budget.
- **T8:** stack neutrality (14c's T13) and the probes staying local, as in 16a.

**Probes:** K1–K4 and the two Playwright cases on the sample app, with your OK.

## Open points for you

1. **The changed lines are the added lines only** (`+` lines of `-U0`). A removed line can't be
   covered. Recommended, as in D-45's "only the lines a ticket changes".
2. **Unmeasured changed files are reported apart, never counted** as covered or as uncovered. Two
   cases fall here: a new file no test loads, and a file type the runner doesn't measure (a
   template, a config file). Counting them as uncovered would punish the second. Leaving them
   out entirely would hide the first. Recommended: reported apart; unit 26 or 54 decides what
   to do with them.
3. **Probe runs on the sample app:** about 8, all local, with no subscription:
   - K1–K4 for PHPUnit and Vitest;
   - 16a's two Playwright cases.

   I'll stop and tell you if a batch has to be redone. The 16a estimate was off by double, and
   this time I'll say so before going past it.
4. **16a's two Playwright cases go in this unit's probes.** If the config without a junit
   reporter really leaves no report, the adapter adds `--reporter=list,junit`. That changes the
   output's look and drops the config's other reporters for MIRAI's runs. The alternative is to
   keep it as a documented requirement. Recommended: probe first, then choose with you.
5. **`--against` is for you only in this unit.** Agents and the gate get diff coverage in units
   21, 25 and 26, where it's decided how they use it. Recommended, to keep this unit to the
   parsers and the data.

## Changes after testing and review

**From the probes (K1–K4 and 16a's two Playwright cases, research/12):**

1. **Cobertura files have a DOCTYPE.** PHPUnit's name the Cobertura DTD
   (`<!DOCTYPE coverage SYSTEM "…coverage-04.dtd">`), and 16a's reader refused every DOCTYPE.
   - The reader gains an opt-in, used only for Cobertura: one DOCTYPE that only names an external
     DTD, with no internal subset, is let through.
   - The DTD is never fetched, so it can declare nothing, and an entity it would define is still
     refused.
   - JUnit reports stay strict.
2. **Vitest writes no coverage when a test fails** unless `--coverage.reportOnFailure`, which its
   adapter now passes. Without it, every coverage run of a level with a failing test (the sample
   app's has the seeded flaky one) would be `bad-coverage`.
3. **A load failure leaves no coverage** in either runner. So "no coverage" isn't `bad-coverage`
   when the run has any `load` entry. That includes Vitest's per-file one, not only 16a's
   run-level flag.
4. **Playwright with a config that has no junit reporter wrote no report.** Following your choice
   (open point 4, option A), its adapter now passes `--reporter=list,junit` itself. That wins over
   the config, which a branch controls. The config's other reporters don't run in MIRAI's runs.
   Probed through the adapter: a config listing only `list` gave a full report.
5. **Playwright with a folder works** through 16a's anchored path (probed: 10 tests).
6. **The files are read after the containers are gone** (for a level with an adapter). The
   coverage file sits in a subfolder of the output folder, and a running container could swap
   that folder for a link between MIRAI's check and its read. So the containers are removed
   first, and every folder on the way to the file must be a real folder.
7. **A bug the probes caught:** the placeholder filler didn't take `_`, so `{coverage_dir}`
   reached Vitest as text. Fixed, with a test that no coverage argument is left unfilled. That
   cost one probe run.
8. **The probe count:** 11 runs against the 8 estimated. The 8 approved; then 2 more you
   approved (Vitest's `reportOnFailure`, and Playwright's `--reporter`); then 1 more you approved
   after the filler bug. All local, with no subscription use.

**Other changes from the spec:**

9. **Files:**
   - lcov and Cobertura are one file, `src/tests/coverage.js`, sharing the mapping and limits;
   - the safe reader is now `readOutFile` in `src/tests/results.js`, used for the report and the
     coverage file;
   - `changedLines` in `src/store/git.js` uses `src/tests/diff.js`.
10. **Git's own quirks in the diff:** a tab after a `---`/`+++` path that holds a space; octal
    escapes in quoted paths. A repo whose config sets a diff driver is refused before any diff
    (14b), so `changedLines` never runs one.
11. **The CLI's diff-coverage line** gives all added lines, and how many are in files the
    coverage doesn't list. The data keeps those files apart (open point 2).

**From the review (`review.md`):**

12. **`changedLines` refuses a nested repo before the diff** (it ran the diff first, so a nested
    repo's own filter could run).
13. **The coverage parsers are linear in files,** and Cobertura is capped at 3M elements.
14. **A failing run without coverage stays failing,** recording `coverage.state`. `bad-coverage`
    applies only to a run that would pass, and the report's check comes first.
15. **Binary and too-large changed files are listed apart** in `unmeasured`, with a reason, never
    skipped. A `-diff` attribute can't hide changed lines.
16. **`--against` needs the whole level** (no `--path` or `--test`), and the diff is taken before
    the run.
17. **Coverage is the branch's evidence, not proof.** The runner's config decides what's
    measurable. This is now in the docs, and the gap is recorded for units 17, 26 and 54 (a
    trusted `coverage_paths`, a comparison with the baseline). It answers open point 2's "units
    26 and 54 decide".
18. **G7 is answered for the stacks,** but is pending end to end: PHPUnit's coverage through its
    adapter, and `--against` on the sample app, after the refresh.
