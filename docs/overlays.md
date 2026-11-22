# Overlays: a project's own templates, agents and skills

Unit 37 (D-37). An overlay is a project's own change to one of MIRAI's document types, agents or
skills. It lives in `.mirai/custom/`, beside MIRAI's files, and MIRAI's updates never overwrite
it. You approve every overlay with your key. MIRAI uses only an overlay that is on the
integration branch and approved as it is now.

Overlays stay in their project. Which ones go back to MIRAI is `mirai promote`'s choice (unit 74).

## The files

| File | What it changes |
|---|---|
| `.mirai/custom/document-types/<type>.toml` | a document type: added, reordered or renamed sections, more lint checks, or a whole replacement template |
| `.mirai/custom/templates/<type>.md` | the template text for the added sections, or the replacement template |
| `.mirai/custom/agents/<name>.toml` | an agent's tools, role or `read_only`, and how its text applies |
| `.mirai/custom/agents/<name>.md` | the text added to the agent's prompt |
| `.mirai/custom/skills/<name>/overlay.toml` | how a skill's text changes |
| `.mirai/custom/skills/<name>/overlay.md` | the text added to the skill |
| `.mirai/custom/approvals/<kind>-<name>.json` | your signed approval of one overlay, written by `mirai approve` |

The `.toml` file is the overlay. You approve it, and its approval covers the `.md` beside it.

**A project's own items (unit 39)** sit beside the overlays and are approved the same way, each
with its own record (`approvals/<kind>-<name>.json`). They're for your sessions only; a MIRAI run
never reads them. `mirai custom add <path>` puts them there (docs/setup.md):

| File | What it is |
|---|---|
| `.mirai/custom/project-skills/<name>/SKILL.md` (and its files) | a skill of the project's own, rendered into `.claude/skills/<name>/` |
| `.mirai/custom/hooks/<name>.toml` | an interactive-only hook (event, matcher, the script it runs), rendered into `.claude/settings.json` |
| `.mirai/custom/scripts/<name>.<sh, bash, js, mjs, py>` | a script a hook, a check or a skill calls; a hook's approval covers its script |
| `.mirai/custom/mcp/<name>.toml` | an MCP server for your sessions (`transport`, `command`/`args`/`env` or `url`/`headers`), rendered into `.mcp.json` |

An agent kept from a project's own setup is an agent overlay of `mirai-developer` or
`mirai-reviewer` (below), with its write scope a role of the project's own in
`.mirai/custom/roles/`; a role that may write one of MIRAI's protected paths is refused.

## Two ways to change a document type

### 1. Section changes

MIRAI's template stays underneath. When MIRAI updates its template, the update reaches your
project with your changes still applied.

```toml
kind = "document-type-overlay"
schema_version = 1
name = "prd"

# A section of your own, placed after one of MIRAI's. Required unless required = false.
# `variants`: the variants that require it (a PRD's "lite" and "full"); every one by default.
# `checklist`: the verifier's questions for it, added to the type's checklist.
[[add]]
name = "Data privacy"
after = "User journeys"
checklist = ["Does every kind of personal data name who may see it and how long it's kept?"]

[[add]]
name = "Security sign-off"
after = "Glossary"
variants = ["full"]

# MIRAI's name, then your project's. The lint, the summary check, approval and the reader test
# read your name as MIRAI's.
[[rename]]
from = "Summary for approval"
to = "Executive summary"

# Optional: the whole order of the sections, by your names. It must name every section.
# order = ["Executive summary", "User journeys", "Data privacy", ...]

# Optional: the type's checks. You may add a check, never remove one.
# lint_checks = ["summary", "writing", "prd"]
```

`.mirai/custom/templates/prd.md` holds one block per added section. MIRAI puts each one into the
template where it goes. Each block needs a `<!-- done when: … -->` comment, as MIRAI's sections
have: it tells the writer when the section is filled. An overlay without one is refused, naming
the section.

```markdown
## Data privacy

<!-- done when: each kind of personal data the feature reads, stores or sends is named, with who may see it and how long it's kept -->
What personal data the feature reads or keeps, and who may see it.

## Security sign-off

<!-- done when: the reviewer's role, the date and the state (pending or signed) are named -->
Who signed off the security review, and when.
```

A document under MIRAI's own name for a renamed section fails the lint: it says what your project
calls it. The rename reaches MIRAI's guidance too: every quoted name in the template's comments,
its "done when:" lines and the checklist shows your project's name.

**The word caps count your sections.** An added section's words count toward the document's cap
like any other. Raise a cap in `.mirai/config.toml`, under `[docs.limits]`: `prd_lite_words`
and `prd_full_words` for a PRD (3,000 and 5,000 by default), `prd_summary_words` and
`prd_full_summary_words` for its summary, `brief_summary_words` and `epic_summary_words` for the
others ([config.md](config.md)).

### 2. A replacement template

Your template is used as it is. MIRAI's template updates don't reach it.

```toml
kind = "document-type-overlay"
schema_version = 1
name = "prd"
replace = true

[[rename]]
from = "Summary for approval"
to = "Executive summary"
```

`.mirai/custom/templates/prd.md` is then the whole template, frontmatter included. Its `##`
headings are the type's sections. MIRAI's required sections stay required; your own are required
too.

The approval records MIRAI's template version and hash at that time. `mirai doctor` warns when
MIRAI's template for the type has a newer version than the one recorded, or when its text changed
under the same version. MIRAI's own tests fail when a template's text changes without its
`template_version` going up (`test/lint/template-versions.json`).

### See the template your project uses

```
mirai show template prd
```

It prints the type's template with the approved overlays applied. An agent writing a PRD starts
from it. `mirai show checklist prd` prints its checklist the same way: MIRAI's questions under
your names, then your sections' questions. From your session: `/mirai show template prd` and
`/mirai show checklist prd`.

## What no overlay may drop

Each document type lists its protected parts: what MIRAI's machinery reads. They're in
`registry/document-types/<type>.toml`, as `[[protected_sections]]` and `[[protected_fields]]`,
each with what reads it (`read_by`). Neither way of changing a type may drop one. A rename keeps
it: the readers follow the rename.

The readers:

| Reader | What it is |
|---|---|
| `approval` | `mirai approve` |
| `reader-test` | the reader test of the summary ([documents.md](documents.md)) |
| `trace` | the IDs other documents and tests refer to |
| `epic-coverage` | the epic's coverage of the PRD's requirements |
| `graph-lint` | the ticket graph's checks |
| `epic-render` | `mirai epic render` |
| `gate` | a gate, such as the plan gate |
| `lint` | the type's own lint checks |

The protected parts, by type:

| Type | Sections and parts | Fields and link lines |
|---|---|---|
| `brief` | Summary for approval and its five parts, Success, Business requirements, Appetite and track, No-gos, Rabbit holes, Open questions | `track`, the `Interview:` line |
| `prd` | Summary for approval and its five parts, User journeys, Functional requirements and its four groups, Non-functional requirements, Non-goals, Risks, Dependencies, Rollout, Assumptions, Open questions, Glossary with Terms and ID prefixes | `track`, `variant`, the `Brief:` line |
| `epic` | Summary for approval and its five parts, Release, Not in this epic, Tickets, Dependencies, Coverage, Design decisions | `track`, `release`, the `PRD:` and `Design:` lines |
| `story`, `bug` | Acceptance criteria | `covers_fr`, `covers_ac`, `after`, `epic`, `risk`, `size`, `repo` |
| `plan` | Intent, Boundaries, Edge cases, Code map, Test list, Declared changes | `ticket`, `acs`, `risk`, `tdd`, `tests`, `round`, `ticket_type` |
| `interview` | Questions, Restatement | `state` |
| `business` | every required section, Sources | none |
| `journeys` | Journeys, Sources | none |
| `feature-map` | Screens | `code` |
| `project` | Stack, Commands, Layout, Test levels, Instructions | `service`, `root` |
| `conventions` | Rules | `service` |

These are refused, each naming the part and what reads it:

- an `order` that leaves out a section, or moves "Summary for approval" from first;
- a rename that maps two names to one, or onto a name another section has;
- a `lint_checks` list without one of MIRAI's checks;
- a replacement template without a protected section, part, field or link line.

A project can't unprotect a part. MIRAI's own registry refuses a type whose checks read a section
it doesn't protect.

## Agents and skills

An agent overlay may change the agent's text and its permissions.

```toml
kind = "agent-overlay"
schema_version = 1
name = "mirai-reviewer"

# Optional: the agent's tools, role and read_only, as its MIRAI definition has them.
# role = "reviewer"
# read_only = true
[tools]
allowed = ["Read", "Grep", "Glob", "Bash"]

# How the text in mirai-reviewer.md applies: appended (the default), or in place of one part.
[instructions]
mode = "replace"
part = "## Output"
```

- **Instructions only, or narrowing:** fewer tools, `read_only = true`, or a read-only role. The
  agent launches as soon as you approve it.
- **Widening:** anything its MIRAI definition or its role's mode doesn't allow, such as a tool, a
  role that may write, or `read_only = false`. The launch is refused until the red team has passed
  with the overlay. Run it yourself: `mirai redteam run`. The red team runs the same escape cases
  under the agent's own template (its tools, its mode's limits), and the result is recorded
  against the overlay's hash. Any change to the overlay needs a new run.
- **The cases made for the widened tool** run under the agent's template too, and only when an
  approved overlay widens an agent with that tool:
  - Bash beyond the agent's mode: writing into the checkout, the network, and the real `.env`
    files and MIRAI's store (`x-bash-checkout`, `x-bash-network`, `x-bash-secrets`);
  - Write or Edit for a read-only agent: a protected path (`x-write-protected`,
    `x-edit-protected`).

  The launch stays refused until every case under the agent's template has passed.
- **Never:** a tool no launch gets (`WebFetch`, `WebSearch`, `Task`, `Agent`, and the strict
  profile's own denies), or the agent's own `may_write`. For a different write scope, add a role
  in `.mirai/custom/roles/` and name it in `role`.
- A launch whose agent has an overlay that isn't approved as it is now is refused. MIRAI never
  runs MIRAI's definition instead.

A skill overlay changes a skill's text:

```toml
kind = "skill-overlay"
schema_version = 1
name = "mirai-write"

[instructions]
mode = "append"
```

Its text is in `.mirai/custom/skills/mirai-write/overlay.md`.

### In your own sessions

`mirai render` writes the approved agent and skill overlays into your sessions' files:
`.claude/agents/mirai-*.md` and `.claude/skills/mirai-*/SKILL.md`. It takes an overlay only with a
committed approval record that matches it as it is now. Any other overlay isn't rendered: MIRAI's
own file is, and render prints the overlay's line. Run `mirai render` after you approve an agent or
skill overlay, and commit its files with the record.

The lock's bundle hash stays MIRAI's own bundle: the plugin folder the trust root checks, which
launches never read. Your sessions' files are listed in the lock one by one, each with the overlay
files it came from. MIRAI's own launches take the overlay from the trust root at the launch.

## Approving an overlay

```
mirai approve --file .mirai/custom/document-types/prd.toml
```

- It refuses an overlay that doesn't validate or drops a protected part, listing every problem.
  Nothing is written.
- It shows the overlay, its hash and the files it binds, such as the template beside it. For a
  widening agent overlay, it says the red team must run first.
- Your decision is signed: one journal line, `kind: overlay`, over the file's hash and the files
  it binds. For a replacement template, it also records MIRAI's template version and hash.
- The same decision is written as a signed record,
  `.mirai/custom/approvals/<kind>-<name>.json`: the overlay's path, the hash of it and every file
  it binds, your decision, and for a replacement template MIRAI's template version and hash. Commit
  it with the overlay. It's how the approval reaches a teammate's checkout and CI.
- A change to the overlay, or to a file it binds, makes the approval stale. Approve it again.

### Which approval counts

An overlay is approved when its committed record matches it as it is now, checked against the
public keys committed on the integration branch. With no record, your local journal counts, where
MIRAI is set up. When there is a record, it decides for everyone:

- a record that doesn't verify (edited, or signed by a key that isn't committed) makes the overlay
  not approved;
- a record for other bytes makes it changed since its approval.

So `mirai lint` in a checkout with no MIRAI store, a teammate's before `mirai join` or CI, applies
every overlay with a valid record.

## Where MIRAI reads overlays

Only from the integration branch's commit, the trust root, like the project's own roles and
stacks. An overlay that is only on a branch isn't read. Every command that reads document types or
agents uses only the overlays approved as they are now: `mirai lint`, `mirai approve`,
`mirai reader-test`, `mirai epic render`, the plan step, the launches and the red team.

A skipped overlay gets one line, naming it and the fix:

```
note: .mirai/custom/document-types/brief.toml is not approved, so MIRAI's brief type is used; to use it: mirai approve --file .mirai/custom/document-types/brief.toml
```

## Seeing them: `mirai show overlays`

```
mirai show overlays
```

It lists every overlay in your work tree: its kind, the name it changes, its state and its full
path. The states: approved, not approved, changed since approval, rejected, or doesn't validate
(with its problems). An agent overlay also says whether it's instructions only, narrows or widens
the agent. "(not on main yet)" means the integration branch doesn't have it, so MIRAI doesn't use
it yet. From your session: `/mirai show overlays`.

## Doctor

`mirai doctor`'s "Overlays" item lists each agent:

- `MIRAI's`: no overlay;
- `overlay (approved)`: its overlay is used;
- `overlay (not approved)`: its launches are refused until you approve it;
- `widened: red team needed`: its launches are refused until a red-team run covers it.

It's yellow when an agent's launches are refused, an overlay isn't approved as it is now, or
MIRAI's template has a newer version, or other text, than a replacement template was approved
against.
