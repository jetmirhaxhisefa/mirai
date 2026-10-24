---
unit: "07b"
name: lint
status: approved (2026-10-24, as part of unit 07; split by open point 1)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 07; D-04, D-19, D-35, D-37, D-40, D-41; 03 "Templates" (shared frontmatter); 01 §5 template rules
depends_on: ["01", "03b", "04", "07a"]
---

# Unit 07b — The lint framework and `mirai lint`

Unit 07's spec was approved with its four open points as recommended. This is the second half.
The frontmatter reader is unit 07a (`../07a-frontmatter-reader/spec.md`).

## Why

Every document MIRAI works with, from a ticket to a PRD, must have the same shape, with nothing
forgotten and nothing padded (D-41). The lint checks that shape **before any AI looks at it**. It
is cheap, deterministic and fast, so agents and you get exact `file:line` messages instead of a
reviewer's opinion.

**Roadmap "done when":**
- lints a sample doc set;
- messages give file:line;
- an extra heading is flagged;
- a missing template version is flagged.

## Scope

**In:**
- **A Markdown structure scanner:** headings, fenced blocks, HTML comments, links and IDs, with
  line and column. It's not a Markdown renderer.
- **The lint rules,** driven by document-type definitions in the registry (03b, D-37):
  - frontmatter fields;
  - the template version;
  - sections: required, optional, unknown, order, empty, "Not applicable";
  - IDs: format, uniqueness, references inside the document;
  - links;
  - Mermaid blocks.
- **The registry gains the fields the rules need,** all optional and additive (schema stays 1):
  `template_version`, `optional_sections`, `frontmatter`, `ids`.
- **`mirai lint [<path>...] [--json]`.**

**Out:**
- **The real templates:**
  - story, bug and plan come in unit 08;
  - reports and findings in unit 09;
  - the PRD and the brief in Milestone B.

  This unit tests against a sample document type in the test fixtures.
- **The frontmatter reader:** unit 07a.
- **Per-project overlays** (add, rename or reorder sections; renames with a mapping): unit 37.
- **Cross-document checks** (an AC covered by a ticket, a ticket naming a PRD's FR): `mirai trace`
  (D-35), later.
- **Frontmatter `status` against the run log's history** (R-M11): it needs document events, which
  come with the document flow (B). Unit 04's `checkDocumentState` is ready for it.
- **The `pre-commit` hook that runs the lint** (unit 44).

## The frontmatter

Read by 07a's `readFrontmatter`. A reader error is reported as a lint problem with its
position, and the file's other rules are skipped.

## The Markdown scanner

- **ATX headings:** `#` to `######`, a space, then text. Setext underlines (`===`, `---` after a
  text line) are refused: "use # headings".
- **Fenced blocks** (```` ``` ```` or `~~~`, three or more): their content is opaque. Headings,
  IDs and links inside them don't count. An unclosed fence is an error.
- **HTML comments** (`<!-- … -->`, possibly over several lines) are opaque too. Templates keep
  their hidden "done when" rule per section there (01 §5).
- **Links:**
  - `[text](target)` and `[text](target "title")`, outside code spans;
  - reference-style and auto-links are reported as they are, and the lint checks their targets
    the same way.
- **IDs:** tokens matching the document type's ID patterns, outside code, with their positions.

## The lint rules

All problems are collected, never stopping at the first. Each is
`{ code, file, line, column, reason, hint? }`, printed as `file:line:column: reason`.

**Frontmatter (shared, 03 "Templates"):**

| Field | Rule |
|---|---|
| `id` | required; the type's ID pattern for documents (e.g. `prd-login`), `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` by default |
| `type` | required; a document type the registry knows |
| `template` | **required**; `<type>@v<N>` with the same type. Older than the definition's `template_version` → a warning; newer → an error ("written for a newer template") |
| `status` | required for documents, from the type's state machine; **refused for tickets** (D-06: status lives in the store) |
| `version` | an integer ≥ 1, when the type is versioned |
| `derived_from`, `upstream`, `downstream` | lists of document ids |
| `owner` | a string |
| `updated` | a real `YYYY-MM-DD` date |

The type's own fields come from its definition (`frontmatter.fields.<name>`): a type, required
or not, allowed values or a pattern. Unknown fields are errors.

**Sections (D-41):**
- **Strictness is at `##` (H2) level,** for the template's sections. There is exactly one `#`
  (H1), the title, first.
- **Every required and optional section is present, once, in the template's order.**
- **An unknown `##` heading is an error** (`unknown-section`), with the closest known name as a
  hint. A one-off topic goes in an existing section, or into a `template_gap`.
- **`###` and deeper are free** inside a section (a PRD's `### FR-1`), unless the type lists
  allowed subsections for that section.
- **An empty section is an error.** Only comments and blank lines count as empty.
- **An optional section** has content or one line `Not applicable — <reason>`. A required section
  may not be "Not applicable".

**IDs (D-35):**
- **The type lists its ID kinds,** for example
  `{ prefix = "FR", pattern = "FR-[0-9]+", defined_by = "heading" }` or
  `{ prefix = "AC", pattern = "AC-FR-[0-9]+\\.[0-9]+", defined_by = "bullet" }`.
- **Defined IDs are unique** in the document.
- **A mentioned ID of a kind this type defines, but defined nowhere in it, is an error**
  (`unknown-id`). IDs of other kinds are left to `mirai trace`.
- **A dependent ID needs its parent:** `AC-FR-2.1` without `FR-2` is an error.

**Links:**
- **A relative link** must point at a file inside the repo that exists. An `#anchor` must match
  a heading in that file, using GitHub's slug rule.
- **Not allowed:** absolute paths, `..` leading out of the repo, and `file:` links.
- **`http(s)` links** aren't fetched. A link with a credential in it is an error (03b's
  `linkHasCredential`).

**Mermaid (D-40):**
- **A ```` ```mermaid ```` block's first non-comment line** starts with a known diagram keyword:
  `graph`, `flowchart`, `sequenceDiagram`, `classDiagram`, `stateDiagram`, `stateDiagram-v2`,
  `erDiagram`, `gantt`, `journey`, `pie`, `mindmap`, `timeline`, `gitGraph`, `quadrantChart`,
  `requirementDiagram`, `C4Context`, `C4Container` or `C4Component`.
- **`( ) [ ] { }` balance,** outside quoted strings and `%%` comments.
- **No real parse:** that would need a dependency.

## The registry additions (03b's `document-type`, still schema 1)

```toml
kind = "document-type"
schema_version = 1
name = "sample"
template = "sample.md"
template_version = 2
checklist = "sample-checklist.md"
required_sections = ["Summary", "Requirements"]
optional_sections = ["Risks"]          # order = required then optional, unless `section_order` says otherwise
section_order = ["Summary", "Requirements", "Risks"]
status = "required"                    # or "forbidden" (tickets)
versioned = true

[frontmatter.fields.priority]
type = "enum"                          # string | integer | boolean | date | list | enum
values = ["low", "normal", "high"]
required = false

[[ids]]
prefix = "FR"
pattern = "FR-[0-9]+"
defined_by = "heading"                 # heading | bullet | table
```

The patterns are checked when the registry loads: they must compile, and they're anchored by
the lint, so a pattern can't match half a word. A section name in `section_order` must be one of
the listed sections.

## `mirai lint [<path>...] [--json]`

- **Paths:**
  - files or folders, inside the repo;
  - with none, the folders the project lists, or the repo, skipping `.git`, `node_modules` and
    the store;
  - only `.md` files with a frontmatter `type` are linted. Others are counted as skipped.
- **Definitions** come from MIRAI's own registry (shipped with MIRAI, `registry/`). In unit 07
  that has no types yet: unit 08 adds the first ones. The tests use a fixture registry.
- **Output:**
  - one `file:line:column: reason` per problem, warnings marked `warning:`;
  - a summary line: "3 files, 2 problems, 1 warning, 4 skipped";
  - `--json` gives the same as data.
- **Exit codes:** 0 clean (warnings allowed); **1 problems found**; 2 a usage error; 3 a broken
  registry or config. It writes nothing.

## Files

```
src/lint/markdown.js        # the structure scanner
src/lint/rules.js           # frontmatter, sections, IDs, links, Mermaid
src/lint/lint.js            # lintFile, lintPaths: the rules with a document type
src/config/registry.js      # + the document-type fields above
src/cli/commands/lint.js
registry/                   # MIRAI's own definitions (empty until unit 08)
test/lint/*.test.js
test/lint/fixtures/                 # a sample registry and a sample doc set
```

## Tests

| # | Test |
|---|---|
| T1 | Scanner: headings inside fences and comments don't count; an unclosed fence is an error; setext headings are refused; links and IDs carry line and column |
| T2 | **The sample doc set lints clean** (several valid documents of the sample type) |
| T3 | **An extra heading is flagged** with file:line and the closest known name; a missing required section, a duplicate, a wrong order and an empty section are flagged |
| T4 | Optional sections: "Not applicable — reason" passes; a bare "Not applicable" or an empty one fails; a required section can't be "Not applicable" |
| T5 | **A missing template version is flagged**; a wrong type in `template` is flagged; an older version warns; a newer one errors |
| T6 | Frontmatter fields: required, unknown, wrong type, bad enum, bad date (2026-02-30); `status` required for documents and refused for a ticket-like type; a reader error is one problem with its position |
| T7 | IDs: a duplicate definition, an unknown mentioned ID, `AC-FR-2.1` without `FR-2` are flagged; IDs in code don't count |
| T8 | Links: a missing file, a missing anchor, a link out of the repo, an absolute path and a link with a token are flagged; a good relative link and anchor pass |
| T9 | Mermaid: a block without a keyword, and unbalanced brackets, are flagged; brackets in strings and comments don't count |
| T10 | Registry: the new fields validate; a pattern that doesn't compile or a `section_order` with an unknown name is refused with its position |
| T11 | `mirai lint`: exit 0 clean, 1 with problems, 2 on a bad flag, 3 on a broken registry; `--json` matches; nothing is written; files without a `type` are skipped |

## Decisions (approved open points)

- **Strict at `##` only** (open point 3). `###` and deeper are free inside sections.
- **Section order is enforced** (open point 4), until unit 37's overlays allow reordering per
  project.

## Done when

- `npm test` passes: the earlier tests (including 07a's) plus T1–T11.
- `test-results.md` holds the output.
- The Tech Lead and Architect reviews are done, and `review.md` is written.
- You write **"UNIT APPROVED"**. Then: one commit and push, and `PROGRESS.md` updated.

## Notes from 07a's review (settled 2026-10-24: you agreed to point 1's proposal)

1. **Reader errors in files that aren't MIRAI documents.** A README that starts with `---` as a
   horizontal rule gives `unclosed`, and a Docusaurus page with a nested `last_update:` gives
   `nested`. If those count as problems, `mirai lint` over the whole repo fails on ordinary docs.
   If they're skipped, an agent can escape the lint by breaking its own frontmatter. A proposal
   to discuss:
   - inside the MIRAI document folders, a reader error is always a problem;
   - elsewhere, it's skipped with a warning.
2. **Exit code:** the reader throws `ConfigError` (exit 3). `mirai lint` catches it and reports a
   problem (exit 1). Exit 3 stays for a broken registry or config.
3. **Read files as bytes** (`readFrontmatter(bytes)`), so invalid UTF-8 is a problem with a
   position and is never silently replaced.
4. **Point at values:** frontmatter rules use the key's `valueColumn` (07a) for a bad enum, date
   or `template`.
5. **Dates are quoted strings** (`updated: "2026-10-24"`); the rule checks it's a real date.

## Details settled while building (for your check)

These fill in the approved spec. None changes a rule above.

1. **Where MIRAI's documents live:** `<docs_root>` from the design (03 §layout), as a new
   project config key `[docs] root`, default `"docs/mirai"`. It's the folder the gate already
   leaves out of `code_paths`.
2. **Inside `<docs_root>`,** every `.md` file is a MIRAI document. Each of these is a problem:
   - no frontmatter;
   - a reader error;
   - no `type`;
   - a type the registry doesn't know;
   - a symbolic link.
3. **Outside it,** only files whose frontmatter names a known type are linted. A reader error
   there is a warning, and every other file is skipped.
4. **With no paths,** `mirai lint` walks the repo from its top folder. It skips `.git`,
   `node_modules` and `.mirai`, never follows symbolic links, and leaves out files over 1 MB.
   Named paths must be inside the repo, or it's a usage error (exit 2).
5. **`mirai lint` works before `mirai init`.** With no `.mirai/config.toml`, it uses the
   defaults. A broken config is exit 3.
6. **Registry details:**
   - **`status = "forbidden"`** types (tickets) have no `states`. `"required"`, the default,
     needs them, as before.
   - **`id_pattern`** (a regex) sets a type's document-id shape.
   - **A dependent ID kind** names `parent = "FR"`. Its pattern's one capture group is the
     parent ID: `AC-(FR-[0-9]+)\.[0-9]+`.
   - **No `subsections` yet:** no type needs them, and TOML keys can't hold section names with
     spaces. Unit 37's overlays can add them.
7. **Links:**
   - `http`, `https` and `mailto` are allowed, with the credential check;
   - every other scheme is a problem (`file:`, `javascript:`, …);
   - anchors in other `.md` files are checked by scanning that file;
   - GitHub's slug rule is approximated: inline marks are stripped, then the text is
     lower-cased, punctuation removed and spaces made into `-`, with `-1`, `-2` for repeats.
8. **The CLI takes its registry from MIRAI's own `registry/`.** Tests build the command with a
   fixture registry in code, not through an environment variable or a flag, so nothing can
   point a real run at another registry.


## Changes after testing and review

Both reviews requested changes (`review.md`). Each change to the text above is listed here for
your check before "UNIT APPROVED".

**Your decisions (asked during the review, 2026-10-24):**
1. **The walk uses git's file list:** `git ls-files --cached --others --exclude-standard`.
   - It covers tracked files plus new ones, minus what `.gitignore` excludes. This replaces
     "Details" #4.
   - Outside a git repo, the paths must be named.
   - A named folder is filtered through the same list.
2. **Outside the docs root, a file is linted only when its type is known and it has
   `template:`.** This replaces "Details" #3.
   - A broken frontmatter there is a warning only when a top-level `type:` line names a known
     type.
   - Anything else is skipped silently.
3. **An ID is defined only in its definition form,** and every other occurrence is a mention:
   - **heading or list item:** the ID, then `:` or ` — ` (`### FR-1: Sign in`,
     `- AC-FR-1.1: …`);
   - **table:** the ID is the whole first cell.
4. **Per-section subsections move to unit 37** (approved text: "unless the type lists allowed
   subsections"). When they come, they'll be an array of tables.
5. **Only `http`, `https` and `mailto` links** are allowed.
6. **The gate's default `code_paths` follows `docs.root`.** It is
   `["**", "!<docs.root>/**", "!.mirai/**"]` unless a file sets `gate.code_paths`.
7. **Two ID kinds with the same prefix** (a story's own AC beside a PRD's `AC-FR-n.m`) are
   designed in unit 08, with the story type.

**Fixes:**
8. **The docs root can't be escaped** by:
   - a symbolic link (a file, a folder, or the root itself, whether named or walked);
   - letter case (`DOCS/MIRAI/x.md`, `.MD`, `.markdown`);
   - a FIFO or other special file.

   "Inside" is decided on the path's place in the repo, case-insensitively, with links
   resolved one part at a time.
9. **`docs.root` has one spelling.** `./docs`, `docs//mirai`, `docs/./mirai`, a trailing `/`
   and `.` are refused.
10. **Every scanner pattern is linear,** and lines over 10,000 characters are a problem
    (`long-line`) and aren't scanned. One line of 160k `[` used to take 22 s.
11. **Code spans and comments are read in one pass,** so `` `<!--` `` in a code span no longer
    hides the rest of the document.
12. **Links:**
    - **Credentials:** they're checked in relative links' queries and anchors too, and anchors
      are echoed only when they look like a slug. Bare `https://…` URLs get the credential
      check.
    - **Outside the repo:** whether a target is outside is decided before whether it exists,
      so links can't probe the file system.
    - **Not links:** `[TODO]: text` is prose, not a reference definition. Link destinations
      and HTML tags don't count as ID mentions.
    - **Queries:** `[a](?x=1)` is fine.
13. **Mermaid:**
    - brackets are counted only in flowchart, graph, class and C4 diagrams, and on the keyword
      line too;
    - `>` opens a shape only outside other brackets (`A[one<br>two]`);
    - sequence arrows (`-)`) and notes are left alone.
14. **"Not applicable — reason" may wrap** over several lines.
15. **Unreadable folders and files** are a problem inside the docs root and a warning outside.
    They no longer stop the run.
16. **`--json` is escaped,** like the text output, and has `schema_version: 1`.
17. **Smaller fixes:**
    - a closing fence must keep its indentation;
    - setext isn't reported after a list or an HTML block;
    - text before the `#` title is a problem;
    - years 0000–0099 are checked correctly;
    - an ID followed by `-x` or `.5` isn't a mention of it;
    - problems in a body-less file point inside the file;
    - linked files over 1 MB don't have their anchors checked;
    - up to 100,000 paths.

**The problem codes** are now part of `--json` (units 26, 44, 54):
- **files:** `no-frontmatter`, `unknown-type`, `required`, `symlink`, `not-a-file`,
  `too-large`, `unreadable`, `frontmatter-<07a code>`;
- **scanner:** `long-line`, `empty-heading`, `setext`, `unclosed-fence`, `unclosed-comment`;
- **fields:** `type`, `pattern`, `enum`, `date`, `unknown-field`, `template`, `template-older`
  (a warning), `template-newer`, `status-forbidden`;
- **sections:** `title`, `unknown-section`, `duplicate-section`, `missing-section`,
  `section-order`, `empty-section`, `not-applicable`;
- **IDs:** `duplicate-id`, `unknown-id`, `missing-parent`;
- **links:** `link`, `link-credential`, `link-scheme`, `link-absolute`, `link-outside`,
  `missing-file`, `missing-anchor`;
- **Mermaid:** `mermaid`.

**Notes for later units:**
- **Unit 37:** project overlays will add patterns, which run on every line. Allow only a
  restricted regex subset (no nested quantifiers, backreferences or lookarounds) with a length
  cap.
- **Unit 43 (`mirai trace`):** it needs the IDs a document defines and mentions. Export them
  from `checkIds`.
- **Units 08, 09:** plans, findings and reports live in the store, not the repo. They need a
  text-level entry point (`lintText`).
- **Possible later additions:** a PRD `variant_of`, `defined_by` lists, and integer min/max.
