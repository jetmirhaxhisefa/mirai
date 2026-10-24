---
unit: "07b"
date: 2026-10-24
reviewers: Tech Lead, Architect (independent, read-only)
verdicts: CHANGES REQUESTED (1 blocking), CHANGES REQUESTED (1 blocking); all findings applied, decided by you, or noted for later units
---

# Unit 07b — Review

**How the reviewers checked:**
- **The Tech Lead** ran 16 probes against temporary repos: scanner edge cases, rules, links,
  Mermaid, the CLI and timings.
- **The Architect** probed the docs-root policy, safety, and fit with config, the CLI and later
  units.

**Both confirmed what works:**
- frontmatter types, enums and dates;
- the status and version rules;
- the template checks;
- CRLF and BOM files;
- invalid UTF-8;
- most link cases;
- the registry's cross-key checks;
- the exit codes and the summary format.

## Applied in unit 07b

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **Blocking: the docs-root rule could be escaped.** A named symlink, a symlinked folder, the docs root as a symlink, or letter case (`DOCS/MIRAI/x.md` on macOS) all gave exit 0 with a broken document | Architect | "Inside" is decided on the path's place in the repo, case-insensitively. Links are resolved one part at a time, and any link inside the root is a problem | T13 |
| 2 | **Blocking: quadratic patterns.** A 160k-character line of `[` took 22 s, and `# a` + spaces + `b` took 44 s, so a 1 MB file could stall the hook for minutes | both | Linear patterns (heading without a lazy group, link text without brackets); lines over 10,000 characters are a problem and aren't scanned | T12 (timed) |
| 3 | `` `<!--` `` in a code span hid the rest of the document | Tech Lead | One pass over code spans and comments | T12 |
| 4 | Credentials in a relative link's query or anchor were missed, and the anchor was echoed | Tech Lead | Checked with values only, so `#session-timeout` isn't a secret; anchors are shown only when they look like a slug | T14 |
| 5 | Bare `https://…` URLs were never checked | Tech Lead | Collected as `bare` links, with the credential check | T12, T14 |
| 6 | `[docs] root` spellings (`.`, `./docs/mirai`, `docs//mirai`, `Docs/Mirai`) switched the policy off | both | One spelling is accepted; the comparison ignores case | T16 |
| 7 | Mermaid false positives: `<br>` in labels, the `-)` arrow, notes and titles; T9 locked one in | Tech Lead | Brackets are counted only in flowchart/graph/class/C4 and on the keyword line; `>` opens a shape only outside brackets | T9 |
| 8 | Any heading, bullet or table row starting with an ID defined it, so ordinary references were duplicates | Tech Lead | **Your decision:** the definition form only | T14 |
| 9 | A hard-wrapped "Not applicable" paragraph failed | Tech Lead | Paragraphs, not lines | T15 |
| 10 | An unreadable folder or file stopped the run (exit 1, no output); a named FIFO hung forever; `.MD`, `.markdown` and FIFOs in the docs root were ignored | both | Unreadable: a problem inside, a warning outside; files are opened non-blocking and must be regular | T13 |
| 11 | `--json` output wasn't escaped | both | Escaped like `mirai status --json`; `schema_version: 1` added | T11 |
| 12 | IDs in link targets and HTML attributes counted as mentions; `[TODO]: text` was read as a link | Tech Lead | Destinations and tags are blanked for the ID scan; a reference definition must end after its title | T12 |
| 13 | A link through a symlink could tell what exists outside the repo | Architect | Whether a target is outside is decided before whether it exists | T14 |
| 14 | The walk ignored `.gitignore`; outside the root, any file with a known type was fully linted | Architect | **Your decisions:** git's file list; outside the root, a known type plus `template:` | T11, T13 |
| 15 | The gate's default exclude was fixed at `docs/mirai` | Architect | **Your decision:** the default follows `docs.root` | T16 |
| 16 | T11's "nothing written" check couldn't see a new file | Tech Lead | It compares the full file set, `.git` included, around every run | T11 |
| 17 | Nits: the closing fence's indent; setext after a list or HTML block; text before the title; years 0–99; `FR-1-b` read as `FR-1`; problems past the end of a body-less file; linked files over 1 MB; `[a]()`; the 1000-path limit | Tech Lead | All fixed | T12, T15 |

**Your other decisions:**
- per-section subsections move to unit 37;
- only `http`, `https` and `mailto` links are allowed;
- two ID kinds with one prefix are designed in unit 08.

## Noted for later units (in the spec)

| Unit | Note | From |
|---|---|---|
| 08 | Two ID kinds with the same prefix (a story's own AC beside a PRD's `AC-FR-n.m`), perhaps an `{id}` placeholder | Architect |
| 37 | Overlay patterns: a restricted regex subset with a length cap | Architect |
| 43 | Export the IDs `checkIds` finds | Architect |
| 08, 09 | A text-level entry point (`lintText`) for plans and reports, which live in the store | Architect |
| — | PRD `variant_of`, `defined_by` lists, integer min/max | Architect |

## Not changed

- **Slugs keep `_emphasis_` underscores,** which GitHub drops. This is a documented
  approximation.
- **Smaller scanner limits:** `### [FR-2](#x):` doesn't define FR-2, and a table without a
  leading `|` defines nothing.
- **Spec-listed Mermaid keywords only:** newer ones (`xychart-beta`, `sankey-beta`) are refused
  until the list is revisited.
- **Outside git, the current folder is the root.**
