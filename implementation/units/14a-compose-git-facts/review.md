---
unit: "14a"
date: 2026-10-26
reviewers: Tech Lead, Architect (independent, read-only, no network)
verdicts: approvable after fixes (both); all findings applied, probed, or noted for later units
---

# Unit 14a — Review

Both reviewers worked on a frozen tree, with git in their own scratch folders. Neither ran
Docker, `claude` or the harnesses, and neither read a real secret. Between them they reproduced
five git bypasses against the pin set as written. Two of them could run code: an ssh-signature
verifier on `merge`, and a nested repo's filter.

**What held up:**
- the controls are real, and the control and pinned runs differ only by the pins;
- `GIT_CONFIG_NOSYSTEM` keeps Apple's system `credential.helper=osxkeychain` out, so no probe
  could reach the keychain;
- `classify`, the `hit` functions, the nslookup regex and `section()` are correct;
- cleanup runs in `finally`, with a label sweep;
- no machine paths outside the probe harness, and nothing stack-specific in `git-pins.js`;
- the 14a → 14b → 14c split.

## Applied in unit 14a

| # | Finding | From | Fix | Probe / test |
|---|---|---|---|---|
| 1 | **High:** masks may be bypassed by another case of the name (the Mac disk ignores case) | Architect | Probed (case-variant reads and writes in the mask script). **Confirmed:** file masks leak and a write reached the real `.env`; folder masks held. 14b mounts a per-run copy of the tree instead (open point for you) | g27-mask-volume/-tmpfs FAIL (d6) |
| 2 | **High:** `gpg.ssh.program` ran on a pinned `merge` of an ssh-signed commit (`merge.verifySignatures`), and on `log` (`log.showSignature`) | Tech Lead | Pins for every signing program, and signature checks off; `log` added to MIRAI's steps | g23-gpg-ssh-verify pass; T4 |
| 3 | **High:** a URL-scoped `http.<url>.proxy` beats the `http.proxy` pin | both | Moved to "not pinnable"; 14b allowlists the repo's config keys | g23-http-proxy-url |
| 4 | **High:** a nested repo's filter runs through the outer, pinned git | Architect | Submodule pins added: they stop `status` and `diff`, but `add -A` still runs it. So 14b refuses any `.git` below the top folder | g23-nested-repo |
| 5 | `GIT_DIR` still follows a `.git` file and `.git/commondir`; the comment said otherwise | both | Comment corrected; both probed; 14b checks the repo's shape | g23-gitfile, g23-commondir |
| 6 | A repo can hide new files from `status` and reshape the diff MIRAI reads | Tech Lead | Pins: every untracked file shown, no colour, standard prefixes, `--no-color` in the diff flags | g23-hide-untracked, g23-diff-shape; T4 |
| 7 | A read-write source mount lets a test write anything in the work tree | Architect | The copied tree (1) closes it; said in research/11 and the docs | — |
| 8 | No control showed the override ever loading, so the `g12-override` pass couldn't fail | Tech Lead | Control with `--env-file` and no `-f`: the override loads | g12-override-shown |
| 9 | Checks that pass when nothing ran (the masks, DNS) | Tech Lead | A pass needs the run's end marker; `dscacheutil` re-run, with a host control | T3; n2 |
| 10 | The network control never showed the outside-IP check could see a leak; no LAN-address probe | Tech Lead | A TCP connect to `1.1.1.1:443`, which the control reaches; the missing default route is the evidence for the rest (said) | g19-internal, g19-control |
| 11 | The guard covered less than T3 claimed (`~` paths, object includes, `extends.file`, device objects, cli arguments) | Tech Lead | Guard widened; T3 covers each | T3 |
| 12 | The ssh probe's safety rested on the pin under test (a real ssh would read your `~/.ssh/config`) | Tech Lead | The probe pushes to `ssh://127.0.0.1:1/` | T3 |
| 13 | `receivepack` was listed as neutralised by a pin; the explicit URL stops it | Tech Lead | Reworded | — |
| 14 | The P5 SIGTERM result is ambiguous (`sleep` as PID 1 ignores SIGTERM) | Tech Lead | Said in research/11; the conclusion holds | — |
| 15 | `uploadpack` was in the spec but not probed | Architect | Recorded as unit 22's (MIRAI doesn't fetch before it) | — |
| 16 | The docs overstated the masks and the includes handling | Architect | Rewritten: tests get a copy; unknown repo config is refused | — |
| 17 | Nits: a retargeted symlink hashed as a constant; `diff.external=''` makes plain diffs fail (comment); `PIN_DIRS.global` names a file; `git.js` said pinned git comes with unit 22 | both | Fixed | — |

## Noted for later units (in the spec)

| Unit | Note | From |
|---|---|---|
| 14b | **The copied tree**:<ul><li>per run, MIRAI's own copy of the files git lists, without `.git` or real `.env*`;</li><li>the dummy env file added;</li><li>test output in a separate folder, read without following links</li></ul> | both |
| 14b | **The repo config allowlist** (with `--file`, no includes); **the shape check** (a real `.git` folder, no `commondir`, alternates or nested `.git`); `top` from MIRAI's record; the hash's full scope | both |
| 14b | What the pins change for today's callers: your global excludes (record the path), `user.*` for commits, Git LFS (refuse or opt in) | both |
| 14b | Raw compose files: decide JSON-only or a strict YAML subset for the prescan | Architect |
| 14b | Still to probe:<ul><li>`run` on the frozen file;</li><li>`up --wait` with healthchecks;</li><li>digest image references with `--pull never`;</li><li>resource keys, `use_api_socket`, `label_file`;</li><li>`--env-file` on the frozen `up`;</li><li>14b's exact git command lines</li></ul> | both |
| 14b | A stack-neutral allowlist (extra keys such as `shm_size` per project, opted in); MIRAI's own resource limits; a clear error when Docker Desktop isn't running | Architect |
| 22 | Pushing with the pins:<ul><li>per-operation transport (ssh or https with a MIRAI-owned credential);</li><li>`ls-remote --get-url` checked against the URL;</li><li>the pinned hooks path skipping D-54's pre-push;</li><li>unsigned commits;</li><li>worktrees in the hash;</li><li>rebase and fetch probes (`uploadpack`)</li></ul> | both |
| 18 | Re-run H1/H2/gitfile and the case-variant probes after git or Docker updates; Apple git updates arrive silently | both |
