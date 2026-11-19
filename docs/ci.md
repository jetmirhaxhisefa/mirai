# MIRAI's CI

Unit 30a (D-63). MIRAI's repo runs its unit tests on GitHub, each on Node 22 (MIRAI's minimum) and Node 24:

- **Ubuntu:** on every pull request and every push to `main`. A PR merges only when both Ubuntu
  jobs are green. They take about 2 minutes.
- **macOS:** after a merge to `main` only, and it doesn't block anything. GitHub's Macs take
  about 30 minutes and are sometimes not available. The build runner on your Mac is the macOS
  gate.

As the repo's admin, you can merge past a red or stuck check. The workflow is
`.github/workflows/ci.yml`:

- its actions are pinned to commit SHAs;
- its permissions are read-only;
- it has no secrets;
- it uses only the `pull_request` trigger.

## What CI proves, and what it doesn't

GitHub's machines have no Docker on macOS, no Claude Code, and none of your keys. Ubuntu has no
`sandbox-exec`. So CI runs every test that needs none of these.

**The build runner's `tests` job on your Mac stays the full check** (`docs/build-runner.md`), and
each unit's done-when still names it. CI is the fast gate, and the place a Linux slip shows up
first.

## Tests that need something

A test that needs Docker, the cage, a real Claude Code or macOS says so:

```js
import { needsTest } from '../helpers/needs.js';

const dockerTest = needsTest('docker', 'runs the sample app\'s image');
dockerTest('T5: …', async () => { … });
```

- **Where the thing is missing,** the test is skipped with that reason. The skip is detected
  (`docker info`, `/usr/bin/sandbox-exec`, `claude --version`, the system), never read from an
  environment variable.
- **Each CI job ends with "left out, and why":** the skipped tests, grouped by need. On your Mac
  with Docker running, the list is empty.
- **To print it locally:**

  ```bash
  MIRAI_LEFT_OUT=/tmp/left-out.jsonl npm test; node test/helpers/left-out.js /tmp/left-out.jsonl
  ```

The needs are `docker`, `cage`, `claude` and `macos`. Use `macos` only for a test of code that
P01 (`design/11`) will move into the operating-system module.

## The operating-system module

`src/os/index.js` answers everything that depends on the system: where MIRAI's home is, which
sandbox runs the cage, and how paths are compared. On macOS it gives today's answers. On any
other system it says "not supported yet", and never guesses.

**New code asks the module.** `test/os/guard.test.js` fails on a new system check outside
`src/os/`: `process.platform`, `darwin`, `Library/Application Support`, `sandbox-exec`, `/private/tmp` or
`/Users/`. The checks from before 30a are listed there with their count. P01 empties the list, and
the list only shrinks.
