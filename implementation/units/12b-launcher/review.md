---
unit: "12b"
date: 2026-10-25
reviewers: Tech Lead, Architect (independent, read-only, no network)
verdicts: CHANGES REQUESTED (1 blocking), CHANGES REQUESTED (1 blocking); all findings applied, decided by you, or noted for later units
---

# Unit 12b — Review

**A note on the process.** I applied the Architect's plain fixes while the Tech Lead was still
reviewing, so its files changed under it partway through. It re-ran its attacks on the newer
files, and its findings are against those. From now on I don't touch the repo while reviewers
run (memory updated).

**What held up:**
- the (A)/(B) trust rule fits D-15 and the trust root;
- `bin/mirai.js` never hands over to another copy;
- the `bin` change is right for `npx` and global installs;
- a lock-only edit on a branch runs `main`'s copy;
- an added file or a FIFO is refused;
- a real terminal passes through for `key revoke`;
- the code imports only `node:` modules, with no dynamic imports.

## Applied in unit 12b

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **Blocking:** checked in the work tree, then run from it. Swapped code ran in 8–9 of 40 tries | both | **Your decision:** a sealed copy from git objects in the store, run from there; (B) runs the launcher's own code. Re-run: 0 of 40 | T9, race re-run |
| 2 | **Blocking:** a symbolic link in the copy was trusted. A linked `bin/mirai.js` next to planted code ran it; a linked `.mirai` was accepted | both | Links and non-regular files are never trusted | T2b, T11 |
| 3 | Signing commands could run an uncommitted refresh | Architect | **Your decision:** they need (A) | T10 |
| 4 | No store-only path; the hint `init --refresh` changed the repo, or dead-ended on a downgrade | both | **Your decision:** `mirai init --join`, with a yes in a real terminal | T12 |
| 5 | (A) refused ordinary states (a branch cut before a refresh, local `main` behind) | Architect | **Your decision:** also origin's tip and the merge-base, looked at lazily | T10 |
| 6 | The alias would trust the dev folder's uncommitted edits | Architect | **Your decision:** a clean release folder; steps in the README | — |
| 7 | The cache held a path, so it could point at a forged record anywhere | Architect | Repo ids only, checked against the store's record | T6b |
| 8 | The launcher used `openStore` (which writes), a strict lock reader and the launcher's own version rules | both | Read-only, tolerant reads; its own "update the launcher" refusal | T2b |
| 9 | Signals: Ctrl-C returned the prompt early; SIGTERM didn't reach the child | Architect | Wait, forward, re-raise | T11 |
| 10 | One merged hint; unquoted arguments in it | Architect | Two hints by branch; shell quoting | T2, T2c |
| 11 | Tests passing by accident (T6b and T2b used paths, not ids; separate HOMEs) | Tech Lead | Rewritten with one HOME and real ids | T6b |
| 12 | Untested: a symlinked `.mirai`, a linked `bin` with neighbours, an added file, a lock-only edit, the origin fallback, signals, one argument with spaces | Tech Lead | Added | T9–T11 |
| 13 | Nits: `fileURLToPath`; `--version`/`--help`/`help` when the copy may not run; a dangling-link lock; `blobAt` throwing on large blobs; the remote picked as the repo id picks it; the SIGINT handler before spawn; the rule comment; doc drift | both | All fixed | T2b, T4 |
| 14 | Found while testing: unit 12's snapshot lock could be taken over in the instant between its creation and the owner's pid being written. Under full-suite load, two builders raced (one in seven full runs failed) | me | A lock without a pid yet counts as held, for 10 s | snapshot T6b, repeated runs |

## Noted for later units (in the spec)

| Unit | Note | From |
|---|---|---|
| 13 | Deny agents the MIRAI home (`launcher.json`, `store/runtime/`); `Bash(mirai *)` doesn't catch `node …/launch.js` | both |
| 15, 19, 26, 54 | Hooks, CI, the broker and broker-started agent runs call the trust root's copy directly, never the launcher | Architect |
| 29 | Launcher version against the pin; cache permissions; pruning the cache and old runtimes | Architect |
| 54, D-56, 70 | An update-MR path in `mirai-verify`; the docs MR refuses framework changes; `update` leaves the copy byte-equal | Architect |
