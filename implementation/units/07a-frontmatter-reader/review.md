---
unit: "07a"
date: 2026-10-24
reviewers: Tech Lead, Architect (independent, read-only)
verdicts: CHANGES REQUESTED (2 blocking), CHANGES REQUESTED (none blocking); all findings applied or noted for 07b
---

# Unit 07a — Review

**How the reviewers checked:**
- **The Tech Lead** compared our values with four YAML readers already on disk (yaml@2 in 1.2
  and 1.1 mode, js-yaml 4 and 3, PyYAML 6), and ran about 1M random inputs. Nothing crashed
  with anything but `ConfigError`.
- **The Architect** checked every vendored file against the upstream git blobs (all 1180 match)
  and confirmed the vetting record is accurate.

**Both found the same gap:** the claim "reads the same in YAML 1.1 tools" wasn't true for dates,
`=` and `<<`, and nothing tested it. T7 now does.

## Applied in unit 07a

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **Blocking: a no-break space (or U+3000) in the indent counted as indentation.** `"a:\n \u00a0- x"` gave a list; YAML gives the string `"\u00a0- x"` | Tech Lead | Only spaces indent: `/^ */` | corpus `indent-nbsp`, T2 |
| 2 | **Blocking: boolean and null words were accepted as keys.** `on:` is `True` in PyYAML; `true:` and `null:` aren't strings in YAML 1.2 either | Tech Lead | `y yes n no on off true false null` refused as keys (`key`) | corpus `key-bool-*`, `key-true`, `key-null`, T7 |
| 3 | **Unquoted dates and timestamps read as dates in YAML 1.1 tools;** PyYAML fails on `2026-02-30` | both | **Your decision:** refused (`ambiguous`, "quote it: \"2026-10-24\"") | corpus `ambiguous-date*`, `ambiguous-timestamp*`, T2, T7 |
| 4 | The values `=` and `<<` (YAML 1.1 value and merge) crash PyYAML | both | Refused (`ambiguous`) | corpus `ambiguous-equals`, `ambiguous-merge`, T7 |
| 5 | Invisible and bidi characters were accepted in values (`id: prd​login` looks valid) | Architect | The set unit 05a escapes on output is refused (`control`), raw and through `\u` | corpus `control-zero-width`, `-bidi`, `-soft-hyphen`, `-escaped-bidi`, `-tag-character` |
| 6 | Listed errors printed `reason` raw (a U+202E reached the terminal) | Architect | `formatError` escapes listed lines and hints | — (07b's listed problems will use it) |
| 7 | Positions were quadratic: 513 ms for one 16 KB line with positions | Architect | A fast path, plus a per-line surrogate count for lines with emoji | T4 (3000 items with emoji) |
| 8 | No answer for invalid UTF-8: 07b would decode leniently | Architect | `readFrontmatter` takes bytes; invalid UTF-8 is refused (`encoding`) at its position; the check is shared with 03a in `src/util/utf8.js` | T3 |
| 9 | 07b needs value positions and paths | Architect, Tech Lead | `valueColumn` on key entries; `path` on errors | T2, T3, T4 |
| 10 | **`e2e: yes` and `tdd: on/off` in the design** would fail the lint | Architect | **Your decisions:** `e2e: true` in all design docs and the SVG; `tdd` is `auto · first · after` in the design, the config schema and the run log | config T1/T8, logs T11 |
| 11 | The outside-subset list pinned only the code; 33 cases fall under the catch-all `syntax` | both | Pins `line:column: code` | T5 |
| 12 | Nothing tested the YAML 1.1 promise | both | **T7:** every word from the suite, the corpus and a generated set is checked against the YAML 1.1 and 1.2 type patterns. Removing the date or `=` refusal makes it fail (checked) | T7 |
| 13 | `title: Fix the #1 bug` is silently cut to "Fix the" | Architect | ` #x` after a plain value is refused; a comment needs `# ` | corpus `syntax-hash-cuts-value` |
| 14 | A glob such as `**/*.md` got the hint "anchors aren't supported" | Architect | Hint: "quote the value if it's text" | T2, corpus `alias-glob` |
| 15 | `trimEnd()` stripped Unicode whitespace, giving misleading errors | both | Only spaces end a plain value | T2 |
| 16 | A near-miss closing line (`--- `, `...`) gave "unclosed" at line 1; a huge frontmatter was copied before the size check | Architect | Points at the near miss; the size is checked while scanning | T2, T3 |
| 17 | The provenance could only be re-checked against itself | Architect | `PROVENANCE.json` names the upstream tree and a blob-by-blob check; the vetting record says it was done | T6 |
| 18 | Smaller fixes: a literal BOM in the code; the escape table rebuilt each time; an unreachable branch; a missing hint; hint wording; the leading-`-` rule not documented; T2 tested 16,390 bytes rather than 16 KB + 1; two asserts that checked nothing; the differences from 03a not written down | both | All fixed; `YAML-SUBSET.md` gained "Differences from the TOML subset" | T2 |

## Noted for 07b (in its spec)

| Note | From |
|---|---|
| **To decide with you:** what a reader error means in a file that isn't a MIRAI document (a README with a `---` rule). Proposal: always a problem in the MIRAI folders, a warning elsewhere | Architect |
| `mirai lint` catches the reader's `ConfigError` and reports a problem (exit 1); exit 3 stays for a broken registry | Architect |
| Read files as bytes; point frontmatter rules at `valueColumn`; dates are quoted strings | Architect |

## Not changed

- **Only 9 of the 308 valid suite cases are accepted.** The reviewers agree this follows from a
  small subset: most cases use keys with spaces or capitals, `---`, or tags. All 94 error cases
  are refused. T7 now covers the meaning of plain words, which is where the real risk is.
- **The quoted-`1.2.3` friction:** acceptable, because the hint is concrete (Architect).
