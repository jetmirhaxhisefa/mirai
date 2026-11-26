# Unit 61: ADR research (web, 2026-11-26)

The research behind 61's interview. [C] = consensus across primary sources; [S] = one source.

## Template
- **MADR 4.0.0** (2024-09-17, latest): required Title, Context and Problem Statement, Considered
  Options, Decision Outcome; optional front matter, Decision Drivers, Consequences, **Confirmation**
  ("how the implementation of/compliance with the ADR can/will be confirmed", e.g. a review or an
  ArchUnit test), Pros and Cons, More Information. https://adr.github.io/madr/ ·
  https://github.com/adr/madr
- **Nygard (2011):** Title, Context, Decision, Status, Consequences; one or two pages.
  https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- **Y-statement (Zimmermann):** "In the context of …, facing …, we decided for … to achieve …,
  accepting …". https://socadk.github.io/design-practice-repository/artifact-templates/DPR-ArchitecturalDecisionRecordYForm
- Must contain [C]: context, decision, alternatives, consequences including the negative ones.
  Microsoft adds confidence and "avoid making decision records design guides"; Fowler (2026) adds
  revisit triggers, about one page. https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record ·
  https://martinfowler.com/bliki/ArchitectureDecisionRecord.html · https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html

## ADR vs HLD
- The ADR sits beside the design doc and records its decisions [C]. Spotify: big change → RFC,
  then ADR; small change → ADR only. https://engineering.atspotify.com/2020/04/when-should-i-write-an-architecture-decision-record
- Microsoft playbook: decisions buried in design docs are hard to find; track them as ADRs.
  https://microsoft.github.io/code-with-engineering-playbook/design/design-reviews/decision-log/
- arc42 §9: refer, don't repeat. https://docs.arc42.org/section-9/
- Anti-patterns (Zimmermann [S]): Mega-ADR, Blueprint in disguise, Dummy alternative, Fairy tale.
  https://ozimmer.ch/practices/2023/04/03/ADRCreation.html

## When to write one
- Significance [C]: structure, NFRs, dependencies, interfaces, hard to reverse. Zimmermann's
  significance test (7 criteria). https://ozimmer.ch/practices/2020/09/24/ASRTestECSADecisions.html ·
  https://docs.cloud.google.com/architecture/architecture-decision-records
- Not for trivial, temporary or standard-covered choices.
  https://github.com/joelparkerhenderson/architecture-decision-record

## Keeping the count small
- One decision per ADR [C]; statuses incl. rejected (kept, "to prevent future discussions",
  AWS) and superseded; an index (Microsoft playbook); periodic review (GOV.UK 2025, ecADR).
  https://www.gov.uk/government/publications/architectural-decision-record-framework/architectural-decision-record-framework
- Data: 921 GitHub repos (IEEE Access 2023): about half of the repos with ADRs have 1–5.
  https://doaj.org/article/f838f2a538ea48e7a3b15ce99befe612
- Sprawl with agents: an anecdote of 141 ADRs in ~4 months (search snippet only); O'Reilly (2026):
  agents turn "clarifications into amendments". https://oreilly.com/radar/coding-agents-love-decision-records/
- Counter-view [S]: a short decision log edited in place. https://dev.to/gregsmethells/your-decision-log-is-an-archaeological-site-41bk

## Lifecycle and checks
- Immutable once accepted; supersede [C] (Nygard, AWS, Microsoft, Fowler); dissent: mutable with
  dated edits (joelparkerhenderson; Davidson 2026).
- In the repo as Markdown (ThoughtWorks Radar: Adopt); `docs/decisions/` (MADR).
- Checkability: fitness functions (Building Evolutionary Architectures ch. 4), ArchUnit-style rules
  citing the ADR ID; LLMs detect explicit violations well, implicit ones poorly (arXiv 2602.07609).

## Agents
- Accepted = binding, proposed = context, superseded = history; a conflict stops the agent and
  asks (O'Reilly 2026). Give agents the index and a few recent ADRs, not the archive (EASE 2026,
  arXiv 2604.03826: the last 3–5 ADRs as context work best). https://understandingdata.com/posts/adrs-for-agent-context/

Not opened directly: adr-tools, log4brains, Zimmermann's Y-statement Medium post (403).
