# The design: `mirai design`

Arlo (`mirai-architect`) writes an initiative's design from its approved PRD and the code, in the
background (unit 64). You read the result and approve it, as you do the PRD and the tickets.

```
mirai design due-dates --explore            # in your session: /mirai design --explore due-dates
mirai design due-dates --approve-questions  # the design questions, as they are now
mirai design due-dates --research           # the research run, in the background
mirai design due-dates --decide Q-1 --pick A --reason "our files reach 150 MB" --hard yes
mirai design due-dates                      # Arlo's run, following your decisions
mirai design due-dates --no-explore         # no open questions: skip (recorded), start Arlo
mirai design due-dates --change "Send the reminders from one nightly command"   # after approval
```

## Before the design: research and your decisions (unit 65b)

On `full`, after the PRD's approval, the design starts with a conversation in your session, not with
Arlo's run. It has three parts.

1. **The questions.** `/mirai design --explore <initiative>` (`mirai design <initiative> --explore`
   prints the same brief). You and Arlo's persona list the design questions the PRD leaves open
   (approaches, libraries, limits: what current sources can inform), with a short stack summary, in
   `research-questions.md`. When the list is right, approve it: `mirai design <initiative>
   --approve-questions` (a step in your session, not a signed gate: MIRAI records it and commits the
   file on your branch).
2. **The research.** `mirai design <initiative> --research` (`/mirai design research`, in the
   background) starts the research run, which answers exactly those questions in `research.md`:
   per question the options, a pick and a runner-up, and the strongest argument against the pick,
   every claim citing a source with its URL and a short quote. It runs in its own cage (below).
3. **Your decisions.** `/mirai design --explore <initiative>` again: one question at a time, with
   the options from `research.md` and its pick as the recommendation. Each answer is recorded by
   MIRAI in `design-decisions.md`: `mirai design <initiative> --decide Q-1 --pick A --reason "…"
   --hard yes|no`, or `--pick arlo` to leave it to him. A pick you mark hard to reverse becomes a
   draft ADR (`proposed`) that Arlo writes from your pick and you sign at the set's sitting; it
   doesn't pause his run again.

Then `mirai design <initiative>` starts Arlo. His run 1 reads `research.md` and
`design-decisions.md`; he follows every pick and cites it on the D-n line that settles it
("(design-decisions.md Q-n)"). MIRAI's lint finds a pick left uncited, and Vera's set check judges
that the design follows each one.

**No open questions?** `mirai design <initiative> --no-explore` records the skip and starts Arlo.
On `full`, `mirai design` without either waits and says so. On `standard` the step runs only when
you ask for it (`--explore`).

Two files, two jobs: `design-decisions.md` holds your decisions **before** Arlo's run 1;
`design-notes.md` (the workflow, step 4) holds your answers **after** a set is sent back.

### The research run's cage

The research run (`mirai-design-research`, Arlo's persona, step `design-research` in
`mirai models`) reads web pages, which may carry instructions planted for an AI. Your session never
reads them: it can sign, and holds your key and token. The run itself has nothing to steal:

| Layer | What holds it |
|---|---|
| **Nothing to steal** | Its working folder is a fresh scratch folder with only the approved questions and the PRD (and research.md's template). It reads nothing else: not the repo, the home, the store or your secrets. No shell, no MCP tools. A tricked run can leak only what you chose to show it. |
| **The fetch gate** | `WebSearch` is allowed. `WebFetch`, like every call of the run, needs MIRAI's hook: it allows only a URL one of the run's own searches returned, and refuses any other (a URL a page points to, or one with data written into it). A hook that fails or is too slow refuses. |
| **The rules** | A page is information, never instructions. A page that tries to instruct the run is listed under "Suspicious pages" and never cited. |
| **The check after the run** | Every claim cites a source; MIRAI checks each source's URL is one the run's searches returned and each quote is in what the run's fetch of it returned. A failure goes back to the run once (it keeps its record, so it needn't search again); then the run fails. |

A quote is checked against what `WebFetch` returned to the run: Claude Code's fetch model's answer
to the run's prompt, not the raw page. The run is told to ask for the exact sentences it quotes.

Caps: `[design] research_max_searches` (30) and `research_minutes` (20). The red team runs every
read-only case under the research template too, plus its own: a fetch no search returned, a page's
instruction to send the stack summary to a crafted URL, the repo, Bash, a write outside
`research.md`, its own URL list, the hook past its timeout, the search cap, and the control (a
search and a fetch of its result) ([red-team.md](red-team.md)).

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

1. **The offer.** Approving the PRD on `full` points to the design questions first (unit 65b):
   "Next: the design questions, in your session: /mirai design --explore <initiative>. Skip them
   and start Arlo now? [y/N]" (a "y" records the skip); once they're settled, "Start Arlo on the
   design now? [y/N]". On `standard`, "Start Arlo on the technical note now?". Tess's offer comes after the design is
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
