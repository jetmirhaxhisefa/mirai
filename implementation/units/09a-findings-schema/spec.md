---
unit: "09a"
name: findings-schema
status: approved (2026-10-24, as part of unit 09; split by open point 1)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 09; R-M7, R2-C1, R3-C2, R3-C3, Q9; D-12, D-16, D-29, D-46; 01 §9 (loop rules L1–L8), §10, §11, §13; 03 "Templates"
depends_on: ["05b", "08b"]
---

# Unit 09a — The findings schema and verdicts

Unit 09's spec was approved with its five open points as recommended. This is the first half:
the schemas, the validator and the findings logic. Unit 09b (`../09b-report-templates/spec.md`)
has the report templates.

## Why

The fix loop is decided by a script, not by agent goodwill (01 §9, L8):
- only blocking findings send work back;
- a finding must cite its basis;
- the same failure twice means a plan problem;
- progress must be strict.

None of that can be deterministic without a fixed format for findings and verdicts (R-M7). And
what an agent returns is untrusted: the launcher captures it as structured output, and MIRAI
must check it before believing a word (R2-C1).

The reports are where you meet the results each morning. The MR description is the only part
that leaves your machine, so it must never carry review text (Q9, D-29).

**Roadmap "done when" (09a's share; the MR description is 09b's):**
- a finding without a citation or a resolvable `basis.ref` is flagged;
- the schema has a test corpus.

## Scope

**In:**
- **Four structured-output schemas,** as JSON Schema files in `registry/schemas/`:
  - **`review-verdict`:** the reviewer's verdict and findings;
  - **`finding-replies`:** the developer's `fixed` / `disputed` per finding (L3);
  - **`qa-verdict`:** the QA agent's verdict and evidence per AC;
  - **`gate-result`:** what the orchestrator records after the named checks (R3-C2). It's not
    agent output, but the same kind of checked data.
- **A small validator** for the JSON Schema subset the schemas use (D-04: no packages), so a
  captured output is checked by MIRAI itself.
- **Findings logic:**
  - `findingFingerprint`: file + symbol + `basis.ref`, never line numbers (L4);
  - `failureSignature`: a test failure with numbers, times, hashes and paths normalized;
  - `resolveBasis` and `triage`: a blocking finding without a citation or with an unresolvable
    `basis.ref` is downgraded (L1).
- **The report templates and their renderers:** unit 09b.

**Out:**
- **Running the reviewer, QA or the checks:** units 24, 50–51, 22.
- **The loop guard,** which compares fingerprints across rounds: unit 20. This unit gives it
  the fingerprint and the signature.
- **Signing the gate-result record** and the other proofs: unit 25. This unit defines the
  record's content.
- **The changed-lines check:** a finding outside the diff is "pre-existing" (unit 24). The triage
  takes the changed lines as an optional input.
- **Running a repro command:** a sandboxed run (units 13, 22). This unit checks its shape only.
- **The release record:** Milestone D.

## The schemas

All four share:
- **Strict shapes:** `additionalProperties: false` everywhere, and every string with a length
  cap.
- **Text as data:** free text such as a finding's claim is capped and shown escaped. It is
  never parsed for instructions.

**`review-verdict`:**
```json
{ "verdict": "pass | changes",
  "findings": [ { "id": "F1", "severity": "blocking | should-fix | nit", "category": "correctness",
                  "file": "app/Actions/RenameTeam.php", "line": 42, "symbol": "RenameTeam::handle",
                  "basis": { "kind": "ac | adr | rule | repro", "ref": "AC-PMT-31.1" },
                  "claim": "one or two sentences", "suggestion": "optional" } ] }
```
- `verdict: pass` with a blocking finding is invalid.
- `file` is a repo path (no leading `/`, no `..`).
- `line` ≥ 1.
- The `id`s are unique within the verdict.

**`finding-replies`:**
```json
{ "replies": [ { "id": "F1", "outcome": "fixed | disputed", "reason": "one sentence, for disputed" } ] }
```

**`qa-verdict`:**
```json
{ "verdict": "pass | fail",
  "acs": [ { "ac": "AC-PMT-31.1", "result": "pass | fail | not-run",
             "evidence": [ { "kind": "test | screenshot | output", "ref": "store reference" } ] } ],
  "issues": [ { "severity": "…", "title": "…", "ac": "optional AC ID" } ] }
```
- `pass` needs every AC `pass`, each with at least one piece of evidence.

**`gate-result`:**
```json
{ "ticket": "PMT-31", "round": 1, "code_hash": "sha256:…",
  "checks": [ { "name": "lint", "result": "pass | fail", "minutes": 0.4 } ] }
```

## The findings logic

**`findingFingerprint(finding)`:**
- `sha256(file + "\0" + symbol + "\0" + basis.kind + ":" + basis.ref)`, in hex;
- the path is POSIX and the symbol trimmed;
- no symbol counts as "".

It matches the run log's `finding.fingerprint` (05b).

**`failureSignature({ test, message })`:** a SHA-256 over the test's id and its message, with
these normalized:
- numbers, durations and timestamps;
- hex ids;
- absolute paths;
- the repo root.

So the same failure gives the same signature in another round (L4).

**`resolveBasis(basis, ctx)`:**

| Kind | Resolves when |
|---|---|
| `ac` | the ID is one of the plan's `acs` (08b) |
| `adr` | the ID is in the ticket's `governed_by`, or `ctx.adrs` lists it |
| `rule` | the ID is in `ctx.rules`: the project's convention rule IDs (empty until the context units, so a rule finding can't block yet) |
| `repro` | a single-line command of the right shape: printable, at most 512 characters, no newline. Running it is a later unit |

**`triage(verdict, ctx)`** returns the findings with their final severity. It doesn't change
the verdict text. A blocking finding is **downgraded** (`downgraded: true`, as in the run log)
when:
- it has no `file:line`; or
- its basis doesn't resolve; or
- `ctx.changedLines` is given and its line isn't among them ("pre-existing", unit 24 passes
  them).

Non-blocking findings go to the follow-up list.

## Files

```
registry/schemas/{review-verdict,finding-replies,qa-verdict,gate-result}.json
src/findings/schema.js        # the JSON Schema subset validator
src/findings/findings.js      # findingFingerprint, failureSignature, resolveBasis, triage
src/findings/verdicts.js      # checkReviewVerdict, checkReplies, checkQaVerdict, checkGateResult
test/findings/*.test.js
test/findings/corpus/{valid,invalid}/<schema>/*.json   # the test corpus
```

## Tests

| # | Test |
|---|---|
| T1 | **The corpus:** every valid output passes its schema; every invalid one fails with its expected path and code (missing fields, extra keys, wrong enums, a pass with a blocking finding, duplicate ids, a QA pass without evidence, over-long text) |
| T2 | The validator: each keyword the schemas use, and a schema that uses a keyword it doesn't support is refused |
| T3 | **A finding without a citation, or with an unresolvable `basis.ref`, is downgraded,** for each basis kind; a resolvable one stays blocking; `changedLines` makes an outside line pre-existing |
| T4 | Fingerprints: the same finding on another line has the same fingerprint; another symbol or basis changes it; the run log accepts it |
| T5 | Failure signatures: two runs that differ only in times, durations, ids and paths match; another message doesn't |

## Decisions (approved open points)

- **Split** into 09a and 09b (open point 1).
- **JSON Schema files with MIRAI's own validator** for the subset (open point 2).
- **The four basis kinds** resolve as above; rules can't block until the conventions exist (open point 3).
- **The fingerprint includes the basis kind** (open point 5).

## Done when

- `npm test` passes: the earlier tests plus T1–T5.
- `test-results.md` holds the output.
- The Tech Lead and Architect reviews are done, and `review.md` is written.
- You write **"UNIT APPROVED"**. Then: one commit and push, and `PROGRESS.md` updated.

## Changes after testing and review

Listed for your check before "UNIT APPROVED".

**Settled while building:**
1. **In the review schema, `file`, `line` and `basis` are optional.** A finding without them
   still has to be accepted, so that `triage` can downgrade it ("a finding without a citation
   is flagged"). If the schema required them, the whole verdict would be refused instead.
2. **The validator refuses loose schemas at compile time.** An object needs
   `additionalProperties: false`, a string needs `maxLength` (or an enum or const), and an array
   needs `maxItems`. A later schema can't quietly accept unbounded text.
3. **Captured output is parsed strictly** (`parseJsonStrict`):
   - at most 256 KB and 32 levels;
   - objects without a prototype;
   - duplicate keys refused (`JSON.parse` keeps the last one, so an output could say `pass`
     and `changes` at once);
   - control characters and non-finite numbers refused.
4. **Free text is one line** (a printable pattern), so a claim can't carry a hidden second
   line of instructions. Reasons never repeat the output's text. Tightened after review, #13.
5. **`basisForLog(basis)`** gives the run log's `basis_ref`: `kind:ref`, or `kind:sha256-…`
   for a repro command, which doesn't fit the log's shape.
6. **The cross checks take what they know:**
   - `checkReplies({ findingIds })`: every blocking finding is answered, and nothing else;
   - `checkQaVerdict({ acs })`: every plan AC is reported, and no other AC.
7. **Downgraded findings become `should-fix`,** with `downgraded: true` and a
   `downgrade_reason`. After review the reasons are:
   - `no-citation`;
   - `no-symbol`;
   - `no-basis`;
   - `unresolved-basis`;
   - `repro-not-run`;
   - `pre-existing`;
   - `frozen`;
   - `unconfirmed`.
8. **New problem codes:** `json`, `type`, `required`, `unknown-key`, `enum`, `const`, `pattern`,
   `length`, `range`, `items`, `duplicate`, `pass-with-blocking`, `pass-with-failure`,
   `no-evidence`, `missing-reply`, `unknown-finding`, `missing-ac`, `unknown-ac`.

**From the reviews (`review.md`), with your decisions (2026-10-24):**
9. **A repro can't block until MIRAI runs repros** (`repro-not-run`), like rules before the
   conventions exist. A repro is printable ASCII on one line, and its wording isn't part of the
   fingerprint.
10. **The gate result holds what the signed record needs** (D-16, 01 §8, §11):
    - `base_sha`, `trust_root_hash` and `framework_version`;
    - the `baseline` (sha and store ref) and its `known_failures`;
    - `failures[{ check, test, signature, known }]`, the home for L4's test-failure signatures;
    - a `skip` result, and `output_ref`.

    Its rules: a failure names a check that ran; `known` agrees with `known_failures`; a passed
    check has no new failure; a failed check lists its failures.
11. **Failure signatures keep plain numbers** (changed from "numbers normalized"). Only times,
    durations, `:line:col`, UUIDs, hex ids (with a digit, `0x`, or 12+ long) and paths outside
    the repo are normalized. The repo root is replaced at a path boundary, so paths inside the
    repo are kept. "Expected 4, got 0" and "expected 0, got 4" are now different failures.
12. **Added for later units:**
    - **Round 2 (L2):** a finding's `prior` names the earlier finding it carries over. Triage
      takes `round`, `priorBlocking` and `delta`. A new finding stands only if it's blocking and
      inside the delta (`frozen` otherwise). `changedLines` stays the whole ticket diff, for
      `pre-existing`.
    - **A fifth schema, `finding-check`:** the per-finding check on high-risk tickets (high,
      medium, low, false, maybe-false). Triage's `confirmations` downgrades what isn't
      confirmed (`unconfirmed`).
    - **The QA verdict follows the dogfood report shape** (R-M17):
      - issues carry a category (visual, functional, ux, content, performance, console,
        accessibility), a severity (critical, high, medium, low), a description, repro steps and
        evidence;
      - a `blocked` verdict with its reason means "can't reach the app" (no round used);
      - evidence can be checked against what `run_tests` returned (`evidenceRefs`);
      - a fail needs a failed AC or an issue.
    - **A blocking finding must name its symbol** (`no-symbol`), and triage reports findings
      that share a fingerprint in one verdict (`duplicates`).

**Fixes from the reviews:**
13. **Blocking:** a schema-valid finding could make the run log throw:
    - a blank symbol;
    - a file of 512 emoji (the log counts UTF-16 units).

    All text needs a non-space character now, and `file` is at most 256 characters. T4 logs the
    longest accepted values.
14. **Hidden characters:**
    - Text refuses C1 controls, U+2028/2029, zero-width, bidi and the BOM.
    - Strings with a lone surrogate are refused.
    - Paths must be canonical: no empty or `.` parts, no spaces at either end.
15. **The validator refuses every loose schema it would apply loosely:**
    - each node is exactly one of type, enum, const or `$ref`;
    - only annotations beside a `$ref`, and `$ref` chains resolve;
    - object keywords need type `object`;
    - keyword values are type-checked, and enums hold plain values.
16. **The strict parse can't be skipped:** an object from `JSON.parse` is refused.
    `parseJsonStrict` takes `maxBytes`, so unit 19 can parse the CLI's envelope strictly too.
17. **Smaller fixes:**
    - a reason on a `fixed` reply is refused;
    - a too-long number says so;
    - the depth limit is exact;
    - parse positions are in the whole text;
    - `changedLines` may be a plain object, with paths in any spelling;
    - a trailing `()` on a symbol doesn't change the fingerprint.

**For later units:**
- **Unit 19:**
  - check that `claude --json-schema` accepts these exact files: lengths, `maxItems` and the
    lookaheads may be stripped or unsupported. MIRAI's own check is the one that counts;
  - decide what a refused output costs: an agent error, retried once without using a round,
    then parked.
- **Unit 24:** the orchestrator namespaces finding ids per lens (`lens.F1`) and merges by
  fingerprint; it decides from triage's `blocking`, never from `verdict`; findings are shown to
  the developer as fenced data.

