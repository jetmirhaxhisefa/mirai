---
unit: "26a"
date: 2026-11-09
claude_code: 2.1.319
result: 556/556 in the full suite · P1 passed on its second run (the first run's edited-hook step was a probe mistake, fixed in 77e9c7f): every push refused or passed as the spec says, 2–4 s each
---

# Unit 26a — Test results

## Tests (`npm test`, no model; real `git push`es to a bare repo by path)

New, in `test/hooks/pre-push.test.js` (7):

- **The pieces:** git's stdin line parsed (a new branch), a malformed one refused; the trailer read from the last paragraph only; the scan's log parser with its random marker (a `+++` line inside a hunk is content, a deleted file adds nothing).
- **A MIRAI branch:** with its proofs, `pass`; after a code change, `stale`; a commit without the trailer, `trailer-mix`; a merge commit, `merge-commit`; a delete passes; pushing `main` gets the scan only.
- **No proofs, `no-proof`; the branch registry gone, `registry` (a human branch still passes); a human branch passes,** and so does one built on top of merged MIRAI work (only the branch's own commits count).
- **The secret scan, on every branch:** a cloud key (the value never printed); the token as is, base64, base64url, hex and reversed (the other forms are `containsToken`'s own tests); in a commit message; in a binary file; added in one commit and removed in the next (still refused); a line that only removes a secret passes.
- **The hook itself:** a line added to it → `hooks-changed`, an extra file in the folder too; `core.hooksPath` unset → `off`, and `requireHooks` refuses with `hooks-off`; a launcher that's gone → the push is refused; the store gone → refused, and the message names `git push --no-verify`.
- **Existing hooks:** with no terminal, not installed and said so; a no, not installed; a yes, forwarded (pre-commit runs; the repo's own pre-push gets git's stdin first, and its failure refuses the push); a refresh with the same hooks doesn't ask again.
- **The range:** the commits a push adds are the ones the remote's tracking refs don't reach.

Changed: `test/cli/cli.test.js` (the command list has `hook`); `test/proofs/gate.test.js` (its helpers moved to `test/proofs/fixture.js`).

## The full suite

**556/556 pass**, in 23 min 23 s (under `caffeinate -i`). Unit 13's T5/T6 scratch-folder race (25a's one failure) didn't fire this time; it's still there, for later.

## Probes

`test/probes/hook-probes.js`, **P1** (Sonnet, 1 run), in a clone of the sample app with a probe home; pushes go to a bare repo in the probe folder (nothing reaches GitHub). The log is `~/mirai-26a-p1.log`.

1. **Baseline** 401 s; the seeded build (the walkthrough code without the bug) handed over.
2. **Rex** (claude-sonnet-5-5, 6 turns, 0.4 min): `pass`, one nit (no 401 test). The canary never reached him.
3. **`gate record`:** `recorded` in 166 s, code `96c717e75bdf`, 4 files. Then the real token was swapped out of the probe home for a stand-in.
4. **Hooks installed** by `init`'s `setUpHooks`, in the probe home's `local-…/hooks`.

| Push | Result | Time |
| --- | --- | --- |
| the MIRAI branch with its proofs | **pushed**: `pass`, the proofs match `96c717e75bdf` | 3.9 s |
| + a commit without the trailer | refused, `trailer-mix` | 2.5 s |
| + a code change after the proofs | refused, `stale` (code `0087351c0dff`) | 2.6 s |
| + a fake AWS key | refused, `secret` (`aws-access-key`, file and commit named, value not printed) | 2.2 s |
| + the stand-in token, base64 | refused, `secret` (`claude-login-token`) | 2.2 s |
| one byte added to the hook script | refused, `hooks-changed`: "pre-push was changed" | 2.0 s |
| a human branch, a plain commit | **pushed**: "only the secret scan applies" | 2.3 s |
| + a fake AWS key | refused, `secret` | 2.6 s |

The first run (same day) had all of these right but the edited-hook step: it pushed a tip the remote already had, and git runs no pre-push hook when a push is "Everything up-to-date". The probe now pushes that step to a new branch name (77e9c7f); the code didn't change.

## Not proven

- The new git calls (`rangeCommits`, `hasTrackingRefs`, `pushLog`, `setHooksPath`) across git versions: one git here (2.39.5, Apple); `git-probes.js --mirai` has no case for them yet (unit 54, against CI's).
- A deleted MIRAI home: git then runs no hook (the known limit in the spec); `status` shows `hook: off` and `build` refuses, CI (unit 54) is the second check.
