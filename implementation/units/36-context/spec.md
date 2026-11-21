---
unit: "36"
name: context
status: approved (Jet, 2026-11-20: "approve 36"; decisions 1–7 from his interview answers the same day)
roadmap: design/07-implementation-roadmap.md, row 36; design/01 setup steps 3a, 4 and 6, §10; D-41, D-43, D-44 (design/04); 08 Q4, Q6; R2-M11
depends_on: ["31", "34"]
---

# Unit 36: The context file templates

## Why

Every agent run loads the project's context: what the business is, which flows must never break,
what the screens are, how each service runs, and the rules its code follows. Today none of these
files exists. The sample app and Thudos have only `agents-local.md`. Without business context,
PRDs come out generic and reviewers can't judge whether a feature makes sense (D-43).

This unit defines the five context files: their templates, checklists, examples, lints and which
of them you approve. Setup (39) fills them in for a project; this unit defines what "filled in
well" means.

**Why now:** setup (39) writes them, and Nora (44) and Tess (42) read them.

## Decisions (Jet, 2026-11-20, interview)

1. **You approve a whole file, not a summary** (Q1, "A"). `business.md`, `journeys.md` and each
   conventions file are short, and agents read all of them. They have no summary for approval and
   no reader test. The approval is signed, like a brief's, and goes stale when the file changes.
2. **Every claim carries a source ID** (Q2, "A"). Each bullet in `business.md` ends with `(S-n)`.
   A `## Sources` table at the bottom lists each ID once: what it is, the link or file, and when
   it was read, or "you said" with the date. The lint fails a bullet with no ID and an ID the
   table doesn't define.
3. **`business.md` is about two pages** (Q3, "A"). The lint warns past 800 words and fails past
   1,000, the Sources table not counted. `[docs.limits] business_words` and
   `business_warn_words` change both (project layer). Detail stays in the linked sources.
4. **Journeys and screens are two files** (Q4, "B"):
   - `journeys.md`: the critical journeys `J-n`, each with its steps, why it's critical, its
     source and its E2E test. You approve it.
   - `feature-map.md`: screens, routes and stable handles. It isn't approved. The lint checks
     that each handle exists in the code. Agents update it with their tickets.
5. **Facts and rules are two files per service** (Q5, "A"):
   - `project-<service>.md`: the stack, run commands, layout and test levels. It isn't approved.
     The lint checks each path and command.
   - `conventions-<service>.md`: the rules. You approve it. A rule a check enforces is one line,
     `enforced by <check>`, and the check must exist in the config. A `judgment` rule is a short
     sentence with an example.
6. **The examples are the sample app's; the real check is Thudos** (Q6, "A"). The committed
   examples describe `mirai-sample-app` (a backend and a frontend service), whose code lets the
   lint check paths and handles. In P2 a fresh agent writes all five files for Thudos from its
   sources, and you judge `business.md` and `journeys.md`. The Thudos files aren't committed.
7. **The format is researched first** (Jet's standing rule: each document's format and template
   are researched in depth in its own unit). The research covers what good business context,
   critical-journey lists, screen maps and service conventions hold, from the best sources, and
   ends with what this unit takes.
8. **What no source says is a question to you** (Jet, 2026-11-21, after P2 on Thudos: "If any
   context is missing from the data should be a question to the user to fill"). A claim no
   source says yet ends with `(open)` in place of its source ID, such as `- Who pays: not known
   yet (open)`, in `business.md` and on a journey's "Why critical:" line. The lint warns and
   names it as the question to ask you; your answer becomes a `you said` source with its date.
   `mirai approve` refuses a file with an open line. Setup (39) asks you each one.

## Scope

**In**

1. **Research: `research/15-context-files.md`.** For each of the five files: the best sources
   (agent context files such as `AGENTS.md` and `CLAUDE.md` conventions, business-context and
   product one-pagers, critical user journey practice, test-handle conventions, engineering
   conventions docs), cited with licenses, and what MIRAI takes. Wording follows `mirai-write`.
2. **The five document types** in `registry/document-types/`, each with a template, a checklist
   and an example under `examples/context/` written for `mirai-sample-app`:
   - **`business`** (`.mirai/context/business.md`): sections as D-43:
     - what the product does;
     - who it's for (users, customers, who pays);
     - business model and goals/KPIs;
     - what this project or repo is responsible for and what it isn't (one line per repo in a
       workspace);
     - key business rules;
     - glossary;
     - constraints (legal, markets, languages);
     - stakeholders (optional);
     - Sources.
   - **`journeys`** (`.mirai/context/journeys.md`): each `### J-n: <name>` with:
     - its steps, naming screens from the feature map;
     - why it's critical (users or money lost if it breaks), with a source ID;
     - its E2E test file, or `none yet`;
     - and a Sources table.
   - **`feature-map`** (`.mirai/context/feature-map.md`): one row per screen: name, route, and
     its stable handles (`data-testid`, ARIA role and name).
   - **`project`** (`.mirai/context/project-<service>.md`): stack and versions, run and test
     commands, folder layout, test levels, where the service's own instructions are.
   - **`conventions`** (`.mirai/context/conventions-<service>.md`): rules, each one bullet
     tagged `enforced by <check>` or `judgment`, a judgment rule with a short example.
3. **The lints** (`src/lint/context.js`), each naming the line and the fix:
   - `business`: a bullet with no `(S-n)`; an `S-n` not in the table; a table row no bullet uses
     (warning); a source row with no link, file or "you said" date; past 800 words (warning) and
     1,000 (fail); a missing required section;
   - `journeys`: a journey with no `J-n` ID; a gap or repeat in the IDs; a journey with no steps,
     no "why critical" line or no source; an E2E path that doesn't exist (`none yet` passes); a
     screen in a step that isn't in the feature map (warning);
   - `feature-map`: a handle not found in the service's source files; a route not found (warning,
     since routes can be built at run time);
   - `project`: a path that doesn't exist; a command whose script isn't in `package.json` (or the
     stack's equivalent, as 17a detects it);
   - `conventions`: a rule with no tag; `enforced by <check>` naming a check not in the config's
     named checks; a `judgment` rule with no example (warning); a rule that repeats an enforced
     check as prose (warning, when the text names the check's tool).
   - The lint runs on `.mirai/context/` through `mirai lint`, like the documents.
4. **Approval:** `mirai approve --file .mirai/context/<file>.md` for `business`, `journeys` and
   `conventions`:
   - it refuses while the file doesn't lint clean, listing the problems;
   - it shows the file's path and hash and writes one signed line, `kind: context`, with the
     file's type;
   - a changed file is stale; `mirai show context` lists the five kinds of file with their state
     (approved, changed since approval, not approved, or "checked, not approved") and full path;
   - `feature-map` and `project` files are refused with the reason: they're checked against the
     code, not approved.
5. **`mirai doctor`:** reports `business.md`'s age (yellow past 180 days since its last
   approval), and a stale approval of any context file.
6. **Config:** `[docs.limits] business_words` and `business_warn_words` (project layer, in
   range).
7. **Docs:** `docs/context.md` (new): the five files, which ones you approve, what the lint
   checks, the limits; one line in `docs/documents.md` pointing to it.

**Out**

- Setup asking you and filling the files for a project (39).
- Nora proposing `business.md` updates at intake (44).
- The verify skill (39).
- Writing E2E tests for journeys (Tess, 42).
- Per-project template overlays (37).
- Committing the Thudos files (they stay a check until setup).

## Tests

- **T1** Each type: the template, left as it is, fails as leftover text only; the example lints
  clean against the sample app's code, with no warning; the checklist exists.
- **T2** `business`: a bullet with no source fails; `S-9` not in the table fails; an unused source
  warns; a "you said" row with no date fails; 850 words warns, 1,050 fails, the Sources table
  not counted; `business_words = 1200` moves the cap; the config refuses out-of-range values and
  the keys in a personal file.
- **T3** `journeys`: a journey with no `J-n` fails (the roadmap's done-when); `J-1`, `J-3` fails;
  a missing "why critical" fails; an E2E path that doesn't exist fails, `none yet` passes; a
  step naming an unknown screen warns.
- **T4** `feature-map` and `project`: a `data-testid` not in the code fails; a path that doesn't
  exist fails; `npm run nope` fails; the examples pass against the sample app's fixture copy.
- **T5** `conventions`: an untagged rule fails; `enforced by eslint-x` with no such named check
  fails; a judgment rule with no example warns.
- **T6** Approval, through the CLI with a signed key: `business.md` with a lint problem is
  refused, nothing written; a clean one writes one `kind: context` line; a changed file is stale;
  `feature-map.md` is refused with its reason; `mirai show context` lists every file's state and
  path.
- **T7** `mirai doctor`: `business.md` approved 200 days ago is yellow; a stale context approval
  shows.

## Probes (real)

- **P1 Your read:** you read the sample app's five example files, about 10 minutes. **Pass when**
  each is clear, short, and something you'd want an agent to load on every run.
- **P2 Thudos:** a fresh agent gets the templates, checklists and Thudos's sources
  (`.mirai/context/sources/` and the repo), and writes all five files in a scratch copy.
  **Pass when:**
  - every file lints clean after at most one fixing round;
  - you recognise your product in `business.md`: no claim you'd call wrong, and nothing
    important missing;
  - `journeys.md` lists the flows you'd call critical, and none you wouldn't.

## Done when

- T1–T7 pass, and the full suite passes through the build runner and CI.
- P1 and P2 pass.
- The roadmap row's done-when holds: a `business.md` claim without a source, or one over the size
  cap, is flagged; journeys without IDs are flagged.
