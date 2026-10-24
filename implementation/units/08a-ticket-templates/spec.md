---
unit: "08a"
name: ticket-templates
status: approved (2026-10-24, as part of unit 08; split by open point 1)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 08; D-06, D-09, D-15, D-23, D-29, D-35, D-41, D-42, D-44, D-45, D-48; R-M10, R2-M11, R3-M2, R3-C2; 01 §5–§7; 03 "Templates"
depends_on: ["04", "06", "07b"]
---

# Unit 08a — Story and bug templates, and the ticket check

Unit 08's spec was approved with its five open points as recommended. This is the first half:
the two ticket types. Unit 08b (`../08b-plan-template/spec.md`) has the plan.

## Why

Tickets and plans are what the agents work from every night. If their shape drifts, the
orchestrator can't trust what a ticket covers, which tests a plan promises, or whether you
approved this plan or an edited one. This unit writes MIRAI's first real document types into
its registry, and gives them the checks unit 07's generic rules can't do alone.

**Roadmap "done when" (08a's share; the plan items are 08b's):**
- a filled example lints clean;
- a ticket without AC IDs or a `repo` is flagged.

## Scope

**In:**
- **Two document types** in `registry/document-types/`, with their templates and checklists
  in `registry/templates/`: `story` and `bug`. The `plan` type is unit 08b.
- **Small, additive registry fields** (schema stays 1):
  - `{id}` in ID patterns;
  - `required` on an ID kind;
  - `checks`, which names built-in checks.
- **One built-in check** in code: `ticket`.
- **The plan, `may_be_empty`, the `plan` check, the frozen block and `lintText`:** unit 08b.

**Out:**
- **The epic template:** it comes with the ticket workflow (unit 45). The `story` type takes an
  optional `epic` field now.
- **Auto-setting `risk` from risk paths and keywords:** the ticket planner (unit 42).
- **Cross-document checks** (a story's `covers_ac` exists in the PRD): `mirai trace` (unit 43).

## The two ticket types

Tickets have no `status` field (D-06): their status lives in the store. Both types use
`status = "forbidden"`.

**Frontmatter (01 §5, "Every ticket records"):**

| Field | Type | Required | Rule |
|---|---|---|---|
| `id` | string | yes | a ticket key (unit 04's `TICKET_ID`), for example `PMT-12` |
| `repo` | string | **yes** | one of the config's `[[repos]]` names (D-42) |
| `risk` | enum `normal` · `high` | yes | |
| `size` | enum `S` · `M` · `L` | yes | anything bigger is split (D-09) |
| `verify` | string | yes | one sentence: how the ticket is checked |
| `covers_fr` | list `FR-n` / `NFR-n` | no | empty on the quick track |
| `covers_ac` | list `AC-FR-n.m` / `AC-NFR-n.m` | no | the PRD ACs it covers (R2-M11: one field name) |
| `governed_by` | list `ADR-n` | no | |
| `after` | list of ticket keys | no | real prerequisites only |
| `epic` | string | no | the epic's id |
| `files_likely` | list of paths | no | |
| `e2e` | boolean | no | `true` only for a critical journey (D-44); default `false` |
| `tdd` | enum `auto` · `first` · `after` | no | only when it differs from the project (D-23) |
| `tests` | enum `required` · `optional` | no | likewise |

**The ticket's own ACs (R-M10):**
- **Every story and bug numbers its own acceptance criteria as `AC-<id>.n`:** for example
  `AC-PMT-12.1`, written in definition form (`- AC-PMT-12.1: …`) with Given / When / Then
  under it.
- **The kind is `required`:** a ticket with none is flagged.
- **A PRD's ACs are mentioned in `covers_ac`,** and may be mentioned in the text. They aren't
  the ticket's own kind, so they're never "unknown" (see open point 2).

**Sections:**

| Type | Required | Optional |
|---|---|---|
| `story` | Description · Acceptance criteria | Boundaries · References · Notes |
| `bug` | Description · Reproduction · Acceptance criteria | Cause hypothesis · References · Notes |

**The `ticket` check (code):**
- `repo` is one of the config's repos;
- an `after` entry isn't the ticket itself.

## The registry additions (document-type, still schema 1)

```toml
[[ids]]
prefix = "AC"
pattern = "AC-{id}\\.[0-9]+"    # {id}: this document's id, escaped
defined_by = "bullet"
required = true                 # at least one definition

lint_checks = ["ticket"]        # built-in checks by name (08b adds plan); renamed after review
```

- **Checked at load:**
  - a pattern with `{id}` must compile with a sample id;
  - `checks` names known checks.
- **`{id}`** is replaced by the document's escaped `id` before the pattern runs. It may appear
  only in ID patterns.

## Files

```
registry/document-types/{story,bug}.toml
registry/templates/{story,bug}.md               # the templates, with hidden "done when" rules
registry/templates/{story,bug}-checklist.md     # for the verifier (later units)
registry/examples/{story,bug}.md                # filled examples (the "done when")
src/config/registry.js       # + {id}, required, checks
src/lint/rules.js            # + {id} substitution, required kinds
src/lint/checks.js           # the ticket check
src/lint/lint.js             # config repos passed to the checks
test/lint/templates.test.js
```

## Tests

| # | Test |
|---|---|
| T1 | MIRAI's registry loads with story and bug; each template has exactly its type's sections in order, and its frontmatter names its type |
| T2 | **The filled examples lint clean** through `mirai lint` in a sample repo |
| T3 | **A ticket without own AC IDs is flagged; a ticket without `repo` is flagged;** `repo` not in the config's repos is flagged; a ticket with `status` is flagged |
| T4 | Ticket fields: `size: XL`, `risk: low`, a bad `covers_ac` entry, `after` naming itself; PRD AC mentions in the body are not unknown IDs |
| T5 | `{id}`: `AC-PMT-12.1` is the ticket's own kind in `PMT-12`, and a mention of `AC-PMT-13.1` in it is unknown |
| T6 | Registry: `{id}` outside ID patterns and an unknown check name are refused with positions; `required` with no definition is flagged |

## Decisions (approved open points)

- **Split** into 08a and 08b (open point 1).
- **Own ACs through `{id}`** (open point 2).
- **Every ticket numbers its own ACs, on every track** (open point 3).
- **No `severity` on bugs** (open point 5).

## Done when

- `npm test` passes: the earlier tests plus T1–T6.
- `test-results.md` holds the output.
- The Tech Lead and Architect reviews are done, and `review.md` is written.
- You write **"UNIT APPROVED"**. Then: one commit and push, and `PROGRESS.md` updated.

## Changes after testing and review

Listed for your check before "UNIT APPROVED".

**Found while testing:**
1. **T5 as approved can't hold.** It said a mention of another ticket's `AC-PMT-13.1` is
   unknown. With `{id}` (open point 2), the story's own kind is `AC-PMT-12.n`, so
   `AC-PMT-13.1` isn't that kind, just as a PRD's `AC-FR-2.1` isn't. Both are left to
   `mirai trace`. The shape alone can't tell another ticket's AC from a PRD's. T5 now checks
   three things:
   - another ticket's AC passes;
   - an own AC mentioned but not defined (`AC-PMT-12.9`) is unknown;
   - the same text under another id has no own ACs.

**Settled while building:**
2. **A template is a valid document of its type,** with its guidance in HTML comments and
   "Not applicable — …" lines in the optional sections. So the templates lint clean, and `mirai
   lint` on MIRAI's own repo stays quiet: the registry lies outside the docs root, but its files
   have a known type and `template:`.
3. **Filled examples live in `registry/examples/`,** next to the templates. Agents and tests
   follow them.
4. **New problem codes:**
   - `missing-id`: a required ID kind has no definition;
   - `unknown-repo`: from the ticket check;
   - `after-self`: from the ticket check.
5. **`repo` is checked against the config's `[[repos]]` names.** Before `mirai init`, that is
   the default, `"."`, which must be quoted: a bare `.` reads as a number in YAML 1.1.

**From the reviews (`review.md`), with your decisions (2026-10-24):**
6. **Unfilled templates are caught.** Inside the docs root, any of these is a problem
   (`template-text`): a body line that is word for word the type's template, the template's
   example `id`, or its sample `verify`. The templates themselves live outside the docs root.
   The checklists ask about it too.
7. **A bug's ACs state the fixed behaviour only.** The meta-criteria are gone:
   - "a test covers the defect" moves to the done-when comment and the checklist;
   - "no change needed" becomes an outcome: the ticket is dropped with the evidence.

   `mirai trace` can then require a test and QA evidence for every AC.
8. **`checks` is renamed `lint_checks`,** apart from the config's named quality-gate checks.
   For unit 37: overlays may add lint checks, never remove them.
9. **Ticket keys are compared without regard to case:** in `after` and the file-name rule.
10. **`files_likely` accepts quoted paths with spaces.** It still refuses a leading `/`, a drive
    letter, `..`, backslashes and control characters.

**Fixes from the reviews:**
11. **An AC defined under another id** (`- AC-PMT-13.3:` in PMT-12, a stale copy or a typo) is
    a problem (`foreign-id`), not silently ignored. A ticket never defines another document's
    IDs.
12. **Own ACs belong in "Acceptance criteria":** the new ID-kind field `section`. One defined
    elsewhere is a problem (`misplaced-id`), and still counts as defined.
13. **Under `tickets/`, the file name is the id** (`file-name`, design/03's `tickets/<id>.md`).
14. **`after` naming a ticket twice** is a problem.
15. **Without a usable id** (missing, a number, or the wrong shape) there's no extra
    `missing-id`. A token-shaped id is never echoed in a message.
16. **The checks get one `project` object** (`{ repos }`, which 08b extends). Missing, it's the
    defaults, so a check is never silently skipped.
17. **The templates say more:** the slicing rules, `tickets/<id>.md`, `AC-NFR-n.m`, and the bug
    template's guidance in full.

**For later units:**
- **Unit 43** owns checking every AC-shaped mention in a ticket's text: it must resolve to a
  PRD AC or a ticket's own AC. 08a's rules leave them alone by design.
- **The multi-repo units** decide whether a service repo's light install lints tickets, and
  with which repo list.

