---
status: draft
version: 1
---

# 09 — After the MVP

What happens once the MVP (`07` Milestones A–E) is built. Agreed with you on 2026-10-23.

**The rule: use it, measure it and fix it before adding anything new.**

## Step 1 · Use it for real (about 4–6 weeks)

- Tag the finished MVP as **MIRAI v1.0**. Later work ships as updates through `mirai update`.
- Run MIRAI on the pilot and on the second project with real work: **at least 20 tickets**,
  supervised first, then overnight runs.
- **No new features in this period.** Capture friction with `mirai feedback` (an MVP unit), so
  the reasons behind back-and-forth with agents are logged from the first ticket.

## Step 2 · Judge it against the success and kill criteria (D-38)

| Result | Next |
|---|---|
| Targets met | Step 3 |
| Close but not met | A **fix-up phase** first: the top 3 problems from the logs (parking reasons, template gaps, expensive steps, your feedback entries) |
| Far off | **Stop adding features** and rethink the weak part (the kill rule) |

## Step 3 · One post-MVP backlog, prioritised

**Sources:**
- the Later list in `07`;
- your Phase 2 notes (`2_Efforts/MIRAI - How it works.md`, "Phase 2 followups");
- the deferred items from the interview (`00`): UX, discovery and market research.

**Suggested order.** The final order is decided after step 2, from what the data shows.

| Order | Group | Contents | Why here |
|---|---|---|---|
| 1 | **Evaluate** | Cost analysis (where tokens are wasted), analysis of the `mirai feedback` logs (back-and-forth with agents), retros (`mirai-retro`), blinded skill evals (`mirai-eval`) | Uses data the MVP already collects; makes every later feature cheaper and better |
| 2 | **Debug** | Debug workflow with agents that know the system and the business context; an application-logs assistant (logs, traces, database) using the `resources` links | Your most-requested capability |
| 3 | **First tracker connector** | ClickUp, Jira or Linear, whichever you use most by then | Needed before the ticket board and work projects |
| 4 | **Docs website** | HTML/CSS/JS docs of all features, skills and workflows, with tips; a log page; document pages for repo-stored PRD/HLD/LLD/ADRs; the prompt collection. It must explain design reasoning (Q1) | Built once the content is stable |
| 5 | **Standalone tools** | `teach-me` skill; on-demand security audit (app, git host, interfaces); optional simple ticket board (epics, tickets, bugs, investigations) | Valuable but independent |
| 6 | **Bigger changes** | UX agent; discovery and market research; parallel tickets; Codex/Cursor as main tools; reviewing other people's MRs; `mirai export/import`; container option | Once the core has proven itself |

## Step 4 · The process per feature (lighter than the MVP)

1. **A short interview** (one question at a time, with a guess).
2. **A design addendum:** one new file per feature, e.g. `design/10-debug-workflow.md`, instead
   of rewriting `01`–`07`.
3. **One review round** (PM, Tech Lead, Architect). The core is stable by then.
4. **Units in the roadmap, built one at a time**, with spec approval and unit approval, exactly
   as in the MVP.
5. **External skills are vetted first** (`research/06` gate: read every file, pin a commit,
   record the verdict), before building our own. Security audit and debugging especially.
6. **Dogfooding:** where possible, the feature itself goes through MIRAI's own brief → PRD →
   tickets flow.
