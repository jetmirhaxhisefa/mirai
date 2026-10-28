---
unit: "15a"
name: broker-core
status: approved (2026-10-28); unit approved (2026-10-28)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 15 (split proposed below into 15a, 15b and parts moved to 19 and 43); D-12, D-53, D-54
depends_on: ["14d"]
---

# Unit 15a: The broker's core

## Why

D-53 says that a sandboxed session reaches MIRAI through one channel only: the **MIRAI MCP
broker**. It comes from the trust root, runs outside the sandbox and takes structured arguments
only. Unit 14d built the first piece of it, a server with two tools (`run_tests`, `run_check`).

The roadmap's unit 15 lists much more than one unit can hold, and some of it can't be built yet:

| Broker part | Needs | Where it goes |
|---|---|---|
| Tools as data (14d review note), `log_event`, the input folder | 14d | **15a** (this unit) |
| The broker in **your** interactive session: `lint`, `log_event`, `run_tests`/`run_check` | 15a, plus probes of how Claude Code loads a server for a project without committing a path | **15b** |
| `start_agent` / `agent_status` (detach-and-wait, the launch token) | `mirai agent run`, which doesn't exist yet | **unit 19** (it depends on 15 anyway) |
| `session_start` / `session_end` | run ids for sessions, which come with `mirai session` | **unit 19** |
| `trace(item)` | `mirai trace` | **unit 43** (its row already says "reached through the broker") |

So this unit is the base that 15b, 19 and 43 add tools to. It does three things:
1. **Tools as data.** 14d's server dispatches on two hard-coded names. This unit turns each tool
   into one entry (name, schema, argument check, handler, which launches get it), so later units
   add an entry instead of editing the server.
2. **`log_event`** for headless agents: the way an agent writes a note or a template gap to the
   journal (agents can't run `mirai log`, which `Bash(mirai *)` denies). D-53: headless runs get
   only `run_tests`, `run_check` and `log_event`.
3. **The per-launch input folder** (D-12's work-file exchange): what an agent needs (a plan, the
   findings of earlier rounds) is written into the launch's `input/`, readable by that launch
   only and never writable. Unit 19 fills it with real plans; this unit builds and probes the
   mechanism.

It also closes 14d's open gap: Claude Code itself hasn't yet started the server through
`/usr/bin/env -i`. This unit's Haiku run does.

**Versions:** Claude Code 2.1.311, Node 22.23.2, macOS 26.7 (as 14d).

**Roadmap "done when" covered here:**
- `mirai` from Bash is denied (already true since 13b; a probe checks it again with the broker
  wired);
- a launched agent reads its plan from the input folder and can't write it.

**Moved to 15b:** "a skill in an interactive session logs and lints only through the broker".
**Moved to 19:** "a skill in an interactive session launches an agent".
**Unit 51** keeps "a QA script passed as content runs in the Playwright container".

## Scope

**In:**

1. **Tools as data** (`src/mcp/tools.js`, one file per tool under `src/mcp/tools/`):
   - each tool is `{ name, description, schema(policy), enabled(policy), check(args, policy),
     run(args, ctx), exclusive }`:
     - `schema` builds the input schema from the policy (the enums for levels, checks and event
       types);
     - `check` returns the checked arguments or a refusal;
     - `exclusive: true` marks tools that take the "one call at a time" slot (the two test
       tools); `log_event` doesn't, so an agent can log while a test runs;
   - **the server** (`createServer`) keeps the protocol, the stop rule, cancelling, progress and
     the error cleaning. It looks a tool up in the table, and `tools/list` lists the enabled
     ones;
   - **shared checks, for every tool:**
     - the arguments are an object, with no key the schema doesn't name (`__proto__` included);
     - a stopped server refuses every tool;
     - the trust root is re-verified on every call, as in 14d;
   - **D-54's `.git` checks** (before, at the turn, after) stay with the test tools, which run
     git. `log_event` runs no git.
   - **No behaviour change for `run_tests` and `run_check`:** 14d's tests pass unchanged, apart
     from where they import things.

2. **`log_event(type, message, template?, section?)`:**
   - **Types:** `note` and `template_gap` only, the same non-privileged types `mirai log` takes.
     Privileged types (approval, status, gate results, records) aren't in the enum. That's the
     allowlist D-53 asks for: a type added later is MIRAI's own until someone decides otherwise.
   - **The line it writes** in the repo's journal:
     - `by: "agent"`, a new value of the journal's `by` (open point 2), and `launch_id` from the
       policy;
     - `item` from the policy (the launch's ticket or document, null until unit 19 sets it),
       **never from the agent**, so an agent can't log against another ticket;
     - the message as given, checked by the journal's own rules (no empty text, 16 KB per line).
   - **Limits per launch:** 50 events and 4,000 characters per message. Past the cap the tool
     refuses with `log-full`. The caps are in the policy, not in the agent's hands (open
     point 4).
   - **No git and no store paths:** the policy names the store folder and the repo id outright,
     so the server never runs git to find the store. The reply is `{ logged: <type>, seq }`.
   - **Shown safely:** `mirai status` and the inbox print agent lines through `shown()`, like
     every other journal text, and mark them as the agent's.

3. **Every headless launch gets the server:**
   - 14d wired the server only for projects with tests. Now every launch has `log_event`, so
     every launch gets `input/mcp.json`, the policy and the allow rule
     `mcp__mirai__log_event` (open point 3);
   - **the template** replaces `tests` with `mcp: { tests: {levels, checks} | null, log:
     ["note", "template_gap"] }`, so the canonical bundle hash still covers all the wiring.
     Strict schema `mirai-strict/4`, snapshot format 5;
   - **the policy** becomes `mirai-mcp-policy/2`: it adds the tools and their settings, the
     store folder, the repo id, the item and the log caps. `launch_id` becomes required;
   - `expectedInit` always expects the `mirai` server connected; `mirai sandbox show` lists
     `log_event` and its types.

4. **The input folder** (`prepareLaunch({ inputs })`):
   - `inputs` maps a file name to its text. Names match `^[a-z0-9][a-z0-9._-]{0,63}\.(md|json|txt|diff)$`,
     at most 32 files and 4 MiB in all. Anything else is refused before the launch folder is
     made;
   - the files go into `input/files/`, mode 0400, and the folder 0500, written before the rest
     of `input/` is locked (as the policies are today);
   - **readable by this launch only:** `input/` is already in this launch's sandbox `allowRead`
     and in the hook's read roots, and nowhere else. Writes are refused three ways: the
     MIRAI-home `denyWrite` in the sandbox, the file modes and the hook's path check;
   - the launch plan returns the files' absolute paths, so unit 19 can name them in the prompt;
   - `removeLaunch` removes them with the rest.

5. **Probes** (`test/probes/broker-probes.js`, run by hand, canaries only, the fixture under
   `~`):
   - **direct, with the harness as the client:** `tools/list` with and without tests; each
     `log_event` refusal (a privileged type, an extra field, an `item` field, an empty message,
     too long, the 51st event); a log call while a test runs; the journal lines it wrote;
   - **with Haiku, through MIRAI's own launch** (open point 5), about 3 short runs:
     - **b1:** the launch passes `checkInit` with `mirai` connected, which also shows that
       Claude Code starts the server through `/usr/bin/env -i` (14d's gap). The model calls
       `log_event(note, …)`, and the line is in the journal with `by: "agent"` and the launch
       id;
     - **b2:** the model reads a canary `plan.md` from `input/files/` and quotes it. Then it
       tries to change it with Write, Edit and Bash (`echo >>`, `rm`, `chmod`): all are refused
       and the file is unchanged;
     - **b3:** `mirai --version` and `node <trust>/…/bin/mirai.js log note` from Bash are
       refused or fail (no store access), and nothing reaches the journal.

6. **Docs:** `docs/agent-safety.md` gains "How agents talk to MIRAI": the tools, what the
   journal records for an agent line, the input folder. `research/10` gets b1–b3's results.

**Out:**
- **Your interactive session's broker:** 15b.
- **`start_agent`, `agent_status`, `session_start`, `session_end`:** unit 19.
- **`trace`:** unit 43. **`lint` for agents:** D-53 gives headless runs no `lint`; it comes with
  15b for your session.
- **Filling the input folder with real plans, deltas and findings:** units 19–21.
- **Capturing structured output (verdicts, finding replies):** unit 19.

## Files

- **New:**
  - `src/mcp/tools.js` (the table and the shared checks);
  - `src/mcp/tools/run-tests.js`, `run-check.js`, `log-event.js`;
  - `test/mcp/broker.test.js`;
  - `test/probes/broker-probes.js`;
  - `implementation/units/15a-broker-core/{spec,test-results,review}.md`.
- **Changed:**
  - `src/mcp/server.js` (dispatch through the table, policy 2);
  - `src/store/journal.js` (`by: "agent"`, `launch_id`);
  - `src/status/` (agent lines marked as such), `src/cli/commands/log.js` (shares the type list);
  - `src/launch/strict.js` (the `mcp` template field, the server for every launch, the input
    folder), `src/trust/snapshot.js` (format 5), `src/cli/commands/sandbox.js`;
  - `test/mcp/server.test.js`, `test/launch/strict.test.js`, `test/store/logs.test.js`;
  - `docs/agent-safety.md`, `research/10-claude-code-facts.md`, `design/04-decisions.md` (D-53:
    where each verb lands), `design/07-implementation-roadmap.md` (the split).

## Tests

`npm test`, no Docker and no model:
- **T1:** tools as data: `tools/list` comes from the table and the policy; a tool not enabled
  for the launch is "unknown tool"; 14d's T1–T7 still pass.
- **T2:** the shared checks: extra keys, `__proto__`, a stopped server refuses every tool, the
  trust root is checked on every call (a log call too).
- **T3:** `log_event`: the enum, the fields per type, `item` refused as an argument, the
  journal line (`by: "agent"`, `launch_id`, the policy's item), the caps (`log-full` on the
  51st), no git call (a fake git that fails if run).
- **T4:** `log_event` while a test runs is answered; a second test call is still `busy`.
- **T5:** the journal: `by: "agent"` only for `note` and `template_gap`; a privileged type with
  it is refused; existing lines and signed lines still verify; `mirai status` marks agent lines.
- **T6:** the policy 2: its hash, its shape, the caps, a policy 1 refused with a clear message.
- **T7:** the wiring: every launch has `mcp.json` and the `log_event` rule, with and without
  tests; the template's `mcp` field is in the canonical hash; `checkInit` expects `mirai`;
  `sandbox show` lists `log_event`.
- **T8:** the input folder: names, counts and sizes refused; files 0400 in a 0500 folder; in
  `allowRead` and the hook's read roots of this launch only; returned paths; removed after.
- **T9:** the probe scenarios stay canary-only and local, and the model is always Haiku.
- **T10:** the stack-neutrality check covers `src/mcp/tools/`.

**Probes:** b1–b3 and the direct cases above, after your OK on the Haiku runs.

## Open points for you

1. **The split.** Recommended: 15a (this unit), then 15b (your session's broker), with
   `start_agent`/`agent_status` and the session verbs moving to unit 19 and `trace` staying
   with unit 43. They can't be built before `mirai agent run` and `mirai trace` exist, and unit
   19 already depends on 15. The roadmap and D-53 get a line saying where each verb landed.
   - **15b needs its own facts first.** Your sessions aren't sandboxed (13c) and the committed
     `.claude/settings.json` can't name machine paths. So the probes must settle how your
     session gets the server: a local-scope entry through `claude mcp add-json --scope local`
     (personal, never committed, no file MIRAI owns in the repo), or starting your session
     through MIRAI with `--mcp-config`. A committed `.mcp.json` is out, because your project
     may already have one.
2. **Agent lines say `by: "agent"`.** Recommended. Today `by: "unverified"` means you, through
   `mirai log`, unsigned. A separate value with the launch id keeps the two apart, and the
   journal's readers can tell an agent's note from yours. The other choice is reusing
   `unverified` plus a `launch_id` field.
3. **Every headless launch gets the server**, even in a project without tests, because every
   agent may need `log_event`. Recommended. The cost: a launch now always fails when the server
   can't start (it fails closed, as with tests today).
4. **Caps: 50 events and 4,000 characters per message per launch.** A guess: enough for notes
   and template gaps, small enough that an agent can't flood the journal or your inbox.
5. **About 3 short Haiku runs on your subscription** (b1–b3). I'll ask before starting them, as
   before.
6. **The agent never picks the `item`.** Recommended: the launch's own item, set by MIRAI. The
   other way, an agent could file notes against any ticket.

## Changes after testing and review

1. **The input folder needs `--add-dir`, and `input/` is write-denied** (the b2 probes). The spec
   said the folder was already readable through the sandbox's `allowRead` and write-protected by
   the MIRAI home's denyWrite. Both were wrong:
   - **`--restricted` confines Claude Code's file tools to the working directory.** Read
     refused the file whatever `allowRead` said. `allowRead` covers Bash only.
   - **`launches/` was never in the sandbox's denyWrite.** It was safe only because sandboxed
     writes reach just the checkout, the temp folders and `allowWrite`.
   - **`--add-dir <folder>` lets Read in, but it also opens the folder to sandboxed writes.**
     `chmod 600` on the plan succeeded, and only the file modes stopped `echo >>` and `rm`.

   **What the launch does now:**
   - it adds `--add-dir <launch>/input/files` when there are inputs;
   - every launch write-denies `<launch>/input` in the sandbox and for Edit;
   - `checkInit` requires exactly the folders MIRAI added.

   Under that, Write, Edit, `echo >>`, `chmod`, `rm` and a new file were all refused, and Read
   and `cat` both worked (the final run). This changes the bundle's write surface, so it's
   flagged here for your OK.
2. **The canonical bundle hash covers more:** the template's `mcp` field (the log types, and
   14d's levels and checks, which the rendered settings don't name) and the launch flags, with
   and without an input folder. Every canonical hash changes. No red-team results are stored yet
   (unit 18).
3. **`log_event`, beyond the spec** (review):
   - the token and the template's secret shapes are refused, as the hook does for files an agent
     writes;
   - control, bidi, invisible-only and lone-surrogate characters are refused; newlines and tabs
     are fine;
   - **the cap is per launch,** counted in `<launch>/log-events` once a line is written, so a
     restarted server doesn't start again at 0;
   - the journal lock is waited on for at most 2 s, then `journal-busy`.
4. **The policy gains `kind`** (`headless`), **`launch_dir`** and the secret shapes. Each tool
   names its `contexts`. A policy that offers a tool outside its kind stops the server at start,
   so D-53's recursion guard is in the table, not only in the policy writer.
5. **Smaller changes:**
   - input names that are instruction files (`claude.md`, `agents.md`, …) are refused;
   - `checkInit` reports an `additional_directories` that isn't a list;
   - `renderStrict` checks the template's `mcp` field;
   - error text hides `<store>` and `<launch>` as well.
6. **Not built: marking agent lines in `mirai status`.** `status` shows no journal notes at all,
   so there was nothing to mark. Showing agent lines as the agent's, through `shown()`, moves to
   unit 46 (the inbox), which the roadmap now says.
7. **Other ways the build differs from the spec:**
   - the two test tools are one file, `src/mcp/tools/tests.js`, not `run-tests.js` and
     `run-check.js`;
   - `prepareLaunch` takes `item` (unit 19 sets it);
   - `test/store/logs.test.js` didn't need changes. The journal's version pins were in
     `store.test.js` and `sign.test.js`;
   - `appendEvent` and `withSeq` take a `lock` option;
   - the journal's signature context still comes from each line's own version, so no
     signature-context change was needed;
   - T7 and T8 are in `strict.test.js`, and the stack-neutrality check (T10) is 14c's T13;
   - a new sign test: a version-2 signed line still verifies, and relabelled as version 3 it
     doesn't.
8. **The probes:**
   - **the 3 planned Haiku runs grew to 10,** with your OK at each step;
   - b2 keeps its canary only in the file (the first pass was false, since the canary was in the
     prompt), and it now requires each of its six write attempts to be refused;
   - **b2c** was added: Bash reads the folder;
   - **b1 closed 14d's gap:** Claude Code itself started the server through `env -i`;
   - the direct probes, and 14d's 19 Docker probes, were re-run on the review fixes. The Haiku
     probes weren't re-run after the review fixes: those changed `log_event`'s checks and the
     policy's fields, which the direct probes and T7 (the server started as `mcp.json` says)
     cover.
9. **The split is recorded:**
   - D-53 says where each verb lands;
   - each of roadmap row 15's checks names its unit;
   - row 19 gains the verbs, the launch token minted in the broker, G24, the input contents and
     its moved check;
   - row 43 gains its table entry;
   - row 46 gains the agent lines.
10. **Noted for later units** (review.md has the full table):
    - **15b:** your session's kind and its `.git` and trust-root model, the `by` model, the
      local-scope policy, `lint` paths;
    - **18:** red-team rows for the input folder and `log_event`, and keying results on the
      server and hook code too;
    - **19:** fill the inputs, `item`, `launch_id` in the run log, `start_agent` for your session
      only, the token in the broker, G24, de-duplicating `template_gap`, agent text as untrusted
      input;
    - **43:** `trace` as a read-only entry;
    - **46:** agent lines.
