import { posix } from 'node:path';

import { TestRunError } from './docker.js';

// Project paths and the service's own paths (unit 16a). A test level runs in its compose
// service, which mounts parts of the project wherever its compose file says (the sample app's
// backend/ is /var/www/html in `app`). So a file or test the caller names by its path in the
// project is passed to the runner as the service's absolute path for it, and a path a report
// names is mapped back. Both come from the frozen compose file's binds of that service: no stack
// knowledge, and nothing guessed.

const under = (p, dir) => dir === '' || p === dir || p.startsWith(`${dir}/`);
const rest = (p, dir) => (dir === '' ? p : p.slice(dir.length + 1));

// The service's mounts: binds of the copy as { rel, target } (rel is the project path, '' for
// the whole project), and every mount's target, deepest first.
export function serviceMounts(service, copyRoot) {
  const binds = [];
  const targets = [];
  for (const v of service?.volumes ?? []) {
    if (typeof v.target !== 'string' || !v.target.startsWith('/')) continue;
    const target = posix.normalize(v.target).replace(/\/+$/, '') || '/';
    targets.push({ target, bind: null });
    if (v.type === 'bind' && typeof v.source === 'string' && (v.source === copyRoot || v.source.startsWith(`${copyRoot}/`))) {
      const b = { rel: v.source.slice(copyRoot.length + 1), target };
      binds.push(b);
      targets[targets.length - 1].bind = b;
    }
  }
  for (const t of service?.tmpfs ? [].concat(service.tmpfs) : []) {
    if (typeof t === 'string' && t.startsWith('/')) targets.push({ target: posix.normalize(t.split(':')[0]).replace(/\/+$/, '') || '/', bind: null });
  }
  targets.sort((a, b) => b.target.length - a.target.length);
  return { binds, targets };
}

const inside = (p, target) => target === '/' || p === target || p.startsWith(`${target}/`);

// The mount a container path is under: the deepest one.
const mountOf = (mounts, p) => mounts.targets.find((t) => inside(p, t.target)) ?? null;

// The service's absolute path for a project path: through the bind that holds it most closely,
// and refused when the service doesn't mount it, or another mount hides it there.
export function toServicePath(mounts, projectPath, serviceName) {
  const fits = mounts.binds.filter((b) => under(projectPath, b.rel)).sort((a, b) => b.rel.length - a.rel.length);
  for (const b of fits) {
    const r = rest(projectPath, b.rel);
    const p = r ? posix.join(b.target, r) : b.target;
    if (mountOf(mounts, p)?.bind === b) return p;
  }
  throw new TestRunError(fits.length
    ? `${projectPath} is hidden in ${serviceName} by another of its mounts`
    : `${projectPath} isn't in what ${serviceName} mounts from the project`, { code: 'bad-path', hint: `pass a file or folder ${serviceName} mounts: ${mounts.binds.map((b) => b.rel || '.').join(', ') || 'it mounts nothing of the project'}` });
}

// The project path for a path a report names, or null when it isn't one: an absolute path
// through the service's mounts, or a relative one from `base` (the service's working folder, or
// the level's report_root, already a service path).
export function toProjectPath(mounts, reported, base) {
  if (typeof reported !== 'string' || reported === '' || reported.includes('\0')) return null;
  const abs = reported.startsWith('/') ? posix.normalize(reported) : base ? posix.join(base, reported) : null;
  if (!abs) return null;
  const m = mountOf(mounts, abs);
  if (!m?.bind) return null;
  const r = abs === m.target ? '' : abs.slice(m.target === '/' ? 1 : m.target.length + 1);
  const p = m.bind.rel && r ? `${m.bind.rel}/${r}` : m.bind.rel || r;
  return p === '' || p.split('/').some((x) => x === '..' || x === '.' || x === '') ? null : p;
}
