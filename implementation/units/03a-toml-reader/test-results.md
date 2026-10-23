---
unit: "03a"
name: toml-reader
date: 2026-10-23
node: v22.23.2
result: 33 / 33 pass (unit 01's 19 + 03a's 14), after the review fixes
---

# Unit 03a — Test results

## Run

`npm test` (scoped to `test/**/*.test.js`), after the review fixes (`review.md`):

```
ok 20 - T1: every valid corpus file parses to its expected JSON
ok 21 - T2: every invalid corpus file fails at its expected position and message
ok 22 - T3: the corpus covers every row of the subset table
ok 23 - T4: duplicate keys and tables are refused
ok 24 - T5: prototype keys are refused everywhere, and Object.prototype stays clean
ok 25 - T6: each limit passes just under and fails just over
ok 26 - T7: text rules (UTF-8, control characters, surrogates, BOM, CRLF)
ok 27 - T8: a realistic config and a definition file parse to the expected objects
ok 28 - T9: errors are ConfigErrors with exit code 3 and source:line:column
ok 29 - T10: every table in the output has no prototype
ok 30 - T11: the official TOML 1.0 suite (toml-test, vendored data)
ok 31 - T12: the vendored suite matches its provenance, with nothing added
ok 32 - T13: positions give line, column and type for every key path
ok 33 - T14: hints name the concrete fix
# tests 33
# pass 33
# fail 0
```

Tests 1–19 are unit 01's, unchanged and green.

## The official TOML 1.0 suite (T11)

`toml-lang/toml-test` at `ff49d10`, vendored as data (see `research/06-skill-vetting.md`):

| Set | Files | Result |
|---|---|---|
| Invalid TOML | 501 | **All 501 rejected** (a subset must reject everything TOML rejects) |
| Valid TOML, inside the subset | 102 | **All 102 accepted with exactly the suite's values** |
| Valid TOML, using a left-out feature | 106 | **All rejected, each for its expected reason** (a checked-in map, `test/config/toml-test-outside-subset.json`) |

The 106, by reason:

| Reason | Files |
|---|---|
| quoted keys | 28 |
| dotted keys | 25 |
| multi-line strings | 22 |
| dates and times | 19 |
| exponents | 5 |
| inf and nan | 3 |
| hex, octal, binary | 3 |
| integer out of range (int64 max) | 1 |

None crashed or threw anything but a `ConfigError`.

## Our corpus

- `test/config/corpus/valid/`: 23 files with their expected JSON. They cover every accepted
  feature, plus a realistic `.mirai/config.toml` and an agent manifest.
- `test/config/corpus/invalid/`: 55 files with their expected `line:column: message`. They
  cover every left-out feature, every duplicate and closed-table rule, prototype keys, control
  characters, invalid UTF-8, and the syntax errors people make most.

Every corpus file is run twice, as bytes and as a string, with the same result.

## Sample messages (as the CLI prints them: the hint on its own line)

```
mirai: .mirai/config.toml:3:1: dotted keys are not supported
use a [git.branch] table, then name = …
mirai: .mirai/config.toml:2:11: dates and times are not supported
write the time as a string, for example "06:30"
mirai: .mirai/config.toml:3:1: "repos" is already defined
```

## Changes against the approved spec

| Change | Why |
|---|---|
| **The toml-test suite is included** (T11, vendored data in `test/vendor/toml-test/`, 917 files, MIT, pinned) | Your decision "include it" |
| **Escapes `\b` and `\f` are accepted too** (the spec listed `\" \\ \n \t \r \u \U`) | They are TOML 1.0 escapes with the same meaning; leaving them out would reject valid files for no safety gain |
| **Control characters follow TOML exactly:** U+0000–U+0008, U+000B–U+001F, U+007F are refused (CR only as part of CRLF); U+0080–U+009F are allowed (the spec said "other than tab") | Refusing C1 characters would reject valid TOML (the suite has such a case). The one-rule promise "everything accepted means the same in TOML" stays intact |
| **Underscores are accepted in floats** (`3_141.592_7`) | TOML 1.0 allows them; same meaning |
| **One leading BOM only;** a second one is an error | As TOML requires |
| **Integers beyond ±(2⁵³−1) are an error** ("integer out of range") | TOML requires an error when a value can't be represented exactly |
| **A `tagged` option** on `parseToml` returns `{ type, value }` leaves | Only for the conformance test (T11), so ints and floats can be told apart |
| T7 also checks that a raw tab is allowed in strings and that overlong and encoded-surrogate UTF-8 are refused | Gaps found while writing the tests |
| **A `positions` option** returns `{ value, positions }` with `{ line, column, type }` per key path | Architect review: 03b, 07 and the registry need positions for their own errors; the type keeps `90` and `90.0` apart |
| **Hints moved out of `message` into `hint`** (printed on its own line); `reason` and `path` fields added to `ConfigError` | Architect review: one error shape before 03b writes many errors |
| **Floats that overflow are refused** ("float out of range") | Tech Lead review: they came back as `Infinity` |
| **String length is counted in UTF-16 code units** (documented) | Tech Lead review: "16 KB" was ambiguous |
| T12 (provenance), T13 (positions), T14 (hints) added; T11 pins exact counts and per-file reasons | Both reviews |
