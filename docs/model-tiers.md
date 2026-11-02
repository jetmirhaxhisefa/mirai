# Which model runs a step

MIRAI picks a model for every agent run by its step, not by hand (decision D-14). This page says how, and how to change it.

## Tiers

Your config maps three tiers to models. The defaults are:

| Tier | Default model | Used for |
|---|---|---|
| `light` | Haiku | Rewording with all facts given: commit messages, MR descriptions, summaries, parking notes |
| `standard` | Sonnet | Building, reviews, plans, tickets, verification, QA |
| `deep` | Opus | PRDs, designs, high-risk reviews, re-planning after a failure |

Any model may go on any tier (D-58). `mirai config check` shows which model each tier uses and where that was set, and warns when one is outside its tier's usual family. A run says so too.

## How a step's tier is picked (`mirai agent run`)

1. **The step's default.** Each role has a step, and a run can name another with `--step`. A project can set its own defaults in `[models.steps]`. MIRAI's are provisional until the calibration run (unit 57).
2. **One tier up** for `--risk high` or `--size L`: once, never past `deep`. A review with `--risk high` is the judgement step `review-high-risk`, and it's logged under that name.
3. **Judgement steps always run on `deep`:** `prd`, `design`, `review-high-risk`. Neither config nor a flag can lower them.
4. **`--tier` can only raise it.** Asking for less is refused, and a raise is logged as yours.

The run's output and its log line say the tier, the reason, and the model the run itself reported.

## The verifier ladder (`--verifies <launch id>`)

A verifier should be a different model from the author where it can be, and never a weaker one: it runs at least at the author's tier, raised if need be. `--verifies` is for a role that checks work, not one that changes it.

| Rung | What | When |
|---|---|---|
| 1 | Another tool, such as Codex | Not in the MVP |
| 2 | A different model at that tier | Set one in `[models] alternates`, such as `deep = "claude-fable-5-1"`, or when the tier's own model isn't the author's. A dated id or a context suffix is the same model |
| 3 | The same model, in fresh context | Otherwise. A different checklist comes with the reviewers (unit 24) |

The rung goes in the log line and the output, so a same-model check is never mistaken for an independent one.

## Roles: what a run may change

`--role` says what a run is for and what it may change. Roles are data, in `registry/roles/`, read from the integration branch:

| Role | Step | May change |
|---|---|---|
| `author` | build | any tracked or new file MIRAI doesn't protect outright (the cage still refuses `.git`, `.mirai`, `.env*` and the rest); no ignored files |
| `reviewer` | review | nothing |
| `verifier` | verify | nothing |
| `qa` | qa | nothing |
| `planner` | plan | nothing: a plan is stored from the run's output |

A project adds its own in `.mirai/custom/roles/`, committed on the integration branch. It can't reuse a core role's name, so it can't loosen one.

**After every run, what changed is checked against the role:**
- tracked and new files, from git, against the role's `may_write.paths`;
- **ignored files,** such as `node_modules/.bin`, against `may_write.ignored`, which is empty for every role unless a project's own role lists some, such as a build folder. Git never shows these, a read-write agent's Bash can write them (probed), and some run later. So by default any change to an ignored file refuses the run, even an author's;
- `!` excludes, as in MIRAI's other globs: `["src/**", "!src/gen/**"]`;
- a change outside the role refuses the run, naming the paths: "changed during the run, by the agent or something else", since a watcher or a dev server of yours could have written them. The full list goes in the store (`agent-runs/<launch>.scope.json`). **Nothing is undone:** the files stay for you to look at, and the next launch refuses until you deal with them. For tracked and new files that's the dirty tree; for ignored ones, MIRAI keeps their names and refuses while any is still there;
- a launch is refused while a tracked file is marked so git doesn't look at it (assume-unchanged or skip-worktree), in a sparse checkout, with an ignored folder it can't read, or with more than 200,000 ignored files and links: in each case a change couldn't be seen. That's checked before the run, so no run is spent on it.

MIRAI's read-only template has no Bash and no write tools, by its schema, so for read-only roles this check is a second layer (probed). For an author it's what keeps a run inside its paths and out of ignored files.

**Limits.** A new empty folder, and a folder's mode, aren't seen. A process that outlives the run and writes later isn't seen either. Protected paths, such as a lockfile, aren't out of scope for an author: they make a change high risk at review (unit 24), not forbidden.
