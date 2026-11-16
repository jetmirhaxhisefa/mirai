---
status: final
version: 1
---

# 19 — Review of the post-MVP plan (2026-11-16)

One review round on `09` version 2, the addenda `10`–`18`, `07` version 6 and D-59 to D-65,
before they were merged. Three reviewers, each starting with no knowledge of the interview: a
Product Manager, an AI Architect and a Software Architect. All three said "ready after fixes".
This file records what they found and what was done.

## 1. Blocker

| Finding | Fix |
|---|---|
| **A way to leak data** (AI Architect). An agent-written browser script against staging or production is agent code with a logged-in session. In the same launch the agent may hold database rows and logs, and may have read text planted in them | `17` §2.7: the browser container reaches only the environment's base URL; dedicated low-privilege test accounts; production takes a committed journey by name, never a script; no launch holds production-data tools and a browser together; red-team cases for each. Nightly diagnose became two launches (`17` §7.2) |

## 2. Facts about the existing code that the plan had wrong

| The plan said | The code says | Fix |
|---|---|---|
| A run gets a git worktree under MIRAI's home | The cage refuses a checkout inside MIRAI's home, and a worktree's objects sit in the main `.git`, which agents may not read | `16` §4.1: a local clone per run, outside MIRAI's home |
| Agent tool calls with their targets are in the run log | Only a count per tool is kept, and raw streams are pruned to 50 launches | A new MVP addition to unit 56 logs each call |
| Red-team cases have tags | Cases have an `id` and a `fact`; an `--only` filter by id exists and never stores a result | `10`: partial runs by `fact` or case ids |
| A Claude Code move is a gate with your key | Unit 18h (merged the same day): MIRAI moves by itself between tickets when you set `move = "auto"` | `13` §7: P13 is a delta on 18h and adds no gate. **For you to confirm:** in the interview you agreed to a keyed approval; 18h's setting is the newer decision |
| The hub export is filtered by `shown()` | `shown()` escapes text for a terminal. It filters no secrets | `15` §3.2: an export redactor, an allow-list per record type |
| The MVP additions are all in unbuilt units | Local approval checks live in built units (06, 25a, 26a, 29b, 29d) | The role rule left the MVP (below) |
| Change records are written at merge | Nothing may be committed to the integration branch after your gate | `15` §5: written on the ticket branch at ship, with the proofs |

## 3. Design changes

| Finding | Fix |
|---|---|
| "Whose approval counts" rested on the Jira assignee, which is advisory data that CI can't read, and added a whole authorisation model to the MVP | MVP: any listed key counts (row 54, D-62). The role rule moved to `12` P09, on a signed roles file and a signed claim record, checked by one function locally and in CI |
| The Ubuntu test job was put into unit 54, which builds project CI. MIRAI's repo has no CI, and no unit created the operating-system module | New MVP unit 30a |
| The build runner claimed it "can't run an arbitrary command as you". It runs the unit branch's code unattended | `10` §3 states the trust plainly and adds: pushed commits only, a scrubbed environment, `sample-run` scripts from `main` only, a canary test |
| Epic autopilot contradicted "only you merge" (D-22, `01` §12a) with no decision record. "Marked as read" could be cleared by a session. The epic branch could be pushed to | D-66. Marking as read is a gate. The epic branch is protected, the trust root stays the integration branch, CI checks the final MR commit by commit. Split into P25a, P25b, P25c |
| `db_query` relied on parsing for "one SELECT", which misses `INTO OUTFILE`, `FOR UPDATE`, side-effect functions and client shell commands. MIRAI has no database driver | `17` §2.6: the database is the primary control (read-only transaction, timeout, limited role); the client runs in a container; the broker's check is a tested deny-list. P31 split into P31 and P31b |
| Production data goes to the model provider. Redaction was described as removing personal data | `17` §2.4 and §2.8: an allow-list for production, your signed confirmation per project, and "reduces" in place of "removes". **A decision record is due when P32 is specced** |
| Findings had three homes | One home, your store. Notifications carry no agent-written title. A `learn` explanation is saved to the repo only on your command |
| The run state and events duplicated what the store already holds, and assumed one run | `14` §2: both are projections of the existing store files; a list of active runs; missing events added. `16` §4.0 states the change to the global run lock |
| Two judgings of D-38 were mixed up, and "close" had no number | `13` §1 and `09` §2.2: the review is a second judging on 20 new tickets, with "close" defined |
| The signals in `13` §5 had no thresholds, and 20 tickets give about four parks | Each candidate has a threshold and a minimum sample. Below it: keep collecting |
| Two audits had no data: Vera's misses at build time, and the second reviewer inside a "no model" script | A "document at fault" field (unit 46). The comparison moved to P11 |
| The regression set compared against one run and had no measure of correctness | `13` §6: hidden acceptance tests as the primary measure, three runs each side, a comparison rule, a throwaway install for candidates |
| Subscription cost was never added up | `09` §2.3 |
| Stage 0 was said not to change a ticket's flow, which is false once Jira is used. No unit covered the tag and onboarding | Stage 0 split into 0a and 0b, P00 added, judged tickets use the `repo` store |
| P22 held six epics. Hidden dependencies across stages, two of them circular | P22a–P22f. `09` §5 lists the cross-stage links. Each unit registers its own schema and events |
| P10 and P11 were to be built after the 20 tickets, which is dead time | P10, P12 and P13 are built during the measuring period |
| The unpark step asked dispute questions for every park | Only parks that involve a dispute ask them, and the script's proposal is accepted with one key |
| Names easy to confuse | `09` §9 |

## 4. Smaller corrections

Wrong references (D-07 for release modes is D-33; the sample app is unit 02; "§6.3" is §7.3),
Later-list items that pointed to nothing, "one new rule" where two were added, row 72 still
saying "when needed", per-person settings shown in project config, the status line writing to
project settings (which would make every red-team result stale), and `09` §5 dependencies that
were shorter than the addenda's. All corrected.

## 5. Not done, and why

| Finding | Why not |
|---|---|
| Add workspace evidence to Milestone D's exit check | Row 72 has its own "Done when". Changing a milestone's exit is your call |
| Generate the contract's schemas from `src/config/schema.js` | Left as "check first" in P18. It covers config, not the records |
| Name the team's git host and tracker in the plan | Not known here. P00 records it |
| A glossary beyond the command names | `09` §9 covers the names that collide |

## 6. Open for you

1. **Claude Code moves:** keep unit 18h's rule (by itself when you set `move = "auto"`), or add
   a keyed approval per move as you said in the interview.
2. **Production data to the model provider:** confirmed per project with your key (`17` §2.8).
   This needs your decision before P32.
3. **The thresholds in `13` §5 and the caps in `09` §2.3** are proposals.
