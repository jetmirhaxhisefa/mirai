---
unit: "15b"
name: session-broker
status: approved (2026-10-29); unit approved (2026-10-29)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 15 (split in 15a); D-53, D-12, D-54
depends_on: ["15a"]
---

# Unit 15b: The broker in your own sessions

## Why

D-53 says workflow skills in your Claude Code session reach MIRAI only through the broker, as
agents do. 15a built the broker's core for agent runs. This unit gives **your own sessions** the
same server, with the tools a workflow skill needs today:
- `lint(paths)`;
- `log_event`;
- `run_tests` and `run_check`.

**Why now, honestly:** your sessions aren't sandboxed (13c). Your Claude can already run
`mirai lint`, `mirai log` and `mirai test` from Bash, so these four tools add little safety
today. What this unit really buys:
1. **The plumbing unit 19 needs.** `start_agent` must live in your session's server, so that the
   launch token is minted and used inside the broker and your session never sees it (D-12,
   D-53). How your session gets the server, which trust root it runs, and what it checks are
   the risky parts, so they get settled early. Unit 19 is big enough already.
2. **One interface for skills.** A workflow skill calls `mcp__mirai__lint` in your session and in
   a headless run alike, never a shell command that only works on one side.
3. **Lines your session writes say so.** The journal can then tell your Claude's note from
   yours (`mirai log`) and from an agent run's.

**The facts to settle first** (probes, before anything is built):
- **The committed `.claude/settings.json` can't name machine paths,** so the server can't be
  registered there.
- **A committed `.mcp.json` is out:** your project may already have one, and a branch controls
  it.
- **So registration is personal:** most likely a **local-scope entry** written by Claude Code's
  own CLI (`claude mcp add-json --scope local`). That's stored per project in your Claude Code
  config, never in the repo, and MIRAI never edits Claude Code's config file itself.

**Versions:** Claude Code 2.1.311, Node 22.23.2, macOS 26.7.

**Roadmap "done when" covered here:** "a skill in an interactive session logs and lints only
through the broker". The other half, "launches an agent", is unit 19's.

## Scope

**In:**

1. **Facts first: session probes** (`test/probes/session-probes.js`, run by hand, canaries only).
   - **Never your real Claude Code config:** every probe runs with a temporary
     `CLAUDE_CONFIG_DIR` and a fixture under `~`. Before and after, the harness compares the
     size and modification time of your real `~/.claude.json` and `~/.claude/` (it never reads
     them) and stops if either changed.
   - **S1:** `claude mcp add-json mirai '<json>' --scope local`, run in the fixture:
     - where it's stored (expected: the config file under `CLAUDE_CONFIG_DIR`, keyed by the
       project path);
     - that `claude mcp get mirai` and `claude mcp list` show it;
     - that `claude mcp remove mirai --scope local` removes it;
     - what happens when the project folder is moved.
   - **S2:** a `claude -p` run in the fixture, without `--strict-mcp-config`, as your sessions
     start:
     - the local-scope server starts through `/usr/bin/env -i` and is listed as connected;
     - its tools are `mcp__mirai__*`;
     - an allow rule in the committed `.claude/settings.json` lets them run, and without the
       rule they're denied.
   - **S3: a hijack attempt.** A committed `.mcp.json` declares a server also named `mirai`
     (a canary command). Which one wins? Is the project one asked about or started? Does the
     allow rule then reach the planted command?
     - **Fallback if the planted one can win:** the server gets a name a branch can't predict
       (`mirai-<repo id>`), and the allow rules name that.
   - **S4:** what your session sees when the server can't start (a moved trust root, a stale
     policy): a clear error, not a hang.

   About 4–6 short Haiku runs (open point 4).

2. **A second server kind: `interactive`.** Same server, same table; the policy says which kind.
   - **Tools:** `lint`, `log_event`, `run_tests`, `run_check`. Each entry lists the contexts it
     belongs to (15a), and none of the agent-only state applies.
   - **The trust root:** pinned at registration, re-verified on every call, as in headless runs.
     - **It's kept:** trust-root pruning keeps the snapshot a registration points at.
     - **When the integration branch moves:** `mirai render` (and `mirai init`) register again
       with the new trust root.
     - **A stale registration still works,** with the rules it was made with. `mirai status`
       and `mirai render` say when it's behind.
   - **No D-54 stop in your session:** your own commits change `.git` all the time.
     - What protects MIRAI's git calls is 14b's pinned host git, the repo config allowlist and
       the shape check. Every MIRAI git call runs them, as when you type `mirai test`.
     - So the interactive server never stops on a `.git` change; it runs those checks instead.
   - **The policy** lives in `<repo-home>/session/mcp-policy.json`, read-only, with its hash on
     the server's command line, like a launch's. It holds:
     - the checkout, the trust root and its manifest hash, HOME;
     - the store, the registration id and the tools.

3. **`lint(paths?)`:**
   - **paths:** files or folders of the project, in `run_tests`' path form (no leading `-` or
     `/`, no `.`/`..` parts, at most 32 paths). With none, the whole project, as `mirai lint`.
   - **runs** `lintPaths` with the **trust root's registry and config**, never the work tree's,
     on git's file list (pinned host git).
   - **returns** the problems inline, like `mirai lint --json`: file, line, column, severity,
     reason and hint, escaped. It writes nothing.

4. **`log_event` in your session:**
   - the same types and checks as 15a: plain text, no secrets, the caps;
   - **the line:** `by: "session"`, a new `by` value (open point 2), with `session_id` set to the
     registration id. No item is set; a later unit can give a session an item.
   - **the cap:** 200 lines a day per registration (open point 3), counted in
     `<repo-home>/session/`.

5. **`run_tests` and `run_check` in your session:**
   - as `mirai test`: the repo's turn, the machine slots, the copied tree;
   - the stored result says `by: "session"`, and it's never signed;
   - no `.git` stop, as above.

6. **Registration** (`mirai session-server install | remove | status`, also run by `mirai render`
   and `mirai init`):
   - **writes** the policy, then runs `claude mcp add-json <name> '<json>' --scope local` in the
     checkout. The json is `/usr/bin/env -i HOME=… PATH=/usr/bin:/bin <node>
     <trust>/…/bin/mcp.js <policy> <sha256>`;
   - **`remove`** runs `claude mcp remove`;
   - **`status`** compares what `claude mcp get` reports with the policy;
   - **if `claude` isn't on your PATH,** it prints the command for you to run and changes
     nothing;
   - **it never edits Claude Code's config files itself;**
   - **the allow rules** for the four tools go into the committed `.claude/settings.json` next
     to 13c's denies. They are tool names only, no paths.

7. **Docs:**
   - `docs/agent-safety.md`'s "Your own Claude Code sessions" gains the server: what it gives
     your session, what's checked, what isn't (no sandbox, no `.git` stop), and how to remove
     it;
   - `research/10` gets S1–S4.

**Out:**
- **`start_agent` and `agent_status`, and the session verbs:** unit 19. This unit only makes room
  for them.
- **A sandbox for your sessions:** not planned. 13c decided your sessions keep their normal
  behaviour.
- **Showing `by: "session"` lines:** unit 46 (the inbox), as for agent lines.
- **Other tools (Cursor, Codex):** Milestone D.

## Files

- **New:**
  - `src/mcp/session.js` (the interactive policy, the registration);
  - `src/mcp/tools/lint.js`;
  - `src/cli/commands/session-server.js`;
  - `test/mcp/session.test.js`;
  - `test/probes/session-probes.js`;
  - `implementation/units/15b-session-broker/{spec,test-results,review}.md`.
- **Changed:**
  - `src/mcp/server.js`, `tools.js` and `tools/*.js` (the kind, the contexts, `by` per kind);
  - `src/store/journal.js` (`by: "session"`, `session_id`; version 4);
  - `src/tests/run.js` (`by: "session"`);
  - `src/trust/snapshot.js` (keep the registered trust root);
  - `src/install/render.js` and `init.js` (register; the allow rules);
  - `src/adapters/claude-code.js` (the allow rules);
  - `src/cli/commands/status.js` (a stale registration; there's no `mirai doctor` yet);
  - `docs/agent-safety.md`, `research/10-claude-code-facts.md`, `design/04-decisions.md` (D-53).

## Tests

`npm test`, no Docker and no model. `claude` is a fake script that records its arguments.
- **T1:** the interactive kind:
  - its tools are `lint`, `log_event`, `run_tests` and `run_check`;
  - a headless-only tool in an interactive policy is refused at start, and the reverse;
  - no `.git` stop.
- **T2:** `lint`:
  - the path form and the count;
  - the trust root's registry, not the work tree's (a loosened work-tree registry has no
    effect);
  - the results escaped and inline;
  - it writes nothing.
- **T3:** `log_event` in a session:
  - the line says `by: "session"` and carries the session id;
  - no `launch_id`, and no item;
  - the daily cap;
  - the journal's own rules (`session` lines are never on privileged types; `session_id` goes
    with `session`).
- **T4:** the policy: its hash, its shape, a pinned trust root that's gone or changed.
- **T5:** the registration:
  - the exact `claude mcp add-json` arguments, run in the checkout, never a write to Claude
    Code's files;
  - `remove` and `status`;
  - no `claude` on PATH: the printed command, nothing changed;
  - `mirai render` registers again when the trust root moved.
- **T6:** pruning keeps the registered trust root.
- **T7:** the allow rules in `.claude/settings.json`: merged next to 13c's, only tool names, and
  idempotent.
- **T8:** the session probes stay canary-only, use only a temporary `CLAUDE_CONFIG_DIR`, and use
  Haiku.

**Probes:** S1–S4 as above, after your OK on the runs.

## Open points for you

1. **Do 15b now, or fold it into unit 19.** Recommended: now.
   - Its own tools add little safety today, since your sessions can run `mirai` from Bash.
   - But the facts (local scope, the name hijack, a stale trust root) are the risky part of
     19's supervised launches. Settling them in a small unit keeps 19 smaller.
   - The other way: skip to unit 16 (test IDs) and build all of this with `start_agent` in 19.
2. **Your session's lines say `by: "session"`.** Recommended. It's your Claude writing, not you
   (`unverified`) and not an agent run (`agent`). The other choice is `by: "agent"` with a
   session id in place of the launch id.
3. **Caps for your session:** 200 lines a day and 4,000 characters each. A guess. Your sessions
   are long, and you can always use `mirai log` yourself.
4. **About 4–6 short Haiku runs** for S1–S4, with a temporary Claude Code config folder, never
   your real one. I'll ask before starting them.
5. **MIRAI runs `claude mcp add-json` for you** during `mirai render` and `mirai init`. That
   changes your personal Claude Code config (local scope, this project only). Recommended,
   since `remove` undoes it. The other way: MIRAI only prints the command, and you run it.
6. **The server's name.** Recommended: `mirai`, unless S3 shows a committed `.mcp.json` can take
   it over. Then it's `mirai-<repo id>`.

## Changes after testing and review

1. **The allow rules moved to your `.claude/settings.local.json`** (review; this changes the
   approved spec, which put them in the committed `.claude/settings.json`).
   - **Why:** committed rules would also let a look-alike `mirai` server from a branch's
     `.mcp.json` run its tools without asking, for a teammate who never registered. The
     s3-no-local probe shows that case: the branch's server loads (`source: project`) and its
     tool is denied for want of an allow rule. s2-local shows a rule in `settings.local.json` is
     honoured.
   - **What install does:** it adds the four rules there, but only when git ignores the file (it
     says why otherwise), and records which entries it added.
   - **What remove does:** it takes out exactly those entries. Your own entries are never
     touched.
   - **The lock:** the committed settings and the lock are as 13c left them.
2. **Registering is your choice, and `remove` lasts** (both reviewers). `mirai render`, in a
   terminal, registers again only a MIRAI registration that's behind. It never registers a project
   that isn't registered. The spec's open point 5 ("MIRAI runs `claude mcp add-json` for you during
   render") is narrowed to that.
3. **A failed or impossible install leaves the running registration alone** (both reviewers; the
   Tech Lead reproduced the break):
   - each policy file is named by its hash (`mcp-policy-<sha>.json`);
   - older ones are removed only after a successful install;
   - pruning keeps every trust root that a policy file names;
   - `remove` deletes the policies.
4. **MIRAI never removes or replaces a `mirai` server it didn't register.** "Ours" means its
   command names this repo's session folder; otherwise `foreign`, and MIRAI refuses.
5. **`status`** compares the whole entry: node, script, policy and hash. It counts a server that
   can't start as `stale`, and a `claude` error as `unknown`, never `missing`.
6. **`findClaude`** resolves the folders and the binary, so a `claude` in the project doesn't
   count even through a link. The printed command `cd`s into the checkout first.
7. **`session_id` is now `registration_id`** (Architect). It's one id per repo, shared by your
   sessions there; unit 19's session runs add their own run ids.
8. **`log_event` in a session:**
   - the cap is counted under the journal lock, so two sessions can't pass it together;
   - it's per UTC day, and day counts older than a week are removed;
   - the tool's description depends on the kind.
9. **`lint`:**
   - at most 32 KB of problems inline, as well as the 500 cap;
   - `trust_base` in the reply;
   - a note that a whole-project lint runs in the server's event loop.
10. **The guard on your real Claude Code config is a count, not a size or time check.** This
    session writes to `~/.claude.json` and `~/.claude/` all the time. Before and after each run,
    `grep -c` counts the fixture folder's path in `~/.claude.json`, `~/.claude/settings.json` and
    `~/.claude/settings.local.json`. That reads the files but prints, stores and writes nothing.
    It was 0 and 0 on every run.
11. **Trusted folders** (a probe fact): Claude Code ignores a project's allow rules in a folder
    you never trusted. The fixtures are marked trusted in their temporary config only. Five runs
    were invalid before that, and three were repeated.
12. **`mirai init` doesn't register.** At init there's no trust root yet. Its "Next" list ends with
    `mirai session-server install`. **`mirai render`** acts only in a terminal, and a failure
    there never fails the render.
13. **A stale registration shows in `mirai session-server status` and `render`,** not in `mirai
    status`. A status line can come with unit 46's inbox.
14. **The server's name stays `mirai`** (S3).
15. **The probes:**
    - S5 was added (MIRAI's own server from a real session; its quoting bug was fixed against
      the saved run);
    - s2-local and s3-no-local came after review;
    - **11 Haiku runs in all,** against 4–6 planned, each with your OK.
16. **Docs and design:**
    - D-12 and D-53 no longer describe an "interactive bundle", which 13c dropped. They say that
      "skills use only broker verbs" is a convention in your unsandboxed session, and that the
      checks guard against what a branch contains, not against the session itself;
    - roadmap row 15 lists the tools as built, and row 46 gains session lines;
    - `agent-safety.md` drops its stale 15b bullet;
    - research/10 gains S5, the tool-search fact, s2-local and s3-no-local.
17. **Other ways the build differs from the spec:**
    - the session's state (the id, the policies, the allow record, the daily counts) lives in
      `<repo-home>/session/`;
    - `lint` reads the files through git, as `mirai lint` does, so it isn't limited to the docs
      root;
    - the allow rules come from the tool table (its interactive tools);
    - the tests: T5b (`findClaude`), T6 (the commands and render), T7 (`settings.local.json`) and
      T9 (the entry starting the server over its pipe);
    - 01's T14 gains the command name.
