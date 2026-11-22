import { contentHash } from '../../sign/sign.js';
import { plain } from '../../status/text.js';
import { hostConfig } from '../../ship/host.js';
import { blobAt, remotes } from '../git.js';
import { readJournal } from '../journal.js';

// Document links (unit 38, Scope 7; unit 32's decision 8): every time MIRAI writes, changes or
// approves a document, its last output line gives the document's full path, so you open it with
// one click. Once the file is on a pushed branch with these bytes, the line also gives its GitHub
// (…/blob/<branch>/<path>) or GitLab (…/-/blob/<branch>/<path>) link, built from the remote.

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

// The host's web address of a file (or a folder, `tree`) on `branch`, or null when the remote
// isn't on a host MIRAI knows.
export function hostLink({ config, remoteUrl, branch, path, folder = false }) {
  let h;
  try {
    h = hostConfig(config, remoteUrl);
  } catch {
    return null;
  }
  const kind = folder ? 'tree' : 'blob';
  const b = encodePath(branch);
  return h.name === 'gitlab' ? `${h.hostUrl}/${h.repo}/-/${kind}/${b}/${encodePath(path)}` : `${h.hostUrl}/${h.repo}/${kind}/${b}/${encodePath(path)}`;
}

// The pushed branch that holds `rel` with exactly `bytes`: the integration branch, when the
// remote-tracking copy of it has them (a merged docs MR, a lone ticket merged with its code), else
// the docs branch of the last docs merge request MIRAI published with them. Null otherwise.
export function pushedBranchOf({ store, config, rel, bytes, events = null }) {
  if (!rel || !bytes) return null;
  const hash = contentHash(bytes);
  const integration = config.git?.integration_branch ?? store.branch;
  const tracked = blobAt(store.checkout, `refs/remotes/origin/${integration}`, rel, store.gitEnv);
  if (tracked && contentHash(tracked) === hash) return integration;
  let branch = null;
  for (const e of events ?? readJournal(store).events) {
    if (e.type === 'docs_published') branch = (e.files ?? []).some((f) => f.path === rel && f.content_hash === hash) ? e.branch : null;
    if (e.type === 'docs_merged' && branch) branch = integration;
  }
  return branch;
}

// The closing line for a document: its full path, then its host link once pushed. `rel` is the
// path relative to the store's base; a local store's document has no link (it never leaves the Mac).
export function documentLine({ store, config, conn = null, abs, rel = null, bytes = null, events = null }) {
  let link = null;
  if ((!conn || conn.kind === 'repo') && rel && bytes) {
    try {
      const branch = pushedBranchOf({ store, config, rel, bytes, events });
      const remoteUrl = branch ? remotes(store.checkout, store.gitEnv).get('origin') ?? null : null;
      link = branch && remoteUrl ? hostLink({ config, remoteUrl, branch, path: rel }) : null;
    } catch {
      link = null;
    }
  }
  return `${plain(abs)}${link ? `   ${link}` : ''}`;
}
