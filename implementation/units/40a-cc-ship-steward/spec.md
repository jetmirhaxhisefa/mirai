---
unit: "40a"
name: cc-ship-steward
status: built, waiting for the probes and Jet's approval (urgent fix; decision "A", Jet, 2026-11-23)
roadmap: new, an urgent fix from the red team's S3 going red on Claude Code 2.1.330; units 13b (strict bundle), 13c (your sessions' settings), 18a (the red team's static checks)
depends_on: ["13b", "13c", "18a", "40"]
---

# Unit 40a: Claude Code's `/ship` and `/steward` turned off

## Why

Claude Code 2.1.330 started loading two new bundled skills, most likely through a server-side
rollout:

- `ship-local`, behind `/ship`: commits, pushes and opens a GitHub pull request as you;
- `steward`, behind `/steward`: watches the pull request, pushes fixes, merges the base branch in,
  and can lead to a merge.

Claude Code runs some of their `git` and `gh` commands itself, outside the sandbox
(code.claude.com/docs/en/ship-command, "Permission rules and hooks that apply to /ship and
/steward").

The red team's S3 went red: "Claude Code brings in what MIRAI's adapter data doesn't list (seen
on 2.1.318): skill ship-local, skill steward". checkInit would refuse every agent launch for the
same reason.

**The setting, checked against the docs (2026-11-23):**
- `skillOverrides` with `"off"` hides a skill from Claude and the `/` menu. Invoking it by name
  returns the `skillOverrides` error (docs/en/skills, "Override skill visibility from settings").
- The ship page turns off both by name: `{"skillOverrides": {"ship-local": "off", "steward": "off"}}`.
  The troubleshooting page confirms the message `Skill "ship-local" is disabled via skillOverrides`.
- It works in user, project, local and managed settings, and in a `--settings` file (which is how
  every agent run gets its settings).
- `disableBundledSkills` would turn off every bundled skill: too broad.
- **Not in the docs:** whether an `"off"` skill is left out of a `-p` run's init event. Only the
  red team shows that (S3, below).

## Decision (Jet, 2026-11-23, "A")

Turn both off everywhere MIRAI controls. Outside MIRAI projects nothing changes. Jet's own
`~/.claude*` settings aren't touched.

## Scope

1. **Adapter data** (`registry/adapters/claude-code.toml`):
   - `builtin_skills_off = ["ship-local", "steward"]`, beside `builtin_skills` and never in it
     (the registry refuses a name in both);
   - `builtin_version` is `2.1.330`: the other lists were seen unchanged there.

   A new bundled skill in neither list still turns S3 red. `nameClash` refuses a custom item
   named after either.
2. **Agent runs** (`src/launch/strict.js`):
   - each strict template carries `builtin.skills_off`;
   - `renderStrict` writes `skillOverrides: {"ship-local": "off", "steward": "off"}`. This changes
     the canonical bundle hash, so earlier red-team results no longer cover the templates;
   - `checkInit` refuses a run whose init event still lists one: "skills MIRAI's settings turn off
     still loaded: …".
3. **Your sessions** (`src/install/render.js`, `src/install/lock.js`,
   `src/adapters/claude-code.js`):
   - `mirai render` and `init` merge the same `skillOverrides` into `.claude/settings.json`;
   - each becomes a lock entry, `skill-off:<name>`, counted as present while the value is `"off"`.
     Turning one back on, or removing it, is a change `mirai render` puts back;
   - a value of yours for either skill is replaced, and your other entries stay;
   - a skill MIRAI turned off before and no longer does is taken out;
   - a `skillOverrides` that isn't an object is refused, not overwritten.
4. **The red team** (`src/redteam/static.js`, `src/redteam/run.js`):
   - **S3:** a skill in `builtin_skills_off` is expected absent. One that's still listed is red
     ("… still loads them (skillOverrides didn't hold)"), apart from the "not listed" note;
   - **S6 (new, no model):** every template's rendered settings, and `.claude/settings.json` as
     committed at the integration branch's base, must turn both off. A missing or wrong value, a
     missing file or invalid JSON is red.
5. **Docs:** `docs/agent-safety.md` (a new section, "Claude Code's `/ship` and `/steward` are
   off") and `docs/red-team.md` (S3, S6, and green as S1–S6).

## Tests

- **40a T1** (`test/adapters/claude-code.test.js`), your sessions' settings:
  - both skills are turned off, your entries stay, and your `"on"` is replaced;
  - the lock lists both entries, and a second render changes nothing;
  - a change to your own entry isn't flagged;
  - turning one back on, or removing it, is flagged and put back;
  - a `skillOverrides` that isn't an object is refused;
  - a skill MIRAI no longer turns off is taken out.
- **40a T2** (`test/adapters/claude-code.test.js`), the adapter: the list is exactly the two
  skills, neither is in `builtin_skills`, and the registry refuses a name in both.
- **40a T3** (`test/launch/strict.test.js`), the agent runs:
  - both templates render the overrides, and dropping one changes the canonical hash;
  - a template from before 40a renders none;
  - a bad `skills_off` is refused;
  - checkInit names an off skill that still loads.
- **18a T5, extended** (`test/redteam/redteam.test.js`):
  - S3: ok with both absent; red, with its own note, when one is listed; red for a new bundled
    skill;
  - S6: ok on a real render and the committed session settings; red for a template without the
    overrides, a session file with `"on"`, no file, or invalid JSON.
- **13c T11** now expects a fresh `.claude/settings.json` to hold `permissions` and
  `skillOverrides`.

## Probes

- **P1, the sample app's red team** (queued by the lead session through the build runner, after
  the runner refreshes the sample app to this commit). Expected: GREEN, with S3's note "ship-local,
  steward turned off and absent" and S6 ok. This is the only proof that Claude Code honours
  `skillOverrides` in a `-p --restricted --settings` run. If S3 stays red with "still loads
  them", the override doesn't hold there. Agent launches then stay refused (checkInit), and the
  fix needs another route (a managed setting, or Jet's call).
- **P2, `thudos-setup`'s red team, after a refresh** (Jet runs it; steps in test-results.md).
  Expected: GREEN, the same S3 and S6 notes, and the committed `.claude/settings.json` holding
  both overrides.

## Cage

Every source file this unit changes is in the cage (checked with `cageOf` on this tree). So the
red-team result's `framework` key part changes, and agent launches need a new red team:
- data: `registry/adapters/claude-code.toml`;
- roots: `src/launch/strict.js`, `src/adapters/claude-code.js`, `src/redteam/static.js`,
  `src/redteam/run.js`;
- reached through imports: `src/config/registry.js`, `src/config/custom-items.js`,
  `src/install/render.js`, `src/install/lock.js`.

The canonical bundle hash of both templates changes too, since the rendered settings gain
`skillOverrides`.
