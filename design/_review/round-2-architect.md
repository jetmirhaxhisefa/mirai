---
reviewer: software-architect
round: 2
scope: design/00, 01, 02, 03, 04, 05, 06, 07, 08; design/_review/round-1-architect.md; research/07, research/09
---

# Round 2 — Architect review of the MIRAI design

**Lens:** structural soundness and coherence: the state model (branch-carried facts, orchestrator
store, trust root) under D7 (no container), local-only work files and workspace mode; connectors
and one source of truth; extension points; state machines; the SDD chain; templates vs
customization vs update; retention vs audit; the framework/project boundary; consistency across
01/02/03/04/07 and with `08`.

**Counts:** 4 Critical · 17 Major · 12 Minor.

**Top 3:**
1. **AR2-1:** the orchestrator store, the trust root, launch tokens and the MIRAI hooks all sit
   under `<project>/.git/`. That folder is *inside* the project folder the sandbox and the deny
   rules allow agents to read and write. So an agent can reset its own round counters, read
   launch tokens, edit the next launch's `strict.json` and repoint `core.hooksPath`. Under D7
   this breaks the guarantees of D-12, D-15, D-18 and D-30.
2. **AR2-2:** Ivy writes the E2E test *after* review PASS, and it's committed with the ticket.
   E2E files are code paths, so the patch-id changes and `pre-push` refuses every `e2e: yes`
   ticket. That's R-C1 coming back on the happy path.
3. **AR2-3:** CI is said to "re-check records and signatures", but the signatures are HMAC. CI
   can only check them by holding the same secret key, and an MR workflow can read that key. The
   same problem means a second machine can't verify approvals made on the first.

The round-1 fixes are mostly in, and the direction is right. The new weak spots come from
combining three later decisions that were each sound alone:
- D7: agents run as your own user, with no container;
- Q9: work files stay local only;
- Q3: workspace mode.

Each moves state somewhere the round-1 model didn't expect.

---

## Critical

### AR2-1 · Critical · The store, trust root, tokens and hooks are inside the agent's read/write scope

**Where:**
- `03` §8 lines 246–254: the store and `trust/<base-sha>/` live under `<git-common-dir>/`,
  "e.g. `<project>/.git`".
- `04` D-15 line 357: the trust root is under the orchestrator store.
- `04` D-12 line 287: "Agents can't read the store (D-30), so they can't mint one."
- `04` D-30 lines 757–766: `denyRead` covers the home folder *with `allowRead` for the project*.
  The Edit denies cover only `.env*` and the records folder. Sandbox writes default to the cwd
  (`research/09` §1).

**Problem:**
- `<project>/.git/mirai/` is inside the project folder, so nothing in D-30 denies it. A
  sandboxed `sh -c` or an `Edit` can:
  - rewrite `ledger.json` or `state.json`. That resets rounds and budgets, which breaks D-18
    "resume never resets counters" and your main Q5 concern;
  - read the one-time launch token (D-12's recursion guard) and start nested agents;
  - edit `trust/<sha>/strict.json` or `mcp.json`, which the *next* launch uses. That breaks
    D-30 #5 "a branch can't loosen the rules". "Read-only" here only means file permissions,
    and the same user can run `chmod`;
  - write a fake reviewer output file that the CLI then signs into a PASS record. D-16 says the
    CLI writes records "from the reviewer's own output file", and `01` §9 line 789 puts that
    file in the store;
  - run `git config core.hooksPath …` (that writes `.git/config`) or edit `.git/hooks-mirai/`.
    The hook hash check runs from the trust root, which is itself writable, so the check is
    circular.
- Round 1 put the store in the git common dir (AR-3) *before* D7 removed the container. With
  agents running as your user, the location is no longer safe.

**Fix:**
1. Move the store and the trust root out of the project folder: `~/Library/Application
   Support/mirai/<repo-id>/` (or `$XDG_STATE_HOME/mirai/<repo-id>/`), where `<repo-id>` is a
   hash of the remote URL. Add it to `denyRead` and `denyWrite` and to the `Read`/`Edit` denies.
   Add a red-team case for it.
2. Deny agent writes to `.git/**` in the sandbox (`denyWrite`) and with `Edit(.git/**)`. Agents
   don't commit (D-15), so they never need it. This also protects `.git/config`.
3. Agents never write files the CLI later trusts. The reviewer, verifier and QA return verdicts
   through `--json-schema` structured output, which the launcher captures from stdout. The CLI
   writes the store.
4. Keep launch tokens in the orchestrator process memory or a 0600 file in the moved store, never
   in the project.
5. This also gives workspace mode (AR2-4) and a second machine (AR2-5) one natural home.

### AR2-2 · Critical · QA's E2E test, written after review PASS, invalidates the review record

**Where:**
- `02` (a) lines 52–56: Review → QA "+ E2E test if e2e: yes" → Ship.
- `01` §10 line 881: "the new or updated E2E test files, committed with the ticket".
- `04` D-16 lines 403–407: the patch-id covers code paths; "any later code change changes the
  patch-id, so the record stops counting".
- `01` §11 lines 962–963: `pre-push` needs a review record for the current patch-id.
- `07` unit 45's "Done when" doesn't include "push succeeds".

**Problem:**
- E2E test files aren't in the default `code_paths` exclude list (`.mirai/**`, docs root,
  bookkeeping). So Ivy's commit changes the patch-id after Rex's PASS, and every `e2e: yes`
  ticket fails `pre-push` and CI. That's the R-C1 failure for a new writer.
- Excluding E2E paths from `code_paths` would be worse: Ivy's test code would then never be
  reviewed or bound to any record.

**Fix:** pick one rule and write it into D-16 and D-44.
- **(a) Preferred:** split the scope. The review record binds `code_paths − e2e_paths`. The QA
  record binds `e2e_paths` plus the review record's patch-id. `pre-push` and CI need both. Rex
  doesn't review E2E files, and the floor guard covers deletions and skips.
- **(b)** Ivy writes the E2E test *before* review (after checks are green). Rex reviews it with
  the code and QA runs it. This costs one QA pass before review.

Add `e2e_paths` to `[gate]` config. Add "an `e2e: yes` ticket pushes successfully" to unit 45's
"Done when", and to unit 59 for the final E2E.

### AR2-3 · Critical · HMAC signatures can't be checked in CI without handing CI the signing key

**Where:**
- `04` D-17 lines 433–438: signed with an HMAC key in `~/.config/mirai/`; "`pre-commit` and CI
  reject a status change … without a matching signed approval event".
- `03` §3 line 106: CI "re-checks records and signatures".
- `01` §11 line 969.
- `07` unit 19.

**Problem:**
- HMAC is symmetric. To verify, CI needs the same secret, so it would have to be a repo secret.
- On `pull_request` events GitHub runs the workflow from the PR's merge ref. Secrets reach it
  before the job can compare its own workflow against the base lock (D-15 #4). A modified
  workflow (for example a supervised ticket that touched CI files) could print or send the key,
  and then forge every approval.
- The key is per machine. Approvals and records signed on machine A fail on machine B, and the
  design has no way to share the key.
- Unit 19 is in Milestone A, so this affects MVP-core.

**Fix:**
1. **MVP:** CI checks only what it can without a secret: records exist, their patch-id matches,
   `mirai.lock` matches the base branch. Signature checks stay local (`pre-push`, `mirai status`).
   `doctor` and D-17 say plainly that "signatures are verified locally only".
2. **Proper fix:** move SSH signing (`07` Later #15) into Milestone D, or earlier if CI runs.
   The public key goes in `.mirai/` on the base branch, so CI verifies with no secret. That was
   round-1 AR-11's original proposal.
3. Write down how the key gets to a second machine (copy by hand, with the risks), and say that
   `doctor` warns about approvals signed by an unknown key.

### AR2-4 · Critical · In workspace mode the branch-carried facts aren't on the branch being gated

**Where:**
- `03` §8 lines 263–268: the workspace `.mirai/` holds "config …, context, records,
  approvals". The service repo gets "lock, conventions, quality gate, test levels".
- `04` D-06 line 125 and `03` line 71: the store belongs to the workspace repo.
- `04` D-42 #3: each ticket runs in its own repo, with one MR there.
- `01` §11 lines 961–969: `pre-push` and CI need records for *the branch's* patch-id, and CI runs
  `mirai trace`.
- `01` §14 line 1085: "one `mirai run` at a time per repo".

**Problem:** the D-06 model says facts *travel with the MR*. In workspace mode they don't, in
four ways:
- **Records:** they're committed in the workspace repo, but the MR and its CI are in the service
  repo. Service-repo CI can't see them, so it either fails every MIRAI MR or can't gate.
- **Trust root:** gate config (`code_paths`, risk paths, caps, tiers) comes from the workspace
  base commit. But the code under test, its hooks and its `mirai.lock` come from the service
  repo's base. Which snapshot is "the trust root"? There are two base SHAs per ticket.
- **Trace in CI:** PRDs, ACs and tickets live only in the workspace (D5). Service-repo CI can't
  run `mirai trace`.
- **Lock and protected paths:** the "light install" has no defined lock contents, so it's
  unclear what CI compares and what counts as a protected path in a service repo.
- **Run lock:** the lock is "per repo", but one workspace run drives several repos.

**Fix:** write a "workspace state model" section into D-42 before unit 17's spec, because the
record path is decided there.
1. **Records** are committed in the **service repo** whose code they bind, under
   `.mirai/records/` there. Approvals for documents stay in the workspace.
2. **Two trust-root halves per ticket:** the workspace base gives the rules (config, framework,
   custom). The service-repo base gives that repo's lock, hooks, test levels and conventions.
   Both hashes go into the record.
3. **Service-repo CI** checks records, the lock and the gate. It doesn't run `mirai trace`.
   Trace runs in the workspace at the ticket gate and before ship, and the QA record carries the
   covered AC list (see AR2-11).
4. Define the light install's lock (framework subset + generated files) and its protected paths.
5. One run lock per workspace, plus one checkout lock per service repo.

---

## Major

### AR2-5 · Major · A second machine (or a lost one) breaks the round invariant, the inbox and the metrics

**Where:**
- `04` D-06 lines 143–145: "Losing the machine loses run progress but not the work itself …
  `resume` rebuilds what it can".
- `04` D-18 lines 469–471: "`resume` never resets counters or budgets".
- `01` §14 line 1082: "from any tool, on any day".
- `08` Q9 #2 and `04` D-29: plans, findings, QA reports and parking notes are local only.
- `04` D-46: metrics are "kept", but in the store.

**Problem:** you run supervised work on one machine and overnight work on another, or you
replace a laptop.
- **Counters:** on machine B a ticket has no ledger, so `resume` starts with zero rounds. D-18's
  "a restart can't grant fresh rounds" fails across machines.
- **Inbox:** disputes, parked notes, template gaps and plan review packets aren't there.
- **Plans:** the approved plan (whose frozen block "is owned by the human", `01` §6 line 560) only
  exists on A.
- **Metrics:** the trust history that decides human → auto (Q6) is lost with the disk.
- **Hooks:** `core.hooksPath` isn't cloned, so a fresh clone has no `pre-push` gate until setup
  runs.
- **Record IDs:** `r<n>` needs the local counter, so a second machine can produce colliding IDs.

**Fix:**
1. **Exported run-log lines (D-29) become the portable ledger.** At ship time and at parking,
   export per ticket: rounds used, budget used, verdicts, structured findings. `resume` on a
   machine with no local state rebuilds counters from them. A ticket with no export and no local
   state is `foreign`: it needs `mirai unpark` with a budget you grant, never fresh rounds.
2. `mirai metrics` reads the exported lines in git as its source of truth. The store's
   `metrics/` folder is a cache.
3. `doctor` flags missing hooks and an unknown signing key (AR2-3).
4. State plainly in D-06 that the inbox and plan text are single-machine.

### AR2-6 · Major · Ticket status has no home, and derived `built` conflicts with moves out of `built`

**Where:**
- `04` D-07 lines 160–161 and `02` (h) line 411: "frontmatter is the current state". Tickets
  carry frontmatter `status` (`03` §6 line 193) and live in `<docs_root>/…/tickets/` (`03`
  line 242).
- `01` §17 line 1188: run progress is in the store.
- `02` (h) lines 426–435: `built → in_progress`, `built → waiting`, `waiting → blocked`.
- `04` D-06 line 130: `built` = an open MR whose head has valid records.

**Problem:**
- **Where status is written:** `ready_for_dev → in_progress → in_review → blocked` are
  operational, but the rule says frontmatter is current. Written to the ticket file, they land on
  a branch, which is R-C4 again. Written only to the store, the frontmatter stays `ready-for-dev`
  forever, and the "frontmatter/log mismatch is an error" rule (`07` unit 03) fires on every
  ticket.
- **Derived vs written:** after MR comments or a red CI, the MR is still open and the patch-id
  record is still valid. So the derivation still says `built` while the machine says
  `in_progress`. `waiting` has the same problem. No precedence rule exists.
- **Missing states:** there's none for "QA passed, waiting at the human `ship` gate", or for
  "pushed but MR creation failed".

**Fix:**
1. Split the ticket fields. Ticket *content* is committed (ACs, `covers`, `repo`, `e2e`). Ticket
   *status* is never in frontmatter; it's computed by `mirai status` from three things: the
   store journal, the exported lines and the git host.
2. **Precedence:** a written human or orchestrator state with a later `seq` beats the derived
   one. `built`/`done` are derived only when no later written state exists.
3. Add a `shippable` state between QA PASS and an open MR.
4. Restate the D-07 rule as "frontmatter is the current state **for documents**".

### AR2-7 · Major · Documents and post-merge records have no branch or integration model

**Where:**
- `04` D-06 #3 line 133: "Nothing commits to `main` after a merge". `01` §12 line 990.
- `01` §12a line 1048: `releases/<version>.md` with states `staging → … → live`, written after
  the merge. Line 1049: "the PRD's work item is marked `live`".
- `01` §13 line 1066: `reports/run-<date>-<id>.md`. `05` #9: "a file in the repo".
- `01` §5 line 464, `01` §6 line 582: tickets branch from `main`.
- No section says which branch the brief, PRD, ADRs, ticket set and `.mirai/approvals/` are
  committed to.

**Problem:**
- **Documents:** the ship model exists only for tickets. Approved documents and their signed
  approvals need to reach `main` *before* ticket branches are cut from it. Otherwise the ticket
  branch (and CI's `mirai trace`) has no PRD or ticket set. Either MIRAI commits documents
  straight to `main` (and may hit branch protection), or there's a docs MR you merge. Neither is
  written down.
- **Release records** are written after the merge, with status changes and your signed
  go/no-go. They contradict "nothing commits to main after a merge".
- **Run reports and the work item's `live` state** have the same problem.

**Fix:** add a §"Where writes land" table to D-06.
- **Documents:** a `docs/<initiative>` branch per initiative. Approval events are committed
  there. The orchestrator opens one docs MR at the ticket-set gate, and you merge it before any
  ticket starts. Or, as an alternative, allow direct commits of approved documents to `main`
  where branch protection allows, and say so.
- **Releases:** the release record lives in the store and is exported as a git tag annotation
  or host release (tier 0). The work item's `live` state is derived from those, never written.
- **Run reports:** they stay in the store, with an optional export.
- Fix `05` #9 to match.

### AR2-8 · Major · A `release: together` epic deadlocks on its own `after` rule

**Where:**
- `01` §6 line 551: a ticket is ready when its `after` tickets are "`done`, or `built` in the same
  epic within the stacking depth".
- `01` §12 lines 987–989 and `02` (h) lines 445–447: `done` in a `together` epic = merged into
  `feature/<epic>` *and* that branch merged into `main`.
- `04` D-06 line 130: `built` = an *open* MR.

**Problem:**
- Once ticket A's MR merges into `feature/<epic>`, A is neither `built` (its MR is closed) nor
  `done` (the epic isn't in `main`). So B (`after: [A]`) never becomes ready.
- The epic can't reach `main` without B, so the epic deadlocks.
- There's also no epic-level state for "final E2E failed", or for which ticket gets the fix.

**Fix:**
1. Add a derived ticket state `integrated` (merged into `feature/<epic>`). The `after` rule
   accepts `done`, `integrated` within the same epic, or `built` within the stacking depth.
2. Add a small epic machine: `open → integrating → final_e2e → ready_to_merge → done`, with
   `final_e2e_failed → (new bug ticket in the epic, you choose)`. That ticket uses the normal
   loop.
3. Protect `feature/*` with the required check. Say who runs the merge after a batch approval
   in `mirai inbox` (see AR2-29).

### AR2-9 · Major · Stacked tickets take their trust root and CI lock from an unmerged, agent-written branch

**Where:**
- `04` D-15 #1 and `01` §8 line 750: the trust root comes "from the base commit".
- `01` §6 line 586: B starts from A's branch.
- `04` D-15 #4 and `01` §11 line 969: CI compares against "the **base branch's** `mirai.lock`".
  For stacked MR B, the base branch is A's.
- `01` §8 line 750: one snapshot "at run start", although one night has several bases (`main`,
  `feature/X`, A's branch).

**Problem:**
- In supervised mode A can touch protected paths (high risk, but allowed through). B's trust
  root and CI baseline then come from A's unmerged, agent-written rules. That's the R-C2 hole
  again, one level down.
- "One snapshot per run" is also wrong when tickets in the same night have different bases.

**Fix:**
- The trust-root base is always the **human-merged root** of the stack: `main`, or
  `feature/<epic>`. It's never a stacked parent.
- Key snapshots per ticket by that root SHA.
- In CI, compare the lock against the stack root: resolve `main` or `feature/*` through the host
  API, not the PR's base ref.
- Write this into D-15 and D-24.

### AR2-10 · Major · Gitignored files inside the work tree are trusted, agent-writable and invisible to every diff check

**Where:**
- `03` §8 line 234: `config.user.toml` is gitignored. Line 240: `cache/` (external doc copies) is
  gitignored.
- `03` line 60: config layering includes `config.user.toml`.
- `02` (c) line 135: the trust root holds "config" from the base commit, where `config.user.toml`
  doesn't exist.
- `04` D-12 line 248: the write-scope check compares "changed files".
- `04` D-30 line 765: Edit denies cover only `.env*` and records.

**Problem:**
- `config.user.toml` can hold budgets, tiers and caps. It isn't in the base commit, so either
  it's read live from the agent-writable work tree, or it's silently dropped. Neither is stated.
- An edit to it (or a poisoned `cache/` copy of a PRD) doesn't show in `git diff`. So the floor
  guard, protected paths and the write-scope check (if it's based on git status) all miss it.

**Fix:**
1. Snapshot `config.user.toml` into the trust root at run start, from the working copy, before
   any agent runs. Record its hash.
2. Limit `config.user.toml` to non-gate keys (model mapping, `run.stop_by`). Gate keys there are
   a schema error.
3. Deny agent `Edit`/`denyWrite` on `.mirai/**` (agents never need it).
4. The write-scope check compares a before/after filesystem snapshot, including ignored files.
5. The cache is written only by the CLI, and each cached copy carries its remote content hash.

### AR2-11 · Major · `mirai trace` "in CI" needs inputs CI never has, and its rules ignore the test settings

**Where:**
- `01` §5a lines 537–542: trace checks that every ticket AC has a test **and** every AC has QA
  evidence, and "runs at the ticket gate, before ship, and in CI".
- `01` §11 line 968.
- `01` §10 line 881 and `04` D-16 line 414: QA reports are never committed, and records "hold no
  findings".
- `01` §7 lines 634–637: with `tdd: off` it's a test *or* QA evidence; `tests: optional` allows no
  tests; plans allow `no-test` rows.

**Problem:**
- **Evidence:** CI has no QA evidence, because it's local only. With an external ticket store or
  a workspace, it has no tickets or PRD either (AR2-4, AR2-16). So "M8 computed, not
  self-reported" (D-35) can't be checked where it matters.
- **Rules:** as written, the trace fails every `tests: optional` or UI-styling ticket.

**Fix:**
1. The **QA record** stays free of findings but carries the structured result:
   `{ac_id, verdict, evidence_kind, test_ids[]}`. CI's trace checks that this list covers the
   ticket's `covers` ACs.
2. The trace rules are keyed by `tests`/`tdd` and per-AC `no-test`. With `tests: optional`, an AC
   needs QA evidence; with `required`, a test, or QA evidence where the plan says so.
3. Where documents aren't on the branch, CI runs a *ticket-local* trace from the record, and the
   full chain runs locally.

### AR2-12 · Major · Gaps in the SDD ID chain

**Where:**
- `03` §6 line 183: the lite PRD is "the spec kernel (Why / Capabilities / …)".
- `01` §5 lines 471 and 481: `covers_ac` vs `covers: [FR-…, NFR-…]`. `03` line 187: `covers`
  holds AC IDs.
- `01` §5a line 532: `FR/NFR → AC-FR-n.m`.
- `01` §3 line 310: `UJ-n`; critical journeys live in the feature map with no ID (`01` §10).
- `research/07` §6.1: BR → FR closure.

**Problem:**
- **Lite PRDs:** it isn't said whether lite PRDs carry `FR-n`/`AC-FR-n.m`. `standard` is the main
  track, so the chain is undefined where it's used most (round-1 AR-9, still unfixed).
- **NFRs:** they have no AC IDs, so the chain stops at "a ticket covers it". No test, check or
  evidence is ever needed for an NFR.
- **Field names:** `covers` and `covers_ac` are used for different things in `01` and `03`.
- **BR closure:** the trace list in `01` §5a doesn't check BR → FR closure.
- **E2E tags:** E2E tests are "tagged with the journey", but journeys have no ID and no link to
  the PRD's `UJ-n`. Trace doesn't check that an `e2e: yes` ticket has a journey-tagged test.
- **TEA classification:** TEA's FULL/PARTIAL/NONE evidence classes and the "never reuse an ID"
  rule from AR-9 aren't adopted.

**Fix:** one ID grammar in the shared frontmatter unit (27):
- lite PRDs use `FR-n` and `AC-FR-n.m` (Capabilities = FRs);
- NFRs get `AC-NFR-n.m`, or a `check:` ID verified like an ADR Confirmation;
- tickets carry `covers_fr` and `covers_ac`;
- critical journeys get `CJ-n`, with `realizes: [UJ-n]`;
- trace adds BR closure and "every `e2e: yes` ticket → a test tagged `CJ-n` + AC";
- an ID-stability lint: retired IDs are never reused.

### AR2-13 · Major · Approvals aren't bound to content, so "approved = frozen" is unenforced

**Where:**
- `04` D-07 lines 162–164 and `01` §15 lines 1101–1105: frozen version; on approval "the old file
  is kept under its version name".
- `04` D-17: what an approval signs isn't specified.
- `07` unit 05: "an unsigned or edited approval fails". That's an edited *event*, not an edited
  document.
- `04` D-06: external docs have pointers `id, url, version, status` (`03` line 239).

**Problem:**
- An agent edit, a hand edit or a bad merge to an approved `prd.md` (or a Confluence edit after
  approval) is invisible. `pre-commit` checks only *status* changes.
- On supersede the file is renamed (the name isn't specified). An approval tied to a path then
  breaks, and `derived_from: prd@v1` has nothing to resolve to.
- This is round-1 AR-7 fix 3 and AR-8 fix 1, still open.

**Fix:**
- An approval signs `{doc_id, version, content_sha256, ts}`.
- `pre-commit`, CI and `mirai status` re-hash approved docs, and a mismatch is an error.
- The pointer gets `approved_content_hash`, and reading a changed remote doc stops the stage.
- Fix the naming: `prd.md` = current approved; `prd.v1.md` = superseded (frozen); `prd.v2.draft.md`
  = draft. `prd@v1` resolves through the approval event's hash.
- Stale detection lists the IDs added, changed or removed.

### AR2-14 · Major · Template customization, template versions and `update` don't meet

**Where:**
- `04` D-41 #4–5 and `08` Q2 #4–5: per-project add/reorder/rename "in `.mirai/custom/`";
  templates are versioned.
- `04` D-05 lines 98–99: custom hook points are `persistent_facts`, `external_sources`,
  `on_complete` and template *paths*.
- `03` line 93, `02` (e) U5 line 283, `07` unit 62: update "never touches config/custom/context",
  *and* has "versioned config/state schemas with deterministic migrations".
- `03` §6 lines 193–194: the shared frontmatter has no template version.

**Problem:**
- A custom template is a full fork reached through a template path. `update` never touches it,
  so a new framework version (a new protected section, new "done when" rules, a new lint) never
  reaches it. Or the new lint rejects every document made from the old fork.
- Approved, frozen documents can't be edited, so after an update the lint must not re-judge them
  against a newer template. Documents don't record which template version they used.
- **Config migrations:** the design says migrations exist and also that config/custom are never
  touched. That's round-1 AR-5's exact contradiction, still in place.

**Fix:**
1. Customizations are **deltas**: `.mirai/custom/templates/<type>.toml` with `add`/`rename`/`order`
   over the framework template, merged at render time. Framework updates then flow through, and
   the protected-core check runs on the merged result.
2. Frontmatter gets `template: <type>@<version>`. Lint checks a document against its recorded
   version. Frozen documents are never re-linted against a newer one.
3. Allow migrations to change config/custom/context through the same diff-and-approve flow. Say
   so in D-03, `03` and unit 62.

### AR2-15 · Major · Custom overrides reach headless runs only; interactive authoring sees something else

**Where:**
- `04` D-21 lines 567–568 and `03` line 72: overrides are rendered into the **launch bundle**.
- `04` D-12 lines 237–238: interactive authoring (Nora, Arlo, Tess) runs in your own session,
  which loads the generated `.claude/skills/`.
- `01` §0 line 62: "Both paths use the same skills, write the same files".

**Problem:**
- A `.mirai/custom/mirai-prd.toml` (template path, persistent facts) changes the scripted PRD
  verifier, but not the interactive Nora who writes the PRD.
- The two paths diverge, and the template the author used isn't the one the lint and the
  verifier expect.

**Fix:**
- Render the same content-hashed snapshot into the generated tool files too (regenerate on
  `mirai config apply`, and `doctor` flags stale renders, as in round-1 AR-16 fix 3).
- Or make interactive skills resolve overrides at run time with `mirai config resolve <skill>`.
- Either way, `mirai session start` records the render hash it ran with.

### AR2-16 · Major · Status authority for external artifact types contradicts "control data works offline"

**Where:**
- `02` (h) lines 413–414: "When that place is an external tool, the status lives there and the
  repo keeps only a pointer."
- `04` D-06 #5 lines 138–139: control data never depends on an external API, and the gate and
  `resume` work offline.
- `00` Q7.
- `03` §7 line 218: the contract has a "status map".

**Problem:**
- With tickets in Jira, readiness (`after`), `waiting`, human-only checks and CI trace would all
  read Jira.
- Who wins when someone moves a Jira ticket to Done by hand? Round-1 AR-7 fixes 1–2 ("observed,
  never authoritative") were dropped together with `both`. But they concern status authority, not
  `both`.

**Fix:** state in D-06 and D-36:
- **External tool:** it's the source of truth for *content*.
- **MIRAI:** its journal (and the derived states) is the source of truth for *workflow status*.
- **Mirroring:** status is mirrored one way to the tool by tier 0. A status change made in the
  tool shows up as `external_status_drift` in `mirai status` and the inbox, and is never applied.

This doesn't re-open D5: content still lives in one place.

### AR2-17 · Major · Generated files with project-specific content blur the framework/project boundary

**Where:**
- `03` §5 line 160: `verify-<app>` is "generated", "project-specific".
- `03` §2 line 94: the managed `AGENTS.md` block.
- `04` D-21 lines 549 and 561: `contribute` reads lock-listed files whose hash changed, and the
  lock lists generated tool files.
- `04` D-42 #5 and `01` §1 lines 164–168: the block list is built from `resources`. Its location
  isn't stated (round-1 AR-6 fix 4).

**Problem:**
- If `verify-<app>` or a managed block holding project lines is lock-listed as a "generated tool
  file", every edit shows as a framework change and `contribute` offers it upstream. That's a
  leak path the scanner has to catch alone.
- The trust root also snapshots "generated tool files" without saying whether project-generated
  ones count.

**Fix:**
- The lock gets an ownership class per entry: `framework`, `generated-from-framework`,
  `generated-from-project`, `local-addition` (after promote). `contribute` reads only
  `framework` and `local-addition`.
- `verify-<app>` lives under `.mirai/context/` as project content, with a generated stub
  pointing to it.
- The block list lives in the project (`config.user.toml` or the store), and the scanner refuses
  a block-list path inside the lock.

### AR2-18 · Major · The roadmap's red-team check drops the attacks the signing model depends on

**Where:**
- `04` D-30 lines 791–798: the seeded attempts include `~/.config/mirai` (the key), a Glob from
  `/`, pushing a fake secret, and a branch adding a `.claude/settings.json` hook.
- `04` D-17 line 445: "The red-team test in D-30 includes reading the key".
- `07` unit 13's "Done when" (line 126): `~/.ssh`, `curl`, `sh -c`, `grep -r /`, writing an API
  key, `dangerouslyDisableSandbox`.
- `01` §7a lines 714–719: a third, shorter list.

**Problem:**
- The unit that proves the boundary doesn't test reading the signing key, a branch-provided hook
  or Glob outside the project. Those are the attacks D-17 and D-30 rest on.
- There are three lists, and they disagree.

**Fix:**
- Keep one list (D-30), referenced by `01` §7a and unit 13.
- Add the AR2-1 cases: write `.git/mirai/**`, `git config core.hooksPath`, read the launch token,
  edit `.mirai/config.user.toml`.

### AR2-19 · Major · Native subagents bypass the launcher's recursion guard, budgets and log

**Where:**
- `04` D-12 lines 282–288: the guard covers `mirai agent run` only, and cites mattpocock's 50+
  spawned agents.
- `04` D-12 line 250: "Native subagents can come later".
- `03` §3 line 107: the blocking-rules list doesn't deny Claude's Task/Agent tool.

**Problem:**
- A headless developer or reviewer session can still spawn native subagents. Their turns,
  models and spend aren't capped or logged per agent.
- That weakens "one logging point, one budget point" (D-12) and the Q5 cost concern. It's the
  exact incident the guard cites. Round-1 AR-10 fix 2 isn't applied.

**Fix:**
- The strict bundle denies the native subagent tool in headless runs (`--disallowedTools`, or
  a deny rule).
- The red-team test checks it.
- If a skill needs parallel lenses (high-risk review), the orchestrator launches them as
  separate `mirai agent run` calls.

### AR2-20 · Major · You can't take over a MIRAI branch by hand

**Where:**
- `04` D-16 lines 405–407: any code change invalidates the record.
- `03` §3 line 105 and `04` D-15: the gates apply to any branch with `Mirai-Ticket` commits.
- `02` (h) line 427: `built → in_progress` only with a granted agent budget.

**Problem:**
- As a solo developer you'll often fix one line on a MIRAI MR yourself. That commit changes the
  patch-id. `pre-push` and CI then block the branch until MIRAI re-reviews it.
- No state or command lets you take the ticket over, or waive the gate with a signed reason.
  That pushes you towards `--no-verify`, which M9 counts as a bypass.

**Fix:**
- Add `mirai takeover <ticket>`, a human-only signed event. It marks the branch human-owned:
  - gates switch to the human-branch rules (secret scan only);
  - the MR line becomes `Review: PASS (MIRAI) + human changes after review`;
  - the ticket leaves the loop (status `human`, derived `done` on merge).
- Alternatively, `mirai review <ticket>` re-binds a record after your change.

### AR2-21 · Major · Data-driven definitions (D-37) have no unit; the status model contradicts per-type machines

**Where:**
- `04` D-37 lines 933–937: document types and agents are definitions with a schema.
- `03` line 69: "One table of document, ticket and release states".
- `07` units 03, 06, 07–09 and 27–28 build the status model, lint and templates.
- No unit builds a doc-type registry or an agent manifest. Only the tool profile (unit 11) and
  the connector contract (unit 33) appear.

**Problem:**
- The lint (06) and the status model (03) come before any registry. They'll be written against
  hard-coded types, which is the AR-15 risk.
- D-37's "state machine per document type" also contradicts "one table".

**Fix:**
- Make unit 03 "status model + doc-type registry" (`framework/doctypes/<type>.json`: id
  prefixes, template + version, protected sections, checklist, lint rules, machine, upstream
  types, trace rules, storage default). Units 06 and 38 read the registry.
- Unit 15 defines the agent manifest (`may_write`, tools, default tier, skills).
- Say that one shared machine is the *default* that a type may refine.

---

## Minor

### AR2-22 · Minor · `obsolete` is used but doesn't exist

`03` line 200, `01` line 1120, D-46 line 1149 and unit 50 retire `superseded`/`obsolete`
documents. The document machine (`02` (h) lines 392–403) and D-07 have no `obsolete`, and
`dropped` isn't listed as retired. **Fix:** add `approved → obsolete` (human only) to the
machine, or replace "obsolete" with `dropped`. The retired set is `{superseded, obsolete,
dropped}`.

### AR2-23 · Minor · No run-level state machine

Usage-limit pauses (`01` §8 line 767 "`paused: usage-limit`"), the `run.stop_by` stop, circuit
breaker trips, the run lock and the heartbeat are described, but there's no run machine
(`running → paused → resumed | stopped | broken`). The PRD work item's `live` state (`01`
line 1049) has no machine either (AR-21, still open). **Fix:** add a run machine and a work-item
machine to `02` (h) and unit 03, or drop the work-item state as derived (see AR2-7).

### AR2-24 · Minor · Committed artifacts with no path in the layout

The exported run-log lines (D-29, `01` line 1187) and `reports/` (`01` line 1066, `02` (g)
line 366) are committed, but `03` §8 has no path for either. It also doesn't say whether they're
in the `code_paths` exclude list, or how one-file-per-MR avoids merge conflicts. **Fix:**
`.mirai/runs/<ticket>/<run-id>.jsonl` (one immutable file each, excluded from `code_paths`).
Reports go to the store, per AR2-7.

### AR2-25 · Minor · Retention edges

- **The clock:** it's "90 days after the merge" (D-46). Dropped and closed-unmerged tickets have
  no merge date.
- **Trust roots:** `trust/<base-sha>/` snapshots pile up with no retention rule.
- **Compaction:** the optional monthly compaction destroys per-ticket rows, so M16 slicing and any
  change to a metric definition can't be recomputed. That conflicts with "log every raw field"
  (D-38).

**Fix:**
- Retention runs from `resolved_at` (merged, dropped or closed).
- Trust roots are kept while a ticket references them.
- Compaction keeps the exported lines in git (AR2-5) as the raw source.

### AR2-26 · Minor · Leftover contradictions between documents

- `06` §G "Other" line 530: "Usage-limit hits park the remaining tickets". D-18 and `01` §8 say
  *pause* ("your decision, 2026-10-21"). Add a note in `06` that it's superseded.
- `01` frontmatter says `version: 2` while it applies Q1–Q9 (line 20). The others are version 3.
- `00` Q7 line 166: "control data always stays in the repo: … run state". It's now local
  (R-C4, Q9), and the "Changes" section doesn't say so.
- `03` §5 line 159: `mirai-qa` posts the ticket comment (MVP C). `07` puts it in Later #2, after
  the first tracker connector.

### AR2-27 · Minor · The connector contract is missing verbs for what's planned

Q9 posts a QA comment and screenshots. The contract has only `setup/write/read/query` + status
map (`03` §7 line 218, D-36). There's also no idempotency key (round-1 AR-14 fix 2). **Fix:** add
`comment`/`attach` verbs, with capability flags, and an idempotency key `item@version`.

### AR2-28 · Minor · Test baseline: who ratchets it?

`test-baseline.json` is in `.mirai/context/` (`03` line 236), a protected path. When a ticket
fixes a known failure, the baseline isn't shrunk, so the test can break again unnoticed. Updating
it in a ticket forces `high` risk. **Fix:** `mirai gate baseline --shrink` is run by the
orchestrator after merge detection (tier 0) and needs your approval. The baseline only ever
shrinks automatically.

### AR2-29 · Minor · Merges into `feature/<epic>`: who runs them, and is the branch protected?

D-33 says you approve each merge, batched in `inbox` (`03` line 79). `02` (a) line 66 says "You
merge". If MIRAI runs the merge after your inbox approval, D-22 should say so. Either way,
`feature/*` needs the same required check as `main`, or the gate doesn't apply there. **Fix:**
state the merge runner and add `feature/*` protection to setup and `doctor`.

### AR2-30 · Minor · `resources` commits cloud IDs and internal URLs into the project repo

D-42 #5 puts account and project IDs and console links in committed `config.toml`. A personal
project may be a public repo. **Fix:** allow `resources` in `config.user.toml`, and have setup
ask when the repo is public.

### AR2-31 · Minor · Stacking with squash merges

The patch-id survives a clean rebase (D-16), but after A is *squash*-merged, a plain rebase of B
replays A's original commits. **Fix:** spec unit 47 as `git rebase --onto <new-base> <A-head> B`,
and test it with squash, merge and rebase strategies.

### AR2-32 · Minor · The launcher's input contract

Round-1 AR-10 fix 1 ("`mirai agent run <role> --item <id>` takes no prompt; the CLI builds it")
isn't stated. Without it, an author can shape its own verifier's input (`02` (d) lines 214–215).
**Fix:** one sentence in D-12 and unit 15.

### AR2-33 · Minor · Leak scanner in the MIRAI repo

`03` line 86 runs the scanner in MIRAI's own pre-commit. There's no project block list there,
only the generic detectors. **Fix:** say so, so nobody assumes project names are caught upstream.

---

## Round-1 Architect findings: status

| ID | Status | Note |
|---|---|---|
| AR-1 | Fixed | Patch-id, head.sha, happy-path "Done when" in unit 17. Regressed for E2E files (AR2-2). |
| AR-2 | Fixed in shape | Trust root, protected paths, base lock. Location (AR2-1), stacked base (AR2-9) and gitignored inputs (AR2-10) are open. |
| AR-3 | Fixed | Two kinds of state, derived `built`/`done`. Ticket status home (AR2-6) and document branches (AR2-7) are open. |
| AR-4 | Mostly fixed | Generated files are in the lock. The GENERATED header and the ownership classes are missing (AR2-17). |
| AR-5 | Partly fixed | 3-way merge and deterministic migrations. "Never touch config" still contradicts migrations (AR2-14). |
| AR-6 | Mostly fixed | Scan last, fresh branch, generic detectors. Block-list location isn't stated (AR2-17). |
| AR-7 | Partly fixed | `both` removed. External status authority and the approved content hash are dropped (AR2-13, AR2-16). |
| AR-8 | Partly fixed | Frozen version + draft beside it. No content binding, vague version naming, ID-level stale diff missing (AR2-13). |
| AR-9 | Partly fixed | One chain and `mirai trace`. Lite PRD IDs, NFR verification, ID stability and TEA classes are open (AR2-12). |
| AR-10 | Partly fixed | Write-scope check, token guard. No-prompt input (AR2-32), native subagents (AR2-19), token readable (AR2-1). |
| AR-11 | Partly fixed | HMAC signing, restated honestly. CI verification can't work (AR2-3). |
| AR-12, AR-13, AR-14 | Fixed | AR-14's idempotency key is missing (AR2-27). |
| AR-15 | Decided, not scheduled | D-37 exists, but there's no registry unit (AR2-21). |
| AR-16 | Half fixed | Bundle rendering yes. Interactive sessions not covered (AR2-15). |
| AR-17 | Moot | No worktrees in the MVP. |
| AR-18 to AR-20, AR-22 to AR-28 | Fixed | |
| AR-21 | Partly fixed | Release machine added. Work-item and run machines, `obsolete`, and the light context approval path are missing (AR2-22, AR2-23). |

## `08` agreements: reflected?

Q1, Q4, Q5, Q7 and Q8 are applied consistently across `01`/`03`/`04`/`07`. The exceptions:
- **Q2:** the customization mechanics clash with D-05's hook points and with `update` (AR2-14).
- **Q3:** the workspace state model isn't worked out (AR2-4).
- **Q6:** E2E authoring after review breaks the records (AR2-2). Journey IDs are missing (AR2-12).
- **Q9:** local-only files remove the trace's CI inputs (AR2-11) and portability (AR2-5). The QA
  comment's milestone is inconsistent (AR2-26).

---

## What's good, keep

1. **Two kinds of state with derived `built`/`done`** (D-06). It's the right backbone. Every
   finding above refines *where* state lives, not *whether* to split it.
2. **Patch-id records over code paths with `head.sha` in CI** (D-16). This makes stacking cheap
   and the gate tool-independent. Extend the same idea to E2E paths (AR2-2), don't replace it.
3. **The trust root plus `--setting-sources user --settings … --strict-mcp-config`** (D-12,
   D-30). A branch can't bring its own rules. With the store moved (AR2-1) it becomes a real
   boundary under D7.
4. **The loop guard as a library used by documents and code, with counters saved before each
   launch** (D-18), and the findings schema with a resolvable `basis.ref`. Still the strongest
   part of the design.
5. **Strict templates with a `template_gap` signal** (D-41). This turns padding into data. Keep it,
   and make customization a delta so it survives updates (AR2-14).
6. **Commit-trailer scoping and the brownfield ratchet** (D-15, D-45). These let MIRAI live next
   to human developers and messy repos.
7. **Honest residual-risk statements** (D-17, D-30). Keep the habit when AR2-1 and AR2-3 change
   what can be claimed.
