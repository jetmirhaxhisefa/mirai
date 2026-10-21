# 04 — Pilot project analysis: Thudos platform

Path: `/Users/jetmir.haxhisefa/Projects/people-management-tool/platform` (paths below are relative to it unless noted).
Method: an Explore subagent built the inventory; I then read the core files myself: `AGENTS.md`, `backend/AGENTS.md`, `.claude/README.md`, `.claude/skills/development-council/SKILL.md`, the hooks `stop-quality-gate.sh`, `on-file-change.sh`, `mark-review-complete.sh`, the templates, `scripts/quality-gate.local.sh`, `_bmad/_config/manifest.yaml`, `_bmad/config.toml`, plus `git status` and `git log`. Nothing was changed in the pilot.

---

## 1. The headline: the pilot is not a blank slate

Three AI setups sit on top of each other, and two are half-migrated:

1. **Your own "engineering council"** (committed). It lives in `.claude/`: 10 agents, 6 skills, 5 hooks, 5 templates, a quality gate, and a sticky risk level. Its hooks enforce reviewer verdicts deterministically.
2. **A BMAD v6.12.1-next.0 install** (uncommitted). It includes `_bmad/`, `.agents/skills/` (about 40 skills, including TEA), `skills-lock.json` and `_bmad-output/`. BMAD's `bmad-project-context` **created** `AGENTS.md`, `backend/AGENTS.md` and `frontend/AGENTS.md`. They are untracked (`??` in `git status`), each with a `bmad:context` block "Verified 2026-09-29 against 9afe20b".
3. **A move of the decision docs and rules that is half done** (uncommitted):
   - `docs/decisions/*` and `docs/development-council.md` were deleted; copies sit in `docs_old/`.
   - `.claude/rules/{architecture,decision-documents,security,testing}.md` were deleted. A new untracked `.claude/rules/claude-code.md` was added.
   - The three `CLAUDE.md` files were reduced to `@AGENTS.md`. Committed sizes were 164 lines (root), 201 (`backend/`) and 42 (`frontend/`) (`git show HEAD:<path> | wc -l`). Their content moved into the new `AGENTS.md` files.

`git status` shows all of this on branch `feature/BKT-48/bmap-agent-setup`, at commit `9afe20b` with a dirty tree.

**Why this matters for MIRAI:**
- **Branch base.** The MIRAI pilot branch must not start from this dirty tree. See question P1.
- **Coexistence.** MIRAI must coexist with BMAD and the council, or replace them. The installer needs a "detect existing AI setup" step, and probably a migration path.
- **Prior art you already own.** Your council setup is prior art, and its enforcement layer is stronger than anything in BMAD or pstack (§4).

---

## 2. Stack and architecture

| Area | Fact | Source |
|---|---|---|
| Shape | Monorepo: Laravel API `backend/` + React SPA `frontend/`, Docker Compose | `docker-compose.yml`, `README.md` |
| Backend | PHP 8.4, Laravel 13.8, Sanctum 4.3 (SPA cookie auth), PHPUnit 12, Pint | `backend/composer.json` |
| Frontend | React 18, TypeScript 5.8, Vite 5, Tailwind 3, shadcn/ui, TanStack Query/Table, RHF + Zod, MSW, Vitest, Playwright, Storybook | `frontend/package.json` |
| Data | MySQL 8.4, used in tests too (no SQLite) | `backend/phpunit.xml`, ADR-0003 in `docs_old/decisions/` |
| API today | 3 endpoints: `POST /api/v1/login`, `POST /api/v1/logout`, `GET /api/v1/user` | `backend/routes/api.php` |
| Frontend today | About 30 HR routes plus about 50 template demo routes. Only auth is real; the rest is MSW mocks or inline data | `frontend/src/App.tsx`, `frontend/src/mocks/handlers.ts` |
| Backend layering | route → FormRequest → thin controller → `App\Actions\<Verb><Noun>` → Resource. No repositories or services. Enforced by `tests/Unit/Architecture/LayoutTest.php` | `backend/AGENTS.md` |
| Size | Backend about 7 real classes (about 238 lines); about 24 backend tests; frontend about 16.8k lines, mostly template pages | Explore inventory |
| Product spec | `ALL_FEATURES.md` (about 38 KB) in the sibling repo `people-management-tool-mockup/` | sibling repo |

This is an early-stage product. The domain (employees, leave, feedback, documents, permissions, multi-tenancy) is designed in ADRs and HLDs but not yet built. That makes it a good pilot: real requirements work (PRD → HLD → stories) is still ahead.

## 3. Docs, tests, CI, conventions

- **Decision docs:** ADR-0001..0008 (no 0004) and HLD-0001 sit in `docs_old/decisions/`. The index also lists HLD-0002, ADR-0004 and ADR-0009, but **those files do not exist anywhere**.
- **Templates:** `.claude/templates/{adr,hld,rfc}-template.md`, `task-brief.md`, `verification-report.md`. The HLD template has 16 sections (`grep -c '^## '`): context, architecture, components, flows, interfaces, data model, transactions, failure modes, security, performance, migration, rollout, observability, test strategy, alternatives, risks. It is a strong base for your `HLD_template.md`. Status lines differ by template:
  - HLD and RFC start with `Status: Draft`.
  - ADR starts with `Status: Proposed`.
  - `task-brief.md` and `verification-report.md` have no status line.
  - So statuses exist informally and inconsistently.
- **BMAD PRD output:** `_bmad-output/planning-artifacts/prds/prd-platform-2026-10-03/prd.md` is **0 bytes**. Only its `.memlog.md` exists. This is direct evidence for your "resumable statuses" requirement: a PRD run started and the document never got written.
- **Tests:**
  - PHPUnit (Unit + Feature, plus architecture tests).
  - Vitest (2 files).
  - Playwright (`frontend/e2e/app.spec.ts`, 3 tests). Playwright is **not in the gate**.
- **Quality gate:** no CI.
  - `scripts/quality-gate.sh` is a wrapper. It requires and runs `scripts/quality-gate.local.sh`, and fails if that is missing ("This gate intentionally does not fall back to host tools").
  - The local script runs inside the containers, in this order: `composer validate --no-interaction` → `vendor/bin/pint --test` → `php artisan test` → `npm run lint` → `npx tsc -p tsconfig.app.json --noEmit` → `npm run test` (Vitest) → `npm run build`.
  - Helper scripts: `scripts/set-risk.sh normal|high|reset` (sticky risk level in `.claude/state/risk-level`) and `scripts/token-savings.sh` (reads `.claude/state/tool-savings.jsonl`).
- **Commits:** free-form sentences, not Conventional Commits.
- **Branches:** `feature/BKT-<n>/<kebab>`. `BKT-` looks like Jira, but no tracker URL appears anywhere.
- **Not present:** CODEOWNERS, PR templates, a root `.editorconfig`.
- **Local dev inconsistency** (uncommitted):
  - The `proxy` service was removed from `docker-compose.yml`.
  - `vite.config.ts`, `.env.development`, `docker/nginx/default.conf` and `playwright.config.ts` still expect `*.thudos.test` on port 80.
  - Any UI-driven QA or verification-skill test will fail until this is fixed or reverted.

## 4. Your existing council setup: what it does mechanically

| Mechanism | How it works | File |
|---|---|---|
| One writer | Only the `developer` agent edits tracked files. Reviewers and QA are read-only. | `.claude/skills/development-council/SKILL.md:12,99-110` |
| Independent first pass | Reviewer and QA form a risk model and a behavior matrix **before** seeing the developer's reasoning. | same file, `:24,74-82` |
| Debate rules | No majority vote. An unresolved BLOCKER or MAJOR blocks the plan. The reviewer must challenge at least one assumption, or document that none remains. | `:84-97` |
| Edit invalidates approval | The PostToolUse hook wipes every review marker and report on any source edit, then auto-escalates risk by path pattern. | `.claude/hooks/on-file-change.sh` |
| Verdict captured from the reviewer itself | The SubagentStop hook writes the reviewer's *own* last message to `.claude/state/reviews/<agent>.md` with a nanosecond stamp. The lead can't substitute a summary. | `.claude/hooks/mark-review-complete.sh` |
| Stop gate | The turn cannot end until every required reviewer's report is newer than the last edit and contains `VERDICT: PASS`, `final-verifier` ran last, and the quality gate passes. The gate is scoped to the session that made the edit. A loop guard releases after 6 stuck attempts with a loud "NOT verified" message. | `.claude/hooks/stop-quality-gate.sh` |
| Risk tiers | `normal` needs code-reviewer + test-engineer + final-verifier. `high` adds security-reviewer + architecture-reviewer. | `stop-quality-gate.sh:117-120` |
| Token economy | Tool output over a cap is truncated to head + tail, with the full text cached. Model tiers: Sonnet for debate, Opus for gating. Reviewers read the diff first. | `.claude/hooks/tool-output-truncate.py`, `.claude/README.md` §Token economy |
| Read-only reviewers | A PreToolUse Bash hook blocks read-only agents from mutating commands (`rm`, `mv`, `sed -i`, file redirects, git writes, dependency installs, `migrate`, infra). Inspection is still allowed (pipes, `git diff`, tests) | `.claude/hooks/reviewer-bash-guard.sh` (86 lines); `.claude/README.md` §What's enforced |
| Hard denies | `permissions.deny` blocks reading `.env`/keys and destructive commands for every agent, including the lead | `.claude/settings.json`; `.claude/README.md` §What's enforced |
| Honest limits | "Hooks prove reviewers ran and passed after the last edit — not that a review was good." | `.claude/README.md` §Limitations |

**What this means for MIRAI.** This is Lauren's "encode lessons in structure" put into practice. None of BMAD's or pstack's review flows is enforced by hooks in this way. pstack relies on prose plus the model obeying it; BMAD relies on step files and HALT text. MIRAI should **reuse this enforcement layer**, made generic (configurable reviewer sets, gate command, risk patterns), instead of designing review gates from scratch. It is also the strongest answer to your "Setup Verification" question: hooks plus a gate are the verification.

Gaps in it:
- **No requirements layer.** There is no PRD, epics or stories, only a task contract.
- **No document statuses** beyond `Status: Draft` in templates.
- **No decision trail.** Only review reports, which are wiped on the next edit and not kept.
- **No feature map or UI verification.** Playwright is outside the gate.
- **No metrics.** `tool-savings.jsonl` is the only telemetry.
- **Project-specific logic is hard-coded in hooks:** reviewer names, risk path patterns, gate path.

## 5. What the setup skill must auto-detect here

| Item | Detect from | Value found |
|---|---|---|
| Languages/frameworks per service | `backend/composer.json`, `frontend/package.json`, Dockerfiles | PHP 8.4 / Laravel 13, TS / React 18 / Vite |
| Service map | `docker-compose.yml` | app, nginx, frontend, mysql, mailhog |
| How to run commands | `AGENTS.md` "Running and verifying", compose services | `docker compose exec -T app|frontend ...` |
| Quality gate command | `scripts/quality-gate.sh` | present |
| Test frameworks + commands | `phpunit.xml`, `vitest.config.ts`, `playwright.config.ts` | PHPUnit, Vitest, Playwright |
| UI URL + login for verification | `README.md`, `playwright.config.ts`, seeder, `docker-compose.yml` | Committed design: `http://app.thudos.test` via the port-80 proxy. **Uncommitted tree**: nginx on `:8000`, frontend on `:8080`, no proxy. Setup must detect the mismatch and ask (P7). Login: the seeded admin |
| Existing conventions | `backend/AGENTS.md`, `frontend/AGENTS.md`, `.editorconfig`, Prettier, ESLint, Pint | rich, per service |
| Existing AI setup | `.claude/`, `_bmad/`, `.agents/`, `AGENTS.md` markers, `skills-lock.json` | council + BMAD v6.12 |
| Existing templates | `.claude/templates/` | ADR, RFC, HLD, task brief, verification report |
| Decision docs | `docs/decisions/`, `docs_old/` | moved, 3 files missing |
| Ticket key pattern | branch names | `BKT-<n>` |
| Commit convention | `git log` | free-form sentences |
| Product feature list | sibling `ALL_FEATURES.md` | present outside the repo |
| Git hosting | `git remote -v` | GitHub org `people-management-tool` |

## 6. What the setup skill must ask

- P1. **Pilot branch base.** Branch from `main` (`d4a554b`), from `9afe20b`, or from the current dirty tree after you commit or stash it?
- P2. **Existing setups.** Should MIRAI replace the BMAD install, coexist with it, or migrate its outputs? And the council: absorb it into MIRAI, or leave it as is and add MIRAI next to it?
- P3. **Decision docs.** Is `docs_old/decisions/` still truth, or a draft to rework? Do the missing HLD-0002, ADR-0004 and ADR-0009 exist anywhere (Confluence? your notes vault?)
- P4. **Ticket system.** What tracker does `BKT-` belong to: Jira, ClickUp, or another? Local markdown tickets or the tracker?
- P5. **Docs destination.** Keep docs in-repo under `docs/`, or write some to an external system (Obsidian vault, Confluence, Notion)?
- P6. **Business context source.** Should `ALL_FEATURES.md` in the mockup repo be the input for `PROJECT-CONTEXT.md` and `FEATURE_MAP.md`?
- P7. **Local dev URLs.** The proxy removal is uncommitted. Which setup is current? UI verification depends on it.
- P8. **Team.** Commits show a second author. Is the setup for you only, or shared with the team? That decides what gets committed versus kept in local files.
- P9. **Risk policy.** Reuse the existing high-risk path list as MIRAI config?

## 7. Fit as a pilot

Good fit:
- Requirements work is still ahead (empty PRD, undecided data model and permissions).
- A strong gate and conventions already exist.
- There are two services with different conventions, which tests the per-service `CODING_CONVENTIONS.md` idea.
- The repo is small enough to read fully.

Risk:
- The dirty branch state.
- The broken local proxy setup blocks UI verification.
- An existing BMAD install that MIRAI must not silently overwrite.
