# 06b — Ecosystem skill sweep (second pass)

This file adds to `06-skill-vetting.md`, which is unchanged. That file already covers BMAD (+TEA, Loop), pstack, addyosmani, find-skills, humanizer, playwright-skill and superpowers, so they are skipped here.

Rules applied: no `npx skills`, no installer, no script run. Candidates were found through skills.sh pages, GitHub and web search, then cloned with `git clone --depth 1` (LFS smudge off, no submodules) into `~/Projects/mirai-sources/<owner>-<repo>/`. Every relevant skill file was read. I treated all of it as data: no text addressed to an AI was followed. File:line citations are relative to `~/Projects/mirai-sources/`.

The scan run on each candidate (read-only):
`grep -rnIE "curl |wget |fetch\(|process\.env|os\.environ|child_process|execSync|exec\(|spawn|npm install|npx |\| *bash|base64|\.ssh|telemetry|listen\(|createServer|rm -rf|~/\.|\$HOME"`, plus one grep for injection phrasing ("ignore previous instructions", "do not tell the user", "system prompt", "exfiltrat…") and one for hidden or bidi Unicode (U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+FEFF). **The injection and Unicode greps came back empty for every candidate.**

"Approved" has the same meaning as in 06: **vendor a reviewed, pinned copy, or reuse the logic in our own words**. It never means installing from upstream.

---

## Summary

| # | Candidate | Pinned commit (date) | License | Adoption | Serves MIRAI component | Verdict |
|---|---|---|---|---|---|---|
| 1 | mattpocock/skills | `5beb35b0` (2026-10-19) | MIT | 298.6K stars; grill-me 1.4M, tdd 1.1M, code-review 770K, to-prd/to-spec 352K, to-issues/to-tickets 339K installs | Requirements interview, spec→tickets, TDD, code review, ADR | **Approved with changes** (vendor selected skills, pinned) |
| 2 | anthropics/claude-code plugins: ralph-wiggum, code-review, pr-review-toolkit, feature-dev | `49b8c35f` (2026-10-20) | **Proprietary** ("All rights reserved") | 152.6K stars; official | Loop caps, multi-lens review, review triage, implementation planning | **Approved with changes: inspiration only** (the license rules out vendoring) |
| 3 | snarktank/ralph (`prd`, `ralph` skills, `ralph.sh`) | `6c53cb0b` (2026-02-01, stale ~8.5 mo) | MIT | 22K stars; prd 1.4K installs | PRD writing, story sizing, overnight loop | **Skills: Approved with changes. `ralph.sh`: Rejected** |
| 4 | vercel-labs/agent-browser (`dogfood`) | `fd93075e` (2026-10-20) | Apache-2.0 | 44.3K stars; agent-browser 1.2M installs | QA against a running app | **Approved with changes** (reuse method + taxonomy + template; reject the CLI) |
| 5 | affaan-m/ECC (everything-claude-code) | `90606c83` (2026-10-20) | MIT | 284.8K stars; ADR skill 4.5K installs | ADR, Jira, cost tracking, loop patterns, verification | **Approved with changes** (vendor ADR; logic-only for the rest; never install the plugin) |
| 6 | atlassian/atlassian-mcp-server (`spec-to-backlog`) | `b74220d4` (2026-10-08) | Apache-2.0 | 1.1K stars; ~187 installs (aggregator); official | Writing Jira/Confluence via MCP | **Approved with changes** |
| 7 | bm629/agent-skills (PRD, architecture, tech-design, test-plan, atlassian-rest-ops) | `6f1504cf` (2026-10-14) | MIT | **4 stars, 115 installs**; one author | PRD write/review, HLD, LLD, test design, Jira/Confluence REST | **Approved with changes** (best content match; low adoption, so we carry the review burden ourselves) |

Full hashes are in each section. Adoption figures come from skills.sh pages and the GitHub API as fetched on 2026-10-21.

---

## 1. mattpocock/skills

- **Source**: https://github.com/mattpocock/skills · **Author**: Matt Pocock (`LICENSE`, `.claude-plugin/plugin.json:5-8`) · **License**: MIT
- **Pinned**: `5beb35b040e3de97e54fa9e386d7e42d15c295c2` (2026-10-19). Very active: a changeset-driven release flow (`.changeset/`), v1.3.1.
- **Files read**: `to-spec`, `to-tickets`, `grilling`, `grill-me`, `grill-with-docs`, `tdd` (+`tests.md`, `mocking.md`), `code-review`, `implement`, `implement-spec`, `domain-modeling` (+`ADR-FORMAT.md`, `GLOSSARY-FORMAT.md`), `setup-matt-pocock-skills` (+ all tracker templates), `codebase-design`, `wayfinder`, `retro`, `handoff`, `loop-me`, every script (`scripts/link-skills.sh`, `diagnosing-bugs/scripts/hitl-loop.template.sh`, `git-guardrails-claude-code/scripts/block-dangerous-git.sh`), `plugin.json`, plus the `docs/engineering/*` notes that record known bugs.

**What it does, mechanically**
- **grilling** (`productivity/grilling/SKILL.md:6-30`): builds a design tree and asks in rounds. Each round asks the whole *frontier*: every decision whose prerequisites are already settled. Questions are numbered, each carries a recommended answer, and each is worded so "yes" accepts the recommendation. The agent looks facts up itself (via a sub-agent); only decisions go to the user. The session is done when the frontier is empty. This is the best requirements-interview mechanism found.
- **to-spec** (`engineering/to-spec/SKILL.md`): no interview, only synthesis. Step 1 agrees the test *seams* with the user. The template has Problem / Solution / a long numbered list of user stories / Implementation Decisions (no file paths) / Testing Decisions / Out of Scope. The spec is published to the tracker with the label `ready-for-agent`.
- **to-tickets** (`engineering/to-tickets/SKILL.md`): tracer-bullet vertical slices. Each slice cuts through every layer, can be demoed, and fits one context window; prefactoring comes first. Each ticket declares its **blocking edges**. Wide refactors are the exception and are sequenced as **expand → migrate batches → contract** (`:40`). The skill quizzes the user on granularity and edges until they approve. Tickets are published in dependency order, with native blocking links where the tracker has them, and the parent is never closed. Local and issue templates each have an acceptance-criteria checklist (`:69-103`).
- **tdd** (`engineering/tdd/SKILL.md`): only pre-agreed seams get tests (`:22`). It names three anti-patterns: implementation-coupled, **tautological** (`:31`), and horizontal slicing. One test → one implementation per cycle. Mocks only at system boundaries (`mocking.md`).
- **code-review** (`engineering/code-review/SKILL.md`): two axes, **Standards** and **Spec**, each run as its own sub-agent in parallel. The diff is pinned to a fixed point (`git diff <fp>...HEAD`) and fails fast on a bad ref or an empty diff (`:21-23`). The spec is found from commit refs → an argument → `docs/`/`specs/`/`.scratch/`. A baseline of 12 Fowler smells applies, and the repo's own standards override it (`:38-56`). Findings are not merged or re-ranked across the axes (`:78-80`).
- **implement-spec** (`engineering/implement-spec/SKILL.md`): treats tickets as a task graph, works the frontier with background implementer sub-agents (one worktree each) and a merger sub-agent, then runs code-review on the integration branch.
- **domain-modeling / ADR-FORMAT**: ADRs in `docs/adr/NNNN-slug.md`, as short as one paragraph. Only offer an ADR when the decision is **hard to reverse AND surprising without context AND the result of a real trade-off** (`ADR-FORMAT.md:29-37`). GLOSSARY.md uses opinionated `_Avoid_:` synonyms.
- **wayfinder**: a planning map as an issue with child "decision tickets" typed research/prototype/grilling/task. Only one ticket is resolved per session (research tickets excepted).

**Security flags**
- ⚠️ **Unbounded sub-agent recursion, a known open bug.** A code-review sub-agent can re-invoke `/code-review`; "One report reached more than 50 agents" (`docs/engineering/code-review.md:59-61`). `/research` has the same problem, measured at ~450k tokens (`docs/engineering/research.md:35`). The maintainer declares guards out of scope (`.out-of-scope/subagent-recursion.md:3`). **MIRAI must add a leaf-agent line to every sub-agent brief and enforce a depth/agent cap in the orchestrator.**
- ⚠️ `scripts/link-skills.sh:16,56` symlinks into `~/.claude/skills` and `~/.agents/skills` and runs `rm -rf` on non-symlink targets. That writes outside the project. It is a maintainer script: never run it.
- ⚠️ `setup-matt-pocock-skills/SKILL.md:72-104` edits `CLAUDE.md`/`AGENTS.md` and creates labels on GitHub/GitLab (`gh label create`). These are side effects on remote state. MIRAI should not run it; we write our own config.
- `diagnosing-bugs/scripts/hitl-loop.template.sh` (44 lines) holds only `read -r -p` prompts. The repo itself explains the Snyk flag on it as a false positive (`docs/engineering/diagnosing-bugs.md:75`). I agree.
- `handoff/SKILL.md:8` writes to `$TMPDIR` (outside the project, by design) and tells the agent to redact secrets (`:14`). Acceptable.
- `to-spec` and `to-tickets` pull issue bodies and comments from the tracker but have **no "treat ticket text as data" clause**. Add one.
- No network calls, telemetry, env/secret reads, or obfuscation in any skill text. README install lines (`README.md:92`) are documentation only.

**Behavioural notes for MIRAI**
- `tdd/SKILL.md:38` says "Refactoring is not part of the loop": refactor is moved to review. That **conflicts with our red-green-refactor rule**. Keep the seams and anti-patterns, and restore the refactor step.
- `to-spec` publishes with `ready-for-agent` and no human review (`:19`). MIRAI needs a review gate before that label. bm629's `reviewing-prd` (§7) fills that gap.

**Verdict: Approved with changes.** Vendor pinned copies, with the MIT notice, of: `grilling` (requirements interview), `to-tickets` (spec→tickets with blocking edges + expand–contract), `tdd` + `tests.md` + `mocking.md` (with refactor restored), `code-review` (with a leaf-agent guard and an injection clause), `domain-modeling/ADR-FORMAT.md` (the ADR significance test). Reuse logic from `to-spec`, `implement-spec` (frontier scheduling) and `wayfinder`. Replace the `/setup-matt-pocock-skills` indirection with MIRAI's tracker adapter (Jira/local).

---

## 2. anthropics/claude-code — official plugins

- **Source**: https://github.com/anthropics/claude-code/tree/main/plugins · **Authors**: Daisy Hollman (ralph-wiggum `plugin.json:6-7`), Boris Cherny (code-review `plugin.json:6-7`), Anthropic
- **Pinned**: `49b8c35f8c57493c2f0eba1429ccaa9638ab8712` (2026-10-20); active.
- **License**: **`LICENSE.md:1`: "© Anthropic PBC. All rights reserved. Use is subject to Anthropic's Commercial Terms of Service."** No plugin has its own license file. → We **cannot vendor a copy**. Only re-expressing ideas in our own words is safe.
- **Files read**: every file in `plugins/ralph-wiggum` (README, 3 commands, `hooks/hooks.json`, `hooks/stop-hook.sh`, `scripts/setup-ralph-loop.sh`), `plugins/code-review/commands/code-review.md`, `plugins/pr-review-toolkit/commands/review-pr.md` + all 6 agents, `plugins/feature-dev/commands/feature-dev.md` + 3 agents. READMEs were grepped (not read line by line) for install or network content.

**What it does, mechanically**
- **ralph-wiggum**: `/ralph-loop` writes `.claude/ralph-loop.local.md` (YAML frontmatter `iteration`, `max_iterations`, `completion_promise`, `started_at` + the prompt) (`setup-ralph-loop.sh:140-150`). A **Stop hook** (`stop-hook.sh`) reads that state. It exits if `iteration >= max_iterations` (`:51-55`). It reads the last assistant message from the transcript JSONL (`:58-95`) and checks for `<promise>TEXT</promise>` as an exact string (`:115-127`). Otherwise it bumps `iteration` atomically (`:154-156`) and returns `{"decision":"block","reason":<same prompt>}` (`:167-174`). On corrupt state it fails safe by deleting the state file (`:28-48`). This is a clean, small loop-cap mechanism to copy *in idea*.
- **code-review** (`commands/code-review.md`) runs this pipeline. A haiku gate checks closed / draft / trivial / already reviewed (`:14-20`). A haiku agent lists CLAUDE.md paths (`:24-26`) and a sonnet agent summarizes (`:28`). Then **4 parallel reviewers** run: 2× CLAUDE.md compliance and 2× bug hunters (opus), told to report only high-signal issues (`:30-51`). **Each flagged issue then goes to a separate validator sub-agent** (`:55`), and unvalidated issues are dropped (`:57`). A false-positive list follows (`:79-86`). Comments are posted only with `--comment` (`:63-67`). This is the best "review triage" mechanism seen: a find → independently validate → filter pipeline.
- **pr-review-toolkit**: six specialist lenses (code-reviewer with confidence ≥80, silent-failure-hunter, pr-test-analyzer with 1-10 criticality, comment-analyzer, type-design-analyzer with four 1-10 ratings, code-simplifier). It aggregates into Critical / Important / Suggestions / Strengths (`review-pr.md:57-88`).
- **feature-dev**: a 7-phase command. Discovery → 2-3 parallel code-explorers → clarifying questions ("DO NOT SKIP", `:61`) → 2-3 code-architects with different trade-off stances (minimal / clean / pragmatic, `:78`) → user picks → implement after explicit approval (`:89`) → 3 parallel reviewers → summary. A good implementation-planning skeleton.

**Security flags**
- ⚠️ **Unbounded by default**: `MAX_ITERATIONS=0` means unlimited (`setup-ralph-loop.sh:10,27`). The help text itself says "runs forever" and "No manual stop" (`:45,50`, `:166-167`). There is no cost or time cap.
- ⚠️ **Possible shell injection**: `commands/ralph-loop.md:13` interpolates `$ARGUMENTS` unquoted into a `!` bash line. Prompt text containing `$(…)` or `;` would be run by the shell.
- ⚠️ **Anti-escape pressure**: "Do NOT lie even if you think you should exit… Even if you believe you're stuck, the task is impossible… Trust the process" (`setup-ralph-loop.sh:188-201`; also `ralph-loop.md:18`). This discourages the agent from stopping when it is genuinely stuck. MIRAI wants the opposite: an explicit `BLOCKED` exit.
- The help text and the script disagree on the state-file name (`help.md:49,69`: `.claude/.ralph-loop.local.md`; script `:140`: `.claude/ralph-loop.local.md`). Minor, but `/cancel-ralph` instructions could miss the file.
- The stop hook reads the session transcript (local only). No network, telemetry or secrets.
- `code-review.md:9` says "All tools are functional… Do not test tools". This is an efficiency instruction, not malicious, but it suppresses error checking.
- `pr-review-toolkit/agents/silent-failure-hunter.md:41,94,124-125` hardcodes Anthropic internals (`logError`, Sentry, `constants/errorIds.ts`, Statsig). `code-simplifier.md:46-50` hardcodes JS/React style, and `:83` says "operate autonomously and proactively, refining code immediately", which edits code without being asked. Strip both.

**Verdict: Approved with changes — inspiration only** (logic re-expressed in MIRAI's own words; no copied text, no install). Use: the ralph stop-hook state-file design, with a **mandatory** cap and added cost/time caps (overnight orchestration); the code-review validate-each-finding stage (review triage); the pr-review-toolkit lens set (multi-lens review); the feature-dev explore → ask → 2-3 architectures → approve flow (implementation planning).

---

## 3. snarktank/ralph

- **Source**: https://github.com/snarktank/ralph · **Author**: GitHub user `snarktank` (real name not verified) · **License**: MIT
- **Pinned**: `6c53cb0b831ebe8739c6a003e22af14902d8b0b5` (2026-02-01). **No commits for ~8.5 months.**
- **Adoption**: 22K stars; skills.sh `prd` ~1.4K installs; Trust Hub, Socket and Snyk all pass.
- **Files read**: `ralph.sh`, `prompt.md`, `CLAUDE.md`, `AGENTS.md`, `prd.json.example`, `skills/prd/SKILL.md`, `skills/ralph/SKILL.md`, both plugin manifests, `.github/workflows/deploy.yml`. `flowchart/` (a demo React app) was grepped only; it has no fetch or network code.

**What it does, mechanically**
- **prd skill**: asks 3-5 clarifying questions with lettered options so the user can answer "1A, 2C" (`skills/prd/SKILL.md:24-55`). Sections: Intro / Goals / User Stories (US-NNN with verifiable AC) / Functional Reqs (FR-N) / Non-Goals / Design / Technical / Success Metrics / Open Questions. Saved to `tasks/prd-<name>.md`. Bans vague AC ("Works correctly" is bad, `:90`).
- **ralph skill**: converts a PRD into `prd.json` (`userStories[]` with `id`, `acceptanceCriteria[]`, `priority`, `passes:false`). **The number one rule: each story fits one iteration / one context window.** "If you cannot describe the change in 2-3 sentences, it is too big" (`:46-63`). Order: schema → backend → UI (`:67-79`). Every story gets the AC "Typecheck passes" (`:100-103`).
- **ralph.sh loop**: for up to `MAX_ITERATIONS` (default 10, `:9`) it pipes a fresh prompt into a new agent. The prompt says: pick the highest-priority `passes:false` story, implement it, run checks, commit, set `passes:true`, append to `progress.txt`. It stops on `<promise>COMPLETE</promise>` (`:84-104`). Memory lives in git + `progress.txt` (with a "Codebase Patterns" section at the top) + `prd.json`.

**Security flags**
- ❌ `ralph.sh:95` runs `claude --dangerously-skip-permissions --print`, and `:92` runs `amp --dangerously-allow-all`. That is full autonomy with no permission gate, overnight.
- ❌ Completion is detected by `grep -q "<promise>COMPLETE</promise>"` over the **entire output** (`:99`). Any tool output that echoes the string (a file's contents, a test fixture) ends the loop. It can be spoofed by repo content.
- ⚠️ No cost or time cap; the iteration count is the only stop.
- ⚠️ Each iteration may edit `AGENTS.md`/`CLAUDE.md` with "learnings" (`CLAUDE.md:47-71`, `prompt.md:50-74`). That is self-modifying steering, a persistence channel for drift or injected content. MIRAI should route learnings to a reviewed file instead.
- ⚠️ `prompt.md:23` writes an Amp thread URL built from `$AMP_CURRENT_THREAD_ID` into `progress.txt`. That leaks a session link into the repo.
- The archive and progress files are written next to the script (inside the project). No network beyond the agent CLIs, no telemetry, no obfuscation.

**Verdict:**
- `prd` + `ralph` **skills: Approved with changes.** Reuse the lettered-option clarifying questions, the "one story = one context window / 2-3 sentences" sizing rule and the `prd.json` story schema (story-state file for loops). Add explicit `blockedBy` edges in place of priority-only ordering, and drop the `dev-browser` coupling.
- `ralph.sh` + `prompt.md`/`CLAUDE.md` loop: **Rejected** (`--dangerously-*`, a spoofable completion signal, self-editing steering files). Keep only the idea: a fresh context per story, state in files.

---

## 4. vercel-labs/agent-browser — `dogfood`

- **Source**: https://github.com/vercel-labs/agent-browser · **Author**: Vercel · **License**: Apache-2.0
- **Pinned**: `fd93075e55a21a47fcb36d7433361daa867a0580` (2026-10-20); very active (v0.39.1).
- **Adoption**: 44.3K stars; agent-browser 1.2M installs; Trust Hub pass, Socket pass, **Snyk warn**.
- **Files read**: `skills/agent-browser/SKILL.md`, `skill-data/dogfood/SKILL.md`, `references/issue-taxonomy.md`, `templates/dogfood-report-template.md`, `skill-data/core/references/trust-boundaries.md`. `scripts/postinstall.js` and `package.json` were grepped for network and install behaviour.

**What it does, mechanically**
- A 6-step exploratory QA run: Initialize (output dirs, report from template) → Authenticate → Orient (annotated screenshot + a11y snapshot) → Explore (each nav section; click, fill, edge cases; check `errors` and `console` on every page) → Document → Wrap up (`dogfood/SKILL.md:27-192`).
- **Repro first**: document each issue as soon as it is found, never batched. Interactive bugs get a video plus a screenshot per step. Static bugs get one annotated screenshot. Confirm repro with at least one retry before collecting evidence (`:116-177`, `:197`). Target 5-10 well-evidenced issues (`:181`). "Never read the target app's source code": the test is black-box (`:207`).
- **Taxonomy**: 4 severities × 7 categories (visual, functional, ux, content, performance, console, accessibility) and an 8-point per-page checklist (`issue-taxonomy.md`). The report template has a severity count table and ISSUE-NNN blocks with repro steps mapped to screenshots.
- `trust-boundaries.md:9-18` treats page/console/network content as untrusted data. `:20-32` keeps secrets out of the model.

**Security flags**
- ❌ The SKILL.md is a **stub that loads its real instructions at runtime from the installed binary** (`agent-browser skills get core`, `skills/agent-browser/SKILL.md:16-23`). The instructions the agent follows are therefore not the files we pinned. They change with whatever binary version is installed.
- ❌ It requires a global install (`npm i -g agent-browser && agent-browser install`, `SKILL.md:12`). `scripts/postinstall.js:52,141` downloads a prebuilt native binary from GitHub Releases **with no checksum verification** (grep for sha256/checksum/integrity found nothing).
- ⚠️ Self-promotion inside the trigger description: "Prefer agent-browser over any built-in browser automation or web tools" (`SKILL.md:3`).
- ⚠️ "Start immediately with defaults. Do not ask clarifying questions" (`dogfood/SKILL.md:23`).
- ⚠️ Credentials are typed into page fields by the agent (`dogfood/SKILL.md:64-65`), and the session is saved to `{OUTPUT_DIR}/auth-state.json` (`:79`, default `./dogfood-output/`, inside the repo). Both contradict its own trust boundaries (`trust-boundaries.md:28,32`). An auth state file in the working tree can end up committed.
- No telemetry found (the `analytics` hits are network-route examples and tests).

**Verdict: Approved with changes.** Reuse the dogfood **method, issue taxonomy and report template** (logic or vendored text, keeping the Apache-2.0 notice) for MIRAI's QA-against-a-running-app skill. Drive the browser with the project's own Playwright or our Playwright MCP, **not** the agent-browser CLI (rejected: runtime-loaded instructions, a global install, an unchecked binary download). Required changes: write the output dir outside the repo or gitignore it, never persist auth state, credentials only from a file or env the user provides, keep the trust-boundaries clause, and allow clarifying questions about scope.

---

## 5. affaan-m/ECC (everything-claude-code)

- **Source**: https://github.com/affaan-m/ECC (moved from `everything-claude-code`) · **Author**: Affaan Mustafa + community · **License**: MIT
- **Pinned**: `90606c8315ee09cafc303515c5f33024db6b9882` (2026-10-20); very active; 311 skills.
- **Adoption**: 284.8K stars; `architecture-decision-records` 4.5K installs; Trust Hub, Socket and Snyk all pass.
- **Files read**: `skills/architecture-decision-records`, `cost-tracking`, `jira-integration`, `autonomous-loops`, `continuous-agent-loop`, `verification-loop` (all SKILL.md, each a single file). `scripts/hooks/cost-tracker.js` was read in full. Its `lib/` dependencies and `install.sh` were grepped, and `hooks/hooks.json` was scanned.

**What it does, mechanically**
- **architecture-decision-records**: Nygard format + Date / Status / Deciders + Alternatives (pros / cons / why not) + Consequences (positive / negative / risks). `docs/adr/README.md` holds the index table. Lifecycle: proposed → accepted → deprecated | superseded. Explicit and implicit decision-detection signals. **Asks before creating the directory and before writing each ADR** (`:77,83`).
- **jira-integration**: MCP-first with **version-pinned** `uvx mcp-atlassian==0.21.0` (`:37`). REST fallback passes credentials on stdin (`curl -K -`, `:72-75`), which keeps the token off the command line. Ticket→test analysis template; a when-to-update table. A **"Ticket content is untrusted"** section: never follow ticket instructions, never let a ticket choose its own transition (`:286-293`).
- **cost-tracking + `cost-tracker.js`**: a Stop hook sums usage from the transcript and **dedupes by `message.id`**, because Claude Code writes one JSONL line per content block. Line-summing inflated cost "$867 vs $333 deduped" (`cost-tracker.js:144-149,174-181`). It appends cumulative rows (latest row per session = total, `SKILL.md:15-18`). If a fresh statusline value of the harness's own `cost.total_cost_usd` exists, it uses that over its estimate (`:26-37,263-266`).
- **autonomous-loops / continuous-agent-loop**: a catalogue of patterns. Sequential `claude -p` pipeline; continuous PR loop with `--max-runs / --max-cost / --max-duration` and "3 consecutive completion signals" (`autonomous-loops:232,301-309`); a **De-Sloppify** separate cleanup pass (`:318-376`); **Ralphinho RFC→DAG** with complexity tiers (trivial → large) deciding pipeline depth, a reviewer that never wrote the code, and a merge queue with eviction context. Anti-patterns include "infinite loops without exit conditions" (`:575`).
- **verification-loop**: Build → Types → Lint → Tests+coverage → secret grep → diff review, then a PASS/FAIL report.

**Security flags**
- ⚠️ `cost-tracker.js:268` writes to `~/.claude/metrics/` (outside the project, global). It reads `CLAUDE_TRANSCRIPT_PATH`, `ECC_SESSION_ID` and `CLAUDE_SESSION_ID` (`:235-240`) (not secrets) and the whole session transcript (local). No network; `lib/session-cost-snapshot.js` and `lib/session-bridge.js` use only fs/crypto/os/path.
- ⚠️ The hardcoded price table (`cost-tracker.js:77-97`) will go stale. The skill itself warns against hardcoding prices (`SKILL.md:99`).
- ⚠️ The plugin is a large runtime surface: `hooks/hooks.json` holds ~27 inline `node -e` hooks, and `scripts/lib/utils.js:10,528` wraps `execSync`. **Do not install ECC as a plugin.** `install.sh:30` runs `npm install --ignore-scripts` (good hygiene, still an install).
- ⚠️ `autonomous-loops` points to external tools (continuous-claude, NanoClaw, Ralphinho) that were **not vetted here**. It rightly warns "Do not pipe external scripts directly to bash" (`:239`).
- `verification-loop:78-79` uses a naive secret grep (`sk-`, `api_key`). It is no replacement for a real scanner.
- No injection text, telemetry or obfuscation in the skills read.

**Verdict: Approved with changes.**
- `architecture-decision-records`: **vendor a pinned copy** (ADR writing). Merge with mattpocock's significance test and bm629's immutability/supersede rule.
- `jira-integration`: **reuse logic**: the untrusted-ticket rules, the update-points table and stdin credentials. Use the official Atlassian MCP (§6) rather than `mcp-atlassian`.
- `cost-tracking` + `cost-tracker.js`: **logic only**: per-`message.id` dedupe and cumulative rows. Write to MIRAI's per-run log in the project, not `~/.claude`, and prefer harness-reported cost over our own price table.
- `autonomous-loops`: **inspiration** for orchestration (caps on runs/cost/duration, de-sloppify pass, tier-driven pipeline depth).

---

## 6. atlassian/atlassian-mcp-server — `spec-to-backlog`

- **Source**: https://github.com/atlassian/atlassian-mcp-server · **Author**: Atlassian (official) · **License**: Apache-2.0 (`LICENSE`, `plugin.json:12`)
- **Pinned**: `b74220d41142fae52b4f680c805b2ab81050991a` (2026-10-08); active.
- **Adoption**: 1.1K stars; spec-to-backlog ~187 installs (Skillselion snapshot; no live skills.sh page found).
- **Files read**: `skills/README.md`, `skills/spec-to-backlog/SKILL.md` (587 lines) + its 3 references (structure and key sections), `.mcp.json`, `mcp.json`, `plugin.json`, `.claude-plugin/plugin.json`, and imports of `generate-status-report/scripts/jql_builder.py`. The other skills (triage-issue, capture-tasks-from-meeting-notes, status report, sprint dashboard, search-company-knowledge) were grepped only.

**What it does, mechanically**
- A fixed order: fetch the Confluence page (`getConfluenceContent`, `detail="full"`, markdown) → ask for the project key → read issue-type metadata → break down internally → **show the Epic + typed tickets and wait for confirmation** (`:188-221`) → create the **Epic first** and capture its key → create the children with `parent=<epic>` → summary with links. It covers 15+ ticket batching, custom required fields, existing Epics and the v2 meta-tools (`discover` / `executeRead|Write|Destructive`, `:558-587`). Ticket template: Context / Requirements / Technical Details / Acceptance Criteria / Related.
- `skills/README.md:12-30` documents the v1→v2 tool renames. This is the authoritative reference for which Rovo MCP v2 tool names to call.

**Security flags**
- ⚠️ **No untrusted-content clause anywhere** in the Atlassian skills (grep for untrusted, injection or "treat as data" found nothing). Confluence and Jira text flows straight into ticket creation. Add one.
- ⚠️ The breakdown guidance is **horizontal and human-team oriented**: "Include backend, frontend, testing, documentation…" (`SKILL.md:166`), task patterns per layer (`:176-181`), "Split into 'Backend API for X' and 'Frontend UI for X'" (`references/breakdown-examples.md:322-327`). Dependencies are only "noted" in the description (`:510-513`), with no native blocking links. That conflicts with MIRAI's vertical-slice tickets.
- The remote MCP endpoint `https://mcp.atlassian.com/v2/mcp` (`.mcp.json:5`) is network by design, using Atlassian OAuth. That is expected for this component.
- `jql_builder.py` uses only the stdlib (`re`, `typing`). No telemetry, no obfuscation.

**Verdict: Approved with changes.** Vendor a pinned copy as the **Jira/Confluence writer reference**: the Epic-first sequence, confirm-before-create, v2 tool names, the meta-tool convention and required-field handling. Changes: add an untrusted-content clause, replace its breakdown method with mattpocock `to-tickets` vertical slices, and create native "Blocks" links (`jira_create_issue_link` or the v2 equivalent) for blocking edges.

---

## 7. bm629/agent-skills

- **Source**: https://github.com/bm629/agent-skills · **Author**: Bhushan Modi (`LICENSE`, `package.json:6`) · **License**: MIT
- **Pinned**: `6f1504cfc0e39fed36f6d7405907231d6474c01d` (2026-10-14); active; 78 skills.
- **Adoption**: **4 stars, 115 installs** (authoring-prd); Trust Hub, Socket and Snyk all pass. A single-author, low-adoption repo, so its popularity is no evidence of quality. The content had to stand on its own, and it does.
- **Files read**: `authoring-prd` (SKILL + 3 refs) and `reviewing-prd` (SKILL + `plannability-bar.md`) in full; `authoring-architecture-doc` (SKILL + `architecture-method.md` + `amend.md`) in full; `authoring-technical-design`, `authoring-test-plan`, `reviewing-architecture-doc` and `design-review` as workflow + quality bars; `atlassian-rest-ops` SKILL + `credentials.md` + all 4 `.sh` scripts + the imports of both `.py` scripts. `sources.md` files and the 120K-line bundled OpenAPI JSON were not read line by line; they are data.

**What it does, mechanically**
- **authoring-prd / reviewing-prd**: one **12-condition plannability bar** shared by author and reviewer, so the two cannot drift. The conditions: evidenced problem (JTBD) · concrete personas · 2-4 metrics with target + method + guardrail · MVP boundary + non-goals + release criteria · features with Given/When/Then AC · **no fabricated evidence** · risks/OQs · unambiguous · NFR taxonomy with numeric targets (ISO 25010, WCAG 2.2 AA) · traceability (no orphan feature or goal) · dependencies · amend integrity. A thin-idea blocker gate (`authoring-prd:104`). Amend as a versioned delta with ripple analysis (`:106-116`). The reviewer emits a literal `VERDICT: approve|revise` line plus findings of the form condition + location + fix (`reviewing-prd:89-119`), with explicit rules against both false-revise and false-approve, and proportionality for thin PRDs.
- **authoring-architecture-doc (HLD)**: boundary first → stakeholders/concerns (ISO 42010) → one responsibility per component → protocol per arrow, with diagrams and prose kept in sync → failure semantics per boundary → rationale per significant tech choice → **a realization mechanism per NFR target** (6-part quality-attribute scenarios) → system observability → ATAM trade-offs. **Decisions live as standalone, linked, immutable ADRs, changed only by supersede** (`SKILL.md` Step 5; `architecture-method.md` ADR section). A 10-condition bar shared with `reviewing-architecture-doc`.
- **authoring-technical-design (LLD/design doc)**: an 11-condition implementability bar. Bidirectional requirement trace · one feature at the right altitude · diagram + narrative agree · reference, don't duplicate · ≥1 real alternative with a decision criterion · failure modes + idempotency/concurrency · observability arming rollback triggers · testing · rollout/migration/rollback with measurable triggers · assumptions explicit · amend.
- **authoring-test-plan (test design)**: coverage map first (every AC/operation has ≥1 case) · cheapest level that proves it · risk-weighted (likelihood × impact, not a cross-product) · testable entry/exit criteria · environments + test data · executable, traceable cases · NFR tests · amend with impact + risk regression selection, and defect → regression case.
- **atlassian-rest-ops**: curl-only REST for Confluence v2 / Jira v3. A bundled OpenAPI spec plus a stdlib `$ref` resolver (`scripts/endpoint.py`) and an ADF converter (`md_to_adf.py`). It covers the ADF-vs-storage rich-text pitfalls, the two-stage Confluence delete, and unbounded-JQL rejection.

**Security flags**
- ⚠️ `atlassian-rest-ops` puts the token **on the curl command line** (`curl -u "$ATLASSIAN_EMAIL:$ATLASSIAN_API_TOKEN"`, `scripts/create-jira-issue.sh:8`, `create-confluence-page.sh:9`, `list-confluence-pages.sh:8`, `search-jira-issues.sh:14`). Other local users can see it in the process list. ECC's `curl -K -` stdin pattern is safer. The standalone section's `set -a; source .env` loads *every* secret in `.env` into the environment.
- ⚠️ `atlassian-rest-ops` can reach delete/purge endpoints (documented in its Gotchas). Writes need a confirm gate in MIRAI.
- ⚠️ The authoring skills assume a "template tool", a "deep-research capability" and an injected `capability_record` (`authoring-prd:33,52,56-60`; `authoring-architecture-doc` Step 1). That is coupling to the author's own orchestration, so strip or replace it.
- `project-document-discovery/scripts/validate.py` needs `jsonschema` + `yaml` (third-party). We do not need it.
- Python scripts are stdlib only (`json`, `os`, `sys`, `re`). There is no network outside the Atlassian scripts, no telemetry, and no writes outside the project. The `external-content-sanitizer` skill is defensive, a list of regex injection patterns, and is worth a later look for our own vetting gate.

**Verdict: Approved with changes.** Vendor pinned copies (MIT notice kept): `authoring-prd` + `reviewing-prd` (**PRD writing / PRD review**), `authoring-architecture-doc` + `reviewing-architecture-doc` (**HLD**), `authoring-technical-design` (**LLD/design doc**), `authoring-test-plan` (**test design**). Changes: remove the template-tool/capability-record coupling and inline a section structure; make research optional with the existing "flag as assumption, never fabricate" fallback; pair with mattpocock `grilling` for gap filling. `atlassian-rest-ops`: **logic only, as a fallback** behind the official MCP: take the ADF/storage rules, pagination and the JQL gotchas, and switch to stdin credentials. Because adoption is low, re-check with a diff before every version bump.

---

## Searches run

| Query / page | Result used |
|---|---|
| skills.sh home leaderboard (WebFetch) | mattpocock/skills dominance (grill-me, tdd, code-review, to-prd, to-issues), stablyai/orca orchestration |
| `skills.sh PRD writing skill SKILL.md` | terminalskills, superplanehq, shipshitdev, **bm629 authoring-prd**, joellewis |
| `github agent skills "SKILL.md" architecture decision record ADR skill claude` | crowd.dev adr, chatto adr, majiayu000 adr-review, mohitagw15856, **affaan-m/ecc ADR**, ncklrs, joelhooks |
| `claude skill split PRD into user stories acceptance criteria dependencies tickets SKILL.md github` | terminalskills prd-to-issues, borghei spec-to-repo, meriley prd-implementation-planning, Donchitos create-stories, PagerDuty prd |
| `ralph loop claude code skill overnight max iterations github` | **official ralph-wiggum**, **snarktank/ralph**, super-ralph-wiggum, ralph-invoke |
| `skills.sh atlassian jira confluence skill` | vancebs, sillsdev, witooh/neo-plugin (acli), benjaming, alirezarezvani pm-skills (skills.sh audit HIGH), aholbreich |
| `skills.sh test-driven-development skill installs` | obra (already analyzed), many tiny TDD skills (<20 installs) |
| `mattpocock skills prd-to-issues write-a-prd grill-me github` | confirmed renames to-prd→to-spec, to-issues→to-tickets |
| `atlassian official agent skills github "SKILL.md" jira confluence rovo mcp` and `github.com/atlassian skills agent "jira" SKILL.md repository 2026` | TWG CLI docs, langpingxue/atlassian-skills (40 stars, no license), then GitHub API → **atlassian/atlassian-mcp-server/skills** |
| `claude code skill generate project context CLAUDE.md coding conventions extraction codebase scan skills.sh` | only `/init` (built-in) and continuedev `scan` (checks code against a skill's rules, the inverse direction) |
| `agent skill audit trail run log cost tracking token usage claude code skill github` | **ECC cost-tracking**, belchman audit-claude-overhead, kelviq/tare, sahil87/tu, LangWatch (SaaS) |
| `skills.sh QA skill test running web app verification dogfood exploratory testing agent skill` | **vercel-labs/agent-browser dogfood**, NousResearch/hermes-agent dogfood (Tessl notes a missing template) |
| `snarktank ralph prd.json skill github stars`, `skills.sh atlassian/atlassian-mcp-server spec-to-backlog installs` | adoption numbers |
| skills.sh pages fetched: vercel-labs/agent-browser/dogfood, bm629/agent-skills/authoring-prd, snarktank/ralph/prd, affaan-m/everything-claude-code/architecture-decision-records | install counts + audit results |
| GitHub API `repos/<owner>/<repo>` for 12 repos | stars, last push, license |

Considered and not cloned: witooh/neo-plugin (0 stars), aholbreich/agent-skills (3 stars; browser-session Jira for SSO orgs, worth revisiting if API tokens are banned), langpingxue/atlassian-skills (no license), alirezarezvani pm-skills (skills.sh audit rated it HIGH risk), borghei spec-to-repo (runs a bundled Python decomposer), NousResearch hermes dogfood (a 1.29 GB repo with the same method as vercel's), majiayu000 claude-skill-registry (an aggregated mirror; provenance unclear).

---

## MIRAI component → source map

| MIRAI component | Best source(s) | Mode |
|---|---|---|
| Requirements interview | mattpocock `grilling`; snarktank `prd` lettered options; feature-dev phase 3 | vendor grilling; ideas |
| PRD writing | bm629 `authoring-prd` (+ mattpocock `to-spec` template, snarktank `prd`) | vendor (with changes) |
| PRD review | bm629 `reviewing-prd` (12-condition bar, `VERDICT:` token) | vendor |
| HLD | bm629 `authoring-architecture-doc` + `reviewing-architecture-doc` | vendor (with changes) |
| LLD / design doc | bm629 `authoring-technical-design`; feature-dev code-architect stances | vendor; idea |
| ADR writing | ECC `architecture-decision-records` + mattpocock significance test + bm629 supersede rule | vendor ECC; merge rules |
| Spec → tickets with AC + dependencies | mattpocock `to-tickets` (+ snarktank one-context-window sizing) | vendor |
| Implementation planning | feature-dev flow (inspiration), mattpocock `implement-spec` frontier + `wayfinder` | logic |
| TDD | mattpocock `tdd` (refactor step restored) | vendor (with changes) |
| Code review (multi-lens) | mattpocock two-axis `code-review`; pr-review-toolkit lenses (idea) | vendor mattpocock; ideas |
| Review triage | anthropic code-review validate-each-finding stage (idea) | **build**, using the idea |
| QA vs running app | vercel `dogfood` method + taxonomy + template, on Playwright | reuse (with changes) |
| Test design | bm629 `authoring-test-plan` | vendor (with changes) |
| Jira/Confluence via MCP/CLI | Atlassian `spec-to-backlog` (v2 tool names) + ECC untrusted-ticket rules; bm629 rest-ops as fallback | vendor + logic |
| Run logging / cost | ECC cost-tracker dedupe logic | logic only; **audit trail must be built** |
| Overnight orchestration with caps | ralph-wiggum stop-hook state (idea), ECC caps + tiers, mattpocock frontier scheduling | **build**, using the ideas |
| Project scanning / conventions extraction | nothing usable | **build** |

## Components with nothing usable (we must build them)

1. **Project scanning / context generation / coding-conventions extraction.** Nothing found beyond Claude Code's built-in `/init`. continuedev `scan` works in the opposite direction (it checks code against rules). bm629 `project-document-discovery` plans *documents*, not code. Only a fragment is reusable: snarktank's "Codebase Patterns" section at the top of `progress.txt`, and mattpocock `retro`'s rule that mechanical conventions become lint/CI checks, not prose.
2. **Run logging / audit trail.** No skill records a per-step, append-only trail of agent decisions, tool calls, inputs/outputs, approvals and cost per run. ECC covers **cost only**, and it logs globally to `~/.claude`. The pstack logging logic from 06 remains the base. Build the trail ourselves, using ECC's `message.id` dedupe for the cost column.
3. **Review triage.** No skill classifies review findings into accept / reject / defer with reasons and routes them back to implementation. Anthropic's validator stage is the only pattern, and its license allows inspiration only.
4. **Overnight orchestration with hard caps.** Nothing combines (a) iteration + cost + wall-clock caps, (b) stuck detection and an explicit `BLOCKED` exit, (c) normal permission mode with no `--dangerously-*` flag, and (d) a sub-agent depth/count limit. The mattpocock recursion bug shows (d) is required. The pieces exist across ralph-wiggum, ECC autonomous-loops and bmad-loop (06); the assembly does not.
5. **Implementation planning as a stand-alone artifact** is only partly covered. superpowers `writing-plans` (06) + feature-dev + mattpocock `to-tickets` cover it between them, but no single skill yields a reviewed plan file with a quality bar. That is a small build, mostly composition.
