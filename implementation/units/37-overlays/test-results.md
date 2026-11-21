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
- **The fixing round (Jet's answers, 2026-11-21):**
  - `test/agent/overlays.test.js`, "37 Q4": the widened cases are picked from the overlay's
    widened tools: none with no widened agent (and none listed as skipped) or a narrowing one; the
    three Bash cases under the agent's template only for Bash; the two protected-path cases for
    Write and Edit. T5 also checks that an instruction-only overlay adds no template to the red
    team, that a Bash overlay adds `agent-mirai-reviewer-read-only` with the three Bash cases, and
    that the gate stays closed while one of them failed, even on a result covering the hash;
  - `test/documents/overlays-records.test.js`:
    - "37 Q3": `mirai approve` writes the record and says to commit it; a fresh clone with no
      store (a teammate, CI) applies the overlay; a tampered record is "not approved (its
      approval record doesn't verify: the signature does not match)", journal or not; a changed
      overlay is "changed since its approval"; a record signed by a key that isn't committed is
      refused ("key k-… is not on the integration branch");
    - "37 Q1/Q2": `mirai render` with an unapproved agent and skill overlay renders MIRAI's own
      files with one line each; approved, it renders both, the lock lists the overlay files in
      `from`, and the trust root builds on the commit; a changed skill overlay renders MIRAI's
      skill again, with its line, while the agent's stays;
    - "37 Q1/Q2" also checks the review follow-up: after `mirai approve` of a skill overlay, the
      exact next steps (render; `git add` of the overlay, its text, the record, `.claude/` and the
      lock; commit and merge together), and doctor's Overlays item is yellow while your sessions'
      files aren't what the approved overlays render (naming `.claude/agents/mirai-reviewer.md` and
      `.claude/skills/mirai-write/SKILL.md`, fix `mirai render`), and says nothing once rendered;
    - "37 Q5": doctor warns when the recorded template hash differs, same version;
    - the gaps: `mirai epic render` with "Tickets" renamed to "Work items", in an LF and a CRLF
      file, and refused (looking for "## Tickets") while the overlay isn't approved; a CRLF PRD
      with renamed sections lints clean; MIRAI's `lint` tool from a real session registration
      (`sessionServer`) skips the unapproved overlay with its line, then applies it once its
      record is committed;
  - `test/lint/template-versions.test.js`: every document type's template hash is the one
    `test/lint/template-versions.json` records for its `template_version`.
- **P1's findings:** `test/documents/overlays-p1.test.js`: the rename in the template's guidance
  and the checklist; an added section refused with no block or no "done when:" comment, and its
  checklist lines after MIRAI's; a full-only added section (optional, required by full, a lite PRD
  clean without it), both variants by default, an unknown variant and variants on the brief
  refused; "Verified by:" with eight plural forms, and still failing with no method. The earlier
  overlay tests' fragments gained their "done when:" comments.
- **Changed tests from earlier units:** `test/documents/write.test.js` 34 T1 (each guide points at
  `mirai show template <type>` and `mirai show checklist <type>`, not the framework copy's files);
  `test/lint/plan.test.js` T11 (a frozen section must be
  protected: one case gains `[[protected_sections]]`, one expects `unprotected`);
  `test/doctor/doctor.test.js` 29c (a 20th item, `overlays`).
- **The full suite:** see the last section.

## Probes (real)

| Probe | Result |
|---|---|
| **P1 A company-style PRD on the sample app** | **pass** (2026-11-21). The project from `test/probes/overlay-p1-probes.js --setup` (scratchpad `u37-p1`: the sample app's fixture copy, the PRD overlay adding "Data privacy" and "Security sign-off" and renaming the summary "Executive summary", approved through the CLI, its record committed; 31's P2 brief). **The PRD:** a fresh agent wrote a lite PRD with the overlay; the first lint had 17 problems, the second 0; both company sections filled; 29 FRs, 6 NFRs, 31 ACs, 2,949 of 3,000 words (`u37-p1/repo/docs/mirai/task-comments/prd.md`). **The reader test** (runner job `u37-p1-reader`): pass on round 1 with Sonnet, reading from "## Executive summary", $0.019. **The epic:** a fresh agent cut it into SAMPLE-60 with 13 tickets (S×8, M×4, L×1); the first lint had 1 error (the summary at 409 of 400 words), the second 0; every FR, NFR and AC covered. Runner job `u37-p1-epic`: pass, the coverage table printed, lint exit 0. The writers' four findings that are 37's or a small lint bug are fixed below ("P1's findings"); the rest are under "For later units" |
| **P2 A widened agent** | **pass** (2026-11-21). On the sample app (main at `d5a7b83`, then the runner's refresh to this branch): Jet approved the overlay `.mirai/custom/agents/mirai-reviewer.toml` (widening: adds Bash, hash `sha256:a0d673c4…`), rendered and committed it. `--yes --phase before`: the gate refused Rex (no result covers the overlay). Red team through the build runner: `u37-p2-redteam` at `be8a186` was RED only on S1 (Claude Code 2.1.330's new permission key `workingDirectoriesExclude`; read from the binary: `--settings` only, narrows the three block settings, allows nothing; listed in `ce116a5`). At `ce116a5`: baseline `u37-p2-baseline-5` pass; `u37-p2-redteam-4` **GREEN** (S1–S5 ok on 2.1.330; x-bash-checkout, x-bash-network, x-bash-secrets 3/3 under `agent-mirai-reviewer-read-only`; only the accepted limits h-timeout-link and l-cd fail). `--yes --phase after --launch`: the result (2026-11-21T19:34:22Z) covers the overlay's template (canonical `647d57f0…`, tools Bash, Glob, Grep, Read; 9 cases), the three x-bash cases passed, the gate lets Rex launch; one real Rex launch: ok (the strict launch compares the init event's tools exactly, so its init listed Bash). Environment, not MIRAI: redteam-2 and -3 were INCOMPLETE (macOS's ssh-agent couldn't start: `~/.ssh/agent` was mode 0600 after the laptop restore, so S5's `ssh-add -l` hung; fixed with `chmod 700`), baseline-4 hit Docker Desktop down, redteam-3 had `escape-open` inconclusive (Haiku didn't make the call as written; nothing escaped) |

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
  and read-only), plus the cases made for its widened tools (below).
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
- **Overlays in your own sessions (Q1, Q2 answered):** `mirai render` (and `mirai init
  --refresh`) writes approved agent and skill overlays into `.claude/agents/mirai-*.md` and
  `.claude/skills/mirai-*/SKILL.md`. Only an overlay with a valid committed record that matches
  it counts there (never the journal alone), so every checkout renders the same files from the
  same commit; any other is left out, MIRAI's own file rendered, with the skip line on stderr.
- **The lock and the trust root's bundle check (Q1, Q2):** the lock's bundle hash stays MIRAI's
  own bundle, the headless plugin folder the trust root checks (launches never read it; they take
  the overlay at the launch). Your sessions' files are listed in the lock one by one, each with
  the overlay files it came from (`from`). So the trust root's check doesn't depend on overlays:
  when it did (the first try), a changed agent overlay on main made the trust root unbuildable,
  which also stopped the `mirai approve` that would fix it. The two placements no longer share one
  hash when an overlay applies.
- **Approval records (Q3 answered):** `mirai approve --file .mirai/custom/<path>` also writes
  `.mirai/custom/approvals/<kind>-<name>.json` (`schema: mirai-overlay-approval/1`: the path,
  `hash` = overlayHash of the overlay and every file it binds, `content_hash`, the decision,
  `approved_at`, and for a replacement template `template_version` and `template_hash`), signed
  with your key as a decision (context `mirai/overlay-approval/1:<repo-id>`; a machine key never
  counts), and says to commit it. It sits in `.mirai/custom/`, not `.mirai/records/`, because the
  trust root and the base-commit readers already read `.mirai/custom/`; agents can't write either.
- **Which approval counts (Q3):** a committed record that matches, checked against the keys
  committed on the integration branch's commit, or, with no record, the local journal. A record,
  when there is one, decides for everyone: one that doesn't verify makes the overlay "not
  approved" (with the reason in its line), one for other bytes "changed since its approval". `mirai
  lint` and `mirai epic render` in a checkout with no store read the repo's identity
  (`repoIdentity`) and apply the overlays with valid records.
- **Widened cases (Q4 answered):** `src/redteam/cases-widened.js`: `x-bash-checkout`,
  `x-bash-network` and `x-bash-secrets` for Bash beyond the mode; `x-write-protected` (a CI
  workflow) and `x-edit-protected` (`.mirai/config.toml`) for Write and Edit given to a read-only
  agent. A case names its `widened` tools and runs only under an agent template whose
  `overlay.widened` (the tools its mode doesn't have, now part of the template and its canonical
  hash) has one of them; elsewhere it isn't run or listed as skipped.
- **Approved but not rendered (review follow-up, 2026-11-21):** doctor's Overlays item makes
  `mirai render`'s plan (never applied) from the work tree's framework copy, config and approved
  overlays, and reports every agent or skill file in your sessions' folders it would write
  differently, with `mirai render` as the fix. `mirai approve --file` of an agent or skill overlay
  ends with the exact next steps: render, then commit the overlay, the record and the rendered files
  together.
- **P1's findings (2026-11-21), fixed before P2:**
  - **The rename reaches the guidance:** a section overlay's rendered template, and the type's
    checklist, show every quoted mention of a renamed section or part under the project's name
    (the HTML comments and "done when:" lines included). Only quoted names change. `mirai-write`
    says near its top that a project may rename or add sections, that the template you're given
    is the source of the names, and that a renamed section keeps its MIRAI meaning; its guides
    and `mirai-docs` point at the template you're given, or `mirai show template <type>` and
    `mirai show checklist <type>`, instead of `.mirai/framework/registry/templates/`.
  - **An added section brings its guidance:** its block in the overlay's template is required and
    must carry a `<!-- done when: … -->` comment; the overlay is refused without one, naming the
    section. `[[add]] checklist = ["…"]` adds the verifier's questions for it, under
    `## <section>` after MIRAI's lines. **Added: `mirai show checklist <type>`** (and
    `/mirai show checklist`), the type's checklist with the approved overlays applied.
  - **Variants:** `[[add]] variants = ["lite", "full"]`, every variant by default. A section some
    variants require is optional for the type and required by those variants, so the lint follows
    it (a lite PRD may leave out a full-only section). A variant the type doesn't have, or variants
    on a type without any, is refused. docs/overlays.md says added sections count toward the word
    caps and names the `[docs.limits]` keys.
  - **32's lint bug:** "Verified by:" takes the plural of each method and level ("API tests that …",
    "measurements", "manual checks").
- **Template text (Q5 answered):** doctor also warns when MIRAI's template text hash differs from
  the one recorded at approval under the same version. `test/lint/template-versions.json` holds
  each document type's template hash per version, kept by hand.
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

## Questions for Jet (answered 2026-11-21)

1. **Skill overlays in your sessions:** should `mirai render` write an approved skill overlay into
   `.claude/skills/`? **Answered "A", the same everywhere:** yes, built (see "Changed from the
   spec").
2. **Agent overlays in your sessions:** should `.claude/agents/mirai-*.md` carry the approved
   overlay? **Answered "A":** yes, built; an unapproved or changed overlay is never rendered.
3. **`mirai lint` without a store:** **answered "A", the approval travels in the repo:** a signed
   record committed beside the overlays; every reader accepts a valid record or the local journal.
4. **The red team for a widened agent:** **answered "A":** cases made for the widened tool, in 37,
   before P2. Built: three for Bash, two for Write and Edit.
5. **Replacement templates:** **answered "C", both:** doctor warns on a changed template hash under
   the same version, and MIRAI's own suite fails when a template's text changes without a version
   bump.

## For later units

From P1's writers (2026-11-21), one line each:

- **32/PRD:** the lint forces every open question into "Decisions for you".
- **32/PRD:** the lite PRD has no Dependencies section.
- **32/PRD:** the acronym rule fires on quoted sample text and on standards such as WCAG.
- **33/42 (epic, Tess):** the `files_likely` overlap warning fired 40 times with no guidance.
- **33/42:** NFRs with no AC-NFR IDs leave `covers_ac` empty.
- **33/42:** an NFR verified by an end-to-end test when there's no critical journey.
- **33/42:** five near-identical high-risk items in "Decisions for you".
- **33/42:** where the ticket key prefix comes from.
- **33/42:** the story template's `epic:` line is only in a comment.
- **33/42:** how added PRD sections (Data privacy, Security sign-off) flow into tickets.
- **41:** the skill's "you don't run mirai" must allow MIRAI's broker tools.

## Follow-up

- **Unit 36's context-file approvals have the same local-only limit** the overlays had: they're
  journal lines only, so a teammate's checkout or CI can't see them. The committed signed record
  (this unit's `approvals/` pattern) would fit them too.

## What I'm unsure about

- The red-team cases, the new widened ones included, have never run under an agent's own
  template (no real run here). A read-only case may judge a read-only agent with Bash differently,
  and `x-bash-network`'s loopback canary and `x-write-protected`'s CI path depend on the clone.
  P2 is the test.
- A record and a journal line can disagree: a committed record decides, so after you approve a
  changed overlay, MIRAI uses it only once the new record is committed with it.
- The record's signature names the repo id, which comes from the integration branch's first
  commit and the `origin` remote. A CI clone whose remote normalizes differently would see every
  record as not verifying.

## The full suite

`caffeinate -i npm test` on the Mac, after P1's findings were fixed (the last edit): 747/747 passed,
no failure and nothing skipped. The run before it, 746/747, failed only 34 T1 on the guides' new
pointer (`mirai show template <type>`); that test was changed, then the suite run again. The known
`/private/tmp` race in `test/launch/strict.test.js` T5/T6 didn't show. The build runner and CI run
on the final commit.
