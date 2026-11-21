# Business context checklist

For the verifier, and for you before you approve. Each line is a yes / no question about
`.mirai/context/business.md`. The lint has already checked the shape: every bullet ends with a
source ID, every ID is a row of the Sources table with a link, a file or "you said" and a date,
and the file is at most 1,000 words. These need judgement.

## The claims

- Does each bullet say what its source says, and no more? Open two or three sources and compare.
- Is a guess written as a claim, with a source that doesn't say it? It should end with (open)
  and be asked.
- Is each claim about the product, its people or its rules, not about how the code is built?
- Would an agent writing a PRD know from this file who it's for and what success means?
- Are the numbers real numbers (a goal with a date, a rule with its limit), not "many" or "soon"?
- Does "What this repo is responsible for" say what it isn't, so an agent doesn't build it here?

## What's missing

- Is a rule that would make a feature wrong missing: a legal limit, a market, a language?
- Does the glossary hold the words the business uses in its own way, and does the code use the
  same words?
- Is a stakeholder who must be told about changes missing?

## The sources

- Is each "you said" really something the owner said, with the date it was said?
- Is a long source summarized in a bullet, with its link kept, rather than copied?
- Is anything left from the template: a guidance line, a placeholder, the sample id?
