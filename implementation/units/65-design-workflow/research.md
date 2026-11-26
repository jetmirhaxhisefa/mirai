# Unit 65: the `mirai-design` workflow research (2026-11-26)

Read by a research agent with unit 64's (`../64-arlo/research.md` holds the source list S1–S39).
**Opinion** marks inferences.

## F. The order, and where you come in

- Drafted together, reviewed together: the architecture doc and its ADR files written together, the doc holding a linked index; the reviewer judges both, and flags the decisions "unverifiable" without the ADR files [S22, S23].
- BMAD shows the load-bearing calls during the run, then distills, reconciles, reviews, and finalizes once [S5]. Superpowers has two gates: the approaches (their own message, the human picks), then the written doc after a builder check, its open questions in one message, "a short list of the calls you made", and approval before planning [S12].
- A short human review: "a one-sentence gate verdict, then critical and high; medium and low in a tail" [S6a]; a human rendering apart from the build artifact [S5]; tell the reader where a wrong call is cheapest to catch [S18]; AWS opens the ADR meeting with 10–15 minutes of silent reading [S35]; waiting for meetings slows teams [S33]; the forum advises, the authors decide [S34].
- **Opinion:** Arlo drafts the HLD, its ADRs and (when needed) the LLD before review; one combined approval opening with a summary, then decisions for you (options and a recommendation), then Arlo's calls to spot-check, then any blockers Vera left. An optional early checkpoint on the approaches when a decision is hard to reverse.

## G. The reviewer loop

- Across documents: the decisions index in sync with the ADR files; one decision per ADR; every NFR with the mechanism that realizes it; every requirement covered, no orphan structure; diagrams in sync with prose; a failure stance per external dependency [S23, S24]; every requirement in the driving document; ratifies the brownfield code; a silent dimension (operations) is a finding [S6a].
- Adversarial: "construct two units one level down that each obey every decision to the letter yet still build incompatibly" [S5a].
- Fresh context per lens: "an inline self-check does not count" [S6a]; "a fresh reviewer helps because it hasn't seen your reasoning" [S36].
- Verdict: approve or revise, revise only on a real, named gap, never a false revise of a thin doc [S23]; blocker, important, minor, and the reviewer never approves [S25].
- Rounds: no source fixes a count; gains concentrate in round 2 and further refining degrades [S38]; diminishing past about 3 [S39].
- **Opinion:** Vera runs the cross-document checklist and the "two compliant units" probe, every finding cited; 2 fix rounds, then what's left goes to you as decisions.

## H. Changes after approval

- An accepted ADR is immutable; a change is a new ADR, reviewed, the old one superseded [S35, S34].
- Amend: scope the delta; supersede the ADR and keep the index in sync; bump the version with a changelog; a requirement-driven change amends the PRD first; flag the ripple to dependent documents; the reviewer checks the delta only [S26].
- Stable decision IDs tickets cite, never renumbered; update the ticket so it doesn't silently diverge [S5, S8]; "if you change direction, delete the unfinished tickets and keep the spec" [S18].
- **Opinion:** after approval a change is a superseding ADR, an HLD amendment with a changelog, Vera's delta review, your signature on the delta, and the list of tickets citing the changed IDs (built ones flagged, unbuilt ones re-cut).

## I. Contrary points

1. "Find at least ten issues" [S4] against "a reviewer asked to find problems will always find something; fix every finding and you get extra layers" [S36]; bm629 prevents false revises [S23]. Vera takes bm629's stance.
2. "Don't spend adversaries on an abstract plan"; prototypes settle questions [S2].
3. Rationale out of the spine [S5] vs alternatives and rationale in the ADR [S28, S35, S22].
4. No file paths in a spec, they go stale [S17] vs exact paths in plans [S12a]. **Opinion:** `path:line` in the HLD's current-state section only; modules elsewhere.
5. Agent frameworks add instability for architecture from requirements; multi-agent raised recall but lowered precision [S32, S31]: one strong run plus an independent reviewer.
6. Specs as disposable snapshots; ADRs and the glossary last [S18]; amendments pile up unless linked [S33]: decide which design documents are living.
