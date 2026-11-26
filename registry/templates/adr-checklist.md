# ADR checklist

For the verifier. Each line is a yes / no question about the ADR as written. The lint has already
checked the shape: the sections, the Y-statement, at least two options, a bad consequence, the gate
names a test, the cited FR and NFR IDs, the Confirmation's form, the supersede link and the length.
These need judgement. Lines marked `[vera]` are Vera's: she checks them before the ADR reaches you
(unit 40). A finding that the ADR doesn't pass the gate is a writing finding (the fix: make it a
line in the HLD or technical note); a finding about which option to choose is a decision for the
owner.

## One decision

- [vera] Is it one decision, and not a design guide ("how to build X") or several decisions in one
  (a "Mega-ADR")? Name the second decision if there is one.
- [vera] Does the decision pass the test its `gate` names (hard to reverse, cross-cutting, an NFR, an
  external dependency or interface, first of its kind)? If it passes none, it is a writing
  must-fix: make it one line in the HLD's or technical note's Decisions list.
- [vera] The cap (decision 3): does the initiative have more than 2 ADRs on a `standard` track, or 3 on
  `full` (the list in `adrs.md`, this one included)? If so, name the one that could be a line
  instead, as a decision for the owner (`Kind: scope`): never refuse it yourself.

## The options

- [vera] Are the options real: could a reasonable team choose each one, with no option written to lose
  (a "dummy alternative")?
- [vera] Is "do nothing" or "keep what we have" among them, where it fits?
- [vera] Do the pros and cons compare the options on the same qualities, the ones the Context names?

## The decision and its cost

- [vera] Does the Decision follow from the options as written: is the reason one of the pros listed?
- [vera] Are the bad consequences honest: is the real cost there (effort, risk, lock-in, a quality
  given up), and not a token one?
- [vera] Does the Y-statement say the same as the detail: the same option, quality and cost?

## Confirmation

- [vera] Can the Confirmation actually catch a change that breaks the decision: does the check or test
  it names test this decision, and does a `review:` line say what the reviewer looks for?
- [vera] Are the Revisit triggers measurable (a number, an event), when there are any?

## For the author

- Accepted is final: change only typos and links. A new decision is a new ADR with `supersedes`.
- Cite the PRD's FR and NFR IDs the decision serves; don't copy their text.
