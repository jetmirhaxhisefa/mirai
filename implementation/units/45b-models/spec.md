---
unit: "45b"
name: models
status: approved (Jet, 2026-11-25: "approve 130"; interview 2026-11-23, roadmap row 45b; questions 1 "D" and 2 "A" answered 2026-11-25)
roadmap: design/07-implementation-roadmap.md, row 45b; D-14 (tiers, judgement steps deep), D-58; units 03b (config), 05a (the personal-repo file), 11 (render, the lock's bundle hash), 19b (`pickTier`, alternates), 21a (each agent's model in its file), 21f (the session list), 40 (Vera), 41 (Nora)
depends_on: ["03b", "05a", "11", "19b", "21a", "21f", "40", "41"]
---

# Unit 45b: `mirai models`

## Why

Which model runs each agent and step lives in `.mirai/config.toml` (`[models]`, `[models.steps]`)
and in your personal file (`config.user.toml`). Changing it means knowing the key names, editing
TOML by hand, then running `mirai render` and committing, or the next launch refuses the stale
plugin files. Unit 40's P1 chose Vera's model that way. Nothing shows, in one place, which model
Nora, Tess, Vera, Kai and Rex actually run on.

**Why now** (Jet, 2026-11-23: "earlier, right after 44-45"): the document agents (41, 42) and Vera
(40) are on; you want to try models per step without editing config, and Cursor and Codex (71, 73)
will add a tool per step later.

## Decisions (Jet, 2026-11-23, interview; roadmap row 45b)

1. **One command to see and change models.** `mirai models` lists; `mirai models set` changes.
   Nobody edits `[models]` by hand.
2. **Two kinds of change:** a step's tier (`mirai models set <step> <tier>`) and a tier's model
   (`mirai models set <tier> <model>`). Both write the project config, a normal committed change.
   `--mine` writes your personal-repo tier-to-model override, as exists today.
3. **Today's rules hold:** `prd`, `design` and `review-high-risk` stay `deep` (D-14); a tier's model
   must be of its family (`light` a Haiku, `standard` a Sonnet, `deep` an Opus or Fable,
   `TIER_FAMILIES`); a model MIRAI doesn't know is refused (question 1).
4. **In your session too:** `/mirai models` (gates: none); `set` prints the change and the commit
   it needs.
5. **Skills have no model of their own** (they run on your session's model): out of scope.
6. **Ready for 71/73:** the listing has a tool column (Claude Code today); `set` takes `--tool`
   once a second tool exists.

## Scope

**In**

1. **`mirai models`** (`src/cli/commands/models.js`): one table, a row per step (`STEPS`, 15 today)
   with the agent that runs it where there is one (from the registry's roles: `prd` Nora, `tickets`
   Tess, `verify` Vera, `plan`/`build` Kai, `review` Rex, the light steps "MIRAI"):
   ```
   step              agent                      tier      model              tool         from
   prd               Nora (mirai-product-manager) deep    claude-opus-5-5    Claude Code  default (must stay deep)
   tickets           Tess (mirai-ticket-planner)  standard claude-sonnet-5-5 Claude Code  default
   verify            Vera (mirai-verifier)        standard claude-sonnet-5-5 Claude Code  .mirai/config.toml:14
   …
   ```
   - then the three tiers with their model and where each comes from (default, project, your
     personal file, your global file: `loadConfig`'s `sources`), and the alternates (19b) if set;
   - a footer: "one tier up for high risk or size L (not for steps that are already deep)";
   - persona names from the registry (38b: never hard-coded); `--json` for scripts.
2. **`mirai models set <step> <tier>`:** refuses an unknown step or tier (naming the valid ones) and
   a judgement step off `deep` (D-14, the schema's own message). Writes `models.steps.<step>` in
   `.mirai/config.toml`; setting a step back to its default removes the key.
3. **`mirai models set <tier> <model>`:** refuses a model off its tier's family and a model MIRAI
   doesn't know (question 1). Writes `models.<tier>`. With `--mine`, writes your personal-repo
   file instead (`config.user.toml`, 05a), where only the three tiers may be set (03b's allowlist);
   `--mine` also takes a step's tier (question 2, "A": `models.steps.*` joins the personal-repo
   allowlist; judgement steps still `deep`).
4. **Writing the config:** a small line edit of `[models]` / `[models.steps]` that keeps comments
   and order (MIRAI has a TOML parser, no writer: the edit is checked by parsing the result and
   comparing every other key, and refused if anything else would change). The file must be clean
   in git first (no other edits mixed in).
5. **After a project change:** `set` runs `mirai render` (the plugin files carry each agent's
   model, and the lock's bundle hash must match, 11), shows the diff (config, lock, agent files),
   and prints the commit and where it applies: "Launches use it once it's on main (they run from
   main's snapshot, 11)." It never commits (C1) and never touches main.
6. **Launches read your personal file** (question 2, "A"): `trustedConfig`'s result is merged with
   your personal-repo file's `[models]` (tiers and steps) for launches you start, after the checks
   (03b's allowlist, D-14, question 1's lists); the run line and `mirai models` name the source.
   Main's snapshot and the lock are unchanged (the plugin files keep the project's models; the
   launch passes its picked model, as `pickTier` does today). A test shows a personal step tier
   used, a personal `prd = "standard"` refused, and a project-only run unchanged.
7. **`/mirai models`** on the session list (21f): the listing; `set` runs and prints the commit
   line. Cursor and Codex: the command is MIRAI's, nothing names Claude Code except the tool
   column's value.
8. **Docs:** `docs/models.md` (new: tiers, steps, families, the judgement rule, project vs
   `--mine`, when a change applies); `docs/config.md` points to it; the session list.

**Out**

- Skills' models (they run on the session's model).
- A second tool and `--tool` (71, 73): only the column and the parsed option's refusal ("one
  tool today: Claude Code") are in.
- Calibration of step tiers from results (57).
- Cost per model (a report, later).

## Tests

- **T1 Listing:** a fresh project lists all 15 steps with the agent, tier, model, tool and
  "default"; a project override and a personal-file model show their sources; judgement steps say
  "must stay deep".
- **T2 Step tier:** `set verify deep` writes `models.steps.verify = "deep"` and nothing else in the
  file (comments kept); `set verify standard` (the default) removes the key; `set prd standard` is
  refused with D-14's message; `set nosuch deep` names the steps.
- **T3 Tier model:** `set standard claude-sonnet-5-5` writes it; `set deep claude-haiku-5-5` is
  refused (family); a name on no list is refused naming `--check`; `--check` with a stand-in tool
  that accepts it sets it, one that refuses shows the tool's error; an alias (`opus`) is set with
  the "not pinned" note; a failing live list falls back to the shipped list and says so.
- **T4 `--mine`:** `set standard <model> --mine` writes `config.user.toml` (private, 0600), the
  listing shows the source, and a launch (fake launcher) uses it (question 2); the project config
  is unchanged.
- **T5 Render:** after a project `set`, the plugin files carry the new model and the lock's
  bundle hash matches (the trust snapshot accepts it once committed); nothing is committed.
- **T6 Refusals:** a dirty config file, a config that doesn't parse, or an edit that would change
  another key: refused, nothing written.
- **T7 Session:** `/mirai models` is on the session list; the docs check (34b) passes.

## Probes (real)

- **P1 Change Vera's step and see it run:** on the sample app, `mirai models`, then `mirai models
  set verify deep`, commit and merge as printed, then one Vera check (`mirai verify` on an
  approved PRD). **Pass when** the listing showed the change and its source, and Vera's run line
  names Opus.
- **P2 `--mine`:** `mirai models set standard <another Sonnet> --mine`, one Tess run (`--probe
  p4`). **Pass when** her run line names that model and the project config is unchanged.

## Done when

- T1–T7 pass, and the full suite passes through the build runner and CI.
- P1 and P2 pass.
- The roadmap row's done-when holds.

## Checked against the queued units

- **19b:** `pickTier` stays the one place that picks a launch's tier; the listing calls it.
- **11:** render and the lock as they are; `set` only calls render.
- **40, 41, 42:** Vera, Nora and Tess show by persona; no change to them.
- **43, 44, 45:** unchanged; their steps (`tickets`, `prd`, `verify`) are listed.
- **57:** calibration later writes the same `models.steps` keys.
- **71, 73:** the tool column and `--tool`; each adapter's `listModels()` (Cursor live, Codex
  live). The tier families (`TIER_FAMILIES`: Haiku, Sonnet, Opus/Fable) are Claude's only: in
  Cursor and Codex a tier can be a GPT, Grok or Composer model, so each adapter needs its own tier
  rule (for those units' interviews).
- **Cage:** `src/cli/commands/models.js` and the config edit are outside the red team's cage, but
  Scope 6 (launches read your personal models) changes `src/agent/run.js` and the trust code, which
  are cage roots: the build needs a baseline and a red team. The personal file may change only
  `[models]` (the allowlist), never what a launch may touch.

## Questions for Jet

1. **A model MIRAI doesn't know** (answered 2026-11-25, **D**, after Jet asked for the tools'
   own lists and the CLIs were checked): each tool's adapter supplies its known models, live where
   the tool can list them:
   - **Claude Code:** the aliases from `claude -p "/model"` (`sonnet`, `opus`, `haiku`, `fable`,
     `best`, `[1m]` variants, `opusplan`, `default`), plus MIRAI's shipped list of full IDs
     (`registry/models.toml`, updated with MIRAI's releases); there is no list of full IDs;
   - **Cursor** (71): `cursor-agent models` (the account's list); **Codex** (73): `codex debug
     models` (JSON; under `debug`, so it may change between versions);
   - a name on none of them is refused, unless `--check` proves it with one tiny real call (the
     tool accepts the name, or `set` refuses with the tool's own error);
   - a live list that fails (not logged in, a changed command) falls back to the shipped list, and
     says so;
   - defaults stay pinned full IDs; an alias may be set, with a one-line note ("not pinned: moves
     to the newest model; probes and red-team results were measured on the pinned one");
   - 45b builds Claude Code's lists and the adapter hook (`listModels()`); Cursor's and Codex's
     come with 71 and 73.
2. **Your personal override doesn't reach launches today** (found while writing this spec; answered 2026-11-25, **A**: launches apply your personal file for your launches, tiers and step tiers, with D-14 and question 1's checks; the run line names the source).
   `docs/config.md` says your personal-repo file may set `models.light|standard|deep`, and `mirai
   config show` shows it, but every launch reads only main's project config (`trustedConfig` in
   `src/trust/snapshot.js` → `loadTreeConfig`, project file only). So `--mine` would write a value
   nothing uses. A: launches apply your personal file on top of main's config for **you** (your
   machine, your launches): the three tiers' models, and also step tiers (`models.steps.*` joins the
   personal-repo allowlist), with D-14's judgement rule and the families still enforced, and the
   run line naming the source ("standard: claude-sonnet-… from your personal file"); B: the same,
   tiers only, as the docs say today; C: drop the personal model keys (a docs fix), project changes
   only. Recommendation: **A**: you can try "Vera on deep" for yourself at once, and propose it to
   the repo with a project `set` once it's proven.

## Re-checked against 43 as built (merged 2026-11-25, PR #127)

- No change: trace runs no model; the steps listed are unchanged (`STEPS`, 15).

## Re-checked against 44 as built (merged 2026-11-26, PR #132)

- No new step: Nora's look-ahead runs in your session (the `mirai-interview` skill); her decision
  answers, continue and fix runs are the `prd` step; Vera's incremental re-check is the `verify`
  step. 44's only new key, `[docs] max_decision_questions`, isn't a model key. Nothing changes here.
