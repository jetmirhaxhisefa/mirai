---
unit: "20"
date: 2026-11-02
claude_code: 2.1.316
result: 439 tests; R1 with 3 Haiku launches; no full red team (no change to the cage)
---

# Unit 20 — Test results

## R1: the usage reading (3 one-turn Haiku launches, sample-app clone, gate stubbed)

| Launch | Where the event sits | Windows | Share |
|---|---|---|---|
| 1 | 3rd of 4 events: `system assistant rate_limit_event result` | `seven_day` 0.12, allowed | unknown: no reading before it in the probe home |
| 2 | the same | the same | 0, measured |
| 3 | the same | the same | 0, measured |

So:
- one reading per stream, **after the first answer, not at the end**;
- only the weekly window;
- hundredths, so a short run reads 0.

**What follows:** a launch's share runs from the last reading before it to its first answer. Its tail goes to the next launch. Over a night the shares still add up to the change in readings. Not known yet: whether a long run gets more than one reading.

## Tests

The loop guard's tests (11), with seeded rounds, readings and a real signed grant:
- rounds and refunds;
- L2, L4 and L5;
- counters that only go up and refuse when broken;
- the usage check's caps, unknown and out-of-date readings;
- limits;
- the breaker;
- parking;
- a launch's measured share and usage limit through `runAgent`.

**Not shown:**
- a real usage limit (it can't be hit on purpose without using up your week);
- a long run's readings;
- the loops themselves, which come in units 21 to 27.
