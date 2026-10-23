---
unit: "06"
date: 2026-10-23
reviewers: Tech Lead, Architect (independent, read-only)
verdicts: CHANGES REQUESTED, CHANGES REQUESTED; all blocking and should-fix findings applied
---

# Unit 06 — Review

Both reviewers confirmed the cryptographic core:
- **Ed25519** through node:crypto, with key ids derived from the raw key.
- **What's signed:** the canonical JSON of the whole line, with `seq`, `key_id` and `ts`.
- **Malleability:** OpenSSL refuses a non-canonical S.
- **Canonical JSON** is in practice the same as RFC 8785, so CI on another machine gets the same
  bytes.
- **Revocation** by date.
- **The library** needs no store, so the hooks and CI can use it.

Both found the same **blocking hole in the trust root** (1) and the same **weak status
cross-check** (2), each verified with a probe.

## Applied in unit 06

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **Blocking: the work tree chose which branch's keys verify.** A branch with its own `.pub` plus `integration_branch = "<that branch>"` in the work-tree config opened the same store and showed a forged line as "by you (signed)" | both | The integration branch is pinned in `store.json` at creation; keys come only from it; a config naming another branch is refused (`branch-changed`, exit 4) | T4b |
| 2 | **Blocking: the status cross-check didn't compare the state.** After a signed `drop`, `status.json` edited back to `ready-for-dev` (seq unchanged) still showed "by you (signed)"; a file could also be rolled back to an older signed seq; the check lived only in `mirai status` | both | `checkStatusAgainstJournal` in the store: a human status must point at the ticket's latest line, yours, with the same state and park reason; a script status can't be older or disagree. Used by `readTicketStatus({ events })`, status, approve and drop | T10 |
| 3 | Signed lines weren't bound to a repo or purpose: with one key per machine, a line copied from repo A's journal verified in repo B | both | A required, unstored context (`mirai/journal/2:<repo-id>`) in every signature | T3, T10b |
| 4 | The store accepted moves only you may make when written by `script` (e.g. `ready-for-dev` from draft) | Architect | Refused (`human-only`); `dropped` always needs you; a human write must be an allowed move (unit 04's `move()`) | T9 |
| 5 | `approve` recorded the approval and then failed the move when the status changed mid-prompt; a retry added a second approval | both | The move's checks run first, inside the same step; the file is re-checked after your confirmation | T8b |
| 6 | Bad dates failed open: a revocation with `2026-13-01` revoked nothing; a signature dated `2099-99-99` passed a revoked key; `key show` crashed on it | Tech Lead | Real times only (`validTime`); an unreadable revocation date revokes from the start | T2, T3, T5b |
| 7 | A second repo couldn't be set up: `key new` refused on a machine with a key, and only `--replace` (which breaks every other repo) wrote a `.pub` | Architect | `key new` publishes this machine's existing key into the repo | T1 |
| 8 | Key reads were slow (about 1.4 s with 21 key files, held under the journal lock) and fixed to `refs/heads/<branch>`, dropped problem files silently, and resolved a different ref than the identity | Architect | One `ls-tree` and one `cat-file --batch`, cached by tree id; `readCommittedKeys(checkout, ref)` takes any ref or commit and lists problems; the same local-then-`origin` resolution as the identity; hints mention pulling | T3, T4 |
| 9 | Deleting a `.pub` (or a `.revoked`) on main bricked every journal read | both | The key-change rule refuses editing or deleting a `.pub` and deleting a `.revoked` ("revoke, never delete"); documented | T11 |
| 10 | The drop note wasn't signed | Tech Lead | `status_written` carries an optional `note` | T9 |
| 11 | Base64 malleability: a changed unused bit in the last character still verified | Tech Lead | The signature text must be the canonical encoding of its 64 bytes | T3 |
| 12 | The honest limit was only in a code comment, and didn't name terminal emulators (`expect` drives `approve` with no human, verified) or local ref moves | both | `docs/signing.md`, the comment and the spec state both; units 13, 18 and 54 are the guards | — |
| 13 | Approved-file and prompt gaps: a FIFO swapped in could hang the open; `.git/` paths were accepted; `.mirai` itself wasn't checked for a link; no answer length cap; bidi and U+2028 passed; a wrong confirmation exited 5 | Tech Lead | Same dev and inode, regular file, `O_NONBLOCK`; `.git/` refused; `.mirai` checked; 2000-character cap; invisible characters refused; a wrong confirmation is exit 1 "cancelled" | T7, T12 |
| 14 | `signHumanMove` (promised by the spec) was missing; `key show` had no fingerprint; "by you" was shown for any committed key; canonical JSON accepted sparse arrays; D-17 and `03` still said `<machine>.pub` and `key add \| rotate \| revoke` | both | `signHumanMove` in `tickets.js`; a SHA-256 fingerprint; "by you" only for your own key id, else "signed by k-…"; holes refused; the design wording updated | T1, T2, T10 |

**The three choices:**
- **`key new` and `key revoke` need a TTY:** both agree.
- **No `signature_seq` field:** acceptable, now that the full check in #2 is in the store.
- **Approval before the move:** the order is fine, now that the checks run first (#5).

## Notes for later units

| Unit | Note |
|---|---|
| 13, 18 | Deny agents `mirai approve \| drop \| key`, and `expect`, `script`, `unbuffer` and python `pty`; deny `.git` writes and `git update-ref` (a moved local integration branch makes a key look committed); red-team all three |
| 21, 44 | Approval `kind` is `ticket` only. Adding `plan` or `document` bumps the journal schema, so an older MIRAI says "newer", not "corrupt". Document approvals use their own context (`mirai/approval/1:<repo-id>`) |
| 25, 54 | Proof records use their own context. Refuse duplicate JSON keys in signed files (`JSON.parse` keeps the last one). CI reads keys at the base commit (`readCommittedKeys(checkout, <sha>)`) and compares `revoked_at` with commit times |
| 26 | The pre-push hook calls `checkKeyChange` with each commit's `changes` (`git diff --name-status`), and reads keys through the store's pinned branch |
| 28 | Resume (`stopped → running`) needs a signed human event: `by: human` on `run_state`, or a signed journal line the run log points at |
| 29 | `doctor` reports `readCommittedKeys(...).problems`, repairs a status file from its journal line, and changes the pinned integration branch (with your signature) |
| — | A deleted or edited `.pub` already on main still makes the journal unreadable (fail closed); `doctor` (29) needs a non-throwing read to report which lines it signed |
