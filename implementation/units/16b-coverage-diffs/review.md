---
unit: "16b"
date: 2026-10-30
reviewers: Tech Lead, Architect (independent, read-only, no network, no Docker, no probes, never the real claude, never your Claude Code config)
verdicts: no Blocker; Tech Lead two High (fixed), Architect one High (a design gap, recorded for units 17, 26 and 54); every Medium fixed or recorded; two fixes checked by mutation
---

# Unit 16b — Review

Both reviewers worked on a frozen tree, in their own `mktemp -d` copies, removed afterwards.
- **Restrictions:** no network calls, no Docker, no probes, never the real `claude`. They changed
  nothing in either repo.
- **The Tech Lead** reproduced each finding in a copy, timed the parsers on hostile input, and
  ran mutations against the new tests (six survived: see "Test gaps").
- **The Architect** checked the design against units 17, 21, 25, 26 and 54, and ran the new test
  files (26/26).

**What held up:**
- **The diff parser** against real git output with the pinned flags:
  - quoted paths, and the trailing tab after a path with a space;
  - a leading `-`, mode-only changes, empty files, links;
  - no newline at the end, CRLF, binary files, conflict markers.

  Git keys that would change the output are refused by 14b's repo check.
- **The `externalDoctype` opt-in:**
  - Cobertura only, one DOCTYPE, before the root;
  - SYSTEM or PUBLIC, no internal subset, bounded lengths;
  - never fetched; other entities still refused; JUnit strict.

  It admits nothing dangerous.
- **`readOutFile` after cleanup:**
  - every folder `lstat`ed, then the file opened with `O_NOFOLLOW|O_NONBLOCK` and `fstat`ed;
  - once the containers are gone (a cleanup failure is a fault), nothing else writes the output
    folder.
- **`--against`:** no leading `-`, `^{commit}` with `--verify`, no option injection.
- **The design pieces:**
  - **the `[coverage]` shape** is minimal and right, with `no-coverage` kept apart from faults;
  - **`coverage.json`** is hashed with the raw file;
  - **Playwright's `--reporter=list,junit`** is right: the trust root, not the branch's config,
    sets the reporter.
- **Personal data:** none in the corpus, docs, tests or probes.

## Fixed in unit 16b

| # | Finding | Severity, from | Fix | Test |
|---|---|---|---|---|
| 1 | **`changedLines` ran the diff before its nested-repo check.** With a gitlink in the index, the outer diff runs status in the nested repo, whose own `.git/config` filter then ran (reproduced: the marker was made, then `repo-nested`). `changedNames` checks first, on purpose (14b) | High, Tech Lead | Untracked files and `checkNested` first, then the diff | An inner repo with a `filter.evil.clean`: refused, the marker never made. Checked by mutation |
| 2 | **The coverage parsers were quadratic in files** (`Object.keys` per new file): 10,000 files in a 0.3 MB lcov took 50 s; 100,000 would take about an hour, holding the repo lock and the MCP server's event loop | High, Tech Lead | A running count | 20,000 files well under the limit (about a second) |
| 3 | **A failing run with no coverage became an environment fault,** so an agent's broken code read as "check the coverage driver". And with both files missing, the error named coverage, not the report | Medium, Tech Lead | Coverage is read once the outcome is known: a failing run records `coverage.state` and stays failing; `bad-coverage` only for a run that would pass. The report's check comes first | A failing run: `fail`, `{ state: 'missing' }`; both missing: `bad-report`. Checked by mutation |
| 4 | **A `-diff` or `binary` attribute hid changed lines** (git prints "Binary files differ", and diff coverage skipped binaries silently); untracked files over 4 MiB were "binary" too | Medium, Tech Lead | Binary files (not deleted ones) and too-large files are listed apart in `unmeasured`, with `changed: null` and a reason | A committed `*.js -diff`: `a.js` binary, listed apart |
| 5 | **Cobertura's element limit** allowed about 11M elements (about 3 GB of memory on 43 MB of `<a/>`) | Medium, Tech Lead | 3M elements (`COVERAGE_LIMITS.elements`) | The cap refuses |
| 6 | **The code comments overstated the diff parser for unit 25:** it keeps line numbers, not content; it refuses `--binary`; the file order follows the repo's `diff.orderFile` | Medium, Architect | Reworded: unit 25 can build on it, and needs content, binary patches and a fixed order besides | — |
| 7 | **The docs didn't say coverage is the branch's evidence:** include and exclude lists, ignore comments, a custom provider, or the code writing the file itself decide what's measurable | High (design), Architect; Note, Tech Lead | docs/test-adapters.md, docs/agent-safety.md, `diff-coverage.js`'s comment; the gap is recorded for units 17, 26 and 54 (below) | — |
| 8 | **Smaller things:** <ul><li>with several Cobertura sources the first that mapped won;</li><li>quoted paths beyond the BMP were mangled (an emoji);</li><li>`untrackedFile` could block on a file swapped for a FIFO;</li><li>`constructor` or `__proto__` as a changed file read as measured;</li><li>`--against` was accepted with `--path` or `--test` (a partial run lists every other file at 0);</li><li>the CLI took the diff after the run;</li><li>"199 of 200" printed as 100%;</li><li>the diff's 10 s git timeout;</li><li>git's 8,000-byte binary sniff;</li><li>dead code in the hunk start;</li><li>the K4 claim for Vitest was confounded (probed without `reportOnFailure`);</li><li>agent-safety didn't describe the coverage read;</li><li>G7 read as settled</li></ul> | Low, both | <ul><li>the source where the file exists in the run's copy;</li><li>whole characters;</li><li>opened non-blocking, no links, `fstat`;</li><li>`Object.hasOwn`;</li><li>refused;</li><li>taken before the run;</li><li>rounded down;</li><li>120 s;</li><li>8,000;</li><li>removed;</li><li>research/12 says so;</li><li>described;</li><li>"pending end to end" in G7 and research/12</li></ul> | Two sources; an emoji path, through git; prototype names; the `--against` refusal; the highest count in both orders |

## Test gaps (the Tech Lead's surviving mutations)

| Mutation | Now |
|---|---|
| removing `checkNested` in `changedLines` | caught (fix 1) |
| last-wins for a line listed twice | caught: both orders tested |
| Vitest's per-file load case versus the run-level flag | caught: a Vitest-adapter level with a file-named case needs no coverage |
| removing the cleanup before the read | still not caught: the fake docker swaps the folder before the read either way, so the race can't be shown without real containers. The check of every folder on the way is tested |
| removing the 4 MiB cap on untracked files | not tested (a 4 MiB fixture). The cap is now `too_large`, listed apart |
| `--diff-algorithm=myers` | not tested: the repo check accepts `diff.algorithm=patience`, and showing a difference needs a crafted change. The pin stays |

## Noted for later units

| Unit | Note | From |
|---|---|---|
| 17 | <ul><li>Record which files each level measures, so 26 and 54 can see a branch stop measuring one;</li><li>detect a trusted `coverage_paths` per level</li></ul> | Architect |
| 21 | Kai may want the uncovered line numbers of its own change, bounded, in the reply | Architect |
| 25 | The diff parser needs line content, `GIT binary patch`, `-O/dev/null` and a fixed `indentHeuristic` for the proof hash, and sorting by path; a type change gives two entries for one path | both |
| 26, 54 | <ul><li>Diff coverage is the branch's evidence: compare the measured files with the baseline, and count a changed file the baseline measured but the branch doesn't as uncovered;</li><li>treat "every file unmeasured" or "0/0" as suspicious, never as a pass;</li><li>renames are off, so a moved file is wholly added: decide before 54 blocks;</li><li>bind the merge base, the changed lines' hash, the numbers and a union across levels in the record;</li><li>a coverage run can fail where a plain run passes (a branch's `coverage.thresholds`)</li></ul> (in the roadmap's row 26) | both |
| Later | <ul><li>`lcovonly` instead of `lcov` (the HTML report copies every source file into the store; not probed);</li><li>a level `coverage_root` for runners whose `root` isn't the service's working folder (Vitest's lcov paths);</li><li>Playwright configs with several projects: `--reporter=list,junit` drops the config's junit options (`includeProjectInTestName`)</li></ul> | Architect |
