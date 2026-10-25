---
unit: "13b"
date: 2026-10-25
reviewers: Tech Lead, Architect (independent, read-only, no network)
verdicts: not approvable as it stood (Tech Lead), approve after fixes (Architect); one blocker found by both; all findings applied, re-probed, or noted for later units
---

# Unit 13b — Review

Both reviewers worked on a frozen tree, and I made no edits until both reports were in. Neither
ran the real harness or read a real secret. The Tech Lead tested Seatbelt's case handling with
`sandbox-exec` on this Mac; the Architect rendered the bundle with production-shaped paths.

**What held up:**
- the split into 13b and 13c, and `--restricted` only;
- closed templates, with the safe values in code;
- the trust root built from the base commit's config, so a branch can't change the templates or
  `readable_env`;
- the token on fd 3, the environment allowlist, a fresh config folder per launch;
- the explicit keychain deny;
- auto-run write denies from the core rules and packs;
- install scripts left to the gate rather than write-denied;
- `envFiles`' pathspec (case, depth, ignored files) and `plain()`;
- `mirai sandbox show`: a good dogfooding tool, and it shows no token;
- stack-neutral, with no personal data in the repo;
- Seatbelt's write denies hold against case variants (`.GIT`, `.VSCODE`, `.NpmRc`).

## Applied in unit 13b

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **Blocker:** in production the scratch folder sat inside the write-denied MIRAI home (G20: the deny wins), and the bundle probes used another layout | both | MIRAI home no longer write-denied whole; store, trust and `launcher.json` one by one; a layout with scratch under a deny is refused; the probes run through the real `prepareLaunch` on a production-shaped home | T3, T5, b5–b6 |
| 2 | Found by the re-run of 1: Claude Code puts Bash's `TMPDIR` under `CLAUDE_CODE_TMPDIR` only if it's about 30 bytes or less, otherwise the denied `/tmp/claude-<uid>` | me | A short private scratch per launch, `/private/tmp/mirai-<8 hex>` | T5, bundle-tmp |
| 3 | The Read tool could read `.env*` files in nested repos and submodules (exact-path denies only) | Tech Lead | The file tools' denies are globs | T2, bundle-nested-read, bundle-grep-tool |
| 4 | `[compose] env_file` / `[sandbox] readable_env` could make a real `.env` readable (team policy lowering personal protection) | both | Only a committed `.env*` file, never `.env` or `*.local`; refused entries shown | T2b, T8 |
| 5 | `.git` protected only at the top; the worktree or submodule `.git` file, and nested repos' hooks, open | both | `.git` at any depth, and the `.git` file, in the sandbox and Edit denies | T3, bundle-nested, bundle-case-write |
| 6 | A checkout at your home folder (a dotfiles repo) re-allowed all of it | both | Refused, and `/`, `/Users`, `/private/tmp` too | T4 |
| 7 | `PATH` copied as is: a relative entry lets the unsandboxed Claude Code run a planted program | both | Absolute folders outside the checkout, launch and MIRAI home only | T5 |
| 8 | Reads outside your home: your sessions' scratchpads, temp and cache folders, `/Users/Shared`, `/Volumes`, Homebrew databases | Architect | All read-denied | T2, bundle-outside-home |
| 9 | Case variants, a symlink to `.env`, the Grep tool: unprobed for the unsandboxed file tools | Tech Lead | Probed: all blocked (one run each; 18 repeats) | bundle-case-*, bundle-symlink-read, bundle-grep-tool |
| 10 | `checkInit`: version optional; built-in plugins by path only; a nameless MCP server passed; skills and agents unchecked | both | Version required; built-in plugins, skills and agents by name from `[strict]` data; folder, model, nameless entries checked | T7 |
| 11 | Weakening keys not all written; `looseKeys` used by nothing in production | Architect | Written or checked; `prepareLaunch` refuses a loose file | T4 |
| 12 | The deny lists had no floor in code | Tech Lead | Minimum tool and env-var denies in code | T4 |
| 13 | `core.hooksPath` and the `git-hooks` rule's files writable | Tech Lead | Write-denied (sandbox and Edit) | T3, bundle-nested |
| 14 | A failed launch left its folder; the token enumerable on the plan | Tech Lead | Removed on failure; `fds` not enumerable | T5 |
| 15 | Facts not normalized (`HOME`, links); HOME unset threw a raw error | Tech Lead | `realpath`ed; both home spellings denied; a clear error | T5 |
| 16 | `anchored()`: trailing slash, braces, `!` | Tech Lead | Handled; `!` refused | T3b |
| 17 | The red-team key (template hash) didn't cover the renderer | Architect | A canonical render hash, shown by `sandbox show` | T5, T8 |
| 18 | The docs page: structure, claims beyond the facts, terms for a newcomer | Architect | Restructured and corrected | — |
| 19 | Nits: `envFiles` comment, `trustedStrict` name length | Tech Lead | Fixed | — |

## Noted for later units (in the spec and roadmap row 19)

| Unit | Note | From |
|---|---|---|
| 13c | The `realpath` hook on every file tool; a hook-level `.env*` check; interactive settings with exact `Agent()` names | both |
| 17 / packs | Secret files beyond `.env*` as pack data | Architect |
| 18 | N≥3 of everything; the static diff of profile, schema and built-ins per binary; `denyWrite` globs at depth; reads outside your home; a planted program on `PATH`; the data-protection keychain; results keyed by the canonical render, agents no looser than their mode | both |
| 19 | The token on a pipe at fd 3; the process group; re-hashes before the start; `checkInit` with the green version; `agentsJson` from the trust root; log the hashes; `removeLaunch`; hooks off for commits; `DISABLE_AUTOUPDATER` (probe first) | Architect |
| 29 | Canonical hash, green version, stale launches | Architect |
| Later | Worktree checkouts need git's common folder re-allowed | Tech Lead |
