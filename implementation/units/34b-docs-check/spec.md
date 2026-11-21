---
unit: "34b"
name: docs-check
status: done (spec and unit approved by Jet, 2026-11-20: "approve 34b, and add the read" / "approve 34b"; Jet's interview the same day; built after 34 is merged, before 35 is rebased and built)
roadmap: new, from unit 38's interview (Jet, 2026-11-20: "how will you be sure in the end that all these configs and commands are documented?"; placement "A")
depends_on: ["34"]
---

# Unit 34b: The docs check

## Why

Each unit's spec has a "Docs" item, checked when that unit is reviewed. Nothing checks across
units, so gaps pile up. On 2026-11-20:
- `docs/` never names `mirai lint`, `mirai protected`, `mirai help` or `mirai version`;
- the config schema has about 110 keys, and no page explains them.

By v1.0 a search at the end would turn up hundreds of gaps at once. This unit makes the test
suite fail as soon as something you can use is left undocumented, so each unit documents its own
additions before it merges.

**Why now:** built before 35, so 35–38 and every later unit are checked as they're built.

## Decisions (Jet, 2026-11-20, interview)

1. **A test in the suite, on every PR** (placement "A"). This is a small unit of its own, built
   after 34 merges and before 35 is rebased and built.
2. **Config keys get one reference page** (Q, "A"). `docs/config.md` has one row per key: the
   key, who may set it (project file, personal repo file, personal global file), the default, and
   one sentence on what it does. The test checks the rows against the schema in both directions.
3. **Exceptions live on one short list,** each with a reason.
4. **The check proves a mention, not quality.** A read of the docs before v1.0 checks the wording.
5. **A read of the existing docs now** (Jet, "approve 34b, and add the read"). Every page in
   `docs/` is read against the code as it is on main, and what's out of date is fixed in this unit.

## Scope

**In**

1. **`test/docs/coverage.test.js`**, run by `npm test` and in CI:
   - **commands:** every command in `src/cli/commands/index.js`, and every subcommand named in
     its `usage` string (for example `mirai redteam accept-blocker`; commands have no subcommand
     table today, so the usage string is the source), must appear in `docs/` as `mirai <command>` or `mirai <command>
     <subcommand>` (in a code span, a code block or a heading);
   - **session commands:** every `/mirai <command>` that 21f's server offers
     (`src/mcp/tools/commands.js`) must appear in `docs/` as `/mirai <command>`, or the command's
     doc page must say it isn't available in a session;
   - **config keys:** every key in `LAYER_KEYS` and the schema (expanded below each `*`) has
     exactly one row in `docs/config.md`'s tables, with every column filled. A row whose key the
     schema doesn't know fails;
   - **document types:** every `registry/document-types/*.toml` (and its folders, such as 36's
     `context/`) is named in `docs/documents.md` or a page it links;
   - **failure messages** name what's missing and where to add it, for example: `mirai protected
     isn't named in docs/: add it to the page for its area (docs/agent-safety.md?) or to
     docs/internal-list.toml with a reason`.
2. **`docs/internal-list.toml`:** the exceptions, each with `name`, `kind` (command, key, type) and
   `reason`. An entry without a reason fails, and so does an entry for something that no longer
   exists. It starts with `mirai hook` ("called by git, not by you") and anything else the build
   finds that's truly internal, each one named in the PR.
3. **`docs/config.md` (new):** every key, grouped by table (`git`, `docs`, `gate`, `run`, …),
   with the rows from decision 2. Defaults come from `src/config/defaults.js`. The page opens with
   the three files and what each may set (D-57). `docs/install.md` links it.
4. **Fill today's gaps:** `mirai lint`, `mirai protected`, `mirai help` and `mirai version` get
   their lines in the right pages, plus any other gap the first run shows. The PR lists each one.
6. **The read** (decision 5): an agent reads each existing page in `docs/` against the code
   (commands' usage strings and options, config defaults, file paths, error codes, flows) and lists
   every statement that is no longer true, with the page, the line and what the code says.
   - Each item is fixed in this unit. The list goes in `test-results.md` as a table: page, old
     text, new text, the code it was checked against.
   - Something that looks wrong but may be intended is not changed. It goes to Jet as a question.
   - The read covers wording rules too (`research/14-document-wording.md`): a page that breaks
     them is noted, and fixed only where the fix is small.
7. **`docs/README.md` (new, short):** what each page in `docs/` covers, so a new page has a place
   in the index. The test checks that every file in `docs/` is listed.

**Out**

- A test for correctness. The read (Scope 6) is a one-time pass; the read before v1.0 repeats it.
- Agent and skill files, and MCP tool descriptions (they describe themselves).
- Descriptions inside the config schema (decision 2's option C).
- Units 35–38's additions. Each of them documents its own, and this check holds them to it.

## Tests

- **T1** The check passes on the finished branch: no gaps, every exception with a reason.
- **T2** Seeded gaps fail, naming the missing item and where to add it:
  - a fixture command that no page mentions;
  - a subcommand that's missing from the docs;
  - a `/mirai` command with no mention;
  - a schema key with no row in `docs/config.md`;
  - a row for a key the schema doesn't know;
  - a row with an empty column;
  - a document type no page names;
  - a `docs/` file missing from `docs/README.md`.
- **T3** The internal list: an entry without a reason, and an entry for something that no longer
  exists, each fail.
- **T4** Speed: the check runs in under 2 seconds, with no git, network or Docker.

## Probes (real)

- **P1 Your read of `docs/config.md`.** **Pass when** you can find what `run.stop_by` and
  `docs.root` do, and who may set them, in under a minute each, without opening code.
- **P2 The check catches a real unit.** After 35 is rebased on top of this unit: **pass when** the
  check either passes on 35, or names exactly what 35 added without docs (the `interview` type, the
  brief's `Interview:` link). Any gap is fixed in 35, not added to the internal list.

## Done when

- T1–T4 pass, and the full suite passes through the build runner and CI.
- The read's table is in `test-results.md`, every item fixed or asked.
- P1 passes. P2 runs during 35's rebase and is recorded in 34b's test results.
- PROGRESS lists 34b between 34 and 35.
