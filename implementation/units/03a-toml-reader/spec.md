---
unit: "03a"
name: toml-reader
status: draft
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 03a; D-40
depends_on: ["01"]
---

# Unit 03a — The TOML subset reader

## Why

Every file a person edits for MIRAI is TOML:
- the project config (`.mirai/config.toml`);
- your personal configs (`config.user.toml` in the MIRAI home, `~/.config/mirai/config.toml`);
- per-skill overrides (`.mirai/custom/*.toml`);
- the definition files of the registry (D-37).

MIRAI has no outside packages (D-04), so it needs its own reader. D-40 sets the policy: **a
written subset grammar with a test corpus; anything outside it is rejected loudly, never
guessed.**

Config is MIRAI's attack surface. A project file is written by a branch, and later by agents'
branches, so the reader must be **strict and safe** before it is convenient.

**Roadmap "done when":**
- the corpus passes;
- every out-of-grammar case is rejected with a position;
- duplicate keys and tables are refused.

## Scope

**In:**
- `parseToml(text, { source })` → a plain data object, or a `ConfigError` with
  `source:line:column`.
- The grammar, written down in `src/config/TOML-SUBSET.md`.
- The test corpus: valid files with their expected JSON, and invalid files with their expected
  error.

**Out:**
- **Writing TOML.** MIRAI writes JSON (D-40). If config migrations (unit 70) need to write TOML,
  that's their unit.
- **What the values mean:** schemas, layers, merging and presets (unit 03b).
- **YAML frontmatter:** its own subset, in the lint unit (07).
- **CLI commands:** none in this unit. `mirai config check` belongs to 03b.

## The subset

**One rule: everything we accept is valid TOML 1.0 and means the same thing there.** We only
leave features out; we never change their meaning. A file that works in MIRAI works in any
TOML tool too.

| Feature | Accepted | Example |
|---|---|---|
| Comments | yes, full-line and end-of-line | `# note`, `key = 1 # note` |
| Bare keys | yes: `A–Z a–z 0–9 _ -` | `integration_branch = "main"` |
| Tables | yes | `[git]`, `[gate.risk]` |
| Arrays of tables | yes | `[[repos]]` |
| Basic strings | yes, one line, escapes `\" \\ \n \t \r \uXXXX \UXXXXXXXX` | `"feature/{ticket}"` |
| Literal strings | yes, one line | `'C:\path'` |
| Integers | yes, decimal, optional sign, `_` between digits | `90`, `-1`, `1_000` |
| Floats | yes, simple decimal form | `0.6`, `-1.5` |
| Booleans | yes | `true`, `false` |
| Arrays | yes, may span lines, trailing comma allowed | `["lint", "types",]` |
| Inline tables | yes, one line | `{ name = "api", path = "." }` |
| **Dotted keys in assignments** | **no** (use a table header) | `git.branch = "x"` → error |
| **Quoted keys** | **no** | `"my key" = 1` → error |
| **Multi-line strings** | **no** | `"""…"""` → error |
| **Dates and times** | **no** | `2026-10-23` → error |
| **Hex, octal, binary numbers; exponents; `inf`/`nan`** | **no** | `0x1F`, `1e3` → error |

Each "no" is rejected with a message naming the feature and suggesting the accepted form.

## Safety rules

- **Duplicate keys, a table defined twice, or a key and a table with the same name** → error
  (as TOML itself requires).
- **No prototype keys:** `__proto__`, `constructor` and `prototype` are refused as keys. Output
  objects have no prototype (`Object.create(null)`), so no key can reach `Object.prototype`.
- **Limits:**
  - file size 256 KB;
  - nesting depth 16 (tables plus arrays plus inline tables);
  - string length 16 KB;
  - 10,000 keys.

  Anything larger is an error, so a hostile file can't exhaust memory or the stack.
- **Text rules:**
  - the input must be valid UTF-8; a leading BOM is accepted and ignored;
  - control characters other than tab are refused, inside strings and out;
  - lone surrogates from `\u` escapes are refused;
  - LF and CRLF line endings are both accepted.
- **No evaluation:** values are data only. No environment variables or `${…}` are expanded
  (that would make a branch able to read your environment through config).

## Errors

- **Type:** `ConfigError`, which extends unit 01's `MiraiError` with exit code 3 (`CONFIG`).
- **Message format:** `<source>:<line>:<col>: <what> — <hint>`, one line. For example:
  `.mirai/config.toml:12:5: dotted keys are not supported — use a [git] table`.
- **Stop at the first error.** No partial result is ever returned.

## Files

```
src/config/toml.js           # parseToml(text, { source }) — the whole reader
src/config/TOML-SUBSET.md    # the grammar (EBNF-style) and the rules above
src/cli/errors.js            # + ConfigError (exit code 3)
test/config/toml.test.js     # runs the corpus + the unit tests below
test/config/corpus/valid/*.toml    + matching *.json (expected value)
test/config/corpus/invalid/*.toml  + matching *.err  (expected "line:col: message" start)
```

## Tests

| # | Test | Expected |
|---|---|---|
| T1 | Every `valid/*.toml` parses to exactly its `.json` | Deep-equal |
| T2 | Every `invalid/*.toml` fails with its `.err` position and message start | Exact line:col |
| T3 | The corpus covers every row of the subset table, both "yes" and "no" rows | A test lists the features and checks each has at least one corpus file |
| T4 | Duplicate key, duplicate table, key vs table, array of tables vs table | Each refused |
| T5 | `__proto__`/`constructor`/`prototype` as keys, at top level, in tables and in inline tables | Refused; `Object.prototype` unchanged after the attempts |
| T6 | Each limit: just under passes, just over fails | Error names the limit |
| T7 | Invalid UTF-8, control characters, lone surrogate escapes, BOM, CRLF | As in "Text rules" |
| T8 | A realistic `.mirai/config.toml` (from the `07` key list) and a definition file | Parse to the expected objects |
| T9 | Error type and format | `ConfigError`, exit code 3, `source:line:col: …` |
| T10 | Output objects have no prototype | `Object.getPrototypeOf(x) === null` for every table |

`npm test` stays scoped to `test/**/*.test.js`, and unit 01's tests stay green.

## Open point for you

**Cross-checking against the official TOML test suite.** The official suite
(`toml-lang/toml-test`) is a set of data files, TOML inputs with expected JSON. Running its
valid cases for the features we support would prove we match TOML 1.0, not just our own
reading of it.
- It's data, not code, but it's external. So it goes through our gate: read it, pin a commit,
  log it in `research/06-skill-vetting.md`, and keep a vendored copy of only the files we use.
- **My recommendation:** yes, but as a small follow-up after 03a, so this unit stays
  dependency-free and quick to review. Say "include it" if you want it in 03a.

## Done when

- `npm test` passes: unit 01's tests plus T1–T10.
- `test-results.md` holds the output.
- The Tech Lead and Architect reviews are done, and `review.md` is written.
- You write **"UNIT APPROVED"**. Then: one commit and push, and `PROGRESS.md` updated.
