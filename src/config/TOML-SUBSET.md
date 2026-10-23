# The TOML subset MIRAI reads

`src/config/toml.js` reads every human-edited MIRAI file. Decision D-40: a written subset, with a
test corpus; anything outside it is rejected loudly, never guessed.

**One rule: everything accepted here is valid TOML 1.0 and means the same thing there.** The
subset only leaves features out. This is checked against the official TOML 1.0 suite
(`test/vendor/toml-test`, test T11): every invalid file is rejected; every accepted valid file
gives exactly the suite's value; every rejected valid file is rejected only for a feature listed
under "Left out".

## Grammar

Written in the style of TOML's own ABNF. `ws` is space or tab; `newline` is LF or CRLF.

```
file          = expression *( newline expression )
expression    = ws [ comment ]
              / ws keyval ws [ comment ]
              / ws table ws [ comment ]

comment       = "#" *allowed-char            ; up to the end of the line

keyval        = key ws "=" ws value
key           = 1*( ALPHA / DIGIT / "_" / "-" )   ; bare keys only

table         = std-table / array-table
std-table     = "[" ws table-key ws "]"
array-table   = "[[" ws table-key ws "]]"     ; "[[" and "]]" have no space inside
table-key     = key *( ws "." ws key )        ; dots only in headers

value         = string / boolean / array / inline-table / float / integer

string        = basic-string / literal-string
basic-string  = %x22 *( basic-char / escape ) %x22    ; one line
literal-string = %x27 *literal-char %x27             ; one line, no escapes
escape        = "\" ( %x62 / %x74 / %x6E / %x66 / %x72 / %x22 / %x5C   ; \b \t \n \f \r \" \\
                    / "u" 4HEXDIG / "U" 8HEXDIG )      ; a Unicode scalar value

boolean       = "true" / "false"

integer       = [ "+" / "-" ] unsigned-int
unsigned-int  = "0" / %x31-39 *( DIGIT / "_" DIGIT )
float         = integer "." DIGIT *( DIGIT / "_" DIGIT )   ; no leading zeros, no exponent

array         = "[" *( ws / newline / comment )
                [ value *( blank "," blank value ) [ blank "," ] ] blank "]"
blank         = *( ws / newline / comment )

inline-table  = "{" ws [ keyval *( ws "," ws keyval ) ] ws "}"
                ; on one line; no trailing comma; a value inside may be an array
                ; that spans lines
```

## Meaning (as in TOML 1.0)

- **Tables:**
  - a table is defined once;
  - a header may create its parent tables implicitly, and a parent created that way may be
    defined explicitly once later (`[a.b]` then `[a]`);
  - `[[name]]` appends a table to an array of tables, and later headers under `name` go into
    the last element;
  - inline tables and plain arrays are closed: no header can add to them.
- **Keys:** a key is defined once per table; table names and keys share one namespace.
- **Values:**
  - **integers** must fit exactly in a JavaScript number (±9007199254740991); larger ones are an
    error, as TOML requires for values a reader can't represent; `-0` reads as `0`;
  - **floats** are IEEE 754 doubles;
  - **arrays** may mix types.
- **Output:** plain data. Tables are objects with no prototype; arrays are arrays.

## Left out (each rejected with a hint)

| Feature | Message |
|---|---|
| Dotted keys in assignments (`a.b = 1`), also inside inline tables | dotted keys are not supported — use a [table] header |
| Quoted keys (`"a b" = 1`, `["a"]`) | quoted keys are not supported |
| Multi-line strings (`"""…"""`, `'''…'''`) | multi-line strings are not supported |
| Dates and times | dates and times are not supported |
| Hex, octal, binary integers | hexadecimal, octal and binary numbers are not supported |
| Exponents (`1e3`) | exponents are not supported |
| `inf`, `nan` | inf and nan are not supported |
| Integers beyond ±(2⁵³−1) | integer out of range |
| Floats that overflow to infinity (`1000…0.0`) | float out of range |

## Safety rules

| Rule | Value |
|---|---|
| Maximum file size | 256 KB (`LIMITS.bytes`) |
| Maximum nesting (table path, arrays, inline tables) | 16 (`LIMITS.depth`) |
| Maximum string length | 16,384 UTF-16 code units (`LIMITS.stringLength`) |
| Maximum keys and table-name parts | 10,000 (`LIMITS.keys`) |
| Refused key names | `__proto__`, `constructor`, `prototype` |
| Encoding | UTF-8 only (byte input is validated; overlong forms and encoded surrogates are refused); one leading BOM is ignored |
| Control characters | refused anywhere except tab and CRLF line endings: U+0000–U+0008, U+000B–U+001F, U+007F; a CR without LF is refused. U+0080–U+009F are allowed, as in TOML |
| Expansion | none: no environment variables, no `${…}`, no includes |

## Errors

`ConfigError` (exit code 3):
- `message`: one line, `<source>:<line>:<column>: <reason>`;
- `reason`: the problem without the position;
- `hint`: the concrete fix, printed by the CLI on its own line (as for usage errors);
- `line` and `column`: 1-based; the column counts Unicode code points.

Parsing stops at the first error and never returns a partial result.

## Positions

`parseToml(text, { positions: true })` returns `{ value, positions }`. `positions` maps every key
path to `{ line, column, type }`. Paths look like `git.branch`, `repos[1].name` and
`checks[0]`; bare keys can't contain `.` or `[`, so paths are unambiguous. `type` is `string`,
`integer`, `float`, `boolean`, `array` or `table`, so a schema can tell `90` from `90.0`.

## Known limit

Inputs outside the official suite rest on our own corpus and tests. A differential fuzz against
a reference TOML parser would need a dependency (D-04), so it isn't done.
