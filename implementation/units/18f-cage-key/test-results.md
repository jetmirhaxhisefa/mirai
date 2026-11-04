---
unit: "18f"
date: 2026-11-04
result: 476 tests; the last full run 475/476, its one failure (a source-hygiene test tripping on a comment in cage.js) then fixed and both affected test files passing (30/30); no model run
---

# Unit 18f — Test results

## Probes

**None with a model.** The new key takes effect at your next red-team run, after the sample app is refreshed with this unit. Unit 21c's refresh will be the first test of a workflow-only change keeping the result green.

## Tests (`npm test`, no model)

New, in `test/redteam/redteam.test.js`:
- **T1: the computed cage.**
  - It's computed on the real MIRAI copy (238 files; 140 in the cage). It holds:
    - the roots;
    - the files the reviews found them importing: the policy parser, the lock helpers, the journal, the lint tool, the red-team command, the error and text helpers;
    - `package.json` and the adapter and role data.
  - It leaves out `build.js`, `plan.js`, `commit.js`, the CLI's `build` command, the loop guard, Kai's prompt and `bin/mirai.js`.
  - Every relative import from a cage file lands in the cage, apart from the one allowed edge.
  - The import parser reads `from '…'`, `import '…'` and `import('…')`.
- **T2: the key**, from a trust root on disk:
  - workflow changes keep the key;
  - changing a file the cage imports changes it, and so does changing a root;
  - a new import from the cage to a workflow file changes it, by pulling the file in;
  - the whole-copy hash changes either way.
- **T3: `status`.** After a recorded green result, with a different stored whole-copy hash, it says "MIRAI changed since this result, but not the cage", and exits 0.

**After the re-review:** T1 also covers:
- the multi-line import, `export * from`, `export {…} from` and `new URL(…, import.meta.url)` forms;
- the files cage code runs by path (the MCP server, the worker, the echo server) and Kai's definition file, all in the cage;
- the fail-closed cases (an unreadable file, a computed import, a runtime require, a path to nothing) giving no cage;
- comments and URL parsing not counting.

T2 checks that an unknowable cage hashes the whole copy.

## Not proven

- **Imports built at runtime** can't be followed; they make the cage unknowable, so the whole copy is hashed (fails closed). A file read by a path built in some way the scan doesn't know (not `new URL`, not an import) would still be missed; the re-review found none in the cage today.
- **Code outside the cage can call into it with other arguments** (the commands that start agents pass options to the launch). That's said in the docs, and the gate stays in the cage.
- **A real workflow-only refresh keeping a real result green:** shown at unit 21c's refresh.
