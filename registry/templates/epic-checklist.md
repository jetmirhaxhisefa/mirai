# Epic checklist

For the verifier. Each line is a yes / no question about the epic and its tickets as written. The
lint has already checked the graph (no cycle, every `after` a ticket that exists), the coverage of every PRD FR, NFR and AC, the sizes and the caps, each ticket's
ACs and `verify` line, the generated sections, the "Decisions for you" items, the link lines and
the writing rules; these need judgement. Lines marked `[vera]` are Vera's: she checks them before the document
reaches you (unit 40).

## The summary for approval

- [vera] Could the approver approve the set from the summary alone: what gets built, in what order, and
  what to decide, without opening a ticket?
- [vera] Does each "What changes" bullet group tickets by what they deliver, ending with the ticket keys
  and the FRs, rather than listing tickets one by one?
- [vera] Do the summary and the tickets say the same thing: no promise in the summary that no ticket
  holds?

## The slicing

- [vera] Is each ticket a vertical slice: does it touch each layer it needs, with one runnable check?
- [vera] Can one agent session plan and finish each ticket, with a diff reviewed in about 15 minutes?
- [vera] Is the first ticket a tracer bullet, and does the ticket the team is least sure of come next?
- [vera] Is every `after` entry a real prerequisite, and nothing more?
- [vera] Where two lanes would touch the same boundary, is the interface and its stub its own early
  ticket?

## Nothing cut to fit

- [vera] Was any work merged, shrunk or dropped to stay under the caps? Name it. Over a cap, the PRD is
  split or the work moves to the full track.
- [vera] Does each ticket deliver every AC it lists in `covers_ac` in full, with no "for now",
  "placeholder" or "wired later"? Those are a second ticket.
- [vera] Are the failure paths their own ACs in the tickets, not folded into a happy path?

## What the set must not add (P3, unit 32)

- [vera] Does every ticket's work trace to its FRs and NFRs, and nothing else? Name any ticket work no
  FR or NFR asks for: a report, a log, a setting, a screen.
- [vera] Does a ticket record data for a metric only when a BR in the brief asks for it? A change log or
  a report nobody asked for is scope creep.
- [vera] Is a question a builder would have to ask about what is built, or who may do what, sent back to
  the PRD rather than settled by a guess in a ticket?

## Order, release and decisions

- [vera] Does "Order" explain why the tickets come in this order, and which can run side by side?
- [vera] Is the release mode right: `per-ticket` unless the epic must go live as one piece, and then
  with its reason?
- [vera] Is `risk: high` set on every ticket that touches a risk path, and `e2e: true` only on a ticket
  that creates or changes a critical journey? A critical journey is one listed in the project's
  feature map (setup, design/01 §10); with no list yet, only the PRD's main user journey counts,
  and the choice is named under "Decisions for you".
- [vera] Does each "Decisions for you" item give the approver a real choice, with a one-line reason?

## Words and scope

- [vera] Is the epic free of the "how" (endpoints, tables, libraries, file names), which belongs in the
  design, the plan and each ticket's `files_likely`?
- [vera] Are the epic's own non-goals the things a reader would otherwise expect, such as a refactor
  sweep left out on purpose?
- [vera] Is anything left from the template: a guidance line, a placeholder, the sample id?
