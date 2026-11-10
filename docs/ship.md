# Shipping a ticket: `mirai ship`

After Rex's review passed and `mirai gate record <ticket>` minted the ticket's proofs, MIRAI
pushes the ticket's branch and opens its merge request (unit 27a):

```
mirai ship SAMPLE-1
```

It signs nothing, so it runs from your terminal or unattended (unit 28's `mirai run` calls the
same thing). There is no approval step here: **your merge is the gate.** MIRAI never merges.

## What it does, in order

Every refusal comes before anything leaves your machine.

1. The ticket is `in-review`, HEAD is on its branch, the tree is clean.
2. `mirai gate check` passes at HEAD: the review and gate proofs are for exactly this code.
3. The host: which one (below), its CLI, and that you're logged in.
4. The push check, the same one MIRAI's pre-push hook runs (`docs/pre-push.md`): the secret scan,
   the trailers, the proofs.
5. The branch's starting point is on the host's integration branch. Otherwise the MR would carry
   commits from your local main that you haven't pushed: push main first.
6. The MR, if one exists for the branch (below).
7. The push (only when the host's branch isn't at HEAD), then the MR opened or its description
   updated. The journal records both; `mirai status` then shows the ticket `built`, with the MR's
   address.

## The host

The host is set per project, in `.mirai/config.toml` on the integration branch (a branch can't
change it):

```toml
[git]
integration_branch = "main"
host = "github"                          # or "gitlab"
host_url = "https://git.example.com"     # only for a self-hosted server
```

Without `host`, MIRAI takes it from the `origin` remote when that's `github.com` or `gitlab.com`
(`mirai init` writes it for a new install). A self-hosted server can't be told from its address:
set `host` and `host_url` yourself. The repo's path on the host (`owner/repo`, or GitLab's
`group/subgroup/repo`) comes from the remote. **GitLab is unit 27b**: until then a `gitlab` host is
valid config and `mirai ship` refuses it (`host-not-built`).

## Credentials

MIRAI's own git has no credentials, on purpose (no helper, no ssh, an empty HOME), so nothing in a
repo's config and no agent can push. For the push only, MIRAI adds one credential helper: your
`gh` (GitHub's CLI), found on your PATH by `mirai init` and recorded in the store. `gh` hands git
the token in memory; it never appears in arguments, files or the repo. Install `gh`, then:

```
gh auth login
mirai init --refresh      # records gh's path
```

## The MR

A normal, ready MR (not a draft) against the integration branch, titled `<ticket>: <title>`, from
the fixed template: Why (the ticket), What changed (the plan's tasks), `Review: PASS after N rounds
(MIRAI)` with Rex's non-blocking notes as one-line follow-ups, QA ("hasn't run" until unit 51),
Risk and the ticket's path. **No review findings**: a note that names a file or a line stays local
and is only counted. The description starts with `<!-- mirai:mr-description@v1 -->`.

## Running it again

| On the host | What ship does |
| --- | --- |
| an open MR for the branch | pushes a new head if there is one, and puts MIRAI's description back if it was edited: `updated`, or `unchanged`. Never a second MR |
| a merged MR | refuses (`mr-merged`) and records the merge |
| a closed MR | refuses (`mr-closed`) and records it. Closing was your decision; MIRAI never reopens it |
| the branch at a commit MIRAI didn't push | refuses (`remote-moved`), never overwrites it |

## Codes

| Code | What to do |
| --- | --- |
| `not-reviewed`, `no-proof`, `stale` | `mirai review <ticket>`, then `mirai gate record <ticket>` |
| `wrong-branch`, `dirty` | check out the ticket's branch; commit or stash your changes |
| `no-remote`, `bad-remote`, `no-host`, `wrong-host` | fix the `origin` remote, or `[git] host` / `host_url` on the integration branch |
| `no-gh`, `gh-auth` | install `gh`, `gh auth login`, `mirai init --refresh` |
| `host-not-built` | a GitLab project before unit 27b: push and open the MR yourself |
| `fetch-first`, `base-not-pushed` | `git fetch`, or push the integration branch first |
| `mr-merged`, `mr-closed`, `remote-moved` | look at the MR on the host |
| `secret`, `trailer-mix`, … | the push check's codes: `docs/pre-push.md` |
