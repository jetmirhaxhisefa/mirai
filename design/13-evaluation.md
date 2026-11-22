---
status: draft
version: 1
---

# 13 — The review, the retro and upkeep (stage 1)

Decisions PM-01, PM-02, PM-04, PM-05, PM-06, PM-14, PM-16, PM-41 to PM-44.

## 1. The review after 20 tickets

**This is the first post-MVP step that depends on data.** Nothing in stages 2–6 starts before
it.

**Two judgings, not one.** The MVP judges D-38 on the 15 pilot tickets after the 5 calibration
tickets, before Milestone D (`07`, "MVP success and kill criteria"). The review here is a
**second judging, on at least 20 new tickets built after the v1.0 tag**, against the same pass
marks. Tickets count when they used the `repo` store. Tickets built through Jira are logged
with their store kind and judged apart, so the connector doesn't blur the result.

1. The review data pack (P10) computes the numbers below from the store and git.
2. `mirai retro` (P11) reads the pack and the raw logs with a strong model and writes
   suggestions.
3. You go through the suggestions one at a time in a session and decide each.
4. The results are judged against D-38 (`09` §2.2).
5. `09` is updated: the order of stages 2–6, and which candidates of §5 become units.

**"Close but not met"** (`09` §2.2) means: the safety and escape marks are met, and at most two
of the other marks are missed, each by less than a fifth of its value. Anything worse is "far
off". These two definitions are defaults and config values (D-68).

## 2. What the MVP must log

These fields are MVP additions (`09` §4 rows 2, 7, 8, 9). The unit that owns each one writes
it. **Check first** in each unit's research what is logged already.

| Data | Fields | Written by |
|---|---|---|
| Unnecessary code | Rex's findings with `category: "unnecessary"`: ticket, file, line, claim, and a `kind` (`unused`, `outside-plan`, `speculative`, `defensive`, `unrelated`). Your agree or disagree on each, given in the follow-up list of `review-mr` with one key | Unit 48 |
| Ticket decisions | At ticket-set approval: each ticket you dropped, merged into another, split or rejected, with a one-line reason | Unit 45 |
| Park cause | The existing park reasons stay (`cap`, `budget`, `repeat`, `no-progress`, `environment`, `rebase-conflict`, `bad-plan`, `scope`, `disputed`, `high-risk-review`, `bad-verdict`, `sign-proofs`). **For the reasons that involve a review dispute** (`cap`, `repeat`, `disputed`, `bad-verdict`) a `dispute_cause` is added: `reviewer-wrong`, `valid-not-fixed`, `fix-broke-other`, `new-finding-untouched-code`, `spec-unclear`, `scope-or-style`, `other`. With it: the round each open finding was first raised, whether its cited lines changed since round 1, your ruling, whether a test could have decided it, and the document at fault if one was | Unit 46. A script proposes the dispute cause and you accept it with one key or pick another. Other parks ask nothing extra |
| Vera's misses | Per document type: a problem you named when rejecting a document Vera had passed; a `template_gap`; and a **document at fault** named in a park ruling or in `mirai escape`, which is the only link from a build-time problem back to a document | Units 40, 46 and 56 |
| Agent tool calls | Per launch: each call's tool, its sanitised target (a project path or a level, never content) and its order | **Not logged today.** Checked in the code on 2026-11-16: the run log keeps only a count per tool, and the raw streams are pruned to the last 50 launches. Unit 56 adds the per-call list, using the sanitiser the progress lines already have |
| Decision questions | Per document and per ticket: each question's `decision_type` (scope, audience, money-legal, number, conflict, trade-off, invented, other) and your answer type (answered, Vera is wrong, not a decision, left open); questions per document; rounds used; repeated questions on the same item; decisions found afterwards that should have been asked (Jet, 2026-11-22, from 44's interview) | Unit 44 (`decision-question` and `decision-answer` journal events, the document loop's books); code loops in unit 46. Decisions found afterwards: a rejection note or a park ruling that names one (units 40, 46) |
| Store kind | Per ticket: `repo` or the external tracker | Unit 56 |
| Cost | Turns, tokens, minutes and limit share per step, per round, per agent | Already logged (units 20, 56) |

## 3. The review data pack (P10)

A script with no model. It writes one folder of JSON and a Markdown summary. It is built during
the measuring period and tested on seeded data, so a missing log field is found before 20
tickets are spent. Only its real run waits for the tickets.

| Audit | What it computes | Answers |
|---|---|---|
| Pass marks | The D-38 numbers on the judged tickets | Go, fix-up or rethink |
| Unnecessary code | `unnecessary` findings per ticket and per kind. The planned files against the changed files, and lines changed per ticket | How well Kai keeps to the task (PM-01) |
| Ticket size | Tickets per epic, your ticket decisions with reasons, diff size and review time per ticket | Whether Tess makes too many or too small tickets (PM-05) |
| Verifier | Vera's misses per document type against documents checked | Whether a specialist verifier is needed (PM-06) |
| Parks | Parks by cause, rounds used, your rulings | Which dispute fix to build (PM-16) |
| Decision questions | Questions per document and per ticket, by `decision_type` and answer type. **Too many:** e.g. more than 1 in 4 answered "not a decision". **Too few:** any invented decision found later. **Back-and-forth:** e.g. an average of more than 5 questions per document, or the same item asked twice. The thresholds are placeholders, set when this review is specced (Jet, 2026-11-22, from 44's interview) | Whether Vera's labels are right, and whether 35's interview should ask more up front |
| Repeated work | Tool calls that repeat across tickets: the same search, the same file read, the same command, ranked by total turns | What to move into scripts or hand to the agent up front (PM-04) |
| Fan-out signals | Clock time of high-risk reviews, Kai's turns spent reading before the first edit, failing tests per failed check | Whether a fan-out candidate pays (PM-14) |
| Cost | Cost per ticket, agent and step. The wasted part: failed rounds, parked tickets, retries | Where to save |
| Feedback | Your `mirai feedback` entries grouped by agent and step | What annoyed you |

## 4. `mirai retro` (P11)

- **When:** on demand, and on a schedule you set (proposed default: every 20 tickets or once a
  month, whichever comes first). It never runs during a ticket.
- **Model:** the strongest tier you have configured. The morning report already shows which
  model does judgement work (D-58).
- **Input:** the data pack, the run logs, your feedback entries, the current agent instructions
  and templates. Logs are untrusted text: they contain agent output and project text.
- **Output:** a suggestions file. Each suggestion has:
  - the problem, in one sentence;
  - the evidence: tickets, counts, log references;
  - the proposed change: which file (an agent's instructions, a template, a checklist, a
    script, a config default) and what changes;
  - the expected effect and how the regression set or the next tickets would show it;
  - the risk.
- **The walk-through:** `/mirai retro` in your session goes through the suggestions one at a
  time. For each you choose: accept, reject with a reason, or later. Rejections are kept so the
  next retro doesn't raise the same thing.
- **The second-reviewer comparison** runs here, since it needs a model: on a sample of merged
  tickets (proposed: five), a second model reviews the same diff. The walk-through shows you
  the findings only it made and the findings only Rex made, and you mark which were real. It
  has its own budget and is skipped when the week's reserve is low.
- **Nothing changes by itself.** An accepted suggestion becomes a unit (or a ticket in a project
  for project-level changes) and is built the normal way.
- **Team:** each developer's logs stay on their machine. A developer can export a data pack
  without project text (numbers and categories only) and send it to you. Sharing is their
  choice.

## 5. Candidates the review decides

No unit exists for these. Each names the signal that would create one.

**Small numbers.** Twenty tickets give few parks (the pass mark is under 20%, so about four)
and a handful of documents per type. A share of four parks proves little. So each signal has a
**threshold and a minimum sample**. Below the sample the answer is "keep collecting", no unit
is built, and the next retro looks again. The numbers are **defaults, and each is a config
value** you can change (D-68). The data pack and the retro show the values they used.

| Candidate | Build it when (default) | Design in brief |
|---|---|---|
| Extra coding rules for Kai | At least 10 `unnecessary` findings you agreed with, and one kind holds half of them | Add only the rules that kind points to. From research: offer the simpler option, trace every changed line to the request, no defensive code for impossible cases, no cleanup of untouched code, out-of-scope findings go to a list. Generic rule lists showed no measured gain |
| Plan-against-diff check | A quarter of tickets changed files the plan didn't name | The plan lists files and an expected size. A script compares the real diff and flags the excess before review |
| `unnecessary` as blocking | You agreed with at least 8 in 10 findings of a provable kind, over at least 10 findings | Only the provable kinds block: files outside the plan, code a script shows is unused |
| A ticket size rule | You dropped, merged or split at least a fifth of proposed tickets, over at least 3 ticket sets | A lint on the ticket set, with the size taken from your review times |
| Specialist verifier | One document type has at least 3 misses and twice the miss rate of the others. Since documents are few, Vera is also run on a **seeded-defect set** per type (unit 40's test documents, extended) to get a recall figure | A second verifier agent with its own checklist for that type. HLD and ADRs first |
| Refutation pass for all tickets | At least 5 dispute parks, half of them `reviewer-wrong` | The check pass that high-risk tickets already get (unit 24b), for every ticket. It costs some recall, so dropped findings are logged and sampled |
| Early exit on an unclear spec | At least 5 dispute parks, half of them `spec-unclear` | Kai or Rex flags it in round 1 and the ticket goes to your inbox without using rounds |
| A contest step with an arbiter | At least 8 dispute parks where your rulings split between Kai and Rex | Kai fixes or contests once with evidence. A model from a third family rules, with roles hidden, and the run repeated with the order swapped. Disagreement between the two runs, or a high-risk ticket, goes to you. Its agreement with your rulings is logged before it is trusted |
| Test as tiebreaker | You marked "a test could have decided it" on most of at least 5 dispute parks | A contested blocking finding must come with a failing test. Concurrency and security findings are exempt |
| A precedent file | The same dispute appears on at least 2 tickets | Each of your rulings is added to a file read from the integration branch, which Rex and Kai both get |
| Parallel review lenses | High-risk review takes more than a fifth of a high-risk ticket's clock time, over at least 5 such tickets | Unit 24b's lenses run at the same time. Same tokens, less waiting |
| Explorer before the plan | On large tickets Kai spends more than a third of his turns reading before the first edit, over at least 5 such tickets | A cheap read-only agent, started by the orchestrator, maps the relevant files and hands Kai a short summary |
| Test-failure triage | A failed check has more than 10 failing tests on at least 5 tickets | One small agent per failure group sorts "caused by this change" from "flaky or old" |
| Two builders in parallel | Stage 4's earlier steps work and your review time has room | `16` §4 |
| Codex as a standing reviewer | In the second-reviewer comparison, the second model found at least 3 real findings Rex missed on five tickets | A lens on high-risk tickets (`16` P30) |

## 6. The regression set (P12)

A development tool for MIRAI itself (`tools/regress.js`, proposed), run through the build
runner (`10`). It isn't a command in installed projects.

- **What:** a small fixed set of tickets on the sample app (proposed: five). Each has **hidden
  acceptance tests** that the agents never see, kept outside the sample app's repo.
- **The primary measure is correctness:** do the hidden tests pass on the result. Rounds,
  findings, diff size and cost are secondary.
- **The reference is at least three runs per ticket**, since agent output varies from run to
  run. A candidate is also run three times. A ticket counts as worse when the candidate fails
  hidden tests the reference passed in most runs, or when a secondary measure falls outside
  the reference runs' range in all three runs. Anything less is reported as "no clear
  difference".
- **When:** whenever an agent's instructions, a template the agents read, or a model mapping
  changes, and by `mirai retro` to test a suggestion before you accept it.
- **How a candidate runs.** Agents read their rules from the trust root, so an unapproved
  change can't be tried in a real project. The regression set runs in a throwaway install of
  the sample app whose trust root is built from the candidate branch.
- **The reference goes stale** when the model mapping or the Claude Code binary moves. It is
  re-recorded then, and the report says which reference it compared against.
- **Blinded where possible:** the report doesn't say which side is new until you've read it
  (the `mirai-eval` idea from `07`'s former Later list).
- **Cost:** about thirty ticket runs for a full comparison. It runs on the build runner's
  queue, never during a night run, and inside the budget of `09` §2.3.

## 7. Claude Code update check (P13)

**Unit 18h already decides how MIRAI moves** (merged on 2026-11-16, the same day as this
interview, and it stands): one Claude Code version per ticket; MIRAI moves between tickets,
never during one; with `[claude_code] move = "auto"` in your personal config it moves by itself
at a ticket's start once the red team is green on the new version; it warns while a newer
version waits and stops new tickets after 7 days. You confirmed this on 2026-11-16 (D-69):
MIRAI moves by itself, and no keyed approval per move is added.

P13 adds what 18h doesn't have:

- **A scheduled check** (proposed: daily, and on `mirai doctor`). Today the red team for a new
  version runs when a ticket is about to start, which costs about fifteen minutes at the worst
  moment. The check runs it in the background when no ticket runs, so the result is ready.
- **A report** when the check ends: all cases pass, or these cases changed, plus any new
  settings keys the version needs, and how far behind the kept version is.
- **For the team:** the version the project last proved is recorded in the repo as
  information. Each machine still earns its own green result, since a result never crosses
  machines. `doctor` on a teammate's machine says "the project moved to version X: run the red
  team".

## 8. Units

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| P10 | **Review data pack** (`mirai retro data`, no model): the audits of §3, written as JSON and a Markdown summary; tickets split by store kind; an export without project text for teammates. Built during the measuring period on seeded data | MVP units 45, 46, 48, 56 | The review needs numbers | On a store with seeded runs, each audit's numbers match hand-counted values; a seeded store that lacks a field named in §2 is reported as incomplete, not as zero; the text-free export contains no ticket title, path or finding text |
| P11 | **`mirai retro`:** the strong-model investigation, the suggestions file in the format of §4, the walk-through in the session, kept rejections, the schedule, the second-reviewer comparison with its budget | P10, P12 | Turns data into decisions | On seeded logs with a planted problem, a suggestion names it with its evidence and a concrete change; a rejected suggestion isn't raised again by the next run; nothing in the repo changes without your choice; the comparison lists findings by which reviewer made them |
| P12 | **The regression set** (`tools/regress.js`, development only): five sample-app tickets with hidden acceptance tests, three reference runs each, the comparison rule of §6, the throwaway install with a candidate trust root, the blinded report, the `regress` job of the build runner | MVP units 02, 28, 29e | A change to an agent must be proven | A deliberately worse instruction for Kai is reported as worse on at least one ticket; a candidate identical to the reference is reported as "no clear difference" on every ticket in three repeats of the comparison; the report hides which side is new until opened; no hidden test is readable by an agent (red-team case) |
| P13 | **Claude Code update check:** the scheduled background red-team run on a new binary, the report with changed cases and the gap, the project's proven version recorded in the repo, `doctor`'s message on other machines. A delta on unit 18h, which keeps deciding when MIRAI moves | MVP units 18g, 18h | Updates arrive every week or two | With a newer binary installed and no ticket running, the check runs the red team on it and reports; the next ticket start finds the result ready and follows 18h's rule; a second machine's `doctor` asks for a red-team run on the new version |
