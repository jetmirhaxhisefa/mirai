---
unit: "11"
name: claude-adapter
date: 2026-10-24
node: v22.23.2
result: 167 / 167 pass (earlier units' 158 + unit 11's 9), after the review fixes; 3 full runs in a row green, then one more after the last CLI wording change
---

# Unit 11 — Test results

## Run

`npm test` (scoped to `test/**/*.test.js`), after the review fixes (`review.md`). The new file
`test/adapters/claude-code.test.js`:

```
T1: the bundle is deterministic, and changes only with what it's made of
T2: the interactive and headless bundles have the same content hash
T3: init renders CLAUDE.md, the skills and the agents, all rendered in the lock
T4: your CLAUDE.md, skills and agents stay yours; links and unlisted MIRAI names are refused
T5: mirai render follows the config, re-renders edits, and changes nothing twice
T6: skill, agent and adapter definitions are checked, with file, line and column
T7: the skill MIRAI ships passes its own checks and uses only the portable fields
T9: init --refresh gives an installed repo this MIRAI's copy, keeps your files, and undoes a failure
T10: the edge cases from the review
# tests 167
# pass 167
# fail 0
```

The tests install a copy of MIRAI's package with a fixture agent and a two-file fixture skill
added (`test/fixtures/registry-agents/`), through `init`'s new `packageRoot` option. That's how
the install carries agents before Kai (unit 21) and Rex (unit 24) exist. Every test uses
temporary repos and a temporary HOME, removed afterwards.

**Earlier tests changed:**
- `test/install/init.test.js`:
  - an install now also writes `.claude/` and `CLAUDE.md` (T1, T7, T9 expectations);
  - the not-UTF-8 code is the generic `not-utf8`;
  - T9 filters to `AGENTS.md`.
- `test/config/config.test.js`: the fixture agent gains a `description`, which agents now need.

## The roadmap's "done when", mapped

| Done when | Test |
|---|---|
| The interactive and headless bundles have the same content hash | T2: `.claude/` in an installed repo, and a plugin folder built from the same bundle, hashed from the files on disk; both equal the bundle's `sharedHash` and the lock's `bundles.claude-code` |
| Claude Code lists MIRAI's skills and agents | **Skills: T8, yours to run** (below). **Agents:** moved to unit 21, since MIRAI ships no agent before Kai. T3 checks the rendered agent file's format with the fixture agent |

## T8: the sample app

**What I ran: a scratch copy, not part of `npm test`.** I copied `~/Projects/mirai-sample-app`,
with your committed 0.1.0 install, to the scratchpad and used a temporary HOME. The original
wasn't touched.

| Step | Result |
|---|---|
| `render` with the installed 0.1.0 copy | exit 0, "AGENTS.md: unchanged" (that copy knows no adapter) |
| `mirai init --refresh` with this MIRAI | exit 0, "same version, a different framework copy". Wrote `.mirai/framework`, `CLAUDE.md`, `.claude/skills/mirai-docs/SKILL.md` and the lock; 102 files in the lock |
| `lint`, `status`, `render` from the refreshed copy | all exit 0; `render` says all three rendered files are unchanged |
| `checkLock` | clean |
| `bundles` in the lock | `{ "claude-code": "4b8d587b…" }` |

- **`git status`:** outside the framework copy, only `M .mirai/mirai.lock`, `?? .claude/` and
  `?? CLAUDE.md`.
- **The framework copy:** 748K.

**On the real sample app, run by you (2026-10-24):**
- **`init --refresh`:** run twice. The first run wrote `CLAUDE.md` and
  `.claude/skills/mirai-docs/SKILL.md`. The second said "the framework copy was already this
  one" and wrote only the copy and the lock.
- **`render`:** every file "unchanged".
- **`checkLock`:** clean, 102 entries, with the same `bundles.claude-code` (`4b8d587b…`) as the
  scratch run.
- **Claude Code skills:** `/` lists `mirai-docs`.
- **Claude Code `/memory`:** shows "Project instructions — Checked in at ./CLAUDE.md", with
  "AGENTS.md @-imported" under it. So the import works, and Claude Code accepts MIRAI's block
  markers around it.

**Still UNVERIFIED, moved to unit 21 with the `/agents` check:** whether Claude Code reads
`tools` as a comma-separated string and a full model id in an agent's `model:`.
