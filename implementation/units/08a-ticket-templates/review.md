---
unit: "08a"
date: 2026-10-24
reviewers: Tech Lead, Architect (independent, read-only)
verdicts: CHANGES REQUESTED, CHANGES REQUESTED (none blocking); all findings applied, decided by you, or noted for later units
---

# Unit 08a — Review

**What both reviewers confirmed:**
- the fields match design/01 §5 and 03 "Templates", and tickets have no `status`;
- `id_pattern` equals unit 04's `TICKET_ID`;
- `{id}` is escaped correctly under the `u` flag, with no backtracking risk;
- the repo check reads `[[repos]]` from the project layer only;
- unknown-repo messages don't echo the value;
- a copy of the registry lints clean;
- the dependency runs one way: the lint imports config, never the reverse.

**Branding:** the section names follow the prior art's ticket structure as functional reuse
(allowed by 03). No names, personas or branding are borrowed.

## Applied in unit 08a

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **An AC defined under another id** (`AC-PMT-13.3` in PMT-12, or a typo `AC-PTM-12.2`) silently stopped being an AC, so plans, tests and trace would miss it | Architect | `foreign-id`: a definition-form ID of the kind's shape but another id is a problem | T7 |
| 2 | Own ACs counted anywhere in the file, for example under Notes | Architect | ID-kind field `section = "Acceptance criteria"`; elsewhere is `misplaced-id` (still counted, so no second report) | T7 |
| 3 | **A copied, unfilled template linted clean** | both | **Your decision:** inside the docs root, template lines, the example `id` and the sample `verify` are `template-text` problems; checklist line added | T7 |
| 4 | The bug ACs couldn't all be satisfied ("no change needed" replaced the others; "a test covers the defect" is about tests, not behaviour) | Tech Lead | **Your decision:** behaviour-only ACs; the test rule moves to the done-when and the checklist; "no change needed" is a drop with evidence | T1, T2 |
| 5 | `checks` clashed with the config's named checks, and an overlay could remove one | Architect | **Your decision:** renamed `lint_checks`, with unique names; for unit 37, overlays may add, never remove | T6 |
| 6 | Tracker keys: `after: [pmt-12]` wasn't caught as self, and duplicates weren't flagged | both | **Your decision:** keys compared without regard to case; duplicates flagged | T4 |
| 7 | `files_likely` refused quoted paths with spaces, and accepted `C:/x` | Tech Lead | **Your decision:** spaces allowed; drive letters refused | T4 |
| 8 | The file name wasn't tied to the id | Architect | `file-name` under `tickets/` (03: `tickets/<id>.md`) | T7 |
| 9 | The T5 escaping assertion passed by accident | Tech Lead | It now checks a mention that would match only if `.` weren't escaped | T5 |
| 10 | Nothing tested that `mirai lint` reads `[[repos]]` from `.mirai/config.toml` | Tech Lead | T2 covers the config case through the CLI | T2 |
| 11 | With no id, or a numeric one, a follow-on `missing-id` appeared with the hint `AC-undefined.1`; a token-shaped id was echoed | both | No `missing-id` without a usable id (missing, wrong shape); token-shaped ids are shown as `<id>` | T3 |
| 12 | With no repos passed, the repo check failed open | both | One `project` object, defaulting to the config defaults | T2, T3 |
| 13 | The template comments lacked slicing guidance and `AC-NFR`, and the bug one pointed at the story's | Tech Lead | Rewritten | T1 |
| 14 | Field cases missing from T4: `tests`, `epic`, `covers_fr: [BR-1]`, `after: [11]`; `missing-id` checked on the story only | Tech Lead | Added | T3, T4 |

## Noted for later units (in the spec)

| Unit | Note | From |
|---|---|---|
| 43 | Owns checking every AC-shaped mention in a ticket's text (a PRD AC or a ticket's own) | Architect |
| 37 | Overlays may add lint checks, never remove them | Architect |
| multi-repo | Whether a service repo's light install lints tickets, and with which repo list | Architect |
