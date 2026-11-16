---
status: draft
version: 1
---

# 12 — The team, Jira and Confluence (stage 0)

Decisions PM-26, PM-38, PM-39. The team starts when the MVP is fully done.

## 1. The team model

- Each developer runs their own MIRAI on their own machine, with their own subscription, key
  and store. Some teammates don't use MIRAI.
- The instances don't talk to each other. Developers meet where they already meet:
  - **pull requests** on the git host: a teammate reviews and approves a MIRAI MR like any
    other;
  - **tickets** in Jira;
  - **documents** in Confluence.
- Your MIRAI doesn't need to know that another MIRAI exists. It only needs to behave well in
  shared places: not take a colleague's ticket, not block a colleague's PR, not overwrite a
  colleague's edit.
- Shared run status, shared logs and a shared board are **later** (`09` §7).

### What the MVP gives a teammate on day one (on a Mac)

| Need | State |
|---|---|
| Join an existing project | `mirai init --join` sets up the machine's store |
| Tickets and documents in the repo | Yes (unit 38's `repo` store) |
| A PR from a colleague without MIRAI passes CI | Already in unit 54's design: a human MR without the trailer gets only the secret scan. Row 54 now tests it |
| A key per developer | MVP addition to unit 54: any key listed on the integration branch counts. CI already checks against a list of public keys with a revocation list |
| CI on GitLab | **Check first.** Unit 54 describes two GitHub Actions jobs, and the hosts unit supports GitLab too. If the team's repos are on GitLab, the same two jobs are needed there |
| Getting started | P00: the v1.0 tag and an onboarding checklist for a teammate on a Mac |
| Several services in one workspace | Unit 72, now needed |
| Ubuntu or Windows | Stage 0 (`11`) |
| Jira and Confluence | Stage 0 (this file) |

### Whose approval counts

- **In the MVP: any listed key.** Every developer's public key is committed on the integration
  branch by a human, as today. An approval signed by any listed, unrevoked key counts. This is
  enough for a small team that trusts each other, and it needs no new concept.
- **Later, with roles (P09):** a rule that says whose signature counts for what. It can't rest
  on who a ticket is assigned to in Jira, because Jira's data is advisory and CI can't read it
  (D-06). So it rests on two signed things in the repo:
  - a **roles file** on the integration branch, committed by a human: each key's owner and
    roles (`lead`, approver for a document type);
  - a **claim record**: when a developer starts a ticket, their MIRAI writes a signed claim on
    the ticket branch. A ticket's plan and merge approvals count when signed by the claimant or
    a lead.
- **One check for both places.** The same function decides locally (the gates that exist since
  units 06, 25a, 26a, 29b and 29d) and in CI's `mirai-verify`, so they can't disagree.

## 2. Connectors: what already holds

Unit 38 builds the contract. These rules apply to every connector and are not reopened:

- **One home per kind of record** (D5). If tickets live in Jira, they don't also live in the
  repo. If HLDs live in Confluence, the repo holds none.
- **External status is advisory.** It is mirrored into a local cache with a last-sync time.
  Gates use only MIRAI's signed proofs.
- **Actions run in the CLI** through the official CLI or REST. MCP is only for an agent reading
  during a session.
- **Credentials come from the tool's own login** and are never stored by MIRAI or shown to an
  agent.
- **Text from a connector is untrusted** and is fenced as data wherever an agent reads it. A
  Jira description or a Confluence comment can contain text written to steer an agent.

### Where each kind of record lives (PM-26)

Set per project and per type in config. The existing setting already takes `repo` or
`external:<tool>` per artifact type (D-06, `03`), and the connectors add the values
`external:jira` and `external:confluence`:

| Kind | Choices |
|---|---|
| Tickets and epics | the project repo (default), an external repo, Jira |
| PRD, HLD, LLD, ADR, brief | the project repo (default), an external repo, Confluence |

"External repo" is a second git repo that holds only documents or tickets. It uses the `repo`
store with another path, so it needs no new connector. **Check first** whether unit 38's store
already takes a path outside the project. If it doesn't, P08b adds it. In a workspace this is
what the workspace repo already is (D-42), so P08b may turn out to be nothing.

## 3. Jira (tickets)

- **Setup** maps MIRAI's ticket states to the Jira project's statuses and checks that each
  transition MIRAI needs exists. A missing one is reported at setup, not at run time.
- **Write:** after you approve a ticket set, MIRAI creates the epic and its tickets in Jira,
  with dependencies as links and the acceptance criteria in the description.
- **Read:** a ticket that already exists in Jira can be taken into MIRAI by its key. Its text is
  untrusted input to the plan step.
- **Status mirror:** MIRAI moves a ticket in Jira when its own state changes (started, in
  review, merged, parked). Jira's status never moves MIRAI's. Until the event stream exists
  (`14` P14) the mirror hooks the state change directly.
- **A dry run.** `setup --dry-run` reads the Jira project and reports what MIRAI would create
  and which transitions it would use, and writes nothing. The team's real Jira is first met
  this way, since tests only ever use a personal site.
- **The QA comment** (from `08` Q9): a script posts the QA result as one comment, with
  screenshots where the API allows.
- **Not in scope:** creating Jira projects, editing workflows, custom fields beyond the ones
  setup maps.

## 4. Confluence (documents)

- **Publish:** an approved or draft document is written to a Confluence page under a space and
  parent page named in config. The two layers (`09` PM-03) are kept in order: the top part
  first.
- **Approval is bound to a page version.** Your signed approval records the page id, the version
  number and a hash of the content MIRAI published. If anyone edits the page afterwards, the
  version changes and MIRAI shows the document as **changed since approval**. Nothing downstream
  starts from it until you approve again or restore the approved version.
- **Comments come back.** Before a revision, MIRAI reads the page's comments and hands them to
  the author agent as untrusted input, each with its author and the text it refers to. The
  agent's revision notes say which comments it acted on. Comments never count as an approval.
- **Teammates' direct edits** are treated the same way as comments: MIRAI shows you the
  difference from its last published version and you decide to accept it into the document or
  to overwrite it. MIRAI never silently overwrites a human's edit.
- **Diagrams:** Mermaid blocks are published in a form Confluence renders. **Check first** what
  that is without a paid plugin; a rendered image with the source attached is the fallback.

## 5. Team behaviour on a shared epic

Your case: an epic of 30 tickets in Jira, several developers taking tickets in order, some with
MIRAI and some without.

- **Only my tickets.** MIRAI's queue for an epic contains the tickets assigned to you. An
  unassigned ticket is taken only if you name it or set the project to allow it.
- **Claim before starting.** Before a ticket starts, MIRAI assigns it to you (if allowed),
  moves it to the in-progress status in Jira, and writes the signed claim record on the ticket
  branch (§1). If the ticket is already assigned to someone else
  or already in progress, MIRAI skips it and says so.
- **A colleague's unmerged ticket is a wait.** If your ticket depends on a ticket that someone
  else holds and that isn't merged, your ticket is `waiting`. It doesn't stack on a colleague's
  branch.
- **Selection.** The overnight queue takes all your tickets in the epic by default. You can
  name a selection (`16` P24).
- **Fresh state before each ticket.** MIRAI reads Jira again before starting each ticket, since
  a colleague may have taken or finished something during the night.

## 6. Testing

- A free personal Atlassian site only. **Never your work Jira or Confluence**, by the same rule
  as the work GitLab.
- The leak scanner (unit 75) already treats ticket keys and resource links as blocked text for
  contributions back to MIRAI.

## 7. Units

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| P00 | **The v1.0 tag and Mac team onboarding:** the tag, a one-page checklist for a teammate (install, `init --join`, the key, the red team, a first ticket), CI on GitLab if the check shows it is needed, and a note of which host and tracker the team uses | MVP | The team starts the day the MVP is done | A teammate on a Mac follows the checklist from a fresh clone to one sample ticket's MR without help; their key is listed and their approval passes CI |
| P07 | **Jira connector (tickets):**<br>• setup with the status map, a check of every transition, and `--dry-run`;<br>• write an approved epic and ticket set, with links and criteria;<br>• read a ticket by key, fenced as untrusted;<br>• the status mirror and the local cache with a last-sync time;<br>• the QA comment;<br>• auth through the tool's own login, never stored;<br>• the store value `external:jira` and the one-home check;<br>• the store kind logged per ticket (`13` §2) | MVP unit 38 | The team's tickets are in Jira | On a personal site: an approved set appears as an epic with linked tickets; a MIRAI state change moves the Jira ticket; a status changed by hand in Jira changes nothing in MIRAI's gates; a ticket description with a planted instruction reaches the agent fenced; a missing transition is reported at setup; a dry run writes nothing |
| P08 | **Confluence connector (documents and comments):**<br>• publish a document to a page, two layers in order;<br>• approval bound to page id, version and content hash;<br>• "changed since approval" when the version moved;<br>• comments read back as untrusted input for a revision;<br>• a teammate's direct edit shown as a difference, never overwritten silently;<br>• diagrams, after checking what renders | MVP unit 38 | Teammates read and comment on HLDs | On a personal site: an approved HLD edited by hand shows as changed and blocks the ticket step; a comment reaches the next revision and is named in its notes; a comment saying "approved" approves nothing; a diagram is readable on the page |
| P08b | **An external repo as a store,** only if the check shows unit 38 can't take a path outside the project | MVP unit 38 | Documents or tickets kept in their own repo (PM-26) | With documents set to an external repo, a PRD is written, approved and published there, and the project repo holds none |
| P09 | **Team behaviour on a shared epic:**<br>• the queue holds only tickets assigned to you;<br>• claim (assign, move, and the signed claim record) before starting, skip what someone else holds;<br>• a dependency on a colleague's unmerged ticket is `waiting`;<br>• Jira read again before each ticket;<br>• the roles file and the role rule of §1, checked by one function locally and in CI | P07, MVP unit 54 | Several developers on one epic | In a seeded epic with tickets assigned to two users, MIRAI builds only yours; a ticket taken by the other user between two of your tickets is skipped with a message; a ticket depending on the other user's open ticket waits and starts after that one is merged; with a roles file, a plan approval signed by a key that is neither the claimant's nor a lead's is refused both locally and in CI |
