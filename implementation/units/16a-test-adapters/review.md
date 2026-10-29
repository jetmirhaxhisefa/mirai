---
unit: "16a"
date: 2026-10-29
reviewers: Tech Lead, Architect (independent, read-only, no network, no Docker, no probes, never the real claude, never your Claude Code config)
verdicts: no Blocker; Architect three High (two shared with the Tech Lead's one High and a Medium), Tech Lead one High; every High and Medium fixed or recorded; three fixes checked by mutation; 322 / 322 after the fixes
---

# Unit 16a — Review

Both reviewers worked on a frozen tree, in copies of the repo without `research/_sources`.
- **Restrictions:** no network calls, no Docker, no probes, never the real `claude`. They changed
  nothing in either repo.
- **The Tech Lead** ran 316/316 in a copy, made 13 mutations against the new tests (two
  survived: findings 13 and 14 below), timed the parser on hostile 16 MiB reports, and wrote
  reproductions for the outcome rules.
- **The Architect** fed the real corpus through `testResults` with the shipped adapters. Its 315
  of 316 in a copy is init's version check, which needs `.git`.

**What held up:**
- **The adapter contract:** minimal, stack-neutral, data only:
  - one argv element per placeholder, no shell;
  - `{name}` can't start an argument, and `{path}` and `{report}` are absolute;
  - regexes compile in Unicode mode, with no back-references;
  - `regexEscape` suits PCRE with `/`, Vitest's `-t`, and Playwright's `-g` and file filter.
- **Trust:**
  - core adapters come from the trust root's registry;
  - project adapters come from the trust root's `.mirai/custom/`, and can't take a core name;
  - the work tree's copy doesn't count.
- **The XML reader:**
  - DOCTYPE and unknown or over-long entities are refused;
  - numeric references are range-checked;
  - well-formedness and strict UTF-8 are enforced;
  - the depth limit is exactly 64;
  - attributes have a null prototype;
  - there's no I/O;
  - nothing quadratic and nothing that hangs: hostile 16 MiB inputs run 0.1–3.9 s.
- **Reading the report:**
  - `O_NOFOLLOW|O_NONBLOCK`, then `fstat`, so a link, a FIFO or a folder is malformed;
  - the size is capped before anything is allocated, and the read is bounded by that size.
- **Outcome rules:**
  - no false pass from a broken report or a runner quirk, except whole-level zero tests (fixed,
    finding 4);
  - a timeout skips the report.
- **Paths:**
  - mapping goes through the deepest bind;
  - a path hidden by a volume or tmpfs is refused;
  - sibling prefixes and traversal are handled.
- **The service-path change for levels without an adapter** is right, since 14d's path was
  broken under remapped mounts, and it's documented.
- **Test IDs:** only the first `::` splits, which is unambiguous because paths can't hold `:`.
- **Redaction** happens before the cut; the CLI escapes report text.
- **Stack neutrality** holds in `src/`.
- **Personal data:** none in the corpus, docs, research/12 or the TOMLs.

## Fixed in unit 16a

| # | Finding | Severity, from | Fix | Test |
|---|---|---|---|---|
| 1 | **A data provider's method by name was always `not-found`,** even when it passed: the filter runs every data set, but the scope needed the exact name | High, both | New `report.variant` (PHPUnit: `" with data set "`): a test ID covers the cases named `<name><variant>…` | Real report, asking for `test_data`: 2 in scope, 2 passed. A prefix (`test_a`) isn't a variant. Checked by mutation |
| 2 | **The stored result cut the failing list at 50 and kept no list of IDs,** so the gate (25) and pre-push (26) couldn't tell known failures 51–80 from new ones, and the baseline (17) couldn't see a test disappear | High, Architect | Every case in scope goes to `cases.json` (`{id, outcome, kind?}`). `result.json` keeps up to 1,000 failing tests with messages, plus `cases_sha256` and `report_sha256`, so a signed result covers them. The 50 and 16 KiB caps are only the reply's | `cases.json` written, its hash and the report's match |
| 3 | **A Vitest file that doesn't load, run by a test ID, was `not-found`,** and the "Failed to resolve import" message was lost | Medium (Tech Lead), High (Architect) | A case named after its own file is in scope for any test of that file, and is `load` | Real report, asked by a test name: `load`, with the import message |
| 4 | **A whole level that ran nothing passed** (exit 0, empty, or all skipped), against the docs' own rule | Medium, Tech Lead | Nothing ran is `not-found` for a level too. A pass needs at least one test run | Vitest's empty and all-skipped reports at exit 0 |
| 5 | **`load` came from any output line or the exit code, even when tests ran:** a line a test prints could turn a real assertion into `load`. PHPUnit's bare exit 255 (a missing autoloader, a memory fatal) was `load`, blaming the branch | Medium (Tech Lead), Medium–High (Architect) | Output and exit code count only when no test ran (every load failure probed left an empty report). PHPUnit drops `load_exit_codes = [255]`: exit 255 without "An error occurred inside PHPUnit." has no report, so it's `bad-report` | Playwright's real failures plus an `Error:` line: no `load`. A passing run's output: no `load`. A bare 255: not `load`. Checked by mutation |
| 6 | **A failed run could have an empty failing list** (a runner failing on warnings), reading as "no new failures" | Medium, Architect | Such a run gets one `error` entry ("exited N with no failing test in its report") | Exit 1 with only passing cases |
| 7 | **Playwright couldn't run a folder:** the path was anchored at `$` | Medium, Tech Lead | `{path:regex}(?:/\|$)`: still keeps the `.tsx` twin out. **Not probed** (research/12) | The regex: file, folder, twin, sibling folder |
| 8 | **The Playwright adapter needs a junit reporter in the project's config,** and the TOML comment said it "adds" one | Medium, both (from Playwright's source, not probed) | Said in the TOML, its description, the docs table and research/12 ("Not probed") | — |
| 9 | **The docs overstated it:** "a branch can't change how its tests are run or read". The runner's config, the scripts and the code under test are the branch's, and could write the report themselves | Medium, Architect | Reworded: the branch can't change how MIRAI asks for and reads reports, and a report is evidence, not proof. Unit 25 compares counts and IDs with the baseline (agent-safety.md, test-adapters.md, adapters.js) | — |
| 10 | **The reply's 32 KiB budget held only for plain text:** the server sends pretty JSON, so quotes and control characters grow it (up to ~123 KB) | Low, Tech Lead | The tail and the failing list are measured as JSON, and the tail is cut until it fits | `o`, `"`, `\x01`, `\\`: all within budget. Checked by mutation |
| 11 | **A test ID naming a folder** ran, then always reported `not-found` | Low, Tech Lead | Refused after the copy (`bad-path`) | `tests::test_a_b` |
| 12 | **A broken project adapter** threw an untyped config error, which the MCP tool called an environment fault | Low, Architect | Refused as `bad-adapter`, naming the file and its first problems | A project adapter with `format = "tap"` |
| 13 | **A case with both `<skipped>` and `<failure>`** wasn't covered (the mutation survived) | Low, Tech Lead | Test added: the failure wins | ✓ |
| 14 | **The output-only-on-failure guard** wasn't covered (the mutation survived) | Low, Tech Lead | Test added: a passing run's output can say anything | ✓ |
| 15 | **Smaller things:** <ul><li>one `<testcase name="">` made the whole report malformed;</li><li>the colour-leftover cleanup ate `[m]`;</li><li>the cut could split a surrogate pair;</li><li>blank fillers (U+3164, U+2800) passed as visible names;</li><li>error messages could carry a 16 MB element name;</li><li>1M elements took ~420 MB;</li><li>200 characters was too short to re-run long nested and data-set names</li></ul> | Low, both | <ul><li>`(unnamed)`;</li><li>digits required;</li><li>cut by characters;</li><li>fillers count as invisible;</li><li>names over 200 characters refused;</li><li>the element limit is now 400,000 (4 per case at the case limit);</li><li>names up to 1,000 characters</li></ul> | ✓ |
| 16 | **Stale references and claims:** <ul><li>research/11 for research/12;</li><li>roadmap dependencies still "16";</li><li>versions claimed (PHPUnit 10+, Vitest 3+, Playwright 1.40+) beyond those probed;</li><li>the spec said the level's `adapter` is checked when the config loads</li></ul> | Low, both | <ul><li>research/12;</li><li>17 and 26 need 16a and 16b, 21 and 23 need 16a;</li><li>"seen on 12.5 / 3.2 / 1.64";</li><li>the adapter is checked when the level runs (`unknown-adapter`), recorded in the spec's changes</li></ul> | — |

## Noted for later units

| Unit | Note | From |
|---|---|---|
| 16b or 17 | <ul><li>Probe Playwright with a folder, and with a config that has no junit reporter (decide `--reporter=list,junit` versus the documented need);</li><li>`mirai doctor` or lint to check a level's `adapter` and the project's adapters before a run</li></ul> | both |
| 17 | <ul><li>Read `cases.json`, not the failing list;</li><li>Playwright with several projects gives the same ID per browser: add a project qualifier before flaky detection;</li><li>a Vitest title that itself contains " > " is re-split by the filter</li></ul> | Architect |
| 23 | <ul><li>Only `assertion` is "the right reason";</li><li>a PHPUnit test calling a method that isn't there yet is `error`, expected before the stub;</li><li>an environment fault (a test that kills its runner leaves no report) on a branch that passes on base is a code signal</li></ul> | Architect |
| 25 | <ul><li>A report is evidence, not proof: compare counts and IDs with the baseline, and treat a level whose count drops as suspicious;</li><li>the signed result covers `cases.json` and the report by hash</li></ul> | Architect |
| Later | <ul><li>PHPUnit's `file` may be the declaring file, so an inherited test could fall outside a file run (unverified);</li><li>`<failure>`/`<error>` directly under `<testsuite>` (a hook error) is ignored, and a non-zero exit still fails the run;</li><li>unit 05's store tests (`test/store/store.test.js`, `logs.test.js`) leave a `mirai-home-*` folder in the temp folder on every run (about 9,000 there now)</li></ul> | Tech Lead |
