---
reviewer: software-architect
round: 3
scope: safety and state model only (R2-C1, R2-C4, R2-C5, R2-C7, R2-M4, R2-M5, R2-M6, R2-M11, R2-M12 lock marks)
read: design/06-review-round-2.md, _review/round-2-architect.md, 04 (D-03, D-05..D-07, D-12, D-15..D-18, D-21, D-24, D-28..D-30, D-33..D-37, D-42, D-45, D-47..D-52), 03 (all), 01 (§1, §3 step 7-8, §5-§17), 02 (a, b, c, e, f, g, h), 05 §G, 07 (all)
---

# Round 3: Architect review of the safety and state model

**Counts:** 3 Critical · 10 Major · 9 Minor (22 findings).

**Verdict:** the round-2 fixes moved the right things to the right places. The store, trust root
and key now sit outside the project; verdicts come from structured output; Ed25519 with a
committed public key and `pull_request_target` is the right CI model; E2E-before-review gives a
single proof. What's left is three kinds of problem:
- **Boundary seams:** places where the new outside home touches the project. These are `.git/`,
  the CLI called from inside a sandboxed session, and the files agents must read or write.
- **Local-only facts that CI needs:** the branch registry and handover.
- **One concept, two homes:** ticket status, the test baseline, hooks and approvals.

**Top 3:**
1. **AR3-1:** `.git/` is still writable from inside the agent's reach. D-30 only has an `Edit`
   permission deny and a `git config` command deny (`04:893-895`). The sandbox list doesn't name
   `.git` (`04:884-887`), and test containers mount "the project source" (`04:1415-1416`), which
   includes `.git/`. An agent, or agent-written test code in a container, can write
   `.git/config` (`core.fsmonitor`, `core.sshCommand`, `remote.*.url`, `include.path`) or
   `.git/hooks/*`. Your own `git status` in the morning, your IDE's git polling, or the
   orchestrator's `git push` then runs it **outside every sandbox**. Pinning two keys with `-c`
   (`04:414-416`) covers only the orchestrator, and only those two keys.
2. **AR3-2:** the design calls the MIRAI CLI from inside sandboxed Claude sessions:
   - workflow skills run `mirai agent run`, `mirai session start/end` and `mirai lint`/`trace`;
   - agents run `mirai log`;
   - supervised launches poll "a status file in the store".

   The store those calls must write is now `denyRead`/`denyWrite` for every sandboxed process
   and its children (`04:886-887`, `04:270-272`, `01:1399-1400`, `02:177`). Either the
   interactive/supervised flow can't work, or someone cuts a hole that reopens R2-C1.
3. **AR3-3:** the per-ticket work files agents must read or write have no reachable home:
   - the plan (Kai's "sole source of truth", which Kai also writes);
   - the review findings that a fix round feeds back;
   - Ivy's throwaway QA scripts.

   They all live in the store, which agents are denied (`01:625`, `01:696`, `01:960`,
   `01:1090`, `03:135`). And `run_tests(path)` only accepts work-tree paths (`04:1407-1408`).

**Round-2 Architect findings:** 8 closed, 10 partly closed, 3 still open (table at the end).

---

## Artifact homes: what the files say today

This is the check the round asked for: every artifact has exactly one home; committed vs local;
what CI can see. Rows marked ✗ are contested or missing, and each one points to a finding.

| Artifact | Home per the files | Committed | CI sees | Status |
|---|---|---|---|---|
| framework, `mirai.lock`, `config.toml`, `custom/`, `context/`, keys, records, approvals, pointers, docs, ticket content, E2E tests | project repo `.mirai/…`, `<docs_root>/…` | yes | yes | ✓ |
| state, journal, heartbeat, ledger, run lock, parked notes, metrics, reports, run logs, cache, `config.user.toml`, release record | MIRAI home (outside the project) | no | no | ✓ (release record also exported as a tag or host release) |
| private signing key | `~/.config/mirai/` | no | no | ✓ |
| launch tokens | MIRAI home or process memory (`04:322-323`, `07:165`) | no | no | ✓ |
| **ticket status** | frontmatter (`04:137-139`, `03:77`, `03:262`), "repo store" (`07:107`), *or* `<store>/tickets/<t>/status.json` (`01:1185-1188`, `02:492-494`) | contested | contested | ✗ AR3-7 |
| **plan, review findings fed back, QA scratch scripts** | the store (`01:1090`, `04:821`), but agents must read/write them | no | no | ✗ AR3-3 |
| **test baseline** | `.mirai/context/test-baseline.json` (`03:254`), "refreshed from `main` every run" (`04:1317-1320`), with no home for the refreshed copy | partly | stale copy | ✗ AR3-11 |
| **git hooks** | `<store>/hooks` (`04:415`, `03:270`) *or* `<trust-root>/hooks` (`01:247`, `01:834`, `07:157`); in workspace mode also "hooks" in the service repo (`03:292`) | no | n/a | ✗ AR3-20 |
| **branch registry, handover** | `branches.json` in the store (`03:79`, `04:1461-1464`) | no | **no**, but CI "uses the same scope" (`07:238`, `03:116`) | ✗ AR3-4 |
| **plan / unpark / handover / go-no-go signatures** | "signed" (`04:504-506`, `04:517`), home unstated; approvals folder is committed (`03:257`) | ? | ? | ✗ AR3-9 |
| `core.hooksPath` for *your* pushes | must be in `.git/config`, but unit 10 says "nothing MIRAI controls is written under `.git/`" (`07:153`) | n/a | n/a | ✗ AR3-1 |
| `.env.test` | project root (`03:259`); committed or ignored isn't said; the trust-root copy is what `run_tests` uses (`04:1413`) | ? | needed by the test job | ✗ AR3-11 (minor note) |

---

## Critical

### AR3-1 · Critical · `.git/` stays writable through Bash and test containers, so agent code runs unsandboxed through git

**Where:**
- `04:884-887`: D-30 #4 sandbox: explicit `denyRead`/`denyWrite` only on the store and
  `~/.config/mirai`. `.git` isn't named.
- `04:893-895`: D-30 #5: `Edit` of `.git/**` and `Bash(git config *)` are **permission** rules.
- `01:259` and `01:804` say "`.git/**` gets `denyWrite`" in the sandbox, and `02:351` agrees.
  But D-30 (the normative list), `03:117` and `07:156` (unit 13) don't.
- `04:1415-1416`, `01:817-818`, `07:105`, `07:157`: containers may mount "the project source",
  which includes `.git/`.
- `04:414-416`, `01:247-248`: "host git runs with `-c core.hooksPath=… -c core.fsmonitor=false`,
  so nothing in `.git/config` can switch them off". That's true only for the orchestrator's own
  git calls, and only for those two keys.
- `07:153`: "nothing MIRAI controls is written under `.git/`".

**Problem:**
- **Permission denies don't cover shell writes.** `D-30` itself says the sandbox is "the only
  layer that covers child processes, … `sh -c`" (`04:889-890`). So
  `printf '[core]\n fsmonitor = ./x.sh\n' >> .git/config`, or a write into `.git/hooks/`, is
  blocked only if the sandbox write rules name `.git`. The normative decision doesn't say so.
- **Test containers are a second, separate route.** Even with a perfect sandbox, agent-written
  test code runs as root in a container that mounts the repo root with `.git/` read-write.
  `run_tests` validation checks for "no host mounts except the project source", which allows
  exactly this mount.
- **Whoever runs git next runs the payload, outside every sandbox:**
  - **You:** `git status` in your terminal, or VS Code/JetBrains git polling (`core.fsmonitor`,
    `core.pager`, `diff.external`, `.git/hooks/post-checkout`). This happens every morning, on
    the single checkout the run left on a MIRAI branch (`04:732`).
  - **The orchestrator:** `-c` pins two keys. It doesn't pin `core.sshCommand`,
    `credential.helper`, `remote.origin.pushurl`, `url.*.insteadOf`, `include.path`,
    `gpg.program` (if commit signing is on), or `filter.*` drivers referenced from an
    agent-written `.gitattributes`. `git push` with the orchestrator's credentials can then go
    to another remote, which exfiltrates the repo past the "no route out" claim (`01:836-840`),
    or run a command.
  - **The proof hash:** `git diff` honours `diff.*` drivers and `diff.orderFile` from
    `.git/config` unless they're pinned (see AR3-6).
- **Your own pushes skip the hooks.** If MIRAI writes nothing under `.git/` (`07:153`), your own
  `git push` (after `handover`, or by hand) never runs the `pre-push` hook. Only the
  orchestrator passes `-c core.hooksPath`.
- **The write-scope check depends on this deny.** It "covers the work tree" because `.git/**`
  writes are "denied up front" (`04:276-278`), so it doesn't see `.git/` changes.

**Fix:**
1. **D-30 #4:** add sandbox `denyWrite` on `<project>/.git/**`. Name it in `03:117` and unit 13,
   and add red-team cases for a *Bash* write to `.git/config` and to `.git/hooks/x` (not only
   `git config core.hooksPath`).
2. **D-48 #3:** the project-source mount must **mask `.git`**. Options are a read-only bind of
   `.git`, or an empty tmpfs/volume over `<mount>/.git`. Validation refuses any mount whose
   source contains `.git` read-write. Add it to unit 14's "Done when".
3. **Git config integrity:**
   - setup records a hash of `.git/config` and the listing of `.git/hooks/`;
   - the orchestrator re-checks both before every git call and after every agent run or
     `run_tests` call, and a mismatch stops the run;
   - the orchestrator runs git with `GIT_CONFIG_NOSYSTEM=1`, a fixed `GIT_CONFIG_GLOBAL`, and
     `-c` pins for `core.hooksPath`, `core.fsmonitor=false`, `core.sshCommand`,
     `credential.helper`, `core.pager=cat`, `diff.external=` and `protocol.ext.allow=never`;
   - push uses an explicit URL, not `remote.origin.*`.
4. **Set `core.hooksPath` in `.git/config` at install.** It's written by `init`, owned by you,
   and checked by the integrity hash. Fix the wording of `07:153` to "nothing *agent-reachable*".
5. **End every run on the integration branch** with a clean tree, so the checkout you open in
   the morning isn't a MIRAI branch (see AR3-12).

### AR3-2 · Critical · The CLI calls made from inside sandboxed sessions can't reach the store, or reopen R2-C1

**Where:**
- `04:886-887`: the store is sandbox `denyRead`/`denyWrite`. The sandbox covers "every process
  [shell commands] start" (`01:804`).
- `04:259-261`, `04:270-272`: interactive authoring runs in your Claude session. Supervised
  launches are "detach-and-wait … the session polls a status file in the store".
- `04:321-323`: `mirai agent run` needs a token "from the orchestrator store or your
  `mirai session`".
- `01:1399-1400`, `04:519-520`: "Agents call `mirai log …`".
- `02:177`: "workflow skill calls → CLI". `03:105`: interactive `.claude/settings.json` has
  "sandbox on, deny rules".
- `04:1422-1423`: the sandbox has **no `excludedCommands`**, on purpose.

**Problem:**
- **Every CLI call from inside a sandboxed session inherits the sandbox.** That covers
  `mirai agent run` started by a workflow skill, `mirai session start/end`, `mirai log`,
  `mirai lint` and `trace` (which read QA evidence in the store), and the polling loop. All of
  them run inside Claude Code's Seatbelt profile. So the launcher can't write the store,
  re-hash the trust root or capture the verdict. It also starts `claude -p` *inside* the parent
  sandbox (nested Seatbelt; whether it even starts is UNVERIFIED).
- **Two outcomes, both bad:**
  - **(a)** The interactive bundle denies the store, as the headless one does. Then the
    supervised document flow (Milestone B) and supervised launches (Milestone A, unit 17
    "detach-and-wait") don't work.
  - **(b)** The interactive bundle *doesn't* deny the store. Then Nora, Arlo, Tess or any
    interactive agent with Bash can read launch tokens and rewrite counters. That's R2-C1 again,
    during the day. The implementer then either drops the deny or adds an `excludedCommands`
    entry for `mirai`, which D-48 removed for good reason (shell bypasses, TL2-2).
- **D-17 assumes the opposite.** "`mirai log` refuses privileged types" assumes an agent *can*
  call `mirai log` and that the CLI is the guard. Under the new model, the sandbox blocks the
  call before the CLI's own check ever runs.

**Fix:** define a **single trusted channel** from a sandboxed session to MIRAI, the same way
`run_tests` was done:
1. **A MIRAI MCP server from the trust root** (it runs outside the sandbox, like `run_tests`)
   exposes only narrow verbs:
   - `log_event(type ∈ {template_gap, note, …})`: privileged types aren't in the enum;
   - `start_agent(role, item)` and `agent_status(id)`, for workflow skills in your session. The
     launch token is minted and consumed inside the server and never shown to the session;
   - `session_start` / `session_end`;
   - `lint(doc)` and `trace(item)`, read-only.
2. **The plain `mirai` binary** is for your terminal and the orchestrator only. State in D-30
   that **no sandboxed process calls `mirai`**, and add a red-team case: `mirai agent run` from
   Bash must fail.
3. **The interactive bundle denies the store exactly like the headless one** (option a), so the
   daytime flow uses only the MCP verbs.
4. **The headless `mcp.json`** gets only `run_tests` and `log_event`. Never `start_agent`: the
   recursion guard holds by construction.
5. **Update D-12, D-17, `01` §17, `02` (c) and unit 17.** Add a §G item: a nested `claude -p`
   started by an MCP server outside the sandbox gets its own fresh sandbox.

### AR3-3 · Critical · The files agents must read or write have no reachable home

**Where:**
- **The plan:** "Output: `<ticket>-plan.md`" (`01:625`). Kai's input is "the plan file (sole
  source of truth)" (`01:696-697`). Kai "may write … plan" (`03:135`). The plan has
  agent-owned, append-only sections (`01:633-638`). Plans are never committed and live in the
  store (`04:821`, `01:1341`).
- **The commit points include "plan"** (`04:1458-1459`), but plans aren't committed, so this
  contradicts D-29.
- **Review inputs:** Rex gets "the plan's claims, **as file paths, never pasted**" (`01:960`).
- **Fix rounds:** the developer answers each finding `fixed | disputed` (`01:982`). The findings
  live in the store (`01:961`).
- **QA scripts:** Ivy writes throwaway scripts "into a scratch folder **in the store**" and runs
  them with `run_tests(level: "qa-explore", path)` (`01:1089-1091`). But `path` is "checked
  against the work tree (no `..`, no absolute paths)" (`04:1407-1408`). `run_tests` returns
  "screenshots and output paths in the store" (`04:1411`), which Ivy can't open to judge.

**Problem:**
- Every option the files leave open is wrong:
  - **Store:** agents are denied it, so Kai, Rex and Ivy can't read or write it.
  - **The work tree, untracked or gitignored:** that's the AR2-10 hole round 2 closed. These
    files would be agent-writable, invisible to `git diff`, and trusted. The human-owned frozen
    block of the plan could be edited between launches, and the pre-step guard's "clean tree"
    (`01:641-642`) fails on the next step.
  - **The work tree, committed:** that contradicts Q9/D-29 and puts work files into MRs.
- **The core loop depends on this.** Plan → build → review → fix is the loop every ticket runs,
  so the question has to be answered before unit 19, not left to the implementer.

**Fix:** write a "work-file exchange" rule into D-29 and D-12:
1. **Inputs are injected, never shared.** The launcher renders a per-launch **read-only input
   folder** outside the project and allows it with sandbox `allowRead` for that launch only:
   - the plan (frozen block plus agent sections);
   - the delta diff;
   - the findings for this round;
   - the ACs.

   Rex's "file paths" point there. It's deleted after the run.
2. **Outputs come back as structured output only.** That covers the plan's agent sections,
   finding replies (`fixed | disputed`), `template_gap`, and Ivy's QA table. The CLI writes them
   into the store and re-checks the frozen-block hash on every write.
3. **QA scratch scripts are passed to `run_tests` as content** (`run_tests(level:
   "qa-explore", script: <text>)`), not as a path. `run_tests` returns evidence *inline*
   (images as MCP image content, text capped) as well as storing it.
4. **Fix the commit points** at `04:1458-1459`. "plan" isn't a commit point. The commits are:
   stub, tests, build, fix round, E2E.
5. **Add to the red-team list:** an agent edits the frozen block (detected). An agent writes a
   file outside its scope into the input folder (denied).

---

## Major

### AR3-4 · Major · CI can't see the branch registry or handover, so "fails closed" is local-only and handover is blocked by CI

**Where:**
- `03:79` and `04:1461-1462`: the registry is `branches.json` in the store.
- `04:434-438`, `01:1142-1146`: registered → gated; registered without the trailer → blocked;
  handover → "unregistered, gates off".
- `03:116`: CI is "Scoped like the hooks". `07:238` (unit 52): "Both use the same fail-closed
  trailer/registration scope".
- `07:182`: "an unregistered branch **with no MIRAI commits** (a human branch) is untouched".
  An unregistered branch *with* MIRAI commits is undefined.

**Problem:**
- **CI only has git.** It can't read `branches.json`. So in CI the scope can only be the
  trailer, which is exactly the fail-open rule R2-M4 removed. A registered branch whose commits
  lack the trailer passes CI as a "human branch". That can happen through a GitHub "Update
  branch" merge commit, a suggestion commit made in the MR UI, or your own commit. CI fails
  open, and `pre-push` (skippable with `--no-verify`, and absent on any other clone) is the
  only closed gate.
- **Handover breaks the other way.** After `mirai handover` the branch still carries
  trailer-marked commits. CI sees MIRAI commits plus your new, unproven change, and blocks the
  MR. The handover has no effect where it matters, which pushes you toward disabling the check.
- **D-52 (one machine) doesn't save this.** The GitHub UI is a second writer too.

**Fix:** make scope a **branch-carried, signed fact:**
1. **Registration record.** When MIRAI creates a branch, its first commit adds
   `.mirai/records/<ticket>/branch.json`, signed, with `{ticket, branch, base_sha}`.
2. **CI scope.**
   - A PR is MIRAI-scoped if any commit in range has the trailer **or** a valid `branch.json`
     exists.
   - In scope, every non-merge commit must carry the trailer, and a valid proof must match.
   - Merge commits made by the host are allowed only if their tree equals a rebase of the
     proofed diff. Simpler: refuse them and let the orchestrator rebase.
3. **Handover record.** `mirai handover` commits a signed `handover.json` `{ticket, at_sha}`.
   For a handed-over branch, CI checks only the secret scan, and the MR line becomes "MIRAI
   review covers up to `<at_sha>`".
4. **The local registry stays** as the orchestrator's index. It's keyed by `(branch,
   creation_sha)` and cleared on merge or delete, so a reused branch name isn't blocked forever.
5. **Update** D-15, D-50, `01` §11, unit 23, unit 24 and unit 52. Add "an unregistered branch
   with MIRAI commits" to the rules.

### AR3-5 · Major · Stacked MRs: CI anchors on the agent-written parent, and merging a child into its parent is allowed

**Where:**
- `04:402-404`, `04:740-741`, `01:662-663`: the trust root and lock come from `main` (local
  only).
- `04:418-421`, `04:512-513`, `01:1157-1161`: `mirai-verify` uses "the **base** branch's
  workflow" and "public keys from the **base** commit". For stacked MR B, the base is **A's
  branch** (`01:656-657`, `02:114`).
- `01:1372`: "Merge (into `main`, `feature/<epic>` **or a stacked parent**): human".

**Problem:**
- **CI trusts the parent.** `pull_request_target` runs the workflow file from B's base ref,
  which is A's unmerged, agent-written branch. In supervised mode A may touch protected paths
  (workflow, `.mirai/keys/`, `mirai.lock`) as `high` risk. So B's CI check runs A's workflow
  and trusts A's keys and lock. That's the AR2-9 hole, fixed locally but not in CI.
  "A PR can't add its own key" (`04:513`) doesn't hold one level down.
- **Merging a child into its parent breaks both.** If you merge B's MR into A, which is listed
  as allowed:
  - A's code hash changes. A's proof no longer matches, so A's MR blocks.
  - B is neither `built` (MR closed), `integrated` nor `done`, so C (`after: [B]`) is stuck.

  That's the AR2-8 deadlock again, for stacks.

**Fix:**
1. **A stacked MR is never merged into its parent.** Your merge targets are `main` or
   `feature/<epic>`, and B is merged only after the orchestrator retargets it. Change `01:1372`
   and D-22. `mirai inbox` and the MR description say "do not merge until retargeted".
2. **CI on a stacked MR is advisory.** `mirai-verify` finds the **stack root** through the
   GitHub API: the first ancestor PR base that is `main` or `feature/*`. It verifies against
   that root's keys and lock, from a checkout of the root, not the base ref. Because the
   workflow file itself still comes from A, the check that *counts* is the run after B is
   retargeted to the root. Required checks are set only on `main` and `feature/*` (that's where
   the merge happens).
3. **Write this into** D-15 #4, D-24 and unit 52's "Done when". Add a red-team case: a stacked
   parent edits the workflow, and the child's verify still uses `main`'s rules.

### AR3-6 · Major · The code hash isn't stable under a rebase, so "a clean rebase keeps the review" mostly won't hold

**Where:**
- `04:474-475`, `01:1004-1011`: SHA-256 over `git diff --binary <merge-base>..head -- <code
  paths>`.
- `04:481-482`, `02:128-130`, `07:180`, `07:237`: a clean rebase keeps the proof; the stacked
  child's review survives the parent's merge.
- `05:158` (G14): stability across git config, still to test.

**Problem:**
- **`--binary` implies `--full-index`.** Every file header carries
  `index <pre-blob-sha>..<post-blob-sha>`, and every hunk carries `@@ -l,n +l,n @@` line
  numbers. So the hash changes whenever **anything else** in a touched file changed on the new
  base, even with an identical hunk. This happens when:
  - main moved between B's start and its rebase;
  - A's fix round touched the same file;
  - a sibling ticket in the epic edited the same module.
- **The cost lands on the economic case.** D-24 is "affordable" because of this claim
  (`04:482`), and re-reviews on rebases will eat into it.
- **Unpinned options change the output.** The diff output also depends on settings that aren't
  pinned: `diff.renames` (rename detection is on by default), `diff.algorithm`, `diff.context`,
  `diff.orderFile`, `diff.noprefix`/`mnemonicPrefix`, `core.quotePath`, external diff and
  textconv drivers. Local git and the CI runner will differ. G14 names the risk but no fix is
  designed.

**Fix:** define the hash over a **normalized patch**, not raw `git diff` output. Write it into
D-16 and unit 22:
1. Run `git -c core.quotePath=true diff --binary --no-ext-diff --no-textconv --no-renames
   --no-color -U3 --src-prefix=a/ --dst-prefix=b/ <base>..<head> -- <paths>` with
   `GIT_CONFIG_NOSYSTEM=1` and an empty global config.
2. Normalize the output:
   - drop the `index …` lines;
   - replace hunk headers with `@@`;
   - sort the file sections by path.

   Whitespace, mode changes and binary content (the binary patch body) still count, so the
   round-2 reason for dropping `patch-id --stable` stays covered.
3. Test cases in unit 22:
   - main moves inside a touched file (keeps the proof);
   - a context line changes (fails);
   - mode-only and binary-only changes (fail).
4. If you'd rather keep the raw diff, change the claims at `04:481-482`, `02:128-130` and unit
   51 to "survives only when no touched file changed on the new base", and budget the
   re-reviews.

### AR3-7 · Major · Ticket status has four homes, and the precedence rule makes `built` unreachable

**Where:**
- **Frontmatter for approved states:** D-06 #3 (`04:136-139`): `draft`, `ready-for-dev` and
  `dropped` are in "the ticket file's frontmatter". Also `03:77` and `03:262` ("tickets/<id>.md
  frontmatter holds the approved ticket states").
- **"Repo store":** unit 04 (`07:107`): "One status file per ticket **in the repo store**" (the
  connector name for markdown in the repo, `03:228`), and "frontmatter is the current state …
  a frontmatter/log mismatch is an error".
- **The orchestrator store:** `01:1185-1188` ("Ticket status is **not** in the ticket's
  frontmatter … `<store>/tickets/<ticket>/status.json`") and `02:492-494`.
- **A generic rule that ignores tickets:** D-07 (`04:181-182`): "Frontmatter is the current
  state … a mismatch is an error". Only `01:412-414` limits this to documents.
- **The tracker as status home** (`04:138`, `01:1187-1188`) vs "tracker status is advisory"
  (`04:1095-1097`, `02:455-458`).
- **The precedence rule:** `01:1196-1198`, `02:494`: "a written state … with a later sequence
  number beats the derived one; `built`/`integrated`/`done` apply only when no later written
  state exists".

**Problem:**
- **Four places hold the same field.** A unit 04 implementer gets three answers. Writing
  `dropped`/`ready-for-dev` into frontmatter after the docs MR merged needs a commit to `main`,
  which needs another docs MR. Meanwhile `pre-commit` would check frontmatter status changes
  that §12 says never happen.
- **Derived states never win.** They have no sequence number, so "later" is undefined. Read
  literally:
  - every ticket that ever had a written `in-review` stays `in-review` after its MR opens, so
    `built` is unreachable;
  - a `blocked` ticket whose MR you merge anyway stays `blocked` instead of `done`;
  - a `waiting` written state beats `done`.
- **Gates run on advisory data.** With a tracker, the tracker as the home for `ready-for-dev`
  conflicts with "tracker status is advisory".

**Fix:**
1. **One rule, written once in D-06 and copied verbatim** into D-07, `01` §12, `02` (h), `03`
   (glossary, layout, status model) and unit 04:
   - ticket **content** plus its signed approval are committed;
   - **all** ticket status lives in `<store>/tickets/<t>/status.json`;
   - `dropped` is a signed human event in the store journal;
   - frontmatter has no `status` field for tickets (the lint enforces it);
   - D-07's "frontmatter is current" applies to documents only.
2. **Derived facts become timestamped observations.** The orchestrator logs `mr_opened(head)`,
   `mr_merged(target)` and `mr_closed` as journal events with a `seq` when it sees them.
3. **Precedence becomes a fixed order:**
   - merged into `main` → `done`, and merged into `feature/<epic>` → `integrated`, always win
     (terminal);
   - otherwise the latest event by `seq` wins;
   - `built` holds only while the open MR's head equals the head the orchestrator shipped.
4. **Tracker:** the store stays the authority for workflow status, and the tracker is a one-way
   mirror (AR2-16's rule). Change `04:138` and `01:1187-1188`.

### AR3-8 · Major · "main" is hard-coded, but the pilot runs on `mirai/pilot`

**Where:**
- `04:792`: D-28: "The pilot branch is `mirai/pilot`, cut from `main`". `07:41-42`: MIRAI is
  installed on `mirai/pilot`.
- `04:402-404`: the trust root is "always `main`".
- `04:141-144`: `done` = merged into `main`; documents reach `main`.
- `01:653-655`: tickets branch from `main`.
- `01:665`: `rebase --onto main`. `02:301`: "read `mirai.lock` on main".
- No `integration_branch` / `base_branch` key appears anywhere (grep).

**Problem:**
- On the pilot, `main` has no `.mirai/`: no framework, config, keys or lock. So:
  - the trust root "from `main`" is empty;
  - ticket branches cut from `main` have no MIRAI;
  - the docs MR targets a branch without MIRAI;
  - `done` (merged into `main`) never happens for pilot tickets that merge into `mirai/pilot`.
- The pilot starts right after Milestone A (U1), so this is the first real install, not an
  edge case.

**Fix:**
- Add `[git] integration_branch` (default: the host's default branch; the pilot uses
  `mirai/pilot`).
- Replace "main" with "the integration branch" in D-06, D-15, D-16, D-24, D-33, `01` §6/§11/§12,
  `02` (a, b, e, h), `03` glossary and units 12, 22, 24, 51 and 52.
- `doctor` checks that the integration branch has `.mirai/mirai.lock` and the CI workflow.
- `pull_request_target` already uses the PR's base ref, so CI works once MRs target
  `mirai/pilot`. Add that to G11.

### AR3-9 · Major · Docs MRs and approvals have no write path in a single, switched checkout

**Where:**
- `04:143-144`, `01:387-391`: documents and signed approvals are committed on
  `docs/<initiative>`; one docs MR is opened at the ticket-set gate.
- `04:1457-1460`: the orchestrator is the only committer, at fixed build points. None of them is
  a document point.
- `03:115`: `pre-push` needs "a patch-id review … record for the current change". A docs branch
  has an empty code-path diff (`04:476-477` excludes `<docs_root>/**` and `.mirai/**`).
- `04:504-506`, `04:517`: `unpark`, `handover`, the go/no-go and the plan approval are "signed",
  but their home isn't stated. `03:257`: `approvals/` is committed.
- `01:1305`: "one `mirai run` at a time per repo". `04:732`: one checkout with branch switching.

**Problem:**
- **Nobody commits documents.** Nora writes them in your session, agents can't commit, and the
  orchestrator has no document commit point. If you commit by hand on a registered docs branch,
  the commit has no trailer and is blocked (AR3-4). If the docs branch isn't registered, nothing
  gates it.
- **The docs-MR gate isn't defined.** Is it registered? Does `pre-push` need a proof for an
  empty code hash? What does `mirai-verify` check? It should re-hash every approved document
  against its signed `content_sha256`, using the base keys.
- **Approvals land on whatever branch is checked out.** `mirai approve` writes
  `.mirai/approvals/…` into the work tree of the current branch. If the overnight run, or a
  supervised run, has the checkout on ticket branch X, the PRD approval lands on X, not on the
  docs branch. A daytime `mirai session` on the docs branch while a run switches branches has
  the same problem: the run lock doesn't cover sessions.
- **Plan, unpark, handover and go/no-go signatures have no home.** It's unclear whether they're
  committed and with what. If they're store-only, a signature verified on the same machine that
  holds the key adds little. That's fine, but say so. The real protection is the store deny.

**Fix:** add a "write paths" table to D-06:
- **Documents:** the CLI (`mirai approve`, `mirai session end`) commits on the docs branch with
  a `Mirai-Docs: <initiative>` trailer, using `git commit` against that branch's index through a
  temporary worktree or `git commit-tree`. It never switches your checkout.
- **Docs branches** are registered. Their gate is: every changed document under `<docs_root>`
  has a matching signed approval of its exact content hash, and the code-path diff is empty
  (otherwise the push is refused).
- **`mirai-verify` for docs MRs:** verify the approval signatures with the base keys, re-hash
  the documents, and require an empty code-path diff.
- **Approvals of plans, unpark, round grants, handover and go/no-go** are journal events in the
  store, signed for audit only. Exception: handover gets a committed record (AR3-4). Say so in
  D-17.
- **The checkout lock** covers `mirai run` and `mirai session`. A session refuses to start while
  a run holds the checkout, and the reverse.

### AR3-10 · Major · Signing-key lifecycle: bootstrap, adding a key, revocation

**Where:**
- `04:507-513`: private key per machine, public key committed, reaching `main` "through a docs
  MR you merge"; CI checks "with the public keys from the base commit … a PR can't add its own
  key".
- `04:529`, `04:1493`: a second machine adds its own key pair.
- `03:255`: `.mirai/keys/<machine>.pub`.
- `04:893-894`: no `Edit` deny on `.mirai/keys/`. `.mirai/**` is only a protected path, which
  forces `high` risk but lets the change through in supervised mode (`04:405-407`).

**Problem:**
- **Bootstrap.** The first docs MR carries both the first key and approvals signed by it. CI
  verifies with the *base* keys, where there are none yet, so the very first docs MR fails
  `mirai-verify`. The second-machine case fails the same way.
- **Adding a key is a trust-root change with no special handling.** A ticket diff that adds a
  `.pub` (an agent can generate an Ed25519 pair in the sandbox with `node:crypto`) is just
  "high risk". If you merge it among other changes, every later forged proof verifies in CI
  forever. The "can't add its own key" guarantee lasts one MR.
- **No revocation.** A lost machine leaves its key trusted.
- **Workspace mode copies the problem.** Every service lock pins the workspace's keys (D-51),
  so a rotation touches N repos.

**Fix:**
1. **Key changes go only through a "key MR".** The CLI generates it (`mirai key add|revoke`)
   and it changes only `.mirai/keys/`.
   - `mirai-verify` refuses key changes in any other MR, and refuses any MR with a trailer that
     touches `.mirai/keys/`.
   - The key MR itself passes `mirai-verify` by a self-signature check plus a label you set.
   - The bootstrap key lands in the `init` commit, which you push by hand.
2. **Deny agents `Edit`/sandbox writes to `.mirai/keys/`** and `.mirai/records/` (the sandbox
   too, not just `Edit`; see AR3-1). Red-team: an agent writes a `.pub`.
3. **Revocation:** `keys/<machine>.revoked` with a date. Proofs signed after that date fail.
   `doctor` lists the active keys and their fingerprints.
4. **D-51:** service locks pin a key *fingerprint set* updated by `mirai update`. Rotation is
   one command across the repos.

### AR3-11 · Major · The test baseline has two homes, and CI uses the stale one

**Where:**
- `03:254`: `.mirai/context/test-baseline.json`, committed, and a protected path
  (`04:405-408`).
- `04:1317-1320`, `01:225-228`, `07:182`: "refreshed from `main` at the start of every run …
  Only that refresh moves the baseline".
- `01:1156-1163`: CI's test job re-runs the quality gate ("nothing new broke") on `head.sha`.
- `04:1436-1440`, `03:259`: `.env.test`; whether it's committed isn't said.

**Problem:**
- **The refresh has nowhere to go.**
  - Writing it to the committed file on `main` breaks "nothing commits to `main` without your
    merge".
  - Writing it on the ticket branch touches a protected path, so every ticket is `high` risk.
  - Writing it to the store gives two baselines: local `pre-push` gates against the fresh one,
    CI against the setup-time file.

  A test that started failing on `main` after setup then blocks every CI run but no local push.
  The reverse also happens: a test fixed on `main` and broken again is "known" in CI. That's
  AR2-28's ratchet issue, still open.
- **CI's test job needs `.env.test`.** If it isn't committed, CI has no dummy secrets.

**Fix:**
- **The baseline home is the store** (`<store>/baseline/<main-sha>.json`), recomputed per
  integration-branch SHA and cached.
- **CI computes its own baseline** by running the gate on the merge-base, or reuses a cached
  artifact keyed by base SHA. Both sides then compare against the same base, and the committed
  file becomes a setup-time *report*, not a gate input.
- **The known-failure list may only shrink** automatically, as AR2-28 asked.
- **State that `.env.test` is committed** (it holds fake values only) and that it's a
  protected path.

### AR3-12 · Major · Agent-written config that runs on its own fires outside the sandbox when you open the branch

**Where:**
- `04:405-412`: the protected-path list covers `.mirai/**`, tool dirs, CI, git hooks, lint/test
  configs, compose, Docker, `.env*` and `CLAUDE.md`/`AGENTS.md`.
- `04:732`: one checkout, switched by the run.
- `03:105`: your interactive Claude Code loads the project `.claude/settings.json` and
  `.mcp.json`.

**Problem:**
- D7's model is "agent-written code never runs on the host" (`04:871`). But several files run
  **without you choosing to run code**, as soon as you check out or open the branch:
  - `.claude/settings.json` hooks and `.mcp.json` servers (when you start Claude interactively
    on that branch, outside any sandbox);
  - `.vscode/tasks.json` with `runOn: folderOpen`, and `.vscode/settings.json` tool paths;
  - `.envrc` (direnv), `.devcontainer/`;
  - `.husky/` and `package.json` `prepare`/`postinstall` scripts (on your next `npm install`);
  - `.git/hooks` (AR3-1).
- `.claude/` is protected, but in supervised mode protected only means `high` risk, which still
  goes through. The others aren't protected at all.
- The run also leaves your checkout on its last MIRAI branch.

**Fix:**
- Add `.vscode/**`, `.idea/**`, `.envrc`, `.devcontainer/**`, `.husky/**`, `.mcp.json` and
  `package.json` lifecycle-script changes to the protected paths.
- For these "auto-exec" paths, **park in both presets**. You review them on the host before you
  check the branch out.
- The run ends with the checkout on the integration branch (AR3-1 fix 5).
- The morning report lists any MR touching auto-exec paths at the top.

### AR3-13 · Major · Lock marks: `framework | project` can't describe generated or mixed files

**Where:**
- `04:1107-1109`, `04:636-638`, `03:102-103`: every file is marked `framework` or `project`;
  `update` leaves `project` files untouched; `contribute` takes `framework` only.
- `04:637`: "the `AGENTS.md` managed block's project part". That's one file holding two marks.
- `02:309`: update "regenerate[s] tool files". `03:80`, `04:656-658`: the `.claude/` files are
  rendered from framework *plus* `custom/` overlays.

**Problem:**
- **Rendered tool files fit neither mark.** `.claude/skills/…` and `.claude/settings.json`,
  rendered from framework plus overlays, aren't really either:
  - marked `framework`, `contribute` would carry rendered project overlays upstream (a leak
    path);
  - marked `project`, `update` never regenerates them (a stale-render path).
- **A per-file mark can't express a mixed file.** `AGENTS.md` (framework block plus project
  lines) is one file, so it can't be both.
- **The trust root's "generated tool files" are ambiguous.** It's unclear whether they're
  inputs (snapshotted from base) or outputs (rendered from the trust root). Unit 11's "the
  interactive and headless bundles have the same content hash" (`07:154`) can't hold: the
  interactive one uses `ask` and the headless one uses `deny` (`04:899-901`).

**Fix:**
- Four marks, as in AR2-17: `framework` (copied, 3-way merged, contributable),
  `generated` (re-rendered on every `update`/`config apply`, never contributed, never edited by
  hand, `doctor` flags drift), `project` (yours, untouched), `local-addition` (after
  `promote`).
- `AGENTS.md` is `generated` from a framework block plus a `project` source file
  (`.mirai/context/agents-local.md`).
- The trust root renders the generated files itself from framework + config + custom.
  Committed generated files are never inputs to a headless run.
- Unit 11 compares the hash of the **shared part** (skills, agents, prompts); the permission
  modes legitimately differ.

---

## Minor

### AR3-14 · Minor · The release machine still disagrees across files

- `04:172` (D-07), `01:1263` and `07:257` say `pending → [staging → verified] → approved →
  deployed → live | rolled-back`.
- `02:540-551` (the diagram) has **no `pending`**: `[*] → staging` / `[*] → approved`.
- `03:77` says "a release machine that **starts at `deployed`**". `03:204` says "release record
  starting at `deployed`".
- `07:257`'s "Done when" says `pending → go/no-go → live`, skipping `deployed`.
- `06-review-round-2.md:487` claims the states "now read the same everywhere", which isn't true.

**Fix:** add `pending` to `02` (h), fix `03:77`/`03:204` and unit 58, and correct the `06` §G
note. Also say that the tag or host-release export happens only at a terminal state (`live` or
`rolled-back`), since a tag annotation can't follow state changes.

### AR3-15 · Minor · Which proof carries the trace result, and when proofs are minted

- `01:961` mints the proof "on PASS". `01:1132` mints it at ship ("ship runs `mirai trace` and
  writes the signed proof").
- `04:486-487` says a record carries the trace result "computed at ship time".
- `03:115` and `07:132-134`: in Milestones A–B there is no QA proof, and trace arrives at unit
  41.

**Fix:**
- Proofs (review and QA) are minted **at ship**, from captured verdicts, together with the
  trace result. Before unit 41 the field is `trace: "n/a"`.
- Add `base_sha`, `trust_root_hash`, `framework_version` and `rung`/`model` to the proof for
  audit. In workspace mode, add both base SHAs (AR3-19).
- Proofs from earlier rounds stay as immutable files; the checker picks the one that matches.

### AR3-16 · Minor · Gaps in the ticket, epic and run machines

- **Tickets:**
  - `waiting` for a cross-repo dependency (`04:168`, `01:555-557`) has no entry from
    `ready_for_dev` (`02:472-473` only goes from `built`).
  - `waiting → built` (`02:473`) ignores that a changed parent can change the child's hash. It
    needs `waiting → in_review` when the proof no longer matches.
  - There's no handed-over state (`02:502-503` describes it, but the diagram has none), so M1
    can't tell a handed-over merge from a MIRAI one.
  - There's no state for "QA PASS, push or MR creation failed" (AR2-6 #3).
- **Epic:** dropped tickets aren't handled in "all tickets integrated" (`02:515`).
- **Run:** there's no stale-`running` (crash or power loss) transition; `resume` from a dead
  lock isn't drawn (`02:525-535`).
- **Unpark choices differ:** `04:180`, `04:1050-1051` and `02:500` say re-plan / retry / drop;
  `07:221` says "re-plan, split, raise the budget once, drop".

### AR3-17 · Minor · Stacking mechanics

- **The recorded parent head goes stale.** `01:665-666` records "A's head … when B started". If
  A gets fix rounds and B is rebased onto the new A (`01:670`), a later
  `--onto main <A-head-at-start>` replays A's fix commits. Record the parent head at **every**
  (re)base.
- **Pin the lease.** `--force-with-lease` (`04:746-747`) should be
  `--force-with-lease=<branch>:<sha-last-pushed>`, because a plain lease is defeated by any
  fetch.
- **GitHub retargets before MIRAI rebases.** GitHub retargets B to `main` when A's branch is
  deleted on merge, so B's CI runs against `main` with A's old commits still on B. It's red
  until the rebase. Expect it, and don't count it as a failure in metrics.

### AR3-18 · Minor · `mirai-verify` hardening and where the hash domain comes from

- `01:1157-1161` and `04:417-421` don't say:
  - `permissions: contents: read` (`pull_request_target` gets a write token by default);
  - no `npm install`, and no `node` from the PR tree;
  - fetching PR objects only for `git diff`/`git show`;
  - the MIRAI verifier comes from the base checkout.
- **The hash domain must come from the base.** `code_paths`, `<docs_root>` and the e2e paths
  must be read from the **base** config, both in CI and in `pre-push`. Otherwise a branch can
  narrow `code_paths` after review.
- **`config.user.toml` can override gate keys.** It still can (`03:67`; AR2-10 fix 2 wasn't
  adopted), so local and CI hashes can differ. Make gate-domain keys a schema error there.

### AR3-19 · Minor · Workspace mode (D-51) gaps that matter for the proof format now

- **The lock pins a version, not the config.** Each service lock pins "the gate config
  **version**" (`04:1477-1478`). But service-repo CI needs the **content** (`code_paths`, risk
  paths) to recompute the hash. Pin a hashed copy in the light install.
- **Two bases per ticket.** The workspace base gives the rules and the service base gives
  lock/hooks/tests. Both SHAs go into the proof (AR2-4 #2, not adopted).
- **Hooks.** `03:292` puts "hooks" in the service repo, against D-47. Say that the service
  checkout's `core.hooksPath` points into the workspace's MIRAI home.
- **Locks.** The run lock is "per repo" (`01:1305`). In a workspace, use one run lock per
  workspace plus a checkout lock per service repo (AR2-4 #5).
- **Reads across repos.** The sandbox `allowRead` "the project" has to name the workspace docs
  *and* the one service checkout for that ticket.

### AR3-20 · Minor · Naming and path drift

- **Hook location:** `core.hooksPath=<trust-root>/hooks` (`01:247`, `01:834`, `07:157`) vs
  `<store>/hooks` (`04:415`, `03:270`). Pick one. Recommendation: the store's `hooks/`,
  hash-checked against the base lock before every git call.
- **Double `<repo-id>`:** `07:57` defines `<mirai-home>` as `…/mirai/<repo-id>/`, then
  `07:108` and `07:155` write `<mirai-home>/<repo-id>/`.
- **"MIRAI home" vs "orchestrator store":** `01:146` and `02:153` say MIRAI home; `03:37` says
  orchestrator store. Put both in the glossary as one term with one meaning.
- **Who merges into `feature/<epic>`:** D-33 says "you merge every one of them yourself"
  (`04:1013`), but `01:1240-1241` says "after an inbox approval the orchestrator performs
  exactly that merge", and `07:264` says "via the inbox". This decides who authors those merge
  commits, which matters for the trailer rule (AR3-4).
- **Stale field name:** `01:624` still says `covers` (renamed `covers_ac`).

### AR3-21 · Minor · The red-team lists still diverge and miss this round's cases

There are still three lists: D-30 (`04:926-940`), `01:850-862` and unit 16 (`07:159`).
- Unit 16 lacks reading the store, a Glob from `/`, `WebFetch`, reading the launch token, and
  writing `.env`/`COMPOSE_FILE`.
- `01` §7a lacks the launch token and the forged verdict.
- None has:
  - a Bash write to `.git/config` or `.git/hooks` (AR3-1);
  - a container write to `.git` (AR3-1);
  - `mirai` called from Bash (AR3-2);
  - an agent writing `.mirai/keys/*.pub` or a `records/` file through Bash (AR3-10);
  - a stacked parent editing the workflow (AR3-5).

**Fix:** make D-30 the single list, have `01` and unit 16 reference it, and add the cases above.

### AR3-22 · Minor · The registry comes after the units that read it

- D-37 says "the status model reads each document type's state machine from its definition"
  (`04:1110-1112`), and `03:95` puts the registry in Milestone A.
- But the registry is unit 34 in Milestone B (`07:211`), after unit 04 (status model) and unit
  07 (lint).

**Fix:** split out a minimal registry loader (schema + document-type machines) into A before
unit 04, or say that A hard-codes the two machines and unit 34 moves them to data. Fix `03:95`
either way.

---

## Round-2 Architect findings: closed or still open

| ID | Status | Note |
|---|---|---|
| AR2-1 | **Partly closed** | Store, trust root, key and tokens are outside the project (D-47), and verdicts come from structured output. Open: `.git/` writes (AR3-1); the CLI channel from sandboxed sessions (AR3-2). |
| AR2-2 | **Closed** | E2E written before review, one proof (U2, D-16, `01` §8a). |
| AR2-3 | **Partly closed** | Ed25519, public key committed, `pull_request_target`. Open: key bootstrap, adding keys and revocation (AR3-10); a stacked MR's base keys (AR3-5). |
| AR2-4 | **Partly closed** | Proofs in the service repo (D-51). Open: two base SHAs, gate config content, light-install hooks and locks (AR3-19). |
| AR2-5 | **Closed by decision** | U3/D-52: one machine; `doctor` says so. |
| AR2-6 | **Still open** | Ticket status home contradicts itself in 4 places; the precedence rule is broken; no shippable state (AR3-7, AR3-16). |
| AR2-7 | **Partly closed** | Docs MR, releases in the store with export, reports in the store. Open: who commits documents, the docs-MR gate, where approvals land (AR3-9). |
| AR2-8 | **Closed** | `integrated` plus the epic machine. Leftovers: who runs the merge (AR3-20); merging a child into a stacked parent (AR3-5). |
| AR2-9 | **Partly closed** | Closed locally (trust root from `main`). Open in CI (AR3-5). |
| AR2-10 | **Mostly closed** | `config.user.toml` and the cache moved out. Fix 2 (no gate keys there) not adopted (AR3-18). The work-file issue moved to AR3-3. |
| AR2-11 | **Closed** | Trace runs locally at ship and its result goes in the proof; rules keyed by `tests`. Carrier and timing are vague (AR3-15). |
| AR2-12 | **Closed** (outside this round's scope) | `J-n`, lite-PRD IDs, NFR methods, `covers_ac`, BR closure, ID-stability lint. TEA classes not adopted; stale `covers` at `01:624`. |
| AR2-13 | **Partly closed** | Approvals sign the content hash. Open: the superseded file name ("kept under its version name", `01:1324-1325`); external pointers have no `approved_content_hash` (`03:258`). |
| AR2-14 | **Closed** | Overlays, template versions, migrations allowed. |
| AR2-15 | **Closed** | Same render for interactive files. Unit 11's equal-hash check can't hold as written (AR3-13). |
| AR2-16 | **Partly closed** | External status is advisory, but a tracker is still named as the status home (AR3-7). |
| AR2-17 | **Partly closed** | Lock marks added, but two classes don't cover generated or mixed files (AR3-13). |
| AR2-18 | **Still open** | Three lists that still disagree (AR3-21). |
| AR2-19 | **Closed** | Task/Agent tool denied headless; in the red-team list. |
| AR2-20 | **Partly closed** | `mirai handover` exists, but CI can't see it (AR3-4); the MR line isn't updated. |
| AR2-21 | **Still open (ordering)** | Registry unit 34 exists, but in B, after units 04 and 07 that need it (AR3-22). |

**Tally:** 8 closed (incl. AR2-5 by decision), 10 partly closed, 3 still open.

---

## What's good, keep

1. **Moving the store out of the project and denying it with the sandbox.** This is the right
   boundary under D7. AR3-1 and AR3-2 are its edges, not its core.
2. **Verdicts only from captured structured output.** Extend the same rule to every agent output
   (AR3-3).
3. **Ed25519 with base-commit keys and a data-only `mirai-verify`.** This is the right CI shape.
   It needs the stack-root and key-MR rules (AR3-5, AR3-10).
4. **`run_tests` as a narrow MCP tool.** It's the pattern to reuse for the CLI channel (AR3-2)
   and for QA scripts (AR3-3).
5. **E2E before review, one proof.** It's clean, and it closes R2-C4 for good.
6. **`integrated` plus the epic machine.** It removes the deadlock. Apply the same thinking to
   stacked merges (AR3-5).
