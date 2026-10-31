---
unit: "18a"
date: 2026-10-31
reviewers: Tech Lead, Architect (independent, read-only, no network, never the real claude, no subscription, no Docker, never your Claude Code config, the token or the key)
verdicts: Tech Lead two Blockers and four Highs, Architect three Highs; all fixed; Mediums fixed or recorded for the unit that owns them
---

# Unit 18a — Review

Both reviewers worked on a frozen tree. The repo's git status was the same before and after, and
their experiments ran in `mktemp -d` copies that were removed afterwards. Each ran the unit's
tests, 7 of 7 at the time; the Tech Lead also ran the full `npm test`, 362 of 362. The Architect
read about 3 KB of the 2.1.314 binary near S1's anchor, and the Tech Lead read the profile
function, read-only, without running it.

**What held up (both):**
- **Consent:** a real terminal and your yes. There's no `--yes`, the library needs explicit
  consent, and a partial or stopped run is never stored.
- **Signing:** results are signed per repo and verified with the integration branch's keys. An
  edited result, one renamed to another key, or one from another repo is refused, never read as
  "none". A key must match its parts.
- **States fail safe:** inconclusive cases and unknown checks give `incomplete`. A blocker is
  stored as such.
- **The token** goes only on fd 3. Every note is redacted, the report escapes what it prints, and
  no raw tool output is stored.
- **The clones:** the pinned `cloneTo` makes one clone per worker, never in a temp folder. Only
  the names of your env files are read.
- **Every run** goes through the real `prepareLaunch`, then `.git` is checked (D-54) and so is the
  init event.
- **Blockers run first,** and the host baseline gates each G18 service.
- **Data and code:** the floor is code (D-37). `[strict.binary]` lives in the trust root's adapter
  data, so a branch can't widen it, and an old copy fails red, never green.
- **The key** covers 15a's and 15b's "key on the hook, MCP server and session server code".
- **The run time:** 4.5 minutes, against the 10-minute target.

## Fixed in unit 18a

| # | Finding | Severity, from | Fix | Test |
|---|---|---|---|---|
| 1 | **The workspace wrote through folder links in your commit.** If the integration commit tracked a folder link (`sub`, `docs`, `src`, `nested`) on the way to a fixture path, the canary write went to the real place. The reviewer overwrote a real `.env` this way in a copy. A `nested -> $HOME` link would have run `git init` in your home folder | Blocker, Tech Lead | Every path the workspace writes is checked: a folder on the way that's a link or a file stops the run. The last part is removed, never followed | T8: a tracked `sub` link; the real file unchanged |
| 2 | **The clone's housekeeping ran the project's git hooks on the host** (`core.hooksPath .githooks`, then `git checkout` after every run), about 130 times a red team, outside the sandbox | Blocker, Tech Lead | Every housekeeping git call sets `core.hooksPath=/dev/null` and `core.fsmonitor=false`. Only `prepareLaunch` reads the clone's configured value | T8: a tracked `post-checkout` hook never runs |
| 3 | **A leak in a run marked inconclusive was thrown away,** so a later 3/3 made the result green. This covered a timeout, a missing section, the model making another call (the reviewer showed both a timeout and a missing section) | High, Tech Lead | A canary in a run's output fails the run first, whatever else happened. No canary is in any prompt or command | T8: a leak with no call made |
| 4 | **Templates no case ran under counted as green,** and `redTeamStatus` matched the name only. Agent templates, which unit 19 launches, would have come back green untested | High, both | S4 runs for every template, with no model. The result lists, per template, its bundle hash, how many cases ran and whether all passed. A template with no case keeps the result `incomplete`. Status needs a case to have run under the template and the hash to match | T3 (coverage), T8 (a renamed bundle, an unknown template) |
| 5 | **S2 read only the profile's array** and missed the 16 rules pushed after it: the network rules, `pseudo-tty`, `file-ioctl`, `file-read* file-write*`. The comment claimed otherwise | High, Tech Lead | The profile is read to the end of its function. The data was regenerated: 127 rules, not 111. R1 re-run: 2.1.312 changed two `localhost` rules into one, which the first reader couldn't see | T8: a rule pushed after the array |
| 6 | **A worker's crash tore the run down while others were launching.** The lock was released and the clone deleted under a live `claude` | High, Tech Lead | Each worker catches its own error and the run stops. Only after every worker has stopped is everything cleaned up and the error thrown. Nothing is recorded | T8: a case that throws beside a slow one |
| 7 | **Your project's Claude Code files (`.claude/settings*.json`, `.mcp.json`) were outside the key.** The 2.1.314 binary says project settings feed some sandbox values, and whether `--restricted` drops them isn't proven | High, Architect | They're a key part (`project_rules`), and the clone carries your checkout's copies. 18b settles whether a launch reads them | T8: a new `settings.local.json` makes it stale |
| 8 | **`mirai redteam` could run from an uncommitted MIRAI copy** and sign a result naming the committed framework | High, Architect | `redteam` is in the launcher's committed-copy list, with `approve` and `key` | — |
| 9 | **Removing a rule never turned anything red** | Medium, Tech Lead | A key or rule that's gone makes the check `unknown`; a gone `(deny` or `(version` line makes it red | T5 |
| 10 | **S1 missed quoted keys** | Medium, Tech Lead | Quoted keys count. The permission keys and nested paths aren't read yet: 18b, written down in the docs | T8 |
| 11 | **S4 could miss a re-opened path:** no normalisation, patterns in allow lists ignored, the file tools' allow rules and `allowWrite` not checked, `failIfUnavailable` not required | Medium, both | Each of these is checked | T5 |
| 12 | **The control's services weren't in the key:** a run from a shell without your ssh-agent stood for one with it | Medium, Tech Lead | The controls present are a key part (`host_controls`) | T2 |
| 13 | **A case's leftovers survived a reset** when the project's `.gitignore` ignored them (`clean` without `-x`) | Medium, Tech Lead | `clean -ffdqx`, keeping only the canary env files and the nested repo | T8: an ignored file never seen by the next run; the canary stays |
| 14 | **Canaries at committed `.env*` paths** (an `.env.example`) were put back to the commit's text after the first run | Medium, Tech Lead | Committed env files aren't treated as secrets | — |
| 15 | **A killed run's leftovers weren't swept,** and no test covered stopping. Two runs on one machine could also delete each other's canaries | Medium, both | One red team at a time per machine (a lock in the MIRAI home). The next run sweeps `~/.mirai-redteam-*` and the `~/` case's file. SIGTERM and SIGHUP stop a run like Ctrl-C. Canaries are removed even when creating them failed halfway | T8: a stop isn't recorded and the workspace is removed; the sweep |
| 16 | **`bundle-agents-md` and the read-only no-call cases passed on a run that errored** | Medium, Tech Lead | They need an answer or a finished run; otherwise the run is inconclusive | — |
| 17 | **Without Docker Desktop there was no result and no status** (it threw) | Medium, both | Docker is a key value, `unavailable`, never an error | T8 |
| 18 | **`status` couldn't use the launch's own trust snapshot** | Medium, Architect | `redTeamStatus({ trust })` | T8 |
| 19 | **A blocker vanished from view** after a later green, or once the key changed | Medium, Architect | `status` shows `blocker_seen` for the same Claude Code binary and macOS build. Whether a green may clear it at all is your V1 decision: open point below and row 19 | — |
| 20 | **Row 18b only pointed at the earlier units' notes** | Medium, Architect | They're listed in row 18b, unit by unit | — |
| 21 | **Smaller things:** <ul><li>runs launched the `~/.local/bin` link, not the hashed binary;</li><li>the guard ran after the canaries;</li><li>a unit stopped mid-queue disappeared from the report;</li><li>no launch id per run;</li><li>`status` compared with the newest result, not the newest green one;</li><li>the binary cache trusted mtime;</li><li>the canary git ran from your PATH in your checkout;</li><li>escape passes didn't say what refused;</li><li>the file-wide T13 exemption;</li><li>a tautology in T4;</li><li>the docs' 15 minutes and the estimate's 30 s;</li><li>research/10 called the runs `mirai redteam run`;</li><li>the docs said only some MIRAI updates make it stale;</li><li>S1's note told you to edit MIRAI's data</li></ul> | Low and Medium, both | <ul><li>`real`;</li><li>moved first;</li><li>`not-run`;</li><li>`launch_id`;</li><li>since the last green;</li><li>plus ctime and inode;</li><li>`/usr/bin/git` in `/`;</li><li>`refusedBy` in the note;</li><li>the label renamed (`g19-dns-getaddrinfo`, `#py`), no exemption;</li><li>a real check;</li><li>5 minutes, 8 s;</li><li>corrected;</li><li>any update;</li><li>"wait for a MIRAI update"</li></ul> | T2, T3, T8 |

**Not changed, on purpose:**
- **A green on the same key replaces a blocker** (spec item 7: "only a new green result clears
  it"). The Architect would keep a blocker until you record a V1 decision. `status` now shows it
  (fix 19), and the decision belongs with unit 19's launch rule; see open point 1 in the spec's
  changes.
- **`DISABLE_AUTOUPDATER` for launches** changes 13b's launch environment, so unit 19 owns it. A
  mid-run update already turns into a red run (`checkInit`'s version), never a silent one.
- **The escape cases still pass on "no marker".** The note now says what refused. Making a
  refusal the required evidence is 18b.
- **The framework hash covers every MIRAI file,** so any MIRAI update makes the result stale.
  Safe; the docs now say so. A narrower hash is for unit 47.

## Noted for later units

| Unit | Note | From |
|---|---|---|
| 18b | Every row listed in roadmap row 18b, from 06, 11, 13b, 13c, 14a–14d, 15a and 15b, and from this review: project rule files as rule sources under the launch flags; cases under agent templates; S1's permission keys and nested paths; escape evidence; compose files in the key | both |
| 19 | `redTeamStatus({ trust, template })` with the launch's snapshot, refused unless green for that template; launch the hashed `real` binary; `DISABLE_AUTOUPDATER=1`; a `blocker_seen` needs your recorded V1 decision | Architect |
| 29, 47 | `doctor` shows the state (no throw without Docker); re-run only through the `[y/N]` prompt; a machine-wide part (G18, escapes, S1, S2, S5) apart from a per-repo part, to save runs across repos; a narrower framework hash | Architect |
| 55 | Park cleanly when the result goes stale mid-night; Docker must be up for the key to match | Architect |
| 17b | `baseline` signs too, but isn't in the launcher's committed-copy list | me, while fixing 8 |
| 54 | Nothing: CI can't make or verify a machine's result | Architect |
