---
status: draft
version: 5
---

# 02 — Architecture diagrams

There are eight views, each explained in plain words underneath. Names match `03-components.md`.
Version 2 applied the round-1 review decisions (`06-review-round-1.md` §G). Version 3 applied the
follow-up agreements Q1–Q9 (`08-followup-discussion.md`). Version 4 applied review round 2
(`06-review-round-2.md`, fixes and decisions U1–U5). Version 5 applies review round 3
(`06-review-round-3.md` §B and decisions V1–V3). **"Integration branch"** below means the
configured `[git] integration_branch`: `main` by default, `mirai/pilot` during the pilot (R3-C1).

---

## (a) The lifecycle

```mermaid
flowchart TD
    S(["Setup: mirai init + /mirai-setup"]) --> I["Intake + brief<br/>product-manager"]
    I --> T{"Track?"}
    T -- quick --> TK
    T -- standard --> P
    T -- full --> BG{{"Human gate: brief + track<br/>full track only"}}
    BG --> P

    P["PRD draft<br/>product-manager"] --> PL["lint prd<br/>script"]
    PL -- fail --> P
    PL -- ok --> PV["Verify PRD<br/>verifier, fresh context"]
    PV -- "blocking, within loop guard" --> P
    PV -- pass --> PG{{"Human gate: PRD<br/>standard: brief + track approved here too"}}
    PG -- changes --> P
    PG -- approved --> D0{"full track or<br/>ADR-worthy decision?"}

    D0 -- no --> TK
    D0 -- yes --> D["HLD / ADR / LLD draft<br/>architect"]
    D --> DL["lint design<br/>script"] --> DV["Verify design<br/>verifier"]
    DV -- blocking --> D
    DV -- pass --> DG{{"Human gate: design"}}
    DG -- changes --> D
    DG -- approved --> TK

    TK["Tickets: epics + stories<br/>ticket-planner"] --> TL["graph + closure + mirai trace<br/>script"] --> TV["Verify tickets<br/>verifier"]
    TV -- blocking --> TK
    TV -- pass --> TG{{"Human gate: ticket set<br/>quick: approve the ticket"}}
    TG -- approved --> DMR["Orchestrator merges the docs MR<br/>after your signed approval, docs only"]
    DMR --> LOOP

    subgraph LOOP ["Per ticket, run by the orchestrator script (the only part that runs overnight)"]
        direction TB
        PN["Plan<br/>developer, declares protected paths<br/>and new dependencies"] --> PNG{{"Plan gate<br/>auto on quick track;<br/>human if high risk or declared paths"}}
        PNG --> B["Build, TDD by setting<br/>developer runs named checks via run_tests"]
        B --> C["Checks by the orchestrator, in hardened containers:<br/>named checks, nothing new broke vs baseline,<br/>diff coverage, floor guard, trace<br/>signed gate-result record"]
        C -- "red, uses a round" --> B
        C -- green --> EW{"e2e: yes?"}
        EW -- yes --> E2W["Write the E2E test<br/>qa, before review"]
        EW -- no --> R
        E2W --> R["Review code + E2E test<br/>reviewer, depth by risk"]
        R -- blocking --> B
        R -- pass --> Q["QA: verify every AC<br/>run_tests in project containers"]
        Q -- fail --> B
        Q -- pass --> SH["Ship: trace + signed proof,<br/>push + open MR<br/>orchestrator, not the agent"]
    end

    B -. "cap or budget hit" .-> PK[["Parked: blocked<br/>with a note"]]
    R -. "cap / no progress / repeat" .-> PK
    Q -. "app won't start" .-> PK

    SH --> RM{"Epic release mode?"}
    RM -- per-ticket --> M{{"You merge the ticket MR"}}
    M --> REL["Release this ticket:<br/>deploy, smoke, your go/no-go"]
    RM -- together --> MF{{"You merge into feature/epic"}}
    MF --> ALL{"All epic tickets merged?"}
    ALL -- no --> LOOP
    ALL -- yes --> E2E["Final E2E: every epic AC<br/>qa, on the feature branch"]
    E2E --> MM{{"You merge feature/epic into the integration branch"}}
    MM --> REL2["Release the epic:<br/>deploy, smoke, your go/no-go"]
    REL --> LIVE(["live"])
    REL2 --> LIVE
    LOOP --> RP["Run report / morning report"]
    PK --> RP
```

**In plain words:**
- **Documents:** every document goes author → cheap script check → separate verifier → **you**. A
  document only feeds the next stage after you approve it. No document gate can be `auto` (D6).
- **Gates by track (U4, R3-M4):** `quick` = approve the ticket, then merge (2 actions; 3 once
  the release stage adds your go/no-go). The quick plan gate is `auto`. `standard` = the brief is
  approved together with the PRD. `full` keeps its own brief gate. Approved documents reach the
  integration branch through one docs MR, which **the orchestrator merges after your signed
  ticket-set approval** (V3); it carries documents only. `01` §16 is the one gates table.
- **The build loop:** a script runs the per-ticket loop, not an agent. Each arrow back to "Build"
  after handover uses one round of the ticket's shared budget, which covers checks, review and QA
  together. Failures the developer fixes inside its own session don't count. The orchestrator,
  not the agent, commits after each green step.
- **E2E before review (U2):** when `e2e: yes`, QA writes the E2E test before review, so the
  reviewer checks it with the code and one proof covers both.
- **No ship gate:** push and MR are automatic; your merge is the gate.
- **Parking:** when the budget runs out, the ticket is parked with a note instead of retried.
- **Tests:** `tdd` and `tests` settings decide how tests are written. The gate checks that nothing
  new broke against the test baseline, and only changed lines need tests (diff coverage). E2E
  tests exist only for critical journeys and are written by QA, not the developer.
- **Models:** each step runs at its tier (0 no AI, `light`, `standard`, `deep`). Only `light`
  steps escalate, once. The verifier uses another family, else another Claude model, else the
  same model in fresh context (logged).
- **Release:** an epic is released ticket by ticket (the default), or all together through a
  feature branch with a final E2E test (D3).
- **Merging:** no code merges without you, anywhere. The docs MR is the only merge MIRAI
  performs (V3).

---

## (b) Stacked tickets inside one epic

```mermaid
flowchart LR
    MAIN[("integration branch")] --> A["ticket A branch<br/>MR A targets the integration branch"]
    A --> B["ticket B branch<br/>starts from A<br/>MR B targets A"]
    B --> C["ticket C branch<br/>depth 2 is the limit<br/>MR C targets B"]
    A -. "you merge A" .-> RB["MIRAI: rebase --onto integration branch old-A-head,<br/>push --force-with-lease with the expected sha,<br/>re-run gate, retarget MR B"]
    RB -. "code hash unchanged" .-> KEEP["review proof still valid"]
    RB -. conflict .-> PK2[["B parked: rebase-conflict"]]
    RB -. "then C on B" .-> CAS["cascade one level at a time"]
    A -. "you request changes" .-> WAIT["B waiting on A"]
    MAIN -. "trust root + lock + CI keys" .-> TRB["always from the integration branch,<br/>never from A"]
    B -. "never" .-> NOM["B never merges into A"]
```

**In plain words:**
- **Starting early:** if B needs A and A's MR is open but not merged, B starts from A's branch. B's
  MR shows only B's changes.
- **Limits:** at most two levels deep (A → B → C), and only inside one epic (D2).
- **No double review:** when A merges, B is moved onto the integration branch with
  `rebase --onto`, which also works after a squash merge. The code hash is a normalized patch (no
  blob IDs, no line numbers, R3-M11), so if B's own change is the same, its review still counts.
  Only the quality gate re-runs. The orchestrator pushes with `--force-with-lease`, naming the
  exact commit it expects, and records A's head every time it pushes A.
- **Rules from the integration branch:** a stacked ticket always runs under the trust root and
  lock from the integration branch, never from its unmerged parent (R2-M6). CI verifies B against
  the integration branch's keys and lock too (R3-M10).
- **B never merges into A.** B's MR targets A only so you see B's diff; it is retargeted before
  it can be merged.
- **In a `together` epic** the same picture applies, with `feature/<epic>` in place of the
  integration branch.

---

## (c) How the parts relate

```mermaid
flowchart LR
    subgraph FW ["Framework files: from the MIRAI repo, read-only in a project"]
        direction TB
        AG["Agents with personas<br/>product-manager · architect · ticket-planner<br/>developer · reviewer · qa · verifier"]
        SK["Skills<br/>mirai-new · mirai-prd · mirai-design · mirai-tickets<br/>mirai-plan · mirai-tdd · mirai-review · mirai-qa · mirai-ship<br/>mirai-setup · mirai-interview · mirai-write ..."]
        TP["Templates<br/>brief · PRD · HLD · ADR · LLD · epic · story · bug<br/>plan · review · QA report · MR · run report · release"]
        CK["Checklists + lints<br/>per document type"]
        CLI["mirai CLI script, used by you and the orchestrator<br/>run · agent run · inbox · approve · unpark · handover<br/>log · status · gate · lint · trace<br/>show · clean · archive · resume · report · contribute"]
        RT["MIRAI MCP broker, the agents' only way in<br/>run_tests: levels + named checks, no shell<br/>launch · log · lint · trace"]
        AD["Tool adapters<br/>Claude Code first; Codex, Cursor later"]
        CN["Connector contract<br/>repo first; ClickUp / Jira / Linear / Confluence later"]
    end

    subgraph HOME ["MIRAI home: ~/Library/Application Support/mirai/repo-id, outside the project, denied to agents"]
        SNAP["Trust root: copy from the integration branch<br/>framework + config + custom + tool files<br/>+ strict settings bundle + hooks + broker<br/>re-hashed before every launch"]
        ST["Orchestrator store: run state · ticket status, its one home<br/>rounds · budgets · parking · checkpoints<br/>registered branches · test baseline · reports<br/>plans · review + QA results · evidence<br/>90-day retention, then mirai clean"]
        INF["Per-launch input folder<br/>read-only for that one launch"]
    end

    subgraph PJ ["Project files: never leave the project"]
        direction TB
        CFG[".mirai/config.toml<br/>repos · resources · test levels<br/>tdd / tests · tiers · branch pattern"]
        CUS[".mirai/custom/<br/>per-skill overrides"]
        CTX[".mirai/context/<br/>project · business · conventions<br/>feature map + critical journeys · test baseline"]
        VS["verify-app skill<br/>generated at setup"]
        DOCS["Work documents<br/>one place per artifact type"]
        REC["Branch-carried facts<br/>doc versions · signed approvals<br/>signed proofs + gate-result record<br/>branch.json · handover.json<br/>E2E tests · public keys with key ids"]
    end

    subgraph EN ["Enforcement"]
        GH["git hooks in the trust root<br/>pre-commit · pre-push<br/>host git pinned, .git/config hash-checked"]
        CIJ["CI: mirai-verify from the base branch<br/>+ test job, required checks"]
        TH["Tool hooks<br/>fast feedback + blocking rules"]
    end

    FW -- "snapshot at run start" --> SNAP
    CFG -- "snapshot" --> SNAP
    CUS -- "snapshot" --> SNAP
    SK -- "workflow skill calls, via the broker" --> RT
    RT -- "hands requests to" --> CLI
    CLI -- "launches with the bundle from" --> SNAP
    CLI -- "launches, logs, budgets" --> AG
    CLI -- "copies inputs into" --> INF
    AG -- "reads inputs from" --> INF
    AG -- "tests, checks, log, lint, trace only via" --> RT
    RT -- "built from" --> SNAP
    AG -- follow --> SK
    SK -- fill --> TP
    SK -- run --> CK
    AG -- read --> CTX
    AG -- "qa uses" --> VS
    SK -- "write through" --> CN
    CN -- writes --> DOCS
    CLI -- writes --> REC
    CLI -- writes --> ST
    AD -- "generate tool files from" --> SK
    GH -- "check, from trust root" --> REC
    CIJ -- "recompute hash, verify with integration-branch keys + lock" --> REC
    TH -- check --> REC
```

**In plain words:**
- **Skills hold the procedures. Agents are personas that follow skills.**
- **The `mirai` CLI** is the one thing that launches agents, writes logs, picks models and
  enforces budgets (D-12). **Agents and workflow skills never run it directly** (R3-C3): it needs
  the MIRAI home, which the sandbox denies. They use the narrow **MIRAI MCP broker**, which runs
  outside the sandbox as the orchestrator. Inputs reach an agent through a per-launch read-only
  folder; outputs come back only as structured output.
- **The MIRAI home (R2-C1):** the trust root, the orchestrator store and the hooks live in
  `~/Library/Application Support/mirai/<repo-id>/`, outside the project. Agents can neither read
  nor write it, and they can't write `.git/**`. So a ticket branch can't relax the gate that
  checks it (R-C2), and an agent can't reset its own counters.
- **Two kinds of state:**
  - facts that belong to an MR (approvals, proofs) travel on its branch;
  - run bookkeeping lives in the orchestrator store and is never committed (R-C4). One machine in
    the MVP (U3).
- **Verdicts** come from the agents' structured output captured by the launcher, never from files.
- **Where results live:** review and QA results stay in the orchestrator store and are never
  posted to the git host. Only small signed files are committed: the proofs, the gate-result
  record, `branch.json` and `handover.json` (so CI can see which branches are MIRAI's). The MR gets one line,
  `Review: PASS after N rounds (MIRAI)`, plus QA as text.
- **Sync-back:** it can only ever read the framework side (D-21).

---

## (d) One feature, from idea to live

```mermaid
sequenceDiagram
    autonumber
    actor H as You
    participant O as mirai CLI / orchestrator
    participant PM as product-manager (Nora)
    participant V as verifier (Vera)
    participant AR as architect (Arlo)
    participant TP as ticket-planner (Tess)
    participant DV as developer (Kai)
    participant RV as reviewer (Rex)
    participant QA as qa (Ivy)
    participant G as git host + CI

    H->>PM: /mirai-new "Employees can request leave"
    PM->>H: Inputs? Anything else? (brain dump)
    PM->>H: one question + guess (interview)
    PM->>O: brief.md, then prd.md (draft)
    O->>V: verify, fresh context, model by ladder
    V-->>O: findings (2 blocking, 5 non-blocking)
    O-->>PM: blocking only (loop guard counts the round)
    PM->>O: fixed / disputed per finding
    O->>V: round 2: old blocking + delta only
    V-->>O: PASS
    H->>O: mirai inbox: approve brief + PRD (real terminal, content hash signed)

    H->>AR: /mirai-design
    AR->>O: hld.md, ADR-0010, ADR-0011, lld (draft)
    O->>V: verify design
    V-->>O: PASS after 1 fix round
    H->>O: mirai inbox: approve design

    H->>TP: /mirai-tickets
    TP->>O: epic (release per-ticket) + 7 stories
    O->>O: graph + closure + mirai trace
    O->>V: verify tickets
    H->>O: mirai inbox: approve ticket set
    O->>G: open the docs MR (documents only)
    O->>G: merge the docs MR after your signed approval (V3)

    H->>O: mirai run --preset autonomous (overnight)
    Note over O: preflight, trust root from the integration branch, red-team passed, run lock, caffeinate
    loop each ready ticket (stacked on an open parent if allowed)
        O->>DV: plan, stub, then build (strict settings bundle, inputs in a read-only folder)
        DV->>O: handover after running named checks itself (run_tests)
        O->>O: kill agent process group, commit with trailer, code hash at commit
        O->>O: named checks in hardened containers, signed gate-result record, red evidence vs baseline + stub
        O->>QA: if e2e: yes, write the E2E test
        O->>RV: review code + E2E test (diff in input folder, instruction files from the integration branch)
        RV-->>O: PASS as structured output, findings stay local
        O->>QA: verify ACs (run_tests qa-explore, script passed as content)
        QA-->>O: PASS with evidence per AC ID
        O->>O: mirai trace into the QA proof, signed Ed25519 (normalized code hash)
        O->>G: push, open MR
        Note over O,G: MR text: Review PASS after N rounds (MIRAI) + QA table
        G->>G: mirai-verify (base workflow, recomputes the hash) + test job on head.sha
    end
    O->>H: morning report (MRs, parked, usage, inbox)
    H->>G: review + merge MR
    G-->>O: merge seen, ticket is done (derived)
    O->>QA: release: smoke + ticket ACs after deploy
    H->>O: production go/no-go
```

---

## (e) Install, update and sync-back

```mermaid
flowchart TD
    subgraph UP ["MIRAI repo: public, only the owner can push"]
        REL["Tagged release vX.Y.Z"]
    end

    subgraph INST ["Install: once"]
        A1["npx github:owner/mirai at tag vX.Y.Z, init"] --> A2["copy framework files to .mirai/framework/<br/>write mirai.lock: version + hashes,<br/>including generated tool files"]
        A2 --> A3["generate tool files: Claude Code<br/>+ strict settings bundle"]
        A3 --> A4["install git hooks in the trust root<br/>+ Ed25519 key pair with key id + CI jobs"]
        A4 --> A5["/mirai-setup in your tool:<br/>detect, interview gaps, config + context"]
        A5 --> A6["mirai doctor<br/>incl. red-team check of the blocking rules"]
    end

    subgraph RUN ["Every run"]
        R1["read mirai.lock on the integration branch"] --> R2["copy + hash framework, config,<br/>custom, tool files into the trust root<br/>in the MIRAI home"]
        R2 --> R3["re-hash before every launch;<br/>every launch, hook and gate<br/>uses the trust root"]
    end

    subgraph UPD ["Update"]
        U1["npx github:owner/mirai at tag vNEW, update"] --> U2["compare lock hashes:<br/>which framework or tool files changed locally?"]
        U2 --> U3["3-way merge with the pinned base<br/>custom templates are overlays<br/>+ deterministic config schema migrations"]
        U3 --> U4{"You approve?"}
        U4 -- yes --> U5["replace framework files<br/>regenerate tool files<br/>config changed only by shown migrations"]
        U4 -- no --> U6["nothing changes"]
    end

    subgraph SB ["Sync-back: only when you run it"]
        S0["mirai promote: custom override<br/>into a framework path"] --> S1
        S1["mirai contribute"] --> S2["collect files marked framework in the lock<br/>never project or rendered ones"]
        S2 --> S3["fresh branch from upstream,<br/>neutral git identity"]
        S3 --> S4["leak scanner on diff, PR title,<br/>body and commit messages"]
        S4 -- hit --> S5["blocked until you edit it out"]
        S4 -- clean --> S6{"You read the final diff:<br/>approve?"}
        S6 -- yes --> S7["PR on the MIRAI repo"]
        S7 --> S8["MIRAI's own review gate"]
    end

    REL --> A1
    REL --> U1
    A6 --> R1
    S8 --> REL
```

**In plain words:**
- **What a project may change:** framework files are copied and pinned. A project changes behavior
  through config and `.mirai/custom/` overrides. A direct edit to a framework file or a generated
  tool file shows up in the lock hash.
- **Every run** takes its rules from a trust root copied from the integration branch, never from
  the branch being checked, and re-hashes it before every launch.
- **The lock marks each file `framework`, `project` or `rendered`** (R2-M12, R3-M13).
  `framework` files come from MIRAI as they are. `project` files hold project content, such as
  `verify-<app>`. `rendered` files are generated from framework templates plus project data, such
  as the tool files and the managed `AGENTS.md` block; their template is framework, their output
  isn't. `contribute` carries only `framework` files (and template changes behind `rendered`
  ones), never `project` or rendered output.
- **Updates** ask first. They merge your local edits three ways instead of overwriting them.
- **Contribute** only ever carries framework-file changes. It builds a fresh branch from upstream
  and scans the final text, and you read the final diff (R-M14).

---

## (f) The blocking layers (D7)

```mermaid
flowchart TD
    AGT["Claude Code agent<br/>on your machine, as your user (V1 = a)<br/>no container, no separate user"] --> L1
    subgraph L1 ["1. OS sandbox, Seatbelt"]
        SB1["shell commands + child processes:<br/>home denied except project + caches,<br/>MIRAI home and .git denied for writes,<br/>network allowlist, empty if it tests clean,<br/>no escape"]
    end
    L1 --> L2
    subgraph L2 ["2. Permission deny rules"]
        SB2["Read/Edit of MIRAI home, key folders, .git;<br/>git push / commit / config, gh, docker,<br/>claude, mirai;<br/>headless: WebFetch, WebSearch, Task tool"]
    end
    L2 --> L3
    subgraph L3 ["3. PreToolUse hooks from the trust root"]
        SB3["secret patterns in written content,<br/>Glob/Grep outside the project"]
    end
    L3 --> TST["Tests and checks only via the MIRAI MCP broker, no shell:<br/>validate the exact rendered compose file, then run it,<br/>.git masked, unique project name,<br/>no outside network, .env.test dummy secrets"]
    L3 --> L4
    subgraph L4 ["4. pre-push secret scan"]
        SB4["blocks keys, passwords, tokens<br/>and the exact login-token value"]
    end
    L4 --> PUSH["Orchestrator commits, pushes, opens MR<br/>with pinned git, .git/config hash-checked<br/>agent holds no credentials"]
    PUSH --> L5
    subgraph L5 ["5. CI: mirai-verify from the base branch + test job"]
        SB5["recomputes the code hash,<br/>signatures checked with integration-branch keys,<br/>branch.json scope, secret scan,<br/>can't be skipped locally"]
    end
    L5 --> MRG{{"Your merge: the final gate"}}
```

**In plain words:**
- **Why these layers:** each covers a gap the others leave
  (`research/09-claude-blocking-rules.md` §7):
  - the sandbox covers code the agent writes and runs;
  - the deny rules cover the file tools;
  - hooks cover Glob/Grep;
  - `run_tests` replaces any shell exception, and the containers it starts have no route out;
  - the two secret scans catch anything that reaches a commit.
- **MIRAI's own files are out of reach (R2-C1):** the store, trust root and hooks are in the MIRAI
  home outside the project, and agents can't write `.git/**`, neither from the shell nor from a
  test container (`.git` is masked there, R3-C4). MIRAI's own git calls refuse to run if
  `.git/config` changed.
- **The login token:** the agent can read it. Test containers have no network, WebFetch and
  `claude` are denied, and a commit containing it is blocked. If the sandbox allowlist must keep
  the package registries, an upload there remains a possible route (R3-M5); setup tests an empty
  allowlist first.
- **What's not covered (V1 = (a)):** there's no OS boundary between the agent and you. Files
  that run by themselves (`.vscode` tasks, `.envrc`, `.husky`, `package.json` scripts) fire when
  you open a branch, so they're protected paths and the report warns you first. If the red-team
  tests find your docker socket, ssh-agent, keychain or real `.env` reachable and not closable
  by configuration, headless runs are blocked and the decision comes back to you.
- **What changes by mode:** interactive sessions **ask** before anything outside the project;
  headless runs **deny** it.
- **Browsers:** E2E tests and Ivy's overnight checks run in the Playwright container
  (`run_tests` levels `e2e` and `qa-explore`). Playwright MCP runs outside the sandbox, so it's
  used only in interactive daytime sessions, never headless.

---

## (g) One repo or several

```mermaid
flowchart LR
    subgraph MONO ["Monorepo: MIRAI installed in the repo"]
        M1["repos = one entry: ."] --> M2["docs, tickets, config,<br/>business context, run state"]
    end
    subgraph WS ["Multi-repo: a separate workspace repo"]
        W1["workspace repo<br/>config · repos list · resources<br/>business context · PRD · HLD · ADR<br/>tickets if in repo · reports"]
        W1 --> SA["backend repo<br/>light install: conventions,<br/>gate, hooks, CI"]
        W1 --> SB["frontend repo<br/>light install"]
        W1 --> SC["third service repo<br/>light install"]
    end
    MONO -. "project grows: change repos + doc location" .-> WS
```

**In plain words:**
- **Same model for both:** a `repos` list in config. A monorepo has one entry; a workspace repo
  points to the service repos (`08` Q3).
- **No document copies in service repos:** documents live once, in the workspace repo or the one
  configured tool (D5).
- **Every ticket belongs to one repo.** Cross-repo work starts with an interface ticket, then one
  ticket and one MR per repo.
- **Cross-repo E2E** is `local`, `deployed` or `none` (a manual check for you, flagged in the
  report).
- **Where proofs live (R2-C7):** a ticket's proofs are committed on the **service repo's** ticket
  branch, because they're about that repo's code. Documents and approvals live in the workspace
  repo. Each service repo's lock pins the workspace's public key and gate config version, and
  `mirai trace` runs from the workspace. Each repo has its own integration branch setting. Built
  in Milestone D (see 07).

---

## (h) Status state machines

### Documents (brief, PRD, HLD, LLD, ADR, ticket set, context files)

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> in_review : author done + lint passes
    in_review --> changes_requested : verifier blocking findings or you request changes
    changes_requested --> draft : author picks up
    in_review --> approved : verifier pass + your approval (human only)
    approved --> superseded : a newer version is approved (human only)
    approved --> obsolete : no longer relevant, not replaced (human only)
    draft --> dropped : you drop it (human only)
    in_review --> dropped : you drop it (human only)
    changes_requested --> dropped : you drop it (human only)
    superseded --> [*]
    obsolete --> [*]
    dropped --> [*]
```

**Rules:**
- **Human-only moves:** `approved`, `superseded`, `obsolete` and `dropped` can only be set through
  `mirai inbox` / `mirai approve` / `mirai drop`. These need a real terminal and write signed
  events that include the document's content hash (D-17, R-M1, R2-M11).
- **Frozen versions:** an approved version is never edited. A change starts
  `<doc>.v<N+1>.draft.md` beside it.
- **Current state vs history, for documents:** frontmatter is the current state, and the run log
  is the history. A mismatch is an error.
- **Storage:** each artifact type lives in exactly one place (D5). When that place is an external
  tool, the status lives there and the repo keeps only a pointer. MIRAI's gates never depend on it:
  they use only the signed proofs; tracker status is read from a local cache with a last-sync time
  and is advisory (R2-M13).

### Tickets

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> ready_for_dev : ticket set approved
    ready_for_dev --> in_progress : plan written
    in_progress --> ready_for_dev : plan rejected, re-plan
    in_progress --> in_review : handover, checks green
    in_review --> in_progress : blocking finding or QA fail (uses a round)
    in_review --> built : review + QA PASS and MR open (derived)
    built --> in_progress : MR comments or red CI (you grant a new budget)
    built --> waiting : stacked parent got change requests
    waiting --> built : parent fixed, rebase + gate green
    built --> integrated : merged into feature/epic (derived)
    integrated --> done : feature/epic merged into the integration branch (derived)
    built --> done : MR merged into the integration branch (derived from git)
    built --> ready_for_dev : MR closed, you send it back
    built --> dropped : MR closed, you drop it
    in_progress --> blocked : cap, budget, repeat, no progress, environment
    in_review --> blocked : same
    waiting --> blocked : rebase conflict
    blocked --> ready_for_dev : unpark re-plan, with your note
    blocked --> in_progress : unpark retry, new budget, with your note
    blocked --> dropped : unpark drop
    draft --> dropped : you drop it
    ready_for_dev --> dropped : you drop it
    done --> [*]
    dropped --> [*]
```

**Rules:**
- **Where status lives (R2-M5, R3-M12):** ticket status is not in the ticket's frontmatter. It
  has **one home**, the per-ticket status file in the orchestrator store. A tracker, if used, gets
  a mirrored copy that is advisory.
- **Derived states win:** `done` and `integrated` always win (a merged ticket is never
  `blocked`). `built` wins over written states from before the MR's latest head push; a written
  `in_progress` or `waiting` after that push takes over until the next push with valid proofs.
- **Derived states:** `built`, `integrated` and `done` are computed from MRs and merges, never
  written (R-C4). `integrated` means merged into `feature/<epic>` in a `release: together` epic;
  the next ticket's `after` rule accepts it, so the epic can't deadlock. `done` there means that
  branch is merged into the integration branch.
- **Parking:** `parked` (Q7) is the `blocked` state plus a required `park_reason` and a parking
  note. Only `mirai unpark`, with your note and a choice of **re-plan**, **retry** or **drop**,
  takes a ticket out of it.
- **Handover:** `mirai handover <ticket>` releases the branch to you; the ticket leaves MIRAI's
  machine and its gates. A signed `handover.json` is committed, so CI stops applying MIRAI's
  rules too.
- **Human-only moves:** only a human action leads to `dropped`, grants a new budget after MR
  comments, or merges. No agent moves a ticket past `built`.
- **Logging:** every transition is one line in the run log, with `by` (agent, script or human) and
  the reason.

### Epic (`release: together`)

```mermaid
stateDiagram-v2
    [*] --> open
    open --> integrating : first ticket integrated
    integrating --> final_e2e : all tickets integrated
    final_e2e --> ready_to_merge : final E2E passes
    final_e2e --> final_e2e_failed : final E2E fails
    final_e2e_failed --> integrating : you pick the bug ticket for the fix
    ready_to_merge --> done : you merge feature/epic into the integration branch
    done --> [*]
```

### Run

```mermaid
stateDiagram-v2
    [*] --> running
    running --> paused : usage limit hit
    paused --> running : limit reset, resume from checkpoint
    paused --> stopped : reset after run.stop_by, or weekly limit
    running --> stopped : circuit breaker, cut-off, or you
    stopped --> running : mirai resume
    running --> finished : queue empty
    finished --> [*]
```

### Release record

```mermaid
stateDiagram-v2
    [*] --> pending : ticket merged
    pending --> staging : project has staging
    pending --> approved : no staging, your go/no-go first (human only)
    staging --> verified : qa smoke + ACs pass on staging
    staging --> rolled_back : verification fails
    verified --> approved : your go/no-go (human only)
    approved --> deployed : production deploy
    deployed --> live : production smoke + ACs pass
    deployed --> rolled_back : production smoke fails
    live --> [*]
    rolled_back --> [*]
```

**Release rules:** staging is optional; nothing assumes it. Without staging, your go/no-go comes
first, and the smoke check and ACs run after the production deploy. The release record lives in
the store and is exported as a git tag annotation or a host release. A PRD's `live` state is
derived, never written.
