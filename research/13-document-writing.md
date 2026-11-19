# 13 — Writing documents for two readers: the approver and the agents

Research date: 2026-11-19. This file builds on `research/07-doc-templates.md` and does not repeat it.
Every fact comes from a live fetch of the URL next to it, or from a file in a repo cloned on this
date (path and commit given). When a page could not be fetched, or did not state something (for
example a license), this file says so. It does not guess.

Legend: **L** = a lint script can check it. **J** = it needs judgement (Vera or the reader test).

The question: how do MIRAI's templates make a document that Jet can approve in minutes, that reads
as professional and clear, and that still gives agents enough detail to build without guessing?
D-59 (PM-03) already fixed the shape: two layers in one file.

---

## 1. Summary

| Topic | Main finding | Best sources | Use in MIRAI |
|---|---|---|---|
| Approver's summary | Put the bottom line first. Say what is asked of the reader. Keep it to one page. Write it last, from the detail. | BLUF (AR 25-50 via Wikipedia); Amazon PR/FAQ; KEP and PEP summaries; BMAD brief | The top part opens with a one-line ask. It is written last and holds nothing the detail does not. |
| Decisions asked | No standard "decision memo" format exists in a primary source. The common shape is: question, options, recommendation, cost. | Cagan Q10; MADR; secondary decision-memo guides | A fixed "Decisions for you" block. Each item has options, a recommendation and the ID of the detail it rests on. |
| Business brief | Lenny's 1-pager, Shape Up pitch, Cagan's assessment and PR/FAQ overlap on problem, audience, why now and success. Shape Up adds appetite and no-gos. | Shape Up; SVPG; AWS; BMAD brief and opportunity templates | A brief with problem, users, why now, success, BR-n, appetite, no-gos, rabbit holes, open questions. |
| Clear writing | Short sentences (split above 25 words), active voice, most important first, plain words, lists with a lead-in. | GOV.UK; digital.gov; Google; Microsoft; pstack `technical-writing` | Six lint rules and six judgement rules (§9c). |
| Detail for agents | Agents need a written "done when", testable criteria with IDs, edge cases, scope limits, and no open questions at handoff. | Spec Kit; Kiro; EARS; Claude Code and Codex guides | The detail part always carries the eight items in §9d. |
| Frameworks | None of them puts an approver layer and an agent layer in one file. Spec Kit splits by file. BMAD writes an executive summary last and renders an HTML view. | BMAD v7; Spec Kit; Kiro; pstack; agent-os; Task Master | Keep D-59. Borrow BMAD's "summary says nothing the sections don't hold" and Spec Kit's ambiguity checks. |

---

## 2. The approver's summary (the top part)

### 2.1 BLUF: bottom line up front
- **Source:** https://en.wikipedia.org/wiki/BLUF_(communication). It traces BLUF to *Army Regulation 25-50, Preparing and Managing Correspondence*, version of 17 May 2013, para 1-36b. Its quote comes second-hand from a 2020 blog: "putting the main point at the beginning of the correspondence (bottom line up front)". The same page says the regulation also asks for active voice.
- For operational messages the page says BLUF states "the purpose of the message and the required action".
- Army email subject lines carry a keyword such as ACTION, SIGN, INFO or DECISION (same page, citing HBR). The HBR article (https://hbr.org/2016/11/how-to-write-email-with-military-precision, Kabir Sehgal, 2016-11-22) is paywalled. I could not read its body.
- I did not fetch AR 25-50 itself. The plainlanguage.gov PDF excerpt that a search returned was not fetched either.
- **Use:** the first line of the top part is the ask and the recommendation. A keyword tells Jet what kind of ask it is (approve, decide, note).

### 2.2 Amazon narratives and PR/FAQ
- Bezos, 2017 shareholder letter (https://www.aboutamazon.com/news/company-news/2017-letter-to-shareholders): Amazon writes "narratively structured six-page memos" instead of slides. Meetings start with silent reading. A great memo takes a week or more and is rewritten and edited after a pause.
- AWS, Product management at Amazon (https://aws.amazon.com/executive-insights/content/product-management-at-amazon): the press release "must fit on a single page". It comes before budget, team or code. The FAQ has an external half (customer questions, e.g. "What happens when the product breaks?") and an internal half (e.g. "Do we have the resources to make this work?"). Teams answer "enough to make decisions quickly", not every question.
- The official Working Backwards template (https://www.workingbackwards.com/resources) lists the template only by title. Its section-by-section form was not on the fetched page. Third-party templates exist, but they are not primary sources. License: © Working Backwards LLC, all rights reserved.
- **Use:** two ideas transfer. Write for a reader who reads silently and alone. Answer the hard questions ("the FAQ") before the reader asks. The press-release form itself is overhead for internal engineering work.

### 2.3 How proposal formats open
| Format | Opening rule | License |
|---|---|---|
| Kubernetes KEP (https://raw.githubusercontent.com/kubernetes/enhancements/master/keps/NNNN-kep-template/README.md) | The Summary is "incredibly important", written before implementation, for a wide audience, "probably at least a paragraph". Non-goals "help to focus discussion". The Proposal "should not include things like API designs"; those go to Design Details. | Apache-2.0 (repo, via GitHub API) |
| Python PEP 1 (https://peps.python.org/pep-0001/) | Abstract: "a short (~200 word) description of the technical issue". | Public domain or CC0-1.0 |
| Google Technical Writing, Documents (https://developers.google.com/tech-writing/one/documents) | State the scope and the non-scope. State the audience. The start must answer "your readers' essential questions". | Not stated on the fetched page |
| Oxide RFD 1 (https://rfd.shared.oxide.computer/rfd/0001) | No rule to lead with the decision. RFDs record options, reasoning and "the determination". States: prediscussion, ideation, discussion, published, committed, abandoned. | Not stated |
| GOV.UK clear structure (https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-structure/) | Write a summary for the top. "Do not repeat the summary in the first paragraph." | OGL v3.0 |
| BMAD brief (`skills/method/bmad-agent-analyst/assets/template-brief.md:33`, BMAD-METHOD `e435a22`) | The executive summary is drafted last (`facilitation_order` puts it last, line 8). "Done when it says nothing the sections do not hold." | MIT |

The KEP split matters for MIRAI. The approver part says what and why. API shapes belong to the detail.

### 2.4 Decisions asked of the approver
- I found no primary source that defines a "decision memo" or "decision needed" section. Search results were consultancies, course pages and prompt libraries. Their common shape: a sentence starting "Decision requested:", two or three options with the key trade-off each, a recommendation, and a yes/no the reader can give from the memo alone. Treat this as convention, not a standard.
- Cagan's opportunity assessment (https://www.svpg.com/assessing-product-opportunities/, 2006) ends with question 10: "Given the above, what's the recommendation? (go or no-go)". © SVPG, all rights reserved.
- MADR and Oxide both record options and the chosen one (research/07 §2.1; RFD 1 above).
- GitLab's design-document template (https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/_template) could not be read: the fetch returned navigation only.
- **What keeps a decision from being buried:** a fixed heading, near the top, with a count. "None" is a valid answer, but it must be written down.

### 2.5 Keeping the summary consistent with the detail
- BMAD's rule above is the only explicit one I found: the summary is written last and says nothing the sections do not hold.
- Spec Kit's `/analyze` command looks across spec, plan and tasks for duplication, ambiguity, underspecification, coverage gaps and inconsistency, with a severity per finding (`templates/commands/analyze.md:54,127-183`, spec-kit `61d3abb`).
- Kiro's Analyze Requirements (https://kiro.dev/docs/specs/analyze-requirements/) flags requirements that are "collectively impossible", vague terms ("large files", "fast response times"), conflicting constraints, unstated assumptions and missing edge cases.
- **Use (my proposal, not from a source):** make the match checkable. Every claim in the top part ends with the IDs it summarises. The lint checks that the IDs resolve and that every number in the top part also appears in the detail. Vera judges whether the meaning matches.

---

## 3. The business brief that comes before the PRD

| Section idea | Lenny 1-pager | Amazon PR/FAQ | Shape Up pitch | Cagan assessment | BMAD brief | Earns its place in MIRAI? |
|---|---|---|---|---|---|---|
| Problem | Problem | Press release problem | Problem | Q1 | Problem | **Yes** |
| Who has it | Audience | Customer | (in problem) | Q2 | Who it serves | **Yes** |
| Why now / evidence | Why | — | — | Q6 | (in summary) | **Yes** |
| Success | Success | — | — | Q8 | Success criteria | **Yes**, with a counter-metric |
| Solution outline | What | Solution | Solution | — | Solution | **Short**: what changes for the user, not how |
| Time budget | When | — | **Appetite** | — | The ask (optional) | **Yes**: Jet sets how much the work is worth |
| Out of scope | — | — | **No-gos** | — | Scope | **Yes** |
| Known risks | — | Internal FAQ | **Rabbit holes** | Q9 | — | **Yes** |
| Alternatives | — | External FAQ ("why this") | — | Q4 | What makes it different | Optional (internal tools rarely need it) |
| Market size, go-to-market | — | Internal FAQ | — | Q3, Q7 | — | No, unless the work is a new product |
| Experiment plan | How | — | — | — | — | No: that belongs to the PRD or plan |

Sources: Shape Up chapter 6 (https://basecamp.com/shapeup/1.5-chapter-06) lists the five pitch ingredients: Problem, Appetite ("How much time we want to spend and how that constrains the solution"), Solution, Rabbit holes, No-gos ("Anything specifically excluded"). Chapter 3 (https://basecamp.com/shapeup/1.2-chapter-03): "Estimates start with a design and end with a number"; appetites "start with a number and end with a design". Chapter 2 (https://basecamp.com/shapeup/1.1-chapter-02): shaped work is rough, solved and bounded; "words are too abstract" when a project is a few words like "build a calendar view". License: © 37signals, all rights reserved. Lenny's sections are from research/07 §5.4. His newsletter post (https://www.lennysnewsletter.com/p/my-favorite-templates-issue-37) only links the template, with no license. Cagan and AWS as in §2.

Job stories: Alan Klement's guest post on Intercom (https://www.intercom.com/blog/using-job-stories-design-features-ui-ux/, 2013-12-23) argues that user stories "ignore context, situations, and anxieties". Job stories start from the situation. The fetched page did not give the "When…, I want to…, so I can…" template in those words, so I do not cite it as Intercom's.

BMAD v7 ships all four shapes as separate templates: `brief` (above), `pitch` (Shape Up's five sections, `skills/method/bmad-agent-pm/assets/template-pitch.md:8`), `opportunity` (Cagan's questions, `template-opportunity.md:8`) and `prfaq`. Its BRD rule fits MIRAI's `BR-n`: "once a statement names a screen, a field or an API it has started designing, so move it to `prd`" (`skills/method/bmad-agent-analyst/assets/template-brd.md`, stance comment).

---

## 4. Clear writing for humans: the well-regarded guides

| Guide | Rules that matter here | License |
|---|---|---|
| GOV.UK clear language (https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/) | "Paragraphs should have no more than 5 sentences each." "Try to split up sentences that are over 25 words long." Active voice. Short words ("buy", not "purchase"). Explain specialist terms the first time. "Must" for legal requirements, "can" for options. | OGL v3.0 (site footer) |
| GOV.UK clear structure (URL in §2.3) | "Put the most important information first." People "only read 20 to 28% of text on a webpage". Headings are descriptive, front-loaded and active. No generic headings like "Introduction". No questions as headings. No footnotes. | OGL v3.0 |
| GOV.UK A to Z (https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/) | Bullets: a lead-in line, at least two, one sentence each, no "or"/"and" at the end. Numbered steps for a process. Spell out an acronym on first use. Words to avoid: utilise, leverage, deliver (abstract), impact, streamline, tackle, empower, "in order to", "going forward". Numerals for numbers 2 and up. | OGL v3.0 |
| digital.gov plain language (https://digital.gov/guides/plain-language/writing) | Active voice "makes it clear who should do what". Present tense. Avoid hidden verbs (-ment, -tion): "We analyze data", not "We conduct an analysis". The guide is "adapted from PlainLanguage.gov" (https://digital.gov/guides/plain-language); plainlanguage.gov now redirects there. | Not stated on the pages |
| Google developer style, highlights (https://developers.google.com/style/highlights) | Second person, active voice, conditions before instructions, sentence-case headings, numbered lists for sequences, code font for code. | Not confirmed (not on the fetched text) |
| Google Technical Writing One (https://developers.google.com/tech-writing/one/short-sentences) | "Focus each sentence on a single idea." Turn a long sentence with "or" into a list. Cut filler: "is able to" becomes "can". | Not confirmed |
| Microsoft style, top 10 tips (https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice) | "Get to the point fast. Lead with what's most important." "Be brief. Give customers just enough information to make decisions confidently." Avoid "there is / there are". Sentence-style capitals. | Not checked |
| Diátaxis (https://diataxis.fr/) | Four kinds of documentation (tutorial, how-to, reference, explanation). Author Daniele Procida. | CC BY-SA 4.0 (repo README, `evildmp/diataxis-documentation-framework`) |
| pstack `technical-writing` (https://github.com/cursor/plugins, `pstack/skills/technical-writing/SKILL.md`, plugin 0.15.44) | Layers Diátaxis, Google style, Simplified Technical English and Global English. "Split instructions longer than about 20 words and other sentences longer than about 25." "Call each thing by one name, everywhere." "Make every 'it', 'they', and 'this' point at one obvious thing." Vague → specific: not "schema changes can cause issues" but "a column rename fails the build". | MIT (`pstack/LICENSE`, Lauren Tan) |

What a lint can check: sentence length, paragraph length, banned words, acronyms without a definition, question headings, bullets without a lead-in, word count, "etc.", footnotes. A passive-voice heuristic ("is/was/were + -ed") is noisy, so it should warn only. What needs judgement: most important first, one idea per sentence, one name per thing, whether a term needs explaining, whether the tone is plain.

---

## 5. Detail enough for agents

### 5.1 Spec-driven sources
- **GitHub Spec Kit** (https://github.com/github/spec-kit, MIT, cloned at `61d3abb`, 2026-11-19). The spec template has mandatory User Scenarios & Testing, Requirements and Success Criteria (`templates/spec-template.md`). User stories get priorities (P1, P2…) and an "Independent Test" each (lines 26-47). Requirements are `FR-001` with "MUST". Success criteria `SC-001` "must be technology-agnostic and measurable". Unknowns are marked `[NEEDS CLARIFICATION: …]`, with "Maximum 3" markers (`templates/commands/specify.md:128-132`). The spec checklist includes "Written for non-technical stakeholders" and "No [NEEDS CLARIFICATION] markers remain" (lines 163-168). `/clarify` asks at most 5 questions, only ones that change architecture, data, tasks, tests, UX, operations or compliance (`commands/clarify.md:129-134`). `/analyze` flags "vague adjectives (fast, scalable, secure, intuitive, robust) lacking measurable criteria" (`commands/analyze.md:134`). Checklists are "Unit Tests for English" (`commands/checklist.md:9`). The design note (https://github.com/github/spec-kit/blob/main/spec-driven.md) says specs say what and why, not how, and "every technical choice links back to specific requirements".
- **AWS Kiro specs** (https://kiro.dev/docs/specs/, https://kiro.dev/docs/specs/feature-specs/). Three files: `requirements.md` (user stories and acceptance criteria), `design.md`, `tasks.md`. Requirements use EARS: "WHEN [condition/event] THE SYSTEM SHALL [expected behavior]". Kiro says each requirement "can be directly translated into test cases". Bugfix specs hold current, expected and **unchanged** behaviour. The fetched pages do not say how tasks link to requirements. License of the docs: not checked; Kiro is a product, not an open repo.
- **EARS** (https://alistairmavin.com/ears/). Alistair Mavin and colleagues at Rolls-Royce, first published 2009. The paper is Mavin, Wilkinson, Harwood, Novak, RE'09, pp. 317-322, DOI 10.1109/RE.2009.9 (https://bibtex.github.io/RE-2009-MavinWHN.html). Patterns: ubiquitous ("The <system> shall <response>"), event ("When…"), state ("While…"), unwanted ("If…, then…"), optional ("Where…"), complex. The site says "© 2026 Alistair Mavin // All Rights Reserved". The pattern keywords are a notation. MIRAI should describe them in its own words and credit EARS. This is not legal advice.

### 5.2 What the coding-agent vendors say
- **Claude Code best practices** (https://code.claude.com/docs/en/best-practices; the old anthropic.com URL redirects). "Claude stops when the work looks done." "Give Claude something it can run that comes back pass or fail." Before an unattended run, ask: "Does it know what done looks like? A goal condition, a spec file, or a failing test." Say your preference between two reasonable approaches "up front", because Claude cannot read it from the code. Review "against SPEC.md, check every requirement is implemented and the listed edge cases have tests".
- **Claude prompting best practices** (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices). Treat the model as "a brilliant but new employee who lacks context". Key test: show the prompt "to a colleague with minimal context". Give the reason behind a rule. Use 3–5 examples to steer format.
- **OpenAI Codex best practices** (https://learn.chatgpt.com/guides/best-practices.md; redirected from developers.openai.com). A good prompt has Goal, Context, Constraints and "Done when: What should be true before the task is complete". "If the task is complex, ambiguous, or hard to describe well, ask Codex to plan before it starts coding."

### 5.3 What an agent needs so it does not guess
1. A written "done when" for the whole unit and each criterion (all three vendors).
2. Requirements with stable IDs and one testable statement each (Spec Kit, Kiro, EARS).
3. Failure and edge cases written as their own criteria (Spec Kit Edge Cases; Kiro analysis; EARS "If…, then…").
4. Scope limits: non-goals and behaviour that must not change (KEP, Kiro bugfix "unchanged behavior", BMAD Boundaries).
5. Constraints and preferences the code cannot show (Claude Code; Codex "Constraints").
6. No open question at handoff (Spec Kit checklist; Rust RFC in research/07 §4.2).
7. Real names: files, commands, symbols (pstack `technical-writing`; Claude Code examples).
8. Examples where a format matters (Claude prompting guide).
9. Assumptions marked as assumptions (BMAD `[ASSUMPTION: …]`, §6.1).

---

## 6. How agent frameworks handle this (scope addition)

### 6.1 BMAD-METHOD v7
Repo https://github.com/bmad-code-org/BMAD-METHOD, MIT (`LICENSE`, BMad Code LLC), cloned at `e435a22` (2026-11-12). research/02 analysed the 2026-10-16 commit. Since then, templates moved into one skill, `bmad-facilitate`, and one markdown file per document type (`docs/customize/how-document-templates-work.md`).
- **Documents:** brief, BRD, PRFAQ (analyst); PRD, PRD-light, agent-spec, opportunity, pitch, business-case, SRS and others (PM, `skills/method/bmad-agent-pm/assets/`); architecture spine; tickets (initiative, epic, story in one template, `skills/method/bmad-agent-po/assets/ticket-template.md`); decision record.
- **Template mechanics:** frontmatter `facilitation_order` lists sections, with `?` for optional ones. Comments carry `purpose`, `stance`, `inputs`, `writing` and `done when` (same doc). Optional sections use `include when:`.
- **Approver layer:** none inside the file, except the brief's executive summary. A brief is "One to two pages" (`template-brief.md:24`). Done when "Someone who reads only the executive summary can say what this is, who it is for, and why it matters now" (line 26). For humans, BMAD renders an **HTML view** from the markdown (`view: brief-view.html`, `html_view: always`).
- **Length ceilings:** PRD "about 3,000 words at program or initiative altitude, 2,000 at epic altitude, two pages for hobby and solo work"; past the ceiling, push detail down a level or split (`template-prd.md:23`).
- **Completeness for agents:** global IDs (UJ-N, FR-N, RULE-N, SM-N, OQ-N); "no traceability matrix" (`template-prd.md:23`). FR form "[Actor] can [capability] [under conditions]". Open questions carry an owner, a need-by and what they block. `[ASSUMPTION: …]` tags mark every guess in the body; before review they move to one Assumptions section (`skills/core-tools/bmad-facilitate/references/guidance-planning.md:15`). The rubric checks five things: decision-ready, earned (no theatre or padding), testable ("flag vague adjectives"), honest scope, usable downstream (`references/rubric-planning.md`). The agent-spec template is done when "nothing about scope is left for the agent to guess" (`template-agent-spec.md:23`).
- **Better than MIRAI's plan:** summary written last with an explicit "says nothing new" rule; word ceilings per altitude; assumption tags; open questions tied to what they block; a short rubric.
- **Worse:** no approver block for decisions; the HTML view is a second artefact to keep in sync; optional sections vanish instead of saying "Not applicable — reason"; "no traceability matrix" relies on the reader to follow IDs, where MIRAI lints the chain.

### 6.2 pstack
Source: https://github.com/cursor/plugins, folder `pstack/`, plugin 0.15.44 (`pstack/plugin.json`), MIT (`pstack/LICENSE`). research/03 analysed 0.15.25.
- **Documents:** none for product or design. "i don't believe in planning. the best spec is code" (research/03 §1). The `architect` skill's `rationale-template.md` from 0.15.25 is gone at 0.15.44 (GitHub returned 404).
- **What it has:** the writing standard in §4; `unslop`, a numbered catalogue of AI-writing tells (research/03 §5); a plan linter `check-plan.mjs` that checks prose rules and required headings and prints `file:line: message` (research/03 line 302); a unit brief GOAL / SCOPE / CONTEXT / ACCEPTANCE / VERIFY / TIMEBOX / FORBIDDEN / REPORT / STANDING, where "A field you cannot fill is a unit you have not scoped yet" (research/03 §6.5; not re-checked at 0.15.44). The reply rule: "Lead with what changes for the user. Give each claim its evidence or a label (measured, inferred, or guess)" (`pstack/skills/poteto-mode/SKILL.md:104`).
- **Better:** prose rules enforced by a script; claims labelled by evidence. **Worse:** no approver document at all.

### 6.3 GitHub Spec Kit
See §5.1. **Approver layer:** the whole spec is meant for "non-technical stakeholders"; all technical detail goes to `plan.md`. That is D-59's option (b), two files. **Completeness:** FR/SC IDs, P1–P3 stories with an independent test, at most 3 clarification markers, `/clarify` and `/analyze`. Tasks carry `[P]` for parallel and `[US1]` for the story they serve (`templates/tasks-template.md:16-18,87`). **Better:** cross-document consistency check with severities; hard cap on open questions; ambiguity word list. **Worse:** no decisions block; the spec has no word budget.

### 6.4 AWS Kiro
See §5.1. **Approver layer:** none; the user reviews each of the three files in turn. **Completeness:** EARS requirements; an analysis pass for conflicts and gaps; tasks run in dependency waves (https://kiro.dev/docs/specs/). **Better:** EARS gives one sentence shape per requirement; bugfix specs list unchanged behaviour. **Worse:** the fetched pages show no IDs linking tasks to requirements.

### 6.5 Agent OS (Builder Methods)
Repo https://github.com/buildermethods/agent-os, MIT (GitHub API), cloned at `e892e61` (2026-10-07), about 5.6k stars. **Documents:** `mission.md`, `roadmap.md`, `tech-stack.md` (`commands/agent-os/plan-product.md:3`); per feature `plan.md`, `shape.md` (scope, decisions, context), `standards.md`, `references.md` (`commands/agent-os/shape-spec.md:136-143,181-216`). "Keep it lightweight — This is shaping, not exhaustive documentation" (line 9). **Approver layer:** none. **Completeness:** relies on standards files and reference code; no IDs or acceptance criteria in the templates. **Better:** points the agent at real reference code. **Worse:** nothing for a verifier to check.

### 6.6 Task Master
Repo https://github.com/eyaltoledano/claude-task-master, cloned at `c0c98d3` (2026-04-23). License: **MIT with the Commons Clause** (`LICENSE`), so it may not be sold. Do not copy its text into MIRAI. **Documents:** a PRD parsed into tasks. The simple template has Overview, Core Features, User Experience, Technical Architecture, Development Roadmap, Logical Dependency Chain, Risks, Appendix (`.taskmaster/templates/example_prd.md`). The "RPG" template separates capabilities (what) from modules (how) and states "Never assume - always state what depends on what" (`example_prd_rpg.md:1-12`). Each phase has entry criteria, exit criteria and "Delivers"; each task has "depends on", acceptance criteria and a test strategy (lines 297-316). **Approver layer:** none. **Better:** explicit dependencies and phase exit criteria. **Worse:** no IDs on requirements; a 511-line template is hard for a human to approve.

### 6.7 What this means for MIRAI
- No framework I read puts an approver layer and an agent layer in one file. MIRAI's D-59 is unusual. The risk is drift between the two parts. The mitigations are the ID references, the number check and Vera's match item (§9a).
- Spec Kit is evidence for the two-file option that D-59 rejected. I do not recommend reopening it: one file means one signature and one place to look.
- BMAD is the closest match. Its "says nothing the sections do not hold" rule and its per-altitude word ceilings are worth taking, in MIRAI's own words.

---

## 7. research/07's choices, checked against both readers

| Template | For the human approver | For the agents |
|---|---|---|
| Brief (Lenny) | Good and short. Missing: appetite and no-gos (Shape Up). | `BR-n` must stay business outcomes, with no screens, fields or APIs (BMAD BRD rule). |
| PRD (Yien + HashiCorp + Atlassian) | Up to 18 parts. Without a ceiling it will be long. Add a word ceiling for the whole file (BMAD: about 2,000–3,000 words). The top part replaces Yien's "Problem alignment" as the first thing read. | Strong: FR/NFR, `AC-FR-n.m`, non-goals. Add a glossary (BMAD PRD has one) and a "change boundary" for work on an existing product (BMAD `template-prd.md:64`). Use "must", not "shall" (§9e). |
| HLD (arc42 + C4 + pilot) | About 18 sections. The top part must name the 3–5 quality goals and the ADRs that need Jet's yes. Mermaid diagrams help both readers. | Missing: one table of consistency conventions (naming, ID and date formats, error shape, logging), as in BMAD's architecture spine. Without it, parallel agents drift. |
| LLD (Google + Rust RFC + Uber) | The top part should say what changes, the risk and the rollback in plain words. | Strong. Check that its "ticket breakdown" does not duplicate the ticket set Tess writes; one of them should own the split. |
| ADR (MADR + Y-statement) | The 7-clause Y-statement is hard to read. In the top part use "We chose X over Y because Z. We accept W." Keep the Y-statement in the detail for the lint. | Strong: Confirmation names a check ID. |
| Story (existing `registry/templates/story.md`) | Already plain. "Done when" comments and "Not applicable — reason" work. | A ticket gets no top part of its own (§9e, decision 6). |

---

## 8. Sources not reached

- AR 25-50 itself; the HBR article body (paywall); the Working Backwards PR/FAQ template text; GitLab's design-document template (navigation only); Lenny's template doc (only linked; research/07 §5.4 has its sections); Google and Microsoft content licenses (not shown on the fetched text).
- The local `~/Projects/mirai-sources/` folder used by research/02 and 03 no longer exists after the laptop move. BMAD, Spec Kit, Agent OS and Task Master were cloned fresh into the session scratchpad. pstack was read through the GitHub API.

---

## 9. Recommendation for MIRAI

### 9a. The shared top part

**Where it sits.** Right after the title, before any detail. Every document type has it: brief, PRD, HLD, LLD, ADR, epic. Tickets do not (decision 6 below).

**Headings and order.** The order follows BLUF: the ask comes first.

| # | Heading | Done when (the one-line rule in the template comment) |
|---|---|---|
| 1 | `### The ask` | One sentence, at most 30 words, starts with a keyword (Approve, Decide or Note) and names what is approved and the outcome it buys. |
| 2 | `### Why` | Two to four sentences say who has the problem, what it costs them and why now. Each claim cites a source or a detail ID. |
| 3 | `### What changes` | Three to seven bullets say what a user or the system does differently. Each bullet ends with the detail IDs it summarises, e.g. `(FR-3, FR-4)`. |
| 4 | `### Decisions for you` | A numbered list. Each item is a question, two or three options, the recommendation and its main cost, and the ID it rests on (`ADR-0004`, `Q-2`). Or one line: `None — <why nothing needs your call>`. |
| 5 | `### Not in this` | Bullets of what is out of scope, each with a short reason and its `NG-n` ID. |

**Length.** One page is the target. The lint fails a top part over its type's budget and warns at 80%:
brief 400 words, PRD 600, HLD 600, LLD 500, ADR 250, epic 250. These sit inside PM-03's "one to two
pages". The budgets are my proposal, set from BMAD's "one to two pages" brief and PEP's ~200-word
abstract. Tune them after the pilot.

**Rules that keep the two parts in step.**
- The author writes the top part **last**, from the finished detail (BMAD).
- The top part says nothing the detail does not hold (BMAD). **L:** every ID in it resolves in the detail; every number in it also appears in the detail. **J:** Vera checks that the meaning matches (§4 row 5 of `09`).
- Every open `Q-n` and every ADR with status `proposed` appears under "Decisions for you". **L.**
- Every `NG-n` in the detail appears under "Not in this", and the reverse. **L.**
- The detail does not repeat the top part in its first paragraph (GOV.UK).
- The reader test (unit 34) runs on the top part alone.

**How the lint tells the two parts apart: three options.**

| Option | How | For | Against |
|---|---|---|---|
| A. One fixed H2 | `## Summary for approval` holds the five H3s above. The top part ends at the next H2. Detail sections stay H2, as today. | Plain Markdown. Renders well in GitLab and GitHub. A reader sees the boundary. No change to the existing heading levels. | The name is fixed in every template. |
| B. Comment markers | `<!-- mirai:top -->` … `<!-- mirai:detail -->` | Free headings. | Invisible when rendered. A human edit can drop a marker. |
| C. Frontmatter fields | `summary:`, `ask:`, `decisions:` in YAML | Easy to parse. | YAML is hard to read and review. Long prose in YAML breaks easily. Jet reads the page, not the header. |

**Recommendation: option A.** Use one fixed H2 with the five fixed H3s. The lint already parses headings.

### 9b. Business brief template outline

Frontmatter as in research/07 §6 rule 1, plus `track` and `appetite`. Then the top part (§9a), then:

| Section | Done when | Source |
|---|---|---|
| `## Problem` | Names who has it, what it costs them today, and the strongest evidence, with a source. An assumed problem is tagged as an assumption. | Lenny (Problem); Shape Up (Problem); Cagan Q1; BMAD brief |
| `## Who it is for` | Names the first real user or role, the situation they are in, and what they want. "Everyone" fails. | Lenny (Audience); Cagan Q2; Klement job stories; BMAD "Who it serves" |
| `## Why now` | Says what changed that makes this worth doing now, with a source. | Lenny (Why); Cagan Q6 |
| `## Success` | `SM-n` rows: metric, baseline or `UNKNOWN`, target, how measured, and one counter-metric. | Lenny (Success); Cagan Q8; BMAD PRD counter-metrics |
| `## Business requirements` | `BR-n`, each an outcome the business needs, with a source. None names a screen, a field or an API. | MIRAI (D chain); BMAD BRD rule |
| `## Appetite and track` | States the time Jet is willing to spend and the proposed track (`quick`, `standard`, `full`) with a one-line reason. | Shape Up (Appetite); MIRAI track rule (`01` §2) |
| `## No-gos` | `NG-n` bullets, each with a reason. | Shape Up (No-gos); Google (non-scope); KEP (Non-Goals) |
| `## Rabbit holes` | `R-n` bullets: each known risk or hard part, with its patch or "becomes a no-go". `Not applicable — reason` allowed. | Shape Up (Rabbit holes); Cagan Q9 |
| `## Hard questions` | Optional. The two or three questions a sceptic would ask, each answered. Required when the work faces external customers. | Amazon PR/FAQ |
| `## Sources` | Every source cited above, with a link or path. | MIRAI (`01` §2) |
| `## Open questions` | `Q-n` with an owner and what it blocks. Empty at `approved`. | Atlassian and Rust RFC (research/07); BMAD OQ-N |

Left out on purpose: Lenny's How and When (they belong to the PRD and the plan); market size and
go-to-market (Cagan Q3, Q7; only for a new product); the press-release form (overhead for internal
work). Write all wording ourselves: Lenny, Shape Up, SVPG and Working Backwards give no license.

### 9c. Writing rules for humans

**Lint-checkable (L)**, applied to the top part; the detail gets rules 2, 3 and 5 only:
1. Word budget per type (§9a).
2. Sentences over 25 words fail; over 20 warn (GOV.UK; pstack).
3. Banned words, from one list in the lint and not in the prompt (`07` unit 34): GOV.UK's words to avoid, the vague adjectives without a number (fast, scalable, secure, robust, intuitive: Spec Kit), and "etc.".
4. Paragraphs of at most 5 sentences (GOV.UK).
5. An acronym not in the glossary or the allowlist must be spelled out at first use (GOV.UK).
6. Lists have a lead-in line; no question headings; no footnotes (GOV.UK).

A passive-voice check ("is/was/were/been + -ed") warns only, because it is noisy.

**Judgement (J)**, for Vera and the reader test:
1. The most important thing comes first, in each section and each sentence (GOV.UK; Microsoft).
2. One idea per sentence (Google; pstack).
3. Say who does what (digital.gov; GOV.UK).
4. One name per thing, everywhere, matching the glossary (pstack).
5. Specific, not general: "a column rename fails the build", not "schema changes can cause issues" (pstack).
6. Plain words a colleague would say aloud; explain a term the first time (GOV.UK; pstack).

Unit 34 wants three to five before/after examples instead of long rule lists. The Microsoft and Google pages above are good models for their form. Write MIRAI's own examples from pilot documents.

### 9d. What the detail part must always carry

1. **Frontmatter with links:** `id`, `type`, `upstream`, `status` (research/07 §6).
2. **Stable IDs** on everything another document cites: BR, FR, NFR, AC, NG, R, Q, ADR, SM.
3. **One testable statement per requirement.** FRs in EARS shape ("When <trigger>, the system must <response>"); ACs in Given/When/Then, as `story.md` does. No vague adjective without a number.
4. **Failure and edge cases as their own criteria**, not folded into the happy path (Spec Kit; EARS "If…, then…").
5. **Scope limits:** non-goals with reasons and, for changes to existing behaviour, what must not change (KEP; Kiro bugfix; BMAD Boundaries).
6. **A "done when" and a check to run** for each unit of work: a test, a command or a named review item (Claude Code; Codex; MADR Confirmation).
7. **Assumptions marked as assumptions.** `[ASSUMPTION: …]` while drafting; moved into an Assumptions list before `in-review` (BMAD).
8. **Zero open questions at `approved`.** At most three `Q-n` while in review (Spec Kit's limit of 3).

Real names (paths, commands, symbols) belong in the LLD and tickets, not in the brief or PRD (Spec Kit "what and why"; BMAD agent-spec).

### 9e. Open decisions for Jet

| # | Question | Options | Recommendation |
|---|---|---|---|
| 1 | What is the top part called? | `## Summary for approval` / `## For you` / `## Approver summary` | `## Summary for approval`. "For you" breaks when teammates approve (D-62). |
| 2 | One word budget or one per type? | One cap (600) / per type (§9a) | Per type, fail at the cap, warn at 80%. Review after the pilot. |
| 3 | Requirement keyword | "shall" (EARS original) / "must" (GOV.UK, Spec Kit) | "must". It is plain and agents read it the same way. |
| 4 | EARS for FR statements? | EARS shape / free "[Actor] can …" (BMAD) | EARS shape for FRs; ACs stay Given/When/Then. |
| 5 | Appetite in the brief? | Yes / no | Yes. It is the one number only you can set, and it sizes the track. |
| 6 | Do tickets get a top part? | Yes / no | No. A story is already short and plain. The epic's top part covers the set. |
| 7 | Number check in the lint | Fail / warn / skip | Warn for the pilot, fail after it if false alarms are rare. |
| 8 | Who writes the top part? | The author agent, last / a separate summary agent | The author, last, then the reader test. A second agent costs a run and adds a third voice. |
| 9 | Hard questions section | Always / optional / never | Optional; required for work that faces external customers. |

### 9f. What the scope addition (frameworks and guides) changed

- **Added** the "write it last, say nothing new" rule and the number check (BMAD).
- **Added** per-type word budgets and a ceiling for the whole PRD (BMAD's altitude ceilings).
- **Added** assumption tags and the cap of three open questions in review (BMAD; Spec Kit).
- **Added** Spec Kit's vague-adjective list to the banned words, and its "unit tests for English" idea as the frame for Vera's checklist items.
- **Added** the consistency-conventions table to the HLD (BMAD spine) and the dependency and exit-criteria idea for epics (Task Master; text not copied, Commons Clause).
- **Confirmed** D-59: no framework does two layers in one file. Spec Kit's split by file is the alternative, and one file still wins on one signature and one place to read.
