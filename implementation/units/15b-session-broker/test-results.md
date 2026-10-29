---
unit: "15b"
name: session-broker
date: 2026-10-29
node: v22.23.2
claude-code: 2.1.312
macos: 26.7
result: 288 / 288 before review; after the review fixes 286 / 288 at a load average above 500, the two failures load-only timing checks (hook T4, lint T12) that pass alone; S1 (no model); 11 Haiku runs (S2–S5, then s2-local and s3-no-local after review), your real Claude Code config untouched (counted, never written); MIRAI's own server used from a real session (S5)
---

# Unit 15b — Test results

## `npm test`

New tests, with no model and no Docker. `claude` is a fake script that records its arguments and
keeps one registration:

```
15b T1: the interactive kind: lint, log_event and the test tools; no launch fields; no .git stop
15b T2: lint: the path form, the trust root's rules not the work tree's, results inline and escaped, nothing written
15b T3: log_event in a session: by session with its registration, no launch or item, the daily cap under the lock, the journal's rules
15b T4: the policy: named by its hash, read-only; a stable id; a pinned trust root that changed stops the server
15b T5: registration: claude's own CLI in the checkout; a failed or impossible install leaves the running one alone; never a server that isn't MIRAI's
15b T5b: findClaude: absolute folders only; never one in the project, by its real path or through a link
15b T6: the commands, and mirai render: only a registration that's behind is made again; remove lasts
15b T7: the allow rules: in your git-ignored settings.local.json, never the committed file; only MIRAI's are taken out
15b T8: the session probes stay canary-only, use a temporary Claude Code config, and use Haiku
15b T9: the registered entry starts MIRAI's server as Claude Code would, and its tools answer over the pipe
```

**The review fixes** (review.md) were checked by mutation. Each of these made its test fail when
undone:
- pruning's protection of a registered trust root (T5);
- render registering only a stale registration (T6);
- `status` comparing the whole entry (T5);
- refusing a `mirai` server that isn't MIRAI's (T5).

T9 starts `bin/mcp.js` exactly as the registered entry says (`/usr/bin/env -i`, `env: {}`). It
then calls `tools/list`, `log_event` and `lint` over the pipe, and reads the line back from the
journal.

**Existing tests changed by this unit:**
- **15a's broker T1:** the table holds `lint`, with each tool's contexts.
- **15a's broker T5, 06's T10b and 05a's T6:** the journal is version 4.
- **01's T14:** the pinned command list gains `session-server`.

**After the review fixes**, the full run gave 286 / 288 at a load average of 505–580:
- hook T4's `bin/hook.js` took 2,874 ms against its 2 s limit;
- lint T12 was over its 1 s check.

Both pass alone, and nothing in 15b touches them. The run before review, below, was 288 / 288.

An earlier full run, at a load average near 120, had two failures. 01's T14 was the
command-list pin, which this unit updated; lint T12's 1-second timing check took 1,244 ms and
passes alone.

```
# tests 288
# pass 288
# fail 0
# cancelled 0
```

## The session probes (Claude Code 2.1.312)

`node test/probes/session-probes.js`.
- **Isolation:** every Claude Code call ran with a temporary `CLAUDE_CONFIG_DIR`, in a fixture
  under `~`.
- **Your real config:** on every run, the fixture folder's path appeared **0 times before and 0
  after** in `~/.claude.json`, `~/.claude/settings.json` and `~/.claude/settings.local.json`.
  That's a count from `grep -c`; nothing was printed, stored or written.

**S1, no model:**

| Probe | Result |
|---|---|
| s1-add | pass: "Added stdio MCP server mirai to local config" |
| s1-stored | fact: in `$CLAUDE_CONFIG_DIR/.claude.json` (keyed by the project's path) |
| s1-get | pass: "Scope: Local config (private to you in this project)", "Status: ✔ Connected", started through `/usr/bin/env -i` |
| s1-list | pass: listed and connected |
| s1-moved | fact: from the moved folder, "No MCP server named mirai" |
| s1-remove | pass: removed; then `get` finds none |

**S2–S4, with Haiku** (a canary server that answers with its marker), 8 runs, then 2 after review; with S5, 11 Haiku runs in all.

The first 5 runs found a fact about my setup. In a fresh config folder the workspace isn't
trusted, and Claude Code then ignores the committed allow rules. It said so on stderr: "Ignoring 1
permissions.allow entry from .claude/settings.json: this workspace has not been trusted". Your own
project is one you trusted once. So the harness now marks the fixture trusted in its temporary
config, and three runs were repeated.

| Probe | Result |
|---|---|
| s2-allow | pass (trusted): `mirai: connected (local)`; the tool answered with the local marker |
| s2-no-allow | pass: no allow rule, so the tool was denied (`permission_denials`) |
| s2-untrusted | fact (the first runs): in a folder never trusted, the allow rule is ignored and the tool denied |
| s3-planted | pass (trusted): a committed `.mcp.json` server named `mirai` was shadowed; only the local server appeared, and it answered |
| s3-enabled | pass (trusted): the same, with `enableAllProjectMcpServers: true` in the committed settings |
| s4-broken | fact: a registered server that can't start shows as `mirai: failed (local)`; the run goes on without its tools (8 s) |
| s2-local (after review) | pass: the allow rule only in a git-ignored `.claude/settings.local.json` is honoured; the tool answered with the local marker |
| s3-no-local (after review) | fact: no local registration, a committed `.mcp.json` `mirai` server and `enableAllProjectMcpServers`: the look-alike is loaded (`source: project`) and its tool **denied** for want of an allow rule. Committed allow rules would have let it run, hence the move to `settings.local.json` |

On this busy machine, the init event showed the server as `pending` in s2-local and s3-no-local
(14d's note for unit 19).

**S5, MIRAI's own server in a real session** (1 Haiku run). The fixture had MIRAI installed, and
the server was registered as `mirai session-server install` does it.
- **Init:** `mirai: connected`.
- **What Haiku did:** it found both tools through tool search, then called them:
  - `log_event` returned `{"logged": "note", "seq": 1}`. The journal has one line:
    `{"schema_version":4, …, "by":"session","session_id":"s-…"}`, and its id matches the
    registration's;
  - `lint` returned `{"outcome": "pass", "files": 0, "skipped": 4, …}`.
- **The reply:** "1 pass".

S5 ran before review, with the allow rules still in the committed settings. s2-local shows the
same rule works from `settings.local.json`, where `install` now puts it.

The probe's own check first reported FAIL. It looked for `"files"`, but a tool result is JSON
inside JSON (`\"files\"`). The check was fixed, then verified against the saved run: it finds the
lint result, and not in the `log_event` result. The run wasn't repeated.

**Afterwards:** no probe folders were left (the reports are kept in this session's scratchpad),
and no `/private/tmp/mirai-*` folders.
