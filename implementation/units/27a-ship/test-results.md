---
unit: "27a"
date: 2026-11-11
claude_code: 2.1.319
result: 571/571 in the full suite · git probe (--mirai) all pass, with pushBranch · P1 passed on its first run against the real GitHub repo (a PR opened through gh's credential helper, unchanged on a rerun, put back after an edit, refused once closed; no token in the probe folder; cleaned up), and showed the plan's code spans garbled in "What changed", fixed after it
---

# Unit 27a — Test results

## Tests (`npm test`, no model, no network; a stand-in `gh` and a bare repo as the host's git)

New, in `test/ship/ship.test.js` (6):

- **The host:** remotes over https and scp-style ssh, GitLab's nested groups; `owner/repo` refused when short or with `..`; no `host` in config → github.com and gitlab.com remotes recognised, a self-hosted one → `no-host`; a configured self-hosted GitLab read from `host_url`; a remote on another server than the configured one → `wrong-host`; `gitlab` → `host-not-built`.
- **The description:** the `## Tasks` lines (a fence inside skipped); the ticket's title, one review round, What changed from the plan with no backticks left, the ticket's path, no finding object.
- **Opened, unchanged, updated:** one PR against `main` from the branch, titled `PMT-31: Renaming a team hides its members`, the marker first, the review line, "QA hasn't run"; the host's branch at HEAD; every `gh` call with your `GH_CONFIG_DIR` and `GH_HOST=github.com`; the journal's push with its checked proofs and the MR's URL; `mirai status` shows `built … https://github.com/acme/app/pull/1`. Again → `unchanged`, one `pr create` only. The body edited on the host → `updated`, the same PR.
- **Refused before anything leaves:** no proofs → `no-proof`, and `gh` never asked; logged out → `gh-auth`; the host's main behind the base → `base-not-pushed`; no recorded `gh` → `no-gh`; no PR made.
- **Refused, never forced or reopened:** a commit MIRAI didn't push on the host's branch → `remote-moved`, the branch left as it was; closed → `mr-closed`, recorded, still closed; merged → `mr-merged`, recorded.
- **`pushBranch`:** to a bare repo by path; a lease that no longer holds refused, one that holds pushes; a remote's name, a URL with a user and password, `../x`, a helper with a relative path → refused.

Changed: the journal version (5) in `test/mcp/broker.test.js`, `test/mcp/session.test.js`, `test/sign/sign.test.js` and `test/store/store.test.js` now follows the constant; the command list has `ship`.

## The full suite

**571/571 pass** (569 on the first run, 34 min under `caffeinate -i`, plus the two tests that had pinned journal version 4, fixed and rerun).

## The git probe

`node test/probes/git-probes.js --yes --mirai`: every case passed, with the new `pushBranch` (to a bare repo by path).

## A fact found during the build

`gh` with any HOME but yours can't reach its token in the macOS keychain ("the token in default is invalid"), even with `GH_CONFIG_DIR` set; with your HOME and nothing else of your environment, it's logged in. So the credential helper gives `gh` your HOME in its own command, and git keeps the pinned empty one.

## Probes

`test/probes/ship-probes.js`, **P1** (Sonnet, 1 run), one run, against your private `jetmirhaxhisefa/mirai-sample-app` on GitHub. The log is `~/mirai-27a-p1.log`.

1. **Baseline** 639 s; the seeded build handed over; **Rex** (claude-sonnet-5-5, 7 turns): `pass`, one nit (no 401 test); `gate record`: recorded.
2. **The base:** the clone's main pushed to `mirai-probe/base-9919fd` **through MIRAI's push and `gh`'s credential helper**: ok in 3.2 s (GitHub's `main` never touched).
3. **`mirai ship SAMPLE-1` → `opened`** in 13.6 s: PR #1, `SAMPLE-1: A user deletes one of their tasks`, `feature/SAMPLE-1-…` → the probe base, **not a draft**, open. The body: the marker first, `Review: PASS after 1 round (MIRAI)`, Rex's nit as the one follow-up (no file named), "QA hasn't run", Risk normal, the ticket's path; nothing citing a file and a line. The journal: MR open, proofs at head, the URL.
4. **Again → `unchanged`** (8.2 s, nothing pushed). **The description edited on GitHub → `updated`** (MIRAI's put back). **The PR closed on GitHub → refused `mr-closed`**, not reopened.
5. **No GitHub token shape** anywhere in the probe folder.
6. **Clean-up:** the PR closed, both branches deleted: ok, ok, ok. (GitHub keeps closed PR #1 in the repo's history; a PR can't be deleted.)

**Seen, and fixed after the run:** "What changed" read garbled: the plan's tasks carry markdown code spans (`` `backend/…` ``, `` `destroy(Task $task)` ``), and passed through as text the renderer escaped their backticks. `describeTicket` now drops code-span backticks from every text it takes (a test checks the plan's tasks arrive without them); the renderer still shows a `$word` as code, its guard against GitHub's math.

## Not proven

- A rebased branch pushed with the lease on the real host (the lease is tested on a bare repo; stacking, unit 53, is where MIRAI rebases).
- GitLab: unit 27b.

## The sample app on 27a

- **Refreshed** (`afdbc23`, pushed): `mirai init --refresh` recorded `gh` in the store's `host-tools.json` (`/Users/jetmir.haxhisefa/.local/bin/gh`).
- **Red team: GREEN**, key `1a6f6bdea6da8891`, framework `46086afba7a0`, Claude Code 2.1.319 (kept; 2.1.322 is installed), 324 runs on 6 workers in 28 min 40 s (haiku); S1–S5 ok, cases ran under both templates. "Bash denied before it ran" for `w-git-config` and `a-claude`, as before.
- **Baseline** for `afdbc23`, signed: lint pass; unit 13/14 with `KnownFailureSeedTest` failing 10 of 10 (the known failure), coverage 31 of 35 lines in 8 files; frontend 5/6 with the planted `flaky-seed.test.ts` caught as flaky (failed 1 of 2), coverage 41 of 121 lines in 6 files; e2e 1/1. One gap (reported): the playwright adapter has no coverage.
