import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { prescan } from '../tests/compose.js';
import { dockerCall, dockerSetup } from '../tests/docker.js';

// The compose file as setup detection sees it (unit 17a; design/01 §1 step 1). Docker's own
// file names at the top folder; the first one Compose would pick is read. Its text first goes
// through test runs' strict prescan (unit 14c: no include, extends or env_file, so resolving
// reads no other file), then `docker compose config` resolves it in MIRAI's private Docker
// setup, from a folder of its own holding only that file, with an empty --env-file: your .env is
// never read, not even to fill in a variable. No container starts.
//
// Kept: each service's image, working folder, profiles, bind mounts (a project path, or the
// absolute path outside it) and published ports, and whether the file fixes the project name.

export const COMPOSE_NAMES = Object.freeze(['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']);
export const OVERRIDE_NAMES = Object.freeze(['compose.override.yaml', 'compose.override.yml', 'docker-compose.override.yaml', 'docker-compose.override.yml']);
const SOCKET = /(?:^|\/)docker\.sock$/;
const MAX_WARNINGS = 50;

const inside = (p, dir) => p === dir || p.startsWith(`${dir}/`);

// { file, others, overrides, state: 'ok' | 'none' | 'link' | 'refused' | 'error', reason,
//   services: { <name>: { image, working_dir, profiles, binds, ports } }, name_fixed, warnings }.
// `workDir` is a private folder of this detection run. A bind of your home folder (env.HOME, or
// the private Docker setup's, which is what `~` and $HOME resolve to there) is reported as such.
export async function readCompose({ tree, reader, workDir, env, docker = {}, call = dockerCall }) {
  const present = COMPOSE_NAMES.filter((n) => tree.files.has(n) || tree.links.includes(n));
  const overrides = OVERRIDE_NAMES.filter((n) => tree.files.has(n) || tree.links.includes(n));
  const base = { file: present[0] ?? null, others: present.slice(1), overrides, services: {}, name_fixed: false, warnings: [] };
  if (!base.file) return { ...base, state: 'none' };
  if (tree.links.includes(base.file)) return { ...base, state: 'link', reason: `${base.file} is a link; test runs read the file itself` };
  const text = reader.text(base.file);
  if (text === null) return { ...base, state: 'error', reason: `${base.file} is too large to read` };
  try {
    prescan(text, base.file);
  } catch (err) {
    if (err.code !== 'compose-prescan') throw err;
    return { ...base, state: 'refused', reason: err.message };
  }
  base.name_fixed = /^["']?name["']?[ \t]*:/m.test(text);

  const project = join(workDir, 'compose');
  mkdirSync(project, { recursive: true, mode: 0o700 });
  writeFileSync(join(project, base.file), text, { mode: 0o600 });
  writeFileSync(join(workDir, 'empty.env'), '', { mode: 0o600 });
  const projectReal = realpathSync(project);
  let setup;
  try {
    setup = dockerSetup(env, docker);
  } catch (err) {
    if (err.code !== 'no-docker') throw err;
    return { ...base, state: 'error', reason: err.message };
  }
  const r = await call(setup, ['compose', '--progress', 'quiet', '-f', join(projectReal, base.file), '-p', 'mirai-detect', '--project-directory', projectReal, '--env-file', join(workDir, 'empty.env'), '--profile', '*', 'config', '--format', 'json'], { timeout: 60_000 });
  if (r.status !== 0) return { ...base, state: 'error', reason: `docker compose config failed: ${(r.stderr.trim().split('\n').pop() ?? '').slice(0, 300)}` };
  let resolved;
  try {
    resolved = JSON.parse(r.stdout);
  } catch {
    return { ...base, state: 'error', reason: 'docker compose config gave no readable JSON' };
  }
  const homes = [setup.env.HOME, env.HOME].filter((h) => typeof h === 'string' && h.startsWith('/') && h !== '/');
  // A path in your home folder is written from "~", in the facts too.
  const tilde = (p) => {
    const h = homes.find((x) => inside(p, x));
    return h ? `~${p.slice(h.length)}` : p;
  };
  // The line a warning is on: the first that names the mount's target, looked up for at most
  // MAX_WARNINGS warnings (a guess for you to find it by, not a fact).
  const lines = text.split('\n');
  const lineOf = (needle) => {
    if (base.warnings.length >= MAX_WARNINGS) return null;
    const i = lines.findIndex((l) => !/^\s*#/.test(l) && l.includes(needle));
    return i === -1 ? null : i + 1;
  };
  for (const [name, s] of Object.entries(resolved.services ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const binds = [];
    for (const v of s?.volumes ?? []) {
      if (v?.type !== 'bind' || typeof v.source !== 'string' || typeof v.target !== 'string') continue;
      const target = posix.normalize(v.target).replace(/(?<=.)\/+$/, '');
      const rel = inside(v.source, projectReal) ? v.source.slice(projectReal.length + 1) : null;
      const bind = { ...(rel !== null ? { source: rel } : { outside: tilde(v.source) }), target, read_only: v.read_only === true };
      binds.push(bind);
      let kind = null;
      if (rel === null) kind = SOCKET.test(v.source) ? 'socket' : homes.some((h) => inside(v.source, h)) ? 'home' : 'outside';
      else if (rel.split('/').some((part) => part.toLowerCase() === '.git')) kind = 'git';
      if (kind) base.warnings.push({ service: name, target, line: lineOf(target), kind, source: rel ?? tilde(v.source) });
    }
    const ports = (s?.ports ?? []).filter((p) => p && p.published !== undefined && p.published !== '').map((p) => ({ published: String(p.published), target: p.target, ...(p.host_ip ? { host_ip: p.host_ip } : {}) }));
    base.services[name] = {
      image: typeof s?.image === 'string' ? s.image : null,
      ...(typeof s?.container_name === 'string' ? { container_name: s.container_name } : {}),
      working_dir: typeof s?.working_dir === 'string' ? s.working_dir : null,
      profiles: Array.isArray(s?.profiles) ? s.profiles.filter((p) => typeof p === 'string') : [],
      binds,
      ports,
    };
  }
  // Networks and volumes made outside the compose file are shared by every stack that names them.
  base.external = ['networks', 'volumes'].flatMap((k) => Object.entries(resolved[k] ?? {}).filter(([, v]) => v?.external === true || (v?.external && typeof v.external === 'object')).map(([n]) => `${k.slice(0, -1)} ${n}`)).sort();
  return { ...base, state: 'ok' };
}

// Why the toolchain is bound to this checkout (D-24, R-C5): [reason]; empty when it isn't.
export function worktreeReasons(compose) {
  if (compose.state !== 'ok') return [];
  const reasons = [];
  if (compose.name_fixed) reasons.push(`${compose.file} sets the project name, so a second checkout's stack would replace this one's`);
  const mounts = Object.entries(compose.services).flatMap(([n, s]) => s.binds.filter((b) => b.source !== undefined).map((b) => `./${b.source || '.'} in ${n}`));
  if (mounts.length) reasons.push(`it mounts the checkout itself (${mounts.slice(0, 4).join(', ')}${mounts.length > 4 ? ', …' : ''}), so a second checkout's containers would run this one's files`);
  const ports = Object.entries(compose.services).flatMap(([n, s]) => s.ports.map((p) => `${p.published} in ${n}`));
  if (ports.length) reasons.push(`it fixes host ports (${ports.slice(0, 4).join(', ')}${ports.length > 4 ? ', …' : ''}), which two stacks can't both have`);
  const names = Object.entries(compose.services).filter(([, s]) => s.container_name).map(([n, s]) => `${s.container_name} for ${n}`);
  if (names.length) reasons.push(`it fixes container names (${names.slice(0, 4).join(', ')}${names.length > 4 ? ', …' : ''}), which two stacks can't both have`);
  if (compose.external?.length) reasons.push(`it uses what's made outside it (${compose.external.slice(0, 4).join(', ')}${compose.external.length > 4 ? ', …' : ''}), which two stacks would share`);
  return reasons;
}
