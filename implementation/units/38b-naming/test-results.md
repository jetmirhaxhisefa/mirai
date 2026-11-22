# Unit 38b: test results (2026-11-22)

## Tests

- **`test/agent/naming.test.js`** (new):
  - T1: MIRAI's registry has the role `developer` (read-write, step `build`, `may_write` `["**"]`,
    only the name changed) and no `author`; Kai's definition names it; `BUILD_ROLE` is
    `developer`; `RENAMED_ROLES` is `{ author: 'developer' }`;
  - T2: refused, each with `the role "author" is now "developer" (MIRAI 38b): write role =
    "developer"`: an agent overlay with `role = "author"` (not applied); `findRole` for `author`
    (what `mirai agent run --role` and the broker's `start_agent` use), even on a copy that still
    has it; `.mirai/custom/roles/author.toml` (`renamed-role`); and `mirai agent run --role author`
    through the CLI, before anything launches;
  - T3: a role set with `author` and no `developer` (a framework copy from before 38b) refuses the
    build role with `this project's MIRAI copy is from before unit 38b (it has the role "author",
    now "developer"): run mirai init --refresh, and commit it` (`old-framework-copy`); a set with
    neither is a plain `unknown-role`; an old copy's agents (no persona) are named by id;
  - T4: an `agent_run` line with `"role": "author"` still validates (`buildRunLine`); the run
    report still says "Kai's build"; a report saved before 38b (no `agent` on its steps) renders as
    it did;
  - T5: the sample app's approved Rex overlay (tools only, Bash added) is a `widening` with
    `overlayHash` `sha256:a0d673c4…5e08`, the same hash `main` before 38b (6a56e7a) computes from
    the same bytes, so its signed approval stays valid; the persona carries through;
  - T6: every agent in MIRAI's registry has a persona (Kai, Rex); the namer gives
    "Kai (mirai-developer)" once, then "Kai", and the same for Rex; Markdown gives
    ``Kai (`mirai-developer`)``; an id with no persona is its id; the reviewer refusals read
    `Kai (mirai-developer) never runs under the reviewer role: who writes a change never reviews
    it` (code `author-reviews` unchanged) and `only Rex (mirai-reviewer) reviews; …`; an overlay
    with `persona` is refused (`persona: an agent's persona is MIRAI's (Rex); an overlay can't
    change it`); a registry whose persona isn't one capitalised word is refused;
  - T7: `hostWords('github')` is pull request / PR / `#16`, `('gitlab')` merge request / MR / `!16`,
    `(null)` GitLab's words with no host; `wordsFor` from the config and remote (github.com,
    gitlab.com, a self-hosted GitLab named in config, no remote, a host it can't tell); a host
    object's words; the run report's ticket line says "PR open …" for a GitHub report;
  - T8: a source check over `src/`: no string outside `src/ship/words.js`, `src/ship/gitlab.js`
    and the lint's acronym list says "merge request" or "MR"; no string says Kai or Rex (comments
    and the two sentences of Kai's fix prompt that talk to the agent are left out, as the spec says).
- **`test/run/run.test.js`:** T6 end to end: `mirai run` (driveTicket, stand-in claude, one namer as
  the CLI passes it): the plan run's progress names "Kai (mirai-developer)" once; after your
  approval, the build-and-review run's first Kai line is `Kai (mirai-developer): preparing the
  launch …`, every later one "Kai (Sonnet) …"; Rex the same; the run log's launches are
  `mirai-developer`/`developer`/`build` and `mirai-reviewer`/`reviewer`/`review`. 29a's report
  test: the saved Markdown says ``Kai (`mirai-developer`)'s plan`` (earlier run), then "Kai's
  build", and ``Rex (`mirai-reviewer`)'s review``; with no origin remote the step reads "MR !7
  opened" (an unknown host takes GitLab's words).
- **T7 through the commands** (stand-in gh and glab):
  - `test/store/docs-publish.test.js`: `mirai docs publish` prints `pull request #1: https://github.com/…`
    on GitHub (38's P2 printed "merge request 16") and `merge request !1: https://gitlab.com/…` on
    GitLab; GitHub's refusals and waits say "docs pull request";
  - `test/ship/ship.test.js` and `gitlab.test.js`: ship's line is `PR #1` on GitHub and `MR !1` on
    GitLab;
  - `test/review/review-mr.test.js`: the packet's head line is `PMT-31 · PR #1 open · …` (the host's
    words), and `mirai merge` says `merge PMT-31's pull request #1 …` and `merged: PMT-31's pull
    request …`.
- **Changed pins:** the role list (`developer`), the cage's root `registry/roles/developer.toml`,
  `mirai status`'s "why" (MR in the fixtures, which have no origin remote), the lone ticket's
  refusal ("a ticket's code merge request"), and every test launch's `role: 'author'`.
- **T9:** the docs check (`test/docs/coverage.test.js`, 14/14) passes; the full suite: see below.

## The full suite

Through the build runner, `u38b-tests-2` on a635ee2: **767/767 pass** (13.1 min). (`u38b-tests-1` was withdrawn before it ran: its commit still had 24a's registry test checking `roles.author`.)

## The red team

The cage changes: `registry/roles/author.toml` → `developer.toml`, `src/agent/run.js`, and two new
cage files, `src/agent/persona.js` (the pure full-name helper `run.js` uses, so the registry folder
stays out of the cage) and `src/ship/words.js` (reached through `src/status/derive.js`). The
sample app's red-team pass goes stale with the refresh; a `redteam-full` run is due before
approval.

## Probes (real)

- **P1, the Kai launch: passed with Jet (2026-11-22).** `test/probes/build-probes.js --yes --probe r1`
  from this branch's worktree (a sample-app clone refreshed to 38b, Haiku, `--step commit-message`):
  `r1-naming: role developer; first progress line: Kai (mirai-developer) (Haiku): started`; the
  handover came back ok, 4 turns, 1.15 min, model Haiku.
- **P1, `mirai docs publish`: prepared, not run yet.** The sample app's checkout is shared with the
  build runner (its main is refreshed and pushed by u39's jobs), so `test/probes/naming-probes.js`
  works in a clone of its own: a probe HOME (its own MIRAI store; the sample app's store and
  checkout are never touched), MIRAI refreshed from this checkout and committed on the clone's main
  only (never pushed), and a new initiative `naming-38b` (one brief, MIRAI's example) in the work
  tree. `due-dates` is merged already (PR #16), so the probe publishes the new initiative instead:
  one docs branch and one pull request on the sample app's GitHub repo, to close afterwards; main
  is never changed. Checked here with `--publish --dry` (a stand-in gh over a local bare copy of
  the host's main): `docs publish naming-38b: opened`, `pull request #1: …`, the docs commit on the
  host's main holding only `docs/mirai/naming-38b/brief.md`, PASS; the sample app's checkout stayed
  clean. Found while preparing it: MIRAI reads its trust root only when main is level with
  origin/main, so the clone's origin/main is set to its own refreshed main; the docs branch still
  starts from the host's real main (`refs/probe/host-main`, fetched again at the publish).
