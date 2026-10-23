# Sources analyzed

All repos are cloned read-only with `git clone --depth 1` into `~/Projects/mirai-sources/`, outside the MIRAI repo. No scripts or installers from them have been run.

**Moved on 2026-10-23** from `research/_sources/` to `~/Projects/mirai-sources/`, outside the MIRAI repo, and made read-only (`chmod -R a-w`). A bare `node --test` had run their test files from inside the repo (`implementation/units/01-cli-skeleton/test-results.md`). The old path stays in `.gitignore` as a guard.

| Source | Local path | Commit | Commit date |
|---|---|---|---|
| BMAD Method — https://github.com/bmad-code-org/bmad-method | `~/Projects/mirai-sources/bmad-method/` | `cfba3ff5f982c1809e060606e399f55ebd7bce5e` | 2026-10-16 |
| cursor/plugins (pstack) — https://github.com/cursor/plugins | `~/Projects/mirai-sources/cursor-plugins/pstack/` | `0317eb8b858c991c57721358daaee19dbe8c814d` | 2026-10-17 |
| Addy Osmani agent-skills — https://github.com/addyosmani/agent-skills | `~/Projects/mirai-sources/addyosmani-agent-skills/` | `aeac41d4d005999432bb7312f7ff06383a91d59d` | 2026-10-13 |
| BMAD Test Architect (TEA module) — https://github.com/bmad-code-org/bmad-method-test-architecture-enterprise | `~/Projects/mirai-sources/bmad-tea/` | `22f38e5a3f2699be60dd6fd487ae676df6e54b66` | 2026-10-15 |
| BMAD Loop (unattended epic runner) — https://github.com/bmad-code-org/bmad-loop | `~/Projects/mirai-sources/bmad-loop/` | `77d89f96f25c1f14a83e9ccdca7430267f578f57` | 2026-10-17 |
| vercel-labs/skills (find-skills) — https://github.com/vercel-labs/skills | `~/Projects/mirai-sources/vercel-labs-skills/` | `13e4063a1cf913f5606d57d42ab83a86f5001e04` | 2026-10-09 |
| blader/humanizer (vetting candidate) — https://github.com/blader/humanizer | `~/Projects/mirai-sources/blader-humanizer/` | `8c307f367c91bd974002f10f2be2965d642c13df` | 2026-10-16 |
| lackeyjb/playwright-skill (vetting candidate) — https://github.com/lackeyjb/playwright-skill | `~/Projects/mirai-sources/lackeyjb-playwright-skill/` | `dd47a6a023e249eb1b36e9e943eab89d0900865d` | 2026-08-14 |
| obra/superpowers (vetting candidate, prior art not in the brief) — https://github.com/obra/superpowers | `~/Projects/mirai-sources/obra-superpowers/` | `bb92a77741419a4ab5f06e711a283343f1ada0c3` | 2026-10-09 |

The pilot project (`/Users/jetmir.haxhisefa/Projects/people-management-tool/platform`) was read at commit `9afe20b50b49f68608dec7e6393d1ab1a9959adb` on branch `feature/BKT-48/bmap-agent-setup` with an uncommitted working tree (see `04-pilot-project-analysis.md`). Nothing in it was changed.

Note: BMAD `main` is the **v7 preview alpha** (stable is v6.12 on branch `V6.12`). The analysis targets `main`, because that is where the method is heading; v6-only behavior from the user's notes is called out where it differs.

Cloned on 2026-10-17. File paths cited in the research docs are relative to `~/Projects/mirai-sources/`.
