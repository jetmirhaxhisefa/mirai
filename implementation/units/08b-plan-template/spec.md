---
unit: "08b"
name: plan-template
status: approved (2026-10-24, as part of unit 08; split by open point 1)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 08; D-06, D-09, D-15, D-23, D-29, D-35, D-41, D-42, D-44, D-45, D-48; R-M10, R2-M11, R3-M2, R3-C2; 01 §5–§7; 03 "Templates"
depends_on: ["04", "06", "07b", "08a"]
---

# Unit 08b — The plan template and the plan check

Unit 08's spec was approved with its five open points as recommended. This is the second half:
the plan. Unit 08a (`../08a-ticket-templates/spec.md`) has the ticket types, `{id}`, `required`
ID kinds and `checks`.

## Why

Tickets and plans are what the agents work from every night. If their shape drifts, the
orchestrator can't trust what a ticket covers, which tests a plan promises, or whether you
approved this plan or an edited one. This unit writes MIRAI's first real document types into
its registry, and gives them the checks unit 07's generic rules can't do alone.

**Roadmap "done when":**
- a filled example lints clean;
- a ticket without AC IDs or a `repo` is flagged;
- an AC without a test level is flagged;
- a characterization test for an unchanged symbol is flagged;
- an edited frozen block fails verification;
- a new dependency raises the risk.

## Scope

**In:**
- **Three document types** in `registry/document-types/`, with their templates and checklists
  in `registry/templates/`: `story`, `bug`, `plan`.
- **Small, additive registry fields** (schema stays 1):
  - `{id}` in ID patterns;
  - `required` on an ID kind;
  - `may_be_empty` sections;
  - `checks`, which names built-in checks.
- **Two built-in checks** in code: `ticket` and `plan`.
- **The plan's frozen block:** its markers, its lint, and `frozenBlockHash`, the content hash
  the plan gate will sign.
- **`lintText(text, { source, registry, config })`:** lints one document's text. Plans live in
  the store (D-29), outside the repo, so `mirai lint` can't reach them.

**Out:**
- **The epic template:** it comes with the ticket workflow (unit 45). The `story` type takes an
  optional `epic` field now.
- **Signing a plan approval** in the journal and the plan gate itself: unit 21. This unit
  provides the hash and shows that an edit breaks a signature over it.
- **Which paths are protected:** unit 12. The plan only declares them, in a fixed format.
- **Auto-setting `risk` from risk paths and keywords:** the ticket planner (unit 42). This unit
  checks that a plan with a new dependency says `risk: high`.
- **Cross-document checks** (a story's `covers_ac` exists in the PRD): `mirai trace` (unit 43).

## The plan type

A plan is written by the developer agent from the template, returned as structured output, and
stored by the orchestrator in the store (01 §6, D-12, D-29). It has no `status` of its own: the
ticket's status says where it is.

**Frontmatter:**

| Field | Type | Required | Rule |
|---|---|---|---|
| `id` | string | yes | `<ticket>-plan` |
| `ticket` | string | yes | the ticket key; must match `id` |
| `acs` | list of AC IDs | yes, at least one | every AC the plan must prove: the ticket's own and its `covers_ac`, copied by the orchestrator |
| `risk` | enum `normal` · `high` | yes | `high` when a new dependency is declared (R3-C2) |
| `tdd` | enum `auto` · `first` · `after` | yes | the ticket's effective value (D-23) |
| `tests` | enum `required` · `optional` | yes | likewise |
| `round` | integer ≥ 1 | yes | the plan round counter |

**Sections**, in this order:

| Section | Owner | Rule |
|---|---|---|
| Intent | **frozen** | problem and approach |
| Boundaries | **frozen** | always / never |
| Edge cases | **frozen** | the I/O and edge-case matrix |
| Code map | agent | a table: `Path`, `Symbols`, `Change` (`add` · `change` · `remove` · `read`) |
| Tasks | agent | |
| Test list | agent | a table: `Test`, `AC`, `Level`, `Kind` (`red` · `after` · `characterization`) |
| Declared changes | agent | a table: `Kind` (`protected-path` · `dependency`), `Item`, `Why`; or one row `none` |
| Verification | agent | commands |
| Design notes | agent | optional |
| Implementation log · Change log · Review triage log | agent | **may be empty** at plan time; filled during the build and review |

**The frozen block:**
- **The three frozen sections sit between `<!-- frozen:start -->` and `<!-- frozen:end -->`.**
  The markers are HTML comments, so they don't show when rendered.
- **`frozenBlockHash(text)`** is the SHA-256 of the exact text between the markers, with
  CRLF turned into LF. The plan gate (unit 21) will sign it, and a later edit fails
  verification (R2-M11).
- **The lint checks the markers:** each appears once, in order, and the block holds exactly
  Intent, Boundaries and Edge cases.

**The `plan` check (code):**
1. **Every AC in `acs` has at least one Test list row,** and every row has a `Level`. A level
   is one of the config's `testing.levels` names when the config lists any. `no-test: <reason>`
   is also allowed (01 §7). → "an AC without a level is flagged".
2. **A row's AC is one of `acs`.**
3. **A `characterization` row names, in its `Test` cell, a symbol whose Code map row says
   `change`** (D-45, Q8). → "a characterization test for an unchanged symbol is flagged".
4. **A `dependency` row in Declared changes requires `risk: high`** (R3-C2). → "a new
   dependency raises the risk".
5. **`ticket` matches `id`,** and `tdd: first` has no `after` rows.

## The registry additions (document-type, still schema 1)

```toml
[[ids]]
prefix = "AC"
pattern = "AC-{id}\\.[0-9]+"    # {id}: this document's id, escaped
defined_by = "bullet"
required = true                 # at least one definition

may_be_empty = ["Implementation log", "Change log", "Review triage log"]
checks = ["plan"]               # built-in checks by name: ticket | plan
```

- **Checked at load:**
  - a pattern with `{id}` must compile with a sample id;
  - `may_be_empty` names listed sections;
  - `checks` names known checks.
- **`{id}`** is replaced by the document's escaped `id` before the pattern runs. It may appear
  only in ID patterns.

## Files

```
registry/document-types/{story,bug,plan}.toml
registry/templates/{story,bug,plan}.md               # the templates, with hidden "done when" rules
registry/templates/{story,bug,plan}-checklist.md     # for the verifier (later units)
registry/examples/{story,bug,plan}.md                # filled examples (the "done when")
src/config/registry.js       # + {id}, required, may_be_empty, checks
src/lint/rules.js            # + {id} substitution, required kinds, may_be_empty
src/lint/checks.js           # the ticket and plan checks
src/lint/frozen.js           # frozenBlock, frozenBlockHash
src/lint/lint.js             # + lintText; config repos and levels passed to the checks
test/lint/templates.test.js
```

## Tests

| # | Test |
|---|---|
| T1 | MIRAI's registry loads: three types, each template has exactly its type's sections in order, and each template's frontmatter names its type |
| T2 | **The filled examples lint clean** (story and bug through `mirai lint` in a sample repo; plan through `lintText`) |
| T3 | **A ticket without own AC IDs is flagged; a ticket without `repo` is flagged;** `repo` not in the config's repos is flagged; a ticket with `status` is flagged |
| T4 | Ticket fields: `size: XL`, `risk: low`, a bad `covers_ac` entry, `after` naming itself; PRD AC mentions in the body are not unknown IDs |
| T5 | `{id}`: `AC-PMT-12.1` is the ticket's own kind in `PMT-12`, and a mention of `AC-PMT-13.1` in it is unknown |
| T6 | **An AC without a level is flagged;** an AC in `acs` with no row is flagged; a level not in the config's levels is flagged; `no-test: reason` passes; a row for an AC not in `acs` is flagged |
| T7 | **A characterization row for a symbol the Code map marks `read`, `add` or doesn't list is flagged;** one marked `change` passes |
| T8 | **A `dependency` row with `risk: normal` is flagged;** with `risk: high` it passes; `none` passes |
| T9 | Frozen markers: missing, twice, out of order, or a frozen section outside them are flagged |
| T10 | **An edited frozen block fails verification:** sign `frozenBlockHash` (unit 06's signing), then any edit inside the block fails and an edit outside it doesn't; CRLF and LF give the same hash |
| T11 | Registry: `{id}` outside ID patterns, an unknown check name and an unknown `may_be_empty` section are refused with positions; empty log sections pass only when listed |

## Decisions (approved open points)

- **Split** into 08a and 08b (open point 1).
- **Plans are linted through `lintText` only, for now** (open point 4). A CLI way comes with
  the plan step (unit 21).

## Done when

- `npm test` passes: the earlier tests plus this unit's (T2's plan part, T6–T11).
- `test-results.md` holds the output.
- The Tech Lead and Architect reviews are done, and `review.md` is written.
- You write **"UNIT APPROVED"**. Then: one commit and push, and `PROGRESS.md` updated.

## Changes after testing and review

Listed for your check before "UNIT APPROVED".

**Carried over from 08a (already approved there):**
1. **The field is `lint_checks`,** not `checks` (08a review). The plan uses
   `lint_checks = ["plan"]`.
2. **The checks get one `project` object.** It is now `{ repos, levels }`; `levels` are the
   config's `testing.levels` names.

**Settled while building:**
3. **The frozen markers are checked by a generic rule,** driven by a new document-type field
   `frozen_sections = ["Intent", "Boundaries", "Edge cases"]`, not by the plan check. They must
   be the first sections, in order. Any later document with a human-owned block can reuse it.
4. ~~`verifyFrozenApproval`~~ is replaced after review by `approvalHash` and
   `verifyPlanApproval` (#11 below). Unit 21 records the approval in the journal.
5. **The plan is a document, not a ticket:** it has no own ACs. `acs` lists the ACs it must
   prove, of any AC shape.
6. **Table rules, as read from the visible text:**
   - **Test list:** a row may name several ACs, separated by commas.
   - **Characterization:** the symbol comes from the `Symbol` column, matched exactly
     (changed after review, #12).
   - **Declared changes:** one `none` row means nothing is declared.
   - **Missing columns:** a table without its columns is `plan-table`.
7. **`round` must be at least 1** (`plan-round`). **`id` must be `<ticket>-plan`**, ignoring
   case (`plan-id`).
8. **Leftover template text skips prescribed structure:** table header and `|---|` rows, and
   lines of fewer than three words (such as the `none` row). Otherwise every plan would match
   its own template's headers.
9. **`lintText` doesn't follow relative links:** there's no repo around a stored plan.
10. **New problem codes:** `frozen`, `plan-id`, `plan-round`, `plan-table`, `plan-test`,
    `plan-level`, `plan-characterization`, `plan-risk`.

**From the reviews (`review.md`), with your decisions (2026-10-24):**
11. **Your approval signs more than the frozen block.** `approvalHash` covers:
    - the frozen block;
    - the Declared changes rows;
    - the fields `ticket`, `acs`, `risk`, `tdd`, `tests` and `round`.

    It is checked by `verifyPlanApproval(approval, text, keys, { context })`, which also ties
    the approval to its ticket. So a dependency, a protected path, `tdd: first → after` or a
    dropped AC added after approval fails. The design approves declared changes with the plan
    (01 §6, §7 step 8). `frozenBlockHash` stays, for showing the block.
12. **The Test list gains `Test ID` and `Symbol`**, so units 22–23 can run exactly the planned
    tests. A test row needs a Test ID (a no-test row has none). A characterization row's Symbol
    must be one the Code map marks `change`. Another row's Symbol must be in the Code map.
13. **The signing context is `mirai/plan-approval/1:<repo-id>`,** in `docs/signing.md`. How
    the journal records the approval is unit 21's decision.
14. **Every AC needs a row, even with `tests: optional`:** a test, or `no-test: <reason>`.

**Fixes from the reviews:**
15. **Blocking:** text between the end marker and the next section rendered as part of Edge
    cases but wasn't hashed. Only blank lines and comments may sit there now.
16. **Nothing hidden inside the frozen block:** no HTML comment other than the markers, and no
    invisible character. The template's guidance for the frozen sections moved above the
    block.
17. **Markers count only outside fences, indented at most three spaces.** A marker quoted in a
    log no longer breaks the approval.
18. **Tables are read as GFM renders them:**
    - rows without a leading pipe count;
    - a separator needs dashes;
    - the table ends at a blank line;
    - a row hidden by a comment, or a second table in the section, is a problem.
19. **Declared changes have a fixed format.** Item and Why are required. A protected path is a
    path or glob inside the repo. A dependency is `<ecosystem>:<name>`, such as `npm:left-pad`.
20. **Smaller fixes:**
    - with `tdd: after`, `red` rows are a problem;
    - `No-test:` is accepted in any case, and a no-test row has no Test ID or Kind;
    - repeats in `acs` are flagged, and a missing AC is reported at `acs[i]`;
    - an `add` row in the Code map names its symbols, for the stub step;
    - leftover text is compared as it shows, so a real `npm test` line isn't flagged and the
      template's Code map row is;
    - `lintText` has the size limit, `required` for an empty type, and the "did you mean" hint.

**For later units:**
- **Unit 21:**
  - how the journal records a plan approval (a ticket-kind event with the hash, or a `plan`
    kind with a journal schema bump);
  - the broker and the floor guard check installs and protected paths against the approved
    plan;
  - the `mirai-plan` and `mirai-tdd` skills say the frozen block wins over anything below it.
- **Unit 23:** maps the Test ID to the level's runner.
- **Unit 37:** "Code map", "Test list", "Declared changes" and the frozen sections are
  protected core sections. Overlays may not rename or reorder them, or the plan check must
  follow the mapping.
- **Multi-repo:** test levels are flattened across repos for now. A plan's levels could be
  limited to its ticket's repo.

