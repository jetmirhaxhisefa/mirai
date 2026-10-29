import { join } from 'node:path';

import { EXIT } from '../cli/exit-codes.js';
import { ConfigError } from '../cli/errors.js';
import { loadCustomTestAdapters } from '../config/registry.js';
import { trustedRegistry } from '../trust/snapshot.js';
import { TestRunError } from './docker.js';

// Test adapters (unit 16a; D-48 item 5): the registry's (registry/test-adapters/) and the
// project's own (.mirai/custom/test-adapters/), both from the trust root, so a branch can't
// change how MIRAI asks for and reads its reports (the runner's own config is the branch's). What
// they hold is in src/config/registry.js (TEST_ADAPTER); here they become argv. Nothing about any
// one runner is code.

// Every adapter a level of this trust root can name. A project adapter that doesn't load is
// refused (`bad-adapter`), naming its problems.
export function trustedAdapters(trust) {
  const core = trustedRegistry(trust).testAdapters;
  try {
    return { ...core, ...loadCustomTestAdapters(join(trust.dir, 'tree', '.mirai', 'custom'), core) };
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    const first = (err.errors ?? []).slice(0, 3).map((e) => `${e.source}:${e.line}: ${e.reason}`).join('; ');
    throw new TestRunError(`${err.message}: ${first}`, { code: 'bad-adapter', exitCode: EXIT.USAGE, hint: 'fix it on the integration branch (see docs/test-adapters.md)' });
  }
}

export function findAdapter(adapters, name) {
  if (Object.hasOwn(adapters, name)) return adapters[name];
  const known = Object.keys(adapters);
  throw new TestRunError(`the test adapter ${name} isn't in the registry or the project's own`, { code: 'unknown-adapter', exitCode: EXIT.USAGE, hint: known.length ? `known: ${known.join(', ')}` : 'add one in .mirai/custom/test-adapters/ (see docs/test-adapters.md)' });
}

// Every character a regex gives a meaning to, escaped. Escaping only these (and "/", which some
// runners use as the pattern's delimiter) is valid in every common flavour, Unicode mode included.
export const regexEscape = (text) => text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

// A test's name as the runner's filter sees it: the report's parts (split on report.separator)
// joined with select.join.
export function filterName(adapter, name) {
  const sep = adapter.report.separator;
  const join2 = adapter.select.join;
  return sep && join2 !== undefined && join2 !== sep ? name.split(sep).join(join2) : name;
}

function fill(template, values) {
  return template.replace(/\{([a-z:]+)\}/g, (whole, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`no value for {${key}}`);
    return values[key];
  });
}

// The arguments (appended to the level's command) and environment variables for one run:
// `report` is the service's path for the report file; `select` is null (the whole level),
// { path } (a file or folder, the service's path) or { path, name } (one test).
export function adapterRun(adapter, { report, select = null }) {
  const values = { report };
  if (select) Object.assign(values, { path: select.path, 'path:regex': regexEscape(select.path) });
  if (select?.name !== undefined) {
    const n = filterName(adapter, select.name);
    Object.assign(values, { name: n, 'name:regex': regexEscape(n) });
  }
  const args = (adapter.report.args ?? []).map((t) => fill(t, values));
  if (select) args.push(...(select.name === undefined ? adapter.select.file : adapter.select.test).map((t) => fill(t, values)));
  const env = Object.fromEntries(Object.entries(adapter.report.env ?? {}).map(([k, t]) => [k, fill(t, values)]));
  return { args, env };
}
