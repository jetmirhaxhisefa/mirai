# Unit 37: test results (2026-11-21)

## Tests

- **`test/documents/overlays.test.js`:**
  - T1: every built-in type (all twelve) declares `protected_sections`, each entry with what reads
    it. The PRD protects the summary and its five parts, the FR, AC and NFR sections, "Not in
    this" (read by the reader test too), the `Brief:` line, `track` and `variant`; the brief its
    `Interview:` line; story and bug "Acceptance criteria"; the plan its frozen sections; the
    context types exactly the sections 36's lints read. A registry copy whose PRD drops "Not in
    this" from `protected_sections` is refused (`"Not in this" is read by the summary check, so
    it must be in protected_sections`), and a protected entry naming nothing the type has is
    refused too;
  - T2: "Data privacy" added after "Problem" (the brief) is in the rendered template between
    "Problem" and "Who it is for", and the lint requires it (the example brief fails with one
    `missing-section`, then passes with it). A new order moves "Why now" in the template and the
    lint. The PRD renamed ("Summary for approval" to "Executive summary", "Not in this" to "Out of
    scope") lints clean under the project's names; MIRAI's own name fails (`renamed-section`); a
    problem names the part as the project calls it (`"### Out of scope" is empty`). The reader
    test's summary and section lookup read the renamed parts (and fail without the map). A MIRAI
    template version bump (a registry copy whose PRD gains "Rollback", version 2) reaches the
    project with the overlay still applied. Through the CLI: the overlay approved with a signed key,
    `mirai reader-test` (fake reader) and `mirai approve` of the renamed PRD and its brief pass;
  - T3: an `order` that leaves out "Functional requirements" (naming its readers), an `order`
    that moves the summary from first, a rename of "Non-goals" and "Not in this" to one name
    (naming both protected parts), a rename onto another section's name, and a `lint_checks`
    without `prd` are each refused. Adding a check passes. A stray template, an unknown type and
    an unknown `after` are named. A context type's protected section may be renamed
    (`Sources` to `References`), never dropped;
  - T4: a company-style PRD template (MIRAI's parts renamed, plus "Data privacy" and "Security
    sign-off") passes, is used as it is, records MIRAI's template version 1 and hash, and a PRD
    written to it lints clean. Without "Out of scope" (MIRAI's "Not in this") it's refused, naming
    the part and its readers; without the `Brief:` line or `track`, too. After MIRAI's PRD template
    moves to version 2, doctor's item is yellow: "MIRAI's prd template is at version 2; your
    replacement … was approved against version 1";
  - T6: through the CLI with a signed key: an overlay on main, not approved, is skipped by
    `mirai lint` with one line naming it and `mirai approve --file …`; approved, it's one signed
    line (`kind: overlay`, `item: overlay-brief`, the hash, and the template it binds in `files`)
    and the lint requires the added section, with no note; the template file alone is refused
    ("approved with its overlay"); a changed template on main is skipped again ("changed since its
    approval"); an overlay only on a branch (approved there) isn't read, and `mirai show overlays`
    says "not on main yet"; a replacement without "Out of scope" is refused at approval with the
    problem listed, nothing written;
  - T7: Kai, Rex and every role pass the schema without overlays; for each agent an
    instruction-only, a narrowing and a widening overlay validate and are classed so (Kai under
    the read-only reviewer role with Edit, Write and Bash is a widening). A tool no launch gets,
    an unknown role and an agent's own `may_write` are refused; a skill overlay validates. In a
    repo: doctor lists "overlay (not approved)" for both, then "overlay (approved)" and "widened:
    red team needed" after approval; with no overlays, both "MIRAI's"; `mirai show overlays` lists
    kind, name, state and full path, an invalid overlay with its problem.
- **`test/agent/overlays.test.js`:**
  - T5 (fake launcher, a stand-in `claude` that keeps its arguments): an unapproved overlay
    refuses Rex's launch (`overlay-not-approved`, naming `mirai approve --file …`); an approved
    instruction-only overlay launches with its text at the end of Rex's prompt and his tools as
    they are; a narrowing overlay (no Glob) launches at once on the mode's result with
    `--tools Grep,Read`; a widening overlay (Bash) is refused (`overlay-widened`, naming
    `mirai redteam run`) with its own template `agent-mirai-reviewer-read-only` carrying the
    overlay's hash; a result for another hash doesn't cover it; a fake result covering its hash
    lets it launch, with `--tools Bash,Glob,Grep,Read`.
- **Changed tests from earlier units:** `test/lint/plan.test.js` T11 (a frozen section must be
  protected: one case gains `[[protected_sections]]`, one expects `unprotected`);
  `test/doctor/doctor.test.js` 29c (a 20th item, `overlays`).
- **The full suite:** see the last section.

## Probes (real)

| Probe | Result |
|---|---|
| **P1 A company-style PRD on the sample app** | not run yet |
| **P2 A widened agent** | not run yet. `test/probes/overlay-p2-probes.js` is ready: `--yes --phase before` (the gate refuses Rex, no model), then `mirai redteam run` through the build runner, then `--yes --phase after` (the result covers the overlay's template, by its hash; the gate lets Rex launch), and `--launch` for one real Rex run whose init lists Bash |

## Changed from the spec

- **The rename map is a list of pairs:** `[[rename]] from = "Summary for approval"` /
  `to = "Executive summary"`. MIRAI's TOML subset has no quoted keys, so `"Executive summary" =
  …` can't be written.
- **Protected entries:** `[[protected_sections]]` with `name` and `read_by`, and
  `[[protected_fields]]` with `name` (a frontmatter field) or `link` (a link line's label, such as
  `Brief`): a link line isn't a frontmatter field, and the spec names two lists. `read_by` takes
  `approval`, `reader-test`, `trace`, `epic-coverage`, `graph-lint`, `gate`, `lint` (the type's own
  checks) and `epic-render`.
- **What must be protected is wider than the spec's PRD list:** the registry requires every
  section and part a type's checks read by name (`CHECK_READS` in `registry.js`), every section
  its IDs are defined in (trace) and its frozen sections (the plan gate). For a PRD that adds User
  journeys, Non-goals, Risks, Dependencies, Rollout, Assumptions, Open questions, Glossary, the four
  requirement groups, Terms and ID prefixes. The business type protects every required section
  (its check reads each one's bullets).
- **`lint_checks` in an overlay is the whole list**, MIRAI's plus the added ones; one without a
  MIRAI check is refused.
- **An added section is required unless `required = false`**, and goes at the end without `after`.
  A section overlay's template holds only `## <added section>` blocks; any other block is refused.
- **A document under MIRAI's own name for a renamed section fails** (`renamed-section`), so one
  name means one section in a project.
- **A replacement template's sections are its `##` headings:** MIRAI's required ones stay
  required, MIRAI's optional ones stay optional, the project's own are required. `add` and `order`
  aren't allowed with `replace = true`. Its frontmatter must say the type and hold every protected
  field; its link lines are checked under the title.
- **Agent overlays:** the `.toml` is required (it says how the `.md` applies); `role`,
  `read_only`, `[tools] allowed` (the whole list) and `[instructions]` (`append`, or `replace` with
  the heading `part`). `may_write` is refused: an agent's own write scope isn't applied since 21a,
  so the way is a role of its own in `.mirai/custom/roles/`.
- **Widening, exactly:** a tool beyond the agent's MIRAI definition or beyond its role's mode
  (the strict profile's read-only or read-write tools), a role change to a role that may write, or
  `read_only = false`. Narrowing: fewer tools, `read_only = true`, or a read-only role.
- **A widened agent runs under a template of its own,** `agent-<name>-<mode>`: its launch's mode
  template with the overlay's tools and the overlay's path and hash (in the canonical hash). It
  isn't part of the red-team key, so other agents' launches stay green; its coverage is checked by
  that canonical hash. A narrowing overlay that changes the tools runs under its own template too,
  gated by its mode's result. The red team "gains the cases" by running its existing cases under
  each approved widening overlay's template, for each mode the agent may run under (its role's
  and read-only); it has no new case definitions.
- **The approval line:** `item` is `overlay-<name>` (the key you type to confirm), `files` binds
  the `.md` beside it, and two new journal fields, `template_version` and `template_hash`, go with
  `kind: overlay` only. The overlay is approved as your work tree has it; MIRAI uses the trust
  root's copy only when its bytes match.
- **The skip line** goes to stderr from `mirai lint`, `mirai epic render`, `mirai approve` (for
  the types it checks) and `mirai show template`. The reader test and the plan step use the
  approved overlays without a line; a launch whose agent overlay is skipped is refused.
- **Added: `mirai show template <type>`** (and `/mirai show template prd`, a new `type`
  argument of `mirai_command`): the type's template with the approved overlays applied. P1's
  fresh agent, and later Nora, need the rendered template from somewhere.
- **Skill overlays** (`skills/<name>/overlay.toml` + `overlay.md`) are checked, approved, listed
  and applied in the registry (`skillTexts`), but not placed anywhere yet: MIRAI's skills reach
  only your own sessions, through `mirai render`, whose files the lock pins (a question below).
- **Agent overlays apply to MIRAI's launches only.** Your interactive `.claude/agents/` files stay
  MIRAI's (a question below).
- **`mirai show overlays` lists your work tree's overlays,** each also marked "(not on main yet)"
  or "(main has another version)" when the integration branch differs.
- **Doctor has one new item, "Overlays"** (the 20th). "widened: red team needed" uses the
  red-team status doctor already reads.
- **MIRAI's `lint` tool for your session** applies the overlays when its registration knows the
  store, and returns `overlays_skipped`.
- **`mirai epic render`** finds and keeps a renamed generated section under the project's name.
- **T2's "after Problem":** the PRD has no "Problem" section, so T2 adds "Data privacy" after
  "Problem" on the brief, and after "User journeys" on the PRD.
- **Code moved:** the tool floor (`FLOOR_DENY_TOOLS`) is in `registry.js`, shared with
  `strict.js`; the template check of `redTeamStatus` is `forTemplate`, exported.

## Questions for Jet

1. **Skill overlays in your sessions:** should `mirai render` write an approved skill overlay into
   `.claude/skills/` (the lock recording it as an overlay, the trust root's bundle check allowing
   it)? Today they're checked and approved but not placed.
2. **Agent overlays in your sessions:** should your interactive `.claude/agents/mirai-*.md` files
   carry the approved overlay too, or stay MIRAI's (they don't launch MIRAI's runs)?
3. **`mirai lint` without a store:** in a checkout where MIRAI isn't set up (a teammate before
   `mirai join`, CI later), overlays aren't applied, so a PRD with renamed sections fails there.
   Keep it so, or trust overlays approved by any committed key?
4. **The red team for a widened agent:** it runs the same cases as the agent's mode. Should it get
   cases made for the widened tool (for example a read-only agent with Bash trying to write the
   checkout)? P2 will show whether the read-only cases pass as they are with Bash added.
5. **Replacement templates:** doctor warns on a newer MIRAI template version only. Warn also when
   MIRAI's template text changed with the same version?

## What I'm unsure about

- The red-team cases have never run under an agent's own template (no real run here); a case
  written for the read-only mode may judge a read-only agent with Bash differently. P2 is the test.
- The session `lint` tool builds a store handle from its policy (`dir`, `repo_id`, the checkout,
  the trust root's branch) to read the journal; it's untested against a real session registration.
- `mirai epic render` with renamed generated sections, and a CRLF file with renames, have no test.

## The full suite

`caffeinate -i npm test` on the Mac, on the unit's commits (`202096b`): 736/736 passed, no
failure and nothing skipped, in about 13 minutes. The known `/private/tmp` race in
`test/launch/strict.test.js` T5/T6 didn't show this time. One change came after that run (a rename
in a problem message now uses a replacer function, `src/lint/rules.js`); the lint, PRD and overlay
test files passed again after it, 55/55. The build runner and CI run on the final commit.
