---
unit: "33"
name: epic
status: draft, reshaped after 32 (interview confirmed by Jet, 2026-11-20; waiting for "approve 33")
roadmap: design/07-implementation-roadmap.md, row 33; design/01 §5, §5a, §6, §12a; D-09, D-35, D-36 (design/04); design/09 PM-03; research/13 §9a
depends_on: ["08", "32"]
---

# Unit 33: The epic and the ticket graph lint

## Why

After the PRD, Tess splits the work into tickets, and you approve the set before any of it is
built (the `tickets` gate is always yours, D6). Today nothing gives you one page for that
decision. You would open ticket files one by one, and nothing checks that the set covers the PRD
or that its order can be built.

This unit adds:

- **the epic:** the page you approve a ticket set from;
- **the graph lint:** the checks that the set is complete and buildable.

**Why now:** the ticket set is the next document in B's flow, after the PRD (32). Tess (42) and
the tickets workflow (45) build on both.

## Decisions (Jet, 2026-11-20, interview)

1. **One epic file per epic** is your approval page for its ticket set.
   - **Where:** `<docs_root>/<initiative>/epic-<slug>.md`, with its tickets in
     `<initiative>/tickets/`.
   - **On `standard`:** exactly one epic per PRD.
   - **On `full`:** Tess proposes several epics, each covering its own FRs. One approval covers
     them all.
   - **The approval** signs the epic and every ticket file in it, so what you read is what gets
     built.
2. **MIRAI generates the parts that restate the tickets.** `mirai epic render <epic file>`
   writes these from the ticket files, under fixed headings:
   - **the ticket table:** key, title, size, risk, `after`, FRs and ACs covered, ADRs;
   - **the dependency diagram:** Mermaid, from `after`;
   - **the coverage table:** every PRD FR, NFR and AC, and the tickets that cover it;
   - **the "Design decisions" list:** every ADR the tickets name in `governed_by`, linked.

   The lint fails when any of them no longer matches the ticket files. The fix is to run the
   command again.

   **Tess writes only the judgement parts:**
   - the summary;
   - the order and why (the tracer bullet first, then the part she is least sure of; design/01 §5);
   - the release mode with its reason (`per-ticket` by default, `together` only with a reason;
     §12a);
   - what's left out.
3. **Caps,** configurable in `[docs.limits]` (project layer only, range-checked, as in 32):

   | Key | Default | Lint |
   |---|---|---|
   | `epic_tickets` | 20 | warn at 16, fail above 20 |
   | `epic_l_tickets` | 5 | fail above 5 |
   | `epic_summary_words` | 400 | fail above |
   | `epic_summary_warn_words` | 300 | warn at or above |

   - **Ticket sizes stay S, M and L.** Nothing bigger (design/01 §5).
   - **No exception route.** On `standard`, a set over the cap means splitting the PRD or moving
     to `full`, never merging tickets to fit.
4. **The summary** (31's five parts) groups tickets by what they deliver.
   - **"What changes":** 3–7 bullets, each ending with its ticket keys and FRs, for example:
     "Reminder emails go out the evening before, retried once on failure (SAMPLE-53, SAMPLE-54;
     FR-4, FR-7)".
   - **"Decisions for you":** only what needs your call, each by ticket key with a one-line reason:
     - the release mode, when Tess proposes `together`;
     - every `risk: high` ticket;
     - every `e2e: true` ticket;
     - every `tdd` or `tests` override.

     The lint checks that each one is listed.
5. **The epic links its design and holds no implementation detail.**
   - **Link lines under the title,** as the PRD's `Brief:` line:

     ```
     PRD: [Tasks with due dates](prd.md)
     Design: [HLD](hld.md), [LLD for reminders](lld-reminders.md)
     ```

   - `PRD:` is always required. `Design:` is required on `full`, and on `standard` only when an
     ADR exists.
   - **ADRs come from each ticket's `governed_by`,** shown in the generated parts.
   - **No section asks for the "how".** Vera's checklist flags any that belongs in the design or
     the plan.
   - **In 33 the lint checks only that the `Design:` links resolve.** Their types (HLD, LLD) are
     checked once unit 62 adds them.

## Scope

**In**

1. **The epic document type** (`registry/document-types/epic.toml`):
   - **Frontmatter:** the shared fields, plus:
     - `track`;
     - `release` (`per-ticket` | `together`).
   - **`upstream`** names the PRD (and, on `full`, the design documents).
   - **Sections, in order:**

     | Section | Holds | Written by |
     |---|---|---|
     | `## Summary for approval` | 31's five parts, budget 400 words, warning at 300 | Tess |
     | `## Order` | why the tickets come in this order | Tess |
     | `## Release` | the release mode and its reason | Tess |
     | `## Not in this epic` | what's left out, citing the PRD's NGs or adding the epic's own | Tess |
     | `## Tickets` | the ticket table | generated |
     | `## Dependencies` | the Mermaid diagram from `after` | generated |
     | `## Coverage` | every PRD FR, NFR and AC → its tickets | generated |
     | `## Design decisions` | every ADR from `governed_by`, linked, or "None" | generated |

   - **The generated sections** sit between markers that the lint and the command both know.
     Hand edits inside them are drift.
2. **The epic template, checklist and example:**
   - `registry/templates/epic.md` and `epic-checklist.md`;
   - `registry/examples/epic.md`: the due-dates epic from 32's example PRD, with its tickets in
     `registry/examples/tickets/`. It lints clean.
   - **No list lead-ins or sample sentences an agent would copy** (32's P2: copied lead-ins
     failed as leftover text). Guidance sits in `done when` comments.
   - **The checklist gains 32's P3 lessons** (a section "What the set must not add"):
     - no ticket builds something the PRD doesn't ask for: every ticket's work traces to its FRs
       and NFRs, and nothing else;
     - a ticket records data for a metric only when a BR asks for it (32's round-2 scope creep:
       a change log and a report nobody asked for);
     - a question a builder would have to ask about what is built or who may do what goes back
       to the PRD, not into a ticket's guess.
3. **`mirai epic render <epic file>`:**
   - reads the epic's ticket files (every ticket whose `epic` field names it) and the PRD;
   - rewrites only the four generated sections;
   - prints the epic's clickable path (32's link rule);
   - it writes the repo's docs only, so it's on the `/mirai` session list (21f).
   - **`mirai show <initiative>`** (32) lists the epic too, with its state, ticket count and full
     path, so the approver finds it in one click.
4. **The graph lint** (`src/lint/graph.js`, run on an epic with its tickets and PRD):
   - **Fail:**
     - a cycle in `after`;
     - an `after` naming a ticket that doesn't exist;
     - a PRD FR, NFR or AC (Failures and Unchanged behaviour included) that no ticket covers;
     - a ticket covering an ID the PRD doesn't define;
     - a size other than S, M or L;
     - more tickets or L tickets than the caps;
     - a ticket with no AC or no `verify`;
     - stacking deeper than 2 levels or across epics (design/01 §6);
     - a generated section that doesn't match the tickets;
     - a "Decisions for you" item missing for a ticket that needs one (decision 4).
   - **Warn:**
     - two tickets in the epic listing the same file in `files_likely` with no `after` between
       them;
     - the ticket count at 16 or more.
   - **Every message** names the ticket and the fix.
5. **31's summary check and the link lines:** the `PRD:` and `Design:` lines may sit between
   the title and the summary (32's `Brief:` rule, widened to a type's list of upstream links).
6. **Approval:** `mirai approve <epic-id> --file <epic.md>`:
   - lints the epic, its tickets and the graph as at approval;
   - shows the epic's path and how many tickets it covers;
   - takes one decision and writes one signed approval over the epic's bytes and each ticket
     file's bytes;
   - a later change to any of those files needs a new approval.

   The inbox screen and the docs MR merge stay in 45.
7. **Config:** the four `docs.limits` keys (decision 3).
8. **Docs:** fix the epic's budget in "The summary for approval" (it says 250; it is 400), and add
   an "Epics and ticket sets" section in `docs/documents.md`:
   - reading an epic as its approver;
   - what is generated;
   - the caps;
   - `mirai epic render`.

**Out**

- Tess writing tickets and epics (42), the tickets workflow and its approval screen (45), the
  docs MR merge (38), the inbox (46).
- The HLD, LLD and ADR types, and checking the `Design:` link's type (62 and later).
- `mirai trace` from tickets down to tests and QA evidence (47).
- The epic's runtime states and `release: together` branches (design/01 §12a; later units).

## Tests

- **T1** The type, the template and the example: the example lints clean with its PRD and
  tickets; the template left as it is fails.
- **T2** Generated sections:
  - `mirai epic render` produces the example's four sections exactly;
  - a hand edit inside one fails as drift;
  - a ticket changed after rendering fails until it is rendered again.
- **T3** The graph lint: each failure in Scope 4 caught on a seeded set, with the ticket named.
  Includes a cycle, an uncovered Failures AC, a 21st ticket, a sixth L ticket, an XL size, and a
  third stacking level.
- **T4** "Decisions for you": a `risk: high` ticket or an `e2e: true` ticket not listed fails;
  `release: together` without a decision item fails.
- **T5** Links: no `PRD:` line fails; `full` without `Design:` fails; a broken `Design:` link
  fails.
- **T6** Caps from `[docs.limits]`: a project value moves each cap; out-of-range values are
  refused; a personal file can't set them.
- **T7** Approval: one decision signs the epic and every ticket; a changed ticket makes the
  approval stale; an epic with a graph-lint error is refused.
- **T8** `mirai show due-dates` lists the brief, the PRD and the epic, each with its state and
  full path; the epic line gives its ticket count.

## Probes (real)

- **P1 Your read:** you approve the example ticket set from the epic's summary, about 5 minutes.
  **Pass when** you knew what gets built, in what order, and what to decide, without opening a
  ticket.
- **P2 An agent splits a PRD:** a fresh agent gets 32's P2 PRD, the epic and story templates
  and checklists. It writes the epic and tickets, then runs `mirai epic render`. **Pass when:**
  - the set lints clean after at most one round of fixing;
  - every PRD AC is covered;
  - **nothing added:** a second fresh agent compares each ticket with the PRD and finds no ticket
    work that no FR or NFR asks for (32's P3 lesson). Anything found becomes a checklist or
    template finding.
  - **nothing cut to fit:** the agent didn't merge or drop work to stay under the caps (32's P2
    agent cut ACs to fit the PRD cap).

## Done when

- T1–T8 pass, and the full suite passes through the build runner and CI.
- P1 and P2 pass.
- The roadmap row's done-when holds: the graph lint catches a cycle and an uncovered AC.
