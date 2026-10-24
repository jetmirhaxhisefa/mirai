---
unit: "10"
date: 2026-10-24
reviewers: Tech Lead, Architect (independent, read-only, no network)
verdicts: CHANGES REQUESTED (2 blocking), CHANGES REQUESTED (1 blocking, the same TOML issue); all findings applied, decided by you, or noted for later units
---

# Unit 10 — Review

**What held up:**
- the refusals run before anything is written;
- the framework copy holds only the runtime and registry;
- the lock is sorted, strictly parsed and schema-checked;
- nothing is written under `.git/`;
- there is no network use;
- the licence is fine for a copy that lands in every project.

## Applied in unit 10

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **Blocking: a branch with `"` or `#` rewrote the TOML:** `main"#x` pinned `main` | both | Escaped TOML string; the config is read back and must name the same branch | T6 |
| 2 | **Blocking: the rollback wasn't failure-safe:** a read-only `AGENTS.md` left a half install | Tech Lead | Each undo step wrapped, the first error kept and reported with what's left. A writability check before anything is written. A half-made store removed | T5, T7 |
| 3 | The current-branch fallback could make a feature branch the trust anchor | Architect | **Your decision:** `--branch`, else the config's branch, else the remote's default; otherwise refused. Where the branch came from is printed | T6, T7b |
| 4 | `.gitignore` rules could drop MIRAI files; `eol=crlf` broke the hashes | Architect | **Your decision:** `.mirai/.gitignore` `!*`, `.mirai/.gitattributes` `* -text`, and a `git check-ignore` refusal | T1, T7 |
| 5 | No way to apply a changed config or `agents-local.md`; no `updateLock` | Architect | **Your decision:** `mirai render` and `updateLock` | T9 |
| 6 | The block's place and size: appended at the end, a line cap only | Architect | **Your decision:** first, at most 8 KiB, with a 32 KiB warning | T3, T3b |
| 7 | Lock gaps: no source, no tree digest, no inputs, no code for a newer lock | Architect | `source`, `framework_sha256`, `from`, `lock-newer`; mark rules checked | T2, T9 |
| 8 | `checkLock` followed symlinked `.mirai` and `.mirai/framework` | Tech Lead, Architect | A link anywhere on the way is refused | T2 |
| 9 | `symbolic-ref --short` was ambiguous | Tech Lead | Full ref, exact prefix | T6 |
| 10 | `replaceAll` expanded `$` patterns; a backtick broke the code span | Tech Lead | A function replacement; backtick refused | T3 |
| 11 | A quadratic `/\s*$/` on a large file | Tech Lead | Gone: the block goes first, no end trimming | T3b |
| 12 | `AGENTS.md` bytes, line endings and mode not kept; not written atomically | Tech Lead, Architect | Temp file plus rename; bytes and mode restored on undo; CRLF and BOM kept; not UTF-8 refused | T3, T5, T7 |
| 13 | Markers inside fences or indented counted | Tech Lead | Column 0, alone on a line, outside fences | T3 |
| 14 | The title strip hit any `# ` line; comments stripped inside fences | Tech Lead, Architect | First non-blank line only; fences kept | T3 |
| 15 | The block wording invited agents to edit protected paths, and claimed edits were detected | Architect | Reworded (spec item 20) | T3 |
| 16 | A specific hint for `AGENTS.md` linked to `CLAUDE.md`; `withBlock` errors specific to `AGENTS.md` | Architect | The hint, and a `file` option; `BlockError` is a `MiraiError` | T5 |
| 17 | A single remote not called `origin` | Tech Lead | Supported, as 05a's identity already did | T6 |
| 18 | Test gaps: T7's first case passed by accident; T5 didn't check that nothing was written, or HOME; T4 skipped folders; temp folders left behind; T1 didn't run lint or status | Tech Lead | All fixed | T1, T4, T5, T7 |

## Noted for later units (in the spec, "Noted for later units")

| Unit | Note | From |
|---|---|---|
| 11 | Claude Code files join `mirai render`, with `from` | Architect |
| 12 | Hooks and CI run the trust-root copy, not the work-tree copy (D-15) | Architect |
| 26 | Hook paths can't be lock entries | Architect |
| 29 | `doctor`: stale versus edited blocks through `from`, `lock-newer`, sweeping stale `.init-*` folders | both |
| 12, 26, 29 | Version skew between the lock and the running MIRAI | Architect |
| `/mirai-setup` | Exclude `.mirai/` from the stack scan | Architect |
| Vendoring | Licences added to `FRAMEWORK_PARTS`; `YAML-SUBSET.md` cites a path that isn't in the copy (harmless) | Architect |

**Not done:**
- **The TOCTOU nit** (a file appearing between the checks and the move): `move` refuses to
  replace anything, and nothing more is needed for a single user.
- **The stale `.init-*` sweep:** deferred to unit 29.
