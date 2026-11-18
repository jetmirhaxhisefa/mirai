---
status: draft
version: 1
---

# 20 — Brainstorming (stage 6)

Decision PM-46 (2026-11-18). It was on the original Later list ("market research,
brainstorming and other discovery work", `00`) and was left out of `09` version 2 by mistake.

## 1. The problem

MIRAI's flow starts when you bring a feature request: Nora interviews you and writes a brief.
Before that there is often a step with no request yet. You have a problem, a vague idea or a
goal, and you want to explore options before choosing one. Today that happens outside MIRAI.

## 2. The design

- **A skill, `mirai-brainstorm`, run in your session** (`/mirai brainstorm`). It is
  interactive, so it never runs headless or at night, in line with "no documents drafted at
  night" (`09` §6).
- **Input:** a problem, an idea or a goal, in your words.
- **Three stances**, taken from BMAD's skill (`research/02` §3.8), chosen at the start:
  - **facilitate:** it asks and you generate;
  - **partner:** both of you generate;
  - **ideate for you:** it proposes options and you react.
- **Diverge, then converge.** It first widens (many options, no judging), then narrows with
  one method you pick (for example impact against effort, or MoSCoW).
- **A small set of methods.** BMAD has 108. MIRAI vets them first (`research/06` gate) and keeps
  a short curated list, about ten.
- **Context it reads:** `business.md`, the list of existing PRDs, and the change records when
  record search exists (`15` P23). It reads nothing outside the project. Agents have no network
  (G16), so market research isn't part of this unit.
- **Output: a brainstorm record**, a draft document in the project's docs location. It holds
  the ideas, how they were grouped, the method used to narrow them, and **one to three
  candidate briefs**, each with its reason.
- **Handover to Nora:** you pick a candidate and start the normal flow from it
  (`/mirai-new --from <brainstorm>`, proposed). Nora still interviews you and writes the real
  brief. The brainstorm record is input to her, not a brief.
- **No gate.** The record is never approved and never creates tickets. It stays a draft you
  can come back to.
- **A budget per session**, shown before it starts (`09` §2.3, D-68).

## 3. Left for its short interview

The plan's process (`09` §8) starts every feature with a short interview. For this one:

- Who uses it: you only, or teammates too.
- Whether the record should live in the repo or only in your store.
- Whether market research is wanted later, which would need a reviewed way for agents to read
  the web.
- Which methods make the short list.

## 4. Unit

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| P42 | **`mirai-brainstorm`:** the skill with its three stances, diverge then converge, the vetted short list of methods, the brainstorm record as a document type, the handover to Nora's intake, the session budget; BMAD's skill vetted first | Review, MVP units 31, 34, 35, 41, 44 | Exploration before a request exists | In a session, a seeded problem ends in a record with grouped ideas, the method used and at least one candidate brief with its reason; starting `/mirai-new` from that record hands it to Nora, who still interviews before writing the brief; the record lints clean as its own document type; nothing is approved or ticketed; it can't be started headless |
