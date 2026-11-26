# PRD checklist

For the verifier. Each line is a yes / no question about the PRD as written. The lint has
already checked the shape, the IDs, the groups, the trace to the brief, the ACs' form, the
verification methods, the glossary's prefixes, the length and the writing rules; these need
judgement. Lines marked `[vera]` are Vera's: she checks them before the document
reaches you (unit 40).

## The summary for approval

- [vera] Could the approver decide from the summary alone, for both the brief and the PRD on standard,
  without opening the detail?
- [vera] Do the summary and the detail say the same thing: no claim, number or promise in the summary
  that the detail doesn't hold, and nothing important in the detail that the summary hides?
- [vera] Is every real choice under "Decisions for you", with options and a recommendation, rather than
  decided quietly in a requirement or an assumption?
- [vera] Are the failures and the unchanged behaviour an approver would worry about named in "What
  changes"?

## Nothing dropped

- [vera] Is everything the brief, the intake note and the sources ask for here, and nothing replaced by a
  vaguer statement ("handle errors", "support large teams")? Name each gap and its source.
- [vera] When the owner gave their own list (`upstream-requirements.md`), does every REQ-n it cites keep
  the line's meaning and its numbers ("1 day before" stays "1 day before"), with no condition dropped
  or added? A changed or weakened line is a must-fix, `against` the list's line. A line left out on
  purpose under "Not in this", with its reason, is no finding.
- [vera] Does every journey (UJ-n) have the requirements it needs, and every requirement a journey?
- [vera] Is a length exception real: does the feature truly not split along its business requirements?

## The requirements

- [vera] Is each FR in the right group, one requirement per line, saying what and never how (no tables,
  endpoints, libraries or file names)?
- [vera] Are the Failures the ones that can really happen: bad input, a service down, a limit reached,
  two people at once, the person or thing gone? Name any obvious one missing.
- [vera] Does Unchanged behaviour name what a user of today's product would notice if it broke?
- [vera] Could each AC become a test without asking anyone: a concrete starting state, one action, a
  result someone can see or measure?
- [vera] Does each NFR have a number (or UNKNOWN) and a way to check it that someone could run?

## What a builder would have to ask (P3, unit 32)

- [vera] Is it clear what exists today and what this feature adds: every part it builds on (a
  notification area, a role, a page) named as existing or new, and each new part with its FRs?
- [vera] Is every role and state defined: who counts as "can see" or "can't see", and in which states
  (open, done, archived) each action is allowed?
- [vera] Is every boundary defined: how a limit is counted and what happens exactly at it, each date or
  time's format and time zone, how ties in an order are broken?
- [vera] Does it say when other people see a change: at once, or on their next reload?
- [vera] Does it say what someone who loses access still sees: notices already sent, links, search? And
  whether a notice is sent at all to someone who can't see what it's about?
- [vera] Does it say where else the new data shows up in today's product (search, exports, notices), and
  who sees it there?
- [vera] Does it say what happens to the new data when its author's account is removed or deactivated?
- [vera] Does it say how each success metric is measured, without adding a feature the brief doesn't ask
  for (a report, a log) just to measure it?
- [vera] Does each measured NFR name its conditions: the data size, the load, where it's measured, and
  what the time includes?

## Words and scope

- [vera] Is every term the requirements depend on in the glossary, and used in exactly that form
  everywhere?
- [vera] Is every guess marked as an assumption, with what changes if it's wrong?
- [vera] Does every claim added since the last check cite a source (the brief, the interview, a
  context file, an approved document, the code)? One that no source holds is an
  invented decision: a must-fix decision finding (unit 44).
- [vera] Is every assumption the owner approved in the interview (`upstream-interview.md`, its
  `## Assumptions`, A-1, A-2 …) reflected in the PRD under the same A-n, and none contradicted by a
  requirement? A dropped or contradicted one is a must-fix, `against` the interview's line (unit 44).
- [vera] Are the non-goals the things a reader would otherwise expect, so the agents don't build them?
- [vera] Would an agent cutting tickets from this PRD have to guess anything? Name it.
- [vera] Is anything left from the template: a guidance line, a placeholder, the sample id?
