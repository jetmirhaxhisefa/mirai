---
unit: "45"
name: tickets-workflow
status: approved (Jet, 2026-11-24: "approve 45"; interview 2026-11-24: Q1 "the approval asks; tickets are their own command and workflow", Q2 "A", Q3 "A", Q4 "yes", Q5 "yes", restatement "yes"; spec Q1 "A")
roadmap: design/07-implementation-roadmap.md, row 45 (and notes on rows 61–65, a new row 62b, a new row "talk to an agent directly"); design/01 §5 (tickets), §12a (release modes), §16 (gates); design/02 (gates by track, U4; the docs MR, V3, D-56); design/13 §2 ("Ticket decisions"), §3; units 33 (epic approval), 38 (`mirai docs merge`), 40 (Vera), 42 (Tess), 43 (trace), 44 (`/mirai-new`, the quick request)
depends_on: ["33", "38", "40", "42", "43", "44"]
---

# Unit 45: The `mirai-tickets` workflow

## Why

Tess (42) cuts a ticket set when you start her, and `mirai approve <epic>` (33) approves the whole
set or none of it. Nothing yet joins the steps from approved documents to an approved, merged
ticket set: the offer to start her, the changes you make to a set before you sign it, the release
mode, the logged reasons, trace, and MIRAI merging the docs MR. And the quick track (one ticket,
two actions) isn't wired end to end.

**Why now:** the build loop and the night run (55) start from approved ticket sets; design/13 §2
needs your ticket decisions logged to judge whether Tess cuts well (PM-05).

## Decisions (Jet, 2026-11-24, interview)

1. **Tickets are their own command and workflow** (Q1). `/mirai tickets <initiative>` (`mirai
   tickets` in a terminal) is the workflow's entry. When the last upstream document the track needs
   is approved, that approval **asks** whether to start Tess now: yes starts her run; no ends with
   the command to start her later. It never starts her without asking. *Why (Jet):* after the PRD
   come the technical documents, and tickets are based on them too.
2. **Each track names the documents tickets need** (Q2, "A"):
   - **`quick`:** none; one ticket by hand (42's decision 2);
   - **`standard`:** the approved PRD **and a short technical note** (the components touched, data
     changes, the API shape; ADRs only for real decisions);
   - **`full`:** the approved PRD, HLD, ADRs and LLD.
3. **45 is built now; the design documents come right after it** (Q3, "A", revised after Jet asked
   to re-think the first recommendation). The needed documents are a list per track (data, not
   code), so a document type plugs in when its unit lands, with no rework of 45. Until a type
   exists, Tess cuts from what's there and the approval screen says what's missing ("no technical
   note yet: unit 62b"). The design units (61–65) and the new technical-note type (62b) move to
   right after 45 in the build order, ahead of 46–60.
4. **You change the set at the approval, per ticket** (Q4, "yes"): **keep** (the default),
   **drop** (a one-line reason; MIRAI removes the ticket, re-renders the epic and re-runs the
   coverage check so a dropped ticket can't leave an AC uncovered without you seeing it), or
   **change** (merge, split, fix: you type what you want; nothing is signed; Tess runs again with
   your notes, Vera checks, and you approve the new set). Every drop and change is logged with your
   reason (design/13 §2, "Ticket decisions"). When every ticket is "keep", you sign once.
5. **Tess proposes the release mode, you set it** (Q5, "yes"): the epic carries `release:
   per-ticket` (default) or `together` with a one-line reason ("together: the old and new checkout
   can't run side by side"). The approval screen shows it and lets you switch it; it's signed with
   the set and logged.

## Scope

**In**

1. **The offer after the last upstream approval.** `mirai approve` of a document that completes
   the track's list (decision 2) ends with "Start Tess (mirai-ticket-planner) on the ticket set
   now? [y/N]"; `y` starts `mirai tickets <initiative>` in that terminal; `N` (the default) prints
   the command. An approval that doesn't complete the list says what's still needed. Through your
   session, the approval's answer names `/mirai tickets <initiative>`.
2. **The required documents per track:** `[tickets.inputs]` defaults in MIRAI (`standard = ["prd",
   "tech-note"]`, `full = ["prd", "hld", "adr", "lld"]`), project-overridable only to *add* types.
   `mirai tickets` refuses while a required document of an existing type isn't approved as it is
   now (naming it and its approval command); a required type MIRAI doesn't have yet is skipped with
   a warning that names its unit, shown in Tess's run line and at approval.
3. **The approval screen of a set** (`mirai approve <epic> --file …`, 33's, extended):
   - the epic, its coverage, trace's document result (43), Vera's result, the release mode and its
     reason, then one line per ticket (key, type, priority, order, blocks, size, title);
   - per ticket: `k` keep, `d` drop (reason required, one line), `c` change (note required);
   - **drops only:** MIRAI removes the dropped tickets' files, fixes `after` links that pointed to
     them (refused, naming both, if a kept ticket depends on a dropped one: change it instead),
     re-renders the epic, re-lints and re-checks coverage, shows the result, and asks again;
     Vera's result for the changed set is needed again only if coverage changed;
   - **any change:** nothing is signed; the notes go to `docs/mirai/<initiative>/ticket-notes.md`
     (a new document type: one entry per ticket, your note, the date) and Tess's next run gets
     them; the screen ends with `/mirai tickets <initiative>`;
   - **release mode:** `r` switches it; you're asked for a one-line reason if you change Tess's;
   - **sign:** when all are "keep": one signed line over the epic and every ticket (33's), the
     release mode inside it.
4. **The log:** a `ticket_decision` journal line per drop and change (`ticket`, `decision`
   `drop|merge|split|change`, `reason`, the epic, the set's round), and `release_mode` on the
   approval line; `mirai show <initiative>` lists them; design/13 §2's row is these lines.
5. **After the signature:** trace's document scope runs (43) and must be clean (it already runs at
   the epic's approval: a failing trace refuses the signature, naming the gap); then MIRAI calls
   38's docs merge function (`mirai docs merge <initiative>`). If the host still has the MR
   waiting (checks, a required reviewer), it says what for and `mirai docs merge` tries again.
   Then the tracker publish (38) where a tracker is set, using each type's `tracker_type` (42).
6. **The quick track end to end:** `/mirai-new` with a `quick` answer (44) → 42's one-ticket path
   → your approval of the ticket (the lint, Vera, your signature) → MIRAI's build → your merge of
   its code MR. The plan gate is `auto` for a normal-risk quick ticket (U4); a high-risk one waits
   for you. Two human actions, counted in a test.
7. **Docs:** `docs/tickets.md` gains "From approved documents to an approved set" and the screen's
   keys; `docs/documents.md` the `ticket-notes` type; any new key in `docs/config.md`; `/mirai
   tickets` already on the session list (42).

**Out**

- Writing the technical note or the design documents (61–65, 62b, Arlo).
- The inbox and batch approvals (46); the night run's pick (55).
- MIRAI merging code, ever (V3: the docs MR is the only merge MIRAI performs).
- Talking to an agent directly outside a workflow (a new roadmap row, to interview).

## Tests

- **T1 The offer:** approving the PRD on `standard` with no technical-note type yet asks "Start
  Tess …? [y/N]" with the warning naming 62b; `N` prints the command, starts nothing; `y` starts
  the run (fake launcher). On `full` with an approved PRD and no design types, the same.
- **T2 Required documents:** with a fake `tech-note` type registered and its document unapproved,
  `mirai tickets` refuses, naming it and its approval command; approved, it starts.
- **T3 Drop:** dropping one of five tickets with a reason removes its file, re-renders the epic,
  re-runs coverage; a dropped ticket that leaves AC-3 uncovered is shown before you can sign; a
  kept ticket with `after` on the dropped one is refused, naming both. A drop without a reason is
  refused.
- **T4 Change:** a "split" note writes `ticket-notes.md`, signs nothing, logs `ticket_decision`,
  and Tess's next run (fake) gets the notes as an input.
- **T5 Release mode:** Tess's `together` with its reason is shown; switching it asks a reason; the
  signed line carries the mode; `mirai show` lists it.
- **T6 Sign and merge:** all "keep" → one signed line; trace clean; the docs merge function is
  called once with the branch head (fake host); a waiting MR is reported, not retried in a loop.
  A failing trace refuses the signature.
- **T7 Quick track:** a quick request to a merged code MR needs exactly two human actions (approve
  the ticket, merge its MR); the plan gate is auto for normal risk, human for high.
- **T8 The docs check** (34b) passes with the new keys and the `ticket-notes` type.

## Probes (real)

- **P1 PRD to merged set** on the sample app (standard, no technical-note type yet): approve the
  PRD, answer `y`, Tess cuts (through `--probe loop`), you drop one ticket and change one, Tess
  runs again, you sign; the docs MR is merged by MIRAI. **Pass when** every step happened with one
  command or key from you, each decision is in `mirai show`, and the merged MR has documents only.
- **P2 Quick ticket:** `/mirai-new` → quick → one ticket → approved → built → you merge. **Pass
  when** you counted two actions.

## Done when

- T1–T8 pass, and the full suite passes through the build runner and CI.
- P1 and P2 pass.
- The roadmap row's done-when holds: approved PRD → approved ticket set, trace clean, docs MR
  merged by the orchestrator; a quick ticket needs two human actions in total; a dropped ticket's
  reason is in the log.

## Checked against the queued units

- **33:** the epic approval gains the per-ticket screen; one signed line as before.
- **38:** the docs merge and tracker publish are 38's functions, called here.
- **40:** Vera checks a changed set again; an unchanged one after drops only if coverage changed.
- **42 (as built, PR #123):** `mirai tickets`, `--one`, `fix`; this unit adds the offer, the
  inputs list, `ticket-notes.md` as her input, and the screen. Her `release` proposal is new to her
  prompt and the epic template (a protected field, read by `approval`).
- **43:** trace's document scope runs at this approval (already its trigger).
- **44:** `/mirai-new`'s quick answer is the entry to decision 2's quick track.
- **45b, 46, 55:** unchanged; 46's inbox can list `ticket_decision` lines later.
- **61–65, 62b (moved after 45):** each adds its type to `[tickets.inputs]`; 65's "→
  `mirai-tickets`" is decision 1's offer.

## Questions for Jet (answered)

1. **Where 45b goes: A** (Jet, 2026-11-24): 45 → 45b → 61–65 + 62b → 46.

## Re-checked against 42 as built (merged, PR #123) and 43 as built (PR #127, not merged yet: re-check again if 43 changes before its merge) (2026-11-25)

- **Trace runs before the signature, not after** (43 as built; 43's Q1 "A"): trace's documents
  scope runs between Tess's launches (a missing link goes to her next launch through `lint.json`)
  and again at `mirai approve <epic>`, after the lint and before you sign; a fail refuses the
  signature. Scope 5's "After the signature: trace's document scope runs" is corrected: **before**
  the signature, as T6 already tests ("a failing trace refuses the signature"). After the
  signature come only the docs merge and the tracker publish.
- **Drops and trace:** after a drop, the re-render and re-lint (Scope 3) also re-run trace, so the
  screen shows a link the drop broke (an AC no ticket covers now, an NFR whose only covering
  ticket was dropped through `covers_fr`) before you can sign.
- **Retired IDs** (43's Q1 "A"): a ticket dropped at the set's approval was never approved, so its
  key isn't retired and ID stability doesn't apply. A ticket of an **approved** set that's later
  removed keeps its key reserved (43's ID stability; tickets have no `Retired` line: the key is
  simply never reused). Tess's prompt says so: never reuse a dropped key in the next round.
- **Vera's open must-fix at the screen** (42's P1/P4 auto runs: a set can end done with 1 must-fix
  open after 3 rounds): the screen shows it as today's approval does (40); you may still sign, and
  the open count is in the signed line (`verifierField`, already built). No new rule.
- **The release mode in the epic** (42's P4 auto: Vera flagged that the summary didn't name it):
  `release` is a protected field of the epic template (Scope's 42 note); the epic's summary names
  it in one line, so Vera stops flagging it. The epic template goes to v3 (42 made it v2).
- **`mirai tickets` from a Tess pause** (42's decision: the PRD takes the answer first; Nora's
  continue step; Tess refuses to cut while the PRD is behind an answer): the answered PRD must be
  approved again before Tess runs; that re-approval completes the track's list again, so Scope
  1's offer would be shown again. See question 1.
- **The quick track** (Scope 6, 44's re-check): `/mirai-new` never proposes `quick` for a request
  its intake found unclear, and 42's "too unclear" outcome from `/mirai-new` offers `standard`, so
  P2 can't ping-pong. No change here.
- **Lone tickets and investigations** (42's decisions 2, 6–7): the quick track's ticket is a lone
  ticket (`docs/mirai/tickets/<KEY>.md`, no epic): no set screen, no docs MR of a set; 43's code
  scope applies at ship. An `investigation` lone ticket has no build or code MR (42b): T7's "two
  actions" is for a change ticket.

**Question for Jet (from this re-check; answered 2026-11-25, "A"):**

1. **The offer after a Tess pause** (answered **A**: the re-approval asks "Tess paused on Q-8 for
   this; continue her run now? [Y/n]", default yes; add a test T1b for it). Tess paused on the PRD; Nora took your answer; you approve
   the PRD again. A: the offer still asks, worded "Tess paused on Q-8 for this; continue her run
   now? [Y/n]" (default yes, since you started her already); B: her run continues by itself after
   the re-approval (no question); C: the same offer as the first time ("Start Tess …? [y/N]").
   Recommendation: **A**: decision 1's "never without asking" holds, and the default matches what
   you already chose.

