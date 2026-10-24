---
unit: "08b"
date: 2026-10-24
reviewers: Tech Lead, Architect (independent, read-only)
verdicts: CHANGES REQUESTED (1 blocking), CHANGES REQUESTED (none blocking); all findings applied, decided by you, or noted for later units
---

# Unit 08b — Review

**What both reviewers confirmed:**
- the example plan lints clean with LF, CRLF and a BOM;
- CRLF and LF hash the same;
- an edit inside the block breaks the approval;
- a missing, repeated or out-of-order marker gives no hash, so the approval fails closed;
- a second `## Boundaries` after the block is a `duplicate-section`;
- `frozen_sections` and `may_be_empty` are good extension points.

## Applied in unit 08b

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **Blocking: text after the end marker** rendered as part of Edge cases but wasn't hashed. With the end marker in the middle of the table, every row below it could change after approval | Tech Lead | Only blank lines and comments may sit between the end marker and the next section | T9 |
| 2 | **The approval didn't cover what the plan gate approves:** after approval, a new dependency or protected path, `tdd: first → after`, or a dropped AC still verified | both | **Your decision:** `approvalHash` over the frozen block, the Declared changes rows and `ticket`, `acs`, `risk`, `tdd`, `tests`, `round`; `verifyPlanApproval` | T10 |
| 3 | An approval wasn't tied to a ticket: one signed for PMT-31 verified against PMT-99's plan | Architect | `verifyPlanApproval` checks the approval's ticket against the plan's, ignoring case | T10 |
| 4 | Hidden content in the frozen block was signed: an HTML comment, a bidi character; the template put its guidance comments inside the block | Architect | Comments (other than the markers) and invisible characters are problems inside the block; the template's guidance moved above it | T9, T2 |
| 5 | **Test rows couldn't be matched to tests by machine** (units 22–23 must run exactly the planned ones) | Architect | **Your decision:** `Test ID` and `Symbol` columns now, in template v1 | T6, T7 |
| 6 | The table reader missed GFM rows without a leading pipe (a dependency with `risk: normal` passed), and counted lines that aren't rows: a second table, indented code, a row hidden by a comment | Tech Lead | Read as GFM renders it: header, separator with dashes, then the run of non-blank lines; hidden rows and a second table are problems | T8 |
| 7 | Declared changes had no fixed format | Architect | Item and Why required; a protected path is a repo path or glob; a dependency is `<ecosystem>:<name>` | T8 |
| 8 | The characterization check keyed symbols by name, so the last row won; it over-matched bare names | Tech Lead | Exact `Symbol`, checked against the set of changes per symbol | T7 |
| 9 | Leftover text: a real `npm test` line was flagged, and the template's Code map row was missed; T2 checked only the set of codes | Tech Lead | Compared as the text shows (code spans kept); T2 lists the lines it expects flagged | T2 |
| 10 | `red` rows under `tdd: after` passed | both | A problem | T6 |
| 11 | A marker quoted in a fence broke the approval; a marker indented four spaces still counted | both | Markers only outside fences, indented at most three spaces | T9 |
| 12 | Approval context and journal kind | Architect | **Your decision:** `mirai/plan-approval/1:<repo-id>`, in `docs/signing.md`; unit 21 decides the journal shape | T10 |
| 13 | `tests: optional` and rows per AC | Architect | **Your decision:** every AC still needs a row (`no-test: <reason>` allowed) | T6 |
| 14 | Nits: `No-test:` was case-sensitive; repeats in `acs`; a missing AC reported at `acs`, not `acs[i]`; an unused `cell` field; no-test rows ran the kind and symbol checks; `lintText` had no size limit, said "unknown type" for an empty one, and gave no hint; `add` rows didn't have to name their symbols | both | All fixed | T2, T6, T7 |

## Noted for later units (in the spec)

| Unit | Note | From |
|---|---|---|
| 21 | How the journal records a plan approval; the broker and floor guard check against the approved plan; the skills say the frozen block wins over anything below it | Architect |
| 23 | Map `Test ID` to the level's runner | Architect |
| 37 | The plan's core sections are protected from renames and reordering, or the check follows the mapping | Architect |
| multi-repo | Levels are flattened across repos; a plan could be limited to its ticket's repo | Architect |

## Not changed

- **Linking edge cases to tests:** no Case column. The verifier checklist asks about it instead.
- **A lone carriage return** isn't normalised. The frontmatter reader refuses it anyway.
