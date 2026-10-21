---
status: draft
version: 2
---

# 02 — Architecture diagrams

There are seven views, each explained in plain words underneath. Names match `03-components.md`.
Version 2 applies the round-1 review decisions (`06-review-round-1.md` §G).

---

## (a) The lifecycle

```mermaid
flowchart TD
    S(["Setup: mirai init + /mirai-setup"]) --> I["Intake + brief<br/>product-manager"]
    I --> BG{{"Human gate: brief + track"}}
    BG --> T{"Track?"}
    T -- quick --> TK
    T -- standard --> P
    T -- full --> P

    P["PRD draft<br/>product-manager"] --> PL["lint prd<br/>script"]
    PL -- fail --> P
    PL -- ok --> PV["Verify PRD<br/>verifier, fresh context"]
    PV -- "blocking, within loop guard" --> P
    PV -- pass --> PG{{"Human gate: PRD"}}
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
    TV -- pass --> TG{{"Human gate: ticket set"}}
    TG -- approved --> LOOP

    subgraph LOOP ["Per ticket, run by the orchestrator script (the only part that runs overnight)"]
        direction TB
        PN["Plan<br/>developer"] --> PNG{{"Plan gate<br/>human or auto;<br/>always human if high risk"}}
        PNG --> B["Build with TDD<br/>developer runs the gate itself"]
        B --> C["Checks from the trust root:<br/>quality gate + floor guard + trace"]
        C -- "red, uses a round" --> B
        C -- green --> R["Review<br/>reviewer, depth by risk"]
        R -- blocking --> B
        R -- pass --> Q["QA on the running app<br/>qa, in project containers"]
        Q -- fail --> B
        Q -- pass --> SH["Ship: push + open MR<br/>orchestrator, not the agent"]
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
    E2E --> MM{{"You merge feature/epic into main"}}
    MM --> REL2["Release the epic:<br/>deploy, smoke, your go/no-go"]
    REL --> LIVE(["live"])
    REL2 --> LIVE
    LOOP --> RP["Run report / morning report"]
    PK --> RP
```

**In plain words:**
- **Documents:** every document goes author → cheap script check → separate verifier → **you**. A
  document only feeds the next stage after you approve it. No document gate can be `auto` (D6).
- **The build loop:** a script runs the per-ticket loop, not an agent. Each arrow back to "Build"
  after handover uses one round of the ticket's shared budget, which covers checks, review and QA
  together. Failures the developer fixes inside its own session don't count.
- **Parking:** when the budget runs out, the ticket is parked with a note instead of retried.
- **Release:** an epic is released ticket by ticket (the default), or all together through a
  feature branch with a final E2E test (D3).
- **Merging:** nothing merges without you, anywhere.

---

## (b) Stacked tickets inside one epic

```mermaid
flowchart LR
    MAIN[("main")] --> A["ticket A branch<br/>MR A targets main"]
    A --> B["ticket B branch<br/>starts from A<br/>MR B targets A"]
    B --> C["ticket C branch<br/>depth 2 is the limit<br/>MR C targets B"]
    A -. "you merge A" .-> RB["MIRAI rebases B onto main,<br/>re-runs the quality gate,<br/>retargets MR B"]
    RB -. "patch-id unchanged" .-> KEEP["review record still valid"]
    RB -. conflict .-> PK2[["B parked: rebase-conflict"]]
    A -. "you request changes" .-> WAIT["B waits on A"]
```

**In plain words:**
- **Starting early:** if B needs A and A's MR is open but not merged, B starts from A's branch. B's
  MR shows only B's changes.
- **Limits:** at most two levels deep (A → B → C), and only inside one epic (D2).
- **No double review:** when A merges, B is moved onto `main`. If B's own change is the same
  (same patch-id), its review still counts. Only the quality gate re-runs.
- **In a `together` epic** the same picture applies, with `feature/<epic>` in place of `main`.

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
        CLI["mirai CLI script<br/>run · agent run · inbox · approve · unpark<br/>log · status · gate · lint · trace · exec test<br/>resume · report · contribute"]
        AD["Tool adapters<br/>Claude Code first; Codex, Cursor later"]
        CN["Connector contract<br/>repo first; ClickUp / Jira / Linear / Confluence later"]
    end

    subgraph TR ["Trust root: read-only copy from the base commit, outside the repo"]
        SNAP["framework + config + custom<br/>+ tool files + strict settings bundle<br/>hashed"]
    end

    subgraph PJ ["Project files: never leave the project"]
        direction TB
        CFG[".mirai/config.toml<br/>+ config.user.toml"]
        CUS[".mirai/custom/<br/>per-skill overrides"]
        CTX[".mirai/context/<br/>project · business · conventions · feature map"]
        VS["verify-app skill<br/>generated at setup"]
        DOCS["Work documents<br/>one place per artifact type"]
        REC["Branch-carried facts<br/>doc versions · approvals · patch-id records"]
    end

    subgraph OS ["Orchestrator store: git-common-dir/mirai, never committed"]
        ST["run progress · rounds · budgets<br/>parking · checkpoints · lock · heartbeat"]
    end

    subgraph EN ["Enforcement"]
        GH["git hooks outside the work tree<br/>pre-commit · pre-push"]
        CIJ["CI job<br/>required status check"]
        TH["Tool hooks<br/>fast feedback + blocking rules"]
    end

    FW -- "snapshot at run start" --> SNAP
    CFG -- "snapshot" --> SNAP
    CUS -- "snapshot" --> SNAP
    SK -- "workflow skill calls" --> CLI
    CLI -- "launches with the bundle from" --> SNAP
    CLI -- "launches, logs, budgets" --> AG
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
    CIJ -- "check against base lock" --> REC
    TH -- check --> REC
```

**In plain words:**
- **Skills hold the procedures. Agents are personas that follow skills.**
- **The `mirai` CLI** is the one thing that launches agents, writes logs, picks models and
  enforces budgets (D-12).
- **The trust root:** every launch, hook and gate reads MIRAI's rules from a **trust root**, a
  copy taken from the base commit. So a ticket branch can't relax the gate that checks it (R-C2).
- **Two kinds of state:**
  - facts that belong to an MR (approvals, records) travel on its branch;
  - run bookkeeping lives in the orchestrator store and is never committed (R-C4).
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
    H->>O: mirai inbox: approve brief + PRD (real terminal)

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

    H->>O: mirai run --preset autonomous (overnight)
    Note over O: preflight, trust root snapshot, run lock, caffeinate
    loop each ready ticket (stacked on an open parent if allowed)
        O->>DV: plan, then build with TDD (strict settings bundle)
        DV->>O: handover after running the gate itself
        O->>O: checks from trust root + red evidence vs baseline
        O->>RV: review (diff as file path)
        RV-->>O: PASS, patch-id record signed
        O->>QA: verify ACs on the app in project containers
        QA-->>O: PASS with evidence per AC ID
        O->>G: push branch, open MR (orchestrator credentials)
        G->>G: CI on head.sha: gate, secret scan, records vs base lock
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
        A3 --> A4["install git hooks outside the work tree<br/>+ CI job template"]
        A4 --> A5["/mirai-setup in your tool:<br/>detect, interview gaps, config + context"]
        A5 --> A6["mirai doctor<br/>incl. red-team check of the blocking rules"]
    end

    subgraph RUN ["Every run"]
        R1["read mirai.lock on the base commit"] --> R2["copy + hash framework, config,<br/>custom, tool files into the trust root"]
        R2 --> R3["every launch, hook and gate<br/>uses the trust root"]
    end

    subgraph UPD ["Update"]
        U1["npx github:owner/mirai at tag vNEW, update"] --> U2["compare lock hashes:<br/>which framework or tool files changed locally?"]
        U2 --> U3["3-way merge with the pinned base<br/>+ deterministic migrations"]
        U3 --> U4{"You approve?"}
        U4 -- yes --> U5["replace framework files<br/>regenerate tool files<br/>never touch config / custom / context"]
        U4 -- no --> U6["nothing changes"]
    end

    subgraph SB ["Sync-back: only when you run it"]
        S0["mirai promote: custom override<br/>into a framework path"] --> S1
        S1["mirai contribute"] --> S2["collect FRAMEWORK file changes only<br/>lock hash differs"]
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
- **Every run** takes its rules from a trust root copied from the base commit, never from the
  branch being checked.
- **Updates** ask first. They merge your local edits three ways instead of overwriting them.
- **Contribute** only ever carries framework-file changes. It builds a fresh branch from upstream
  and scans the final text, and you read the final diff (R-M14).

---

## (f) The blocking layers (D7)

```mermaid
flowchart TD
    AGT["Claude Code agent<br/>on your machine, no container"] --> L1
    subgraph L1 ["1. OS sandbox, Seatbelt"]
        SB1["shell commands + child processes:<br/>no reads or writes outside the project,<br/>network allowlist, no escape"]
    end
    L1 --> L2
    subgraph L2 ["2. Permission deny rules"]
        SB2["Read/Edit outside project, key folders,<br/>git push, gh, docker, printenv"]
    end
    L2 --> L3
    subgraph L3 ["3. PreToolUse hooks from the trust root"]
        SB3["secret patterns in written content,<br/>Glob/Grep outside the project"]
    end
    L3 --> TST["Tests run only via mirai exec test<br/>inside the project's Docker containers"]
    L3 --> L4
    subgraph L4 ["4. pre-push secret scan"]
        SB4["blocks a commit with keys,<br/>passwords or tokens"]
    end
    L4 --> PUSH["Orchestrator pushes + opens MR<br/>agent holds no credentials"]
    PUSH --> L5
    subgraph L5 ["5. CI secret scan + gate on head.sha"]
        SB5["can't be skipped locally"]
    end
```

**In plain words:**
- **Why five layers:** each layer covers a gap the others leave
  (`research/09-claude-blocking-rules.md` §7):
  - the sandbox covers code the agent writes and runs;
  - the deny rules cover the file tools;
  - hooks cover Glob/Grep;
  - the two secret scans catch anything that reaches a commit.
- **What changes by mode:** interactive sessions **ask** before anything outside the project;
  headless runs **deny** it.

---

## (g) Status state machines

### Documents (brief, PRD, HLD, LLD, ADR, ticket set, context files)

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> in_review : author done + lint passes
    in_review --> changes_requested : verifier blocking findings or you request changes
    changes_requested --> draft : author picks up
    in_review --> approved : verifier pass + your approval (human only)
    approved --> superseded : a newer version is approved (human only)
    draft --> dropped : you drop it (human only)
    in_review --> dropped : you drop it (human only)
    changes_requested --> dropped : you drop it (human only)
    superseded --> [*]
    dropped --> [*]
```

**Rules:**
- **Human-only moves:** `approved`, `superseded` and `dropped` can only be set through
  `mirai inbox` / `mirai approve` / `mirai drop`. These need a real terminal and write signed
  events (D-17, R-M1).
- **Frozen versions:** an approved version is never edited. A change starts
  `<doc>.v<N+1>.draft.md` beside it.
- **Current state vs history:** frontmatter is the current state, and the run log is the history.
  A mismatch is an error.
- **Storage:** each artifact type lives in exactly one place (D5). When that place is an external
  tool, the status lives there and the repo keeps only a pointer.

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
    built --> done : MR merged (derived from git)
    built --> ready_for_dev : MR closed, you send it back
    built --> dropped : MR closed, you drop it
    in_progress --> blocked : cap, budget, repeat, no progress, environment
    in_review --> blocked : same
    waiting --> blocked : rebase conflict
    blocked --> ready_for_dev : mirai unpark with your note
    draft --> dropped : you drop it
    ready_for_dev --> dropped : you drop it
    blocked --> dropped : you drop it
    done --> [*]
    dropped --> [*]
```

**Rules:**
- **Derived states:** `built` and `done` are computed from MRs and merges, never written (R-C4).
  `done` in a `together` epic means merged into `feature/<epic>` *and* that branch merged into
  `main`.
- **Parking:** `parked` (Q7) is the `blocked` state plus a required `park_reason` and a parking
  note. Only `mirai unpark`, with your note, takes a ticket out of it.
- **Human-only moves:** only a human action leads to `dropped`, grants a new budget after MR
  comments, or merges. No agent moves a ticket past `built`.
- **Logging:** every transition is one line in the run log, with `by` (agent, script or human) and
  the reason.

### Release record

```mermaid
stateDiagram-v2
    [*] --> staging
    staging --> verified : qa smoke + ACs pass
    staging --> rolled_back : verification fails
    verified --> approved : your go/no-go (human only)
    approved --> live : production deploy + smoke pass
    approved --> rolled_back : production smoke fails
    live --> [*]
    rolled_back --> [*]
```
