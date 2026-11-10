---
unit: "27a"
name: ship
status: draft (Jet's five decisions, 2026-11-10; waiting for approval)
roadmap: design/07-implementation-roadmap.md, row 27 (split, Jet's decision 2026-11-10: **27a** `mirai ship` with a host interface and the GitHub host; **27b** the GitLab host, cloud and self-hosted; `mirai-ship`: push and open the MR targeting the integration branch via the host CLI with its own credentials; the MR description with the review line and follow-ups only, no review comments (Q9); idempotent MR creation, R-M6); design/01 §11 (ship); design/03 (`mirai-ship`, the git host); D-30 #9 (credentials stay with the orchestrator; an explicit push URL); D-29 (no findings on the host); D-34 (no ship gate: your merge is the gate); D-06/D-07 (`built` derived)
depends_on: ["09", "14b", "22", "24a", "25a", "26a"]
---

# Unit 27a: `mirai ship`, with GitHub

## Why

After 25a and 26, a reviewed ticket has signed proofs and a push check that trusts them, but nothing leaves your machine: you push and open the MR by hand. Row 27 makes MIRAI do it, as the orchestrator (never an agent): push the ticket's branch and open one MR against the integration branch, with a description that carries the review line and nothing a host shouldn't hold. There is no human step at ship; your merge is the gate (D-34).

Already built and waiting:

- **The MR description** (09b): `renderMrDescription(data)` and `MR_MARKER`, escaping every value, refusing tokens and follow-ups that cite a file or line.
- **The push check** (26a): `prePushCheck({ …, checkHooks: false })`, the same check the hook runs, for MIRAI's own push (26a decision 5).
- **Proofs** (25a): `checkProofs`; the review record's `followups` (Rex's non-blocking findings, 24a).
- **`built`** (04): `deriveTicketState(status, { mr, pushSeq, proofsValidAtHead })`, waiting for facts this unit provides.
- **Pinned git** (14b): no credential helper, no ssh, HOME `/var/empty`, `protocol.https.allow=always`.
- **`gh`** 2.103 on your machine, logged in to github.com (keyring); the sample app's remote is GitHub over https.

## Decisions (Jet, 2026-11-10, in the interview)

1. **Push credentials: `gh` as the helper.** Every pin stays. For the push only, one credential helper is set on the command line: your `gh` (`!'<gh>' auth git-credential`), with `<gh>` the absolute path `mirai init` recorded in the store. The token stays inside `gh` and git's memory: never on disk, in arguments, in the repo, or in an agent's reach. The push goes to the repo's https URL (`<host_url>/<owner>/<repo>.git`, the path from the registered remote), never through `remote.origin.*`. The GitLab host does the same with `glab` (27b, decision 5).
2. **`mirai ship <ticket>`**, a command of its own: `gate check` must pass for the branch's HEAD; it runs `prePushCheck` itself; then it pushes and opens or updates the MR. From your terminal or unattended (it signs nothing, so no terminal is needed). `gate record` ends with `next: mirai ship <ticket>`. Unit 28's `mirai run` calls the same function.
3. **A ready MR with short follow-ups.** Not a draft. Title `<ticket>: <ticket title>`. Why from the ticket; What changed from the plan's tasks; `Review: PASS after N rounds (MIRAI)` plus Rex's non-blocking findings as one-line follow-ups (their summary text only; a line the renderer refuses for citing a file or line is left out, and the description says how many were); QA: "QA hasn't run" (unit 51); Risk from the plan; Links: the ticket file.
4. **Reruns: update an open MR, refuse a closed one.** An open MR for the branch → push the new head and rewrite MIRAI's description in place (found by its marker), never a second MR. A merged or closed MR → refused (`mr-merged`, `mr-closed`), never reopened (closing is your decision). The remote branch at a commit MIRAI didn't push → refused (`remote-moved`), never forced; `--force-with-lease=<branch>:<sha MIRAI last pushed>` is for MIRAI's own rebased branch only.
5. **GitHub or GitLab, per project, in config** (Jet, 2026-11-10, after the interview): the pilot is on GitHub, but MIRAI must work the same on GitHub or GitLab, cloud or self-hosted. Ship talks to the host through one interface; the project's config says which host it is. **27a** builds the interface and the GitHub host; **27b**, right after, the GitLab host (`glab` as the credential helper, merge requests, GitLab's markdown, a self-hosted server's URL). Every later unit that talks to the host (28, 53, 54, 56) works on both.

Defaults taken with the decisions (not asked; say if you want them otherwise):

- **The host in config** (decision 5): `[git] host = "github" | "gitlab"`, and `host_url` for a self-hosted server (`https://gitlab.example.com`; the cloud's `https://github.com` or `https://gitlab.com` when left out). Read only from the integration branch's config, so a branch can't point ship at another server. `mirai init` fills it in from the remote when the remote's host is `github.com` or `gitlab.com`, and otherwise asks (a self-hosted server can't be told from its address); you commit it with the rest. The repo's path on the host (`owner/repo`, or GitLab's `group/subgroup/repo`) comes from the remote. In 27a a `gitlab` host is valid config but ship refuses it (`host-not-built`, unit 27b).
- **`gh` is found and recorded by `mirai init`** (an absolute path on your PATH, a regular executable file you own or root owns, never inside the project), in the store beside the hooks record; ship refuses without it (`no-gh`, run `mirai init --refresh`) or when `gh auth status` isn't logged in to the configured host (`gh-auth`, run `gh auth login`). `gh` runs with your HOME and PATH and nothing from the project's environment; inside git's helper it gets `GH_CONFIG_DIR` (your `~/.config/gh`), since git's pinned HOME is empty.
- **The base must be on the host:** the merge-base with the integration branch must be reachable from the host's integration branch (read with `gh api`), or the MR would carry your unpushed main commits → refused (`base-not-pushed`, push main first).
- **The journal records each ship** (`shipped`: ticket, branch, head, MR number and URL, its state as seen); `mirai status` then shows the ticket `built` (MR open, proofs valid at the head MIRAI pushed) with the MR's URL, from the journal, with no network call. Noticing a merge or a close on the host is unit 28's (the run checks its MRs) and 56's (the morning report).
- **The branch name on the host is the local one** (`feature/<ticket>-<slug>`, unit 22's pattern).

## Scope

**In.**

1. **The host interface** (`src/ship/host.js`): `hostFor(config, remoteUrl)` → a host with `name`, `pushUrl`, `credentialHelper`, `checkAuth`, `integrationTip`, `remoteBranch`, `findMr`, `openMr`, `updateMr`, and the renderer's `host` (`github` or `gitlab`, 09b already has both). Ship never calls `gh` directly. **The GitHub host** (`src/ship/github.js`), through `gh`: `findGh(env)` (the recorded path, checked), `ghJson(args)` (pinned env, a timeout, JSON out), `repoOf(remoteUrl, hostUrl)` (`owner/repo` from an https or `git@<host>:` remote on the configured host; another server refused, `wrong-host`), `remoteBranch(repo, branch)` and `integrationTip(repo, branch)` (`gh api`), `findMr(repo, branch)` (`gh pr list --head <branch> --state all --json number,state,url,body,baseRefName,headRefOid`), `openMr` (`gh pr create --repo --base --head --title --body-file`), `updateMr` (`gh pr edit <n> --body-file`). The body goes through a private temp file (0600, removed after), never an argument.
2. **`src/store/git.js` `pushBranch(root, url, branch, sha, env, { gh, lease })`:** pinned git with `-c credential.helper=` (reset) then `-c credential.helper=!'<gh>' auth git-credential`, `GH_CONFIG_DIR` in its environment, `push --porcelain <url> <sha>:refs/heads/<branch>` (with `--force-with-lease=refs/heads/<branch>:<expected>` only when asked), `--no-verify` (MIRAI's check ran just before; its git has hooks off anyway). Added to `git-probes.js --mirai`.
3. **`src/ship/ship.js` `shipTicket({ cwd, env, ticket })`:** the ticket in-review with a passing review; HEAD on its branch (build record), a clean tree; `gate check` passes; `prePushCheck` for the update passes; the base is on the host; the MR state (decision 4); push; open or update; the journal event. Returns `{ outcome: 'opened' | 'updated' | 'unchanged' | <refusal code>, mr: { number, url }, head }`.
4. **The description** (`src/ship/describe.js`): the data for `renderMrDescription` from the ticket file (title, why), the plan's tasks (what changed), the latest review record (rounds; follow-ups as above), the plan's risk, the ticket path.
5. **`mirai ship <ticket>`** (`src/cli/commands/ship.js`): prints the outcome, the MR's URL, and `pushed <sha>`; exit codes as gate's. `gate record`'s last line names it. `init` records `gh`. `mirai status` shows `built` and the URL.
6. **Docs:** a new `docs/ship.md` (what ship does, the credentials, the codes, reruns); D-30 #9 "Update (unit 27)"; design/01 §11 and design/03's git-host row (GitHub through `gh` in A); roadmap row 27.

**Out.**

- **QA** in the description and the QA proof: unit 51. **`mirai trace`** before ship: unit 43.
- **Stacked MRs** (target the parent, retarget, rebase with lease): unit 53. **`feature/<epic>`**: unit 67.
- **Noticing merges and closes on the host**, CI status: units 28, 54, 56.
- **The GitLab host** (`glab`, merge requests, GitLab's markdown, self-hosted URLs and certificates): **27b**, right after this unit.

## Probes (with your OK)

One manual run, about 12 minutes and one Sonnet review (as 26b's P1), in a probe clone of the sample app with a probe home **whose remote is the real `mirai-sample-app` repo on GitHub** (private, yours): this probe opens a real PR there, and its last step closes it and deletes the branch.

- **P1.** SAMPLE-1 built, reviewed by Rex, `gate record`; then `mirai ship SAMPLE-1` → the branch pushed through `gh`'s helper, one ready PR against `main` with the template (no file or line in it); `mirai ship` again → `unchanged`, still one PR; a new commit's proofs, then ship → `updated`, the same PR; the PR closed (by the probe) → ship refuses `mr-closed`. Then the branch deleted on GitHub. Also: the push's process arguments and the probe home hold no token.

## Files

- **New:** `src/ship/host.js`, `src/ship/github.js`, `src/ship/ship.js`, `src/ship/describe.js`, `src/cli/commands/ship.js`, `docs/ship.md`, tests in `test/ship/`, `test/probes/ship-probes.js`.
- **Changed:** `src/config/config-schema.js` (`git.host`, `git.host_url`), `src/store/git.js` (`pushBranch`), `src/cli/commands/init.js` (record `gh`, fill in the host), `src/cli/commands/gate.js` (the next line), `src/cli/commands/status.js` (`built`, the URL), the command list, `src/redteam/probes/git.js`, docs.

## Tests (`npm test`, no model, no network; a stand-in `gh` and a bare repo as the host's git)

- The push: `pushBranch` to a bare repo by path (the pins allow `file`; no credentials are asked) lands the sha on the branch; its git arguments name the recorded `gh` as the only helper and hold no token; a `credential.helper` in the repo's config is never run; the lease refuses a moved branch. (The helper's real round trip through `gh` is P1's: it needs GitHub.)
- The host: `git.host` and `git.host_url` validated (a URL is https, no path, no credentials); init fills in `github` for a `github.com` remote and `gitlab` for `gitlab.com`, and asks otherwise; `gitlab` → `host-not-built` in 27a; a remote on another server than the configured one → `wrong-host`; the work tree's config changing the host is ignored (the integration branch's is read).
- `gh` checks: not recorded → `no-gh`; not logged in → `gh-auth`.
- Ship: no proofs or stale → refused (`no-proof`, `stale`) before any push; `prePushCheck` blocking (a secret) → refused; the base not on the host → `base-not-pushed`; no MR → push and `opened` (the stand-in records `pr create` with base `main`, the title, the body file's text); again → `unchanged`, no second `create`; a new head → `updated` (`pr edit`); closed or merged → refused; the remote branch at another sha → `remote-moved`.
- The description: the review line with N rounds; a follow-up with a file path left out and counted; no finding object; "QA hasn't run"; the marker first.
- The journal's `shipped` event; `mirai status` shows `built` with the URL.

## Done when

- The tests pass, P1 is recorded in `test-results.md`, and after the sample app's refresh the red team is green and the baseline signed. The row's done-when: a sample-app MR opens with the template against `integration_branch`; running it twice opens one MR; no MIRAI-written text in the MR holds findings.

## Open points for you

The five decisions are taken (above), and five defaults are named. Approve the spec, or say which default to change. P1 opens and closes a real PR on your private `mirai-sample-app` repo.
