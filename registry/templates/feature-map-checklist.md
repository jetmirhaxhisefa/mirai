# Feature map checklist

For the verifier, after a ticket that adds or changes a screen. Each line is a yes / no question
about `.mirai/context/feature-map.md`. The lint has already checked that each handle is in the
code and each route is a path. These need judgement.

- Does every screen the journeys name have a row, with the same name?
- Did the ticket's new or changed screen get its row updated in the same change?
- Is each handle the way a test should find the part: a role and its accessible name first, a
  test ID only where the text changes?
- Is each accessible name what a person sees or hears, not an internal name?
- Is the route the one a person opens, with its changing parts written <like-this>?
- Is a row left for a screen the code no longer has?
