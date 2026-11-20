---
id: product-conventions-web
type: conventions
template: conventions@v1
service: web
owner: product-owner
updated: "2026-01-01"
---
<!--
The conventions template, one per service (MIRAI, unit 36). It lives at
.mirai/context/conventions-<service>.md, and you approve the whole file (mirai approve --file
.mirai/context/conventions-<service>.md). Replace every line below; keep the heading.
- Each rule is one bullet, tagged at its end:
  - (enforced by <check>): a check in [checks] of .mirai/config.toml enforces it. Say what it
    holds in one line; the check, not the prose, is the rule.
  - (judgment): no tool checks it. Add an indented line under it, "Example: …", with a short case
    from this code.
- Don't write a rule a check enforces as prose: the lint warns when a judgment rule names the
  check's tool.
- Write the rules this code follows that an agent would get wrong: how it differs from the usual
  way, and the mistakes you had to correct twice.
-->
# Conventions: the service's name

## Rules

<!-- done when: each rule is tagged; each judgment rule has an example from this code -->
- What the named check holds, in one line (enforced by lint).
- A rule no tool checks, said as what to do (judgment).
  Example: a short case from this code that follows it.
