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

## Words and scope

- Is every term the requirements depend on in the glossary, and used in exactly that form
  everywhere?
- Is every guess marked as an assumption, with what changes if it's wrong?
- Are the non-goals the things a reader would otherwise expect, so the agents don't build them?
- Would an agent cutting tickets from this PRD have to guess anything? Name it.
- Is anything left from the template: a guidance line, a placeholder, the sample id?
