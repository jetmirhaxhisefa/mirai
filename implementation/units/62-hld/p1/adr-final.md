---
id: ADR-0001
type: adr
template: adr@v1
status: proposed
upstream: [own-due-dates-prd]
date: "2026-11-26"
decision_makers: [Jet]
confidence: medium
gate: [external, first-of-kind]
initiative: due-dates
components: [frontend/src/api.ts, backend/app/Http/Requests]
owner: mirai-architect
created: "2026-11-26"
---
# Judge "today" in the time zone the browser sends with each write

PRD: [Due dates on my own tasks](../mirai/due-dates/prd.md)

## Summary

In the context of due dates judged by the owner's own day, facing an app that stores no time zone per user, we decided for an `X-Time-Zone` header on every write to achieve the owner's day without a new column, accepting a day's error near midnight when a write has no header or an unknown zone.

## Context and problem

A date before the owner's today is refused (FR-4), and a task is late from the day after its date in the owner's own time zone (FR-3, A-1). The users table has no time zone, and the server runs in UTC. The late mark is drawn in the browser from its own zone, so only the server's check on a write needs the zone. This is the first value the frontend sends with every write.

## Options considered

### A time zone header on every write

- Good, because the browser knows its own zone, and nothing new is stored.
- Bad, because a request without the header, or with an unknown zone, needs a fallback.

### A time zone column on users, set once

- Good, because the zone is stored and the server needs no header.
- Bad, because it needs a settings screen and a migration, and a user who travels sees the wrong day.

### Judge every date in UTC on the server

- Good, because it needs nothing new.
- Bad, because an owner east or west of UTC sees a date refused or marked late on the wrong day, which breaks A-1.

## Decision

We chose the header, because it gives the owner's own day with no new column or screen.

## Consequences

- Good, because the server's check (FR-4) and the browser's late mark (FR-3) use the same zone, the computer's.
- Bad, because a write without the header, or with a zone the server doesn't know, falls back to UTC, and is a day off near midnight.
- Neutral, because the header is sent by `frontend/src/api.ts` only, so no other client is affected.

## Confirmation

test: ADR-0001
review: each new write in `frontend/src/api.ts` sends `X-Time-Zone`, and the server reads the owner's today through it, or UTC when it is missing or unknown.
