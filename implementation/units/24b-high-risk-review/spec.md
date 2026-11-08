---
unit: "24b"
name: high-risk-review
status: approved (2026-11-08; Jet's seven decisions taken in the interview; not built yet)
roadmap: design/07-implementation-roadmap.md, row 24 (24b: the `high`-risk lens passes and the per-finding check); design/01 §9 (depth by risk, L7; "High-risk tickets only: check each finding"), §8 (instruction-file changes block in supervised mode too), §4 (risk auto-set from risk paths); D-14, D-58 (a high-risk review is a judgement step, never below deep); 24a's spec and build
depends_on: ["24a", "19", "20", "09"]
---

# Unit 24b: review (Rex), the `high`-risk depth

## Why

24a built the `normal` review: one combined Rex pass. A high-risk ticket gets that pass and then stops for you (`needs-you`, a park at night), because design/01 §9 says high-risk work deserves more: separate **lens passes**, each with one focus and a fresh context, and a **check of each blocking finding** at its cited location before Kai sees it. Until 24b, every high-risk ticket waits for your morning, whatever the review found.

Already built and waiting for this unit:

- `triage()` (`src/findings/findings.js`) takes `confirmations` on high-risk tickets: a blocking finding not confirmed `high`, `medium` or `low` is downgraded (`unconfirmed`).
- The `finding-check` schema (09a, `checkFindingCheck`): a batch, one verdict per finding id (`high | medium | low | false | maybe-false`, a short note).
- `pickTier`: a high-risk review is the step `review-high-risk`, a judgement step, always on `deep` (Opus), never lowered (D-14).
- The loop guard: 3 rounds for high risk instead of 2 (`rounds_high_risk`).
- 24a's step, diff (with the file's line numbers), triage, records, fix rounds from findings, disputes and `mirai unpark --retry | --accept`.

## Decisions (Jet, 2026-11-08, in the interview)

1. **The lenses run one after another, not in parallel.** Each lens is its own Rex launch inside the same run lock. The launcher is built and red-tested for one launch at a time ("a launch never runs beside another": one heartbeat, one run lock, one run-log writer); parallel launches would need a new concurrency model and its own red-team cases. Each lens still gets a fresh context and never sees another lens's findings, which is what "parallel" was for. Cost: wall time only (roughly 5–15 minutes per high-risk round 1).
2. **Five lenses, a sixth when it has something to check against:**
   - **blind hunter:** the diff only (no plan, no ticket): bugs a reader finds from the code alone;
   - **edge cases:** the plan's Edge cases and the paths it missed (a path tracer: inputs, empty and error paths, deletions);
   - **verification gap:** claims without proof: an AC or a plan claim with no test that really proves it;
   - **intent alignment:** the plan's verbatim frozen intent and Boundaries: the defensible readings of the intent, which one the diff implements, where it diverges;
   - **security:** authorization, injection, secrets, data exposure, unsafe defaults;
   - **architecture:** only when the ticket is governed by an ADR or design document (the plan's inputs name one); without one it has nothing to cite, and L1 would downgrade its findings anyway.
3. **Lenses in round 1 only.** From round 2, a high-risk review is one combined Rex pass on `deep` with last round's blocking findings and the delta, exactly as 24a's round 2 (L2), then the per-finding check on whatever still blocks.
4. **The per-finding check is one fresh Rex launch for all blocking findings of the round.** After the lenses' findings are merged, a new launch (read-only, `deep`, the verifier ladder against Kai's launch, a fresh context that saw no lens) gets only the blocking findings and reads the code at each cited location. It returns one `finding-check` verdict per finding. `false` and `maybe-false` are dropped before Kai sees them and logged as reviewer false positives (M5, reviewer precision); `high`, `medium` and `low` stand.
5. **After a full high-risk pass, only protected paths still stop for you.** A ticket that is high risk because of its plan (`risk: high`) or a risk path (decision 7) passes like a normal one after the lens passes and the check. A change that touched a **protected path** (instruction files, hooks, auto-run config: design/01 §8) still stops after the pass: `needs-you` in your terminal, a park at night (`high-risk-review`, as in 24a). Agents can change what later agents obey there, so a human sees those.
6. **No pass without every lens.** If a lens fails (a verdict MIRAI can't read, a launch error, a usage limit) while others returned, their blocking findings still go through (checked, then to Kai). But the review only **passes** when every lens and the check returned: otherwise `agent-failed` in your terminal, where `mirai review` again runs **only the missing lenses** (the returned ones are kept in the record), and a park at night (`bad-verdict`). A missing security lens must never read as "no security issues".
7. **`gate.risk.high` decides from the diff.** The project config's `gate.risk.high` (path patterns; empty by default) is read at review time from the **trust root's** config (the integration branch, never the ticket branch, so a branch can't empty the list). Any changed file that matches makes the review high risk, whatever the plan said; the review record names the matching files. It can only raise risk, never lower it.

## Scope

**In.**

1. **The lens prompts as data.** One section per lens in Rex's prompt file or one small file per lens in `registry/agents/mirai-reviewer/` (decided at the build: whichever keeps `agentFor`'s checks unchanged), each naming its focus, what it gets, and what it must not do (the blind hunter is told it has no plan on purpose). Every lens returns the same `review-verdict` schema; L1's citation rule holds for all of them.
2. **The lens inputs.** The same read-only input folder as 24a, but per lens: the blind hunter gets `review.diff` and `review-files.json` only; the others also get `plan.md`, `ticket.md` and the documents it cites; the intent-alignment lens gets the plan's frozen block as its own file (`intent.md`, verbatim); the architecture lens the governing ADRs or design sections.
3. **The round-1 run, in `runReview()`.** When the ticket is high risk and it's round 1: each lens launched in a fixed order (blind hunter, edge cases, verification gap, intent alignment, security, then architecture when it applies), each with its own one-time launch token (`nextToken`, as `runFix()` does) and the usage check before each launch. Each lens's verdict is checked against the schema and kept in the review record under its lens name.
4. **Merging the lenses' findings.** Findings are merged by fingerprint (file + symbol + `basis.ref`, the L4 fingerprint, never the line): two lenses raising the same problem are one finding, with both lenses named. Each merged finding gets a new id unique in the review (`F1`, `F2`, …), the ids Kai replies to. Then `triage()` as in 24a (L1, pre-existing).
5. **The per-finding check.** One Rex launch (role `reviewer`, step `review-high-risk`, `jsonSchema` = `finding-check`) with `findings-to-check.json` (the blocking findings after triage: id, file, line, symbol, basis, claim) and `review.diff`. Its verdicts become `triage()`'s `confirmations`. A check MIRAI can't read is a failed launch (decision 6). No blocking finding after triage → no check launch.
6. **Round 2 and later.** One combined pass on `deep` (decision 3), then the check on whatever still blocks.
7. **The outcome.** As in 24a (`pass`, `changes`, `replan`, `parked`, `agent-failed`), with `needs-you` only for a protected path after a full pass (decision 5). The record's `depth` is `high`, with `lenses` (each lens's state: `returned`, `failed`, `not-applicable`) and `checks` (each finding's check verdict).
8. **A rerun after a failed lens** (decision 6): `mirai review <ticket>` on the same commit runs only the lenses the last record shows as failed, then merges with the kept ones. 24a's "same commit only after `changes`" rule widens: also after an incomplete high-risk round 1.
9. **`gate.risk.high` at review time** (decision 7), through `src/util/glob.js`, matched against the review diff's files.
10. **The run log and the report.** One `review` launch line per lens and one for the check (each with its lens name), the merged findings' structured part as `finding` lines (Q9: their text stays in the review file), and false positives as `finding_outcome` lines with outcome `false` (M5).
11. **Docs:** design/01 §9 "built" notes, roadmap row 24, Rex's prompt.

**Out.**

- **Parallel launches** (decision 1): a roadmap note to revisit if high-risk reviews are too slow in the pilot.
- **Setting risk early from paths and keywords** at the tickets or plan step (so the plan gate and the build's tier are raised too): the tickets unit; 24b only raises the review.
- **The signed review proof:** unit 25. **Test-scope findings:** unit 48. **`mirai inbox`:** unit 46. **Chaining steps at night:** unit 28.
- **The `mirai-review` skill:** not made (24a, item 10).

## Probes (with your OK before each batch)

- **R1. A high-risk round 1** (Opus, about 6–7 runs: 5 lenses and the check; a sample-app clone, gate stubbed). The 24a seed (`destroy()` deleting by title) on a plan marked `risk: high`, plus a second seeded problem the blind hunter can't see without the plan (an AC the diff doesn't implement). What we learn: each lens's verdict comes back as structured output; the merge; the check confirms the real findings; whether it drops anything, and what (a false finding can't be planted from outside, so a drop is recorded and judged by hand); time and tokens per lens.
- **R2. A failed lens and its rerun** (Opus, 1–2 runs): one lens stubbed to return an unreadable verdict, then `mirai review` again runs only that lens.
- **R3. Round 2 on high risk** (Opus, about 3 runs: Kai's fix, the combined pass, the check if anything blocks).

## Files

- **New:** the lens prompts (`registry/agents/`), `src/review/lenses.js` (which lenses apply, their inputs, the merge), tests, `test/probes/review-high-probes.js`.
- **Changed:** `src/agent/review.js` (the high-risk path, the check, the rerun of missing lenses, `gate.risk.high`), `src/cli/commands/review.js` (`nextToken`), `src/findings/findings.js` only if the merge needs it, `registry/agents/mirai-reviewer.md`, docs.

## Tests (`npm test`, no model; a stand-in `claude`)

- A high-risk round 1 launches the five lenses in order, each with its own token and inputs (the blind hunter gets no `plan.md` or `ticket.md`); the architecture lens only with a governing ADR.
- Two lenses raising the same file + symbol + basis give one finding, both lenses named; ids are unique in the review.
- The check gets only the blocking findings after triage; `false` and `maybe-false` are dropped and logged as false positives; no blocking finding → no check launch.
- A failed lens: the others' findings still reach Kai; the review never passes; your terminal gets `agent-failed`, the night a park; `mirai review` again runs only the failed lens.
- Round 2 on high risk: one combined deep pass with the delta and prior findings, then the check.
- After a full pass: `pass` for a `risk: high` plan; `needs-you` (park at night) for a touched protected path.
- `gate.risk.high`: a matching file makes the review high, named in the record; the list is read from the trust root, so a ticket branch that empties it changes nothing; it never lowers a plan's `risk: high`.
- Every lens and the check run on `deep`, never lower, and on the verifier ladder against Kai's launch.

## Done when

- The tests pass, R1–R3 are recorded in `test-results.md`, the red team is green, and a high-risk sample-app ticket goes build → high-risk review (blocking, checked) → fix → round 2 → pass by hand.

## Open points for you

All seven design decisions are taken (above). Approved by Jet on 2026-11-08, with this cost note: a high-risk round 1 is 6–7 Opus launches, and up to 3 rounds per ticket; design/01 §2 budgets 12–22 launches per high-risk ticket on the `full` track.

## Changes during the build (2026-11-08)

What the build found that the spec didn't say, or said differently. Each is in the code and tested.

1. **Decision 6, made exact (Jet, during the build): a failed lens holds everything back.** A round 1 with a failed lens (or a failed check) is **incomplete**: no verdict, nothing to Kai, the returned passes kept in the record. `mirai review` again on the same commit runs only the missing passes (and the check), then decides on all of them; at night a verdict MIRAI can't read parks (`bad-verdict`). A pass that fails stops the ones after it: they'd hit the same limit, and the night has other tickets.
2. **Every review is now "passes, then the check".** A normal review is one pass (`combined`), a high-risk round 1 one pass per lens, a high-risk later round one combined pass on deep; the record keeps each pass's state and verdict under `passes`, and the check under `check`. 24a's records and outcomes are unchanged for a normal review, except `depth` (`high` on high risk).
3. **Launch tokens:** `runReview()` takes `nextToken` (as `runFix()` does), and `mirai review` mints one per launch. A caller with a single token is refused **before any launch** when the review needs more (`needs-tokens`), never halfway.
4. **The usage check runs before each launch after the first** (a high-risk review is six or seven launches), as fix rounds do.
5. **The lens names are in the review record, not on the run log's launch lines** (the spec's item 10): the launch line's schema has no field for them, and the record maps each pass to its launch id. The progress label shows them (`Rex (security)`, `Rex (check)`).
6. **The run log's `finding_outcome` takes `false`** besides `fixed` and `disputed` (05b's event): one line per finding the check calls `false` or `maybe-false` (M5).
7. **The blind hunter is blind by its inputs and its prompt, not by the sandbox:** it gets only `review.diff` and `review-files.json`, and its prompt tells it not to open the plan or the ticket; the ticket's file is in the checkout, which it can read. A real wall would need a launch without the checkout, which is the clean export (24a's decision 5).
8. **The park note for `high-risk-review`** now says the review passed and the change touches a protected path.
9. **Probes:** R2 (a failed lens and its rerun) isn't a model probe: a failed lens has to be forced, which a stand-in does exactly and a real model can't; the tests cover it. R1 and R3 are `test/probes/review-high-probes.js`, on 24a's seed with the plan marked `risk: high`. The second seeded problem (an AC the diff doesn't implement) isn't planted: the seed's three ACs all have code, and a new one would need a new plan; what each lens finds on the one seeded bug is what R1 records.
