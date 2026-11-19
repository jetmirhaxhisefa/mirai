# Unit 32: test results (2026-11-20)

## Tests

- **`test/documents/prd.test.js`:**
  - T1: the template, left as it is, fails as leftover text only. It holds every section of the
    type in order, and as a lite or a full PRD nothing else fails. The example lints clean with
    its brief, with no warning; so does its full version;
  - T2: requirements. An FR with no BR, an FR with no AC, an AC with no Then, a missing Failures
    group, an empty Unchanged behaviour group (and `None.` without a reason), a gap in the FR
    numbers, `AC-FR-3.2` with no `AC-FR-3.1`, and an AC whose FR doesn't exist each fail, naming
    the ID and the fix. "Shall" fails. A Capabilities FR written as "When …" only warns;
  - T3: an NFR with neither an `AC-NFR` nor a `Verified by:` line fails; a `Verified by:` line
    with no method fails; an end-to-end test passes;
  - T4: across the brief. A BR no FR or NFR serves, a cited `BR-9` the brief doesn't define, a
    redefined `NG-2`, a first new no-go `NG-1` (and a gap: `NG-5` after `NG-3`), a missing
    `Brief:` line, a linked brief that `upstream` doesn't name, and a brief NG missing from "Not
    in this" each fail. A `Brief:` link to a missing file fails through `mirai lint`;
  - T5: length. 1,700 words warns; 2,100 fails with the split message. With `length_exception`
    it fails until "Decisions for you" asks, then only warns. The exception under the cap fails.
    `limits.prd_lite_words = 2500` moves the cap. The config check refuses `999999` and a summary
    budget of 50, and refuses `docs.limits` in a personal file;
  - T6: `variant: full` with no Rollout fails; a lite PRD with Risks passes; `standard` with
    `full` warns; a changed ID-prefix block fails; a missing glossary, or one with no "Terms",
    fails;
  - T7: `mirai approve <prd-id> --file`, through the CLI with a signed key:
    - the brief's open question refuses the pair, both files' problems listed, nothing written;
    - an `[ASSUMPTION]` tag in the body refuses it;
    - one decision writes two signed lines, `kind: brief` and `kind: prd`, each on its own file's
      hash;
    - a changed brief is stale, and the PRD stays approved;
    - on `full`, the PRD is refused while the brief isn't approved as it is now; after the brief's
      own approval, one `kind: prd` line is written;
  - T8: `mirai show due-dates` lists both documents with type, id, state ("not approved", then
    "approved" and "changed since approval") and full path, and writes nothing. A ticket of the
    same name asks for `--docs`; `--docs` and `--json` choose. An unknown name says what was
    looked for.
- **The suites from 31** (`test/documents/brief.test.js`, `test/lint/`) pass unchanged.
- **The full suite:** 686/686 on the Mac (`npm test`), 9 of them new in `prd.test.js`. The build
  runner and CI run on the final commit.

## Probes (real)

| Probe | Result |
|---|---|
| **P1 Jet's read** | pending (the main session and Jet) |
| **P2 an agent fills it** | pending (the main session and Jet) |
| **P3 an agent builds from it** | pending (the main session and Jet) |

## Changed from the spec

- **The example brief keeps its open `Q-1`** (Scope 9 said it's answered first). The example PRD
  carries it under "Decisions for you", so the example shows how the brief's decision reaches the
  PRD's summary. T7 answers `Q-1` (email only) in a test copy of both files before approving.
- **The length-exception item is checked for the cap and the word "words",** not the exact count
  (decision 5 says it gives the word count). The count changes with every edit, so a check on it
  would fail after each one. The lint's hint suggests the count.
- **A length-exception line's numbers aren't checked against the detail.** Without this, the
  required item always warned "the summary says 2,000, which the detail doesn't".
- **`AC-NFR` uses the registry prefix `ACNFR`** in `prd.toml`, since an ID kind's prefix is one
  word. The text in documents is `AC-NFR-n.m`, as in the spec.
- **`quick` approves the pair, as `standard` does.** The spec names `standard` and `full` only.
  Only `full` asks for the brief's own approval first.
- **The template lost its three list lead-ins** ("Once this is built:" and two others). An
  example that kept them failed as leftover text, as 31's P2 found with the Success lead-in.
- **Five ACs in the example were shortened** to 20 words or fewer, so it lints with no warning.
- **`mirai show <ticket> --full` or `--json` chooses the ticket** when the name is also an
  initiative. The spec only names `--docs`.
- **The session's `/mirai show` takes `docs`** too, so the choice works from your session.
- **The journal's `approval` event gains `kind: prd`,** as 31 added `kind: brief`.
- **Approval refusals now show their hint.** 31's lint refusal passed its hint where
  `MiraiError` has none, so "fix them, run mirai lint, then approve again" never printed.
