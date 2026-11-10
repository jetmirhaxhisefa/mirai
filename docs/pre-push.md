# The pre-push check

When you `git push` in a repo where MIRAI is installed, MIRAI checks the push before anything
leaves your machine (unit 26a). It runs on every push from this clone, from your terminal or
from an editor, and from unit 27 on MIRAI's own pushes too.

## Where it lives

- `mirai init` (and `mirai init --refresh`, `mirai init --join`) writes a small script to
  `~/Library/Application Support/mirai/<repo-id>/hooks/pre-push` and points git at that folder
  with `core.hooksPath` in the repo's `.git/config`. The folder is outside the project, and
  agents can't read or write it.
- The script runs the `mirai` launcher, which runs the check from **the integration branch's
  committed copy of MIRAI**, never from the branch you're pushing. A branch that changes MIRAI's
  own files can't change the check that judges it.
- `mirai status` shows `hook: ok`, `off` or `changed`. While it isn't `ok`, `mirai build`,
  `mirai fix` and `mirai review` refuse to start (`hooks-off` or `hooks-changed`): run
  `mirai init --refresh` in a terminal.

## What is checked

On **every branch**, yours included:

- **The secret scan.** Every commit the push adds: its message, and the lines its diff adds, in
  every file (binary files too). It looks for:
  - the Claude login token (`mirai token set`), in any form: as is, base64, base64url, hex,
    URL-encoded, reversed, or a 16-character piece of it;
  - the fixed-prefix secret shapes in `registry/secrets/core.toml`: private keys, AWS, GitHub,
    Anthropic, OpenAI, Slack and other service tokens.

  It reads history, not just the result: a secret added in one commit and removed in the next is
  still pushed, so it's still refused. The value found is never printed.

On a **MIRAI branch** (any of its own commits has the `Mirai-Ticket` trailer or MIRAI's
committer, it changes `.mirai/records/`, or the branch is registered), also:

- no merge commits (`merge-commit`): rebase onto the integration branch instead;
- every commit carries the same ticket's trailer (`trailer-mix`);
- the ticket's `branch.json` is there (`no-branch-record`);
- the signed review and gate proofs for exactly this code (`mirai gate check`): `no-proof`,
  `stale` (the code changed since the proofs) or `bad-record` (something else in the records
  folder). Mint them with `mirai gate record <ticket>` after Rex's review.

A branch counts as MIRAI's only by its own commits since it left the integration branch: a
branch of yours built on top of merged MIRAI work is yours. Pushing the integration branch itself,
or a tag, gets only the secret scan: your merge is the gate there.

## Diff coverage: a warning

When a MIRAI branch passes, the push also prints the diff coverage that `mirai gate record`
signed into the gate proof (unit 26b): how many of the lines the ticket added that can run were
run by a test, and the files and lines that weren't:

```
mirai pre-push: feature/PMT-31-…: pass: PMT-31: the review and gate proofs match code 3f1c…
  warning: diff coverage 41 of 45 changed lines ran (91%); no test ran these lines:
    backend/app/Http/Controllers/TaskController.php 52-55
```

It never blocks in Milestone A (unit 54 makes it blocking, in CI). `mirai gate check <ticket>`
prints it in full. What counts (a level's `coverage_paths`, the baseline's measured files, exact
renames) is in `docs/test-adapters.md`. A proof minted before unit 26b says "none in this proof".

## When it refuses

Each ref gets one line, `pass` or `blocked (<code>)`, with the reason and what to do:

| Code | What it means | What to do |
| --- | --- | --- |
| `secret` | a secret shape or your token is in what the push adds | take it out of every commit (`git rebase -i`, or reset and commit again); if it was real, replace it |
| `too-large-to-scan` | more than 64 MB of changes in one push | push fewer commits at a time |
| `hooks-changed` | the hooks folder or `core.hooksPath` isn't as MIRAI wrote it | `mirai init --refresh` |
| `registry` | the branch looks like MIRAI's, and the branch registry is missing | `mirai doctor` |
| `merge-commit`, `trailer-mix`, `no-branch-record` | a MIRAI branch has commits MIRAI didn't make | take it over by hand (unit 46) or start again |
| `no-proof`, `stale` | no review and gate proofs for this exact code | `mirai review <ticket>`, then `mirai gate record <ticket>` |
| `bad-record` | a file in `.mirai/records/<ticket>/` that isn't a valid MIRAI record | look at it; only MIRAI's signed records belong there |

When the check **can't run at all** (MIRAI moved, Node is gone, the store is missing, the
integration branch has no MIRAI copy), the push is refused too, and the message says why.

One gap git leaves: if the whole MIRAI home folder is deleted, the hook script goes with it,
and git runs no hook at all. `mirai status` then shows `hook: off`, and MIRAI starts no agents
until `mirai init --refresh` puts it back.

## Your own hooks

If the repo already had git hooks (in `.git/hooks`, or a `core.hooksPath` such as Husky's or
lefthook's), `mirai init` lists them and asks. On yes, MIRAI's folder gets a small forwarding
script for each, so they run as before; your own `pre-push` runs first, then MIRAI's check, and
both must pass. On no, MIRAI's hook isn't installed (and MIRAI starts no agents until it is).

## Pushing anyway

`git push --no-verify` skips every pre-push hook, MIRAI's included. That is your choice to make,
for a false alarm. Until CI checks the same things (unit 54), the merge gate is local only.
