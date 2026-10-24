---
unit: "12"
name: trust-root
date: 2026-10-24
node: v22.23.2
result: 181 / 181 pass (earlier units' 167 + unit 12's 14), after the review fixes; 3 full runs in a row green
---

# Unit 12 — Test results

## Run

`npm test` (scoped to `test/**/*.test.js`), after the review fixes (`review.md`). The new files:

```
test/util/glob.test.js       T10: the glob matcher
test/trust/protected.test.js T1: the roadmap's branch cases each give high risk
                             T1b: the core is stack-neutral; packs are opt-in data
                             T2: the rest of the rules, renames, imports, package.json and the E2E exception
                             T3: declared paths: an approved plan's exact path doesn't need you; a pattern declares nothing; auto-run always needs you
                             T4: changed paths, from the merge-base and against the work tree; no filter or driver runs
                             T4b: files git ignores: listed when present, part of the change when an agent changed them
                             T9: the report warns before you open such a branch in your IDE
test/trust/snapshot.test.js  T5: the snapshot comes from the base commit, not the work tree
                             T6: a tampered trust-root file is detected; an untouched one is reused
                             T6b: the anchor is the base commit; snapshots are pinned, built one at a time, and the same twice
                             T7: the snapshot refuses a bad base, writing nothing
                             T8: gates read the snapshot, not the work tree
                             T11: mirai trust and mirai protected through the CLI
# tests 181
# pass 181
# fail 0
```

Three full runs in a row: 181/181 each. Every test uses temporary repos and a temporary HOME,
removed afterwards (read-only snapshot folders are made writable first).

**Earlier tests changed:**
- `test/cli/cli.test.js` T14: the pinned command list gains `protected` and `trust`.
- `test/lint/plan.test.js`: a declared protected path that is a pattern is refused.

## The roadmap's "done when", mapped

| Done when | Test |
|---|---|
| A branch that edits a lint config, a compose override, a `.gitattributes` `-diff` rule, a `.vscode` task or a nested `CLAUDE.md` gets `high` | T1 (the lint config through the `node` pack, the others through the core); T12 below, on the sample app |
| A tampered trust-root file is detected at the next launch | T6, T6b: a changed, added, removed or writable file, an added folder, a changed manifest, and a file + manifest + record rewritten together. Unit 19 calls the same check before each launch |
| Hooks and gates read the snapshot, not the work tree | T5, T8: the work tree loosens the rules (drops a `[gate] protected` addition, edits the core list in the copy), and classify still uses the base's |
| The report warns before you open such a branch in your IDE | T9: auto-run paths rendered through 09b's run report; T11: the `mirai protected` line |

## T12: the sample app (a copy, not part of `npm test`)

**Setup.** `~/Projects/mirai-sample-app`, with your committed install (`30b0271`), was copied to
the scratchpad and used with a temporary HOME. The original wasn't touched. In the copy:
- `mirai init --refresh` with this MIRAI;
- `[gate] packs = ["php", "node"]` added to the config, then `mirai render`;
- a commit on `main`, with `origin/main` moved to it, standing in for a push.

**Before moving `origin/main`**, `trust snapshot` refused with "main here and origin/main differ;
push or pull main first", as intended.

**`mirai trust snapshot`:** exit 0, 118 files, in about 1.3 s.

**A scratch branch touching each roadmap case,** plus a Composer install script and an ordinary
file, gave this from `mirai protected main..scratch/protected` (about 2.5 s):

```
auto-run   .vscode/tasks.json  (auto-run)
protected  backend/.gitattributes  (hides-code-from-review)
protected  backend/CLAUDE.md  (instruction-files)
auto-run   backend/composer.json  (php-dependencies, php-install-scripts)
protected  docker-compose.override.yml  (containers-and-secrets)
protected  frontend/eslint.config.js  (node-checks)
risk: high; 2 run by themselves: read them on the host before you open the branch in your IDE
```

The ordinary `frontend/src/ordinary.ts` isn't listed.

**On `main` with nothing changed:**

```
no protected paths touched
ignored by git, under protected paths (not part of the change): backend/.env
```

That's your own ignored `.env`, shown apart; it doesn't park anything.

**For your real sample app:** after "UNIT APPROVED" and my push, refresh it, and add
`[gate] packs = ["php", "node"]` to `.mirai/config.toml` (your file) if you agree.
