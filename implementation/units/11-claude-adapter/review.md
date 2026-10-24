---
unit: "11"
date: 2026-10-24
reviewers: Tech Lead, Architect (independent, read-only, no network)
verdicts: CHANGES REQUESTED (no blocking), CHANGES REQUESTED (1 blocking, the skill name); all findings applied, decided by you, or noted for later units
---

# Unit 11 — Review

**What held up (verified by the reviewers):**
- **Rollback:** a write failure undoes everything, in `init`, `init --refresh` and `render`,
  including after the framework swap.
- **`CLAUDE.md`:** linked to `AGENTS.md`, it drops its lock entry. A CRLF `CLAUDE.md` renders the
  same every time.
- **Your files are safe:** a stray `mirai-*` file, or your own file inside a MIRAI skill folder,
  is refused. A linked folder inside a MIRAI skill is caught before anything is removed.
- **The bundle:** it's deterministic, and both placements give the same hash.
- **The design:** the bundle and its hash fit unit 12 (snapshot) and unit 19 (plugin folder). The
  hash covers skills, agents and prompts, and leaves settings, MCP config, the instruction blocks
  and the headless system prompt outside, which matches D-37.
- **`init --refresh`:** it's `update`'s no-edits, no-merge case, and doesn't pre-empt its design.
- **The `mirai-docs` skill:** its paths, ticket file names, AC ids, no-status rule and heading
  order match the templates and the lint.

## Applied in unit 11

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **Blocking: `mirai-docs` was already the catalogue's later docs-website skill** | Architect | **Your decision:** that one is now `mirai-docs-site`; 03 says how `mirai-docs` relates to `mirai-write` and `mirai-tickets` | — |
| 2 | `bundle_sha256` copied onto every entry, never checked | Architect | **Your decision:** one top-level `bundles` per tool | T2 |
| 3 | The tool vocabulary of agent definitions | Architect | **Your decision:** Claude Code's names, recorded in D-37 | T6 |
| 4 | `--refresh` once `update` exists | Architect | **Your decision:** stays as update's fast case, in the roadmap | — |
| 5 | An empty or missing `tools.allowed` gave the agent every tool; `read_only` was ignored | both | Tools required and non-empty; a read-only agent can't list write tools | T6 |
| 6 | macOS case-insensitivity: your `MIRAI-DOCS` skill was overwritten | Tech Lead | Names compared ignoring case; refused | T10 |
| 7 | An undo could turn a link into a regular file holding outside content | Tech Lead | Removals checked for links and regular files | T10 |
| 8 | A false "undoing it failed" after a refused write | Tech Lead | Undo recorded after each write; the message names the path | T10 |
| 9 | Hand edits deleted silently when a file is removed | both | A warning | T10 |
| 10 | CRLF checkouts reported every rendered file as edited | Tech Lead | CRLF read as LF in rendered files' hashes | T10 |
| 11 | The 500-line limit was off by one; T6 passed by accident | Tech Lead | Counted right; tests at 500 and 501 | T6 |
| 12 | `render` on an older install: no hint; the changed-copy hint looped to a refresh that refuses | both | "run: mirai init --refresh"; "git checkout -- .mirai" | T9, T10 |
| 13 | A refresh could downgrade | Architect | Refused (`downgrade`) | T9 |
| 14 | An older MIRAI reading a newer lock said only `lock-invalid` | Architect | `lock-newer`, by `mirai_version`; fields are only added within a schema version | T10 |
| 15 | Characters MIRAI's own frontmatter reader refuses (C1, U+2028), unchecked model names, a description over 1,024 with the note | both | Printable-only descriptions, an agent description cap of 950, model names checked | T1, T6 |
| 16 | The bundle wrote Claude's agent format | Architect | The agent file is rendered by the Claude Code adapter | T1, T3 |
| 17 | Skill file names unchecked (a space breaks the hash lines); hidden files bundled | Architect, Tech Lead | Plain names only; hidden files skipped | T6 |
| 18 | Nits: a dangling `CLAUDE.md` link refused; raw ENOTDIR; reserved profile paths; prune bound; `checkLock` naming the wrong file; a hyphen in MCP tool names | both | All fixed | T6, T10 |
| 19 | The skill's text: "replace the guidance comments", "quote dates", and nothing on `Not applicable`, `id` or `repo` | Architect | Rewritten to match the lint (spec item 16) | T7 |
| 20 | T8 couldn't check `/agents` (no agent ships); the refresh test had no spec row | Architect | `/agents` moved to unit 21, `/memory` added; T9 and T10 added to the table | — |
| 21 | Test gaps: render-side removals, a write failing partway through `render`, links on `.claude` and `.claude/agents`, a missing tier | Tech Lead | Added | T1, T10 |

## Noted for later units (in the spec)

| Unit | Note | From |
|---|---|---|
| 13, 18, 19 | Work-tree `.claude/` copies must never reach a headless run; pass agents with `--agents`; a canary test | Architect |
| 13 | Block native starts of `mirai-*` agents in the interactive settings | Architect |
| 15 | The launcher note and `mirai-docs` point at the broker | Architect |
| 19 | Model through `--model`/`--agents`; file modes; plugin loading and naming UNVERIFIED | both |
| 29 | Compare the resolved `[models]`, not only `from` hashes | Architect |
| D | What the profile needs for Codex and Cursor | Architect |

**Not done:** the duplicate-`@AGENTS.md` warning counts lines inside code fences, and description
length counts UTF-16 units. Both are harmless.
