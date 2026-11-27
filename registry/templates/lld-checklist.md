# LLD checklist

For the verifier. Each line is a yes / no question about the LLD as written. The lint has already
checked the shape: the HLD link, the sections, failure rows and retry lines on the contracts,
migration, rollback and backfill on each schema change, unique names, the test map against the
failures and the PRD's acceptance criteria, the D-n it cites, and the length. These need judgement.
Lines marked `[vera]` are Vera's: she checks them before the LLD reaches you (unit 40).

## Builders can't diverge

- [vera] Builder check: reading only this LLD and its HLD, where would a builder have to guess, and a
  wrong guess matter (a field's type, an error's code, who owns a write, an order of operations)?
  Name each such question; if there is none, say so.
- [vera] Do the names, contracts and schema changes match the HLD's components, data ownership and
  flows? Name a shape no component owns, or a component's interface missing here.
- [vera] Is every field typed precisely enough ("integer, minor units, >0", not "a number"), and is
  one error shape used everywhere?

## Nothing decided here

- [vera] Does every non-obvious choice cite one of the HLD's D-n lines or an ADR? The LLD decides
  nothing: a choice made only here is a writing must-fix ("record it in the HLD").

## The edges

- [vera] Are the limits, re-runs and the security surface covered: what happens on a repeated call,
  an empty or huge input, a caller who isn't allowed?
- [vera] Do the claims about existing code hold at the cited files?
- [vera] Is a thin LLD thin because the work is small, not because shapes are missing? Don't ask for
  more where nothing is shared.
