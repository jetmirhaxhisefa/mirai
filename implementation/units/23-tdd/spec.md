---
unit: "23"
name: tdd
status: approved (2026-11-15; Jet: "approve 23"; interview decisions 1–3, the defaults and the probes as written)
roadmap: design/07-implementation-roadmap.md, row 23 ("`mirai-tdd` skill + floor guard + orchestrator red check"; Q7, Q8, R2-M7). Skipped by mistake after 22 (no decision recorded it); Jet, 2026-11-15: "Unit 23, then the pilot"
depends_on: ["16a", "17b", "20", "21b", "21c", "22", "24a", "25a", "28"]
---

# Unit 23: test-first, proven

## Why

Milestone A's exit names "plan → TDD → review", and the pilot checkpoint repeats that check on real
work. Today `tdd` is only a hint: Kai builds in one session, MIRAI sees only the end state, so
nothing proves a `red` test failed before the code existed, or that it failed for the right reason,
and nothing stops Kai from weakening an existing test (only a level that runs fewer tests than at
the baseline is caught, since 21b). SAMPLE-5 said `tdd: auto` and nothing checked it.

Already built: the plan's test list with a kind per row (`red`, `after`, `characterization`) and the
lint that ties kinds to `tdd` (08b); test results that tell an **assertion** failure from an error,
a load failure or a test not found, with per-adapter rules (16a: `assertion_types`,
`assertion_messages`); checkpoint refs and `baseline_revision` (22); a resumable Kai session for
fix rounds (21c); the loop guard's rounds (20); the signed gate proof (25a).

## Decisions (Jet, 2026-11-15, in the interview)

1. **A red handover.** When the plan has `red` or `characterization` rows, the build is two
   handovers in one Kai session:
   - **Red:** Kai writes the tests the plan lists, and for each new symbol a stub that compiles
     and returns a wrong value, and no implementation. He hands over with `status: red`.
   - **MIRAI's red check:** MIRAI runs its usual safety checks, commits it as `<ticket>: red`
     (a checkpoint), and runs each row's Test ID itself: every `red` row must **fail by an
     assertion**: an error, a load failure or "not found" is the wrong reason, and a row that
     passes already is wrong too. Every `characterization` row must **pass**.
   - **Green:** the same session resumed with "red confirmed": Kai makes them pass and hands over
     as today. From the red commit on, **the tests are locked**: a change to a file the red
     commit added or changed as a test stops the ticket (decision 2 covers older tests).
2. **Declared or untouched.** A test file that existed at the baseline revision changes only if
   the plan declares it: a new Declared changes kind, `test-change`, with the exact file and why.
   A declared test change always puts the plan in front of you (`gateFor` adds it to "why you",
   whatever the preset). An undeclared change stops the ticket. Always checked, declared or not:
   no test case deleted, no new skip or focus marker (per adapter: `skip_markers` in its TOML),
   no level running fewer tests than at the baseline (today's check). Rex's input and
   `mirai review-mr` show the diff of every declared test change.
3. **`tdd: auto`: Kai per row, with two rules** in the plan lint:
   - a **bug** ticket has at least one `red` row (the reproduction);
   - a symbol the Code map **adds or changes**, named by a test row, has a `red` row, or its row's
     Kind reads `after: <reason>`.

   `mirai report` and `review-mr` show the counts: red, after, characterization, and each red
   row's assertion message from the red check.

## Defaults taken with the decisions (not asked; say if you want them otherwise)

- **`tdd: first`:** every row `red` (the lint already refuses `after`). **`tdd: after`, or a plan
  with no `red` and no `characterization` rows:** one handover as today, no red check; every AC
  still needs a test row or `no-test: <reason>` (the lint already says so).
- **A failed red check** goes back to Kai in the same session with the rows that failed and why
  ("passes already", "fails with an error: …"): a **red round**, at most 2. Then the ticket stops
  for you (`needs-you`): the plan's tests may be wrong for the code. Red rounds count in the loop
  guard's turns and tokens, not in the fix rounds.
- **The stub step is proven by the red check, not by a separate rule:** a test for a missing
  function fails with a load or not-found error, which the red check refuses; with a stub it
  fails by assertion.
- **The red evidence** (each row: Test ID, the outcome, its assertion message, the red commit) goes
  into the build record, the run log (with the resolved `tdd`, closing run-log.js's "unit 23's
  to record") and the signed **gate proof**, so `review-mr`, `report` and CI later read the same
  facts.
- **An existing test file** is a file at the baseline revision that holds a test case in MIRAI's
  own run of its level; a deleted one shows as fewer tests than at the baseline.
- **The locked tests stay locked through fix rounds** (review findings included). A finding that
  needs a test changed: Kai answers `disputed` or `blocked`, and you decide; a new plan approval
  (a re-plan) unlocks.
- **The red commit is pushed with the branch,** so the MR's history shows test before code.
- **Kai's instructions** (`mirai-developer.md`, build step) and a `mirai-tdd` skill say how: the
  stub, the red handover, the locked tests, the declared test change.
- **From your session and at night:** the same flow; nothing in it needs you except the stops.

## Settled while building (2026-11-15; say if you want them otherwise)

- **"Only grows", not "untouched":** decision 2 as written would stop SAMPLE-5's own build, which
  added its tests to the existing `TaskApiTest.php`. So an existing test file may get **new lines**
  (new tests, an import); a **removed or changed** line is what needs the declared `test-change`.
  The red lock is the same rule from the red commit on, with no declaration that lifts it. What it
  can't catch: a new line that weakens a test without a marker (an early `return`); Rex reads the
  whole diff, and so do you in `review-mr`.
- **Kai's instructions, not a separate skill:** the red handover, the stub, the lock and
  `test-change` are in Kai's agent definition (`mirai-developer.md`), which every build launch
  loads. A `mirai-tdd` skill would add a file to the launch bundle that S3 and the red team check,
  for no gain: Kai would still need the prompt to say which half he's in.
- **Which files are tests:** the runner's word: a file that holds a case in MIRAI's own run of a
  level (`case_files` on each test result), and the red rows' Test ID files.
- **The plan's frontmatter gains `ticket_type`** (`story` or `bug`, written by MIRAI from the
  ticket), so the lint knows a bug's plan; plans from before have none, and it isn't in the
  approval hash, so no approval changes.

## Scope

**In.**

1. **`src/agent/build.js`:** the red handover (`status: red` in the handover schema), the red check
   after it (the safety checks, the red commit, one run per row's Test ID at its level), red rounds,
   the green resume, the lock check after green and after each fix.
2. **`src/agent/tdd.js` (new):** the row verdicts (assertion / passes / wrong reason), the locked
   files, the existing-test rule, skip and focus markers per adapter.
3. **The plan:** `test-change` in Declared changes (the template, the lint, `gateFor`); the two
   `tdd: auto` rules; `after: <reason>`.
4. **The adapters' TOML:** `skip_markers` for PHPUnit, Vitest and Playwright.
5. **Records:** the build record, the run log (resolved `tdd`, red evidence), the gate proof
   (`red` field), `review-mr` and `report` (the counts, the red messages, declared test diffs);
   Rex's input gets declared test diffs.
6. **Kai:** `registry/agents/mirai-developer.md` (build step) and `registry/skills/mirai-tdd/`.
7. **Docs:** `docs/tdd.md` (new): what each `tdd` means, the red handover, the lock, the declared
   test change, what to do when a ticket stops on one; `docs/run.md` and `docs/review-mr.md`
   updated.

**Out.**

- ATDD for high-risk tickets by a separate agent (unit 68). E2E protection with QA (unit 51).
  Mutation testing. CI reading the red evidence (unit 54 will; the proof carries it now).

## Probes (with your OK: "approve 23", 2026-11-15; SAMPLE-6 itself still needs your approval)

- **R1, a real run on the sample app** (Sonnet, about 15 minutes): a new ticket SAMPLE-6, small
  logic with `tdd: auto` (written by me, for your approval), through `mirai run` to its MR: the
  red commit before the green one, every red row failing by assertion at the red check, the red
  evidence in the gate proof and in `review-mr`.
- **R2, seeded, no model** (a stand-in Kai, in the tests and a clone of the sample app): an
  import-error "red" refused, a stub-then-assert red accepted, a red row that already passes
  refused, a weakened assertion in an existing test stopped, a declared one allowed and shown, a
  new skip marker stopped, a locked test edited in green stopped, `tdd: after` with no red check.

## Files

- **New:** `src/agent/tdd.js`, `registry/skills/mirai-tdd/SKILL.md`, `docs/tdd.md`,
  `test/agent/tdd.test.js`, `test/probes/tdd-probes.js`.
- **Changed:** `src/agent/build.js`, `src/agent/fix.js`, `src/agent/plan.js` (`gateFor`),
  `src/lint/checks.js`, `registry/templates/plan.md`, `registry/document-types/plan.toml`,
  `registry/test-adapters/*.toml`, `registry/agents/mirai-developer.md`, `src/store/run-log.js`,
  `src/tests/gate.js` (the proof), `src/review/packet.js`, `src/reports/*`, `src/agent/review.js`
  (Rex's input), `docs/run.md`, `docs/review-mr.md`.

## Tests (`npm test`, no model, no network)

- The red check per row: assertion → ok; passes → refused; error, load, not-found → refused;
  characterization passing → ok, failing → refused.
- Red rounds: a fixed red goes green; a third failed red check stops for you.
- The lock: a red-commit test edited in green or in a fix → stopped; a re-plan unlocks.
- Existing tests: an undeclared change stopped; a declared one passes and shows in Rex's input and
  `review-mr`; a deleted case or a new skip/focus marker stopped either way.
- The lint: `test-change` format; a bug with no red row; an added symbol with an `after` row and no
  reason; `tdd: first` / `after` unchanged.
- `tdd: after` and a plan with no red rows: one handover, no red commit.
- The gate proof carries the red evidence; `review-mr` and `report` print the counts.

## Done when

- R1 passes on the sample app and R2's cases all hold; the roadmap's row 23 "done when" is met:
  red evidence logged, an import-error red rejected, a stub-then-assert red accepted, a weakened
  test caught, `tdd: after` skipping the red check while still needing a test or QA evidence per AC.
- The red team is green after the sample app's refresh.
