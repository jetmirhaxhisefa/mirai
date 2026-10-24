---
name: mirai-docs
description: "How MIRAI documents work in this repo: where the templates are, how to write a story or bug ticket, and how it gets checked. Use it when you write or change a ticket or any other document under the MIRAI docs folder."
---

# Writing MIRAI documents

This repo keeps its MIRAI documents (tickets now; PRDs and designs later) as Markdown files
under the docs folder that `AGENTS.md` names. MIRAI checks each one against its document type.

## Before you write

- Find the template for the type: `.mirai/framework/registry/templates/<type>.md` (`story`,
  `bug`). A filled example is in `.mirai/framework/registry/examples/<type>.md`.
- Read the type's checklist, `.mirai/framework/registry/templates/<type>-checklist.md`. It's what
  a reviewer checks the document against.

## Writing it

1. Copy the template to `<docs folder>/<initiative>/tickets/<id>.md`. The file name is the
   ticket's `id`.
2. **The `id` is the tracker key the owner gives you.** Don't invent one. `repo` must name a
   `[[repos]]` entry in `.mirai/config.toml`. Keep `template:` as the template has it.
3. Keep every `##` heading of the template, in its order. Write the real text in place of the
   template's lines: `mirai lint` flags any line, the example `id` and the `verify` sentence left
   word for word. The `<!-- … -->` guidance can simply be deleted.
4. An optional section that doesn't apply keeps one line: `Not applicable — <the reason>`. The
   required sections (Description, Acceptance criteria) always get real content.
5. Give each acceptance criterion its own id, `AC-<ticket id>.<n>`, in the "Acceptance criteria"
   section, with Given / When / Then.
6. **There is no status field.** MIRAI keeps each ticket's status in its store, outside the
   repo. Don't add `status:` or write "approved" anywhere: only the owner approves, in a real
   terminal.

## Checking it

- **You don't run `mirai`.** Ask the owner to run `mirai lint <file>` in their terminal, and fix
  what it reports.
- **Don't edit** `.mirai/`, `AGENTS.md` or `CLAUDE.md`. If the template seems wrong, say so
  instead of working around it.
