# Reports, M1 and feedback (unit 29a)

## `mirai report`

```
mirai report                  # the last run's report
mirai report r-20261114-124456-5474   # an earlier run's
mirai report --json           # the data, for scripts
mirai report --m1             # the M1 acceptance rate
```

Also `/mirai report` and `/mirai report --m1` in your session: they only read (a report not saved yet is saved).

MIRAI saves a run's report when the run ends, in its store: `reports/<run-id>.md` (every value escaped) and `reports/<run-id>.json`. A run from before unit 29a gets its report the first time you ask for it. A saved report stays as it was when it was saved.

What it shows, in the run-report template's sections:

- **Tickets:** each ticket the run touched, with its whole path so far. A step from an earlier run is marked `(earlier run)`, and one after this run `(later run)`. Each agent step shows its model (and the model that really ran, when it differs), round, turns, tokens, minutes, share of your usage limit and verdict. Then your approvals, the push with its checked proofs, the MR and its M1 class, the rounds used of the cap, and your feedback.
- **Done:** the MRs this run opened. **Parked**, **Follow-ups** (Rex's, from the last review), **Usage** (this run's launches, with the limit share), **Red team** (the state for the Claude Code agents run), **Waiting for you** (a plan waiting for your approval), **Template gaps**, **Known test failures** (from the baseline the run was judged against).

Times are your local time.

## M1, the acceptance rate

M1 is how many of MIRAI's MRs you merged as they were (D-38's value mark: at least 60%). MIRAI compares the **code**, not the commits:

| Class | When |
|---|---|
| merged as is | the MR's final head has the same code hash as MIRAI's last push |
| edited | the code hash differs: someone changed code after MIRAI's last push |
| closed | closed without merge |
| unknown | the MR's head or merge commit can't be read; named, with why, and left out of the rate |

The code hash is the one MIRAI's proofs use (unit 25a): the change over `gate.code_paths`, taken from where each commit meets the integration branch just before the merge. So a rebase, or GitHub's "Update branch", isn't an edit, and neither is a change only to docs or records.

```
$ mirai report --m1
M1: 2 of 2 merged as is (100%) · 0 edited · 0 closed

SAMPLE-3     merged as is             https://github.com/…/pull/3
SAMPLE-4     merged as is             https://github.com/…/pull/4
```

Since unit 29a, `mirai ship` records an MR's final head and its merge commit when it sees the merge. For a merge recorded before, `--m1` reads the head from the host (`refs/pull/<n>/head` on GitHub, `refs/merge-requests/<n>/head` on GitLab), through the host's CLI as `ship` does; its commits go into the object store only, never a ref. Pull the integration branch first, so the merge commit is there. A run's report doesn't ask the host: an older merge's M1 shows `unknown` there until `--m1` has read it.

## `mirai feedback`

```
mirai feedback SAMPLE-4 "Kai's first plan missed the 404 case"
```

Your words on how the work with an agent went, one line, up to 2,000 characters. It goes in the ticket's journal and shows in `mirai show` (`Feedback`) and in the report. It's kept as structured data (the retention rule's "kept" class) for the evaluation after the MVP.

- From your terminal it's signed with your key (it needs a real terminal, like `approve`).
- From your session, `/mirai feedback SAMPLE-4 "…"` writes it through MIRAI's `log_event` tool, marked as your session's; the report says "from your session".
- Agents can never write it.
