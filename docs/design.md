# The design: `mirai design`

Arlo (`mirai-architect`) writes an initiative's design from its approved PRD and the code, in the
background (unit 64). You read the result and approve it, as you do the PRD and the tickets.

```
mirai design due-dates          # in your session: /mirai design due-dates
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

## Approving

Until unit 65 you approve each document on its own, in order:
`mirai approve <hld-id> --file docs/mirai/<initiative>/hld.md` (its proposed ADRs on the same
screen), then the LLD; or the technical note on `standard`.
