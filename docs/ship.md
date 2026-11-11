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
`group/subgroup/repo`) comes from the remote.

**A self-hosted server on its own address** works (`https://gitlab.acme.com`), including one whose
certificate comes from your company's own authority (below). A `host_url` with a port
(`https://git.acme.com:8443`) or a sub-path (`https://acme.com/gitlab`) is refused
(`host-unsupported`): that's later work (unit 27b, Jet's decision 2026-11-11).

## Credentials

MIRAI's own git has no credentials, on purpose (no helper, no ssh, an empty HOME), so nothing in a
repo's config and no agent can push. For the push only, MIRAI adds one credential helper: your
`gh` (GitHub's CLI), found on your PATH by `mirai init` and recorded in the store. `gh` hands git
the token in memory; it never appears in arguments, files or the repo. Install `gh`, then:

```
gh auth login
mirai init --refresh      # records gh's path
```

**GitLab** (unit 27b) works the same way with `glab`, GitLab's CLI, version 1.125.0 or newer
(the first with every credential-helper fix MIRAI relies on). `glab` keeps your login in the macOS
Keychain; MIRAI never sees the token, and a `GITLAB_TOKEN` in the project's environment is never
passed to it.

```
glab auth login --hostname gitlab.com --web --git-protocol https     # or your server's name
mirai init --refresh      # records glab's path and prints its version
```

On a self-hosted server, log in with a personal access token (scopes `api` and `write_repository`):
`glab auth login --hostname gitlab.acme.com` and paste it when asked. (Browser login there needs an
OAuth application registered on the server, which isn't covered yet.)

MIRAI calls only `glab --version`, `glab auth status` and `glab api` (GitLab's REST API: the branch,
the merge requests), with glab's update check, telemetry and what's-new notice switched off, and
glab's config folder found the way glab finds it (on a Mac, usually
`~/Library/Application Support/glab-cli`).

**Company certificates.** If your server's certificate comes from your company's own authority, tell
glab where that authority's file is:

```
glab config set ca_cert /absolute/path/to/company-ca.pem --host gitlab.acme.com
```

MIRAI gives git the same file for the push (`http.sslCAInfo`, for that push only), so glab and git
trust the same authority. A relative or unreadable path is refused (`bad-ca`). MIRAI never pushes
with certificate checks off: `skip_tls_verify` in glab's config is refused (`tls-off`).

## The MR

A normal, ready MR (not a draft) against the integration branch, titled `<ticket>: <title>`, from
the fixed template: Why (the ticket), What changed (the plan's tasks), `Review: PASS after N rounds
(MIRAI)` with Rex's non-blocking notes as one-line follow-ups, QA ("hasn't run" until unit 51),
Risk and the ticket's path. **No review findings**: a note that names a file or a line stays local
and is only counted. The description starts with `<!-- mirai:mr-description@v1 -->`.

Nothing in it acts on the host: a line can't start with `/` (GitLab runs a line like `/merge` or
`/close` as a command, when the MR is opened and when it's edited), and anything a host turns into
a mention or a link (`@all`, `#12`, `!12`, `~label`, `%milestone`, GitLab's `[[_TOC_]]` and the
rest) is shown as code. A leading `Draft:`, `[Draft]`, `(Draft)` or `WIP:` is taken off the title,
so the MR is never a draft.

## Running it again

| On the host | What ship does |
| --- | --- |
| an open MR for the branch | pushes a new head if there is one, and puts MIRAI's description back if it was edited: `updated`, or `unchanged`. Never a second MR |
| a merged MR | refuses (`mr-merged`) and records the merge |
| a closed MR | refuses (`mr-closed`) and records it. Closing was your decision; MIRAI never reopens it |
| a locked MR (GitLab is merging it) | refuses (`mr-locked`): run it again in a minute |
| the branch at a commit MIRAI didn't push | refuses (`remote-moved`), never overwrites it |

## Codes

| Code | What to do |
| --- | --- |
| `not-reviewed`, `no-proof`, `stale` | `mirai review <ticket>`, then `mirai gate record <ticket>` |
| `wrong-branch`, `dirty` | check out the ticket's branch; commit or stash your changes |
| `no-remote`, `bad-remote`, `no-host`, `wrong-host` | fix the `origin` remote, or `[git] host` / `host_url` on the integration branch |
| `host-unsupported` | a server on a port or a sub-path: not supported yet |
| `no-gh`, `gh-auth` | install `gh`, `gh auth login`, `mirai init --refresh` |
| `no-glab`, `glab-auth`, `glab-old` | install or upgrade `glab` (1.125.0+), `glab auth login --hostname <host>`, `mirai init --refresh` |
| `tls-off`, `bad-ca` | remove `skip_tls_verify` from glab's config; set `ca_cert` to an absolute, readable file |
| `host-failed` | the host or glab answered with an error (shown): check the project, your login, the server |
| `fetch-first`, `base-not-pushed` | `git fetch`, or push the integration branch first |
| `mr-merged`, `mr-closed`, `mr-locked`, `remote-moved` | look at the MR on the host |
| `secret`, `trailer-mix`, … | the push check's codes: `docs/pre-push.md` |
