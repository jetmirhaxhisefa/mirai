---
id: product-feature-map
type: feature-map
template: feature-map@v1
code: [src]
updated: "2026-01-01"
---
<!--
The feature map template (MIRAI, unit 36). It lives at .mirai/context/feature-map.md. It isn't
approved: mirai lint checks it against the code, and an agent updates it in the ticket that adds
or changes a screen. Replace every row below; keep the heading.
- code: the folders that hold the screens' code, from the repo's top folder. Handles and routes
  are looked up there, tests left out.
- One row per screen: its name as people say it (the journeys use it in bold), its route in
  backticks, and its handles.
- Handles, each in backticks, the way a test finds the part: a role and its accessible name first,
  such as button "Save" or label "Email"; data-testid="task-list" only where the text changes.
  A part that changes is written <like-this>: data-testid="task-<id>".
- A handle the code doesn't have fails; a route the code doesn't hold warns (it may be built at
  run time).
-->
# Feature map: the product's name

## Screens

<!-- done when: every screen a journey names is a row, with its route and the handles a test needs -->
| Screen | Route | Handles | Notes |
|---|---|---|---|
| Start | `/` | `heading "Start"`, `button "Begin"` | Where the person starts |
| Result | `/result` | `heading "Result"`, `data-testid="result-<id>"` | What the person came for |
