---
unit: "24"
name: review
status: draft (decisions recorded 2026-11-07; not approved yet)
roadmap: implementation/PROGRESS.md (unit 24 is the review step); 21c (review findings as a source of fix rounds)
depends_on: ["21b", "21c", "22"]
---

# Unit 24: review

## Why

After Kai builds a ticket (21b), MIRAI's own tests run, and the change waits for review before it is merged. Unit 24 is that review step. Its findings become fix rounds for Kai (21c).

Decided by Jet (2026-11-07): **the reviewer is a separate agent or session from the one that wrote the change.** Kai never reviews its own change. The reason: an agent reviewing its own work tends to miss the same mistakes it made while writing, and the review is the second check on MIRAI's own rules and instruction files.

## Scope

**In.**

1. **A separate reviewer.** A review run never runs in the same launch, session, or Claude Code config folder as the author's run that produced the change. MIRAI records the author run's id on the ticket, and the review refuses to start when the reviewer's run id matches it.
2. **The review run's role.** It uses the existing `reviewer` role (`src/mcp/tools/agents.js`, `src/cli/commands/agent.js`), so it cannot change files. Its only output is findings, in the findings schema from 09a.
3. **Findings to rounds.** Each finding that a verifier confirms becomes input to `mirai fix` (21c). Findings are not applied by the reviewer.
4. **Instruction files.** The review also covers changes to instruction and command files: `AGENTS.md`, `CLAUDE.md`, `.claude/commands/**`, `.claude/settings*.json`. Unit 24's protected-path check, not the reviewer's judgment alone, decides when these need a human.

**Out.**

- Who reviews when no separate reviewer is available (see Open).
- Changes to how fix rounds run (21c) and how commits are made (22).

## Decisions

Recorded 2026-11-07, following the recommendations in this draft:

- **No separate reviewer available: refuse and wait.** A review that can't be separate from the author doesn't run. No fallback to a fresh session under the same author.
- **Findings are verified before they become fix rounds.** A second, separate run confirms each finding (as 21c's verifier does). A finding that isn't confirmed doesn't start work.
- **The `ask` rule goes in this unit.** The `ask` rule from 21f (`/mirai approve` and the other commands are asked for in Claude Code) goes in the committed `.claude/settings.json` beside 13c's denies, so it holds for every developer. The instruction-file check in item 4 covers `.claude/commands/**`, as the notes already say.

## Open

- Nothing blocking. Approval is still needed before anything is built.

## Tests (to write when approved)

- A review whose run id matches the author's is refused before it starts.
- A reviewer run cannot write a file (the `reviewer` role has no write tool).
- A finding with no verifier confirmation does not become a fix round.
- A change to `.claude/commands/**` or `.claude/settings*.json` is covered by the instruction-file check.
