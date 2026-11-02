---
unit: "19c"
date: 2026-11-02
claude_code: 2.1.316
result: 428 tests; G30 settled end to end (a real session's start_agent, a real agent, the worker outliving the session); the sessions red team GREEN, 166 runs in 8 min 47 s, its first complete green
---

# Unit 19c — Test results

## No model

- `d-start-chain`: MIRAI's real server started the real worker from the trust root through `env -i`; the token came down the pipe; the request was claimed once; the red-team gate refused the launch, as a terminal launch is refused; `agent_status` brought the refusal back.

## R1 and R2 (G30), 3 Haiku runs

On a sample-app clone, with a probe home. **The red-team gate was satisfied by a stand-in green written by the probe, signed with its own key, for the clone's exact key, computed the way the worker computes it.** Everything else was the real path.

- A real Claude Code session (temporary config, MIRAI's server registered as `install` does) saw `mirai: connected`, called `start_agent`, got a request id, and exited.
- **After the session had ended,** the worker launched a real agent (Haiku, reviewer, light step), which replied PONG; the status read `done`, outcome `ok`.
- **My probe's first try failed:** it overwrote the folder's entry in the temporary Claude Code config when marking it trusted, which removed the registration. Fixed, re-run.

Not shown: that your terminal's red-team key and the worker's match on your machine beyond the ssh part (unit-tested); a model other than Haiku.

## R3: the permission prompt

Yours, after approval: it needs 19c's code in the sample app.

## The sessions red team

**GREEN, 166 runs in 8 min 47 s on 4 workers**: 53 promises hold, 27 controls behaved, 24 known limits. The new cases: `d-start-hostile` (forged arguments, a prompt holding the token, a request id from elsewhere: all refused), `d-start-chain`, `d-launch-token`. The first complete green of this suite, in a probe home; yours comes from your own `mirai redteam run --sessions`.
