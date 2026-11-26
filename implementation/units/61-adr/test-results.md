# Unit 61: test results (2026-11-26)

**Approved** (Jet, 2026-11-26: "approve 61"). The runner is green at `a67ccdd` (948 tests, baseline, red team GREEN); CI on PR #140 green; P1 and P2 passed. Built on `unit/61-build` from
`origin/main` (`f413a6f`: 45b merged, its re-checks merged).

## What was built

| Scope | Where | What |
|---|---|---|
| 1 The type | `registry/document-types/adr.toml`, `registry/templates/adr.md`, `adr-checklist.md`, `registry/examples/adr.md` | MADR 4.0.0 at its core: Summary (a Y-statement), Context and problem, Options considered, Decision, Consequences, Confirmation; optional Revisit when and Links (left out when they don't apply). Front matter: `status`, `date`, `decision_makers`, `confidence`, `gate`, `initiative`, `supersedes`, `superseded_by`, `status_reason`, `components`. The one type with `status = "required"` (Jet's "A"), its states proposed → accepted / rejected, accepted → superseded / deprecated. Past 600 words a warning, past 900 an error. `verifier = true`. The "PRD:" line links the initiative's PRD; FR and NFR IDs are cited from it. |
| 2 The lint | `src/lint/adr.js` | The Y-statement in order (warns past 80 words, fails past 120); at least two options; a Bad consequence; `gate` names a test; the PRD line when `initiative` is set; each Confirmation line `check:` (in `[checks]`), `test: <its id>` or `review: <a sentence>`; `supersedes` names an accepted ADR of the folder; a rejected or deprecated ADR keeps `status_reason`, a superseded one `superseded_by`; the id is the file's number; `(open)` (44's rule); the length. Template leftovers are checked for ADRs too, though they live outside the docs root. |
| 3 The checklist | `adr-checklist.md` | Vera's lines: one decision, the gate holds (else a writing must-fix: "make it a line"), the cap as a `scope` decision naming the ADR (44's re-check), real options, honest bad consequences, a checkable Confirmation. Her inputs gain `adrs.md`: the initiative's ADRs and its track. |
| 4 Confirmation in trace | `src/trace/documents.js`, `src/adr/confirm.js`, `src/adr/evidence.js`, `src/proofs/record.js` | Each accepted or proposed ADR of the initiative: `check:` links when `[checks]` has it; `test:` links when a ticket of the initiative passed the gate with a test named for it (the gate keeps those names, `adr-tests.json`), **pending** while none has shipped; `review:` links. "No ADRs yet" is gone. |
| 5 The index | `src/adr/adr.js`, `mirai adr index` | Rendered from the files (number, title, status, date, superseded by); `mirai lint` fails while it doesn't match; every approval and review renders it. |
| 6 The project's ADRs | `[adr] folder`, `[adr] numbering`, `src/detect/adr.js` | Defaults `docs/decisions`, `ADR-0001`. `mirai detect` (so `mirai setup`) drafts both from an existing folder. Existing ADRs are indexed as they are (their title, a `Status:` line or bullet, `accepted` otherwise) and never rewritten. |
| 7 Approval | `src/cli/commands/approve-adr.js` | `mirai approve <adr-id> --file <path>`: the lint as at approval (the PRD linked, the folder read), Vera's result, then `[a/r]`; a rejection needs a reason. MIRAI writes the status into the file and signs those bytes (44's re-check); a superseding ADR marks the old one `superseded` with `superseded_by`, both files in one signed line (`files`). The index is rendered; the initiative is published (44's publish); the ticket planner's offer follows when the track's inputs are complete. |
| 8 Review | `mirai adr review [<id>] [--list]` | The accepted ADRs with their Revisit triggers; still true or deprecated (a reason, written into the file); signed `adr_review` lines. |
| 9 Agents' context | `src/adr/context.js`, `src/agent/inputs.js`, `src/agent/plan.js`, `src/agent/review.js`, `src/tess/run.js` | Kai (plan), Rex (review) and Tess: the index, and in full the accepted ADRs of the initiative, the ticket's `governed_by`, the ones whose `components` the work names, and the last three accepted; never a rejected, superseded or proposed one in full. The rules in their prompts. Kai stops with `ADR-CONFLICT: <id>: <why>`: the ticket parks `adr-conflict` (`mirai unpark --retry`: back to ready-for-dev). Rex checks each given ADR's Confirmation; an accepted ADR is a basis for a blocking finding. |
| 10 The technical note's link | | The type exists for 62b's `D-n` links. |
| 11 Docs, the session | `docs/adr.md` (new), `docs/documents.md`, `docs/config.md`, `docs/trace.md`, `docs/agents.md`, `docs/README.md`; `src/mcp/tools/commands.js` | `/mirai adr`, `/mirai adr index`, `/mirai adr new` (slug; initiative, supersedes), `/mirai adr review` (the list); the approval and the marking stay in your terminal. |
| From the re-checks | `src/hooks/pre-commit.js`, `src/store/connectors/publish.js`, `state.js`, `src/tickets/inputs.js`, `src/store/journal.js` | 44's: `pre-commit` refuses an ADR status other than `proposed` unless the bytes are ones you signed, and an accepted ADR changed beyond typo and link fixes ("supersede it"); a typo fix isn't stale (the store keeps the signed text). 45's: the initiative's ADRs as Tess's input (none needs none; proposed blocks); the docs MR carries the initiative's ADRs, the ones they superseded and the index (Jet's "A"), each checked at the merge against your signed line; any other path in the ADR folder is still refused. The journal: approval `kind = "adr"`, `adr_review`. |

## Tests

| Test | File | Result (Mac) |
|---|---|---|
| T1 the lint: a good ADR passes; one option, no Bad, no gate, no or a vague Confirmation, an unknown check, an unknown FR, the Y-statement, the PRD line, the reason, the length, the number, `(open)` | `test/documents/adr.test.js` | pass |
| T2 the status written and signed; a changed Decision refused naming "supersede it"; a typo fix passes and isn't stale; a hand-set status refused (44's re-check asked for it); superseding marks the old one, both in one signed line; T2b a rejection keeps its reason | same | pass |
| T3 the cap: three on standard, Vera's inputs name them with the track; her scope decision lets you sign; the line's `vera_open` names it | same | pass |
| T4 Confirmation: check missing and linked; test pending, missing, linked; review linked; the gate keeps passed ADR tests only | same | pass |
| T5 the index rendered, a hand edit a lint problem, rendered again, a superseded ADR's successor | same | pass |
| T6 a project's own ADRs (Thudos's shapes): detect, numbering, `adr-0002`, indexed as they are, its own README left alone | same | pass |
| T7 the agents' inputs (index, relevant, last three, never rejected or superseded) from the integration branch; Kai's rules and the conflict park | same | pass |
| T8 `mirai adr review`: the list, deprecated with a reason, signed, logged; still true | same | pass |
| T9 an overlay renaming "Confirmation" to "Validation" | same | pass |
| The ticket planner's input | same | pass |
| The docs MR carries the ADRs (45's re-check, Jet's "A") | `test/store/docs-publish.test.js` | pass |
| T10 the docs check (34b) | `test/docs/coverage.test.js`, `adr.test.js` | pass |

Pinned lists updated: the command list, the journal's event types, the registry's types, the
template hashes, Vera's types, the summary-check exemption (an ADR's summary is its Y-statement),
trace's notes.

## The red team

The cage changes: the journal (`adr_review`, the `adr` kind), the session's commands, the config
schema (`[adr]`), the park reasons (`adr-conflict`), the plan and review launches (their inputs and
prompts).

## The runner (at `a67ccdd`)

| Job | Result |
|---|---|
| `u61-tests-1` | pass: 948 tests, 0 failed (27.9 min) |
| `u61-baseline-1` | pass (4.6 min; the sample app's seeded known failure and flaky test, as always) |
| `u61-redteam-1` | **RED TEAM: GREEN**, 354 runs, S1–S6 ok (16.1 min) |

Only the probe script and these records changed after `a67ccdd`.

## Probes (real)

`test/probes/adr-probes.js`:
- **P1 PASSED** (2026-11-26, `~/mirai-u61-p1.txt`; a probe home of 42's, `--auto`): the ADR
  written in this session with the mirai-write rules (the sample app's reminders: one scheduled
  command, one queued job per assignee, or an email when the date is set). It linted clean at 396
  words. **Vera (`claude-sonnet-5-5`) passed it, round 1, with 3 suggestions, all about the
  decision, none about the shape:** the third option was written to lose (the "dummy alternative"),
  the chosen option's cost left out the cron line it still needs, and the Revisit thresholds
  (10,000 jobs, 06:00) have no source and no time zone. The approval wrote `status: accepted` and
  signed it (the probe key), the index lists it, and `mirai trace due-dates` shows its
  Confirmation: `review:` linked, `test: ADR-0001` pending until a ticket ships.
- **P2 PASSED** (no model, `~/mirai-u61-p2.txt`): a clone of `thudos-setup`: detect found
  `docs/decisions`, numbering `adr-0001`; its ADR-0001 indexed as it is ("Local development reverse
  proxy and real domain names", accepted, 2026-08-05); the next is `adr-0002-…`; the index goes to
  `index.md`, since its `README.md` is its own; nothing in the clone changed.

## Changed from the spec

- **The index's name:** `README.md`, unless the folder already has a `README.md` of the project's
  own (Thudos's is a usage note): then `index.md`, and the README is never rewritten (D-20).
  Found by P2's look at the mirror.
- **The Y-statement's budget** is in the ADR's own lint (80 words, a warning; 120, an error), not
  the type's `summary_words`, which belongs to the "Summary for approval" check.
- **`components`** (optional front matter) is how an ADR says what it governs; a ticket or plan
  that names one gets it in full.
- **`status_reason`** holds your reason for a rejected or deprecated ADR.
- **No `mirai-write` guide for ADRs yet:** its guides need three before/after examples from real
  drafts; P1's draft is the first. The rules are in the template and the checklist.

## Questions for Jet

None open.
