---
id: product-business
type: business
template: business@v1
owner: product-owner
updated: "2026-01-01"
---
<!--
The business context template (MIRAI, unit 36). It lives at .mirai/context/business.md. Every
agent run loads it, so it says what an agent needs to judge whether a feature makes sense, and no
more. Replace every line below; keep the headings. mirai lint flags any line or the id left word
for word from this template.
- About two pages: the lint warns past 800 words and fails past 1,000. The Sources table isn't
  counted. Summarize a long source in a bullet and keep its link.
- Every claim is a bullet that ends with its source ID: (S-1), or (S-1, S-3). Each ID is one row
  of the Sources table: what it is, where it is (a link, a file path in backticks from the repo's
  top folder, or "you said"), and the date it was read or said.
- Plain sentences of 20 words or fewer; the answer first; real names, not "the system". Spell out
  an acronym the first time.
- You approve the whole file (mirai approve --file .mirai/context/business.md). A change to it
  needs a new approval.
-->
# Business context: the product's name

## What the product does

<!-- done when: two to four bullets say what a person can do with the product, in their words -->
- What a person does with the product, and what they get from it (S-1).

## Who it's for

<!-- done when: the users, the customers and who pays are each named; a workspace says which of them this repo serves -->
- Users: the people who use the product day to day (S-1).
- Customers: the people or companies who choose it (S-2).
- Who pays: who pays for it, and for what (S-2).

## Business model and goals

<!-- done when: how the product makes money, and each goal with a number and a date; the measures you watch -->
- Model: how the product makes money, or why it doesn't yet (S-2).
- Goal: the outcome the business wants, with a number and a date (S-2).
- Measures: the numbers that show the goal is reached (S-2).

## What this repo is responsible for

<!-- done when: one bullet says what this repo holds, one what it doesn't; in a workspace, one line per repo -->
- This repo holds the parts of the product named here (S-1).
- Not this repo: the parts another repo or tool handles (S-2).

## Business rules

<!-- done when: each rule a feature must not break, with its numbers; a rule the code holds cites the file -->
- A rule the business holds to, with its numbers (S-3).

## Glossary

<!-- done when: each word the business uses in its own way, defined in one sentence; the words the code uses are the same -->
- Term: what the business means by it, in one sentence (S-1).

## Constraints

<!-- done when: the laws, markets, languages and limits a feature must respect -->
- A law, a market, a language or another limit every feature must respect (S-2).

## Stakeholders

<!-- done when: who decides and who must be told, by role; or Not applicable — <reason> -->
- The person who decides what's built, and approves this file (S-2).

## Sources

<!-- done when: each ID cited above is one row; Where is a link, a file in backticks or "you said"; Date is when it was read or said -->
| ID | Source | Where | Date |
|---|---|---|---|
| S-1 | What the source is | `README.md` | 2026-01-01 |
| S-2 | The owner, in setup's interview | you said | 2026-01-01 |
| S-3 | A page that holds the rules | https://example.com/rules | 2026-01-01 |
