---
unit: "37"
name: overlays
status: approved (Jet, 2026-11-20: "approve 37"; decisions 1–8 from his interview answers the same day; built only after 36 is finished, and re-checked against 34–36 first)
roadmap: design/07-implementation-roadmap.md, row 37; D-37 (design/04, and its unit 21a update); R2-M12; unit 03b (the registry core); units 18 and 21a (the red team and strict launches)
depends_on: ["03b", "07", "36"]
---

# Unit 37: Template registry content and overlays

## Why

MIRAI's document types, templates, agents and skills are data files (D-37). A project can
already add its own stacks, test adapters and roles in `.mirai/custom/`. It can't yet change a
template, an agent or a skill.

A company team will need that. For example, its PRD has a "Data privacy" section and a "Security
sign-off", and calls the summary the "Executive summary". Without overlays, the team either edits
MIRAI's framework copy, which the next update overwrites, or doesn't use MIRAI.

This unit adds overlays: a project's own changes, kept beside MIRAI's files, approved by you, and
never allowed to break what approvals, IDs, tracing and the security model rely on.

**Why now:** the document agents (Nora 41, Vera 40, Tess 42) read the templates through the
registry. Overlays settle what "the template" means in a project before they're built.

## Decisions (Jet, 2026-11-20, interview)

1. **For company teams** (Q1, "A"): a team whose documents must follow its company's rules.
2. **You approve every overlay** (Q1, Jet: "I always approve if somebody different than me is
   changing them"). An overlay needs your signed approval. An unapproved or changed overlay isn't
   used, and MIRAI says so.
3. **Overlays stay in their project** (Q1, Jet: "PRD design is different in this project and
   will not be synced back"). Which ones go back to MIRAI is `mirai promote`'s choice (74), file
   by file.
4. **Two ways to change a template** (Q2, "C"):
   - **section changes:** add, reorder or rename sections, a rename with a mapping (`"Executive
     summary" = "Summary for approval"`). MIRAI's template updates still flow in underneath;
   - **a whole replacement template:** the project's own design. MIRAI's updates don't flow in;
     `doctor` says when MIRAI's template changed since the replacement was approved.
5. **Protected parts are what MIRAI's machinery reads** (Q3, "A"). MIRAI declares them per type.
   Neither way may drop them. For a PRD: the summary for approval, the FR, AC and NFR sections with
   their IDs, "Not in this", the `Brief:` link, and `track` and `variant`. A project can't
   unprotect a part.
6. **Agents and skills may change fully, permissions included** (Q4, "C"), with your signed
   approval.
7. **A widened agent needs the red team** (Q4b, "B"). An overlay that gives an agent more than
   its MIRAI definition (a tool, a write path, a role or mode) is refused at launch until the red
   team has passed with that overlay. Instruction-only and narrowing changes launch at once.
8. **Each agent's definition file comes with its own unit** (Q5, "B"). This unit makes every
   existing agent file validate (Kai and Rex today) and applies overlays to any file added later.

## Scope

**In**

1. **Protected parts in each document type:** a `protected_sections` list and `protected_fields`
   list in each `registry/document-types/*.toml` (brief, PRD, epic, story, bug, plan, interview,
   and the context types from 36). The brief's `Interview:` link (35) and the reader test's sections (34: "Decisions for you", "Not in this") are protected. Each entry names what reads it (approval, the reader test,
   `trace`, the epic coverage, the graph lint, the gate). The registry refuses a type whose
   `lint_checks` read a section that isn't protected.
2. **Section overlays: `.mirai/custom/document-types/<type>.toml`:**
   - `add`: a new section with its position (`after = "Problem"`) and whether it's required;
   - `order`: a new order of the type's sections;
   - `rename`: `"<MIRAI's name>" = "<the project's name>"`. The lint, the summary check, approval
     and `trace` read the project's name as MIRAI's;
   - `lint_checks`: may add a check, never remove one (as the registry core already says);
   - a template overlay `.mirai/custom/templates/<type>.md` fragment per added section, placed into
     the rendered template.
   - **Applied on top each time:** the effective type and template are MIRAI's current ones with
     the overlay applied, so a MIRAI template version bump still reaches the project.
3. **Replacement templates: `.mirai/custom/templates/<type>.md` with `replace = true`** in the
   type's overlay:
   - the project's template is used as it is;
   - the lint refuses it if any protected section or field is missing (through the rename map);
   - its approval records MIRAI's template version and hash at the time;
   - `mirai doctor` warns when MIRAI's template for that type has a newer version than the one
     recorded.
4. **Agent and skill overlays: `.mirai/custom/agents/<name>.toml` and `.md`,
   `.mirai/custom/skills/<name>/`:**
   - **instructions:** text added to an agent's prompt or a skill file (appended, or replacing a
     named part);
   - **permissions:** tools, write scope, role or mode may change;
   - **widening** is anything the agent's MIRAI definition or its role's mode doesn't allow. The
     launch refuses a widened agent until a green red-team result covers that overlay's hash,
     naming `mirai redteam` as the fix. The red team gains the cases that test a widened agent's
     configuration (its tools and paths against the same escape cases as MIRAI's modes);
   - narrowing and instruction-only changes need no red-team run.
5. **Approval of overlays:** `mirai approve --file .mirai/custom/<path>` writes one signed line,
   `kind: overlay`, over the file's hash (and, for a replacement template, MIRAI's template version
   and hash):
   - it refuses an overlay that drops a protected part or doesn't validate, listing the problems;
   - every MIRAI command that reads the registry uses only overlays approved as they are now, read
     from the trust root (the base commit), like the project's roles and stacks today. A changed
     or unapproved overlay is skipped with one line naming it and the command to approve it; a
     launch whose agent overlay is skipped is refused rather than run on MIRAI's definition.
6. **Agent definition files validate:** Kai's and Rex's definitions and every role pass the schema
   with overlays applied; `mirai doctor` lists each agent with "MIRAI's", "overlay (approved)",
   "overlay (not approved)" or "widened: red team needed".
7. **`mirai show overlays`:** every overlay with its kind, state and full path.
8. **Docs:** `docs/overlays.md` (new): the two ways, the protected parts per type, agent and skill
   overlays, widening and the red team, approval, what `doctor` shows. `docs/documents.md` links
   it.

**Out**

- Nora's, Vera's, Tess's, Ivy's and Arlo's definition files (40, 41, 42, 50, 64).
- `mirai promote`, the leak scanner and `mirai contribute` (74–76).
- Removing or loosening lint checks; unprotecting a part.
- Overlays for the build loop's internals (the plan gate, the loop guard, the hooks).

## Tests

- **T1** Protected parts: every built-in type declares them; a type whose check reads an
  unprotected section is refused by the registry.
- **T2** Section overlay: adding "Data privacy" after "Problem" puts it in the rendered template
  and the lint requires it; reordering moves sections; renaming "Summary for approval" to
  "Executive summary" passes the summary check, approval and the reader test's section lookup.
  **A MIRAI template version bump** (a fixture adds a section to MIRAI's PRD) reaches the
  project with the overlay still applied (the roadmap's done-when).
- **T3** Protected: an overlay that removes or reorders away a protected section, a rename that
  maps two names to one, and a `lint_checks` removal are each refused, naming the part and what
  reads it (the roadmap's done-when).
- **T4** Replacement: a company-style PRD template with every protected part passes; without
  "Not in this" it's refused; after a MIRAI PRD template bump, `doctor` warns.
- **T5** Agent and skill overlays: an instruction-only overlay launches (fake launcher) with the
  added text in the prompt; a narrowing overlay launches; a widening overlay (an extra tool) is
  refused until a fake red-team result covering its hash is recorded, then launches.
- **T6** Approval and trust root: an unapproved overlay is skipped with its line; a changed one
  after approval is skipped; an overlay only on a branch, not in the base commit, isn't read;
  approval refuses an overlay that drops a protected part, nothing written.
- **T7** Every agent definition and role validates with and without overlays (the roadmap's
  done-when); `mirai doctor` and `mirai show overlays` list each state.

## Probes (real)

- **P1 A company-style PRD on the sample app:** an overlay that adds "Data privacy" and "Security
  sign-off", renames the summary to "Executive summary", approved with your key. A fresh agent
  writes a PRD with it from 31's P2 brief. **Pass when:**
  - the PRD lints clean after at most one fixing round, with the new sections filled;
  - the reader test runs on the renamed summary;
  - an epic cut from it passes the coverage lint.
- **P2 A widened agent:** an overlay gives the reviewer `Bash` on the sample app. **Pass when** the
  launch is refused, the red team runs with the overlay through the build runner, and then the
  launch is allowed, with the result recorded against the overlay's hash.

## Done when

- T1–T7 pass, and the full suite passes through the build runner and CI.
- P1 and P2 pass.
- The roadmap row's done-when holds: a custom overlay adds a section and survives a template
  version bump; an overlay that drops a protected section is refused; every agent manifest
  validates.

## Checked against the queued units

- **36** (re-checked after it was built, 2026-11-21): the sections 36's lints read must be in
  each context type's `protected_sections`:
  - `business`: `Sources`, and the required sections it checks;
  - `journeys`: `Journeys` and `Sources`;
  - `feature-map`: `Screens`;
  - `project`: `Layout`, `Stack`, `Commands`, `Test levels` and `Instructions`;
  - `conventions`: `Rules`.
  
  An overlay can add a section to a context type and rename one of these through the rename map
  (36's lints then read the project's name), but never drop one. 36's
  `(open)` marker is a line format, not a section, so nothing changes for it.
- **39:** adds `.mirai/custom/hooks/` and `scripts/` to the overlay folders (39's spec, "Checked
  against the queued units").

