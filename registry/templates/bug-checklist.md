# Bug checklist

For the verifier. Each line is a yes / no question about the bug as written. Lines marked `[vera]`
are Vera's: she checks a lone bug (one asked for by hand, unit 42) against its interview and the
context files before it reaches you; a bug of an epic is checked with its epic.

- [vera] Can someone else follow the reproduction, with the actual and expected values?
- [vera] Is the cause hypothesis a hypothesis, not a prescribed fix?
- [vera] Is every criterion about the fixed behaviour, and can a test that fails on the defect and
  passes on the fix prove each one?
- [vera] Could the reviewer test each acceptance criterion with what the ticket says: a value, a
  screen, a record or a log line they can observe?
- If nothing is wrong, is the ticket dropped with the evidence, rather than "fixed"?
- [vera] Is `repo` the one repo the fix belongs to?
- [vera] Is `e2e: true` set only when the fix changes a critical journey in journeys.md?
- [vera] Does every statement in it agree with the interview it was written from and the context
  files?
- [vera] Is anything left from the template: a guidance line, "replace this line", the sample `verify`?
