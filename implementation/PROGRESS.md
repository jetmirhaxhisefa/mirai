# Implementation progress

One line per unit, added when you approve it. The build order is
`design/07-implementation-roadmap.md`; each unit's folder holds its spec, test results and
review.

| Unit | Name | Milestone | Approved | Tests | Notes |
|---|---|---|---|---|---|
| 00 | Usage spike | — | dropped 2026-10-23 | — | Step 0 dropped; unit 30's usage note is the first reading (`00`, "Changes at the start of implementation") |
| 01 | [`mirai` CLI skeleton](units/01-cli-skeleton/) | A | 2026-10-23 | 19 / 19 | Router, help, version, exit codes, zero dependencies. Incident during the first test run: see `test-results.md` |
| 02 | [Sample app](units/02-sample-app/) | A | 2026-10-23 | 9 / 9 checks | Private repo `mirai-sample-app` (`5df7a1d`): Laravel 13 + React 18 + MySQL + Playwright, seeded traps, canary `.env` |

**Next:** unit 03, the config model.
**Added:** proposals P1–P11 from the unit 02 review are in `design/07` (units 13, 14, 16, 17, 18, 30, 39, 47, 52, 57 and Later).
**Done:** the external clones moved to `~/Projects/mirai-sources/` (read-only) on 2026-10-23.
