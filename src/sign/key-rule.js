// The key-change rule (unit 06; D-17), for the pre-push hook (unit 26) and CI (unit 54): keys
// change only through your own commit that changes nothing else (the key MR), and they're only
// ever added or revoked: a public key that's deleted or edited would make every line it signed
// unreadable, and a deleted revocation would bring a revoked key back.
// `changes`: [{ path, status: 'A' | 'M' | 'D' }] (git's added / modified / deleted) for one
// commit; `hasTrailer`: it has the Mirai-Ticket trailer; `miraiCommitter`: it was made by
// MIRAI's git identity. Returns { ok, reason }.
export function checkKeyChange({ changes, hasTrailer = false, miraiCommitter = false }) {
  const touchesKeys = (c) => c.path === '.mirai/keys' || c.path.startsWith('.mirai/keys/');
  const keys = changes.filter(touchesKeys);
  if (keys.length === 0) return { ok: true, reason: 'no key change' };
  if (hasTrailer || miraiCommitter) return { ok: false, reason: 'a MIRAI commit may never change .mirai/keys/ (a new key added by a non-human commit is refused)' };
  if (keys.length !== changes.length) return { ok: false, reason: 'a key change must be its own commit, changing nothing outside .mirai/keys/' };
  const pubChanged = keys.find((c) => c.path.endsWith('.pub') && c.status !== 'A');
  if (pubChanged) return { ok: false, reason: 'a public key is never edited or deleted: revoke it (mirai key revoke) and add a new one' };
  const revocationGone = keys.find((c) => c.path.endsWith('.revoked') && c.status === 'D');
  if (revocationGone) return { ok: false, reason: 'a revocation is never deleted' };
  return { ok: true, reason: 'a key-only commit by you' };
}
