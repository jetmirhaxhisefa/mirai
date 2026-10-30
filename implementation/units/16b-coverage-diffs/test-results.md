---
unit: "16b"
date: 2026-10-29
result: 334 tests after the review fixes; the full run passed 333, and lint T12 (a timing check in a file this unit doesn't touch) passed alone right after; K1–K4 and 16a's two Playwright cases settled by 11 runs on the sample app; nothing left in Docker
---

# Unit 16b — Test results

## `npm test`

**332 tests: 330 pass, and 2 time out under load.**
- **The full run** took over 10 minutes, with the machine's load average at about 410. No process of
  MIRAI's was running; the load came from the rest of the machine.
- **The two failures** are 13c's hook T4 and 07b's lint T12, both timing checks in files this unit
  doesn't touch. They failed again when run alone at that load. Memory already records them as
  flaky under heavy load. They need a run when the machine is quieter, before the commit.

Unit 16b adds 10 tests in three new files, and extends 16a's:

| File | Tests | What |
|---|---|---|
| `test/tests/diff.test.js` | 3 | **T3/T4:** real `git diff -U0` from a fixture repo, through `changedLines`: added, removed and changed lines; new, deleted and binary files; no newline at the end; a path with spaces, a tab, quotes and `é` (git's quoting and its trailing tab). Against the work tree: untracked files wholly added, a link as one line, a rename as two paths, a repo with a diff driver refused. Malformed diffs and the limits |
| `test/tests/coverage.test.js` | 4 | **T1:** lcov: records, ignored records, malformed ones, relative and absolute paths, unmapped files, the limits. **T2:** Cobertura from PHPUnit's real files: the DTD's DOCTYPE, `<source>` plus filename, class lines only, totals matching the file's own, a one-file run; refused: another DOCTYPE, an entity, the wrong root, bad numbers. **T5:** diff coverage: measurable, covered, unmeasured apart, the path filter, an empty change |
| `test/tests/coverage-run.test.js` | 3 | **T6** (the fake docker leaves a coverage file): the argv, `coverage.json` and its hashes, the summary; no file, a broken one, another DOCTYPE, a coverage folder swapped for a link: all `bad-coverage`; a load failure stays `load`; `no-coverage` without an adapter or `[coverage]`. **T7:** `run_tests`' `coverage` and its summary; `mirai test --coverage --against main` on a real work-tree change; `--against` refusals |
| `test/tests/adapters.test.js` | (extended) | Every coverage argument filled; Playwright's `--reporter=list,junit` |
| `test/tests/junit.test.js` | (changed) | The corpus test skips coverage files |

**The corpus** gains:
- `phpunit-coverage.xml` and `phpunit-coverage-file.xml`;
- `vitest-coverage.info` (a whole level with failing tests) and `vitest-coverage-file.info`.

None holds personal data.

## After the review

**334 tests.** The full run passed 333 at a load average of about 30 to 170. The one failure was
07b's lint T12, a timing check; it passed alone right after (17 / 17). Hook T4, which failed in
the first run, passed.

**Tests added or extended for the fixes:**
- a nested repo refused before the diff, with its filter never run;
- an emoji path through git;
- a `-diff` attribute showing as binary;
- 20,000 lcov files in about a second;
- Cobertura's element cap;
- two sources, choosing the one that exists;
- prototype names;
- binary and too-large files apart;
- the highest count in both orders;
- a failing run without coverage;
- both files missing (`bad-report`);
- Vitest's per-file load case;
- `--against` with `--path`.

**Checked by mutation:** removing the nested-repo check, and making a missing coverage file
always a fault, each make a test fail.

## The probes

All runs were on a throwaway clone of the sample app under `~` (origin removed, a temporary MIRAI
home):
- the sample app's own images, never pulled;
- every container, network and volume checked gone after each run;
- no subscription use.

| Run | Result |
|---|---|
| `k-php`: the whole level, Cobertura | written, with a DOCTYPE naming the Cobertura DTD; 8 files, 35 lines, 31 run (the file's own totals) |
| `k-php-file`: one file | every file of `<source>` listed, most at 0 |
| `k-php-load`: a file that doesn't parse | exit 255, an empty report, no coverage file |
| `k-vitest`: the whole level, lcov | **no coverage:** the level has failing tests, and Vitest writes none then by default |
| `k-vitest-file`: one file | `coverage/lcov.info` (and an HTML report); `SF` relative to `/app`; every included file listed; the CLI reporter replaced the config's |
| `k-vitest-load`: a file that doesn't load | no coverage file |
| `w-folder`: Playwright, a folder, through the adapter | all 10 tests under `e2e/tests` |
| `w-noreporter`: Playwright, a config without junit, the variable only | the tests ran; **no report** |
| `m-e2e-noreporter`: the same through the adapter with `--reporter=list,junit` | a full report: 8 tests, assertion and error |
| `m-front-coverage` (1st): the vitest adapter, coverage of the whole level | `bad-coverage`, from my filler bug (`{coverage_dir}` unfilled); fixed |
| `m-front-coverage` (2nd) | **coverage written with failing tests** (`reportOnFailure`): 6 files, 121 lines, 41 run; the run fails on its two probe failures |

Afterwards nothing of any run was left in Docker, and every probe folder is removed.

## What wasn't run

- **`--against` on the sample app.** T7 runs it on a fixture repo's real change. On the sample
  app it needs MIRAI refreshed there, which you commit after the push.
- **No agent's `run_tests` call with coverage:** T7 covers the tool's side.
