---
unit: "15b"
date: 2026-10-29
reviewers: Tech Lead, Architect (independent, read-only, no network, no Docker, never the real claude, never the user's Claude Code config)
verdicts: Tech Lead "approvable after fixes" (five Medium); Architect "approvable after fixes" (three Medium); no Blocker or High; every Medium and Low fixed or recorded, four fixes checked by mutation, 2 more probe runs for the allow-rule move
---

# Unit 15b — Review

Both reviewers worked on a frozen tree.
- **Restrictions:** no network calls, no Docker, never the real `claude` and never the
  registration commands. They didn't read your Claude Code config, the token or the signing key,
  and changed nothing in the repo.
- **The Tech Lead** ran 35/35 tests on a copy of the repo, plus reproductions with a fake
  `claude` and one mutation, then removed them.
- **The Architect** ran 17/17.

**What held up:**
- **The policy kinds:**
  - an interactive policy with a launch field is refused, and so is a bad id or a relative
    `state_dir`;
  - `lint` in a headless policy is refused by the table's contexts;
  - the headless check is unchanged;
  - only a MIRAI-written, hash-pinned policy can set `kind`, so nothing else can turn the `.git`
    stop off.
- **MIRAI's git calls** still run the pinned git, the config allowlist and the shape check in a
  session.
- **`lint`:**
  - it reads only the trust root's config and registry;
  - its paths use `run_tests`' form;
  - `canonical()` refuses paths that leave the repo;
  - a symlink in the docs root is reported, and outside it only plain Markdown files are read;
  - its output is escaped, and it writes nothing.
- **The journal (version 4):**
  - a session line is never privileged, and its id goes with `by: "session"` both ways;
  - older signed lines still verify;
  - a session's test runs are never signed.
- **`commandText`** quotes correctly for a POSIX shell. Claude Code's files are never written by
  MIRAI.
- **Render's terminal path** never runs in tests, and never fails the render.
- **The registration approach** (Architect): Claude Code's own CLI, at local scope, never
  committed, and the name `mirai` (S3). Personal data stays out of the repo.
- **The pinned trust root:** pinning the server's code and policy is right. A running process
  can't swap its own rules, and it matches agent runs.
- **The spec is candid** about the small safety gain today.

## Fixed in unit 15b

| # | Finding | Severity, from | Fix | Test |
|---|---|---|---|---|
| 1 | **An install with no `claude`, or a failed one, broke the registration that was running.** The policy file (one name, its hash in the entry) and `session/base` were rewritten before the add | Medium, both (Tech Lead reproduced it) | Each policy file is named by its hash. Older ones are removed only after a successful install. Pruning keeps every trust root a policy names, and `remove` deletes them | T5: after a no-`claude` install and a failed add, the running registration's policy still checks and its trust root survives KEEP_SNAPSHOTS + 2 more snapshots. Checked by mutation |
| 2 | **`mirai render` in a terminal registered again when the server was `missing`,** so `remove` didn't last, and anyone running render had their Claude Code config changed | Medium, both | Render registers again only a MIRAI registration that's `stale` | T6: no registration, then render: none. Behind, then render: made again. Removed, then render: none. Checked by mutation |
| 3 | **The committed `mcp__mirai__*` allow rules** would let a branch's look-alike `mirai` server run its tools unasked, for a teammate who never registered | Medium, Tech Lead | They move to your git-ignored `.claude/settings.local.json`: added by install only when git ignores it, and only MIRAI's taken out by remove. The committed settings and lock are as 13c left them | T7; probes s2-local (honoured there) and s3-no-local (the look-alike's tool is denied) |
| 4 | **`status` said `current` on the policy hash alone,** so a moved node (say, a Homebrew upgrade) went unnoticed | Medium, Tech Lead | It compares the whole entry and requires a connected server. A `claude` error is `unknown`, never `missing` | T5: another node, then a failed start: `stale`; a `claude` error: `unknown`. Checked by mutation |
| 5 | **T6 couldn't fail:** it made fewer snapshots than are kept anyway | Medium, Tech Lead (shown by mutation) | Now in T5, with KEEP_SNAPSHOTS + 2 snapshots | Fails with the protection removed |
| 6 | **D-53 and D-12 still described an interactive bundle** and an interactive `mcp.json`, which 13c dropped | Medium, Architect | Rewritten: no interactive bundle; "only broker verbs" is a convention in your session; the checks guard against a branch's content, not your session; `lint(paths?)` | — |
| 7 | **The docs** didn't say what the checks guard against; "the token never reaches your session" overstated it; a stale "unit 15b" bullet | Low, Architect | The docs say what's guarded and what isn't; "the skill never handles the token"; the bullet is gone | — |
| 8 | **`remove` and `install` would remove or replace a user's own `mirai` server** | Low, Architect | Ours means its command names this repo's session folder. Otherwise `foreign`, and both refuse | T5 |
| 9 | **The daily cap was read and written outside a lock;** the day files were never pruned; the day was UTC, unsaid | Low, both | Taken under the journal lock (`appendEvent`'s `before`); older than a week removed; "UTC" in the docs and the message | T3: two servers on one registration share the cap; the pruning |
| 10 | **`findClaude`** didn't resolve paths, so a `claude` in the project could slip through a link | Low, Tech Lead (reproduced) | Folder and binary resolved first | T5b: the project's own, a linked project folder, a link into it |
| 11 | **`lint` replies could pass Claude Code's MCP output limit** (500 pretty-printed problems) | Low, Tech Lead | A 32 KB budget; the counts stay whole | T2: 400 problems |
| 12 | **The printed command** said "in this folder", but local scope is keyed by the exact folder | Low, Tech Lead | `cd '<checkout>' && claude mcp …` | T5 |
| 13 | **`remove`** reported any failure as "wasn't registered", and left the policy that kept a trust root | Low, Tech Lead | A failure is an error; the policies are deleted | T5 |
| 14 | **A stale registration's results** didn't say which rules they used | Low, Architect | `lint` returns `trust_base`; stored test results already have `base_sha` | T2 |
| 15 | **`session_id`** will collide with unit 19's session runs | Note, Architect | Renamed `registration_id`, documented as one per repo | T3 |
| 16 | **S5 and the tool-search fact** weren't in research/10 | Low, Architect | Added, with s2-local and s3-no-local | — |
| 17 | **Smaller things:** the allow list was hand-kept; the description and messages said "run" or "launch" in a session; `bin/mcp.js` said "headless only"; a short timeout for render's `claude` calls | Notes, both | The list comes from the table; wording per kind; 15 s for render | T1 |

## Noted for later units

| Unit | Note | From |
|---|---|---|
| 18 | <ul><li>No local registration, plus a committed `.mcp.json` `mirai`, plus `enableAllProjectMcpServers` or `enabledMcpjsonServers` (s3-no-local is the base); also consider a warning when committed settings enable project servers;</li><li>a branch adding allow rules to `.claude/settings.json`;</li><li>`lint` through a committed link to `~/.config/mirai` or the store (outside the docs root);</li><li>`log_event` from a session: privileged types, a forged id, a flood across two sessions, terminal and bidi text;</li><li>a tampered pinned trust root; a policy edited from Bash under its old hash;</li><li>key the result on the session server's code</li></ul> | both |
| 19 | <ul><li>`start_agent` refuses when the registration is behind the base;</li><li>pin the absolute `claude` path in the policy (under `env -i`, PATH is `/usr/bin:/bin` and `CLAUDE_CONFIG_DIR` is gone);</li><li>supervise agents outside the stdio server, in their own process group, with state where `agent_status` reads it;</li><li>a per-session launch cap and budget; decide whether `start_agent` gets an allow rule (recommended: it asks);</li><li>G24 first;</li><li>session run ids beside `registration_id`;</li><li>the server process as the natural key for `session_start`;</li><li>long-call timeouts;</li><li>skills must expect `mcp__mirai__*` through tool search;</li><li>`checkInit` and `pending` (seen again here on a busy machine)</li></ul> | both |
| 46 | `by: "session"` lines shown as your session's, through `shown()` (the roadmap row says so now); whether they go under FYI | Architect |
| Later | <ul><li>A `mirai status` line for a registration that's behind, missing, or left at an old path after a move;</li><li>`lint` in a worker or with a file cap for huge repos;</li><li>sessions started from a subfolder (unprobed)</li></ul> | both |
