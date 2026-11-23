---
id: sample-app-business
type: business
template: business@v1
owner: product-owner
updated: "2026-11-20"
---
# Business context: the task list

## What the product does

- People log in and keep a list of their own tasks. They add a task and tick it off when it's done (S-1).
- Each person sees only their own tasks. Nobody can read or complete another person's task (S-1).

## Who it's for

- Users: people on small teams who track their own work in a simple list (S-2).
- Customers: the team leads, who set the app up for their team (S-2).
- Who pays: nobody yet. The app is free while it finds its first 20 teams (S-2).

## Business model and goals

- Model: free during the trial. A paid plan per team comes after it, priced later (S-2).
- Goal: 20 teams use the app every week by the end of March 2027 (S-2).
- Measures: weekly active users, and tasks completed per user each week (S-2).

## What this repo is responsible for

- This repo holds the whole product: the web app in `frontend/`, the API in `backend/` and the browser tests in `e2e/` (S-1).
- Not this repo: sign-up, billing and email. The product has none of them yet (S-2).

## Business rules

- A task needs a title of 1 to 120 characters (S-3).
- A new task starts not done. Once it's done, it can't be undone (S-3, S-4).
- Only the person who owns a task can see it or mark it done (S-1, S-5).
- A login allows at most 6 tries a minute (S-6).

## Glossary

- Task: one piece of work a person wants to remember, with a title and a done mark (S-3).
- Done: the task is finished. The list shows it ticked, and the box can't be changed again (S-4).
- Demo user: the account seeded for trying the app, `demo@example.test` (S-1).

## Constraints

- English only, for now (S-2).
- Hosted in the EU. Personal data stays there, under GDPR (S-2).
- People log in with the app's own account (S-1). There's no single sign-on (S-2).

## Stakeholders

- The product owner decides what's built and approves this file (S-2).

## Sources

| ID | Source | Where | Date |
|---|---|---|---|
| S-1 | The app's README | `README.md` | 2026-11-20 |
| S-2 | The product owner, in setup's interview | you said | 2026-11-20 |
| S-3 | The task model | `backend/app/Models/Task.php` | 2026-11-20 |
| S-4 | The task list screen | `frontend/src/components/TaskList.tsx` | 2026-11-20 |
| S-5 | The task policy | `backend/app/Policies/TaskPolicy.php` | 2026-11-20 |
| S-6 | The API's routes | `backend/routes/api.php` | 2026-11-20 |
