# Story checklist

For the verifier. Each line is a yes / no question about the story as written. Lines marked
`[vera]` are Vera's: she checks a lone story (one asked for by hand, unit 42) against its interview
and the context files before it reaches you; a story of an epic is checked with its epic.

- [vera] Is it a vertical slice: does it touch each layer it needs, with one runnable check?
- [vera] Can one agent session plan and finish it, and can its diff be reviewed in about 15 minutes?
- [vera] Does each acceptance criterion state a rule with Given / When / Then, including failure paths?
- [vera] Could the reviewer test each acceptance criterion with what the ticket says: a value, a
  screen, a record or a log line they can observe? A system-facing criterion ("the log entries use
  the structure in ADR-12") counts when a check can read it.
- Does `covers_ac` list exactly the PRD ACs it delivers (none on the quick track)?
- [vera] Is `repo` the one repo the work belongs to?
- [vera] Is `e2e: true` set only when it creates or changes a critical journey in journeys.md? An NFR
  is proved by an end-to-end test only through a critical journey; otherwise by a unit, an
  integration or a load test, named in `verify`.
- [vera] Does it avoid "for now", "placeholder" and "wired later"? Those are a second story.
- Are `after` entries real prerequisites only?
- [vera] Does every statement in it agree with the interview it was written from and the context
  files (business.md, journeys.md, the conventions)?
- [vera] Is anything left from the template: a guidance line, "replace this line", the sample `verify`?
