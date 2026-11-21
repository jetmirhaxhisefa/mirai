# Unit 36: test results (2026-11-20)

## Tests

- **`test/documents/context.test.js`:**
  - T1: each of the five types has no summary check (decision 1). Its template, left as it is,
    fails as leftover text only, and its checklist exists. The seven examples (business,
    journeys, feature map, and project and conventions for `frontend` and `backend`) lint clean,
    with no warning, against the sample app's fixture copy and its named checks. The business
    type's cap is 1,000 words, warning at 800, the Sources table not counted;
  - T2: `business`: a bullet with no source fails ("this bullet has no source"), and so does a
    claim written as a paragraph; `S-9` not in the table fails and the unused `S-6` warns; an
    added `S-7` nothing cites warns; a "you said" row with no date fails; a row with no link,
    file or "you said" fails; a file source that doesn't exist fails. About 850 words warns, about
    1,050 fails; a Sources table over 1,000 words more changes nothing. `business_words = 1200`
    moves the cap, and 820 with a warning at 700 fails the 850-word file. The config takes both
    keys, refuses 99999, 10 and 5, and refuses them in a personal file;
  - T3: `journeys`: a journey with no `J-n` fails (and the next one isn't reported too), even
    with no repo; `J-1`, `J-3` fails ("J-3 should be J-2"); a repeated `J-1` fails; no "Why
    critical:" line fails; one with no source fails; no steps fails; an E2E file that doesn't
    exist fails, `none yet` passes, no "E2E test:" line fails; a step naming the screen "Sign in"
    warns, since the feature map has no such screen;
  - T4: `feature-map`: `data-testid="signin-form"` and `button "Remove"` fail as not in the code
    under `frontend/src`; `knob "Add"` fails as not an ARIA role; the route `/settings` warns.
    `project`: a missing path fails, `npm run nope` fails and lists the scripts, a `root` that
    isn't a folder fails, a missing Dockerfile in the backend's Stack table fails, and a file
    named for another service fails. Through `mirai lint` in a git copy of the sample app, the
    seven examples in `.mirai/context/` lint clean (7 files, 0 problems; `agents-local.md` beside
    them is left alone), and two broken files fail with exactly their two problems;
  - T5: `conventions`: an untagged rule fails; `enforced by eslint-x` fails, listing the named
    checks; a judgment rule with no example warns; a judgment rule naming `tsc`, the `types`
    check's tool, warns. Linted where it lives, with no project, the named check isn't looked up;
  - T6: through the CLI with a signed key: `business.md` with a lint problem is refused before
    any prompt, the problem listed, nothing written; the clean file shows its path and hash and
    writes one signed line (`kind: context`, `file_type: business`, its id and path); an id that
    isn't the file's is a usage error; `feature-map.md` and `project-frontend.md` are refused with
    the reason; `journeys.md` is approved the same way. After a change, `mirai show context`
    lists all seven files with their states and full paths (business "changed since approval",
    journeys "approved", the feature map and both project files "checked, not approved", both
    conventions files "not approved"); a repo with no context files lists each kind as missing;
  - T7: the doctor's check: both files not approved is yellow, with the approve command; both
    approved is ok 10 days later and yellow 200 days later ("business.md was last approved 200
    days ago …, more than 180"); a changed `journeys.md` is yellow, "changed since its approval".
- **Changed tests from 31–35:** `test/lint/templates.test.js` T1 (the twelve types);
  `test/documents/brief.test.js` T5 (the context types have no summary, like an interview);
  `test/doctor/doctor.test.js` 29c (a 19th item, `context`).
- **The fixture:** `test/fixtures/sample-app/`, 28 files copied from `mirai-sample-app` (no `.env`
  file; the README's secrets section is cut, so no canary text is in MIRAI's repo).
- **The full suite:** see the last section.

## Probes (real)

| Probe | Result |
|---|---|
| **P1 Your read** | pass (Jet, 2026-11-21: "Generally ok but not much details. I assume in a proper app will have much more details for every context"): the sample app is small; P2 judges a real app's depth |
| **P2 Thudos** | pass (Jet, 2026-11-21: "36 P2 pass"). A fresh agent wrote the seven files from Thudos's sources; first lint 8 problems, 3 of them MIRAI's (host names checked as paths, fixed in `96ed959`). One fixing round: 0 problems, 10 `(open)` lines (decision 8). Jet answered them (S-6, "you said"), dropped J-2 and settled two contradictions in the template's feature list; final lint 0 problems, 0 warnings. The Thudos files aren't committed (decision 6) |

## Changed from the spec

- **The formats are fixed so the lint can read them:**
  - `business.md`: every claim is a bullet ending `(S-n)` or `(S-1, S-3)`; a plain paragraph
    fails, except "Not applicable — <reason>". The Sources table is `| ID | Source | Where | Date |`;
    "Where" is a link, a file path in backticks, or `you said`. Every row needs a date (when it
    was read, or when you said it), not only "you said" rows. **Added:** a file source that
    doesn't exist fails.
  - `journeys.md`: `### J-n: <name>` under `## Journeys`; `Steps:` and a list; `Why critical:`
    ending with its source; `E2E test:` with a path in backticks or `none yet`. A screen in a step
    is the bold text, `**Tasks**`. **Added:** a repeated `J-n` fails, and a missing "E2E test:"
    line fails.
  - `feature-map.md`: `code:` in the frontmatter lists the folders the handles are looked up in.
    The table is `| Screen | Route | Handles | … |`; a handle is `role "name"` (an ARIA role, or
    `label`) or `data-testid="…"`, with `<like-this>` for a part that changes. Test files are left
    out of the search. A role that isn't an ARIA role fails. The route `/` always passes.
  - `project-<service>.md`: `service:` and `root:` in the frontmatter. Paths are checked in the
    Layout table's Path column, the Stack table's "Set in" column and the Instructions; commands
    in the Commands and Test levels tables' Command column. Other code spans aren't checked, so
    a package name such as `laravel/framework` isn't read as a path.
  - `conventions-<service>.md`: the tag ends the bullet, `(enforced by <check>)` or
    `(judgment)`; the example is an indented `Example:` line. A check's "tool" is its command's
    words without the runners (`npm`, `run`, `npx`, `composer`, `docker` …), so `npx tsc` is
    `tsc`, `npm run lint` is `lint`.
- **"As 17a detects it" is stack data:** each stack gains `[[scripts]]` (a command form with
  `{script}`, its manifest and field): `npm run`, `npm run-script`, `npm test|start|stop|restart`,
  `pnpm run`, `yarn run`, `composer run-script`, `composer run`. The registry schema checks it.
- **The checks against the code and config run only on a real context file:** one in
  `.mirai/context/` under `mirai lint`, or the text `mirai approve` lints with the repo. A
  template or an example where it lives (`registry/`) is checked for its shape only, since its
  paths and checks aren't that repo's.
- **Which files in `.mirai/context/` are linted:** only the five names (`business.md`,
  `journeys.md`, `feature-map.md`, `project-<service>.md`, `conventions-<service>.md`). They're
  linted as strictly as the docs root's files. `agents-local.md` and `sources/` aren't
  documents. **Added:** in `.mirai/context/`, a file's name must match its type and service
  (`context-name`).
- **`mirai approve --file` takes no key for a context file:** `approve`'s positional is now
  optional. An id given with a context file must be the file's; any other file still needs its
  key or id.
- **An approval is bound to the file's path, not its id**, so a context file's id can change with
  an edit. The journal line is `kind: context` with a new field, `file_type`; its `item` is the
  file's id (the key you type to confirm).
- **`mirai show context`:** `context` is read as the context view unless `--full`, `--json` or
  `--docs` is given, so a ticket or initiative named "context" needs one of those. Each project
  or conventions file is its own line; a kind with no file shows its name pattern and "missing".
- **Doctor also reports an approved kind that was never approved** (yellow, with the command), not
  only a stale approval and business.md's age. With no context files it's ok ("setup writes
  them"). The item is named `context`.
- **The registry schema gains `document_words` and `document_warn_words`** for a type with no
  variants (business: 1,000 and 800); `[docs.limits] business_words` (300–3,000) and
  `business_warn_words` (200–3,000) override them.
- **`E2E` is on the writing lint's acronym list**: it's MIRAI's own label in `journeys.md`.
- **The examples' named checks are the sample app's README's** (`lint`, `types`, `format`,
  `composer-validate`, `build`), as setup would write them. The sample app's real
  `.mirai/config.toml` has only `lint`, so its conventions files would fail there today on
  `types`, `format` and `composer-validate` until its config lists them.
- **The examples are seven files**, since the sample app has two services. They live in
  `registry/examples/context/`.
- **The journeys template's "E2E test:" line shows a path**, not "none yet": a real file's
  `none yet` would otherwise be flagged as leftover template text.

## The full suite

`caffeinate -i npm test` on the Mac, after the rebase onto unit 35's latest commit (`aad81c1`):
714/715, 7 tests in `context.test.js`. The one failure is `test/lint/lint.test.js` T12, a
wall-clock check that `scanMarkdown` scans a worst-case text in under 1 second (it took 1,078 ms
under the full suite's load). This unit doesn't change `scanMarkdown`; T12 passes alone. The run
before the rebase (711/715) had it and three other load-timing failures (14c T8, the strict
launch's T5/T6 scratch folder, which unit 35's results also note, and the doctor's item count,
which this unit changed and now fixes). The build runner and CI run on the final commit.

## Rebase onto 34, 34b and 35 (2026-11-20)

**How.** `git rebase --onto origin/main aad81c1` of 36's 8 commits (old head `f9282fc`) onto
main at the PR #92 merge (`bb19c07`), which has the final 34, 34b and 35. A rebase, not a merge.

**Conflicts.** One: `docs/documents.md`, in "docs/context.md; documents.md points to it". Main
(34b) had added "The document types" table and "The lint" sections where 36 added its paragraph
on the context files. Kept both: 36's paragraph after the summary paragraph, then main's two
sections unchanged. Everything else (approve.js, journal.js, registry.js, the lint, doctor,
show, the tests) applied cleanly.

**Double-check against the final 34, 34b and 35.**

- Approval: `mirai approve --file .mirai/context/<file>.md` goes to `approveContext` before the
  `DOCUMENTS` branch, so it never reaches 34's reader-test requirement (`readerFor` /
  `needsReaderTest`) or 35's interview binding (`interviewOf`, briefs only). No reader test is
  asked for (decision 1). The journal keeps 35's `files` on a brief and 36's `kind: context` with
  `file_type` side by side; `reader_test` stays limited to brief, PRD and epic. No change needed.
- Document types: `registry/document-types/` has 35's `interview` and 36's five (`business`,
  `journeys`, `feature-map`, `project`, `conventions`); `BUILT_IN_CHECKS` lists all of them. No
  change needed.

**34b's docs check** (`node --test test/docs/coverage.test.js`) failed T1 after the rebase,
naming exactly:

1. config key `docs.limits.business_words` has no row in docs/config.md;
2. config key `docs.limits.business_warn_words` has no row in docs/config.md;
3. document types `business`, `conventions`, `feature-map`, `journeys` and `project` aren't
   named in docs/documents.md or a page it links (context.md is linked, but names files, not
   types);
4. docs/context.md isn't listed in docs/README.md.

Fixed by documenting each, nothing added to `docs/internal-list.toml`: two rows in
docs/config.md's `[docs]` table (project, defaults 1000 and 800, with their ranges), five rows
in documents.md's document types table, each pointing to context.md, and a line for context.md
in docs/README.md. The check then passed, 14/14.

**The earlier review's three notes.**

- a) BMAD against stack lists and folder trees: stated and resolved in research/15, §2.4 ("The
  tension, and MIRAI's answer": keep the sections, the lint checks every path and every
  command's script, no copied manifests or trees), and in the summary table and §6. One part
  stays open: the Stack table's versions aren't checked against the manifests, only its "Set
  in" files exist (a question for Jet, below).
- b) The sample app's conventions example: `test/fixtures/sample-app/` has no
  `.mirai/config.toml`, by design (it's a copy of mirai-sample-app; setup writes `[checks]`).
  The tests pass the README's five named checks as the config's (`CHECKS`), and T5 shows a name
  missing from them fails (`eslint-x`). In a repo, `projectOf` always gives `checks` (an empty
  table when the config has none), so the check runs; it's skipped only with no repo (a template
  or an example in the registry). So it passes for the right reason. The real sample app's
  config still lists only `lint` (noted above): its conventions files would fail there until
  its config lists the others.
- c) The feature map's handle check is a plain, case-sensitive substring search: each fixed part
  of the handle's value (the parts between `<…>`, `{…}`, `:name`, `*`) must appear somewhere in
  one non-test source file under `code:`; the parts needn't be next to each other, and the role
  isn't searched (only the name). Probed on the fixture: `data-testid="id"`,
  `data-testid="e"` and `button "a"` all pass; `button "Zzzqx"` fails. A handle that's all
  placeholder (`<id>`) always fails. Not changed: tightening it is a behaviour change (a
  question for Jet, below).

**Questions for Jet.** (1) Should the handle check match the value as a whole quoted string or
attribute (`"id"`, `'id'`, `>id<`), or warn on a very short value? (2) Should the project lint
check the Stack table's versions against the files in "Set in"?

**The full suite** (`caffeinate -i npm test`, after the rebase and the docs fix): 728/729. The
one failure was the known `/private/tmp` race in `test/launch/strict.test.js` T5/T6 ("a failed
launch left its scratch folder"); the file alone passed 14/14.


### The handle check matches whole handles (2026-11-20, after the rebase)

The review's note c) showed a plain substring search: `data-testid="e"` passed on any file with an "e". Now a test id must start right after a quote and, when it has no `<part>`, end at one; a role's name must be a whole string or an element's whole text (after a quote or `>`, before a quote or `<`). T4 gains three cases (`data-testid="e"`, `data-testid="login"` against `login-form`, `button "A"`), and the examples still pass against the sample app's fixture.

Left as a follow-up (not a bug): the project lint doesn't check stack versions against the manifests.

### Decision 8: `(open)` for what no source says (2026-11-21, from P2)

On Thudos, the agent cited the README for who pays and how the product makes money, which the
README doesn't say: the template gave no way to write "not known yet". Jet: "If any context is
missing from the data should be a question to the user to fill." A bullet in `business.md`, or a
journey's "Why critical:" line, may now end with `(open)` instead of a source ID: a warning
(`business-open`, `journeys-open`) that names the question, and a failure at approval. `(open)`
in the middle of a line isn't a marker. The templates, the business checklist and
`docs/context.md` say so. T2 and T3 gain the cases; `test/documents/context.test.js` passes 7/7.
