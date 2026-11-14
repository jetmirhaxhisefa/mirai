import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

// The GitLab host behind `mirai ship` (unit 27b; Jet's decisions 2026-11-11): gitlab.com, or a
// self-hosted server on its own address, through `glab`. Everything goes through GitLab's API
// (`glab api`): structured JSON back, the body as a JSON file, never an argument, never glab's
// printed text. glab's `mr` subcommands, its `--fill` (which pushes) and anything that downloads
// (Duo, Orbit) are never called: only `glab --version`, `glab auth status` and `glab api`.
//
// Probed on this Mac (2026-11-11, glab 1.130.0): the helper's `get` answers from a HOME-only
// environment; `auth status` exits 0 logged in and 1 for an unknown host or an empty config
// folder; glab's config is in ~/Library/Application Support/glab-cli on a fresh Mac.

// The first release with every credential-helper fix MIRAI relies on: a non-blank username for
// tokens, access-token-only OAuth (1.117.0), and the output from the resolved credential (1.125.0).
export const GLAB_MIN = Object.freeze([1, 125, 0]);

// glab's config folder, found as glab finds it (internal/config/config_file.go): $GLAB_CONFIG_DIR;
// else the legacy ~/.config/glab-cli, only when its config.yml exists; else the XDG config home
// ($XDG_CONFIG_HOME, or ~/Library/Application Support on macOS, ~/.config elsewhere).
export function glabConfigDir(env, home, platform = process.platform) {
  if (typeof env.GLAB_CONFIG_DIR === 'string' && isAbsolute(env.GLAB_CONFIG_DIR)) return env.GLAB_CONFIG_DIR;
  const legacy = join(home, '.config', 'glab-cli');
  if (existsSync(join(legacy, 'config.yml'))) return legacy;
  if (typeof env.XDG_CONFIG_HOME === 'string' && isAbsolute(env.XDG_CONFIG_HOME)) return join(env.XDG_CONFIG_HOME, 'glab-cli');
  return platform === 'darwin' ? join(home, 'Library', 'Application Support', 'glab-cli') : legacy;
}

// Two keys of one host in glab's config.yml: `ca_cert` and `skip_tls_verify`. A line reader, not a
// YAML parser: `hosts:` at the top level, the host as a key under it, its keys under that.
export function glabTls(configDir, host) {
  let text;
  try {
    text = readFileSync(join(configDir, 'config.yml'), 'utf8');
  } catch {
    return { caCert: null, skipTls: false };
  }
  const value = (raw) => {
    let v = raw.trim();
    const q = /^(["'])(.*)\1(?:\s+#.*)?$/.exec(v);
    if (q) return q[2];
    v = v.replace(/\s+#.*$/, '').trim();
    return v;
  };
  const indent = (l) => /^ */.exec(l)[0].length;
  const lines = text.split(/\r?\n/);
  let inHosts = false;
  let hostIndent = null;
  let mine = false;
  const out = {};
  for (const l of lines) {
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const ind = indent(l);
    if (ind === 0) {
      inHosts = /^hosts:\s*$/.test(l);
      mine = false;
      hostIndent = null;
      continue;
    }
    if (!inHosts) continue;
    if (hostIndent === null) hostIndent = ind;
    const m = /^\s*("[^"]*"|'[^']*'|[^:]+):\s*(.*)$/.exec(l);
    if (!m) continue;
    const key = m[1].replace(/^["']|["']$/g, '').trim();
    if (ind === hostIndent) {
      mine = key.toLowerCase() === host.toLowerCase();
      continue;
    }
    if (mine && ind > hostIndent && (key === 'ca_cert' || key === 'skip_tls_verify')) out[key] = value(m[2]);
  }
  return { caCert: out.ca_cert ? out.ca_cert : null, skipTls: /^(true|yes|on|1)$/i.test(out.skip_tls_verify ?? '') };
}

// The project's path for GitLab's API: `group/sub/repo` → `group%2Fsub%2Frepo`.
export const projectPath = (repo) => repo.split('/').map(encodeURIComponent).join('%2F');

// glab's version at `cli` ([major, minor, patch]), or null. glab reads (and makes) its config
// folder even for --version, and exits 2 when it can't (a read-only HOME: the sample app's refresh,
// 2026-11-12): a throwaway folder, removed after, so your own config is never touched.
export function glabVersion(cli) {
  const dir = mkdtempSync(join(tmpdir(), 'mirai-glab-'));
  try {
    const out = execFileSync(cli, ['--version'], { cwd: '/', env: { PATH: '/usr/bin:/bin', HOME: dir, GLAB_CONFIG_DIR: join(dir, 'glab-cli'), GLAB_CHECK_UPDATE: 'false', GLAB_SEND_TELEMETRY: 'false', GLAB_SHOW_WHATS_NEW: 'false', NO_COLOR: '1' }, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(out);
    return m ? m.slice(1, 4).map(Number) : null;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// [major, minor, patch] a before b.
export function olderThan(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

const STATES = Object.freeze({ opened: 'open', closed: 'closed', merged: 'merged', locked: 'locked' });

// GitLab learns of a pushed branch in a background job: on a busy server, an MR opened seconds
// after the push can be refused "source_branch does not exist" (P2, 2026-11-11, a local GitLab CE).
// That one refusal is tried again, about 30 s in all. Nothing is made by a refused create.
export const openRetry = { delaysMs: [1000, 2000, 3000, 4000, 5000, 5000, 5000, 5000] };
const NO_SOURCE = /source_branch\W{0,6}does not exist/i;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// `deps`: { runCli, withJsonFile, hostError, failed } from host.js (shared with the GitHub host).
export function gitlabHost({ hostUrl, repo, cli, env, cliHome = env.HOME }, deps) {
  const { runCli, withJsonFile, hostError, failed } = deps;
  const host = new URL(hostUrl).host;
  const configDir = glabConfigDir(env, cliHome);
  // No phoning home: glab's update check runs after any command, telemetry and the what's-new
  // notice are on by default. Nothing from the project's environment (GITLAB_TOKEN would beat
  // your stored login).
  const quiet = { GLAB_CHECK_UPDATE: 'false', GLAB_SEND_TELEMETRY: 'false', GLAB_SHOW_WHATS_NEW: 'false', GLAB_NO_PROMPT: '1' };
  const cenv = { PATH: '/usr/bin:/bin', HOME: cliHome, GLAB_CONFIG_DIR: configDir, GITLAB_HOST: hostUrl, NO_COLOR: '1', LANG: 'C', ...quiet };
  const glab = (args, o) => runCli(cli, args, cenv, o);
  const project = `projects/${projectPath(repo)}`;
  // One API call: JSON back, or null for a 404 that `missing` accepts.
  const api = (method, path, { body, missing = null, retry = null } = {}) => {
    const call = (file) => glab(['api', '--hostname', host, '--method', method, ...(file ? ['--header', 'Content-Type: application/json', '--input', file] : []), path]);
    const once = () => (body === undefined ? call(null) : withJsonFile(body, call));
    let r = once();
    for (const ms of retry ? openRetry.delaysMs : []) {
      if (r.ok || !retry.test(`${r.err} ${r.out}`)) break;
      sleep(ms);
      r = once();
    }
    if (r.ok) return JSON.parse(r.out || 'null');
    if (missing && /\b404\b/.test(r.err ?? '') && missing.test(`${r.err} ${r.out}`)) return null;
    if (/\b404\b/.test(r.err ?? '') && /Project Not Found/i.test(`${r.err} ${r.out}`)) throw hostError(`${repo} isn't on ${host}, or your login can't see it`, 'host-failed', 'check the remote and that glab is logged in as a member of the project');
    throw failed(`glab api ${method} ${path}`, r);
  };
  let tls = null;
  const readTls = () => {
    if (tls) return tls;
    const t = glabTls(configDir, host);
    if (t.skipTls) throw hostError(`glab's config turns certificate checks off for ${host} (skip_tls_verify)`, 'tls-off', 'MIRAI never pushes without checking the server\'s certificate: remove skip_tls_verify, and set ca_cert to your company\'s certificate authority file instead');
    if (t.caCert !== null) {
      let ok = isAbsolute(t.caCert);
      try {
        ok = ok && statSync(t.caCert).isFile();
        accessSync(t.caCert, constants.R_OK);
      } catch {
        ok = false;
      }
      if (!ok) throw hostError(`glab's ca_cert for ${host} isn't an absolute path to a readable file`, 'bad-ca', `fix it: glab config set ca_cert /absolute/path/to/ca.pem --host ${host}`);
    }
    tls = t;
    return t;
  };
  const self = {
    name: 'gitlab',
    renderAs: 'gitlab',
    hostUrl,
    repo,
    pushUrl: `${hostUrl}/${repo}.git`,
    helper: { command: cli, home: cliHome, configDir, configVar: 'GLAB_CONFIG_DIR', vars: quiet },
    get ca() {
      return readTls().caCert;
    },
    checkAuth() {
      const v = glab(['--version']);
      const m = /(\d+)\.(\d+)\.(\d+)/.exec(v.out ?? '');
      const have = m ? m.slice(1, 4).map(Number) : null;
      if (!v.ok || !have || olderThan(have, GLAB_MIN)) throw hostError(`glab ${have ? have.join('.') : '(version unknown)'} is older than ${GLAB_MIN.join('.')}, the first with the credential-helper fixes MIRAI needs`, 'glab-old', 'upgrade glab, then run: mirai init --refresh');
      readTls();
      const r = glab(['auth', 'status', '--hostname', host]);
      // Not logged in, or the server unreachable: P2 showed a missing ca_cert ends here too.
      if (!r.ok) throw hostError(`glab can't use a login to ${host}: it isn't logged in, or can't reach the server`, 'glab-auth', `see why: glab auth status --hostname ${host}. Not logged in: glab auth login --hostname ${host}. A server with your company's certificate: glab config set ca_cert /absolute/path/to/ca.pem --host ${host}`);
    },
    branchTip(branch) {
      const b = api('GET', `${project}/repository/branches/${encodeURIComponent(branch)}`, { missing: /Branch Not Found/i });
      const sha = b?.commit?.id ?? null;
      if (sha !== null && !/^[0-9a-f]{40}$/.test(sha)) throw hostError('the host named a branch tip MIRAI can\'t read', 'host-failed');
      return sha;
    },
    // An open MR first, else the newest.
    findMr(branch) {
      const list = api('GET', `${project}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=all&order_by=created_at&sort=desc&per_page=100`);
      if (!Array.isArray(list)) throw hostError('the host\'s merge request list isn\'t a list', 'host-failed');
      const mrs = list.filter((m) => m.source_branch === branch).map((m) => ({ number: m.iid, state: STATES[m.state] ?? String(m.state), url: m.web_url, body: m.description ?? '', title: m.title ?? '', base: m.target_branch, head: m.sha, mergeSha: m.squash_commit_sha ?? m.merge_commit_sha ?? null }));
      return mrs.find((m) => m.state === 'open') ?? mrs.sort((a, b) => b.number - a.number)[0] ?? null;
    },
    openMr({ base, head, title, body }) {
      const m = api('POST', `${project}/merge_requests`, { body: { source_branch: head, target_branch: base, title, description: body }, retry: NO_SOURCE });
      if (!Number.isInteger(m?.iid) || typeof m.web_url !== 'string') throw hostError('GitLab didn\'t name the new merge request', 'host-failed');
      return { number: m.iid, url: m.web_url };
    },
    updateMr(number, { title, body }) {
      api('PUT', `${project}/merge_requests/${Number(number)}`, { body: { title, description: body } });
    },
    // Unit 29d: the MR for the review and the merge (as the GitHub host's): its state, head,
    // whether it can be merged, and the head pipeline as CI.
    mrState(number) {
      let m = null;
      for (let i = 0; i < 6; i++) {
        m = api('GET', `${project}/merge_requests/${Number(number)}`, { missing: /Not Found/i });
        if (!m || m.state !== 'opened' || !['checking', 'unchecked', 'preparing', 'approvals_syncing'].includes(m.detailed_merge_status)) break;
        sleep(2000);
      }
      if (!m) throw hostError(`${repo} has no merge request !${number}`, 'no-mr');
      if (!/^[0-9a-f]{40}$/.test(m.sha ?? '')) throw hostError('the host named a head MIRAI can\'t read', 'host-failed');
      const state = STATES[m.state] ?? String(m.state);
      const dms = m.detailed_merge_status;
      const WHY = { conflict: 'it has conflicts with its base', draft_status: 'it\'s a draft', not_approved: 'it needs an approval', discussions_not_resolved: 'it has open threads', ci_must_pass: 'its pipeline must pass first', ci_still_running: 'its pipeline is still running', need_rebase: 'it needs a rebase', blocked_status: 'another MR blocks it', not_open: 'it isn\'t open' };
      const p = m.head_pipeline ?? null;
      const ps = p?.status;
      const checks = p ? [{ name: `pipeline ${p.id ?? ''}`.trim(), state: ps === 'success' ? 'passed' : ['failed', 'canceled'].includes(ps) ? 'failed' : ['skipped', 'manual'].includes(ps) ? 'passed' : 'pending' }] : [];
      const ci = checks.length ? (checks[0].state === 'passed' ? 'passed' : checks[0].state) : 'none';
      return { state, head: m.sha, mergeable: state === 'open' ? (dms === 'mergeable' ? true : ['checking', 'unchecked', 'preparing'].includes(dms) ? null : false) : false, why: dms === 'mergeable' ? null : WHY[dms] ?? (dms ? `GitLab says ${dms}` : null), ci: { state: ci, checks } };
    },
    // Merges with a merge commit, only if the head is still `head` (GitLab's own sha check), and
    // removes the source branch. Returns { mergeSha }.
    mergeMr(number, { head }) {
      if (!/^[0-9a-f]{40}$/.test(head ?? '')) throw new TypeError('the head is a full commit id');
      let m;
      try {
        m = api('PUT', `${project}/merge_requests/${Number(number)}/merge`, { body: { sha: head, should_remove_source_branch: true, squash: false } });
      } catch (err) {
        const text = String(err.message ?? '');
        if (/\b409\b|SHA does not match/i.test(text)) throw hostError(`GitLab refused: !${number}'s head isn't ${head.slice(0, 7)} any more`, 'mr-head-moved', 'someone pushed after your review: review it again: mirai review-mr');
        if (/\b405\b|\b406\b|\b422\b/.test(text)) throw hostError(`GitLab can't merge !${number}`, 'mr-not-mergeable', 'see the merge request on GitLab');
        throw err;
      }
      const sha = m?.merge_commit_sha ?? null;
      if (m?.state !== 'merged' || !/^[0-9a-f]{40}$/.test(sha ?? '')) throw hostError('GitLab didn\'t say the merge happened', 'host-failed');
      return { mergeSha: sha };
    },
    deleteBranch(branch) {
      api('DELETE', `${project}/repository/branches/${encodeURIComponent(branch)}`, { missing: /Branch Not Found|Not Found/i });
    },
  };
  return self;
}
