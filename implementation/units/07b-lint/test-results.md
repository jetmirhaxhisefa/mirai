---
unit: "07b"
name: lint
date: 2026-10-24
node: v22.23.2
result: 126 / 126 pass (earlier units' 109 + unit 07b's 17), after the review fixes; 3 full runs in a row green
---

# Unit 07b — Test results

## Run

`npm test` (scoped to `test/**/*.test.js`), after the review fixes (`review.md`):

```
ok 59 - T1: scanner: fences and comments are opaque; setext and unclosed blocks are flagged; positions
ok 60 - T2: the sample doc set lints clean
ok 61 - T3: sections: an extra heading, a missing, duplicate, misordered or empty section
ok 62 - T4: optional sections: Not applicable needs a reason and must stand alone; required ones can't use it
ok 63 - T5: the template version: missing, wrong type, older (a warning) and newer (an error)
ok 64 - T6: frontmatter fields, status rules and reader errors
ok 65 - T6b: the docs root: every .md in it is a document; outside, only known types are linted
ok 66 - T7: IDs: duplicates, unknown mentions, a dependent ID without its parent; code doesn't count
ok 67 - T8: links: missing files and anchors, out of the repo, absolute, credentials and schemes
ok 68 - T9: Mermaid: a known diagram type, balanced brackets outside strings and comments
ok 69 - T10: registry: the new fields validate, with positions
ok 70 - T11: mirai lint: exit codes, output, --json, paths, the docs root from config, and no writes
ok 71 - T12: scanner fixes from review: code spans vs comments, long lines, linear time, bare URLs, prose that looks like a link
ok 72 - T13: the docs root can't be escaped by links, letter case, extensions or special files
ok 73 - T14: IDs and links from review: definition forms, word ends, secrets in anchors and queries, the outside oracle
ok 74 - T15: Not applicable may wrap; dates before year 100; problems in an empty body point at the file
ok 75 - T16: config: docs.root has one spelling; the gate default follows it
# tests 126
# pass 126
# fail 0
```

Three full runs in a row: 126/126 each, 40–44 s.

**Earlier tests changed:** `test/cli/cli.test.js` T14 pins the command list, which now
includes `lint`.

**Isolation:**
- Every test lints a temporary repo, made with `mkdtemp`.
- T11 compares every file in the repo (`.git` included) before and after each run, so a run
  that writes anything fails.
- T13 checks the FIFO and unreadable-folder cases, then puts the permissions back.

**On MIRAI's own repo:** `mirai lint` gives "0 files, 0 problems, 0 warnings, 74 skipped" in
0.4 s. MIRAI's real registry has no types yet (unit 08), so nothing is a document.

## The roadmap's "done when", mapped

| Done when | Test |
|---|---|
| lints a sample doc set | T2 (two PRD-like documents and a ticket-like note, clean) |
| messages give file:line | T3–T9, T11 (`file:line:column: reason` and `--json`) |
| an extra heading is flagged | T3 (`unknown-section`, with "did you mean") |
| a missing template version is flagged | T5 (`required`, with the exact line to add) |

## What came up while testing

1. **My own line and column counts were wrong several times,** and the rules were right each
   time. The fixture's priority line is line 9, not 10.
2. **Changing one part of a document correctly broke another.** For example, removing
   Requirements breaks the Summary's `#requirements` link, and writing a document outside its
   folder breaks its `../billing` link.
3. **The fixture registry first had its templates next to the definitions.** The registry
   resolves template paths from its root, so they moved to `templates/`.
4. **The first section-order rule reported every heading after a moved section.** It now
   reports only the sections outside the longest run that is already in order, so one moved
   section is one problem.
