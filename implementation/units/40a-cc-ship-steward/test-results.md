# Unit 40a: test results (2026-11-23)

Branch `fix/cc-ship-steward`, from `main` at `33b3066`.

## Tests

- **Locally**, during the build:
  - `test/adapters/claude-code.test.js`, `test/launch/strict.test.js`, `test/config/*`,
    `test/install/*`: 53/53 and more, including 40a T1, T2, T3 and the updated 13c T11;
  - `test/redteam/redteam.test.js`: 18/18 (18a T5 extended: S3 and S6). The full-run tests still
    reach `green`, since the fixture's committed `.claude/settings.json` carries the overrides;
  - docs, config, trust, install, launch and the other red-team files: 130/130.
- **The full suite, through the runner's `tests` job:**
  - `fix-ccss-tests-1` at `6e1aaba`: 806/808. 39 T1 and T5 failed: the setup ledger counted
    MIRAI's own `skillOverrides` in `.claude/settings.json` as an item of yours. Fixed in
    `src/setup/ledger.js`.
  - `fix-ccss-tests-2` at `a4e1ede` (15.2 min): **808/808**.
  - `fix-ccss-tests-3` at `4148fb8` (14.6 min, with claude-approvals off): **808/808**.

## Probes

Pending. The red team must prove what the docs leave open: whether a `-p --restricted --settings`
run leaves an `"off"` skill out of its init event.

### P1, first run: `u40a-redteam-1` at `e4202b6`, Claude Code 2.1.331: RED on S3 only

- **S6:** ok.
- **ship-local and steward:** absent. The override holds in `-p --restricted --settings` runs.
- **Cases:** all passed but the known h-timeout-link and l-cd.
- **S3 red:** "skill claude-approvals", a new bundled skill on 2.1.331, undocumented.
- **Jet's decision, 2026-11-24, "A":** the same treatment. `claude-approvals` is added to
  `builtin_skills_off`, and `builtin_version` is now 2.1.331. Tests updated:
  - 40a T1–T3 and 18a T5 expect all three;
  - 18a T5's ok case has none of them loaded, which is also what an older Claude Code without one
    looks like.

### P1: the sample app's red team, again (the lead session queues it)

The runner refreshes the sample app to this branch's commit, then runs its red team.

**Expected:** GREEN.
- **S3:** "… claude-approvals, ship-local, steward turned off and absent".
- **S6:** "claude-approvals, ship-local, steward turned off in read-only, read-write and in .claude/settings.json".

**If S3 says "still loads them (skillOverrides didn't hold)":** the override doesn't work in agent
runs. checkInit keeps refusing launches, and the fix comes back to Jet.

**Result, `u40a-redteam-2` at `feef9a9` (23.2 min), Claude Code 2.1.331: GREEN.** S3 "claude-approvals,
ship-local, steward turned off and absent"; S6 ok; every case passed but the known h-timeout-link
and l-cd. The baseline `u40a-baseline-2` at the same commit: pass.

### P2: `thudos-setup`'s red team, after a refresh (Jet runs it, after the merge)

Every `mirai` step runs with your private Claude Code config, typed in full as
`CLAUDE_CONFIG_DIR=~/.claude-private` where shown. Start with nothing else running on Docker.

1. Point the spare MIRAI checkout at the merged main:
   `git -C ~/Projects/mirai fetch origin && git -C ~/Projects/mirai-u39 checkout --detach origin/main`.
   You see `HEAD is now at <commit> Merge pull request …`.
2. `cd ~/Projects/thudos-setup && git status`. It must be clean, on `mirai/setup`.
3. `node ~/Projects/mirai-u39/bin/mirai.js init --refresh`. It ends with
   `hooks: pre-push, pre-commit in …`.
4. `grep -A3 skillOverrides .claude/settings.json`. You see `"claude-approvals": "off"`, `"ship-local": "off"` and
   `"steward": "off"`.
5. `git add -A && git commit -m "MIRAI refresh: unit 40a (ship and steward off)" && git push`.
6. `CLAUDE_CONFIG_DIR=~/.claude-private mirai session-server install`.
7. When the build runner is idle and `docker ps -aq --filter label=mirai.repo | wc -l` prints
   `0`: `mirai redteam run`. Not `--kept`: the installed Claude Code (2.1.331 now) is the one to
   test.
   - **Expected:** GREEN, with S3 "claude-approvals, ship-local, steward turned off and absent" and S6 ok.
   - h-timeout-link and l-cd are listed as known, not counted.
8. `CLAUDE_CONFIG_DIR=~/.claude-private mirai doctor`. You see no red.
9. In a `claude-priv` session in `thudos-setup`, type `/ship`. It isn't in the `/` menu, and
   typing it gives `Skill "ship-local" is disabled via skillOverrides`, or Unknown command. In a
   session outside a MIRAI project, `/ship` is still there.

## Approved

Jet, 2026-11-24: "approve 40a". Merged as PR #116 (`9f4011b`), CI green on both Ubuntu checks; the
runner's `fix-ccss-tests-3` at `4148fb8`: **pass, 808/808**; P1 GREEN at `feef9a9` (no code change
after it).

## Follow-up

- **P2, Jet:** refresh `thudos-setup` to main and run its red team without `--kept` (the steps above).
- **Unit 41** merges main to take this fix in; its sample-app baseline and red team run again.
- **Refresh the other installs** (`mirai-sample-app-gitlab`, the pilot's Thudos) with a red team each.
- **A new bundled skill** in a later Claude Code turns S3 red again: it comes to Jet the same way.
