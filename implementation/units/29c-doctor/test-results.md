---
unit: "29c"
date: 2026-11-14
claude_code: 2.1.319 (agents); no model in this unit's probes
result: 604/604 · P1 on the sample app: 10 ok, 4 yellow, 0 red, exit 0, every yellow with its hint · P2 in a throwaway clone: every seeded fault named, one --fix repaired the dead lock and breaker, the registry and the run state, the hook and gh left red and named, a broken journal line named and its bytes left as they were; 17/17 checks, clean-up included
---

# Unit 29c — Test results

## Tests (`npm test`, no model, no network)

New: `test/doctor/doctor.test.js` (4 tests, a real store with a planned, built and reviewed ticket):
- a healthy store: the 14 items in order, the ones that must be ok, merge gate yellow (local-only), every non-ok item with a hint, the summary line, exit 0, `--json`, the session list's `doctor` with `--fix` and `--json`;
- red items: the hook's Node removed (and `hooksState` stops saying ok), `gh` at a missing path, exit 5; a stale red team red, a newer Claude Code yellow; a 340-day token yellow, no token red; the session server missing yellow, foreign red;
- `--fix`: a dead process's lock and breaker removed, a live one kept; the registry rebuilt (1 entry); the run state, hidden behind the locks, rebuilt in the same `--fix`; then store and registry ok; the run state left alone while a run holds the run lock; a broken journal line named red and its bytes unchanged;
- the Mach-O CPU: arm64, Intel, universal, a script, a missing file.

The pinned command list takes `doctor`.

## The full suite

604 tests, 604 pass (about 25 minutes under `caffeinate -i`).

## P1: the sample app as it is (`test/probes/doctor-probes.js`)

`doctor: 10 ok, 4 yellow, 0 red`, exit 0. The yellows: the red team (green for 2.1.319; 2.1.325 installed, not tested), the merge gate (local-only), the agents' binary (Intel, through Rosetta on this Mac), the baseline (none yet for `e596d6e`; the next run records it). The registry is ok with 5 entries; one, SAMPLE-2's first build from the old Mac, can't be checked here (its commit isn't in this clone) and is named.

## P2: seeded faults in a throwaway clone with its own MIRAI home

A stand-in login token (never yours); the folder deleted at the end.

| Seeded | doctor | `--fix` |
|---|---|---|
| the hook's Node removed | red: "isn't there: every push fails", hint `mirai init --refresh` | left red, named |
| `gh` at a missing path | red: "isn't there: mirai ship refuses" | left red, named |
| a dead process's lock and breaker | red: "2 locks left by a process that's gone" | removed both |
| the branch registry deleted | red: "missing" | rebuilt |
| the run state deleted | (hidden behind the locks) | rebuilt from its log: finished |
| a broken journal line | red Store: the file named, "MIRAI never rewrites its history" | bytes unchanged, exit 5 |

All 17 checks passed on the third run. The first two found probe faults, not doctor's: the probe's own patterns expected the wrong spacing, and its clean-up couldn't delete MIRAI's read-only trust trees (now made writable first; both leftover folders, holding only the stand-in token, deleted).

## Found and fixed during the build

- **A damaged journal made doctor crash:** the store refuses to open with it, so doctor now reports exactly that (the Store item red, the file, what you can do) with the login, instead of failing.
- **The registry check would have dropped an entry it couldn't verify** (SAMPLE-2's first build, from the old Mac): now kept, named, and not red.
- **One `--fix` repairs everything safe:** it checks again after each repair, since the Store item shows its first problem.
