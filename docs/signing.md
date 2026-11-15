# Signing in MIRAI

Some moves only you may make: approving a ticket, dropping one, resuming a stopped run,
unparking. MIRAI signs each of them with a key on your machine, so it can tell your decisions
apart from anything else that writes a file (decision D-17). A signature proves your key was
used, not that you were there: see "What it does and doesn't protect" and unit 18e's limits in
`docs/agent-safety.md`.

## Set up (once per machine, once per repo)

1. In the repo, in your own terminal:
   ```
   mirai key new
   ```
   - **On a machine with no key yet,** this makes an Ed25519 key pair. The private key goes in
     `~/.config/mirai/` (yours only). The public key goes in `.mirai/keys/<key-id>.pub`, in the
     repo.
   - **On a machine that already has a key,** it writes that key's public file into this repo.
     There's one key per machine.
2. **Commit that file by itself, and push it to the integration branch yourself.** MIRAI never
   commits keys.
3. `mirai key show` tells you when the key is on the integration branch and signatures verify.

## Every day

- `mirai approve <ticket> --file <ticket file>`:
  - asks "accepted as is / edited / rejected", with an optional one-line reason;
  - asks you to type the ticket key to confirm;
  - signs your decision over the file's exact bytes.
- `mirai drop <ticket>`: the same confirmation, then a signed move to `dropped`.
- Both need a terminal; a piped or headless agent-run command is refused. A process that makes its
  own terminal isn't (below).

## Plan approvals (unit 08b; recorded by the plan gate, unit 21)

Approving a plan signs `approvalHash` over:
- its frozen block (Intent, Boundaries, Edge cases);
- its Declared changes rows;
- the fields `ticket`, `acs`, `risk`, `tdd`, `tests` and `round`.

The signing context is `mirai/plan-approval/1:<repo-id>`, its own, so a plan approval can't
pass for a document approval (`mirai/approval/1:<repo-id>`) or a journal line. An edit to any
signed part needs a new approval. The code map, the tasks and the logs may change.

## Branch records (unit 22)

Every ticket branch MIRAI makes starts with a commit of `.mirai/records/<ticket>/branch.json` (D-15): the ticket, the branch, the commit it started from and when. It's signed with your key, under its own context, `mirai/branch-record/1:<repo-id>`. So CI and the pre-push hook (unit 26) can see the branch is MIRAI's even without the store. `mirai branch verify [<branch>]` checks it with the integration branch's public keys, as CI will. Records are signed from your terminal only. Night runs need a machine key, which is row 29b's.

## Proofs (unit 25a)

`mirai gate record <ticket>` mints a ticket's **proofs** after Rex's review passed: a `review` proof and a `gate` proof in `.mirai/records/<ticket>/`, each its own immutable file (`review-r1-<hash>.json`, `gate-r1-<hash>.json`), signed with your key under `mirai/proof/1:<repo-id>`, and committed on the ticket's branch by MIRAI. They're bound to the ticket's **code hash** (D-16): a clean rebase keeps them, any code change doesn't. They say only that the review and the gate passed for that code, never what was found. `mirai gate check <ticket>` recomputes the hash and checks them with the integration branch's public keys only, as the pre-push hook (unit 26) and CI (unit 54) will. Like every record, they're signed from your terminal only; until row 29b's machine key, a night run parks the ticket for you (`sign-proofs`).

## Your passphrase and the machine key (unit 29b)

Two keys, each for its own kind of signature:

| Your key | The machine key |
|---|---|
| your decisions: approving a ticket or a plan, merge, drop, unpark, resume, accepting a red-team blocker | MIRAI's records: the baseline, red-team results, the tested Claude Code, branch records, review and gate proofs |
| `~/.config/mirai/signing.ed25519`, **encrypted with your passphrase** | `~/.config/mirai/machine.ed25519`, plain (MIRAI signs with nobody there) |
| `.mirai/keys/<id>.pub` | `.mirai/keys/<id>.machine.pub` |

**A decision signed by the machine key never counts**: the journal, plan approvals and accepted blockers verify only with your key. Records verify with either, so everything your key signed before stays valid.

Setting it up, in your terminal:

```
mirai key protect          # your existing key, encrypted; same id, so its signatures still verify
mirai key new --machine    # the machine key; commit .mirai/keys/<id>.machine.pub by itself, push it
mirai key status           # both keys, and whether yours is unlocked
```

Each decision asks **your passphrase in place of typing the ticket key**. (A key that isn't protected still takes the typed key.) With the machine key on the integration branch, `/mirai run` from your session signs the proofs with it and goes on to the MR, so you're asked only at the plan and the merge. `mirai key passphrase` changes the passphrase; a forgotten one can't be recovered: `mirai key new --replace`, then revoke the old key.

**How long it stays unlocked is your setting:** `[signing] unlock` in `~/.config/mirai/config.toml` (your global file only; a project can't set it).

- `"each"` (the default): your passphrase for each decision; nothing stays unlocked.
- a duration up to 30 days (`"8h"`, `"3d"`): after you type it, a small MIRAI process keeps your key unlocked that long; `mirai key lock` locks it, so does a restart.
- **The cost:** while it's unlocked, any program running as you, a Claude session included, can ask that process to sign. The real-terminal check stays, but a session can fake a terminal (`expect`, `script`). So for the time you choose, a session can sign as you; outside it, it can't. `mirai doctor` and `mirai key status` show "unlocked until".

Touch ID is later work: a key behind biometry needs an Apple-signed helper (the data-protection keychain refuses an unsigned one, error -34018).

The Claude login token stays a plain file (only you can read it): a session already runs on your own Claude login, so MIRAI's token gives it nothing new. `mirai key new`, `key protect` and `token set` add MIRAI's deny rules (no reading or editing `~/.config/mirai` and MIRAI's home) to your user-level Claude Code settings, in each config that's there (`~/.claude-private`, which links to your synced `~/claude-config`, and `~/.claude`), so no session reads them by accident.

## When a key changes

- **Rotate:** `mirai key new --replace`, then `mirai key revoke <old id>`. Commit both files by
  themselves.
- **A lost or stolen laptop:** from another machine, `mirai key revoke <its id>` and commit it.
  Signatures made with that key after the revocation time fail. Those made before still verify.
- **Never delete or edit a `.pub`:** every line it signed would stop verifying. Revoke it
  instead. The key-change rule refuses deleting or editing one.

## What it protects, honestly

This resists accidental and casual forgery:
- an agent can't approve by writing a line or by editing a status file;
- an approval stops verifying when the file changes afterwards;
- a signed line copied into another repo, or passed off as another kind of record, doesn't
  verify;
- CI can check signatures with only the committed public keys, so a pull request can't steal a
  secret.

Agents run as your own user, without a container, so it is only as strong as what keeps them
away from three things:
- **The private key** (`~/.config/mirai/signing.ed25519`; encrypted with your passphrase since unit 29b).
- **The human-only commands** (`mirai approve | drop | key`). The real-terminal check stops piped
  input and headless runs. It doesn't stop a process that drives a terminal itself, such as
  `expect`, `script`, `unbuffer` or a pty.
- **Git's own files.** Locally, "committed on the integration branch" means "on your local
  branch". A process that can move that ref could make its own key look committed.

The deny rules and the sandbox (units 13 and 18) close those paths for headless agents. Your own
sessions have no sandbox, and a wrapped command there read the key and signed through `script`
(unit 18e, probed). Since unit 29b, your key file is encrypted: a session that reads it gets nothing
it can sign with, and one that drives a terminal doesn't know your passphrase (probed: R1). That
holds while your key is locked (`signing.unlock = "each"`, or outside the time you set). The final check for code is CI, against the
remote's base commit (unit 54), but a stolen key's signature passes it.

A signature's time is written by the signer. Someone who holds a revoked key could backdate a
signature: revocation stops later use, not a stolen key used with an old date. CI can also
compare against commit times.
