# Test-first, proven (unit 23)

MIRAI doesn't take Kai's word that a test was written first. It checks. A test written before the
code has to fail, and fail for the right reason: its check says the behaviour isn't there yet. A
test that fails because the function doesn't exist proves nothing, and neither does one that
passes before the code is written.

## What `tdd` means

A ticket's `tdd` (its frontmatter, or `[testing] tdd` in the config, default `auto`) decides which
rows of the plan's test list may be which kind:

| Kind | Written | Before the code, it must |
|---|---|---|
| `red` | before the code | fail by an assertion |
| `characterization` | before the change, for a function the ticket changes | pass (it pins today's behaviour) |
| `after` | after the code | nothing: no red check |

- **`tdd: first`:** every row is `red` (or characterization).
- **`tdd: after`:** every row is `after`; there's no red check. Every acceptance criterion still
  needs a test row, or `no-test: <reason>`.
- **`tdd: auto`:** Kai chooses per row in the plan, and you see it at the plan gate. Two rules hold:
  - a **bug's** plan has at least one `red` row: the test that reproduces the bug;
  - a symbol the Code map **adds or changes** gets a `red` row, or its `after` row says why not:
    `after: <reason>`, such as `after: styling, checked by QA`.

## The build in two halves

When the plan has `red` or `characterization` rows, Kai's build is two handovers in one session:

1. **Red.** Kai writes those tests, and for each new function they call a **stub** that compiles
   and returns a wrong value, and no implementation. He hands over with `status: red`.
2. **MIRAI's red check.** MIRAI runs its usual safety checks, commits the work as
   `<ticket>: red: the tests and stubs, before the code`, and runs each row's test itself, at its
   level:
   - a `red` row must **fail by an assertion**. An error, a load or compile failure, or "no test
     found" is the wrong reason, and a row that **passes already** is refused too;
   - a `characterization` row must **pass**.
3. **Green.** The same session goes on: Kai writes the code and the `after` rows' tests. MIRAI's
   usual checks run, and the work is committed as `<ticket>: green: …`.

The red commit is pushed with the branch, so the MR's history shows the tests before the code.

**When the red check fails,** Kai gets `red.json` with each row that isn't right and why, in the
same session: a red round. After 2 red rounds (3 checks in all) the ticket stops for you
(`needs-you`): the plan's tests may not fit the code. Look at it with `mirai show <ticket>`, then
`mirai discard <ticket>`, or reject the plan for a re-plan.

## The floor guard: tests only get stronger

After every handover (the build, each fix round), MIRAI checks the test files its own run saw:

- **An existing test only grows.** A file that held tests at the branch's start may get new lines
  (new tests, a new import), but a removed or changed line stops the ticket, unless the plan
  declares it: a `test-change` row under Declared changes, with the exact file and why. A declared
  test change always brings the plan to you, whatever the preset.
- **The red tests are locked.** From the red commit on, a removed or changed line in one of its
  test files stops the ticket, declared or not, in green and in every fix round. Only a new plan
  (a re-plan) unlocks them. If a review finding needs one changed, Kai disputes it or stops, and
  you decide.
- **No new skip or focus marker,** declared or not: `markTestSkipped(`, `it.skip`, `test.only`,
  `xit(` and the like, per test adapter (`[classify] skip_markers`).
- **No level runs fewer tests** than at the baseline (since unit 21b).

A floor-guard stop isn't committed: the work stays in the tree for you to look at.

What this can't catch: a new line that weakens a test without a marker (an early `return`, say).
Rex reads the whole diff, and `review-mr` shows it to you.

## Where you see it

- **`mirai review-mr <ticket>`:** a `Test-first` line with the row counts, the red commit, and each
  red row's assertion message from the red check; and each declared test change.
- **`mirai report`:** a `Test-first` line per ticket.
- **The gate proof** (`.mirai/records/<ticket>/gate-…json`, signed): a `tdd` field with the same
  facts, for CI later (unit 54).
- **The run log:** a `red_check` line per check, and `tdd_applied` (`first` or `after`) on the
  checks line.
