// A plan's dependency rows (unit 30b), with no imports, so the lint can use them: an item is
// `<ecosystem>:<name>@<exact version>`, under Kind `dependency` or `dev-dependency`.

export const DEPENDENCY_KINDS = Object.freeze(['dependency', 'dev-dependency']);
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?(?:\+[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
const NAME = /^(?:@[a-z0-9][a-z0-9._-]{0,99}\/)?[a-z0-9][a-z0-9._-]{0,99}(?:\/[a-z0-9][a-z0-9._-]{0,99})?$/;

// One plan row's item: { ecosystem, name, version } or { problem }.
export function parseDependency(item) {
  const m = /^([a-z][a-z0-9-]{0,31}):(\S+)$/.exec(String(item ?? '').trim());
  if (!m) return { problem: 'a dependency is written <ecosystem>:<name>@<exact version>' };
  const rest = m[2];
  const at = rest.lastIndexOf('@');
  if (at <= 0) return { problem: `${m[1]}:${rest} has no version: name the exact version you approve, such as ${m[1]}:${rest}@1.2.3` };
  const name = rest.slice(0, at);
  const version = rest.slice(at + 1);
  if (!NAME.test(name)) return { problem: `${name} isn't a package name` };
  if (!EXACT.test(version)) return { problem: `${version} isn't an exact version (no ranges, tags, URLs, paths or git sources)` };
  return { ecosystem: m[1], name, version };
}

// The stack data for an ecosystem: { dep, install } (the `[[dependencies]]` entry and its install
// data), or null when no stack can install it.
export function installData(stacks, ecosystem) {
  for (const s of Object.values(stacks ?? {})) {
    for (const d of s.dependencies ?? []) if (d.ecosystem === ecosystem && d.install) return { dep: d, install: d.install };
  }
  return null;
}

