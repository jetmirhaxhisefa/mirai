# `mirai trace`: the chain from a business requirement to a passing test

Every acceptance criterion (AC) must be proven: by a ticket that covers it, by a test that ran and
passed, and later by QA evidence. `mirai trace` checks the whole chain (unit 43; design/01 §5a):

```
BR-n  →  FR-n / NFR-n  →  AC-FR-n.m / AC-NFR-n.m  →  ticket covers_fr / covers_ac
      →  AC-<ticket>.n  →  a passing test named with that ID  (→ QA evidence, unit 50)
```

No model runs. It reads documents and test results, and changes nothing.

## Two scopes

```
mirai trace due-dates      # an initiative: its documents
mirai trace SAMPLE-53      # a ticket: its ACs to passing tests
mirai trace SAMPLE-53 --json
```

In your session: `/mirai trace due-dates`, `/mirai trace SAMPLE-53`. Each link is printed, `ok` with
what proves it, or `missing` with what's missing and where to fix it. A missing link exits non-zero.

### The documents: `mirai trace <initiative>`

- **BR → FR:** every BR in the brief is cited by at least one FR or NFR of the PRD.
- **PRD → ticket:** every FR, NFR and AC of the PRD is in a ticket's `covers_fr` or `covers_ac`
  (the epic lint's own coverage check, unit 33). A ticket that delivers an NFR cites it in
  `covers_fr`.
- **NFR → how it's verified:** a "Verified by:" line naming a test level, a measurement or a manual
  check, or the NFR's own ACs.
- **ADR "Confirmation" → what checks it** (unit 61): for each of the initiative's ADRs (accepted or
  proposed), `check: <name>` links when `[checks]` has it; `test: <id>` when a ticket of the
  initiative passed the gate with a test named for the ADR (`pending` until one has shipped);
  `review: …` links, and the reviewer checks it. Anything else is missing ([adr.md](adr.md)).
- **FR → a technical note's component:** not built yet; trace says "no technical note yet" (62b).

When it runs:

- **Inside Tess's run**, between her launches, with the lint. A missing link goes to her next
  launch in `lint.json` (as a `trace-…` entry), so a set she hands over has every link.
- **When you approve the set** (`mirai approve <epic-id> --file …`), once more, as the gate: a
  missing link refuses the approval, each named with its place.
- **`mirai show <initiative>`** shows the result as the documents are now.

A lone ticket's interview folder (`/mirai ticket "…"`, `for: ticket`) has no PRD, so this scope
doesn't apply: trace says so and points at `mirai trace <KEY>`.

### The code: `mirai trace <ticket>`

- **Each AC of the ticket** (`AC-<ticket>.n`) has a test that **ran and passed in the gate's own
  run**, whose name **starts with the AC's ID and a colon**:

  ```
  test('AC-SAMPLE-53.2: a day is sent once', …)
  it('AC-SAMPLE-53.2, AC-SAMPLE-53.3: a moved date is sent once, again', …)   // proves both
  ```

  The same in Pest, Vitest and Playwright. A runner that puts its describe blocks in front
  ("Reminders › AC-SAMPLE-53.2: …") is read at the last part. `retries once (AC-SAMPLE-53.2)`
  doesn't count: the ID must come first.

  **PHPUnit** writes a test's method name in its JUnit report, never its `#[TestDox]` text, so
  there the method name starts with the ID in snake case (lower case, each run of other
  characters one `_`), after an optional `test_`:

  ```php
  public function test_ac_sample_53_2_a_day_is_sent_once(): void                 // AC-SAMPLE-53.2
  public function test_ac_sample_53_2_and_ac_sample_53_3_sent_once_again(): void // both
  ```

  Only the ticket's own ACs (and those its plan names, and the journeys) are read this way, and each
  ID must end at a `_` or the name's end, so `test_ac_sample_53_12_…` is AC-SAMPLE-53.12, never
  .1. Snake case only: `testAcSample532` can't be told apart. A plan row written with the TestDox
  text matches the method in the same file that carries the same IDs.
- **An `e2e: true` ticket** also has a passing test named with its journey and an AC ID:
  `J-1, AC-SAMPLE-53.1: …`. The journey is the `J-n` the ticket names, or any in
  `.mirai/context/journeys.md` when it names none.
- **The plan's test list:** each row's test (its Test ID) is in the results, passed, and its name
  starts with its AC. A planned test that's missing or renamed is a missing link.
- **`tests: optional`** drops the test link, but then QA evidence is needed. Until unit 50 (Ivy)
  builds QA, such a ticket can't ship: trace says "QA evidence is needed; QA isn't built yet
  (unit 50)".
- **An investigation** (a ticket that runs as `investigation`, whatever its type is called) has no
  code scope: no tests, no merge. Trace says so.

The results are **the gate's own**: the signed result of each level and its case list
(`cases.json`, whose hash the signed result holds). A test in your work tree that the gate didn't
run doesn't count, and nor does an agent's own `run_tests`. Before the gate has run, `mirai trace
<ticket>` shows what the tests must be named.

## At ship time

`mirai gate record <ticket>` runs trace after every check and test level passed, before any proof
is minted:

- **A pass** goes into both proofs, signed with the rest:
  `"trace": { "result": "pass", "scope": "ticket", "links": 6, "qa": "not built yet" }`.
  Changing it breaks the signature.
- **A fail mints nothing.** Each missing link becomes one must-fix finding for Kai
  (`<store>/tickets/<ticket>/trace.json`), and the ticket goes back to `in-progress`: `mirai fix`
  (or `mirai run`) gives his next round `trace.json`. The round counts in the loop guard like a
  failing test: the same link missing again is a plan problem (L4), and the count must drop (L5).
  When the ticket's rounds are used, it parks, with the trace result in its note.

## The proof check

`mirai gate check`, the pre-push hook, `mirai ship` and CI accept a proof only with a `trace`
result of `pass`. A proof minted before trace was built says `"trace": "n/a"`: it's still accepted
when it was minted before the day unit 43 merged (the cut-off, `TRACE_CUTOFF` in
`src/proofs/records.js`, named in the check's output), and refused
after it. CI checks the proof and never runs trace again.

## For agents

Kai and Rex have the read-only broker tool `trace(item)` (`mcp__mirai__trace`), for a ticket key or
an initiative's folder name: the same result as data. Tess doesn't need it: MIRAI runs trace
between her launches.

## Retired IDs are never reused

Approving a PRD (and a set, again) runs the ID-stability lint against the version you approved
last: an FR, NFR or AC, or a ticket key or its own AC, that comes back with another meaning is
refused (`id-stability`). A rewording keeps most of its words and passes; a new requirement under
an old number doesn't.

To drop an approved FR, NFR or AC, keep its line as `- FR-4: Retired — <why>` (Jet's answer 1,
"A"): the numbering stays whole (the numbering lint names this form when there's a gap), the ID
stays reserved, no ticket covers it and trace leaves it out. A retired ID never comes back: a
later version giving FR-4 a meaning again is refused against the version that retired it.
