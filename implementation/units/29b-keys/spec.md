---
unit: "29b"
name: keys
status: approved (2026-11-15; Jet: "approve 29b"; interview decisions 1–6, the defaults as written)
roadmap: design/07-implementation-roadmap.md, row 29b ("Your key and token at rest", proposed in 18e; "decide before building"); D-17 and its 18e update (a signature proves your key was used, not that you were there); docs/signing.md ("What it protects, honestly"); docs/agent-safety.md ("What holds in your sessions", unit 18e)
depends_on: ["06", "13c", "18e", "25a", "29d"]
---

# Unit 29b: your key and token at rest

## Why

Today one key signs everything, and it sits in `~/.config/mirai/signing.ed25519` as a plain file. Unit 18e proved a Claude session running as you can read it through a wrapper (`sh -c`, `perl`) and sign with nobody there (`script` in `sh -c`): an approval, a drop, a token change. So a signature proves your key was used, not that you were there (D-17's update). Row 29b's success test: **your signature means you were there.** "A session's wrapped read gets nothing it can sign with; `script` can't complete an approval; an overnight run still signs its proofs."

Already built: signing and verifying (`src/sign/sign.js`, `keys.js`, `signer.js`), the committed public keys and revocations (`.mirai/keys/`), the real-terminal rule and the typed key (`src/cli/tty.js`, `human-move.js`), the interactive settings' denies (13c), the session red team (18e).

## Decisions (Jet, 2026-11-15, in the interview)

1. **A passphrase now, Touch ID later.** Your key file is encrypted with a passphrase (PKCS#8 with AES-256, Node's own crypto: tested here, a wrong or missing passphrase is refused). Every decision asks for it in your terminal, **in place of typing the ticket key**. Touch ID is later work: a key behind biometry needs a binary signed with an Apple developer certificate (18b hit error -34018), and a Touch ID yes/no without that gates nothing.
2. **Two keys.** Your key (with the passphrase) signs **your decisions**; a **machine key** (file permissions only) signs **MIRAI's records**:

   | Your key: your decisions | The machine key: MIRAI's records |
   |---|---|
   | approving a ticket or a plan; merge; drop; unpark; discard; resume | the baseline; red-team results; the record of the tested Claude Code; branch records; review and gate proofs |

   The checks learn the difference: **a decision signed by the machine key never counts**, anywhere it's checked (the journal, plan approvals, `mirai-verify` later). A record signed by your key still verifies (everything signed so far). So a session that steals the machine key can at worst forge a "review passed" proof; your passphrase-signed merge is still the gate.
3. **How often you type it is your setting:** `[signing] unlock` in your personal config (`~/.config/mirai/config.toml`, never a project's, so a branch can't set it):
   - `"each"` (the default): the passphrase for each decision; nothing stays unlocked.
   - a duration, `"8h"`, `"3d"`, up to `"30d"`: after you type it, MIRAI keeps your key unlocked that long, in a small MIRAI process (the unlock holder) that signs for MIRAI's commands; `mirai key lock` and a restart lock it.
   - **The honest cost, shown:** while unlocked, any program running as you, a Claude session included, can ask the holder to sign; MIRAI's real-terminal check stays, but 18e showed a session can fake a terminal (`script`). So for the time you choose, a session can sign as you, as today; outside it, it can't. `mirai doctor` and `mirai status` show "your key is unlocked until <time>".
4. **The Claude login token stays as it is,** behind the deny rules below: a session already runs on your own Claude login, so MIRAI's token gives it nothing new, and encrypting it would stop `/mirai run` from a session.
5. **Deny rules in both your Claude configs:** at `mirai key new`, `key protect` and `token set`, MIRAI adds its own rules (Read and Edit denied on `~/.config/mirai/**` and `~/Library/Application Support/mirai/**`) to your user-level settings: `claude-priv`'s (`~/.claude-private/settings.json`, a link to your synced `~/claude-config/settings.json`, so they reach your other laptops through `sync.sh`) and your work `~/.claude/settings.json`. Only MIRAI's own rules, marked as MIRAI's; nothing else is touched. 18e showed a branch can't remove user-level rules.
6. **The probes R1 and R2** (below, with your OK).

## Defaults taken with the decisions (not asked; say if you want them otherwise)

- **Moving over:** `mirai key protect` encrypts your existing key in place, asking the passphrase twice. Its id (`k-eea753565042f25b`) stays, so every signature so far still verifies. `mirai key new --machine` makes the machine key (`~/.config/mirai/machine.ed25519`, 0600); its public key is committed as `.mirai/keys/<id>.machine.pub` by you, by itself, as your own (MIRAI never commits keys). Until it's on the integration branch, MIRAI's records are signed with your key as today (and ask the passphrase).
- **A plain key after 29b** is yellow in `mirai doctor` with the hint `mirai key protect`; your decisions still work with it (no lock-out), the passphrase is only asked once it's protected.
- **Feedback from your terminal** isn't a decision: it's recorded unsigned, marked "from your terminal" (still apart from "your session"; agents still can't write it).
- **From your session:** a decision still names the terminal command (unchanged). `/mirai run` now signs the branch record and the proofs with the machine key, so a session run reaches the MR without the `gate record` stop.
- **The passphrase:** at least 12 characters, asked twice when set, read without echo (as `token set` reads the token); `mirai key passphrase` changes it. Forgotten: the key can't be recovered; make a new one (`mirai key new --replace`) and revoke the old (unchanged).
- **The unlock holder:** one per machine, started by the first decision when `unlock` isn't `"each"`; it holds the decrypted key in memory only, listens on a socket in `~/.config/mirai/` (0600), signs only for MIRAI's commands' requests (journal lines and approvals, under their contexts), and exits at the time set or on `mirai key lock`. `mirai key status` shows it.

## Scope

**In.**

1. **`src/sign/keys.js`, `signer.js`:** the encrypted key (read with the passphrase), `key protect`, `key passphrase`, the machine key (`key new --machine`), key kinds in `.mirai/keys/` (`<id>.pub` yours, `<id>.machine.pub` the machine's), and `committedKeys` with each key's kind.
2. **`src/sign/sign.js` and every verifier:** a decision's line or file verifies only with a human key (the journal's human lines, plan approvals); the records accept both (baseline, red team, tested Claude, branch records, proofs).
3. **`src/sign/unlock.js`:** the unlock holder, `mirai key unlock | lock | status`, `[signing] unlock` read from your personal config only.
4. **The decisions** (`approve`, `approve --plan`, `merge`, `drop`, `unpark`, `discard`, `resume`): the passphrase (or the holder) in place of the typed ticket key.
5. **The records** (`baseline`, `redteam`, `build`'s branch record, `gate record`, the run's proofs): the machine key when it's on the integration branch.
6. **The user-level denies** (decision 5), written at `key new`, `key protect`, `token set`, and checked by `mirai doctor` (new item: "Your key at rest": protected, unlocked until, the denies in both configs).
7. **Docs:** `docs/signing.md` (two keys, the passphrase, the unlock setting and its cost), `docs/agent-safety.md` (18e's known limits that now hold), D-17's update.

**Out.**

- Touch ID (later work: an Apple-signed helper). Batch approvals (the inbox, unit 46). Night runs (unit 55; they'll sign with the machine key). `mirai-verify` in CI (unit 54; it gets the key kinds).

## Probes (with your OK: yes, 2026-11-15)

- **R1, a sample-app clone with its own MIRAI home and probe keys (no model; your real key never used):** (1) the encrypted key file read as a session would: no way to sign with it; (2) `approve` driven through `script` without the passphrase: refused; (3) a journal approval, a plan approval and a merge approval signed with the machine key: each refused where it's checked; (4) `/mirai run` from a session (the request path) signs the branch record and the proofs with the machine key and reaches a stand-in MR; (5) `unlock = "1h"`: a second decision needs no passphrase; after `mirai key lock`, it does; (6) the denies written to both settings files (probe copies), MIRAI's only.
- **R2, the session red team** (`mirai redteam run --sessions`, Haiku, about 10–15 minutes, on the sample app with your protected key, `unlock = "each"`): 18e's known limits "a session can read your key and sign" (`sh -c`, `$(…)`, `perl`, `script` in `sh -c`, `drop` and `token clear` through `script`) should now hold. Shown as before and after.

## Files

- **New:** `src/sign/unlock.js`, `test/sign/keys-at-rest.test.js`, `test/probes/keys-probes.js`.
- **Changed:** `src/sign/keys.js`, `src/sign/signer.js`, `src/sign/sign.js`, `src/cli/commands/key.js`, `src/cli/commands/approve.js`, `merge.js`, `drop.js`, `unpark.js`, `discard.js`, `resume.js`, `feedback.js`, `token.js`, `src/cli/human-move.js`, `src/store/journal.js` (human lines need a human key), `src/lint/frozen.js` (plan approvals), the records' signers (`src/baseline/record.js`, `src/redteam/run.js`, `src/redteam/tested.js`, `src/store/branch-record.js`, `src/proofs/record.js`), `src/run/drive.js` (no proofs stop from the session once the machine key is there), `src/doctor/checks.js`, `src/mcp/session.js` or a new `src/sign/denies.js` (the user-level denies), the docs above.

## Tests (`npm test`, no model, no network)

- The encrypted key: signs with the passphrase; a wrong or no passphrase refused; `key protect` keeps the id and the old signatures verifying; `key passphrase` changes it.
- Kinds: each decision type refused when signed by a machine key; each record type accepted from either; a machine key file never read as yours.
- `unlock`: `"each"` asks every time; a duration skips the second ask, ends on time and on `lock`; a project config's `[signing]` refused; more than 30 days refused.
- The denies: added once to both files (as MIRAI's, idempotent), others' rules untouched, a link followed to its file.
- `doctor`: a plain key yellow, unlocked shown, a missing deny named.

## Done when

- R1 passes, and R2 shows 18e's "a session can sign as you" cases holding with `unlock = "each"`.
- Your key protected and the machine key committed on the sample app; a sample ticket's session run reaches its MR with your passphrase asked only at the plan approval and the merge.
- `npm test` passes; the docs say what's above.

## What you'll do by hand (when we get there; exact commands then)

- Approve this spec. Then, in your terminal: `mirai key protect` (choose your passphrase), `mirai key new --machine`, commit the machine key's `.pub` by itself and push it.

## Open points for you

- None beyond the approval.
