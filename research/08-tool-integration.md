# 08 - Tool integration: Claude Code, Codex CLI, Cursor (state as of October 2026)

Research date: 2026-10-21. Every claim carries a source key in square brackets (for example [C5]). The full URL for each key is in the **Sources** list at the end. Anything I could not confirm in an official page is marked **UNVERIFIED**. Nothing was installed or run. I only read docs, plus the Codex source code on GitHub where the docs page renders its flag tables with JavaScript.

Notes on the docs themselves:
- Codex docs moved. `developers.openai.com/codex/...` now redirects (308) to `learn.chatgpt.com/docs/...`.
- Cursor's CLI binary is now called `agent`. It used to be `cursor-agent` [U7][U8].
- The model names below (for example `gpt-6.1-sol`, `claude-opus-5-5`, `composer-2.5`) are the ones the docs show today [X3][X13][U4][C6].

---

## 1. Comparison matrix

| Capability | Claude Code | Codex CLI | Cursor (IDE + `agent` CLI) |
|---|---|---|---|
| **Main instruction file** | `CLAUDE.md` (or `.claude/CLAUDE.md`), plus `CLAUDE.local.md`, user `~/.claude/CLAUDE.md` and a managed-policy file [C1] | `AGENTS.md` (or `AGENTS.override.md`), plus global `~/.codex/AGENTS.md` [X1] | `.cursor/rules/*.mdc`, `AGENTS.md` (root and nested), user rules and team rules [U1]. The CLI also reads root `CLAUDE.md` [U2] |
| **Reads AGENTS.md?** | Yes, but by default only when there is no `CLAUDE.md`/`CLAUDE.local.md` (v2.1.277+). Can be set to read both [C1] | Yes, natively [X1] | Yes, root and nested [U1] |
| **Nesting per directory** | Files from the filesystem root down to the working dir load at launch. Subdirectory files load when Claude touches files there [C1] | One file per directory, from the repo root down to the cwd, joined together. Closer files win [X1] | Nested `AGENTS.md` is combined with its parents, and the more specific file wins [U1] |
| **Size limit** | Advice only: keep each file under 200 lines. Auto memory is capped at 200 lines / 25KB [C1] | Hard cap: `project_doc_max_bytes`, default **32 KiB** for all files combined [X1] | Advice: keep rules under 500 lines [U1] |
| **Path-scoped rules** | `.claude/rules/*.md` with a `paths` field [C1] | None. Use nested `AGENTS.md` instead [X1] | `.mdc` frontmatter `globs` + `alwaysApply` + `description` [U1] |
| **Agent Skills (SKILL.md)** | Yes. `.claude/skills/`, `~/.claude/skills/`, nested, plugin, enterprise [C2] | Yes. `.agents/skills/` (cwd up to repo root), `~/.agents/skills`, `/etc/codex/skills` [X2] | Yes. `.agents/skills/`, `.cursor/skills/`, `~/.agents/skills/`, `~/.cursor/skills/`, **and** `.claude/skills/`, `.codex/skills/` (plus home versions) for compatibility [U3] |
| **Skill frontmatter** | Many fields: `name`, `description`, `when_to_use`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `hooks`, `paths`, `disable-model-invocation`, `user-invocable`, ... [C2] | `name`, `description` (required). Extra settings go in an optional `agents/openai.yaml` [X2] | `name` (must match the folder), `description`, `paths`, `disable-model-invocation`, `metadata`, `icon`, `color` [U3]. `user-invocable` is in the CLI changelog [U15] |
| **Subagents / custom agents** | `.claude/agents/*.md`, `~/.claude/agents/`, `--agents` JSON, plugin `agents/` [C3] | `.codex/agents/*.toml`, `~/.codex/agents/*.toml` [X3] | `.cursor/agents/*.md`, `~/.cursor/agents/`. Also reads `.claude/agents/` and `.codex/agents/` [U4] |
| **Subagent can pick its own model?** | Yes: `model:` (alias, full ID or `inherit`) [C3] | Yes: `model`, `model_reasoning_effort`. It **cannot** override sandbox, approval policy, provider or MCP servers [X3] | Yes: `model: inherit` or a model ID, with options in brackets, e.g. `claude-opus-5[effort=high]` [U4] |
| **Custom slash commands** | `.claude/commands/*.md` still works, but commands have been merged into skills [C2] | `~/.codex/prompts/*.md` is **deprecated**, user-level only, invoked as `/prompts:name`. Use skills instead [X4] | Skills with `disable-model-invocation: true` act as commands [U3]. A `/migrate-to-skills` command exists [U3]. Project `.cursor/commands/` is **UNVERIFIED** in current docs (old page redirects away). Plugins still ship `commands/` [U13] |
| **Hooks: config location** | `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, managed settings, plugin `hooks/hooks.json`, skill/agent frontmatter [C4] | `~/.codex/hooks.json`, `~/.codex/config.toml` `[hooks]`, `<repo>/.codex/hooks.json`, `<repo>/.codex/config.toml`, plugins [X5] | `.cursor/hooks.json`, `~/.cursor/hooks.json`, `/etc/cursor/hooks.json` (enterprise), team hooks, plugins. **Also loads Claude Code hooks** from `.claude/settings*.json` by default [U5][U6] |
| **Hook events (main ones)** | 33 events, including `SessionStart`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`, `SubagentStart/Stop`, `PreCompact`, `SessionEnd`, `UserPromptSubmit` [C4] | `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop`, `Interrupt`, `SessionEnd` [X5] | `sessionStart/End`, `preToolUse`, `postToolUse(Failure)`, `subagentStart/Stop`, `beforeShellExecution`, `beforeMCPExecution`, `beforeReadFile`, `afterFileEdit`, `beforeSubmitPrompt`, `preCompact`, `stop`, ... [U5] |
| **Can a hook block?** | Yes: exit code 2, or a JSON `permissionDecision: "deny"` / `decision: "block"` [C4] | Yes: exit 2, or a JSON `permissionDecision: "deny"` (legacy `decision: "block"`) [X5] | Yes: exit 2, or JSON `permission: "deny"`. Other exit codes let the action go ahead (fail-open) [U5] |
| **Hook trust gate** | None in `-p`. Project hooks run even in a folder you never trusted [C5] | Non-managed hooks must be reviewed and trusted (by hash) before they run [X5] | Workspace trust. Headless needs `--trust` [U8] |
| **Headless command** | `claude -p "<prompt>"` [C5] | `codex exec "<prompt>"` (short form `codex e`) [X7] | `agent -p "<prompt>"` [U7] |
| **Output formats** | `text`, `json`, `stream-json` [C5] | Formatted text by default. `--json` gives a JSONL event stream. `-o` writes the last message to a file [X6][X8] | `text`, `json`, `stream-json` (+ `--stream-partial-output`) [U8] |
| **Structured final output** | `--json-schema` gives a `structured_output` field [C5] | `--output-schema <file>` [X6][X8] | Not available. **UNVERIFIED** that anything like it exists |
| **Token usage reported** | Yes: `usage` + `modelUsage` per model [C12] | Yes: `turn.completed.usage` (input, cached, output, reasoning tokens) [X6] | CLI: **no** (the result has only duration and session id) [U9]. SDK: yes, `TokenUsage` and `Agent.getUsage()` [U16] |
| **Cost reported** | Yes: `total_cost_usd` (a client-side estimate) [C5] | No. Not documented [X6] | CLI: no [U9]. SDK `getUsage()` returns dollar cost [U16] |
| **Max turns** | `--max-turns N` (exits with an error) [C6]. Subagent `maxTurns` [C3] | No such flag (see `codex-rs/exec/src/cli.rs`) [X8] | No such flag [U8] |
| **Budget cap** | `--max-budget-usd X` (counts subagents, can overshoot a little) [C6] | Only the experimental `features.rollout_budget.limit_tokens` (off by default, "under development") [X10] | None in the CLI [U8] |
| **Pick model** | `--model <alias or id>`, `--fallback-model` [C6] | `-m/--model`, `--profile`, `-c key=value` [X8] | `--model <id>`, `--list-models` [U8] |
| **Unattended permission modes** | `--permission-mode dontAsk / acceptEdits / auto / bypassPermissions`, `--allowedTools`, `--disallowedTools`, `--permission-prompts none` [C5][C7] | `--sandbox read-only / workspace-write / danger-full-access`. exec forces approval policy `never`. `--approve-for-me` sends approvals to an auto-reviewer [X8][X9] | `--force`/`--yolo`, `--sandbox enabled/disabled`, `approvalMode: allowlist / auto-review / unrestricted`, allow/deny lists in `.cursor/cli.json` [U8][U10][U11] |
| **Dangerous flags** | `--dangerously-skip-permissions` = `bypassPermissions`. Docs say use it only in containers/VMs [C7] | `--dangerously-bypass-approvals-and-sandbox` (`--yolo`), `--sandbox danger-full-access`, `--dangerously-bypass-hook-trust` [X8] | `--force`/`--yolo` ("allow commands unless explicitly denied"), `--sandbox disabled`, `--approve-mcps`, "Run Everything" mode [U8][U12] |
| **Exit codes** | 0 on success, non-zero on failure, 143 on SIGTERM [C5] | 1 on error, including any error event during the run and a missing git repo without `--skip-git-repo-check` [X8] | Non-zero on failure, with the message on stderr. No JSON is written on failure [U9] |
| **Plugins** | `.claude-plugin/plugin.json` (optional). Marketplace file: `.claude-plugin/marketplace.json` [C8][C9] | Portable root `plugin.json` (Agent Plugins standard) or `.codex-plugin/plugin.json`. Marketplace: `.agents/plugins/marketplace.json`, and it also reads `.claude-plugin/marketplace.json` [X12] | Root `plugin.json` (Agent Plugins) or `.cursor-plugin/plugin.json`. Marketplace: `.cursor-plugin/marketplace.json` [U13] |
| **MCP config** | `.mcp.json` (project), `~/.claude.json` (user/local), `--mcp-config` [C10] | `[mcp_servers.<id>]` in `~/.codex/config.toml` or `.codex/config.toml` (only in trusted projects) [X11] | `.cursor/mcp.json`, `~/.cursor/mcp.json` [U8][U14] |
| **Other model families** | Claude models only. Anthropic "doesn't support routing Claude Code to non-Claude models through any gateway" [C11] | OpenAI models. Custom providers must speak the Responses API (`wire_api = "responses"` is the only value). `--oss` runs local models [X10][X8][X13] | Many families natively: Claude, GPT, Gemini, Grok, Composer [U4][models list in llms.txt] |

---

## 2. Detail: Claude Code

### 2.1 Instruction files
- **Where they load from:** the managed-policy `CLAUDE.md` (e.g. `/Library/Application Support/ClaudeCode/CLAUDE.md` on macOS), the user file `~/.claude/CLAUDE.md`, the project file `./CLAUDE.md` or `./.claude/CLAUDE.md`, and the personal, gitignored `./CLAUDE.local.md` [C1].
- **Combining:** files are joined together, never overridden. They are ordered from the filesystem root down to the cwd, and `CLAUDE.local.md` comes after `CLAUDE.md` in each directory. Files in subdirectories load when Claude reads or edits something in that subdirectory [C1].
- **Imports:** `@path` pulls another file in. Imports that point outside the project need a one-time approval [C1].
- **Path rules:** `.claude/rules/**/*.md`, scoped with a `paths` field. User rules go in `~/.claude/rules/` [C1].
- **AGENTS.md:** read only when no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` sits in the cwd or above it. You can switch this to `claude-md-and-agents-md` via `pluginConfigs."cc-plugin-agents-md@builtin".options.instructionFiles`. That setting only works in user, `--settings` or managed settings [C1]. The simplest portable approach is a `CLAUDE.md` that imports `@AGENTS.md` [C1].
- **Size:** aim for under 200 lines per file. Imports do not save context, because imported files also load at launch [C1].

### 2.2 Skills
- **Locations:** enterprise, `~/.claude/skills/<name>/SKILL.md`, `.claude/skills/<name>/SKILL.md`, nested `<subdir>/.claude/skills/`, and plugin `skills/` [C2].
- **Standard:** skills follow the Agent Skills open standard (agentskills.io). Outside Claude Code, only `name`, `description`, `license`, `compatibility`, `metadata` and `allowed-tools` are accepted [C2].
- **Limits:** keep `SKILL.md` under 500 lines. The description is cut off at 1,536 characters in the listing [C2].
- **.agents/skills:** Claude Code does **not** list `.agents/skills/` as a location [C2]. I treat this as a known gap.

### 2.3 Subagents
- **Format:** Markdown with YAML frontmatter, and the body becomes the system prompt. Priority order: managed > `--agents` > `.claude/agents/` > `~/.claude/agents/` > plugin [C3].
- **Fields:** `name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `effort`, `isolation: worktree`, and more [C3].
- **Model choice:** order of precedence is the per-call model, then frontmatter `model`, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the parent's model [C3].

### 2.4 Commands
- `.claude/commands/x.md` and `.claude/skills/x/SKILL.md` both create `/x`. If both exist, the skill wins [C2].
- In `-p` mode you can put `/skill-name` in the prompt and it is expanded [C5].

### 2.5 Hooks
- **Events:** 33 in total [C4].
- **Handler types:** `command`, `http`, `mcp_tool`, `prompt`, `agent` (`agent` is experimental) [C4].
- **Blocking:** exit 2 blocks on events that support it. Other non-zero codes do not block. You can also return a JSON decision. `onFailure: "block"` (v2.1.295+) makes a crashed or timed-out hook block the action (fail-closed) [C4].
- **Caveat:** exit 2 is not universal. For example, `PostToolUse` only shows stderr to Claude [C4].

### 2.6 Headless
- **Command:** `claude -p`, with `--output-format text|json|stream-json`. The JSON includes `total_cost_usd` and a per-model cost breakdown [C5].
- **Result subtypes:** `success`, `error_max_turns`, `error_during_execution`, `error_max_budget_usd` [C12].
- **Limits:** `--max-turns`, `--max-budget-usd` (both print-mode only) [C6].
- **`--bare`:** skips CLAUDE.md, skills, hooks, plugins, MCP and auto memory. You then pass them in explicitly with `--settings`, `--mcp-config`, `--agents`, `--plugin-dir` and `--append-system-prompt-file`. It needs `ANTHROPIC_API_KEY` and will become the `-p` default in a future release [C5].
- **Safety warning:** without `--bare`, `-p` runs the project's `.claude/settings.json` hooks and `.mcp.json` servers **even in an untrusted folder**, with no prompt [C5].
- **Default mode:** since v2.1.302, `-p` starts in Manual mode, and any call that needs approval is denied [C5].
- **Unattended prompts:** `--permission-prompts none` denies anything nobody can answer and tells Claude not to retry [C5].
- **Modes:** `dontAsk` (deny anything not pre-approved, "locked-down CI"), `acceptEdits`, `auto` (a classifier reviews actions), `bypassPermissions` ("isolated containers and VMs only") [C7]. Deny rules still apply under `bypassPermissions`, but allow rules have no effect there [C7].
- **Exit codes:** 0 or non-zero, and 143 on SIGTERM [C5].
- **Other useful flags:** `--no-session-persistence`, `--strict-mcp-config`, `--setting-sources`, `--restricted` [C6].

### 2.7 Plugins
- **Manifest:** `.claude-plugin/plugin.json` is optional. The default layout is `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `bin/`, `settings.json` [C8].
- **Root CLAUDE.md:** a `CLAUDE.md` at the plugin root is **not** loaded [C8].
- **Marketplace:** `.claude-plugin/marketplace.json`. Commands: `claude plugin marketplace add`, `claude plugin install x@mkt` [C9].
- **Load for one run:** `--plugin-dir <path>` [C6].
- **Agent Plugins standard:** whether Claude Code loads a root `plugin.json` is **UNVERIFIED**. I found no mention of it in the Claude docs I read.

### 2.8 MCP
- **Scopes:** local and user live in `~/.claude.json`, project lives in `.mcp.json` [C10].
- **Transports:** http, sse (deprecated), stdio, ws [C10].
- **Variables:** `${VAR}` and `${VAR:-default}` work in `.mcp.json` [C10].

### 2.9 Models
- **Selection:** aliases `sonnet`, `opus`, `haiku`, `fable`, or full IDs [C6]. Each subagent can have its own model [C3].
- **Other families:** not supported [C11]. A cross-family verifier must run in a different tool.

---

## 3. Detail: Codex CLI

### 3.1 Instruction files
- **Global:** `~/.codex/AGENTS.override.md`, or failing that `AGENTS.md`. Only the first non-empty one is used [X1].
- **Project:** from the git root down to the cwd, Codex takes one file per directory, checking `AGENTS.override.md`, then `AGENTS.md`, then the names in `project_doc_fallback_filenames`. They are joined together and closer files win [X1].
- **Size:** reading stops at `project_doc_max_bytes` (default 32 KiB) [X1].
- **CLAUDE.md:** Codex can be told to read it by adding it to `project_doc_fallback_filenames` [X1].

### 3.2 Skills
- **Locations:** `.agents/skills` from the cwd up to the repo root, `$HOME/.agents/skills`, `/etc/codex/skills`, and system skills [X2].
- **`~/.codex/skills`:** not mentioned on the current page (**UNVERIFIED**). Cursor still reads `.codex/skills` for compatibility [U3].
- **Frontmatter:** must include `name` and `description`. The optional `agents/openai.yaml` holds UI metadata, `policy.allow_implicit_invocation`, and `dependencies.tools` [X2].
- **Invocation:** `$skill-name` or `/skills`. Disable a skill with `[[skills.config]] enabled=false` [X2].
- **Budget:** the skills list gets about 2% of the context window (or 8,000 characters) [X2].

### 3.3 Subagents
- **Built-in agents:** `default`, `worker`, `explorer` [X3].
- **Custom agents:** TOML files in `.codex/agents/` or `~/.codex/agents/`. Required fields: `name`, `description`, `developer_instructions`. Optional: `model`, `model_reasoning_effort`, `features.*` toggles, `skills.config` [X3].
- **What they can't change:** subagents inherit the parent's sandbox, approval policy, provider and MCP servers, and an agent file cannot override them. An agent "can't create a separate read-only sandbox" [X3].
- **Global settings:** under `[agents]`, e.g. `default_subagent_model`, `max_concurrent_threads_per_session` [X3].
- **Headless:** in non-interactive runs, any action that needs a new approval fails and is reported back to the parent [X3].

### 3.4 Commands
- Custom prompts are deprecated, live only in `~/.codex/prompts`, and are not shared through the repo. Use skills instead [X4].

### 3.5 Hooks
- **Locations:** `~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, `<repo>/.codex/config.toml`, and plugins. Hooks from all sources load together [X5].
- **Trust:** project hooks load only if the project `.codex/` layer is trusted. Each non-managed hook must also be trusted by its hash. A hook that changes is skipped until someone re-trusts it [X5]. `--dangerously-bypass-hook-trust` skips this for one run [X5][X8].
- **Handler types:** `command` and `mcp_tool` run. `prompt` and `agent` handlers are parsed but skipped [X5].
- **Blocking:** exit 2 with a reason on stderr, or a JSON `permissionDecision: "deny"` [X5]. When several hooks match, they run in parallel [X5].
- **Caveat:** a `PreToolUse` callback that errors or times out does not block (fail-open) [X5].

### 3.6 Headless
- **Command:** `codex exec "<task>"`. Progress goes to stderr and the final message to stdout [X6].
- **Output:** `--json` gives JSONL events: `thread.started`, `turn.started`, `turn.completed` (with `usage`), `turn.failed`, `item.*`, `error` [X6].
- **Flags in source:** `--json`, `-o/--output-last-message`, `--output-schema`, `--ephemeral`, `--skip-git-repo-check`, `--ignore-user-config`, `--ignore-rules`, `--strict-config`, and the shared flags `-m/--model`, `-p/--profile`, `-s/--sandbox`, `--approve-for-me`, `--dangerously-bypass-approvals-and-sandbox` (alias `--yolo`), `--dangerously-bypass-hook-trust`, `-C/--cd`, `--worktree`, `--add-dir`, `--oss` [X8].
- **Approvals:** headless mode defaults the approval policy to `never` (in the source: "Default to never ask for approvals in headless mode") [X8].
- **Removed flag:** `--full-auto` no longer works. Use `--sandbox workspace-write` [X6].
- **Exit code:** 1 when any error was seen, when a required MCP server fails, or when it runs outside a git repo without `--skip-git-repo-check` [X6][X8]. Other codes are **UNVERIFIED** (the docs page does not list exit codes).
- **No limits:** there is no max-turns and no cost. Usage is reported as tokens only [X6][X8].
- **Sandbox:** the default is read-only. `workspace-write` keeps the network off by default (`sandbox_workspace_write.network_access`) [X6][X10][X9].
- **Protected paths:** inside `workspace-write`, `.git`, `.agents`, `.codex` and `.aws` are **read-only** [X9]. This means the agent cannot run `git commit` in the default sandbox.
- **Auth:** pass `CODEX_API_KEY=... codex exec` per run. Do not set it as a job-wide env var in workflows that run repo-controlled code [X6].

### 3.7 Plugins
- **Manifest:** the portable root `plugin.json` (Agent Plugins standard), or `.codex-plugin/plugin.json` as a fallback. OpenAI-specific settings go under `extensions["com.openai"]` [X12].
- **Contents:** skills in `skills/`, MCP servers in root `mcp.json` [X12]. Plugin hooks work only in some desktop install paths and make a plugin ineligible for the public directory [X12].
- **Marketplace:** `.agents/plugins/marketplace.json` (repo) or `~/.agents/plugins/marketplace.json`. Codex also reads `.claude-plugin/marketplace.json` [X12]. Command: `codex plugin marketplace add|list|upgrade|remove` [X7][X12].

### 3.8 MCP
- **Config:** `[mcp_servers.<id>]` in `config.toml`, either user-level or `.codex/config.toml` (trusted projects only). Keys include `command`, `url`, `bearer_token_env_var`, `required`, `enabled_tools` [X11][X10].
- **CLI:** `codex mcp add <name> -- <cmd>` [X11].
- **Transports:** stdio and Streamable HTTP [X11].

### 3.9 Models
- **Selection:** `--model`/`-m` [X13]. A custom agent file can set `model` [X3].
- **Other providers:** must expose a Responses-API endpoint (`wire_api = "responses"` is the only value) [X10][X13]. `--oss` with `--local-provider lmstudio|ollama` runs local models [X8].
- **Claude through Codex:** not documented. **UNVERIFIED**, and it would need a gateway that translates to the Responses API.

---

## 4. Detail: Cursor (IDE + `agent` CLI)

### 4.1 Instruction files
- **Rule types:** project rules are `.cursor/rules/**/*.mdc`. A plain `.md` file in that folder is **ignored** [U1].
- **`.mdc` frontmatter:** `description`, `globs`, `alwaysApply` [U1].
- **AGENTS.md:** root and nested; nested files are combined with their parents and the most specific wins [U1].
- **Precedence:** Team Rules > Project Rules > User Rules [U1].
- **CLI:** reads `.cursor/rules`, plus root `AGENTS.md` and `CLAUDE.md` [U2].
- **Size:** keep rules under 500 lines [U1].

### 4.2 Skills
- **Locations:** `.agents/skills/`, `.cursor/skills/`, `~/.agents/skills/`, `~/.cursor/skills/`, plus `.claude/skills/`, `.codex/skills/`, `~/.claude/skills/`, `~/.codex/skills/` [U3]. Nested project skill folders are scoped automatically to their directory [U3].
- **Frontmatter:** `name` (lowercase-hyphen, must match the folder), `description`, `paths`, `disable-model-invocation`, `metadata`, `icon`, `color` [U3].
- **CLI warnings:** the CLI warns about specs it considers broken: name over 64 characters, description over 1,024 characters, body over about 5,000 tokens [U15].

### 4.3 Subagents
- **Locations:** `.cursor/agents/`, `.claude/agents/`, `.codex/agents/`, and the same under `~` [U4].
- **Name collisions:** `.cursor/` wins over `.claude/` and `.codex/` [U4].
- **Fields:** `name`, `description`, `model` (`inherit` or a model ID, with options in brackets), `readonly`, `is_background` [U4].
- **Model override can be ignored:** Cursor will not use the requested model if a team admin blocks it [U4].
- **Codex TOML agents:** whether Cursor can parse the TOML files in `.codex/agents/` is **UNVERIFIED** (the Cursor format is Markdown).

### 4.4 Commands
- Skills replace commands, and `/migrate-to-skills` converts old ones [U3].
- The plugin format still has `commands/` [U13].
- Project `.cursor/commands/*.md` is **UNVERIFIED** in current docs. The old docs page now redirects to the docs home.

### 4.5 Hooks
- **Locations:** `.cursor/hooks.json` (runs from the project root), `~/.cursor/hooks.json`, enterprise `/etc/cursor/hooks.json`, team hooks, plugin hooks [U5].
- **Merging:** all sources run. `deny` beats `ask`, and `ask` beats `allow` [U5].
- **Blocking:** exit 0 means use the JSON output. Exit 2 means deny. Any other code means "hook failed, action proceeds" (fail-open). For permission hooks, invalid JSON blocks the action [U5].
- **Loop limit:** `stop` and `subagentStop` hooks have `loop_limit` (default 5) and `followup_message` for auto-continue [U5].
- **Claude Code hooks:** loaded by default from `.claude/settings.local.json`, `.claude/settings.json` and `~/.claude/settings.json`, through the setting "Include Third-Party Plugins, Skills, and Other Configs" (default on) [U6].
- **CLI:** plugin hooks run in the CLI (changelog) [U15]. That all hook events fire in `agent -p` is **UNVERIFIED**.

### 4.6 Headless
- **Command:** `agent -p "<prompt>"`, with `--output-format text|json|stream-json` [U8].
- **Auth:** `CURSOR_API_KEY` or `--api-key` [U7][U8].
- **Writing files:** the docs disagree. The parameters page says print mode "has access to all tools, including write and shell" [U8]. The headless page says that without `--force` "changes are only proposed, not applied" [U7]. Plan on passing `--force` explicitly.
- **Other flags:** `--trust` (trust the workspace, headless only), `--sandbox enabled|disabled`, `--approve-mcps`, `--model`, `--mode plan|ask`, `-w/--worktree`, `--resume` [U8].
- **JSON result:** `type`, `subtype`, `is_error`, `duration_ms`, `result`, `session_id`. **No token usage or cost.** On failure the exit code is non-zero, the message goes to stderr, and no JSON is written [U9].
- **No limits:** no max-turns or budget flags [U8].
- **Admin control:** admins can turn off headless mode for the whole organization [U15].
- **Permissions:** `Shell(cmd)`, `Read(glob)`, `Write(glob)`, `WebFetch(domain)`, `Mcp(server:tool)` in `~/.cursor/cli-config.json` or project `.cursor/cli.json`. Only permissions can be set at project level [U10][U11].
- **Approval modes:** `approvalMode` = `allowlist` | `auto-review` | `unrestricted` [U11]. In the IDE these are called Auto-review, Allowlist and Run Everything. The docs say Auto-review "is not a security boundary" [U12].
- **Sandbox:** network is blocked by default, and `.git/config` and `.git/hooks` are protected [U12].
- **Cost from code:** the TypeScript/Python SDK has `TokenUsage` per run and `Agent.getUsage()` for billed dollar cost. Local agents need usage access turned on [U16].

### 4.7 Plugins
- **Two formats:** the Agent Plugins standard (root `plugin.json`, `skills/`, `mcp.json`) and Cursor Plugins (`.cursor-plugin/plugin.json`, which adds `rules/`, `agents/`, `commands/`, `hooks/hooks.json`) [U13].
- **Marketplace:** `.cursor-plugin/marketplace.json`. Team marketplaces need the Teams/Enterprise plan [U13].
- **CLI:** `agent plugin marketplace add <git-url>` [U15], `--plugin-dir` [U8].
- **About the standard:** Agent Plugins is "an open, vendor-neutral standard". Its steering committee includes Amazon, Cursor, Microsoft, OpenAI and Vercel [A1]. Anthropic is not named there.

### 4.8 MCP
- **Config:** `.cursor/mcp.json` and `~/.cursor/mcp.json`, read by the CLI too [U2][U8].
- **Transports:** stdio, SSE, Streamable HTTP [U14].
- **Variables:** `${env:VAR}` interpolation [U14].
- **CLI commands:** `agent mcp list|enable|login` [U8].

### 4.9 Models
- **Families:** many in one tool (Claude, GPT, Gemini, Grok, Composer) [U4][Cursor llms.txt].
- **Selection:** `--model` per run [U8], or `model:` per subagent [U4].
- **Note:** this makes Cursor the only one of the three that can run a different model family as a verifier inside the same tool.

---

## 5. Consequences for MIRAI

### 5.1 The common denominator (what works the same on all three)
1. **`AGENTS.md`** is the one instruction file all three read [X1][U1][C1]. Claude Code reads it only when no `CLAUDE.md` exists, so the safe pattern is a tiny generated `CLAUDE.md` containing `@AGENTS.md` [C1].
   - Keep root `AGENTS.md` well under **32 KiB** (Codex's hard cap [X1]) and under about 200 lines (Claude's advice [C1]).
2. **Agent Skills (`SKILL.md` folders)** load on all three [C2][X2][U3]. The portable frontmatter is `name` + `description` (+ `license`, `compatibility`, `metadata`) [C2][X2].
   - Name rule: lowercase-hyphen, matching the folder name, at most 64 characters, description at most 1,024 characters [U15].
   - Anything tool-specific (Claude's `allowed-tools`, `context: fork`, Codex's `openai.yaml`, Cursor's `paths`) is optional extra.
3. **Subagents with a per-agent model** work on all three. The shape is the same (name, description, model, instructions body), but there are two file formats: Markdown for Claude/Cursor [C3][U4] and TOML for Codex [X3].
4. **Hooks around tool use and turn end, and blocking with exit code 2**, exist in all three (Claude `PreToolUse`/`Stop`, Codex `PreToolUse`/`Stop`, Cursor `preToolUse`/`stop`) [C4][X5][U5]. The event names, JSON shapes and fail-open behavior differ. That is why the real gates must stay in git hooks and CI, as MIRAI already plans.
5. **Headless with a JSONL stream** exists in all three: `claude -p --output-format stream-json`, `codex exec --json`, `agent -p --output-format stream-json` [C5][X6][U8].
6. **MCP over stdio and HTTP** works on all three, but each needs its own config file and format [C10][X11][U14].

### 5.2 What the installer must generate per tool

| Source concept (single source) | Claude Code | Codex CLI | Cursor |
|---|---|---|---|
| Global instructions | `CLAUDE.md` = `@AGENTS.md` (+ optional `.claude/rules/*.md` with `paths`) | `AGENTS.md` (shared) | `AGENTS.md` (shared). Optional `.cursor/rules/*.mdc` for glob-scoped rules |
| Path-scoped rules | `.claude/rules/<x>.md` with `paths:` | Nested `<dir>/AGENTS.md` (the only option) | `.cursor/rules/<x>.mdc` with `globs:` |
| Skills | `.claude/skills/<name>/SKILL.md` | `.agents/skills/<name>/SKILL.md` (+ optional `agents/openai.yaml`) | Nothing extra: Cursor already reads `.agents/skills/` and `.claude/skills/` |
| Agents | `.claude/agents/<name>.md` | `.codex/agents/<name>.toml` (`developer_instructions`) | `.cursor/agents/<name>.md` (otherwise Cursor reads `.claude/agents/`) |
| Commands | none (skills cover it) | none (prompts are deprecated) | none (skills cover it) |
| Hooks (fast feedback only) | `.claude/settings.json` `hooks` | `.codex/hooks.json` (needs trust) | `.cursor/hooks.json`, **or** rely on Cursor importing `.claude/settings.json` |
| MCP | `.mcp.json` | `.codex/config.toml` `[mcp_servers.*]` | `.cursor/mcp.json` |
| Headless permissions | settings `permissions.allow/deny` or CLI flags | `config.toml` sandbox keys or CLI flags | `.cursor/cli.json` `permissions` |
| Plugin (optional distribution) | `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` | root `plugin.json` (+ `.agents/plugins/marketplace.json`). Codex also reads `.claude-plugin/marketplace.json` | root `plugin.json`, or `.cursor-plugin/plugin.json` + `.cursor-plugin/marketplace.json` |

**Watch out for double-loading in Cursor.** Cursor reads `.claude/skills`, `.codex/skills`, `.agents/skills`, `.claude/agents`, `.codex/agents` and Claude's hooks by default [U3][U4][U6]. If the installer writes the same skill or hook into several of those folders, Cursor may see duplicates or run a hook twice. How it handles duplicate skill names is **UNVERIFIED**. Pick one of these:
- (a) Write each artifact once, where Cursor's compatibility layer will find it: skills only in `.agents/skills` + `.claude/skills` as a symlink (UNVERIFIED that symlinks are deduplicated), and hooks only in `.claude/settings.json` for Claude + Cursor, plus `.codex/hooks.json`.
- (b) Tell Cursor users to turn off "Include Third-Party Plugins, Skills, and Other Configs" and generate native `.cursor/*` files [U6].

Option (a) produces fewer files. Option (b) is more predictable. **Recommendation:** (b) for the orchestrator machine (it is deterministic), and document (a) for humans.

### 5.3 Capabilities only one tool has, and the fallback for the others

| Capability | Who has it | Fallback for the others |
|---|---|---|
| Native dollar budget cap (`--max-budget-usd`) and `total_cost_usd` | Claude Code [C6][C5] | **Codex:** compute cost from `turn.completed.usage` tokens × MIRAI's own price table, and kill the process when over [X6]. **Cursor CLI:** no usage at all [U9]. Either drive Cursor through its SDK (`TokenUsage`, `Agent.getUsage()`) [U16], or cap by wall-clock time and rounds only and reconcile against the dashboard later |
| Max agentic turns (`--max-turns`) | Claude Code [C6] | Orchestrator wall-clock timeout (`timeout 45m ...`) + MIRAI round caps. Codex `features.rollout_budget` is experimental [X10] |
| Validated structured final answer | Claude `--json-schema` [C5], Codex `--output-schema` [X6] | **Cursor:** ask for JSON in the prompt and validate it in the orchestrator, retrying once |
| Multiple model families in one tool | Cursor [U4][U8] | **Claude/Codex:** run the verifier step with the *other* tool (e.g. implement with `codex exec`, verify with `claude -p`, or the reverse) |
| Path/glob-scoped instruction files | Claude `.claude/rules` [C1], Cursor `.mdc` [U1] | **Codex:** nested `AGENTS.md` per directory [X1] |
| Fail-closed hooks (`onFailure: "block"`) and prompt/agent/http hook types | Claude [C4] | **Codex/Cursor:** hooks fail open on errors [X5][U5]. Rely on git hooks + CI as the real gate |
| Hook trust by hash | Codex [X5] | Not needed elsewhere. For Codex unattended runs, either ship hooks as managed (`requirements.toml`) or accept that unvetted hooks are skipped. Avoid `--dangerously-bypass-hook-trust` unless MIRAI hashes and verifies its own hooks first |
| Skill runs in a forked subagent (`context: fork`), skill-scoped `allowed-tools` | Claude [C2] | Write the skill so it also works inline. Treat these fields as optional extras |
| Cross-tool loading of other tools' folders | Cursor [U3][U4][U6] | Not applicable. This is a risk to manage (see 5.2), not a feature to copy |

### 5.4 Safest unattended (overnight) settings per tool

General rules for all three:
- Run each agent in a **fresh git worktree inside a disposable container or VM, as a non-root user**. Claude's docs require this before using bypass mode [C7]. Codex's docs say use bypass only "inside a dedicated sandbox VM" [X7].
- **The orchestrator, not the agent, does `git commit`/`push` and opens the MR.** In Codex's `workspace-write` sandbox `.git` is read-only anyway [X9]. Cursor's sandbox protects `.git/hooks` and `.git/config` [U12].
- Give API keys per process, never as job-wide variables [X6].
- Treat any non-zero exit as failure, and always parse the final JSON event as well.

**Claude Code (recommended form):**
```bash
claude --bare -p "$PROMPT" \
  --output-format stream-json --verbose \
  --max-turns 40 --max-budget-usd 4.00 \
  --permission-mode dontAsk --permission-prompts none \
  --allowedTools "Read,Edit,Write,Bash(npm test *),Bash(npm run lint *)" \
  --disallowedTools "Bash(git push *),Bash(curl *),WebFetch" \
  --settings .mirai/claude-settings.json \
  --plugin-dir .mirai/claude-plugin \
  --append-system-prompt-file AGENTS.md \
  --mcp-config .mirai/mcp.json --strict-mcp-config \
  --model <model-id> --no-session-persistence
```
- **Why `--bare`:** it stops the run from picking up whatever hooks, MCP servers or CLAUDE.md the branch contains. MIRAI passes in only what it trusts [C5].
- **Why `dontAsk`:** it denies everything not pre-approved [C5][C7]. The two cost/turn caps stop runaway loops [C6].
- **Leave headroom:** set the dollar cap a little below the real limit, because spend can overshoot it [C6].
- **Never use:** `--dangerously-skip-permissions` / `bypassPermissions` outside an isolated container [C7].
- **Note:** `--bare` needs `ANTHROPIC_API_KEY` (no subscription login) [C5].

**Codex CLI (recommended form):**
```bash
CODEX_API_KEY="$KEY" codex exec --json -o .mirai/out/last.txt \
  --output-schema .mirai/schemas/result.json \
  --sandbox workspace-write -c sandbox_workspace_write.network_access=false \
  -m <model-id> -C "$WORKTREE" "$PROMPT"
```
- **Defaults it relies on:** headless approval is already `never`. Network is off. `.git`, `.codex` and `.agents` are read-only, so the agent cannot rewrite its own skills or config [X8][X9][X10].
- **Budget:** add up `turn.completed.usage` tokens live and kill the process when over budget. Wrap the run in `timeout` for the turn cap [X6].
- **Avoid:** `--yolo` / `--dangerously-bypass-approvals-and-sandbox`, `--sandbox danger-full-access`, `--dangerously-bypass-hook-trust` [X7][X8].
- **Consider:** `--ignore-user-config` so the overnight box's personal `~/.codex/config.toml` doesn't change the run [X8]. Whether project `.codex/config.toml` still loads with that flag is **UNVERIFIED**.

**Cursor `agent` CLI (recommended form):**
```bash
CURSOR_API_KEY="$KEY" timeout 45m agent -p --force --trust \
  --sandbox enabled --output-format stream-json \
  --model <model-id> --workspace "$WORKTREE" "$PROMPT"
```
plus `.cursor/cli.json`:
```json
{ "permissions": {
    "allow": ["Shell(npm)", "Read(**)", "Write(src/**)", "Write(test/**)"],
    "deny":  ["Shell(git)", "Shell(curl)", "Shell(rm)", "Write(**/.env*)", "WebFetch(*)"] } }
```
- **Why `--force` + sandbox:** `--force` is needed for edits in print mode (see the conflict in 4.6), and it allows everything not explicitly denied [U7][U8]. So the **deny list and `--sandbox enabled` are the real limits** [U10][U12].
- **Avoid:** `approvalMode: "unrestricted"` / Run Everything, `--sandbox disabled`, and `--approve-mcps` (unless MIRAI controls `mcp.json`) [U8][U11][U12].
- **Turn caps:** there are none, so the outer `timeout` and MIRAI's round cap are the only limits [U8].
- **Cost:** none from the CLI. If MIRAI needs a hard dollar budget on Cursor, use the SDK and `Agent.getUsage()` [U9][U16].
- **Org setting:** check that the team has not turned off headless mode [U15].

### 5.5 Bottom line
- **Strongest orchestrator target:** Claude Code. It is the only tool with built-in turn and dollar caps and cost reporting.
- **Best model-diversity target:** Cursor, but its CLI tells you nothing about cost.
- **Codex:** has the strictest default sandbox, which suits overnight work, but reports tokens only.
- **Portable core:** build MIRAI on `AGENTS.md` + `SKILL.md` + per-tool agent files + orchestrator-enforced budgets. Treat per-tool hooks and plugins as optional extras.

---

## Sources

Claude Code
- [C1] https://code.claude.com/docs/en/memory
- [C2] https://code.claude.com/docs/en/skills
- [C3] https://code.claude.com/docs/en/sub-agents
- [C4] https://code.claude.com/docs/en/hooks
- [C5] https://code.claude.com/docs/en/headless
- [C6] https://code.claude.com/docs/en/cli-reference
- [C7] https://code.claude.com/docs/en/permission-modes
- [C8] https://code.claude.com/docs/en/plugins-reference
- [C9] https://code.claude.com/docs/en/plugin-marketplaces
- [C10] https://code.claude.com/docs/en/mcp
- [C11] https://code.claude.com/docs/en/llm-gateway
- [C12] https://code.claude.com/docs/en/agent-sdk/typescript

Codex (docs moved from developers.openai.com/codex to learn.chatgpt.com)
- [X1] https://learn.chatgpt.com/docs/agent-configuration/agents-md
- [X2] https://learn.chatgpt.com/docs/build-skills
- [X3] https://learn.chatgpt.com/docs/agent-configuration/subagents
- [X4] https://learn.chatgpt.com/docs/custom-prompts
- [X5] https://learn.chatgpt.com/docs/hooks
- [X6] https://learn.chatgpt.com/docs/non-interactive-mode
- [X7] https://learn.chatgpt.com/docs/developer-commands?surface=cli
- [X8] https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs , https://github.com/openai/codex/blob/main/codex-rs/utils/cli/src/shared_options.rs , https://github.com/openai/codex/blob/main/codex-rs/exec/src/lib.rs
- [X9] https://learn.chatgpt.com/docs/agent-approvals-security
- [X10] https://learn.chatgpt.com/docs/config-file/config-reference
- [X11] https://learn.chatgpt.com/docs/extend/mcp
- [X12] https://developers.openai.com/plugins/build/plugins
- [X13] https://learn.chatgpt.com/docs/models

Cursor
- [U1] https://cursor.com/docs/rules
- [U2] https://cursor.com/docs/cli/using
- [U3] https://cursor.com/docs/skills
- [U4] https://cursor.com/docs/subagents
- [U5] https://cursor.com/docs/hooks
- [U6] https://cursor.com/docs/reference/third-party-hooks
- [U7] https://cursor.com/docs/cli/headless
- [U8] https://cursor.com/docs/cli/reference/parameters
- [U9] https://cursor.com/docs/cli/reference/output-format
- [U10] https://cursor.com/docs/cli/reference/permissions
- [U11] https://cursor.com/docs/cli/reference/configuration
- [U12] https://cursor.com/docs/agent/security/run-modes
- [U13] https://cursor.com/docs/plugins , https://cursor.com/docs/reference/plugins
- [U14] https://cursor.com/docs/mcp
- [U15] https://cursor.com/docs/cli/changelog
- [U16] https://cursor.com/docs/sdk/typescript
- Cursor model list: https://cursor.com/llms.txt

Standards
- [A1] https://agent-plugins.org
