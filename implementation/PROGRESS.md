# Implementation progress

One line per unit, added when you approve it. The build order is
`design/07-implementation-roadmap.md`; each unit's folder holds its spec, test results and
review.

| Unit | Name | Milestone | Approved | Tests | Notes |
|---|---|---|---|---|---|
| 00 | Usage spike | — | dropped 2026-10-23 | — | Step 0 dropped; unit 30's usage note is the first reading (`00`, "Changes at the start of implementation") |
| 01 | [`mirai` CLI skeleton](units/01-cli-skeleton/) | A | 2026-10-23 | 19 / 19 | Router, help, version, exit codes, zero dependencies. Incident during the first test run: see `test-results.md` |
| 02 | [Sample app](units/02-sample-app/) | A | 2026-10-23 | 9 / 9 checks | Private repo `mirai-sample-app` (`5df7a1d`): Laravel 13 + React 18 + MySQL + Playwright, seeded traps, canary `.env` |
| 03a | [TOML subset reader](units/03a-toml-reader/) | A | 2026-10-23 | 33 / 33 | Zero-dependency reader with positions; official TOML 1.0 suite vendored as data: 501/501 invalid rejected, 102/102 in-subset files exact |
| 03b | [Config model + registry core](units/03b-config-model/) | A | 2026-10-23 | 51 / 51 | Four layers (personal settings never in the repo), collected errors with codes, never-auto gates, credential checks, `checkConfig` for the trust root, registry core, `mirai config check|show`; D-58 (models: freedom with visibility) |
| 04 | [Status model](units/04-status-model/) | A | 2026-10-23 | 67 / 67 | Four state machines (201 state pairs tested), human-only moves, derived `built`/`integrated`/`done` ordered by journal seq, status file format; unpark = re-plan/retry/drop; `mirai status` moved to unit 05 |

**Next:** unit 05, the orchestrator store (with `mirai status`, moved from unit 04).
**Added:** proposals P1–P11 from the unit 02 review are in `design/07` (units 13, 14, 16, 17, 18, 30, 39, 47, 52, 57 and Later).
**Done:** the external clones moved to `~/Projects/mirai-sources/` (read-only) on 2026-10-23.
