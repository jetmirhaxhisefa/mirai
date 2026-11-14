# `mirai doctor` (unit 29c)

```
mirai doctor          # check everything; changes nothing
mirai doctor --fix    # repair what's safe, then check again
mirai doctor --json   # the items, for scripts
```

Also `/mirai doctor` and `/mirai doctor --fix` in your session (Claude Code asks you each time).

Each item is **ok**, **yellow** (works, but worth knowing) or **red** (something will fail). Every yellow and red item has a fix under `to do`. The exit code is 0 when nothing is red, 5 when something is.

| Item | Red when | Yellow when |
|---|---|---|
| Login | no login token | the token is 330 days old or more (it lasts a year); `ANTHROPIC_API_KEY` is set in your shell |
| Strict bundle | a strict template doesn't match its hash | no trust root for the integration branch's commit yet |
| Red team | none, stale or red for the Claude Code agents run | a newer Claude Code is installed, not tested yet |
| Trust root | MIRAI's files here don't match `mirai.lock`, or the trust root changed | no trust root for the integration branch's commit yet |
| Branch registry | it can't be read, or disagrees with the journal and the signed branch records | — |
| Merge gate | — | always, until CI (unit 54): "local-only", your merge is the gate |
| Plan and week | the week's MIRAI share would pass `usage.week_max`; your caps can't be read | no fresh usage reading |
| Store | a store file can't be read; a lock left by a process that's gone; the run state missing or off its log | — |
| Hook's Node | the pre-push hook runs a Node that isn't there (every push would fail) | — |
| Host CLIs | `gh` or `glab` recorded at a path that isn't there | none recorded |
| Agents' binary | the kept Claude Code is for another CPU and can't run here | it's an Intel binary on Apple Silicon (runs through Rosetta) |
| Your key | no key, or it isn't on the integration branch, or it's revoked | `.mirai/keys` holds files that aren't keys |
| Session server | Claude Code has a `mirai` server MIRAI didn't register | not registered, or behind |
| Baseline | — | none for the integration branch's commit (the next run records it) |

## What `--fix` repairs

Only what MIRAI can rebuild from what it trusts, and only when its item is red:

- **A lock or a lock breaker left by a process that's gone** (its pid isn't running). A live process's lock is never touched.
- **The run state** (`state.json`), rebuilt from the run log, only while no run holds the run lock.
- **The branch registry** (`branches.json`), rebuilt from the journal's branch lines and each branch's signed record (verified with the integration branch's keys). An entry whose record can't be read in this clone (its commit isn't here) is kept as it was.

## What it never repairs

**Damaged history:** a broken or out-of-order journal or run-log line, a counter behind, a bad signature. That's your signed history; rewriting it would hide what happened. Doctor names the file, and says what you can do: keep a copy of the file, then remove a torn last line by hand (a crash while writing can leave one), or ask for help with the copy. When the journal itself can't be read, MIRAI can't open the store, so doctor shows only that and your login.

The full doctor (unit 47) adds stack health, verifier rungs, `business.md` age, Docker's disk space and the public-repo warning.
