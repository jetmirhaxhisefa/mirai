---
unit: "03b"
date: 2026-10-23
reviewers: Tech Lead, Architect (independent, read-only)
verdicts: PASS WITH FIXES, PASS WITH FIXES
---

# Unit 03b — Review

Each reviewer found one blocking issue. Both are fixed, and every should-fix is applied, with
one exception: the personal model choice (P1 below) waits for your decision.

**What held (Tech Lead):**
- No route sets a never-auto gate to `auto`: not through inline tables, presets or personal
  files.
- No prototype pollution.
- A scalar replacing a table, and the reverse, are caught with correct positions.
- `git+https://u:p@…` is caught.
- The `.md` references can't escape the registry.

## Applied in 03b

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **Blocking: a symlinked `.mirai` folder was accepted**: a branch could point the project config outside the repo. Same for `agents/` and `document-types/` | Tech Lead | Shared files are opened with `O_NOFOLLOW` and must have a real path inside their folder (`within`); registry folders must be real folders | T15 |
| 2 | **Blocking: `schema_version` was checked on the merged config**, so a personal file could supply or hide the project's version | both | Checked in each file before merging; required in the project file | T14 |
| 3 | Credential bypasses: `sk-proj-`, `#access_token=`, `X-Amz-Signature`, `private_token`, `Api-Key`, `xoxe-`, tokens as a remote's user, SCP-style `oauth2:…@host:` | Tech Lead | New `credentials.js`: wider token shapes (at a word boundary, so `task-…` isn't read as `sk-…`), secret parameter names matched in the query **and** fragment, remotes allow only the `git` user | T4 |
| 4 | Tokens in other fields (resource names, check argv, repo commands, key names) | Tech Lead | Every string value **and key name** in every layer is scanned | T4 |
| 5 | Key names echoed in messages (a token as a key name was printed) | Tech Lead | Key names are shown only when they look like ordinary names, otherwise `<key>`; the registry no longer echoes state or agent names | T4, T11 |
| 6 | The personal per-repo file could set `models.steps.*` | both | That file allows exactly `models.light`, `models.standard`, `models.deep` and `run.stop_by` | T6 |
| 7 | `models.steps` accepted any name | Architect | A closed list of step names (provisional until unit 19) | T8 |
| 8 | `loadConfig` could only read the work tree; the trust root (unit 12) must check config taken from git | Architect | `checkConfig(layers)` checks already-parsed layers; `loadConfig` = read files + `checkConfig` | T16 |
| 9 | Test levels had no `repo`; `required_for` was free text | Architect | `repo` (must name a listed repo) and an enum for `required_for` | T17 |
| 10 | `[checks]` could only be an argv array; unit 14 needs a service and a timeout | Architect | A check may also be a table: `command`, `service`, `workdir`, `timeout_minutes` (the array stays as shorthand) | T17 |
| 11 | `gate.code_paths` could cover no code | Architect | At least one including pattern required | T17 |
| 12 | Registry hardening: `read_only` optional; `may_write.paths` unchecked | Architect | `read_only` required; write paths must be relative globs without `..` | T11 |
| 13 | Errors had no stable code, and two shapes (`errors` missing for a single problem) | Architect | Every problem has a `code`; `errors` is always a list; `listed` tells a summary from a single problem | T8, T17 |
| 14 | Time-of-check race (`lstat`, then read by path) | both | The file is opened once (`O_NOFOLLOW` for shared files), then `fstat` and read from the same handle | T10 |
| 15 | Nits: `sources` mutable; preset gates shown as `default`; `track` missing from the spec list; the branch pattern accepted `/main`, `feature/.x` and `@` | both | `sources` is a frozen object; gates from the preset show `preset:<name>`; `track` listed; the branch pattern is stricter | T1, T8 |
| — | "Proofs required per milestone" (07 key list) | Architect | **Kept in code, not config**, so no config can drop a required proof. Units 25 and 26 own it | — |

## Your decision on the personal model choice (P1)

**Finding (both reviewers):** a personal file could set `models.deep = "claude-haiku-5-5"`, so
PRD, design and high-risk reviews quietly run on the smallest model.

**Decision (2026-10-23, D-58): freedom with visibility.**
- Any model may be set for any tier.
- `mirai config check` always shows each tier's model and where it was set.
- A model outside its tier's family (deep: Opus or Fable; standard: Sonnet; light: Haiku) gives
  a **warning** naming what runs on it.
- Units 19, 29 and 56 show the model actually used for judgement steps (added to `07`).

Test: T18.

## Notes for later units

| Unit | Note |
|---|---|
| 04, 07 | Document types gain a `version` (07's `prd@v3`), derived states and terminal states; all additive |
| 11 | A tool-profile kind: make the registry's kinds list extensible and return results keyed by kind |
| 19 | Agent manifests gain `max_turns` and per-step tiers |
| 19, 40 | A `[verifier]` setting for the ladder rungs |
| 20 | Budgets and round caps per ticket size (additive) |
| 25 | Whether `gate.code_paths` may exclude protected paths (the default excludes `.mirai/**`) |
| 60 | Release mode |
| 37 | Overlays; nothing in 03b blocks them |
