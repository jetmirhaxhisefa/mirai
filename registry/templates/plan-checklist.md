# Plan checklist

For the verifier on high-risk tickets. Each line is a yes / no question about the plan as written.

- Does the Intent say what and why, not how?
- Does every AC in `acs` have a test at the lowest level that really proves it?
- Are characterization tests planned for the existing code the ticket changes, and only for it?
- Does every new function or method have a stub step before its red test?
- Is every protected path and new dependency declared, each with a reason?
- Is the plan one goal? A second goal is a new ticket.
- Can a fresh developer build it from the plan alone?
- Does each edge case have a test, where it can?
- Does nothing below the frozen block contradict it (a "revised" boundary in Design notes)?
- Is anything left from the template: a guidance line, the example rows?
