---
id: sample-business
type: business
template: business@v1
owner: product-owner
updated: "2026-11-25"
---
# Business context: the personal task list

## What the product does

- Each person keeps their own list of tasks. They add a task, see their list and mark it done (S-1).

## Who it's for

- Users: people who sign in to keep their own task list (S-1).
- Customers: the same people; there are no teams and no shared lists (S-1).

## Business model and goals

- Free while it finds its first 100 weekly users. A paid plan comes after, priced later (S-1).
- Goal: 100 people use the app every week by the end of March 2027 (S-1).

## What this repo is responsible for

- The whole product: the web app and its API. The app sends no email and no other message (S-1).

## Business rules

- Only the person who added a task sees it, changes it or marks it done. There are no shared tasks and no public links (S-1).
- A task's title is required and holds at most 120 characters (S-1).

## Glossary

- Task: one item on a person's list, with a title and a done mark (S-1).
- Owner: the person who added the task (S-1).

## Constraints

- Hosted in the EU. Personal data stays there, under GDPR (S-1).

## Stakeholders

- The product owner decides what's built and approves this file (S-1).

## Sources

| ID | Source | Where | Date |
|---|---|---|---|
| S-1 | The product owner, for the probes | you said | 2026-11-25 |
