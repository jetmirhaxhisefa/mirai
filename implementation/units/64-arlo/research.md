# Unit 64: Arlo (the architect agent) research (web and the repos MIRAI studied, 2026-11-26)

Read by a research agent (GitHub `main` via `gh api`, pages fetched). **Opinion** marks inferences.
Shared with unit 65 (`../65-design-workflow/research.md`); the source list is below.

## A. What Arlo reads first, and how it cites code

- Read first, ask second: read what's referenced and the code it connects to "until you can explain how the relevant parts work today and what this change would touch"; never ask what the project already answers [S12]. "Investigate before you decide"; ratify the conventions already there [S5]; trace every system the change touches [S1]; pattern analysis first [S11].
- Input discipline: the driving document first and in full; linked sources only for a need it points at; settled decisions inherited, a contradiction surfaced as a conflict, never overridden locally [S5].
- Existing ADRs and vocabulary: glossary and the area's ADRs first, "decisions this command should not re-litigate"; `git log` hot spots [S16]; match the repo's ADR location and numbering [S20]. The last 3–5 ADRs as context gave the best quality for the cost; the full history added little [S30].
- Citing code: researchers see factual questions only, never the goal; every claim cited to file and line at a commit, with what was looked for and not found; load-bearing claims re-checked [S7]. Every claim cited `file:line` or marked `unverified` [S25].
- **Opinion:** a read-only scan of the PRD (whole), the ADRs and conventions and the code it touches; a short "current state" section, each claim `path:line` or `unverified`; settled decisions inherited.

## B. Choices without over-engineering

- Two shapes, pick the one with one owner per state and the least callers must know [S1, S2]; "design it twice" with parallel sub-agents under different constraints, then one strong recommendation, "not a menu" [S15]; 2–3 real approaches, one recommended, the human picks [S12].
- Ask only "when the answer would change what gets built and neither the request nor the project answers it"; otherwise state the call as a proposal; "a default they never heard is one they couldn't reject"; own calls marked as such [S12]. Headless: infer, never invent; record assumptions, open questions, conflicts [S6].
- Against over-engineering: BMAD's test, fix a choice only when two units could choose incompatibly and it's non-obvious and a real trade-off, else Deferred; "documenting every minor choice" is a named failure [S5, S8]; "one adapter means a hypothetical seam" [S14]; the simplest architecture, no speculative abstraction [S11]; sized to the archetype [S22].
- Against ADR sprawl: an ADR only when hard to reverse, surprising without context and a real trade-off; one paragraph can be enough [S19, S7]. AWS is broader [S35].
- **Opinion:** each D-n or ADR with 2–3 real alternatives and one recommendation, tagged "Arlo's call" or "decision for you"; anything failing the divergence test or the ADR triad stays a D-n line or Deferred.

## C. Model, run shape, tools

- Architect agents on the strongest model, read-only (Read, Grep, Glob); implementation blueprints on a mid model with Bash [S10, S11]. Claude Code's `opusplan`: Opus for architecture decisions [S37]; `max` effort "prone to overthinking" [S37]. Context mattered more than model size [S30].
- BMAD logs decisions as it goes and distills at the end, then checks each input "didn't land" before its reviewer gate [S5]; bm629 writes the architecture doc and its ADRs in one skill [S22]. No source gives a duration.
- Read-only by tool list, enforced by the harness, not the prompt [S36, S9, S10]. Web-check any named technology's current version before binding it [S5]. pstack lets the designer run throwaway prototypes [S2].
- **Opinion:** one deep-tier run drafts the HLD and its ADRs together; the LLD in a second run against the frozen HLD, only when needed; read-only tools, `git log`, web fetch for versions; no code edits or prototypes in v1; the technical note on standard.

## D. Why architect output fails, and the guards

| Failure | Evidence | Guard |
|---|---|---|
| invented components, missing or reversed edges | best edge F1 below 0.2 while node F1 reaches 0.67; orphan nodes 16–20% without the architecture section [S32] | a flow and edge check; an orphan check [S24] |
| verbosity, too many arguments | 4.55 arguments per rationale vs 1.98 by experts, precision about 0.27 [S31]; a no-context ADR twice as long [S30] | size to the archetype [S22]; prior ADRs as context [S30] |
| wrong claims | 1.6–3.2% of arguments misleading [S31]; not human-level [S29] | cite `file:line` or `unverified` [S25]; never invent a limit [S24] |
| stale technology from training | reviewer flags anything "asserted from training data" [S5a] | web-verify versions [S5] |
| a requirement quietly dropped | a reconcile step per input [S5] | the trace table plus a reconcile pass |
| ignoring existing code | "a claim that contradicts the code" [S24] | ratify conventions [S5] |
| invented content to fill a section | "if the spec states something you never said, that is a defect" [S17] | assumption and open-question tags [S5, S6] |

**Opinion:** keep Arlo's prompt examples abstract (a concrete example stack bleeds into output [S10]).

## E. Evaluating it

- Eval cases with a fixture and behaviour expectations (the agent inspects the file before editing; it doesn't invent or replace the interface) [S21]: plant a convention, an ADR and a decoy; assert Arlo cites, ratifies, doesn't re-decide.
- Rubrics: structure (node and edge F1), an LLM judge (κ 0.73 with experts), anti-patterns (orphan, god component) [S32]; precision and recall against expert arguments [S31]; never BLEU or ROUGE [S30].
- Deterministic lint first so reviewers spend judgement on meaning [S6a]; one bar for author and reviewer [S22, S23]; a fresh "builder check" listing only the questions that matter [S13].

## Sources

S1 https://github.com/cursor/plugins/blob/main/pstack/skills/architect/SKILL.md · S2 https://github.com/cursor/plugins/blob/main/pstack/docs/guide/04-design.md · S4 https://github.com/bmad-code-org/BMAD-METHOD/blob/main/skills/core-tools/bmad-review/references/lens-adversarial.md · S5 https://github.com/bmad-code-org/BMAD-METHOD/blob/main/skills/method/bmad-architecture/SKILL.md · S5a …/bmad-architecture/customize.toml · S6 …/bmad-architecture/references/headless.md · S6a …/bmad-architecture/references/reviewer-gate.md · S7 https://github.com/bmad-code-org/BMAD-METHOD/blob/main/docs/plan/research-a-decision.md · S8 https://github.com/bmad-code-org/BMAD-METHOD/blob/main/docs/plan/design-ux-and-architecture.md · S9 https://github.com/affaan-m/ECC/blob/main/.kiro/agents/planner.md · S10 https://github.com/affaan-m/ECC/blob/main/agents/architect.md · S11 https://github.com/affaan-m/ECC/blob/main/agents/code-architect.md · S12 https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md · S12a …/skills/writing-plans/SKILL.md · S13 …/skills/brainstorming/builder-check-prompt.md · S14 https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/SKILL.md · S15 …/codebase-design/DESIGN-IT-TWICE.md · S16 …/improve-codebase-architecture/SKILL.md · S17 …/to-spec/SKILL.md · S18 https://github.com/mattpocock/skills/blob/main/docs/engineering/to-spec.md · S19 …/domain-modeling/ADR-FORMAT.md · S20 https://github.com/addyosmani/agent-skills/blob/main/skills/documentation-and-adrs/SKILL.md · S21 …/evals/cases/documentation-and-adrs.json · S22 https://github.com/bm629/agent-skills/blob/main/docs/skills/authoring-architecture-doc.md · S23 …/docs/skills/reviewing-architecture-doc.md · S24 …/reviewing-architecture-doc/references/architecture-quality-bar.md · S25 …/docs/skills/design-review.md · S26 …/authoring-architecture-doc/references/amend.md · S28 https://adr.github.io/madr/ · S29 https://arxiv.org/html/2403.01709v1 · S30 https://arxiv.org/html/2604.03826 · S31 https://arxiv.org/html/2504.20781v3 · S32 https://arxiv.org/html/2604.06683v1 · S33 https://www.industrialempathy.com/posts/design-docs-at-google/ · S34 https://martinfowler.com/articles/scaling-architecture-conversationally.html · S35 https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html · S36 https://code.claude.com/docs/en/best-practices · S37 https://code.claude.com/docs/en/model-config · S38 https://arxiv.org/pdf/2503.15272 (round counts from a summary only) · S39 https://arxiv.org/pdf/2508.09549 (same caveat)
