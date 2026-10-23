---
unit: "03a"
date: 2026-10-23
reviewers: Tech Lead, Architect (independent, read-only)
verdicts: PASS WITH FIXES, PASS WITH FIXES
---

# Unit 03a — Review

Neither reviewer found anything blocking.

**The Tech Lead attacked the reader with hostile 256 KB inputs**, and it held. Inputs tried:
- all `[`;
- deep arrays;
- 9,000 headers;
- 128K-element arrays;
- a 262K-digit number;
- an error at column 262K;
- long header parts;
- nested arrays of tables.

Results:
- every input parsed in about 106 ms or less, with no quadratic slowdown;
- no crash and no exception other than `ConfigError`;
- no way into `Object.prototype`;
- the UTF-8 validator is correct;
- no input found that is accepted with a meaning different from TOML 1.0, except the float
  overflow below, which is now fixed.

**The Architect focused on what 03b and later units will build on.**

## Applied in 03a

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | Wrong position for an unpaired surrogate after a valid emoji (string input) | Tech Lead | `/\p{Surrogate}/u` | T7 |
| 2 | Overflowing floats came back as `Infinity` | Tech Lead | "float out of range" | corpus `float-overflow` |
| 3 | `x = nope` / `x = inline` said "invalid number" | Tech Lead | Only `inf`/`nan` go to the number path; others say "invalid value — strings need quotes" | corpus, T14 |
| 4 | String length unit ambiguous | Tech Lead | Documented as UTF-16 code units | — |
| 5 | Doc typo in the control-character range | Tech Lead | `U+000B–U+001F` | — |
| 6 | Tagged output lost the sign of `-0.0` | Tech Lead | `'-0'` | — |
| 7 | String input never ran against the corpus | Tech Lead | T1 and T2 run every file as bytes **and** as a string | T1, T2 |
| 8 | T5 proved little | Tech Lead | Checks that parsed tables inherit nothing | T5 |
| 9 | Header depth plus value depth never tested together | Tech Lead | Combined case | T6 |
| 10 | **No positions for later errors** (03b, 07, the registry) | Architect | `positions: true` → `{ value, positions }`, with `{ line, column, type }` per key path; `type` keeps `90` and `90.0` apart | T13 |
| 11 | **T11 too loose:** `accepted >= 100` and a regex for reasons | Architect | Exact counts (102 / 106 / 501), and a checked-in map of file → expected reason | T11 |
| 12 | **The provenance hash couldn't be reproduced** | Architect | The recipe is written into `PROVENANCE.json`; a test recomputes it and checks the folder holds exactly the listed files plus `LICENSE`, `PROVENANCE.json` and the list | T12 |
| 13 | **The hint was baked into `message`,** while the CLI prints `.hint` separately | Architect | `ConfigError` has `reason`, `hint` and `path`; `message` is one line with the position; the CLI prints the hint on its own line | T9 |
| 14 | Generic hints | Architect | Concrete: `use a [retention] table, then days = …`; "time" vs "date" | T14 |
| — | T11 hard-codes the suite's counts | Tech Lead | Kept, with a comment that they move with the pin | — |
| — | No differential fuzz against a reference parser | Architect | Not possible without a dependency (D-04); written down as a known limit in `TOML-SUBSET.md` | — |

## Notes for later units (go into the 03b spec; no roadmap change needed)

| # | Unit | Note | From |
|---|---|---|---|
| L1 | **03b** | `readConfigFile(path)` is the only way to load config: `lstat` first, refuse symlinks for project files, check the size before reading, and pass **bytes** to the parser (never `'utf8'` text, which hides invalid UTF-8 as U+FFFD) | Architect |
| L2 | **03b** | Schema checks use `positions` for every error, and the position's `type` for integer vs float | Architect |
| L3 | **03b** | `mirai config check` collects **all** schema problems (a `ConfigError` with `errors[]`, still exit 3); syntax errors still stop at the first | Architect |
| L4 | **03b** | Error messages may name keys but never echo values (agents may read the logs) | Architect |
| L5 | **03b** | `run.stop_by` is an `"HH:MM"` string; the hint already says so | Architect |
| L6 | **03b, 37** | Long text (templates, checklists, prompts) lives in `.md` files referenced by path; definition files stay short | Architect |
| L7 | **07** | The YAML frontmatter subset returns the same `{ value, positions }` shape | Architect |
| L8 | **37** | Any ported tool profile (for example bmad-loop's) is rewritten into the subset | Architect |
