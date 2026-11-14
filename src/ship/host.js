import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { atomicWrite } from '../store/files.js';
import { gitlabHost } from './gitlab.js';

// The git host behind `mirai ship` (unit 27a; Jet's decision 5): one interface, so ship never
// calls a host's CLI itself. The project's config says which host it is (`[git] host`, and
// `host_url` for a self-hosted server), read only from the integration branch; the repo's path on
// it comes from the remote. GitHub (`gh`) is built here; GitLab (`glab`, unit 27b) in gitlab.js.
//
// A host: { name, hostUrl, repo, pushUrl, helper, renderAs, checkAuth(), branchTip(branch),
// findMr(branch) (with `mergeSha`, the commit a merged MR became: unit 29a), openMr({ base, head, title, body }), updateMr(number, { title, body }) }.

export const CLOUD = Object.freeze({ github: 'https://github.com', gitlab: 'https://gitlab.com' });
const CLI = Object.freeze({ github: 'gh', gitlab: 'glab' });
export const TOOLS_FILE = 'host-tools.json';

export const hostError = (message, code, hint, exitCode = EXIT.BLOCKED) => Object.assign(new MiraiError(message, exitCode), { code, ...(hint ? { hint } : {}) });

// The host's name and server for a project: the config's, or, when the config names none, the
// cloud host the remote is on (github.com or gitlab.com). A self-hosted server must be named.
export function hostConfig(config, remoteUrl) {
  const where = remoteHost(remoteUrl);
  const name = config.git?.host ?? Object.keys(CLOUD).find((k) => new URL(CLOUD[k]).host === where) ?? null;
  if (!name) throw hostError(`MIRAI can't tell which host ${where ?? 'the remote'} is`, 'no-host', 'set it in .mirai/config.toml on the integration branch: [git] host = "github" or "gitlab", and host_url = "https://<server>" for a self-hosted one');
  const hostUrl = config.git?.host_url ?? CLOUD[name];
  // Unit 27b, Jet's decision 1: a self-hosted server on its own address. A port or a sub-path
  // clashes with how glab and git name hosts; it's later work.
  const u = new URL(hostUrl);
  if (u.port || (u.pathname !== '/' && u.pathname !== '')) throw hostError(`MIRAI doesn't support a host on a port or a sub-path yet (${hostUrl})`, 'host-unsupported', 'MIRAI works with a server on its own address, such as https://gitlab.example.com; a port or a sub-path is listed as later work');
  if (where !== new URL(hostUrl).host) throw hostError(`the remote is on ${where ?? 'no host MIRAI reads'}, not ${new URL(hostUrl).host} (the configured ${name} host)`, 'wrong-host', 'fix [git] host_url on the integration branch, or the remote');
  return { name, hostUrl, repo: repoPath(remoteUrl) };
}

// The server of an https or scp-style ssh remote (`git@host:path`), or null.
export function remoteHost(url) {
  const ssh = /^(?:ssh:\/\/)?[A-Za-z0-9._-]+@([A-Za-z0-9.-]+)(?::\d+)?[:/]/.exec(url ?? '');
  if (ssh) return ssh[1].toLowerCase();
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

// The repo's path on the host (`owner/repo`, or GitLab's `group/subgroup/repo`), from the remote.
export function repoPath(url) {
  const ssh = /^(?:ssh:\/\/)?[A-Za-z0-9._-]+@[A-Za-z0-9.-]+(?::\d+)?[:/](.+)$/.exec(url ?? '');
  let path = ssh ? ssh[1] : null;
  if (!path) {
    try {
      path = new URL(url).pathname;
    } catch {
      path = null;
    }
  }
  path = (path ?? '').replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+){1,20}$/.test(path) || path.split('/').some((p) => p === '.' || p === '..')) {
    throw hostError('the remote doesn\'t name a repo on its host', 'bad-remote', 'the remote should look like https://github.com/<owner>/<repo>.git');
  }
  return path;
}

// The host's CLI (`gh` or `glab`), as `mirai init` found it on your PATH and recorded it in the
// store: an absolute path to a regular, executable file you or root own, outside the project.
export function findCli(name, env, root) {
  for (const dir of String(env.PATH ?? '').split(':')) {
    if (!isAbsolute(dir)) continue;
    const path = join(dir, name);
    if (cliProblem(path, root) === null) return realpathSync(path);
  }
  return null;
}

function cliProblem(path, root) {
  let st;
  try {
    st = lstatSync(realpathSync(path));
  } catch {
    return 'not there';
  }
  if (!st.isFile()) return 'not a file';
  if ((st.mode & 0o111) === 0) return 'not executable';
  if (st.uid !== process.getuid() && st.uid !== 0) return 'owned by another user';
  if (st.mode & 0o022) return 'writable by others';
  const real = realpathSync(path);
  if (root && (real === root || real.startsWith(`${root}/`))) return 'inside the project';
  return null;
}

export function recordCli(store, env, root) {
  const tools = {};
  for (const [name, cli] of Object.entries(CLI)) {
    const path = findCli(cli, env, root);
    if (path) tools[name] = path;
  }
  atomicWrite(join(store.dir, TOOLS_FILE), `${JSON.stringify({ schema_version: 1, ...tools }, null, 2)}\n`);
  return tools;
}

export function recordedCli(store, name, root) {
  let rec;
  try {
    rec = JSON.parse(readFileSync(join(store.dir, TOOLS_FILE), 'utf8'));
  } catch {
    rec = null;
  }
  const path = rec?.[name];
  const problem = typeof path === 'string' ? cliProblem(path, root) : 'not recorded';
  if (problem) throw hostError(`MIRAI has no usable ${CLI[name]} for the ${name} host (${problem})`, `no-${CLI[name]}`, `install ${CLI[name]}, then run: mirai init --refresh`);
  return path;
}

// The CLI's environment: your HOME and its config folder, the CLI's own folder on PATH, no
// prompts, no colour, nothing from the project. Run from a neutral folder, so no repo's config is
// read.
// `home`: your HOME. On macOS the keychain that holds `gh`'s token is found through it (an empty or
// other HOME logs gh out: probed 2026-11-10), so the CLI always gets the real one.
// (glab's is in gitlab.js: its config folder is found as glab finds it.)
function ghEnv(env, hostUrl, home = env.HOME) {
  return { PATH: '/usr/bin:/bin', HOME: home, GH_CONFIG_DIR: env.GH_CONFIG_DIR ?? join(home, '.config', 'gh'), GH_HOST: new URL(hostUrl).host, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_SPINNER_DISABLED: '1', NO_COLOR: '1', LANG: 'C' };
}

export function runCli(path, args, cenv, { input, timeout = 60_000 } = {}) {
  try {
    const out = execFileSync(path, args, { cwd: '/', env: cenv, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, ...(input !== undefined ? { input } : {}), stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    return { ok: true, out };
  } catch (err) {
    if (err.signal) return { ok: false, out: '', err: `timed out after ${timeout / 1000} s` };
    return { ok: false, status: err.status, out: String(err.stdout ?? ''), err: String(err.stderr ?? '').slice(0, 2000) };
  }
}

// A body goes to the CLI through a private temp file, never as an argument.
function withBodyFile(body, fn, name = 'body.md') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mirai-mr-')));
  try {
    const file = join(dir, name);
    writeFileSync(file, body, { mode: 0o600 });
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const withJsonFile = (value, fn) => withBodyFile(JSON.stringify(value), fn, 'body.json');

const SHA = /^[0-9a-f]{40}$/;
export const failed = (what, r) => hostError(`${what} failed: ${String(r.err || r.out).trim().split('\n').at(-1)?.slice(0, 300) || `exit ${r.status}`}`, 'host-failed', 'check the host and your login, then run it again');

// The GitHub host, through `gh`.
export function githubHost({ hostUrl, repo, cli, env, cliHome = env.HOME }) {
  const cenv = ghEnv(env, hostUrl, cliHome);
  const gh = (args, o) => runCli(cli, args, cenv, o);
  const api = (path) => {
    const r = gh(['api', '--method', 'GET', path]);
    if (r.ok) return JSON.parse(r.out);
    if (/HTTP 404/.test(r.err ?? '')) return null;
    throw failed(`gh api ${path}`, r);
  };
  return {
    name: 'github',
    renderAs: 'github',
    hostUrl,
    repo,
    pushUrl: `${hostUrl}/${repo}.git`,
    helper: { command: cli, home: cliHome, configDir: cenv.GH_CONFIG_DIR, configVar: 'GH_CONFIG_DIR' },
    checkAuth() {
      const r = gh(['auth', 'status', '--hostname', new URL(hostUrl).host]);
      if (!r.ok) throw hostError(`gh isn't logged in to ${new URL(hostUrl).host}`, 'gh-auth', `run: gh auth login --hostname ${new URL(hostUrl).host}`);
    },
    // The commit a branch is at on the host, or null when it has no such branch.
    branchTip(branch) {
      const ref = api(`repos/${repo}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`);
      const sha = ref?.object?.sha ?? null;
      if (sha !== null && !SHA.test(sha)) throw hostError('the host named a branch tip MIRAI can\'t read', 'host-failed');
      return sha;
    },
    // The MR whose head is `branch`: an open one first, else the newest. { number, state:
    // 'open' | 'closed' | 'merged', url, body, title, base, head } or null.
    findMr(branch) {
      const r = gh(['pr', 'list', '--repo', repo, '--head', branch, '--state', 'all', '--limit', '30', '--json', 'number,state,url,body,title,baseRefName,headRefOid,mergeCommit']);
      if (!r.ok) throw failed('gh pr list', r);
      const list = JSON.parse(r.out).map((p) => ({ number: p.number, state: String(p.state).toLowerCase(), url: p.url, body: p.body ?? '', title: p.title ?? '', base: p.baseRefName, head: p.headRefOid, mergeSha: p.mergeCommit?.oid ?? null }));
      return list.find((p) => p.state === 'open') ?? list.sort((a, b) => b.number - a.number)[0] ?? null;
    },
    openMr({ base, head, title, body }) {
      const r = withBodyFile(body, (file) => gh(['pr', 'create', '--repo', repo, '--base', base, '--head', head, '--title', title, '--body-file', file]));
      if (!r.ok) throw failed('gh pr create', r);
      const url = r.out.trim().split('\n').at(-1);
      const m = /\/pull\/(\d+)$/.exec(url ?? '');
      if (!m) throw hostError('gh pr create didn\'t name the new pull request', 'host-failed');
      return { number: Number(m[1]), url };
    },
    updateMr(number, { title, body }) {
      const r = withBodyFile(body, (file) => gh(['pr', 'edit', String(number), '--repo', repo, '--title', title, '--body-file', file]));
      if (!r.ok) throw failed('gh pr edit', r);
    },
  };
}

// The host for a project: { name, hostUrl, repo } from hostConfig, its CLI from the store.
export function hostFor({ config, remoteUrl, store, env, root, cliHome }) {
  if (!remoteUrl) throw hostError('the repo has no remote named origin', 'no-remote', 'add it: git remote add origin <url>');
  const h = hostConfig(config, remoteUrl);
  if (h.name === 'gitlab') return gitlabHost({ ...h, cli: recordedCli(store, h.name, root), env, ...(cliHome ? { cliHome } : {}) }, { runCli, withJsonFile, hostError, failed });
  return githubHost({ ...h, cli: recordedCli(store, h.name, root), env, ...(cliHome ? { cliHome } : {}) });
}


// An MR title that can't make the MR a draft (unit 27b): GitLab drafts an MR whose title starts
// with Draft:, [Draft], (Draft) or WIP: (any case, repeated). Both hosts get the same title.
export function cleanTitle(title) {
  let t = String(title);
  for (;;) {
    const next = t.replace(/^\s*(?:\[\s*(?:draft|wip)\s*\]|\(\s*(?:draft|wip)\s*\)|(?:draft|wip)\s*:|draft\s+-)\s*/i, '');
    if (next === t) return t.trim() || 'Untitled';
    t = next;
  }
}
