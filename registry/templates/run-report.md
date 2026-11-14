<!--
The run report template (MIRAI, unit 09b; design/01 §13, the "morning report"). It stays in the
store as Markdown, with every value escaped, and is printed in the terminal as plain text. It's
never committed. The sections are fixed: unit 37's overlays don't change report templates.
-->
# {title}

## Summary

## Branch warnings

<!-- First, because it's a safety warning (D-54). Every MIRAI branch that touches files which run by themselves (.vscode tasks, .envrc, .husky, package.json scripts, .claude/ hooks): read them before you open the branch in your IDE. -->

## Tickets

<!-- Unit 29a: each ticket the run touched, with its whole path so far (earlier runs' steps marked): each step's model, round, turns, tokens, minutes, limit share and verdict; your approvals, the push and the MR; rounds used of the cap; the MR's M1 class; your feedback. -->

## Done

<!-- The MRs opened, in stack order. -->

## Parked

<!-- Each parked ticket with its reason and parking note; usage-limit pauses with their reset time. -->

## Follow-ups

## Usage

<!-- Turns, tokens, minutes and the share of your usage limit per ticket and in total, with the estimated dollar cost. -->

## Red team

<!-- Unit 29a: the red team's state for the Claude Code agents run (the Milestone A evidence). -->

## Waiting for you

<!-- What waits in mirai inbox. -->

## Template gaps

## Known test failures

<!-- From the baseline. -->

## Housekeeping

<!-- A note when old files are due for mirai clean. -->
