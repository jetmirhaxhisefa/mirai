# Stage 3: context

The five context files in `.mirai/context/` (`business.md`, `journeys.md`, `feature-map.md`,
`project-<service>.md`, `conventions-<service>.md`). Their templates and lints are MIRAI's:
`mirai show template business` and so on, and `mirai lint` checks each.

## Sources first

1. Ask the owner for sources: links, files, pasted text. Add the documents stage 2 kept (BMAD's
   PRD and architecture notes) and the instruction text it noted.
2. Write each file from its template. Each claim carries its source's ID from the file's Sources
   table. What no source says is written with `(open)` in place of a source: never a guess.
3. Ask only what the sources don't answer, one question at a time (`mirai-interview`).
4. In `journeys.md`, propose the first critical-journeys list: the few flows that must never
   break. The owner approves it.
5. Run `lint` until each file lints clean, apart from the `(open)` lines.

## The review (decision 9)

Call `setup review`. Show the owner its first part as it is: every file, what it is, its state,
its full path and its link. Then take each file in turn:

- **`business.md`, `journeys.md`, each conventions file:** ask each `(open)` line as a question,
  with options and your guess. Write the answer in as a "you said" source and take the `(open)`
  away. Only when none is left, commit the file (`git add` it, `git commit -m "MIRAI setup:
  <file>"`: the verifier checks committed text), then call `verify` with its path (unit 40:
  Vera checks it before the owner approves). Fix each must-fix finding she raises, commit, and
  call `verify` again; ask the owner each finding of kind `decision`, as with `(open)`. Then give
  the approval command for the owner's terminal: `mirai approve --file .mirai/context/<file>`,
  and say to read the whole file first.
- **`feature-map.md`, each `project-<service>.md`:** they're checked against the code, not
  approved. Still show each and ask "anything wrong or missing?"; write the correction in.

If the owner wants to come back to a file later, call `setup defer` with its path: it becomes a
checklist line and `setup status` names it.

On a second run, do this for each file you rewrite, and say which lines changed.

## End of the stage

Call `setup review` again: every file you approve shows approved or put off. Then the commit
(`git add -A`, `git commit -m "MIRAI setup: context"`) and `setup done` with `context`.
