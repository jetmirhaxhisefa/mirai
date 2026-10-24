---
unit: "12"
date: 2026-10-24
reviewers: Tech Lead, Architect (independent, read-only, no network)
verdicts: CHANGES REQUESTED (3 blocking), CHANGES REQUESTED (3 blocking, overlapping); all findings applied, decided by you, or noted for later units
---

# Unit 12 — Review

**What held up (verified by the reviewers):**
- The snapshot reads only git objects.
- The manifest's hash is checked before the manifest is parsed.
- A framework file the base lock doesn't list is refused.
- Gate rules come from the snapshot, and `[gate] protected` can only add.
- Renames count as both paths; paths with newlines and non-ASCII characters survive.
- `classify` is pure, so CI can reuse it on base data.
- The run report gets what it needs.

## Applied in unit 12

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **Blocking:** ignored files (`.claude/settings.local.json`, `.idea/`, a self-ignoring `.vscode/`) were invisible after an agent launch | both | **Your decision:** closed here. Ignored files under protected paths are fingerprinted and compared before and after a launch, and listed apart otherwise | T4b |
| 2 | **Blocking:** a symbolic link (`.vscode -> tools/ide`) slipped past every rule | Architect | Links count as a change; `x/**` matches `x` | T2 |
| 3 | **Blocking:** case variants slipped past on macOS | both | Case-insensitive matching | T2, T10 |
| 4 | **Blocking:** concurrent snapshots left one that always read as tampered; raw EACCES/ENOENT errors | Tech Lead | A build lock; a deterministic manifest | T6b |
| 5 | **Blocking:** the `package.json` install-script check could be bypassed with a large or linked file; commit mode crashed on a large blob | Tech Lead | Unreadable counts as changed; read limits; an ENOBUFS code | T2 |
| 6 | Stack-specific rules built in (phpunit, eslint, Cargo, Composer) | you | **Your decision:** a stack-neutral core plus opt-in ecosystem packs, with the install-script check as data | T1, T1b, T2 |
| 7 | Declared paths could be patterns (`**`) | both | **Your decision:** exact paths only, in classify and in the plan lint | T3, plan lint |
| 8 | D-15's epic base | Architect | **Your decision:** always the integration branch; D-15 amended | — |
| 9 | The diff ran from the base tip, not the merge-base; ranges compared tips | both | The merge-base, for work tree and ranges; `a...b` accepted | T4 |
| 10 | A clean filter ran during the work-tree diff; T4 passed by accident | Tech Lead | `core.attributesFile` pinned; T4 tests the filter | T4 |
| 11 | The glob matcher's exponential backtracking; a trailing `/` anchored; `[ ]` matched literally | Tech Lead | A linear matcher; `.gitignore` anchoring; unsupported forms refused in schemas | T10 |
| 12 | The manifest had a time in it; the store record was the only anchor | Architect | No time; blob ids recomputed from the bytes and checked against the commit | T6b |
| 13 | Snapshot reads weren't hash-checked; the run's snapshot wasn't pinned; prune could drop it | Architect | Hashed reads; `openTrustRoot({ baseSha })`; `keep` | T6b |
| 14 | `CLAUDE.md` → `AGENTS.md` links and linked or huge imports refused the snapshot; nested instruction files and skills missing | both | Skipped and listed; nested files, `.claude/rules`, skills and imports included | T6b |
| 15 | Rule gaps: nested IDE folders, workspace and devcontainer files, package-manager hooks, `mise`, baselines, test transforms, `lefthook-local`, `bun`/`uv` locks, other tools' instruction files | both | Added to the core or a pack | T1b, T2 |
| 16 | Nits: verify missed modes and added folders; the leading-space path; leftover `.tmp-*`; snapshot format version; literal pathspecs; the `base-not-pushed` hint; `park` vs presets; the instruction-file list; the E2E role constant; doc drift | both | All fixed | T4, T6b, T11 |

## Noted for later units (in the spec)

| Unit | Note | From |
|---|---|---|
| 12b | Which framework copy the launcher runs (the work tree's can be edited together with its lock) | Architect |
| 13 | `denyWrite` on `trust/`; `strict.json` rendered into the snapshot; deny writes to auto-run paths | both |
| 14 | Compose inputs in the snapshot | Architect |
| 19 | Pinned base; `ignoredFingerprint` before and after each launch; the actor is the registry role | both |
| 20, 23, 25, 29, 37, 53 | `needsYou` per preset; CI runs classify on base...head; `doctor` checks; overlays can't replace `core`; stacked diffs from the parent | Architect |

**Not done:**
- `branch.<b>.remote` as the remote;
- absolute imports inside the repo, and escaped spaces in imports;
- a size limit across the whole import closure.
