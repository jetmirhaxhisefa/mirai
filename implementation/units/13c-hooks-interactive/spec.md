---
unit: "13c"
name: hooks-interactive
status: approved (2026-10-25)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 13 (13c); D7, D-30; research/09 §7.6; research/10; 13b's "Noted for later units"; unit 11's note on native agent starts
depends_on: ["13a", "13b"]
---

# Unit 13c: Hooks and the interactive settings

## Why

13b's strict bundle relies on two kinds of rules:
- **the sandbox,** which the operating system enforces on every command an agent runs;
- **Claude Code's permission rules,** which cover its own file tools (Read, Edit, Write, Grep,
  Glob) and match file **names**.

The file tools run outside the sandbox. So for them, the only guard is name matching. 13b's
probes found it held for the routes tried (`.ENV`, a symlink to `.env`, Grep over the project),
but name matching has a structural blind spot: a file reached under a different name. Research/09
§7.6 planned a second layer for exactly this, **hooks**. A hook is a small MIRAI program that
Claude Code runs before every file tool call. It sees the real target on disk and can refuse it.

13c also covers your own **interactive** Claude Code sessions in a MIRAI project. They don't run
in the strict bundle, so they need a few hard rules of their own: never read your signing key or
token, never write `.git`, and never start MIRAI's agents directly (unit 11's note).

## The first step: a possible hole in 13b (probe before anything is built)

A **hard link** is a second name for the same file. If a sandboxed command can run
`ln .env notes.txt` (creating a link needs no read of the file's content), then the Read tool on
`notes.txt` would read the real `.env`:
- the `.env*` glob deny doesn't match the name;
- a `realpath` check doesn't see it either, because a hard link isn't a symlink.

**Two probes, against the 13b bundle as committed:**
1. Can sandboxed Bash create a hard link to a read-denied file?
2. Can the Read tool read through it?

**What follows from the result:**
- **If the link is refused,** 13b is fine on this point, and the hook's inode check (below) is a
  second layer.
- **If it works,** 13b has a hole. The hook's inode check closes it, and 13b's docs and
  research/10 get corrected. I'll tell you before going on either way.

## What the hooks do

**One hook program,** `.mirai/framework/bin/hook.js`, run from the trust root (never the work
tree). Claude Code runs it outside the sandbox as `PreToolUse` on the file tools.

1. **The path check** (Read, Edit, Write, MultiEdit, NotebookEdit, Glob, Grep). It resolves
   every path the call names:
   - symlinks resolved;
   - case compared the way your disk does (macOS ignores case);
   - for a new file, its nearest existing folder.

   It refuses:
   - **reads outside** the checkout, the run's input and scratch folders, and the run's trust
     root;
   - **writes outside** the checkout and the scratch folder;
   - **at any depth:** `.git`, `.mirai`, the write-denied auto-run and hook paths, and every
     `.env*` file except the committed readable ones;
   - **any file that is the same file on disk** (same device and inode) as a protected one. This
     is what catches a hard link.
2. **The secret check** (Write, Edit, MultiEdit, NotebookEdit). It refuses content that contains:
   - **the login token**, in every encoding the probe harness redacts. The hook reads the token
     from `~/.config/mirai` itself: it runs outside the sandbox, so the token never has to be
     handed to the run;
   - **known secret shapes**, as stack-neutral data (`registry/secrets/core.toml`): private key
     blocks, and token prefixes such as `AKIA…`, `ghp_…`/`github_pat_…`, `sk-ant-…`, `xox…-`,
     `AIza…`, `sk_live_…`. Only shapes with a fixed prefix, so ordinary code doesn't trip it.
     Packs can add more later (unit 17).
3. **Failing closed** (open point 2): the bundle stops allowing the file tools in its permission
   rules. Instead, the hook allows each call explicitly once it passes. So a hook that crashes,
   hangs or is missing means the call is refused, not let through. This depends on a Claude Code
   behaviour that must be probed first: in `dontAsk` mode, does a hook's "allow" let a tool run
   that the rules don't allow?
4. **Integrity:**
   - the hook's command is the absolute `node` path plus the hook script in the run's trust root;
   - the policy it applies is a file in the launch's read-only `input/`, written by
     `prepareLaunch` next to the settings;
   - on every call, the hook checks the trust root's files and the policy against their hashes
     (the cost is measured; open point 1).

## The interactive settings

`.claude/settings.json` in the work tree, rendered by `mirai render` and marked `rendered` in
the lock (unit 11 reserved it as `later.settings`). Your own sessions keep their normal
behaviour, plus these hard denies:
- **reading or writing** `~/.config/mirai/**` (your signing key, the token) and the MIRAI home
  (`~/Library/Application Support/mirai/**`);
- **writing** `.git/**` and `.mirai/keys/**`, `.mirai/records/**`;
- **Bash commands** that only you may run: `mirai approve`, `drop`, `key`, `token` (speed bumps;
  the terminal rule is the real guard);
- **starting MIRAI's agents natively:** `Agent(mirai-<name>)` for each agent in the registry, by
  exact name (13a: a `mirai-*` wildcard doesn't work).

These work only if Claude Code honours these rules from a **project** settings file; 13a only
tested `--settings`. A probe settles it.

**Your own entries stay yours** (open point 3): MIRAI merges its denies into the file, keeps
everything else in it, and the lock records MIRAI's entries rather than the whole file's hash.

## Scope

**In:**
- **The hard-link probe** (first).
- **The hook program:** the path check, the inode check, the secret check, the hash checks, and
  failing closed. It is wired into 13b's bundle: the settings' `hooks` section, the policy file
  in `input/`, and the file tools allowed by the hook rather than the rules if the probe allows
  it.
- **`registry/secrets/core.toml`:** secret shapes as data.
- **The interactive `.claude/settings.json`,** through `mirai render` and `mirai init`, merged
  into an existing file.
- **Probes** (13a's harness, `--bundle` and a new interactive-settings mode):
  - the hard link;
  - hooks from `--settings` run under `--restricted`;
  - a hook "allow" under `dontAsk`;
  - a crashed hook refuses;
  - the token and a secret shape are refused in Write;
  - an ordinary Write passes;
  - the hook's time per call;
  - the interactive denies, including `Agent(mirai-x)`, from a project settings file;
  - every 13b bundle probe still passes with the hooks on.
- **The docs:** `docs/agent-safety.md` gains the second layer and your interactive sessions'
  rules.

**Out:**
- **Hooks in interactive sessions:** the committed file can't name machine paths, and a
  rendered `settings.local.json` is for later, if needed.
- **The Bash commands themselves:** the sandbox covers them.
- **Secret scanning of commits:** unit 26's pre-push hook.
- **More secret shapes per technology:** packs, unit 17.

## Files

```
bin/hook.js                         # the hook entry point (in the framework copy, run from the trust root)
src/launch/hook.js                  # the checks: paths, inodes, secrets; the policy file
src/launch/strict.js                # the hooks section, the policy file, file tools allowed by the hook
src/sign/token.js                   # the token's encodings (moved from the probe harness)
registry/secrets/core.toml          # secret shapes
src/config/registry.js              # the secrets kind
src/install/render.js               # .claude/settings.json, merged
src/adapters/claude-code.js         # the interactive denies
test/launch/hook.test.js
test/adapters/claude-code.test.js   # T11: the interactive settings (in place of a new settings test file)
test/probes/*                       # the new probes
docs/agent-safety.md
```

## Tests

| # | Test |
|---|---|
| T1 | **The path check:** symlinks, case variants, `..`, a new file's folder, nested `.git`, `.env*` except committed readable ones, auto-run and hook paths; reads and writes outside their roots refused |
| T2 | **The inode check:** a hard link to a protected file is refused under any name |
| T3 | **The secret check:** the token (plain, base64 at every offset, hex, URL-encoded, a 16-character piece) and each secret shape refused in Write, Edit, MultiEdit and NotebookEdit content; ordinary code passes |
| T4 | **Failing closed:** a hook that throws, gets bad input, can't read its policy, or finds a changed trust root or policy refuses |
| T5 | **The bundle with hooks:** the settings' hooks name the trust root's hook with an absolute `node`; the policy file is read-only in `input/` and its hash is checked |
| T6 | **The interactive settings:** rendered with the denies and each registry agent by name; merged into an existing file without touching other entries; `mirai render` idempotent; the lock records MIRAI's entries; removing one is noticed |
| P | **The probes** above, recorded in `test-results.md` |
| S | **On the sample app:** refresh, render, commit and push; `.claude/settings.json` holds the denies |

## Open points for you

1. **The hook checks the trust root's hashes on every call.** It's the strongest option, at a
   cost of some milliseconds per file tool call (measured by a probe). The alternative is to
   check only the hook's own files. I recommend the full check if it costs under about 50 ms,
   otherwise only the hook's own files plus the policy.
2. **Make the hook the gate for the file tools** (it must allow each call), so a broken hook
   refuses instead of letting calls through. This depends on the probe of a hook "allow" under
   `dontAsk`. If Claude Code doesn't support it, the hook can only add denies: a crashed hook
   then fails open, and the permission rules remain the first layer. I recommend failing closed
   if the probe allows it.
3. **Merge into your `.claude/settings.json`** rather than owning the whole file. Teams often
   keep their own settings there; MIRAI adds its denies and records only its entries. The
   alternative is to refuse to render when the file exists and isn't MIRAI's. I recommend
   merging.
4. **Secret shapes with fixed prefixes only,** no "high entropy" guessing: fewer false alarms,
   and the token itself is matched exactly. I recommend it.
5. **The hard-link probe goes first,** and I report the result before building, because it may
   mean 13b has a hole. I recommend it.

## Changes after testing and review

Listed for your check before "UNIT APPROVED".

**Settled during testing:**
1. **Open point 5, the hard link: a real gap in 13b.** An agent can't create one, but an existing
   second name for a secret file was read by both the Read tool and Bash. Your decision: fix it
   in 13c.
   - A launch is refused while a real `.env*` file, the token or the signing key has more than
     one name on disk. The message says how to find and remove the extra name.
   - The hook also refuses any file tool call on a protected file's device and inode.
   - research/10 and the docs say so.
2. **Open point 2, failing closed: for writes only.** Claude Code's Read (and so Glob and Grep)
   needs no permission inside the project, so a hook can't be the gate for reads; it only adds
   refusals there. For Write, Edit, MultiEdit and NotebookEdit it is the gate: the bundle no
   longer allows them by its rules, the hook allows each call it checks, and a hook that crashes
   leaves the call refused.
3. **Open point 1, the cost:** about 200 ms per hook call, of which the trust-root check is about
   30 ms. The full check stays. To get there, `verifyTrustRoot` and `TrustError` moved into
   `src/trust/verify.js` (`snapshot.js` re-exports them), so the hook doesn't load the rest of
   MIRAI.
4. **`.envrc` counts as a `.env*` file** for the hook, as it already did for the sandbox's
   `**/.env*` glob (13b). It often holds secrets.

**Changes from the spec:**
5. **The token's encodings** (`tokenForms`, `redactToken`, `containsToken`) moved from the probe
   harness into `src/sign/token.js`, for the hook.
6. **The lock gains a second kind of rendered block,** `mirai-settings`, listing MIRAI's entries
   in `.claude/settings.json`. Its hash is over those of MIRAI's entries that are present, so
   removing one is noticed and your own changes to the file aren't.
7. **Paths with `"`, `` ` `` or `$`** are refused in sandbox rules too, since the hook's command
   line quotes paths.
8. **Unit 11's test** that said `.claude/settings.json` stays untouched now checks the merge:
   your keys and rules stay, MIRAI's are added.


**Fixed from the review** (both reviewers; details in `review.md`):
9. **The hook only says "allow" for writes.** For a read it lets through, it prints nothing, so
   Claude Code's own checks still apply. An "allow" on a read could have skipped Claude Code's
   check for paths outside the project.
10. **Only plain absolute paths are judged.** A path starting with `~`, with a space at either
    end, relative, with a NUL, or using `..` (also anywhere in a Glob pattern) is refused. The
    hook had joined `~/.zshrc` onto the project and allowed it (both reviewers).
11. **A Write through a symlink that points nowhere is refused** (Tech Lead). The hook had
    treated it as a new file in the project; writing through it creates the target wherever it
    points.
12. **Symlinked secrets:**
    - a `.env*` file (or the token or key) that is a symbolic link refuses the launch, like a hard
      link, since its target is readable under its own name;
    - a write-denied folder that is a link (`.husky -> scripts/hooks`) counts by both names;
    - `core.hooksPath` is resolved too.
13. **No silent skips:**
    - a token file that can't be read makes the hook refuse writes;
    - a launch without a verified trust root is refused;
    - the hook reads the token by its path;
    - the hook runs with an empty environment (`env -i`);
    - a `node` inside a folder agents can write is refused.
14. **One list of protected files** (`protectedFiles`) for the launch checks and the hook.
15. **The settings merge:** a `permissions.deny` that isn't a list is refused rather than
    dropped; a byte-order mark is accepted; the `/.mirai/...` denies have `**/` twins, since the
    `/` form in a project file wasn't probed.
16. **Secret shapes:** PGP private keys and GitLab tokens added. The refusal tells the agent to use
    a placeholder or make test keys when the tests run. Vendor and registry tokens stay in the
    core list, as they apply whatever the stack.
17. **The docs say what isn't covered:**
    - the check-then-use race between the hook and the tool;
    - the hook can't vouch for its own code (the sandbox's write deny on `trust/` is that guard);
    - the content check covers the file tools only;
    - MIRAI protects names and file identity, not content (copies, committed `.env` history);
    - the interactive rules stop Claude's tools, while shell commands still ask you;
    - personal rules go in `.claude/settings.local.json`;
    - the first merge reformats the file.
18. **Nits:** an orphaned comment moved with `verifyTrustRoot`; a "keep in step" note on the
    copied `filesUnder`; `process.exitCode` in `bin/hook.js`; a shadowed test variable; the
    probe guard's mask.

## Noted for later units

- **15:** the plan in the launch's `input/` folder needs a Read allow (or `--add-dir`) for that
  folder only: `--restricted` confines the file tools to the project, and the hook allows nothing
  for reads.
- **17 / packs:** secret files beyond `.env*` (`*.env`, `*.pem`, `auth.json`, `config/master.key`,
  …) as pack data, which then get the launch's second-name checks and the hook's inode check
  through `protectedFiles`; packs may also carry known example values (AWS's documented example
  key) so test fixtures aren't refused.
- **18 (red-team):**
  - every hook probe N≥3 times;
  - `~/` and space-padded paths for every hooked tool;
  - a hook "allow" against a deny rule and against an outside-the-project call;
  - a hook that takes more than 30 s, for reads and writes;
  - the hook's environment;
  - `/.vol/<dev>/<inode>` and firmlink reads in the bundle;
  - Grep over a folder holding a link made mid-run;
  - git objects of a staged or committed `.env`;
  - interactive sessions: Bash reads of `~/.config/mirai`, and the denies under bypass and auto
    modes;
  - the check-then-use race.
- **19:** re-check the policy's hash before the start; the `node` path still existing; the hook's
  cost (about 0.2 s per file tool call) in the turn budget.
- **26 (`pre-push`):** reuse `registry/secrets` and `tokenForms` as the one source; scan what
  shell commands wrote too.
- **29 (`doctor`):**
  - before a night run: the second-name checks, and `.env` files in git history;
  - MIRAI's entries present in `.claude/settings.json`;
  - the hook in the trust root;
  - the `node` path;
  - stale `/private/tmp/mirai-*` folders.
- **Later, with your OK:** also write the two personal denies (`~/.config/mirai/**`, the MIRAI
  home) into your **user** settings when you run `mirai key new` or `mirai token set`, so a
  teammate's branch can't remove them from the project file.
