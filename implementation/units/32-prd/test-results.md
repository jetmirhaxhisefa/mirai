# Unit 32: test results (2026-11-20)

## Tests

- **`test/documents/prd.test.js`:**
  - T1: the template, left as it is, fails as leftover text only. It holds every section of the
    type in order, and as a lite or a full PRD nothing else fails. The example lints clean with
    its brief, with no warning; so does its full version;
  - T2: requirements. An FR with no BR, an FR with no AC, an AC with no Then, a missing Failures
    group, an empty Unchanged behaviour group (and `None.` without a reason), a gap in the FR
    numbers, `AC-FR-3.2` with no `AC-FR-3.1`, and an AC whose FR doesn't exist each fail, naming
    the ID and the fix. "Shall" fails. A Capabilities FR written as "When …" only warns;
  - T3: an NFR with neither an `AC-NFR` nor a `Verified by:` line fails; a `Verified by:` line
    with no method fails; an end-to-end test passes;
  - T4: across the brief. A BR no FR or NFR serves, a cited `BR-9` the brief doesn't define, a
    redefined `NG-2`, a first new no-go `NG-1` (and a gap: `NG-5` after `NG-3`), a missing
    `Brief:` line, a linked brief that `upstream` doesn't name, and a brief NG missing from "Not
    in this" each fail. A `Brief:` link to a missing file fails through `mirai lint`;
  - T5: length. 1,700 words warns; 2,100 fails with the split message. With `length_exception`
    it fails until "Decisions for you" asks, then only warns. The exception under the cap fails.
    `limits.prd_lite_words = 2500` moves the cap. The config check refuses `999999` and a summary
    budget of 50, and refuses `docs.limits` in a personal file;
  - T6: `variant: full` with no Rollout fails; a lite PRD with Risks passes; `standard` with
    `full` warns; a changed ID-prefix block fails; a missing glossary, or one with no "Terms",
    fails;
  - T7: `mirai approve <prd-id> --file`, through the CLI with a signed key:
    - the brief's open question refuses the pair, both files' problems listed, nothing written;
    - an `[ASSUMPTION]` tag in the body refuses it;
    - one decision writes two signed lines, `kind: brief` and `kind: prd`, each on its own file's
      hash;
    - a changed brief is stale, and the PRD stays approved;
    - on `full`, the PRD is refused while the brief isn't approved as it is now; after the brief's
      own approval, one `kind: prd` line is written;
  - T8: `mirai show due-dates` lists both documents with type, id, state ("not approved", then
    "approved" and "changed since approval") and full path, and writes nothing. A ticket of the
    same name asks for `--docs`; `--docs` and `--json` choose. An unknown name says what was
    looked for.
- **The suites from 31** (`test/documents/brief.test.js`, `test/lint/`) pass unchanged.
- **T5 (summary budget, after P1):** a full PRD's summary may have 1,000 words, a lite one's
    600. About 800 words fails a lite PRD and passes a full one; `prd_full_summary_words` moves
    the full budget, and `prd_summary_words` doesn't touch it; out of range is refused.
- **The full suite:** 687/687 on the Mac (`npm test`), 10 tests in `prd.test.js`. The build
  runner and CI run on the final commit.

## Probes (real)

| Probe | Result |
|---|---|
| **P1 Jet's read** | **pass** (Jet, 2026-11-20: "the example PRD looks good. I would expect if the task is more complicated the summary has more details"). His note: the summary's size should grow with the work; see "Changed from the spec". |
| **P2 an agent fills it** | **three rounds, each a fresh Sonnet agent** given only the template, the checklist and 31's P2 brief (task comments). Round 1: 7 errors after the first lint, 2 of them MIRAI's (an FR citing its assumptions after its BR; the brief's open questions listed again, which the template didn't forbid); 0 after one round. Round 2 (stricter template): 9 errors, 3 MIRAI's (several assumption groups; an NFR verified by its own AC; a copied lead-in); 0 after one round, 1,904 words. Round 3: 11 errors, 3 MIRAI's (date placeholders and UTC read as acronyms); **1 left after one round** (a 31-word sentence), 1,898 words. The agent cut a failure FR and some edge-case ACs to stay under the cap, which the template forbids. Kept: `p2-agent-prd.md` (round 3). Its summary still needs Jet's read. |
| **P3 an agent builds from it** | **Not passed; a known limit (Jet's decision, 2026-11-20).** A fresh agent cut tickets from P2's PRD (13, 11 and 12 tickets, every AC covered each time) and listed the questions it would have to ask. Round 1: 11. The template and checklist gained seven kinds of gap (what exists today, roles and states, boundaries, when others see a change, lost access, metric data, measurement conditions). Round 2: 16; the metric rule had made the agent add features the brief didn't ask for (a change log, a report), and the questions got finer. Jet changed the bar ("P3 as recommended"): pass when no question changes what is built or who may do what; a second agent sorts them. Round 3 (metric rule fixed): 10 questions, sorted A 3 (must be in the PRD), B 3 (the plan can settle), C 4 (already answered; the sorter's own total said A 2, its verdicts say 3). The three A questions became template and checklist rules: whether a notice reaches someone who can't see its subject; where else the new data shows up (search, exports); what happens to it when its author's account is removed. |

**P3 on the example PRD** (Jet asked for an answer to P1's question 3, 2026-11-20). Check 1:
12 tickets, every AC covered; 5 questions the PRD must answer (who is a team lead; who may date a
task, where FR-1 and UJ-1 disagreed; who sees overdue marks; the reminder setting's scope; a moved
date's reminder) and 13 for the plan. All 5 fixed. Check 2 on the fixed example: 12 tickets,
every AC covered; 5 new questions of the first kind (done tasks in the email, the assignee in UJ-2,
a task dated today, reassignment after an assignee leaves, a creator who left), 11 for the plan.
All 5 fixed; no third check. A strict reader finds a new layer of edge cases each round: the
example is enough to cut tickets every time, and what's left is for Vera, the plan and the plan
gate.

## Changed from the spec

- **The example brief keeps its open `Q-1`** (Scope 9 said it's answered first). The example PRD
  carries it under "Decisions for you", so the example shows how the brief's decision reaches the
  PRD's summary. T7 answers `Q-1` (email only) in a test copy of both files before approving.
- **The length-exception item is checked for the cap and the word "words",** not the exact count
  (decision 5 says it gives the word count). The count changes with every edit, so a check on it
  would fail after each one. The lint's hint suggests the count.
- **A length-exception line's numbers aren't checked against the detail.** Without this, the
  required item always warned "the summary says 2,000, which the detail doesn't".
- **`AC-NFR` uses the registry prefix `ACNFR`** in `prd.toml`, since an ID kind's prefix is one
  word. The text in documents is `AC-NFR-n.m`, as in the spec.
- **`quick` approves the pair, as `standard` does.** The spec names `standard` and `full` only.
  Only `full` asks for the brief's own approval first.
- **The template lost its three list lead-ins** ("Once this is built:" and two others). An
  example that kept them failed as leftover text, as 31's P2 found with the Success lead-in.
- **Five ACs in the example were shortened** to 20 words or fewer, so it lints with no warning.
- **`mirai show <ticket> --full` or `--json` chooses the ticket** when the name is also an
  initiative. The spec only names `--docs`.
- **The session's `/mirai show` takes `docs`** too, so the choice works from your session.
- **The journal's `approval` event gains `kind: prd`,** as 31 added `kind: brief`.
- **Approval refusals now show their hint.** 31's lint refusal passed its hint where
  `MiraiError` has none, so "fix them, run mirai lint, then approve again" never printed.
- **P3's pass bar** (Jet, 2026-11-20, after round 2): no question that changes what is built or
  who may do what; plan-level questions don't count; one last round, leftovers become template
  findings and a known limit.
- **The completeness rules** (P3) are now in the template's top comment and a checklist section,
  "What a builder would have to ask".
- **Date and time placeholders and UTC** are on the acronym list.
- **Commit `c92cd80`'s message is wrong:** it says round 3 linted clean with no fixing round; it
  had 8 long sentences, fixed in `63ddc35`.
- **A full PRD's summary is 1,000 words** (Jet, 2026-11-20, P1: "if the task is more complicated
  the summary has more details"; "summary as recommended"). Up to 12 "What changes" bullets,
  grouped under lead-ins; lite stays at 600 words and 3–7 bullets. A variant can carry its own
  `summary_words`; the project key is `prd_full_summary_words`. The bullet count is template
  guidance, not a lint rule, as in 31.
