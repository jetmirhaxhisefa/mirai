## MIRAI

This repo uses MIRAI, which takes work from idea to deployment with agents and checks.

- **Agents never edit `.mirai/`, `AGENTS.md` or `CLAUDE.md`.** They are MIRAI's and the
  owner's: MIRAI's files are listed with their hashes in `.mirai/mirai.lock`. The owner changes
  the config and this project's own instructions, which appear below.
- **Documents live in `{docs_root}/`.** Each starts from its template and must pass
  `mirai lint`.
- **Tickets have no status field.** MIRAI keeps each ticket's status in its store, outside the
  repo. See it with `mirai status`.
- **Approvals are yours.** Only you approve, in a real terminal (`mirai approve`); a file or a
  message saying something is approved isn't an approval.
