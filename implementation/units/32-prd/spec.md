---
unit: "32"
name: prd
status: done (spec and unit approved by Jet, 2026-11-20: "approve 32"; decisions 1–8 from his interview answers, 2026-11-19)
roadmap: design/07-implementation-roadmap.md, row 32; design/01 §3; D-08, D-35 (design/04); design/09 PM-03; research/13-document-writing.md §7, §9d, §9e
depends_on: ["31"]
---

# Unit 32: The PRD template (lite and full)

## Why

The PRD is the second document in B's flow. Nora writes it from the approved idea in the brief,
Vera checks it, and you approve it. On `standard` you approve the brief at the same step (U4).
Tess then cuts tickets from it (33, 42), so every requirement must be clear enough for a ticket
and a test.

Jet's goal from 31 still holds: documents that are "professional and clear to read, clear to
understand for a human, also detailed enough for the AI agents to make the implementation".
Unit 31 fixed the summary for approval and the writing rules. This unit adds the PRD's detail:
how requirements are worded, how long a PRD may be, and how the brief and the PRD fit together.

**Why now:** Milestone B's `standard` flow needs a PRD lite. The shape of a requirement set here
is used by tickets (33), Nora (41) and the PRD workflow (44). Changing it later means rewriting
documents.

## Decisions (Jet, 2026-11-19, interview)

1. **One document type, two variants.** A single `prd` type has `variant: lite | full` in its
   frontmatter.
   - **Lite** is the required core:
     - the summary;
     - user journeys;
     - functional requirements;
     - non-functional requirements;
     - non-goals;
     - assumptions;
     - open questions;
     - the glossary.
   - **Full** adds:
     - key flows;
     - risks;
     - dependencies;
     - rollout phases with exit criteria.
   - A lite PRD becomes a full one by filling in more sections. Nothing is rewritten.
   - Both variants ship in 32.
   - The variant follows the track (`standard` → lite, `full` → full). Nora may propose
     another; the lint warns when they differ.
2. **Requirements are worded by kind (option C).** The functional requirements fall into four
   groups, each with one sentence shape:

   | Group | Shape | Use it for |
   |---|---|---|
   | Capabilities | "[Actor] can …" | something a person does |
   | Triggers and states | "When …, the system must …" / "While …, … must …" | something the system does by itself, or that holds while a state lasts |
   | Failures | "If …, then … must …" | bad input, outages, edge cases |
   | Unchanged behaviour | "Where …, … must …" | what must stay as it is in an existing product |

   - Every statement of what the system does uses "must", never "shall".
   - Failures and Unchanged behaviour are always present. When there is nothing to list, they
     hold one line: `None — <reason>`.
   - Every FR ends with the brief's BR it serves, for example `(BR-2)`.
   - ACs stay `AC-FR-n.m` in Given / When / Then, under their FR.
   - The shapes come from EARS (Mavin et al., Rolls-Royce, RE'09). The template describes them
     in MIRAI's own words and credits EARS. It doesn't copy the EARS site's text.
3. **A glossary at the end of every PRD,** with two parts:
   - **The ID prefixes:** a fixed block that the template supplies. It says what BR, FR, NFR,
     AC, UJ, NG, A, R, Q, SM, DEP and PH mean, with one example each. The lint checks it's
     there and unchanged.
   - **Domain terms:** each term the requirements depend on, defined once and used in exactly
     that form everywhere.

   (From Jet's question "what is FR?": the approver should never have to ask.)
4. **A length cap on the whole PRD:**

   | Variant | Cap | Warning at |
   |---|---|---|
   | lite | 2,000 words | 1,600 |
   | full | 3,500 words | 2,800 |

   - **Changed by Jet, 2026-11-20, after the probes ("keep your recommendation"):** lite 3,000
     words (warning at 2,400), full 5,000 (warning at 4,000); the Glossary and Open questions
     aren't counted. Three agent PRDs for a small feature landed at 1,860–1,990 words, and one cut
     requirements to fit.
   - **The summary budget by variant (Jet, 2026-11-20, after P1, "summary as recommended"):** a
     full PRD's summary is 1,000 words with up to 12 grouped "What changes" bullets; lite stays
     at 600 words and 3–7 bullets. Project key: `prd_full_summary_words`.
   - **Counted:** everything below the frontmatter, ACs included.
   - **Not counted:** the frontmatter, code blocks, and the glossary's fixed ID-prefix block.
   - **Over the cap fails the lint.** The message says to split the feature into two PRDs, or
     to move to `full` and put the "how" into the design. It says not to remove requirements or
     ACs to fit.
   - **The cap never trades away completeness.** The checks in decision 6 apply at any length,
     and Vera checks that nothing was dropped or made vaguer (checklist).
5. **A PRD that can't be split goes to you.** The author sets
   `length_exception: "<reason>"` in the frontmatter. The lint then warns instead of failing,
   and requires an item under **Decisions for you** that gives the word count, the cap and the
   reason. You approve it as one PRD or ask for a split. Setting `length_exception` on a PRD
   under the cap is an error, so it can't be left on by habit.
6. **Caps and budgets are configurable** in the project config, under `[docs.limits]`, team
   layer only. The registry's numbers are the defaults:

   ```toml
   [docs.limits]
   brief_summary_words = 400
   prd_summary_words = 600
   prd_lite_words = 2000
   prd_full_words = 3500
   ```

   Each key is range-checked (summaries 100–2,000 words; documents 500–10,000), so a project
   can't switch a cap off by setting it very high. Personal files can't set them.
7. **On `standard` you read one summary: the PRD's.** It covers both documents:
   - **The ask** names both: "Approve the due-dates brief and its PRD, so that …".
   - **Decisions for you** carries the brief's open decisions with the PRD's.
   - **Not in this** lists the brief's no-gos and the PRD's own.

   The PRD's detail doesn't repeat the brief's Problem, Who it is for, Why now or Success. It
   uses the brief's IDs (`BR-n`, `SM-n`, `NG-n`, `R-n`, `Q-n`), and its own IDs of the same kind
   continue from the brief's highest number (the brief has `NG-1`…`NG-3`, so the PRD's first new
   no-go is `NG-4`). One ID means one thing across both files. One approval signs both.
8. **Documents are easy to find.**
   - **In 32:**
     - the PRD links to its brief in one line under the title: `Brief: [<title>](brief.md)`;
     - `mirai show <initiative>` lists the initiative's documents with their approval state and
       a clickable full path.
   - **Written into rows 38, 41, 44 and 46 as a rule:** every time MIRAI writes, changes or
     approves a document, its last output line gives the clickable path, plus the GitHub or
     GitLab link once pushed. This covers Nora's run, `/mirai` in your session, the inbox item
     and the docs MR description, which lists every document in it with its link.

## Scope

**In**

1. **The PRD document type** (`registry/document-types/prd.toml`):
   - **Frontmatter:** the shared fields from 31, plus:
     - `track` (`quick` | `standard` | `full`; the proposed track, R2-M11);
     - `variant` (`lite` | `full`);
     - `length_exception` (optional string).
   - **`upstream`** names the brief's id.
   - It lives at `<docs_root>/<initiative>/prd.md` (`03`).
   - **Sections, in order** (* = full only; required when `variant: full`, absent or
     `Not applicable — <reason>` in lite):

     | Section | Holds | IDs |
     |---|---|---|
     | `## Summary for approval` | 31's five parts, budget 600 words (full: 1,000, see decision 4) | — |
     | `## User journeys` | each journey: who, the situation, the steps in a sentence or two | `UJ-n` |
     | `## Functional requirements` | four H3 groups (decision 2), each FR with its ACs | `FR-n`, `AC-FR-n.m` |
     | `## Non-functional requirements` | statement, target (or `UNKNOWN`), and how it's verified | `NFR-n`, `AC-NFR-n.m` |
     | `## Key flows`* | one flow per main journey: steps, branches; Mermaid allowed | cites `UJ-n`, `FR-n` |
     | `## Non-goals` | the PRD's own no-gos, each with a reason; the brief's are cited, not repeated | `NG-n` |
     | `## Risks`* | likelihood, impact, mitigation | `R-n` |
     | `## Dependencies`* | what this needs from other teams, systems or work, and what it blocks | `DEP-n` |
     | `## Rollout`* | phases, each with its exit criteria | `PH-n` |
     | `## Assumptions` | everything assumed, each tagged `[ASSUMPTION]` in the body and listed here | `A-n` |
     | `## Open questions` | each with an owner and what it blocks; empty at approval | `Q-n` |
     | `## Glossary` | the fixed ID-prefix block, then the domain terms | — |

   - Lite has no Success section: its metrics are the brief's `SM-n`, cited where they matter.
2. **The PRD template** (`registry/templates/prd.md`):
   - one template for both variants, with full-only sections marked in their comment;
   - each section has a "done when" comment and names its source, as 31's does;
   - the four FR groups show one example sentence each;
   - the EARS credit line;
   - the fixed ID-prefix block, ready to keep as it is.
3. **The PRD lint** (`src/lint/prd.js`, the `prd` check; with `summary` and `writing` from 31):
   - **IDs:**
     - `UJ`, `FR`, `NFR`, `A`, `DEP`, `PH` run 1, 2, 3 … with no gap;
     - `AC-FR-n.m` and `AC-NFR-n.m` run .1, .2 … under their parent, and the parent exists;
     - `NG`, `R`, `Q` continue after the brief's highest; an ID the brief already defines may
       be cited, not redefined.
   - **Across the brief:**
     - an ID the PRD cites resolves in the PRD or in its brief (31's `unknown-id`, widened to
       the linked brief);
     - **every BR in the brief is served by at least one FR or NFR** (fail);
     - the `Brief:` link resolves to the brief named in `upstream` (fail).
   - **Requirements:**
     - every FR names its BR (fail);
     - every FR and NFR has at least one AC, and every AC has Given, When and Then (fail);
     - every NFR names how it's verified: at least one `AC-NFR-n.m`, or a `Verified by:` line
       naming a test level, a measurement or a manual check (fail; D-35);
     - an FR whose sentence doesn't match its group's shape warns, at least until we've seen
       real PRDs;
     - the four FR groups are all present; Failures and Unchanged behaviour hold FRs or
       `None — <reason>` (fail).
   - **Shape:**
     - `variant: full` with a full-only section missing fails; lite with one filled is allowed;
     - variant and track disagree (`standard` + `full`, `full` + `lite`) warns;
     - the glossary's ID-prefix block is missing or changed (fail);
     - the length cap and `length_exception` (decisions 4–5).
   - **At approval:** no open question, and no `[ASSUMPTION]` tag left outside the Assumptions
     list (fail).
   - **The summary's "Not in this":** 31's rule (every NG appears there, and the reverse) now
     counts the brief's NGs too on `standard`.
4. **31's summary check, widened by one line:** `Brief: [<title>](brief.md)` may sit between the
   title and the summary. Nothing else may.
5. **The PRD checklist** (`registry/templates/prd-checklist.md`), Vera's judgement items, for
   example:
   - nothing the brief, the intake note or the sources ask for is missing or replaced by a
     vaguer statement;
   - each Failures FR is a failure that can really happen, and the obvious ones are all there;
   - Unchanged behaviour names what a user of today's product would notice if it broke;
   - each AC could be turned into a test without asking anyone;
   - every term in the requirements is in the glossary and used the same way;
   - on `standard`, the PRD's summary covers both documents and reads alone;
   - a `length_exception` is real: the feature can't be split along its BRs.
6. **The configurable limits** (decision 6): `docs.limits.*` in the config schema, project layer
   only, with ranges; the brief's summary budget moves there too. The lint reads the trusted
   config, as approval already does.
7. **Approval:**
   - **`standard`:** `mirai approve <prd-id> --file <prd.md>` also reads the brief the PRD
     links to, lints both as at approval, and prints both paths and hashes. You decide once,
     and two signed `approval` events are written (`kind: brief`, `kind: prd`), each on its
     file's exact bytes.
   - **`full`:** the PRD approval is refused unless the brief is approved as it is now.
   - A PRD or brief changed after approval needs a new approval (31's `documentApproval`,
     extended to `prd`).
8. **`mirai show <initiative>`:** lists the documents in `<docs_root>/<initiative>/`, each with
   its type, id, approval state (approved, changed since approval, not approved) and full path,
   for example:

   ```
   due-dates   standard
     brief.md   approved      /Users/…/sample-app/docs/mirai/due-dates/brief.md
     prd.md     not approved  /Users/…/sample-app/docs/mirai/due-dates/prd.md
   ```

   - **Telling a ticket from an initiative:** when the argument is a folder under the docs root,
     it's an initiative. When it's both an initiative and a ticket, `show` asks you to choose
     with `--docs`.
   - It's read-only, so `/mirai show` in your session already has it.
   - The host link comes with the docs MR (38).
9. **The example** (`registry/examples/prd.md`): the due-dates PRD, lite, from 31's example
   brief. It lints clean together with the brief and is the template's worked example. The
   example brief's `Q-1` is answered first (email only), so the pair can be approved.
10. **Design and roadmap updates:**
    - **design/01 §3:** the FR wording becomes decision 2, replacing "[Actor] can [capability]
      [under conditions]" for every FR.
    - **Roadmap rows 38, 41, 44 and 46:** add decision 8's link rule.
    - **Row 33:** the graph lint's closure includes the Failures and Unchanged behaviour FRs.
11. **Docs** (`docs/documents.md`), a PRD section covering:
    - the variants;
    - the four requirement groups, with the due-dates examples;
    - the glossary;
    - the caps and the exception;
    - how to approve the pair on `standard`;
    - `mirai show <initiative>`.

**Out**

- Nora writing PRDs (41), the interview (35), Vera running the checklist (40).
- The PRD workflow, its approval screen and its document states (44), the docs MR and its host
  links (38), the inbox (46).
- The reader test and `mirai-write`'s examples (34).
- `mirai trace` over the whole chain to tests (33, 47); 32 checks the PRD and its brief only.
- PRD versions and change requests (66).

## Tests

- **T1 The type and the template:**
  - the template, left as it is, fails as leftover text;
  - both variants of the template match the type;
  - the example lints clean with its brief.
- **T2 Requirements:** each of these fails, naming the FR and the fix:
  - an FR with no BR;
  - an FR with no AC;
  - an AC with no Then;
  - a missing Failures group;
  - an empty Unchanged behaviour group with no `None — <reason>`;
  - a gap in the `FR` numbers;
  - `AC-FR-3.2` with no `AC-FR-3.1`;
  - an AC whose FR doesn't exist.

  A Capabilities FR written as "When …" only warns.
- **T3 NFRs:** an NFR with neither an `AC-NFR` nor a `Verified by:` line fails. A `Verified by:`
  line naming none of test, measurement or manual check fails.
- **T4 Across the brief:**
  - a BR in the brief that no FR or NFR serves fails;
  - a cited `BR-9` the brief doesn't define fails;
  - a PRD that redefines the brief's `NG-2` fails;
  - a PRD whose first new no-go is `NG-1` while the brief has `NG-1`…`NG-3` fails;
  - a broken `Brief:` link fails;
  - a brief NG missing from the PRD's "Not in this" on `standard` fails.
- **T5 Length:**
  - a lite PRD of 1,700 words warns, and one of 2,100 fails with the split message;
  - with `length_exception` set, the same PRD only warns, and fails if "Decisions for you" has
    no item with the word count;
  - `length_exception` on a PRD under the cap fails;
  - a project config with `prd_lite_words = 2500` moves the cap, and `999999` is refused by the
    config check;
  - a personal file setting `docs.limits` is refused.
- **T6 Variant and glossary:**
  - `variant: full` with no Rollout fails;
  - a lite PRD with a filled Risks section passes;
  - `track: standard` with `variant: full` warns;
  - a changed ID-prefix block fails;
  - a missing glossary fails.
- **T7 Approval:**
  - on `standard`, one decision writes two signed events, one per file's bytes;
  - a brief with an open question blocks the pair;
  - a changed brief makes both stale only where its own hash changed;
  - on `full`, a PRD whose brief isn't approved is refused;
  - an `[ASSUMPTION]` tag outside the list blocks approval.
- **T8 `mirai show <initiative>`:**
  - lists both documents with their states and full paths;
  - an argument that's both a ticket and an initiative asks for `--docs`;
  - an unknown name says what it looked for.

## Probes (real)

- **P1 Your read:** you read the example PRD (due dates, lite) as its approver, from its summary
  first, then the requirements, about 10 minutes. **Pass when you say:**
  - from the summary alone you knew what you were approving, for both documents, and what to
    decide;
  - nothing in the requirements was unclear, and the glossary answered any ID or term you
    didn't know;
  - the detail looks enough for an agent to cut tickets and build without guessing.

  Anything you flag is fixed and you read it again.
- **P2 An agent fills it:** a fresh Sonnet agent gets only the template, the checklist, P2's
  approved brief from 31 (task comments) and a one-paragraph note of your answers to that
  brief's decisions. It writes the PRD, as in 31's P2. **Pass when:**
  - it lints clean after at most one round of fixing the lint's messages;
  - it has a real Failures group, not `None`;
  - every brief BR is served;
  - its summary passes your read as in P1.
- **P3 An agent builds from it:** a second fresh agent gets only P2's PRD and lists the tickets
  it would cut and the questions it would have to ask. **Pass when** it asks no question the PRD
  should have answered. Each one it does ask goes back into the template or the checklist.
  **Changed by Jet, 2026-11-20 ("P3 as recommended"), after two rounds:** pass when it asks no
  question that changes what is built or who may do what; questions a builder can settle in the
  plan don't count. A second fresh agent sorts the questions, and Jet sees the list. One last
  round; anything of the first kind left over becomes a template finding and a known limit.

## Done when

- T1–T8 pass, and the full suite passes through the build runner and CI.
- P1, P2 and P3 pass.
- The roadmap row's done-when holds:
  - FR, NFR and AC ID rules are linted;
  - an NFR without a verification method is flagged;
  - a PRD whose top part is missing or over its word budget fails the lint.
