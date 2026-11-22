import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConfigError } from '../../cli/errors.js';
import { readConfigFile } from '../../config/load.js';
import { validate } from '../../config/schema.js';
import { deepFreeze } from '../../util/freeze.js';

// The connector contract (unit 38, Scope 1; D-37: data with a schema). One TOML file per store in
// registry/connectors/<name>.toml says what the store does (its verbs), which document types it
// holds, how `setup` proves it works, and how its own states map to MIRAI's. A store's code (one
// module per store in src/store/connectors/) follows the same interface: write, read, query,
// publish, status, setup and pathOf. The status map is advisory: no gate reads it (D-36, R2-M13);
// gates read only your signed approvals.

export const CONNECTORS_DIR = fileURLToPath(new URL('../../../registry/connectors/', import.meta.url));
// Every verb is required: a store that can't do one says so in its own code (local's publish does
// nothing and says so), so a workflow never meets a missing verb.
export const VERBS = Object.freeze(['setup', 'write', 'read', 'query', 'publish', 'status']);
// MIRAI's document states, which a store's states map to.
export const MIRAI_STATES = Object.freeze(['draft', 'in-review', 'approved', 'published']);
// The document types a store may hold: the initiative's documents and tickets. Context files
// (.mirai/context/, unit 36) and overlays (.mirai/custom/, unit 37) are project files in the repo,
// never a store's.
export const STORE_TYPES = Object.freeze(['interview', 'brief', 'prd', 'epic', 'story', 'bug']);

const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const LINE = /^[^\x00-\x1f\x7f]{1,300}$/;

const SCHEMA = {
  type: 'table',
  fields: {
    schema_version: { type: 'integer', min: 1, max: 1 },
    name: { type: 'string', pattern: NAME, patternHint: 'a short name such as "repo"' },
    // repo and local are MIRAI's own; external is a store outside the machine (Jira, Confluence:
    // post-MVP), whose text is untrusted and whose status is a cache.
    kind: { type: 'enum', values: ['repo', 'local', 'external'] },
    description: { type: 'string', pattern: LINE, patternHint: 'one line' },
    verbs: { type: 'array', items: { type: 'string', pattern: /^[a-z][a-z_-]{0,31}$/, patternHint: 'a verb such as "write"' } },
    holds: { type: 'array', minItems: 1, items: { type: 'string', pattern: NAME, patternHint: 'a document type such as "prd"' } },
    setup: { type: 'table', fields: { proof: { type: 'string', pattern: LINE, patternHint: 'one line: what setup checks' } }, required: ['proof'] },
    // The store's own state → MIRAI's.
    status_map: { type: 'table', map: { type: 'string', pattern: /^[a-z][a-z-]{0,31}$/, patternHint: 'one of MIRAI\'s states' }, keyPattern: /^[a-z][a-z0-9_-]{0,47}$/ },
    // External stores only: how long a mirrored status stays fresh, in minutes.
    sync_window_minutes: { type: 'integer', min: 1, max: 10080 },
  },
  required: ['schema_version', 'name', 'kind', 'description', 'verbs', 'holds', 'setup', 'status_map'],
};

// The problems of one parsed connector file, each naming its field: [{ path, reason }].
export function connectorProblems(value) {
  const problems = validate(value, SCHEMA, () => ({ source: 'connector', line: 1, column: 1 })).map((p) => ({ path: p.path, reason: p.reason }));
  if (problems.length) return problems;
  value.verbs.forEach((v, i) => {
    if (!VERBS.includes(v)) problems.push({ path: `verbs[${i}]`, reason: `verbs[${i}] is "${v}", which isn't a connector verb (${VERBS.join(', ')})` });
  });
  for (const v of VERBS) if (!value.verbs.includes(v)) problems.push({ path: 'verbs', reason: `verbs is missing "${v}": every connector has ${VERBS.join(', ')}` });
  const seen = new Set();
  value.verbs.forEach((v, i) => {
    if (seen.has(v)) problems.push({ path: `verbs[${i}]`, reason: `verbs[${i}] repeats "${v}"` });
    seen.add(v);
  });
  value.holds.forEach((t, i) => {
    if (!STORE_TYPES.includes(t)) problems.push({ path: `holds[${i}]`, reason: `holds[${i}] is "${t}", which isn't a type a store holds (${STORE_TYPES.join(', ')})` });
  });
  for (const [state, to] of Object.entries(value.status_map)) {
    if (!MIRAI_STATES.includes(to)) problems.push({ path: `status_map.${state}`, reason: `status_map.${state} maps to "${to}", which isn't a MIRAI state (${MIRAI_STATES.join(', ')})` });
  }
  if (!Object.keys(value.status_map).length) problems.push({ path: 'status_map', reason: 'status_map maps no state' });
  if ((value.kind === 'external') !== (value.sync_window_minutes !== undefined)) problems.push({ path: 'sync_window_minutes', reason: value.kind === 'external' ? 'an external connector says how long its mirrored status stays fresh (sync_window_minutes)' : 'sync_window_minutes is for an external connector only' });
  return problems;
}

const refuse = (source, problems) => new ConfigError(`${source}: ${problems[0].reason}`, {
  source, path: problems[0].path, reason: problems[0].reason, code: 'connector', errors: problems.map((p) => ({ source, line: 1, column: 1, code: 'connector', ...p })),
});

// One connector file, read as a definition (no symbolic link) and checked. The file's name is the
// connector's.
export function readConnector(path, source = path) {
  const { value } = readConfigFile(path, { trust: 'definition', source });
  const problems = connectorProblems(value);
  const file = path.split('/').at(-1);
  if (!problems.length && file !== `${value.name}.toml`) problems.push({ path: 'name', reason: `name is "${value.name}", but the file is ${file}` });
  if (problems.length) throw refuse(source, problems);
  return deepFreeze(structuredClone(value));
}

// Every connector in a folder: { name: definition }.
export function loadConnectors(dir = CONNECTORS_DIR) {
  const out = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.toml')).sort()) {
    const def = readConnector(join(dir, f), `registry/connectors/${f}`);
    out[def.name] = def;
  }
  return deepFreeze(out);
}

// D5: one source of truth per type. `homes` is the stores a project uses for documents, each
// { name, holds }; a type held by two of them is refused, naming the type and both stores.
export function checkHomes(homes) {
  const owner = new Map();
  for (const h of homes) {
    for (const t of h.holds) {
      if (owner.has(t)) {
        const reason = `the ${t} type has two homes, the ${owner.get(t)} store and the ${h.name} store: a type has one source of truth`;
        throw new ConfigError(reason, { path: `holds.${t}`, reason, code: 'two-homes', hint: `keep ${t} in one store` });
      }
      owner.set(t, h.name);
    }
  }
  return Object.fromEntries(owner);
}

// The MIRAI state for a store's own state, or null (an unmapped state is shown as it is).
export const miraiState = (def, state) => def.status_map[state] ?? null;
