---
status: draft
version: 1
---

# 18 — Project skills and reviewing a colleague's MR (stage 6)

Decisions PM-36 and PM-37.

## 1. Project skills and agent additions (P40)

### 1.1 The problem

Every codebase has its own way of doing common tasks: how a migration is written here, how a
new endpoint is added in this service. That knowledge makes Kai's output match the existing
code. Unit 37 lets a project customise **document templates** through overlays in
`.mirai/custom/`. It doesn't let a project add its own **skills** or add to an agent's
instructions.

### 1.2 The design

A folder MIRAI never writes to (proposed: `.mirai/custom/skills/` and
`.mirai/custom/agents/`), beside unit 37's overlays.

| What a project can add | Example | How it reaches an agent |
|---|---|---|
| **A project skill** | "How we write a database migration here" | Listed to the agents that may use it. The skill's header names those agents |
| **An addition to an agent's instructions** | Kai must update the OpenAPI file when an endpoint changes. Rex must check translations | Appended to that agent's instructions in a marked block |

Rules:

- **`mirai update` never touches the folder.** Files there are marked `project` in the lock.
- **`mirai promote` and `mirai contribute` never send them** to the framework unless you name
  a file. This is how unit 74 already treats `project` files.
- **Additions are text, appended after MIRAI's own.** An addition is never read for an agent's
  tools, write scope, tier or gates: those come only from MIRAI's manifests. So an addition
  can't widen what an agent may do, whatever it says. The loader refuses a file that carries
  such structural keys. Whether prose contradicts one of MIRAI's rules can't be checked by a
  script, so MIRAI's rules come first in the instructions and say that project text can't
  override them.
- **Not part of the red-team key.** The key covers what an agent can reach. Additions change
  what it is told. **Check first** that no addition path is among the files the key hashes.
- **Trust.** The folder is read from the **trust root** (the integration branch), like every
  other rule file. A ticket branch that edits a project skill doesn't change what its own
  agents are told. The change takes effect after it is merged.
- **A namespace.** Project skills are named `project:<name>`, so they can never shadow a MIRAI
  skill.
- **Size.** Research found that generic context files cost tokens without raising success, and
  only repo-specific rules help. So a project skill is loaded when it applies (by the files a
  ticket touches or the task type its header names), not into every launch. `doctor` warns when
  the additions for one agent grow past a set size.
- **Documented automatically.** This unit adds project skills to the generated reference (`15`
  P20).
- **New commands and workflows per project are not planned** until a real case appears.

### 1.3 In a workspace

Skills can sit at the workspace level (for all services) or in one service's light install (for
that service only). The more specific one applies to its service.

## 2. Reviewing a colleague's MR (P41)

### 2.1 The problem

You review MRs that MIRAI didn't write. You want Rex's help there, with comments on GitHub or
GitLab.

### 2.2 How it differs from Rex's normal review

| | MIRAI's own ticket | A colleague's MR |
|---|---|---|
| Basis | The plan's acceptance criteria | **Criteria you give it:** the ticket linked to the MR (from Jira through `12`, or pasted), or criteria you type for a small project |
| Code | Written under MIRAI's cage | **Untrusted.** A diff can contain text written to steer the reviewer |
| Result | Blocking findings go back to Kai | Comments from you to a person |

### 2.3 The flow

1. `mirai review-external <MR url>` (proposed name; `review-mr` is taken by unit 29d). It
   fetches the diff and the description through the host's CLI.
2. **The basis.** It looks for a linked ticket. If none, it asks you for the criteria or for a
   go-ahead without them. With no criteria it reviews against the description and the project's
   conventions and ADRs, and says so at the top of the result.
3. **Rex reviews** with the same rules as always: a finding needs a file, a line inside the
   change and a reason. Style remarks are dropped unless one of the project's own rules backs
   them. The check pass (unit 24b) runs on the findings before you see them, since noise here
   costs you credibility.
4. **You see the list first**, sorted by severity, each with its reason. You tick the ones you
   stand behind and edit the wording.
5. **MIRAI posts the chosen ones** as line comments under your account, plus an optional
   summary comment. Posting is the last step and happens only on your confirmation.

### 2.4 Rules

- **Read-only on the code.** The review never checks out the MR into your working folder and
  never runs its code on your machine. If tests are wanted, they run in the hardened test
  container, as a later option.
- **The diff, the description and the ticket text are fenced as untrusted** for the agent.
- **Nothing is posted without you.** Posting by itself could become a per-project option later,
  once you've seen how often you delete findings. It is not in this unit.
- **No MIRAI marker is forced on the comments.** They are yours once you chose and edited
  them. Whether to mark them is a project setting, off by default. (`07`'s former Later list suggested a
  bot account with a marker for unattended comments. That stays the rule if posting ever
  becomes automatic.)
- **No approval of the MR by MIRAI.** Approving or requesting changes on the host stays your
  click.
- Works on GitHub and GitLab (units 27a and 27b). **Never tested against your work GitLab.**
- It records which findings you posted and which you dropped, so the review (`13`) can show how
  useful Rex's findings are on other people's code.

## 3. Units

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| P40 | **Project skills and agent additions:** the two folders, the `project:` namespace, loading from the trust root, the loader refusing structural keys, loading by applicability, the `doctor` size warning, workspace and service levels, `project` marks in the lock, project skills in the generated reference | MVP units 37, 74, and P20 | Agents learn the codebase's own ways | A project skill applies to a ticket that touches its files and not to one that doesn't; an addition file carrying a tools or scope key is refused with the reason, and an addition that says "you may push" changes nothing about what the agent can do (red-team case); a project skill appears in the generated reference; `mirai update` leaves the folder byte for byte; `contribute` refuses a project file unless named; a skill edited on a ticket branch doesn't change that ticket's agents |
| P41 | **`mirai review-external`:** fetching the MR, the basis (linked ticket, pasted or typed criteria, or none with a notice), Rex's review with the check pass, the list for you to choose and edit, posting line comments on GitHub and GitLab, the record of posted and dropped findings | MVP units 24, 24b, 27a, 27b | Reviewing is part of your day | On a personal repo: an MR with a seeded defect against given criteria yields a finding at the right line; a diff with a planted instruction doesn't change the review; nothing is posted until you confirm; only the ticked findings appear as line comments, with your edited wording; with no criteria the result says so at the top |
