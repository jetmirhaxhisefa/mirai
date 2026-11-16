# Unit 30: what the pilot found in MIRAI

Jet, 2026-11-16: "record this MIRAI gaps to be fixed later after the pilot. Meaning what we find
in pilot like problems we need to record to fix them."

Every problem MIRAI shows on the pilot goes here as it happens, with what we did instead. None is
fixed during the pilot unless it blocks it. After the pilot each one becomes a fix, a row or an
addition to a unit's spec, and its line here says where it went.

| # | Found | What happened | Workaround on the pilot | Fix after the pilot |
|---|---|---|---|---|
| F1 | 2026-11-16, keys | `mirai key new --machine` can't publish an existing machine key into a second repo: it refuses with "a machine key already exists on this machine". `mirai key new` (your key) does publish an existing key. | Copied the public file `k-6ffd6a59990e793c.machine.pub` from the sample app (`f39ba2a` on `mirai/pilot`). | `key new --machine` writes the existing machine key's public file, as `key new` does. |
| F2 | 2026-11-16, keys | F1's error hint suggests `mirai key new --machine --replace`. Following it would make a new machine key, and every other repo's records signed with the old one stop verifying until its new public file is published there. | Not followed. | The hint names the publish path from F1; `--replace` warns that the other repos need the new file. |
| F3 | 2026-11-16, setup | Thudos's Docker setup didn't fit MIRAI's test runs, and nothing said so before trying: compose used `env_file:` (refused by the strict text check), the frontend ran `npm install` at start (test runs have no network), the PHP image had no Composer packages baked in. Found by reading the sample app, not by MIRAI. | Changed the pilot's Docker files to the sample app's pattern (`9daed7c`). | `mirai detect` names each of these with the fix: `env_file` in a service, an install command in a `command`/`CMD`, a Dockerfile that doesn't install from the lockfile. Check what 17a already reports first. |
| F4 | 2026-11-16, install | After `mirai init`, the "Next" list says `mirai key new` and nothing about the machine key, which the install needs for the red team, baseline and proofs (29b). | Done by hand (F1). | `init`'s Next list names both keys, or one command publishes both. |
| F5 | 2026-11-16, install | Running MIRAI needs the full path (`node ~/Projects/mirai/bin/launch.js …`); `mirai` alone isn't a command. Jet: "very important that MIRAI gets installed with a command". | Full path in every instruction. | Roadmap row 12c. |
