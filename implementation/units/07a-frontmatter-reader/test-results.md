---
unit: "07a"
name: frontmatter-reader
date: 2026-10-24
node: v22.23.2
result: 109 / 109 pass (earlier units' 102 + unit 07a's 7), after the review fixes; 3 full runs in a row green
---

# Unit 07a — Test results

## Run

`npm test` (scoped to `test/**/*.test.js`), after the review fixes (`review.md`):

```
ok 52 - T1: the corpus: valid files give their JSON, invalid ones fail at their line, column and code
ok 53 - T2: edge cases: text stays text, prototype keys, escapes, CRLF, BOM and the size limit
ok 54 - T3: readFrontmatter: none, unclosed, empty, the body and file line numbers
ok 55 - T4: positions give the line and column of every key and list item
ok 56 - T5: the YAML test suite (yaml-test-suite, vendored data)
ok 57 - T6: the vendored suite matches its provenance, with nothing added
ok 58 - T7: every plain word reads as the same type in YAML 1.1, YAML 1.2 and MIRAI
# tests 109
# pass 109
# fail 0
```

Three full runs in a row: 109/109 each, 47–55 s.

**The corpus:** 9 valid files and 113 invalid ones. Every refusal code in the subset table has
at least one file; `too-large`, `unclosed` and `encoding` are tested in T2 and T3.

**The YAML test suite (T5), pinned to `data-2022-01-17`:**

| | Cases |
|---|---|
| Invalid YAML, refused | 94 of 94 |
| Valid YAML, accepted with exactly the suite's JSON | 9 (3 of them empty streams, read as `{}`) |
| Valid YAML outside the subset, refused at the listed place with the listed code | 299 |

**T7, the type patterns:** a check showed the test is real. With the date refusal removed, it
fails on `2001-07-23`; with the `=` refusal removed, it fails on `=`.

**Earlier tests changed** (your `tdd` decision): `test/config/config.test.js` T1 and T8, and
`test/store/logs.test.js` T11, now use `first` and `after`.

**Isolation:** the tests read only the repo's own files; nothing is written.

## The roadmap's "done when", mapped (07a's share)

| Done when | Test |
|---|---|
| (D-40) a written subset with a corpus; anything outside it is refused loudly, with a position | T1, T5, `src/lint/YAML-SUBSET.md` |
| messages give file:line | T1 (line and column for every invalid file), T3 (file lines in a document) |

The rest (a sample doc set, extra headings, a missing template version) is 07b's.

## What came up while testing

1. **Four of my own expectations were wrong, and the reader was right each time:**
   - a column was off by one;
   - `1.2.3` matches YAML 1.1's float pattern, so it must be quoted;
   - a test case used `y` as a value, which is a YAML 1.1 boolean;
   - after the review, the corpus used `n:` as a key, which is now refused.
2. **The first type-pattern table was too literal.** YAML 1.2's float pattern also matches
   integers (the spec resolves int first), and its null includes the empty value. T7 now uses
   resolution order.
