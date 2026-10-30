# Setup detection

`mirai detect` reads your project and writes a **draft config** for you to review. It's a script,
with no AI (unit 17a). It never changes `.mirai/config.toml` or anything else in the repo, and it
never runs your project's code.

```sh
mirai detect           # the report: what it found, the gaps, and how the draft differs from your config
mirai detect --json    # the same facts as JSON
```

**Before you run it:** MIRAI installed (`mirai init`), and the integration branch committed and,
when it has a remote, pushed (local and remote agree; MIRAI never fetches). Detection reads that
commit and its data comes from the trust root, as the test adapters' and the packs' do. So the
order is: `mirai init`, commit and push, `mirai detect`. The differences it lists are against your
**committed** `.mirai/config.toml`: lines you copied but haven't committed still show.

## What it reads

- **The integration branch's commit,** from git objects: tracked files only, so build output,
  dependencies and your `.env` don't count. MIRAI's own `.mirai/` is left out. A link is listed,
  never followed. A nested repo or submodule is listed as a candidate for `[[repos]]`, never
  entered.
- **The compose file** at the top folder, under one of Docker's own names (`compose.yaml`,
  `compose.yml`, `docker-compose.yaml`, `docker-compose.yml`):
  - first through the same strict text check as test runs (no `include`, `extends`, `env_file`
    or `label_file`, so resolving it reads no other file that we know of);
  - then `docker compose config`, in MIRAI's private Docker setup, from a folder holding only that
    file, with an **empty `--env-file`**. Your `.env` is never read, not even to fill in a
    variable. No container starts.
- **Branch names and the last 200 commit messages,** with MIRAI's pinned git (no hook, no filter,
  no pager, no signature check).
- **Agent-instruction files** (below).

## What it finds

| Fact | From | Drafted as |
|---|---|---|
| Stacks | a stack's marker files at any depth (`registry/stacks/`) | `[gate] packs` |
| Test levels | each test adapter's `[detect]`: its config file, the first command whose condition holds | `[[testing.levels]]` with `command`, `service`, `workdir`, `run`, `adapter`, `report_root` |
| Where each runs | the compose service whose bind mount covers the folder most closely; the folder's path there | `service`, `workdir` (left out when it's the service's working folder); `run = "oneoff"` for a service in a profile |
| Named checks | a stack's `checks`: a manifest's scripts (`lint`, `build`, …) or a listed dependency | `[checks]` |
| `worktree_safe` | a fixed project `name`, mounts of the checkout, fixed host ports, fixed container names, networks or volumes made outside the file (D-24) | `[workspace] worktree_safe` |
| The branch pattern | 60% or more of at least 5 branches share one shape, such as `feature/PMT-12-x` | `[git] branch_pattern` |
| The commit format | 80% or more of at least 10 commits: Conventional Commits, or a ticket key in the subject | facts only |
| G8 | a committed commit-message rule (a `commit-msg` hook, commitlint, …), or a strict format | `check` (a gap) or `no-local-rule`. Never a pass: a rule the code host enforces (a ruleset, a push rule) isn't visible from the repo, so unit 22 and the setup interview (39) settle it |
| Instruction files | `registry/instruction-flags/` | facts, and the commands flagged |
| Compose mounts of your home folder, the Docker socket, `.git` or a folder outside the repo | the resolved compose file | gaps |

**Levels and suites.** A runner's suites (PHPUnit's `Unit` and `Feature`) are listed as facts,
not levels: a file path given to a `--testsuite` level replaces the suite rather than narrowing
it (unit 17a's probe D1), so a suite level wouldn't keep its tests apart. One level per runner and
folder is drafted; split it yourself if you want.

**A name already taken** (two runners suggesting `unit`, or a check and a level) becomes
`<service>-<name>`.

**What isn't read, by design:**
- a quality-gate script (`Makefile`, CI workflows, …) is code. It's listed as a gap; name its steps
  as checks;
- a runner's own config (`playwright.config.ts`) is code: `report_root` is a guess from the
  folders beside it, to check;
- a commit-message rule is never run: whether `Mirai-Ticket: <id>` passes it is checked in unit 22;
- a CI step that checks messages can't be told apart from other steps, and the code host's own
  rules aren't asked about (detection never uses the network);
- a value the config can't hold (a folder with a space as `report_root`, say) isn't drafted: it's
  a gap.

## The output

Each run writes `<store>/detect/<id>/` (the last 10 are kept):
- `config.draft.toml`: a whole config, each value with a comment saying where it came from
  (`# from backend/phpunit.xml (phpunit), in app, which mounts ./backend:/var/www/html`), each gap
  as `# check: …`. It's checked against the config schema before it's written;
- `facts.json`: everything found, for unit 39's setup ledger, with the trust root's manifest hash
  and the MIRAI version that produced it. **It holds text from the repo** (paths, flagged lines,
  service names, Compose's error), so whatever reads it, unit 39's AI skill included, treats it as
  data, never as instructions. Paths in your home folder are written from `~`.

A run that fails leaves nothing behind.

The report lists the **differences** from your `.mirai/config.toml`, key by key (levels and checks
by name). Copy what you want; nothing in the draft is in use.

## Instruction files (P2)

Listed, each with its blob id (so the ledger can tell when one changes after review):
- every tracked `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`, `GEMINI.md`, `.cursorrules`,
  `.windsurfrules`, `.github/copilot-instructions.md` and `.mcp.json` at any depth, and every file
  under `.claude/`, `.cursor/rules/`, `.agents/`, `_bmad/`, `.github/instructions/` and
  `.windsurf/rules/`;
- every file a `CLAUDE.md`, `CLAUDE.local.md` or `AGENTS.md` `@`-imports, up to five levels (an
  import of a file that isn't there is a gap);
- `.mirai/context/agents-local.md`: what you write into MIRAI's block of `AGENTS.md`;
- an instruction file that's a link, as a link (never followed; a gap to check).

Flagged, for you to review: shell, network and install commands (`curl`, `| sh`, `sudo`,
`docker run`, `npm install`, `pip install`, `composer require`, `brew install`, …):
- in Markdown, in code spans, fenced blocks and lines starting with `$ `; on prose lines only a
  pipe into a shell, so prose that mentions `curl` isn't flagged. MIRAI's own block
  (`<!-- mirai:begin -->` to `<!-- mirai:end -->`) is skipped only when it's closed and matches
  the lock; otherwise the whole file is read;
- in JSON (the keys are data): a `command` with its `args` (hooks, MCP servers), each entry of an
  `allow` list (never `deny`), and keys a tool runs or connects to, always: `apiKeyHelper`,
  `awsAuthRefresh`, `awsCredentialExport`, `otelHeadersHelper`, a remote MCP server's `url`,
  `ANTHROPIC_BASE_URL` and its Bedrock and Vertex forms;
- in any other file, every line.

A file MIRAI rendered whole and that hasn't changed since (its hash in `mirai.lock`) is listed, not
read. Files over 256 KiB, binary ones, and files past detection's read limit are listed, not read;
lines too long to scan are counted.

**Flags are hints, not a verdict.** Agents follow prose too, and "zero flagged" isn't "clean".
Nothing here blocks: unit 39's ledger asks you about each file, by its blob id, and unit 24 is
where Rex will read only reviewed ones.

## Adding a stack

Put it in `.mirai/custom/stacks/<name>.toml` and commit it on the integration branch. Its name
can't be one of the shipped ones (`node`, `php`, `python`, `go`, `rust`, `ruby`).

```toml
kind = "stack"
schema_version = 1
name = "deno"
description = "Deno, with a deno.json"
markers = ["deno.json"]           # file names that mark the stack in a folder
pack = "node"                     # optional: the protected-paths pack to suggest

[[checks]]                        # a manifest's scripts: each name it lists is a check
file = "deno.json"
field = "tasks"
names = ["lint", "check"]
command = ["deno", "task", "{script}"]

[[checks]]                        # or a dependency the manifest lists: one check
package = { file = "deno.json", fields = ["imports"], name = "@std/fmt" }
name = "format"
command = ["deno", "fmt", "--check"]

[[commit_rules]]                  # optional: files that hold a commit-message rule (G8)
file = ".deno-commit.json"
contains = "commit-msg"           # optional: a word the file must contain
```

A manifest is a JSON file beside a marker. A command is argv, never a shell line; `{script}` is a
name from `names`, never something read from the repo. A test runner is found by its adapter's
`[detect]` section (see `docs/test-adapters.md`).
