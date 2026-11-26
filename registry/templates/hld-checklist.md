# HLD checklist

For the verifier. Each line is a yes / no question about the HLD as written. The lint has already
checked the shape: the sections, the diagrams' kinds, the trace table against the PRD and the
components table, the quality goals' NFR and number, the D-n lines and their ADR links, the cited
paths, the `lld` line, the lettered decisions and the length. These need judgement. Lines marked
`[vera]` are Vera's: she checks them before the HLD reaches you (unit 40).

## The summary

- [vera] Could the owner approve the design from the summary alone, in about 15 minutes: what is
  built, the shape it takes, what they must decide and what is left out?
- [vera] Does every load-bearing choice sit under "Decisions for you" with real options, rather than
  being decided quietly in the detail?

## The design holds together

- [vera] Is every container in the diagrams in the components table, and every component in a
  diagram? Name the one missing.
- [vera] Could two teams obey every rule here and still build parts that don't fit (a shape, a name, an
  error, an owner they'd pick differently)? Name the gap: it belongs in the conventions table, a
  D-n line or the LLD.
- [vera] Does each piece of data have one owner, and does every flow that writes it go through that
  owner?
- [vera] Is every connection between components in the flows real: does a flow show it, and does
  the code (or a component marked new) support it? No invented connections.

## The code and the requirements

- [vera] Do the claims in "Current state" hold at the cited lines?
- [vera] Does each quality goal's scenario test its NFR, and does the design meet it (the mechanism
  that delivers it named)?
- [vera] Is the `lld` line right: does the design add or change a stored entity, an external
  contract, a state machine, or span modules that could pick different shapes, while saying
  `not-required`? Then it is a must-fix.

## Decisions

- [vera] Does any D-n line pass the ADR test (hard to reverse, cross-cutting, an NFR, an external
  dependency, first of its kind)? Then it is a writing must-fix: "make it ADR-n". Which option to
  choose is a decision for the owner.
- [vera] The ADR cap: more than 3 ADRs on this `full` initiative (the list in `adrs.md`)? Name the one
  that could be a line, as a decision for the owner (`Kind: scope`).
- [vera] Is an "(Arlo's call)" line one the owner would expect to be asked about? Then it belongs
  under "Decisions for you".

## For the author

- Link ADRs; never repeat them. Cite the PRD's IDs; never copy their text.
- Over 4,000 words, the detail belongs in the LLD.
