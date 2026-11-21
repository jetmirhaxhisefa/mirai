---
unit: "43"
name: trace
status: approved (Jet, 2026-11-21: "approve 43"; interview Q1–Q4 "A", restatement "yes"; built only after 42 is finished, and re-checked against 37–42 as built first)
roadmap: design/07-implementation-roadmap.md, row 43; design/01 §5a (the chain, `mirai trace`), §7 (`tdd`, `tests`), §11 (CI checks the proof); R-M10, R2-M11; D-35 (the ship-time proof), AR3-15; units 08a (ticket ACs), 15a (the broker's tool table), 25a (proofs), 33 (epic, graph lint), 42 (Tess)
depends_on: ["08a", "15a", "25a", "33", "42"]
---

# Unit 43: `mirai trace`

## Why

Every acceptance criterion (AC) is meant to be proven: by a ticket that covers it, a test that
passes, and later QA evidence. Today nothing checks the whole chain. The proof records carry
`trace: "n/a"`, so a ticket can ship with an AC nobody has shown to work. `mirai trace` closes that
gap. It makes spec-driven development checkable without local data in CI: trace runs where the
evidence is, and its result travels inside the signed proof.

**Why now:** Tess (42) writes the tickets that trace checks against, and the ship step (25a) has
the proof field waiting for it.

## Decisions (Jet, 2026-11-21, interview)

1. **A broken link stops the ship** (Q1, "A"). The ticket goes back as a must-fix that names the
   missing link ("AC-53.2 has no passing test and no QA evidence"). The fix round counts in the
   loop guard. A ticket still broken after its rounds is parked for you.
2. **A test names its AC in its name** (Q2, "A"): `test('AC-53.2: a failed reminder is retried
   once')`. It's the same in every framework (PHPUnit, Vitest, Playwright). Trace reads the gate's
   own test results (JUnit XML), so it sees that the test **ran and passed**, not just that it
   exists. The plan's test list must match the names.
3. **QA waits for Ivy** (Q3, "A"). Until unit 50, trace checks the test links only, and the proof
   says `qa: "not built yet"`. Unit 50 switches the QA check on. A ticket with `tests: optional`
   has no test and no QA in that gap, so it can't ship; trace says why.
4. **Two scopes** (Q4, "A"):
   - **`mirai trace <initiative>`, the documents:** every business rule (BR) is covered by an FR;
     every PRD AC is covered by a ticket; every ADR "Confirmation" names a check that exists (once
     ADRs exist, 62–65). It runs when you approve the epic and its tickets, and `mirai show
     <initiative>` shows it;
   - **`mirai trace <ticket>`, the code:** every ticket AC has a passing test named with its ID;
     an `e2e: true` ticket also has a passing test named with its journey (`J-n`) and AC IDs. It
     runs at ship time, and its result goes inside the signed proof. CI checks the proof and
     doesn't re-run trace.
   - Agents get both as one read-only broker tool.

## Scope

**In**

1. **`src/trace/`: the chain as a function.** `traceInitiative(…)` and `traceTicket(…)` return
   `{ result: "pass" | "fail", links: [{ from, to, state, where }], missing: [...] }`. Each
   missing link names the ID, what's missing and where to fix it (the file, or the test list).
   No model runs.
2. **The documents' scope:**
   - BR → FR: every BR in the brief or PRD is cited by at least one FR or NFR;
   - PRD AC → ticket: reuses 33's graph-lint coverage (one source for that check, not two);
   - NFR → its "Verified by" method (32's lint) and, when the method is a test, a ticket that
     covers the NFR;
   - ADR "Confirmation" → a named check in the config, once ADRs exist (a no-op before 62–65,
     shown as "no ADRs yet");
   - run at epic approval: `mirai approve <epic-id>` refuses while the documents' trace fails,
     listing the missing links; `mirai show <initiative>` shows the last result.
3. **The code's scope:**
   - **the tests:** read from the gate's own run (the signed gate-result record and its JUnit
     files, 25a), never from the work tree. A test counts for `AC-<ticket>.n` only when its name
     starts with that ID (`AC-53.2:`; a list `AC-53.2, AC-53.3:` covers each) and it passed;
   - **`e2e: true`:** a passing test whose name carries the ticket's `J-n` and its AC IDs;
   - **the plan's test list:** each row's AC must match a test name in the results; a planned
     test that's missing or renamed is a missing link;
   - **`tests` and `tdd`:** `tests: optional` drops the test link, but then QA evidence is
     required, and before 50 that ticket can't ship (decision 3);
   - **QA:** `qa: "not built yet"` until 50. The field and the check that 50 switches on are
     defined here.
4. **At ship time** (25a's step): trace runs before the proof is minted. A pass writes the
   result into the proof (`trace: { result, scope: "ticket", links: n, qa: … }`), signed with the
   rest. A fail mints no proof. The ticket gets a must-fix finding per missing link (09a's
   schema) and goes back to the fix loop, counted by the loop guard; after its rounds it parks
   with the trace result as the reason.
5. **The broker tool:** `trace(item)`, read-only, in 15a's tool table, for an initiative or a
   ticket. Agents (Kai, Rex, Tess, Vera) use it to see what's missing before they hand over.
6. **The CLI:** `mirai trace <initiative|ticket>` prints each link (pass or what's missing,
   with where), and exits non-zero on a fail. It's on the `/mirai` session list (21f).
7. **The proof check:** `mirai gate check` and CI's check (25a, 30a) accept a proof only with a
   `trace` result of `pass`. A proof with `trace: "n/a"`, minted before this unit, is still
   accepted for tickets shipped before it; the check names the cut-off.
8. **The ID-stability lint** (design/01 §5a, "retired IDs are never reused"): an FR, NFR, AC or
   ticket ID that once existed in an approved version can't come back with another meaning. The
   lint compares against the last approved version.
9. **Docs:** `docs/trace.md` (new): the chain, the two scopes, how to name a test, what a broken
   link does, and the QA gap. `docs/documents.md` and the plan guide say how tests are named.
   Kai's prompt and the plan template's test list say it too.

**Out**

- QA evidence and Ivy (50); the QA check is only switched on there.
- ADRs, the HLD and their Confirmation checks (62–65). The documents' scope checks them when they
  exist.
- CI on GitLab and the CI side beyond accepting the proof (54).
- Mapping test names for frameworks that can't name a test freely (none of the three stacks).

## Tests

- **T1 The documents:** a seeded PRD with a BR no FR cites, and an AC no ticket covers: trace
  names both with their files. With both fixed it passes. `mirai approve <epic-id>` refuses
  while it fails.
- **T2 The code:** fake gate results for SAMPLE-53 with `AC-53.1: …` passed and nothing for
  AC-53.2: trace fails, naming AC-53.2 and the plan's test list row. A test named `AC-53.2: …`
  that failed doesn't count. A test named `retries once (AC-53.2)` doesn't count. A test named
  `AC-53.2, AC-53.3: …` covers both.
- **T3 Work tree vs gate:** a passing test in the work tree that isn't in the gate's signed
  results doesn't count.
- **T4 `e2e`:** an `e2e: true` ticket with AC tests but no test carrying `J-1` fails; with one it
  passes.
- **T5 `tests: optional`:** before 50, a `tests: optional` ticket fails with "QA evidence is
  needed; QA isn't built yet (unit 50)".
- **T6 Ship:** a failing trace mints no proof, writes one must-fix finding per missing link, and
  counts a loop-guard round; after the rounds the ticket parks with the trace result. A passing
  trace's result is in the signed proof, and changing it breaks the signature.
- **T7 Proof check:** a proof with `trace` `fail` or missing is refused; `n/a` before the cut-off
  is accepted.
- **T8 Broker tool:** `trace(item)` returns the result as data from a sandboxed run, and is
  read-only.
- **T9 ID stability:** an approved PRD's FR-4 removed, and a new, different FR-4 added in the
  next version, fails the lint.
- **T10 The docs check** (34b) passes.

## Probes (real)

- **P1 A real ticket ships through trace:** on the sample app, a small ticket with two ACs. Kai's
  tests are named with the IDs. **Pass when** the proof carries `trace: pass` with both links,
  CI accepts it, and the merge request opens.
- **P2 A missing test stops it:** the same ticket with one AC's test removed by hand before the
  gate. **Pass when** the ship stops, Kai gets the must-fix naming the AC, his fix round adds the
  test, and the ticket then ships.
- **P3 The documents at approval:** P1 of unit 42's epic (or 37's P1 epic) with one AC's ticket
  coverage removed. **Pass when** `mirai approve` of the epic refuses, naming the AC.

## Done when

- T1–T10 pass, and the full suite passes through the build runner and CI.
- P1–P3 pass.
- The roadmap row's done-when holds: `trace(item)` is a read-only broker tool; a seeded broken
  link is reported with its location; a ticket with `tests: optional` isn't flagged for a missing
  test (it needs QA evidence instead); the ship-time proof carries the trace result.

## Checked against the queued units

- **25a:** the proof's `trace` field changes from `"n/a"` to the result; the gate check accepts
  old proofs before the cut-off.
- **33:** the AC-to-ticket coverage is 33's graph lint, called, not copied.
- **37:** renamed sections are read through the rename map.
- **41, 42:** Nora's and Tess's documents are what the documents' scope checks.
- **50:** switches the QA check on.
- **54:** CI checks the proof's trace result; it never re-runs trace.
- **62–65:** the ADR Confirmation check becomes real.

**Re-checked against 37 as built (2026-11-21):**

- **The plan's test list** (Scope 3): trace reads the plan's "Test list", but its `read_by` is
  `["lint", "gate"]` (`registry/document-types/plan.toml`). Added: `trace` joins its readers.
- **`e2e`, `tests` and `tdd`** (Scope 3): trace reads them, but the story and bug
  `protected_fields` don't include them (`registry/document-types/story.toml`, `bug.toml`).
  Added: story and bug protect `e2e`, `tests` and `tdd`, read by `trace`.
- **The ID-stability lint** (Scope 8): it gets a `CHECK_READS` entry for the ID sections it reads.
- **The frontmatter:** it had two `status:` lines (approved and draft). The draft one is removed,
  and `name: trace` is added, as the other specs have.
