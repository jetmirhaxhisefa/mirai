# Technical note checklist

For the verifier. Each line is a yes / no question about the technical note as written. The lint has
already checked the shape: the seven sections, the PRD link, every FR and NFR in Coverage and no
other ID, the D-n lines and their ADR links, the cited paths, reversible or not on each data change,
and the length. These need judgement. Lines marked `[vera]` are Vera's: she checks them before the
note reaches you (unit 40).

## The approach

- [vera] Does the approach answer every FR and NFR of the PRD: for each Coverage row, does the
  component named actually deliver that requirement, as the approach describes it?
- [vera] Could an engineering manager read it in about five minutes and know how it is built, what
  isn't changing, and what to object to?
- [vera] Do the claims hold at the cited files: does each file exist where it says, and does it do
  what the note says it does today?

## Building it

- [vera] Could two engineers following it build parts that don't fit together: an endpoint and its
  caller with different shapes, two migrations on the same table, two ways to store the same thing?
  Name the gap.
- [vera] Does each data change say honestly whether it can be undone, and is the reason true?
- [vera] Does "Risks and rollout" say what breaks if only half ships, in the order the work goes?

## Decisions

- [vera] Is every real choice a D-n line, rather than made quietly inside the approach?
- [vera] Does any D-n line pass the ADR test (hard to reverse, cross-cutting, an NFR, an external
  dependency or interface, first of its kind)? Then it is a writing must-fix: "make it ADR-n" (an
  ADR, linked from the line). Which option to choose is a decision for the owner.
- [vera] The ADR cap: does the initiative have more than 2 ADRs on `standard` (the list in
  `adrs.md`)? If so, name the one that could be a line, as a decision for the owner (`Kind: scope`).

## For the author

- Cite the PRD's IDs; don't copy their text.
- Over 800 words, the feature belongs on the full track: say so instead of cutting detail.
