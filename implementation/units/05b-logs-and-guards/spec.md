---
unit: "05b"
name: logs-and-guards
status: approved 2026-10-23 (the 05b parts of the unit 05 spec, plus the 05a review notes)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 05; D-06, D-15, D-17, D-29, D-47, D-57; 03 "Run log"
depends_on: ["04", "05a"]
---

# Unit 05b — Logs and guards

## Why

05a gave MIRAI a private store with a journal. 05b adds what a run needs before anything can be
measured or guarded (D-29):
- **a run log** with the metric fields from day one;
- **the run's state and heartbeat**, so a paused or dead run is visible;
- **the branch registry,** failing closed, so a lost index can't let a MIRAI branch skip its
  checks;
- **one usage budget and one run at a time across all your projects** (D-57);
- **`mirai log`,** which can never write MIRAI's own events.

**Roadmap "done when"** (the parts left for 05b):
- a run line with `tier`/`model`/`limit_share` validates;
- a privileged event via `mirai log` is refused;
- a second run in another repo is refused while one holds the global lock;
- deleting the registry blocks a trailer-branch push with a `doctor` hint.

## Scope

**In:**
- the run log (`store/runs/<run-id>.jsonl`): line schema, event types, writer and reader;
- **taking several numbers in one step** (05a review note);
- **the counter check includes the run logs** (05a review note);
- run state (`state.json`) and heartbeat (`heartbeat.json`);
- the branch registry (`store/branches.json`) and `pushScope`;
- the global folder: the usage ledger and the global run lock;
- `mirai log`, and the run and lock lines in `mirai status`.

**Out** (as in the unit 05 spec):
- **who writes run lines and registers branches:** units 19, 22, 28;
- **the `pre-push` hook** that uses `pushScope`: unit 26;
- **the cap checks before each ticket:** unit 20;
- **signed human events:** unit 06;
- **`doctor` repairs:** unit 29.

## One step, several numbers (05a review note)

05a's `withSeq(store, fn(seq))` takes one number. The store's locks aren't re-entrant, so a run
line and a journal event can't be written in one step today. 05b changes `withSeq`:

```js
withSeq(store, ({ take, event, runLine }) => {
  const seq = take();                       // the next number; call again for more
  runLine(runId, seq, { event: 'run_state', from: 'running', to: 'paused', … });
  event(take(), { type: 'note', by: 'script', message: '…' });
});
```
- Everything inside runs under the journal lock, so file order is still `seq` order in each file.
- `appendEvent` (05a) becomes a thin wrapper around it. Its behavior doesn't change.
- A number taken and not used stays a gap.

## The counter check includes the run logs (05a review note)

Run logs share the store's counter. So on open, the counter must be at least the highest `seq`
in the journal's last line **and** in the newest run log's last line. "Newest" means the run
named in `state.json`, and the run log whose id sorts last. The newest name is checked too, in
case `state.json` is gone. Both reads are tail-only, as in 05a.

## Run state and heartbeat

- **`state.json`:** `{ schema_version, run_id, state, started_at, seq, ticket?, step?, stop_by? }`.
  - `state` is a run-machine state (unit 04).
  - `writeRunState(store, next, { by })` moves through unit 04's `move()`, so an illegal run move
    is refused. A new run starts at `running`.
  - Each write takes a `seq` and writes a `run_state` line with the same number to the run log.
  - `by: "human"` (`stopped → running` is `mirai resume`) is refused until unit 06 signs it.
  - Written atomically.
- **`heartbeat.json`:** `{ schema_version, run_id, pid, ts, ticket?, step? }`.
  - Written atomically by the running orchestrator; it carries no `seq`.
  - **Stale after 5 minutes:** `mirai status` then says the run may have died.
- **Run ids:** `r-YYYYMMDD-HHMMSS-<4 hex>` (UTC), checked before use as a file name.

## The run log (`store/runs/<run-id>.jsonl`)

- **Every line:** `{ schema_version, run_id, seq, ts, item, by, event, ...fields }`.
  - `item` is a ticket, a document or `run`.
  - `by` is always `script`: the orchestrator alone writes run logs.
- **Event types and their fields, from day one** (fixed in code, pinned by a test):

  | Event | Required fields |
  |---|---|
  | `run_started` | `preset`, `plan` (from your global config, D-57; `unknown` when unset) |
  | `run_state` | `from`, `to` (checked by the run machine) |
  | `agent_launched` | `step`, `role`, `tier`, `model`, `tokens_in`, `tokens_out`, `turns`, `minutes`, `limit_share`, `verdict` |
  | `checks` | `tdd`, `tests` (`{ passed, failed, skipped }`), `named` (check names and results) |
  | `finding` | `id`, `severity`, `file`, `symbol?`, `fingerprint`, `text_ref` (`{ ref, sha256 }`) |
  | `template_gap` | `template`, `section`, `message` |
  | `run_finished` | `tickets_done`, `tickets_parked`, `limit_share` |

- **Field rules:**
  - `tier` is `light | standard | deep`.
  - `model` is a non-empty string, not checked against a list (D-58: any model may be on any
    tier; D-58 also says the model used for judgement steps is shown in units 19, 29 and 56).
  - `limit_share` is a number from 0 to 100: percent of the weekly limit.
  - Counts are integers ≥ 0.
  - `verdict` and `severity` come from fixed lists.
  - `text_ref.ref` is a path inside the store, never `..`.
  - Unknown fields are refused.
  - 05a's line and string limits apply: 16 KB per line, 4096 characters per string.
- **Reading** fails closed on a broken middle line and skips a torn last line, as for the journal.
- **Never committed:** the run log lives only in the store (U3, Q9).

## The branch registry (`store/branches.json`, D-15)

- **The local index** of branches MIRAI registered:
  `{ schema_version, entries: [{ branch, creation_sha, ticket, base_sha, seq }] }`, keyed by
  `(branch, creation_sha)`.
- **A missing file means it was lost,** not "never used": `createStore` now writes it empty. No
  real stores exist yet (`mirai init` is unit 10), so nothing needs migrating.
- **`registerBranch` and `clearBranch`** (on merge or delete) write the index atomically and their
  journal event with one `seq`, in one step. `lookupBranch` reads it.
- **`pushScope({ branch, hasTrailer, hasBranchRecord, miraiCommitter })`** returns `in-scope`,
  `untouched` or `blocked`:
  - **in scope** if any commit has the trailer, **or** a `branch.json` record exists, **or** the
    committer is MIRAI's git identity, **or** the branch is in the index;
  - **`blocked`** when the index is missing or unreadable and the branch has the trailer:
    "the MIRAI branch registry is missing or corrupt; run `mirai doctor` to rebuild it from the
    branch records". As an error it's exit 4;
  - **`untouched`** for a human branch: no trailer, no record, not MIRAI's committer, not
    registered.

  The checks inside scope (the trailer on every commit, the proofs) are unit 26's.

## The global folder (`<mirai-home>/global/`, D-57)

- Private like the store (0700 folders, 0600 files, no symbolic links). It's created by the
  first run, or by `createStore`.
- **The usage ledger** (`usage.jsonl`):
  - one line per finished ticket and per run end:
    `{ schema_version, ts, repo_id, run_id, plan, limit_share, kind: "ticket" | "run" }`;
  - written under the ledger lock (`global/locks/ledger.lock`);
  - `usageSince(env, from)` sums `limit_share` across all repos since a time. Unit 20 picks the
    windows and checks the caps.
- **The global run lock** (`run.lock`): `{ pid, host, repo_id, run_id, started_at }`.
  - `acquireRunLock(store, runId)` never waits.
  - While another live run holds it, a run in any repo is refused with exit 4: "a MIRAI run is
    already going in `<repo-id>` (run `<run-id>`, pid `<pid>`); one run at a time across all
    projects (D-57)".
  - A lock whose holder is dead is broken, as in 05a, and a `lock_broken` event goes to *this*
    repo's journal.
  - `releaseRunLock` removes it only while it's ours.

## Commands

**`mirai log <type> --message <text> [--item <id>] [--template <t> --section <s>]`:**
- Appends a journal line with `by: "unverified"`.
- **Only `note` and `template_gap` are allowed** (the allowlist, your decision). A privileged type
  is refused with exit 4: "`mr_merged` is written only by MIRAI itself (D-17)". An unknown type
  is a usage error (exit 2), with the closest type.
- `template_gap` needs `--template` and `--section`. A message over 4096 characters is a usage
  error.

**`mirai status`** gains two lines above the tickets:
```
run: r-20261023-221405-a1f3  running  ticket T-12 (build)  heartbeat 12 s ago
global lock: held by this repo
```
- **No run yet:** `run: none`.
- **A heartbeat older than 5 minutes:** "heartbeat 7 min ago — the run may have died (`mirai
  resume` checks it)".
- **The global lock** reads `free`, `held by this repo`, or `held by <repo-id>` (run, pid).

`--json` carries the same as data.

## Errors

As in 05a:
- **store problems** are a `StoreError`, exit 3;
- **refusals** are exit 4: a held run lock, a privileged `mirai log` type, a blocked push scope,
  an illegal run move.

## Files

```
src/store/journal.js     # withSeq with take/event/runLine; checkCounter reads the run logs too
src/store/run-log.js     # the run log schema, writer, reader (no journal imports)
src/store/run.js         # run ids, state.json, heartbeat.json, recordProgress
src/store/branches.js    # the branch registry and pushScope
src/store/global.js      # the global folder, the usage ledger, the global run lock, beginRun
src/store/home.js        # createStore also writes branches.json
src/cli/commands/log.js
src/cli/commands/status.js   # + the run and lock lines
src/cli/commands/index.js    # + log
test/store/logs.test.js
```

## Tests

| # | Test |
|---|---|
| T11 | Run log: a line with `tier`, `model`, `limit_share` validates and round-trips; a bad tier, a share over 100, a negative count, an unknown field, an unknown event, a `text_ref` with `..`, a 20 KB line are refused; the event list is pinned |
| T12 | Run state: a legal move is saved with a `run_state` line carrying the same `seq`; an illegal move and a `human` move are refused; a heartbeat older than 5 minutes shows as stale in `mirai status` |
| T13 | Registry: register, look up, clear, each with its journal event; **deleting `branches.json` blocks a trailer branch with the `doctor` hint (exit 4)**; a corrupt file blocks too; a human branch is `untouched`; a branch record or MIRAI's committer puts a branch in scope |
| T14 | Global: **a second run in another repo is refused while the lock is held** (exit 4, naming the holder); a dead holder's lock is broken and logged; release only removes our own lock; the ledger sums `limit_share` across two repos since a time |
| T15 | `mirai log`: `note` is written as `unverified`; **`mr_merged` is refused with exit 4**; an unknown type is exit 2 with a suggestion; `template_gap` without `--section` is exit 2; a 5,000-character message is exit 2 |
| T18 | Several numbers in one step: a run line and a journal event from one `withSeq` get consecutive numbers, each file in `seq` order; a number taken and not used is a gap; `appendEvent` behaves as in 05a |
| T19 | Counter check: a counter behind the newest run log's last line is refused, even when the journal is behind both |
| T20 | `mirai status`: `run: none`; a running run with its ticket, step and heartbeat age; the three lock lines; `--json` carries them |

All tests use a temporary `HOME` and temporary git repos, as in 05a. The 05a tests must stay green.

## Decisions (2026-10-23)

1. **A dead holder's global run lock is broken automatically** and logged.
2. **The ledger gets ticket lines and run lines.** Changed after review: every line is a delta
   (decision 6 below).

## Changes after testing and review (2026-10-23)

Recorded here so the text above stays as approved; `test-results.md` and `review.md` give the
evidence. These replace the text above where they differ.

**Your decisions on the review (2026-10-23):**
3. **`checks` logs both** `tdd` (the setting: auto/on/off) and `tdd_applied` (on/off), plus
   `tests_policy` (required/optional, D-23).
4. **The launch line is `agent_run`** (written when the launch ends). It gains:
   - `launch_id`, `round`, and `rung` (1–3, optional, D-14);
   - `cost_usd` (optional);
   - `limit_share_source` (`measured`, `manual` or `unknown`). `limit_share` is left out exactly
     when the source is `unknown` (D-38 allows entering it by hand).
5. **Findings keep D-46's data:**
   - `round` and `category`;
   - optional `line`, `basis_ref` and `downgraded`;
   - a new `finding_outcome` event (`fixed` / `disputed`).
6. **The ledger records deltas with keys.**
   - Ticket lines name their `ticket`.
   - Run lines hold the overhead since the run's last line, written at each ticket boundary and
     at the end, so a run may have several.
   - Every line carries `upto_seq`, the run-log seq it covers. A line at or below what its run
     already covers is skipped, so a resume or `doctor` can't count it twice.
   - `run_finished.limit_share` stays the run's whole share.

**Fixes from the review:**
- **The run log lives in `src/store/run-log.js`.** It imports nothing from the journal, which
  avoids an import cycle. `run.js` keeps run state and the heartbeat.
- **`withSeq` refuses a number** that wasn't taken in that step, was already used, or isn't
  above the last one written to the same file.
- **Lines are checked before a number is taken:** `checkEvent`, and `buildRunLine` in
  `startRun` and `writeRunState`, including the 16 KB line size. `mirai log` turns an oversized
  line into a usage error.
- **Write order:** the run-log line first, then `state.json`. `runStateMatchesLog` detects a
  crash between the two, for `resume` and `doctor`. `startRun` refuses a `stopBy` that isn't a
  UTC time.
- **`recordProgress`** records the ticket and step without a move. Moves keep the ticket and
  step unless `clear: true`.
- **`beginRun`** takes the global run lock, then starts the run with the same id; the lock is
  released if the start fails. The returned `release()` is the spec's `releaseRunLock`. A run
  that can't log breaking a dead lock releases it.
- **`pushScope`:**
  - returns `{ scope, reasons, registered, entries, error? }`;
  - takes an optional `isAncestor(sha)`, so a stale entry can't capture a later human branch
    with the same name;
  - blocks on a lost index whenever the branch shows *any* MIRAI sign (the trailer, a record,
    MIRAI's committer).
- **One plan-name pattern** (at most 32 characters), shared by the global config, the run log
  and the ledger. `usageSince` refuses an invalid date, because a bad window must never read
  as "no usage".
- **`mirai status`:**
  - takes the ticket and step from the heartbeat when it belongs to the run;
  - shows a damaged heartbeat instead of failing;
  - treats a heartbeat dated in the future as stale.
- **A finding's `file`** can't contain `..` or control characters.
