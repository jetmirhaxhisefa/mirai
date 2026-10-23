# The YAML subset MIRAI reads

`src/lint/frontmatter.js` reads the frontmatter at the top of every MIRAI document. Decision
D-40: a written subset, with a test corpus; anything outside it is refused loudly, never
guessed.

**One rule: everything accepted here is valid YAML 1.2, means the same thing there, and reads
the same in YAML 1.1 tools such as PyYAML and js-yaml (and so gray-matter).** The subset only
leaves features out. Two tests in `test/lint/frontmatter.test.js` check this:
- **T5, the official YAML test suite** (`test/vendor/yaml-test-suite`):
  - every case the suite marks as an error is refused;
  - every accepted case gives exactly the suite's JSON;
  - every refused valid case is refused at the place and with the code listed for it in
    `test/lint/yaml-test-suite-outside-subset.json`.
- **T7, the type patterns:** every plain word from the suite, the corpus and a generated set is
  checked against the YAML 1.1 types (bool, null, int, float, timestamp, value, merge) and the
  YAML 1.2 core schema. A word MIRAI reads as a string matches none of them. An integer,
  boolean or null is the same type in both.

## The document

```markdown
---
id: prd-login
type: prd
template: prd@v2
---
# Login
```

- **The input** is a string or UTF-8 bytes. Bytes that aren't valid UTF-8 are refused
  (`encoding`) at their position. Decoding them leniently would give a value strict tools refuse.
- **Frontmatter starts** with `---` as the file's first line (after an optional BOM). Without
  it, the document has no frontmatter.
- **It ends** at the next line that is exactly `---`. With no such line, the error points at a
  near miss (`--- ` with a trailing space, or `...`) if there is one, else at line 1.
- **At most 16 KB** between the two markers.
- **An empty frontmatter** (nothing but blank lines and comments) is an empty mapping. YAML
  reads it as no document. This is the one difference.

## Grammar

`sp` is a space. Lines end with LF or CRLF.

```
frontmatter  = *line
line         = blank / comment / entry / item
blank        = *sp
comment      = *sp "#" *char
entry        = key ":" [ 1*sp value ] [ trailer ]      ; at column 1
             / key ":" [ trailer ]                     ; empty: null, or the key of a block list
item         = 2sp "-" sp scalar [ trailer ]           ; only under an empty entry
trailer      = *sp / 1*sp "#" *char

key          = %x61-7A *( %x61-7A / DIGIT / "_" )    ; [a-z][a-z0-9_]*, but not
                                                     ; y yes n no on off true false null
value        = scalar / flow-list
flow-list    = "[" *sp [ flow-item *( *sp "," *sp flow-item ) ] *sp "]"   ; one line
flow-item    = scalar                                ; plain flow-items also exclude , [ ] { }

scalar       = double / single / plain
double       = %x22 *( dchar / "\" ( %x22 / "\" / "n" / "t" / "u" 4HEXDIG ) ) %x22   ; one line
single       = %x27 *( schar / "''" ) %x27           ; one line
plain        = first-char *char                      ; see "Plain scalars"
```

## Plain scalars

A plain scalar:
- doesn't start with any of `- ? : , [ ] { } # & * ! | > ' " % @` or a backquote. A `-`
  followed by a digit is fine, so that `-5` works;
- contains no `: `, and doesn't end with `:`;
- ends before ` #`, which starts a comment. The comment needs a space after the `#`:
  `title: Fix the #1 bug` is refused, because YAML would silently cut it to `Fix the`;
- ends at its last space-free character. Only spaces count here: a no-break space is content,
  as in YAML.

Then it's read as:

| Text | Value |
|---|---|
| `null` | null |
| `true`, `false` | boolean |
| `0`, `-12`, `42`: no leading zero, no sign but `-`, not `-0`, within ±2^53−1 | integer |
| a word in the next table | **refused** (`ambiguous`), "quote it" |
| anything else | the string itself |

**Refused as `ambiguous`,** because some YAML tool reads them as something else:
- `y`, `yes`, `n`, `no`, `on`, `off`, in any case (YAML 1.1 booleans), and `=` and `<<`
  (YAML 1.1's value and merge keys, which PyYAML refuses to load);
- `True`, `TRUE`, `False`, `FALSE`, `Null`, `NULL`, `~` (YAML 1.2 core);
- anything made only of digits, `.`, `_` and `:`, with an optional sign and exponent, that isn't
  an integer above: `0.5`, `1e3`, `017`, `+1`, `1_000`, `1:30`, `1.2.3`;
- `.inf`, `.nan` (any case, optional sign);
- anything starting with `0x`, `0o` or `0b`;
- dates and timestamps: `2026-10-24`, `2026-1-5`, `2026-10-24T10:00:00Z`,
  `2001-12-14 21:59:43 -5`. YAML 1.1 tools read them as dates, and PyYAML fails on
  `2026-02-30`. Write `updated: "2026-10-24"`; the lint checks the date;
- integers beyond the safe range.

**Keys** follow the same idea: `y`, `yes`, `n`, `no`, `on`, `off`, `true`, `false` and `null` are
refused as keys, because a YAML tool reads them as a boolean or null (`on:` is `True` in
PyYAML, the GitHub Actions trap).

## Refused

Each refusal is a `ConfigError` (exit code 3), with a stable `code`:

| Code | What |
|---|---|
| `ambiguous` | the words above |
| `anchor`, `alias`, `tag` | `&x`, `*x`, `!x` |
| `block-scalar` | `\|`, `>` |
| `nested` | an indented `key: value`; `- a: b`; `a: b: c`; a value ending in `:` |
| `flow-mapping` | `{…}` |
| `continuation` | an indented line that isn't a list item |
| `indent` | a list item not at exactly two spaces, or with more than one space after `-` |
| `list` | an empty item; a nested list; an item with no empty key above it; `key: - a`; an empty or trailing flow item |
| `key` | a quoted, upper-case, spaced or dashed key; a boolean or null word as a key; `? ` complex keys; a space before the colon; `__proto__` |
| `duplicate` | a key defined twice |
| `forbidden-key` | `constructor`, `prototype` |
| `tab` | a tab anywhere, even inside quotes |
| `escape` | an escape other than `\" \\ \n \t \uXXXX` |
| `control` | C0 and C1 controls, DEL, a lone CR, unpaired surrogates; invisible characters that hide or reorder text (the soft hyphen, U+061C, zero-width characters U+200B–U+200F, bidi controls U+202A–U+202E and U+2066–U+2069, U+2060–U+2065, U+FEFF after the start, tag characters U+E0000–U+E007F); U+2028 and U+2029 (line breaks in YAML 1.1 only); U+FFFE, U+FFFF; the same through `\u` |
| `directive`, `document` | `%…` lines; `---` or `...` lines |
| `syntax` | everything else: no `: `, an unclosed quote or list, text or a `#` right after a closing quote, a comment inside a flow list |
| `too-large`, `unclosed` | over 16 KB; no closing `---` |
| `encoding` | bytes that aren't valid UTF-8 |

## Results

- **Value:** a mapping without a prototype. Lists are arrays. Key order is kept.
- **Positions** (`positions: true`): a `Map` from `key` and `key[n]` to `{ line, column }`.
  A key whose value is on its line also has `valueColumn`, so a rule can point at the value.
  All are 1-based and count from the top of the file. Columns count characters, not UTF-16
  units, and are found in linear time.
- **Errors:** `<source>:<line>:<column>: <reason>`, with a `hint` where there is a concrete fix,
  and `path` (`tags[1]`) once the key is known. The reader stops at the first error, and never
  returns a partial value.

## Differences from the TOML subset (03a)

- **Dates:** both refuse unquoted dates. TOML has a date type; here a date is a quoted string.
- **Too large:** TOML's error has no position (code `file`). Here it points at the
  frontmatter's first line (code `too-large`), because the file has a body after it.
- **Keys:** TOML allows `-` and upper case in bare keys. Here keys are lower case with `_`,
  which is what the templates use.
