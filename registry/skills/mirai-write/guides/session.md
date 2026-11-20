# Talking to the owner in the session

This guide is for the text you write to the owner in a Claude Code session: the manual steps they
must do, and your explanations. The owner sees only your final message, often after a long wait,
and acts on it alone. Write it so they can follow it without asking anything.

**Asking the owner a question** follows the `mirai-interview` skill (unit 35,
[its SKILL.md](../../mirai-interview/SKILL.md)): one question at a time, with options and your
guess.

## Manual steps

- **Number the steps from the very first action.** Step 1 says where: the Terminal app or this
  session, a browser, an editor. The next step says which folder (`cd ~/Projects/…`). Never start
  in the middle and assume the owner is already in the right place.
- **One action per step.** A step that says "do X, then Y" is two steps.
- **Give the exact command or click, ready to copy.** A command is in a code block, whole, with
  real paths and names. Run it yourself first where you can.
- **Say what they should see** after a step that changes something: "You should see: …", with the
  words or the number the screen shows.
- **Say what to do when it goes wrong,** for the failure that is likely: "If you see …, do …".
- **Put the steps last** in your reply, under one heading, after everything else. The owner reads
  the end first.
- **Never treat a step as obvious.** If the owner has to switch a branch, open a file or wait, it
  is a step.

## Explanations

- **Answer first,** in one or two plain sentences. Background comes after, if at all.
- **Give one concrete example** with real names and values from this project, not a placeholder.
- **One idea at a time.** If the owner needs three ideas, explain the first and offer the next.
- **Stop early.** End by offering what you could explain next, instead of covering everything.
- **Define a term the first time,** especially one that could mean the owner ("the reader", "the
  approver", "the author"). Say who does each thing.
- **Asked to explain again, explain differently, not longer:** plainer words, a different example,
  fewer ideas. A longer version of the same explanation fails twice.

## Examples

Each example quotes a real reply from this project's sessions as it was, then a fixed version,
and the rule it teaches. The replies are in a session transcript that CI can't see, so their
quotes are checked by hand.

### Example 1: steps start with the first action

**Rule:** manual steps start where the owner is: which app, which folder, which branch. One action
per step, the exact command, what they should see, and what to do if it fails.

**Before**, from `session transcript 60ff2a19, the unit 32 spec handover` (a session reply):

```markdown
Read the spec. Open it in your editor or run `less implementation/units/32-prd/spec.md`. Then reply with one of:
- **`approve 32`**, and I'll build it;
- corrections, and I'll fold them in and push again.
```

**After:**

```markdown
1. Open the Terminal app.
2. Go to MIRAI's folder and fetch the branch the spec is on:
   `cd ~/Projects/mirai && git fetch origin`
3. Open the spec without switching your branch:
   `git show origin/unit/32-prd:implementation/units/32-prd/spec.md | less`
   You should see the title "Unit 32: The PRD template (lite and full)". Press `q` to close it.
   If you see "invalid object name", step 2 didn't finish: run it again.
4. Back in this session, reply `approve 32` to start the build, or write your corrections.
```

The draft gave a path that only works on the spec's branch, which the owner's checkout wasn't on.

**Checked by:** judgement.

### Example 2: define the term, say who does what

**Rule:** define a term the first time, and say who does each thing. A word like "the reader"
can mean the owner; here the owner asked whether he had to write the sentences himself.

**Before**, from `session transcript 60ff2a19, unit 34 interview, Q3 explained` (a session reply):

```markdown
**Q3, option B with examples:** every answer from the reader must come with the exact words from the summary it relied on.

### How it works

MIRAI gives the reader only the summary and asks it to fill in this form:
```

**After:**

```markdown
You write nothing for option B. MIRAI starts a separate AI agent, the test reader, which knows nothing about the project. It gets only the summary and answers four questions. For each answer, it must copy the words from the summary it used. MIRAI then searches the summary for those words.

For example, the test reader says "recurring tasks are left out". It must quote "Recurring tasks, because they need their own design (NG-1)". If those words aren't in the summary, the test fails.
```

**Checked by:** judgement.

### Example 3: the answer and one example first, then stop

**Rule:** answer first in plain words, give one concrete example, keep one idea per line, and
offer more instead of covering everything. The owner had to ask for "more details" and
"examples" after this reply.

**Before**, from `session transcript 60ff2a19, unit 34 interview, Q1` (a session reply):

```markdown
**Q1: When should the reader test run?**

The test gives a fresh agent only the summary. That agent must say what will be built, for whom, what's left out and what you must decide. Any of the four it can't answer fails the test. The options:

- **(A) A step in the skill.** The author agent asks a helper agent before handing the document over. It costs nothing extra, but the author grades its own work and nothing enforces it.
- **(B) MIRAI runs it once the lint is clean, before you're asked to approve.** It launches a separate Claude run that sees only the summary and records the four answers. A failure goes back to the author with the missing answer named. You see the four answers at approval, so you can check them against your own read. It costs one short run per document version.
- **(C) It goes into Vera's review (unit 40)** and waits until then.
```

**After:**

```markdown
**Question 1: who runs the reader test, and when?**

The reader test checks that you can approve from the summary alone. For example, suppose the due-dates summary said only "Some extras are left for later". Nobody could tell what is left out, so the test would fail.

Who runs it:

- **(A) The agent that wrote the document,** before handing it over. Nothing checks that it did.
- **(B) MIRAI, after the lint and before you approve.** You see the four answers on your approval screen.
- **(C) Nobody, until Vera's review** in unit 40.

My recommendation is B, because only MIRAI's run is recorded. Ask me if you want to see what each option looks like in practice.
```

**Checked by:** judgement.
