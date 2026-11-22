import { lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { MiraiError } from '../../cli/errors.js';
import { REGISTRY_DIR } from '../../cli/commands/lint.js';
import { EXIT } from '../../cli/exit-codes.js';
import { identity } from '../../agent/commit.js';
import { docsPushScan } from '../../hooks/pre-push.js';
import { loadRegistry } from '../../config/registry.js';
import { lintPaths, projectOf } from '../../lint/lint.js';
import { cleanTitle, hostFor } from '../../ship/host.js';
import { hostWords, wordsOfHost } from '../../ship/words.js';
import { contentHash } from '../../sign/sign.js';
import { plain } from '../../status/text.js';
import { projectOverlays } from '../../trust/overlays.js';
import { snapshot, trustedConfig } from '../../trust/snapshot.js';
import { catBlobs, changedNames, commitOf, docsCommit, isAncestor, lsTree, mergeBase, pushBranch, remotes, setDocsBranch } from '../git.js';
import { openStore } from '../home.js';
import { appendEvent, readJournal } from '../journal.js';
import { checkInitiative, readUnder } from './common.js';
import { openDocsStore } from './index.js';
import { approvalGaps, documentRows } from './state.js';

// The docs merge request (unit 38, Scope 4; Jet's decisions 1 and 3). One per initiative:
// - `mirai docs publish <initiative>` commits the initiative's folder under the docs root on
//   `docs/<initiative>` (made from the integration branch on its first publish), without touching
//   your work tree or current branch, pushes it, and opens the merge request through the host
//   (GitHub or GitLab, 27a/27b). A later publish updates the same branch and merge request. Its
//   description names each document with its approval state.
// - Documents only: a diff that touches anything outside the initiative's folder is refused before
//   the push, listing the paths.
// - `mirai docs merge <initiative>` merges it, pinned to its head, once every document in it has
//   your signed approval matching its file at that head, the lint is clean, and the epic's signed
//   approval covers the ticket set. Your signed approvals are the gate; there is no second question.
//   The host still waiting (checks running, a reviewer) leaves it open, with what it waits for.
// The journal gets `docs_published` and `docs_merged`. Unit 45's ticket-set approval calls
// docsMerge too.

const DOC_MAX = 1024 * 1024;
const FILES_MAX = 500;
const fail = (message, code, hint, exitCode = EXIT.BLOCKED) => Object.assign(new MiraiError(message, exitCode), { code, ...(hint ? { hint } : {}) });
export const docsBranchOf = (initiative) => `docs/${initiative}`;

// What both commands start from: the store (repo only), the trust root's config, the host.
function setup({ cwd, env, initiative, hostOf, now }) {
  checkInitiative(initiative);
  const store = openStore({ cwd, env });
  const trust = snapshot({ cwd, env, now });
  const config = trustedConfig(trust);
  const conn = openDocsStore({ store, config });
  if (conn.kind !== 'repo') return { local: true, conn, store, config };
  const remoteUrl = remotes(store.checkout, store.gitEnv).get('origin') ?? null;
  const host = hostOf({ config, remoteUrl, store, env, root: store.checkout });
  return { store, trust, config, conn, host, remoteUrl, folder: `${conn.docsRoot}/${initiative}`, branch: docsBranchOf(initiative), integration: config.git.integration_branch };
}

// The initiative's files in the work tree: [{ path (repo path), bytes }]. Every entry must be a
// regular file (a link or a folder other than tickets/ is refused: documents are real files).
function folderFiles(conn, initiative) {
  const dir = conn.dir(initiative);
  let info;
  try {
    info = lstatSync(dir);
  } catch {
    throw fail(`there is no initiative ${initiative}: ${conn.docsRoot}/${initiative}/ doesn't exist`, 'unknown-initiative', `an initiative is a folder under the docs root (${conn.docsRoot}/)`, EXIT.USAGE);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) throw fail(`${conn.docsRoot}/${initiative} isn't a real folder`, 'not-folder', 'documents are real files in a real folder, not links');
  const out = [];
  const walk = (abs) => {
    for (const name of readdirSorted(abs)) {
      const p = join(abs, name);
      const st = lstatSync(p);
      const rel = conn.relOf(p);
      if (st.isSymbolicLink()) throw fail(`${rel} is a symbolic link; nothing was published`, 'link-in-folder', 'documents are real files: replace the link with the file');
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) {
        if (st.size > DOC_MAX) throw fail(`${rel} is larger than 1 MB; nothing was published`, 'too-large');
        out.push({ path: rel, bytes: readUnder(conn.base, p) });
      }
      if (out.length > FILES_MAX) throw fail(`${conn.docsRoot}/${initiative}/ holds more than ${FILES_MAX} files`, 'too-many');
    }
  };
  walk(dir);
  return out;
}
const readdirSorted = (d) => readdirSync(d).filter((n) => !n.startsWith('.')).sort();

// The docs-only rule (the roadmap's done-when): every path the docs branch changes against its
// base on the integration branch is inside the initiative's folder.
export function outsideFolder(names, folder) {
  return names.filter((n) => !n.startsWith(`${folder}/`));
}

// The merge request's description: each document with its approval state, from the journal.
function describe({ store, conn, initiative, files }) {
  const rows = documentRows({ store, conn, initiative });
  const byRel = new Map(rows.map((r) => [r.rel, r]));
  const lines = [`Documents of the initiative **${initiative}**, published by MIRAI (unit 38). Documents only: no code.`, '', '| Document | Type | Id | State |', '| --- | --- | --- | --- |'];
  for (const f of files) {
    const r = byRel.get(f.path) ?? (f.path.includes('/tickets/') ? { type: 'ticket', id: null, state: 'with its epic' } : { type: '—', id: null, state: '—' });
    lines.push(`| \`${f.path.replace(/[|`]/g, '')}\` | ${String(r.type ?? '—').replace(/[|`]/g, '')} | ${String(r.id ?? '—').replace(/[|`]/g, '')} | ${r.state} |`);
  }
  lines.push('', 'MIRAI merges this after your signed approvals: every document as it is here, and the epic approved with its tickets (`mirai docs merge`). Please don\'t push to this branch.');
  return lines.join('\n');
}

// `mirai docs publish <initiative>`. Returns { outcome: 'opened' | 'updated' | 'unchanged' |
// 'local', branch, head, mr: { number, url }, files: [{ path, state }], pushed }.
export async function docsPublish({ cwd, env, initiative, hostOf = hostFor, now = () => new Date() }) {
  const s = setup({ cwd, env, initiative, hostOf, now });
  if (s.local) return { outcome: 'local', initiative, message: `the local store keeps ${initiative}'s documents on this Mac only: publish does nothing (no branch, no ${hostWords(null).long}), and teammates can't see them` };
  const { store, config, conn, host, folder, branch, integration } = s;
  const w = wordsOfHost(host);
  const files = folderFiles(conn, initiative);
  if (!files.some((f) => /\.md$/i.test(f.path))) throw fail(`${folder}/ has no documents to publish`, 'nothing-to-publish', 'write the initiative\'s documents first (mirai-write)');
  host.checkAuth();

  // The base: the host's integration branch, which this clone must have.
  const tip = host.branchTip(integration);
  if (!tip) throw fail(`the host has no ${integration} branch`, 'base-not-pushed', `push ${integration} first`);
  if (!commitOf(store.checkout, tip, store.gitEnv)) throw fail(`the host's ${integration} has commits this clone doesn't`, 'fetch-first', `git fetch origin ${integration}, then run it again`);

  // The docs branch: MIRAI's own, here and on the host; a commit someone else pushed is never
  // overwritten.
  const local = commitOf(store.checkout, `refs/heads/${branch}`, store.gitEnv);
  const remote = host.branchTip(branch);
  if (remote && remote !== local && !(local && commitOf(store.checkout, remote, store.gitEnv) && isAncestor(store.checkout, remote, local, store.gitEnv))) {
    throw fail(`${branch} on the host is at ${remote.slice(0, 12)}, a commit MIRAI didn't push`, 'remote-moved', 'someone pushed to the docs branch: look at it on the host; MIRAI never overwrites it');
  }
  const parent = local ?? tip;
  const who = identity(env, config);
  const message = `Docs: ${initiative}\n\nThe documents of ${initiative}, published by MIRAI (mirai docs publish).\n`;
  const made = docsCommit(store.checkout, store.gitEnv, { parent, folder, files, message, ...who });
  const head = made.sha;

  // Documents only, checked on the commit about to be pushed: nothing has left the machine yet.
  const base = mergeBase(store.checkout, tip, head, store.gitEnv);
  const names = base ? changedNames(store.checkout, base, head, store.gitEnv) : [];
  const outside = outsideFolder(names, folder);
  if (!base || outside.length) {
    throw Object.assign(fail(`a docs ${w.long} carries documents only, and ${branch} changes ${outside.length ? `${outside.length} path${outside.length === 1 ? '' : 's'} outside ${folder}/: ${outside.slice(0, 20).join(', ')}` : `no history shared with ${integration}`}; nothing was pushed`, 'not-docs-only', `take those changes off ${branch} (they belong on a code branch), then publish again`), { paths: outside });
  }
  // 26a's push check: the same secret scan a code push gets, over what this push adds. A hit names
  // the pattern and the file, never the secret; nothing is pushed and the docs branch doesn't move.
  if (remote !== head) {
    const scan = docsPushScan({ cwd, env, head, remoteSha: remote });
    if (scan.outcome !== 'pass') {
      throw Object.assign(fail(`the push check refused ${branch}: ${scan.why}; nothing was pushed`, scan.outcome === 'secret' ? 'secret' : scan.outcome, scan.outcome === 'secret' ? 'take it out of the document (and replace it if it was real), then publish again' : 'publish fewer or smaller files at a time'), { findings: scan.findings });
    }
  }
  if (!made.same) setDocsBranch(store.checkout, branch, head, local, store.gitEnv);

  let pushed = false;
  if (remote !== head) {
    const p = pushBranch(store.checkout, host.pushUrl, branch, head, store.gitEnv, { helper: host.helper, ca: host.ca ?? null });
    if (!p.ok) throw fail(`the push of ${branch} was refused: ${p.why}`, 'push-refused', 'look at the branch on the host, then run it again');
    pushed = true;
  }

  const title = cleanTitle(`Docs: ${initiative}`);
  const body = describe({ store, conn, initiative, files });
  const mr = host.findMr(branch);
  if (mr?.state === 'closed') throw fail(`the docs ${w.long} for ${initiative} (${mr.url}) is closed`, 'mr-closed', 'closing it was your decision, and MIRAI never reopens it: reopen it on the host, then publish again');
  if (mr?.state === 'locked') throw fail(`the docs ${w.long} ${mr.url} is locked: GitLab is merging it`, 'mr-locked', 'run it again in a minute');
  let outcome;
  let number;
  let url;
  if (!mr || mr.state === 'merged') {
    const opened = host.openMr({ base: integration, head: branch, title, body });
    ({ number, url } = opened);
    outcome = 'opened';
  } else {
    ({ number, url } = mr);
    const same = (a, b) => String(a ?? '').replace(/\r\n/g, '\n').trim() === String(b ?? '').replace(/\r\n/g, '\n').trim();
    const edited = !same(mr.body, body) || !same(mr.title, title);
    if (edited) host.updateMr(number, { title, body });
    outcome = pushed || edited ? 'updated' : 'unchanged';
  }
  const fileHashes = files.map((f) => ({ path: f.path, content_hash: contentHash(f.bytes) }));
  appendEvent(store, { type: 'docs_published', by: 'script', item: initiative, branch, head, number, ...(url ? { url } : {}), files: fileHashes });
  const rows = new Map(documentRows({ store, conn, initiative }).map((r) => [r.rel, r.state]));
  return { outcome, branch, head, pushed, mr: { number, url }, files: files.map((f) => ({ path: f.path, abs: join(conn.base, f.path), state: rows.get(f.path) ?? (f.path.includes('/tickets/') ? 'with its epic' : '—') })), folder: conn.dir(initiative), config, store, remoteUrl: s.remoteUrl, words: w };
}

// The initiative's files at a commit: [{ rel, bytes }].
function filesAt(store, head, folder) {
  const entries = (lsTree(store.checkout, head, folder, store.gitEnv, { recursive: true, sizes: true }) ?? []).filter((e) => e.type === 'blob');
  if (entries.some((e) => e.mode === '120000')) throw fail(`the docs branch has a symbolic link in ${folder}/`, 'link-in-folder');
  const total = entries.reduce((n, e) => n + (e.size ?? 0), 0);
  const blobs = catBlobs(store.checkout, entries.map((e) => e.sha), store.gitEnv, { maxBytes: DOC_MAX, maxTotal: total + 1024 });
  return entries.map((e) => ({ rel: e.path, bytes: blobs.get(e.sha) ?? Buffer.alloc(0) }));
}

// The lint, as `mirai lint` runs it, on the files at the head: they are written to a private
// temporary folder and linted there with the project's approved overlays (unit 37), any skipped
// overlay reported. Returns { errors: [{ file, line, reason }], skipped: [lines] }.
function lintAt({ cwd, env, store, config, conn, files }) {
  const own = projectOverlays({ cwd, env, registry: loadRegistry(REGISTRY_DIR), checkout: store.checkout });
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'mirai-docs-lint-')));
  try {
    for (const f of files) {
      mkdirSync(join(tmp, dirname(f.rel)), { recursive: true });
      writeFileSync(join(tmp, f.rel), f.bytes);
    }
    const r = lintPaths({ root: tmp, paths: [join(tmp, conn.docsRoot)], files: null, registry: own.registry, docsRoot: conn.docsRoot, project: projectOf(config) });
    return { errors: r.problems.filter((p) => p.severity === 'error'), skipped: [...(own.note ? [own.note] : []), ...own.skipped.map((x) => x.line)] };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// `mirai docs merge <initiative>`. Returns { outcome: 'merged' | 'already-merged' | 'waiting' |
// 'local', … }; every refusal throws, naming the gap, with nothing merged.
export async function docsMerge({ cwd, env, initiative, hostOf = hostFor, now = () => new Date(), log = () => {} }) {
  const s = setup({ cwd, env, initiative, hostOf, now });
  if (s.local) return { outcome: 'local', message: `the local store keeps ${initiative}'s documents on this Mac only: there is no docs ${hostWords(null).long} to merge` };
  const { store, config, conn, host, folder, branch, integration } = s;
  const w = wordsOfHost(host);
  const { events } = readJournal(store);
  const published = events.filter((e) => e.type === 'docs_published' && e.item === initiative).at(-1);
  if (!published) throw fail(`${initiative} has no docs ${w.long} yet`, 'not-published', `run: mirai docs publish ${initiative}`);
  host.checkAuth();
  const live = host.mrState(published.number);
  if (live.state === 'merged') {
    if (!events.some((e) => e.type === 'docs_merged' && e.item === initiative && e.number === published.number)) {
      const sha = (x) => (typeof x === 'string' && /^[0-9a-f]{40}$/.test(x) ? x : null);
      const mr = host.findMr(branch);
      if (sha(mr?.mergeSha)) appendEvent(store, { type: 'docs_merged', by: 'script', item: initiative, number: published.number, head: live.head, merge_sha: mr.mergeSha });
    }
    return { outcome: 'already-merged', mr: { number: published.number, url: published.url }, store, config, conn, remoteUrl: s.remoteUrl, files: [], words: w };
  }
  if (live.state !== 'open') throw fail(`the docs ${w.long} ${published.url ?? w.ref(published.number)} is ${live.state}`, 'mr-closed', 'closing it was your decision: reopen it on the host, then run it again');
  // The head MIRAI checks is the one it published; anything else moved after MIRAI's check.
  if (live.head !== published.head) throw fail(`the docs ${w.long}'s head moved since MIRAI published it (${published.head.slice(0, 12)} → ${live.head.slice(0, 12)}); nothing was merged`, 'mr-head-moved', `someone pushed to ${branch}: look at it on the host; to publish the documents as they are here again: mirai docs publish ${initiative}`);
  if (!commitOf(store.checkout, live.head, store.gitEnv)) throw fail(`this clone doesn't have the docs ${w.long}'s head ${live.head.slice(0, 12)}`, 'fetch-first', `mirai docs publish ${initiative}`);

  // Documents only, again, at the head.
  const tip = host.branchTip(integration);
  const base = tip && commitOf(store.checkout, tip, store.gitEnv) ? mergeBase(store.checkout, tip, live.head, store.gitEnv) : mergeBase(store.checkout, store.branch, live.head, store.gitEnv);
  const outside = base ? outsideFolder(changedNames(store.checkout, base, live.head, store.gitEnv), folder) : ['(no shared history)'];
  if (outside.length) throw fail(`the docs ${w.long} changes ${outside.length} path${outside.length === 1 ? '' : 's'} outside ${folder}/: ${outside.slice(0, 20).join(', ')}; nothing was merged`, 'not-docs-only', `a docs ${w.long} carries documents only`);

  // Your signed approvals against the files at the head, and the lint.
  const files = filesAt(store, live.head, folder);
  const gaps = approvalGaps({ store, docs: files, events, words: w });
  const lint = lintAt({ cwd, env, store, config, conn, files });
  for (const line of lint.skipped) log(line);
  for (const p of lint.errors.slice(0, 20)) gaps.push({ path: `${p.file}:${p.line}`, gap: `a lint error: ${p.reason}`, hint: 'fix it, run mirai lint, approve again if it changed an approved file, then publish again' });
  if (gaps.length) {
    throw Object.assign(fail(`the docs ${w.long} for ${initiative} can't be merged yet: ${gaps.length} gap${gaps.length === 1 ? '' : 's'}; nothing was merged`, 'docs-gaps', 'each gap is listed above, with what closes it; then run mirai docs merge again'), { gaps });
  }

  // The host: checks failed refuses; still running, or a rule the host holds it by, waits.
  if (live.ci?.state === 'failed') throw fail(`the docs ${w.long}'s checks failed (${live.ci.checks.filter((c) => c.state === 'failed').map((c) => c.name).slice(0, 5).join(', ')}); nothing was merged`, 'ci-failed', `see the ${w.long} on the host`);
  const waitingFor = live.ci?.state === 'pending' ? `its checks are still running (${live.ci.checks.filter((c) => c.state === 'pending').map((c) => c.name).slice(0, 5).join(', ')})` : live.mergeable === null ? 'the host is still working out whether it can merge it' : live.mergeable !== true ? (live.why ?? 'the host can\'t merge it yet') : null;
  if (waitingFor) return { outcome: 'waiting', waitingFor, mr: { number: published.number, url: published.url }, head: live.head, words: w };

  let merged;
  try {
    merged = host.mergeMr(published.number, { head: live.head });
  } catch (err) {
    if (err.code === 'mr-head-moved') throw fail(`the docs ${w.long}'s head moved while MIRAI was merging it; nothing was merged`, 'mr-head-moved', `look at ${branch} on the host; then mirai docs publish ${initiative} and merge again`);
    throw err;
  }
  appendEvent(store, { type: 'docs_merged', by: 'script', item: initiative, number: published.number, head: live.head, merge_sha: merged.mergeSha });
  return { outcome: 'merged', mr: { number: published.number, url: published.url }, head: live.head, mergeSha: merged.mergeSha, files: files.map((f) => ({ path: f.rel, abs: join(conn.base, f.rel), bytes: f.bytes })), folder: conn.dir(initiative), store, config, conn, remoteUrl: s.remoteUrl, integration, words: w };
}
