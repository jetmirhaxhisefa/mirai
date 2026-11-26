# Unit 63: LLD research (web and the repos MIRAI studied, 2026-11-26)

Read by a research agent (GitHub files via `gh api`, pages fetched). **Opinion** marks inferences.
Answers so far: Q1 **B** (Jet, 2026-11-26): one LLD per initiative (`lld.md`), only where needed.

## Sources

- **[bm-TDD]** bm629/agent-skills, authoring/reviewing-technical-design (and `implementability-bar.md`, `failure-test-rollout-amend.md`): https://github.com/bm629/agent-skills/blob/HEAD/docs/skills/authoring-technical-design.md
- **[bm-API]** bm629 authoring/reviewing-api-spec, `contract-method.md`: https://github.com/bm629/agent-skills/blob/HEAD/skills/authoring-api-spec/references/contract-method.md
- **[bm-DM]** bm629 data model lifecycle: https://github.com/bm629/agent-skills/blob/HEAD/skills/authoring-data-model/references/lifecycle-and-amend.md
- **[bm-DR]** bm629 design-review: https://github.com/bm629/agent-skills/blob/HEAD/docs/skills/design-review.md
- **[BMAD-arch]** BMAD design-ux-and-architecture, spine template, reviewer gate: https://github.com/bmad-code-org/BMAD-METHOD/blob/HEAD/docs/plan/design-ux-and-architecture.md
- **[BMAD-spec]** BMAD agent-spec template; **[BMAD-shard]** prepare-long-documents-for-agents
- **[MP-spec]** mattpocock to-spec, implement-spec: https://github.com/mattpocock/skills/blob/HEAD/docs/engineering/implement-spec.md; **[MP-design]** codebase-design, DESIGN-IT-TWICE
- **[pstack]** cursor/plugins architect skill and design guide: https://github.com/cursor/plugins/blob/HEAD/pstack/docs/guide/04-design.md
- **[SP-brain]**, **[SP-plans]** obra/superpowers brainstorming (builder check), writing-plans: https://github.com/obra/superpowers/blob/HEAD/skills/writing-plans/SKILL.md
- **[ECC]** affaan-m/ECC `.kiro/agents/architect.md`
- **[addy-SDD]**, **[addy-API]** addyosmani/agent-skills spec-driven-development, api-and-interface-design: https://github.com/addyosmani/agent-skills/blob/HEAD/skills/api-and-interface-design/SKILL.md
- **[spec-kit]** github/spec-kit plan and analyze commands: https://github.com/github/spec-kit/blob/HEAD/templates/commands/analyze.md
- **[Ubl]** Design Docs at Google: https://www.industrialempathy.com/posts/design-docs-at-google/
- **[Orosz]** RFCs and design docs: https://blog.pragmaticengineer.com/rfcs-and-design-docs/
- **[Kashitsyn]** Effective design docs (2024): https://mmapped.blog/posts/31-effective-design-docs
- **[Zhang]** How to write a good software design doc: https://www.freecodecamp.org/news/how-to-write-a-good-software-design-document-66fcf019569c
- **[Böckeler]** Understanding spec-driven development (2025): https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
- **[Sato]** Parallel Change: https://martinfowler.com/bliki/ParallelChange.html
- **[Stripe]** Idempotent requests: https://docs.stripe.com/api/idempotent_requests
- **[R07]** MIRAI research/07 §6.3

## A. When an LLD is needed, who decides

- The question is whether the solution is ambiguous; skip "implementation manuals" with no trade-offs [Ubl]. Thresholds vary: a month of work [Zhang], two weeks, several viable solutions or changes between components; "most changes don't need a design doc" [Kashitsyn]. Companies use "API changes", "decisions impacting several teams" [Orosz].
- BMAD's test: "if two units built this independently, could they choose incompatibly?" Local change: usually unnecessary; several components: by coordination risk; several epics: needed [BMAD-arch].
- Agent triggers: work longer than one session [MP-spec]; several files or modules [addy-SDD]; crossing function boundaries or moving ownership [pstack]. spec-kit writes contracts only with external interfaces, a data model from the spec's entities [spec-kit].
- **Opinion:** make the triggers checkable: (1) a new or changed persisted entity or field; (2) a new or changed external contract (endpoint, event, CLI, file format, public module interface); (3) more than one module where two tickets could pick incompatible names or shapes; (4) a non-trivial state machine or algorithm no single ticket owns. The HLD author records `LLD: required | not required — triggers`; Vera checks it against the HLD (a new entity in data ownership with "not required" is a finding).

## B. Sections, length

- Agent sources converge on typed interfaces, failure handling, a test mapping and explicit assumptions [bm-TDD, SP-plans, BMAD-spec]. "Decisions, not rationale"; no empty headers; a Deferred list [BMAD-arch]. "A thin feature collapses inapplicable conditions: judge completeness of decisions, not section count" [bm-TDD].
- Length: 1–3 pages for a mini design doc [Ubl]; agents read up to about 50 KB (8,000 words) before sharding [BMAD-shard]; "cut ruthlessly" [Kashitsyn].
- **Opinion** on R07 §6.3's list: merge context, goals and non-goals into a short Scope that cites PRD and HLD IDs; cut the component view (the HLD's), keep a sequence diagram per non-trivial flow; core: API contracts (trigger 2), data schema and migrations (trigger 1), a failure table, the test map; conditional: state and algorithms; delta only: security, observability, rollout ("per HLD §x" or what's new); cut alternatives and drawbacks (they're ADRs: the LLD holds no decisions); keep open questions, empty at approval; cut the ticket breakdown (Tess's); add a Names table (the exact identifiers tickets share). About 2,500 words of prose, contract and schema blocks not counted; a hard stop near 8,000.

## C. Contracts and schemas two implementers can't diverge on

- Parallel implementers added the same field as `blockedSince` and `blockedOn`; the fix is to fix the exact names each ticket adds [MP-spec]. Every plan task gets Interfaces (consumes, produces, exact names and types) because an implementer sees only its own task [SP-plans].
- Every field typed, required or optional, with constraints ("integer, minor units, >0", not "a number"); shared types defined once; the project's own notation (OpenAPI, SDL, proto, a command schema for CLIs) [bm-API, spec-kit].
- One error shape (RFC 9457 Problem Details plus a machine code); each operation lists every named failure with status, code and retryability; "a spec listing only 2xx fails" [bm-API, addy-API].
- Idempotency: the key, its source, retention, and what the same key with another payload gets (Stripe keeps keys 24 h and errors on a different payload) [Stripe, addy-API].
- Migrations: the plan, not the DDL; breaking changes expand → backfill → transition → contract, each step revertible and compatible with the running app [bm-DM, Sato].
- One vocabulary, no synonyms [MP-design]; spec-kit's analyze flags terminology drift and checks each cited `Entity.field` against the data model [spec-kit].

## D. The test plan mapped to AC IDs

- The PRD's acceptance criteria are the coverage checklist, plus failure cases and contract-conformance tests [bm-TDD]. Agree the test seams up front, as few as possible [MP-spec]. Coverage % and "untestable acceptance criterion" as HIGH [spec-kit]. Exact test names and assertions belong in the plan, not the design [SP-plans].
- **Opinion:** a table AC-ID | level | seam | the case in one line | the failure row it covers; no test code (Kai's plan owns it); Vera checks every AC in scope appears and every failure row has a test.

## E. HLD, LLD, ADR, the ticket plan

- The technical design references the architecture doc, API spec and data model and never duplicates them [bm-TDD]. BMAD records only decisions that would conflict between independent builders, with stable IDs tickets cite; the code owns the rest after [BMAD-arch]. Lasting decisions go to ADRs; the spec is disposable after it ships [MP-spec]. Tickets are cut by a separate step [MP-spec, BMAD-arch].
- **Opinion:** HLD: components, flows, data ownership, NFR answers, D-n, the "LLD required?" line. ADR: one hard choice. LLD: exact shapes (contracts, schema and migrations, state machines, the failure table, names, the AC → test map), citing D-n and ADRs, never arguing them. Kai's plan: files, signatures per task, test code. Drop the ticket breakdown; give contract and schema items stable IDs (C-1, S-1) tickets cite.

## F. What Vera checks

- **Mechanical:** every AC in scope in the test map; every operation typed with an error row and retryability; idempotency on every unsafe operation; migration, rollback and backfill per schema change; no placeholders or duplicate IDs; cited D-n and ADRs exist (BMAD lints this before any judgement review); no alternatives section; open questions empty at approval; Mermaid; the cap; no copied HLD table.
- **Judgement:** could a builder implement it without guessing (superpowers runs a fresh "builder check" listing only the guesses that matter) [SP-brain]; hidden assumptions, limits, re-runs, security [bm-DR]; consistency with the code, cited `file:line` [bm-DR]; failures with detection, handling and what the user sees [bm-TDD]; nothing invented.

## G. Contrary points

1. Google: don't paste full interfaces or schemas, they go stale [Ubl]; agent sources demand full typing. **Opinion:** before the code exists the LLD is the only truth: type it fully; after the merge the code owns it.
2. Specs are disposable [MP-spec, Kashitsyn]; spec-kit in practice is spec-first per branch [Böckeler]. **Opinion:** freeze the LLD once its initiative ships.
3. Agents ignore or over-follow specs; heavy markdown is hard to review; one workflow for every size is "a sledgehammer to crack a nut" [Böckeler]: supports "only when needed" and a cap.
4. bm629 and ECC keep alternatives inside the design doc; MIRAI's split (decisions only in ADRs) is stricter, so Vera checks every non-obvious LLD choice cites a D-n or an ADR.
5. pstack has no planning skill on purpose: it settles open questions with prototypes, not documents [pstack].
6. BMAD allows a spine per initiative or per epic [BMAD-arch]; R07 said per component or epic; Jet's Q1 "B" (per initiative) supersedes it.
7. What an LLD buys agents most is agreement on names and shapes across parallel tickets [MP-spec, SP-plans].
