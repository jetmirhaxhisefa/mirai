# MIRAI's registry

MIRAI's own definitions (D-37), shipped with it:
- **`document-types/`:** one TOML definition per document type (unit 07b). `mirai lint` checks
  documents against them. Each lists its protected parts (unit 37), what MIRAI's machinery reads,
  which no project overlay may drop (`docs/overlays.md`).
- **`templates/`:** each type's template and verifier checklist. A document template is itself
  a valid document, with its guidance in HTML comments, so it lints clean. The three report
  templates (`mr-description`, `qa-report`, `run-report`, unit 09b) are not documents: their
  `##` headings are the sections their renderers fill, and they are fixed.
- **`schemas/`:** the JSON Schemas for agents' structured output and the gate result (unit 09a).
- **`examples/`:** a filled example of each type. These are the examples the unit tests and
  agents follow. `examples/context/` holds the five context files (unit 36) as written for the
  sample app: `business`, `journeys`, `feature-map`, and `project` and `conventions` for its
  `frontend` and `backend` services (`docs/context.md`).
- **`agents/`:** agent definitions, from the agent units on (Kai in unit 21, Rex in unit 24).
- **`skills/`:** skills, one folder each with its `SKILL.md` (unit 11): `mirai-docs` (a document's
  form) and `mirai-write` (unit 34: how to word the documents you approve, and tickets, with
  per-type guides and before/after examples in `guides/`, and `guides/session.md` for manual
  steps and explanations to you in a session). Every author agent gets both.
  `mirai-interview` (unit 35) is how an agent asks the owner for decisions; its record is the
  `interview` document type.
- **`protected-paths/`:** the protected-path rules (unit 12): which changed files force high
  risk, and which run by themselves (`auto-run`). `core.toml` holds what's true on every stack
  and is always on; the others are ecosystem packs (`node`, `php`, `python`, `rust`, `go`,
  `ruby`, `task-runners`), which a project switches on in `[gate] packs`. A new stack is a new
  pack file. A project adds its own rules in `[gate] protected`.
- **`secrets/`:** secret shapes the agents' hook refuses in what they write (unit 13c):
  `core.toml`, true on every stack, with fixed prefixes only (private keys, GitHub, AWS, Slack,
  Stripe, npm tokens…). Packs can add their own later.
- **`test-adapters/`:** how each test runner writes its report and coverage, runs one file or
  test, and is found by setup detection (units 16a, 16b, 17a; `docs/test-adapters.md`).
- **`stacks/`:** what marks a stack, the pack it suggests, its named checks and its
  commit-message rules, for setup detection (unit 17a; `docs/setup-detection.md`): `node` and
  `php` with checks, `python`, `go`, `rust` and `ruby` with markers only. Unit 36 adds
  `[[scripts]]`: how a command runs a manifest's script, which the project context lint checks
  (`npm run nope` fails). A project adds its own in `.mirai/custom/stacks/`.
- **`instruction-flags/`:** the agent-instruction files setup detection lists, and the shell,
  network and install commands it flags in them (unit 17a; P2).
- **`adapters/`:** one profile per tool, which says where it reads instructions, skills and
  agents (unit 11): `claude-code`.

The types so far: `story` and `bug` (unit 08a), and `plan` (unit 08b). Plans live in the store,
so they're linted through `lintText`, not `mirai lint`.
