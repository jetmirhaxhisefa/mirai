# MIRAI's registry

MIRAI's own definitions (D-37), shipped with it:
- **`document-types/`:** one TOML definition per document type (unit 07b). `mirai lint` checks
  documents against them.
- **`templates/`:** each type's template and verifier checklist. A document template is itself
  a valid document, with its guidance in HTML comments, so it lints clean. The three report
  templates (`mr-description`, `qa-report`, `run-report`, unit 09b) are not documents: their
  `##` headings are the sections their renderers fill, and they are fixed.
- **`schemas/`:** the JSON Schemas for agents' structured output and the gate result (unit 09a).
- **`examples/`:** a filled example of each type. These are the examples the unit tests and
  agents follow.
- **`agents/`:** agent definitions, from the agent units on (Kai in unit 21, Rex in unit 24).
- **`skills/`:** skills, one folder each with its `SKILL.md` (unit 11): `mirai-docs` so far.
- **`protected-paths/`:** the protected-path rules (unit 12): which changed files force high
  risk, and which run by themselves (`auto-run`). `core.toml` holds what's true on every stack
  and is always on; the others are ecosystem packs (`node`, `php`, `python`, `rust`, `go`,
  `ruby`, `task-runners`), which a project switches on in `[gate] packs`. A new stack is a new
  pack file. A project adds its own rules in `[gate] protected`.
- **`secrets/`:** secret shapes the agents' hook refuses in what they write (unit 13c):
  `core.toml`, true on every stack, with fixed prefixes only (private keys, GitHub, AWS, Slack,
  Stripe, npm tokens…). Packs can add their own later.
- **`adapters/`:** one profile per tool, which says where it reads instructions, skills and
  agents (unit 11): `claude-code`.

The types so far: `story` and `bug` (unit 08a), and `plan` (unit 08b). Plans live in the store,
so they're linted through `lintText`, not `mirai lint`.
