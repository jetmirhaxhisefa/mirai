# 07 — Document Templates for MIRAI (PRD, HLD, LLD, ADR)

Research date: 2026-10-21. All facts below come from live fetches of the URLs cited next to them. Where a page could not be fetched or did not state something (for example a license), this file says so instead of guessing.

Legend for "Verifier-checkable": **O** = objectively checkable (exists / non-empty / matches a pattern / links resolve); **S** = needs judgement (quality of reasoning).

---

## 1. Summary tables

### 1.1 ADR

| Template | Owner | License (exact) | Sections | Status values | Fit for MIRAI |
|---|---|---|---|---|---|
| **MADR 4.0.0** (2024-09-17) | adr GitHub org | `MIT OR CC0-1.0` (dual, pick either) | Title, Context & Problem, Decision Drivers*, Considered Options, Decision Outcome (+Consequences*, +Confirmation*), Pros/Cons of Options*, More Information* (*optional) | `proposed \| rejected \| accepted \| deprecated \| … \| superseded by ADR-NNNN` in YAML frontmatter | **Best base.** Frontmatter, option list, "Confirmation" section. |
| **Nygard ADR** (2011) | Michael Nygard / Cognitect | CC0 1.0 (copyright waived) | Title, Context, Decision, Status, Consequences | Proposed, Accepted, Deprecated, Superseded | Too thin alone; good minimum. |
| **Y-statement** | Olaf Zimmermann et al. | Not stated on the fetched page | One sentence: In the context of… facing… we decided for… (and neglected…) to achieve… accepting… (because…) | None | Use as a required one-line summary inside the ADR. |
| **joelparkerhenderson collection** | Joel Parker Henderson | README: CC BY-NC-SA (4.0); individual templates vary | 13 templates (Nygard, MADR, Tyree/Akerman, Planguage, Merson, Zimmermann, …) | Not standardised | Reference only. NonCommercial license — do not copy text. |

### 1.2 HLD / architecture

| Template | Owner | License (exact) | Structure | Diagrams-as-code | Fit for MIRAI |
|---|---|---|---|---|---|
| **arc42** | Peter Hruschka, Gernot Starke | CC BY-SA 4.0 | 12 sections (Goals → Glossary) | Notation-agnostic; AsciiDoc/Markdown sources | **Best skeleton for HLD**; ShareAlike applies if we copy its text. |
| **C4 model** | Simon Brown | Website + examples CC BY 4.0 | 4 levels (Context, Container, Component, Code) + 3 supporting (Landscape, Dynamic, Deployment) | Yes: Structurizr DSL (exports PlantUML/Mermaid), Mermaid C4 (experimental) | **Use for the diagrams inside the HLD**, not as a doc template. |
| **Pilot HLD (people-management-tool)** | Jet (internal) | Internal | 16 sections + header | Not specified | Strong on ops/failure/security; map onto arc42 (see §4.2). |

### 1.3 LLD / design doc / RFC

| Template | Owner | License (exact) | Sections | Fit for MIRAI |
|---|---|---|---|---|
| **Design Docs at Google** (2020) | Malte Ubl | No license on page | Context & scope, Goals & non-goals, The actual design (diagram, APIs, data storage, code, degree of constraint), Alternatives considered, Cross-cutting concerns | **Best base for LLD** (structure only; write our own text). |
| **Rust RFC template** | rust-lang | Apache-2.0 OR MIT | Summary, Motivation, Guide-level explanation, Reference-level explanation, Drawbacks, Rationale & alternatives, Prior art, Unresolved questions, Future possibilities | Good add-ons: Drawbacks, Unresolved questions, Prior art. |
| **HashiCorp RFC** | HashiCorp | No license on page (site terms only) | Header fields + Overview, Background, Proposal (+Abandoned ideas), free-form sections | Good header fields + status set; body too free-form. |
| **Uber RFC (to ~2019)** | Uber (via Gergely Orosz) | Not published as a file | Services: approvers, abstract, architecture changes, SLAs, dependencies, load testing, multi-DC, security, testing & rollout, metrics, support | Good operational checklist. |
| **IEEE 1016-2009 SDD** | IEEE | Paywalled standard, "Inactive – Reserved" | 12 viewpoints (context, composition, logical, dependency, information, patterns, interface, structure, interaction, state dynamics, algorithm, resource) | Checklist of LLD topics only. |

### 1.4 PRD

| Template | Owner | License (exact) | Sections | Acceptance criteria? | Fit for MIRAI |
|---|---|---|---|---|---|
| **Kevin Yien PRD (Square)** | Kevin Yien | No license stated | Problem alignment, High-level approach, Narrative, Goals, Non-goals, Solution alignment, Key features, Future, Key flows, Key logic, Launch plan, Milestones, Ops checklist, Appendix (changelog, open questions), FAQ, Impact checklist | Exit criteria per phase; none per feature | **Best structure** (non-goals, sign-off gates). |
| **HashiCorp PRD** | HashiCorp | No license on page | Background, Problem (+Personas), Requirements & Phases (each requirement → Acceptance Criteria, Considerations), User research, Approvals | **Yes, per requirement** | Best requirement block shape. |
| **Atlassian Confluence PRD** | Atlassian | No license; © Atlassian, Cloud ToS | Basics/team, Objective, Success metrics, Assumptions, Requirements table (user story, importance, Jira, notes), Supporting docs, Open questions, Out of scope | No (user stories + importance) | Good tables for metrics and open questions. |
| **Lenny's 1-pager** | Lenny Rachitsky | No license stated | Description, Problem, Why, Success, Audience, What, How, When | No | Good for the Business Requirements step before the PRD. |

**License takeaway:** only MADR (MIT/CC0), Nygard (CC0), Rust RFC (Apache-2.0/MIT), C4 (CC BY 4.0) and arc42 (CC BY-SA 4.0) are clearly open. The PRD templates and the Google/HashiCorp docs have no license. Treat those as **structural inspiration only**: section names and ideas are fine, copied prose is not.

---

## 2. Per-template detail — ADR

### 2.1 MADR (Markdown Architectural Decision Records)
- **URLs:** https://github.com/adr/madr, template: https://raw.githubusercontent.com/adr/madr/main/template/adr-template.md, changelog: https://raw.githubusercontent.com/adr/madr/main/CHANGELOG.md
- **Owner:** adr organisation on GitHub (https://github.com/adr/madr).
- **Version:** 4.0.0, released 2024-09-17. 4.0.0-beta (2024-09-02) renamed "Validation" to "Confirmation" and added the bare and minimal variants (CHANGELOG).
- **License:** `SPDX-License-Identifier: MIT OR CC0-1.0`, dual licensed, user's choice (https://github.com/adr/madr).
- **Variants:** `adr-template.md` (full, with explanations), `adr-template-minimal.md` (mandatory only), `adr-template-bare.md` (all sections, empty), `adr-template-bare-minimal.md` (https://github.com/adr/madr).
- **Sections (full template):** YAML frontmatter (`status`, `date`, `decision-makers`, `consulted`, `informed`), Title, Context and Problem Statement, Decision Drivers (opt), Considered Options, Decision Outcome, Consequences (opt, good/bad), Confirmation (opt, how compliance is checked, such as reviews or tests), Pros and Cons of the Options (opt, good/neutral/bad), More Information (opt) (template URL above).
- **Status values:** `proposed | rejected | accepted | deprecated | … | superseded by ADR-0123`.
- **Strengths:** machine-readable frontmatter; explicit options list; "Confirmation" ties the decision to a check, which is very useful for a verifier; permissive license; Markdown native.
- **Weaknesses for an AI author:** many optional sections, so agents may skip the hard ones (pros/cons). The "…" in status leaves the list open. No required link to the PRD requirement or HLD section the decision serves. Nothing forces the chosen option to be one of the listed options.
- **Verifier checks:** O: frontmatter parses; status in an allowed enum; date in ISO format; ≥2 considered options; the chosen option matches one listed option exactly; every option has a pros/cons entry; superseded ADRs point to an existing ADR ID; Confirmation non-empty. S: is the context neutral, are the drivers real.

### 2.2 Michael Nygard ADR
- **URL:** https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions (2011-11-15).
- **License:** CC0 1.0. Cognitect "has waived all copyright and related or neighboring rights" (same URL).
- **Sections:** Title (short noun phrase, numbered), Context (forces, "value-neutral… simply describing facts"), Decision ("full sentences, with active voice"), Status, Consequences ("All consequences… not just the positive ones").
- **Status values:** Proposed, Accepted, Deprecated, Superseded (with a reference to the replacement).
- **Strengths:** tiny, universally known, quick for agents to write and readers to scan.
- **Weaknesses:** no alternatives section, so an agent can state a decision without showing it compared options. No metadata, no verification hook.
- **Verifier checks:** O: all 5 sections present, status in enum, superseded link exists. S: are both negative and positive consequences listed (partly O: count bullets under each).

### 2.3 Y-statements (Zimmermann)
- **URL:** https://adr.github.io/adr-templates/ (the original Medium article https://medium.com/olzzio/y-statements-10eb07b5a177 returned HTTP 403). Origin: the "Sustainable Architectural Decisions" article by Zdun et al. (https://adr.github.io/).
- **Shape (short):** "In the context of <use case>, facing <concern>, we decided for <option> to achieve <quality>, accepting <downside>." **Long form** adds "and neglected <other options>" and "because <rationale>" (https://adr.github.io/adr-templates/).
- **License:** not stated on the fetched page.
- **Strengths:** forces trade-off thinking in one sentence; easy to regex-check.
- **Weaknesses:** too compressed to stand alone for big decisions.
- **Verifier checks:** O: all 7 clauses present (pattern match). Ideal as a required summary line.

### 2.4 joelparkerhenderson/architecture-decision-record
- **URL:** https://github.com/joelparkerhenderson/architecture-decision-record
- **License:** README states CC BY-NC-SA (links 4.0) for the author's own work (https://raw.githubusercontent.com/joelparkerhenderson/architecture-decision-record/main/LICENSE.md). **NonCommercial**, so do not copy its text into MIRAI.
- **Contents:** 13 templates: Tyree & Akerman, Nygard, EdgeX, arc42, Alexandrian pattern, business case, MADR, Planguage, Paulo Merson, Olaf Zimmermann, Gareth Morgan, GIG Cymru NHS Wales, Ignacio Larrañaga ITDs. No standard status set.
- **Use:** reference catalogue only.

---

## 3. Per-template detail — HLD / architecture

### 3.1 arc42
- **URLs:** https://arc42.org/overview, https://arc42.org/license, https://arc42.org/download, tips: https://docs.arc42.org/home/
- **Owner:** Peter Hruschka & Gernot Starke (footer, https://arc42.org/overview).
- **License:** "Creative Commons Attribution-ShareAlike 4.0 International License" (https://arc42.org/license). "Open source and free, also for commercial use" (overview). **ShareAlike:** a MIRAI template that copies arc42 text must also be CC BY-SA. Reusing the section *structure* with our own wording avoids most of this. Attribution is still polite.
- **Sections:** 1 Introduction & Goals (requirements, top quality goals), 2 Constraints, 3 Context & Scope (external systems, interfaces), 4 Solution Strategy, 5 Building Block View (usually the largest), 6 Runtime View, 7 Deployment View, 8 Crosscutting Concepts, 9 Architecture Decisions, 10 Quality Requirements (quality tree, scenarios), 11 Risks & Technical Debt, 12 Glossary (https://arc42.org/overview).
- **Formats/variants:** AsciiDoc (source), Markdown (incl. strict and multi-page), GitHub Markdown, docx, LaTeX, rST, etc. "Plain" vs "with help" (https://arc42.org/download).
- **"Lean":** there is no official lean variant. docs.arc42.org uses `lean`, `essential`, `thorough` as **tags on tips**. "Essential" covers what you should document even when lean, for example quality goals (https://docs.arc42.org/home/). A third-party toolkit (https://github.com/MSiccDev/arc42-toolkit) defines LEAN/ESSENTIAL/THOROUGH levels and says they are "not part of the official arc42 template". arc42's FAQ: "Please don't fill in everything. Document only what your stakeholders need" (https://leanpub.com/read/arc42-faq/chapter-vii).
- **Strengths:** proven, complete, well-known, cleanly separates static/runtime/deployment views; quality scenarios are testable.
- **Weaknesses for an AI author:** 12 sections plus "everything optional" invites padding. Section 8 (Crosscutting) is a catch-all. Quality goals are often vague ("fast", "secure") unless scenarios are required. No explicit failure-modes, migration or rollout sections, which the pilot template has.
- **Verifier checks:** O: sections present; every external system in §3 appears in the context diagram; every building block in §5 has an owner; every quality goal in §1 has ≥1 measurable scenario in §10; every ADR referenced in §9 exists; glossary terms used in the text are defined. S: solution strategy coherence.

### 3.2 C4 model
- **URLs:** https://c4model.com/, https://c4model.com/diagrams, https://c4model.com/tooling
- **Owner:** Simon Brown. **License:** website and example diagrams CC BY 4.0 (https://c4model.com/).
- **Levels:** System Context, Container, Component, Code. Supporting diagrams: System Landscape, Dynamic, Deployment (https://c4model.com/). "System context and container diagrams are sufficient for most software development teams"; you don't need all 4 levels (https://c4model.com/diagrams).
- **Notation:** notation- and tooling-independent (https://c4model.com/). Modelling tools are preferred over drawing tools because they can validate diagrams and are easy to diff in git (https://c4model.com/tooling).
- **Diagrams as code:**
  - **Structurizr DSL:** text DSL for C4 models with context, container, component, dynamic and deployment views. Exports to PlantUML, C4-PlantUML and Mermaid, and can embed docs and ADRs (https://docs.structurizr.com/dsl).
  - **Mermaid C4:** supports C4Context, C4Container, C4Component, C4Dynamic, C4Deployment, but "This is an experimental diagram for now. The syntax and properties can change" (https://mermaid.js.org/syntax/c4.html).
- **Strengths:** standard vocabulary for diagrams; text-based diagrams are diffable and parseable, which makes them ideal for agents and verifiers.
- **Weaknesses:** it is a diagram model, not a document template. Mermaid C4 is experimental, so its rendering may vary.
- **Verifier checks:** O: Mermaid/Structurizr block parses; every container in the diagram is described in the text and the reverse; every relationship has a label and protocol; every element has a type (Person/System/Container/…).

---

## 4. Per-template detail — LLD / design docs

### 4.1 Design Docs at Google (Malte Ubl)
- **URL:** https://www.industrialempathy.com/posts/design-docs-at-google/ (2020-07-06). **License:** none stated.
- **Sections:** Context and scope (objective facts, not requirements); Goals and non-goals (bullets); The actual design (overview, then trade-offs: system-context diagram, APIs, data storage, code/pseudo-code (rare), degree of constraint); Alternatives considered; Cross-cutting concerns (security, privacy, observability).
- **Length:** 10–20 pages for larger projects; a 1–3 page "mini design doc" for incremental work.
- **Lifecycle:** create & iterate → review → implement & update → maintain/learn.
- **When not to write one:** the solution is not ambiguous; the doc is really an implementation manual with no trade-offs; rapid prototyping.
- **Strengths:** focuses on trade-offs; explicit non-goals; "when not to write" helps MIRAI skip LLDs for trivial tickets.
- **Weaknesses for an AI author:** no fixed headings for API contracts or data schema; no acceptance criteria, test plan or rollout; the 10–20 page target invites verbosity.
- **Verifier checks:** O: non-goals present; ≥1 alternative with a rejection reason; each API listed has request/response/error shape; diagram parses. S: trade-off quality.

### 4.2 Rust RFC template
- **URL:** https://raw.githubusercontent.com/rust-lang/rfcs/master/0000-template.md. **License:** Apache-2.0 OR MIT (https://github.com/rust-lang/rfcs; the repo says it is still adopting this per RFC 2044).
- **Header:** Feature Name, Start Date, RFC PR, Rust Issue.
- **Sections:** Summary, Motivation, Guide-level explanation, Reference-level explanation, Drawbacks, Rationale and alternatives, Prior art, Unresolved questions, Future possibilities.
- **Strengths:** "Drawbacks" and "Unresolved questions" are explicit; splitting the user-facing explanation from the technical one is a good pattern for an API LLD.
- **Weaknesses:** built for language features; no ops, security or rollout sections.
- **Verifier checks:** O: unresolved questions list is empty before status=Accepted; drawbacks non-empty.

### 4.3 HashiCorp RFC (and PRD)
- **URL:** https://www.hashicorp.com/how-hashicorp-works/articles/rfc-template. **License:** none for the template; only site terms.
- **Header fields:** Summary, Created, Status, Current Version, Owner, Target Version, Contributors, PRD (link), Other stakeholders, Approvers.
- **Status values:** WIP, In-Review, Approved, Obsolete.
- **Sections:** Overview, Background, Proposal/Goal (+ Abandoned Ideas, optional), free-form H2 sections (examples: Implementation, UX, UI), Style notes.
- **Process:** PRD defines the problem, then the RFC proposes a solution (https://hashicorp.com/how-hashicorp-works/articles/writing-practices-and-culture). This matches the MIRAI chain.
- **Strengths:** clean PRD→RFC link field; small status enum; approvers field.
- **Weaknesses:** body is free-form, so it is hard to verify.

### 4.4 Uber RFC (historic)
- **Source:** https://blog.pragmaticengineer.com/rfcs-and-design-docs/ (and https://blog.pragmaticengineer.com/scaling-engineering-teams-via-writing-things-down-rfcs/). No template file is published.
- **Services sections:** Approvers, Abstract, Architecture changes, Service SLAs, Service dependencies, Load & performance testing, Multi-data-center concerns, Security, Testing & rollout, Metrics & monitoring, Customer support considerations. A separate mobile variant adds UI/UX, network interactions, analytics and accessibility.
- **Value:** a good operational checklist for LLD. The same article lists other public templates (Sourcegraph, Razorpay, Couchbase, incident.io).

### 4.5 IEEE 1016-2009 (Software Design Description)
- **Source:** https://en.wikipedia.org/wiki/Software_design_description (the standard is paywalled and listed as "Inactive – Reserved").
- **Viewpoints:** context, composition, logical, dependency, information, patterns use, interface, structure, interaction, state dynamics, algorithm, resource.
- **Use:** a coverage checklist for LLD (state dynamics and algorithm are often missing from design docs). Not a template to copy.

---

## 5. Per-template detail — PRD

### 5.1 Kevin Yien PRD (Square)
- **URL:** https://docs.google.com/document/d/1mEMDcHmtQ6twzNlpvF-9maNlAcezpWDtCnyIqWkODZs/edit (listed at https://www.lennysnewsletter.com/i/683946/pagersprds). **License:** none stated.
- **Sections:** Header (name, description, team, contributors, resources, status, last updated); **Problem Alignment** (1–2 sentence problem, why, evidence; *reviewer sign-off before continuing*); High Level Approach; Narrative (opt); Goals (prioritised, measurable and non-measurable); **Non-goals** (with reasons); Solution Alignment; Key Features (prioritised); Future considerations; Key Flows; **Key Logic** (rules and edge cases; *sign-off*); Launch Plan (phases, exit criteria, risks, dependencies); Key Milestones (table with exit criteria); Operational Checklist (analytics, support, legal, …); Appendix (Changelog, Open Questions); FAQs; Impact Checklist.
- **Strengths:** staged sign-off gates map well onto MIRAI verifier gates; non-goals; edge cases in "Key Logic".
- **Weaknesses for an AI author:** long (18 parts). Features have no IDs and no per-feature acceptance criteria. Goals can be non-measurable.
- **Verifier checks:** O: problem ≤2 sentences; ≥1 non-goal with a reason; every goal has a metric or is marked non-measurable; milestones have exit criteria; no open questions left at Approved.

### 5.2 HashiCorp PRD ("Problem Requirements Document")
- **URL:** https://www.hashicorp.com/how-hashicorp-works/articles/prd-template. **License:** none stated.
- **Header:** Summary, Created, Status, Owner, RFC (link), Contributors. **Status:** WIP, In Review, Approved, Obsolete.
- **Sections:** Background; Problem (+Personas); Requirements and Phases (each Requirement block has **Acceptance Criteria** and Considerations); User Research; Approvals.
- **Strengths:** the only fetched PRD with acceptance criteria per requirement; problem-first; links to the RFC.
- **Weaknesses:** no non-goals, metrics or risks; requirements have no IDs.

### 5.3 Atlassian Confluence PRD
- **URL:** https://www.atlassian.com/software/confluence/templates/product-requirements. **License:** none; "Copyright © 2026 Atlassian" plus Cloud Terms. (The article https://www.atlassian.com/agile/product-management/requirements could not be read: only the navigation came through.)
- **Sections:** PRD basics (target release, status, team); Objective; Success metrics (table); Assumptions; Requirements table (user story, importance, Jira issue, notes); Supporting documentation; Open questions (question/answer/date table); Out of scope.
- **Strengths:** tabular, so it is easy to parse; assumptions and out-of-scope are explicit; importance per requirement.
- **Weaknesses:** no acceptance criteria; user stories alone are ambiguous.

### 5.4 Lenny Rachitsky 1-pager
- **URL:** https://docs.google.com/document/d/1541V32QgSwyCFWxtiMIThn-6n-2s7fVWztEWVa970uo/edit. **License:** none stated.
- **Sections:** Description, Problem, Why (evidence), Success, Audience, What, How (experiment plan), When.
- **Strengths:** very short, so it fits the **business requirements / brief** step that comes before the PRD.
- **Weaknesses:** not detailed enough for engineering.

---

## 6. Recommendation for MIRAI

General rules for all four templates:
1. **YAML frontmatter on every doc:** `id`, `type`, `title`, `status`, `version`, `owner` (agent or human), `reviewers`, `created`, `updated`, `upstream` (IDs of the parent docs), `downstream`. One shared status enum: `draft → in-review → approved → superseded | obsolete` (HashiCorp's set plus MADR's superseded). ADRs also allow `proposed | accepted | rejected | deprecated | superseded-by:<id>`.
2. **Stable IDs everywhere** so verifiers can trace: `BR-n` (business requirement), `FR-n` / `NFR-n` (requirements), `AC-FR-n.m` (acceptance criteria), `G-n` / `NG-n` (goals/non-goals), `R-n` (risks), `Q-n` (open questions), `ADR-NNNN`, `C-name` (component).
3. **Write our own text, borrow structure.** Copy text verbatim only from MADR (MIT/CC0), Nygard (CC0) or Rust RFC (MIT). Do not copy arc42 text unless the MIRAI template is CC BY-SA. Do not copy text from Yien, HashiCorp, Atlassian, Google or joelparkerhenderson (no license, or NonCommercial).
4. **Every section gets a one-line "done when" rule** inside an HTML comment. The author agent fills to the rule, and the verifier checks against the same rule.
5. **"Not applicable — <reason>" is allowed** for any optional section. Empty sections are not. This stops padding (arc42's own advice) and still lets verifiers check that nothing was skipped silently.
6. **Diagrams as Mermaid** (flowchart/sequence; C4 syntax allowed but note it is experimental). Offer Structurizr DSL as an option for larger systems.

### 6.1 PRD: base on Kevin Yien's structure + HashiCorp's requirement block + Atlassian's tables
Keep: Problem alignment (≤2 sentences + evidence), Goals with metrics, **Non-goals with reasons**, Key flows, Key logic/edge cases, Launch phases with exit criteria, Open questions, Changelog.
Cut: FAQ, Impact checklist and Operational checklist as separate sections (fold into one short "Impacts" checklist), Narrative (optional), "Example PRDs".
Add:
- `upstream: BR-*` links to the business brief (the brief itself is based on Lenny's 1-pager: Problem, Why, Success, Audience, What, When).
- A **Requirements table:** `FR-n | statement (shall…) | priority (MoSCoW) | source BR`. Plus `NFR-n` with a measurable target.
- **Acceptance criteria per FR**, given/when/then, IDed `AC-FR-n.m`. This is the main gap in Yien and Atlassian.
- Assumptions, Dependencies, Risks (`R-n`: likelihood, impact, mitigation), Success metrics table (metric, baseline, target, how measured).
- Verifier: every FR has ≥1 AC; every AC is testable (has a when/then and an observable result); every goal has a metric; no `Q-n` open at `approved`; every BR is covered by ≥1 FR.

### 6.2 HLD: base on arc42's section order, C4 diagrams, and keep the pilot's ops sections
Mapping of the pilot's 16 sections (`/Users/jetmir.haxhisefa/Projects/people-management-tool/platform/.claude/templates/hld-template.md`) to arc42 / C4:

| Pilot section | arc42 equivalent | C4 | Action |
|---|---|---|---|
| Header (Status, Authors, Reviewers, Related RFC/ADR, Last updated) | — | — | Keep; convert to YAML frontmatter with `upstream: PRD-x`. |
| Context and accepted requirements | §1 Intro & Goals + §2 Constraints + §3 Context & Scope | System Context | Keep; split into *Requirements in scope (FR/NFR IDs)*, *Constraints*, *Context & scope (context diagram)*. |
| Architecture overview | §4 Solution Strategy | Container | Keep; require a container diagram. |
| Components and ownership | §5 Building Block View | Container/Component | Keep; table: component, responsibility, owner, FRs served. |
| Request, event, and data flows | §6 Runtime View | Dynamic | Keep; sequence diagram per key flow. |
| Interfaces and contracts | §3 (external) / §5 (internal) | relationships | Keep at HLD level (names + protocol); full schemas go to the LLD. |
| Data model and invariants | §8 Crosscutting (domain model) | — | Keep (entities + invariants); field-level schema goes to the LLD. |
| Transaction and consistency model | §8 Crosscutting | — | Keep. |
| Failure modes and recovery | §8 / §11 (partly) | — | Keep — **not in arc42**; a strength of the pilot. |
| Security and privacy | §8 Crosscutting / §10 | — | Keep. |
| Performance and scale assumptions | §10 Quality Requirements | — | Keep; rewrite as **quality scenarios** with numbers tied to NFR IDs. |
| Migration and mixed-version compatibility | — (not in arc42) | — | Keep, "N/A — reason" allowed. |
| Deployment, rollout, and rollback | §7 Deployment View | Deployment | Keep; add a deployment diagram for multi-env systems. |
| Observability and operations | §8 Crosscutting | — | Keep. |
| Test strategy | — (not in arc42) | — | Keep at HLD level (test levels and which NFRs get load/chaos tests). |
| Alternatives and trade-offs | §9 Architecture Decisions | — | Keep a short summary; **each significant decision becomes its own ADR** and is linked by ID. |
| Risks, unknowns, and follow-up decisions | §11 Risks & Technical Debt | — | Keep; use `R-n` and `Q-n` IDs. |
| *(missing)* | §12 Glossary | — | **Add** (short; links to the domain terms). |
| *(missing)* | §1 Quality goals (top 3–5) | — | **Add** explicitly, at the top. |
| *(missing)* | — | — | **Add a requirements traceability table:** FR/NFR → component(s) → ADR(s). |

Result: about 18 sections, ordered like arc42, with the pilot's ops depth. Verifier: every FR/NFR in the upstream PRD appears in the trace table; every container in the diagram appears in the components table and the reverse; every quality goal has a measurable scenario; every referenced ADR exists and is `accepted`; the Mermaid blocks parse.

### 6.3 LLD: base on Google design doc + Rust RFC's drawbacks/unresolved questions + the Uber ops checklist
One LLD per component or epic, and **only when needed** (Ubl's "when not to write one"). For trivial tickets the ticket itself is enough.
Sections: Frontmatter (`upstream: HLD-x, FR/AC IDs`); Context & scope (facts only); Goals / Non-goals; Design overview (component diagram); **API contracts** (per endpoint/event: request, response, errors, idempotency, auth); **Data schema & migrations** (tables/fields/indexes, migration and backfill); State and algorithms (state machine / pseudo-code where logic is non-trivial, per IEEE 1016's state-dynamics and algorithm viewpoints); Error handling & edge cases; Security; Observability (metrics, logs, alerts); **Test plan mapped to AC IDs**; Rollout/feature flags; Alternatives considered; Drawbacks; Unresolved questions; **Ticket breakdown** (each ticket lists the AC IDs it satisfies).
Cut: Google's long-form length target (aim for 1–3 pages per the "mini design doc" guidance); Rust's guide-level explanation, prior art and future possibilities (optional).
Verifier: every AC from upstream is covered by ≥1 test and ≥1 ticket; every API has an error section; every schema change has a migration and rollback; unresolved questions are empty at `approved`.

### 6.4 ADR: base on MADR 4.0.0 (full template, MIT licensed copy) + Y-statement summary
Keep: MADR frontmatter, Context & Problem, Decision Drivers (make it **required**), Considered Options (**≥2 required**), Decision Outcome, Consequences (good **and** bad, both required, per Nygard), **Confirmation (required)**: how compliance is checked (test, lint rule, review item).
Cut/optional: More Information; Pros/Cons per option can be a compact table.
Add: a required **Y-statement** one-liner at the top (long form); `upstream` links to the HLD section and the FR/NFR IDs it affects; `supersedes` / `superseded-by` fields; a closed status enum (drop MADR's open "…").
Verifier: chosen option ∈ considered options; Y-statement has all 7 clauses; at least one bad consequence; Confirmation names a concrete check; supersede links resolve; numbering is unique and sequential.

### 6.5 Licensing note for MIRAI's own templates
If MIRAI templates are published under MIT, include MADR text (MIT) and Rust RFC wording (MIT) with attribution. Restate arc42/C4 ideas in our own words, with a credit line: "Structure inspired by arc42 (CC BY-SA 4.0) and the C4 model (CC BY 4.0)". Keep the PRD templates as structural inspiration only.
