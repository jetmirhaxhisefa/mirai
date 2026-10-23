# Implementation progress

One line per unit, added when you approve it. The build order is
`design/07-implementation-roadmap.md`; each unit's folder holds its spec, test results and
review.

| Unit | Name | Milestone | Approved | Tests | Notes |
|---|---|---|---|---|---|
| 00 | Usage spike | — | dropped 2026-10-23 | — | Step 0 dropped; unit 30's usage note is the first reading (`00`, "Changes at the start of implementation") |
| 01 | [`mirai` CLI skeleton](units/01-cli-skeleton/) | A | 2026-10-23 | 19 / 19 | Router, help, version, exit codes, zero dependencies. Incident during the first test run: see `test-results.md` |

**Next:** unit 02, the private sample app (`mirai-sample-app`).
**Open:** the decision on moving `research/_sources/` out of the repo folder (`units/01-cli-skeleton/review.md`).
