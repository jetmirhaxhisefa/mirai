---
unit: "05a"
name: store-core
date: 2026-10-23
node: v22.23.2
git: 2.39.5 (Apple Git-154)
result: 80 / 80 pass (earlier units' 67 + unit 05a's 13), after the review fixes; 3 full runs in a row green
---

# Unit 05a — Test results

## Run

`npm test` (scoped to `test/**/*.test.js`), after the review fixes (`review.md`):

```
ok 68 - T1: the repo id: stable across moves and remote spellings, tied to the first commit, refuses what it cannot know
ok 69 - T1b: a store under another id for this checkout is refused, never replaced by a fresh one
ok 70 - T2: the store lives outside the work tree; a HOME inside the checkout is refused before anything is created
ok 71 - T3: permissions: symlinked or shared folders and readable files are refused; new files are 0600
ok 72 - T4: a second checkout of the same repo is refused; a moved checkout updates the path and logs it
ok 73 - T5: concurrent appends: 8 processes × 25 lines, none lost or merged, seq unique and in file order
ok 74 - T6: a torn last line is skipped and counted, then cut off by the next append; a broken middle line fails closed
ok 75 - T7: the counter: a gap after a crash is allowed; a counter behind the journal is refused
ok 76 - T8: locks: a live holder blocks; a dead holder is broken once and logged; breakers at once leave one holder
ok 77 - T9: status files: round trip with the journal seq; a bad ticket key never becomes a path; the migration hook
ok 78 - T10: facts from the journal: merged beats blocked, a closed MR waits for you, a later status takes over an open MR
ok 79 - T16: mirai status: no store, not a repo, the ticket list, one ticket, --json, hostile text shown safely
ok 80 - T17: mirai config check reads store/config.user.toml once the store exists; MIRAI writes nothing into the project
# tests 80
# pass 80
# fail 0
# duration_ms 34810
```

Three full runs in a row: 80/80 each, 33–35 s. T5 takes about 14 s and T1 about 4 s; the rest
are under 2 s each.

**Earlier tests changed:** one line only. `test/cli/cli.test.js` T14 pins the command list,
which now includes `status`.

**Isolation:** every test uses a temporary `HOME` and temporary git repos (`GIT_CONFIG_GLOBAL=/dev/null`,
`GIT_CONFIG_NOSYSTEM=1`). Nothing touches your real `~/Library/Application Support/mirai`. T2,
T9, T16 and T17 also compare every work-tree file before and after MIRAI's calls.

## What came up while testing

1. **`fsync` on macOS is a full flush, about 19 ms.**
   - **Measured:** Node's `fsync` and `fdatasync` both took about 19 ms; a rename about 0.4 ms. An
     event costs two flushes (the counter, then the journal line), so about 40 ms. That's no
     problem in real use, where a ticket writes a handful of events.
   - **Why the spec's T5 doesn't fit:** 8 × 200 lines is 1,600 serialized events, about 64 s.
     Writers waited past the 5 s lock limit.
   - **What changed:**
     - T5 is 8 × 25: 200 events, all 8 writers overlapping, and the test checks that they really
       interleave;
     - the short-lock wait is 30 s;
     - both flushes are kept, because the counter must be safe on disk before its line is written,
       so a crash leaves a gap, never a duplicate.
2. **A torn tail is cut off, not healed with a newline.**
   - Healing would turn the fragment into a broken line in the middle of the file, and the reader
     refuses those (fail closed). So the store would be unusable after any crash.
   - The fragment is the line a crashed writer never finished, and its number stays a gap. It's
     kept in `<file>.torn` for `doctor`.
3. **The lock bug both reviewers found** (`review.md` #1) showed in T5 on their runs, and not
   always on mine. After the fix, three full runs were green.

## Coverage of the spec's tests

| Spec | Where | Notes |
|---|---|---|
| T1 repo id | T1, T1b | Plus local and relative remotes, a remote-less folder rename, the remote-tracking fallback, and `identity-changed` (review #2) |
| T2 outside the work tree | T2 | Checked before anything is created |
| T3 permissions | T3 | |
| T4 second checkout, moved checkout | T4 | Plus an unrelated folder at the old path |
| T5 concurrent appends | T5 | 8 × 25 (see above) |
| T6 torn tail, broken line | T6 | Cut off and kept |
| T7 counter | T7 | |
| T8 locks | T8 | Plus "broken exactly once", exit 4, not re-entrant |
| T9 status files, migration hook | T9 | Plus compare-and-swap, case clash, readability check, folder symlink |
| T10 facts | T10 | Plus the epic, `pushSeq`, merge precedence, `by` checks on read, the pinned event list |
| T16 `mirai status` | T16 | Plus an unknown ticket, "no status file yet", escaped error messages |
| T17 config wiring, nothing written | T17 | Plus a symlinked personal file, a relative remote, a shallow CI clone, a store with a bad mode |
| T11–T15 | — | Unit 05b |
