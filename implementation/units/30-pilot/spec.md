---
unit: "30"
name: pilot
status: draft (interview 2026-11-16, decisions 1–8 below; waits for "approve 30")
roadmap: design/07-implementation-roadmap.md, row 30 (the pilot checkpoint) and its early stop rule; design/05-open-questions.md §E (Q16–22)
depends_on: ["29", "17a", "17b", "29b", "29c", "29d", "18h"]
---

# Unit 30: The pilot checkpoint (Thudos)

## Why

Until now everything has been proven on the sample app. Calibration, the stop rules and the
first real value all need real tickets. Unit 30 installs MIRAI on the real project, runs **one**
real ticket through Milestone A's flow, and measures it. The measurements decide go or no-go
for Milestone B.

## Decisions (Jet, 2026-11-16, in the interview)

1. **Base.** A new branch `mirai/pilot` of `people-management-tool/platform`, made from
   `main` (`224afc4`, with Jet's `.env.example` update). MIRAI only ever targets it
   (`[git] integration_branch = "mirai/pilot"`),
   never `main`. BKT-44 and BKT-47 aren't in it. They come in later when Jet merges them into
   `main` and `main` into `mirai/pilot`.
2. **The checkout:** `~/Projects/thudos` (cloned 2026-11-16, clean, on `main`, pulled to `224afc4`; `backend/.env` copied from `.env.example` on Jet's word, git-ignored, mode 600).
3. **The council goes.** On `mirai/pilot`, the first commit removes:
   - all of `.claude/`;
   - all three `CLAUDE.md` files (root, `backend/`, `frontend/`) and `CLAUDE.local.md.example`;
   - `docs/development-council.md` and the council-only scripts (`scripts/set-risk.sh`,
     `scripts/token-savings.sh`);
   - the README section "Working with Claude (AI development)" and the council lines in
     `.gitignore`.

   Agents there get only MIRAI's instructions (D-28; P9). `scripts/quality-gate.sh` stays: it is
   the project's own gate, and the named checks may reuse its steps. `main` is untouched.
4. **The ticket: BKT-49, "Storybook for the UI primitives"** (Jira; text below). It is
   frontend-only and needs nothing from BKT-44 or BKT-47. Scope: a working Storybook plus all 49
   primitives in `frontend/src/components/ui`. The layout components and the pattern pages are a
   follow-up ticket (B checkpoint material).
5. **Risk paths (Q19).** The council's high-risk list is carried over as MIRAI globs in
   `[gate.risk] high` (draft below). Jet reviews it in the detect-drafted config. MIRAI's built-in
   protected paths apply as well.
6. **Docs (Q20).**
   - MIRAI's ADRs and HLDs go in `docs/decisions/`. MIRAI's numbering starts at ADR-0009 and
     HLD-0002, so it never clashes with BKT-44's ADR-0002–0008 and HLD-0001 when they merge.
   - PRDs and tickets go in `docs/mirai/`.
7. **Business context (Q17).** `ALL_FEATURES.md` from GitHub `people-management-tool/POC` is
   copied to `docs/mirai/context/ALL_FEATURES.md` on `mirai/pilot`. Agents can't reach other
   repos. Jet confirms it's still current. Milestone B reads it; BKT-49 doesn't.
8. **Stop rule by size.** The early stop rule (row 30) stays, but the turn limit is 2× the
   provisional cap for **the size MIRAI assigns at ticket approval**. BKT-49 is likely M. The
   other limits stay as written: about 2 h of Jet's attention, more than 2 fix rounds, parking,
   and fewer than 3 tickets a night. The usage note reports per size: "N S tickets or M M tickets
   a night".

## The pilot questions (`05` §E), answered

| Q | Answer |
|---|---|
| 16 Decision docs | There's no `docs_old/` on any branch. HLD-0002, ADR-0004 and ADR-0009 exist nowhere. The truth is `docs/decisions/` on the integration branch: today ADR-0001 only; BKT-44's set once merged. |
| 17 Business context | `POC/ALL_FEATURES.md`, copied in (decision 7). |
| 18 Local URLs | The `*.thudos.test` proxy on port 80 (ADR-0001, `main`'s compose). QA (Milestone C) uses it. |
| 19 Risk paths | Carried over (decision 5). |
| 20 Docs location | `docs/decisions/` and `docs/mirai/` (decision 6). |
| 21 CI | None: no `.github/workflows`, and the free org can't protect branches in private repos (HTTP 403). Unit 54 reports "local-only" on the pilot. |
| 22 Compose mounts | Only project folders and named volumes, so nothing outside the project. But `app` reads `env_file: ./backend/.env`, and `proxy` publishes port 80. A test compose file for agent runs uses `backend/.env.test` and leaves out the proxy and the published port. |

## BKT-49 (the Jira text, as agreed)

**Title:** Storybook for the UI primitives

**Description:** set up a working Storybook that shows every primitive in
`frontend/src/components/ui`, so the team can see and reuse the design system without opening
the app. Today it is half set up and broken:
- `.storybook/main.ts` references packages that aren't installed;
- there's no `storybook` script;
- only Button has a story.

**Acceptance criteria**
1. **It runs.**
   - `npm run storybook` starts Storybook 10 locally, and `npm run build-storybook` builds with
     no errors.
   - The config uses only packages that exist for Storybook 10: `@storybook/react-vite`, and no
     `addon-essentials`.
   - New packages are pinned in `package.json` and the lockfile.
2. **Every primitive has a story.**
   - Each of the 49 components in `components/ui` has at least one story, titled `UI/<Name>`.
   - Story files sit next to their component; `src/stories/Button.stories.tsx` moves beside
     `button.tsx`.
   - The stories show the variants, sizes and states the component has.
   - Each story file uses `autodocs`.
3. **It looks like the app.** Stories use the app's Tailwind theme (`index.css`), and a toolbar
   switch toggles light and dark mode.
4. **Self-contained.**
   - Components that need context get it inside Storybook (form, sidebar, toast and sonner,
     chart).
   - No story calls the API or the network.
5. **Enforced by tests (Vitest).**
   - A test fails if a file in `components/ui` has no matching story.
   - A test renders every story and fails if any of them throws.
6. **Nothing else breaks.**
   - lint, tsc, `vite build` and the existing Vitest tests still pass.
   - `build-storybook` is added to the project's checks.
7. **Components unchanged.** No file in `components/ui` is modified. A real bug found along the
   way is reported in the MR.
8. **Documented.** The frontend README gets a "Storybook" section: how to run it and how to add a
   story.

**Out of scope:** the layout components; the table, form and theme pattern pages; visual
regression; hosting.

**The packages go in by hand.** Agents have no network, and until a broker verb exists a new
dependency is added on the integration branch by a person, with a new baseline (design/05 §F,
`docs/agents.md`).
- Before BKT-49 starts, Jet adds the Storybook 10 packages the setup needs, pinned to the
  installed `storybook` version (`10.2.16`): `@storybook/react-vite`, `@storybook/addon-docs` and
  `@storybook/addon-themes`.
- This is one commit on `mirai/pilot`; the baseline is recorded after it.
- AC1's "pinned" is met by that commit, and the agent's plan may not add others. If the plan finds
  one missing, the ticket parks for Jet.

## Scope

**In.** In this order; each step must work before the next one starts.

1. **Prepare `mirai/pilot`** (I prepare the commits, Jet reviews and pushes):
   - the council removal (decision 3);
   - `docs/mirai/context/ALL_FEATURES.md` (decision 7);
   - the Storybook packages (above);
   - `backend/.env.test` with dummy secrets, from `.env.example`;
   - the test compose file (Q22).
2. **First boot** (the project has never run on this laptop): `docker compose up -d --build`,
   then composer install, the migrations and npm install inside the containers. The app answers
   on `app.thudos.test` and `api.thudos.test` (the `/etc/hosts` entries from ADR-0001, a sudo
   step for Jet in Terminal). Any fix this needs is a commit on `mirai/pilot` before install, so
   the baseline starts from a stack that runs.
3. **Install.**
   - `mirai init` on `mirai/pilot`. Unit 17a's detection drafts the config. Jet reviews it, with:
     the integration branch; `[gate.risk] high` (draft below); the named checks wired to Pint,
     tsc, ESLint, `vite build` and `build-storybook`; the docs paths.
   - The test adapters are checked on the pilot's PHPUnit, Vitest and Playwright.
   - Jet's key and the machine key are set up for this repo (unit 06 and 29b).
   - The test baseline is recorded (17b).
4. **Instruction files (P9):** detection lists no agent-instruction files left on `mirai/pilot`,
   apart from MIRAI's own.
5. **Red team GREEN on the pilot** (`mirai redteam run`, Terminal). The known limits
   `h-timeout-link` and `l-cd` are accepted.
6. **`mirai doctor` green on `mirai/pilot`.**
7. **BKT-49 through Milestone A's flow**, supervised, as SAMPLE-6 went:
   - approve the ticket, then plan, then approve the plan;
   - the TDD build, Rex's review and the proofs;
   - the MR into `mirai/pilot`. Jet merges.
8. **The usage note** (`implementation/units/30-pilot/usage-note.md`), from BKT-49's run log and
   `/status`:
   - turns, tokens, minutes, fix rounds and the limit share;
   - Jet's attention time (`mirai session` time plus one manual note);
   - "at this rate, N S tickets or M M tickets fit in one night and in a week";
   - each early stop limit, met or not;
   - go or no-go for Milestone B.
9. **`05` §E updated** with the answers above, and anything the run changes.

**Out.**
- Any change to the pilot's `main`; BKT-44 and BKT-47.
- CI (unit 54); QA through the proxy (Milestone C).
- More pilot tickets: those come at the B checkpoint, C and calibration.
- New MIRAI features. A gap the pilot finds becomes a fix or a follow-up, listed in the note.

## `[gate.risk] high`, the draft

From the council's list (`CLAUDE.md` "Risk classification" and the edit hook's patterns), plus
HR data. MIRAI's globs ignore case.

```toml
[gate.risk]
high = [
  # auth, sessions, permissions
  "backend/app/**/*auth*", "backend/app/**/*auth*/**", "backend/app/**/*sanctum*",
  "backend/app/**/*permission*", "backend/app/**/*policy*", "backend/app/Policies/**",
  "backend/app/Http/Middleware/**", "backend/app/**/*guard*",
  "backend/config/auth.php", "backend/config/sanctum.php", "backend/config/cors.php",
  "backend/config/session.php", "backend/config/permission.php",
  # the public API
  "backend/routes/api.php",
  # data
  "backend/database/migrations/**", "**/*.sql",
  # sensitive HR records
  "backend/app/**/*payroll*", "backend/app/**/*salary*", "backend/app/**/*compensation*",
  "backend/app/**/*leave*", "backend/app/**/*employee*",
  # infrastructure
  "docker/**", "**/Dockerfile*", "**/*nginx*", "docker-compose*.yml", ".github/workflows/**",
  "**/.env.example",
]
```

## Probes

- **P1:** the council removal leaves nothing Claude Code loads by itself on `mirai/pilot`. No
  `.claude/`, no `CLAUDE.md`, no settings: detection's instruction-file list is empty apart from
  MIRAI's.
- **P2:** an agent-triggered test run uses the test compose file: no port 80 published, and
  `backend/.env` is never read.
- **P3:** the baseline on `mirai/pilot` is complete on PHPUnit, Vitest and the named checks.
  Playwright stays a manual level if its browsers or the proxy aren't there (recorded, not
  failed).

## Done when

- `mirai doctor` is green on `mirai/pilot`.
- BKT-49's MR targets `mirai/pilot` and Jet has merged it.
- The usage note is written, with go or no-go.
- `05` §E is answered.
