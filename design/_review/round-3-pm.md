# Round 3 review: Product Manager lens

Reviewer: independent PM reviewer, round 3.
Read: `design/06-review-round-2.md` (findings + §G U1–U5), `_review/round-2-pm.md`,
`07-implementation-roadmap.md` (v4), `01-workflow.md` §0, §1, §6, §7, §7a, §8a, §11, §12, §12a,
§13, §16, §17, `04-decisions.md` D-02, D-12, D-28, D-30, D-33, D-34, D-38, D-47…D-52,
`05-open-questions.md`, `00-interview-log.md`, plus `02` (a), (d), (h) and `03`'s MVP column to
check consistency, and `research/04-pilot-project-analysis.md` for the pilot's facts.
Lens: the round-2 fixes from the user's side. Did the safety work make setup and daily use too
heavy? Is the first real value still close? Do U1–U5 read the same everywhere? Can the
success and kill criteria be measured? How many human actions are left per track? Were the
PM2 findings closed?

## Summary

**1 Critical, 7 Major, 7 Minor.**

The safety work itself is sound and mostly well explained: §7a now has a plain "what each layer
blocks / what gap it leaves" table, an honest residual-risk paragraph, and `doctor` hints for
each red item. U1, U2, U3 and U5 are carried through cleanly. The supervised `ship` gate is gone,
and a 5-ticket feature drops from about 19 to about 10–14 human actions. Most PM2 findings are
closed (12 of 19 fully, 7 partly, none fully open).

The problems are on the path from "Milestone A done" to "first real pilot MR". That path is
where the user first gets value, and it has gaps that the sample app hides.

**Top 3:**
1. **PM3-1 (Critical): the pilot checkpoint can't work as written.** MIRAI is installed only on
   the `mirai/pilot` branch, but the trust root, ticket base, MR target, docs MR and baseline are
   all hard-wired to `main`, which on the pilot has no MIRAI files. The first real ticket has no
   valid trust root, or its MR targets the real product's `main`.
2. **PM3-2 / PM3-3 (Major): the first real ticket depends on unplanned work you do by hand, and
   Kai can't run the pilot's own quality gate.** In A, config is hand-written. Setup detection,
   `.env.test`, baseline and pilot-stack test adapters all arrive in B, so you write them by hand
   for a Laravel + React brownfield app. Separately, agents are denied `docker` and only get
   `run_tests(level)`, while the pilot's gate (`pint`, `artisan`, `tsc`, lint, build) runs inside
   containers. Kai has no way to run lint, type checks, generators or package installs.
3. **PM3-5 / PM3-6 (Major): the keep-or-stop numbers still can't all be measured, D-38 still
   contradicts `07`, and the real kill check fires only after 56 of 74 units.** "Your time per
   MR" from the MR timeline includes the night an overnight MR waits for you. "Enough of the
   weekly limit" has no number. The early stop rule's "2× its turn cap" uses a cap that doesn't
   exist until calibration (unit 55).

---

## Round-2 PM findings: closed or still open?

| ID | Round-2 issue | Status | Evidence |
|---|---|---|---|
| PM2-1 | Pilot start undefined | **Closed.** Pinned to right after A everywhere. A new problem, which branch is "main" on the pilot, is PM3-1 | `07:39-45`, `04:799-802`, `00:285-287`, `05:93-95`, `01:24-26` |
| PM2-2 | A too big; refinements in A | **Closed (deviation explained).** Customization, escalation, E2E protection, Rex scope checks and CI left A. Sample app is unit 02. First agent run checkpoint at unit 19. A stays at 27 with a stated reason. Small leftovers in PM3-13 | `07:22-25`, `07:71-84`, `07:172` |
| PM2-3 | A missing report, doctor, session, pre-commit; `03` out of line | **Partly.** Report + doctor (27), session (17), pre-commit (24) and the hand-written-config note (03) added. `03`'s MVP column still disagrees with `07` in 7 rows (PM3-11) | `07:185`, `07:165`, `07:182`, `07:106`; `03:87,95,108,116,117,163,228` |
| PM2-4 | Criteria circular, late, no value signal; D-38 ≠ `07` | **Partly.** `07` now fixes pass marks up front, adds a value line and an early stop rule. But D-38 still says "calibration only fills in the numbers" (circularity back), still "after 20 pilot tickets", and has no overnight/usage/safety marks or early rule. Two marks are unmeasurable (PM3-5), and the check is still late (PM3-6) | `07:284-299`, `04:1121-1134`, `07:301` |
| PM2-5 | No capture point for review time / acceptance | **Partly.** M1 is derived from git (unit 54). Review time took the weaker option, "MR timeline, upper bound", which is meaningless for overnight MRs (PM3-5). The definition was not written into `01` §17 | `07:240`, `07:288`, `01:1392-1415` |
| PM2-6 | Redundant gates; 5 actions for a CSS fix | **Partly.** Ship gate dropped, brief + PRD as one action, needs-a-decision/FYI split, batch go/no-go. But `01` still makes the quick-track plan gate human in supervised, and the new docs-MR merge isn't counted (PM3-7) | `01:70`, `01:1371`, `07:221`, `07:257`; `01:627`, `01:1367`, `01:389-391` |
| PM2-7 | D a grab bag; reuse last | **Closed.** Second project is unit 57 (first in D), outcome-style exit, workspace and Cursor "when needed". The cheap install + doctor smoke on project 2 at the end of B wasn't adopted; acceptable | `07:68`, `07:250-271` |
| PM2-8 | Subscription sustainability measured too late | **Closed.** `limit_share` logged from unit 05/17, in A's exit, plus the pilot go/no-go note and an N < 3 stop. Remaining gap: G4 (how to read the share) is UNVERIFIED and no by-hand fallback is written (PM3-5) | `07:48-50`, `07:64-65`, `07:195-197`, `05:148` |
| PM2-9 | Run-log lines committed vs Q9 | **Closed** | `01:1133`, `01:1407`, `03:78`, `04:133`, `07:108` |
| PM2-10 | Usage limit: park vs pause | **Closed** | `06-review-round-1.md:530` |
| PM2-11 | ATDD still "Later" | **Closed** | `01:721`, `01:1081`, `04:717`, `04:1272` |
| PM2-12 | Track `auto` in autonomous meaningless | **Closed** | `01:1362` |
| PM2-13 | Brief gate drawn three ways; D-34 "one touchpoint" | **Partly.** `01` §2, `02` (a) and (d) now agree. D-34 still says "one touchpoint per feature before overnight builds", when standard has at least three (brief + PRD, ticket set, docs MR) | `01:316`, `02:23,30,243`; `04:1053` |
| PM2-14 | `unpark` choices | **Partly.** Choices adopted, but two different lists: re-plan/retry/drop vs re-plan/split/raise budget/drop (PM3-12) | `01:118`, `04:1050`, `03:66,87`, `02:482-484` vs `07:221` |
| PM2-15 | Retention in C | **Closed** (unit 67 in D) | `07:266` |
| PM2-16 | Calibration on sample app | **Closed** | `07:44`, `07:241`, `05:41` |
| PM2-17 | Report location | **Closed** | `01:1280`, `05:46-48`, `07:185` |
| PM2-18 | Release starts at `staging` | **Partly.** Text says `pending → …` in `01`/`04`/`07`, but the `02` (h) state diagram still starts at `staging` or `approved`, with no `pending` (PM3-15) | `01:1263`, `04:172`, `07:257` vs `02:541-542` |
| PM2-19 | Exits not checkable | **Closed.** Every exit names its evidence. The early stop rule's "2 hours of attention" has no capture, covered in PM3-5 | `07:60-69` |

**Tally:** 12 closed (PM2-1, 2, 7, 8, 9, 10, 11, 12, 15, 16, 17, 19); 7 partly (PM2-3, 4, 5, 6,
13, 14, 18; PM2-18 is cosmetic).

---

## Human actions per track after U4 (recount)

Assumptions: normal risk, no parks, no disputes, no MR comments, per-ticket release (the
default, `01:1223-1230`, `04:1007-1010`). "MVP-core" means before the release stage exists
(unit 58, D). Ranges come from batching (plans in one batch; go/no-go batched for tickets merged
the same day, `07:257`).

| Work | Supervised | Autonomous | Round 2 count | Sources |
|---|---|---|---|---|
| **Quick fix** (1 ticket), MVP-core | ticket approval + merge = **2**, or **3** if the plan gate stays human as `01` says | **2** | 5 | `01:66`, `07:220` vs `01:627`, `01:1367` |
| **Quick fix**, after D (release on) | **3–4** (+ production go/no-go) | **3** | 5 | `01:1228`, `04:1009-1010` |
| **Standard feature, 5 tickets**, MVP-core | brief+PRD 1 · ticket set 1 · **docs MR merge 1** · plan batch 1 · merge ×5 = **9** | **8** | ~19 / ~13 | `01:64-68`, `01:389-391`, `02:45` |
| **Standard feature, 5 tickets**, after D | 9 + go/no-go 1–5 = **10–14** | **9–13** | ~19 / ~13 | `07:257` |
| **Full-track epic, 7 tickets, per-ticket release** | brief 1 · PRD 1 · design 1 (up to 4 if HLD/ADRs/LLD are approved one by one) · ticket set 1 · docs MR 1 · plan batch 1 · merge ×7 · go/no-go 1–7 = **14–20** (17–23 per-document) | **13–19** | n/a | `01:68`, `02:249`, `01:1365` |
| **Full-track epic, 7 tickets, `release: together`** | 6 doc/plan actions · merges into `feature/<epic>` 1–7 (inbox batches) · final MR to main 1 · go/no-go 1 = **9–15** | **8–14** | n/a | `01:1238-1248` |

**Hidden extras that land in the same inbox:** +1 plan approval per high-risk ticket (always
human, `01:627`). +1 unpark per parked ticket. +1 round-budget grant per MR with comments or red
CI (`01:1207-1208`). `business.md` proposals and new critical journeys (`01:1375`). And, new in
round 2, every ticket that touches a protected path parks overnight (PM3-4).

**Verdict:** U4 delivered a real cut, from ~19 to ~10–14 for the common case. But the headline
"quick = 2 actions" is true only before release exists, and only if `01` adopts `07`'s "plan
`auto` for quick + normal risk". The docs-MR merge is a new action that U4's tables don't show
(PM3-7).

---

## Critical

### PM3-1 · Critical · On the pilot, "main" is the wrong branch: the trust root, ticket base and MR target all point at a `main` with no MIRAI on it

**Evidence.**
- The pilot install lives on a branch: "MIRAI is installed on the `mirai/pilot` branch"
  (`07:41-42`, `07:188`); "The pilot branch is `mirai/pilot`, cut from `main`" (`04:792`). No
  local project is touched before then, and your BKT-48 work must be committed or stashed first
  (`04:797-798`). So the pilot's `main` has no `.mirai/`, no public key and no lock.
- Everything else is hard-wired to `main`:
  - the trust root is snapshotted "**from the main base commit**" (`07:155`; `01:662`, "The
    trust root and lock always come from `main`");
  - tickets branch from `main` (`01:654`);
  - MRs target `main` (`01:1134`);
  - the docs MR goes to `main` (`01:387-391`);
  - the baseline is "refreshed from `main`" (`01:227`, `07:182`);
  - CI's `mirai-verify` reads the base branch's public key and lock (`01:1157-1161`).
- Result at the pilot checkpoint, one of three:
  - the first real ticket finds no MIRAI files in its trust root, and the launch is refused;
  - its MR opens against the product's real `main`, and its first merge pulls MIRAI into the
    product, which is exactly what the clean-branch rule in D-28 avoids;
  - or someone quietly treats `mirai/pilot` as `main` without a rule saying so.
- No `base_branch` key exists in the config key list (`07:112-136`).

**Why it matters (user side).** This is the step that gives you your first real value (U1). As
written, it fails on the first `mirai run`, or it changes your real product's `main` before you
decided that.

**Fix.**
- Add a config key `[git] base_branch` (default `main`; `mirai/pilot` on the pilot). Use it for
  the trust-root snapshot, ticket bases, MR targets, the docs MR, the baseline refresh and CI's
  base. Unit 03 owns it, and units 12, 14, 24, 25 and 26 read it.
- State in D-28: "During the pilot, `base_branch = mirai/pilot`. Ticket MRs target
  `mirai/pilot`. Merging `mirai/pilot` into `main` is a separate, later decision of yours."
- Add to the pilot-checkpoint checklist (`07:187-191`): "`doctor` shows the base branch and that
  its lock and public key are present."
- If you'd rather merge the install into the pilot's `main` instead, that **conflicts with
  decision D-28 / Q10** (clean branch) and needs your explicit yes.

---

## Major

### PM3-2 · Major · The pilot checkpoint hides a unit of hand work: config, test adapters, baseline, `.env.test` and maybe a test compose file for a brownfield app

**Evidence.**
- In A, "the sample app's config is **written by hand** (setup comes in B)" (`07:106`). The
  checkpoint repeats it: "install MIRAI on `mirai/pilot` (hand-written config, as in A)"
  (`07:188`).
- What the first pilot ticket needs, and when MIRAI would otherwise produce it:
  - **test levels and adapters for the pilot's stacks:** unit 15 builds "adapters for the sample
    app's stacks first" (`07:158`). The sample app's stack is unspecified ("an API + a small UI",
    `07:105`). The pilot is PHP 8.4 / Laravel / PHPUnit + React / Vitest / Playwright
    (`research/04-pilot-project-analysis.md:32-34`);
  - **the test baseline, with existing failures and flaky tests:** detection is unit 36, in B
    (`07:213`). But `pre-push` in A already depends on it: "known failures are listed, new ones
    block" (`07:182`);
  - **`.env.test` with dummy secrets:** setup creates it (`01:146`; `04:1438`), and setup is
    B (`07:214`);
  - **a test compose file** if the pilot's compose mounts anything outside the project (`05:109-111`);
  - **the branch pattern and trailer format** (`07:125`), the risk paths (`05:103`), host CLI
    credentials for push (`07:183`), and the OAuth token (`04:294`).
- None of this is sized. The checkpoint reads like a smoke test, but for a brownfield app it's
  the hardest config MIRAI has.

**Why it matters.** The first real value depends on hand-writing the pieces most likely to be
wrong. A wrong baseline blocks every push. A missing adapter makes red checks and coverage fail
as "environment faults". The early stop rule ("more than about 2 hours of your attention",
`07:195`) may fire because of config, not because of MIRAI's idea.

**Fix.**
- **Build the sample app in the pilot's stacks** (Laravel/PHPUnit API + React/Vitest UI +
  Playwright) so unit 15's adapters carry over unchanged. Write this into unit 02's row.
- **Move unit 36 (setup detection, a script with no AI) into A**, before unit 24, or run it at the
  checkpoint. It writes exactly the facts the hand config needs (levels, adapters, baseline,
  branch pattern, compose mounts). The AI parts of setup (37) stay in B.
- **Make the pilot checkpoint a sized step** ("27a · pilot onboarding") with a by-hand checklist
  and done-when: base branch set (PM3-1); detection output reviewed; `.env.test` written; test
  compose file if needed (Q22); `doctor` green; one hand-written ticket using the unit 08
  template.

### PM3-3 · Major · Agents can run tests, but nothing else inside the project's containers: no lint, type check, build, generator or package install

**Evidence.**
- "The developer runs the quality gate itself before handing over" (`01:748-750`; `07:172`).
- The pilot's gate runs inside the containers: `composer validate → pint --test → php artisan
  test → npm run lint → tsc --noEmit → npm run test → npm run build`
  (`research/04-pilot-project-analysis.md:59`).
- Agents are denied `docker` (`01:263`, `07:156`). The only way into the containers is
  `run_tests(level, path?)`, whose levels are **test** levels plus `e2e` and `qa-explore`
  (`01:824-825`; `04:1405-1406`).
- Nothing says how Kai runs `pint`, `tsc`, `npm run lint`, `php artisan make:*`, migrations, or
  `composer require` / `npm install` for a ticket that needs a package. Host PHP 8.4 can't be
  assumed. A search of `01` finds no rule for dependency changes.

**Why it matters.** Daily use. Kai can't do in-session self-checks, so every lint or type error
becomes a post-handover failure that uses a round (`01:749-750`). That inflates rounds, parks
and usage, which are exactly the numbers your pass marks judge. Tickets that need a package or a
generated file will park or get hand-written files.

**Fix** (keeps D7, adds no shell):
- Let `run_tests` (or a sibling `run_check(name)`) run **named project commands from the
  trust-root config**: `lint`, `types`, `build`, `gate`. Same compose hardening, no arguments
  beyond the name.
- Say plainly in `01` §7a: "Kai can run tests and these named checks. Kai can't install packages
  or run generators. A ticket that needs a new dependency is high risk: the plan names the
  package, you approve it at the plan gate, and the orchestrator runs the install from the trust
  root."
- Add a red-team case: a `run_check` name that isn't configured is refused.

### PM3-4 · Major · Protected paths will park routine work overnight, with no way to plan for it

**Evidence.**
- Protected paths now include compose files, Dockerfiles, **`.env*`**, lint and test configs, and
  new or changed `CLAUDE.md`/`AGENTS.md` (`01:827-830`; `07:155`).
- "A change to any of them means high risk; **in autonomous mode the ticket parks**"
  (`01:829-830`). The floor guard says it "**fails** any diff touching protected paths"
  (`01:746`). Fails and parks are not the same outcome.
- Ordinary features touch these files: a new env variable means `.env.example`, and the pilot
  already has `.env.development` and a Vite config (`research/04-pilot-project-analysis.md:66`).
  A new service means a compose edit, and a new lint rule means a lint-config edit.
- The pass mark is "under 20% of tickets parked" (`07:292`). Parks found mid-run cost a night's
  slot and a morning unpark (+1 action each).

**Why it matters.** The safety rule is right. Discovering the need mid-build is the problem: the
ticket burns tokens and then parks. You can't see in the evening which tickets will park.

**Fix.**
- **Declare it at plan time:** the plan template (unit 08) lists any protected paths it expects
  to touch (from `files_likely`, `01:553`). Such a ticket is high risk **at the plan gate**, so it
  gets your approval in the daytime batch, and the build may touch exactly those paths and no
  others.
- `mirai run --plan` (`01:621`) shows which queued tickets are protected-path tickets, so they
  aren't queued overnight unapproved.
- Undeclared touches still park. Make the floor-guard wording match: "flags → high risk → park
  in autonomous / stop in supervised".

### PM3-5 · Major · Two pass marks and the early stop rule can't be measured, and D-38 still contradicts `07`

**Evidence.**
- **Your time per ticket:** "under 15 minutes per shipped ticket (MR timeline, upper bound)"
  (`07:288`). An overnight MR opened at 03:00 and merged at 09:30 has a 6.5-hour "upper bound".
  On a solo personal repo there's usually no review event between open and merge (you can't
  approve your own PR on GitHub). The mark fails for the main product, overnight work, every
  time.
- **Usage:** "one night's usage leaves enough of the weekly limit for your daytime work"
  (`07:290-291`) has no number. **Overnight:** "2 of 3 overnight tickets shipped" (`07:289`),
  where "shipped" is undefined (MR opened? merged? merged without edits?).
- **Early stop rule** (`07:195-197`):
  - "more than about 2 hours of your attention": nothing in A captures your attention time
    (the MR-timeline capture is unit 54, in C);
  - "more than 2× its turn cap": turn caps don't exist yet. "The default numbers are withdrawn
    until the calibration run" (`01:133`), and calibration is unit 55 (`07:114`, `07:241`);
  - the limit share depends on G4, still UNVERIFIED (`05:148`), with no by-hand fallback written
    (PM2-8 suggested "even by hand").
- **D-38 vs `07`:**
  - D-38: "Calibration only fills in the numbers" (`04:1121-1122`). That is the circularity
    PM2-4 removed, and `07:284` says the opposite: "Calibration sets only the budgets, never the
    pass marks";
  - D-38: "first check after 20 pilot tickets" (`04:1132`). `07`: 15 judged after 5 calibration
    tickets (`07:286`);
  - D-38 has no Overnight, Usage or Safety mark and no early stop rule. `07:301`'s "D-38 must
    state the same list" is not done.

**Fix.**
- **Your time:** measure it directly. `mirai review <ticket>` opens the MR and starts a timer,
  and the merge event (host API) stops it, with idle time capped at 30 minutes. Or a one-key
  "minutes spent?" prompt in `mirai inbox` for the 15 judged tickets only. Keep the MR timeline
  as a secondary number. Write the definition in `01` §17 (PM2-5).
- **Usage:** a number, for example "one night ≤ 15% of the weekly limit". **Shipped:** "an MR
  with valid proofs that you merge within 48 hours".
- **Early stop rule:**
  - replace "2× its turn cap" with a provisional cap written now (for example `--max-turns` per
    S ticket, labelled "provisional until unit 55"), or with "more than 2 fix rounds, or parked";
  - capture attention as `mirai session` time plus one manual note at the checkpoint;
  - allow the limit share to be read by hand from `/status` if G4 fails.
- **Rewrite D-38** as a copy of `07`'s list and stop rules, and delete "calibration only fills in
  the numbers".

### PM3-6 · Major · The real keep-or-stop check comes after 56 of 74 units

**Evidence.**
- The only check of **value** (share merged without edits, your time) is on "the 15 pilot tickets
  after the 5 calibration tickets" (`07:286`). Calibration is unit 55, the second-to-last unit of
  C (`07:241`). Kill/rethink fires "before Milestone D" (`07:298-299`), so it can stop only
  D + E (18 units).
- The pilot checkpoint's early stop rule (`07:195-197`) checks **cost and attention** on one
  ticket, not value.
- The git-derived M1 ("accepted as is / edited / rejected") is in unit 54 (`07:240`), so even an
  informal value check before C has no tool.
- Between the checkpoint (after unit 27) and unit 55 there are 28 units with no value gate. B's
  exit (`07:66`) is a flow check ("one pilot feature … to MR"), not a "was it worth it" check.

**Why it matters.** Your main fear (Q5) is spending a lot for little. The design measures cost
early, but it measures whether the MRs are any good only after overnight mode is fully built.

**Fix.**
- **Move the tier-0 M1 script** (merged as is / edited / closed, from git) out of unit 54 into
  unit 27 (minimal report). It's a small script and needs no AI.
- **Add a B checkpoint** after B's exit (about 3–5 supervised pilot tickets). If fewer than 40%
  are merged without hand edits, or your time per ticket is over 30 minutes, stop and rethink
  before building C. Mark the numbers provisional. The full 15-ticket check stays where it is.

### PM3-7 · Major · U4's "2 actions" and the per-track tables leave out the plan gate, the production go/no-go and the new docs-MR merge

**Evidence.**
- **Quick, plan gate:** `07:220` says "quick ticket … plan gate `auto` for normal risk" and "two
  human actions in total". But `01:627` ("`human` in `supervised`") and `01` §16 (`01:1367`,
  "Plan: human (batch in `inbox`)") have no quick-track exception. So in supervised mode `01`
  gives 3 actions.
- **Quick, release:** per-ticket release is the default, and it has a human production go/no-go
  (`01:1228`, `01:1379`; `04:1009-1010`). After D, a quick fix is 3 actions, not 2. Yet `01:66`,
  `02:86`, `04:1040` and `00:289` all say "Two actions".
- **Docs MR:** "you merge it before any ticket starts" (`01:389-391`; `02:45`, "You merge the
  docs MR, full + standard"; `02:257`). That's a new human action on every standard and full
  feature. It's missing from the "Your actions before the build" table (`01:64-68`) and from
  D-34, and it sits on the critical path to an overnight run: approve the ticket set at 23:00
  and nothing runs until you also merge.
- D-34's consequence still says "one touchpoint per feature before overnight builds"
  (`04:1053`).

**Fix.**
- Put the recount table above into `01` §0 in place of `01:64-68`: name the plan gate, the docs
  MR and the go/no-go, and say "2 actions until release is on; 3 after".
- Add the quick-track exception to `01:627` and `01:1367`: "quick + normal risk: plan `auto` in
  both presets".
- **Option for you:** reuse the `feature/<epic>` pattern (`01:1240-1242`, "after an inbox
  approval the orchestrator performs exactly that merge"). Your signed ticket-set approval then
  also authorises the orchestrator to merge the docs MR, which saves one action and removes the
  night-start dependency. This touches R2-M5's "documents reach main through a docs MR you
  merge" (`04:143`), so it's **your decision**. Recommendation: accept, because the decision is
  still yours and signed.
- Fix D-34's consequence line to: "two or three touchpoints per feature (documents, ticket set,
  plan batch)".

### PM3-8 · Major · The sample app inside the public MIRAI repo makes A's exit unrepresentative, and its MR would land on the public framework repo

**Evidence.**
- The sample app is `examples/sample-app` "inside the MIRAI repo" (`07:38`, `07:105`; `01:25`).
- MIRAI is a **public** repo (`04:42`; `00:260`).
- A's exit is "plan → TDD → review → **push → MR**" for a sample-app ticket (`07:64`), and unit
  25's done-when is "A sample-app MR opens" (`07:183`). That MR, its branch, and MIRAI's install
  files (`CLAUDE.md`, `.claude/`, `.mirai/`, the committed public key) land on the public
  framework repo.
- `<repo-id>` is derived from the repo's first commit and remote (`04:1377`), so the "project"
  is the MIRAI repo itself. The installer, trust root and hooks are then tested on a subfolder
  install that no real project uses. The nested `CLAUDE.md` would also be loaded by your own
  sessions on MIRAI (G13, `05:157`).

**Fix.** Unit 02 creates the sample app as **its own private repo** (for example
`mirai-sample-app`), with its own `main` and remote, and installs MIRAI at its root exactly like
a real project. The MIRAI repo keeps only small test fixtures. A's exit MR then opens on the
private sample repo.

---

## Minor

### PM3-9 · Minor · The usage premise could be tested before unit 01, not at unit 19

The first agent run is at unit 19 (`07:82-84`), and the first limit-share reading on real code is
at the pilot checkpoint (after 27). Whether 3 tickets fit in a night (`07:196`) is the cheapest
kill test in the plan, and it needs no MIRAI code.

**Fix:** a zero-unit spike before unit 01. Run one plain Claude Code session on an S-sized
ticket in **another** personal repo (not the pilot, so U1 holds), and note `/status` usage
before and after. If fewer than 3 such tickets fit in one night's share, revisit the tiers or
the overnight target before building. Running it on the pilot would **conflict with decision
U1**.

### PM3-10 · Minor · Setup has no plain "what you do by hand" list, and optional choices have no stated default

**Evidence:**
- `01:146` packs every setup output into one table cell.
- **OAuth token:** where the `claude setup-token` value is stored, and its one-year expiry, are
  not stated (`04:294`). `doctor` checks only the "auth method" (`07:185`).
- **Push credentials:** "its own credentials" for push (`07:183`) are undefined (your `gh` login?
  a fine-grained token?).
- **Managed settings:** "optional, recommended for overnight" (`04:909`) vs "offered before
  autonomous" (`03:108`) vs unit 13 in A (`07:156`). Which is the default?
- **One machine:** losing the machine or the signing key is covered (`04:1494`), but there's no
  backup advice, and `doctor` doesn't show "one machine" as D-52 says (`04:1490`; `07:185`,
  `07:222`).

**Fix:** add a box to `01` §1 (ready to paste):

> **What you do by hand (once per machine, then once per project)**
> 1. `claude setup-token` once per machine. MIRAI stores the token in the macOS Keychain, and
>    `doctor` warns 30 days before it expires. Why: overnight runs use your subscription, never
>    an API key.
> 2. `gh auth login` once per machine. Only the orchestrator pushes with it; agents never see
>    it.
> 3. `npx github:<owner>/mirai#vX.Y.Z init` in the project. It copies files, uses no AI, and
>    creates your signing key in `~/.config/mirai/`. Back that folder up: without it you can't
>    approve on a new machine.
> 4. `/mirai-setup`: answer the gap questions, approve the config and context files (about 30–60
>    minutes).
> 5. Check the generated `.env.test` (fake values only) and, if `doctor` asks, the test compose
>    file.
> 6. Merge the setup MR, so the trust root has a base.
> 7. Optional, needs admin rights: lock the rules with macOS managed settings. Default: off.
>    `doctor` shows it as "recommended" before your first overnight run.
> 8. `mirai doctor` until it's green. Each red line has a fix hint.

### PM3-11 · Minor · `03`'s MVP column still disagrees with `07` (PM2-3 leftover)

| Row | `03` says | `07` has it in |
|---|---|---|
| `mirai inbox` | A (minimal) (`03:87`) | unit 44, B |
| Registry (D-37) | A (`03:95`) | unit 34, B |
| Managed settings | C (`03:108`) | unit 13, A (optional) |
| CI job template | "A if the pilot can run CI, otherwise D" (`03:116`) | unit 52, C. The pilot has no CI (`research/04:57`) |
| Blocking-rules layer | "C (red-team test before autonomous)" (`03:117`) | unit 16, A |
| `mirai-setup` | A (minimal) (`03:163`) | units 36–37, B |
| `repo` store | A (`03:228`) | unit 35, B |

**Fix:** regenerate `03`'s column from `07`'s unit table.

### PM3-12 · Minor · Two different `unpark` choice lists

`01:118`, `02:482-484`, `03:66`, `03:87`, `04:180` and `04:1050` list **re-plan, retry, drop**
(R2-M3, adopted with U4). `07:221` lists **re-plan, split, raise the budget once, drop**.
**Fix:** use R2-M3's three in unit 44, or add "split" as a fourth everywhere. M13 needs one fixed
list.

### PM3-13 · Minor · Small items in A that the first MR doesn't need

- Unit 03: the v1 → v2 schema migration test (`07:106`). No v2 exists before the updater
  (unit 68).
- Unit 03: the two-repo config validation (`07:106`). Workspace mode is "when needed" (unit 70).
- Unit 24: `pre-commit` "a human-only status change needs a signed approval" (`07:182`). Ticket
  status now lives in the store, not in commits (`01:1185-1188`), and A has no documents, so in
  A it guards nothing.
- Unit 23: `mirai handover` (`07:181`). Useful, but not on the first-MR path.
- Unit 19's checkpoint runs "plan + build" (`07:172`), but it depends only on 17, 18 and 08. The
  build step needs the test adapters (15).

**Fix:**
- Move migrations to 68, two-repo validation to 70, `pre-commit` to 42 (first approved
  documents) and `handover` to 44.
- Add 15 to unit 19's dependencies, or make the checkpoint "plan + build without red check".

### PM3-14 · Minor · `00` doesn't record U2 or U5, and still has two stale lines

- `00`'s round-2 change list (`00:282-294`) records U1, U3 and U4 only. U2 (E2E before review)
  and U5 (D order) are missing.
- `00:89` (L8) says "Agents exchange verdict files". Verdicts are now structured output only
  (`01:846-848`).
- `00:29` (Q3) says a CI job "refuses a merge". The design now says your merge is the final gate
  and CI is a second check (`01:1165-1167`).

**Fix:** add U2/U5 lines and a one-line note on L8 and Q3 to the change list.

### PM3-15 · Minor · The release state diagram has no `pending` state

`02:541-542` starts at `staging` or `approved`. `01:1263`, `04:172`, `04:1023` and the
cross-check note (`06-review-round-2.md:487`) say `pending → …`. **Fix:** add
`[*] --> pending`, then `pending --> staging` or `pending --> approved`.

---

## Answers to the round-3 questions

1. **Did safety make setup and daily use too heavy?**
   - **Setup:** heavier, but acceptable once it's written as one list (PM3-10). The admin-rights
     step is optional and plainly worded (`01:278-279`).
   - **Daily use:** two real snags. Kai can't run anything but tests (PM3-3), and protected
     paths park routine tickets mid-run (PM3-4). Both are fixable without weakening D7.
2. **Milestone A at 27: is first value still right after A?**
   - Only once PM3-1 (base branch) and PM3-2 (pilot onboarding) are fixed. Otherwise the
     checkpoint either fails or quietly becomes a unit of hand work.
   - A few small items can leave A (PM3-13).
   - The first agent run at unit 19 is early enough to see behaviour. The usage premise could
     be tested before unit 01 (PM3-9).
3. **U1–U5 everywhere?**
   - **U1, U2, U3 and U5:** yes. The only gaps are that `00` misses U2/U5 and `doctor` doesn't
     show "one machine".
   - **U4:** no. The quick-track plan gate, the go/no-go and the docs MR differ between `01`,
     `07` and D-34 (PM3-7), and the `unpark` lists differ (PM3-12).
4. **Success and kill criteria:** the pass marks are now fixed up front, which is good. Two marks
   and the early stop rule aren't measurable as written, D-38 contradicts `07` (PM3-5), and the
   value check comes too late (PM3-6).
5. **Human actions:**
   - quick 2 (MVP-core) / 3 (after D);
   - standard 5-ticket 9 / 10–14 supervised;
   - full 7-ticket 14–20 per-ticket, 9–15 together.

   The table is above.
6. **PM2-1…PM2-19:** 12 closed, 7 partly (the table is above). None fully open.

## What's good / keep

1. The §7a layer table with "gap it leaves", and the honest residual-risk paragraph
   (`01:802-809`, `01:864-867`). This is how safety should be explained to the person who owns
   the machine.
2. Dropping the supervised `ship` gate and folding brief into PRD on `standard`. A real cut in
   ceremony without touching D6.
3. Pass marks fixed before data, with a value line (`07:284-295`). Once PM3-5 is fixed, it's a
   usable scorecard.
4. The pilot go/no-go note on usage at the checkpoint (`07:65`, `07:195-197`). It's the right
   question at the right time.
5. U5's "when needed" units (`07:250-252`). They stop D from blocking on speculative work.
6. Verdicts as structured output, and no work data committed (Q9 kept under U3). Less to leak,
   less to moderate.
