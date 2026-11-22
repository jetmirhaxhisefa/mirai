---
unit: "38"
name: connectors
status: done (spec approved by Jet 2026-11-20, unit approved 2026-11-22: "approve 38"; decisions 1–8 from his interview; built after 37, re-checked against 34–37 first)
roadmap: design/07-implementation-roadmap.md, row 38; D-36 (updated here); D-06; R-M15, R-M16, R2-M5, R2-M13, D5, Q3, R3-M12, V3; units 27a/27b (the git hosts), 29d (`mirai merge`), 32 (the docs root, `mirai show <initiative>`), 33 (the epic's approval over its ticket set)
depends_on: ["04", "05", "06", "27a", "27b", "29d", "32", "33", "37"]
---

# Unit 38: The connector contract and the `repo` store

## Why

Today a feature's documents are files under the docs root (`docs/mirai/<initiative>/`) on
whatever branch you happen to be on. Nothing gets them to main, so a teammate's agent building
SAMPLE-12 can't count on reading the approved PRD. And every later document workflow (44 PRD,
45 tickets) needs one place to write documents, one way to publish them, and one answer to "where
does this file live?".

This unit adds that place: a **store** per project, with one contract every store follows.
- The default `repo` store keeps documents in the project's git repo. They reach main through one
  docs merge request per feature, which MIRAI merges after your signed ticket-set approval.
- A `local` store keeps them on your Mac, for solo or private work.
- A later Jira or Confluence store plugs into the same contract without changing a workflow.

**Why now:** 44 and 45 publish through it, and 41's document links point into it.

## Decisions (Jet, 2026-11-20, interview)

1. **One docs merge request per feature, merged by MIRAI** (Q1, "A"). The documents go on a
   `docs/<initiative>` branch. MIRAI opens the merge request, and merges it once your signed
   ticket-set approval is recorded (the epic's approval over its tickets, unit 33). Your signed
   approvals are the gate, so there is no second "merge?" question.
2. **The code branch flow moves to unit 53** (Q1 and Q2, Jet, "A"). These are recorded in row 53,
   not built here:
   - a feature branch per epic, by default;
   - ticket branches straight to main, on request or for a lone ticket;
   - who merges code is a setting: by default a person; auto-merge is an opt-in in the
     developer's personal config, with a coloured warning on every command while it's on.
3. **GitHub and GitLab both** (Q3, "B"). Both host connectors already exist for `mirai ship`
   (27a, 27b). This unit adds the docs merge request to both. GitLab work, tests and probes use
   only `GLAB_CONFIG_DIR=~/.config/glab-personal`, never the work GitLab. **D-36 changes** from
   "the git host (GitHub) only" to "the git hosts GitHub and GitLab".
4. **The store is a project setting** (Q4, "A"). The default is `repo`. The option `local` keeps
   documents in MIRAI's store on your Mac.
5. **Confluence and Jira are post-MVP** (Q5, Jet: "leave Confluence completely for post-MVP").
   Confluence is unit P08 (`design/12` §7), which starts with its own interview. Nothing
   Confluence-specific is built here. The contract only has to fit an external store, and that's
   proven with a fake one.
6. **A lone ticket's document rides with its code** (Q7, "A"). A ticket with no initiative (for
   example a bug) has its ticket file in the same merge request as its code. The "docs merge
   request has no code" rule applies to feature docs merge requests only.
7. **External text is untrusted, external status is advisory** (D-36, R2-M13; unchanged). Gates
   read only the signed proofs. A store's status is a cache with a last-sync time.
8. **Document links** (unit 32, Jet's decision 8; moved here from rows 38 and 41). Every time MIRAI
   writes, changes or approves a document, its last output line gives the full path. Once the
   file is pushed, the line also gives the file's GitHub or GitLab link.

## Scope

**In**

1. **The contract: `registry/connectors/<name>.toml`** (D-37: data with a schema):
   - **verbs:** `setup` (with a proof step: a check the store works, run at `init` and by
     `doctor`), `write`, `read`, `query`, `publish`, `status`;
   - **a status map:** the store's states mapped to MIRAI's (`draft`, `in-review`, `approved`,
     `published`). It's advisory and never read by a gate;
   - **which artifact types it holds** (D5: one source of truth per type; a config that gives one
     type two homes is refused);
   - the registry validates each connector file; an unknown verb or a missing required one is
     refused, naming the field.
2. **`src/store/connectors/`: one module per store, behind one interface** (`write`, `read`,
   `query`, `publish`, `status`, `setup`, `pathOf`):
   - **`repo`:** documents under the docs root in the working tree (today's behaviour);
     `publish` is the docs merge request (item 4);
   - **`local`:** documents under `<store>/projects/<project>/docs/<initiative>/`, outside the
     repo, never committed. `publish` does nothing and says so. `doctor` notes that teammates
     can't see these documents;
   - **contract tests** in `test/store/connector-contract.test.js` run the same cases against
     `repo`, `local` and a **fake external store** (`test/fixtures/connectors/fake-external.js`),
     which keeps documents in memory, returns text with a planted instruction, and has a status
     cache.
3. **Every document path resolves through the store** (roadmap: "document paths resolve through
   the store"):
   - the lint, approval, `mirai show <initiative>`, the reader test (34), the interview link (35),
     the context files (36) and 37's `mirai epic render` call `pathOf(type, initiative, name)`
     instead of joining the docs root themselves. 37's overlays stay in `.mirai/custom/` and apply
     to documents in either store, including the lint `mirai docs merge` runs (it uses the
     approved overlays and reports any it skips);
   - **the setting** is `[docs] store = "repo" | "local"` in `.mirai/config.toml`, read from the
     integration branch like `docs.root`. A personal file can't set it. Changing it on a project
     that already has documents is refused, naming `mirai docs move` as later work.
4. **The docs merge request (`repo` store):**
   - **`mirai docs publish <initiative>`** commits the initiative's documents on
     `docs/<initiative>` (made from the integration branch on its first publish), pushes them,
     and opens the merge request through the host. A later publish updates the same branch and
     merge request. Its title and description name the documents, each with its approval state;
   - **documents only:** a docs merge request whose diff touches anything outside the
     initiative's folder under the docs root is refused before the push, listing the paths
     (the roadmap's done-when);
   - **MIRAI merges it** when every document in it has a signed approval matching its file as it
     is on the branch's head, the lint is clean, and the epic's signed approval covers the ticket
     set. It merges through the host's `mergeMr`, pinned to that head. `mirai docs merge
     <initiative>` does it, and 45's ticket-set approval will call the same function. If the
     host still has the merge request waiting (checks running, a required reviewer), MIRAI says
     what it's waiting for and leaves it open. A later `mirai docs merge` tries again;
   - **refusals name the gap:** a document changed after its approval, a missing approval, an
     unapproved ticket set, or a merge request whose head moved since MIRAI checked it.
     Nothing is merged;
   - **journal:** `docs-published` (branch, merge request, head, files with hashes) and
     `docs-merged` (merge request, merge commit) events;
   - **sessions:** `/mirai docs publish` and `/mirai docs merge` (21f's list). A merge needs your
     signed approvals, not a typed key, because it decides nothing new.
5. **A lone ticket's document** (decision 6): `mirai ship` includes the ticket's own file under
   the docs root in the code merge request when the ticket belongs to no initiative and the file
   isn't on the integration branch yet. The proof hash is unchanged, because the docs root is
   already outside `gate.code_paths`.
6. **External stores (contract only):** connector text reaches an agent fenced as untrusted data
   (a marked block with its source, in the spirit of the agents' `reply_untrusted` field; no
   shared fence exists yet, so this unit adds one in `src/store/connectors/fence.js`), and a status older than its last sync is shown as
   stale. Both are proven on the fake store only.
7. **Document links** (decision 8): `approve`, `docs publish`, `docs merge`, the lint's
   `--fix` output, `mirai show <initiative>`, and the write skill's closing line (34) end with
   the full path. Once the file is on a pushed branch, they also give its host link: GitHub
   `…/blob/<branch>/<path>`, GitLab `…/-/blob/<branch>/<path>`.
8. **D-36 update** in `design/04-decisions.md`: GitHub and GitLab; the store setting; Confluence
   (P08) and Jira (P07) post-MVP.
9. **Docs:** `docs/stores.md` (new) covers the two stores, the setting, the docs merge request
   from publish to merge, a lone ticket's document, and what `doctor` shows. `docs/documents.md`
   links it.

**Out**

- Confluence (P08, with its own interview) and Jira (P07). Every external connector.
- The code branch flow and the auto-merge setting (unit 53, decision 2).
- The `mirai-prd` and `mirai-tickets` workflows that call publish and merge (44, 45).
- CI checking a docs merge request's approvals on the host (unit 54); MIRAI's own merge checks them
  locally here.
- Moving a project's documents between stores (`mirai docs move`).
- An external repo as a store (P08b).

## Tests

- **T1 Contract file:** each built-in connector file validates. A missing verb, an unknown verb, a
  status mapped to a state MIRAI doesn't have, and one type given two homes are each refused,
  naming the field.
- **T2 Contract cases:** the same suite passes on `repo`, `local` and the fake external store:
  write then read returns the same bytes; `query` lists an initiative's documents with type and
  state; `pathOf` is the one path the lint and approval use; the fake store's planted
  instruction reaches the agent-facing text only inside the fence; its status after the sync
  window is reported stale and changes no gate (the roadmap's done-when).
- **T3 Paths through the store:** with `local`, `mirai lint`, `mirai approve --file`,
  `mirai show <initiative>` and 34's `reader-test` find the documents outside the repo, and the
  repo holds none. A personal file setting `docs.store` is refused, and so is a store change on
  a project that has documents.
- **T4 Publish** (a fake host, as 27a's tests use): the first publish makes `docs/<initiative>`
  from the integration branch, commits only that folder, pushes and opens one merge request; a
  second publish updates the same one. A diff with a code path (`src/app.js`) is refused before
  the push, naming it (the roadmap's done-when).
- **T5 Merge:** with signed approvals for the brief, PRD and epic and the epic's approval over
  its tickets, `mirai docs merge` merges at the checked head (the roadmap's done-when). Each of
  these is refused and merges nothing, naming the gap: a document changed after approval, a
  missing approval, no ticket-set approval, a head that moved, and a lint error. A merge request
  the host holds (checks pending) stays open with a "waiting for" line, and a later run merges
  it.
- **T6 GitHub and GitLab:** T4 and T5's host calls run through both host modules (fake `gh` and
  `glab` binaries, as in 27a/27b). A GitLab call carries `GLAB_CONFIG_DIR` from the environment
  given, and the test asserts it never falls back to glab's default config.
- **T7 A lone ticket:** `mirai ship` on a ticket with no initiative puts its ticket file in the
  code merge request; the proof still matches. A ticket that belongs to an initiative doesn't
  carry its documents.
- **T8 Links:** each command in Scope 7 ends with the full path. After a fake push, the line also
  gives the GitHub or GitLab link, built from the remote.
- **T9 The suites from 31–37** pass, with paths read through `pathOf`.

## Probes (real)

- **P1 A feature through GitLab** (the sample app, personal gitlab.com,
  `GLAB_CONFIG_DIR=~/.config/glab-personal`): 33's example initiative (brief, PRD, epic, tickets)
  is published, and you approve it with your key. **Pass when:**
  - one merge request holds only the initiative's folder;
  - `mirai docs merge` before the ticket-set approval refuses and names it;
  - after the approval, MIRAI merges it, and main has the documents;
  - an edit to the PRD after that publish shows "changed since approval" and blocks the merge
    until you approve again.
- **P2 The same on GitHub:** the same steps on a personal GitHub repo (the sample app's GitHub
  copy from 27a). **Pass when** the results match P1.
- **P3 A lone bug ticket:** a bug ticket with no initiative, built and shipped on the sample app.
  **Pass when** its merge request holds the fix and the ticket file, and `mirai merge` takes it in
  as one change.
- **P4 The `local` store:** a throwaway project with `store = "local"`, with a brief and PRD written
  and approved. **Pass when** `git status` shows nothing new, `mirai show` gives the paths in
  MIRAI's store, and `doctor` says teammates can't see them.

## Done when

- T1–T9 pass, and the full suite passes through the build runner and CI.
- P1–P4 pass.
- D-36 and `docs/stores.md` are updated.

## Checked against the queued units

- **53:** gets the code branch flow (decision 2, already in its roadmap row). 38's docs branch is
  separate from an epic's feature branch.
- **44, 45:** call `docs publish` and the merge function. Row 45's "the orchestrator merges the
  docs MR" is the merge in Scope 4.
- **41:** its "document links" item is built here (decision 8), so 41 only uses it.
- **34–37:** their path lookups move to `pathOf` (T9). 37's overlays sit under `.mirai/custom/`,
  not the docs root, so they never ride in a docs merge request.
- **54:** CI checks a docs merge request's approvals later. Until then, the gate is MIRAI's own
  check before it merges.

**Re-checked against 37 as built (2026-11-21):**

- Scope 3 said overlays (37) call `pathOf`. As built, overlays never resolve a document path:
  they are read only from `.mirai/custom/` in the trust root (`src/config/overlays.js`,
  `CUSTOM_DIR` and `readOverlays`). Changed to: the context files (36) and 37's `mirai epic
  render` call `pathOf`; 37's overlays stay in `.mirai/custom/` and apply to documents in either
  store, including the lint `mirai docs merge` runs (it uses the approved overlays and reports any
  it skips).
