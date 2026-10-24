---
unit: "09b"
name: report-templates
date: 2026-10-24
node: v22.23.2
result: 148 / 148 pass (earlier units' 145 + unit 09b's 3), after the review fixes; 3 full runs in a row green
---

# Unit 09b — Test results

## Run

`npm test` (scoped to `test/**/*.test.js`), after the review fixes (`review.md`). The new file:

```
T6: a rendered MR description holds no findings, counts rounds, and lets no value inject structure
T7: the QA and run reports render their template's sections from checked data, escaped
T7b: the escaping helpers
# tests 148
# pass 148
# fail 0
```

Three full runs in a row: 148/148 each.

**What T6 covers:** every hostile case from both reviews:
- mentions, issue and commit references, emails, math, emoji, GitLab references;
- quick actions, URLs after `_` or a digit;
- secrets in commands and output, terminal escapes and OSC 8 links;
- the size budget per host, the stack reference per host;
- follow-ups that cite code.

It checks the text outside code spans, which is what a host's reference filters see.

**Earlier tests changed:** none. 09a's validator gained a NaN check, and its tests still pass.

## The roadmap's "done when", mapped (09b's share)

| Done when | Test |
|---|---|
| a rendered MR description holds no findings | T6: no field takes them (unknown keys refused), a follow-up citing a file or line is refused, and nothing in it links or references |

## What came up while testing

1. **List items need the line-start escapes too:** their text starts a block, so `1. x` inside
   one became a nested list.
2. **A token in a plain field slipped past the final scan,** because escaping split its shape
   (`ghp\_…`). Input text is now scanned before escaping.
3. **The command itself wasn't redacted, only its output.** Both are now.
4. **My own test data needed fixing twice:** a bidi character the input schema rightly
   refuses, and a size case too big for both hosts.
