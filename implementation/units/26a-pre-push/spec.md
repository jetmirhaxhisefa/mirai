---
unit: "26a"
name: pre-push
status: draft (2026-11-09; Jet's six decisions taken in the interview; not approved yet)
roadmap: design/07-implementation-roadmap.md, row 26 (split, Jet's decision 2026-11-09: **26a** the `pre-push` hook and everything that blocks a push; **26b** the diff-coverage warning with trusted `coverage_paths`); D-15 (hooks outside the project, fail-closed scope, the secret scan for everyone; R-C2, R2-C1, R3-C2, AR3-1, TL3-18, TL3-22); D-16 (proofs); D-30 #10 and D-49 (the secret scan, the token's exact value); D-54 (the git-integrity hash); Q3; open question 05 §151 (the token's exact value)
depends_on: ["05", "06", "10", "12", "12b", "13a", "13c", "14b", "22", "25a"]
---

# Unit 26a: the `pre-push` hook

## Why

25a gives every ticket signed proofs that a push or CI can check: "Rex passed this code, and the gate's tests passed on it against the merge-base's baseline". Nothing checks them yet. A MIRAI branch can be pushed without a review, after a code change since its proofs, or with a commit someone added by hand; and nothing stops your Claude login token or a cloud key from leaving the machine in a commit. Q3 asked for a hard gate at push; R3-C2 made it a check of signed records, not a second run of the suites.

Already built and waiting for this unit:

- **Scope** (05b): `pushScope(store, { branch, hasTrailer, hasBranchRecord, miraiCommitter, isAncestor })` → `in-scope` / `blocked` (a lost registry with any MIRAI sign) / `untouched`.
- **Proofs** (25a): `checkProofs(…)` → `pass` / `no-proof` / `stale` / `bad-record` / `nothing-to-prove`, with only the integration branch's public keys and config.
- **Branch records** (22): `verifyBranchAt` (the signed `branch.json` counts only as the first commit after its base).
- **Secrets** (13c, 18b): `registry/secrets/core.toml` (fixed-prefix shapes: private keys, AWS, GitHub, Anthropic, OpenAI, Slack, …) and `tokenForms(token)` (the exact login token, base64, base64url, hex and reversed).
- **The launcher's sealed copy** (12b): runs a copy of MIRAI built from the integration branch's git objects, outside the work tree.
- **Pinned git** (14b): `core.hooksPath=/dev/null` in MIRAI's own git, and the D-54 guard over `.git/config` and `.git/hooks` during a run. The repo check accepts `core.hooksPath` (`src/config/git-repo-keys.js`, overridden by the pins).

## Decisions (Jet, 2026-11-09, in the interview)

1. **Split:** 26a is the hook and everything that blocks a push; 26b is diff coverage (warn only in Milestone A; the trusted `coverage_paths` per level, the record fields, the renames question).
2. **Where it lives, what it runs:** `mirai init` writes a small fixed hook script to `<mirai-home>/<repo-id>/hooks/pre-push` and sets `core.hooksPath` to that folder in `.git/config`. The script runs MIRAI from the **integration branch's trusted copy** (the launcher's sealed copy), never the branch's own `.mirai/framework`. Each push checks the script's bytes and `core.hooksPath` against what that MIRAI expects; a difference blocks the push (`hooks-changed`, run `mirai init --refresh`).
3. **The secret scan runs on every branch and blocks**, human branches too. Human branches get only the scan; MIRAI branches get every check. A false alarm is passed with `git push --no-verify` (D-15: a human's choice, counted by CI later, M9).
4. **No entropy rule in 26a:** the fixed-prefix patterns and the exact token only. The entropy rule moves to unit 54 (CI runs the same scan), to be tuned on real repos.
5. **One shared check:** the hook calls `prePushCheck(…)`; unit 27 calls the same function right before MIRAI's own push. MIRAI's git keeps hooks off (14b: no planted hook ever runs inside MIRAI).
6. **Fail closed when the check can't run** (MIRAI moved, Node missing, the store gone, no trusted copy): every push is refused with the reason and the fix, and the note that `git push --no-verify` pushes anyway.
7. **Existing hooks are forwarded, after asking:** init lists the hooks it finds (`.git/hooks/` with the executable bit, or an existing `core.hooksPath` such as Husky's or lefthook's) and asks. On yes, MIRAI's folder gets a fixed forwarding script for each, which runs the old hook as before; MIRAI's `pre-push` runs your old `pre-push` first, then its own check, and both must pass. The forwards are part of the checked folder. No hooks found → nothing to ask.

Defaults taken with the decisions (not asked; say if you want them otherwise):

- **Scope counts only the branch's own commits** (D-15's update from unit 22): the trailer, MIRAI's committer and a `branch.json` that the branch itself adds, all within `merge-base..<pushed commit>`, the merge-base with the integration branch. A branch built on top of merged MIRAI work isn't MIRAI's because of it.
- **In scope, every check of D-15:** every non-merge commit in that range carries `Mirai-Ticket: <ticket>` for the **same** ticket (a mix, a missing one, or two tickets → `trailer-mix`); any merge commit in it → `merge-commit` (the orchestrator rebases); the ticket's `branch.json` verifies (`verifyBranchAt`); `gate check` passes for the pushed commit (the review and gate proofs for its code hash). `nothing-to-prove` (no code changed) passes.
- **`mirai build` and `mirai run` refuse to start agents while the hook is off** (`hooks-off`: `core.hooksPath` doesn't point at MIRAI's folder, or the script isn't what it should be), because MIRAI's work could then be pushed unchecked; `mirai status` shows the hook's state. The D-54 guard already catches a change to `.git/config` during a run.
- **`handover.json`** (unit 46) doesn't exist yet: a branch that holds one gets `bad-record` from `gate check` until 46 defines it.

## Scope

**In.**

1. **The hook folder** (`src/hooks/install.js`):
   - `<mirai-home>/<repo-id>/hooks/` (the repo home that already holds `store/`; private, yours only, denied to agents by 13b). `pre-push`, mode 0755, its whole text fixed except two absolute paths, quoted for `sh`:
     ```sh
     #!/bin/sh
     # MIRAI pre-push (unit 26a). Written by mirai init; checked at every push. Don't edit it:
     # run `mirai init --refresh` instead. `git push --no-verify` skips it.
     exec '<node>' '<launcher>' hook pre-push "$@"
     ```
     `<node>` is the Node that ran `init`, `<launcher>` is MIRAI's `bin/launch.js` (the full-path decision, PR #2). Either missing at push time → the shell's error, and git refuses the push (decision 6).
   - Forwards (decision 7): `<name>` → `exec '<old hooks dir>/<name>' "$@"` for every hook but `pre-push`; MIRAI's `pre-push` runs the old one first (`hook pre-push` does it, so stdin reaches both). The old folder is recorded in the store (`hooks.json`: `{ forwarded_from, hooks, node, launcher }`), never in the project.
   - `installHooks({ root, env, ask })` writes the folder (atomic, whole) and `git config core.hooksPath <folder>` in `.git/config` (the repo's local config, never global). `hooksState({ root, env })` → `ok` / `off` (unset or elsewhere) / `changed` (a file added, removed or different from what `installHooks` would write; with which).
2. **`mirai init`, `mirai init --refresh`, `mirai init --join`** install the folder (the launcher's own code, as init already is). `--refresh` rewrites it after a MIRAI move or a Node upgrade.
3. **`mirai hook pre-push <remote> <url>`** (`src/cli/commands/hook.js`), reading git's lines on stdin (`<local ref> <local sha> <remote ref> <remote sha>`):
   - the launcher runs it from the **sealed copy of the integration branch's tip** (the local tip when it matches its remote's, else the remote's tip, so pushing a `main` that's ahead works), whatever the work tree holds; no trusted copy → refused (decision 6);
   - runs the forwarded `pre-push` first, if any;
   - then `prePushCheck` and prints one line per ref (`pass`, or `blocked: <code>` with the reason and the command to run), exit 0 only when every ref passed. No colour, no network, no store writes.
4. **`prePushCheck({ root, env, remote, updates })`** (`src/hooks/pre-push.js`), the one check (decision 5). For each update:
   - a delete (local sha all zeros) → `pass`;
   - **the hook's own state** (`hooksState`) not `ok` → `hooks-changed` for every ref (skipped when unit 27 calls it; MIRAI's push doesn't go through the hook);
   - **the new commits**: those of `<local sha>` not reachable from any of `<remote>`'s tracking refs; when the remote has none (the first push to it), those not reachable from the integration branch;
   - **the secret scan** (item 5) over the new commits → `secret` (the file, the commit, the pattern's name; never the value);
   - **scope** (defaults): `merge-base..<local sha>`'s trailers, committer, its own `branch.json`, and the registry through `pushScope` with `isAncestor`; `untouched` → `pass`; `blocked` → `registry` (run `mirai doctor`); `in-scope` → `trailer-mix`, `merge-commit`, `no-branch-record`, then `checkProofs` for that commit with the integration branch's config and keys → `no-proof` / `stale` / `bad-record` (as 25a prints them, with `mirai gate record <ticket>`) or `pass`.
   Returns `{ ok, refs: [{ ref, sha, scope, outcome, why, hint }] }`.
5. **The secret scan** (`src/hooks/secrets.js`): every added line (`+` lines) of each new commit's diff against its first parent (the empty tree for a root commit), pinned git, `--text --no-renames -U0`, every path (`.mirai/records/**` too). Matches: every `[[patterns]]` of the trusted `registry/secrets` (the integration branch's copy), and the exact token in all of `tokenForms`' encodings when one is set (`~/.config/mirai/claude-token`). Commit messages are scanned too. Limits: 64 MB of diff per push; over it → `too-large-to-scan` (blocked; `--no-verify` is the choice). The value found is never printed, logged or stored.
6. **`hooks-off` before agents** (defaults): `mirai build` and `mirai run` check `hooksState` before the first launch; `mirai status` prints `hook: ok | off | changed`.
7. **Docs:** a new `docs/pre-push.md` (what's checked, what the codes mean, the forwards, `--no-verify`, that CI is the second check later); D-15 "Update (unit 26a)" (the folder, the sealed copy, the shared check, the forwards, the entropy rule's move to 54); roadmap row 26 split; design/05 §151 settled; `docs/agent-safety.md`'s "the push check (unit 26) is the backstop" made true; 14a's note on the pinned hooks path and 01's `<trust-root>/hooks` corrected to the shared check.

**Out.**

- **Diff coverage** (warn), `coverage_paths`, the record fields, renames: **26b**.
- **MIRAI's own push** (calling `prePushCheck`): unit 27. **CI** (the same checks server-side, the entropy rule, bypass counting M9): unit 54.
- **`pre-commit`**: unit 44 (PM3-13). **`handover.json`**: unit 46. **`qa` proofs required**: unit 51.
- **`doctor`'s "merge gate: local-only"** line: unit 29.

## Probes (with your OK)

No model run of its own: one manual run on the sample app (yours, about 10 minutes, mostly 25a's `gate record`), in a probe clone with a local bare repo as its remote, so nothing reaches GitHub:

- **P1.** `mirai init --refresh` installs the hook; SAMPLE-1 (reviewed by Rex, `gate record` as in 25a's P1) pushes → `pass`. Then, each from a copy of that state: a commit without the trailer → `trailer-mix`; a code change after the proofs → `stale`; a fake AWS key in a file → `secret`; the token's base64 form (a stand-in token set for the probe's HOME) → `secret`; one byte changed in the hook script → `hooks-changed`; a human branch with a plain commit → `pass`; a human branch with the fake key → `secret`.

## Files

- **New:** `src/hooks/install.js`, `src/hooks/pre-push.js`, `src/hooks/secrets.js`, `src/cli/commands/hook.js`, `docs/pre-push.md`, tests in `test/hooks/`, `test/probes/hook-probes.js`.
- **Changed:** `src/install/init.js` and `join.js` (install the folder), `src/launch/launch.js` (`hook` runs the integration tip's sealed copy), `src/store/branches.js` (only if `pushScope` needs the range's signals passed differently), the command list and its pins, `mirai status`, `mirai build`/`run`'s start (`hooks-off`), docs.

## Tests (`npm test`, no model; real git, a bare repo as the remote, a stand-in token)

- Install: writes the folder and `core.hooksPath`; `--refresh` rewrites it; a repo with `.git/hooks/pre-commit` (executable) or a Husky `core.hooksPath` → asks, forwards on yes, refuses on no; the forward runs the old hook with its arguments and stdin; `hooksState` sees an edited byte, an added file, a removed forward, a changed `core.hooksPath`.
- A real `git push` to the bare repo through the hook: a MIRAI branch with its proofs → pushed; no proofs → `no-proof`; a code change since → `stale`; one commit without the trailer, or a second ticket's trailer → `trailer-mix`; a merge commit → `merge-commit`; a lost registry with a trailer branch → `registry`; a human branch → pushed; a human branch on top of merged MIRAI commits → pushed (scope counts only its own range); a delete → pushed; pushing `main` ahead of its remote → pushed.
- The scan: each core pattern in an added line → `secret`; the token raw, base64, base64url, hex and reversed → `secret`; in a commit message → `secret`; a secret added then removed in the next commit → `secret` (history); a secret only in a removed line → pushed; a binary file holding the token → `secret`; nothing printed contains the value; over 64 MB → `too-large-to-scan`; no token set → the patterns still run.
- Fail closed: the launcher path gone, Node gone, the store gone, no trusted copy → the push is refused and the message names the fix and `--no-verify`.
- The forwarded `pre-push` fails → the push is refused before MIRAI's check runs.
- `mirai build` with `core.hooksPath` unset → `hooks-off`, no agent started.

## Done when

- The tests pass, P1 is recorded in `test-results.md`, and the red team is green after the sample app's refresh. The row's done-when, for 26a: a push without a review or gate proof is refused; a proof for an older hash is refused; a seeded secret or the token value is refused; an edited hook is detected; a known baseline failure doesn't block and a new one does (through 25a's gate proof: a new failure means no gate proof); a registered branch with a trailer-less commit is blocked; a human branch pushes freely (only the secret scan applies).

## Open points for you

All seven decisions are taken (above); the four defaults are named. Waiting for your approval.
