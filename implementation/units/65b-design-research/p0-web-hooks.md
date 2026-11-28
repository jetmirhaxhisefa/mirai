# P0: what Claude Code's hooks see of WebSearch and WebFetch (2026-11-28, Claude Code 2.1.332)

Before building the fetch gate: a real `claude -p` (haiku) with a PreToolUse and a PostToolUse
hook on `WebSearch|WebFetch`, each writing its input to a file.

1. **Without `--tools`** the session has no `WebFetch` of its own: it reaches one through a
   `web-fetch` sub-agent (the `Agent` tool). The hook still fires inside the sub-agent
   (`agent_type: web-fetch`). A hook that says nothing leaves the fetch refused under `dontAsk`.
2. **With `--tools WebSearch,WebFetch`** (MIRAI's launches pass `--tools`): both are direct, no
   sub-agent. The PreToolUse hook's `permissionDecision: "allow"` lets the fetch through.
3. **PostToolUse on WebSearch:** `tool_response = { query, results: [{ tool_use_id, content: [{ title, url }, …] }, …] }`:
   every result URL, structured.
4. **PostToolUse on WebFetch:** `tool_response = { bytes, code, codeText, result, durationMs, url }`.
   `result` is the text WebFetch returned to the agent (its fetch model's answer to the agent's
   prompt), not the raw page. That is the evidence a quote is checked against (decision 3.4).

So the gate is buildable as specified: record the URLs after each search, allow a fetch only of a
recorded URL, keep each fetch's returned text.
