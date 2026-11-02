---
unit: "19b"
name: scope-tiers
status: approved (2026-11-02)
roadmap: design/07-implementation-roadmap.md, rows 19 and 19b/19c; D-12, D-14 (tiers, ladder, recursion guard), D-37, D-58; R2-M9, R-M1, TL2-6, TL3-8, TL3-9, Q5, Q12
depends_on: ["19a", "03b", "12"]
---

# Unit 19b: What a run may have done, and which model did it

## Why

19a starts one agent safely, but it doesn't check two things:
- **What the agent changed.** The cage stops it reaching outside. Inside your project, a run in `--mode read-write` can change any file that isn't protected. A reviewer that "fixes" the code it's reviewing, or a planner that edits tests, goes unnoticed. And `--mode read-only` only removes the write tools: its Bash can still write into the project, unless the sandbox says otherwise.
- **Which model ran, and why.** Today you pick a tier by hand. D-14 says the step decides, risk and size raise it, judgement work is never lowered, and a verifier differs from the author where it can, with the rung logged.

Both matter before unit 21, when real agents start doing real work.

## Scope

**In.**

1. **Roles as data (`registry/roles/*.toml`, a project's own in `.mirai/custom/roles/`, both from the trust root).** Each role has a mode, a step and a write scope, as globs relative to the project, stack-neutral:
   - `author`: everything but protected paths;
   - `reviewer`, `verifier`, `qa`: nothing;
   - `planner`: nothing in the project, since a plan lives in the store, written from its output.

   `mirai agent run --role <role>` replaces `--mode`. Unit 21's agents name a role. These four are placeholders that later units may refine; nothing here assumes a stack.

2. **The write-scope check, after the processes have ended and before `.git`'s result is reported:**
   - tracked and new files, from pinned git, against the role's scope, measured from the clean tree 19a already requires;
   - **ignored files too (TL2-6):** unit 12's fingerprint of ignored files, before and after, since `node_modules/.bin` or `.env` never show as changed. Any change outside scope fails the run;
   - a violation is outcome `refused`, naming the paths (as data, escaped), with a log field `scope_violations` (a count).
   - **It doesn't undo anything.** The files stay for you to look at. Reverting is unit 22's.

3. **Tier selection (D-14).** `--step <step> [--risk high] [--size L]`, in one function, `pickTier`:
   - the step's default, from `[models.steps]` in the trust root's config (the defaults need setting; they're provisional until unit 57);
   - **one tier up** for high risk or size L, once, at most `deep`;
   - **judgement steps (`prd`, `design`, `review-high-risk`) are always `deep`;**
   - `--tier` stays as a way to go **up** only. Below the computed tier, it's refused for judgement steps and logged as an override elsewhere.

   "Escalate once for light steps" counts failed checks across runs, so it goes to unit 20's loop guard.

4. **The verifier ladder (D-14, Q12).** `--verifies <author-launch-id>`, reading the author's model from the run log, and `pickVerifier`:
   - **Rung 1,** another tool: not in the MVP. It stays in the code as "not available" (Milestone D).
   - **Rung 2,** a different Claude model of a comparable tier: from a new optional `[models] alternates`, such as `deep = "claude-fable-5-1"`.
   - **Rung 3,** the same model in fresh context, with a different checklist. The checklist comes with reviewers in unit 24; here it's only the rung and the log.

   The rung goes in the log line and the output.

5. **The judgement-step model (D-58):** the run-log line and the output name the model actually used, from the init event, not the configured one. They match today, since 19a checks it. A run on `deep` whose model is outside that tier's family says so in its output.

6. **The log line:** `step`, `role`, `rung`, `tier` and the reason for the tier become real.

7. **Docs:** `docs/agent-safety.md`, `docs/model-tiers.md`; the roadmap; D-12 if open point 2 changes it.

**Out:**
- **19c:** the broker, sessions, and the launch token's minting (open point 2).
- **Unit 20:** escalation, rounds, the budget and the usage check.
- **Unit 21:** real agent definitions, their prompts, `agentsJson`, worktrees.
- **Unit 22:** commits and reverting.
- **Unit 24:** review checklists, structured verdicts.
- **Row 29b:** your key at rest.

## Probes (with your OK before each batch)

- **R1. What read-only Bash can do today.** A read-only launch asked to change a tracked file and a new file through Bash. If the sandbox stops it, the check is a second layer. If not, it's the only one, and the docs must say so. 2 Haiku runs.
- **R2. Ignored files.** A run writes an ignored file from Bash, and unit 12's fingerprint must see it. How long that takes on the sample app, with its `node_modules`. No more than 2 Haiku runs; timing with no model.
- **R3. Each tier's model through the real launch:** `checkInit` compares the configured id with what the init event reports, and 19a has only tried Haiku. A one-word prompt on Sonnet, Opus and Fable. 3 short runs, the only non-Haiku runs in this unit.
- **R4. End to end on a sample-app clone:** a reviewer that edits a file is refused and named; an author inside its scope is ok; a verifier gets rung 2, then rung 3 with no alternate. About 4 Haiku runs.

**No full red team in this unit, if the strict bundle and hook don't change** (open point 4). The framework's hash changes anyway, so any green goes stale.

## Files

- **New:** `src/agent/scope.js`, `src/agent/tiers.js`, `registry/roles/*.toml`, `docs/model-tiers.md`, `test/agent/scope.test.js`, `test/agent/tiers.test.js`.
- **Changed:** `src/agent/run.js`, `src/cli/commands/agent.js`, `src/config/config-schema.js`, `src/config/defaults.js`, `src/config/registry.js` (the kind), `src/store/run-log.js`, `test/probes/agent-probes.js`, `docs/agent-safety.md`, the roadmap.

## Tests (`npm test`, no model; the stand-in `claude`)

- **T1.** A reviewer's change to a tracked file, a new file or an ignored file: `refused`, each path named, escaped. Nothing is reverted.
- **T2.** An author inside its scope is ok; a protected path or a path outside its scope isn't. A glob from a project's role can't widen protected paths.
- **T3.** A link or a file with a hostile name can't hide a change or print escapes.
- **T4.** `pickTier`: every step at each risk and size; judgement steps always `deep`; one tier up only; `--tier` can't lower a judgement step, and an override is logged.
- **T5.** `pickVerifier`: rung 2 with an alternate, rung 3 without, never the author's model on rung 2. An unknown author launch is refused.
- **T6.** The log line carries the role, step, tier, rung and model used. A role from the branch's work tree is ignored: only the trust root's count.
- **T7.** A `deep` model outside its family is shown in the output, and refused nowhere (D-58).

## Done when

- A reviewer that writes is refused and named. An author in scope is ok.
- A write outside the role's scope fails the run, including in an ignored file.
- A high-risk step launches one tier up.
- A same-model verifier is logged as rung 3.
- Each tier's real model passes the launch's check, or the difference is fixed.
- Row 19's "a nested launch is refused" is shown by 19a's `a-mirai-agent`, and the rest of the guard is named in 19c.

## Open points for you

1. **Roles as new data.** D-37 puts write scope in agent definitions, and there are none until unit 21. My recommendation: a small `roles` kind now, with agent definitions naming a role later. The other way is a `--scope` flag for now, which is simple but gets thrown away.
2. **The depth guard's one-time token (D-14).** Row 19 puts it here. My recommendation: **move it to 19c, with the broker that mints it.** With only your terminal as a way in, there's nothing to hold a token. Inside the sandbox, `a-mirai-agent` already shows a nested launch fails. And your own unsandboxed session could read any token held in the store (18e), so it would be a speed bump there, not a guard. 19c's spec should say that plainly.
3. **A write outside scope leaves its files.** My recommendation: yes, keep them. Silently reverting could lose evidence, and unit 22 owns reverting. Your tree stays dirty until you act, and the next launch refuses.
4. **No full red team here.** My recommendation: skip it if the bundle and hook don't change, and rerun it in 19c. This unit adds checks after a run, not a way in. If the review disagrees, I'll ask.
5. **Your first real launch.** You haven't run it yet, as far as I know. I recommend doing that before I build this. It's the first real gate and launch together, and if the result goes stale between the two, I'd rather fix it first. This doesn't block the spec.
6. **The cost:** about 11 short runs, 3 of them on Sonnet, Opus and Fable. I'll ask before each batch.

## Changes after testing and review

1. **Protected paths aren't out of scope for an author:** a lockfile or manifest is a legitimate change, made high risk at review (unit 24). `author` may write `**`; the cage still refuses `.git`, `.mirai`, `.env*` and the rest. T2 tests a project role and the core roles' names instead.
2. **Ignored files:** unit 12's fingerprint covers only ignored files under protected paths, so 19b has its own, a stat walk of every ignored file (about 0.5 s on the sample app), capped at 50,000 entries.
3. **Read-only roles have no Bash (R1),** so the check is a second layer there; for an author it's the only one inside the project.
4. **Fable wasn't probed (R3):** not a default tier model. Sonnet and Opus pass the launch's model check.
5. **Tokens:** cached input logged apart, as `tokens_cached` (your first run showed 156 tokens).
6. **Run-log schema 3:** `tier_reason`, `model_used`, `scope_violations`, `tokens_cached`.
7. **From the review:** ignored files are out of scope for every role unless its `may_write.ignored` lists them (the author's `**` covered them, so the check did nothing for the one role that writes); more than 50,000 ignored entries isn't ok; `!` excludes and broken globs are refused; the ignored files are fingerprinted right before the start, and the refusal says something else may have written them; the evidence goes in `agent-runs/<launch>.scope.json`; a launch with hidden tracked files is refused; a high-risk review is the step `review-high-risk`; a verifier runs at least at the author's tier, and ids differing by a date or suffix are the same model; `--verifies` only for a read-only role; `--step` checked; a model id is made safe for the log.
8. **Lowering `--tier` is refused for every step,** not only judgement steps: simpler, and a raise is the only override. Escalating a light step is unit 58's (the roadmap's), not 20's.
9. **Roles and the AGENT kind:** kept apart; unit 21 reconciles them (row 21), including `qa` writing E2E files.
10. **From the review of the fixes:** a refused run's ignored files are kept on record and refuse the next launch while any is still there (the next fingerprint would take them in); more than 200,000 ignored entries, an unreadable ignored folder, a sparse checkout refuse before the launch, not after; the evidence file holds only the paths, after the log line, pruned with its stream.
