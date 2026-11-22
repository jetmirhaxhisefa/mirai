---
unit: "38b"
name: naming
status: approved (Jet, 2026-11-22: "naming: yes", then "approve 38b"; built after 38 is merged, before 39 is finished)
roadmap: new, from unit 38's P2 finding ("merge request 16" printed for a GitHub pull request) and Jet's naming review (2026-11-22); D-37 (roles and agents as data); units 19b (roles), 21a/21b (Kai), 24a (Rex), 27b (hosts), 37 (overlays), 38 (docs publish)
depends_on: ["37", "38"]
---

# Unit 38b: Naming

## Why

Three names in MIRAI's output mislead today:

1. **The role `author`.** Kai (`mirai-developer`) runs under the role `author` when he builds. But
   the agent that authors documents is Nora (41), under her own role `product-manager`. So
   "author" reads as "writes documents", which it isn't. Units 39–42 add roles and name them next
   to this one, so the cheap moment to rename it is now.
2. **Personas without ids.** Output says "Kai's handover" or "Rex's review". The registry, the
   overlays and `mirai agent run` all use the id (`mirai-developer`). You have to know the
   mapping by heart. Soon there are five (Kai, Rex, Vera, Nora, Tess).
3. **One host word for two hosts.** `mirai docs publish` printed "merge request 16" for a GitHub
   pull request (38's P2). GitHub says "pull request #16"; GitLab says "merge request !16".

**Why now:** 39–42 build on role names and print agent names. After them, the rename touches
four more units.

## Decisions (Jet, 2026-11-22: "naming: yes")

1. **The role `author` becomes `developer`.** Same mode (read-write), same step (`build`), same
   write scope (`**`). Only the name changes.
2. **An agent is named "persona (id)" the first time a command's output names it**, then by the
   persona: "Rex (mirai-reviewer) reviewed SAMPLE-53 … Rex found 2 must-fix findings". One
   naming table in the docs lists them all.
3. **Output uses the host's word:** "pull request" and `#16` on GitHub; "merge request" and `!16`
   on GitLab. One helper decides.

### Choices in this draft (not yet Jet's; each can change at review)

- **The old name is refused, not mapped.** `role = "author"` anywhere a role is named (an agent
  overlay, `mirai agent run --role`, the broker's `start_agent`) is refused with: `the role
  "author" is now "developer" (MIRAI 38b): write role = "developer"`. A silent alias would keep
  both names alive. Checked: no committed project file names it (below), so nobody is broken.
- **A project role can't be called `author`** for now (`.mirai/custom/roles/author.toml` is
  refused with the same message), so the old name can't come back meaning something else.
- **A framework copy from before 38b is named as such.** A project's trust root still holding
  `roles/author.toml` and no `developer` gets: `this project's MIRAI copy is from before unit 38b
  (it has the role "author", now "developer"): run mirai init --refresh, and commit it`. This is
  the pattern 13c, 14d and 18a already use.
- **The error code `author-reviews` stays.** It names the rule (who wrote a change never reviews
  it), not the role. Codes are matched by tests and scripts.
- **The persona is data:** a new `persona = "Kai"` field in each `registry/agents/*.toml`.
  An overlay can't change it. The hard-coded `'Kai'`, `'Rex'` in `src/` go.
- **In the terminal, no backticks:** `Kai (mirai-developer)`. In Markdown output (the run report,
  the PR or MR description, documents) the id is in backticks: ``Kai (`mirai-developer`)``.
- **An unknown host says "merge request".** When MIRAI can't tell the host (no remote, the local
  store), output keeps today's word.
- **What stays as it is:** the command `mirai review-mr`, error codes (`mr-merged`, `no-mr`, …),
  journal events (`mr_opened`, `mr_merged`), JSON keys (`mr`), the step `mr-description` and
  the template file `mr-description.md`. They are contracts that records and scripts read. A
  `review-pr` alias is later work.
- **Docs keep "merge request"** as MIRAI's general term. `docs/README.md` gets one line: "On
  GitHub this is a pull request; MIRAI's output uses your host's word."
- **Finished units' specs and test results are history** and keep `author`. Approved, unbuilt
  specs (41, 42) are updated.

## Checked before writing

- **Who names `author` today** (on `main` and `origin/unit/38-build`):
  - registry: `registry/roles/author.toml`, and `registry/agents/mirai-developer.toml`
    (`role = "author"` and its comment);
  - src, 6 places: `src/agent/build.js:53` (`BUILD_ROLE`, used by `build.js` and `fix.js`) and its
    comment at `:46`; `src/agent/run.js:177` (the refusal text); `src/config/registry.js:44`
    (a hint: `for example "author"`); `src/mcp/tools/agents.js:36` and
    `src/cli/commands/agent.js:23` (the role lists in help); `src/redteam/cases-session.js:253`
    (a `../author` traversal case);
  - tests: 31 lines in 10 files (`test/agent/{run,scope,plan,build,review}.test.js`,
    `test/redteam/{moves,redteam}.test.js`, `test/documents/overlays.test.js`,
    `test/probes/{agent,build}-probes.js`);
  - docs: `docs/agents.md` (lines 20, 51, 54, 123, 129) and `docs/model-tiers.md:44`; the phrase
    "author agent" in `docs/agents.md:7`, `docs/documents.md:165` and `registry/README.md:20`;
  - approved specs: `41-nora/spec.md:194–196` and `42-tess/spec.md:254`. 39, 40, 43 and 44 don't
    name the role (40's "the author fixes" is plain English about the document's writer);
  - 38's branch adds no new reference. Every other "author" in `src/` is git's commit author
    (`author_name`, `GIT_AUTHOR_*`) and stays.
- **Committed project files:** the three installs on this Mac
  (`~/Projects/mirai-sample-app`, `mirai-sample-app-gitlab`, `thudos`) have no `.mirai/custom/roles/`
  and no overlay with a `role` line. Their only overlay is Rex's (`custom/agents/mirai-reviewer.toml`,
  tools only). Each has `.mirai/framework/registry/roles/author.toml` in its framework copy and in
  `mirai.lock`: MIRAI's own file, replaced by `mirai init --refresh`.
- **Approval records (37):** an overlay's hash covers its own file and its bound files
  (`overlayHash`, `src/config/overlays.js:625`), not the roles. Rex's signed approvals in both
  sample apps stay valid.
- **Red-team templates:** a widened agent's templates are named by agent and mode
  (`agentTemplateName(agent, mode)`), never by role. No name changes.
- **Run logs:** the `agent_run` line's `role` is any valid name (`src/store/run-log.js:44`), and
  nothing reads it back as `author`. Old lines keep `"role": "author"` as history; the run report
  names the agent first, so its text doesn't change.
- **Rendered agent files** (`.claude/agents/mirai-developer.md`) don't contain the role. They
  re-render only because the framework copy changes.

## Scope

**In**

1. **The rename:**
   - `registry/roles/author.toml` → `registry/roles/developer.toml` (`name = "developer"`,
     description and comment updated); `mirai-developer.toml` gets `role = "developer"`;
   - `BUILD_ROLE = 'developer'`; the role lists and the hint in the 4 help and schema strings;
     the red-team traversal case uses `../developer`;
   - `src/agent/run.js:177` says: `Kai (mirai-developer) never runs under the reviewer role: who
     writes a change never reviews it` (code `author-reviews` unchanged);
   - the 31 test lines move to `developer`.
2. **The old name refused** (the choices above): one table, `RENAMED_ROLES = { author:
   'developer' }`, read by `findRole` (`src/agent/scope.js`), the overlay check
   (`applyAgent`, `src/config/overlays.js`) and the custom roles' loader. Each gives the message
   with the new name. A trust root with `author` and no `developer` gets the refresh message.
3. **Personas:**
   - `persona` in the agent schema (`src/config/registry.js`): a capitalised word, required on
     MIRAI's agents, not settable by an overlay. Kai and Rex get it now; 40–42 add theirs;
   - **one helper, `src/agent/names.js`:** `agentNamer(registry, { markdown })` returns
     `who(id)`. The first call for an id gives "Kai (mirai-developer)"; later calls give "Kai".
     An id with no persona (a project's own agent) is shown as its id. One namer per command run,
     passed down with `watch`, so `mirai run` introduces Kai once and Rex once;
   - **the places that change** (27 in 16 files on `main`; 38 adds none):

     | File | What it prints |
     |---|---|
     | `src/agent/plan.js:237`, `src/agent/review.js:45` | `AGENT_LABEL`, the progress lines (`Kai: 3 turns, 2 min`) for plan, build, fix and review |
     | `src/agent/build.js:584, 644, 647` | "Kai stopped without a reason"; the recheck refusals |
     | `src/agent/fix.js:258` | "Kai disputes F-2 …" |
     | `src/agent/run.js:176, 177` | the reviewer refusals (today "id (persona)": turned round) |
     | `src/proofs/record.js:104, 146, 151` | "after Rex's review passes", "a proof needs Rex's pass", "since Rex reviewed it" |
     | `src/cli/commands/{plan,build,fix,review}.js` | the summaries ("Have Kai build …") and `build.js:49`, `review.js:48` |
     | `src/cli/commands/review-mr.js:45`, `approve.js:187`, `unpark.js:58, 66, 69` | Kai in hints and the dispute list |
     | `src/run/drive.js:107`, `src/review/packet.js:237`, `src/loop/park.js:19, 21` | Rex and Kai in stop reasons and park reasons |
     | `src/reports/run-report.js:41` | "Kai's build", "Rex's review" (Markdown: backticks) |

     A command's help summary is read alone, so each one uses the full form.
   - Not changed: the agents' own prompts (`src/agent/fix.js:82, 87` and `registry/agents/*.md`
     talk to the agent, not to you).
4. **The host's word:**
   - **one helper, `hostWords(name)`** in `src/ship/words.js`: for `github` `{ long: 'pull
     request', short: 'PR', ref: (n) => '#' + n }`; for `gitlab` `{ long: 'merge request', short:
     'MR', ref: (n) => '!' + n }`; for `null` the GitLab words. `wordsFor({ config, remoteUrl })`
     picks the name with `hostConfig` (no CLI needed) and returns `null`'s words when the host
     can't be told. A host object (`githubHost`, `gitlabHost`) carries its `words`;
   - pure code (`src/status/derive.js`, `src/reports/m1.js`, `src/reports/render.js`) takes
     `words` as an argument; the commands pass the project's;
   - **the places that change:** 62 lines in 19 files on `main` print "MR" or "merge request"
     to you (`src/ship/gitlab.js`'s 5 are GitLab-only and stay); 38's branch adds 16 more in
     `src/store/connectors/publish.js` (12), `src/store/connectors/state.js` (2) and
     `src/cli/commands/docs.js` (2, among them the "merge request 16" line). By file:

     | File | Lines |
     |---|---|
     | `src/status/derive.js` | 9 (the `why` texts: "MR open with valid proofs at its head"; 4 are internal input checks and stay) |
     | `src/review/merge.js` | 8 |
     | `src/reports/render.js` | 6 ("MR description", "an MR link looks like …") |
     | `src/ship/ship.js` | 5 |
     | `src/reports/run-report.js` | 4 ("MR #12 opened") |
     | `src/status/machines.js`, `src/review/packet.js`, `src/reports/m1.js`, `src/cli/commands/{run,review-mr,merge}.js` | 3 each |
     | `src/store/git.js`, `src/run/show.js`, `src/cli/commands/{ship,report}.js` | 2 each |
     | `src/store/journal.js`, `src/mcp/tools/commands.js`, `src/doctor/checks.js`, `src/cli/commands/show.js` | 1 each |

     For example: `ship.js` prints `PR #16: https://github.com/…/pull/16` on GitHub and
     `MR !16: https://gitlab.com/…/merge_requests/16` on GitLab; `docs publish` prints
     `pull request #16: …`.
   - `src/ship/host.js`'s GitHub errors already say "pull request"; they move to the helper too.
5. **Docs:**
   - `docs/agents.md` gets the naming table, near the top:

     | Persona | Agent id | Role | What it does | Unit |
     |---|---|---|---|---|
     | Kai | `mirai-developer` | `developer` (build), `planner` (plan) | plans a ticket, then builds it | 21a, 21b |
     | Rex | `mirai-reviewer` | `reviewer` | reviews a ticket's change, read-only | 24a |

     Vera (40), Nora (41) and Tess (42) each add their row when they're built;
   - the role table and Kai's section say `developer`; `docs/model-tiers.md:44` too;
   - "author agent" becomes "an agent that writes documents" (`docs/agents.md:7`,
     `docs/documents.md:165`, `registry/README.md:20`);
   - `docs/README.md` gets the host-word line (Decisions).
6. **Approved specs:** 41 (lines 194–196) and 42 (line 254) say "role `developer` (named `author`
   before 38b)".
7. **The roadmap:** a row 38b in `design/07-implementation-roadmap.md`, and a line in
   `implementation/PROGRESS.md` when it's done.

**Out**

- Renaming `mirai review-mr`, error codes, journal events, JSON keys and the `mr-description` step.
- Rewording "MR" across `docs/` and `design/` (one line in `docs/README.md` covers it).
- Persona names in agent prompts and skills.
- Refreshing the three installs: that's a step for you after the merge (Done when).

## Tests

- **T1 The rename:** the registry loads with `developer` and no `author`; Kai's definition
  validates under it; a build launch (fake Claude) logs `"role": "developer"`.
- **T2 The old name refused:** an agent overlay with `role = "author"`, `mirai agent run --role
  author`, and `.mirai/custom/roles/author.toml` are each refused with the message naming
  `developer`.
- **T3 An old framework copy:** a trust root with `roles/author.toml` and no `developer.toml`:
  a build launch is refused with the `mirai init --refresh` message.
- **T4 Old records still read:** a run log with an `agent_run` line saying `"role": "author"`
  validates, and the run report still says "Kai's build".
- **T5 37's approvals hold:** Rex's approved overlay (a fixture like the sample app's) is still
  `approved` after the rename; its hash is unchanged.
- **T6 Personas:** one `mirai run` with fake Claude prints "Kai (mirai-developer)" once, then "Kai";
  "Rex (mirai-reviewer)" once, then "Rex". The run report writes ``Kai (`mirai-developer`)``.
  An agent with no persona prints its id. An overlay with `persona` is refused.
- **T7 Host words:** `hostWords('github')`, `('gitlab')`, `(null)`; `ship`, `merge`, `show`,
  `docs publish` (fake hosts) print "pull request #16" on GitHub and "merge request !16" on GitLab.
- **T8 No stray word:** a source check: no user-facing string in `src/` outside `words.js` and
  `gitlab.js` says "merge request" or "MR" as a word; no string says `'Kai'` or `'Rex'` outside the
  registry.
- **T9 The docs check** (34b) passes, and the full suite passes.

## Probes (real)

- **P1 On the GitHub sample app, after the refresh:** `mirai init --refresh` (committed), then
  `mirai redteam` (needed anyway, below), then:
  - one short Kai launch on Haiku (`--step commit-message`, as 21b's R1). **Pass when** its run
    log line says `"role": "developer"` and the progress line starts "Kai (mirai-developer)";
  - `mirai docs publish` for 38's P2 initiative. **Pass when** it prints "pull request #N".

## Done when

- T1–T9 pass through the build runner and CI.
- P1 passes.
- **The red team is re-run.** `registry/roles/**`, `registry/agents/*.toml` and
  `src/agent/run.js` are in the cage (`src/redteam/cage.js`), so the pass in each project goes
  stale when its framework copy is refreshed. Done together with 38's refresh, it costs no extra
  run.
- The three installs are refreshed: `mirai-sample-app`, `mirai-sample-app-gitlab` and `thudos`
  (`thudos` is still on MIRAI 0.1.0).

## Checked against the queued units

- **39 (setup):** line 76's `AGENTS.md` sentence ("tickets, documents or merge requests") uses
  `hostWords`. Setup's own output names agents with the namer.
- **40 (Vera):** `mirai-verifier.toml` gets `persona = "Vera"`. Lines 97 and 100 ("Vera: N
  findings open", "Vera: passed") print "Vera (mirai-verifier)" the first time. She adds her row
  to the naming table.
- **41 (Nora):** lines 194–196 change (Scope 6). `mirai-product-manager.toml` gets
  `persona = "Nora"`; her table row; her output uses the namer.
- **42 (Tess):** line 254 changes (Scope 6). `mirai-ticket-planner.toml` gets `persona = "Tess"`;
  her table row.
- **43 (trace):** no change. Its P1 says "the merge request opens": on GitHub the output says
  "pull request".
- **44 (PRD workflow):** T9's text ("Vera: 2 findings open") gains the full form on first mention.
  Lines 104, 286 and 346 are prose about the docs merge request; the commands print the host's
  word.
