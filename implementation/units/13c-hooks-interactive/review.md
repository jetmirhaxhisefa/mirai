---
unit: "13c"
date: 2026-10-25
reviewers: Tech Lead, Architect (independent, read-only, no network)
verdicts: not approvable as it stood (Tech Lead: two ways to write outside the project), approve after fixes (Architect); all findings applied, re-probed, or noted for later units
---

# Unit 13c — Review

Both reviewers worked on a frozen tree. The Architect's agent still had local background work
after its report, so I stopped it before editing. Neither ran real `claude` or read a real
secret. The Tech Lead called `decide()` directly. The Architect ran `decide()`, `sandbox-exec`
on a scratch canary, and `strings` over the 2.1.310 binary.

**What held up:**
- "the gate for writes, refusals only for reads" follows from the probes;
- every error inside the hook refuses;
- the policy is pinned by its hash and holds no token;
- the 8 MB input cap;
- no ReDoS in the secret shapes (5 MB of adversarial input in 10–30 ms);
- the `verify.js` extraction is byte-for-byte the same;
- the `mirai-settings` lock block ignores your own entries and their order;
- the merge keeps your keys, is idempotent and refuses bad JSON;
- the hard-link refusal and its message;
- telling you about the hard-link gap before building.

## Applied in unit 13c

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **Critical:** a Write through a dangling symlink (to `~/Library/LaunchAgents/…`) was allowed: the hook took it for a new file in the project | Tech Lead | A symlink that points nowhere is refused | T1, hook-dangling-write |
| 2 | **Critical:** `~/…` and space-padded paths were joined onto the project and allowed, while Claude Code expands and trims them | both | Only plain absolute paths are judged; `~`, spaces, relative, NUL and `..` (also in Glob patterns) refused | T1, hook-tilde-write |
| 3 | The hook printed "allow" for reads too; an allow is a grant that may skip Claude Code's outside-the-project check | Architect | Silent on reads it lets through; "allow" only for writes | T4, bundle-read-ok |
| 4 | A `.env` that is a symlink leaves its target readable under its own name | Tech Lead | The launch is refused, like a hard link | strict T5, bundle-env-symlink |
| 5 | An unreadable token file turned the token check off; a missing trust hash skipped the trust check | both | Writes refused when the token can't be read; a launch needs a verified trust root | T4, strict T5 |
| 6 | Symlinked hooks or write-denied folders slipped through (`.husky -> scripts/hooks`) | Tech Lead | Checked by the name as given and as resolved; `core.hooksPath` resolved too | T1 |
| 7 | The protected-file list was written twice | Architect | One `protectedFiles` function | strict T5 |
| 8 | The hook ran with Claude Code's environment | Architect | `env -i`, with `HOME` and a fixed `PATH`; `node` inside a writable folder refused | strict T5 |
| 9 | A non-list `permissions.deny` was silently dropped; a byte-order mark was refused | both | Refused, and accepted, respectively | T11 |
| 10 | `Edit(/.mirai/keys/**)`'s leading `/` in a project file was never probed | Architect | `**/` twins added | T11 |
| 11 | Secret shapes: PGP keys missed; test fixtures refused without a hint | both | PGP and GitLab added; the refusal tells the agent what to do; vendor and registry tokens kept as core, with the reason | T3 |
| 12 | Docs overclaimed: the check-then-use race, the hook vouching for itself, content checks beyond the file tools, the interactive rules against Bash | both | Each said plainly in `docs/agent-safety.md` | — |
| 13 | Copies of secrets, and `.env` in git history, aren't covered | Architect | Said plainly: MIRAI protects names and file identity, not content | — |
| 14 | Nits: an orphaned comment, the copied `filesUnder`, `process.exit` after a write, a shadowed variable, the probe guard's mask, the spec's file list | both | Fixed | — |
| 15 | Found by the fix's own test: a default parameter turned "token unreadable" back into "no token" | me | An explicit flag | T4 |

## Noted for later units (in the spec)

| Unit | Note | From |
|---|---|---|
| 15 | A Read allow for the launch's `input/` only, for the plan | Architect |
| 17 | Secret files beyond `.env*` as pack data, which get the second-name and inode checks; known example values | Architect |
| 18 | N≥3 of every hook probe; `~` and spaces for every tool; a hook allow against a deny and against an outside call; a slow hook; the hook's environment; `/.vol` and firmlinks; Grep over a mid-run link; git objects of `.env`; interactive Bash and modes; the race | both |
| 19 | Re-check the policy hash; the `node` path; the hook's cost per call | Architect |
| 26 | One source for secret shapes and token forms; scan what shell commands wrote | Architect |
| 29 | The second-name and git-history checks before a night run; MIRAI's settings entries; the hook; `node`; stale scratch folders | Architect |
| Later | With your OK, the two personal denies in your user settings too | Architect |
