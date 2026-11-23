# Unit 40: test results (2026-11-23)

Built on `unit/40-build` from `origin/main` (780f856: 38, 38b and 39 merged). The spec was
re-checked against 38, 38b and 39 first (the spec's last section); nothing there changed one of
your decisions.

## Tests

All in `test/documents/verify.test.js` unless named. The fixture is an installed repo with 33's
example initiative (`docs/mirai/due-dates/`: the brief with its Q-1 answered, its interview, the
PRD) and 36's example `business.md`, a committed key and a stand-in token. No model runs: a fake
launcher stands in for MIRAI's launcher, and for T1's real launch a stand-in `claude`.

- **T1 The agent:** `mirai-verifier` (Vera) is in the registry under the role `verifier`
  (read-only, step `verify`), `read_only`, with `Read`, `Glob` and `Grep` only, persona `Vera`; she
  may run under her role and never under `developer`; the `verify` step's tier is `standard`. Her
  prompt carries the three layers, the two grades, 44's writing-or-decision rule ("when in doubt:
  decision") and the `invented` decision, and says an `(open)` line isn't a finding. A launch (fake
  launcher) gets, as input files: `document.md` (the PRD, byte for byte), `checklist.md` (the
  checklist as `mirai show checklist prd` prints it, with its `[vera]` lines), `upstream-brief.md`
  (the brief its "Brief:" line links), `context-business.md` and `index.json` naming each with why
  (and each context file's approval state); the agent, role, step, round and the findings schema
  (inlined for `--json-schema`). A context file is checked against the others, not itself; a
  ticket is refused ("which the verifier doesn't check"). **A real launch** (stand-in `claude`,
  macOS): the arguments name `mirai-verifier`, carry `--json-schema`, run on the `verify` step's
  model (`claude-sonnet-5-5`), with no `Edit`, `Write` or `Bash`; the input folder holds the four
  files; the result is recorded with the line MIRAI found the quote on, the tier and the model. **An
  unapproved overlay of Vera** refuses her launch (`overlay-not-approved`) before Claude Code runs.
- **T2 Findings:** a fake reply with one finding per layer and grade (`checklist`/must-fix,
  `top-vs-detail`/suggestion, `context`/must-fix decision `scope` with `against`, `checklist`/
  suggestion) is recorded: 2 must-fix, 2 suggestions, `open`, round 1, each finding's line where
  MIRAI found its quote, `against` with the context file's path. A fifth finding whose quote isn't
  in the PRD is dropped and kept in the record's `dropped` list ("its quote isn't in
  document.md"), never shown as a finding; the output says "1 finding dropped". The output ends
  with `must-fix: 2`, then each finding, then the document's full path. A rerun on unchanged text
  reuses the result with no run. Three replies that aren't the schema (no `kind`, a review
  verdict, nothing) record nothing and use no round. The schema's own rules: a decision without
  `decision_type`, an `invented` suggestion, a context finding without `against` are refused; a
  quote of a file she wasn't asked to check, or an `against` quote that isn't in its file, drops
  the finding; line breaks and spaces don't matter to the match. In `test/findings/`: the corpus
  gains `verify-findings` (2 valid, 8 invalid, each at its path with its code).
- **T3 The gate:** a brief with no result is refused at approval, naming `mirai verify
  docs/mirai/due-dates/brief.md`, nothing written. One must-fix finding at round 1 of 3 is refused
  ("the author fixes them first"). At round 3 (the last) it shows "Vera (mirai-verifier): 1 finding
  open after the last round", the finding, "you can still decide …", and approval goes through;
  the line's `verifier` is that result's hash. After a change, a pass shows "Vera
  (mirai-verifier): passed (1 suggestion; round 4, …)" and its hash is recorded. With `[docs]
  verify = false` the brief is approved with no result and the screen says "off for this project";
  `mirai verify` is refused there (`verify-off`). `business.md` is gated the same way
  (`verifierFor` with the business type).
- **T4 Rounds:** `verify_fix_rounds = 1` and `reader_fix_rounds = 3` give 2 and 4 runs; the default
  gives 3 and 3 (34's). `6`, `-1` and `"2"` are refused, as is either key in a personal file. Through
  the gate, with one fix round, round 2's open finding reaches you; the reader test reports its cap
  as 4. 34's tests pass unchanged on the default ("round 1 of 3").
- **T5 Order:** the reader test on a PRD with no Vera result is refused (`verify-first`, "run: mirai
  verify docs/mirai/due-dates/prd.md, then the reader test"), and with her open finding at round 1
  too; no reader runs. After her last round it runs. With `verify = false` it doesn't wait for her.
- **T6 Misses:** rejecting a Vera-passed brief with the reason "the appetite is wrong: two weeks, not
  three" writes one `verifier_miss` line (MIRAI's, `by: script`) with the document, its type
  (`brief`), its path, the note and the passed result's hash; the screen says "recorded as a miss
  of Vera (mirai-verifier) …"; `mirai show due-dates` marks the row "missed by Vera
  (mirai-verifier): she passed it and you rejected it (…), <date>". Rejecting a brief with her open
  findings after the last round writes no miss.
- **T7 Checklists:** the Vera-checked types are exactly brief, PRD, epic, business, journeys and
  conventions (`verifier = true`), and each checklist (as the project sees it) has `[vera]` lines.
  A copy of the registry whose PRD checklist has none fails to load (`no-vera-items`). A type she
  doesn't check needs none. `business-checklist.md` keeps three lines for you (what was said, a
  missing market or legal rule, a stakeholder). In `test/documents/overlays-p1.test.js`: an
  overlay's added checklist lines render as `- [vera] …`.
- **T8 Session list:** `/mirai verify` is on the list (`tty`, an agent launch, like review), takes
  `docs/mirai/…` and `.mirai/context/…` files, refuses `.git/…`; `docs/agents.md`,
  `docs/documents.md` and `docs/config.md` name it, the naming-table row and the three keys; the
  docs check (34b, `test/docs/`) passes. The hand-off (Scope 9) puts only the must-fix findings
  between random markers no finding can fake, each `@` defused, ending "Fix these, then run mirai
  verify <file> again."; `mirai verify <file> --handoff` prints it for the file as it is now, with
  no run.
- **38b's T8** (`test/agent/naming.test.js`) now refuses "Vera" hard-coded in `src/` too.

**Tests changed by this unit** (each pin or fixture, and why):

- the pins: the command list (`verify`), the bundle and render lists (Vera's agent file), the
  journal's event list (`verifier_miss`), the agents in 37's T7 and doctor's overlay line,
  launch-token minters (`cli/commands/verify.js`), `custom add`'s hint (`mirai-verifier`);
- approvals in tests that aren't about Vera (31–38's): a helper (`test/helpers/vera.js`,
  `veraBefore`) records her pass for the file as it is now before each `approve --file`, and
  `passReader` records it before the reader test. The tests that are about her (above) don't use it.

## Probes (real)

Not run yet: each is a real Claude launch on your subscription. `test/probes/verify-probes.js`
holds them. Each tier works in its own probe home under your home folder (its own MIRAI store, its
own kept copy of your PATH's Claude Code, your token copied in), deleted afterwards (P3's is kept
until you delete it). Vera runs exactly as `mirai verify` runs her, with the red-team gate stubbed
green (a probe home has no red-team result; 24a's probes do the same).

**The set for P1** (checked with no model: `node test/probes/verify-probes.js --seeds-only`): 32's
example PRD, 33's example epic with its seven tickets, 31's P2 brief, 34's P3 PRD and 36's example
`business.md`, each clean, and each with one seeded defect per layer:

- **checklist:** an FR with no "when" (PRD), a business requirement with no outcome (brief), an AC
  delivered "for now", wired later (epic's SAMPLE-53), a claim whose source doesn't say it
  (`business.md`, 36's P2 finding);
- **top vs detail:** a push notice in the detail, missing from the summary;
- **context:** guests may comment through a shared link, against a `business.md` that says
  signed-in members only (the probe's own `business.md`, a team task app the clean documents keep).

A seeded defect counts when a must-fix finding on its layer sits on a seeded line. 18 documents
per tier.

### Before the probes (once, in Terminal)

1. `cd ~/Projects/mirai && git fetch origin unit/40-build`
2. `git worktree add --detach ~/Projects/mirai-u40 origin/unit/40-build`
   You see `HEAD is now at <commit> Unit 40: …`.
3. `cd ~/Projects/mirai-u40 && node test/probes/verify-probes.js --seeds-only`
   You see `P1's set: 5 clean documents and 13 seeded ones (each seed checked)` and 18 lines.

### P1 Vera's model (36 runs: 18 Sonnet, 18 Opus)

1. `cd ~/Projects/mirai-u40 && caffeinate -i node test/probes/verify-probes.js --yes --probe p1 | tee ~/mirai-u40-p1.txt`
   You see one line per document per tier as it finishes (`standard example-prd clean 0 must-fix …`),
   then a table per tier, then `verdict: PASS` or `FAIL` and `recommended default for [models.steps]
   verify: standard` (or `deep`). Expect tens of minutes; Opus is the slow one.
2. Send me `~/mirai-u40-p1.txt`. **Pass when** at least one tier says "every seeded defect caught on
   its layer, no must-fix on a clean document". I then set the default in `defaults.js`.

### P1's first run (Jet, 2026-11-23, at 7c14b76): FAIL, three causes, each fixed

Output: `~/mirai-u40-p1.txt`. Standard (Sonnet) ran all 18; deep (Opus) none.

1. **Deep: every check refused, `stale-bundle`** (the probe's error). The step's tier is the model
   written into Vera's rendered agent file, so `verify = "deep"` changed the bundle and the probe
   home never re-rendered it. Standard didn't change it (the default). MIRAI behaved as designed:
   the refusal's hint says `run mirai render (or mirai init --refresh), then commit`; the probe
   printed the message without it. **Fixed:** the probe home renders and commits after setting the
   tier, and prints refusal hints. A test now pins it (`40 P1's first run …`): a new tier is
   `stale-bundle` with the render hint until `mirai render` and a commit.
2. **3 standard replies "unreadable": a `context` finding with no `against`.** The prompt said
   `against` was needed but never that a missing one discards the whole reply, and it named "an
   upstream document" among the things to contradict, so Sonnet put PRD-vs-brief contradictions on
   the `context` layer. **Fixed:** the prompt and the schema's descriptions say every `context`
   finding has `against` (or the result is discarded); `context` means the `context-*.md` files
   only; a contradiction with an upstream document is a `checklist` finding with `against` naming
   it. Jet's answer (question 4 below, "B"): such a finding is now dropped and logged, and the
   other findings count.
3. **Must-fix findings on the clean documents, and two misses.** Each must-fix on a clean document:

   | Document, finding | What Vera said | Sort | Fix |
   |---|---|---|---|
   | example-prd V-1 | FR-3 (turn reminders off) isn't in the summary | (b) real | example PRD's summary now names FR-3 and FR-8 |
   | example-prd V-2 | the PRD's team lead differs from business.md's | (a) the probe's business.md | its glossary now says the PRD's definition |
   | example-prd V-3 | NFR-1's 2 s / 500 tasks, FR-7's 1-hour retry have no source | (c) too strict | prompt: an unsourced number a builder can build is a decision, graded suggestion |
   | example-prd V-4 | the summary hides NFR-2 (title and date only) and FR-8 (leavers) | (b) real | the summary names them (FR-4, NFR-2; FR-3, FR-8) |
   | p2-brief V-1 | the ask states the 60% and four weeks as settled; the detail calls them assumptions | (b) real | fixed in the probe's copy (31's file is its record) |
   | p2-brief V-2 | R-2's staged rollout and 1-month check appear only in the detail | (b) real | fixed in the probe's copy |
   | p2-brief V-3 | R-1 and the summary answer Q-1, still open | (b) real | fixed in the probe's copy |
   | p2-brief V-4 | business.md says members already comment | (a) the probe's business.md | it no longer says so |
   | business V-1 | "no single sign-on" cites S-1, the README, which doesn't say it | (b) real | example now cites S-2 (the owner) for it |

   (c) also covered 44's invented rule firing on a first check: 44's decision 3 makes an
   `invented` decision "a claim added since her last check"; the prompt had dropped "since her
   last check". It now uses `invented` only when given an earlier version, which 44's workflow
   provides; the docs say the same.

   **The misses:** p2-brief/checklist's BR-9 ("team members are told about new comments")
   repeated the brief's own BR-3 and answered its open Q-1, so Vera raised it as a conflict
   (top-vs-detail, decision), on the seeded line: (a), a two-defect seed. p3-prd/top-vs-detail's
   push notice contradicted the PRD's NG-6 ("no email or chat alerts"), and the example PRD's would
   contradict its A-1 ("email only"), so Vera raised it on the checklist layer, on the seeded line:
   (a) again. Now the brief's checklist seed is a requirement with no outcome, and a PRD's and the
   brief's top-vs-detail seed takes one summary bullet out, leaving its requirement in the detail
   (one defect, nothing else wrong). The epic keeps the push notice (caught on its layer). The
   probe's table now also shows "caught on any layer" beside the spec's "on its layer"; the
   verdict still uses the spec's rule.

### P1's second run (Jet, 2026-11-23, at a95fc61): not passed under the strict rule; the default chosen by Jet

Output: `~/mirai-u40-p1.txt` (the first run's: `~/mirai-u40-p1-run1.txt`). Both tiers ran all 18.

| | standard (Sonnet) | deep (Opus) |
|---|---|---|
| Seeded defects caught on their layer | 10 of 13 | 11 of 13 |
| Caught on any layer | 11 of 13 | 12 of 13 |
| Must-fix findings on the 5 clean documents | 6 (example-prd 2, p2-brief 1, p3-prd 3) | 14 (example-prd 3, epic 1, p2-brief 5, p3-prd 4, business 1) |

Verdict: **FAIL** under the strict rule (each seed must-fix on its layer, no must-fix on a clean
document). Both missed p3-prd/top-vs-detail (FR-14's summary bullet taken out). Standard also
missed p2-brief/top-vs-detail, and raised the epic's push notice on another layer. Deep raised
example-prd's on another layer, and graded business/checklist's seed (the price S-1 doesn't give)
a suggestion. Most must-fix findings on the clean documents were real gaps:

- the example PRD's "evening reminder" (UJ-2) against "day ends: midnight", and a team time zone
  never said to exist or be new;
- the example epic's AC-SAMPLE-55.2, which reassigned the leaver's task before checking she got
  nothing (deep);
- the example `business.md`'s "not this repo: sign-up, billing and email", which said they were
  missing rather than elsewhere (deep);
- in 34's P3 PRD: NG-1 to NG-4 cited but not defined there, the glossary's template rows, GDPR
  erasure against FR-21 and FR-14;
- in 31's P2 brief: the owner against the assignee. Deep's "internal, no outside customer" finding
  came from the probe's own `business.md` (probe construction).

**Jet's decision (2026-11-23, "A"): the default for `[models.steps] verify` is `standard`.** Sonnet
caught about as many seeded defects as Opus and raised far fewer must-fix findings on clean
documents, which means fewer rounds and less noise. Opus is one line away
(`[models.steps] verify = "deep"`). `STEP_DEFAULTS` in `defaults.js` already had `standard`,
so nothing there changed (the file is in the red team's cage, so not even its comment was touched);
T1's assertion names the decision.

**Fixed in MIRAI's examples** (each still lints clean, and 32's and 33's tests pass):

- PRD: UJ-2 reads "the nightly reminder"; "Exists today" names the teams' time zone.
- Epic: its summary line and SAMPLE-53's title say the reminder goes out at the day's end, not
  "the evening before".
- SAMPLE-55: AC .2 now checks a leaver's task still assigned to her (no reminder), and a new AC .3
  checks the new assignee is reminded.
- `business.md`: "Not in the product yet: sign-up, billing and email (S-2)."

Not fixed (skipped as nitpicks): the overdue page's tie-break. 31's and 34's recorded probe
documents are left as they are (see "For later units").

### P2 Your read (1 Sonnet run)

1. `cd ~/Projects/mirai-u40 && node test/probes/verify-probes.js --yes --probe p2 | tee ~/mirai-u40-p2.txt`
   You see `P2: Vera on 34's P3 PRD (model …): N must-fix, M suggestions`, then each finding with its
   quote, what, fix and "your call: would have sent it back / wrong".
2. For each must-fix, reply with its id and your call. **Pass when** each must-fix is "would have
   sent it back" and none is "wrong".

### P2's first run (Jet, 2026-11-23, at a95fc61): not passed

Output: `~/mirai-u40-p2.txt`. Vera (Sonnet) on 34's P3 PRD: 0 must-fix, 4 suggestions. Jet's read:

| Finding | Vera's grade | Jet |
|---|---|---|
| V-1 checklist, decision (scope): the brief's R-2 phased release and its four-week appetite appear nowhere in the PRD, and the approver isn't told | suggestion | would have sent it back |
| V-2 checklist, decision (money-legal): a removed person's name is kept forever, maybe against GDPR erasure (business.md:40), and the approver isn't told | suggestion | would have sent it back |
| V-3 checklist, writing: the glossary's examples are the template's | suggestion | ok |
| V-4 checklist, writing: journeys that don't cite every FR | suggestion | ok |

**Vera found the right problems and under-graded two of them.** Both were must-fix under decision 5
as written: the top part hides something, and an upstream commitment is dropped. In P1's second run
Sonnet graded V-2 and V-3 must-fix on this same PRD, so the grade also varied between runs. My P1
prompt change ("an unsourced number a builder can build is a suggestion") had pushed decisions in
general toward suggestion.

**Fixed:**

- **Vera's prompt** now has her choose the kind and `decision_type` first, then grade by a fixed list,
  "not by how serious it feels". The list: must-fix, always, for
  1. a context finding;
  2. a `scope`, `audience`, `money-legal`, `conflict` or `invented` decision the approver isn't
     shown;
  3. an upstream commitment (a BR, scope or no-go, rollout, appetite or budget, success metric)
     dropped or changed without the summary saying so; "the brief's phased release appears nowhere
     in the PRD" is the prompt's own example;
  4. a contradiction;
  5. a top part that hides or adds something;
  6. a builder left asking.

  Otherwise suggestion; an unsourced number a builder can build as written stays a suggestion. A
  decision already under "Decisions for you" is no finding.
- **The schema** asks in that order: where, against, what, layer, kind, `kind_reason`,
  `decision_type`, then grade (with the list in its description), then fix.
- **MIRAI holds rules 1 and 2 itself** (`regraded`, `src/verify/findings.js`): a context finding, or a
  decision of those types, is recorded must-fix whatever grade she gave, with hers kept as
  `vera_grade` and the rule as `graded_by`. Rules 3 to 6 need judgement and stay hers. On P2's
  first run this alone would have made V-2 must-fix; V-1 (`scope`) too.

P2 can be re-run as it is (`--probe p2`) once the probe's worktree is at this unit's head.

### P2's second run (Jet, 2026-11-23, at 1ce85bd): the read passed, the run lost a finding

Output: `~/mirai-u40-p2.txt`. Vera (Sonnet) on 34's P3 PRD: 3 must-fix, 1 suggestion, 3 dropped.
Jet's read:

| Finding | Grade | Jet |
|---|---|---|
| V-1: the brief's rollout plan (one team first, the 1-month SM-1 check) and SM-1's 3-month window are dropped | must-fix | would have sent it back |
| V-2: the appetite is dropped | must-fix | would have sent it back |
| V-3: NG-1 to NG-4 cited but not in Non-goals | must-fix | would have sent it back |
| the glossary's template rows | suggestion | — |

None was "wrong". But **3 findings were dropped**:

- `/findings/6/decision_type a decision names its decision_type`;
- twice, `document.md isn't an upstream document or context file she was given`.

**The GDPR finding** (FR-21 against `business.md:40`), which Jet called "back" in the first run, is
missing, almost certainly one of the drops. So P2 waits on a third run, which should show it as
must-fix with no drops.

**Fixed:**

- **`against: document.md`** (Vera cited the document itself for a contradiction inside it). MIRAI
  now accepts any file she was given as `against`, the document and an epic's tickets included,
  mapped to their paths. A `context` finding whose `against` isn't a `context-*.md` file is recorded
  as a `checklist` finding, with `vera_layer: context` kept. I chose this over a prompt ban: a
  contradiction inside the document is must-fix (rule 4), and it needs somewhere to point. The
  prompt names `document.md` as an `against` target.
- **A decision with no `decision_type`:** the schema now requires `decision_type` on every finding,
  `none` for a writing finding, so Claude Code's own structured-output check refuses a reply
  without it while Vera is still running, and she corrects it. MIRAI still drops a decision whose
  type is `none` (Jet's "B"). I didn't record it as `other` instead: that would be MIRAI choosing a
  type she didn't give. The record drops `none`, so a writing finding still has no type.
- **Drops are visible:** each dropped finding keeps its `what`. `mirai verify` lists them apart,
  under "dropped, not counted", with why and what each said, and the probe's report does the same.
  They're still never counted or shown as findings (Scope 2).

### P3 The loop (a session of yours, then 1 Vera run per round and 1 reader test)

1. `cd ~/Projects/mirai-u40 && node test/probes/verify-probes.js --probe p3-home`
   You see `the P3 home: /Users/…/.mirai-probes-XXXX` and the brief's path. Keep that folder path.
2. In a new Terminal window: `cd <the repo path it printed> && claude`
   (a fresh session, as 34's P3: it sees the project's rendered `mirai-write` skill). Paste:
   "Write a lite PRD for `docs/mirai/p3/brief.md` with the mirai-write skill and the PRD template
   (`mirai show template prd`), into `docs/mirai/p3/prd.md`, linking the brief as `Brief: [<its
   title>](brief.md)`. Run `mirai lint docs/mirai/p3/prd.md` until it's clean." Wait until it says
   it's done.
3. Back in the first window: `node test/probes/verify-probes.js --yes --probe p3-verify --home <the P3 home>`
   You see `round 1: N must-fix …`, each finding, and, if N > 0, the hand-off text.
4. If N > 0: paste the hand-off text into the session, wait for its fix, then repeat step 3 (round 2,
   then round 3 at most: the default is the first check and 2 fix rounds).
5. When step 3 says `No must-fix finding` (or after round 3):
   `node test/probes/verify-probes.js --yes --probe p3-final --home <the P3 home>`
   You see the lint's output and `reader test: pass …`.
6. Send me the outputs of steps 3–5. **Pass when** the must-fix findings are closed within the
   default rounds, and the lint and the reader test pass after the fixes.
7. Then delete the home: `rm -rf <the P3 home>`.

### The red team

This unit touches the red team's cage (`cageOf`, computed on this branch): `registry/agents/
mirai-verifier.toml` (cage data: every agent definition), `src/mcp/tools/commands.js` (cage root
`src/mcp/**`), and code the cage reaches: `src/config/registry.js`, `src/config/overlays.js`,
`src/config/config-schema.js` and `src/store/journal.js`. So the red-team
pass of each project goes stale once its framework copy is refreshed with this unit: a
`redteam-full` run (yours, or the build runner's) is needed after the merge, before agents launch
there again. No red-team case changes; Vera runs under the read-only template the red team
already tests (as Rex does).

## Changed from the spec

- **Approval with open must-fix findings and rounds left is refused** (Scope 5 names only "no
  result", "after the last round" and "a pass"). Decision 1 makes Vera a gate whose must-fix
  findings the author fixes first, so before the last round approval is refused, naming the fix
  (`verify-open`). The reader test is refused the same way (Scope 6: "a Vera pass, or Vera's last
  round"). See "Questions for Jet".
- **The miss event is `verifier_miss`**, not `verifier-miss`: every journal event name uses `_`.
- **"Reject with a note"** is approval's `r` and its one-line reason; `mirai approve` has no
  `--reject --note` flags, and the miss records the reason as its note.
- **The rung is logged when MIRAI knows the author's launch** (`authorLaunch`, for 41's Nora and the
  workflows): the verifier ladder then picks Vera's model against the author's and the run log has
  rung 2 or 3. A document written in your session has no author launch, so its line has the tier
  and model and no rung. See "Questions for Jet".
- **On standard, the brief needs its own Vera result** when it's approved with its PRD (decision 6
  lists the brief): approval shows both results, one under the other, and each signed line records
  its own.
- **P1's `business.md`** gets the checklist seed only: it has no summary for a top-vs-detail seed,
  and it is the context a context seed would need. The other documents are checked against a
  `business.md` written for the probe (a team task app), since 36's example says each person sees
  only their own tasks, which the due-dates and comments documents would rightly contradict.
- **The epic's seeds go in ticket SAMPLE-53**, which Vera checks with the epic, and the
  checklist seed is "for now, wired later" (the epic checklist's own line) rather than "an FR with no
  when" (an epic has no FRs).
- **Added for wiring:** `mirai verify <file> --handoff` (Scope 9's CLI: the hand-off for the file as
  it is now, no run); `mirai custom add --as mirai-verifier`; `.mirai/context/` paths through the
  session tool; setup's context guide commits a context file before `verify`.

## Questions for Jet

Answered (Jet, 2026-11-23): **1 A, 2 A, 3 A**, each as built.

1. **Approval before the last round, with must-fix findings open.** Options: **A** refused (built:
   decision 1's gate; the author fixes first); **B** shown and allowed, as the reader test does at
   any round. Recommendation: **A**. Approving a document Vera has flagged while the author still
   has rounds skips the fix loop the gate is for; when you think she's wrong, 44's "Vera is wrong"
   answer is the path.
2. **The rung for documents written in your session.** Options: **A** no rung when MIRAI didn't run
   the author (built); **B** always log rung 3 ("fresh context") for them, since the author's model
   is unknown. Recommendation: **A**: rung 2 and 3 say something about the author's model, and MIRAI
   doesn't know it; claiming one would make the log wrong. 41's Nora gives it the author's launch.
3. **A clean work tree before `mirai verify`** (every launch needs one, so the changes an agent makes
   can be told apart). On the repo store you commit a document before checking it; on the local
   store it's outside the repo and never stops it. Options: **A** keep it (built; the guides and
   `docs/documents.md` say so); **B** a later unit lets read-only launches start on a dirty tree
   (a cage change, with its red team). Recommendation: **A**: the committed text is also exactly
   what the result's hash names.

After P1's first run (Jet, 2026-11-23):

4. **A reply with one finding that breaks a schema rule** (P1: a `context` finding without
   `against`). **B**, as recommended: that finding is dropped and logged in `dropped` (as one whose
   quote isn't in its file), the others count; a reply that isn't the schema's shape still records
   nothing. Built in `findingsFrom` (`src/verify/findings.js`); T2 has the case; Scope 2 and T2 in
   the spec carry the dated note; `docs/documents.md` and Vera's prompt say so.
5. **P1's pass rule.** **A**: a must-fix on the seed's own layer, the default; the probe's "caught on
   any layer" column stays beside it.

## For later units

- **Jet, 2026-11-23:** he wants `/mirai <command>` in Cursor and Codex sessions too, not only Claude Code (today rows 71 and 73; 73 is "only when you actually use Cursor"). A roadmap change: interview after unit 40.

- **41 (Nora):** call `runVerify` with `authorLaunch` (her launch id), so the run log has the rung;
  pass `handoffText` to her next run; her role writes the document, then MIRAI commits it before
  `verify` (a clean tree).
- **44:** the books (`loop/docs.js`) can read Vera's rounds from `verify/<id>.json` in the store
  (`round`, `must_fix`, each finding's `kind`); the dismissal ("Vera is wrong") needs a fingerprint:
  `where.quote` normalized and `what`, as 44 says. The checklists' "invented decision" line is in
  (44's Scope 2). `approvePrd`'s `vera_open` field (44's Scope 8) goes beside this unit's
  `verifier`.
- **45:** the epic's Vera result covers its tickets (the subject hash includes each ticket file).
- **An external docs store:** its text reaches Vera inside 38's untrusted fence (`agentText`).
- **An epic over 32 files** (tickets, upstream and context together) is refused (`verify-too-large`):
  the default cap is 20 tickets, so it only bites a project that raised it; batching tickets is
  later work if it does.

- **Summary omissions in long documents are Vera's weakest catch** (P1's second run): both tiers
  missed a requirement whose summary bullet was taken out of 34's long P3 PRD, and Sonnet missed
  the brief's. The misses log (`verifier_miss`, PM-06) should watch for rejections that name
  something the summary hides.
- **31's P2 brief and 34's P3 PRD** are records of those units' probes and stay as they are. P1
  showed real gaps in them (the brief's owner against assignee; the PRD's undefined NG-1 to NG-4,
  its glossary's template rows, GDPR erasure against FR-21 and FR-14). A later probe set should use
  corrected copies, as P1 does for the brief's first-run gaps.

## What I'm unsure about

- **Whether Vera reads the sources a context file cites.** Her prompt says to open a cited file in
  the project; `Read` reaches the checkout. P1's `business.md` seed (a claim its source doesn't
  say) is the test of it.
- **False must-fix findings on clean documents.** The examples were written to pass the lint and the
  reader test, not a strict reviewer; P1's "no must-fix on a clean document" may fail on a real gap
  in an example. If it does, I'll show each finding so you can judge it, as in P2.
- **Turn and time limits** (`VERIFY_MAX_TURNS = 40`, 20 minutes) are guesses until P1 measures them.

## The full suite

**Through the build runner** (a clean export each):
- `u40-tests-2` at `a370534`: 802/803; the one failure was 17a's T8 pin of the instruction files
  in `.claude/` (Vera's rendered agent is a new one). Pin updated (`test/detect/detect.test.js`).
- `u40-tests-3` at `ccb437b`: **pass, 803/803**, 14.8 minutes.
- `u40-tests-4` at `1cfdfd3` (P1's first-run fixes): **pass, 804/804**, 15.8 minutes.
- `u40-tests-5` at `44443dd` (Jet's answer 4): **pass, 804/804**, 14.8 minutes.
- `u40-tests-6` at `46cffac` (P1's second run: the examples' fixes): **pass, 804/804**, 15 minutes.
- `u40-tests-7` at `1ce85bd` (P2's first run: the grading): **pass, 804/804**, 14.2 minutes.
- `u40-tests-8` at the next commit (P2's second run: `against`, `decision_type`, the dropped list): see the report.

**On the Mac** before them, by folder: `test/documents` 70/70 (with `verify.test.js`, 11),
`test/store`, `mcp`, `docs`, `config` 134/134, `test/setup`, `cli`, `install`, `adapters`,
`doctor`, `sign` 101/101, `test/redteam`, `trust`, `launch`, `lint`, `status`, `reports` 169/169,
`test/agent`, `run`, `review`, `proofs`, `loop`, `hooks` 188/188, `test/findings` 5/5,
`test/detect` 13/13.
