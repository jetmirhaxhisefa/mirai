# Round 1 review: Product Manager lens

Reviewer: independent PM reviewer.
Scope read: `design/00`, `01`, `02`, `03`, `04`, `05`, `07`; `research/01`, `04`, `05` (and `08` checked for CI facts).
Lens: does the design solve the problems the user actually stated in the interview log, is the MVP the right size and order, and can the user get a useful result early?

**Summary:** 2 Critical, 9 Major, 8 Minor.

The design itself is strong. It answers almost every interview point, and the safety thinking (script orchestrator, hard gates, parking, no merge) is better than most frameworks of this kind. The main problem is the **roadmap, not the design**. It builds MIRAI layer by layer, so the user gets nothing they can use until unit 39, and their main fear (endless loops and cost) is only handled at unit 53. The design tells MIRAI to build tickets as a "tracer bullet" first (`01` §5), but the roadmap doesn't build MIRAI that way.

---

## Interview coverage check

| User requirement (`00`) | Covered in design? | Where it lands in the roadmap | Comment |
|---|---|---|---|
| Reusable across projects (Q1) | Yes: lock file, framework/project split (D-02) | Unit 15 | Only ever tested on one pilot (PM-10) |
| 3 tools (Q2) | Yes: adapters (03 §2) | Units 16–18, early | Front-loaded before any value (PM-3) |
| Connectors with `.md` fallback (Q2) | Yes: `repo` store first | Units 27, 43–44 | First external store choice is doubtful for personal projects (PM-5) |
| Hard gates on every tool (Q3) | Yes: git hooks + CI (D-15) | Units 20–22 | Relies on GitHub required checks the pilot has no CI for (PM-11) |
| Full lifecycle to push + MR (Q4) | Yes, plus a release stage the user didn't ask for | Units 39–55 | Release is scope creep (PM-4) |
| Author → verifier pairs (Q4) | Yes: Vera, fresh context, ladder (D-10, D-14) | Unit 32 | Good |
| Supervised vs overnight switch (Q5) | Yes: per-stage gates + presets (`01` §16) | Units 52–54 | PRD/design gates locked to `human` (PM-14) |
| Loop and cost control, the main concern (Q5) | Yes: L1–L8, caps, budgets, parking | **Unit 53** | Far too late (PM-2) |
| Trust metrics (Q6) | Yes: log fields + M1–M9 | Units 04, 51 | No way to capture the human labels several metrics need (PM-7) |
| Storage modes (Q7) | Yes | Unit 27 | `both` mode is heavy for an MVP (PM-15) |
| Resume (Q7) | Yes | Unit 50 | Good |
| Sync-back (Q9) | Yes | Units 56–57 | Right to put it last |

---

## Critical

### PM-1 · Critical · `07-implementation-roadmap.md` (whole stage order, milestones)

**Problem.** The roadmap builds MIRAI in horizontal layers: foundation, then all templates, then all three tool adapters and the updater, then all enforcement, then setup, then all agents, then workflows. The first time the user gets something useful is late:
- **unit 39**: the first real document flow ("A real pilot feature goes request → approved PRD");
- **unit 52**: the first ticket reaches an MR through MIRAI;
- **unit 54**: the first overnight run, which is the headline feature.

That means about 38 units of building before the user gets any value back. The roadmap's own rule is "each unit gets its full spec in Phase 4 … one at a time". At that pace, the user goes weeks before the framework does any useful work, and every early design guess (template fields, config schema, status table, log schema) gets locked in before a real run tests it. The design already knows the cure. It tells MIRAI to put "the thinnest path through every layer" first (`01` §5, D-09), but the roadmap doesn't follow that advice for MIRAI itself.

**Evidence.** `07` Stage 2 builds 8 template units (07–14), including the HLD, LLD and release-record templates, before a single agent exists. Stage 3 builds Codex and Cursor adapters (17–18) and `mirai update` (19) before anything has been used once ("Before anything is used for real", unit 19).

**Fix.** Restructure the roadmap around a **walking skeleton** that delivers the `quick` track end to end on Claude Code only. Then widen it.

- **Milestone A, "first MR" (target about 15–18 units):**
  1. CLI skeleton, config, status model and run log (today's 01–04).
  2. `mirai approve` (05).
  3. Story/bug template and plan template only (part of 12, 13).
  4. `mirai init` on Claude Code only (15, 16).
  5. Agent launcher with budgets and caps (31, plus the cap part of 53; see PM-2).
  6. Developer, reviewer and the `mirai-plan`, `mirai-tdd` and `mirai-review` skills.
  7. Records and the `pre-push` hook (20, 21).
  8. `mirai-ship` (49) and a minimal run report (51).

  Done when one real pilot bug or small story goes ticket → plan → TDD build → review → push → MR, under a budget, in supervised mode.
- **Milestone B, "first PRD to tickets":** business brief and PRD-lite templates, Vera, the PM agent, the ticket planner, and the `standard` track.
- **Milestone C, "first overnight run":** the autonomous preset, QA with `verify-<app>`, and the morning report.
- **Milestone D, "breadth":** the `full` track (HLD, LLD), the Codex adapter (first as a verifier rung, see PM-3), Cursor, CI, the Jira/Confluence connector, the updater and `mirai-change`.
- **Milestone E:** sync-back.

Each milestone ends with a real run on the pilot, and the lessons go back into the next unit specs.

### PM-2 · Critical · `07` Stage 9 unit 53; `01` §3 step 6, §9

**Problem.** Loop and cost control is "your main concern" (`00` Q5, D-18), yet the loop rules L1–L8, round caps, budgets and parking only arrive at **unit 53**, the second-to-last build unit. Loops start much earlier:
- The document flows (units 39–41) already run a verifier fix loop. `01` §3 step 6 says it follows "Same rules as code review (§9: L1–L5) … at most 2 rounds".
- The supervised build-loop units 45–48 run developer ↔ reviewer ↔ QA rounds.

So either those units re-implement caps on the side, or they run without them, on real tokens, while the user watches the very behavior they said they fear. The agent launcher (unit 31) sets per-run turn and dollar limits, but nothing counts **rounds**, matches repeated failures, or parks work before unit 53.

**Fix.**
- Split unit 53. Move the shared parts into a **loop guard** library built straight after the agent launcher (31): the round counter, per-item and per-night budget ledger, finding and failure fingerprints, the strict-progress check, and the parking note writer.
- Make every fix loop (PRD, design, tickets, build) call it from day one. Unit 53 then only wires the remaining rules into the overnight state machine.
- Add a done-when to unit 31 or the new unit: "a seeded endless verifier loop parks at round 2 and logs the spend."

---

## Major

### PM-3 · Major · `07` Stage 3 (units 16–18); `03` §2; D-12

**Problem.** All three tool adapters are built in M2, before any agent exists. The user does want three tools (Q2), but the three are not equal:
- Claude is the main model (Q12).
- Codex's real value in this design is **verifier rung 1**, a different model family (D-14).
- Cursor reports no cost ("the cost field is logged as `unknown`", D-12), so Cursor runs can't enforce the dollar cap that answers the user's main concern. Its duplicate-loading behavior is still UNVERIFIED (`05` §F).

Building Cursor this early buys risk before value.

**Fix.**
- Claude Code first (in Milestone A).
- Add Codex next, first as a headless **verifier** for rung 1, then as an interactive tool.
- Cursor last in the MVP.
- Write down that **overnight runs use Claude Code (and Codex) only in the MVP**, because Cursor can't enforce a cost budget.
- Keep "works on three tools" as an MVP exit criterion, not as M2.

### PM-4 · Major · `01` §12a; `07` unit 55; `03` §5 `mirai-release`; also units 19, 42, 43, 44

**Problem.** The MVP has grown past what the user asked for.
- Q4 ends at "7. push and merge request". The release stage (staging check, go/no-go, production smoke, rollback) is not in Q4, and `05` Q10 admits the personal projects may not even have staging. `03` §5 notes that `mirai-release` has "none in prior art (build new)", so it is new, untested work.
- Inside the MVP there are also two external connectors (Jira and Confluence), `mirai-change` versioning with stale detection, the updater with migrations, and both HLD and LLD templates.

Each is reasonable on its own. Together they push the MVP to 57 units.

**Fix.** Split the list into **MVP-core** (Milestones A–C in PM-1) and **MVP-complete** (D–E).
- Move release to "Later", or cut it down to a record file written by `mirai-ship` after merge. Decide only after open question 10 is answered.
- `mirai update` can wait until there is a second MIRAI version to update to. Until then, reinstall is enough.
- Ask the user to confirm the cut. Per the interview, they want the full lifecycle, but up to the MR.

### PM-5 · Major · `05` C.11; `03` §7; `07` units 43–44

**Problem.** The recommended first external store is Jira + Confluence, "since you named Jira and Confluence". But the user named them as examples of *team* tools (Q2: "e.g. Slack, Jira, Confluence; other teams: others"), and the current scope is **personal projects only** (Q1, with momox out of scope). The pilot is on GitHub with no tracker URL anywhere (`research/04` §3: "`BKT-` looks like Jira, but no tracker URL appears anywhere"). Building two Atlassian connectors for projects that may not use Atlassian is wasted MVP effort.

**Fix.**
- Ask the user now which tracker their personal projects actually use.
- MVP needs exactly **one** real external connector, to prove the connector interface and the `external` mode. Pick it from that answer: GitHub Issues if nothing else is in use, since `gh` is already needed for MRs.
- Move the second connector to Later.

### PM-6 · Major · `01` §16 (presets), D-17, `02` (e) ticket states

**Problem.** In `supervised` mode a single `standard` item needs about 7 or more separate human approvals, each typed in a real terminal (D-17): track, PRD, tickets, plan per ticket, push per ticket, MR per ticket, then merge. For a solo developer on personal projects that leads to gate fatigue and rubber-stamping. The design already worries about this: M6 says "approvals in seconds are rubber stamps". Specifics:
- `push` and `mr` are two separate gates, but they are really one decision ("ship this").
- There is no way to approve several plans at once.
- There is no command for the most common morning action, **resolving a parked ticket**. The state diagram has `blocked → ready_for_dev : you resolve the parking note`, but the CLI list (`03` §1) only has `approve` and `drop`.

**Fix.**
- Merge `push` + `mr` into one `ship` gate.
- Let `mirai approve` take a set (`mirai approve plans --ticket-set <id>`) and show a short review packet: the summary, the verifier's last findings, the diff size, and the cost so far.
- Add a `mirai unpark <ticket>` command with explicit choices: re-plan, split, raise the budget once, or drop. Log the choice, which feeds M13.
- Tell the user in plain words that **overnight covers only the build loop**. PRD, design and tickets are always prepared with them in the MVP.

### PM-7 · Major · `00` Q6; `01` §13; `07` unit 51

**Problem.** Several MVP metrics need **human-labelled ground truth**, and the design never says how those labels are captured:
- **M2 escapes**: who records that a bug was found after a PASS, and how?
- **M5 reviewer precision**: whether a blocking finding was real.
- **M7 verifier recall**: "issues you caught after it passed".
- **M6 review time**: measured from when to when?

`mirai approve` captures the decision and the review time only. Without a capture step these metrics will be empty, and the promotion rule (M1 + M2 + M6, ≥20 runs) will never fire. There's also a volume problem: one person on personal projects might produce 5–15 tickets a week, so a "20 runs" threshold per stage takes weeks to reach, and spreading attention across 9 MVP metrics is a lot.

**Fix.**
- Define the capture points in `01`:
  - `mirai approve` asks one optional question: "Did you find issues the verifier missed? (count + one line)". That feeds M7.
  - A `mirai escape <ticket> "<what>"` command records bugs found after a PASS. That feeds M2.
  - Disputed findings resolved by the human record upheld or rejected. That feeds M5.
  - Review time = from the moment the item reaches the gate to the `approve` call, with idle time over N minutes capped.
- Put M1, M3, M4 and M6 in the MVP report. Log the raw fields for the rest, but compute them later.
- Say in the report when a sample is still too small to trust.

### PM-8 · Major · `05` A.3 and B.7; D-30; missing in `07`

**Problem.** Cost is the user's main concern, but the design has **no estimate of what one feature costs** from end to end. A `standard` item runs, at minimum: a PM session, 1–2 verifier runs on the PRD, the ticket planner, 1–2 verifier runs on the tickets, and then for every ticket a plan, a build, 1–3 review rounds, QA and ship. The budgets in `05` B.7 ($2/$5/$10 per ticket, $40 a night) are per ticket only. Also, open question 3 (overnight `--bare` needs a pay-per-token API key instead of the subscription) is a real money decision. It is marked "before unit 23", but headless runs actually start at unit 31 (the launcher) and unit 54 (overnight).

**Fix.**
- Add a short cost model to `04` or `07`: the expected agent runs per track, times a rough cost per run on the chosen models, with a low and a high case. Ask the user to accept the range.
- State which model each role uses by default. For example, a cheaper model for the build and the strongest model for the verifier and high-risk review.
- Move open question 3 to "before unit 31" and show the user the per-token cost next to their subscription.

### PM-9 · Major · missing across `07` / `04`

**Problem.** MIRAI requires every feature to have success metrics and counter-metrics (`01` §3), yet MIRAI itself has **no success or exit criteria**. The roadmap defines "done when" per unit but not "the MVP worked". Without that, nobody can tell when to stop adding units, or when the approach isn't paying off.

**Fix.** Add a short "MVP success" section to `07`, for example:
- 3 real pilot items shipped to an MR through MIRAI;
- at least one unattended night ending under budget with a usable morning report;
- median human time per ticket under N minutes;
- 0 runaway loops, meaning no ticket goes over its caps without being parked;
- cost per finished ticket under $X.

Add **kill or rethink criteria** too. For example: if after 10 tickets more than half are parked, or you rewrite most of the MRs, stop and redesign before building more.

### PM-10 · Major · `07` header ("Each unit is tested on the pilot branch"); Q1

**Problem.** "Reusable across projects" is requirement number one (Q1), but every unit is tested on a single pilot: a Laravel + React + Docker monorepo with an unusual containerized quality gate. Setup detection, the `verify-<app>` generator, config defaults and the context templates will quietly take on that shape. Nothing in the roadmap proves that MIRAI installs and works on a **second, different** project.

**Fix.** Add an MVP exit unit: "Install on a second personal project with a different stack (for example a small Node or Python repo with no Docker), run setup and doctor, and ship one `quick` ticket to an MR. Record every manual workaround as a bug against MIRAI." Put a cheap version of this check right after Milestone A.

### PM-11 · Major · Q3 / D-15; `07` unit 22; `research/04` §3

**Problem.** The hard gate depends on "a CI job that refuses a merge" set as a **required status check**. But:
- the pilot has **no CI** (`research/04` §3: "Quality gate: no CI");
- its quality gate runs inside Docker containers, which a hosted CI runner may not reproduce;
- on GitHub, required status checks and branch protection on **private** repos generally need a paid plan. This needs checking for the user's account, because `research/08` never looked into it.

If this doesn't hold, the "same hard gates on every tool" promise falls back to local `pre-push` hooks, which `--no-verify` skips. There's also no lighter setup path for a small new personal project that doesn't want CI on day one.

**Fix.**
- Before unit 22, verify which branch-protection and rulesets features the user's GitHub plan allows on private repos, and whether the pilot's Docker gate can run in GitHub Actions.
- If it can't, write down the fallback honestly. For example, `mirai sync` refuses to mark a ticket `done` when its merge commit has no valid records, and M9 counts every case.
- `doctor` should report "merge gate: enforced by CI / local only".
- Offer a minimal setup profile: repo storage, Claude Code, git hooks, CI optional.

---

## Minor

### PM-12 · Minor · `07` milestones vs `00` Q6 metrics; all docs

The milestones are named **M1–M6** ("M1: the foundation works") and the metrics are named **M1–M16** ("M1 Human acceptance rate"). Unit 51 says "`mirai metrics` (M1–M9)" inside the "(M4)" stage, so a reader can't tell which is which. There's also a lot of unexplained jargon for someone new to this field: tree hash, floor guard, tracer bullet, closure, lanes, rung, frozen block, spec kernel, misroute scan, Y-statement.
**Fix.** Rename the milestones (for example `MS-A`… or "Milestone A"). Add a one-page glossary (`design/06-glossary.md` or a section in `01`), each term explained in one sentence.

### PM-13 · Minor · `01` §2 (Intake trigger)

Every piece of work starts with `/mirai-prd <request>`, even a `quick` bug that will never get a PRD. Calling a "PRD" command to fix a misaligned button is confusing.
**Fix.** Use a neutral entry point, such as `/mirai-new <request>` (or `mirai run --from intake`). It proposes the track and routes the work, and `/mirai-prd` stays as a direct entry point for when the user already knows they want a PRD.

### PM-14 · Minor · `01` §16 and §4 step 2 vs `00` Q5

Q5 says each stage, PRD and design included, has a configurable gate. The design locks PRD and design to `human` with "not in MVP". That's a sensible safety call, but it changes what the user decided, so confirm it with them. Separately, `01` §4 step 2 says "In autonomous mode the design stage never runs". That conflicts with the PRD stage, where autonomous mode drafts with `[ASSUMPTION]` tags and waits at the gate.
**Fix.** Say "in autonomous mode the design is drafted and waits at the human gate". Add a line to `05` asking the user to confirm that PRD and design stay human-only in the MVP.

### PM-15 · Minor · `00` Q7 (`both` mode); `07` unit 27

Two-way `both` mode, which compares versions and stops when both sides changed, is the hardest storage mode and the least likely to be needed on a personal project.
**Fix.** In the MVP, `both` means "repo is primary, publish one way to the external tool, and warn if the external copy was edited". Full two-way sync comes later. The user did add storage modes, so this needs their OK.

### PM-16 · Minor · cross-references

- `05` §F says Cursor duplicate loading "Unit 13 must test it". Unit 13 is the plan template, and the Cursor adapter is unit 18.
- `05` A.3 says headless auth is needed "before unit 23". It is actually needed at unit 31 / 54 (see PM-8).
- `research/05` marks #21 Debug Council and #29 Work Council as MVP "Yes", but `03` §4 puts the debugger in Later. Only row #53 has a recorded override (D-25). The user's notes asked for a debug council, so record that decision (and confirm it) in `04`.

**Fix.** Correct the unit numbers, and add a decision line for the debugger and council deferral.

### PM-17 · Minor · `07` units 29, 38, 48; `05` E.17

QA, the `verify-<app>` generator and the first overnight run all need the pilot app to start. The pilot's local URLs are currently broken (`research/04` §3, P7). The roadmap doesn't list this as a blocker.
**Fix.** Add "P7 resolved and the pilot starts locally" as a precondition of unit 29, and ask the user before Milestone C.

### PM-18 · Minor · `07` rules ("Dogfooding starts after unit 04")

Dogfooding means unit specs move through MIRAI statuses, but human-only moves need `mirai approve`, which is unit 05.
**Fix.** "Dogfooding starts after unit 05."

### PM-19 · Minor · `00` header

The interview log still says "Status: in progress", while every design document treats it as locked.
**Fix.** Mark it `approved` (or list what is still open) so later readers know which answers are binding.

---

## Clearly right: keep these

1. **A plain script decides, agents only exchange verdict files** (L8, D-18), with **one shared round budget** across checks, review and QA, and **parking with a note instead of retrying**. This is the right answer to the user's main fear, and it's stronger than prompt-level loop rules.
2. **Hard gates in git and CI, with records tied to the code tree hash, and agents never merge** (D-15, D-16, D-22). It works the same on every tool and is honest about its limits ("proves a review ran, not that it was good").
3. **Three tracks (quick / standard / full)** (D-08). Small work skips big-work ceremony, and a `full` track always stops for a human.
4. **Machines before AI, and the citation rule for blocking findings** (L1, L6, `01` §3 step 4). Lint runs before any verifier, and a "blocking" finding must cite `file:line` plus a rule, or the script downgrades it. This cuts both cost and reviewer noise.
5. **Control data always in the repo; metrics suggest but never flip** (Q6, Q7, D-06). Resume and the gates never depend on an external API, and promotion needs several metrics plus a minimum sample size. Both protect trust.

Also worth keeping: the 15-minute vertical-slice ticket rule, and personas limited to a name plus style, with functional file names for metrics.
