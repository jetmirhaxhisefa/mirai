import { COMMITTER_EMAIL } from '../agent/commit.js';
import { checkProofs } from '../proofs/check.js';
import { committedKeys } from '../sign/keys.js';
import { readToken } from '../sign/token.js';
import { TICKET_ID } from '../status/ticket-file.js';
import { pushScope } from '../store/branches.js';
import { changedNames, commitOf, hasTrackingRefs, isAncestor, mergeBase, rangeCommits } from '../store/git.js';
import { openStore } from '../store/home.js';
import { protectionRules } from '../trust/protected.js';
import { snapshot, trustedConfig, trustedRegistry } from '../trust/snapshot.js';
import { hooksState } from './install.js';
import { scanPush } from './secrets.js';

// The push check (unit 26a; D-15, D-16, Q3, R3-C2): one function, called by the pre-push hook
// (`mirai hook pre-push`) and, from unit 27, by MIRAI right before its own push (Jet's decision
// 5; MIRAI's git keeps hooks off). Everything it trusts comes from the integration branch's
// commit as a push sees it (pushBase): its config, its secret patterns, its public keys. For each
// ref the push updates:
// - a delete passes;
// - the hooks folder must be as MIRAI wrote it (`hooks-changed`; the hook's own call only);
// - the secret scan over what the push adds, on every branch (decision 3): `secret`,
//   `too-large-to-scan`;
// - a tag, or the integration branch itself, gets only the scan: your merge is the final gate;
// - scope (D-15, fail closed): only the branch's own commits since its merge-base count (D-15's
//   update from unit 22): the trailer, MIRAI's committer, a records file it changes, or the
//   registry. A human branch passes. In scope: no merge commit (`merge-commit`), every commit
//   carries the same ticket's trailer (`trailer-mix`), the ticket's branch record is there
//   (`no-branch-record`), and `gate check`'s proofs for the pushed commit (`no-proof`, `stale`,
//   `bad-record`).
// Returns { ok, base, refs: [{ ref, remoteRef, sha, scope, outcome, why, hint, findings? }] }.

const ZERO = /^0+$/;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
const MAX_COMMITS = 10_000;

// git's lines on the hook's stdin: [{ localRef, localSha, remoteRef, remoteSha }].
export function parseUpdates(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (line.trim() === '') continue;
    const [localRef, localSha, remoteRef, remoteSha, extra] = line.split(' ');
    if (extra !== undefined || !SHA.test(localSha ?? '') || !SHA.test(remoteSha ?? '') || !localRef || !remoteRef) throw new TypeError(`not a line git gives a pre-push hook: ${line.slice(0, 120)}`);
    out.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return out;
}

// The trailer lines of a message: its last paragraph's `<trailer>: <value>` values.
export function trailerValues(message, trailer) {
  const last = String(message).trim().split(/\n[ \t]*\n/).at(-1) ?? '';
  const prefix = `${trailer}: `;
  return last.split('\n').filter((l) => l.startsWith(prefix)).map((l) => l.slice(prefix.length).trim());
}

export function prePushCheck({ cwd, env, remote, updates, checkHooks = true }) {
  const store = openStore({ cwd, env });
  const root = store.checkout;
  const genv = store.gitEnv;
  const trust = snapshot({ cwd, env, forPush: true });
  const config = trustedConfig(trust);
  const registry = trustedRegistry(trust);
  const keys = committedKeys(root, trust.baseSha, genv);
  const rules = protectionRules(registry, config).rules;
  const patterns = Object.values(registry.secrets ?? {}).flatMap((d) => d.patterns.map((p) => ({ name: p.name, regex: p.regex })));
  // A token file that can't be read fails closed: the push can't be checked for it.
  const token = readToken(env);
  const trailer = config.git?.trailer ?? 'Mirai-Ticket';
  const committerEmail = typeof config.git?.committer_email === 'string' ? config.git.committer_email : COMMITTER_EMAIL;
  const hooks = checkHooks ? hooksState({ store, env }) : null;
  const tracked = typeof remote === 'string' && REMOTE_NAME.test(remote) && hasTrackingRefs(root, remote, genv);

  const refs = [];
  for (const u of updates) {
    const r = { ref: u.localRef, remoteRef: u.remoteRef, sha: u.localSha, scope: null };
    const done = (outcome, why, hint, extra = {}) => refs.push({ ...r, outcome, why, hint, ...extra });
    if (ZERO.test(u.localSha)) {
      done('pass', 'a delete');
      continue;
    }
    if (hooks && hooks.state !== 'ok') {
      done('hooks-changed', hooks.why, 'run: mirai init --refresh (in a terminal)');
      continue;
    }
    // What the remote already has: its tracking refs, else the integration branch's commit; and
    // the commit the ref has there, when it's here.
    const exclude = [tracked ? `--remotes=${remote}` : trust.baseSha];
    if (!ZERO.test(u.remoteSha) && commitOf(root, u.remoteSha, genv)) exclude.push(u.remoteSha);
    const scan = scanPush({ root, env: genv, head: u.localSha, exclude, patterns, token });
    if (scan.tooLarge) {
      done('too-large-to-scan', 'what this push adds is more than the secret scan reads (64 MB)', 'push fewer commits at a time; to push anyway: git push --no-verify');
      continue;
    }
    if (scan.findings.length) {
      const f = scan.findings[0];
      const where = f.file === null ? `the message of ${f.commit.slice(0, 12)}` : `${f.file} in ${f.commit.slice(0, 12)}`;
      done('secret', `a secret (${f.pattern}) in ${where}${scan.findings.length > 1 ? `, and ${scan.findings.length - 1} more` : ''}`,
        'take it out of every commit (it stays in the history otherwise), and replace it if it was real; a false alarm: git push --no-verify', { findings: scan.findings });
      continue;
    }
    if (!u.remoteRef.startsWith('refs/heads/')) {
      done('pass', 'not a branch: only the secret scan applies');
      continue;
    }
    const branch = u.remoteRef.slice('refs/heads/'.length);
    if (branch === store.branch) {
      r.scope = 'integration';
      done('pass', `the integration branch: only the secret scan applies (your merge is the gate)`);
      continue;
    }
    const base = mergeBase(root, trust.baseSha, u.localSha, genv);
    const commits = rangeCommits(root, base ? `${base}..${u.localSha}` : u.localSha, genv, { max: MAX_COMMITS + 1 });
    if (commits === null || commits.length > MAX_COMMITS) {
      done('too-many-commits', 'the branch\'s commits can\'t all be read', 'push from a branch closer to the integration branch');
      continue;
    }
    const hasTrailer = commits.some((c) => trailerValues(c.message, trailer).length > 0);
    const miraiCommitter = commits.some((c) => c.committerEmail === committerEmail);
    const touched = base ? (changedNames(root, base, u.localSha, genv) ?? []) : [];
    const hasBranchRecord = touched.some((p) => p.startsWith('.mirai/records/'));
    const scope = pushScope(store, { branch, hasTrailer, hasBranchRecord, miraiCommitter, isAncestor: (sha) => isAncestor(root, sha, u.localSha, genv) });
    r.scope = scope.scope;
    if (scope.scope === 'untouched') {
      done('pass', 'a human branch: only the secret scan applies');
      continue;
    }
    if (scope.scope === 'blocked') {
      done('registry', scope.error.message, scope.error.hint);
      continue;
    }
    const why = scope.reasons.join('; ');
    const merge = commits.find((c) => c.parents.length > 1);
    if (merge) {
      done('merge-commit', `a MIRAI branch (${why}) with a merge commit (${merge.sha.slice(0, 12)})`, 'MIRAI branches take no merge commits: rebase onto the integration branch instead');
      continue;
    }
    const tickets = new Set(commits.flatMap((c) => trailerValues(c.message, trailer)));
    const without = commits.filter((c) => trailerValues(c.message, trailer).length === 0);
    if (tickets.size !== 1 || without.length) {
      done('trailer-mix', `a MIRAI branch (${why}) where ${without.length ? `${without.length} commit(s) lack the ${trailer} trailer (such as ${without[0].sha.slice(0, 12)})` : `the commits name ${tickets.size} tickets`}`,
        'a MIRAI branch takes MIRAI\'s commits only; take it over by hand (unit 46) or start again');
      continue;
    }
    const ticket = [...tickets][0];
    if (!TICKET_ID.test(ticket) || !touched.includes(`.mirai/records/${ticket}/branch.json`)) {
      done('no-branch-record', `a MIRAI branch for ${ticket.slice(0, 40)} without its branch record`, 'a MIRAI branch starts with its signed record: start it with mirai build');
      continue;
    }
    const p = checkProofs({ root, env: genv, ticket, commit: u.localSha, integration: trust.baseSha, codePaths: config.gate?.code_paths, keys, repoId: store.repoId, rules, docsRoot: config.docs?.root });
    if (p.outcome === 'pass' || p.outcome === 'nothing-to-prove') {
      // Unit 26b: the gate proof's diff coverage, a warning only (Milestone A).
      done('pass', p.outcome === 'pass' ? `${ticket}: the review and gate proofs match code ${p.hash.slice(7, 19)}` : `${ticket}: no code changed`, undefined, { ticket, ...(p.outcome === 'pass' ? { diffCoverage: p.matched.gate.diffCoverage ?? null } : {}) });
      continue;
    }
    const hint = p.outcome === 'bad-record' ? `look at ${p.bad.map((b) => b.path).slice(0, 2).join(', ')}: only MIRAI's signed records belong there` : `mint them after the review: mirai gate record ${ticket}`;
    const detail = p.outcome === 'bad-record' ? `a record that isn't valid (${p.bad[0].reason})` : p.outcome === 'stale' ? `the proofs are for other code, not ${p.hash.slice(7, 19)}` : `no ${p.missing.join(' or ')} proof for code ${p.hash.slice(7, 19)}`;
    done(p.outcome, `${ticket}: ${detail}`, hint, { ticket });
  }
  return { ok: refs.every((x) => x.outcome === 'pass'), base: trust.baseSha, refs };
}
