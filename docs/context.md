# The context files

Unit 36 (D-43, D-44; `research/15-context-files.md`). Every agent run loads the project's
context from `.mirai/context/`. Five kinds of file hold it:

| File | What it holds | You approve it? |
|---|---|---|
| `business.md` | What the product does, who it's for, the goals, what this repo is and isn't responsible for, the business rules, a glossary, the constraints. Every claim cites its source. | Yes |
| `journeys.md` | The critical journeys, `J-1`, `J-2` …: the flows that lose users or money when they break, each with its steps, why it's critical and its end-to-end test. | Yes |
| `feature-map.md` | One row per screen: its name, its route, and the handles a test finds it by. | No: the lint checks it against the code |
| `project-<service>.md` | One per service: the stack and versions, the commands, where things are, the test levels, and where its own instructions are. | No: the lint checks it against the code |
| `conventions-<service>.md` | One per service: its rules, each `enforced by <check>` or `judgment`. | Yes |

Setup (unit 39) writes them for a project from your sources and an interview. Until then, you can
write them from the templates in MIRAI's registry (`registry/templates/`); the sample app's are in
`registry/examples/context/`. Other files in `.mirai/context/` (`agents-local.md`, `sources/`)
aren't context files and aren't linted.

## What the lint checks

`mirai lint` checks the context files with the documents, and checks them against the repo's code
and config. Each problem names the line and the fix.

**`business.md`:**

- every bullet ends with its source, `(S-1)` or `(S-1, S-3)`; a claim that isn't a bullet fails;
- every `S-n` is a row of the `## Sources` table: what it is, where it is (a link, a file path in
  backticks, or `you said`) and a date; a file that doesn't exist fails; a row nothing cites is a
  warning;
- about two pages: a warning past 800 words, a failure past 1,000, the Sources table not counted.

**`journeys.md`:**

- each journey is `### J-n: <what the person gets done>`, numbered with no gap or repeat;
- each has `Steps:` with a numbered list, a `Why critical:` line ending with its source, and an
  `E2E test:` line: a test file that exists, or `none yet`;
- a screen named in bold in a step that the feature map doesn't have is a warning.

**`feature-map.md`:** `code:` in its frontmatter lists the folders that hold the screens' code.

- each handle is `role "accessible name"` (an ARIA role, or `label "…"`) or `data-testid="…"`; a
  part that changes is written `<like-this>`;
- a handle not found in the code under those folders fails (test files don't count);
- a route not found there is a warning: routes can be built at run time.

**`project-<service>.md`:** `service:` is the name in the file's name; `root:` is the service's
folder.

- each path in the Layout table, the Stack table's "Set in" column and the Instructions must exist;
- each command in the Commands and Test levels tables that runs a package script (`npm run lint`,
  `npm test`, `composer run-script lint`) must name a script in the manifest in `root`.

**`conventions-<service>.md`:**

- each rule is a bullet ending `(enforced by <check>)` or `(judgment)`;
- `<check>` must be a named check in `[checks]` of `.mirai/config.toml`;
- a judgment rule without an indented `Example:` line is a warning;
- a judgment rule that names a check's tool (such as `tsc` for a `types` check) is a warning:
  the check already enforces it, so write it as one `enforced by` line.

## Approving

```
mirai approve --file .mirai/context/business.md
```

- It refuses while the file doesn't lint clean, listing the problems; nothing is written.
- It shows the file's path and hash. You approve the whole file: read it all first.
- Your decision is signed, as for a brief: one journal line, `kind: context`, with the file's type.
- A change to the file makes the approval stale; approve it again.
- `feature-map.md` and `project-<service>.md` are refused: the lint checks them against the code.

`mirai show context` lists the five kinds with each file's state (approved, changed since
approval, not approved, or "checked, not approved") and its full path. A kind with no file shows
as missing.

## Doctor

`mirai doctor` shows a "Context files" item. It's yellow when:

- `business.md` was last approved more than 180 days ago: read it against what has changed;
- an approved context file changed since its approval, or was never approved.

## The limits

`business.md`'s cap is team policy, set in the project's `.mirai/config.toml` only:

```toml
[docs.limits]
business_words = 1200       # 300 to 3,000; default 1,000
business_warn_words = 900   # 200 to 3,000; default 800
```
