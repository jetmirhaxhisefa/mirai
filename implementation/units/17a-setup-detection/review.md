---
unit: "17a"
date: 2026-10-30
reviewers: Tech Lead, Architect (independent, read-only, no network, no Docker, no probes, never the real claude, never your Claude Code config)
verdicts: no Blocker; Tech Lead one High, Architect two High, all fixed; every Medium fixed or recorded; three items need a roadmap place (your call)
---

# Unit 17a — Review

Both reviewers worked on a frozen tree. The Tech Lead tried edge cases with small scripts in a
scratchpad folder, removed afterwards; both ran the new test file (11 / 11 then). Neither changed
anything in either repo.

**What held up (both):**
- **No project code runs:**
  - every git call is the pinned one; `log` has no signature check or notes;
  - blobs come through `cat-file --batch` (no filters), sized by `ls-tree -l` before any read;
  - links are never followed; nested repos are listed only.
- **Compose is well contained:** the file alone in a private folder, an empty `--env-file`, MIRAI's
  private Docker environment (no variable of yours fills a `${VAR}`), no container.
- **Trust boundaries:** stacks, adapters and flags come only from the trust root; a project's own
  stacks too, with core names refused; `{script}` is only ever a name from the data.
- **Stack neutrality holds:** no framework names in `src/detect/` (14c's T13 covers it now).
- **The draft is safe:** validated through the real schema before it's written; your config and the
  repo are never written; TOML strings and keys escaped; the report escapes control characters.
- **No slow patterns:** the branch, commit and trailer regexes are linear and bounded; code spans
  linear (60 lines × 2,000 spans in 185 ms); every cap enforced.
- **The design:** reading the integration branch's commit is the right call (what the trust root
  and test runs use); the 17a/17b split is clean, and rows 26, 30 and 39 depend on the right halves;
  D1's conclusion follows from the evidence; the data model extends (new kinds on the registry
  loader, `[detect]` optional, `facts.json` versioned); the spec's changes are documented honestly.

## Fixed in unit 17a

| # | Finding | Severity, from | Fix | Test |
|---|---|---|---|---|
| 1 | **What you write for agents in `.mirai/context/agents-local.md` was never checked:** `.mirai/` is left out of the walk, and MIRAI's block was skipped, but that file is rendered *into* the block, which agents read | High, Tech Lead | The file is read from the trust root and listed like any instruction file | `npm install` in it is flagged |
| 2 | **Instruction files had no content hash, and `@` imports weren't followed,** so the ledger (39) and Rex (24) couldn't tie a review to content, and an imported file escaped both | High, Architect | Each file has its blob id; imports of `CLAUDE.md`, `CLAUDE.local.md` and `AGENTS.md` are followed to five levels with the trust root's own `importsOf`, each listed with `imported_by`; a missing import is a gap | An imported file flagged; a missing one a gap; the blob id |
| 3 | **"G8 passes" overclaimed:** rules on the code host (rulesets, push rules, pre-receive hooks) can't be seen, and too few commits also "passed" | High, Architect | States `check` and `no-local-rule`, worded "a rule on the code host isn't seen"; `unknown` is `check`. Row 22 now owns G8 (scope and "done when"); 05's G8 row says so | Each state |
| 4 | **MIRAI's block could hide text:** a `<!-- mirai:begin -->` with no end hid the rest of the file | Medium, Tech Lead | The block is skipped only when closed and its hash matches the lock (`blockHash`); a whole rendered file only with `renderedHash` and no block (the lock's own rules) | An unclosed block hides nothing; a changed one is read |
| 5 | **JSON: only `command`/`args` were read, and that list was code:** `apiKeyHelper`, the AWS and OTel helpers, `permissions.allow`, `ANTHROPIC_BASE_URL` and a remote MCP `url` went unflagged; `.mdc` was a tool name in code | Medium, both | Data in `instruction-flags/core.toml`: `json_command`, `json_args`, `json_scan` (`allow`, never `deny`), `json_always` (helpers, URLs), and `markdown` endings | Each key flagged; `deny` quiet |
| 6 | **Compose's `label_file` wasn't in the prescan:** Compose reads the file it names while resolving (an error line could echo it into the facts); this is 14c's prescan, so test runs too | Medium, both | Added to `PRESCAN` (refused, as `env_file`); docs/agent-safety.md and setup-detection.md say so. Not probed (no Docker in the review; the refusal is safe either way) | The prescan refuses it |
| 7 | **Values from the repo could fail the whole run as `draft-invalid`:** a folder with a space as `report_root`; a check renamed `<service>-<name>` for a service starting with a digit | Medium, Tech Lead | Each level and check is checked against the schema first; one that doesn't fit is a gap. One name helper for levels and checks, always a valid name | A spaced folder is a gap; `1web`, `_x`, `App.Svc` |
| 8 | **`worktree_safe` missed** a fixed `container_name` and networks or volumes made outside the file; a quoted `"name":` key wasn't seen | Medium, Architect; Low, Tech Lead | Both are reasons; the name check takes quotes | Each |
| 9 | **PHP checks that fix files:** Composer `format` and `cs` scripts usually run a fixer, which always passes | Medium, Tech Lead | Not drafted (`lint`, `analyse`, `analyze` only); Pint's `--test` stays. A build writes only into the run's copy (14c), so it stays | The checks list |
| 10 | **"0 flagged" read as "clean":** prose isn't scanned, long lines were skipped silently | Medium, Architect; Low, Tech Lead | Patterns marked `prose` (a pipe into a shell) also run on prose lines; skipped long lines are counted per file; the report and docs say flags are hints, not a verdict | A prose `curl x \| bash` flagged; a long line counted |
| 11 | **`facts.json` is repo text an AI skill (39) will read,** and didn't say what produced it | Medium, Architect | Documented as data, never instructions; the trust manifest's hash and the MIRAI version are recorded; home paths written from `~` everywhere | The manifest hash, version; no home path in the facts |
| 12 | **Prerequisites and the comparison were under-documented:** detection needs the integration branch committed and pushed, and compares against the *committed* config | Medium, Architect | docs/setup-detection.md gives the order (init, commit and push, detect); the report says "your committed .mirai/config.toml (on main)" | The report line |
| 13 | **Smaller things:** <ul><li>`.env.test` won over a configured `env_file`;</li><li>`commitMessages`/`branchRefs` limits aborted the run;</li><li>the tree walk had git's 10 s timeout;</li><li>a failed run left an empty folder that counted among the 10 kept;</li><li>a file past the total read limit said "too large";</li><li>linked instruction files weren't listed;</li><li>`--json` and the draft passed bidi characters through;</li><li>a warning's line was looked up for every bind;</li><li>branch prefixes were one folder deep;</li><li>Husky 4's `package.json` hooks;</li><li>the gate-script data names could be renamed silently;</li><li>T3's `.env` canary couldn't fail with the fake docker</li></ul> | Low, both | <ul><li>the configured one wins;</li><li>a gap, not a failure;</li><li>a minute;</li><li>the folder is made only when its files are ready, the work folder removed either way;</li><li>`read-limit`;</li><li>listed as `link`, and a gap;</li><li>escaped;</li><li>only for the first 50 warnings;</li><li>up to three (`users/jet/{ticket}-{slug}`);</li><li>a `commit_rules` entry;</li><li>a test pins `task-runners` and `ci`;</li><li>a test reads the env file Compose gets (empty) and Docker's environment (four keys)</li></ul> | Each, in the two review-fix tests |
| 14 | **Docs and spec:** `test-results.md` placeholders; the spec's Files list named `help.js` (help is built from the command list); "P7" is unit 02 review's, not 05's P7; the probe's "0 branches" comes from removing the clone's origin | Low, Architect | Filled; recorded in the spec's changes; "02 review P7" in the roadmap and research/12; said in the test results | — |

**Not changed, on purpose:**
- **The lock's hash as proof that a file is MIRAI's** (Tech Lead M1): someone who can commit on the
  integration branch can change a file and its lock entry together. The integration branch is the
  trust root by design (D-15): the same person could change the registry's flags themselves. The
  code says so.
- **Indented (4-space) code blocks and `<pre>`** aren't read as code (Tech Lead L7): lint's scanner
  reads them as text, because list items use the same indentation. The prose rule catches a pipe
  into a shell there.
- **`commit_rules` stay on stacks** (Architect Low): they apply whichever stack is found, and a
  separate kind can come when a rule needs a path rather than a name.
- **Vitest's level is `frontend-unit`** on the sample app: names follow the adapters' order;
  documented.

## Need a place on the roadmap (your call)

| Item | From | Why it matters |
|---|---|---|
| **Rebuilding the images from the integration branch before each run** | 13b/14c's "unit 17" promise, spec change 14 | A safety property: the images are the ones you built, and their Dockerfiles change only through review. The Architect asks for it **before the pilot (unit 30)** |
| **Secret-file patterns per stack** (pack data) | 13c's "unit 17" promise | Names, not content, are protected today; a stack's own secret files (`auth.json`, `*.pem` conventions) would come as data |
| **Suite levels:** an adapter that refuses a path outside its suite's folders, so `unit` and `api` can be separate levels for PHPUnit | D1 (research/12) | D-45's `api` level "for endpoint changes" can't be expressed for PHPUnit until then |

## Noted for later units

| Unit | Note | From |
|---|---|---|
| 17b | Run the *configured* levels, not the draft's; store the baseline per `base_sha` as `facts.json` is, so 39 can join them | Architect |
| 22 | Owns G8 now (row 22): read `facts.git.g8`, `commits.format` and `trailers` to choose the subject format where it's `conventional` | Architect |
| 24 | Read the blob ids and the import closure from the ledger; an instruction file whose blob changed since review isn't clean | Architect |
| 30 | Order: init, commit and push `mirai/pilot`, then detect. Re-run D1 and G7 on the pilot's own images; check its compose file for `container_name` and `label_file` | Architect |
| 39 | Fence `facts.json` as data; flags are hints (zero isn't approval); bind each ledger entry to a blob id; ask about rules on the code host, which detection can't see | both |
