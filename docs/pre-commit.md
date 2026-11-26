# The commit check: `pre-commit`

MIRAI installs a `pre-commit` hook beside its `pre-push` one (`mirai init`, and `mirai init
--refresh` on an existing project). Git runs it on every `git commit`, on the files you staged
only. When the repo had its own `pre-commit`, MIRAI runs that one first, with the same input; if it
refuses, the commit is refused and the line names it.

## What it refuses

- **A hand-written status (unit 44).** A brief, a PRD, an interview, or any document type whose
  status lives in MIRAI's store (`status = "forbidden"` in its type) with a `status:` field. A
  document's state comes from your signed approvals in the journal, never from its frontmatter.
  The line names the file and the line, and the approval command.
- **A changed record (unit 44).** A staged file under `.mirai/records/` (a ticket's `branch.json`
  and its proofs) that doesn't verify against the committed public keys, as `mirai gate check`
  reads them, or a file there MIRAI doesn't write.
- **A hand-added agent file (unit 39).** A file under `.claude/`, `.cursor/` or `.codex/` that
  MIRAI didn't render: it names the `mirai custom add` command for each.

When the check itself can't run, the commit is refused.

## What it warns about

**A change to an approved document.** When a staged change alters a document whose last signed
approval matches it as it is in `HEAD`, the commit goes through, with a warning:

```
mirai pre-commit: warning: docs/mirai/due-dates/prd.md: this commit makes your approval of the prd due-dates-prd (seq 41) stale
  write a new draft beside it (prd.v2.draft.md), or approve it again: mirai approve due-dates-prd --file docs/mirai/due-dates/prd.md
```

## Skipping it

`git commit --no-verify` skips it, as `git push --no-verify` skips the push check. `mirai doctor`
still lists the agent files it would refuse, and CI (unit 54) checks the same rules on the host.
Document approvals are journal lines in MIRAI's store, not repo files, so the records check covers
`.mirai/records/` only.
