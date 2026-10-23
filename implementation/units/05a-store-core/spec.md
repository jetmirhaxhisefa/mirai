---
unit: "05a"
name: store-core
status: approved 2026-10-23 (spec covers 05a and 05b; split decided)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 05; D-06, D-15, D-17, D-29, D-47, D-52, D-57; 03 "Orchestrator store", "Run log"
depends_on: ["01", "03b", "04"]
---

# Unit 05 — The orchestrator store (05a: store core; 05b: logs and guards)

## Why

MIRAI's working state must survive a crash, a usage-limit pause and a new day. It must also stay
**out of agent reach**: an agent that can edit its own round counter or status file can cheat the
loop. So the state lives **outside the project**, in your user's Application Support (D-47).
Logging must exist before anything is measured (D-29).

**Roadmap "done when":**
- concurrent appends lose no lines;
- the store path is outside the work tree;
- a privileged event via `mirai log` is refused;
- a run line with `tier`/`model`/`limit_share` validates;
- a second run in another repo is refused while one holds the global lock;
- deleting the registry blocks a trailer-branch push with a `doctor` hint.

## Scope

**In:**
- **The MIRAI home and the repo id:** finding `<mirai-home>/<repo-id>/` for the current repo.
- **Safe file primitives:** atomic writes, append-only JSON lines, locks, permission checks.
- **The store journal** (`journal.jsonl`) with one **store-wide `seq`** (D-06).
- **Ticket status files** in `store/tickets/<t>/status.json` (the format is unit 04's), written
  with a `seq` from the journal, plus the migration hook.
- **Run state and heartbeat** (`state.json`, `heartbeat.json`): format, read and write.
- **The run log** (`runs/<run-id>.jsonl`): the line schema and the event types, with the metric
  fields from day one.
- **The branch registry** (`branches.json`, the local index, D-15), failing closed.
- **The global folder** (D-57): the usage ledger and the global run lock.
- **Commands:** `mirai status` (moved from unit 04) and `mirai log`.
- **Config wiring:** `store/config.user.toml` joins `loadConfig` as the personal per-repo file.

**Out:**
- **Creating the home on a real project:** `mirai init` (unit 10) calls this unit's `createStore`.
  Until then, the tests and the sample-app checks create it.
- **Denying agents the store:** the sandbox and deny rules (unit 13) and the red-team checks
  (unit 18). This unit makes the store private to your user (0700/0600).
- **Who writes the events:** the commit model, the hooks, ship and run (units 22, 26, 27, 28)
  write pushes, merges and run lines; this unit gives them the writer and the schema.
- **Signed human events** (unit 06): until then, no line may claim `by: "human"`.
- **The cap checks before each ticket** (unit 20): this unit keeps the ledger and sums it.
- **`doctor` repairs** (unit 29): this unit names `doctor` in its hints.
- **Pinned host git** (D-54, unit 22): this unit runs read-only git commands with a fixed
  environment.
- **The checkout lock** between `mirai run` and `mirai session` arrives with sessions (Milestone B).
  In A, the global run lock is the only run lock.

## The MIRAI home

```
~/Library/Application Support/mirai/
  <repo-id>/
    store.json                    # { schema_version, repo_id, roots, remote, checkout, created_at }
    store/                        # 0700, your user only
      seq                         # the store-wide counter
      journal.jsonl  state.json  heartbeat.json  branches.json  config.user.toml
      tickets/<ticket>/status.json
      runs/<run-id>.jsonl
      locks/                      # journal.lock, …
  global/                         # 0700
    usage.jsonl                   # the usage ledger (D-57)
    run.lock                      # one MIRAI run at a time, across all projects
    locks/
```
- **The home** is `<HOME>/Library/Application Support/mirai`. `HOME` comes from `io.env`, as for
  `~/.config/mirai` in 03b, so the tests use a temporary home. There is no `MIRAI_HOME` override:
  an override would be a way to point MIRAI at a store an agent wrote.
- **Outside the work tree, checked:** the store's real path must not be inside the checkout's
  real path. If it is (an odd `HOME`), MIRAI refuses with exit 3.
- **Private, checked on every open:** every folder from `mirai/` down must be a real folder (not
  a symlink), owned by you, with no group or other permissions. Files are created 0600. A wrong
  owner or mode is refused with exit 3 and a `chmod` hint. MIRAI never silently "fixes" a mode.

### The repo id (D-47: from the first commit and the remote)

`<repo-id>` = `<name>-<12 hex>`:
- **`<name>`:** the last part of the remote path, or the folder name with no remote, cut down to
  `[a-z0-9-]` and at most 40 characters. It's for you to read; the hash decides.
- **The hash** is SHA-256 over the **root commits** and the **normalized remote**:
  - **roots:** `git rev-list --max-parents=0 refs/heads/<integration_branch>` (from the project
    config), sorted. The integration branch is used, not `HEAD`, so an orphan branch such as
    `gh-pages` can't change the id. A repo with no commits on that branch is refused ("make the
    first commit first"). A **shallow clone** is refused ("its first commit is unknown: run
    `git fetch --unshallow`"), because its roots would be wrong;
  - **remote:** `origin`, or else the only remote, or else none. It's normalized to
    `host/owner/repo`: `git@github.com:o/r.git`, `ssh://git@github.com/o/r` and
    `https://github.com/o/r` are the same; the host is lowercased; user info and any credentials
    are dropped before hashing (03b's `credentials.js` checks it). Two remotes and no `origin` →
    refused, with a hint to name `origin`.
- **Moving the checkout keeps the id.** `store.json` records the checkout's real path:
  - the same path → fine;
  - a different path, and the recorded one no longer exists → you moved it: MIRAI updates the
    path and writes a `checkout_moved` journal event;
  - a different path, and the recorded one still exists → **a second checkout of the same repo:
    refused** (D-52: one machine, one checkout per repo in the MVP). The hint names both paths.
- **Adding a remote later changes the id.** `mirai status` then finds no store, but sees one
  for the same roots without a remote and says so, with a `doctor` hint (re-keying is unit 29).
- **Git runs read-only:** `execFile` (never a shell), a fixed environment (`PATH`, `HOME`,
  `GIT_CONFIG_NOSYSTEM=1`), `-c core.fsmonitor=false`, a 10 s timeout and an output limit. Only
  `rev-parse`, `rev-list` and `config --get` are used.

## File primitives (`src/store/files.js`)

- **Atomic write:** a temp file in the same folder (`O_EXCL`, 0600), `fsync`, rename, `fsync` of
  the folder. A reader sees the old file or the new one, never half of one.
- **Append one JSON line:** one `write()` on an `O_APPEND` descriptor, under the file's lock.
  - **A torn tail is healed first** (bmad-loop's rule): if the file doesn't end with a newline,
    the append starts with one, so a crash costs one line, never two.
  - **Line limit 16 KB, string fields limit 4 KB.** Bulky text never goes into a line: it's a
    file in the store, referenced by `{ ref, sha256 }` (Q9: structured data apart from bulky text).
- **Reading JSON lines:** a line that can't be parsed fails closed. **Only a torn last line**
  (no newline, the trace of a crash) is skipped; it's reported as a count. An unreadable line
  in the middle is a `StoreError` naming the line number, with a `doctor` hint, because a lost
  `mr_merged` could flip a derived state.
- **Locks** (Node has no `flock`, so the lock is a file created with `O_EXCL`):
  - the lock file holds `{ pid, host, purpose, started_at }`;
  - **short locks** (the journal, the counter, the ledger) wait up to 5 s, then fail;
  - **the run lock** never waits: it's held or it isn't;
  - **a lock whose holder is dead** (`kill(pid, 0)` says no such process) is broken, but only
    under a second `O_EXCL` "breaker" file, after reading the lock again, so two processes can't
    both break it and one delete the other's fresh lock. A breaker left by a crash is refused with
    a `doctor` hint;
  - a reused pid makes a dead holder look alive. That fails safe: the lock is refused, and the
    message names the pid so you can check it.

## The store journal and `seq` (D-06)

- **One counter per store** (`store/seq`), shared by the journal and the run logs, so every
  event in a repo has one order: status writes, pushes, merges, closes, run lines.
- **Taking a number:** under the counter lock, read the counter, add one, write it atomically,
  then write the event. A crash in between leaves a **gap**, never a duplicate. Gaps are allowed;
  numbers only go up.
- **Check on open:** the counter must be at least the highest `seq` in the journal's last line.
  If it's lower (a restored or edited counter), the store is refused with a `doctor` hint.
- **A journal line:** `{ schema_version, seq, ts, type, by, item?, ...fields }`.
  - `by`: `script` (MIRAI itself) or `unverified` (`mirai log`). `human` needs a signature,
    which unit 06 adds; until then a `human` line is refused;
  - `ts` is for you to read; **order comes from `seq` only**.

### Journal event types (fixed in code, pinned by a test)

| Type | Fields | Written by | Privileged |
|---|---|---|---|
| `status_written` | `ticket`, `state`, `park_reason?` | the store (below) | yes |
| `pushed` | `ticket`, `branch`, `sha` | ship (unit 27) | yes |
| `mr_opened` | `ticket`, `head`, `target` | ship (27) | yes |
| `mr_merged` | `ticket`, `target`: `integration` \| `epic` | ship / run (27, 28) | yes |
| `mr_closed` | `ticket` | run (28) | yes |
| `epic_merged` | `epic` | run (28) | yes |
| `branch_registered`, `branch_cleared` | `branch`, `creation_sha`, `ticket` | commit model (22) | yes |
| `checkout_moved` | `from`, `to` | the store | yes |
| `lock_broken` | `lock`, `pid` | the store | yes |
| `note` | `message` | anyone, through `mirai log` | no |
| `template_gap` | `template`, `section`, `message` | anyone, through `mirai log` | no |

Later units add types to this table in code; the test pins the list.

## Ticket status in the store

- `writeTicketStatus(store, status)`: takes a `seq`, writes `tickets/<t>/status.json`
  atomically with that `seq` (unit 04's format), then appends `status_written` with the same
  `seq`. The ticket id is checked by unit 04's pattern before it becomes a folder name.
- `readTicketStatus(store, ticket)` → the parsed status, or null.
- **Migration hook:** a table `STATUS_MIGRATIONS` from each schema version to the next. A
  newer version than MIRAI knows is refused (unit 04 already does). An older one is migrated in
  memory for reading and listed by `mirai status` ("written by an older MIRAI"). It's rewritten
  only by `doctor`, after you see it (D-21). The table is empty, because version 1 is the only
  one.

### Facts from the journal

`ticketFacts(journal, ticket)` builds unit 04's facts from the journal events:
- the latest of `mr_opened` / `mr_merged` / `mr_closed` by `seq` gives `mr`;
- `pushSeq` is the latest `pushed`, `closeSeq` the latest `mr_closed`;
- `mergedInto` comes from `mr_merged.target`, and `epicMerged` from `epic_merged`;
- `proofsValidAtHead` is **false** until proofs exist (unit 25). So `built` can't show yet.
  That's honest: an MR without checked proofs isn't built.

## Run state and heartbeat

- **`state.json`:** `{ schema_version, run_id, state, started_at, seq, ticket?, step?, stop_by? }`.
  `state` is a run-machine state (unit 04); a change goes through `move()`, so an illegal run
  move is refused. Written atomically.
- **`heartbeat.json`:** `{ schema_version, run_id, pid, ts, ticket?, step? }`, written atomically
  by the running orchestrator. **Stale after 5 minutes**: `mirai status` then says the run may
  have died, and `mirai resume` (unit 28) checks it.
- **Run ids:** `r-YYYYMMDD-HHMMSS-<4 hex>`, checked before use as a file name.

## The run log (`store/runs/<run-id>.jsonl`)

- **Every line:** `{ schema_version, run_id, seq, ts, item, by, event, ...fields }` (03
  "Run log"). `seq` is the store-wide number. `item` is a ticket, a document or `run`.
- **Event types and their fields, from day one:**

  | Event | Required fields |
  |---|---|
  | `run_started` | `preset`, `plan` (from your global config, D-57) |
  | `run_state` | `from`, `to` (checked by the run machine) |
  | `agent_launched` | `step`, `role`, `tier`, `model`, `tokens_in`, `tokens_out`, `turns`, `minutes`, `limit_share`, `verdict` |
  | `checks` | `tdd`, `tests` (`{ passed, failed, skipped }`), `named` (check names and results) |
  | `finding` | `id`, `severity`, `file`, `symbol?`, `fingerprint`, `text_ref` (`{ ref, sha256 }`) |
  | `template_gap` | `template`, `section`, `message` |
  | `run_finished` | `tickets_done`, `tickets_parked`, `limit_share` |

- **Field rules:** `tier` is `light | standard | deep`. `model` is a non-empty string (D-58: any
  model may be on any tier, so it isn't checked against a list). `limit_share` is a number from
  0 to 100 (percent of the weekly limit). The counts are integers ≥ 0. Unknown fields are refused.
- **Never committed:** the run log lives only in the store (U3, Q9). Nothing in this unit writes
  into the project.

## The branch registry (`store/branches.json`, D-15)

- **The local index** of branches MIRAI registered: entries keyed by `(branch, creation_sha)`
  with `{ ticket, base_sha, seq }`. `createStore` writes it empty, so **a missing file means it
  was lost**, not "never used".
- `register`, `clear` (on merge or delete), `lookup` write journal events.
- **`pushScope({ branch, hasTrailer, hasBranchRecord, miraiCommitter })`**: the decision the
  `pre-push` hook (unit 26) uses:
  - **in scope** if any commit has the trailer, **or** a `branch.json` record exists, **or** the
    committer is MIRAI's git identity, **or** the branch is in the index;
  - **the index missing or unreadable, and the branch has the trailer** → `blocked`
    ("the MIRAI branch registry is missing or corrupt; run `mirai doctor` to rebuild it from the
    branch records"), exit 4;
  - not in scope (a human branch) → `untouched`.
  The checks inside scope (trailer on every commit, proofs) are unit 26's.

## The global folder (D-57)

- **The usage ledger** (`global/usage.jsonl`): one line per finished ticket and per run end,
  `{ schema_version, ts, repo_id, run_id, plan, limit_share, kind: "ticket" | "run" }`. Written
  under the ledger lock.
- `usageSince(home, from)` sums `limit_share` since a time. Unit 20 picks the windows (night,
  week) and checks the caps before each ticket.
- **The global run lock** (`global/run.lock`): `{ pid, host, repo_id, run_id, started_at }`.
  `acquireRunLock` never waits. While another live run holds it, a run in any repo is refused
  with exit 4: "a MIRAI run is already going in `<repo-id>` (run `<run-id>`, pid `<pid>`); one run
  at a time across all projects (D-57)".

## Commands

**`mirai status [<ticket>] [--json]`:**
```
run: r-20261023-221405-a1f3  running  ticket T-12 (build)  heartbeat 12 s ago
global lock: held by this repo

T-12  in-progress            written   seq 4182
T-13  blocked (cap)          written   seq 4190   "rounds used up"
T-9   done                   derived   merged into the integration branch
```
- Lists the tickets in the store, sorted by id. Each line shows the effective state from unit
  04's `deriveTicketState` with the journal facts, and whether it's derived or written.
- With `<ticket>`: that ticket, plus the journal events about it.
- Text from files (notes, ids) goes through unit 04's `shown()`.
- **No store yet:** "MIRAI isn't set up for this repo" (exit 3), with the `mirai init` hint.
  **Not a git repo:** exit 3.
- `--json` prints the same as data, for scripts and later units.

**`mirai log <type> --message <text> [--item <id>]`:**
- Appends a journal line with `by: "unverified"`.
- **Only `note` and `template_gap` are allowed** (an allowlist, so a new privileged type is
  refused by default). A privileged type is refused with exit 4: "`mr_merged` is written only by
  MIRAI itself (D-17)". An unknown type is a usage error (exit 2), with the closest type.
- `template_gap` also needs `--template` and `--section`.

**`mirai config`** now passes `store/config.user.toml` as the personal per-repo file when the
store exists. No store, or not a git repo → as today.

## Errors

- **`StoreError`** (new; exit 3, `CONFIG`, "the setup or its files are wrong"): a corrupt line,
  a counter behind the journal, a wrong owner or mode, a second checkout, a store inside the work
  tree, a store from a newer MIRAI. It carries `path`, `line`, `code` and a hint (`doctor`
  where it applies).
- **Refusals** (a held run lock, a privileged `mirai log` type, a blocked push scope) are exit 4,
  `BLOCKED`, like unit 04's `StatusError`.

## Files

```
src/store/home.js        # the home path, repo id, store.json, createStore, openStore, checks
src/store/git.js         # the read-only git calls with the fixed environment
src/store/files.js       # atomic write, JSON lines, locks, permission checks
src/store/journal.js     # the counter, journal append/read, event types, ticketFacts
src/store/tickets.js     # status files in the store, migration hook
src/store/run.js         # state.json, heartbeat.json, run ids, the run log schema
src/store/branches.js    # the branch registry and pushScope
src/store/global.js      # the usage ledger and the global run lock
src/cli/commands/status.js
src/cli/commands/log.js
src/cli/commands/config.js   # + the per-repo personal file
src/cli/commands/index.js    # + status, log
src/cli/errors.js            # + StoreError
test/store/*.test.js
```

## Tests

| # | Test |
|---|---|
| T1 | Repo id: the same for a moved checkout and for the three remote spellings; different for another root; an orphan branch doesn't change it; a shallow clone, an empty repo and two remotes without `origin` are refused; credentials in the remote never reach `store.json` |
| T2 | The store's real path is outside the work tree; a `HOME` inside the checkout is refused |
| T3 | Permissions: a symlinked store folder, a group-writable folder and a file with mode 0644 are refused, with a hint; new files are 0600 |
| T4 | Second checkout: refused while the first path exists; a moved checkout updates the path and logs `checkout_moved` |
| T5 | **Concurrent appends:** 8 processes × 200 lines each → 1,600 lines, unique `seq`, increasing in file order, none lost or merged |
| T6 | A torn last line is skipped and counted; the next append starts on a new line; an unreadable middle line is a `StoreError` with its line number |
| T7 | The counter: a gap after a simulated crash is allowed; a counter lower than the journal is refused |
| T8 | Locks: a live holder blocks; a dead holder's lock is broken once, with `lock_broken`; two processes breaking at once leave exactly one holder |
| T9 | Status files: write → read round-trip with the journal `seq`; a bad ticket id never becomes a path; the migration hook runs an injected old version |
| T10 | `ticketFacts` + derive: a `mr_merged` into the integration branch shows `done` over a written `blocked`; a closed MR; a status written after the push |
| T11 | Run log: a line with `tier`, `model`, `limit_share` validates; a bad tier, a share over 100, an unknown field, a 20 KB line are refused |
| T12 | Run state: a legal move is saved; an illegal one is refused; a heartbeat older than 5 minutes shows as stale |
| T13 | Registry: register/clear; **deleting `branches.json` blocks a trailer branch with the `doctor` hint**; a human branch is untouched |
| T14 | Global: **a second run in another repo is refused while the lock is held**; the ledger sums `limit_share` since a time across repos |
| T15 | `mirai log`: `note` is written as `unverified`; **`mr_merged` is refused with exit 4**; an unknown type is exit 2 with a suggestion |
| T16 | `mirai status`: no store → exit 3 with the `init` hint; tickets listed with derived/written; `--json` matches; hostile text in a note is shown safely |
| T17 | `mirai config check` reads `store/config.user.toml` when the store exists; nothing is ever written into the project by this unit (the work tree is unchanged after every test) |

All tests use a temporary `HOME` and temporary git repos; none touch your real home.

## Decisions (2026-10-23)

1. **Split into 05a and 05b.**
   - **05a, store core:** the home and repo id, the file primitives (atomic writes, JSON lines,
     locks, permission checks), the journal and `seq`, status files and the migration hook,
     `ticketFacts`, `mirai status` (tickets only), and the config wiring. Tests T1–T10, T16, T17.
   - **05b, logs and guards:** the run log, run state and heartbeat, the branch registry, the
     global ledger and run lock, `mirai log`, and the run line in `mirai status`. Tests T11–T15.
     Its folder `05b-logs-and-guards/` takes the 05b parts of this spec.
2. **One `seq` for the whole store**, shared by the journal and the run logs.
3. **A second checkout of the same repo is refused** in the MVP.
4. **`mirai log` allows only `note` and `template_gap`** (an allowlist).

## Changes after testing and review (2026-10-23)

Recorded here so the text above stays as approved; `test-results.md` and `review.md` give the
evidence. These replace the text above where they differ.

- **Torn tail:** the next append cuts the fragment off and keeps it in `<file>.torn`, instead of
  starting with a newline (a healed fragment would be a broken middle line, which fails closed).
- **Short-lock wait:** 30 s, not 5 s; **T5** is 8 × 25 lines, not 8 × 200. Each event flushes two
  files, and a flush on macOS takes about 19 ms.
- **Locks** are created with their content in one step (temp file + hard link), aren't
  re-entrant, and a held short lock is exit 4.
- **Finding the store:** if this checkout has a store under another id (same checkout path, or
  shared roots with a checkout that no longer exists), MIRAI refuses with `identity-changed`
  (exit 4, `doctor` hint, never `mirai init`). This replaces the `rekey` hint. The id's readable
  name comes from the remote only (`local` without one).
- **Remotes:** local and relative paths are kept as `local:<path>`; GitHub paths are lowercased,
  ssh port 22 is dropped. Git also runs `config --get-regexp` (for the remotes) with
  `--no-replace-objects`; `rev-list` gets 60 s.
- **Journal:** privileged types must be `by: script`, on write and on read; `mr_merged` names its
  `epic` when the target is an epic; unknown types are `unknown-event`.
- **`ticketFacts`:** a merge always wins (integration over epic, D-06); otherwise the latest of
  opened and closed by `seq`. `pushSeq` is the latest `pushed`, or the opening when no push was
  logged. Facts also carry the shipped `head` for unit 25.
- **Status files:** `writeTicketStatus` takes `expectSeq` (compare-and-swap) and refuses a status
  the journal's facts make unreadable; a key clashing in case with an existing folder is refused.
- **`mirai status`:** an unknown ticket is a usage error (exit 2); a ticket whose facts can't be
  derived is listed with its error and exits 4.
- **`mirai config`:** the per-repo personal file is used only when the repo's identity is known,
  and it gets the store's file checks.
- **Error messages** escape control and invisible characters.
