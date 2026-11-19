# Unit 31: test results (2026-11-19)

## Tests

- **`test/documents/brief.test.js`:**
  - T1: the summary's place, its five parts, their order, none empty, The ask;
  - T2: consistency. An unknown ID fails. A missing open question or non-goal fails. A number
    only warns;
  - T3: every writing rule, with the sentence quoted and the fix named. The detail gets only
    rules 2, 3 and 5. Code spans aren't checked. The word budget is checked;
  - T4: the brief's numbering, success rows, outcomes (a warning), the track, and no open
    question at approval;
  - T5: the template, left as it is, fails as leftover text. A document without the summary
    fails. The registry refuses a type whose summary isn't first. Every type you approve from a
    summary must have the summary and writing checks;
  - T6: `mirai approve <brief> --file`, through the CLI with a signed key:
    - an open question is refused, with the problem listed and nothing written;
    - a wrong id is refused;
    - the approval is signed on the bytes (`kind: brief` in the journal);
    - a changed brief is stale until it's approved again.
- **`test/lint/templates.test.js` T1:** it now also covers the brief. Its template matches its
  type and lints clean outside the docs root.
- **The full suite:** 677/677 on the Mac; the final commit through the build runner and CI (below).

## Probes (real)

| Probe | Result |
|---|---|
| **P1 Jet's read** | **pass.** Jet read the example brief (due dates) and P2's agent-written brief (task comments) as their approver and answered "yes": he knew from each summary what was asked and what to decide, nothing was unclear, and the detail was enough for a PRD. |
| **P2 an agent fills it** | **pass.** A fresh Sonnet agent wrote a brief for task comments from only the template, the checklist and a one-paragraph request (34 s). The first lint found 1 real error (a 30-word sentence) and 2 problems that were MIRAI's (below). After one round of fixing the lint's message, it had 0 errors and 7 warnings (sentences of 21–25 words). Its summary asks two real decisions, each with options and a recommendation. Kept at `implementation/units/31-brief/p2-agent-brief.md`. |

## Found by P2, and fixed

1. **`UNKNOWN` read as an acronym:** the template's own word for a missing baseline. It's now on
   the known list.
2. **Template text reused word for word:** the Success lead-in, "How success is measured:", and
   the "Not applicable" example were sensible enough that the agent kept them, so the
   leftover-text rule fired. The lead-in is gone, and the example now reads as an instruction.
3. **The agent's two unclear points, now in the template's guidance:**
   - the heading is a list's lead-in under "Decisions for you";
   - "see Problem" counts as a source in "Why".

## Changed from the spec

- **No `title` field:** the document's `# title` is its title, kept in one place. The shared
  fields gain `created`.
- **The banned and vague words live in `src/lint/words.js`,** not `registry/writing/`. They're
  read by the lint only, and never pasted into a prompt.
- **The journal's `approval` event gains `kind: brief`:** a document approval, with no schema
  bump, as 29d's `merge` was added.
