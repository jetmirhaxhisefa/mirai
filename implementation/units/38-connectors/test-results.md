# Unit 38: test results (2026-11-22)

## Tests

- **`test/store/connector-contract.test.js`:**
  - T1: `repo` and `local` (`registry/connectors/*.toml`) validate, each with the six verbs and a
    setup proof. Refused, naming the field: a missing verb (`verbs is missing "query"`), an unknown
    verb (`verbs[6] is "delete"`), a status mapped to a state MIRAI doesn't have
    (`status_map.merged maps to "shipped"`), a type no store holds (`holds[6]`), an unknown key, an
    external store without `sync_window_minutes`, and a file named for another connector. One type
    with two homes is refused by `checkHomes` (`holds.prd`: "the prd type has two homes, the repo
    store and the fake-external store");
  - T2: the same cases on `repo`, `local` and the fake external store
    (`test/fixtures/connectors/fake-external.js`): write then read returns the same bytes; `query`
    lists the initiative's documents with type and state; `pathOf` gives the initiative's and a
    lone ticket's paths; the lint and `readApprovedFile` read the file at `pathOf` and name it by
    `relOf` (`<docsRoot>/due-dates/prd.md`); the fake's planted instruction reaches the
    agent-facing text only inside the fence; its status is stale 20 minutes after a sync (15-minute
    window) and fresh at 5; MIRAI's own stores are never stale; the fake saying "signed_off" changes
    no gate (`approvalGaps` still finds no signed approval);
  - the fence holds against text that writes its own end marker.
- **`test/store/docs-store.test.js`** (T3): with `[docs] store = "local"` on main, the brief,
  interview and PRD written through the store land in
  `<MIRAI home>/projects/<repo id>/docs/due-dates/`; `mirai lint` lints them with the repo's (a
  broken file is named by its full path; a named path lints alone); `mirai reader-test` and
  `mirai approve due-dates-prd --file <full path>` read them there (two signed lines,
  `docs/due-dates/brief.md` and `docs/due-dates/prd.md`); the approval's last line is the PRD's full
  path; `mirai show due-dates` lists them approved with their paths; `git status` is empty and the
  repo has no `docs/`; doctor's Document store item says teammates can't see them;
  `mirai docs publish` does nothing and says so. A personal file setting `docs.store` is refused; an
  unknown store is refused (`enum`). Back to `repo` on main once the local store has a document:
  `mirai show` and `mirai docs publish` are refused (exit 4), naming `mirai docs move` as later work.
- **`test/store/docs-publish.test.js`** (stand-in `gh` and `glab` over a bare repo,
  `test/helpers/fake-hosts.js`):
  - T4: the first publish makes `docs/due-dates` from the host's main, one commit holding only the
    initiative's 11 files, author you and committer MIRAI; your branch and work tree are untouched;
    one PR, its description naming each document with its state; `docs_published` in the journal.
    After an edit, a second publish adds one commit to the same branch and updates the same PR;
    a third is `unchanged`. A commit with `src/app.js` on the docs branch is refused before the push
    (`not-docs-only`, naming it), and the host's branch doesn't move;
  - T5 (GitHub): refused, naming the gap, with main unmoved each time: no approvals (each document,
    and no ticket-set approval); the PRD approved but not the epic; a ticket changed after the
    epic's approval; a lint error (a stray `notes.md`); a head someone moved on the host. Checks
    running: "waiting for: its checks are still running (docs-ci)", exit 4, left open; a required
    review: "waiting for: a branch rule blocks it". Then a later run merges at the checked head;
    main has the PRD; `docs_merged` records the head and the merge commit; a further run says
    already merged;
  - T6 (GitLab): publish, update, the code-path refusal, a changed-after-approval refusal, a
    running pipeline (waiting), then the merge, all through `glab`; every one of its calls had the
    `GLAB_CONFIG_DIR` given, never glab's default folder;
  - T8: `mirai docs publish` lists each document's full path with its
    `https://github.com/acme/app/blob/docs/due-dates/…` link and ends with the folder and its
    `…/tree/docs/due-dates/…` link; GitLab's `…/-/blob/…` and `…/-/tree/…`; `mirai approve`'s last
    line is the PRD's path and its link once the docs branch holds those bytes; after the merge,
    `docs merge` and `mirai show due-dates` give the `…/blob/main/…` link. A local document has none.
  - the follow-up (the push check): a document holding a GitHub-token-shaped canary is refused by
    26a's secret scan (`secret`: "a secret (github-token) in docs/mirai/due-dates/notes-secret.md
    in <commit>; nothing was pushed"); the secret appears in no message, hint, finding or CLI
    output; the docs branch isn't made here or on the host, and no merge request opens. Without the
    canary the same publish passes and opens the merge request.
- **`test/ship/lone-ticket.test.js`** (T7, macOS only, as 27a's ship tests): PMT-31 (in
  `docs/mirai/tickets/`) is a lone ticket; its own file changed on its branch rides in its MR with
  the fix, and the proof still passes; a PRD of an initiative on the same branch is refused
  (`docs-in-code-mr`) before anything is pushed.
- **T9:** the suites of 31–37 pass with their paths read through the store (see the full suite).
  Changed pins: the command list (`docs`), the journal's event types (`docs_published`,
  `docs_merged`), doctor's items (`docs-store`, 21 items).

## Probes (real)

P1 and P2 passed with Jet (2026-11-22): GitLab MR 5 merged as 0dc820f, GitHub PR #16 merged as
00c4d0f; the sample app's main is level at 00c4d0f. P3 passed with Jet (2026-11-22): SAMPLE-60 (a
lone bug ticket) planned, built test-first, reviewed by Rex (who used his approved Bash overlay),
proofs recorded, PR #17 opened; its diff held the fix and MIRAI's records and no document (the
ticket file was on main already, D-54); `mirai merge` took it in as 5805b2d, SAMPLE-60 done. P4 passed
with Jet (2026-11-22) in ~/Projects/mirai-p4-local: brief and PRD in MIRAI's store, approved,
`git status` clean, `mirai show` paths in the store, doctor's "teammates can't see these documents".
`git-probes.js --yes --mirai` passed (every probe, the two new docs calls inside each). Found on P3/P4:
(d) P4's written steps ran `mirai key new` before committing `.mirai/framework`, so the launcher's
seal refused it (correctly); commit first, then `key new`, then commit the public key; (e) both of
Kai's plan launches on SAMPLE-60 began with a Read/Glob "outside the project" (refused by the cage;
the run went on): worth a look at why the sample app gives Kai a reason to look outside. `test/probes/connector-probes.js` holds the setup and the checks; the
steps with your key and the pushes are yours.

Found on P1/P2 (to fix):
- On GitHub, `mirai docs publish` says "merge request 16"; GitHub's word is "pull request".
- In the GitLab checkout (another remote, so another repo id and store), the approved Rex overlay's
  record shows "doesn't verify: the signature does not match". An approval record should survive a
  second remote or a mirror: a 37 follow-up.
- P1's step 7 needed a fresh `mirai reader-test` on the changed PRD before approving it again: the
  steps given to Jet left it out.

In the sample app's checkout, in your terminal:

- **The setup** (added after the approval): `node <mirai>/test/probes/connector-probes.js --setup
  github|gitlab --initiative due-dates` writes 33's example initiative into the checkout's
  `docs/mirai/due-dates/` from MIRAI's `registry/examples/` (the brief's Q-1 answered in the brief
  and the PRD), not committed: publish takes the folder from the work tree. The ids you approve:
  `due-dates-prd` (with `due-dates-brief`) and `SAMPLE-50`. Proven on a throwaway clone of the
  sample app (a temp HOME, no remote): the setup wrote 11 files, `mirai lint docs/mirai/due-dates`
  gave 0 problems, `mirai show due-dates` listed the four documents (epic with 7 tickets), and the
  lint as at approval was clean for the brief, the PRD, the epic and every ticket, before and after
  the probe's PRD edit (`the evening reminder` → `the nightly reminder`, outside the summary).
- **The GitLab copy:** `jettmir.h/mirai-sample-app` on your personal gitlab.com
  (`GLAB_CONFIG_DIR=~/.config/glab-personal glab repo list`). Its main is at afdbc23 (2026-11-11,
  "Refresh MIRAI: mirai ship (unit 27a)"), an ancestor of the sample app's main (8454cbd, MIRAI at
  38): a fast-forward push brings it up to date.
- **P1 (GitLab, personal gitlab.com only):** every command with
  `GLAB_CONFIG_DIR=~/.config/glab-personal` (the checks refuse a GitLab project without it):
  1. `mirai docs publish due-dates`, then
     `node <mirai>/test/probes/connector-probes.js --check published --initiative due-dates`
  2. `mirai approve due-dates-prd --file docs/mirai/due-dates/prd.md`, then `--check refused`
  3. `mirai approve SAMPLE-50 --file docs/mirai/due-dates/epic-due-dates.md`; the PRD edit above; `mirai docs publish due-dates`; then `--check stale`
  4. `mirai approve due-dates-prd --file docs/mirai/due-dates/prd.md`; `mirai docs publish
     due-dates`; `mirai docs merge due-dates` (again if it says "waiting for"); then `--check merged`
- **P2 (GitHub, the sample app from 27a):** the same steps, without `GLAB_CONFIG_DIR`.
- **P3:** `--setup bug --ticket SAMPLE-60` writes a small real bug in the sample app ("Pressing Add
  twice quickly adds the task twice", `frontend/src/components/AddTaskForm.tsx`), approved and
  committed on main (D-54), then `mirai run` to its MR, `--check lone --ticket SAMPLE-60`,
  `mirai merge SAMPLE-60`, `--check lone-merged --ticket SAMPLE-60`. Proven on a throwaway clone at
  00c4d0f: the file is written, `mirai lint` and the lint as at approval are clean. `--check lone`
  now expects no document in the MR but the ticket's own file, which under D-54 is already on main.
- **P4:** `--setup local --initiative due-dates` writes the brief, interview and PRD through the
  local store; `--check local` also checks the brief and PRD show as approved. Proven on a throwaway
  project (temp HOME): init, `store = "local"` committed, the setup, `mirai lint` (3 files, 0
  problems), `mirai show due-dates`, and `--check local` passed every line but the approval (no key
  there). Found on the way: the first setup wrote the folders 0755 (its own mkdir, not the store's
  write), and doctor's store item went red, as it should; the setup now writes through the store.
- **The new git calls:** `docsCommit` (the docs commit on a private index: `read-tree`,
  `rm --cached --force`, `hash-object -w --stdin`, `update-index --index-info`, `write-tree`,
  `rev-parse`, `commit-tree`) and `setDocsBranch` (`update-ref`) are in `MIRAI_STEPS`, so they run
  with `node test/probes/git-probes.js --yes --mirai` (and in the red team's git probes). Not run
  yet.
- **P4:** a throwaway project with `[docs] store = "local"` on main, a brief and PRD written there
  and approved, then `--check local --initiative <name>`.

## Changed from the spec

- **Journal event names:** `docs_published` and `docs_merged` (the journal's names use `_`), not
  `docs-published` / `docs-merged`. `item` is the initiative.
- **The stores' verbs are split in code:** `repo.js` and `local.js` hold pathOf, read, write and
  setup; `verbs.js` adds query, status and publish. The red team's cage test showed the lint and
  init would otherwise import the approval code (and `src/agent/plan.js`) into the cage.
- **`mirai lint` and `mirai epic render` read `[docs] store` from the work tree's project file**,
  as `mirai lint` reads `docs.root`, not from a fresh trust root: building one inside the lint
  changed `mirai trust check`'s answer (launch T5). Approval, show, the reader test, publish and
  merge read it from the integration branch.
- **The lint's `--fix` output (Scope 7):** `mirai lint` has no `--fix`, so there is no such line.
  `mirai epic render` already ends with the epic's path.
- **A store change is recorded** in `<store>/docs-store.json` the first time a command sees an
  allowed change (an empty old store), so the next change is checked against it. A project with
  no record counts as `repo`, the store every project had before 38. That is a small store write
  from `mirai show`.
- **A non-Markdown file in the initiative's folder** (an image) is published, and blocks the merge
  as a gap ("isn't a document"): conservative, see Questions.
- **The push check on a docs branch is 26a's secret scan** (`docsPushScan` in
  `src/hooks/pre-push.js`: the same patterns from the integration branch, your token, the same
  exclusions). 26a's scope and proof rules are for ticket branches: MIRAI's docs commit (MIRAI as
  committer, no ticket trailer) would fail them by design. The docs-only check and your signed
  approvals are the docs branch's own gate.
- **The merge waits (exit 4) for anything the host holds**, including GitHub's `blocked` and
  GitLab's statuses; failed checks refuse it.

## Questions for Jet

1. **Scope 5, a lone ticket's file "not on the integration branch yet":** today a ticket is planned
   only from the integration branch (D-54, `src/agent/inputs.js`), so a built lone ticket's file is
   always there already. What was built: `mirai ship` lets the lone ticket's own file ride (and
   refuses any other document on a code branch); MIRAI never adds the file itself.
   Options: (A) keep it so; (B) let a lone ticket be planned from your approved work-tree file
   and have ship add it to the code MR (a D-54 change, a later unit). Default: A.
2. **Images in an initiative's folder:** (A) they block the docs merge until removed (built);
   (B) ride without an approval, as the lint treats them as assets; (C) bound by the approval of
   the document that links them. Default: A.
3. **Tickets in the local store:** an epic's tickets kept on your Mac can't be built (the build
   reads tickets from the integration branch). (A) leave it until a unit needs it (built); (B)
   refuse `[docs] store = "local"` for tickets now. Default: A.

## For later units

- 44 and 45 call `docsPublish` / `docsMerge` (`src/store/connectors/publish.js`); 45's ticket-set
  approval calls `docsMerge` after the epic's approval.
- 53: the docs branch `docs/<initiative>` is separate from an epic's feature branch.
- 54: CI can check a docs MR's approvals with `approvalGaps` (`src/store/connectors/state.js`).
- P07/P08: an external connector is a TOML file plus a module with the interface the fake store
  shows; its text goes through `agentText` (fenced) and its status through `statusView`.

## What I'm unsure about

- The local store's hints (`mirai approve … --file docs/due-dates/prd.md`) print the path relative
  to the store, which doesn't resolve from the repo; the full path works.
- A local run of the suite hung for about 3 hours in `test/launch/launch.test.js` with no test
  timeout (stopped by the coordinator). Alone, with `--test-timeout=120000`, the file passes 15/15
  on this branch. It came after the lint started building a trust root (fixed, see above); I can't
  tell whether that change caused the hang.

## The full suite

757/757 on the Mac after the follow-up (`caffeinate -i node --test --test-timeout=300000 "test/**/*.test.js"`), no flaky failure this run (756/756 before it). The runner runs are queued as u38-tests-1 and u38-tests-2.
