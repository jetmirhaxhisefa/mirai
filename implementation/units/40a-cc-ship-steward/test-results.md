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

## Probes

Pending. The red team must prove what the docs leave open: whether a `-p --restricted --settings`
run leaves an `"off"` skill out of its init event.

### P1: the sample app's red team (the lead session queues it)

The runner refreshes the sample app to this branch's commit, then runs its red team.

**Expected:** GREEN.
- **S3:** "… ship-local, steward turned off and absent".
- **S6:** "ship-local, steward turned off in read-only, read-write and in .claude/settings.json".

**If S3 says "still loads them (skillOverrides didn't hold)":** the override doesn't work in agent
runs. checkInit keeps refusing launches, and the fix comes back to Jet.

### P2: `thudos-setup`'s red team, after a refresh (Jet runs it, after the merge)

Every `mirai` step runs with your private Claude Code config, typed in full as
`CLAUDE_CONFIG_DIR=~/.claude-private` where shown. Start with nothing else running on Docker.

1. Point the spare MIRAI checkout at the merged main:
   `git -C ~/Projects/mirai fetch origin && git -C ~/Projects/mirai-u39 checkout --detach origin/main`.
   You see `HEAD is now at <commit> Merge pull request …`.
2. `cd ~/Projects/thudos-setup && git status`. It must be clean, on `mirai/setup`.
3. `node ~/Projects/mirai-u39/bin/mirai.js init --refresh`. It ends with
   `hooks: pre-push, pre-commit in …`.
4. `grep -A3 skillOverrides .claude/settings.json`. You see `"ship-local": "off"` and
   `"steward": "off"`.
5. `git add -A && git commit -m "MIRAI refresh: unit 40a (ship and steward off)" && git push`.
6. `CLAUDE_CONFIG_DIR=~/.claude-private mirai session-server install`.
7. When the build runner is idle and `docker ps -aq --filter label=mirai.repo | wc -l` prints
   `0`: `mirai redteam run`. Not `--kept`: the installed Claude Code (2.1.331 now) is the one to
   test.
   - **Expected:** GREEN, with S3 "ship-local, steward turned off and absent" and S6 ok.
   - h-timeout-link and l-cd are listed as known, not counted.
8. `CLAUDE_CONFIG_DIR=~/.claude-private mirai doctor`. You see no red.
9. In a `claude-priv` session in `thudos-setup`, type `/ship`. It isn't in the `/` menu, and
   typing it gives `Skill "ship-local" is disabled via skillOverrides`, or Unknown command. In a
   session outside a MIRAI project, `/ship` is still there.
