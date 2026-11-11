---
unit: "27b"
name: gitlab
status: approved (2026-11-11; Jet's two interview decisions, the defaults as written)
roadmap: design/07-implementation-roadmap.md, row 27 (split, Jet's decision 2026-11-10: **27b** the GitLab host, cloud and self-hosted, right after 27a; every later unit that talks to the host works on GitHub and GitLab alike); 27a's spec, decision 5 (the host per project in config); D-30 #9 (credentials stay with the orchestrator; an explicit push URL); D-29 (no findings on the host)
depends_on: ["27a"]
---

# Unit 27b: the GitLab host, cloud and self-hosted

## Why

27a built `mirai ship` behind a host interface, with GitHub as its only host. For a `gitlab` host, ship refuses `host-not-built`. Your decision (2026-11-10) was that MIRAI must work the same on GitHub or GitLab, cloud or self-hosted, set per project in config. The pilot is on GitHub, but a later project may be on GitLab. This unit adds the GitLab host. After it, ship on a GitLab project does what it does on GitHub: it pushes through `glab`'s login, opens one ready merge request (MR) with MIRAI's description, updates it on reruns, and refuses a closed or merged one.

Already built and waiting:

- **The interface and ship** (27a): `hostFor`, `shipTicket`, `pushBranch` with a helper of the form `{ command, home, configDir, configVar }`. `cliEnv` has a first GitLab branch, which the research found wrong (below). Config already has `git.host = "gitlab"` and `git.host_url`.
- **The renderer's GitLab mode** (09b): `renderMrDescription(data, { host: 'gitlab' })`, with a 500 000-character limit and `!N` references. A line can't start with `/`, which is how GitLab spots a command (a "quick action"). `@`, `#`, `!`, `%`, `~`, `&`, `$` and `:emoji:` words are shown as code spans.

## What the research found (glab 1.130.0, the docs and the source; nothing run yet)

- **The credential helper exists but is hidden:** `glab auth git-credential get`. Only `get` does anything; `store` and `erase` do nothing. It returns the username `oauth2` for a browser login, and the host's `user` setting (or `glab`) for a personal access token. Recent fixes matter: a non-blank username for tokens (2026-07) and access-token-only OAuth (2026-09).
- **Tokens live in the macOS Keychain** (glab's default since 2025). As with `gh`, glab finds them only with your real HOME.
- **glab's config folder isn't where 27a looks.** It looks in `$GLAB_CONFIG_DIR` if set, else `~/.config/glab-cli` if a `config.yml` is already there, else `~/Library/Application Support/glab-cli` on macOS. 27a always passes `~/.config/glab-cli`, so on a fresh Mac a logged-in glab would look logged out.
- **glab phones home by default:** an update check after each command, telemetry, and a what's-new notice. Each can be turned off with a variable.
- **`glab api --hostname` takes a bare host name only** (no `:port`, no `/path`). Host names with a port or a sub-path are matched against glab's config in ways the docs don't describe.
- **Quick actions run when an MR is created and when it's edited, through the API too.** That includes `/merge`, `/close`, `/approve` and `/assign`. They only count at the start of a line and never inside code. **References**: `@all` notifies everyone; `#12`, `!12`, `~label`, `%milestone`, `&12`, `$12`, `[[_TOC_]]`, `^alert#…` and bracket forms like `[issue:…]` all link or render. A code span is the reliable neutraliser.
- **A title starting with `Draft:`, `[Draft]` or `(Draft)` makes the MR a draft.**
- **MR states:** `opened`, `closed`, `merged`, `locked`. `locked` is a short-lived state while GitLab merges.

## Decisions (Jet, 2026-11-11, in the interview)

1. **Self-hosted means a server on its own address, plus company certificates.** `host_url = "https://gitlab.acme.com"` works, with a certificate from a company authority. A `host_url` with a port (`https://git.acme.com:8443`) or a sub-path (`https://acme.com/gitlab`) is refused when the config is read (`host-unsupported`, saying it's listed as later work). The cloud (`gitlab.com`) needs no `host_url`.
2. **Proven on gitlab.com and on a throwaway GitLab server.** P1 runs on gitlab.com, on a private copy of the sample app on your free account. P2 runs on GitLab's free server (GitLab CE) in Docker on your Mac. It gets its own name (`gitlab.mirai.test`) and a self-signed certificate, and it's removed afterwards. I script the setup; you run a few commands, including one `sudo` line that adds the name to `/etc/hosts`.

Defaults taken with the decisions (not asked; say if you want them otherwise):

- **`glab` is the only credential helper,** exactly as `gh` is for GitHub. The helper runs as `!HOME='<home>' GLAB_CONFIG_DIR='<dir>' '<glab>' auth git-credential`, with `<dir>` resolved the way glab resolves it (above). The push goes to `<host_url>/<group>/<…>/<repo>.git`. The token stays inside glab, the Keychain and git's memory.
- **A minimum glab version.** `mirai init` records glab's path and version; ship refuses an older one (`glab-old`, saying to upgrade). The floor is the first release with both 2026 helper fixes. I'll find it during the build; 1.130.0 has them.
- **glab's environment:** your HOME, the resolved `GLAB_CONFIG_DIR`, `GITLAB_HOST`, `/usr/bin:/bin` on PATH, no prompts (`GLAB_NO_PROMPT=1`), no colour, and `GLAB_CHECK_UPDATE=false`, `GLAB_SEND_TELEMETRY=false`, `GLAB_SHOW_WHATS_NEW=false`. It runs from `/`, so no project's git remote steers it. Nothing from the project's environment passes through, including `GITLAB_TOKEN`, which would otherwise beat your stored login.
- **Everything through GitLab's API (`glab api`),** never the `mr` subcommands. Each call returns JSON with `iid` and `web_url`, so nothing depends on glab's printed text, and the body goes as a JSON file (`--input`, a private 0600 temp file), never an argument.
  - Branch tip: `projects/<path>/repository/branches/<branch>` (each part URL-encoded). A 404 means no branch.
  - Find: `projects/<path>/merge_requests?source_branch=<b>&state=all` (an open one first, else the newest).
  - Open: `POST projects/<path>/merge_requests` with `source_branch`, `target_branch`, `title`, `description`.
  - Update: `PUT projects/<path>/merge_requests/<iid>`.
  - `checkAuth`: `glab auth status --hostname <host>`. Logged out → `glab-auth`, with the exact `glab auth login --hostname <host>` line.
- **Company certificates:** if glab's config names a `ca_cert` for the host, MIRAI's push passes the same file to git (`-c http.sslCAInfo=<file>`, for the push only), so glab and git trust the same authority. The file must be absolute and readable; otherwise ship refuses `bad-ca`. With no `ca_cert`, the system's trust applies, for example a company authority already in your Keychain. MIRAI never turns verification off: a `skip_tls_verify` in glab's config is refused (`tls-off`).
- **`locked` MRs:** ship refuses `mr-locked` ("GitLab is merging it; run it again in a minute"). `opened` maps to `open`.
- **Titles:** a leading draft marker (`Draft:`, `[Draft]`, `(Draft)`, `WIP:`) is removed from the title on both hosts, so a ticket's title can't turn the MR into a draft.
- **GitLab's markdown:** the renderer's GitLab mode gains what the research added: `^` (alerts), `*iteration:`, `[[_TOC_]]` and `[TOC]`, and bracket references (`[issue:…]`). Each is shown as a code span or escaped. A test feeds every reference form and every quick action at the start of every section and asserts it's inert. P1 then checks on gitlab.com that the rendered MR mentions, links and runs nothing.
- **The project's MR settings stay the project's:** MIRAI doesn't set delete-source-branch, squash, assignees, reviewers or labels.
- **`mirai init`** writes `host = "gitlab"` for a `gitlab.com` remote in a new config, as 27a does. For a self-hosted remote it writes nothing and prints how to set `host` and `host_url`. Ship then refuses `no-host` until they're in the config on the integration branch.

## Scope

**In.**

1. **`src/ship/gitlab.js`:** `gitlabHost({ hostUrl, repo, cli, env, cliHome })` with the same shape as `githubHost`. `glabConfigDir(env, home)` resolves the config folder as glab does. `glabCa(configDir, host)` reads `ca_cert` and `skip_tls_verify` for the host from glab's `config.yml`, with a small line reader for those two keys under `hosts:` → `<host>:`, not a YAML library. `projectPath(repo)` URL-encodes the project path.
2. **`src/ship/host.js`:** `hostConfig` refuses `host-unsupported` for a port or path in `host_url`. `hostFor` builds the GitLab host (no more `host-not-built`). `cliEnv` gets the fixes above. `recordCli` records glab's version. The title cleaner is shared by both hosts.
3. **`src/store/git.js` `pushBranch`:** a `ca` option (an absolute file) adds `-c http.sslCAInfo=<file>`.
4. **`src/reports/render.js`:** the extra GitLab references.
5. **Docs:** `docs/ship.md` (GitLab: login, self-hosted, certificates, the codes); design/03's git-host row; D-30 #9's update; roadmap row 27 (27b built).

**Out.**

- **Self-hosted servers on a port or a sub-path,** and OAuth (browser) login on a self-hosted server, which needs an OAuth app registered there. A token login works. Both are listed as later work.
- **GitLab CI** (unit 54; GitLab has no `pull_request_target`, so it needs its own design). **Noticing merges and closes** (units 28, 56), stacked MRs (53): each will work on both hosts when built.
- **ssh remotes for the push:** the push is https through the helper on both hosts, as in 27a. An ssh `origin` still names the repo.

## Probes (with your OK)

**Before the build, three quick checks with glab installed** (no MR, a few minutes): the helper's `get` on gitlab.com returns a username and a token to git, from a HOME-only environment; `glab auth status` exit codes; and the `ca_cert` line reader against a real `config.yml` glab wrote.

- **P1, gitlab.com** (about 12 minutes and one Sonnet review, as 27a's P1). A probe clone pushes to your private `mirai-sample-app` copy on gitlab.com. The steps:
  1. A throwaway base branch.
  2. `mirai ship SAMPLE-1` opens one ready MR with the template.
  3. Again → `unchanged`. The description edited on GitLab → `updated`, MIRAI's text back. The MR closed on GitLab → `mr-closed`.
  4. A ticket title holding `Draft:`, `@all`, `#1` and a line `/close`: the MR stays ready, open, mentions nobody (no to-do or notification on your account) and links nothing.
  5. No token in the probe folder.
  6. Cleanup: the MR closed, both branches deleted. GitLab can delete an MR (GitHub can't), so the probe deletes it too.
- **P2, a local GitLab CE** (about 25 minutes, mostly GitLab starting up). Docker runs `gitlab/gitlab-ce` on port 443 as `https://gitlab.mirai.test`, with a self-signed certificate authority made for the run. A root user and a token are created by script; you log glab in with that token and `ca_cert`. Then:
  1. Ship opens an MR and a second run is `unchanged`.
  2. With `ca_cert` removed from glab's config, ship refuses before pushing (glab's TLS error, reported as `host-failed`). With `skip_tls_verify: true`, it refuses `tls-off`.
  3. A `host_url` with `:8443` → `host-unsupported`.
  4. Cleanup removes the container, its volumes, the certificate and the `/etc/hosts` line (one more `sudo`).

## Files

- **New:** `src/ship/gitlab.js`; tests in `test/ship/gitlab.test.js` with a stand-in `glab` that serves the API calls and a bare repo; `test/probes/gitlab-probes.js` (the quick checks, P1, P2); `test/probes/gitlab-ce/` (the Docker setup and teardown scripts).
- **Changed:** `src/ship/host.js`, `src/store/git.js`, `src/reports/render.js`, `src/cli/commands/init.js` (glab's version; the self-hosted hint), `src/redteam/probes/git.js` (the `ca` option), docs.

## Tests (`npm test`, no model, no network)

- **Config:** `gitlab.com` without `host_url` works; a self-hosted server without `host` → `no-host`; `host_url` with a port or a path → `host-unsupported`; a remote on another server → `wrong-host`.
- **glab:** the config folder resolved in glab's order (the env variable, the legacy folder only when its `config.yml` exists, Application Support); not recorded → `no-glab`; too old → `glab-old`; logged out → `glab-auth`; the env holds no `GITLAB_TOKEN` and sets the three phone-home switches off.
- **Certificates:** `ca_cert` read for the right host only, and passed to the push as `http.sslCAInfo`; relative or missing → `bad-ca`; `skip_tls_verify: true` → `tls-off`.
- **The push:** its helper names the recorded glab and the resolved folder, and holds no token.
- **Ship on GitLab** (the stand-in): opened (the POST's JSON holds the base, title and description), `unchanged`, `updated` (PUT), `mr-closed`, `mr-merged`, `mr-locked`, `remote-moved`, `base-not-pushed`; a project in a subgroup addressed as `group%2Fsub%2Frepo`.
- **The markdown:** every quick action and every reference form, placed at the start of each section and inside follow-ups, comes out inert; draft markers leave the title on both hosts.
- **The GitHub host is unchanged:** 27a's tests still pass.

## Done when

- The tests pass. The quick checks, P1 and P2 are recorded in `test-results.md`. After the sample app's refresh, the red team is green and the baseline signed. For the row: a GitLab MR opens with the template against `integration_branch`, on gitlab.com and on a self-hosted server with its own certificate; running ship twice opens one MR; no MIRAI-written text in the MR holds findings, runs a quick action, or mentions anyone.

## What you'll do by hand (when we get there; exact commands then)

1. Install glab: `brew install glab`.
2. Make a free gitlab.com account, create a private project `mirai-sample-app`, and push a copy of the sample app to it.
3. `glab auth login --hostname gitlab.com` (in the browser).
4. For P2: Docker Desktop running, with 4 GB or more of memory for it, and two `sudo` lines (add and then remove the `/etc/hosts` entry).

## Open points for you

The two decisions are taken (above), and the defaults are named. Approve the spec, or say which default to change.

## Changes during the build (2026-11-11)

1. **The quick checks, on this Mac with glab 1.130.0** (installed from GitLab's own release, checksum checked: Homebrew no longer builds for Intel Macs). The helper's `get` answered from a HOME-only environment run from `/`: username `oauth2`, a password, `password_expiry_utc` and `oauth_refresh_token` (git ignores the last two unless another helper stores them; MIRAI's push resets every other helper). `auth status` exits 0 logged in, 1 for an unknown host, and 1 with 27a's folder (`~/.config/glab-cli` exists here but has no `config.yml`, so glab uses `~/Library/Application Support/glab-cli`): the bug the research found, confirmed. `config.yml` holds `hosts:` → `gitlab.com:` → `ca_cert`, `skip_tls_verify`, `user`, `use_keyring`, as the line reader expects. **A mistake in the first check:** its filter hid only the `password` line, so the refresh token was printed into the session; Jet re-logged in, and was asked to revoke the old grant. Every later check prints only named fields.
2. **The glab floor is 1.125.0** (2026-10-27: the helper's output from the resolved credential; 1.117.0 brought access-token-only OAuth). **Ship checks the version live** (`glab --version`, in `checkAuth`), so an upgrade needs no refresh; `mirai init` prints it on its `host CLIs:` line, with "too old" below the floor. Nothing extra is recorded in `host-tools.json`.
3. **The helper's command carries glab's quiet switches too** (`GLAB_CHECK_UPDATE`, `GLAB_SEND_TELEMETRY`, `GLAB_SHOW_WHATS_NEW`, `GLAB_NO_PROMPT`): `pushBranch`'s helper takes `vars`, plain names and values only.
4. **The push pins `http.sslVerify=true`** beside the CA file. The repo check already refuses `http.*` in a repo's own config (14b), so this is a second guard.
5. **`mirai init` doesn't ask** for a self-hosted host (it has no prompt for it, as in 27a): it prints the `[git] host` / `host_url` lines to add.
6. **P1's poisoned MR** is rendered by MIRAI and opened through the real host's `openMr` on a branch of its own, rather than built from a poisoned ticket title (the seeded ticket's title is fixed). It checks GitLab's rendered HTML for reference links, the MR's notes for quick-action system notes, its state, draft flag, labels and assignees, and your pending to-dos. The to-do count is a weak check: GitLab makes no to-do for an author's own mention.
7. **The token check** takes your GitLab password and refresh token from glab's helper inside the probe process and searches the probe folder for them, logging counts only.
8. **P2's server** is `gitlab/gitlab-ce:19.5.1-ce.0` on `127.0.0.1:443`, with a 2-day certificate authority made by `test/probes/gitlab-ce/setup.sh`; root's token is made inside the server and goes to `glab auth login --stdin`, never printed. `teardown.sh` removes it all.
9. **The git probe** gained `pushBranch-ca` (a CA file and helper variables, to a bare repo by path); all 38 cases passed (2026-11-11).
10. **glab writes a fresh `config.yml` into a config folder that has none**, and from then on a legacy `~/.config/glab-cli/config.yml` beats the real one. Quick check 2 ran `auth status` with 27a's folder and so left an empty config there; glab itself then answered 401 until it was moved aside. MIRAI passes the folder glab really uses, so it never creates one.
11. **One host per repo; services may differ** (Jet, 2026-11-11): a repo is on GitHub or GitLab, never both, and a project's services can be on different hosts. Separate MIRAI installs per service repo work today (each config names its host; init records both CLIs). Workspace mode (row 72) gets `host` / `host_url` per `[[repos]]` entry: added to the roadmap row.
12. **An MR opened right after the push is tried again** (P2's first run): GitLab registers a pushed branch in a background job, and the local server refused the poisoned MR "source_branch does not exist" seconds after its push (the branch was there for the cleanup). `openMr` tries that one refusal again, about 30 s in all; a test plays it (made on the third try; given up on after four). The probe also makes sure the project has `main` as its default branch (P2's project started empty, so the first pushed probe branch became the default, which GitLab won't delete) and removes `mirai-probe/*` branches a stopped run left behind.
13. **P2's second run passed, and its review found a 24a bug:** a normal review's `index.json` was the plan stage's, listing only `plan.md` and `ticket.md`, so Rex (told to read it first) once reviewed the checkout instead of `review.diff`. The index now names every file in the folder; the review tests check it. Also from P2: an emptied `ca_cert` ends at `glab-auth`, whose message now says "isn't logged in, or can't reach the server" and names `glab auth status` and `ca_cert`.
