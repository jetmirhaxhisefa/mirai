# Stage 5: finish

1. Call `setup checklist`. Each line has the exact command, what the owner should see, the default
   for every optional choice, and its state from `mirai doctor`. It's stored in
   `.mirai/setup/checklist.md`.
2. Take the open lines one at a time. Give the owner the command for their terminal and what
   they'll see; wait for them. Never run a gate (the token, the key) yourself.
3. For a line doctor can't check (the key's backup, `.env.test`, managed settings, CI required
   checks), ask whether it's done, then call `setup checklist` with `n` set to the line.
4. A context file put off in stage 3 is a line too: its approval command.
5. Call `setup checklist` again until every line is done; line 8 is `mirai doctor` green.

End: commit the checklist (`git add -A`, `git commit -m "MIRAI setup: finish"`), then `setup done`
with `finish`. Tell the owner setup is done, and that `/mirai setup` later offers only what's new.
