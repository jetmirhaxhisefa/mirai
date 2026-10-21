---
status: draft
version: 2
---

# 05 — Open questions

Each question lists what it blocks and my recommendation. **Version 2** marks the ones you
answered in review round 1 (`design/06-review-round-1.md` §G, 2026-10-21). Unit numbers refer to
`07` version 2.

## A. Install and runtime

1. **Package name and install method.** **Answered:** install from a pinned GitHub tag,
   `npx github:<owner>/mirai#vX.Y.Z`. Nothing is published to npm for now. An npm name (`mirai-dev`
   or a scope) can come later.
2. **Which GitHub owner hosts MIRAI?** **Answered:** your personal GitHub account. The exact
   handle goes into unit 10's spec.
3. **Claude Code headless auth.** **Answered: subscription only.**
   - `--bare` is out, because it skips the OAuth token (`research/09` §4).
   - Overnight runs use `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`, with
     `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` unset (`research/09` §5).
   - Isolation comes from the strict settings bundle instead (unit 13).
4. **Node version floor.** **Recommendation:** current Node LTS. `doctor` checks it.
5. **MIRAI's own license.** **Recommendation:** MIT. It's compatible with what we reuse (MADR,
   mattpocock, Rust RFC, Atlassian Apache-2.0 ideas). It's not CC BY-SA, which is why we don't
   copy arc42 text.

## B. Workflow choices

6. **Stacked MRs.** **Answered (D2):**
   - on, within one epic, at most 2 levels;
   - nothing merges without you;
   - built in unit 47.
7. **Default budgets.** **Withdrawn** (R-M4).
   - The earlier numbers ($2 per S ticket, etc.) were unrealistic.
   - With a subscription, budgets are counted in turns, tokens and minutes. Dollars are only
     Claude's estimate.
   - The calibration run (unit 50) writes the defaults.
8. **Track for a "standard" item: who decides when the PM proposal is wrong?**
   - **Recommendation:** you, at the intake gate.
   - Document approval is always yours (D6), so this is settled in practice.
9. **Where does the morning report go?**
   - **Recommendation:** a file in the repo plus the terminal for the MVP (unit 49).
   - A Slack post comes later.
10. **Release.** **Answered (D3):**
    - **Default:** ticket by ticket.
    - **Per epic:** you can choose `release: together`, with a `feature/<epic>` branch and a final
      E2E test.
    - **Feature flags:** only when you ask.
    - **Staging:** **Answered.** Some projects have it, new unreleased ones often don't, and they
      will later. So the release stage reads `release.environments` from config and adapts: with
      staging, deploy there and verify first; without it, the record plus your go/no-go and a smoke
      check after deploy; not released yet, record only. `doctor` reports the current shape, and
      adding staging later is a config change (unit 57).

## C. Connectors

11. **Which external store first?** **Answered (D4):**
    - none in the MVP;
    - the `repo` store sits behind a generic connector contract (unit 33);
    - candidates for later: ClickUp (personal tasks), Jira (work), Linear (one project).
12. **Storage mode `both`.** **Answered (D5):**
    - removed;
    - each artifact type has one source of truth, never two;
    - different types may live in different tools.
13. **Status mapping per tracker.** Jira has no default "In Review" status, and ClickUp and Linear
    use custom statuses. When the first connector is built, setup asks per project, as BMAD does.

## D. Agents and naming

14. **Persona names.** **Answered:** kept for now. They can change later.

    | Persona | Role |
    |---|---|
    | Nora | product manager |
    | Arlo | architect |
    | Tess | ticket planner |
    | Kai | developer |
    | Rex | reviewer |
    | Ivy | QA |
    | Vera | verifier |

15. **Second model family.** Not needed until Milestone D (D1). Until then the verifier ladder uses
    a different Claude model (rung 2), else the same model. Is Codex installed and logged in on
    the machine that runs overnight? This decides rung 1 in unit 60.

## E. Pilot (Thudos)

These were raised in `research/04` §6 and are still open:

16. **P3 Decision docs.** Is `docs_old/decisions/` still the truth? Do HLD-0002, ADR-0004 and
    ADR-0009 exist anywhere?
17. **P6 Business context.** Is `ALL_FEATURES.md` in the mockup repo the input for the business
    context and feature map?
18. **P7 Local URLs.** Which local setup is current: the `*.thudos.test` proxy or ports 8000/8080?
    QA (Milestone C) can't run until this is settled.
19. **P9 Risk paths.** Reuse the council's high-risk path list as MIRAI config?
20. **Where should repo-mode docs go in the pilot?**
    - **Recommendation:** continue the existing `docs/decisions/` numbering for ADRs/HLDs (D-20)
      and put PRDs and tickets under `docs/mirai/`.
21. **Can the pilot run CI with required checks?** It decides whether unit 19 is CI-enforced or
    reports "local-only" (R-M21).
22. **Does the pilot's compose file mount anything outside the project** (home folder, docker
    socket)? Unit 14 needs it not to.

## F. Known risks to watch (not questions, but they could change the design)

- **Cursor loading things twice:** Cursor imports Claude's and Codex's folders. How it handles
  duplicate skill names is UNVERIFIED (`research/08` §5.2). Unit 61 must test it.
- **Codex hooks need user trust** and are skipped otherwise. Fine, because hooks aren't the gate.
- **Tree-hash records and rebases:** resolved. Records are bound to the patch-id over code paths
  (R-C1, unit 17), so a clean rebase keeps the record.
- **Claude Code rule matching is a single point of failure for reads.** File tools and hooks run
  outside the OS sandbox and rely on the deny rules being right (`research/09` §7). The red-team
  test in unit 13 is re-run by `doctor` after every Claude Code update. A failure blocks the
  autonomous preset.
- **The OAuth token is readable by the agent.** The network allowlist limits where it could be
  sent (`research/09` §7).
- **Run log growth:** one file per run keeps merges clean. Old runs may need compaction later.

## G. Facts to settle by test (UNVERIFIED in `research/09`)

Each is settled in the unit named, before anything depends on it:

| # | Fact | Unit |
|---|---|---|
| G1 | Deny rules behave the same in headless `-p` as in interactive mode | 13 |
| G2 | The exit code and JSON shape when a usage limit is hit in `-p` | 13 (used by 46) |
| G3 | The exit code and JSON subtype when `--max-turns` is reached | 15 |
| G4 | `total_cost_usd` is reported on subscription auth | 15 |
| G5 | `CLAUDE_CODE_OAUTH_TOKEN` works for an unattended run on this machine | 13 |
