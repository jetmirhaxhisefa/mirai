---
unit: "06"
name: signing
date: 2026-10-23
node: v22.23.2
result: 102 / 102 pass (earlier units' 88 + unit 06's 14), after the review fixes; 3 full runs in a row green
---

# Unit 06 — Test results

## Run

`npm test` (scoped to `test/**/*.test.js`), after the review fixes (`review.md`):

```
ok 52 - T1: keys: a private key 0600 in a 0700 folder, the public key in .mirai/keys/, a derived id, never shown
ok 53 - T2: canonical JSON: key order never changes the bytes; non-JSON values are refused
ok 54 - T3 + T5: verification needs only the public key; revoked keys and renamed files fail
ok 55 - T5b: a revocation with no real date revokes from the start
ok 56 - T4: public keys count only from the integration branch, never the work tree or another branch
ok 57 - T4b: the integration branch is pinned in the store: a work-tree config pointing at a branch with another key is refused
ok 58 - T6: an approval made before an edit fails after it
ok 59 - T7 + T8: approve needs a real terminal; it asks, signs the approval and the move in one step
ok 60 - T8b: a move refused at the last moment leaves no approval behind
ok 61 - T9: drop: signed from draft, ready-for-dev and built; refused from in-progress; same terminal rule
ok 62 - T10: the store: unsigned, tampered, moved and revoked human lines fail closed; status shows who signed
ok 63 - T10b: a signed line copied into another repo's journal doesn't verify there
ok 64 - T11: the key-change rule
ok 65 - T12: no key, or a key not committed yet: approve says what to do; key show says "not committed yet"
# tests 102
# pass 102
# fail 0
```

Three full runs in a row: 102/102 each, about 43 s.

**Earlier tests changed:**
- **`test/cli/cli.test.js` T14:** the command list now includes `approve`, `drop` and `key`.
- **`test/store/store.test.js`:**
  - T6 expects schema-2 lines;
  - T9 expects the clearer "needs your signing key" message;
  - T10 pins the event list with `approval`;
  - two tests now write `in-progress` instead of `ready-for-dev` as a script: a script may no
    longer make that move, only `mirai approve` (review #4);
  - T9's open-MR case writes `draft`, for the same reason.

**Isolation:** every test uses a temporary `HOME`, so `~/.config/mirai` is temporary too, and
temporary git repos. Nothing touched the real key folder.

## The roadmap's "done when", mapped

| Done when | Test |
|---|---|
| refuses without a TTY | T7 (stdin, stdout or both not a TTY; also the real `bin/mirai.js` with piped input) |
| an approval made before a document edit fails verification after it | T6 |
| verification works with only the public key | T3 (a separate process with only the committed `.pub`) |
| a signature by a revoked key id fails | T3 + T5, T5b, T10 |
| a new key added by a non-human commit is refused | T11 |
| D-17 is restated honestly | `docs/signing.md`, the comment in `src/sign/sign.js`, the spec |

## What came up while testing

1. **`git cat-file --batch` failed** with `encoding: 'buffer'`. Node uses that encoding for a
   string `input` too, and "buffer" isn't a text encoding. The input is now passed as a Buffer.
2. **T10's journal count was my mistake** (3 lines, not 4). The test is fixed.
3. **The base64 "twin" check** first built a character that wasn't valid base64, so it could pass
   without testing anything. It now flips an unused bit of the last character's 6-bit value, and
   asserts the bytes are equal before checking the refusal.
