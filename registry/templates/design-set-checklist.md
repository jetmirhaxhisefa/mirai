# The design set's checklist (unit 65)

The set is the HLD, the ADRs it proposes and the LLD it asks for, read together. These lines are
yours on top of the document's own checklist. Every finding cites its line; there is no quota, and a
thin set is not sent back for being thin.

- [vera] Does every ADR the HLD's Decisions link say the same as its D-n line, and is every ADR of
  this initiative linked from a D-n line?
- [vera] Is every FR and NFR in the trace table carried by a component, and, where the LLD covers
  it, by an LLD item (a contract, a schema change, a test-map row)?
- [vera] Does every name, contract and schema change in the LLD belong to a component of the HLD,
  under the same name?
- [vera] Is any component in the HLD's table or diagrams used by no flow and no requirement (an
  orphan), or is any connection drawn that no component or flow needs (an invented one)?
- [vera] Construct two units of work that each obey every decision in the set and still build
  things that don't fit together. If you can, name both and the decision that lets them.
- [vera] Unit 65b: when the initiative has design-decisions.md, does the set follow every pick (the
  approach, the D-n lines, the ADRs), with nothing in it against a pick, even in passing? Is each
  pick marked hard to reverse an ADR written for that pick?
