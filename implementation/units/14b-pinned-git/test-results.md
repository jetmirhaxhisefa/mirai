---
unit: "14b"
name: pinned-git
date: 2026-10-26
node: v22.23.2
git: 2.39.5 (Apple Git-154), /usr/bin/git
macos: 26.7
result: 242 tests (earlier units' 228 + unit 14b's 14), 242 / 242 before the review; after the review fixes 241 / 242, the one failure a Markdown-scanner timing test under machine load (load average 57–140), which passes alone and doesn't touch git; 38 git probes through MIRAI's own calls (19 refused before git ran, 19 ran with nothing fired, 0 FAIL; run again after the review fixes, the same); 14a's 38 pinned probes re-run with the new pin paths (same results as 14a); sample-app smoke runs unchanged in time; a planted filter on a clone of the sample app ran 458 times under the old calls, 0 under the new
---

# Unit 14b — Test results

## `npm test`

New in `test/store/git-pinned.test.js`:

```
14b T1: every git.js call is pinned: binary, -c pins, the repo named, MIRAI's empty config and HOME, nothing from the caller; diffs carry the flags
14b T2: the pins need no folder: /dev/null and /var/empty; MIRAI refuses to run another git, and says where it looks
14b T3: the top folder is found by walking up, never by git; a .git file is refused; core.worktree moves nothing
14b T4: known keys pass: the sample app's set, husky's hooksPath, gh and VS Code entries, the pinned ones
14b T5: never keys are refused before git runs on the repo, naming the file and the key (not its value)
14b T6: unknown keys are refused unless you allow them; a never key can't be allowed; config.worktree is checked too
14b T7: the shape: commondir, alternates, http-alternates, grafts, a linked config or info/hooks entry are each refused
14b T8: nested repos: a gitlink and an untracked nested repo are refused by lsFiles and changedNames; an ignored one is not
14b T9: Git LFS is refused, whichever way it shows
14b T10: the integrity hash covers what can run code or redirect git, and the local refs; not fetches, the index or objects
14b T11: while a guard is active, every git call checks it first
14b T12: today's behaviour is kept: your global excludes still apply (unless inside the checkout); strict.js sees the repo's hooksPath
```

Elsewhere:
- `test/launch/strict.test.js`: **14b T11** (the launch half). A hook planted during a launch is
  caught by `finishLaunch`, which removes the launch folders either way.
- `test/probes/harness.test.js`: **14b T13**. The `--mirai` harness runs every `git.js` export,
  and reports a refusal, a clean run and a planted marker (as FAIL); no full path appears in the
  report.

Existing tests changed by this unit, each for a reason of the unit:
- **config T6:** `[git]` keys are now listed one by one per layer, so the message names
  `git.integration_branch`. Also new: `[git] allow_repo_config` is refused in the project file,
  and a never entry or a too-wide section is refused in the personal file.
- **protected T4:** the filter in `.git/config` used to be shown to have no effect. It's now
  refused before git runs, and the test checks the refusal. The pinned `diff.external` still runs
  nothing.
- **trust T11:** `mirai trust snapshot` prints two new lines: which git, and which excludes file.
- **14a T4:** the pin set's hooks path, global config and `HOME` are now fixed system paths (see
  Changes, 1).

```
# tests 242
# pass 242
# fail 0
```

**The first full run had 12 failures:**
- **2 were real findings**, now fixed (see Changes, 1):
  - **the pin folder** was created in the MIRAI home by read-only commands (`lint` "wrote
    something"; init's refusals left a `Library/` behind);
  - **with `HOME` inside the checkout**, it was created inside the project.
- **7** were tests using `HOME=/nonexistent`, which couldn't hold a pin folder. They pass
  unchanged once no folder is needed.
- **3** were the expected changes above.

**Later runs** (see also "After the review" below):
- **The second full run:** one timing test in lint (`T12 … linear time`, 1073 ms against its
  limit) failed under the suite's load. It passed alone, and in the final full run.
- **The final full run:** 242 / 242.

## After the review

The fixes (spec, "Changes after testing and review") came with new cases inside the existing
tests:
- **T5:** a token inside a `url.<base>.insteadOf` key is shown as `<redacted>`, in the message
  and in the hint.
- **T6:**
  - `config.worktree` is refused whenever it holds a never key;
  - a filter there, enabled by a bare `worktreeConfig` or by `= 2`, **never runs** (the
    review's reproduction, as a test);
  - inert keys are Known (`core.sparseCheckout`, `index.sparse`, `remote.pushDefault`,
    `maintenance.*`, `diff.algorithm`, `gui.*`);
  - trailer commands and `gpg.ssh.defaultKeyCommand` are Never, and `trailer.*` can't be
    opted in.
- **T7:** `.git/info`, `hooks`, `objects` and `refs` each refused as links.
- **T10:**
  - `pack-refs --all`, a new tag, `git gc` and a loose ref equal to its packed line leave the
    hash unchanged; moving a branch changes it;
  - remotes defined by file are hashed.
- **T11:** two guards on one repo (releasing one leaves the other checking), and the same
  checkout under another spelling of its path (`/var/…` and `/private/var/…`).
- **T12:**
  - an excludes file inside the checkout, written in another case, is still not used;
  - `configValue` reads `config.worktree` first.

**The runs:**
- `node --test test/store/git-pinned.test.js`: 12 / 12.
- **Full suite:**
  - **3 runs after the fixes:** 241, 240 and 241 of 242 pass. The failures were the Markdown
    scanner's linear-time test (1180, 2147 and 1811 ms against 1000) and once the hook's
    end-to-end time (2031 ms).
  - **The cause is load:** the machine's load average was 57–140 during these runs, from
    other processes. The hook doesn't import git, and the scanner test is pure CPU. Both files
    pass alone (21 / 21).
- **`--mirai` probes on the fixed code:** 38 / 38 pass (19 refused, 19 ran with nothing fired),
  the same split as before. The first summary of this file said 16 and 22, a miscount; the
  table below always listed 19 refusals.

## The probe runs

| Run | What | Result |
|---|---|---|
| p1 | 14a's 38 git probes, pinned mode, with the new pin paths (`/dev/null` hooks path and global config, `/var/empty` HOME) | the same as 14a: 18 pass, 20 facts (14 not pinnable, 2 inert, 4 neutralised without an `expect`) |
| p2 | the same 38 probes with `--mirai`: every export of `git.js` on each hostile repo | **38 pass, 0 FAIL**. No step failed except by refusal |

**p2 in detail:**

| MIRAI | Probes |
|---|---|
| **Refused before git ran on the repo** (19) | `repo-config`: <ul><li>`g23-filter`, `-filter-process`, `-filter-info`;</li><li>`g23-textconv`, `-diff-command`, `-merge-driver`;</li><li>`g23-include`, `-includeif`;</li><li>`g23-ext`;</li><li>`g23-receivepack`, `-receivepack-origin`;</li><li>`g23-insteadof`, `-http-proxy-url`;</li><li>`g23-worktree`;</li><li>`g23-editor` (`sequence.editor` is an Unknown key)</li></ul>`repo-shape`: `g23-commondir`, `g23-alternates`. `git-file`: `g23-gitfile` (at `topLevel`). `repo-nested`: `g23-nested-repo` (at `lsFiles`) |
| **Ran, and nothing fired** (19) | <ul><li>hooks, `hooksPath`, `fsmonitor` (also from `config.worktree`);</li><li>`diff.external`, the pager;</li><li>`sshCommand`, `credential.helper` (plain and URL-scoped), `askPass`, `gpg.program`, the ssh verifier, the plain `http.proxy`;</li><li>`status.showUntrackedFiles`, the diff shape;</li><li>`info/exclude`, `core.excludesFile`, the system and global canaries</li></ul> |

Every control fired except `g23-pager` and `g23-editor`, which 14a found inert under these
commands.

**What p2 shows, and what it doesn't:**
- **MIRAI's calls today are read-only.** They never push, commit, merge or log, so for the
  transport, signing and verify keys, "nothing fired" mainly shows that MIRAI's calls don't reach
  them. 14a's pinned probes (p1) are the evidence that the pins hold when those commands run;
  units 22 and 18 probe MIRAI's own commit and push calls.
- **`g23-info-exclude` ran:** `.git/info/exclude` is allowed by design. An exclude only hides a
  file, which is then never committed or tested (spec, item 4).

## Smoke run on the sample app (read only)

Run from `~/Projects/mirai-sample-app` with `node ~/Projects/mirai/bin/mirai.js`. **Old** is the
committed `fcfe292`, exported with `git archive` to a scratch folder; **new** is this unit. Each
time is the best of 5 runs:

| Command | Exit (old / new) | Old | New |
|---|---|---|---|
| `mirai status` | 0 / 0 | 725 ms | 704 ms |
| `mirai lint` | 0 / 0 (0 files, 0 problems, 4 skipped) | 562 ms | 630 ms |
| `mirai trust check` | 0 / 0 | 723 ms | 868 ms |
| `mirai protected` | 0 / 0 | 2135 ms | 1984 ms |

The differences are within run-to-run noise; `trust check` now also shows the git lines. New
output:

```
trust root for main at 3afc9b1b692d: unchanged (133 files)
  git: /usr/bin/git, pinned; repo config checked
  your global excludes: ~/.config/git/ignore
```

The sample app's own key set (core basics, `remote.origin.*`, `branch.main.*`) is all Known;
`git status` in the sample app was empty afterwards.

## A hostile clone of the sample app

**The setup:**
1. `git clone --no-hardlinks` of the sample app into `~/.mirai-probes-14b-clone/app`. A clone
   carries committed files only: no `.env`.
2. `filter.evil.clean` set to a script that appends a line to a marker file and passes the
   content through.
3. `* filter=evil` in `.git/info/attributes`, and `README.md` touched.

**The commands:**
- `mirai status`, `lint` and `protected` (new): exit 4, with
  `MIRAI won't run git on this repo: .git/config sets filter.evil.clean, which runs a program on
  your files (a filter)` and the remove hint. **No marker written.**
- **The control:** the old commands stop at "MIRAI isn't set up for this repo" (the clone has no
  store), so I called `changedNames(<clone>, 'HEAD', null, env)` directly from the old and the
  new `src/store/git.js`:

  | `git.js` | Result | Filter runs |
  |---|---|---|
  | old (`fcfe292`) | `[]` | **458** (every file: a fresh clone's index has to be refreshed) |
  | new | refused, `repo-config` | **0** |

**Cleaned up afterwards:**
- the clone;
- both probe folders (`~/.mirai-probes-14b-pins`, `~/.mirai-probes-14b-mirai`);
- the scratch export.
