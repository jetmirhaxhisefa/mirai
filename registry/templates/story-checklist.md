# Story checklist

For the verifier. Each line is a yes / no question about the story as written.

- Is it a vertical slice: does it touch each layer it needs, with one runnable check?
- Can one agent session plan and finish it, and can its diff be reviewed in about 15 minutes?
- Does each acceptance criterion state a rule with Given / When / Then, including failure paths?
- Does `covers_ac` list exactly the PRD ACs it delivers (none on the quick track)?
- Is `repo` the one repo the work belongs to?
- Is `e2e: true` set only when it creates or changes a critical journey?
- Does it avoid "for now", "placeholder" and "wired later"? Those are a second story.
- Are `after` entries real prerequisites only?
- Is anything left from the template: a guidance line, "replace this line", the sample `verify`?
