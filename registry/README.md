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
- **`agents/`:** agent definitions, from the agent units on.

The types so far: `story` and `bug` (unit 08a), and `plan` (unit 08b). Plans live in the store,
so they're linted through `lintText`, not `mirai lint`.
