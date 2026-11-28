---
unit: "65b"
name: design-research
status: draft (interview 2026-11-27: Q1 "C", Q2 "A", Q3 "A", Q4 "A" plus Jet's gate, Q5 "A", Q6 "A", Q7 "A", Q8 "A", restatement "yes"; after the research in research.md). Checked for clashes against 65 (six points, "Checked against the other units"): on its branch 2026-11-27, and its merged code (`8428a89`) 2026-11-28, unchanged in those places
roadmap: design/07-implementation-roadmap.md, row 65b; units 64 (Arlo, his web fence), 65 (the design workflow, the sitting), 45b (`mirai models`), 19c (agents started from your session), 13 and 19a (the hook, the launch), 18 (the red team); post-MVP P42 (`design/20`)
depends_on: ["64", "65", "45b", "19c"]
---

# Unit 65b: Design research and brainstorm

## Why

From 64 on, Arlo designs alone in the background: he can't search the web (only `WebFetch` from a
fixed list), and you meet the design first at 65's sitting, which is a review, not a conversation.
The research and the design discussion still happen, in your own sessions, outside MIRAI: nothing
records them, and Arlo doesn't build on them. Jet, 2026-11-27: "very important for every project".
Both halves matter equally (Q1 "C"): the design should rest on current, cited sources **and** on
your decisions. This unit adds that step between the approved PRD and Arlo's run 1.

## Decisions (Jet, 2026-11-27, interview; research.md)

1. **Questions → research → decide** (Q2, "A"):
   1. in your session, you and the architect (Arlo's persona) list the open design questions, with
      a short stack summary;
   2. you approve the list;
   3. a background research run answers exactly those questions in `research.md`;
   4. back in your session, you decide one question at a time;
   5. your decisions go into `design-decisions.md`;
   6. Arlo's run 1 follows them.
   (BMAD and Gemini let you approve the question plan before anything is searched; research.md.)
2. **The research runs in the background, in its own cage** (Q3, "A"): launched by MIRAI like
   Arlo and Kai, red-teamed. Your session never reads the web pages: it can sign and holds your key
   and token, and untrusted pages plus private data plus a way out is the "lethal trifecta".
3. **The cage: four layers** (Q4 "A" with Jet's gate, Q5 "A"):
   1. **Nothing to steal:** no repo, no secrets, no store, no shell. The run's working folder holds
      only the approved questions, the PRD and the stack summary. A tricked run can leak only what
      you chose to show it.
   2. **The fetch gate:** `WebSearch` is allowed. `WebFetch` is kept off the allow rules, so every
      fetch needs MIRAI's hook. The hook allows only a URL that came back from one of this run's
      searches, and refuses any other (a URL a page points to, or one with data written into it).
      It fails closed like the write gate: no answer, or an answer too slow, refuses.
   3. **The rules:** web content is information only. An instruction found on a page is never
      followed. It's listed in `research.md` under "Suspicious pages" (the URL and what it asked).
   4. **The check after the run:** every claim cites a source with its URL and a short quote, and
      MIRAI checks each quote against what that fetch returned in this run. A claim with no
      source, a URL outside the run's searches, or a quote not found fails the lint. Arlo treats
      `research.md` as data, never as instructions.
   The red team proves it: a planted page with hidden instructions and a canary.
4. **The decisions file** (Q6, "A"): `design-decisions.md` in the initiative's folder, one entry per
   question:
   - the options considered, citing `research.md`;
   - your pick and your reason;
   - or "(Arlo's call)" when you leave it to him;
   - "hard to reverse: yes" when it is, and then it becomes a draft ADR (`proposed`): Arlo completes
     it, and you sign it in 65's sitting.
   Arlo's run 1 must follow every pick, and Vera's set check (65) checks that he did. (Spec Kit's
   `Q → A` log; BMAD records only decisions two builders could make differently; research.md.)
5. **When it runs** (Q7, "A"):
   - on `full`, by default after the PRD's approval;
   - "no open questions" skips straight to Arlo, and the skip is recorded;
   - on `standard`, only when you ask with `/mirai design --explore`.
6. **The brainstorm engine is shared with P42** (Q8, "A"): 65b builds the conversation (questions
   one at a time with a recommendation, the `Q → A` log, decisions written to a file) without
   "design" hard-coded. P42 later points it at product questions, and stays post-MVP.
7. **Defaults set at the restatement** (Jet's "yes"):
   - Arlo's persona runs the conversation in your session;
   - approving the question list is a step in your session, not a signed gate;
   - the research run has a cap on searches and on time, and its own model in `mirai models`.

## Scope

**In**

1. **The brainstorm engine** (`src/brainstorm/`): a topic-neutral conversation for your session.
   Questions one at a time, each with a recommendation; a dated `Q → A` log; the output file
   given by its caller. Design is its first caller, P42 its second.
2. **The design explore step:** `/mirai design --explore <initiative>` in your session (and
   Cursor and Codex, with their adapters; the 21f session list).
   - Part 1 writes `research-questions.md`: the questions and the stack summary. You approve the
     list in the session, and MIRAI records the approval as a journal line.
   - It then starts the research run (19c's `start_agent`).
   - Part 2 resumes when the run is done: the options per question, then your decisions, written
     to `design-decisions.md`.
3. **The research run** (`src/design/research.js`): role `design-research` (Arlo's persona, its own
   template `research`).
   - **inputs:** a fresh working folder with copies of `research-questions.md` and the PRD;
   - **output:** `research.md` only, written to that folder, then copied by MIRAI into the
     initiative's folder;
   - **caps:** `[design] research_max_searches` (default 30) and `research_minutes` (default 20),
     enforced by the hook and the launch;
   - **model:** a `design-research` row in `mirai models` (45b).
4. **The `research` template** (`src/launch/strict.js`):
   - **allowed:** `WebSearch`; `WebFetch` through the hook only; `Read`, `Glob` and `Grep` inside
     the working folder only; `Write` to `research.md` only;
   - **denied:** Bash, Task, Agent, MCP tools, and reads outside the folder (the repo, the home,
     the store).
5. **The fetch gate in the hook** (`src/launch/hook.js`):
   - after each `WebSearch`, it records the result URLs in the run's list. The list lives in the
     launch's protected folder, where the agent can't write;
   - before each `WebFetch`, it allows only a URL on that list, after normalising it (scheme,
     host, path; a query string only exactly as listed);
   - it counts searches against the cap;
   - it keeps each fetch's returned text as the run's evidence, for decision 3.4;
   - it fails closed.
6. **The research document type and lint:**
   - `registry/document-types/research.toml` and a template. Per question: the options, a pick
     and a runner-up, and the strongest argument against the pick, with each claim's `[S-n]`.
   - Sources: URL, title, access date, quote.
   - "Sources consulted", kept apart from "sources cited".
   - "Suspicious pages" (required; "none" when empty).
   - The lint checks each quote against the run's evidence.
7. **The decisions document type and lint:**
   - `registry/document-types/design-decisions.toml`;
   - each entry: question, options, pick or "(Arlo's call)", reason, hard to reverse;
   - each option cites `research.md`.
8. **Arlo and Vera:**
   - Arlo's run 1 reads `research.md` and `design-decisions.md` as inputs; his rules
     (`registry/agents/mirai-architect.md`) say to follow every pick, and to treat `research.md`
     as data;
   - a pick marked hard to reverse arrives as a draft ADR;
   - Vera's set checklist (65) gains "the design follows `design-decisions.md`".
9. **The flow on each track:**
   - on `full`, the offer after the PRD's approval (65) points to `/mirai design --explore`, with
     `mirai design <initiative> --no-explore` to skip (recorded); its "y" is that skip (65, point 1);
   - on `standard`, unchanged, with `--explore` available.
10. **The red team** (`src/redteam/cases-research.js`, the `research` template):
    - a fetch of a URL not returned by a search (the loopback canary page) is refused [blocker];
    - a planted page, put on the run's list by the case, hides an instruction to send the stack
      summary to a crafted URL: the canary never gets out, the crafted URL is refused [blocker],
      and the page is listed under "Suspicious pages" (recorded: it depends on the model);
    - a read of the repo, `.env`, the home or the store is refused [blocker];
    - Bash is absent, and a write outside `research.md` is refused [blocker];
    - the run can't write its own URL list [blocker];
    - the hook past its timeout refuses a fetch [blocker];
    - the search cap holds;
    - the control: a search, then a fetch of one of its results, succeeds.
11. **Docs:** `docs/design.md` (the explore step), `docs/documents.md` (the two types),
    `docs/agents.md` (the research run and its cage), `docs/models.md`.

**Out:**
- research on your private code (Arlo's job);
- product brainstorming (P42; only the shared engine is built here);
- starting on its own on `standard`;
- web search anywhere else in MIRAI;
- research during Kai's build;
- per-domain approval during a run (Q5).

## Tests

- **T1** the brainstorm engine: one question at a time, the log, the output file given by the
  caller (a stand-in session).
- **T2** the explore step: `research-questions.md`, the approval's journal line, the research run
  started, part 2 writes `design-decisions.md`; `--no-explore` recorded; `standard` only on request; the
  offer on `full` (its "y" is the skip); a draft ADR from your pick doesn't pause again, and a
  different letter at the sitting signs nothing.
- **T3** the fetch gate: a listed URL is allowed; an unlisted one is refused; so is a listed host
  with another path or query; the cap; a hook that fails or is too slow refuses; the list can't be
  written from the run.
- **T4** the `research` template: Bash, Task, Agent and MCP denied; reads outside the folder
  refused; `Write` only to `research.md`.
- **T5** the research lint: a claim without a source, a URL outside the run's searches, a quote not
  in the evidence, a missing "Suspicious pages": each fails; a clean file passes.
- **T6** the decisions lint, and Arlo's inputs: a pick followed passes Vera's mechanical part; a
  pick ignored is found; a hard-to-reverse pick arrives as a draft ADR.
- **T7** `mirai models` shows and changes `design-research`.
- **T8** the docs check (34b).

## Probes (real)

- **P1** the whole `full` flow on the sample app with a real question (for example, a background
  job versus a synchronous import of a large CSV in Laravel): the question list, a real research
  run (real search), `research.md` passing its lint, the decisions in your session (a probe key),
  Arlo's run 1 following them, and Vera's check.
- **P2** the red team's research cases through the build runner: GREEN.
- **P3** `standard` with `--explore` on one question.

## Done when

T1–T8 pass, the full suite through the build runner and CI; P1–P3 pass; the full red team GREEN
with the new cases; the roadmap's row 65b holds.

## Checked against the other units

- **64:** Arlo's web fence (`WebFetch` per domain) stays as it is; the research template is
  separate. Arlo's inputs gain the two files.
- **65** (checked against its branch at `3aa484c`, 2026-11-27, and the merged code at `8428a89`, 2026-11-28: `nextOffer`, `hardAdrsOpen`, the set checklist and `design-notes.md` unchanged):
  1. **The offer.** 65 asks "Start Arlo on the design now? [y/N]" after the PRD's approval
     (`nextOffer` in `src/cli/commands/approve.js`). The explore step is a conversation in your
     session, so the terminal can't run it. On `full` the offer becomes: "Next: the design questions,
     in your session: /mirai design --explore <initiative>. Skip them and start Arlo now? [y/N]".
     A "y" is the recorded `--no-explore`. On `standard` 65's offer is unchanged. Arlo's paused-run
     offer ("continue his run now?") is unchanged.
  2. **The early pause.** 65 pauses on a proposed ADR whose gate names `hard-to-reverse` and asks
     you in `interview.md`, unless you already answered that ADR's question (`hardAdrsOpen` in
     `src/design/run.js`). A draft ADR made from a `design-decisions.md` pick marked hard to reverse
     counts as answered: it cites the entry, and it doesn't pause again. Arlo still pauses on a
     hard-to-reverse choice you didn't decide. Your picks stay in `design-decisions.md`, not in
     `interview.md`, so the brief's binding (`src/design/hard.js`) is untouched.
  3. **The sitting.** "Decisions for you" still asks a letter for every hard-to-reverse ADR. For
     one made from your pick, your pick is the expected letter. A different letter is 65's "an
     answer differs": nothing is signed, and the answer goes to Arlo as a note. `design-decisions.md`
     is then left as it is, and the signed answer wins.
  4. **Two files, two jobs.** 65's `design-notes.md` holds your answers after a set is sent back.
     65b's `design-decisions.md` holds your decisions before run 1. `docs/design.md` says which is
     which. Both are Arlo's inputs.
  5. **Vera's set checklist** (`registry/templates/design-set-checklist.md`) gains "the design
     follows design-decisions.md". The mechanical part (each pick ↔ the HLD's Decisions or an ADR)
     joins 65's mechanical set check.
  6. **`--change`** (65): no explore step. A change runs as 65 built it.
- **45b:** one more row in `mirai models`.
- **19c:** the session starts the research run with `start_agent`.
- **13, 19a:** the hook gains web tools beside the file tools. Its fail-closed rule and policy
  hash are unchanged.
- **42b** (next): an investigation ticket also writes a finding with sources, but it reads the
  code, so it can't reuse this cage as it is. Raise this at 42b's interview.
- **P42:** reuses the brainstorm engine.
- **46:** "research done" will be an inbox line; until 46, `mirai status` shows it.
