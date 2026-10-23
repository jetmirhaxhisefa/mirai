# Signing in MIRAI

Some moves only you may make: approving a ticket, dropping one, resuming a stopped run,
unparking. MIRAI signs each of them with a key only you hold, so it can tell your decisions
apart from anything else that writes a file (decision D-17).

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
- Both run only in a real terminal; a piped or agent-run command is refused.

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
- **The private key** (`~/.config/mirai/signing.ed25519`).
- **The human-only commands** (`mirai approve | drop | key`). The real-terminal check stops piped
  input and headless runs. It doesn't stop a process that drives a terminal itself, such as
  `expect`, `script`, `unbuffer` or a pty.
- **Git's own files.** Locally, "committed on the integration branch" means "on your local
  branch". A process that can move that ref could make its own key look committed.

The deny rules and the sandbox (units 13 and 18) close those paths for agents. The final check is
CI, against the remote's base commit (unit 54).

A signature's time is written by the signer. Someone who holds a revoked key could backdate a
signature: revocation stops later use, not a stolen key used with an old date. CI can also
compare against commit times.
