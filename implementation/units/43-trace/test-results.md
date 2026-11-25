# Unit 43: test results (2026-11-25)

**Built, waiting for the probes and your approval.** Built on `unit/43-build` from `origin/main`
(`ec9b07c`: 42 merged). The spec's two re-check sections ("Re-checked against 37 as built" and
"Re-checked against 42 as built", your Q1 "A") are what was built: MIRAI runs trace's documents
scope between Tess's launches, with the lint, and a missing link goes to her next launch in
`lint.json`; `mirai approve <epic>` runs it once more as the gate; the broker tool `trace(item)` is
for Kai and Rex. Where the spec and the code as built disagreed, the build follows 42's pattern;
each is under "Changed from the spec", and the open ones under "Questions for Jet".

## Tests

`test/documents/trace.test.js` (15 tests: the documents' scope, the code's scope as pure functions,
Tess's run, the epic's approval, the CLI, ID stability, the registry and the session list, the
probes' tooling) and `test/proofs/trace.test.js` (4 tests on 25a's fixture: the gate, the fix loop,
the proofs, the broker tool). No model runs: fake launchers and 25a's stand-in claude and test runs.

- **T1 The documents:** 33's example brief, PRD, epic and seven tickets trace clean (35 links: BR →
  FR, NFR → its method, every FR, NFR and AC → its ticket); a brief with a BR-4 no FR cites and
  SAMPLE-53 without AC-FR-4.5 in its `covers_ac` fail, naming both with their places (`prd.md`;
  `tickets/ (add it to the covers_ac of the ticket that builds it)`). **`mirai approve SAMPLE-50`
  refuses** while the trace fails (the brief gains BR-4 after the PRD's approval: the epic's own lint
  is clean, the trace isn't): "trace: the brief's BR-4 isn't cited by any FR or NFR
  (docs/mirai/due-dates/prd.md)", "mirai trace finds 1 missing link, listed above; nothing was
  written", journeys.md untouched; `mirai trace due-dates` exits 1 naming it; `mirai show due-dates`
  says "trace: 1 missing link, such as …: mirai trace due-dates". Fixed, the set is approved. The
  no-ops: "no ADRs yet (units 62–65)" and "no technical note yet (unit 62b)".
- **T2 The code:** `AC-SAMPLE-53.1: …` passed and nothing passing for AC-SAMPLE-53.2: trace fails
  naming AC-SAMPLE-53.2 and "plan.md, Test list". A test named `AC-SAMPLE-53.2: …` that failed
  doesn't count ("… failed in the gate's run"); `retries once (AC-SAMPLE-53.2)` doesn't count;
  `AC-SAMPLE-53.4, AC-SAMPLE-53.5: …` covers both. A runner's describe prefix ("Reminders ›
  AC-53.2: …") is read at its last part. **The plan's test list:** a row whose Test ID isn't in the
  results is "missing, or renamed" (with its line); one named without its AC is "name it
  "AC-SAMPLE-53.2: …"".
- **T3 Work tree vs gate:** PMT-31 with `tests/Feature/TeamRenameTest.php` in the repo naming
  `AC-PMT-31.2: …`, and a gate run whose results hold only AC-PMT-31.1's tests: trace fails on
  AC-PMT-31.2 (the test and its two plan rows); the file in the tree doesn't count.
- **T4 `e2e`:** SAMPLE-53 with `e2e: true` and all five AC tests but none carrying a journey fails
  ("… named with its journey (one of J-1, J-2) and an AC ID, such as "J-1, AC-SAMPLE-53.1: …"");
  with `J-1, AC-SAMPLE-53.1: …` it passes. A ticket that names J-2 needs J-2.
- **T5 `tests: optional`:** before 50, every AC fails with "QA evidence is needed; QA isn't built
  yet (unit 50)", never with a missing test; `qa: "not built yet"`.
- **T6 Ship:** the failing trace mints no proof; `<store>/tickets/PMT-31/trace.json` holds one
  must-fix per missing link (3: severity blocking, category `trace`, basis `{ kind: ac, ref:
  AC-PMT-31.2 }`); the loop guard judged it (`reviews` + 1); PMT-31 is back `in-progress`;
  `fixFrom` starts Kai's round from it; **his fix round** (stand-in claude) gets `trace.json`,
  counts as a round (`rounds_used` + 1) and hands over; Rex again; the gate with every test is
  recorded, and both proofs carry `trace: { result: pass, scope: ticket, links: 6, qa: "not built
  yet" }`; editing `links` in the committed proof breaks its signature (`bad-record`). **After the
  rounds:** with the ticket's 2 rounds used, a failing trace parks it `cap`, the note "Its rounds
  are used up. its 2 rounds are used; trace: AC-PMT-31.2 has no passing test named with its ID …".
  `mirai gate record` prints "trace: pass, 6 links (qa: not built yet)".
- **T7 Proof check:** proofs re-signed with your key: `trace` `fail` → `no-trace` ("its trace
  result is fail, not pass"); `n/a` minted 2026-11-20 → `pass`, and `mirai gate check` says
  "trace: n/a, accepted: minted before 2026-12-01, when mirai trace was built"; `n/a` minted
  2026-12-02 → `no-trace`, exit 1, naming the cut-off; no `trace` at all → not a proof
  (`bad-record`; MIRAI won't sign one).
- **T8 Broker tool:** both strict templates (read-write and read-only) offer `trace`
  (`mcp__mirai__trace`); the tool refuses `{}`, `../outside`, `/etc/passwd`, `a;touch /tmp/x` and an
  extra `paths`; on PMT-31 with two kept signed gate results it returns the trace as data (`fail`,
  scope ticket, `gate_run: true`, the three missing links, AC-PMT-31.1's passing link), and neither
  the work tree nor any file of the store changed (sizes and times). `mirai trace PMT-31` reads the
  same kept results.
- **T9 ID stability:** the approved PRD's FR-4 replaced by a different FR-4 fails
  (`id-stability`: "FR-4 meant "When a day ends, …" in the version you approved; it now says "When a
  lead opens the team page, …": an ID that existed in an approved version never comes back with
  another meaning"); a rewording passes; with no approved version nothing is compared; a ticket's
  own AC (AC-SAMPLE-53.2) the same.
- **T10 The docs check** (34b, `test/docs/coverage.test.js`) passes: `mirai trace` and `/mirai
  trace` are named (`docs/trace.md`, new, listed in `docs/README.md`; `docs/agents.md`'s session
  list and plan step; `docs/documents.md`, "The chain: mirai trace").
- **The re-check against 42:**
  - **Trace inside Tess's run** (Q1 "A"): her first draft drops AC-FR-4.5; her second launch gets
    `lint.json` with one `trace-coverage` entry naming it and where to fix it (trace's entry stands
    for the graph lint's own); the lint step's event carries `trace: fail, missing: 1`, then
    `trace: pass`; done.
  - **NFRs through `covers_fr`:** SAMPLE-53 without NFR-2 and AC-NFR-2.1 → both missing; with NFR-2
    in `covers_fr` only → NFR-2 passes, AC-NFR-2.1 missing. NFR-1 is "verified by: a measurement";
    NFR-2 by its own AC.
  - **Doesn't apply:** a lone ticket's interview folder (`for: ticket`, no PRD) is `n/a` ("trace its
    ticket instead: mirai trace <KEY>"), and `mirai trace log-format` exits 0 saying so; the
    investigation example is `n/a` ("no tests to trace"); a "Spike" written as a story that runs as
    `investigation` is `n/a`, a "Chore" that runs as `change` is traced (keyed on `runs_as`).
  - **The 37 re-check:** the plan's Test list is read by `trace`; story and bug protect `e2e`,
    `tests` and `tdd` (read by `trace`, `gate`), still template v2.
  - **The session list (21f):** `trace` with `ticket` (a key or an initiative); the `/mirai` file's
    step 1 names it.
- **The probes' tooling:** P3 `--auto` on a temp home (the probe key approves the PRD; the set's
  approval refuses naming AC-FR-4.5; `mirai trace` names it and where), P1's two-AC ticket, P2's hand
  edit (only the branch's test files), and nothing in `src/` imports the probe.

**Tests changed by this unit** (each pin, and why):

- `test/proofs/fixture.js`: the stand-in gate runs (`passing`, `coveringRun`) report their cases
  (`cases.json` and its hash, as a real run's signed result holds), named with PMT-31's ACs, and the
  fixture's plan names its tests with them: every proof is minted after trace now. `passed()` and
  `approvedTicket()` take `extra` files.
- `test/proofs/gate.test.js` 25a: the review proof's `trace` is the result, not `"n/a"`; the
  baseline case's failing stand-in run reports its cases too.
- `test/probes/fix-probes.js`: `setup` takes a stand-in `token` (for `trace-probes.js --check`).
- `test/cli/cli.test.js` T14: the command list gains `trace`.
- `test/mcp/broker.test.js` 15a T1: the tool table gains `trace` (headless and interactive).
- `test/launch/strict.test.js` (T5/T6, 14d T8, 15a T7, T7's init check), `test/agent/plan.test.js`
  (T2, T5, the launch's agent tools): every launch's allowed MCP tools and its policy gain
  `mcp__mirai__trace` / `trace`.
- `test/mcp/session.test.js` 15b T1, T7, T9: your session's server offers `trace` too (its tools
  come from the read-write template), so its allow rules gain `mcp__mirai__trace` (10, not 9).
- `test/documents/overlays.test.js` 37 T3: a story overlay that lists its `lint_checks` keeps
  MIRAI's new `id-stability` (a project may add a check, never remove one).
- `test/documents/epic.test.js` 33 T8: `mirai show <initiative>` has one line more, the trace.

## Probes (real)

Not run: P1 and P2 are real Claude launches on your subscription and open a PR on your GitHub
sample app; P3 needs no model. `test/probes/trace-probes.js` holds them. Each works in its own probe
home under your home folder (its own MIRAI store, your token copied in for P1/P2, a stand-in for
P3), with the red-team gate stubbed green. **Every approval in a home is signed with the probe
home's own key, never yours** (a stand-in terminal, as 28's r1 and 42's `--auto`), and a journal note
says so.

**Checked with no model** (`node test/probes/trace-probes.js --check`, a stand-in token, temp
folders): two lines, "p1/p2 SAMPLE-1 with two ACs: home built, tree clean; trace before a gate run
names AC-SAMPLE-1.1, AC-SAMPLE-1.2" and "p3 the example set without AC-FR-4.5: home built, trace
fail, missing AC-FR-4.5". Run on this Mac: both lines, exit 0.

**Which run with no typing:** P1 and P2 always do (the probe approves the ticket and the plan with
the probe home's key, as 28's r1). P3 does with `--auto`; without it, it prints your steps.

**Cost:** P1: Kai's plan and build, Rex's review (Sonnet), about 40 minutes, Docker. P2: P1 plus
Rex's review of the hand edit, Kai's fix round, Rex again (Sonnet), about 60 minutes. P3: no model.

### Before the probes (once, in Terminal)

1. `cd ~/Projects/mirai && git fetch origin unit/43-build`
2. `git worktree add --detach ~/Projects/mirai-u43 origin/unit/43-build`
   You see `HEAD is now at <commit> Unit 43: …`.
3. `cd ~/Projects/mirai-u43 && node test/probes/trace-probes.js --check`
   You see the two lines above, and the prompt comes back with no error.
4. Docker Desktop running (P1, P2), and `gh auth status` says you're logged in to github.com (P1,
   P2 open a PR on `jetmirhaxhisefa/mirai-sample-app`).

### P1 A real ticket ships through trace (Sonnet; about 40 min; no typing)

1. `cd ~/Projects/mirai-u43 && caffeinate -i node test/probes/trace-probes.js --yes --probe p1 | tee ~/mirai-u43-p1.txt`
2. You see `AUTO: SAMPLE-1 approved with the probe key (two ACs: AC-SAMPLE-1.1, AC-SAMPLE-1.2)`,
   the run's steps (`p1-run1: [plan] …`), `AUTO: the plan approved with the probe key`, a
   `p1-plan:` line listing the plan's test names that carry an AC, then `p1-run2: [baseline] …
   [build] … [review] … [proofs] … [ship] …`, `p1-gate: recorded` with `trace pass, N link(s)` and
   an `ok` line per link, the `p1-check|` lines of `mirai gate check` and the `p1-trace|` lines of
   `mirai trace SAMPLE-1`, then the clean-up lines.
3. **Pass when** `p1-gate` is recorded with trace pass and both AC links (AC-SAMPLE-1.1 and
   AC-SAMPLE-1.2, each `ok … → <test>`), `p1-check|` says `pass` with `trace: pass`, and
   `p1-run2: finished; PR https://github.com/…` is there: the probe then prints `p1: PASS` and exits 0 (else `p1: FAIL: <why>`, exit 1). Send me `~/mirai-u43-p1.txt`.
4. The probe deletes its home; a run that stopped short keeps it and prints the delete line.

### P2 A missing test stops it (Sonnet; about 60 min; no typing)

1. `cd ~/Projects/mirai-u43 && caffeinate -i node test/probes/trace-probes.js --yes --probe p2 | tee ~/mirai-u43-p2.txt`
2. As P1 until the gate; then `p2-hand: AC-SAMPLE-1.2 taken out of <the test file>, committed;
   Rex reviews that commit first`, `p2-review: …`, `p2-gate: trace-failed` with the missing lines
   naming AC-SAMPLE-1.2, `p2-fix: handed-over`, Rex again, `p2-gate: recorded` with trace pass, the
   check and the PR.
3. **Pass when** the ship stops at the gate with trace naming AC-SAMPLE-1.2, Kai's fix round names
   the test again, and the ticket then ships (`p2-run2: finished; PR …`): the probe prints `p2: PASS` (else `p2: FAIL: <why>`, exit 1). If `p2-review` isn't
   `pass` (Rex caught the missing test first), the run says so: trace's stop wasn't exercised, and
   it's for us to look at, not a pass. Send me `~/mirai-u43-p2.txt`.

### P3 The documents at approval (no model; about 1 min)

With no typing: `cd ~/Projects/mirai-u43 && node test/probes/trace-probes.js --probe p3 --auto | tee ~/mirai-u43-p3.txt`
You see `AUTO: approved due-dates-prd with the probe key (seq n)`, `AUTO: approve SAMPLE-50: exit 4`,
the refusal's lines naming AC-FR-4.5, the trace's `fail` and `missing` lines, and `p3: PASS: …`.
The home is deleted after.

By hand (you see each refusal yourself):

1. `cd ~/Projects/mirai-u43 && node test/probes/trace-probes.js --probe p3`
   It prints the home's path and three commands, every path filled in.
2. The printed `approve due-dates-prd` command. You see the brief and the PRD, "one decision
   approves both", Vera passed, the reader test passed. Answer `a`, then type `due-dates-prd`.
3. The printed `approve SAMPLE-50` command. You see it refused before any question:
   "AC-FR-4.5 (an AC of FR-4, Triggers and states) isn't covered by any ticket" and "nothing was
   written".
4. The printed `trace due-dates` command. You see `trace due-dates (the documents): fail`, an `ok`
   line per link, and `missing  AC-FR-4.5 isn't covered by any ticket (fix in:
   docs/mirai/due-dates/tickets/ (add it to the covers_ac of the ticket that builds it))`.
5. **Pass when** step 3 refuses naming AC-FR-4.5 and step 4 names it with where to fix it.
6. Delete the home (the printed `chmod -R u+w <home> && rm -rf <home>`).

### The coordinator's run at `d86d112` (2026-11-25; checkout `~/Projects/mirai-u43`)

- **P3 `--auto`: PASSED** (`~/mirai-u43-p3.txt`).
- **P1 failed before trace ran** (`~/mirai-u43-p1.txt`, home `~/.mirai-probes-SOqYr6`): Kai named
  his PHPUnit tests with `#[TestDox('AC-SAMPLE-1.1: …')]` and methods
  `test_ac_sample_1_1_deleting_your_own_task_removes_it`, then stopped `blocked` (his own plan said
  to stop if the adapter reads only method names). It does: PHPUnit's JUnit report (`--log-junit`)
  names each `<testcase>` by its method, never by its TestDox text (the report is kept as
  `test/fixtures/junit/phpunit-trace-p1.xml`). Decision 2 ("the same in PHPUnit") didn't hold.
- **P2 failed before the review** (`~/mirai-u43-p2.txt`, home `~/.mirai-probes-mcrkn2`): "the
  overlay .mirai/custom/agents/mirai-reviewer.toml is not approved". The sample app carries 37's P2
  overlay (Rex with Bash), approved with your key; a probe home's key can't verify it.
- **Both printed their failure and exited 0.**
- **Fixed:**
  1. **PHPUnit method names count** (`namedIds` in `src/trace/ticket.js`): a method whose name
     starts with the ID in snake case, after an optional `test_`, each ID ending at `_` or the end
     (`test_ac_sample_1_1_…` → AC-SAMPLE-1.1; `…_and_ac_sample_1_2_…` both; `test_j_1_…` a journey).
     Only the ticket's own ACs, its plan's and the journeys are read this way, so
     `ac_sample_1_12` is never AC-SAMPLE-1.1; camel case isn't read (ambiguous). A plan row written
     with the TestDox text matches the method in the same file carrying the same IDs. Kai's prompt,
     the trace fix round's prompt, `docs/trace.md` and `docs/agents.md` say so. Test
     `43 (P1's finding)` reads P1's real report: both ACs pass, with the plan's TestDox rows.
  2. **The probe home drops the sample app's overlays** (`git rm -r .mirai/custom` in the clone,
     committed); `--check` now also says "overlays none".
  3. **P1 and P2 print `pN: PASS` or `pN: FAIL: <why>`** from what the run did (`shipVerdict`: the
     gates in order, the fix rounds, the gate check's word, the PR) and exit 1 unless it's a pass.
     Test `43 (P1 and P2's first runs)`.
  4. `src/trace/ticket.js` is reached from the MCP server's `trace` tool, so it is in the cage; its
     change only reads names. No case changes; `u43-tests-2`, `u43-baseline-2` and `u43-redteam-2`
     ran at the new head.

### P2's rerun (2026-11-25, at `747f0bf`, `~/mirai-u43-p2.txt`): stopped in the probe

- `u43-tests-3`, `u43-baseline-3` pass; `u43-redteam-3` **GREEN** (only the accepted
  `h-timeout-link` and `l-cd` fail) at `747f0bf`.
- P2's hand edit found nothing to take out: Kai named the tests the PHPUnit way
  (`test_ac_sample_1_2_another_users_task_cant_be_deleted`, Jet's Q3 "A"), and the edit looked only
  for the text form `AC-SAMPLE-1.2`.
- **Fixed (test tooling only, no cage file):** `withoutAc` in `test/probes/trace-probes.js` takes the
  ID out of both forms: the text form (`AC-SAMPLE-1.2: …` in a TestDox or a free name) and the
  method name (`test_ac_sample_1_2_x` → `test_x`; `…_and_ac_sample_1_2_…` dropped; a method that is
  only the ID → `test_ac_taken_out_by_the_probe`), so it stays a PHPUnit test that runs and passes
  and only trace notices. `--check` runs it on a sample PHPUnit file (a third line: "p2 the hand
  edit on a sample PHPUnit file: AC-SAMPLE-1.2 taken out of its TestDox text and its method name;
  AC-SAMPLE-1.1 kept; still a test_ method"). Test `43 (P2's rerun)`.

## The red team

This unit touches the red team's cage (`cageOf`), so a `redteam-full` run is queued with the tests:

- **Cage roots and data:** `src/launch/strict.js` (every strict template gains `mcp.trace`; the
  policy's tools and the allowed MCP tools gain `trace` / `mcp__mirai__trace`; `renderStrict`
  accepts it), `src/mcp/tools.js` and `src/mcp/tools/trace.js` (new: the broker tool),
  `src/mcp/server.js` (the policy check: `trace` takes no settings and needs the store),
  `src/mcp/tools/commands.js` (the `trace` session command), `src/adapters/claude-code.js` (the
  `/mirai` file's step 1), `registry/document-types/story.toml`, `bug.toml`, `prd.toml`,
  `plan.toml` (protected fields, `lint_checks`, a reader).
- **Code the cage reaches:** `src/lint/checks.js`, `lint.js`, `prd.js`, `ids.js` (new),
  `src/config/registry.js` (`id-stability`, its `CHECK_READS`), `src/config/overlays.js` (a protected
  field MIRAI's own template leaves out isn't demanded of a replacement), `src/trace/documents.js`,
  `item.js` and `ticket.js` (new), and two files the cage didn't hold before, which they read with:
  `src/agent/inputs.js` (the ticket as the integration branch has it) and `src/agent/tdd.js` (the
  plan's test rows). The pipeline itself stays outside (18f T1: no `build.js`, `plan.js`,
  `loop/guard.js`): the tool reads the store's plan and build record as files, and the ship-time
  half (`src/trace/gate.js`) and the docs-store reader (`src/trace/initiative.js`) aren't reached
  from the server. `src/redteam/cases-agent.js` changes too.
- **Cases that change:** `h-server-direct` (MIRAI's MCP server with no model) adds five hostile
  `trace` calls (no item, `../outside`, `/etc/passwd`, `a;touch /tmp/x`, an extra `paths`), each
  must be refused like the `lint` ones. The templates' canonical hash changes (a new `mcp` key), so
  each project's red-team pass goes stale after its framework copy is refreshed with this unit:
  `redteam-full` is needed there before agents launch again. No other case changes: `trace` reads
  only (the documents under the docs root, the store's plans and kept gate results), takes one name
  that can't be a path, and writes nothing.

## Claude-only parts (Jet's standing rule, 2026-11-23)

Nothing in trace's path (`src/trace/`, `src/cli/commands/trace.js`, `src/mcp/tools/trace.js`,
`src/lint/ids.js`) names Claude Code. What is Claude Code's today, each behind an existing seam:

- **The tool's name** `mcp__mirai__trace` is how Claude Code names an MCP tool (`MCP_TOOLS` in
  `src/launch/strict.js`, beside `lint`); the tool itself is MIRAI's MCP server's, which any client
  can call.
- **The `/mirai trace` step** is in the `/mirai` command file, the Claude Code adapter's
  (`src/adapters/claude-code.js`); Cursor and Codex adapters render their own; the session command
  table (`src/mcp/tools/commands.js`) is MIRAI's.
- **Kai's fix round from a trace** is a launch through MIRAI's launcher (`launchInRun`), as every
  fix round.
- **The probes** run Claude Code (Kai, Rex) through MIRAI's launcher: probe-level only.

## Changed from the spec

- **Test names carry the ticket's full AC IDs:** `AC-SAMPLE-53.2: …`, as the tickets define them
  (`AC-<ticket key>.n`); the spec's "AC-53.2" is its shorthand.
- **An e2e test names its journey and one AC ID** (`J-1, AC-SAMPLE-53.1: …`), not every AC; the
  journey is the `J-n` the ticket names, or any of journeys.md's when it names none (tickets don't
  carry a journey field yet).
- **`mirai show <initiative>` shows trace as the documents are now**, computed (no model, quick),
  not a stored last result: no new journal event, so the store's schema (a cage file) stays as it is.
- **Inside Tess's run, trace's coverage entries stand for the graph lint's** in `lint.json`: both
  come from 33's coverage, so she gets one entry per missing link, with where to fix it.
- **At the set's approval, the lint runs first, then trace.** An AC no ticket covers is refused by
  the epic's own graph lint (the same coverage, its own words); trace's gate refuses what only it
  sees (a BR no FR cites after the brief changed, an NFR with no method). P3's pass condition
  ("refuses, naming the AC") holds either way.
- **The plan template's text is unchanged** (it would be `plan@v2`, and every plan in the store and
  the fixtures is `plan@v1`). Kai's prompt (`registry/agents/mirai-developer.md`), the plan checklist
  (`registry/templates/plan-checklist.md`), `docs/agents.md` (the plan step) and `docs/trace.md` say
  how tests are named.
- **Story and bug stay template v2** (the 42 re-check's choice): their template text is unchanged,
  so its hash is too; `e2e`, `tests` and `tdd` are protected in the `.toml`. `tests` and `tdd` are
  written only when a ticket overrides the project's setting, so they aren't in the template's
  frontmatter; a replacement template isn't required to carry a protected field MIRAI's own template
  leaves out (`src/config/overlays.js`), but no overlay may drop or rename it.
- **The cut-off for `trace: "n/a"`** is a date in the signed proof (`minted_at` before
  2026-12-01), not a framework version: `0.2.0` isn't bumped per unit. See question 2.
- **A failing trace counts like a failing test in the loop guard:** each missing link is one
  failure signature, so the same link missing again is L4's (the ticket's one re-plan, then a
  park), and the count must drop (L5); the fix launch after it is the round. With the rounds used,
  it parks `cap`, its note carrying the trace result (no new park reason: the status schema stays).
- **`trace(item)` is in every launch** (read-write and read-only templates), so Kai (developer)
  and Rex (reviewer) have it; Tess, Nora and Vera have it too, unused (one template per mode).
- **ID stability runs at approval only** (the PRD's, and the set's tickets against the set's last
  approval), where the last approved version is known; on the repo store (the approved text is
  read from git). "Another meaning" is a definition sharing less than a third of its words with
  the approved one. See question 1.
- **PHPUnit tests are named by their method** (P1's finding): `test_ac_sample_1_1_…` stands for
  AC-SAMPLE-1.1, since PHPUnit's JUnit report never carries the `#[TestDox]` text. The other
  runners keep the free name, `AC-SAMPLE-1.1: …`. See question 3.
- **P2's "test removed by hand"** takes AC-SAMPLE-1.2 out of the test's name (so no test proves
  it), committed; Rex reviews that commit before the gate (the code changed, so the review is stale).

## Jet's answers (2026-11-25): Q1 "A", Q2 "A", Q3 "A"

**1: A,** built. A middle FR, NFR or AC of an approved PRD is dropped by keeping its line as
`- FR-4: Retired — <why>` (`src/lint/retired.js`). The line keeps the numbering whole, so
`prd-numbering` is satisfied; when there's a gap, its hint now names the form ("or, when the missing
ID was in a version you approved, keep its line: "FR-4: Retired — <why>""). No rule for a live
requirement applies to a retired one: not its group's shape, "shall", its BR, its ACs, Given/When/
Then or the testability lint, not a BR being served by it; 33's coverage (`prdItems`, so the epic's
graph lint, its Coverage table and trace) leaves it out. ID stability accepts the retiring, and a
retired ID never comes back: "FR-4 was retired in the version you approved (…); a retired ID never
comes back". Docs: `docs/documents.md` (the PRD's rules), `docs/trace.md`, Nora's prompt
(`registry/agents/mirai-product-manager.md`, "An approved PRD keeps its IDs") and the `mirai-write`
PRD guide. Test `43 (Jet's answer 1, "A")`: the PRD with FR-4 retired lints clean against the
approved version (no problem at all); FR-4 removed instead fails the numbering lint, naming the
form; FR-4 given a new meaning after its retiring fails ID stability; trace leaves FR-4 out.

**2: A,** as built: the cut-off is the day 43 merges, set in its approval commit. It is one line,
`TRACE_CUTOFF` in `src/proofs/records.js` (2026-12-01 until then); the check, its messages, the
docs (`docs/trace.md` names the constant) and the tests all read it, so the approval commit changes
only that line.

**3: A,** as built: a PHPUnit test names its AC in its method name, in snake case.

## Questions for Jet (answered above)

1. **Retiring an ID in the middle conflicts with the PRD's numbering lint.** `prd-numbering` says
   FR IDs run 1, 2, 3 … with no gap, so removing FR-4 of seven means renumbering FR-5 → FR-4: the
   new ID-stability lint then refuses the PRD's approval (FR-4 now means FR-5's old text). So
   today an approved PRD can lose only its last FR, never one in the middle. Options: **A** a gap is
   allowed where the last approved version had the ID (the numbering lint at approval, and in
   Nora's and Tess's runs, reads the approved version too; a retired ID may be listed as
   `FR-4: Retired — <why>`, skipped by the shape, AC and coverage rules); **B** ID stability only
   for IDs something downstream already cites (an approved ticket's `covers_fr`/`covers_ac`, a test
   name), so a PRD not yet cut into tickets may renumber freely; **C** keep as built (rewording is
   fine; removing a middle FR needs a new PRD version with a new ID for everything after it).
   Recommendation: **A**, as a small follow-up on this branch before the merge (it keeps design/01
   §5a's "never reused" and gives a legal way to retire one).
2. **The cut-off date for old proofs.** Built: `trace: "n/a"` is accepted when `minted_at` is
   before 2026-12-01, a few days after this unit should merge. Options: **A** set it to the merge
   day in the approval commit (no proof minted by the old MIRAI after that day is accepted); **B**
   keep 2026-12-01; **C** a framework version instead (a version bump per unit, which MIRAI doesn't
   do today). Recommendation: **A**.

3. **How a PHPUnit test names its AC.** Built: the method name in snake case
   (`test_ac_sample_1_2_a_day_is_sent_once`), read back to AC-SAMPLE-1.2 for the ticket's own IDs.
   Options: **A** as built (no runner change; the report PHPUnit already writes); **B** have the
   phpunit adapter also write PHPUnit's TestDox output and read the `#[TestDox]` text (a second
   report to map back to files and methods, per PHPUnit version); **C** both. Recommendation:
   **A**: it reads exactly what the gate's signed JUnit report holds, the same for Laravel's `php
   artisan test`, and Kai's prompt says the form.

## For later units

- **50 (Ivy):** switches the QA link on: `qa` becomes the QA evidence's result, `tests: optional`
  tickets pass with it (`QA_NEEDED` in `src/trace/ticket.js` is the one place).
- **54 (CI on GitLab):** checks the proof's `trace` with `checkProofs` (`no-trace` refuses); it
  never runs trace again.
- **62–65 (ADRs) and 62b (the technical note):** their links replace the two notes in
  `traceDocuments` ("no ADRs yet", "no technical note yet").
- **45:** calls trace once at the set's approval (the same `traceDocuments`).
- **A `journey` field on tickets:** an e2e ticket names its J-n in its text today; a field would
  make trace's journey exact.
- **Rex's prompt** could ask him to call `trace` before a pass; today only Kai's says so.

## The full suite

**On the Mac** before the runner: `test/documents/trace.test.js` 15/15, `test/proofs/trace.test.js`
4/4, `test/proofs/gate.test.js` and `coverage.test.js` 13/13; the touched folders' pins above green;
`node test/probes/trace-probes.js --check`: both lines, exit 0. **The full suite on the Mac**
(`caffeinate -i npm test` at `ae676f2`): **888/888 pass**, 0 skipped. After it: test results only.

**Through the build runner** (a clean export each), queued at the pushed head: `u43-tests-1`
(tests), `u43-baseline-1` (baseline) and `u43-redteam-1` (redteam-full: cage files changed, see
"The red team"). `u43-tests-1` **pass, 888/888**; `u43-baseline-1` pass; `u43-redteam-1` still
running when the P1/P2 fixes went in; it ended INCOMPLETE (`w-git-config` and `adv-linger`
inconclusive; only the two accepted known limits failed).

**After P1 and P2's first runs** (the PHPUnit names, the probe home's overlays, PASS/FAIL): on the
Mac at `a84e467`, **890/890 pass**, 0 skipped; `--check` both lines (now with "overlays none"),
exit 0. At `ac424e5`: `u43-tests-2` pass, `u43-baseline-2` pass, `u43-redteam-2` INCOMPLETE again
(`w-git-config` inconclusive 2/3; only the accepted known limits `h-timeout-link` and `l-cd`
failed; no other case red).

**After Jet's answers** (the retired IDs, the cut-off's one line): the touched folders on the Mac
(`test/lint`, `test/documents`, `test/proofs/trace.test.js`, `test/docs`, `test/redteam`) green;
the full suite not run on the Mac (the runner and the probes were using it). Queued: `u43-tests-3`.
Cage files changed again: `src/lint/prd.js`, `graph.js`, `ids.js`, `testable.js` and the new
`retired.js` are reached from the server's `lint` and `trace` tools; the lint still only reads and
reports, and no case changes. So `u43-baseline-3` and `u43-redteam-3` are queued with it.
