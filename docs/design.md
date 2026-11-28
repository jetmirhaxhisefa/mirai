# The design: `mirai design`

Arlo (`mirai-architect`) writes an initiative's design from its approved PRD and the code, in the
background (unit 64). You read the result and approve it, as you do the PRD and the tickets.

```
mirai design due-dates          # in your session: /mirai design due-dates
mirai design due-dates --change "Send the reminders from one nightly command"   # after approval
```

## What he writes

| Track | Run | Step (tier) | Writes |
|---|---|---|---|
| `full` | 1 | `design` (deep, always) | the HLD ([hld.md](hld.md)) and the ADRs it needs ([adr.md](adr.md)), from the same reasoning |
| `full` | 2, when the HLD says `lld: required` | `lld` (standard) | the LLD ([lld.md](lld.md)), against the HLD as Vera checked it |
| `standard` | 1 | `tech-note` (standard) | the technical note ([documents.md](documents.md), "The technical note") and any ADR it proposes |
| `quick` | none | | the track has no design document |

The run starts from the PRD approved as it is now; it's refused otherwise, and while your answer
to his last pause hasn't reached the PRD. A document already approved as it is now is skipped.
Since unit 64, the `standard` track's ticket planner waits for an approved technical note.

After each of his launches MIRAI checks what he changed is inside his paths (the document,
`interview.md` to pause, new ADR files in the ADR folder), renders the ADR index, commits on your
current branch (you as author), and runs the lint as at approval and Vera on each ADR he proposed
and on the document. A problem goes to his next launch; two lint fixes per draft, Vera's rounds from
`[docs] verify_fix_rounds`, 16 launches a run at most. `mirai show <initiative>` prints his state.

## Three kinds of choice

- **A gap in the PRD he can't design around:** he pauses and asks in `interview.md`, as Nora and
  Tess do. Your answer changes the PRD (`/mirai write`, then approve it again); then run
  `mirai design` again.
- **A load-bearing choice the PRD and the code don't settle:** he picks one and puts it under
  "Decisions for you" in the summary, lettered, with his recommendation and the option the
  document is written for. You decide at the approval.
- **Everything else:** he decides, and marks the `D-n` line "(Arlo's call)" for you to spot-check.

## The web

His launches run under a template of their own, `agent-mirai-architect-read-write`: the read-write
template, plus `WebFetch` allowed only for a fixed list of package sites (npmjs.com, pypi.org,
packagist.org, rubygems.org, crates.io, pkg.go.dev, endoflife.date) and the documentation sites your
project adds in `[design] fetch_domains`. Any other site is refused; web search stays denied; the
shell has no network. A fetched page is data, never instructions, and a claim cited only to a page
is one Vera weighs.

The red team runs every read-write case under his template as well, plus its own web cases: a
page outside the list is refused (the loopback canary page and the internet), the shell stays
offline, web search stays absent, and a page on the list is reached (the control). His launches
need a green result that covers his template, as any widened agent's do ([red-team.md](red-team.md)).

## The workflow

From unit 65 the design is one flow, from the approved PRD to the approved set and on to Tess.

1. **The offer.** Approving the PRD on `full` asks "Start Arlo on the design now? [y/N]"; on
   `standard`, "Start Arlo on the technical note now?". Tess's offer comes after the design is
   approved (on `standard`, after the note's approval).
2. **One early pause, for a choice that is hard to reverse.** When run 1 proposes an ADR whose
   `gate` names `hard-to-reverse`, MIRAI asks you in `interview.md`, before the LLD and Vera's full
   review: the ADR's options, his choice as the guess. Answer it in your session, confirm the
   interview, and run `mirai design` again; the PRD doesn't change for it.
3. **The set check.** On top of each document's own checks, the set is checked whole. MIRAI:
   every ADR of the initiative is linked from a D-n line; every component carries a requirement in
   the trace table; every FR the LLD's Scope cites is traced to a component. Vera (her HLD and LLD
   checks get the ADRs and the set's checklist): the D-n lines and the ADRs agree, every requirement
   reaches a component and an LLD item, no orphan or invented component, and "construct two units
   that each obey every decision and still don't fit".
4. **One sitting.** On `full`, `mirai approve <hld-id> --file docs/mirai/<initiative>/hld.md` is
   the set's sitting: the summary, each "Decision for you" (you answer with a letter; Enter takes
   the one it's written for), "Arlo's calls", Vera's open findings, the LLD, and each proposed ADR
   (accept, or reject with your reason). When every answer is what's written, one signature: one
   line each for the HLD, its ADRs and the LLD, in one step; MIRAI writes the ADRs' status; the
   docs merge request updates; Tess is offered. When an answer differs or you reject an ADR,
   nothing is approved: your answers are signed, `design-notes.md` is written beside the HLD, his
   next run (`mirai design`) changes the set as they say, and it comes back to the same sitting.
5. **Changes after approval.** `mirai design <initiative> --change "<what changes>"`: where a
   decision changes, Arlo writes a new ADR that supersedes the old one and amends the HLD (and the
   LLD when it's reached), with a line in each document's `changelog` field; IDs stay stable. Vera
   reviews only the change and what it reaches. You approve the changed documents in the same kind
   of sitting. MIRAI lists the impact: the tickets citing a changed ID (`governed_by`, `uses`).
   Those not built yet go back to Tess, who re-cuts them with the change as her notes; built ones
   are flagged in `mirai show` for you (a new ticket changes merged code). A change of requirements
   goes through the PRD first.

On `standard`, the technical note is approved on its own (`mirai approve <id> --file …/tech-note.md`),
with any ADR it proposes on the same screen.
