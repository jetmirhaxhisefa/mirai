---
unit: "24a"
name: review
status: approved (2026-11-07; reopened the same day after the first draft missed roadmap row 24, rewritten, open points decided, approved again; not built yet)
roadmap: design/07-implementation-roadmap.md, row 24 (Rex, read-only, mirai-review skill); design/01 §9 (review per ticket, loop rules L1–L8), §8 (R3-M9 clean instruction files); design/04 (reviewers read a clean export; read-only roles by the sandbox, TL3-23; verdicts from structured output, R2-C1; the findings schema, R-M7); notes from 18c, 21a, 21c, 21f, 22
depends_on: ["19", "20", "09", "21c", "22"]
---

# Unit 24a: review (Rex), the `normal` depth

Unit 24 is split (decision 2): **24a** (this spec) is the `normal` review; **24b** is the `high`-risk depth, specced on its own.

## Why

After a green build or fix round (21b, 21c), the ticket is `in-review` with MIRAI's commit of Kai's work, and nothing reviews it. design/01 §9 puts a review between the checks and QA: **Rex** (`mirai-reviewer`), a separate, read-only agent with a fresh context, reads the diff and the plan's claims, and returns a verdict with findings. Blocking findings send the ticket back to Kai as fix rounds; a pass leaves it ready for QA and ship.

Much of the review's logic is already built and waiting for this unit:

- `triage()` in `src/findings/findings.js` applies L1 (a blocking finding needs a `file:line`, a symbol and a `basis.ref` that resolves), the pre-existing rule (TL2-23: a finding outside the changed lines is downgraded), L2 (frozen after round 1: only last round's blocking findings plus new blocking ones inside the delta), and the high-risk confirmations. Its comment says unit 24 builds the changed lines it needs.
- The schemas: `review-verdict`, `finding-replies`, `finding-check` (09a, `src/findings/verdicts.js`).
- The `reviewer` role (`registry/roles/reviewer.toml`: read-only, step `review`), the read-only launch template (13b, 19b), structured output through `--json-schema` (21a, `src/agent/run.js`), `baselineRevision` (22, `src/agent/checkpoints.js`), and the loop guard's shared round budget (20).

**Decided by Jet (2026-11-07): the reviewer is separate from the author.** Only Rex reviews. Kai (`mirai-developer`) is never launched for the review step, under any read-only role, which settles 21a's note ("Kai under any read-only role, such as reviewing its own change"). Rex never resumes a session; each review starts fresh.

## Scope

**In.**

1. **Rex as data.** `registry/agents/mirai-reviewer.toml` (role `reviewer`, `read_only = true`, the read-only template's tools) and its prompt `registry/agents/mirai-reviewer.md`, plus the `mirai-review` skill in `registry/skills/` with the review rules: the combined `normal` pass (correctness, edge cases, intent alignment, test gaps), the citation rule, and the finding fields the schema needs.
   - **The launch refuses** any agent other than `mirai-reviewer` for the `review` step, and refuses `mirai-developer` under the `reviewer` role.
2. **Instruction files never reach Rex (R3-M9), without an export** (decision 5, changed during the build). Rex runs in the checkout at the ticket's committed head (every launch refuses a dirty tree), under the read-only template and `--restricted`, which every headless launch already uses: a branch's `CLAUDE.md` at any depth, `AGENTS.md`, and `.claude/` agents, skills and commands don't load. The red team proves it: `c-instructions` (read-write) passed 3/3 on 2026-11-07, and 24a adds **`c-instructions-review`**, the same planted files aimed at the reviewer, under the read-only template, for Rex. The project's own conventions reach Rex through the input folder, from the integration branch. **The clean export** of design/04 (a read-only copy with the integration branch's instruction files) **isn't built**: it would change the launch's working folder, the sandbox profile and the hook's roots, red-tested code, for a second layer behind `--restricted`. It stays a hardening item; if `--restricted` ever stops working, `c-instructions` fails and every headless launch stops.
3. **The inputs, as files, never pasted (B8, R3-C3).** In the launch's read-only input folder:
   - **the diff** since `baseline_revision`, built with pinned git (`--no-ext-diff --no-textconv --no-color`, rename detection off, fixed context) and **with `.gitattributes` ignored** (TL3-12), so `-diff` or `binary` attributes can't hide code; fenced as data in the prompt's description of it;
   - the plan's frozen intent and claims, the ticket's ACs, and the conventions and ADRs the ticket is governed by;
   - from round 2: last round's blocking findings and the **delta** since that round.
4. **The changed lines** for `triage()`: new-file line numbers of the whole diff since `baseline_revision`, plus the line next to each deletion, from the same pinned diff.
5. **The verdict.** Rex's verdict comes back as structured output against the `review-verdict` schema, captured by the launcher (R2-C1). MIRAI checks it, runs `triage()`, and stores `review-<ticket>-r<n>.json` in the store with a summary line in the journal. Nothing is committed or posted (Q9). The signed review proof is unit 25's.
6. **What the verdict does to the ticket:**
   - **Pass** (no blocking findings after triage): the ticket stays `in-review`; non-blocking findings go to the follow-up list in the report.
   - **Blocking findings:** `in-review → in-progress` (uses a round, from the loop guard's shared budget), and `mirai fix` takes the blocking findings as its round's input (21c: "review findings as a source of rounds: unit 24"). 21c's refusal rule widens: `mirai fix` starts after a build or fix that ended `checks-failed`, **or after a review that ended with blocking findings**, with MIRAI's commit and a clean tree either way.
   - **An instruction-file change** in the diff (`CLAUDE.md`, `AGENTS.md`, `@` imports, project skills, `.claude/**`) **blocks in supervised mode too**: the review stops with `needs-you` until you approve it (design/01 §8).
7. **Kai's replies (L3).** In a fix round started from review findings, Kai answers each blocking finding with `fixed` or `disputed: <one sentence>` (the `finding-replies` schema). Rex doesn't reply to disputes.
8. **The step, for you and for the night.** `mirai review <ticket>` (decision 1, below) is a thin CLI over `runReview({ cwd, env, ticket, unattended, ... })` in `src/agent/review.js`, the same shape as `mirai fix` over `runFix()`. Unit 28's `mirai run` (and unit 55's overnight queue) calls `runReview()` directly, inside its run (`launchInRun`). **Unattended, every stop for you parks the ticket instead** (row 28: "park the ticket and go on, not stop the run"): a disputed finding, an instruction-file change, a verdict that isn't valid structured output. Each park carries a note for the morning report.
9. **From your Claude Code session (21f's rule).** `review` joins 21f's command list (`COMMANDS` in `src/mcp/tools/commands.js`, `tty: true` like `fix`), so `/mirai review <ticket>` runs from your session as `mirai review <ticket>` does in your terminal, with Claude Code asking you first. `unpark --accept <finding-id>` is a gate: `/mirai unpark` answers with both terminal commands (`--retry` and `--accept <finding-id>`) and runs nothing. The rendered command file (`.claude/commands/mirai.md`, from `src/adapters/claude-code.js`) lists both.
10. **Red-team cases (from 18c):** a branch's `.gitattributes` with `-diff` on a changed file, and instructions aimed at the reviewer (a nested `CLAUDE.md`, an `@` import, a `.claude/commands/` file) planted in the branch. Each must not reach Rex's context, and the hidden code must still be in the diff Rex gets.

**Out.**

- **The signed review proof and `mirai gate`:** unit 25.
- **Test-scope findings** (tests at a needlessly high level, tests for unchanged code) **and the MR review timer:** unit 48.
- **`mirai inbox`** for disputed findings: unit 46.
- **Chaining build → review → fix → review** without you: unit 28 (`mirai run`).
- **The `ask` rule from 21f:** its own item in PROGRESS's Next line, not this unit.
- **QA (Ivy):** unit 51.

## Probes (with your OK before each batch)

- **R1. Rex launches under the read-only template on a clean export** (Haiku, about 2 runs, a sample-app clone, gate stubbed): the init check passes, the working folder is the export, a planted nested `CLAUDE.md` isn't in the run's context, and the verdict comes back as structured output.
  - **What we learn:** the export and the structured verdict work with the real Claude Code.
- **R2. A real review** (Sonnet, 1 to 2 runs, a sample-app ticket with a seeded bug and a seeded uncited finding target):
  - **What we learn:** Rex finds the seeded bug with a citation; an uncited finding is downgraded; a finding on an untouched line is marked pre-existing.
- **R3. Round 2** (Sonnet, 1 run, after a fix round): Rex gets only the delta and last round's blocking findings.

## Files

- **New:** `registry/agents/mirai-reviewer.toml`, `registry/agents/mirai-reviewer.md`, `src/agent/review.js` (the step), `src/review/diff.js` (the pinned diff and the changed lines), `src/cli/commands/review.js`, tests.
- **Changed:** `src/agent/fix.js` (findings as a round's input, Kai's replies), `src/agent/run.js` (the agent and role checks for the review step), `src/cli/commands/unpark.js` (`--accept <finding-id>`), `src/mcp/tools/commands.js` and `src/adapters/claude-code.js` (`/mirai review`, the unpark gate's two commands), `src/redteam/cases-agent.js` (the 18c cases), docs (design/01 §9's "built" notes, roadmap row 24, the README).

## Tests (`npm test`, no model; a stand-in `claude`)

- Kai under the `reviewer` role, or any agent but Rex for the `review` step, is refused before launch.
- Rex's launch runs under the read-only template with `--restricted`, in the checkout at the ticket's committed head; a dirty tree is refused.
- The diff: a `.gitattributes` `-diff` or `binary` rule doesn't hide a changed file; a deletion marks the next line as changed.
- A verdict that fails the schema, or doesn't come back as structured output, is refused (never a pass).
- `triage()` gets the changed lines, so a finding on an untouched line is pre-existing, and from round 2 the delta.
- Blocking findings move the ticket to `in-progress` and use one round; a pass leaves it `in-review`.
- An instruction-file change stops the review with `needs-you`, in supervised mode too.
- A disputed reply is recorded and stops the loop for you (`needs-you`), or parks the ticket unattended (decision 3).
- `mirai unpark <ticket> --accept <finding-id>` drops only that finding, signed, in a real terminal, and logs it as a false positive; an id that isn't a disputed finding of the ticket is refused.
- `/mirai review <ticket>` runs the step through the session server; `/mirai unpark` runs nothing and answers with both terminal commands.

## Done when

- The tests pass, R1–R3 are recorded in `test-results.md`, the red team is green with the new cases, and a sample-app ticket goes build → review (blocking) → fix → review (pass) by hand.

## Open points for you

1. **Decided (Jet, 2026-11-07): a step command, `mirai review <ticket>`,** like `plan`, `build` and `fix`, in your terminal; units 28 and 55 chain the steps through `runReview()`. Row 48's MR-and-timer command needs another name (for example `mirai open <ticket>`), settled when 48 is specced; row 48's text gets a note now.
2. **Decided (Jet, 2026-11-07): split.** **24a** is the `normal` review (everything in Scope); **24b** is the `high`-risk depth (the parallel lens passes and the per-finding check), with its own spec (parallel launches under the run lock, merging the lenses' findings, the cost on `deep`). Until 24b, a high-risk ticket gets the `normal` pass and then stops for you (parks unattended); it never passes at the lower depth.
3. **Decided (Jet, 2026-11-07): a disputed finding, before `mirai inbox` exists (unit 46).** The round finishes as usual (Kai's other fixes are committed and tested); then, if any blocking finding is disputed, the ticket stops for you: `needs-you` in your terminal, a park unattended. The note shows Rex's finding, Kai's one-sentence reason, and the file and line; the dispute is kept in the store for unit 46. To settle it, signed, in your terminal:
   - `mirai unpark <ticket> --retry` (exists): the finding stands; Kai fixes it in the next round;
   - **new in 24a:** `mirai unpark <ticket> --accept <finding-id>`: the finding is dropped and logged as a reviewer false positive (feeds M5, reviewer precision).
   A disputed finding never counts as non-blocking by itself (Kai could escape any finding by disputing it).
4. **Decided (Jet, 2026-11-07): `mirai fix` keeps stopping at green checks** (`in-review`), as in 21c. In your terminal you run `mirai review <ticket>` again, and Rex's round 2 gets the delta and last round's blocking findings automatically; at night, `mirai run` (units 28, 55) runs the next review itself. `mirai fix` now also starts after a review with blocking findings, not only after failing checks (item 6).

All four open points are decided. Approved by Jet on 2026-11-07.

5. **Decided during the build (Jet, 2026-11-08): no clean export.** Every headless launch already runs `--restricted`, and the red team's `c-instructions` proves a branch's instruction files don't reach an agent; building the export would change red-tested launch code for a second layer. 24a adds a read-only `c-instructions-review` case for Rex instead (item 2); the export stays a hardening item.

## Changes during the build (2026-11-08)

What the build found that the spec didn't say, or said differently. Each is in the code and tested.

1. **No clean export** (decision 5, yours): Rex runs in the checkout under `--restricted`; the red team proves it for his template with `c-instructions-review`.
2. **A dispute parks in your terminal too, not only at night.** `needs-you` would have left nothing to settle it with: `mirai unpark` takes a parked ticket only. The parking note names both commands.
3. **`--accept` takes one or more ids, and the disputes you don't name stand.** One signed move either way, never a dead end: none stand → back to `in-review` (a new unpark choice, `accept`, for a disputed park only); some stand → `in-progress`, and the next `mirai fix` sends them to Kai as upheld (a second dispute of them is taken as `fixed`).
4. **L5 compares like with like.** The loop guard compared each round's open count with the last one, whatever its kind: "failures fixed to green, then two review findings" would have parked as no progress. A review now compares with the review before it (`previousOpen`), and the first fix round after a review isn't compared with Rex's count.
5. **A bug the tests found: a first review after a test-fixing round counted no finding.** The guard's L2 freeze is keyed on its own round number, which counts fix rounds too; with an empty delta, two correctly cited blocking findings were dropped and the change passed. A first review's delta is now the whole change.
6. **A green step that committed nothing** (a round that only disputed) is reviewed at the commit it started on, and a review of the same commit is allowed again only after a `changes` verdict (you accepted the disputes).
7. **High risk** is the plan's `risk: high` or a protected path the build found touched (instruction files, auto-run config: design/01 §8). An instruction-file change can't reach a review undeclared (the build stops it), so "blocks in supervised mode too" is the high-risk stop until 24b.
8. **Rex's model** comes from the verifier ladder (unit 19), chosen against Kai's launch.
9. **The git probes** (`pr-git-mirai`) include the review's two git calls (`changedLines --text`, `reviewPatch`), and `h-review-diff` (no model) checks the installed git can't hide code through `.gitattributes`.
10. **The `mirai-review` skill isn't made** (open for you): a headless launch loads no skills (`--restricted`), so the review rules are Rex's prompt; a skill would only serve your own sessions.
11. **The diff Rex reads carries the file's line numbers** (found by probe r3). Rex cited a line's place in `review.diff` instead of its line in the file, and triage rightly dropped the real bug as pre-existing. Each hunk line of `review.diff` and `delta.diff` now starts with the file's line number (none on a removed line); it's text for Rex, not a patch to apply. The probe also takes the sample app's planted flaky test out of its clone (21d's finding 1).
