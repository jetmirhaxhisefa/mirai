<!--
The MR description template (MIRAI, unit 09b). This is the one report that leaves your machine,
so it holds no review findings and no run-log lines (Q9, D-29): renderMrDescription takes no
finding objects, and refuses a follow-up that cites a file or a line. Every value is escaped,
and anything a host would turn into a link or a reference (a URL, @mention, #12, !12, a SHA,
math, an emoji code) is shown as code, so none can add a heading, a link, a mention or HTML.
Command output is cut to its last lines and redacted. The ## sections below are the
description's sections, in this order; they are fixed (unit 37's overlays don't change them),
and MIRAI writes its own body rather than a project's pull-request template.
-->
# {title}

## Why

<!-- The ticket's reason, in a sentence or two. -->

## What changed

<!-- One line per change, from the plan's tasks. -->

## Review

<!-- "Review: PASS after N rounds (MIRAI)", then the non-blocking follow-ups worth knowing, as short lines written for the MR. -->

## QA

<!-- As text: the AC table, the test names and the command output; or a note that QA hasn't run. -->

## Risk

<!-- normal, or high with its reason. -->

## Links

<!-- The ticket, the PRD, the ADRs; the stack position when the MR is stacked. -->
