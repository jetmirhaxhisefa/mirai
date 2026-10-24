---
unit: "10"
name: installer
date: 2026-10-24
node: v22.23.2
result: 158 / 158 pass (earlier units' 148 + unit 10's 10), after the review fixes; 3 full runs in a row green
---

# Unit 10 — Test results

## Run

`npm test` (scoped to `test/**/*.test.js`), after the review fixes (`review.md`). The new file
`test/install/init.test.js`:

```
T1: a fresh install writes the framework copy, its git rules, config, context, AGENTS.md, the lock and the store; the copy runs
T2: the lock lists every file with its mark; checkLock reports what changed
T3: AGENTS.md's MIRAI block is rendered, first; the rest of the file stays yours, byte for byte
T3b: the block's size: at most 8 KiB; a warning when AGENTS.md is over 32 KiB
T4: nothing is written under .git/
T5: refusals, each with nothing written in the repo or the MIRAI home
T6: the integration branch: --branch, the config's, the remote's default; never just the current one
T7: a failure partway undoes everything; an existing store is reused, but not for another branch
T7b: mirai init through the CLI
T9: mirai render renders the block again from the installed copy and your files, and updates the lock
# tests 158
# pass 158
# fail 0
```

Three full runs in a row: 158/158 each. Every test uses temporary repos and a temporary HOME,
which are removed afterwards.

**Earlier tests changed:**
- `test/cli/cli.test.js` T14: the pinned command list gains `init` and `render`.
- 05a's `createStore` now removes a store it only half made; its tests still pass.

## The roadmap's "done when", mapped

| Done when | Test |
|---|---|
| A fresh install on the sample app | T1 (a temporary repo), T8 (the sample app copy, below) |
| The lock lists every file with its mark | T2: every framework file with its hash; `AGENTS.md` `rendered` with its block hash and inputs; config and context `project`; `framework_sha256`; `checkLock` reports changed, missing and added files |
| `AGENTS.md`'s MIRAI block is `rendered` | T2, T3, T9 |
| Nothing MIRAI controls is written under `.git/` | T4: every file and folder under `.git/`, with size, time and mode, is unchanged |

## What the tests cover from the review

| Fix | Test |
|---|---|
| A branch with `"` and `#` is written as escaped TOML, and reads back the same in config and store | T6 |
| No current-branch fallback; `origin/HEAD`, or the only remote's HEAD; an existing config's branch | T6 |
| A genuine failure partway (a `.gitignore` rule hiding `.mirai/`): everything undone, `AGENTS.md` bytes (CRLF) and mode restored, HOME empty | T7 |
| MIRAI's git rules beat a rule such as `*.lock` | T7 |
| An existing store reused; one set up for another branch refused, with nothing left behind | T7 |
| Refusals leave the repo snapshot and HOME unchanged: not a repo, no commit, shallow, symlinked `.mirai`, symlinked `AGENTS.md` (the `CLAUDE.md` hint), read-only `AGENTS.md`, not UTF-8, a foreign `.mirai/.gitignore`, a framework without a lock, an unknown or invalid branch | T5 |
| The block first; your fenced marker example ignored; CRLF and BOM kept; indented markers ignored; the title is only the first line; comments in fences kept | T3 |
| `$&` in the docs root shown as is; a backtick refused | T3 |
| An 8 KiB cap on the block; a 32 KiB warning | T3b |
| `checkLock` refuses a symlinked folder; `framework_sha256` checked; `lock-newer` | T2 |
| `mirai render`: applies your config and instructions, updates the lock and `from`, re-renders a hand-edited block, refuses a changed template, and works through the CLI | T9 |
| The copy runs `version`, `lint` and `status` on its own | T1 |

**Not covered by a test:** an undo step that itself fails. There's no way to make one fail
partway without a fault hook in the code, and I didn't add one. The code is short: each step is
wrapped, and the first error is kept.

## T8: the sample app (a copy, not part of `npm test`)

`~/Projects/mirai-sample-app` was copied to the scratchpad, with a temporary HOME. The original
was not touched.

```
$ mirai init
mirai: the integration branch can't be found (no --branch, and no remote default branch)
name it: mirai init --branch main
exit 4
```
The copy has `origin` but no `origin/HEAD`, so `init` refuses as decided. With `--branch`:

```
$ mirai init --branch main
MIRAI 0.1.0 is installed in …/t8b/sample
  integration branch: main (from --branch)
  wrote: .mirai/framework, .mirai/.gitignore, .mirai/.gitattributes, .mirai/config.toml, .mirai/context/agents-local.md, AGENTS.md, .mirai/mirai.lock (96 files in the lock)
  store: …/t8b/home/Library/Application Support/mirai/mirai-sample-app-2baa88034aec

Next:
  1. Review these files and commit them on main (MIRAI never commits).
  2. mirai key new   (once per machine; commit the public key it writes)
  3. mirai lint
exit 0
```

From the installed copy (`node .mirai/framework/bin/mirai.js …`):

| Command | Result |
|---|---|
| `lint` | exit 0 |
| `status` | exit 0 |
| `config check` | exit 0, "config OK (project)" |
| `render` | exit 0, "AGENTS.md: unchanged" |

- **`git status --porcelain`:** only `?? .mirai/` and `?? AGENTS.md`.
- **The framework copy:** 712K.
- **`AGENTS.md`:** starts with the block.
