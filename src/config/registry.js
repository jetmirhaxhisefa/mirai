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

// The frontmatter fields every document type shares (03 "Templates"); a type's own fields
// can't reuse these names (unit 07b).
export const SHARED_FIELDS = Object.freeze(['id', 'type', 'template', 'status', 'version', 'derived_from', 'upstream', 'downstream', 'owner', 'updated']);
export const FIELD_TYPES = Object.freeze(['string', 'integer', 'boolean', 'date', 'list', 'enum']);
// Checks written in code that a type switches on by name, `lint_checks = ["ticket"]` (unit 08a;
// src/lint/checks.js). Unit 37's overlays may add lint checks, never remove them.
export const BUILT_IN_CHECKS = Object.freeze(['ticket', 'plan']);
// In an ID pattern, `{id}` stands for the document's own id (unit 08a), so a ticket's own
// `AC-<id>.n` never clashes with a PRD's `AC-FR-n.m` mentioned in it.
export const OWN_ID = '{id}';
const SAMPLE_ID = 'PMT-12';
// Escapes the characters that mean something in a pattern (only those: with the u flag,
// escaping anything else is an error).
export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A pattern in a definition must compile (with the u flag), and must not match the empty
// string. The lint anchors it, so it can't match half a word.
function compiles(value, path, report) {
  if (value.includes(OWN_ID)) return report(path, `${path} can't use {id}`, '{id} is only for the patterns in [[ids]]', 'pattern');
  return compilesWith(value, path, report);
}
function compilesWith(value, path, report) {
  let re;
  try {
    re = new RegExp(`^(?:${value})$`, 'u');
  } catch {
    return report(path, `${path} is not a valid regular expression`, undefined, 'pattern');
  }
  if (re.test('')) report(path, `${path} matches an empty string`, undefined, 'pattern');
  return undefined;
}
const regex = { type: 'string', pattern: /\S/, check: compiles };
// An ID pattern may use {id}; it's checked with a sample id in its place.
const idRegex = { type: 'string', pattern: /\S/, check: (value, path, report) => compilesWith(value.split(OWN_ID).join(escapeRegex(SAMPLE_ID)), path, report) };
const sectionName = { type: 'string', pattern: /^\S(?:.*\S)?$/, patternHint: 'a heading text, without leading or trailing spaces' };
const sectionList = { type: 'array', items: sectionName };

const FIELD = {
  type: 'table',
  fields: {
    type: { type: 'enum', values: FIELD_TYPES },
    values: { type: 'array', items: { type: 'string', pattern: /\S/ }, minItems: 1 },
    pattern: regex,
    required: { type: 'boolean' },
  },
  required: ['type'],
  check(field, path, report) {
    if (field.type === 'enum' && field.values === undefined) report(`${path}.values`, `${path}.values is required for an enum`, undefined, 'required');
    if (field.values !== undefined && field.type !== 'enum' && field.type !== 'list') report(`${path}.values`, `${path}.values is only for enum and list fields`, undefined, 'invalid');
    if (field.pattern !== undefined && field.type !== 'string' && field.type !== 'list') report(`${path}.pattern`, `${path}.pattern is only for string and list fields`, undefined, 'invalid');
  },
};

const ID_KIND = {
  type: 'table',
  fields: {
    prefix: { type: 'string', pattern: /^[A-Z][A-Z0-9]{0,15}$/, patternHint: 'capital letters and digits, for example "FR"' },
    pattern: idRegex,
    defined_by: { type: 'enum', values: ['heading', 'bullet', 'table'] },
    parent: { type: 'string' },
    required: { type: 'boolean' },
    // Definitions count only in this section (a ticket's own ACs in "Acceptance criteria").
    section: sectionName,
  },
  required: ['prefix', 'pattern', 'defined_by'],
};

const DOCUMENT_TYPE = {
  type: 'table',
  fields: {
    kind: { type: 'enum', values: ['document-type'] },
    schema_version: { type: 'integer', min: 1, max: 1 },
    name: { type: 'string', pattern: NAME, patternHint: 'for example "prd"' },
    template: mdPath,
    template_version: { type: 'integer', min: 1 },
    checklist: mdPath,
    required_sections: { type: 'array', items: sectionName, minItems: 1 },
    optional_sections: sectionList,
    section_order: sectionList,
    // Sections that may stay empty, such as a plan's logs, filled later (unit 08b).
    may_be_empty: sectionList,
    // Sections inside the frozen block, in order, between the frozen markers (unit 08b).
    frozen_sections: sectionList,
    status: { type: 'enum', values: ['required', 'forbidden'] },
    versioned: { type: 'boolean' },
    id_pattern: regex,
    frontmatter: {
      type: 'table',
      fields: { fields: { type: 'table', map: FIELD, keyPattern: /^[a-z][a-z0-9_]*$/, keyHint: 'a frontmatter key: a–z, 0–9 and _' } },
    },
    ids: { type: 'array', items: ID_KIND, uniqueBy: 'prefix' },
    lint_checks: {
      type: 'array',
      items: { type: 'enum', values: BUILT_IN_CHECKS },
      check(value, path, report) {
        if (new Set(value).size !== value.length) report(path, `${path} names a check twice`, undefined, 'duplicate');
      },
    },
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
  required: ['kind', 'schema_version', 'name', 'template', 'checklist', 'required_sections'],
  check: checkDocumentType,
};

// Rules across keys (unit 07b): states go with status, sections are named once and ordered
// completely, a type's own fields don't reuse shared names, and a dependent ID kind names an
// existing parent and captures its ID.
function checkDocumentType(def, path, report) {
  const status = def.status ?? 'required';
  if (status === 'required' && def.states === undefined) report('states', 'states is required', 'add [states], or status = "forbidden" for tickets (status lives in the store)', 'required');
  if (status === 'forbidden' && def.states !== undefined) report('states', 'states is only for types with status = "required"', undefined, 'invalid');

  const required = Array.isArray(def.required_sections) ? def.required_sections : [];
  const optional = Array.isArray(def.optional_sections) ? def.optional_sections : [];
  const all = [...required, ...optional];
  const seen = new Set();
  all.forEach((name, i) => {
    const where = i < required.length ? `required_sections[${i}]` : `optional_sections[${i - required.length}]`;
    if (seen.has(name)) report(where, `${where} repeats a section name`, undefined, 'duplicate');
    seen.add(name);
  });
  if (Array.isArray(def.section_order)) {
    def.section_order.forEach((name, i) => {
      if (!seen.has(name)) report(`section_order[${i}]`, `section_order[${i}] is not one of the listed sections`, 'use a name from required_sections or optional_sections', 'unknown-section');
    });
    const listed = new Set(def.section_order);
    if (listed.size !== def.section_order.length) report('section_order', 'section_order names a section twice', undefined, 'duplicate');
    for (const name of seen) {
      if (!listed.has(name)) report('section_order', 'section_order leaves out a listed section', 'name every required and optional section once', 'range');
    }
  }

  for (const key of ['may_be_empty', 'frozen_sections']) {
    (Array.isArray(def[key]) ? def[key] : []).forEach((name, i) => {
      if (!seen.has(name)) report(`${key}[${i}]`, `${key}[${i}] is not one of the listed sections`, undefined, 'unknown-section');
    });
  }
  if (Array.isArray(def.frozen_sections) && def.frozen_sections.length > 0) {
    // The frozen sections are one run at the start of the order.
    const order = Array.isArray(def.section_order) ? def.section_order : all;
    if (def.frozen_sections.some((name, i) => order[i] !== name)) report('frozen_sections', 'frozen_sections must be the first sections, in order', undefined, 'range');
  }

  for (const key of Object.keys(def.frontmatter?.fields ?? {})) {
    if (SHARED_FIELDS.includes(key)) report(`frontmatter.fields.${key}`, `frontmatter.fields.${key} is a shared field`, `the shared fields are: ${SHARED_FIELDS.join(', ')}`, 'duplicate');
  }

  const kinds = Array.isArray(def.ids) ? def.ids : [];
  const prefixes = new Set(kinds.map((k) => k?.prefix));
  kinds.forEach((kind, i) => {
    if (typeof kind?.section === 'string' && !seen.has(kind.section)) {
      report(`ids[${i}].section`, `ids[${i}].section is not one of the listed sections`, undefined, 'unknown-section');
    }
    if (typeof kind?.pattern !== 'string') return;
    let groups = 0;
    try {
      groups = new RegExp(`(?:${kind.pattern.split(OWN_ID).join(escapeRegex(SAMPLE_ID))})|`, 'u').exec('').length - 1;
    } catch {
      return; // reported by the pattern check
    }
    if (kind.parent === undefined) {
      if (groups > 0) report(`ids[${i}].pattern`, `ids[${i}].pattern has a capture group but no parent`, 'use (?:…) for grouping', 'pattern');
    } else {
      if (kind.parent === kind.prefix || !prefixes.has(kind.parent)) report(`ids[${i}].parent`, `ids[${i}].parent is not another ID kind's prefix`, undefined, 'unknown-id');
      if (groups !== 1) report(`ids[${i}].pattern`, `ids[${i}].pattern needs exactly one capture group: the parent ID`, 'for example "AC-(FR-[0-9]+)\\.[0-9]+"', 'pattern');
    }
  });
}

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

// Loads and checks every definition under `dir`. Returns frozen `{ dir, agents, documentTypes }`
// keyed by name, or throws one ConfigError listing every problem. `dir` lets the lint read a
// type's template (unit 08a).
export function loadRegistry(dir) {
  const problems = [];
  const out = { dir, agents: {}, documentTypes: {} };
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
