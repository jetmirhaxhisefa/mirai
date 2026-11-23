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

### P2 Your read (1 Sonnet run)

1. `cd ~/Projects/mirai-u40 && node test/probes/verify-probes.js --yes --probe p2 | tee ~/mirai-u40-p2.txt`
   You see `P2: Vera on 34's P3 PRD (model …): N must-fix, M suggestions`, then each finding with its
   quote, what, fix and "your call: would have sent it back / wrong".
2. For each must-fix, reply with its id and your call. **Pass when** each must-fix is "would have
   sent it back" and none is "wrong".

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

## For later units

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

## What I'm unsure about

- **Whether Vera reads the sources a context file cites.** Her prompt says to open a cited file in
  the project; `Read` reaches the checkout. P1's `business.md` seed (a claim its source doesn't
  say) is the test of it.
- **False must-fix findings on clean documents.** The examples were written to pass the lint and the
  reader test, not a strict reviewer; P1's "no must-fix on a clean document" may fail on a real gap
  in an example. If it does, I'll show each finding so you can judge it, as in P2.
- **Turn and time limits** (`VERIFY_MAX_TURNS = 40`, 20 minutes) are guesses until P1 measures them.

## The full suite

(Filled in when the build runner's job lands.)
