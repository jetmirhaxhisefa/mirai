# Unit 34: test results (2026-11-20)

## Tests

- **`test/documents/write.test.js`:**
  - T1: the skill's files. `SKILL.md` names `guides/brief.md`, `prd.md`, `epic.md` and
    `ticket.md`, each exists, and `guides/` holds nothing else. `SKILL.md` has the six habits,
    "When not to act", "Write the summary last" and the pointer to the lint's word list. Each
    guide has exactly 3 examples, each with its rule, its before (with the draft's file), its
    after and how it's checked, and points to its type's template and checklist; 12 in all.
    Decision 11 (added after the build) adds `guides/session.md`, also named in `SKILL.md`, with
    its 3 examples (15 in all) and a pointer to `mirai-interview` instead of a template;
    `CREDITS.md` names humanizer with its commit `8c307f3…`, Siqi Chen, MIT and the notice, and
    pstack;
  - T2: every "after" lints clean as a fragment (`lintFragment`, summary or detail rules as the
    example says), with no warning either. The four lint-checkable examples (brief 2, PRD 1, epic
    2: `writing-sentence`; ticket 1: `writing-vague`) fail that rule before and pass it after. Each
    "before" from a file kept in the repo is found in it word for word; the two from earlier
    commits (`c92cd80`, `4cb2003`) were checked against `git show` by hand (a CI clone may not
    have them). The session guide's three quotes come from the session transcript `60ff2a19`
    (assistant replies only) and were checked by hand against it for the same reason. A seeded
    banned word ("leverage") fails;
  - T3: the quote check with a fake reader: quotes found in the summary pass; a quote not in it
    fails, naming "What's left out"; "not stated" fails with the fix; no quote, or a two-word one,
    fails; a quote that differs only in line breaks and spaces passes; a changed letter fails; a
    seeded summary with "Not in this" emptied fails;
  - T4: `mirai reader-test` through its command, with a fake launcher: the reader gets only the
    summary (no detail, no link line), `--tools ""`, `--strict-mcp-config`, one turn, the
    `reader-test` step's model (standard: Sonnet), an empty temporary work folder and home
    (removed after), the token on fd 3 only. The result is recorded by the summary's hash with
    round 1. A change outside the summary reuses it with no run; a changed summary runs again as
    round 2 and fails naming "What's left out" and the fix. A summary holding an instruction and
    `@~/.ssh/id_rsa` reaches the reader as text between the markers, with the `@` defused; a quote
    of it still matches. A reader with tools, or an answer that isn't the JSON, records nothing.
    The session command takes `reader-test` with a `file`;
  - T5: approval of a PRD: no result refuses it with `run: mirai reader-test <file>, then approve
    again`, nothing written; after three failed rounds it shows "reader test failed (round 3 of 3
    …): What's left out" with the gap, and you can still approve (the line records the failed
    result's hash); with a pass it shows the four answers with their quotes and the line records
    the result's hash; `[docs] reader_test = false` approves with no result and says so;
  - T6: `needsReaderTest`: a brief on `quick` or `standard` no, on `full` yes; a PRD and an epic
    yes; a story and a bug no. A brief on standard is approved with no reader test, and the
    command refuses it, naming the PRD. A brief on full is refused without a result and approved
    with one (its line records it). A story is refused by the command;
  - T7: `[models.steps] reader-test` takes `light` and `standard` (and refuses others); the default
    is standard; `[docs] reader_test` takes a boolean in the project file and is refused in a
    personal file; doctor's word-list check is ok at 90 days, yellow at 91 with what a review is,
    yellow with no date; `src/lint/words.js` opens with its date.
- **Changed tests from 31–33** (approval now needs a reader result, as the spec says):
  - `test/documents/prd.test.js` T7 and T8, `test/documents/epic.test.js` T7 and T8 record a
    passing result with the fake reader before each PRD and epic approval; 32's T7 and 33's T7 also
    check the approval line's `reader_test`. 31's brief test is unchanged (its brief is on
    `standard`).
  - `test/adapters/claude-code.test.js` T1 (the bundle's file list) and T7 (the shipped skills:
    `mirai-docs` and `mirai-write`, both with only `name` and `description`).
  - `test/cli/cli.test.js` T14 (the command list), `test/doctor/doctor.test.js` (the items, now
    with `word-list`) and `test/detect/detect.test.js` 17a T8 (the instruction files an install
    leaves, now with `mirai-write`'s six).
- **The full suite:** 702/702 on the Mac (`caffeinate -i npm test`), 7 tests in `write.test.js`; again 702/702 after decision 11 and the merge of main.
  The build runner and CI run on the final commit.

## Probes (real)

| Probe | Result |
|---|---|
| **P1 Your read** | not run yet (the 15 examples: the 12 for the documents and the 3 in `guides/session.md`) |
| **P2 The reader's model** | not run yet. Until it runs, `reader-test` defaults to `standard`; P2 sets the final default (`light` if Haiku catches every seeded bad summary and fails no good one). |
| **P3 A fresh agent writes with the skill** | not run yet |

## Changed from the spec

- **`mirai reader-test` doesn't run the lint itself.** Decision 1 puts the test after a clean
  lint; the command runs on any document with a summary, and the workflow units (35–36, 42, 45)
  order the two. Approval still lints first and asks for the reader result second.
- **The reader runs as a direct `claude -p`, not through the strict agent launch.** The strict
  launch has only two red-teamed modes (read-write, read-only), both with file tools and the repo
  as their working folder. The reader instead gets the same Claude Code (the kept, red-team-tested
  copy, as `claudeForLaunch` gives a launch with no ticket), `--tools ""` (checked in its init
  event: a run that reports tools is refused and records nothing), `--strict-mcp-config` with no
  server, one turn, and empty temporary folders for its work folder, `HOME` and
  `CLAUDE_CONFIG_DIR`. No red-team gate and no run lock: it has nothing to gate.
- **Every `@` in the summary gets a zero-width space after it** before it reaches the reader, so a
  file reference can't be expanded; quotes are matched with zero-width spaces removed.
- **A quote must be at least three words.** The spec says a missing or unfound quote fails; a one-
  or two-word quote ("the team") matches almost any summary, so it fails too.
- **The reader answers in JSON** (`{"built": {"answer", "quote"}, …}`), its "fixed format". An
  answer that isn't that JSON records nothing and uses no round.
- **Rounds keep counting past 3.** Round = the number of distinct summaries tested for the
  document. After round 3 fails, the command says it goes to your approval marked; you can still
  fix the summary and test it again (round 4), which is how you "answer the gap yourself". Approval
  shows any failed result as "reader test failed", with its round.
- **The record:** `<store>/reader-tests/<document id>.json`, through `src/store/reader-tests.js`,
  under the store's file lock. Each entry carries its own content hash (which the approval line
  records); a changed entry is refused when read. It isn't signed: only MIRAI writes the store, and
  the signed approval line binds the result you saw.
- **The approval line's new field is `reader_test`** (the result's hash), allowed only on a brief,
  PRD or epic line; no journal schema bump, as 31–33 added their fields without one. On `standard`
  it sits on the PRD's line only, since the PRD's summary is the one tested.
- **`reader-test` needs a committed MIRAI copy** in the launcher (`NEEDS_COMMITTED`), like the
  other commands that start a model with your token.
- **The examples' sources:** two PRD "befores" come from earlier commits of
  `p2-agent-prd.md` (`c92cd80`, round 3 before its fixing round; `4cb2003`, round 1), because the
  kept file is the fixed version. Each example names its commit.
- **The example format** (`**Rule:**`, `**Before**, from … (the summary|the detail):`, a fenced
  block, `**After:**`, `**Checked by:** the lint, \`code\`` or `judgement`) is fixed, so T1 and T2
  read it.
- **`lintFragment`** (in `src/lint/writing.js`) lints a fragment with the writing rules 2–6 (the
  summary's) or 2, 3 and 5 (the detail's), with no word budget. The writing check's line loop
  moved into a shared function; the lint's behaviour is unchanged.
- **Doctor's item is `word-list` ("Banned words")**, yellow, last in the list. The date is a first
  comment line, `// Reviewed: YYYY-MM-DD`, set to 2026-11-20.
- **`/mirai reader-test` isn't `quick`:** a model run takes seconds to minutes, so the session
  follows it with `mirai_status`, as for `plan`.
- **Decision 11, after the build (Jet, 2026-11-20, "A"):** `guides/session.md`, how agents write
  manual steps and explanations to you in the session. Its "before" quotes are from three real
  replies in this project's session transcript `60ff2a19` (the unit 32 spec handover's step; the
  unit 34 interview's Q1, after which you asked for "more details" and "examples"; and Q3's
  option B, after which you asked whether you had to write the sentences). Its examples use the
  source form `(a session reply)`, linted with the detail's rules. The questions you're asked stay
  with `mirai-interview` (35): the guide only points to it.
