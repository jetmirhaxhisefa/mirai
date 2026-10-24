# MIRAI's registry

MIRAI's own definitions (D-37), shipped with it:
- **`document-types/`:** one TOML definition per document type (unit 07b). `mirai lint` checks
  documents against them.
- **`templates/`:** each type's template and verifier checklist. A template is itself a valid
  document, with its guidance in HTML comments, so it lints clean.
- **`examples/`:** a filled example of each type. These are the examples the unit tests and
  agents follow.
- **`agents/`:** agent definitions, from the agent units on.

The types so far: `story` and `bug` (unit 08a). `plan` comes in unit 08b.
