---
unit: "06"
name: signing
status: approved 2026-10-23
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 06; D-15, D-16, D-17, D-30, D-34, D-38, D-52; R2-C5, R2-M11, R3-M10, AR3-10, R-M18
depends_on: ["04", "05a", "05b"]
---

# Unit 06 — Signing, `mirai approve`, `mirai drop`

## Why

Some moves only you may make: approving a ticket, dropping one, resuming a stopped run,
unparking. Until now the store simply refused every `by: "human"` line. This unit makes those
moves possible, and **checkable**: each one is signed with a key only you hold, so an agent
can't approve its own work by writing a line, and CI can check a signature without holding any
secret (D-17).

**Roadmap "done when":**
- refuses without a TTY;
- an approval made before a document edit fails verification after it;
- verification works with only the public key;
- a signature by a revoked key id fails;
- a new key added by a non-human commit is refused;
- D-17 is restated honestly.

## Scope

**In:**
- **Keys:** an Ed25519 key pair through `node:crypto` (still zero dependencies); key ids; the
  committed public key; the committed revocation list; `mirai key new | show | revoke`.
- **The signing library:** canonical JSON, signing, verifying against public keys from the
  integration branch, revocation by date.
- **Signed human lines in the store:** the journal accepts `by: "human"` only with a valid
  signature, on write and on read. The status file may say `written_by: "human"`.
- **A new journal event,** `approval`: what was approved (its content hash), your decision
  (accepted as is / edited / rejected), an optional one-line reason (R-M18).
- **`mirai approve <ticket> --file <path>`** (draft → ready-for-dev) and **`mirai drop <ticket>`**,
  in a real terminal only.
- **The key-change rule** as a function, for the hooks and CI to call: a MIRAI commit may never
  touch `.mirai/keys/`.

**Out:**
- **Document approvals committed on the docs branch** (`approvals/`, via `git commit-tree`, D-06):
  they come with the document flow in Milestone B. In A, approvals are signed journal events. The
  same library signs both.
- **`mirai unpark`, `mirai handover`, `mirai resume`, the production go/no-go:** their own units
  (20/28, 46, 28, 60). They call this unit's `signHumanMove`.
- **Plan approvals:** unit 21 (the plan gate), with this library.
- **`mirai inbox`:** Milestone B (D-34).
- **The key MR rules in CI** (`mirai-verify`, a label you set, self-signature): unit 54. This
  unit gives the rule function that CI and the `pre-push` hook (unit 26) call.
- **Denying agents the key file:** the deny rules (unit 13) and the red-team test that reads it
  (unit 18).
- **Keychain storage** of the private key: Later (D-17 calls it optional).

## Keys

```
~/.config/mirai/                     # yours only (0700), denied to agents
  signing.ed25519                    # private key, PKCS#8 PEM, 0600
  signing.json                       # { key_id, label, created_at }
<project>/.mirai/keys/
  <key-id>.pub                       # public key, SPKI PEM, committed
  <key-id>.revoked                   # { revoked_at, reason? }, committed
```
- **Key id:** `k-<16 hex>`, the first 16 hex characters of the SHA-256 of the raw public key.
  It's derived, so a file can't claim another key's id.
- **One key per machine** (D-52). The `label` (default: the host name) is for reading only.
- **Private key files:** created 0600 in a 0700 folder, opened without following symbolic links,
  and refused when they're group- or world-readable or not yours (05a's checks). The key never
  appears in output, errors or logs.
- **`mirai key new`:**
  - makes the pair, writes the private key, and writes `.mirai/keys/<key-id>.pub` into the
    project;
  - **you commit and push that file by hand.** This is the bootstrap path: the first key enters
    the integration branch through your own commit, not a MIRAI one;
  - refuses when a private key already exists. Rotating means `new` with `--replace`, which keeps
    the old file as `signing.ed25519.old-<date>`, then `revoke` of the old id.
- **`mirai key show`:** the key id, label and fingerprint, and whether the public key is on the
  integration branch yet ("not committed yet: commit and push `.mirai/keys/<id>.pub`").
- **`mirai key revoke <key-id> [--reason <text>]`:** writes `.mirai/keys/<key-id>.revoked` with
  today's time, for you to commit.

## Verifying: which public keys count

- **Public keys come from the integration branch, never from the work tree:**
  `git ls-tree` and `git cat-file` on `refs/heads/<integration_branch>:.mirai/keys/`. Any branch
  can edit the work tree's `.mirai/keys/`, so a key added there doesn't count until it's merged
  (D-17: CI uses the base commit's keys; this is the same rule locally).
- **Read-only git**, as in 05a, with the same fixed environment.
- **A signature is valid only when:**
  - its `key_id` names a public key on the integration branch;
  - the key id matches the key (it's derived, so a renamed file fails);
  - the key isn't revoked at the signature's time (`ts` ≥ `revoked_at` fails);
  - the Ed25519 signature checks out over the canonical bytes.
- **Honest limit, stated in code and docs:** `ts` is written by the signer. Someone who holds a
  revoked private key could backdate a signature. Revocation protects against later use, not
  against a stolen key used with an old date. CI (unit 54) can also compare against commit times.

## What gets signed

- **Canonical JSON:** object keys sorted, no whitespace, UTF-8. Only plain JSON values are
  allowed (no `undefined`, functions, non-finite numbers). Two equal objects always give the same
  bytes.
- **A signature record** is added to the signed object: `signature: { alg: "ed25519", key_id,
  ts, sig }`, where `sig` is base64 over the canonical bytes of the object **without** its
  `signature` field but **with** `key_id` and `ts`.
- **Human journal lines:** the whole event (`schema_version`, `seq`, `ts`, `type`, `by`, fields)
  is signed. It's signed inside `withSeq`, after the number is taken, so the `seq` is covered.
  A signed line can't be moved to another place in the journal.
- **Approvals sign the content hash:** `content_hash` is the SHA-256 of the file's bytes.
  `verifyApproval(event, bytesNow)` fails when the file changed after you approved it
  (R2-M11).

## The `approval` event (journal, privileged, by human, signed)

| Field | Meaning |
|---|---|
| `item` | the ticket key (later: a document or plan id) |
| `kind` | `ticket` (later units add `plan`, `document`, …) |
| `path` | the file, relative to the repo |
| `content_hash` | `sha256:<hex>` of the file's bytes |
| `decision` | `accepted`, `edited` or `rejected` (D-34, D-38's M6 label) |
| `reason` | optional, one line, only with `edited` or `rejected` |
| `answered_after_s` | seconds from the question to your answer (M1, R-M18) |

## Commands

**`mirai approve <ticket> --file <path>`:**
- **Needs a real terminal:** stdin and stdout must both be TTYs, or it's refused with exit 5
  (`NEEDS_HUMAN`): "approve in a real terminal". There's no flag to skip it.
- **The file:** a regular file inside the repo (no symbolic link out), at most 1 MB. It's shown
  as its path and content hash.
- **The question:** "accepted as is / edited / rejected?" (`a`/`e`/`r`). Then, for `e` or `r`,
  an optional one-line reason.
- **Confirmation:** you type the ticket key back, a small deliberate friction (D-17).
- **Then, in one `withSeq` step:**
  - the signed `approval` event;
  - for `accepted` or `edited`: the ticket's status `draft → ready-for-dev`, signed, through
    unit 04's `move()` and 05a's `writeTicketStatus` with `expectSeq`;
  - for `rejected`: no move; the ticket stays `draft`.
- **No key, or a key not yet on the integration branch:** refused with exit 3 and a hint
  (`mirai key new`, or "commit and push `.mirai/keys/<id>.pub`").

**`mirai drop <ticket> [--note <text>]`:**
- the same TTY rule and typed confirmation;
- a signed move to `dropped` from the states where unit 04 allows it (`draft`, `ready-for-dev`,
  `built`). Anything else is refused with exit 4.

**`mirai status`** shows `by you (signed, k-…)` for human-written states.

## The store changes

- **Writing:** `appendEvent` / `withSeq` accept `by: "human"` only together with a signing key.
  The line is signed under the lock, and the result is verified before it's written.
- **Reading:** `readJournal` verifies every `human` line against the integration branch's keys.
  An unsigned, badly signed or revoked line fails closed (`StoreError`, a `doctor` hint), as a
  corrupt line does. **Privileged types still need `by: "script"`, except `status_written` and
  `approval`,** which may also be `human` and signed.
- **Status files:** `written_by: "human"` is allowed when the status write is a signed human
  move. The status file carries `signature_seq`, pointing at the signed journal line.
- **`JOURNAL_SCHEMA_VERSION` becomes 2,** because a new event type is added (05a review note: an
  older MIRAI then says "newer MIRAI" instead of `unknown-event`). Version-1 journals read
  unchanged.

## The key-change rule (for units 26 and 54)

`checkKeyChange({ changedPaths, hasTrailer, miraiCommitter })`:
- refused when any path under `.mirai/keys/` changed in a commit with the `Mirai-Ticket` trailer
  or MIRAI's committer identity ("a new key added by a non-human commit is refused");
- refused when a key file changed together with anything outside `.mirai/keys/` (a key change is
  its own commit, D-17's key MR);
- allowed otherwise. Returns `{ ok, reason }`.

## Honest restatement of D-17 (written into `docs` and the code comment)

This resists accidental and casual forgery: an agent can't approve by writing a line or
editing a status file. Agents run as your own user (no container), so the protection is only as
strong as the deny rules and the sandbox around `~/.config/mirai/` (units 13, 18). A gap there
would let a determined agent sign as you. The TTY check stops headless agents, not a determined
one that can open a terminal. You approve from a terminal, not by telling an agent "approved",
on purpose.

## Errors

- **No TTY:** exit 5 (`NEEDS_HUMAN`).
- **No key, or not committed yet:** exit 3.
- **An illegal move:** exit 4.
- **A bad signature on read:** `StoreError` (exit 3, `doctor` hint).
- **A key change refused:** exit 4.

## Files

```
src/sign/canonical.js      # canonical JSON
src/sign/keys.js           # key pair, key id, private key file, public keys from the integration branch, revocations
src/sign/sign.js           # sign, verify, verifyApproval, signHumanMove
src/sign/key-rule.js       # checkKeyChange
src/store/journal.js       # + human lines (signed), approval event, schema 2
src/store/tickets.js       # + written_by human with signature_seq
src/cli/tty.js             # the TTY check and prompts, on io.stdin
src/cli/commands/key.js    # mirai key new | show | revoke
src/cli/commands/approve.js
src/cli/commands/drop.js
bin/mirai.js               # io gains stdin
test/sign/*.test.js
```

## Tests

| # | Test |
|---|---|
| T1 | Keys: `key new` writes a 0600 private key in a 0700 folder and the public key into `.mirai/keys/`; the key id is derived; a second `new` is refused without `--replace`; a group-readable or symlinked private key is refused; the private key never appears in any output |
| T2 | Canonical JSON: key order doesn't change the bytes; `undefined`, functions and non-finite numbers are refused |
| T3 | **Verification works with only the public key:** a signature made with the private key verifies in a process that has only the committed `.pub` |
| T4 | Public keys come from the integration branch: a key only in the work tree, or only on another branch, doesn't verify; after the key is committed on the integration branch, it does |
| T5 | **A revoked key fails:** a signature dated after `revoked_at` fails; one dated before passes; a renamed `.pub` (id mismatch) fails |
| T6 | **An approval made before an edit fails after it:** `verifyApproval` passes on the same bytes, fails after one byte changes |
| T7 | **`approve` refuses without a TTY** (exit 5), with stdin or stdout not a TTY; with a scripted TTY it asks, takes `a`/`e`/`r` and the reason, needs the typed ticket key, and writes the signed approval and the move in one step |
| T8 | `rejected` writes the approval and no move; `edited` moves and keeps the reason; a wrong typed key cancels with nothing written |
| T9 | `drop`: allowed from draft, ready-for-dev and built (signed); refused from in-progress (exit 4); same TTY rule |
| T10 | The store: an unsigned `human` line, a tampered signed line (one field changed), a line moved to another seq, and a line signed by a revoked key all fail closed on read; a valid one reads, and `mirai status` shows "by you (signed, k-…)" |
| T11 | **The key-change rule:** a key file in a trailer commit, or by MIRAI's committer, is refused; a key file mixed with other paths is refused; a key-only human commit is allowed |
| T12 | No key, or a key not on the integration branch yet: `approve` exits 3 with the right hint; `key show` says "not committed yet" |

All tests use a temporary `HOME` (so `~/.config/mirai` is temporary too) and temporary git repos.
The TTY is simulated through `io.stdin` / `io.stdout` with `isTTY` and scripted answers; T7
also checks the real `bin/mirai.js` refuses when piped.

## Decisions (2026-10-23)

You kept the keys after asking why they're needed: they tell your decisions apart from anything
else that can write a file, bind an approval to exact content, and make branch-carried proofs
checkable in CI without a secret. The four open points were approved as recommended:

1. **Public keys come from the integration branch**, never the work tree, for local checks too.
2. **You type the ticket key back** to confirm an approve or drop.
3. **`approve` in Milestone A covers tickets only;** documents and plans come with their units.
4. **Rotation is `key new --replace` plus `key revoke`.**

## Changes after testing and review (2026-10-23)

Recorded here so the text above stays as approved; `test-results.md` and `review.md` give the
evidence. These replace the text above where they differ.

- **The integration branch is pinned in `store.json`** when the store is created. Keys come from
  that branch: its local ref, or `origin`'s remote-tracking branch when there is no local one,
  as the repo identity does. A work-tree config naming another branch is refused
  (`branch-changed`, exit 4). Without this, a branch with its own key plus an edited config
  could forge a "signed by you" line.
- **Signatures bind a context** that isn't stored: `mirai/journal/2:<repo-id>` for journal lines.
  A line copied into another repo's journal, or passed off as another kind of record, doesn't
  verify. `signObject` and `verifySigned` require the context.
- **Status files are checked against the journal** (`checkStatusAgainstJournal`, used by
  `readTicketStatus` with `events`, `mirai status`, `approve` and `drop`):
  - a human-written status must point at the ticket's latest status line, which must be yours
    and say the same state and park reason;
  - a script-written status must not be older than that line, or disagree with it.

  This replaces the spec's `signature_seq` field: no status-schema bump is needed.
- **The store refuses a script writing a move only you may make** (approve, drop, unpark, a grant
  after an MR), and `dropped` always needs you. A human write must be an allowed move (unit 04's
  `move()`). A ticket's first `ready-for-dev` therefore always comes from `mirai approve`.
- **`approve` runs the move's checks before the approval** (inside the same step), so a refused
  move leaves no approval behind. It also refuses if the file changed while you were answering.
- **`status_written` carries `note`,** so a signed move's note is signed.
- **`mirai key new` on a machine that already has a key** writes that key's `.pub` into this repo
  (one key per machine, several repos). `--replace` rotates. `key new` and `key revoke` need a
  real terminal. `key show` prints the fingerprint.
- **Keys:**
  - read with one `ls-tree` and one `cat-file --batch`, cached by tree id;
  - `readCommittedKeys(checkout, ref, env)` takes any ref or commit (CI's base commit) and lists
    the files that verify nothing, for `doctor`;
  - a revocation with no real date revokes from the start;
  - times must be real (no month 13);
  - the base64 signature must be canonical.
- **The key-change rule** takes `changes: [{ path, status }]`: keys are only added or revoked; a
  `.pub` is never edited or deleted, and a `.revoked` is never deleted.
- **Approved files** must be regular files in the work tree (not under `.git/`), the same file
  that was checked. Answers longer than 2000 characters, or with invisible or bidi characters,
  are refused. A wrong confirmation cancels with exit 1.
- **`signHumanMove`** lives in `src/store/tickets.js` (the store's write path), not `sign.js`,
  which would make an import cycle.
- **The honest restatement** is in `docs/signing.md`. It now names terminal emulators (`expect`,
  `script`) and local ref moves as limits, with units 13, 18 and 54 as the guards. D-17 and `03`
  now say `<key-id>.pub` and `mirai key new | show | revoke`.
