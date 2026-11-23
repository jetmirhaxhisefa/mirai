# Stage 1: scan

The ledger lists every AI item the project has besides MIRAI's own. Nothing in it is used by a
MIRAI run until it's decided, moved and approved.

1. Call `setup scan`. It reads the commit the owner is on (not uncommitted files) and writes
   `.mirai/setup/ledger.md`: one row per item, with its path, its kind, one line on what it does,
   the commands MIRAI's patterns flag in it, and an empty decision.
2. If the owner has uncommitted AI files (a skill they're still writing), say they aren't in the
   ledger until committed, and ask whether to commit them first and scan again.
3. Show the owner the ledger's path and the count per kind. Point out:
   - the flagged items (shell, network or install commands): stage 2 looks at each closely;
   - the council's and BMAD's items, if any;
   - anything that looks like a secret or a credential in a path name: say so, and don't open it.
4. Ask whether anything is missing: an item kept outside the repo, a tool's folder MIRAI doesn't
   know. MIRAI doesn't migrate from outside the repo; its pages can still be sources in stage 3.
5. End the stage (SKILL.md: commit, then `setup done` with `scan`).

Also read: `mirai detect`'s facts and the baseline's state (`baseline show`). If the baseline
isn't recorded yet, say so: stage 5's checklist needs it.
