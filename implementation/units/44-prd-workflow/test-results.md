# Unit 44: test results (2026-11-26)

**Waiting for the probes and your approval.** Built on `unit/44-build` from `origin/main`
(`6209a8c`: 42 and 43 merged), with `origin/unit/43-rechecks` merged in (PR #131: the re-check
notes). The spec's later sections are what was built, in their order: "To interview before the
build", "Re-checked against 42 as built", "The look-ahead" (your Q1–Q4 and the statement of intent)
and "Re-checked against 43 as built". Where the spec and the code as built disagreed, the build
follows 42's and 43's pattern; each is under "Changed from the spec", and the open ones under
"Questions for Jet".

## What was built

- **The routing** (`src/docs/route.js`, new). MIRAI runs Vera between Nora's launches (41), and her
  must-fix findings go to Nora's next launch as `findings.md` in two lists, each finding with its
  fingerprint (its quote and its `what`): `fix_these` (writing) and `ask_these` (decisions). A
  decision is asked at once, in any round, and uses no round. Nora writes `(open)` where the answer
  goes, adds the question to `interview.md` in the finding format (`Finding:`, `Kind:`, the four
  answers as options, her guess) and pauses. A finding you dismissed is dropped for that version,
  and the drop is logged (the books' `drops`, a `dismissed` step). **MIRAI's invented-decision
  check:** after each of her launches, an asked decision whose quoted text changed with no `(open)`,
  no cited `Q-n` and no dismissal is MIRAI's own `invented` finding (must-fix, a decision), routed
  as one; the same decision answered by her twice ends the run `failed`.
- **The books** (`src/loop/docs.js`, new): `<store>/loop/docs/<id>@v<n>.json` (`prd.md` is `@v1`,
  `prd.v2.draft.md` `@v2`). Rounds per check (`verify`, `reader_test`), counted when a check runs on
  a new hash after a result with open writing must-fix findings; the decisions asked and answered;
  your dismissals and "not a decision" findings; `answer_runs`; the rounds-out and too-many state;
  the cost in the loop guard's ledger fields (`BUDGET`, now exported). The guard's lock and atomic
  write; no L2, L4 or L5. A file that can't be read refuses, never resets. **The cap moved to the
  books:** Nora gets a fix launch while the books' `rounds_used.verify` is under `[docs]
  verify_fix_rounds`; your new answers start a new cycle of rounds (41's P4 rule), except the
  rounds-out step's answer run, which continues the cycle it ran out in (so approval sees the last
  round).
- **The four answers**, read as a run starts (`takeAnswers`): each answered question from a finding
  writes one `decision_answer` line; `vera-wrong` dismisses the finding for the version,
  `not-a-decision` sends it back as writing, `reopen`/`go-on` record your choice; Nora's continue
  step gets `decisions.json` (each answer, its type and what to do: write it in citing `(interview
  Q-7)`, remove the `(open)`, fix it, or move it to Open questions "Accepted open (…)").
  `decision_question` lines are written when her questions appear in `interview.md`.
- **Too many:** past `[docs] max_decision_questions` (default 5, 1–20, project file only) open on
  one version, MIRAI writes the one question itself (`Kind: reopen`, A reopen the brief interview,
  B go on), sets the interview `paused`, commits it as her documents are, and the run ends paused.
- **The rounds-out step:** writing findings still open after the last round go to her `sort` step
  (`findings.md` says the rounds are used); what only you can decide becomes a question and she
  pauses; after your answers one answer run (`answer_runs`, not a round), Vera once more, and the
  documents go to approval with what's left.
- **`(open)` in the brief and the PRD** (`src/lint/open.js`, new): a warning naming its `Q-n`
  (`prd-open-decision`, `brief-open-decision`), an error at approval. "interview.md Q-7" and
  "interview Q-7" name the interview's question, not the document's own ID (the unknown-ID rule
  skips them). An Open questions line "Accepted open (<who>, <date>)" passes approval's `prd-open`
  and the summary's "Decisions for you" rule.
- **Approval** (`approvePrd`): refuses `(open)` (the lint), counts your dismissals out (the books),
  shows a result whose open findings are all decisions as yours to decide at once, records
  `vera_open` (the open must-fix fingerprints) in the signed line, and then publishes the initiative
  (38's `docsPublish`): one `published:` line, then the documents' lines last, with their host link
  once pushed. A failed publish leaves the approval and names `mirai docs publish <initiative>`; on
  the local store it says there is nothing to do.
- **`pre-commit`** (`src/hooks/pre-commit.js`, new; called from 39's hook in `hook.js`): refuses a
  staged document whose type has `status = "forbidden"` with a `status` field (file and line); a
  staged file under `.mirai/records/` that doesn't verify against the committed keys (a proof or a
  `branch.json`) or isn't a record MIRAI writes; warns, and lets the commit through, when the change
  makes your last signed approval stale (its seq, `prd.v2.draft.md`, or approve again). The repo's
  own `pre-commit` runs first (39's forwarding, unchanged).
- **`/mirai-new "<request>"` and `/mirai-prd "<request>"`**: two command files beside `/mirai`,
  rendered from the adapter (`MIRAI_COMMAND_FILES`, `commandPaths`, `commandText`; render, the lock
  and `isManaged` take all three), and `/mirai new|prd "<request>"` in the `/mirai` file. The intake
  is the skill's: at most 2 questions, the track proposed with its reason, your yes; `quick` → 42's
  one-ticket path, `standard`/`full` → the interview, then Nora.
- **The interview** (template `interview@v2`): an optional `## Intake` (`### I-n`, `Track: <track>,
  because …`, `Track confirmed: yes (date)`) and an optional `## Assumptions` before the
  restatement; a new registry key `may_be_absent` lets a document leave both out entirely. The
  interview lint: at most 2 intake questions, the track and its reason, quick ↔ `for: ticket`; each
  assumption numbered, with its source, and approved (`Approved: yes` or `Approved: corrected: …`)
  in a confirmed interview; a question from a finding with its `Finding:` (fingerprint), `Kind:`, the
  four answers and a matching `Answer type:`. The brief's track must be the intake's.
- **The look-ahead** (your Q1–Q4): the skill's new step before the restatement reads the PRD's
  checklist; a shaky guess is a question, a confident one an assumption with its source, in one
  list approved with "ok" or corrected by number. Nora's prompt: the approved assumptions are your
  answers; the PRD carries each under the same `A-n` ("Approved in the interview."), cites it, and
  never pauses on one (lint `prd-interview-assumption`). Vera: a new `[vera]` line, and the
  interview is her input beside a PRD (`upstream-interview.md`).
- **Vera's incremental re-check** (40's P3, your "B"): from her second check in a cycle, her input
  holds `previous-findings.json` and `changes.diff` (the lines changed since the text she checked
  last: this run's, or git's on the repo store), the prompt says so, and a new finding on unchanged
  text is dropped and logged ("checked before and unchanged since"), unless it is top-vs-detail or
  repeats a previous finding's quote. Nora's run and Tess's (in-run) pass it.
- **`mirai show <initiative>`**: "waiting for you: 3 questions in interview.md (Q-7…Q-9): …" while
  the interview is paused with open questions. No DOCUMENT state changed.
- **Docs:** `docs/documents.md` ("From request to approval" gains the way in, the tracks, the
  look-ahead, writing or decision, the four answers, too many, the rounds-out step, publishing),
  `docs/pre-commit.md` (new, listed in `docs/README.md`), `docs/config.md`
  (`docs.max_decision_questions`), `docs/loop-rules.md` (a document's books), `docs/agents.md`
  (`/mirai new`, `/mirai prd`). The design rows and the 40/41/42 spec notes were added when this
  spec was approved; nothing else there changed.

## Tests

`test/documents/prd-workflow.test.js` (18 tests). No model runs: fake launchers for Nora, Vera and
the reader, on the sample app's documents (`test/fixtures/sample-due-dates/`: a personal task list,
no teams, no email; they lint clean, at approval too).

- **T1 Intake and routing:** the three command files and the `/mirai` line; at most 2 intake
  questions (3 refused, `interview-intake`); quick needs `for: ticket`; the brief's track is the
  intake's; the 42 re-check: a quick ticket interview from `/mirai-new` with a fourth question
  offers the standard track, never `/mirai-new`.
- **T2 Labels:** F1 writing, F2 `audience`, F3 `scope`, each with its `kind_reason`; a finding
  without `kind` is dropped and logged and the others count (40's P1 rule); the checklists and
  Vera's prompt carry the rule.
- **T3 Rounds only for writing:** the books' rule; F2 alone is asked in round 1 (`decision_question`
  round 1, `audience`, its fingerprint), no round used; F1 fixed in one round.
- **T4 `(open)` at approval:** warns naming Q-4; `mirai approve` refuses it, naming it; after "leave
  it open" (`(Q-1)` and "Accepted open (…)") the pair is approved; not accepted, still refused.
- **T5 Invented decision:** F2's quote replaced with "or an admin" and no answer → MIRAI's
  `invented` finding in her next `ask_these`; Vera's own `invented` is routed as a decision.
- **T6 The four answers:** four questions answered (answered, vera-wrong, not-a-decision,
  left-open) → four `decision_answer` lines with their types; `decisions.json` names each; F3
  dismissed for `@v1` (dropped and logged) but raised by `@v2`'s books; F4 comes back as writing.
- **T7 Too many:** 6 decisions with the cap at 5 → MIRAI's own `reopen` question, no launch, the
  run paused; both choices recorded (`reopen`, `go-on`); 0, 21 and a personal file refused.
- **T8 Rounds out:** F1 open through 3 checks → `fix, fix, sort`; her question from it
  (`rounds-out`, `number`); after your answer one answer run, `answer_runs` 1, rounds still 2, Vera's
  round 4 in the same cycle, done with 1 open; approval shows "1 finding open after the last round".
- **T9 Approve anyway:** 2 open after round 3 → "2 findings open", `vera_open` holds both
  fingerprints in the signed line; a decision-only result is "each a decision only you can make".
- **T10/T13 Publish and links:** approval with no host says "published: not yet: …; your approval
  stands … mirai docs publish own-due-dates", the documents' full paths last. Through a fake host:
  38's tests (`test/store/docs-publish.test.js` T5/T6/T8) approve the PRD, which now opens the
  docs merge request (GitLab `!1`), and the last lines carry the host link.
- **T11 `pre-commit`:** a staged `status: approved` refused (file and line 7); a proof that doesn't
  verify refused; a file MIRAI doesn't write under `.mirai/records/` refused; an edit to the
  approved PRD warns with its seq and both ways out, exit 0; the installer writes and checks
  `pre-commit` beside `pre-push`; a repo's own `pre-commit` that exits 1 refuses, naming it; one
  that exits 0 runs first, and MIRAI's checks run after it.
- **T12 The books:** `@v1` and `@v2` separate; `doc-PRD-1` (a ticket's counters) and `PRD-1@v1`
  apart; the cost lands; an unreadable file refuses (`docs-loop-unreadable`).
- **T14 Show:** "waiting for you: 3 questions in interview.md (Q-4…Q-6)"; the DOCUMENT machine
  unchanged.
- **T15 The docs:** named in `docs/` (and 34b's check passes).
- **The look-ahead:** approved together or corrected by number; an unapproved one refused in a
  confirmed interview (not in a paused one); no source refused; the PRD's carry lint; Nora's prompt,
  Vera's checklist line, the skill's step; Vera gets the interview.
- **40's P3 (incremental):** her second check gets her previous findings and the diff; a new
  finding on unchanged text is dropped and logged.
- **43 and 42:** Nora's prompt retires an ID; the decision question uses `PAUSE_PLACE`; the
  hand-off's two lists with fingerprints; the answer type read from the option chosen.
- **The probes' tooling:** `--check` builds all four homes clean (the seeded PRD lints clean; a
  hand-set status refused at commit); `--auto` runs both look-ahead sides and P1 with stand-in
  launches (the summary's pauses and Vera's lines; P1's approval, its publish line and the commit
  refusal); nothing in `src/` imports the probe.

**Tests changed by this unit** (each pin, and why):

- `test/documents/nora.test.js` 41 (P4's run): after the last round Nora sorts what's left (the
  rounds-out step); the fake brief writer now changes nothing on that step, so Vera's three rounds
  are as before.
- `test/store/store.test.js` T10: the event-type list gains `decision_question` and
  `decision_answer`.
- `test/store/docs-publish.test.js` 38 T6 (GitLab): approving the PRD publishes it, so the merge
  request is open before the first `publish` (`updated`, since the epic's approval changed its
  table), and the approval's output names it.
- `test/detect/detect.test.js` 17a T8: the instruction files a project holds gain
  `.claude/commands/mirai-new.md` and `mirai-prd.md` (rendered by `mirai init`).
- `test/lint/template-versions.json`: `interview@v2` (the Intake and Assumptions sections).

## Probes (real)

Not run (your weekly limit is near its reserve). `test/probes/prd-probes.js` holds them. Each works
in its own probe home under your home folder (its own MIRAI store, your token copied in, the
red-team gate stubbed green), on the sample app's request "Tasks need due dates: show when each of
my tasks is due, and which ones are late." Every approval in a home is signed with the probe home's
own key, never yours, and a journal note says so.

**Checked with no model:** `node test/probes/prd-probes.js --check` (stand-in token, temp folders):
four lines ("p1 … lint clean", "p2 … 8 seeds, a hand-set status refused at commit", "lookahead-
without …", "lookahead-with …"), exit 0. Run on this Mac: all four, exit 0.

**All of them run with `--auto`** (no typing). Cost estimates (your subscription):

| Probe | Command (from `~/Projects/mirai-u44`) | Models | About |
|---|---|---|---|
| Look-ahead, without | `caffeinate -i node test/probes/prd-probes.js --yes --auto --probe lookahead --side without \| tee ~/mirai-u44-la-without.txt` | Nora on Opus (brief, PRD, fixes, each pause's continue), Vera on Sonnet per version, 1–3 reader tests (Sonnet) | 40–90 min; 6–14 Opus launches |
| Look-ahead, with | `caffeinate -i node test/probes/prd-probes.js --yes --auto --probe lookahead --side with \| tee ~/mirai-u44-la-with.txt` | one look-ahead launch (Opus), then as above | 45–95 min |
| P1 | `caffeinate -i node test/probes/prd-probes.js --yes --auto --probe p1 \| tee ~/mirai-u44-p1.txt` | as "with", then the approval (probe key) and the commit check (no model) | 45–95 min |
| P2 | `caffeinate -i node test/probes/prd-probes.js --yes --auto --probe p2 \| tee ~/mirai-u44-p2.txt` | Nora's fixes and continues (Opus), Vera per version (Sonnet), a reader test | 40–80 min |

P1 by hand (your session does the intake): `node test/probes/prd-probes.js --probe p1` prints the
home and the steps (`/mirai-new`'s file in a session there; then `--yes --probe p1-run --home
<dir>`, which waits for your session at each pause, then prints the approval command).

### Before the probes (once, in Terminal)

1. `cd ~/Projects/mirai && git fetch origin unit/44-build`
2. `git worktree add --detach ~/Projects/mirai-u44 origin/unit/44-build`
   You see `HEAD is now at <commit> …`.
3. `cd ~/Projects/mirai-u44 && node test/probes/prd-probes.js --check`
   You see the four lines above, and the prompt comes back with no error.

### The look-ahead comparison (your Q1–Q4: accepted only if pauses fall and Vera is no worse)

1. Run the "without" command above. You see each step (`Nora: write the brief (round 1): ok`,
   `lint …`, `Vera …`, `AUTO: answered Q-4=A …` at each pause), then
   `--- lookahead-without: for your review ---` with `pauses: N (Q-…)`, `Vera on
   own-due-dates-brief: round r, M must-fix (…)`, the same for the PRD, the decision questions and
   answers, and `lookahead-without: PASS` (her run ended done; the home is deleted).
2. Run the "with" command. You also see `look-ahead: K assumption(s) (A-1, …), J new question(s)
   (…)` and `AUTO: the assumptions approved ("ok") …`, then the same summary for
   `lookahead-with`.
3. **Accepted when** the "with" side's `pauses:` is lower than the "without" side's, and its PRD's
   must-fix count is no higher, with no new kind among them. Send me both files.

### P1 A real request, end to end

The `--auto` command above. **Pass when** her run ends done, `AUTO: approve own-due-dates-prd: exit
0` with a `published:` line and both documents' full paths, and `pre-commit: refused
docs/mirai/own-due-dates/prd.md:<n>: a prd keeps no status …`; it prints `p1: PASS`. (In a probe
home there's no host, so the publish line says "not yet: …": see question 4.)

### P2 The seeded PRD

The `--auto` command above. The PRD is seeded with 3 writing problems, 3 decisions (a market, a
number, a scope), a finding the brief's NG-1 answers (reminders), and a bait for an invented number
(NFR-2, "quickly"): `P2_SEEDS` in the probe. Each pause is answered with Nora's guess, and the one
about reminders with "the verifier is wrong". **Pass when** (the summary and `git diff` in the home,
which is kept on a failure): the writing seeds are fixed within the rounds and reach you as no
question; the decisions arrive as questions with `audience`, `number`, `scope` and use no round;
the reminder finding is dismissed and not raised again; NFR-2 reaches approval with no number you
didn't give (an `(open)`, or the backstop's `invented`); the decision lines match the pauses.

## The red team

This unit touches the red team's cage (`cageOf`), so `u44-baseline-1` and `u44-redteam-1`
(`redteam-full`) are queued with the tests:

- **Cage roots and data:** `src/adapters/claude-code.js` (the two new command files and the
  `/mirai` line; `isManaged` takes all three), `src/install/render.js` (renders them),
  `src/config/config-schema.js` (`docs.max_decision_questions`), `src/store/journal.js` (two
  MIRAI-only event types, the approval's `vera_open`).
- **Code the cage reaches:** `src/lint/interview.js`, `prd.js`, `brief.js`, `summary.js`,
  `rules.js` and `open.js` (new), `src/config/registry.js` and `overlays.js` (`may_be_absent`):
  reached from the MCP server's `lint` tool. They only read and report.
- **Cases that change:** none expected. The new journal types are privileged (MIRAI's own;
  `LOG_TYPES` for agents and sessions unchanged), the command files are your sessions' (never an
  agent's bundle), and the lint reads only documents under the docs root. The adapter's rendered
  files change, so a project's framework copy refreshed with this unit renders two more files.

## Claude-only parts (Jet's standing rule, 2026-11-23)

Nothing in the workflow's path (`src/docs/`, `src/loop/docs.js`, `src/nora/`, `src/lint/`,
`src/hooks/pre-commit.js`) names Claude Code. What is Claude Code's today, each behind an existing
seam:

- **`/mirai-new` and `/mirai-prd`** are command files of the Claude Code adapter
  (`src/adapters/claude-code.js`, its profile's `[interactive] commands`); a Cursor or Codex
  adapter renders its own (or none: the intake is the `mirai-interview` skill's, in any session).
- **The tool names** in them (`mcp__mirai__mirai_command`, `mcp__mirai__mirai_status`) are how
  Claude Code names MIRAI's MCP tools.
- **Nora's and Vera's launches** go through MIRAI's launcher, as in 40–42.
- **The probes** run Claude Code through MIRAI's launcher; the look-ahead stand-in is a launch of
  the product manager with the skill's text as input: probe-level only.

## Changed from the spec

- **Event names:** `decision_question` and `decision_answer` (the journal's own form; the spec
  wrote them with hyphens).
- **A finding without `kind`** is dropped and logged, and the others count (40's P1, your "B"), not
  "the reply records nothing" (T2's wording, written before 40 was built).
- **Only must-fix decisions are routed.** A decision Vera graded a suggestion (a plain number a
  builder can build as written, 40's grading rules) stays a suggestion you see at approval.
- **The rounds' cap is the books',** not Vera's stored round: a decision-only result uses no round
  there. Approval still reads Vera's stored round, which is never below the books' count, so a
  document the books call "rounds out" is "after the last round" at approval too.
- **A result whose open must-fix findings are all decisions is yours at once** (state
  `decisions`: approval and the reader test take it; decision 1).
- **MIRAI writes the "too many" question itself** (`Kind: reopen`), with no launch: see question 3.
- **The intake and the assumptions live in `interview.md`** (`interview@v2`), as two optional
  sections a document may leave out (`may_be_absent`, a new registry key).
- **"interview.md Q-7" isn't an ID of the PRD's:** the unknown-ID rule skips a mention right after
  "interview" or "interview.md", so `(open)`'s pointer and a cited answer lint clean.
- **"Accepted open (<who>, <date>)"** on an Open questions line passes approval's open-question
  rule and the summary's "Decisions for you" rule: it's decided as open.
- **The published line comes before the documents' lines,** so 38's rule (the last lines are the
  files' paths and links) holds; the links then carry the pushed docs branch.
- **`/mirai new|prd "<request>"`** are skill paths in the `/mirai` file, as `/mirai ticket
  "<line>"` is (42): no server command, since the intake is a conversation.
- **The installer is unchanged:** 39 already writes MIRAI's `pre-commit`, forwards a repo's own and
  `mirai init --refresh` installs it; 44's checks run inside it.
- **Tess's pause questions keep 42's format** (no `Finding:`; they come from no Vera finding), so
  they aren't routed; a Tess question that is a decision is asked as any question. See "For later".
- **Vera's incremental re-check also runs in Tess's run** (within one run), for 42's late findings
  on the epic; a top-vs-detail finding is never dropped by it, so it may not cure those.
- **P2's feature is the sample app's** (due dates on your own tasks), not guest checkout: the
  sample app has no checkout, and 42's "For later" asked for a fixture that matches it.

## Jet's answers (2026-11-26): Q1 "A", Q2 "A", Q3 "A", Q4 "B"

**1: A,** as built: the interview's approved `A-n` keep their numbers in the PRD ("Approved in the
interview."), Nora's own guesses after them; the lint checks the carry.

**2: A,** as built: Nora's continue step writes "leave it open" (`decisions.json` says what to
write); the lint and approval are the backstop.

**3: A,** as built: MIRAI writes the "too many" question itself, with no model.

**4: B:** P1 accepts "published: not yet" in a probe home; the link is proved through the fake host
(38's tests). A real-host check is a follow-up (see "For later units"). No code changed for these
answers.

## Questions for Jet (answered above)

1. **The `A-n` IDs: the interview's assumptions and the PRD's own.** The PRD already has `A-n`
   assumptions (its own guesses, cited as `(BR-2) (A-1)`). Built: one numbering: the interview's
   approved `A-n` keep their numbers in the PRD's Assumptions, each ending "Approved in the
   interview.", and the PRD's own guesses come after them; the lint checks the carry. Options:
   **A** as built; **B** the interview's use their own prefix (`IA-n`), cited `(IA-2)` beside the
   PRD's `A-n`; **C** the PRD doesn't carry them, and a requirement cites `(interview A-2)`.
   Recommendation: **A**: no new ID kind, the PRD's trace form is unchanged, and Vera compares the
   same number on both sides.
2. **Who writes "leave it open".** Built: Nora's continue step (`decisions.json` says what to
   write), with the lint and approval as the backstop (an `(open)` left in refuses). Options:
   **A** as built; **B** MIRAI writes the Open questions line and replaces the `(open)` itself.
   Recommendation: **A**: the `(open)`'s wording is hers, so a mechanical replacement would often
   miss; the backstop holds either way.
3. **The "too many" question.** Built: MIRAI writes it (no model cost, always the same words).
   Options: **A** as built; **B** Nora's launch writes it, with her own guess. Recommendation:
   **A**.
4. **P1's "published with its link" in a probe home.** A probe home has no host, so P1's publish
   says "not yet" (the approval stands). Options: **A** P1 also pushes a docs branch and opens a
   docs PR on the GitHub sample app (as 43's P1 opened a code PR there); **B** accept the probe
   home's "not yet", with the link proved through the fake host (38's tests now approve, which
   publishes). Recommendation: **B** now, **A** as a small follow-up if you want the real link seen.

## For later units

- **45:** offers to start Tess after this approval, and merges the docs MR after the ticket set
  (38's rule, unchanged). Its quick path is `/mirai-new`'s quick track.
- **46:** a code loop's park becomes an interview (the same four answers); `mirai inbox` lists the
  `decision_question` lines waiting.
- **54 (CI):** checks the same rules as `pre-commit` on the host.
- **13's review:** the "Decision questions" log row reads `decision_question` / `decision_answer`
  and the books.
- **Tess's questions as decisions:** give her pause questions a `Kind:` (and route them), once 45
  chains her.
- **The install refresh after 45 (Jet's answer 4, "B"):** check approval's publish against a real
  host (a docs PR on the GitHub sample app, with its link), as part of that refresh.
- **Approvals committed** (38's committed-records idea): the hook's records check then covers them
  (the spec's follow-up).

## The full suite

**On the Mac** before the runner: `test/documents/prd-workflow.test.js` 18/18;
`test/documents/nora.test.js`, `verify.test.js`, `tess.test.js` green (88 with 44's); the touched
folders (`lint`, `documents`, `store`, `cli`, `mcp`, `adapters`, `install`, `hooks`, `setup`,
`docs`, `config`, `loop`) green after the pins above; `node test/probes/prd-probes.js --check`:
four lines, exit 0. **The full suite on the Mac** (`caffeinate -i npm test` at `91032cc`): 909/912,
the three failures pins and one stray persona name in a lint hint (38b T8: "then Nora" became "then
the brief and the PRD"); after the fix the three files and the touched ones rerun: 103/103. So
912/912 at the pushed head.

**Through the build runner** (a clean export each), queued at the pushed head: `u44-tests-1`
(tests), `u44-baseline-1` (baseline) and `u44-redteam-1` (redteam-full: cage files changed, see
"The red team") at `aab2213`: `u44-tests-1` **pass**, `u44-baseline-1` **pass**, `u44-redteam-1`
queued (running when Jet's answers came in, 2026-11-26). After them: test results only.
