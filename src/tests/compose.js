import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, sep } from 'node:path';

import { TestRunError } from './docker.js';

// The Compose side of a test run (unit 14c; D-48; research/11, "Compose"):
// - prescan: the trust-root compose files' text, before Compose reads them;
// - tighten: what only matters for your daytime stack is removed, every network made internal,
//   MIRAI's labels and output folder added (each step only narrows the file);
// - checkAllowlist: the tightened file against the allowlist, written from 14a's list. Anything
//   not named is refused, naming the service and the key.

// Keys that act on the host before any container exists, or that resolving hides (14a), as a
// key anywhere in the text; YAML tags and merge keys; an escape in a double-quoted key. Coarse
// on purpose: a false match is refused with its line.
const PRESCAN = [
  { re: /(^|[\s{,'"-])(include|extends|env_file|provider|models)['"]?\s*:/, why: (m) => `the key ${m[2]} acts on your machine or is hidden by resolving` },
  { re: /(^|[\s:[,-])!{1,2}[A-Za-z<]/, why: () => 'a YAML tag' },
  { re: /<<\s*:/, why: () => 'a YAML merge key' },
  { re: /"[^"\n]*\\[^"\n]*"\s*:/, why: () => 'an escape in a quoted key' },
  // An explicit key (`? key`) can spell any key over several lines (14c review).
  { re: /^\s*(?:-\s+)?\?(?:\s|$)/, why: () => 'an explicit YAML key (?)' },
];

export function prescan(text, file) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#/.test(lines[i])) continue;
    for (const p of PRESCAN) {
      const m = p.re.exec(lines[i]);
      if (m) {
        throw new TestRunError(`${file}:${i + 1}: ${p.why(m)}, which test runs don't accept`, {
          code: 'compose-prescan', hint: 'MIRAI reads compose files with a strict text check; write the service out in full in this file',
        });
      }
    }
  }
}

// Removed from every service: they only matter for your daytime stack.
export const DAYTIME_KEYS = Object.freeze(['ports', 'build', 'restart', 'container_name', 'develop', 'profiles']);

// What may be opted in with [compose] allow (unit 14c's safe list).
export const SAFE_EXTRA = Object.freeze(['shm_size', 'ulimits', 'mem_limit', 'cpus', 'pids_limit']);

const SERVICE_KEYS = new Set(['image', 'command', 'entrypoint', 'environment', 'working_dir', 'user', 'depends_on', 'healthcheck', 'networks', 'volumes', 'tmpfs',
  'read_only', 'init', 'stop_grace_period', 'stop_signal', 'tty', 'stdin_open', 'labels', 'expose', 'hostname']);

// `labels`: added to every service; `output`: { service, source, target } for the run's output
// folder, bound read-write into the level's service.
export function tighten(resolved, { project, labels, output }) {
  const c = structuredClone(resolved);
  c.name = project;
  for (const [name, s] of Object.entries(c.services ?? {})) {
    for (const k of DAYTIME_KEYS) delete s[k];
    s.labels = { ...(s.labels ?? {}), ...labels };
    if (output && name === output.service) {
      s.volumes = [...(s.volumes ?? []), { type: 'bind', source: output.source, target: output.target, bind: { create_host_path: false } }];
    }
  }
  for (const n of Object.values(c.networks ?? {})) if (n && typeof n === 'object') n.internal = true;
  return c;
}

const POSIX_TARGET = /^\/(?:[^\\\0]*)$/;
const inside = (path, dir) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);

// Whether a bind source is really inside one of `roots`: written plainly (absolute, no `.` or
// `..` parts), and every part from the root down is a real folder or file, never a link (14c
// review; Docker Desktop follows an absolute link as a mount source). A missing tail is allowed
// (Compose may create it) once the existing part is checked.
export function plainBindInside(source, roots) {
  if (typeof source !== 'string' || !isAbsolute(source) || source.split('/').some((p) => p === '.' || p === '..')) return false;
  const root = roots.find((r) => inside(source, r));
  if (!root) return false;
  const rest = source.slice(root.length).split('/').filter(Boolean);
  let at = root;
  for (const part of rest) {
    at = `${at}/${part}`;
    let info;
    try {
      info = lstatSync(at);
    } catch {
      return true; // from here on it doesn't exist yet
    }
    if (info.isSymbolicLink()) return false;
  }
  try {
    const real = realpathSync.native(source).toLowerCase();
    return roots.some((r) => inside(real, realpathSync.native(r).toLowerCase()));
  } catch {
    return true;
  }
}
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Refuses the first thing the allowlist doesn't name. `copy` and `out`: real paths a bind may
// come from; `imageOk(ref)`: whether the image is local; `allow`: the [compose] allow keys.
// `isolated`: folders MIRAI made for binds that needed their own copy (isolateNestedBinds).
export function checkAllowlist(c, { project, copy, out, imageOk, allow = [], isolated = [] }) {
  const refuse = (where, what) => {
    throw new TestRunError(`${where}: ${what}, which test runs don't allow`, { code: 'compose-refused', hint: 'see docs/agent-safety.md, "Tests run in containers"' });
  };
  for (const k of Object.keys(c)) if (!['name', 'services', 'networks', 'volumes'].includes(k)) refuse('the compose file', `top-level ${k}`);
  if (c.name !== project) refuse('the compose file', `the project name ${c.name}`);
  const networks = c.networks ?? {};
  for (const [k, n] of Object.entries(networks)) {
    if (!isObj(n)) refuse(`network ${k}`, 'a network without settings');
    for (const key of Object.keys(n)) if (!['name', 'ipam', 'internal'].includes(key)) refuse(`network ${k}`, key);
    if (n.name !== `${project}_${k}`) refuse(`network ${k}`, `the name ${n.name}`);
    if (n.ipam !== undefined && !(isObj(n.ipam) && Object.keys(n.ipam).length === 0)) refuse(`network ${k}`, 'ipam settings');
    if (n.internal !== true) refuse(`network ${k}`, 'a network with outside access');
  }
  const volumes = c.volumes ?? {};
  for (const [k, v] of Object.entries(volumes)) {
    if (!isObj(v)) refuse(`volume ${k}`, 'a volume without settings');
    for (const key of Object.keys(v)) if (key !== 'name') refuse(`volume ${k}`, key);
    if (v.name !== `${project}_${k}`) refuse(`volume ${k}`, `the name ${v.name}`);
  }
  const allowed = new Set([...SERVICE_KEYS, ...allow.filter((k) => SAFE_EXTRA.includes(k))]);
  for (const [name, s] of Object.entries(c.services ?? {})) {
    const where = `service ${name}`;
    for (const key of Object.keys(s)) if (!allowed.has(key)) refuse(where, key);
    if (typeof s.image !== 'string' || !s.image) refuse(where, 'no image');
    if (!imageOk(s.image)) {
      throw new TestRunError(`${where}: the image ${s.image} isn't on this machine`, { code: 'no-image', hint: `build or pull it yourself first (docker compose build ${name}); test runs never build or pull` });
    }
    if (s.working_dir != null && !POSIX_TARGET.test(s.working_dir)) refuse(where, `working_dir ${s.working_dir}`);
    for (const [net, opts] of Object.entries(s.networks ?? {})) {
      if (!(net in networks)) refuse(where, `the network ${net}`);
      if (opts !== null && !(isObj(opts) && Object.keys(opts).every((k) => k === 'aliases'))) refuse(where, `settings for the network ${net}`);
    }
    for (const v of s.volumes ?? []) {
      if (!isObj(v) || typeof v.target !== 'string' || !POSIX_TARGET.test(v.target)) refuse(where, `a mount target ${v?.target}`);
      const opts = Object.keys(v).filter((k) => !['type', 'source', 'target', 'read_only', 'bind', 'volume', 'tmpfs', 'consistency'].includes(k));
      if (opts.length) refuse(where, `mount options ${opts.join(', ')}`);
      if (v.type === 'bind') {
        if (!plainBindInside(v.source, [copy, out, ...isolated])) refuse(where, `a mount of ${v.source}`);
        // The copy has no .git and no real .env, but a mount asking for one is refused outright;
        // a committed dummy env file the copy kept may be mounted.
        const parts = (inside(v.source, copy) ? v.source.slice(copy.length) : '').split('/');
        if (parts.some((part) => part.toLowerCase() === '.git')) refuse(where, `a mount of ${v.source}`);
        if (parts.some((part) => part.toLowerCase().startsWith('.env')) && !existsSync(v.source)) refuse(where, `a mount of ${v.source} (env files other than the committed dummy ones aren't in test runs)`);
        if (v.bind && Object.keys(v.bind).some((k) => k !== 'create_host_path')) refuse(where, `bind options on ${v.target}`);
      } else if (v.type === 'volume') {
        if (v.source !== undefined && !(v.source in volumes)) refuse(where, `the volume ${v.source}`);
        if (v.volume && Object.keys(v.volume).some((k) => !['nocopy', 'subpath'].includes(k))) refuse(where, `volume options on ${v.target}`);
      } else if (v.type !== 'tmpfs') {
        refuse(where, `a ${v.type} mount`);
      }
    }
    for (const t of [s.tmpfs ?? []].flat()) if (typeof t !== 'string' || !POSIX_TARGET.test(t.split(':')[0])) refuse(where, `a tmpfs at ${t}`);
  }
}

// Binds that another service could swap before its own container starts (14c review, probed):
// a source strictly inside another service's writable bind. A running service can replace a
// folder in its own mount with an absolute link, which Docker Desktop follows when the next
// container starts. Such a bind gets its own copy of that folder or file, outside every mount, so
// nothing running can reach it; the service then sees it as it was when the run began.
// Returns [{ service, index, source }] for `isolate` to copy.
export function nestedBinds(c) {
  const binds = [];
  for (const [service, s] of Object.entries(c.services ?? {})) {
    (s.volumes ?? []).forEach((v, index) => {
      if (v?.type === 'bind' && typeof v.source === 'string') binds.push({ service, index, source: v.source, writable: v.read_only !== true });
    });
  }
  return binds.filter((b) => binds.some((o) => o.service !== b.service && o.writable && o.source !== b.source && inside(b.source, o.source)));
}
