# MIRAI's registry

MIRAI's own definitions (D-37), shipped with it: agents in `agents/`, and document types in
`document-types/`. Each is a TOML definition, with its template and checklist as `.md` files
next to it. `mirai lint` checks documents against these types.

Unit 07b adds the lint. The first document types (story, bug, plan) come in unit 08.
