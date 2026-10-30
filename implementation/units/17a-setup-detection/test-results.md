---
unit: "17a"
date: 2026-10-30
result: 347 tests, all passing after the review fixes; probe D1 settled by 2 runs on the sample app (a path replaces a suite, so suites are facts only); git probes through MIRAI's calls 38 / 38; mirai detect on a sample-app clone matches the hand-written config; nothing left in Docker
---

# Unit 17a — Test results

## `npm test`

**345 tests, all passing** before the review (load average about 10 to 16). **347 after it, all
passing** (load average about 6), with no flaky timing failure in either run.

Unit 17a adds 13 tests in one new file (11 before the review, 2 for its fixes), and extends three:

| File | Tests | What |
|---|---|---|
| `test/detect/detect.test.js` | 11 | **T1:** the walk reads the integration branch's commit from git objects: a work-tree edit, an untracked file and `.env` don't count; `.mirai/` is left out; a link and a gitlink are listed, never read; the file and read limits; too many files. **T2:** stacks from markers at any depth, packs, checks from scripts and dependencies; a project's own stack from the trust root; a broken one and a core name are `bad-stack`; the schema (scripts or a dependency, `{script}` only with scripts). **T3:** compose resolved from its own folder with an empty `--env-file` (a canary in `.env` never reaches the facts), the work folder removed; mounts of the socket, your home folder (written as `~`), `.git` and outside the repo; a prescan refusal, a link, no file, no Docker. **T4:** the closest mount, `workdir`, `oneoff`, ties; the commands' order and conditions, the package check, suites, name clashes, a marker no service mounts, a missing `report_root`. **T5/T6:** checks in their service, names made unique across levels and checks, duplicates dropped, task-runner and CI files listed; `worktree_safe`'s three reasons. **T7:** the branch pattern (dominant, mixed, too few, remotes with a `/`, lowercase keys), the commit format and trailers, G8's outcomes; through git, a repo whose config sets a pager and an fsmonitor: neither runs. **T8:** what's read in Markdown (code spans, fences, `$ ` lines, MIRAI's block skipped, prose not), JSON (`command` with its `args`) and plain text; the caps; code spans in linear time; every named file and folder; too large, binary, MIRAI's unchanged files. **T9:** the draft validates and comments its sources and gaps; the differences; `mirai detect` and `--json`; the repo unchanged; ten runs kept; not installed; control characters from the repo escaped in the report. **T10:** the detection probe stays local; D1's scenarios; detection's only Docker call is `compose config` |
| `test/tests/test-run.test.js` | (extended) | 14c's T13: `src/detect/` holds no stack names either |
| `test/cli/cli.test.js` | (changed) | The pinned command list has `detect` |
| `test/probes/git-probes.js` | (extended) | MIRAI's calls now include `changedLines` (16b's, never added), `branchRefs`, `commitMessages`, and `lsTree` with sizes |

The fixture (`test/detect/fixture.js`) is a repo shaped like the sample app, with no personal
data.

## Probes

**D1, the PHPUnit suite levels: 2 container runs on the sample app** (Docker only, no
subscription; the d- scenarios in `test/probes/adapter-probes.js`), through the shipped `phpunit`
adapter on a throwaway clone:

| Run | Result |
|---|---|
| `d-suite-path`: a `--testsuite=Unit` level given `backend/tests/Feature/TaskApiTest.php` | pass, 7 tests: the Feature file's. The path **replaced** the suite |
| `d-suite-test`: a `--testsuite=Feature` level given one test ID | pass, exactly 1 test |

So, as the spec decided for this case, suites are facts only and the draft keeps one level per
runner (research/12, D1). Nothing was left in Docker.

**The git probes through MIRAI's own calls** (`test/probes/git-probes.js --mirai`; host git on
hostile fixture repos under the home folder, no Docker, no network): 38 / 38 pass, run twice
(before and after `lsTree` gained sizes). The new calls ran on every probe repo that wasn't
refused, and nothing fired.

**`mirai detect` on a clone of the sample app** (`test/probes/detect-probes.js`; this checkout's
MIRAI by `init --refresh` in the clone; `docker compose config` only, no container):

```
stacks: node (e2e/package.json, frontend/package.json); php (backend/composer.json)
compose: docker-compose.yml, services app, frontend, mysql, nginx, playwright
levels:
  unit: php artisan test in app at /var/www/html, adapter phpunit (backend/phpunit.xml; suites Unit, Feature)
  e2e: npx playwright test in playwright, adapter playwright, report_root e2e/tests (e2e/playwright.config.ts)
  frontend-unit: npm test -- in frontend at /app, adapter vitest (frontend/package.json)
checks:
  lint: npm run lint in frontend at /app (frontend/package.json scripts.lint)
  build: npm run build in frontend at /app (frontend/package.json scripts.build)
  format: vendor/bin/pint --test in app at /var/www/html (backend/composer.json lists laravel/pint)
worktree_safe: false (a fixed project name, mounts of the checkout, host ports 8180 and 8100)
branch pattern: none found (0 branches)
commits: free (12 read)
G8: no rule in the repo: ... a rule on the code host (a ruleset, a push rule) isn't seen from here
agent-instruction files: 5, 1 rendered by MIRAI and unchanged; 0 commands flagged
```

(Run again after the review fixes: the fifth file is `.mirai/context/agents-local.md`, and G8 is
worded as above. "0 branches" is the probe's doing: it removes the clone's `origin`, and the sample
app has only `main`.)

**Against the config you wrote by hand:**
- **The same commands and services** for `unit`, `e2e` and `lint`. The draft adds what 16a
  recommended (the adapters, `report_root = "e2e/tests"`, Vitest's `npm test --`), the
  `workdir` (the compose file doesn't name the app's working folder; the image's isn't read,
  since that needs Docker running), and two checks you don't have (`build`, Pint's `format`).
- **The Vitest level is `frontend-unit`,** not your `frontend`: PHPUnit's suggestion took `unit`
  first. The report shows both names.
- **G8 on the sample app:** no rule in the repo and a free format (`no-local-rule`); rules on the
  code host aren't visible, so unit 22 settles it.

The report, draft and facts are kept outside the repo, in `~/.mirai-16a-corpus/17a-detect-*`.

## After the review

**347 tests, all passing.** The two added tests cover:
- `agents-local.md` read, `@` imports followed (and a missing one), blob ids, a linked file;
- G8's wording, and too few commits as `check`;
- names and values the config can't hold (a spaced folder, services named `1web`, `_x`, `App.Svc`);
- `label_file` refused by the prescan; container names, external networks and a quoted `name:`;
- the env file Compose gets read at call time (empty) and Docker's environment (four keys);
- the configured env file winning, deeper branch prefixes, the gate-script data names pinned, and
  a failed run leaving no folder.

The first T8 test now also covers MIRAI's block (closed and matching, unclosed, changed), the
JSON keys from the data (`allow` read, `deny` not, the always-flagged keys), `.mdc` as data, prose
lines and counted long lines. T3, T5 and T7 follow the fixes (`~` paths, no Composer `format`
check, G8's states).
