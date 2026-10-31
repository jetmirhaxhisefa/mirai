import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { atomicWrite, ensurePrivateDir } from '../store/files.js';
import { checkDockerRunning, dockerSetup } from '../tests/docker.js';
import { canonicalSha256 } from '../launch/strict.js';
import { trustedStrict } from '../trust/snapshot.js';
import { findClaude } from './claude.js';
import { hostFacts, macos } from './host.js';
import { projectRuleFiles } from './workspace.js';

// What a red-team result is valid for (unit 18a; R3-M7, TL3-9): every part that can change what
// an agent can reach. A result names its key; a launch checks it against the key computed now, so
// any change makes the result `stale`:
// - Claude Code: its version and the binary's sha256 (the binary `claude` on PATH resolves to);
// - the bundle: each strict template's canonical hash (13b; with 15a's MCP field and flags);
// - MIRAI's code that runs outside the sandbox: the trust root's `.mirai/framework/` files (the
//   hook, the MCP server, the launcher), as listed in its manifest;
// - Docker's engine version (`unavailable` when Docker Desktop isn't running or installed), git's
//   (the pinned /usr/bin/git), the macOS build, and Node's version (the hook and the MCP server run
//   on it);
// - the project's own Claude Code rule files (`.claude/settings*.json`, `.mcp.json`) as your
//   checkout has them: whether a launch reads them isn't proven yet (18b), so a change to one
//   needs a new run (18a review);
// - the host controls the run could check (a git credential helper, Docker's socket, an
//   ssh-agent): a result from a shell without SSH_AUTH_SOCK never stands for one with it.

export const KEY_PARTS = Object.freeze(['claude_code', 'bundles', 'framework', 'docker', 'git', 'macos', 'node', 'project_rules', 'host_controls']);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const CACHE = 'binary-cache.json';

// The canonical JSON of the parts (sorted keys), and its hash: the key.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
export const keyOf = (parts) => sha256(canonical(parts));

// The parts that differ between two sets of parts, by name.
export function changedParts(a, b) {
  return KEY_PARTS.filter((k) => canonical(a?.[k]) !== canonical(b?.[k]));
}

function hashFile(path) {
  return new Promise((done, fail) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => done(h.digest('hex'))).on('error', fail);
  });
}

// The binary's sha256, cached in the red-team folder by (path, size, mtime, ctime, inode): a 290 MB
// binary takes about a second to hash, and a launch checks the key every time. ctime and the inode
// can't be set back by hand the way mtime can.
export async function binaryHash(dir, path) {
  const st = statSync(path);
  const file = join(dir, CACHE);
  let cache = {};
  try {
    cache = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    cache = {};
  }
  const hit = cache[path];
  if (hit && hit.size === st.size && hit.mtime_ms === st.mtimeMs && hit.ctime_ms === st.ctimeMs && hit.ino === st.ino && /^[0-9a-f]{64}$/.test(hit.sha256)) return hit.sha256;
  const digest = await hashFile(path);
  ensurePrivateDir(dir);
  atomicWrite(file, `${JSON.stringify({ [path]: { size: st.size, mtime_ms: st.mtimeMs, ctime_ms: st.ctimeMs, ino: st.ino, sha256: digest } }, null, 2)}\n`);
  return digest;
}

// The `claude` that runs: found on PATH, resolved through its link, with its version.
export function resolveClaude(env, given = null) {
  const found = given ?? findClaude(env);
  if (!found) throw new StoreError('claude isn\'t on your PATH', { code: 'no-claude', hint: 'install Claude Code, or put it on PATH' });
  let real;
  try {
    real = realpathSync(found);
  } catch {
    throw new StoreError(`${found} points at nothing (a broken link)`, { code: 'no-claude', hint: 'reinstall or update Claude Code' });
  }
  const out = spawnSync(real, ['--version'], { encoding: 'utf8', timeout: 30_000, env: { PATH: '/usr/bin:/bin', HOME: env.HOME } }).stdout ?? '';
  const version = /^(\d+\.\d+\.\d+)/.exec(out.trim())?.[1];
  if (!version) throw new StoreError(`couldn't read the version of ${real}`, { code: 'no-claude-version' });
  return { path: found, real, version };
}

// The template names a trust root holds (strict/<name>.json in its manifest).
export function templateNames(trust) {
  return (trust.manifest?.files ?? []).map((f) => /^strict\/([a-z0-9][a-z0-9._-]{0,127})\.json$/.exec(f.path)?.[1]).filter(Boolean).sort();
}

// The hash of the trust root's framework files, from its manifest (already verified).
export function frameworkHash(trust) {
  const files = (trust.manifest?.files ?? []).filter((f) => f.path.startsWith('tree/.mirai/framework/')).map((f) => `${f.sha256}  ${f.path}`).sort();
  if (!files.length) throw new StoreError('the trust root has no MIRAI framework files', { code: 'no-framework', hint: 'run: mirai init --refresh, and commit it' });
  return sha256(`${files.join('\n')}\n`);
}

// The hash of the project's Claude Code rule files in `checkout`: name and content hash each, or
// `absent`.
export function projectRulesHash(checkout) {
  const files = projectRuleFiles(checkout);
  return sha256(Object.keys(files).sort().map((rel) => `${rel}\0${files[rel] === null ? 'absent' : sha256(files[rel])}`).join('\n'));
}

// The host controls this machine has, from your environment (`hostEnv`).
export function hostControls(hostEnv) {
  const h = hostFacts(hostEnv);
  return ['keychain', ...(h.credentialHelper ? ['git'] : []), ...(h.dockerSocket ? ['docker'] : []), ...(h.sshAuthSock ? ['ssh'] : [])];
}

async function dockerVersionOf(env, docker) {
  try {
    return await checkDockerRunning(dockerSetup(env, docker));
  } catch (err) {
    if (err.code === 'no-docker' || err.code === 'docker-down') return 'unavailable';
    throw err;
  }
}

// The key's parts for this machine and trust root. `env`: where MIRAI's store is (the probe's own
// home); `hostEnv`: yours. `docker`: { socket } for tests and probes.
export async function keyParts({ env, hostEnv = env, trust, store, claude = null, docker = {}, dockerVersion = null }) {
  const c = claude ?? resolveClaude(env);
  const bundles = {};
  for (const name of templateNames(trust)) bundles[name] = canonicalSha256(trustedStrict(trust, name));
  const gitOut = spawnSync('/usr/bin/git', ['--version'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }).stdout?.trim() ?? '';
  const dv = dockerVersion ?? await dockerVersionOf(env, docker);
  return {
    claude_code: { version: c.version, sha256: await binaryHash(join(store.dir, 'redteam'), c.real) },
    bundles,
    framework: frameworkHash(trust),
    docker: dv,
    git: gitOut || 'unknown',
    macos: macos().build,
    node: process.version,
    project_rules: projectRulesHash(store.checkout),
    host_controls: hostControls(hostEnv),
  };
}
