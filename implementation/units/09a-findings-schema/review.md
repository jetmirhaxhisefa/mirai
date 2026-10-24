---
unit: "09a"
date: 2026-10-24
reviewers: Tech Lead, Architect (independent, read-only)
verdicts: CHANGES REQUESTED (1 blocking), CHANGES REQUESTED (1 blocking); all findings applied, decided by you, or noted for later units
---

# Unit 09a — Review

**What both reviewers confirmed:**
- **The parser:** strict JSON (RFC grammar, duplicate keys, prototype-free objects, linear time).
- **The validator:** a closed set of keywords, and loose schemas refused when they're compiled.
- **Messages:** reasons that never echo the output.
- **Patterns:** no ReDoS risk in the schema patterns.
- **Design:** a fingerprint without the line, and the triage placed here as pure logic, with
  the policy left to unit 20.

## Applied in unit 09a

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **Blocking: a schema-valid finding could make the run log throw** (a blank symbol; a 512-emoji path, since the log counts UTF-16 units) | Tech Lead | All text needs a non-space character; `file` at most 256 characters; the longest accepted values are logged in a test | T1, T4 |
| 2 | **Blocking: the gate result lacked what the signed record holds** (baseline, known failures, test failures with signatures, base sha, trust root, `skip`) | Architect | **Your decision:** added, with cross rules | T1 |
| 3 | Any one-line text resolved as a repro basis, so an opinion could block | both | **Your decision:** a repro can't block until repros are run (`repro-not-run`); repros are printable ASCII | T3 |
| 4 | The failure signature turned every number into `<n>` ("expected 4, got 0" = "expected 0, got 4"; 500 = 404); `root` had no effect; UUIDs weren't normalized; "defaced" counted as hex | both | **Your decision:** plain numbers kept; UUIDs, hex with a digit, `:line:col`; the root replaced at a path boundary and repo paths kept | T5 |
| 5 | L1 and L2 can't share one `changedLines`: round 2 could quietly drop a carried-over blocker | Architect | **Your decision:** `prior`, `round`, `priorBlocking`, `delta` and the `frozen` reason; `changedLines` is the whole diff | T3 |
| 6 | No schema for the per-finding check on high-risk tickets | Architect | **Your decision:** `finding-check`, and triage's `confirmations` (`unconfirmed`) | T1, T3 |
| 7 | QA didn't fit units 50–51: test names didn't fit the evidence pattern; evidence could be invented; no dogfood taxonomy; no "can't reach the app"; a fail with no cause passed | Architect | **Your decision:** dogfood categories, severities, steps and evidence per issue; `blocked` with a reason; `evidenceRefs`; a fail needs a cause | T1 |
| 8 | Fingerprint collisions (two problems in one file with no symbol) and dodges (`app//A.php`, `A::h()`, a reworded repro) | Architect | **Your decision:** a blocking finding needs its symbol; canonical paths; `()` stripped; the repro wording isn't in the fingerprint; `duplicates` reported | T1, T3, T4 |
| 9 | Hidden characters passed the "one line" pattern: U+2028/2029, NEL, CSI U+009B, bidi controls, zero-width, the BOM; lone surrogates were accepted and collided in fingerprints | both | One shared text class; lone surrogates refused when parsing | T1, T2 |
| 10 | The validator still compiled loose schemas: an untyped node, object keywords without a type, siblings of `$ref`, `$ref` chains, `enum` with objects, `required: "ab"`, `maxLength: "3"` | Tech Lead | Each node is exactly one kind; keyword values are type-checked; `$ref` chains resolve; 11 new refusal cases | T2 |
| 11 | Passing an object skipped the strict parse | Architect | Only text or a strictly parsed value is accepted; `parseJsonStrict({ maxBytes })` for the CLI's envelope | T1, T2 |
| 12 | Nits: a reason on `fixed`; a misleading message for a long number; depth off by one; escape positions; a root message without its path; `changedLines` that had to be a `Map` with canonical keys | both | All fixed | T1, T2, T3 |

## Noted for later units (in the spec)

| Unit | Note | From |
|---|---|---|
| 19 | Check that `claude --json-schema` accepts these exact files (lengths, `maxItems` and lookaheads may be stripped); a refused output is an agent error, retried once without using a round, then parked | both |
| 24 | Namespace finding ids per lens and merge by fingerprint; decide from triage's `blocking`, never from `verdict`; show findings to the developer as fenced data | Architect |
