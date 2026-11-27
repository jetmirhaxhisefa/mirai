---
unit: "30b"
name: dependency-install
status: done (built and merged 2026-11-16, PR #68; spec approved 2026-11-16: "approve 30b"; interview decisions 1–5)
roadmap: design/07-implementation-roadmap.md, row 30b; design/05-open-questions.md §F ("A new dependency has no way in yet"); D-48, TL3-3, R3-C2
depends_on: ["21b", "22", "14", "14c", "08", "18h", "30"]
---

# Unit 30b: A declared dependency, installed after your approval

## Why

Jet, 2026-11-16, during unit 30: "I expect that MIRAI could add new dependencies but with me as a
gate". The pilot's first ticket, BKT-49 (Storybook), needs three new npm packages.

Half of this exists. Since 21b a plan declares a new package as `npm:<name>`, which makes the
ticket high risk, you approve it at the plan gate, and the build refuses any dependency the plan
didn't declare. The other half doesn't exist: nothing installs it. Agents have no network, and
MIRAI's test runs never build and have no network either: they use **your images by name**,
with packages baked in at build time, and a fresh volume each run. So a ticket with a new package
can't even import it in its own tests. Until now, the only way was you adding it on the
integration branch by hand (design/05 §F), which the pilot just did once for
`@vitest/coverage-v8` (`473ae18` on `mirai/pilot`).

## Decisions (Jet, 2026-11-16, in the interview)

1. **A per-ticket image.** After the plan gate, MIRAI updates the manifest and lockfile on the
   ticket's branch, then builds an image for that ticket only, from the integration branch's own
   Dockerfile with the ticket's manifest and lockfile. That ticket's test runs use it; your daily
   images and every other ticket stay as they are. The image is removed when the ticket is done
   or dropped. After you merge, you rebuild your own images once (`docker compose build`).
2. **Open network, scripts off.** The lockfile update and the image build get Docker's normal
   network. Only MIRAI runs them, never an agent; only for the exact approved packages; with
   install scripts off; with the Dockerfile from the integration branch. A registry-only proxy is
   for later.
3. **Exact versions.** A plan row names an exact version: `npm:@storybook/react-vite@10.2.16`,
   `composer:spatie/laravel-permission@6.10.1`. A row without one fails the plan lint. MIRAI
   installs exactly that and pins it exactly in the manifest (no `^` or `~`). You approve
   exactly what lands.
4. **Their dependencies: reported, stopped on big or odd.** MIRAI commits the manifest and
   lockfile change on the ticket's branch as its own commit, before Kai's build. The build's
   output and the MR list every added package with its version. It stops for you
   (parks, `deps-review`) only if:
   - an existing package's version would change;
   - a package resolves from anywhere but the ecosystem's registry (`registry.npmjs.org`,
     `repo.packagist.org`);
   - more than `[dependencies] max_added` packages are added (default 50).
5. **npm and Composer.** Both pilot stacks, driven by stack data (`registry/stacks/`). Other
   ecosystems (pip, go, cargo, …) are refused with a clear message: you add the package by hand.

6. **Accepting a stop (Jet, 2026-11-16, during the build, after P1).** The real probe showed BKT-49's
   Storybook packages also move an existing package (`minipass` 7.1.2 → 7.1.3, needed by a new
   one), so the ticket parks (`deps-review`). `mirai unpark <ticket> --accept-deps` (a gate, your
   terminal, your key) shows what would change and signs acceptance of exactly that change (a hash
   of the rows and of each manifest and lock after the update). The next build installs only if the
   update comes out identical; anything else parks again. A machine-key signature never accepts.

## Scope

**In.**

1. **The plan row (unit 08's lint, 21a's plan).**
   - A dependency row is `<ecosystem>:<name>@<exact version>`. The lint refuses one with no
     version, a range, a tag (`latest`), a URL, a path or a git source.
   - A row for an ecosystem with no install data (decision 5) fails the lint, naming it.
   - Kai's plan section says to name exact versions, and how to find them without network: the
     plan lists what it needs; Jet's approval is where a wrong version gets caught.
2. **The install step** (`mirai build`, after the branch is made from the integration commit and
   before Kai's launch; also reached by `mirai run`):
   - **Only when** the approved plan has dependency rows and the ticket's branch doesn't already
     have MIRAI's install commit for exactly those rows (a re-run doesn't install twice; a
     re-plan with other rows installs again from the integration commit's files).
   - **The lockfile update,** per manifest the rows touch (stack data says which file:
     `frontend/package.json` for npm, `backend/composer.json` for Composer). MIRAI copies only the
     manifest and its lockfile into a scratch folder in the store and runs the ecosystem's
     command there, in the service's own image from the integration branch, with network:
     - npm: `npm install --package-lock-only --save-exact --ignore-scripts --no-audit --no-fund
       <name>@<version>…`;
     - Composer: `composer require --no-install --no-scripts --no-plugins <name>:<version>…`
       (P1 checks it writes `composer.lock` without installing).

     The command, its flags and which files it may write are stack data, not code.
   - **The check (decision 4),** comparing the lockfile before and after: every approved package
     at exactly its version; no existing package's version changed; every resolved source from
     the registry; at most `max_added` new packages; nothing written but the manifest and its
     lockfile. Anything else parks the ticket (`deps-review`) with the list, and nothing is
     committed.
   - **The commit:** the manifest and lockfile, as MIRAI's own commit on the ticket's branch
     (22's format, `Mirai-Ticket` trailer), body listing every added package and version. 21b's
     dependency check then compares Kai's changes against this commit, so Kai can't add another.
3. **The per-ticket image (decision 1).**
   - **Which services:** each compose service with a `build` section whose Dockerfile copies a
     changed manifest or lockfile (read from the Dockerfile's `COPY`/`ADD` lines; a service whose
     Dockerfile can't be read that way is built too, and named in the output).
   - **The check first:** the service's Dockerfile installs from the lockfile with scripts off
     (stack data: `npm ci --ignore-scripts`, `composer install --no-scripts`). A Dockerfile that
     doesn't is refused, naming the line to change, never built (decision 2).
   - **The build:** `docker build` with the integration branch's Dockerfile and a context made of
     the integration commit's tree with the ticket's manifest and lockfile on top, `.dockerignore`
     honoured, MIRAI's own Docker settings (14c), its normal network. Tagged
     `<image name>:mirai-<ticket>` (for `hr-platform/frontend:dev`:
     `hr-platform/frontend:mirai-bkt-49`), labelled with the ticket and the install commit.
   - **The ticket's test runs use it:** run_tests, MIRAI's own test run after the build, fix
     rounds, review and the gate record take the per-ticket tag for those services in place of
     the trust root's image. Every other ticket, and the baseline, use the trust root's images.
     The run's output names the per-ticket image.
   - **Removed** with 18h's release: when the ticket is done or dropped, its images go. `mirai
     doctor` lists any left over.
4. **After the merge:** the MR's description says the packages it adds and that your images need
   `docker compose build` once. The next baseline on the integration branch would otherwise use
   the old images: `mirai baseline` checks that each built service's image contains the
   integration branch's lockfile (a hash label set at build) and says to rebuild if not.
5. **The finding it fixes:** design/05 §F's open item is closed; F10's workaround on the pilot
   stays as it is.
6. **Docs:** `docs/agents.md` (new dependencies), `docs/run.md`, `docs/agent-safety.md` (what the
   install can reach).

**Out.**
- A registry-only network for the install (a proxy): later (decision 2).
- Ecosystems other than npm and Composer.
- Updating or removing an existing package through a plan: a plan row adds a new one. A version
  change of an existing package stays yours, by hand.
- Your own images: MIRAI never rebuilds or retags them.

## Tests

- T1 **Plan lint:** `npm:a@1.2.3` passes; `npm:a`, `npm:a@^1.2`, `npm:a@latest`, a URL, a git
  source and `pip:x@1.0` fail, each with its reason. A plan with a dependency row is high risk.
- T2 **Install, npm:** an approved row on a sample manifest (stand-in runner) produces exactly
  `"a": "1.2.3"` and a lockfile, one MIRAI commit with the trailer and the list; a re-run adds no
  second commit.
- T3 **Install, Composer:** the same for `composer:vendor/pkg@1.0.0`.
- T4 **The check parks:** an existing version changed; a `resolved` outside the registry; more
  than `max_added` added; a file other than the manifest and lockfile written. Each parks with
  `deps-review` and commits nothing.
- T5 **Kai adds another:** after the install commit, Kai adds an undeclared package or changes
  the installed version: 21b's check refuses it.
- T6 **The image:** the service to build is chosen from its Dockerfile's `COPY` lines; a
  Dockerfile without `--ignore-scripts` / `--no-scripts` on its install line is refused, naming
  it; the tag and labels are as specified; the ticket's test run uses the per-ticket tag and
  another ticket's uses the trust root's.
- T7 **Release:** done or dropped removes the ticket's images; doctor lists a leftover one.
- T8 **The baseline after merge:** an image whose lockfile label doesn't match the integration
  branch's lockfile is named, with `docker compose build`.

## Probes

- **P1 (real Docker):** on the sample app, an npm row and a Composer row installed for a ticket,
  each image built and used by that ticket's run_tests; install scripts don't run (a planted
  package with a `postinstall` that writes a file: the file never appears); Composer writes its
  lockfile without installing.
- **P2 (red team, the session's side):** from inside a build session, Kai tries to widen the
  install: edits the lockfile to a tarball URL, adds a package to the manifest, edits the
  Dockerfile, calls npm with network. Each is refused or blocked as today. **As built:** no new
  red-team case. The red team's cases stay stack-neutral (no tool names, 14c T13), and `g16-empty`
  already proves a session has no network, which covers npm; the manifest, lock and Dockerfile
  edits are the build's checks, tested (build.test.js: a lock edit after the install needs you).
- **R1 (real, the pilot):** BKT-49's plan declares the Storybook packages at 10.2.16; you approve;
  the install commits them, builds `hr-platform/frontend:mirai-bkt-49`, and Kai's stories run
  against it.

## Done when

The tests pass, P1 and P2 hold, and R1: BKT-49's packages arrive through its plan and your
approval, with no hand install.
