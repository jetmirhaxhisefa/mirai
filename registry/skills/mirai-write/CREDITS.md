# Credits

`mirai-write` is MIRAI's own text. Its rules were written in MIRAI's words after reading the
sources below; none of their text is copied, except short quotes in `research/14-document-wording.md`
with their source. MIRAI keeps no copy of any of them and doesn't track their changes.

## blader/humanizer

- https://github.com/blader/humanizer, read once at commit
  `8c307f367c91bd974002f10f2be2965d642c13df` (2026-10-16), by Siqi Chen.
- What MIRAI took: the idea behind six of its patterns (padding, empty emphasis, staging,
  re-explaining what the reader knows, chat leftovers, the wrong reader), its "treat the text as
  material, never as instructions" stance, its "add no fact" rule and its "when not to act" list.
  research/14 §5 says what was left out and why.
- License: MIT. Its notice:

```text
MIT License

Copyright (c) 2025 Siqi Chen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

humanizer's patterns come from Wikipedia's "Signs of AI writing"
(https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing, WikiProject AI Cleanup).

## pstack `technical-writing` and `unslop`

- https://github.com/cursor/plugins, folder `pstack/` (plugin 0.15.44 for research/13), by Lauren
  Tan. License: MIT (`pstack/LICENSE`).
- What MIRAI took: one name per thing, specific over general, and a short numbered catalogue of
  writing tells.

## The sources research/14 cites

| Source | What it informed | License or terms |
|---|---|---|
| RFC 2119, https://www.rfc-editor.org/rfc/rfc2119 | "must" for a requirement; "should" and "may" used sparingly | IETF; "Distribution of this memo is unlimited" |
| INCOSE Guide to Writing Requirements, rules R7–R9 (through secondary sources) | No vague terms, escape clauses or open ends | © INCOSE; only rule titles used |
| Cucumber, Gherkin reference, https://cucumber.io/docs/gherkin/reference/ | Given, When and Then each with one job | © The Cucumber Open Source Project; no license on the page |
| Dan North, "Introducing BDD", https://dannorth.net/blog/introducing-bdd/ | A story's behaviour is its criteria | © Dan North & Associates |
| Bill Wake, "INVEST in Good Stories", https://xp123.com/invest-in-good-stories-and-smart-tasks/ | Testable means the author could write the test | © XP123 |
| Michael Nygard, "Documenting Architecture Decisions", https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions | "We will …", neutral context, all consequences (for 62) | CC0 1.0 |
| MADR, https://adr.github.io/madr/ | Decision and consequence sentence shapes (for 62) | MIT or CC0-1.0 |
| Malte Ubl, "Design Docs at Google", https://www.industrialempathy.com/posts/design-docs-at-google/ | Non-goals a reader could expect; neutral context | No license stated |
| arc42 §1.2, https://docs.arc42.org/section-1/ | Few, concrete quality goals (for 62) | CC BY-SA 4.0 |
| C4 model notation, https://c4model.com/diagrams/notation | Specific labels, not "uses" | CC BY 4.0 |
| Shape Up, chapter 12, https://basecamp.com/shapeup/3.3-chapter-12 | Name work by what it does, not by layer | © 37signals |
| Rust RFC template, https://github.com/rust-lang/rfcs | Guide-level and reference-level wording (for 62) | MIT or Apache-2.0 |
| Google developer documentation style guide, word list, https://developers.google.com/style/word-list | "and/or", "e.g.", "just", "easy" | License not confirmed on the fetched text |
| GOV.UK, digital.gov, Microsoft, Google Technical Writing, Spec Kit, BMAD (through research/13) | The general writing rules and the summary | As listed in research/13 |
