---
unit: "07a"
name: frontmatter-reader
status: approved (2026-10-24, as part of unit 07; split by open point 1)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 07; D-04, D-40
depends_on: ["01"]
---

# Unit 07a — The YAML frontmatter reader

Unit 07's spec was approved with its four open points as recommended. This is the first half:
the reader and its tests. Unit 07b has the scanner, the rules, the registry additions and
`mirai lint`.

## Why

Every MIRAI document starts with YAML frontmatter: `id`, `type`, `template`, `status` and so on
(03 "Templates"). MIRAI has no outside packages (D-04), so it needs its own reader. D-40 sets
the policy, as for TOML in 03a: **a written subset with a test corpus; anything outside it is
refused loudly, never guessed.**

YAML needs this more than TOML does. The same text can mean different things in different YAML
tools: `no` is `false` in YAML 1.1 and the string `"no"` in 1.2, and `0o17` is 15 in one and
text in the other. The subset leaves out everything whose meaning depends on the tool.

## Scope

**In:**
- `readFrontmatter(text, { source })` finds the frontmatter at the top of a Markdown document
  and reads it.
- `parseYamlSubset(text, { source, positions, firstLine })` reads the YAML between the markers.
  The suite tests call it directly.
- The grammar, written down in `src/lint/YAML-SUBSET.md`.
- A test corpus, and the official YAML test suite as vetted, pinned data (open point 2).

**Out:**
- **What the fields mean:** required fields, types and allowed values are rules (07b).
- **Writing YAML.** Templates (08) are written by hand. If a later unit writes frontmatter, it
  writes the subset.

## The subset

**One rule, as for TOML: everything accepted is valid YAML 1.2 and means the same thing there.**
The subset only leaves features out. It also leaves out YAML 1.2 text that YAML 1.1 tools read
differently.

### The document

- **Frontmatter starts** with `---` as the first line of the file. A file whose first line is
  something else has no frontmatter. `readFrontmatter` returns `null`, and the lint decides
  what that means.
- **It ends** at the next line that is exactly `---`. With no such line: an error at line 1
  ("frontmatter isn't closed").
- **At most 16 KB** between the markers.
- **Line endings:** LF or CRLF. A carriage return on its own is refused.
- **A leading BOM** is ignored.
- **Positions** count lines from the top of the file, so `---` is line 1 and the first key is
  line 2.
- **An empty frontmatter** (nothing but blank lines and comments) is an empty mapping. This is
  the one place we differ from YAML, which reads it as no document at all.

### Accepted

| Feature | Form | Example |
|---|---|---|
| Top-level keys | at column 1, `[a-z][a-z0-9_]*`, then `:` right after | `template: story@v1` |
| Comments | a line that starts with `#` (spaces before it allowed), or ` #` after a value | `# note`, `owner: jet  # me` |
| Blank lines | anywhere | |
| Plain strings | see "Plain strings" below | `id: prd-login` |
| Double-quoted strings | one line; escapes `\" \\ \n \t \uXXXX` | `title: "Login: v2"` |
| Single-quoted strings | one line; `''` is a quote | `note: 'it''s fine'` |
| Integers | `-?(0\|[1-9][0-9]*)`, safe range | `version: 2` |
| Booleans | `true`, `false` | `draft: false` |
| Null | `null`, or nothing after the colon | `owner: null`, `owner:` |
| Flow lists | `[a, b]` on one line; scalars only; spaces around items allowed | `upstream: [prd-login, arch-auth]` |
| Block lists | `  - item` lines (two spaces, `-`, one space) after a key with nothing after its colon | see below |

```yaml
downstream:
  - story-PMT-12
  - story-PMT-13
```

**Plain strings:**
- don't start with any of `- ? : , [ ] { } # & * ! | > ' " % @` or a backquote;
- contain no `: ` and no ` #`, and don't end with `:`;
- inside a flow list, also contain no `,`, `[`, `]`, `{` or `}`;
- end at the last character that isn't a space;
- are not one of the words in the next table.

### Refused, each with a code, a reason and a hint

| Code | What | Hint |
|---|---|---|
| `ambiguous` | Plain words a YAML tool reads as a boolean, null or number other than ours: `yes no on off y n` in any case; `True TRUE False FALSE`; `Null NULL ~`; floats, exponents, `.inf`, `.nan`; `0x…`, `0o…`, `0b…`; leading zeros (`017`); a `+` sign; `-0`; `_` in digits (`1_000`); sexagesimal (`1:30`) | "quote it" (with "or write true / false / null" where it fits) |
| `anchor`, `alias`, `tag` | `&x`, `*x`, `!x` | "anchors, aliases and tags aren't supported" |
| `block-scalar` | `\|` and `>` | "use one line with \\n" |
| `nested` | an indented `key: value`, or a `- a: b` item | "nested mappings aren't supported" |
| `flow-mapping` | `{…}` | "nested mappings aren't supported" |
| `continuation` | an indented line that isn't a list item (a multi-line plain or quoted string) | "keep the value on one line" |
| `indent` | a list item not indented by exactly two spaces | "indent list items by two spaces" |
| `list` | an empty item, a nested list, a list item with no key above it, or a trailing comma | |
| `key` | a key that isn't plain lower-case (quoted, upper-case, with spaces, `? ` complex keys), or a space before the colon | "keys are a–z, 0–9 and _, starting with a letter" |
| `duplicate` | a key defined twice | |
| `forbidden-key` | `constructor`, `prototype` (and `__proto__`, which the key rule already refuses) | |
| `tab` | a tab anywhere, even inside quotes | "use spaces, or \\t in a double-quoted string" |
| `escape` | any escape other than the five | |
| `control` | raw control characters, a lone surrogate (also from `\u`) | |
| `directive`, `document` | `%YAML`, `%TAG`; `...` | |
| `syntax` | everything else: an unclosed quote, text after a closing quote, a missing `: ` | |
| `too-large`, `unclosed` | over 16 KB; no closing `---` | |

~~Dates are not refused.~~ **Changed after review (your decision, 2026-10-24):** unquoted dates
are refused as `ambiguous`; write `updated: "2026-10-24"`. See "Changes after testing and
review", #3.

### Results and errors

- **Value:** a mapping without a prototype (`Object.create(null)`). Lists are arrays. Key order
  is kept.
- **Positions:** with `positions: true`, a `Map` from a key (`id`) or list item (`upstream[1]`)
  to `{ line, column }`, both 1-based, in the whole file.
- **Errors:** a `ConfigError` (exit 3), as in 03a: `<source>:<line>:<column>: <reason>`, with
  `code` from the table and a `hint`. It stops at the first error, and never returns a partial
  value.

## Checking against the YAML test suite (open point 2)

`yaml/yaml-test-suite` is the YAML authors' set of test cases: YAML inputs with the expected
JSON, or an `error` marker. It's data, not code. It goes through the security gate:
`research/06-skill-vetting.md`, the 2026-10-24 addendum.

- **Pinned:** the `data-2022-01-17` release, commit `6e6c296ae9c9d2d5c4134b4b64d01b29ac19ff6f`
  (the latest data release). MIT licence.
- **Vendored:** `test/vendor/yaml-test-suite/`. For each of the 402 cases, only `in.yaml`,
  `in.json`, `error` and `===` (its name): 1180 files, 47 KB. Plus `LICENSE` and
  `PROVENANCE.json`, with the commit and a SHA-256 over every file, as for toml-test.
- **Not vendored:** the event files, the emitter outputs and the `tags/` and `name/` symlink
  folders. Nothing from the repo is run.

**The test, case by case:**
1. **The case has an `error` file:** our reader must refuse it. Three cases have both an `error`
   and an `in.json`. The error wins.
2. **We accept it:** the case must have exactly one JSON document, and it must be exactly our
   value, key order included. The one allowed difference is an empty stream, which we read as
   `{}` (see "The document").
3. **We refuse a valid case:** only with the code listed for it in
   `test/lint/yaml-test-suite-outside-subset.json`. That list is reviewed by hand, as 03a's was.
   A change in the reason shows up in the test.
4. **The counts are pinned:** refused errors, refused valid cases and accepted cases.

## Files

```
src/lint/frontmatter.js       # readFrontmatter, parseYamlSubset, LIMITS
src/lint/YAML-SUBSET.md       # the grammar and the rules above
test/lint/frontmatter.test.js
test/lint/corpus/valid/*.yaml   + *.json  (expected value)
test/lint/corpus/invalid/*.yaml + *.err   ("line:column: code")
test/lint/yaml-test-suite-outside-subset.json
test/vendor/yaml-test-suite/    # pinned data, vetted
```

## Tests

| # | Test |
|---|---|
| T1 | Every valid corpus file gives its expected JSON. Every invalid one is refused with its line, column and code. The corpus covers every row of both tables |
| T2 | Edge cases: dates and other text stay strings; `constructor` is refused and `Object.prototype` is unchanged; `\u` escapes, lone surrogates; CRLF; a BOM; just under and just over 16 KB |
| T3 | `readFrontmatter`: no frontmatter gives `null`; an unclosed one is an error at line 1; positions count from the top of the file; the body starts after the closing `---` |
| T4 | Positions: every key and list item has its line and column, with emoji and CRLF |
| T5 | **The YAML test suite:** cases with `error` are all refused; accepted cases equal their JSON; refused valid cases match the reviewed list; the counts are pinned |
| T6 | The vendored suite matches `PROVENANCE.json`, with nothing added |

`npm test` stays scoped to `test/**/*.test.js`.

## Clarifications made while splitting (for your check)

1. **Octal and hex are refused, not kept as strings.** The approved text said that "a date or
   an octal number" stays a string. For dates that is right: YAML 1.2 agrees. But YAML 1.2 reads
   `0o17` as the number 15, so keeping it as text would break the "same meaning" rule. Refusing
   it ("quote it") is the safe reading of open point 2. `017` with a leading zero is refused
   too, because 1.1 and 1.2 disagree on it.
2. **Capitalised `True`, `Null` and `~`** are refused for the same reason: YAML 1.2 reads them as
   a boolean or null. The approved text said only that "nothing else is a boolean".
3. **Indented comments** are allowed (approved: "`#` at the start of a line"). YAML allows them,
   and templates will use them between list items.

## Done when

- `npm test` passes: the earlier 102 tests plus T1–T6.
- `test-results.md` holds the output.
- The Tech Lead and Architect reviews are done, and `review.md` is written.
- You write **"UNIT APPROVED"**. Then: one commit and push, and `PROGRESS.md` updated.

## Changes after testing and review

Both reviews requested changes (`review.md`). These change the approved text; each is listed
here for your check before "UNIT APPROVED".

**Your decisions (asked during the review):**
1. **`e2e: yes` becomes `e2e: true`** across the design docs and the lifecycle SVG (22 lines; with the `tdd` rename, 34 lines in 8
   files). `yes` is a YAML 1.1 boolean, so the subset refuses it unquoted.
2. **`tdd` takes `auto | first | after`** instead of `auto | on | off`, for the same reason.
   Changed in:
   - the config schema (03b) and the run log's `tdd` and `tdd_applied` (05b), with their
     tests;
   - the design docs.

   The old unit specs (03b, 05b) are left as they were written.
3. **Unquoted dates are refused** (`ambiguous`, hint `quote it: "2026-10-24"`). YAML 1.1 tools
   (PyYAML, js-yaml, so gray-matter) read them as dates, and PyYAML fails on `2026-02-30`. Times
   and zones are refused too. 07b checks that a quoted date is real.

**Fixes to the subset, all refusals that make the rule true:**
4. **Keys that are booleans or null in some tool** (`y yes n no on off true false null`) are
   refused (`key`). `on:` is `True` in PyYAML.
5. **The values `=` and `<<`** are refused (`ambiguous`). PyYAML can't load them.
6. **Invisible characters** (zero-width, bidi, soft hyphen, tag characters; the set unit 05a
   escapes on output) are refused (`control`), raw and through `\u`. An ID with a zero-width
   space would look valid.
7. **Only spaces indent or end a value.** A no-break space was read as indentation, which turned
   a string into a list.
8. **` #x` after a plain value is refused** (`syntax`). YAML cuts `Fix the #1 bug` to "Fix the"
   without a word. A comment needs a space after `#`.

**API additions (for 07b):**
9. **`readFrontmatter` takes bytes too.** Invalid UTF-8 is refused (`encoding`) at its position.
   The UTF-8 check moved from `toml.js` to `src/util/utf8.js`, so both readers share it.
10. **Positions:** a key's entry has `valueColumn`, and errors carry `path` (`tags[1]`).
11. **A near-miss closing line** (`--- ` or `...`) is pointed at. A huge frontmatter is refused
    while the reader is still looking for its end.

**Tests:**
12. **T7 (new): every plain word reads as the same type in YAML 1.1, YAML 1.2 and MIRAI.** It
    uses the YAML type patterns. A check showed it catches the date and `=` gaps when they are
    put back.
13. **The suite's outside-subset list pins `line:column: code`,** not only the code.

**Also fixed:**
- **Positions are linear.** A 16 KB line took 513 ms with positions.
- **Listed errors are escaped** (`formatError` in `errors.js`).
- **Smaller fixes:** hints, a BOM written as `\uFEFF`, and the one-space-after-`-` rule
  documented.

