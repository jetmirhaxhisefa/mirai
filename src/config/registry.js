import { readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, isAbsolute, sep } from 'node:path';

import { ConfigError } from '../cli/errors.js';
import { readConfigFile } from './load.js';
import { validate } from './schema.js';
import { deepFreeze } from '../util/freeze.js';

// The registry core (unit 03b, D-37): agents and document types as checked data. Long text
// (prompts, templates, checklists) lives in .md files next to the definitions, referenced by a
// relative path that must stay inside the registry folder.

const NAME = /^[a-z][a-z0-9-]*$/;
const mdPath = { type: 'string', pattern: /\.md$/, patternHint: 'a relative path to a .md file' };

const AGENT = {
  type: 'table',
  fields: {
    kind: { type: 'enum', values: ['agent'] },
    schema_version: { type: 'integer', min: 1, max: 1 },
    name: { type: 'string', pattern: /^mirai-[a-z0-9-]+$/, patternHint: 'for example "mirai-developer"' },
    role: { type: 'string', pattern: NAME, patternHint: 'for example "developer"' },
    default_tier: { type: 'enum', values: ['light', 'standard', 'deep'] },
    read_only: { type: 'boolean' },
    prompt: mdPath,
    may_write: {
      type: 'table',
      fields: {
        paths: {
          type: 'array',
          items: { type: 'string', pattern: /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[^\\\s]+$/, patternHint: 'a relative glob inside the repo, without ".."' },
        },
      },
    },
    tools: { type: 'table', fields: { allowed: { type: 'array', items: { type: 'string', pattern: /^[A-Za-z][A-Za-z0-9_]*$/ } } } },
  },
  required: ['kind', 'schema_version', 'name', 'role', 'default_tier', 'read_only', 'prompt'],
  check(value, path, report) {
    if (value.read_only === true && (value.may_write?.paths?.length ?? 0) > 0) {
      report('may_write.paths', 'a read-only agent can\'t have may_write.paths', undefined, 'read-only');
    }
  },
};

const DOCUMENT_TYPE = {
  type: 'table',
  fields: {
    kind: { type: 'enum', values: ['document-type'] },
    schema_version: { type: 'integer', min: 1, max: 1 },
    name: { type: 'string', pattern: NAME, patternHint: 'for example "prd"' },
    template: mdPath,
    checklist: mdPath,
    required_sections: { type: 'array', items: { type: 'string', pattern: /\S/ }, minItems: 1 },
    states: {
      type: 'table',
      fields: {
        names: { type: 'array', items: { type: 'string', pattern: NAME }, minItems: 1 },
        initial: { type: 'string' },
        transitions: {
          type: 'array',
          items: {
            type: 'table',
            fields: { from: { type: 'string' }, to: { type: 'string' }, human_only: { type: 'boolean' } },
            required: ['from', 'to'],
          },
        },
      },
      required: ['names', 'initial', 'transitions'],
      check: checkStateMachine,
    },
  },
  required: ['kind', 'schema_version', 'name', 'template', 'checklist', 'required_sections', 'states'],
};

function checkStateMachine(states, path, report) {
  if (!Array.isArray(states.names) || !Array.isArray(states.transitions)) return;
  const known = new Set(states.names);
  if (!known.has(states.initial)) report(`${path}.initial`, `${path}.initial is not one of ${path}.names`, undefined, 'state-machine');
  const next = new Map(states.names.map((n) => [n, []]));
  states.transitions.forEach((t, i) => {
    for (const end of ['from', 'to']) {
      if (typeof t?.[end] === 'string' && !known.has(t[end])) report(`${path}.transitions[${i}].${end}`, `${path}.transitions[${i}].${end} is not one of ${path}.names`, undefined, 'state-machine');
    }
    if (known.has(t?.from) && known.has(t?.to)) next.get(t.from).push(t.to);
  });
  if (!known.has(states.initial)) return;
  const seen = new Set([states.initial]);
  const queue = [states.initial];
  while (queue.length) for (const n of next.get(queue.shift())) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  states.names.forEach((name, i) => {
    if (!seen.has(name)) report(`${path}.names[${i}]`, `${path}.names[${i}] can't be reached from ${path}.initial`, undefined, 'state-machine');
  });
}

const KINDS = [
  { folder: 'agents', kind: 'agent', schema: AGENT, refs: ['prompt'] },
  { folder: 'document-types', kind: 'document-type', schema: DOCUMENT_TYPE, refs: ['template', 'checklist'] },
];

// Loads and checks every definition under `dir`. Returns frozen `{ agents, documentTypes }`
// keyed by name, or throws one ConfigError listing every problem.
export function loadRegistry(dir) {
  const problems = [];
  const out = { agents: {}, documentTypes: {} };
  for (const { folder, kind, schema, refs } of KINDS) {
    let files = [];
    const sub = join(dir, folder);
    let info;
    try {
      info = lstatSync(sub);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (info && !info.isDirectory()) {
      problems.push({ code: info.isSymbolicLink() ? 'symlink' : 'not-folder', source: folder, line: 1, column: 1, reason: `${folder} must be a real folder inside the registry` });
      continue;
    }
    if (info) files = readdirSync(sub).filter((f) => f.endsWith('.toml')).sort();
    const bucket = kind === 'agent' ? out.agents : out.documentTypes;
    for (const f of files) {
      const source = `${folder}/${f}`;
      let file;
      try {
        file = readConfigFile(join(dir, folder, f), { trust: 'definition', source, within: dir });
      } catch (err) {
        if (!(err instanceof ConfigError)) throw err;
        problems.push(...err.errors.map((e) => ({ ...e, source })));
        continue;
      }
      const locate = (path) => {
        for (let p = path; ; p = p.slice(0, Math.max(p.lastIndexOf('.'), p.lastIndexOf('['), 0))) {
          const at = file.positions.get(p);
          if (at) return { source, ...at };
          if (p === '') return { source, line: 1, column: 1 };
        }
      };
      const found = validate(file.value, schema, locate);
      for (const ref of refs) {
        const target = file.value[ref];
        if (typeof target !== 'string') continue;
        const reason = badReference(dir, target);
        if (reason) found.push({ code: 'reference', ...locate(ref), path: ref, reason: `${ref} ${reason}`, hint: 'a relative path to a .md file inside the registry folder' });
      }
      const name = file.value.name;
      if (typeof name === 'string' && Object.hasOwn(bucket, name)) {
        found.push({ code: 'duplicate', ...locate('name'), path: 'name', reason: `name is already used by another ${kind} definition` });
      }
      problems.push(...found);
      if (found.length === 0) bucket[name] = file.value;
    }
  }
  if (problems.length > 0) {
    const n = problems.length;
    throw new ConfigError(`${n} problem${n === 1 ? '' : 's'} in the registry`, { errors: problems });
  }
  return deepFreeze(out);
}

// Why a referenced .md path is not acceptable, or null.
function badReference(dir, target) {
  if (isAbsolute(target) || target.includes('\\') || target.split('/').includes('..')) return 'must stay inside the registry folder';
  let info;
  try {
    info = lstatSync(join(dir, target));
  } catch {
    return 'points to a file that does not exist';
  }
  if (info.isSymbolicLink()) return 'is a symbolic link';
  if (!info.isFile()) return 'is not a file';
  // A symlinked folder on the way could still lead outside.
  const root = realpathSync(dir);
  if (!realpathSync(join(dir, target)).startsWith(root + sep)) return 'must stay inside the registry folder';
  return null;
}
