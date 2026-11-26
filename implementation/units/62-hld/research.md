# Unit 62: HLD research (web, 2026-11-26)

The research behind 62's interview. It builds on `research/07-doc-templates.md` §3 and §6.2
(2026-10-21: arc42, C4, the pilot's 16 sections mapped onto arc42) and `research/13` (the two
readers), and checks them against what changed since and against 61 as approved.
[C] = consensus across sources; [S] = one source.

## The skeleton: arc42
- 12 sections, stable for years: Introduction and goals, Constraints, Context and scope, Solution
  strategy, Building blocks, Runtime, Deployment, Crosscutting concepts, Decisions, Quality,
  Risks and technical debt, Glossary. https://arc42.org/overview
- Latest template 9.0 (July 2025, per a third-party catalog; not confirmed on arc42.org): the
  only notable change splits section 10 into an overview and detailed scenarios [S].
- **Section 1 names the top three, at most five, quality goals**; the full quality requirements
  go to section 10. https://docs.arc42.org/section-1
- **No official lean variant.** The FAQ and the book: remove what nobody needs, and mark a
  deliberately omitted section as omitted rather than leaving it empty.
  https://leanpub.com/read/arc42-faq/chapter-vii · https://leanpub.com/read/arc42inpractice/chapter-iv
- **Section 9 (decisions): refer to the ADRs, don't repeat them.** https://docs.arc42.org/section-9/
- License CC BY-SA 4.0: restate the structure in our own words with a credit line (research/07
  §6.5).

## The diagrams: C4
- Context and container diagrams "are sufficient for most software development teams"; the other
  levels are optional. https://c4model.com/diagrams
- Mermaid's C4 syntax (C4Context, C4Container, C4Component, C4Dynamic, C4Deployment) is still
  labeled **experimental** in the docs seen; its syntax may change. A plain `flowchart` with C4
  labels renders everywhere and is stable. https://mermaid.js.org/syntax/c4.html
- Modelling tools (Structurizr DSL) can validate and diff, but add a dependency.
  https://c4model.com/tooling

## The design doc (Google)
- Sections: context and scope, goals and non-goals (a non-goal is something someone could
  reasonably want, deliberately excluded), the design (diagram, APIs, data storage), alternatives
  considered, cross-cutting concerns (security, privacy, observability).
  https://www.industrialempathy.com/posts/design-docs-at-google/
- Length: a small project 1–3 pages ("mini design doc"), large ones 10–20 pages; "when not to
  write one": when the solution is obvious and there's no trade-off to discuss [C].
- The design doc is a point-in-time artifact read while the work is done; it's not kept in sync
  with the code afterwards (Ubl). That fits 61's decision 1: the HLD is read now, the ADR later.

## How the HLD and ADRs pair [C]
- The design doc is the wider plan; each significant decision in it becomes an ADR, linked from
  the doc. https://ammos.nasa.gov/plandev-docs/overview/design/arch-design-overview/ ·
  https://playbook.microsoft.com/code-with-engineering/design/design-reviews/decision-log/
- ADRs stand alone; longer justification stays in the linked design doc (Microsoft).
  https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record
- Spotify: big change → design doc/RFC, then ADRs; small change → ADR only (61's research.md).
- Already decided in 61: the HLD (`full`) or the note (`standard`, 62b) says how, the ADR says why;
  the HLD carries a Decisions list (one line each or a link); cap 3 ADRs per epic on `full`.

## For agents (2026)
- Spec-driven development: a design step produces a design document the build agents read; specs
  rot unless someone owns them and they have an update rule [C, practitioner sources].
  https://arxiv.org/html/2602.00180v1 · https://augmentcode.com/guides/what-is-spec-driven-development
- A spec for agents is "the subset of architecture decisions needed to implement the feature
  correctly", not a full system design document [S].
- **Consistency conventions** (naming, ID and date formats, error shape, logging) in one table:
  BMAD's architecture spine; without it, parallel agents drift (research/13 §7).

## What the earlier research already settled (research/07 §6.2)
- arc42 order + C4 levels 1–2 + the pilot's ops sections (failure modes, migration, rollout,
  test strategy, observability), about 18 sections.
- Add: top 3–5 quality goals at the top; a trace table FR/NFR → component(s) → ADR(s); a short
  glossary.
- Vera's checks: every PRD FR/NFR in the trace table; every container in the diagram is in the
  components table and the reverse; every quality goal has a measurable scenario; every ADR
  linked exists and is accepted (or proposed on the same approval, per 61); Mermaid blocks pass
  the shallow check.
- Word budget today: HLD 600 for the top part (docs/documents.md); the whole document has none.

## Open for the interview
1. **Size:** about 18 sections (research/07) vs a lean core with the rest optional ("N/A —
   reason", arc42's "omitted"), given 62b's note and the ADRs carry part of the load.
2. **Diagrams:** Mermaid C4 (experimental) vs `flowchart` with C4 labels; which are required
   (context, container, one sequence per key flow?).
3. **The trace table and quality scenarios:** required shape, and what the lint checks vs Vera.
4. **Scope:** one HLD per initiative (feature) vs a living system HLD; what goes to the LLD (63).
5. **The pilot's ops sections:** required on `full`, or optional with a reason.
6. **Overlays:** the pilot's own HLD template (D-20: a project's format wins).

Not opened directly: arc42.org's 9.0 release notes; Structurizr's docs.

## The interview (Jet, 2026-11-26)
- Settled before it (design/01 §4): one HLD per feature on `full`, read while it's built; it links
  ADRs, never repeats them.
- **Q1 Size: "A".** A required core of 10 sections (goals and top 3–5 measurable quality goals;
  context and scope with the context diagram and non-goals; solution strategy; building blocks
  with the container diagram and a components table; key flows; data: ownership, changes,
  migration; cross-cutting rules and conventions; decisions, a line each or an ADR link; the trace
  table FR/NFR → component → ADR; risks and rollout). Optional, each filled in or "Omitted:
  <reason>" (the lint checks one or the other): deployment, observability, failure modes, test
  strategy, constraints, glossary.
- **Q2 Diagrams: "A".** Mermaid `flowchart` with C4 labels (not the experimental C4 syntax):
  the context and container diagrams required, and a `sequenceDiagram` per key flow (at least one).
  The lint: the shallow Mermaid check; Vera: every container in the diagram is in the components
  table and the reverse.
- **Q3 Trace table and quality goals: "A".** The lint checks structure, Vera the substance. Trace
  table `ID | Component(s) | Decision (D-n or ADR) | Note`: every FR/NFR of the linked PRD, no
  other ID; components exist in the components table; ADR links resolve (accepted, or proposed on
  the same approval); `deferred: <reason>` allowed. Quality goals as scenarios, each citing an
  NFR-n and with a number (the lint); Vera judges whether it tests the goal and the design meets it.
- **Q4 Length: "A".** The summary keeps 600 words (fails above); the whole HLD gets 4,000 words
  (`hld_words`, warns above: "move per-epic detail into an LLD, unit 63"); both project settings.
- **Q5 A project's own HLD template: "A".** 37's overlays and rename map: the project's section
  names map onto the 10 core sections; a core section it lacks (the pilot's: the trace table,
  Decisions) is added at the end; the lint, Vera and trace read the mapped names; its extra
  sections stay.
