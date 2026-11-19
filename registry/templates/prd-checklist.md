# PRD checklist

For the verifier. Each line is a yes / no question about the PRD as written. The lint has
already checked the shape, the IDs, the groups, the trace to the brief, the ACs' form, the
verification methods, the glossary's prefixes, the length and the writing rules; these need
judgement.

## The summary for approval

- Could the approver decide from the summary alone, for both the brief and the PRD on standard,
  without opening the detail?
- Do the summary and the detail say the same thing: no claim, number or promise in the summary
  that the detail doesn't hold, and nothing important in the detail that the summary hides?
- Is every real choice under "Decisions for you", with options and a recommendation, rather than
  decided quietly in a requirement or an assumption?
- Are the failures and the unchanged behaviour an approver would worry about named in "What
  changes"?

## Nothing dropped

- Is everything the brief, the intake note and the sources ask for here, and nothing replaced by a
  vaguer statement ("handle errors", "support large teams")? Name each gap and its source.
- Does every journey (UJ-n) have the requirements it needs, and every requirement a journey?
- Is a length exception real: does the feature truly not split along its business requirements?

## The requirements

- Is each FR in the right group, one requirement per line, saying what and never how (no tables,
  endpoints, libraries or file names)?
- Are the Failures the ones that can really happen: bad input, a service down, a limit reached,
  two people at once, the person or thing gone? Name any obvious one missing.
- Does Unchanged behaviour name what a user of today's product would notice if it broke?
- Could each AC become a test without asking anyone: a concrete starting state, one action, a
  result someone can see or measure?
- Does each NFR have a number (or UNKNOWN) and a way to check it that someone could run?

## What a builder would have to ask (P3, unit 32)

- Is it clear what exists today and what this feature adds: every part it builds on (a
  notification area, a role, a page) named as existing or new, and each new part with its FRs?
- Is every role and state defined: who counts as "can see" or "can't see", and in which states
  (open, done, archived) each action is allowed?
- Is every boundary defined: how a limit is counted and what happens exactly at it, each date or
  time's format and time zone, how ties in an order are broken?
- Does it say when other people see a change: at once, or on their next reload?
- Does it say what someone who loses access still sees: notices already sent, links, search?
- Can every success metric be measured with what the product records, or is there an FR that
  records it?
- Does each measured NFR name its conditions: the data size, the load, where it's measured, and
  what the time includes?

## Words and scope

- Is every term the requirements depend on in the glossary, and used in exactly that form
  everywhere?
- Is every guess marked as an assumption, with what changes if it's wrong?
- Are the non-goals the things a reader would otherwise expect, so the agents don't build them?
- Would an agent cutting tickets from this PRD have to guess anything? Name it.
- Is anything left from the template: a guidance line, a placeholder, the sample id?
