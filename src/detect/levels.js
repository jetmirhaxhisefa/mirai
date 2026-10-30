import { posix } from 'node:path';

import { parseXml } from '../tests/xml.js';
import { besides, dirOf, filesNamed, joinIn, nameOf } from './walk.js';
import { listsDependency } from './stacks.js';

// Test levels and where things run (unit 17a; D-45 "detect, then ask the gaps"), from each test
// adapter's [detect] data (registry/test-adapters/, .mirai/custom/test-adapters/). A folder runs
// in the compose service whose bind mount covers it most closely; its working folder there is
// that mount's target plus the rest of the path. Nothing about any runner is code.

const under = (p, dir) => dir === '' || p === dir || p.startsWith(`${dir}/`);

// Where the project folder `dir` runs: { service, workdir, run?, others } or null when no
// service mounts it. `workdir` is left out when it's already the service's working folder; a
// service in a profile (started on demand) runs one-off. `others` names the services that tie.
export function serviceFor(compose, dir) {
  if (compose.state !== 'ok') return null;
  const fits = [];
  for (const [name, s] of Object.entries(compose.services)) {
    for (const b of s.binds) {
      if (b.source !== undefined && under(dir, b.source)) fits.push({ name, s, b });
    }
  }
  if (fits.length === 0) return null;
  fits.sort((x, y) => y.b.source.length - x.b.source.length || Number(x.b.read_only) - Number(y.b.read_only) || x.name.localeCompare(y.name));
  const best = fits[0];
  const rest = best.b.source === '' ? dir : dir.slice(best.b.source.length + 1);
  const workdir = rest ? posix.join(best.b.target, rest) : best.b.target;
  const others = [...new Set(fits.filter((f) => f.name !== best.name && f.b.source === best.b.source && f.b.read_only === best.b.read_only).map((f) => f.name))];
  return {
    service: best.name,
    ...(best.s.working_dir === workdir ? {} : { workdir }),
    ...(best.s.profiles.length ? { run: 'oneoff' } : {}),
    mount: `./${best.b.source || '.'}:${best.b.target}`,
    others,
  };
}

// A config name for `base` (a level or check name from the data) that isn't in `taken`, added to
// it: `base`, else `<service>-<base>`, else with a number; always a valid name (lowercase letters,
// digits and "-", starting with a letter), whatever the service is called.
export function uniqueName(base, service, taken) {
  const clean = (n) => {
    const c = n.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    return /^[a-z]/.test(c) ? c : `s-${c}`;
  };
  let name = clean(base);
  if (taken.has(name)) name = clean(`${service}-${base}`);
  for (let n = 2; taken.has(name); n++) name = clean(`${service}-${base}-${n}`);
  taken.add(name);
  return name;
}

// Whether an adapter's command condition holds in folder `dir`.
function conditionHolds(c, dir, tree, reader) {
  if (c.if_file && !tree.files.has(besides(dir, c.if_file))) return false;
  if (c.if_script) {
    const v = reader.json(besides(dir, c.if_script.file))?.[c.if_script.field]?.[c.if_script.name];
    if (typeof v !== 'string' || !v.includes(c.if_script.contains)) return false;
  }
  return true;
}

// The suite names a runner's config lists (facts only), from its XML: at most 50.
function suitesOf(text, { element, attribute }) {
  let root;
  try {
    root = parseXml(text, { bytes: 1024 * 1024, depth: 32, elements: 20_000 });
  } catch {
    return null;
  }
  const names = [];
  const walk = (el) => {
    for (const c of el.children) {
      if (c.name === element && typeof c.attrs[attribute] === 'string' && names.length < 50) names.push(c.attrs[attribute].slice(0, 100));
      walk(c);
    }
  };
  walk(root);
  return names;
}

// The levels the adapters' data finds: { levels: [...], gaps: [...] }. A level is { name, adapter,
// marker, dir, command, service, workdir?, run?, report_root?, suites?, mount, others }; one per
// adapter and folder (two of an adapter's markers in one folder make one level). `taken` is
// a Set of names already used.
export function findLevels({ tree, reader, adapters, compose, taken = new Set() }) {
  const levels = [];
  const gaps = [];
  for (const a of Object.values(adapters).filter((x) => x.detect).sort((x, y) => x.name.localeCompare(y.name))) {
    const d = a.detect;
    const markers = d.markers.flatMap((m) => filesNamed(tree, m).filter((p) => nameOf(p) === m)).sort();
    const byDir = new Map();
    for (const m of markers) if (!byDir.has(dirOf(m))) byDir.set(dirOf(m), m);
    for (const [dir, marker] of byDir) {
      if (d.package && !listsDependency(reader.json(besides(dir, d.package.file)), d.package.fields, d.package.name)) continue;
      const cmd = d.commands.find((c) => conditionHolds(c, dir, tree, reader));
      if (!cmd) continue;
      const where = serviceFor(compose, dir);
      if (!where) {
        gaps.push({ topic: 'levels', text: `${marker} (${a.name}): no compose service mounts ${dir || 'the top folder'}, so its level isn't drafted` });
        continue;
      }
      const name = uniqueName(d.level, where.service, taken);
      const level = { name, adapter: a.name, marker, dir, command: [...cmd.command], service: where.service, ...(where.workdir ? { workdir: where.workdir } : {}), ...(where.run ? { run: where.run } : {}), mount: where.mount, others: where.others };
      const root = (d.report_root ?? []).map((r) => joinIn(dir, r)).find((p) => p !== null && tree.folders.has(p));
      if (root) level.report_root = root;
      else if (d.report_root?.length) gaps.push({ topic: 'levels', text: `${name}: none of ${d.report_root.join(', ')} is beside ${marker}; check where its report's paths start (report_root)` });
      if (d.suites) {
        const text = reader.text(marker);
        const suites = text === null ? null : suitesOf(text, d.suites);
        if (suites?.length) level.suites = suites;
      }
      levels.push(level);
    }
  }
  return { levels, gaps };
}
