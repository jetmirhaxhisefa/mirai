# Stores and the docs merge request

A project keeps its documents (interviews, briefs, PRDs, epics and their tickets) in one store.
The store decides where a document's file lives and how it reaches your teammates. Every command
that reads or writes a document finds it through the store: `mirai lint`, `mirai approve --file`,
`mirai show <initiative>`, `mirai reader-test` and `mirai epic render`.

Context files (`.mirai/context/`, [context.md](context.md)) and overlays (`.mirai/custom/`,
[overlays.md](overlays.md)) are project files in the repo, whatever the store.

## The two stores

| Store | Where the documents are | Who sees them | How they reach main |
| --- | --- | --- | --- |
| `repo` (the default) | `<docs root>/<initiative>/` in the repo, `docs/mirai/` by default | Your team, once merged | One docs merge request per initiative, merged by MIRAI after your signed approvals |
| `local` | MIRAI's store on this Mac: `~/Library/Application Support/mirai/projects/<project>/docs/<initiative>/` | You only | Never: nothing is committed |

Use `local` for solo or private work. Its folders are private to your user, as all of MIRAI's
store is.

## The setting

```toml
# .mirai/config.toml
[docs]
store = "local"   # or "repo", the default
```

- It's team policy, read from the integration branch like `docs.root`. A personal file can't
  set it.
- Changing it once the old store has documents is refused, with nothing changed. Moving
  documents between stores is later work (`mirai docs move`, not built yet). An empty store may
  change.

## The docs merge request (the `repo` store)

### Publish

```bash
mirai docs publish due-dates
```

MIRAI commits the initiative's folder (`docs/mirai/due-dates/`, its `tickets/` too) on the
branch `docs/due-dates`, pushes it, and opens one merge request against the integration branch on
GitHub or GitLab (the host `mirai ship` uses, [ship.md](ship.md)).

- **Your work tree isn't touched.** The commit is made from the files as they are, on its own
  branch; your current branch, index and files stay as they were. The commit credits you as
  author and MIRAI as committer.
- **The first publish** makes `docs/due-dates` from the host's integration branch. A later
  publish adds a commit to the same branch and updates the same merge request.
- **Documents only.** A docs merge request whose diff touches anything outside the initiative's
  folder is refused before the push, with each path listed. Code goes on a code branch.
- **The description** names each document with its approval state.
- **A branch someone else pushed to** is never overwritten: publish refuses, and you look at it
  on the host.

The output ends with each document's full path and its link on the docs branch, then the folder:

```
docs publish due-dates: opened
  pushed 3f2a9c1e0b7d to docs/due-dates
  merge request 12: https://github.com/acme/app/pull/12
  approved                 /Users/…/app/docs/mirai/due-dates/prd.md   https://github.com/acme/app/blob/docs/due-dates/docs/mirai/due-dates/prd.md
  …
/Users/…/app/docs/mirai/due-dates   https://github.com/acme/app/tree/docs/due-dates/docs/mirai/due-dates
```

### Merge

```bash
mirai docs merge due-dates
```

MIRAI merges the docs merge request, with a merge commit pinned to the head it checked, when:

- every document in it has your signed approval matching its file as it is on that head (the
  brief with its interview, the PRD, the epic with each of its tickets);
- the lint is clean, with the project's approved overlays (any it skips is named);
- the epic's signed approval covers the ticket set (decision 1: your ticket-set approval is the
  gate).

There is no second "merge?" question: your signed approvals are the decision. So `/mirai docs
merge` runs from your session too.

Each refusal names the gap, and nothing is merged:

| Gap | What closes it |
| --- | --- |
| A missing approval | `mirai approve <id> --file <path>` |
| A document changed after its approval | Approve it again, then publish |
| No ticket-set approval | Approve the epic with its tickets: `mirai approve <epic-id> --file <epic.md>` |
| A lint error | Fix it, run `mirai lint`, approve again if an approved file changed, publish |
| The head moved since MIRAI published it | Someone pushed to the docs branch: look at it on the host, then publish again |

When the host still holds the merge request (its checks are running, a required reviewer), MIRAI
says what it's waiting for and leaves it open (exit 4). Run `mirai docs merge` again later. Failed
checks refuse it.

Unit 45's ticket-set approval will call the same merge.

### The journal

`docs_published` records the branch, the merge request, the head and every file with its hash.
`docs_merged` records the merge request, the head and the merge commit.

## A lone ticket's document

A ticket with no initiative (a bug, say) lives in `<docs root>/tickets/`. Its own ticket file may
ride in the same merge request as its code: `mirai ship` lets it through, and the proof is
unchanged, because the docs root is outside `gate.code_paths`. Any other document on a code
branch is refused by `mirai ship`: an initiative's documents reach main through their docs merge
request.

Today a ticket is built only once its file is on the integration branch (D-54), so a lone
ticket's file is usually already there.

## The `local` store

- `mirai lint` lints its documents with the repo's, and names a problem by its full path.
- `mirai approve <id> --file <full path>`, `mirai reader-test <full path>` and
  `mirai epic render <full path>` read them where they are.
- `mirai show <initiative>` lists them with their full paths in MIRAI's store.
- `mirai docs publish` and `mirai docs merge` do nothing, and say so.
- `git status` shows nothing new: the repo holds none of them.

## What `mirai doctor` shows

The **Document store** item runs the store's proof step, the same one `mirai init` runs:

- `repo`: the docs root is a real folder in the repo (or not made yet), not a link.
- `local`: its folder is a private real folder outside the repo, and a file written there reads
  back the same. The item also says teammates can't see these documents.

## External stores (post-MVP)

Confluence (unit P08) and Jira (P07) come after the MVP, each starting with its own interview.
They plug into the same contract (`registry/connectors/<name>.toml`: the verbs `setup`, `write`,
`read`, `query`, `publish` and `status`, a status map, and the types the store holds), without
changing a workflow:

- Text from an external store reaches an agent only inside a fenced block that names its source,
  as data, never as instructions.
- Its status is a cache with a last-sync time, shown as stale past its window. No gate reads it:
  gates read only your signed approvals.
- A type has one home: a setting that gives a type two stores is refused.
