---
status: draft
version: 1
round: 3
---

# 06 — Review round 3

## Sources

| Reviewer | File | Critical / Major / Minor |
|---|---|---|
| PM | `_review/round-3-pm.md` | 1 / 7 / 7 |
| Tech Lead | `_review/round-3-techlead.md` | 4 / 12 / 7 |
| Architect | `_review/round-3-architect.md` | 3 / 10 / 9 |

That's **60 findings**. Round 2's placement fixes are confirmed as real:
- PM: 12 of 19 closed, 7 partly closed, none fully open.
- Tech Lead: the shell wrapper, E2E timing and stacking trust root fully closed.
- Architect: 8 closed, 10 partly closed, 3 open.

**One correction to my own report:** after round 2 I wrote that the release states were now
consistent everywhere. They weren't: `03:77` and the `02` (h) diagram still had the old shape
(AR3-14). Both are fixed now.

---

## A. The pattern behind this round — a decision for you first

Every round so far has closed the holes it was given and found new ones in the same place. Each
time it's a "side door": something running on your Mac **as your own user, outside the sandbox**
that acts on files an agent or a test container can write. This round:

| Side door | Source |
|---|---|
| `.git/config` and `.git/hooks` are still writable. They run when you, your IDE or the orchestrator run git, with your credentials | AR3-1, TL3-2 |
| Agent-written config that runs on its own when you open the branch: `.claude/` hooks, `.vscode` tasks, `.envrc`, `.husky`, `package.json` scripts | AR3-12 |
| The file tools may follow symlinks the sandboxed shell creates, and reach trust-root hooks, `.git/config` or the signing key (unverified) | TL3-4 |
| The docker socket, ssh-agent, `git credential fill` (keychain) and `security find-*-password` may be reachable (unverified) | TL3-5 |
| The real `.env` is readable through Bash | TL3-14 |
| The login token can still leave: the allowed package registries accept uploads, and `claude -p` can run from Bash outside the launcher | TL3-3 |
| User memory and user skills may still load into headless runs | TL3-15 |

**My honest assessment:** with Claude Code running as *you*, every file, socket and keychain item
your user can reach is one wrong rule away. We can keep adding rules, and the reviewers can keep
finding the next gap, because the list of things your user can reach is open-ended. That makes the
design heavier every round without ever giving a clean "this is closed" answer.

**The alternative: one OS boundary, for headless runs only.** It's not a container; Claude Code
still runs directly on macOS. MIRAI runs headless agents as a **separate macOS user** (e.g.
`mirai-agent`):
- **What it can't reach:** that user has no keychain items, no ssh-agent, no `~/.ssh`, no `gh`
  login and no access to your home folder. macOS file permissions enforce this, not Claude's
  rules.
- **What it can reach:** only the project checkout, through a shared group, and its own Claude
  login (`claude setup-token` for that user).
- **Docker:** Docker Desktop's socket belongs to you, so the agent user simply can't reach it.
  Tests go through MIRAI's `run_tests` tool, which hands the request to the orchestrator running
  as you. That's the same broker the Architect asks for anyway (AR3-2).
- **Your daytime sessions** stay as they are (you, with `ask` rules).
- **What it closes:** most rows in the table above, by construction. The Claude sandbox and the
  deny rules stay as a second layer.
- **What it costs:**
  - a one-time setup with admin rights: create the user, share the project folder;
  - a slightly more complex orchestrator, which runs as you and talks to the agent process;
  - Linux later needs the same idea with a different user mechanism.
- **What stays open even then:**
  - `.git/` and auto-run config files in the shared checkout are still writable by the agent
    user. Those fixes (AR3-1, AR3-12, TL3-2) are still needed, and get simpler.
  - The login token belongs to the agent user, so a leak exposes only that user's Claude
    subscription access, not your credentials.

Round 1 listed this as "the minimum" (R-C3). You chose blocking rules without a container (D7),
which is still a valid choice. This would keep your "no container" wish and change only *who*
the agent runs as.

**Decision V1 (yours):**
- **(a) Keep D7 as is**, and apply all round-3 fixes. Expect more rounds to find more side doors,
  and state a larger residual risk.
- **(b) D7 plus a dedicated macOS user for headless and overnight runs.** My recommendation.
  Interactive sessions are unchanged.
- **(c) A VM or container per agent run.** The strongest option, but it's the container you
  didn't want, and the pilot's Docker setup makes it harder.

**Second recommendation (V2): stop design reviews after this round.** The rest of the safety
question is best answered by **tests, not more reading**. The red-team suite (`07` unit 16) has
to pass before any headless agent runs (TL3-9). It holds every attack from rounds 1–3, and the
unverified facts in `05` §G are tested in the units that rely on them. After the round-3 fixes,
I'd recommend going to "APPROVED: start implementation". Any new hole found later becomes a
failing red-team test and a fix.

---

## B. Fixes needed whichever way V1 goes

### Critical

| ID | Theme | Sources | Fix |
|---|---|---|---|
| R3-C1 | **`main` is hard-coded, but the pilot lives on `mirai/pilot`.** The first pilot run fails, or merges MIRAI into the real product's `main`. | PM3-1, AR3-8 | A `[git] integration_branch` config key (`mirai/pilot` during the pilot). Every "main" in trust root, base, MR target, docs MR, baseline and CI reads it. Recorded in D-28. |
| R3-C2 | **The quality gate has no defined place to run**, and Kai can't run lint, types, build or installs. The pilot's gate runs `docker compose exec` on the normal stack (real `.env`, open network). | TL3-1, PM3-3 | Named checks in config (`lint`, `types`, `build`, …), run by the orchestrator through `run_tests` in hardened containers. `pre-push` checks a **signed gate-result record** instead of re-running suites. Installing a new dependency is high risk and approved at the plan gate. |
| R3-C3 | **The `mirai` CLI can't be called from inside a sandboxed session**, and agent work files (plan, findings, QA scripts) have no reachable home. | AR3-2, AR3-3, TL3-7, TL3-8 | One narrow **MIRAI MCP broker** (like `run_tests`) for everything an agent or a skill needs: launch, log, lint, trace. No sandboxed process calls `mirai` directly. Inputs are injected into a read-only folder per launch, outputs come back as structured output, and QA scripts are passed as content. |
| R3-C4 | **`.git/` stays writable** (sandbox, containers), and auto-run config fires outside the sandbox. | AR3-1, TL3-2, AR3-12, TL3-12 | Sandbox `denyWrite` on `.git`. Mask `.git` in container mounts. Hash-check `.git/config` before every git call, and pin a wider set of git settings. Protect `.gitattributes`, `.gitignore`, `.lfsconfig`, `.claude/`, `.vscode/`, `.envrc`, `.husky/` and `package.json` scripts. The report warns before you open a MIRAI branch in your IDE. |

### Major (accept all)

| ID | Theme | Sources | Fix |
|---|---|---|---|
| R3-M1 | The sample app doesn't match the pilot, and it lands in the public repo | PM3-2, PM3-8 | A **private** sample-app repo in the pilot's stacks (Laravel/PHPUnit + React/Vitest + Playwright). Setup detection (unit 36) moves into A. The pilot checkpoint becomes a sized step. |
| R3-M2 | Protected-path tickets park mid-night | PM3-4 | The plan declares the protected paths it touches, approved at the plan gate. |
| R3-M3 | Keep/stop criteria not measurable, value check late | PM3-5, PM3-6 | Measure active review time, not wall time. Number the usage pass mark. The early stop uses a pre-calibration turn cap. A **B checkpoint**. The acceptance-rate script moves into unit 27. D-38 aligned with `07`. |
| R3-M4 | Human-action counts differ between files | PM3-7, PM3-12, PM3-14 | One gates table. Quick track = approve ticket + merge (+ go/no-go once release exists). The quick plan gate is auto. Count the docs-MR merge. One `unpark` list. `00` records U2 and U5. **Optional, you decide (V3):** the orchestrator merges the docs MR after your signed ticket-set approval, which saves one action per feature. |
| R3-M5 | Login-token egress via registries and `claude -p` from Bash | TL3-3 | Test an empty headless network allowlist, since Claude's own API traffic may not go through the sandbox (G16). Dependency installs only through the broker. Deny `claude` in Bash. |
| R3-M6 | `run_tests` validate-then-run gap, relative paths, project-name collision | TL3-6, TL3-17 | Validate the exact rendered file that is then run. Absolute trust-root paths. An allowlist validator. A unique compose project name per run. Strict path and argument checks. |
| R3-M7 | Red-team suite doesn't gate the first headless run | TL3-9, AR3-21 | Unit 17 depends on 16. No headless launch without a green red-team result. One red-team list, in D-30, extended with rounds 2 and 3. |
| R3-M8 | Background processes change files between review and proof | TL3-10 | Kill the agent's process group at handover, and hash at commit time. |
| R3-M9 | Planted `CLAUDE.md`, `@` imports and project skills reach the reviewer | TL3-11 | The reviewer runs on a clean export of the base's instruction files. Diffs to instruction files block in supervised mode too. |
| R3-M10 | CI: no hash recompute, permissions, same-named checks, branch registry invisible, stacked base, key lifecycle, stale baseline | TL3-13, AR3-4, AR3-5, AR3-10, AR3-11 | `mirai-verify` recomputes the hash from the PR head, uses minimal permissions and no caches. Signed `branch.json`/`handover.json` committed on the branch. Stacked MRs are verified against the integration branch, never the parent. Children never merge into a parent. A key id plus a bootstrap path for the first key, and revocation. One baseline home. |
| R3-M11 | The diff hash breaks on any base change | AR3-6 | Hash a normalized patch (pinned git options, no blob IDs or line numbers). |
| R3-M12 | Ticket status has four homes; docs-MR commits are undefined | AR3-7, AR3-9 | One status home, with derived states winning. The orchestrator commits documents on the docs branch, and the docs MR has its own gate rules. |
| R3-M13 | Lock marks too coarse; `--restricted` fallback untested; overclaiming risk text | AR3-13, TL3-15, TL3-16 | Add a third mark, `rendered`. The env scrub becomes an allowlist. Test the fallback. Use the Tech Lead's rewrite of the D-30 risk statement. |

### Minor (accept all)

The rest are listed in the reviewer files:
- PM3-9: test subscription sustainability early;
- PM3-10: a "what you do by hand" setup checklist;
- PM3-11, PM3-13, PM3-15: `03` vs `07` milestone columns, small items in A;
- TL3-18 to TL3-23: hooks path naming, key rotation, interactive Playwright MCP, a unit 20/26 loop, registry fail-open, read-only roles;
- AR3-14 to AR3-22: release states (now fixed), proof timing, state machine gaps, stacking details, verify hardening, workspace gaps, naming drift, registry order.

---

## C. What you decide

| # | Question | My recommendation |
|---|---|---|
| V1 | Safety boundary for headless/overnight runs: (a) D7 as is / (b) D7 + dedicated macOS user / (c) VM or container | **(b)** |
| V2 | After applying round-3 fixes: another review round, or approve implementation and let the red-team suite carry safety from here? | **Approve after the fixes** |
| V3 | Should the orchestrator merge the docs MR after your signed ticket-set approval (saves one action per feature)? | **Yes.** Docs only; code is never merged by MIRAI. |

---

## D. Your decisions (2026-10-23)

| # | Decision | Effect |
|---|---|---|
| V1 | **(a) Keep D7 as is.** Agents run as your user under the blocking rules; no separate user, no container. | Every fix in B applies, in its D7 form. The D-30 residual-risk statement is rewritten honestly (TL3-16). **Condition:** if the red-team tests show that the docker socket, ssh-agent, keychain (`git credential`, `security`) or the real `.env` are reachable and can't be closed by configuration (TL3-5, `05` §G), it becomes a blocker. Then V1 comes back to you before any headless run. |
| V2 | **Yes:** no further design review after the round-3 fixes. The red-team suite carries safety from there. | The red-team suite must pass before any headless launch (R3-M7). New holes found later become failing tests plus fixes. |
| V3 | **Yes:** the orchestrator merges the docs MR after your signed ticket-set approval. | Documents only; code is never merged by MIRAI. One action less per feature. |

**Applied on 2026-10-23** to `00`–`05`, `07` and `research/09`. A cross-check aligned the list of unverified facts: `05` §G is the master list (G1–G29), and `research/09` §8 and `04` now use the same numbers. Feedback capture was added (`08` addendum).
