# Unit 45b: test results (2026-11-26)

**Waiting for the runner, the probes and your approval.** Built on `unit/45b-build` from
`origin/main` (`37679ea`: 45 merged, its re-checks merged).

## What was built

| Scope | Where | What |
|---|---|---|
| 1 The listing | `src/cli/commands/models.js` | `mirai models`: one row per step (15), the agent from the registry's roles (Kai for the plan steps, Rex for the high-risk review, "MIRAI" for the light steps and the reader test, the unit for steps with no agent yet), tier, model, tool, source (file and line, "default", "your personal file"; "(must stay deep)" on the judgement steps); then the three tiers with their source and alternate; the footer; `--json`. It shows what launches use (main's config, your personal models on top), and says when the work tree's `[models]` isn't on main yet, or main's snapshot can't be read. |
| 2 A step's tier | same | `set <step> <tier>`: an unknown step names them all; a judgement step off `deep` is refused (D-14); the default removes the key. |
| 3 A tier's model | same, `src/agent/models.js`, `registry/models.toml` | `set <tier> <model>`: pinned full IDs only (Jet, 2026-11-26, "A"): an alias is refused, naming the full ID to use; off its family refused; a name on no list refused, naming `--check`; `--check` makes one tiny call (`claude -p --model <m> --max-turns 1`) and refuses with the tool's own words; the default removes the key. The list: MIRAI's shipped full IDs (`registry/models.toml`; it also lists Claude Code's aliases, for the refusal). `listModels()` is the adapter hook for 71 and 73. |
| 4 The edit | `src/config/edit.js` | One line changed, comments and order kept; checked by parsing the result (the key holds the value or is gone, every other key unchanged), refused otherwise; the project file must be clean in git. |
| 5 After a project change | `models.js` | `mirai render`, the diff stat, the commit line, "Launches use it once it's on main". Never commits. |
| 6 Launches read your personal file | `src/config/personal-models.js`, `src/agent/run.js`, `src/write/reader.js`, `LAYER_KEYS` | Your per-repo file's `[models]` (tiers) and `[models.steps]` (step tiers; `models.steps.*` joins the personal-repo allowlist) on top of main's config, for your launches; checked: judgement steps deep, a tier's family, a known model (from main's framework copy). The run line's tier reason adds "verify: deep from your personal file". Main's snapshot and the lock are unchanged. |
| 7 The session | `src/mcp/tools/commands.js` | `/mirai models` (`json`) and `/mirai models set` (`target`, `value`, `mine`, `check`): not gates. |
| 8 Docs | `docs/model-tiers.md`, `docs/config.md`, `docs/agents.md` | "Seeing and changing models"; the personal-repo row and every `models.steps.*` row's "who may set it"; the session list. |

## Tests

| Test | File | Result (Mac) |
|---|---|---|
| T1 the listing: 15 steps, agents, sources, judgement steps, a project override's line, your personal file, `--json` | `test/config/models.test.js` | pass |
| T2 a step's tier: one key written, comments kept, rendered, not committed, "not on main yet"; T5 committed, the trust snapshot accepts it; the default removes it; `prd standard` refused; an unknown step names them | same | pass |
| T3 a tier's model: a full ID written; family refused; an alias refused naming its full ID, and refused in your personal file; unknown refused naming `--check`; `--check` refused and proved | same | pass |
| T4 `--mine`: the private file (0600), the listing's source, the pick and the run line's words; a project-only pick unchanged; a personal `prd = "standard"` and a Haiku on standard refused | same | pass |
| T4 a real launch (stand-in Claude Code): your personal `plan = "deep"` passes `--model claude-opus-5-5`, and the run line's reason names your file | `test/agent/plan.test.js` | pass |
| T6 refusals: a config with changes not committed, one that doesn't parse, an inline-table form | `models.test.js` | pass |
| T7 the session list and its arguments; the docs check (34b) | `models.test.js`, `test/docs/coverage.test.js` | pass |

## The red team

The cage changes: `src/agent/run.js` (a cage root: launches read your personal models), its new
imports `src/agent/models.js` and `src/config/personal-models.js`, `src/config/config-schema.js`
(the personal-repo allowlist), `src/config/load.js` (a message) and `src/mcp/tools/commands.js`
(two session commands). A baseline and `redteam-full` are queued with the tests. Your personal
file can change only `[models]` (the allowlist), never what a launch may touch.

## Probes (real)

`test/probes/models-probes.js --probe p1|p2 --yes` (each in its own probe home):
- **P1** `mirai models set verify deep`, committed on main, then one Vera check of
  `business.md`: pass when the listing shows the change and its source and her run line is Opus.
- **P2** `mirai models set standard claude-sonnet-5-5 --mine`, then one Tess run: pass when her run
  finishes, her run line says "standard: claude-sonnet-5-5 from your personal file", and the project
  config is unchanged.

## Changed from the spec

- **Docs:** the new section is in `docs/model-tiers.md` ("Seeing and changing models"), the page
  that already explains tiers and steps, not a new `docs/models.md`; `docs/config.md` points to it.
- **Aliases are refused** (Jet's answer to the question below, "A"): question 1's "D" allowed an
  alias with a note, but every launch checks that Claude Code runs exactly the model it asked for
  (`src/launch/strict.js`), so an alias could be set and never launched (P2's first real run: "the
  model is claude-sonnet-5-5, expected sonnet"). `set` takes pinned full IDs, and Claude Code's live
  alias list (`claude -p /model`) isn't needed: it's not built.
- **A dotted key** (`models.steps.verify = "deep"` at the top): MIRAI's TOML has no dotted keys, so
  such a file doesn't parse at all; an inline table (`steps = { … }`) is refused as "a form MIRAI
  can't change line by line".

## Questions for Jet (answered)

1. **An alias can be set but not launched** (found by P2's first real run; answered **A**, Jet
   2026-11-26): `set` takes pinned full IDs only and refuses an alias, naming the full ID; the
   launch's exact-model check (in the red team's cage) stays as it is. B was: let the launch accept
   any `claude-` ID of the alias's family.
