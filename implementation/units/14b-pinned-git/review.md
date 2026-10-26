---
unit: "14b"
date: 2026-10-26
reviewers: Tech Lead, Architect (independent, read-only, no network)
verdicts: approvable after fixes (both); all High and Medium findings fixed and tested, the rest fixed or noted for later units
---

# Unit 14b — Review

Both reviewers worked on a frozen tree, in their own scratch folders under `/private/tmp`, which
they removed afterwards. Neither made a network call, changed either repo or read a secret. Each
ran `test/store/git-pinned.test.js` (12 / 12).

**What held up:**
- one `git()` choke point; nothing from the caller's environment; `--no-replace-objects` on
  every call;
- `config --file` never follows includes;
- never and unknown keys are refused before any git call on the repo, and only key names are
  shown;
- the parser: case rules, dotted subsections, keys with no value;
- no Known key runs code under today's read-only calls. Aliases can't shadow built-ins, and
  `credential.helper=` empties the helper list;
- the opt-in can only be set in your personal file;
- the top folder is found by walking up, and `.git` files are refused;
- nested repos (including ones made with a gitfile) are refused before
  `--ignore-submodules=none` is reached;
- `repo-check` has no git of its own, and there's no import cycle;
- the evidence: 458 filter runs under the old calls, 0 under the new.

**On `/dev/null` and `/var/empty` instead of the spec's pin folder (Architect):** better than
the spec. Nothing is written by read-only commands, and nothing can be planted in the project.
- **macOS:** `/var/empty` is root:sys 755.
- **Linux:** it's missing on some distributions; git then has no home folder to read, which is
  safe.

## Fixed in unit 14b

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **High:** `config.worktree` was checked only for `extensions.worktreeConfig` = true/yes/on/1. A bare key or `= 2` also turns it on in git, and a filter there **ran under MIRAI's git** (reproduced: 4 marker lines) | Tech Lead | Checked whenever the file exists, whatever the switch says | T6 (both forms; the filter never runs) |
| 2 | Refusal messages printed a credential inside a key (`url.https://user:<token>@github.com/.insteadOf`), in the message and the `--unset-all` hint | Tech Lead | A key's URL user info is shown as `<redacted>`; the hint then says to remove the section by hand | T5 |
| 3 | **The hash stopped runs for routine git activity:** `pack-refs`, `git gc` (`info/refs`, loose → packed refs) and new tags | both | Local branches hashed by value (name → commit, loose wins over packed); tags and `info/refs` left out; the docs say a commit or branch switch of yours does count | T10 |
| 4 | Links in place of `.git/info`, `hooks`, `objects` or `refs` passed. Objects linked from another repo were read (reproduced with `lsTree`) | Tech Lead | `lstat` on those folders (and `HEAD`, `packed-refs`, `remotes`, `branches`); a link is refused | T7 |
| 5 | **Guards:** one slot per path string. A second guard replaced the first, and releasing it left the first launch unchecked. Another spelling of the path (`/tmp` vs `/private/tmp`) skipped the check | both | A set of guards per real path (`realpathSync.native`); every git call checks all of them, the guard before the config check | T11 |
| 6 | The docs and research/11 described the launch guard as live. Nothing outside the tests calls `prepareLaunch`/`finishLaunch` yet | both | Docs: "not live yet", it comes with the launcher (units 15 and 19); the release-in-`finally` contract is written in `repo-state.js` | — |
| 7 | `trailer.<x>.command`/`.cmd` (run by `commit --trailer`, which unit 22 uses) and `gpg.ssh.defaultKeyCommand` sat in the opt-in or Known classes | Architect, Tech Lead | Never; `trailer.*` and `gpg.*` too wide to opt in; the docs say the lists are judged against today's commands | T6 |
| 8 | Common inert keys were Unknown | Architect | Known: `core.sparseCheckout(Cone)`, `splitIndex`, `preloadIndex`, `longpaths`, `index.sparse`, `feature.manyFiles`, `remote.pushDefault`, `fetch.writeCommitGraph`, `diff.renames`/`algorithm`, `maintenance.*`, `pack.*`, `gui.*`. Still Unknown: `remote.<x>.push`/`mirror` (until unit 22), `gitflow.*` (it names a hooks folder), `svn-remote.*` | T6 |
| 9 | The excludes file inside the checkout could pass in another case of the path (the Mac's disk ignores case) | Tech Lead | Both paths through `realpathSync.native`, compared ignoring case | T12 |
| 10 | `configValue` read only `.git/config`, so a `core.hooksPath` in `config.worktree` was lost to strict.js's write-deny | Tech Lead | Reads `config.worktree` first when it exists | T12 |
| 11 | `lsFiles` read the index twice | Architect | One `--stage` call gives the tracked names and the gitlink check; `--others` for the new files | T8 |
| 12 | A `.git` that is a link gave "not a checkout" | Architect | Refused with its own message | — |
| 13 | design/07 row 14's host-git bullet was stale | Architect | Updated (done in 14b, `/dev/null`, the allowlist, hashed while guarded) | — |
| 14 | Remotes and branches defined the old way, by file (`.git/remotes/`, `.git/branches/`), were neither checked nor hashed | Tech Lead | Hashed; a link there is refused | T10 |
| 15 | Nits: `mirai-home.js` and `repo-check.js` comments; T12's title | both | Fixed | — |
| 16 | Undocumented deviations: the pin folder, the guard in strict.js, the spec's T3 store case | both | Listed in the spec's "Changes after testing and review" | — |

## Noted for later units (in the spec)

| Unit | Note | From |
|---|---|---|
| 15 / 19 | Call `finishLaunch` in a `finally`, one guard per launch; until then the guard isn't live | both |
| 22 | <ul><li>Pushing: the pins allow only `file` and `https`, with no `sshCommand` or credentials, so ssh remotes need their own transport and credential design;</li><li>`accept()` after commits, checkpoint refs and branch switches;</li><li>pin `gc.auto=0` and `maintenance.auto=false` on MIRAI's writes;</li><li>decide whether `refs/mirai/*` is hashed;</li><li>re-check the key lists for `commit --trailer`;</li><li>`color.<cmd>`: use plumbing or porcelain output;</li><li>`remote.<x>.push`/`mirror`;</li><li>worktrees (refused by `topLevel` today)</li></ul> | both |
| 14c | Copy the tree from `lsFiles` (the nested-repo check comes with it), not `git archive` (export-subst, attributes) | Architect |
| 18 | <ul><li>Record `git --version` against the probed 2.39.5;</li><li>re-run `--mirai` after a git update;</li><li>the excludes lookup ignores your own `GIT_CONFIG_GLOBAL`</li></ul> | Architect |
| Later | <ul><li>LFS: an untracked `.gitattributes` isn't checked, and a new committed one is seen only by the next process (no code runs either way);</li><li>a hash of a tree over 20,000 entries refuses rather than slowing down (refs no longer count toward it)</li></ul> | both |
