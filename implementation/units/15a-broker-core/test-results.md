---
unit: "15a"
name: broker-core
date: 2026-10-28
node: v22.23.2
claude-code: 2.1.311
docker: Docker Desktop 29.6.2 (only for re-running 14d's direct probes)
macos: 26.7
result: 278 / 278 pass after the review fixes (earlier units' 268 + unit 15a's 10); 14 direct broker probes and 14d's 19 direct run_tests probes on Docker, before and again after the review fixes; 4 Haiku probes on the final pre-review code (10 Haiku runs in all, settling that --restricted confines the file tools and that --add-dir opens writes); nothing left behind
---

# Unit 15a — Test results

## `npm test`

New tests, with no Docker and no model:

```
15a T1: tools as data: tools/list comes from the table and the policy; a tool not enabled is unknown
15a T2: the shared checks: extra keys and __proto__ refused, a stopped server refuses every tool, the trust root on every call
15a T3: log_event: the types, the fields per type, the journal line (by agent, the launch, the policy's item), the caps, no git
15a T4: log_event is answered while a test runs; a second test call is still busy
15a T5: the journal: by agent for the log types only, always with its launch; older lines still read
15a T6: policy 2: its hash, its shape, the caps; a policy 1 is refused with a clear message
15a T9: the broker probes stay canary-only and local, and the model is always Haiku
15a T7: every launch gets MIRAI's server: log_event's policy names the store and the item; Claude Code's way of starting it writes the journal
15a T8: the input folder: names, counts and sizes checked first; read-only files in a read-only folder; readable by this launch only; removed after
```

T1–T6 and T9 are in `test/mcp/broker.test.js`. T7 and T8 are in `test/launch/strict.test.js`,
because they need its installed fixture. T7 starts `bin/mcp.js` exactly as `mcp.json` says
(`/usr/bin/env -i`, `env: {}`), calls `log_event` over the pipe and reads the line back from
the journal. T10 (stack-neutral) is 14c's T13, which now also scans `src/mcp/tools/`.

**The review fixes** (review.md) are covered:
- **broker T3:**
  - the cap per launch: a fresh server on the same launch is still `log-full`;
  - refused and busy calls don't count;
  - the token and secret shapes are refused;
  - control, bidi, invisible-only and lone-surrogate text is refused;
  - a busy journal lock is answered in under 5 s (another process holds it);
  - the checkout isn't a repo, so any git call would have failed;
- **broker T1 and T6:** `contexts`, `kind`, `launch_dir`, the secret shapes;
- **strict 15a T8:** instruction-file input names, a non-list `additional_directories`, a bad
  `mcp` field;
- **a new sign test:** a version-2 signed line still verifies, and relabelled as version 3 it
  doesn't.

Three were checked by mutation, each failing T3 with its check removed:
- the per-launch cap;
- the secret refusal;
- the text rule.

The stricter b2 check (six refusals of six) was checked against the saved runs: 6/6 on the final
run, 5/6 on the run with the hole.

**Existing tests changed by this unit:**
- **14d's server tests:** their policy is version 2 (the tools under `tools`), and the bad-shape
  list uses the new form. All eight passed unchanged after the refactor, before any of them was
  edited for policy 2.
- **strict:**
  - T1: the snapshot format is 5;
  - T5/T6: every launch allows `mcp__mirai__log_event`;
  - T7: the init events have MIRAI's server connected;
  - T8: `sandbox show` lists `log_event` and "no test tools".
- **14d T8 and T8b:**
  - the template's `mcp` field;
  - a launch without tests still gets the server, with `log_event` only;
  - a template with no tools at all gets no server.
- **Version pins:** journal version 3 in 06's T10b (the signature context) and in 05a's T6.
- **14c T13:** scans `src/mcp/tools/` too, and only `.js` files.
- **14c T2's format pin:** 5.
- **`test/probes/run-tests-probes.js`:** d2 expects `log_event` in the tool list.

An earlier full run (before the `--add-dir` changes) had one failure: lint T12's 1-second timing
check took 1,034 ms at a load average of about 40. It passed alone. Nothing in 15a touches it.

```
# tests 278
# pass 278
# fail 0
# cancelled 0
```

## Direct probes (no model)

`node test/probes/broker-probes.js --only direct`. The fixture is a git repo under `~` with
MIRAI installed and no tests. The server is started from a real launch plan.

| Probe | Result |
|---|---|
| d1-tools | pass: `log_event(type, message, template, section)` only, the enum `note, template_gap` |
| d2 (8 cases) | pass, refused as `bad-arguments`: `approval`, `status_written`, an `item` field, a `by` field, a blank message, 4,001 characters, `template` on a note, `template_gap` without `section` |
| d2-no-tests | pass: `run_tests` is an unknown tool (-32602) |
| d2-nothing-written | pass: 0 agent lines after the refusals |
| d3-written | pass: a note and a template gap, `by: "agent"`, the launch id, the item `PROBE-1`, journal version 3 |
| d4-cap | pass: the 50th line written, the 51st `log-full`, 50 lines |
| d5-stdin-closed | pass: exit 0 |

All 14 passed on the first build and again on the final tree.

**14d's direct probes, on Docker Desktop:** `node test/probes/run-tests-probes.js --only direct`
gave 19/19 on the table-driven server, with nothing left in Docker. d2 now lists `run_tests`,
`run_check` and `log_event`.

## Haiku probes (your OK, through MIRAI's own launch)

`node test/probes/broker-probes.js --yes --only haiku`. There were 10 short runs in all: the 3
the spec planned, then 2 and 2 to settle what b2 found, then the final 4 below.

**Final run, on the code as it is now:**

| Probe | Result |
|---|---|
| b1-log | pass. `checkInit` ok, with `mirai` connected (`source: "dynamic"`): **Claude Code started the server through `/usr/bin/env -i` itself, which closes 14d's open gap.** One journal line `by: "agent"` with the launch id; the reply named its `seq` |
| b2-input | pass. `checkInit` ok, with exactly the input folder as an extra folder. Read returned the canary, which was only in the file, never in the prompt. Then: Write and Edit were "denied by your permission settings"; `echo >>`, `chmod 600` and `rm -f` from Bash got "Operation not permitted"; a new file was refused. The file was unchanged, still mode 0400 |
| b2c-bash | pass: `cat` from sandboxed Bash read the canary |
| b3-cli | pass. `mirai log note …` was denied by the rule. `node <trust>/…/bin/mirai.js log note …` ran but said "MIRAI isn't set up for this repo", since the sandbox hides the MIRAI home. The journal was unchanged |

**How b2 got there** (the spec's design didn't hold; see the spec's changes, item 1):
1. **The first b2 passed, but wrongly.** The canary was also in the prompt (the Edit step), so
   Haiku could quote it without reading. The probe now keeps it only in the file. Re-run, the
   Read was refused: "…is outside <checkout>; --restricted confines the file tools to the
   working directory." Every write was refused.
2. **With `--add-dir` on the folder:** Read worked and nothing else loaded. **But `chmod 600`
   from Bash succeeded**, because `--add-dir` opens the folder to sandboxed writes. Only the
   file modes stopped `echo >>` and `rm`. The Bash read failed too, but only because the probe
   didn't quote a path with a space in it.
3. **With the folder write-denied** (the sandbox and Edit), and the probe's paths quoted:
   everything above was refused, and Read and `cat` both worked.
4. **Then the launch itself** adds `--add-dir` and the deny, and checks the extra folder in the
   init event. The final run above is that code.

**After the review fixes** the Haiku probes weren't re-run. The fixes changed `log_event`'s
checks and the policy's fields, which the direct probes and T7 cover; T7 starts the server as
`mcp.json` says. The direct probes were re-run on the fixes: broker 14/14, run_tests 19/19 on
Docker, nothing left.

**Afterwards:** every probe folder was removed (the reports are kept in this session's
scratchpad), and no `/private/tmp/mirai-*` scratch folders were left.
