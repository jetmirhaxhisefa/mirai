# Round 2 review: Product Manager lens

Reviewer: independent PM reviewer, round 2.
Read in full: `design/00`, `01`, `02`, `03`, `04`, `05`, `06`, `07`, `08`, `_review/round-1-pm.md`,
`research/09-claude-blocking-rules.md`.
Lens: does the design deliver the goals in `00` with the least ceremony? Is the milestone order
right, and does first value come early enough? Has scope crept after round 1 and `08`? How much
work lands on the human? Is it clear and consistent, are the success and kill criteria usable,
were the round-1 PM findings fixed, and are the `08` agreements reflected in `01`/`03`/`04`/`07`?

## Summary

**1 Critical, 8 Major, 10 Minor.**

The design got clearly better since round 1. The walking skeleton, the loop guard right after the
launcher, the safety units before any agent runs, and the "results stay local" rule (Q9) all fix
real round-1 problems. What's left is mostly a **sequencing and measurement** problem, not a
design problem.

**Top 3 concerns:**
1. **PM2-1 (Critical): nobody knows when MIRAI first touches a real project.** `07` says the pilot
   comes "after the structure is built", but the milestone exits, the calibration run, the success
   criteria and the kill trigger all assume real pilot tickets from Milestone A on. As written,
   the kill gate can't fire before Milestone D, and the first real value could come at unit 68.
2. **PM2-2 / PM2-3 (Major): Milestone A has grown to 26 units but still lacks parts R-C6 promised.**
   About 7 units' worth of follow-up refinements landed in A, while the minimal run report, a
   setup path, `mirai session`, the `pre-commit` hook and a working `doctor` are missing or sit
   in B. The first MR comes later than it needs to, and A's exit can't be checked as specified.
3. **PM2-4 / PM2-5 / PM2-8 (Major): the numbers that decide "keep going or stop" can't be
   measured in time.** The targets are set from the same data they judge (circular). Review time
   per MR has no capture point, because merges happen on GitHub. And whether a subscription can
   sustain overnight runs at all isn't measured until unit 51.

---

## Round-1 PM findings: fixed or not?

| ID | Round-1 issue | Status in round 2 | Evidence |
|---|---|---|---|
| PM-1 | Horizontal roadmap, value too late | **Partly fixed.** The walking skeleton exists, but A is 26 units, not 15–18, and "each milestone ends with a real run on the pilot" no longer holds (PM2-1, PM2-2) | `07:13-14`, `07:38-41`, `07:60-63` |
| PM-2 | Loop control arrives last | **Fixed.** Loop guard at unit 16, used by every fix loop | `07:134`, `01:821-829` |
| PM-3 | Three adapters too early | **Fixed** (D1) | `07:42`, `04:834-855` |
| PM-4 | MVP scope creep | **Fixed for round 1** (the core/complete split, release in D). **New creep** since `08` (PM2-6, PM2-15) | `07:52-58` |
| PM-5 | Atlassian connectors doubtful | **Fixed** (D4: none in the MVP) | `04:926-929` |
| PM-6 | Too many approvals | **Partly fixed.** Inbox, `ship` gate and batch plans exist. `unpark` choices weren't adopted, and supervised still has redundant gates (PM2-6, PM2-14) | `07:176`, `01:1147-1159` |
| PM-7 | Human labels nobody captures | **Partly fixed.** `approve` label and `mirai escape` exist. No review-time definition, no "issues the verifier missed" question (M7), and no capture at MR merge (PM2-5) | `07:86`, `07:195` |
| PM-8 | No cost estimate | **Partly fixed.** Runs per track exist (`01:98-104`), but what one feature costs in subscription usage is still unknown until unit 51 (PM2-8) | `07:197` |
| PM-9 | No success or kill criteria | **Added but not usable yet** (PM2-4) | `07:233-244`, `04:941-958` |
| PM-10 | Reuse never tested | **Added, but last.** Unit 65, near the end of D. The cheap check right after A wasn't adopted (PM2-7) | `07:221` |
| PM-11 | CI gate the pilot may not have | **Fixed** (honest fallback), though it depends on `doctor`, which comes later (PM2-3) | `07:142` |
| PM-12 | Milestone/metric naming, jargon | **Fixed** (A–E, glossary in `03` §0) | `07:50`, `03:28-50` |
| PM-13 | `/mirai-prd` for a bug | **Fixed** (`/mirai-new`) | `01:36-38` |
| PM-14 | PRD/design gate wording | **Fixed** (D6) | `01:419-422` |
| PM-15 | `both` mode | **Resolved** (D5 removed it) | `04:134-137` |
| PM-16 | Wrong cross-references | **Fixed** | `05:110-111`, `04:960-964` |
| PM-17 | P7 precondition | **Fixed** | `07:185` |
| PM-18 | Dogfooding start | **Fixed** | `07:33` |
| PM-19 | `00` status | **Fixed** | `00:6` |

---

## Critical

### PM2-1 · Critical · When the pilot starts is undefined and contradicts the roadmap's own exits

**Evidence.**
- `07:38-41`: "**The pilot comes after the structure is built** (your decision, 2026-10-21). No
  local project … is touched before then. The pilot phase … repeats the milestone exit checks
  there." `07:36-37`: until then, "pilot ticket" means "sample-app ticket".
- The decision isn't recorded anywhere else: not in `06` §G (`06:517-530`), not in D-28
  (`04:682-691`), and not in `00`'s change list (`00:262-280`).
- Everything else assumes real pilot work early:
  - Milestone A: "One **real** pilot ticket" (`07:54`, and `07:13-14`: "One real pilot ticket
    reaches an MR at the end of Milestone A");
  - unit 34: "First real setup on the pilot" (`07:169`);
  - Milestone B exit: "one real pilot feature" (`07:179`);
  - Milestone C precondition: "the pilot starts" (`07:185`);
  - unit 51 calibrates "on real pilot tickets" (`07:197`);
  - success is measured "after 20 pilot tickets", and the kill trigger fires "before Milestone D"
    (`07:236-244`, `04:945-952`).
- "After the structure is built" can be read as after Milestone A, C or E. If it means after E,
  the kill gate can never fire before D, calibration runs on a toy sample app, and the first real
  value arrives at unit 68. That contradicts R-C6 ("every later milestone widens a path that
  already works", `07:14`) and your Q4 build-order note ("every later stage is measured from day
  one", `00:58-59`).

**Why it matters.** This one line decides when you first get value, whether budgets mean anything
(a sample app's turns and tokens say nothing about a Laravel + React brownfield app), and whether
the kill rule can stop wasted work. It's the riskiest ambiguity in the plan.

**Fix.**
- Ask the user to pin the pilot start to a milestone exit. Recommendation: **the pilot starts
  right after Milestone A's sample-app exit**. A's exit is then repeated on `mirai/pilot`, and B and
  C run on the pilot. That's the only reading where unit 51 and the kill trigger work.
- Record the answer as a decision (extend D-28) and in `00`'s change list.
- If the user really wants the pilot after everything, rewrite honestly:
  - the exits of A–C say "sample-app";
  - calibration (51) and the success/kill check move into the pilot phase;
  - the kill trigger moves from "before Milestone D" to "before the pilot is declared done".

---

## Major

### PM2-2 · Major · Milestone A is 26 units; about 7 of them are follow-up refinements the first MR doesn't need

**Evidence.** `07:60-63` explains the growth by the safety units 12–14, which is fair: those
three are required (D7). But the `08` follow-ups also added scope to A that one supervised,
hand-written ticket on a sample app doesn't need:
- **Unit 06:** per-project template customization from `.mirai/custom/`: add/reorder/rename with
  mappings, plus protected core sections (`07:87`). A needs two built-in templates, not
  customization. Custom overrides are rendered by the updater path anyway (unit 62, `07:218`).
- **Unit 16:** one-step tier escalation (`07:134`). Tier defaults don't exist until calibration
  (`07:90-91`, unit 51), so escalating "one tier up" from an unmeasured default proves nothing in
  A.
- **Unit 18:** diff coverage per stack, which is UNVERIFIED (G7, `05:138`), plus human-branch
  scoping by trailer (`07:141`). Both are reasonable, but they're the riskiest parts of the gate,
  and they sit on the critical path of the first MR.
- **Unit 19:** the CI job (`07:142`). R-C6 suggested pulling CI into A *if the pilot can run CI*
  (`06:167-170`). With no pilot touched in A (PM2-1), this is CI for the sample app. The local
  `pre-push` hook is enough for a supervised first MR. CI matters before unattended nights.
- **Unit 22:** E2E-file protection (`07:150`). There are no E2E files until Ivy, in C.
- **Unit 24:** Rex flagging "needlessly high level" tests and tests for unchanged code
  (`07:152`). These are quality refinements, not loop mechanics.
- **Unit 01** hides a whole sample app: "Docker-based like your real projects, built as part of
  unit 01's test harness" (`07:35-37`). A Dockerized app with tests that MIRAI can drive is a real
  unit of work, not a test harness detail.

**Fix.**
- Cut A to the shortest path. Move to the end of B or into C:
  - template customization (06);
  - tier escalation (16);
  - Rex's scope checks (24);
  - E2E protection (22);
  - CI (19), placed before unit 48, where it actually guards something.
- Make diff coverage **advisory** in A, and blocking once G7 is settled.
- Split the sample app out as **unit 00** so its cost is visible.
- Add an earlier checkpoint: "**first agent run**" after unit 16. One supervised Kai session on a
  sample ticket through the launcher and loop guard, no ship. That's the first moment you can see
  cost and behavior, around unit 16 instead of unit 26.
- That gives A about 20 units with the safety units kept.

### PM2-3 · Major · Milestone A is missing things R-C6 and `03` promise, and its exit depends on later units

**Evidence.**
- **No run report in A.** R-C6's Milestone A includes "a minimal report" (`06:158`), and `03`
  marks `mirai-report` "A (minimal)" (`03:163`). But the only report unit is 49 (Milestone C,
  `07:195`). Unit 09 only defines the template (`07:117`). So A's first ticket ends with no report
  of turns, tokens and minutes, which is the very data the main concern (Q5) needs.
- **No setup path in A.** `03` marks `mirai-setup` "A (minimal)" (`03:148`), but setup is unit 34
  in B (`07:169`). A's ticket needs `repos`, test levels, the branch pattern and a baseline. The
  roadmap never says these are written by hand in A.
- **`doctor` is used before it exists.** Unit 19 (A) is done when "`doctor` reports 'merge gate:
  … local-only'" (`07:142`), but `doctor` is unit 42 in B (`07:177`). `03` marks `mirai-doctor`
  "A" (`03:149`). `05:116-118` has `doctor` re-running the red-team test (unit 13, A).
- **`mirai inbox` "A (minimal)"** (`03:79`) has no A unit either; inbox is unit 41 in B.
- **No unit for `mirai session start/end`** (R-M3; `04:237-238`; `03:59`), so interactive
  authoring in B has no run id, and the metrics for Nora's and Tess's sessions are missing.
- **No unit for the `pre-commit` hook,** which D-17 relies on to "reject a status change to a
  human-only state without a matching signed approval event" (`04:438-439`, `03:105`). Unit 18 is
  `pre-push` only.

**Fix.**
- Add to A: a minimal `mirai report` (one ticket: rounds, turns, tokens, minutes, verdicts), a
  minimal `doctor` (auth, strict bundle, red-team status, merge-gate mode), and a "hand-written
  config" note in unit 02's done-when.
- Add `pre-commit` to unit 18, and `session start/end` to unit 15 or 39.
- Align the MVP column in `03` with `07`, unit by unit.

### PM2-4 · Major · The success and kill criteria are circular, late and say nothing about value

**Evidence.**
- **Circular.** "The numbers are written by unit 51 (calibration), not guessed now"
  (`07:235`), and "Cost: … under the calibrated target" (`07:236-237`). Unit 51 measures turns
  and tokens on real tickets, then writes the target (`07:197`). A target derived from the run it
  judges will nearly always pass.
- **Late.** "After 20 pilot tickets" (`07:236`, `04:945`). For one person on personal projects
  that's several weeks, and with PM2-1 possibly after Milestone D. There's no earlier stop rule,
  for example after Milestone A.
- **No value signal.** All five criteria are costs or safety (cost, parking, escapes, review time,
  violations; `07:236-241`). Nothing checks the reason MIRAI exists: did it ship your features
  faster or with less of your time than you'd spend alone? M12 lead time is "Later" (`00:128`).
  "Share of MRs merged without your edits" isn't a criterion either.
- **Two versions.** D-38 says "median cost per ticket under the target" (`04:947`) and has no
  safety line. `07` says turns/tokens/minutes and adds "Safety" (`07:236-241`).

**Fix.**
- **Fix the targets before calibration, from your side, not the machine's.** For example:
  - your time per shipped ticket under 15 minutes;
  - at least 60% of MRs merged with no hand edits;
  - at least 2 of 3 overnight tickets shipped per night;
  - one night's usage leaves enough of the weekly limit for your daytime work.

  Calibration then sets the **budgets**, not the pass marks.
- Add an **early checkpoint after Milestone A**. If the first ticket needs more than about 2 hours
  of your attention or more than 2× its turn cap, stop and rethink before B.
- Add one **value metric** to the MVP report: MRs merged per week via MIRAI, and the share merged
  without edits (derivable from git; see PM2-5).
- Make D-38 and `07` say the same thing.

### PM2-5 · Major · Review time and acceptance per MR have no capture point

**Evidence.**
- The success criterion is "your review time per MR is under 15 minutes (**from `approve`
  capture**)" (`07:240`).
- But you review and merge MRs on GitHub (`01:984-986`; `02:250`, "H->>G: review + merge MR").
  `mirai approve` is never called for a merge. The `ship` gate is `auto` in autonomous
  (`01:1151`), so overnight MRs have no `approve` event at all.
- M1 ("accepted as is / edited / rejected") is captured only at `approve` (`07:86`), so it's never
  recorded for overnight MRs, which are the main product.
- Round-1 PM-7 asked for a review-time definition ("from when the item reaches the gate to the
  `approve` call, idle time capped"). None was written (`01:331` only says "your review time").

**Fix.**
- **Derive M1 for MRs from git:** "accepted as is" = merged with no non-`Mirai-Ticket` commits
  added after the MR opened; "edited" = you pushed commits; "rejected" = closed without merge. It's
  a tier-0 script, with no extra friction.
- **Review time for MRs:** either a short `mirai inbox` "reviewed" action that starts and stops a
  timer, or the host's MR timeline (opened → first review → merge), honestly labelled as an upper
  bound.
- Write the definition in `01` §17 and D-38.

### PM2-6 · Major · Human workload: redundant gates, and five human actions for a one-line fix

**Evidence.** From `01` §16 (`01:1140-1159`), `01` §12a and D-33:
- **A 5-ticket `standard` feature, supervised:** brief (1) + PRD (1) + ticket set (1) + plan batch
  (1) + `ship` ×5 + merge ×5 + production go/no-go ×5 (per-ticket release is the default,
  `01:1012-1019`) = **about 19 human actions**. Autonomous is still about 13. That's before
  disputes, unparks, `business.md` proposals, new critical journeys, template gaps and
  `mirai clean` prompts, all of which also land in the inbox (`01:1153-1156`).
- **The supervised `ship` gate duplicates the merge gate.** Push + MR is reversible, and the merge
  is always yours anyway (`01:952`). You approve the same diff twice.
- **Brief and PRD are two separate document gates** for every `standard` feature (`01:270`,
  `01:297`; `02:19` vs `02:29`). The sequence diagram already treats them as one action
  ("approve brief + PRD", `02:221`).
- **The `quick` track** ("Login button misaligned on mobile", `01:51`) needs ticket + brief lines
  (1), plan (1), ship (1), merge (1) and production go/no-go (1): **five human actions for a CSS
  fix**. That's more ceremony than doing it by hand, which defeats the point of D-08.

**Fix** (none of these reverses D6 or D3; every document still gets your approval, and production
stays human):
- Make `ship` default to `auto` in `supervised` too, once review and QA pass. The merge is your
  gate.
- Approve brief + PRD-lite in **one inbox action** on the `standard` track (two documents, one
  decision), as `02` (d) already shows.
- Let the inbox **batch production go/no-go** for tickets merged the same day, and let a project
  without staging choose "merge = release request" so go/no-go and the smoke check happen in one
  step.
- Split the inbox into **"needs a decision"** and **"FYI"** (template gaps, cleanup due, known
  baseline failures). Only the first counts toward your review time.
- Default `quick` + `normal` risk to plan `auto` in supervised.

### PM2-7 · Major · Milestone D is a 14-unit grab bag, and the reuse proof (Q1) comes last

**Evidence.**
- D's "done when" is a list of nine features, not an outcome: "The `full` track …, per-ticket and
  per-epic release, workspace mode, ATDD, updater, Codex verifier, Cursor, and a second project"
  (`07:57`).
- **Reusable is requirement #1** (`00:13-15`), but its proof is unit 65, second to last in D
  (`07:221`). Round-1 PM-10 asked for a cheap version right after Milestone A (`round-1-pm.md:178`);
  it wasn't adopted.
- **Workspace mode (61)** depends on release-together (59) and assumes a multi-repo project you
  don't have yet (`08:51-52`: projects "split into several repos as they grow").
- **Cursor (64)** brings duplicate-loading risk (`05:110-111`) for a tool that no MVP role uses
  overnight (`04:844-849`).

**Fix** (all `08` placements kept, only reordered):
- Put **unit 65 (second project) first in D**, right after C's exit, and run a cheap
  "install + doctor" smoke on project 2 at the end of B.
- Order the rest of D by how often you'll use each piece: release (58) → `full` track (52–57) →
  ATDD (60) → Codex verifier (63) → updater (62) → workspace mode (61) → Cursor (64).
- **Trigger** workspace mode and Cursor on need: build them when a real multi-repo project or real
  Cursor use exists. That keeps the `08` Q3 agreement and stops D blocking on speculative work.
- Give D an outcome-style exit, for example "one `full` feature goes PRD → design → tickets → MRs →
  live on two projects".

### PM2-8 · Major · Nobody checks whether a subscription can sustain overnight runs until unit 51

**Evidence.**
- This is the user's main concern (Q5, `00:75-78`), and subscription-only is now a hard decision
  (`06:530`).
- One healthy build session is about 1–2.5M tokens (`01:109-111`). A `standard` feature is "about
  45" runs (`01:103`). Usage limits pause or stop the night (`01:765-777`).
- But the first measurement of usage per ticket is unit 51, the last unit of C (`07:197`). If one
  night of 3 tickets uses most of a weekly limit, Milestone C's premise fails after 50 units of
  work, and there's no earlier signal.
- `total_cost_usd` on subscription (G4, `05:135`) and the usage-limit exit code (G2) are still
  unverified.

**Fix.**
- Make Milestone A's exit record **the share of the session and weekly limit one ticket used**
  (from `/status` or the limit messages, even by hand).
- Add a go/no-go note after A: "at this rate, N tickets fit in one night and M in a week next to
  daytime use".
- If N < 3, tell the user before B. It may change the model tiers or the overnight target.

### PM2-9 · Major · "Exported run-log lines" are committed, which conflicts with decision `08` Q9

**Evidence.**
- `08` Q9.2 (`08:322-327`): per-ticket work files are never committed; "**Only the small signed
  proof files are committed**."
- But three places still commit run-log lines on the branch:
  - `01:949`: "Selected run-log lines are exported into the MR for CI and metrics";
  - `01:1187`: "run-log lines exported at ship time" under "the branch, committed";
  - D-29 (`04:702`) and D-06 (`04:128`); `03:70`.
- Nothing says which lines, what CI does with them (CI checks records, `01:966-969`), or why
  metrics need them when the metrics data is kept locally (`01:1127-1129`). This **conflicts with
  decision `08` Q9.2**, and it's a leak surface on a public-facing MR.

**Fix.** Either drop the export (CI verifies the signed records; metrics read the local store), or
list the exact fields (e.g. rounds, verdict, tier: no free text) and record it as an explicit
exception to Q9.2 that the user confirms.

---

## Minor

### PM2-10 · Minor · Usage-limit behavior contradicts the recorded decision

`06` §G "Other" says "**Usage-limit hits park the remaining tickets**" (`06:530`). `01` §8
(`01:765-777`), D-18 (`04:497-501`, "your decision, 2026-10-21") and unit 46 (`07:192`) say it
**pauses and resumes**. The pause design is better, but **it conflicts with decision G-Other as
recorded**. **Fix:** add a dated line to `06` §G (or `00`'s change list) saying the pause replaces
"park".

### PM2-11 · Minor · ATDD is still called "Later" in two places

`08` Q7.7 moved ATDD for high-risk tickets into Milestone D (`08:234-235`; D-23 `04:616-617`; unit
60 `07:216`). But `01` §10 says "**Later:** acceptance-test-first … (ATDD, see 07)" (`01:903-904`),
and D-44.3 says "**Later:** acceptance-test-first" (`04:1083-1084`). **Fix:** "Milestone D for
high-risk tickets (unit 60); Later for every ticket."

### PM2-12 · Minor · "Track choice: auto in autonomous" means nothing while the brief gate is human

`01` §16 makes track choice `auto` for quick/standard in autonomous (`01:1142`; `01:53-55`). But
the track is confirmed at the brief gate, which is always human (`01:270`, `01:1143`). **Fix:**
drop the track row, or say "confirmed at the brief gate".

### PM2-13 · Minor · The brief gate is drawn three different ways

- `01` §2: the verifier reviews the brief, then you approve it (`01:270`).
- `02` (a): a brief gate with **no verifier step** before it (`02:18-19`).
- `02` (d): brief and PRD approved together (`02:221`).
- D-34: "one touchpoint per feature before overnight builds" (`04:896`), when there are at least
  three (brief, PRD, ticket set).

**Fix:** pick one (see PM2-6) and make `01`, `02` and D-34 match.

### PM2-14 · Minor · `unpark`'s choices from round 1 weren't adopted

Round-1 PM-6 asked for `mirai unpark` with explicit choices (re-plan, split, raise the budget once,
drop), logged to feed M13 (`round-1-pm.md:130`). `07` unit 41 only says "unpark needs a note"
(`07:176`), and `01:96` says the same. A free-text note can't be counted, so M13 (diagnosis
quality) and the parking analysis stay manual. **Fix:** a fixed choice plus the note.

### PM2-15 · Minor · Retention (unit 50) sits in MVP-core but has nothing to delete for 90 days

Unit 50 (`mirai clean` + `mirai archive`) is in Milestone C (`07:196`). The rule deletes only
files older than 90 days after merge (`01:1125-1126`), so it can't act until about three months
after the first merged ticket. `08` Q9 asked for "a `mirai clean` unit" without naming a milestone
(`08:357`). **Fix:** move unit 50 to D. Keep the schema split (structured vs bulky data) in unit 04
as is, so nothing has to be migrated later.

### PM2-16 · Minor · Calibration on a sample app gives meaningless budgets

Linked to PM2-1. Unit 51 writes the budget and tier defaults into the presets (`07:197`). If it
runs on `examples/sample-app` (`07:35-37`), those defaults reach the pilot without ever being
measured on real code. **Fix:** unit 51 runs only on the pilot, and its outputs are marked
"sample-app provisional" until then.

### PM2-17 · Minor · Where the morning report lives is unclear

`05` Q9 says "a file in the repo plus the terminal" (`05:44-46`). `01` §13 writes
`reports/run-<date>-<id>.md` (`01:1066`) without saying whether it's committed. Q9 says work files
stay local (`08:322-327`). **Fix:** put reports in the orchestrator store, readable through
`mirai report`, or state that they're committed and why.

### PM2-18 · Minor · The release state machine starts at `staging` even with no staging

`02` (h) starts every release record at `staging` (`02:459`), but `01` §12a supports projects
without staging and projects not released yet (`01:1007-1010`; `05:52-56`). **Fix:** add a
`pending` start state, or a `staging`-skipped path straight to go/no-go.

### PM2-19 · Minor · Milestone exits name features, not results you can check

B's and C's exits are good outcomes (`07:179`, `07:199-200`). D's is a feature list (`07:57`), and
A's says "inside the loop caps" without naming the cap or usage evidence to keep (`07:54`).
**Fix:** each exit names the evidence file: the run report with rounds, turns, tokens, minutes and
the share of the usage limit (PM2-3, PM2-8).

---

## What's good / keep

1. **The walking skeleton on Claude Code only** (R-C6, D1), with the loop guard placed right after
   the launcher (unit 16). Your main fear is handled from the first loop, not the last.
2. **Safety before any agent runs** (units 12–14): trust root, strict bundle, red-team test, tests
   only inside project containers. It's honest about its residual risk (`01:721-723`,
   `04:803-806`).
3. **D6 and "overnight = build loop only"** say plainly where your attention goes (`01:40-43`).
   That's the right trade for a solo developer.
4. **Results stay local, one line on the MR** (`08` Q9): less noise, no review comments to
   moderate, nothing leaks onto the host. Plus the retention split that keeps the metrics but drops
   the bulk.
5. **The brownfield ratchet** (D-45): "nothing new broke", diff coverage and characterization tests
   only for changed functions. This is what makes MIRAI usable on real, untidy projects, and it
   avoids test-debt scope creep.
6. **Model tiers that are measured, not assumed** (D-14), with judgement steps never downgraded.
   It answers cost on a subscription without risking quality where it matters.
7. **The template-gap signal** (D-41) instead of agents padding documents: cheaper documents, and
   template changes driven by data.
8. **Readability:** glossary (`03` §0), milestone renaming, "In plain words" under every diagram,
   and every change traced to a source ID.
