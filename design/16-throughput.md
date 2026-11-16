---
status: draft
version: 1
---

# 16 — Throughput (stage 4)

Decisions PM-10 to PM-15.

## 1. What limits throughput

Four facts from the research shape this stage:

- **One subscription.** Two agents at once don't give more tokens. They drain the same budget
  twice as fast. A night's share of the weekly limit is a pass mark (D-38).
- **Your review time is the ceiling.** Past two streams, work piles up waiting for you.
- **Agents working at the same time on one repo conflict often**: about 20% of the time for the
  same agent and about 40% across agents in one study.
- **Nothing merges at night**, because merging is your gate. A dependent ticket can stack on its
  parent's open MR, two levels deep (unit 53). After that the queue has nothing it may start.

So the gains are: use more nights (§2), stop the queue from stalling on your merge (§3), and
stop a running ticket from blocking you (§4).

## 2. The queue across nights (P24)

Decision PM-10: a night builds more tickets from your queue. It doesn't draft documents.

- **An epic queue lasts until the epic is done or blocked**, not until morning. Each night
  continues where the last stopped, inside the night, week and reserve caps (D-57).
- **The default is the whole epic.** You can name a selection: `mirai run --epic EPIC-9 --only
  PROJ-142,PROJ-143` or `--max 5` (proposed).
- **`mirai run --plan`** (unit 55's preview) shows the order, what tonight is expected to reach
  from the calibrated budgets, what waits for you, and what can't start and why.
- **What still waits for you**, as in unit 55: a high-risk ticket, protected paths, new
  dependencies.
- **A ticket that can't start is skipped, not a stop.** The queue takes the next ticket whose
  dependencies are met.
- With a tracker (`12`), the queue holds only your tickets and reads the tracker again before
  each one.

## 3. Epic autopilot (P25a–P25c)

Decision PM-11. Your goal: an epic of 30 tickets is built over several nights without a go for
every ticket, as long as no big risky ticket is involved.

### 3.1 How it works

- Only for an epic in `release: together` mode, which already has an epic branch
  `feature/<epic>` and one final MR to the integration branch (D-33).
- It is **off by default** and switched on per epic when you approve the ticket set (proposed:
  `autopilot: true` on the epic, part of what you sign).
- When a ticket's proofs are all green (checks, review, QA where needed, trace) and the ticket
  is not high-risk, **the orchestrator merges its MR into the epic branch**. The next ticket
  starts from the updated epic branch, so the chain never waits on stacking depth.
- **Your signed merge stays on the final epic MR** into the integration branch. Nothing reaches
  the integration branch without you.
- **The trust root stays the integration branch.** Tickets start from the epic branch, which
  holds agent-written code, but the rules, the lock and the keys are still read from the
  integration branch, as for stacked tickets (unit 53).
- **The epic branch is protected on the host:** only MIRAI's merges of proven ticket MRs reach
  it. A direct push is refused. **Check first** how to set that up on GitHub and GitLab with
  the access MIRAI has.
- **Neither an agent nor your session can trigger the merge.** It is done by the orchestrator
  from the run, on the conditions above, and isn't a broker tool or a session command.

### 3.2 What never merges by itself

- A high-risk ticket, a ticket touching protected paths, a ticket adding a dependency.
- A ticket with any open blocking finding, any failed check, or a proof that doesn't verify.
- A ticket you marked "wait for me".
- Any merge into the integration branch.

Each of these waits in your inbox. Tickets that don't depend on it continue.

### 3.3 The two brakes

- **Brake 1, you can stop it after the fact.** Every ticket MR is in your inbox to read.
  `mirai epic reject <ticket>` (a gate, with a reason):
  - pauses the epic's queue;
  - marks the ticket rejected and every ticket built after it on the epic branch as
    **suspect**;
  - offers the choices: revert the ticket on the epic branch and re-run the checks of the
    suspect tickets, or send the ticket back to Kai with your reason and rebuild what depends
    on it.
- **Brake 2, the queue stops by itself.** After a set number of merged tickets you haven't
  reviewed (default 5, proposed `[autopilot] max_unreviewed`), the queue pauses. "Reviewed"
  means you marked the ticket's MR as read **with your key in a terminal**. It is a gate, so a
  session or an agent can't clear the brake.

### 3.4 What it changes in the design

- **It is the one exception to "only you merge".** `09` §1 names it. The gates table (`01` §16)
  gets a new row: merge of a proven, non-high-risk ticket MR into an epic branch, by the
  orchestrator, when you switched autopilot on for that epic. `01` §12a ("you approve each merge
  into it") and D-22 ("agents never merge") are amended by decision D-66: an agent still never
  merges, and the orchestrator merges only into an epic branch.
- **The machine key** (unit 29b) signs the autopilot merge record. CI's `mirai-verify` accepts a
  machine-signed merge into an epic branch and nothing wider. **Check first** what unit 54
  allows.
- **The final epic MR is checked commit by commit.** CI verifies that every commit on the epic
  branch belongs to a ticket with valid proofs. Its description lists every ticket with its own
  MR, its review state and its proofs, so you review ticket by ticket and not one diff.
- **Risk is taken from the diff, as today.** Protected paths and new dependencies are detected
  from the real change, not from the plan.
- **First use on a small epic** (three to five tickets) before a large one.

## 4. Two features at once

Decision PM-12. The goal is that a running ticket doesn't block you. Two at once adds no volume, because the subscription is shared.
Think of two developers on two machines: sometimes their work conflicts, and then the conflict
is resolved at merge.

Built in steps, each useful by itself. Stop after each and look at your review time.

| Step | What | Unit |
|---|---|---|
| 1 | **Two tickets in two services of one workspace.** They can't conflict in git and need no second checkout. The global budget (D-57) is shared | P26 |
| 2 | **A checkout per run.** Every run works in its own copy of the repo, so your checkout stays free. Still one run at a time | P27 |
| 3 | **A second ticket in the same repo while the first waits.** Ticket B may plan and build while ticket A is in tests, in review or waiting for you. Only one agent writes at any moment | P28 |
| 4 | **Two builders at the same time.** A candidate for the review (`13` §5), with no unit yet | none |

**Never more than two** until your review time shows room.

### 4.0 The global run lock

Today one MIRAI run holds a global lock across all projects (`global/run.lock`, D-57). Two runs
at once change that. P26 replaces "one run" with "at most two runs, one writing agent at a
time", keeps the single usage ledger, and records it as an amendment to D-57 and D-24.

### 4.1 A checkout per run (P27)

- **A local clone per run, outside MIRAI's home.** Checked in the code on 2026-11-16: the cage
  refuses a checkout inside MIRAI's home, and a git worktree keeps its objects in the main
  repo's `.git`, which an agent may not read. So a git worktree doesn't fit. The red team
  already clones per worker, and a run does the same: a clone in a folder of its own (proposed:
  beside the project, or under a path you configure), on the ticket's branch.
- **The trust root, the store and the proofs work as today.** The project's rule files that the
  red-team key covers are read from the run's checkout, not from yours. **Check first** which
  red-team cases a second checkout changes.
- **The project must be able to run twice.** The pilot can't today: its compose project name
  and ports are fixed (D-24's reason). Setup checks this and records `worktree_safe` (the
  existing name). A project that can't gets a clear message: "one feature at a time, because
  …", with what to change (a compose project name and ports taken from the environment).
- **Files that aren't in git** (for example `.env.test`, installed dependencies) are prepared
  per checkout from a list in config.
- Clean-up of finished checkouts is MIRAI's job, with a `doctor` line for leftovers.

### 4.2 A second ticket while the first waits (P28)

- The orchestrator holds two ticket runs. A ticket in a waiting state (tests in a container,
  review by another model, your approval) lets the other one's writing step start.
- **One writer at a time** across the machine, enforced by the orchestrator's lock (§4.0).
- Shared files that both tickets plan to touch (lock files, migrations, route tables) are named
  at plan time. If both plans list the same file, the second ticket waits.
- The test stack is the limit: two test runs at once need two stacks. If the project can't, the
  second test run queues.

### 4.3 `mirai resolve` (P29)

Decision PM-13. When a ticket's branch conflicts with what was merged since it started:

1. **Generated files are regenerated by script**, with no agent: lock files, compiled assets,
   snapshots a command can rebuild. The list is in config.
2. **The command asks one question:** resolve automatically, or resolve together.
3. **Automatic:** Kai gets both tickets' plans and both diffs, resolves in the run's checkout, and
   writes a report: each file, what each side wanted, what was chosen.
4. **Together:** Kai goes through the conflicts one at a time in your session. For each it
   shows both sides, gives a recommendation with its reason, and you agree or change it.
5. **In both modes the proofs run again:** all checks, and Rex reviews only the resolution.
6. **Opposite behaviour always comes to you.** If the two tickets want different behaviour from
   the same code, that is a product decision. Kai stops and reports it, in both modes.
7. Then the merge is yours, as always.

`mirai resolve` itself is not a gate: it changes a ticket branch, which the orchestrator
already does. The merge after it is.

## 5. The verifier model (P30)

Decision PM-15.

- **A setting per role** (proposed). D-14's verifier ladder already orders the rungs; this
  setting is a way to choose a rung per role, and the spec expresses it in the ladder's terms:

  ```toml
  [models.verifier]
  documents = "claude:other"     # default: a different Claude model from the writer
  code = "claude:other"
  # documents = "codex"          # optional
  # code = "codex"
  ```

- **The default is a different Claude model from the writer**, as the MVP already does (D-58
  lets you map any model to any tier).
- **Codex is an option, never required.** Unit 71 builds the Codex adapter as a verifier rung.
  This unit lets you choose it per role and adds it for code review.
- **Codex as a review lens.** When chosen for code, Codex runs as one more lens on high-risk
  tickets beside Rex's lenses. Its findings go through the same rules: a blocking finding needs
  a file, a line inside the change, a symbol and a basis.
- Whether it becomes standing is decided by the review's second-reviewer audit (`13` §3).
- A machine without Codex logged in falls back to the default and says so in the report.

## 6. Fan-out

Decision PM-14. The rule stays: **only the orchestrator starts agents.** The three candidates
(parallel review lenses, an explorer before the plan, test-failure triage) are in `13` §5 with
their signals. Any of them is read-only and is started by the orchestrator script, never by an
agent.

Not planned: several builders on one ticket.

## 7. Units

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| P24 | **Queue across nights and queue selection:** the epic queue persists between nights inside the D-57 caps, `--only` and `--max`, the preview naming what can't start and why, skipping a blocked ticket | Review, MVP units 55, 57 | Large epics take several nights | A seeded epic of eight tickets is built over two simulated nights with no command in between; a selection builds exactly the named tickets; a ticket whose dependency is parked is skipped and the next one starts |
| P25a | **Epic autopilot: the merge.** The per-epic switch in the signed ticket-set approval, the orchestrator's merge into the epic branch under §3.2 with risk taken from the diff, the machine-signed merge record and its CI rule, the protected epic branch, the trust root staying the integration branch, the gates-table row and decision D-66 | P24, MVP units 53, 54, 29b | No go per ticket | In a seeded epic: green low-risk tickets merge into the epic branch and the next starts from it; a high-risk ticket, one touching a protected path and one adding a dependency each wait while independent ones continue; a direct push to the epic branch is refused; neither a broker call nor a session command can cause a merge; CI refuses a machine-signed merge into the integration branch; nothing reaches the integration branch without your key |
| P25b | **Epic autopilot: reject and repair.** `mirai epic reject <ticket>` as a gate, suspect marking of later tickets, the two repair choices (revert and re-check, or send back and rebuild) | P25a | Brake 1 | Rejecting a merged ticket pauses the queue and marks every later ticket on the epic branch suspect; after a revert the suspect tickets' checks re-run and their state follows the result; a rejection without your key is refused |
| P25c | **Epic autopilot: the unreviewed limit and the final MR.** Marking a ticket MR as read with your key, the pause at `max_unreviewed`, the `queue-paused` event when the event stream exists, the final MR's per-ticket list, CI's commit-by-commit check | P25a | Brake 2 | The queue pauses after five unreviewed tickets and resumes after you mark them read; a session can't mark a ticket read; a commit on the epic branch that belongs to no proven ticket fails CI on the final MR |
| P26 | **Two tickets at once in two services:** the run lock of §4.0 (at most two runs, one writer), two runs in one workspace when their tickets belong to different services, one shared ledger, reports showing both, the amendment to D-57 and D-24 | Review, MVP unit 72 | The safest form of two at once | In a two-service sample workspace two tickets run at the same time to two MRs; a second ticket in the same service is refused with the reason; the usage ledger counts both |
| P27 | **A checkout per run:** the local clone outside MIRAI's home, rule files for the key read from it, `worktree_safe` detected at setup with the message for projects that can't, per-checkout files from config, clean-up and `doctor`, the red-team cases a second checkout changes | Review | Your checkout stays free | A run on the sample app leaves your checkout untouched while you edit in it; a project with a fixed compose name is reported as not worktree-safe with what to change; a finished run's checkout is removed; the red team is green when run from a per-run checkout |
| P28 | **Second ticket while the first waits:** two held runs in one repo, the one-writer lock, shared-file detection from the plans, queued test runs | P26, P27 | The waiting time is used | While ticket A's tests run, ticket B's build step starts and no two agents write at once (from the log); two plans naming the same migration make the second wait; with one test stack the second test run queues |
| P29 | **`mirai resolve`:** script regeneration of listed files, the automatic-or-together question, the automatic report, the one-at-a-time walk-through with recommendations, the proofs re-run with Rex on the resolution only, the stop on opposite behaviour | P27 | Conflicts are normal with two features | A seeded lock-file conflict is solved with no agent; a seeded code conflict in automatic mode ends in a report and green proofs; in together mode each conflict is shown with a recommendation and your change is applied; two tickets wanting opposite behaviour stop with a question to you |
| P30 | **Verifier model per role, Codex as a review lens:** `[models.verifier]`, the fallback, Codex as a lens under Rex's finding rules, the model named in reports | MVP unit 71 | A second family on documents and code | With Codex chosen for code, a high-risk review includes a Codex lens whose findings obey the blocking rules; without Codex logged in the default runs and the report says so; the report names the verifier model per role |
