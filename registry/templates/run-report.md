<!--
The run report template (MIRAI, unit 09b; design/01 §13, the "morning report"). It stays in the
store as Markdown, with every value escaped, and is printed in the terminal as plain text. It's
never committed. The sections are fixed: unit 37's overlays don't change report templates.
-->
# {title}

## Summary

## Branch warnings

<!-- First, because it's a safety warning (D-54). Every MIRAI branch that touches files which run by themselves (.vscode tasks, .envrc, .husky, package.json scripts, .claude/ hooks): read them before you open the branch in your IDE. -->

## Done

<!-- The MRs opened, in stack order. -->

## Parked

<!-- Each parked ticket with its reason and parking note; usage-limit pauses with their reset time. -->

## Follow-ups

## Usage

<!-- Turns, tokens and minutes per ticket and in total, with the estimated dollar cost. -->

## Waiting for you

<!-- What waits in mirai inbox. -->

## Template gaps

## Known test failures

<!-- From the baseline. -->

## Housekeeping

<!-- A note when old files are due for mirai clean. -->
