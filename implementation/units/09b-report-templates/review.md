---
unit: "09b"
date: 2026-10-24
reviewers: Tech Lead, Architect (independent, read-only)
verdicts: CHANGES REQUESTED (2 blocking), CHANGES REQUESTED (1 blocking); all findings applied, decided by you, or noted for later units
---

# Unit 09b — Review

**A note on how one check was made.** The Tech Lead sent probe strings and a rendered sample MR
description to GitHub's public Markdown API (`api.github.com/markdown`) to see what GitHub
really renders. It did this without being asked. Only test data went out, no project code or
tokens. Reviewer prompts now say "no network calls" (memory updated).

**What held up:**
- headings, line-start list markers, HTML, entities, footnotes, task lists and link reference
  definitions can't be injected (checked on GitHub);
- pipes in table cells stay in their cell;
- the output fence can't be closed from inside;
- a missing or extra template section is detected, while a heading in a comment or fence is
  ignored;
- the MR description takes no findings.

## Applied in unit 09b

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **Blocking: a Why starting with `/merge`** reached the MR as is, so GitLab could run it as a quick action with MIRAI's token | Architect | A leading `/` is escaped, in paragraphs and list items | T6, T7b |
| 2 | **Blocking: backslash escapes don't stop GitHub's reference filters:** `\@user`, `\#1`, `GH-1`, emails, `$math$`, `:shipit:` and SHAs still linked or rendered (checked on GitHub) | Tech Lead | **Your decision:** reference-shaped words are shown as code spans | T6, T7b |
| 3 | **Blocking: a URL after `_` or a digit** (`_https://evil.example`) escaped the defanging and became a live link (checked on GitHub) | Tech Lead | URLs are code spans now; nothing is defanged | T6 |
| 4 | Commands and output went to the MR unredacted (passwords, tokens, AWS keys, home paths) | Architect | **Your decision:** a redacted tail of 20 lines; any other text with a token refuses the render | T6, T7b |
| 5 | No size limit on the whole body (1 MB possible; GitHub caps at 65,536) | Architect | **Your decision:** a budget per host; output dropped first, then test names | T6 |
| 6 | Link targets accepted control and bidi characters, which reached the terminal raw; MR links in the run report weren't credential-checked | both | Excluded characters refused; credentials checked | T6, T7 |
| 7 | The stack reference lost its link (`\!12`); the renderer didn't know the host | Architect | **Your decision:** `host`, and a structured `stack.number` | T6 |
| 8 | "Holds no findings by construction" was overstated: a follow-up could carry `file:line` review text | Architect | **Your decision:** a follow-up citing a file or line is refused; unit 27 builds them from triaged findings | T6 |
| 9 | Report templates and unit 37's overlays; projects' own PR templates | Architect | **Your decision:** fixed templates; MIRAI writes its own body | — |
| 10 | The run report was hard to read in a terminal | Architect | **Your decision:** a plain-text form | T7 |
| 11 | Branch warnings came 8th, while the design puts them first | Architect | Right after the summary | T7 |
| 12 | `$'` in a title expanded through `String.replace` | Tech Lead | A function replacement | T6 |
| 13 | NaN passed the number checks | Tech Lead | Refused, in 09a's validator too | T7 |
| 14 | Repo-path links resolved wrongly on an MR page | Tech Lead | Shown as code paths | T6 |
| 15 | Nits: leading spaces made indented code; a template without `{title}` or with a duplicate section; QA rows that weren't passes; `resets_at` as free text; GitLab `%` references; the cut splitting an escape (the cut now works on lines); the README; a hidden marker for unit 27 | both | All fixed | T6, T7 |
| 16 | The tests encoded the wrong model (a backslash makes a value safe) | Tech Lead | Tests now check the text outside code spans, plus every probe case from both reviews | T6, T7 |

## Noted for later units (in the spec)

| Unit | Note | From |
|---|---|---|
| 27 | Check the real GitHub and GitLab rendering of a hostile description (an opt-in script, with your approval, since it calls the network); follow-ups only from triaged non-blocking findings | both |
| 29, 56 | Rounds, verdicts, limit share and metrics as optional keys with sections (additive) | Architect |
