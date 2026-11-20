# Unit 33: test results (2026-11-20)

## Tests

- **`test/documents/epic.test.js`:**
  - T1: the example epic lints clean with its PRD and its seven tickets, with no warning, and each
    ticket lints clean on its own. Its Coverage table lists all 30 FRs, NFRs and ACs of the
    example PRD, Failures and Unchanged behaviour included. The template holds the type's
    sections in order; left as it is, it fails as leftover text (and, with no tickets, on the
    graph and its generated parts). The template has no list lead-in to copy. The checklist
    holds "What the set must not add" with 32's P3 lessons;
  - T2: `mirai epic render` on the example with its four generated sections emptied writes them
    back exactly, keeps the file's permissions, says "already up to date" the second time, and
    ends with the epic's full path. Before it, each section fails as "isn't the generated part".
    A hand edit inside a table, or text added next to the markers, fails as drift. A ticket
    changed after rendering (SAMPLE-52 S → M) fails the Tickets and Dependencies sections through
    `mirai lint` until it's rendered again; everything outside the four sections is unchanged.
    Render refuses a PRD, an epic with no `PRD:` line, and one missing a section. The session
    takes `epic render` with a `file` (and refuses `../`, absolute, non-`.md` paths), and now
    takes `show … docs`;
  - T3: the graph lint, each on a seeded set rendered again, naming the ticket and the fix: a
    cycle (SAMPLE-51 → SAMPLE-53 → SAMPLE-54 → SAMPLE-51), an `after` naming SAMPLE-99, an
    uncovered Failures AC (AC-FR-7.1), an uncovered Unchanged behaviour FR (FR-9), an uncovered
    NFR, a ticket covering FR-12, an XL size, a 21st ticket (fail) and a 16th (warning only), a
    sixth L ticket, a ticket with no AC, one with no `verify`, no ticket at all; the same file in
    two unlinked tickets warns. A chain of five tickets (SAMPLE-51 → 53 → 54 → 55 → 57), an
    `after` into another epic's ticket, and a ticket covering nothing (a refactor sweep) pass;
  - T4: the example without its SAMPLE-53 item fails (risk: high, e2e: true); a `risk: high`
    ticket, an `e2e: true` ticket and a `tdd`/`tests` override not listed each fail, and pass once
    listed by key. `release: together` fails without a decision item and while "## Release"
    doesn't name it;
  - T5: no `PRD:` line fails; a `PRD:` line linking a brief fails; `full` without `Design:` fails
    and passes with it; on `standard`, a ticket naming ADR-1 requires `Design:` (and the
    Design decisions part links `adr/ADR-1.md`); link lines out of order fail; a broken `Design:`
    link fails through `mirai lint` and passes once the file exists;
  - T6: `epic_tickets = 6` fails the example's 7 tickets and 8 warns; `epic_l_tickets = 0` fails
    SAMPLE-53; `epic_summary_words = 150` fails and `epic_summary_warn_words = 150` warns; by
    default a summary past 400 words fails and one past 300 warns. The config takes all four keys
    in range, refuses out-of-range values for each, and refuses `docs.limits` in a personal file;
  - T7: `mirai approve SAMPLE-50 --file`, through the CLI with a signed key: a cycle refuses it
    with the problem listed and nothing written; a ticket's own lint problem (an unknown repo)
    refuses it; it's refused while the PRD isn't approved; after the PRD's approval one decision
    writes one signed line, `kind: epic`, over the epic's hash with `files` holding all seven
    ticket paths and hashes. A changed ticket, a ticket joining, or a changed epic makes it stale;
    putting the ticket back makes it approved again;
  - T8: `mirai show due-dates` lists the brief, the PRD and the epic (`epic (7 tickets)`), each
    with its state and full path, not the tickets; after approval the epic is "approved", and a
    changed ticket makes it "changed since approval".
- **The suites from 31 and 32** (`test/documents/brief.test.js`, `prd.test.js`, `test/lint/`)
  pass. `test/lint/templates.test.js` T1 now lists the epic type and lints each template with the
  PRD template beside it (see "Changed from the spec").
- **The full suite:** 695/695 on the Mac (`npm test`), 8 tests in `epic.test.js`; `test/cli/cli.test.js` T14 pins the new `epic` command. The build runner and CI run on the final commit.

## Probes (real)

| Probe | Result |
|---|---|
| **P1 Your read** | not run yet |
| **P2 An agent splits a PRD** | not run yet |

## Changed from the spec

- **The epic is refused until its PRD is approved as it is now.** The spec doesn't say; it is the
  closest to 32, where a full PRD waits for its brief's approval. Tickets cut from an unapproved
  PRD could drift from what you approve next.
- **One journal line, with `files`:** the `approval` event gains `kind: epic` and a `files` list
  (each ticket's path and hash), allowed only on an epic's line. The epic's own hash is
  `content_hash`. No journal schema version bump, as 31 and 32 added their kinds without one.
- **A ticket joining or leaving the epic also makes its approval stale,** not only a changed file
  ("a later change to any of those files" read as the set too).
- Stacking (design/01 §6) is a runtime limit, enforced by the scheduler in a later unit; the graph lint doesn't check after-chain depth (the spec's Scope 4 item was wrong, corrected 2026-11-20).
- **On `full`, coverage counts every epic's tickets in `tickets/`,** and each epic's Coverage table
  lists only the IDs its own tickets cover (so an epic's generated part depends only on its own
  tickets). On `standard` the table lists every PRD ID, `—` where nothing covers it.
- **The Coverage table has a Group column** (Capabilities, Failures, Unchanged behaviour,
  Non-functional), so the approver sees the failure paths are covered.
- **"A ticket with no AC" means no own `AC-<key>.n`.** A ticket that covers no PRD ID isn't
  refused: design/01 §5 gives epics a closing refactor sweep by default, and whether a ticket's
  work is asked for is Vera's (the checklist's "What the set must not add").
- **The ticket-count warning sits at 80% of `epic_tickets`** (16 of 20); there is no separate key.
  Ranges: `epic_tickets` 2–50, `epic_l_tickets` 0–20, both summary keys 100–2,000.
- **The summary's warning point is a type key, `summary_warn_words`,** with the project key
  `<type>_summary_warn_words`; other types still warn at 80%.
- **`upstream_link` is now a list in the registry (`[[upstream_link]]`),** with `many` (several
  links on one line) and `required`. `prd.toml` moved to the list form; the PRD's `Brief:` line,
  its messages and 32's tests are unchanged. Link lines must be in the type's order and appear
  once.
- **32's rule that the upstream's no-gos and open questions reach the summary on `standard`** now
  applies only when the upstream is a brief (the PRD's own rule). For an epic it would have
  required the PRD's NG-4 but not the brief's NG-1…NG-3.
- **Two checks the spec doesn't list:** "## Release" must name the frontmatter's mode
  (`epic-release`), and the epic's own non-goals must be numbered after the highest NG in the
  PRD (and so its brief) (`epic-numbering`).
- **The Design decisions part links ADRs as `adr/<ADR-n>.md`** (design/03's layout). Until the ADR
  type exists (62), such a link fails `mirai lint` unless the file is there. **Known limit:** an
  HLD or LLD inside the docs root fails the lint as an unknown type until 62; T5 keeps its design
  files outside the docs root.
- **`mirai epic render` prints a `next: mirai lint <file>` line** before the epic's full path,
  which stays the last line. It writes with the file's own permissions, not the store's 0600.
- **The session's `/mirai show … docs` was refused** (`docs` wasn't an accepted argument in
  `checkCommand`, 32's gap); fixed with the new `file` argument. The `/mirai` command file
  mentions `epic render` and `--docs`.
- **`test/lint/templates.test.js` T1** lists the epic type and puts the PRD template beside each
  template; the epic's template can't lint clean where it lives (it has no tickets), so its
  problems are held to the graph, the generated parts and their empty sections.
- **`mirai show` puts the ticket count in the type column** (`epic (7 tickets)`), so the other
  columns stay aligned.
- **The example epic is `SAMPLE-50`** with tickets SAMPLE-51…57; it leaves the refactor sweep out
  as its own NG-5. Tickets don't link the epic file, since it is `epic.md` in the registry and
  `epic-<slug>.md` in a project.
