import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ConfigError } from '../cli/errors.js';
import { parseToml } from './toml.js';
import { validate } from './schema.js';
import { deepFreeze } from '../util/freeze.js';
import { verifySigned } from '../sign/sign.js';
import { readFrontmatter } from '../lint/frontmatter.js';
import { scanMarkdown } from '../lint/markdown.js';
import { BUILT_IN_CHECKS, CHECK_READS, FLOOR_DENY_TOOLS, SUMMARY_PARTS, checkDocumentTypeDef, loadCustomRoles, renamedRoleMessage } from './registry.js';
import { CUSTOM_FOLDERS, CUSTOM_KINDS, readCustomItems, roleProtectedWrites, strayCustomProblem } from './custom-items.js';

// Overlays (unit 37; D-37, R2-M12): a project's own changes to MIRAI's document types, templates,
// agents and skills, kept in .mirai/custom/ beside MIRAI's files. Each is approved by you (signed,
// over its bytes) and read only from the trust root (the integration branch's commit), like the
// project's roles and stacks. Each is applied on top of MIRAI's current definition every time it's
// read, so a MIRAI update still reaches the project.
//
//   document-types/<type>.toml   a section overlay (add, order, rename, lint_checks), or with
//                                replace = true, a whole replacement template
//   templates/<type>.md          the template fragments for added sections, or the replacement
//   agents/<name>.toml + .md     an agent's instructions and permissions
//   skills/<name>/overlay.toml + overlay.md   a skill's instructions
//
// Unit 39 adds the project's own items beside them (src/config/custom-items.js): project-skills/,
// hooks/, scripts/ and mcp/, each with its own schema and approval record, read and approved the
// same way.
//
// Neither way may drop what MIRAI's machinery reads: each type's protected_sections and
// protected_fields (registry.js). A rename goes through the map, and MIRAI's code reads the
// project's name as MIRAI's.

export const CUSTOM_DIR = '.mirai/custom';
export const OVERLAY_FOLDERS = Object.freeze(['document-types', 'templates', 'agents', 'skills', ...CUSTOM_FOLDERS]);
export const OVERLAY_KINDS = Object.freeze(['document-type', 'agent', 'skill', ...CUSTOM_KINDS]);
export { CUSTOM_KINDS };
// Unit 37 (Jet's answer to Q3, "A"): each approval is also a signed record committed beside the
// overlays, so it travels with the repo: .mirai/custom/approvals/<kind>-<name>.json.
export const RECORDS_FOLDER = 'approvals';
export const OVERLAY_RECORD_SCHEMA = 'mirai-overlay-approval/1';
export const overlayRecordContext = (repoId) => `mirai/overlay-approval/1:${repoId}`;
const READ_FOLDERS = Object.freeze([...OVERLAY_FOLDERS, RECORDS_FOLDER]);
const NAME = /^[a-z][a-z0-9-]*$/;
const MAX_BYTES = 256 * 1024;
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const heading = { type: 'string', pattern: /^\S(?:.*\S)?$/, patternHint: 'a heading text, without leading or trailing spaces' };
const INSTRUCTIONS = {
  type: 'table',
  fields: {
    // `append` adds the .md file's text at the end; `replace` puts it in place of one part: the
    // heading line `part` names, down to the next heading of the same or a higher level.
    mode: { type: 'enum', values: ['append', 'replace'] },
    part: { type: 'string', pattern: /^#{1,6} \S.{0,200}$/, patternHint: 'a heading line such as "## Output"' },
  },
  required: ['mode'],
  check(value, path, report) {
    if (value.mode === 'replace' && value.part === undefined) report(`${path}.part`, `${path}.part names the heading of the part a replace takes the place of`, 'for example part = "## Output"', 'required');
    if (value.mode === 'append' && value.part !== undefined) report(`${path}.part`, `${path}.part is only for mode = "replace"`, undefined, 'invalid');
  },
};

const TYPE_OVERLAY = {
  type: 'table',
  fields: {
    kind: { type: 'enum', values: ['document-type-overlay'] },
    schema_version: { type: 'integer', min: 1, max: 1 },
    name: { type: 'string', pattern: NAME, patternHint: 'the type it changes, such as "prd"' },
    replace: { type: 'boolean' },
    add: {
      type: 'array',
      uniqueBy: 'name',
      // `variants`: the variants that require it (a PRD's lite and full), every one by default;
      // `checklist`: the verifier's questions for it, added to the type's checklist (P1's
      // findings, 2026-11-21).
      items: {
        type: 'table',
        fields: {
          name: heading, after: heading, required: { type: 'boolean' },
          variants: { type: 'array', minItems: 1, items: { type: 'string', pattern: NAME, patternHint: 'a variant such as "full"' } },
          checklist: { type: 'array', minItems: 1, items: { type: 'string', pattern: /^\S[^\n]{0,400}$/, patternHint: 'one line, a yes / no question' } },
        },
        required: ['name'],
      },
    },
    order: { type: 'array', minItems: 1, items: heading },
    // MIRAI's name to the project's ("Summary for approval" to "Executive summary"). A list of
    // from/to pairs: MIRAI's TOML subset has no quoted keys, and section names have spaces.
    rename: {
      type: 'array',
      uniqueBy: 'from',
      items: { type: 'table', fields: { from: heading, to: heading }, required: ['from', 'to'] },
    },
    lint_checks: { type: 'array', items: { type: 'enum', values: BUILT_IN_CHECKS } },
  },
  required: ['kind', 'schema_version', 'name'],
};

const AGENT_OVERLAY = {
  type: 'table',
  fields: {
    kind: { type: 'enum', values: ['agent-overlay'] },
    schema_version: { type: 'integer', min: 1, max: 1 },
    name: { type: 'string', pattern: /^mirai-[a-z0-9-]+$/, patternHint: 'the agent it changes, such as "mirai-reviewer"' },
    role: { type: 'string', pattern: NAME, patternHint: 'a role\'s name, such as "reviewer"' },
    read_only: { type: 'boolean' },
    tools: { type: 'table', fields: { allowed: { type: 'array', minItems: 1, items: { type: 'string', pattern: /^[A-Za-z][A-Za-z0-9_-]*$/, patternHint: 'a tool name such as "Read"' } } }, required: ['allowed'] },
    // Not taken: an agent's own write scope isn't applied by MIRAI (unit 21a). It's refused with
    // the way that works: a role of its own.
    may_write: { type: 'table', fields: { paths: { type: 'array', items: { type: 'string' } } } },
    // Not taken either (unit 38b): the persona is MIRAI's, the name its output gives the agent.
    persona: { type: 'string' },
    instructions: INSTRUCTIONS,
  },
  required: ['kind', 'schema_version', 'name'],
};

const SKILL_OVERLAY = {
  type: 'table',
  fields: {
    kind: { type: 'enum', values: ['skill-overlay'] },
    schema_version: { type: 'integer', min: 1, max: 1 },
    name: { type: 'string', pattern: /^mirai-[a-z0-9-]+$/, patternHint: 'the skill it changes, such as "mirai-write"' },
    instructions: INSTRUCTIONS,
  },
  required: ['kind', 'schema_version', 'name', 'instructions'],
};

// ---- Reading the files -------------------------------------------------------------------

// Every overlay file under `dir` (a .mirai/custom folder): Map<relative path, Buffer>. Folders
// other than OVERLAY_FOLDERS (stacks, roles, test adapters, hooks) aren't overlays. A link or
// anything that isn't a regular file is given as null, so it shows as a problem.
export function overlayFilesIn(dir) {
  const files = new Map();
  const walk = (rel) => {
    let names;
    try {
      names = readdirSync(join(dir, rel)).sort();
    } catch {
      return;
    }
    for (const n of names) {
      if (n.startsWith('.')) continue;
      const r = rel ? `${rel}/${n}` : n;
      if (!rel && !READ_FOLDERS.includes(n)) continue;
      const st = lstatSync(join(dir, r));
      if (st.isDirectory()) walk(r);
      else files.set(r, st.isFile() && st.size <= MAX_BYTES ? readFileSync(join(dir, r)) : null);
    }
  };
  walk('');
  return files;
}

// Map<relative path, Buffer> from a list of [path under .mirai/custom/, bytes] pairs (the trust
// root's files, or a commit's blobs), keeping only the overlay folders.
export function overlayFilesFrom(entries) {
  const files = new Map();
  for (const [rel, bytes] of entries) {
    if (!READ_FOLDERS.includes(rel.split('/')[0])) continue;
    files.set(rel, bytes === null || bytes.length > MAX_BYTES ? null : bytes);
  }
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// ---- Reading the overlays ---------------------------------------------------------------

// The overlays in `files` (from overlayFilesIn or overlayFilesFrom), each checked against MIRAI's
// definitions in `registry`: [{ path, kind, name, main, bound, hash, problems, result }].
// - `path`: the overlay's main file, as `mirai approve --file` names it (.mirai/custom/…);
// - `bound`: the other files its approval covers ([{ path, content_hash }]), such as the template
//   beside a type overlay;
// - `hash`: the main file's content hash;
// - `problems`: why it can't be used (empty when it validates);
// - `result`: what it makes (see applyType, applyAgent, applySkill).
// `roles`: the roles an agent overlay may name (MIRAI's and the project's).
export function readOverlays(files, registry, { roles = registry.roles ?? {}, flagScript = null } = {}) {
  const out = [];
  const used = new Set();
  const take = (rel) => {
    used.add(rel);
    return files.has(rel) ? files.get(rel) : undefined;
  };
  const full = (rel) => `${CUSTOM_DIR}/${rel}`;
  for (const rel of files.keys()) {
    let m;
    if ((m = /^document-types\/([^/]+)\.toml$/.exec(rel))) {
      const md = `templates/${m[1]}.md`;
      out.push(one({ kind: 'document-type', name: m[1], rel, bytes: take(rel), boundRel: md, boundBytes: take(md), full }, (o) => applyType(o, registry)));
    } else if ((m = /^agents\/([^/]+)\.toml$/.exec(rel))) {
      const md = `agents/${m[1]}.md`;
      out.push(one({ kind: 'agent', name: m[1], rel, bytes: take(rel), boundRel: md, boundBytes: take(md), full }, (o) => applyAgent(o, registry, roles)));
    } else if ((m = /^skills\/([^/]+)\/overlay\.toml$/.exec(rel))) {
      const md = `skills/${m[1]}/overlay.md`;
      out.push(one({ kind: 'skill', name: m[1], rel, bytes: take(rel), boundRel: md, boundBytes: take(md), full }, (o) => applySkill(o, registry)));
    }
  }
  // Unit 39: the project's own items.
  out.push(...readCustomItems(files, registry, used, { flagScript }));
  // A file no overlay takes: a template or text with no .toml beside it, or something else. The
  // approval records are read on their own (verifyRecords).
  for (const rel of files.keys()) {
    if (used.has(rel) || rel.startsWith(`${RECORDS_FOLDER}/`)) continue;
    const stray = strayCustomProblem(rel);
    if (stray) {
      const kind = { 'project-skills': 'project-skill', hooks: 'hook', scripts: 'script', mcp: 'mcp' }[rel.split('/')[0]];
      out.push({ path: full(rel), kind, name: rel.split('/')[1]?.replace(/\.[a-z]+$/, '') ?? rel, main: files.get(rel), bound: [], hash: files.get(rel) ? sha256(files.get(rel)) : null, problems: [stray], result: null, flags: [] });
      continue;
    }
    const owner = /^templates\/([^/]+)\.md$/.exec(rel) ? `document-types/${rel.slice(10, -3)}.toml`
      : /^agents\/([^/]+)\.md$/.exec(rel) ? `${rel.slice(0, -3)}.toml`
        : /^skills\/[^/]+\/overlay\.md$/.test(rel) ? rel.replace(/\.md$/, '.toml') : null;
    const kind = rel.startsWith('templates/') || rel.startsWith('document-types/') ? 'document-type' : rel.startsWith('agents/') ? 'agent' : 'skill';
    const bytes = files.get(rel);
    out.push({
      path: full(rel), kind, name: rel.split('/')[1]?.replace(/\.(toml|md)$/, '') ?? rel, main: bytes, bound: [], hash: bytes ? sha256(bytes) : null,
      problems: [owner ? `it has no ${full(owner)} beside it, which says how it applies` : 'it isn\'t an overlay file (a type overlay is document-types/<type>.toml, an agent\'s agents/<name>.toml, a skill\'s skills/<name>/overlay.toml)'],
      result: null,
    });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function one({ kind, name, rel, bytes, boundRel, boundBytes, full }, apply) {
  const o = { path: full(rel), kind, name, main: bytes ?? null, bound: [], hash: bytes ? sha256(bytes) : null, problems: [], result: null, value: null, text: null };
  if (boundBytes !== undefined) o.bound.push({ path: full(boundRel), content_hash: boundBytes ? sha256(boundBytes) : null });
  if (!bytes) {
    o.problems.push('it isn\'t a regular file of at most 256 KiB');
    return clean(o);
  }
  if (boundBytes === null) o.problems.push(`${full(boundRel)} isn't a regular file of at most 256 KiB`);
  try {
    o.value = parseToml(bytes, { source: o.path, positions: true });
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    o.problems.push(...(err.errors ?? [err]).map((e) => `line ${e.line ?? 1}: ${e.reason ?? e.message}`));
    return clean(o);
  }
  const schema = kind === 'document-type' ? TYPE_OVERLAY : kind === 'agent' ? AGENT_OVERLAY : SKILL_OVERLAY;
  const locate = (path) => {
    for (let p = path; ; p = p.slice(0, Math.max(p.lastIndexOf('.'), p.lastIndexOf('['), 0))) {
      const at = o.value.positions.get(p);
      if (at) return { source: o.path, ...at };
      if (p === '') return { source: o.path, line: 1, column: 1 };
    }
  };
  const issues = validate(o.value.value, schema, locate);
  o.problems.push(...issues.map((i) => `line ${i.line}: ${i.reason}${i.hint ? ` (${i.hint})` : ''}`));
  if (typeof o.value.value.name === 'string' && o.value.value.name !== name) o.problems.push(`name "${o.value.value.name}" isn't the file's name "${name}"`);
  o.text = boundBytes ? boundBytes.toString('utf8') : null;
  if (!o.problems.length) apply(o);
  return clean(o);
}

function clean(o) {
  const value = o.value?.value ?? null;
  delete o.value;
  delete o.text;
  return Object.assign(o, { value });
}

// ---- Document types ---------------------------------------------------------------------

// The type's names a rename may take, and its parts (### headings) that protection covers.
function namesOf(def) {
  const listed = [...def.required_sections, ...(def.optional_sections ?? [])];
  const checks = def.lint_checks ?? [];
  const parts = [...new Set([...(checks.includes('summary') ? SUMMARY_PARTS : []), ...(def.fixed_parts ?? []), ...checks.flatMap((c) => (CHECK_READS[c] ?? []).filter((n) => !listed.includes(n) && n !== '*required*'))])];
  return { listed, parts };
}

const readers = (p) => p.read_by.join(', ');
// "the protected section "Not in this" (read by approval, reader-test, lint)"
const protectedName = (p) => `the protected ${p.part ? 'part' : 'section'} "${p.name}" (read by ${readers(p)})`;

// A type overlay applied to MIRAI's current definition: o.result = { def, template, replace },
// where `def` is the effective type (MIRAI's names, `renames` from MIRAI's name to the project's,
// `template_text` the rendered template, `overlay` the file and hash), or problems.
function applyType(o, registry) {
  const v = o.value.value;
  const core = Object.hasOwn(registry.documentTypes, v.name) ? registry.documentTypes[v.name] : null;
  if (!core) return o.problems.push(`there's no document type "${v.name}" (types: ${Object.keys(registry.documentTypes).sort().join(', ')})`);
  let coreTemplate;
  try {
    coreTemplate = readFileSync(join(registry.dir, core.template), 'utf8');
  } catch {
    return o.problems.push(`MIRAI's ${core.template} can't be read`);
  }
  const problems = o.problems;
  const { listed, parts } = namesOf(core);
  const prot = [...(core.protected_sections ?? []).map((p) => ({ ...p, part: !listed.includes(p.name) }))];
  const isProtected = (name) => prot.find((p) => p.name === name);
  const rename = Object.fromEntries((v.rename ?? []).map((r) => [r.from, r.to]));
  const shown = (name) => (Object.hasOwn(rename, name) ? rename[name] : name);

  // The rename map: MIRAI's names to the project's, one to one, onto names nothing else uses.
  const targets = new Map();
  for (const [from, to] of Object.entries(rename)) {
    if (!listed.includes(from) && !parts.includes(from)) problems.push(`rename "${from}": the ${core.name} type has no section or part by that name`);
    if (from === to) problems.push(`rename "${from}" maps it to itself`);
    if (targets.has(to)) problems.push(`rename maps both "${targets.get(to)}" and "${from}" to "${to}": one name can stand for one section only${isProtected(from) || isProtected(targets.get(to)) ? `, and ${[targets.get(to), from].filter(isProtected).map((n) => protectedName(isProtected(n))).join(' and ')} would be lost` : ''}`);
    targets.set(to, from);
    if ((listed.includes(to) || parts.includes(to)) && !Object.hasOwn(rename, to)) problems.push(`rename "${from}" = "${to}": "${to}" is already another ${core.name} section's name`);
  }
  const inverse = (name) => (targets.has(name) ? targets.get(name) : name);

  // lint_checks: a project adds checks, never removes one (unit 03b).
  const checks = v.lint_checks ?? core.lint_checks ?? [];
  for (const c of core.lint_checks ?? []) if (!checks.includes(c)) problems.push(`lint_checks leaves out MIRAI's "${c}" check: a project may add a check, never remove one`);

  let required = [...core.required_sections];
  let optional = [...(core.optional_sections ?? [])];
  let order = [...(core.section_order ?? listed)];
  let template;
  const added = new Map();
  const onlyIn = new Map();
  const checklistAdds = [];
  if (v.replace === true) {
    if (v.add !== undefined || v.order !== undefined) problems.push('a replacement template sets its own sections and order: add and order are for a section overlay');
    if (o.text === null) return problems.push(`replace = true needs the template: ${CUSTOM_DIR}/templates/${v.name}.md`);
    template = o.text;
    const t = templateParts(template);
    if (!t) return problems.push(`${CUSTOM_DIR}/templates/${v.name}.md has no frontmatter that reads`);
    if (t.value.type !== core.name) problems.push(`the template's frontmatter says type: ${JSON.stringify(String(t.value.type ?? ''))}, not ${core.name}`);
    const h2 = t.scan.headings.filter((h) => h.level === 2).map((h) => h.text);
    const h3 = t.scan.headings.filter((h) => h.level === 3).map((h) => h.text);
    for (const p of prot) {
      const want = shown(p.name);
      if (!(p.part ? h3 : h2).includes(want)) problems.push(`the template has no "${'#'.repeat(p.part ? 3 : 2)} ${want}": ${protectedName(p)}${want !== p.name ? `, renamed to "${want}",` : ''} can't be dropped`);
    }
    for (const f of core.protected_fields ?? []) {
      if (f.name !== undefined && !Object.hasOwn(t.value, f.name)) problems.push(`the template's frontmatter has no "${f.name}": the protected field (read by ${readers(f)}) can't be dropped`);
      if (f.link !== undefined && !t.linkLines.includes(f.link)) problems.push(`the template has no "${f.link}:" line under its title: the protected link line (read by ${readers(f)}) can't be dropped`);
    }
    const sections = h2.map(inverse);
    const seen = new Set();
    for (const s of sections) {
      if (seen.has(s)) problems.push(`the template has "## ${shown(s)}" twice`);
      seen.add(s);
    }
    required = sections.filter((s) => !optional.includes(s));
    optional = sections.filter((s) => optional.includes(s));
    order = sections;
  } else {
    for (const a of v.add ?? []) {
      const known = [...order, ...added.keys()];
      if (known.includes(inverse(a.name)) || listed.includes(a.name) || targets.has(a.name)) {
        problems.push(`add "${a.name}": the ${core.name} type already has a section by that name`);
        continue;
      }
      let at = order.length;
      if (a.after !== undefined) {
        const after = inverse(a.after);
        const i = order.indexOf(after);
        if (i < 0) {
          problems.push(`add "${a.name}": after "${a.after}" isn't one of the ${core.name} type's sections`);
          continue;
        }
        at = i + 1;
      }
      const names = Object.keys(core.variants ?? {});
      if (a.variants !== undefined && !names.length) {
        problems.push(`add "${a.name}": variants is for a type with variants; the ${core.name} type has none`);
        continue;
      }
      const unknown = (a.variants ?? []).filter((x) => !names.includes(x));
      if (unknown.length) {
        problems.push(`add "${a.name}": variants names ${unknown.map((x) => `"${x}"`).join(', ')}, which the ${core.name} type doesn't have (${names.join(', ')})`);
        continue;
      }
      order.splice(at, 0, a.name);
      added.set(a.name, a.required !== false);
      // Required in some variants only: optional for the type, required by those variants.
      const some = a.variants !== undefined && names.some((x) => !a.variants.includes(x));
      if (a.required === false) optional.push(a.name);
      else if (some) {
        optional.push(a.name);
        for (const x of a.variants) onlyIn.set(x, [...(onlyIn.get(x) ?? []), a.name]);
      } else required.push(a.name);
      if (a.checklist) checklistAdds.push({ name: a.name, lines: a.checklist });
    }
    if (v.order !== undefined) {
      const wanted = v.order.map(inverse);
      for (const n of wanted) if (!order.includes(n)) problems.push(`order names "${shown(n)}", which isn't one of the type's sections`);
      for (const n of order) {
        if (wanted.includes(n)) continue;
        const p = isProtected(n);
        problems.push(p ? `order leaves out ${protectedName({ ...p, name: shown(n) })}: it can't be dropped` : `order leaves out "${shown(n)}": name every section once (an overlay can't drop one)`);
      }
      if (new Set(wanted).size !== wanted.length) problems.push('order names a section twice');
      if (checks.includes('summary') && wanted[0] !== order[0] && order[0] === 'Summary for approval' && wanted.includes('Summary for approval')) {
        problems.push(`order moves "${shown('Summary for approval')}" from first: the summary check, approval and the reader test read it there`);
      }
      order = wanted.filter((n) => order.includes(n));
    }
    // Fragments: one "## <name>" block per added section, put into the template where it goes.
    const fragments = new Map();
    if (o.text !== null) {
      const blocks = splitBlocks(o.text.replace(/^﻿/, ''));
      if (blocks.pre.trim()) problems.push(`${CUSTOM_DIR}/templates/${v.name}.md holds text before its first "## " heading: it holds one "## <section>" block per added section`);
      for (const b of blocks.list) {
        if (!added.has(b.name)) problems.push(`${CUSTOM_DIR}/templates/${v.name}.md has "## ${b.name}", which the overlay doesn't add (a section overlay's template holds only added sections)`);
        else fragments.set(b.name, b.text);
      }
    }
    // Each added section carries its own guidance, as MIRAI's do: a "done when:" comment.
    for (const name of added.keys()) {
      if (!fragments.has(name)) problems.push(`add "${name}": ${CUSTOM_DIR}/templates/${v.name}.md has no "## ${name}" block; each added section needs one, with a <!-- done when: … --> comment saying when it's filled`);
      else if (!/<!--[^]*?\bdone when:/i.test(fragments.get(name))) problems.push(`add "${name}": its block in ${CUSTOM_DIR}/templates/${v.name}.md has no <!-- done when: … --> comment; say when the section is filled, as MIRAI's sections do`);
    }
    template = renderTemplate(coreTemplate, { order, rename, fragments, added });
  }
  // Whatever the overlay does, every protected section stays.
  for (const p of prot) if (!p.part && !order.includes(p.name)) problems.push(`${protectedName(p)} isn't in the type with the overlay applied: it can't be dropped`);
  const keep = (list) => (list ?? []).filter((n) => order.includes(n));
  const variants = core.variants ? Object.fromEntries(Object.entries(core.variants).map(([k, x]) => {
    const req = [...keep(x.required_sections), ...(onlyIn.get(k) ?? [])];
    return [k, { ...x, ...(req.length || x.required_sections ? { required_sections: req } : {}) }];
  })) : undefined;
  const plain = JSON.parse(JSON.stringify(core));
  const def = {
    ...plain,
    required_sections: required,
    optional_sections: optional,
    section_order: order,
    lint_checks: checks,
    ...(variants ? { variants } : {}),
    ...(core.may_be_empty ? { may_be_empty: keep(core.may_be_empty) } : {}),
    ...(core.uncounted_sections ? { uncounted_sections: keep(core.uncounted_sections) } : {}),
  };
  if (!problems.length) {
    for (const p of checkDocumentTypeDef(def)) problems.push(`with the overlay applied, ${p.path ? `${p.path}: ` : ''}${p.reason}`);
  }
  if (problems.length) return undefined;
  // The checklist: MIRAI's, with the renames applied to its text, then the added sections' lines.
  let checklist = null;
  try {
    checklist = renameGuidance(readFileSync(join(registry.dir, core.checklist), 'utf8'), rename);
  } catch {
    checklist = null;
  }
  if (checklist !== null && checklistAdds.length) {
    checklist = `${checklist.replace(/\n+$/, '')}\n\n${checklistAdds.map((c) => `## ${c.name}\n\n${c.lines.map((l) => `- ${l}`).join('\n')}`).join('\n\n')}\n`;
  }
  o.result = { def: { ...def, renames: { ...rename }, template_text: template, ...(checklist !== null ? { checklist_text: checklist } : {}), overlay: { path: o.path, hash: o.hash, replace: v.replace === true } }, template, replace: v.replace === true, coreTemplate: { version: core.template_version ?? null, hash: sha256(Buffer.from(coreTemplate, 'utf8')) } };
  return undefined;
}

// A template's frontmatter, body scan and link lines (the labels of "<Label>: [..](..)" lines
// right under its title), or null when its frontmatter doesn't read.
function templateParts(text) {
  let fm;
  try {
    fm = readFrontmatter(text);
  } catch {
    return null;
  }
  if (!fm) return null;
  const scan = scanMarkdown(fm.body);
  const title = scan.headings.find((h) => h.level === 1);
  const linkLines = [];
  for (const l of scan.lines) {
    if (!title || l.line <= title.line || !(l.kind === 'text' || l.kind === 'heading' || l.kind === 'fence')) continue;
    const m = l.kind === 'text' ? /^([A-Z][A-Za-z ]{0,30}): \[/.exec((l.visible ?? l.text).trim()) : null;
    if (!m) break;
    linkLines.push(m[1]);
  }
  return { value: fm.value, scan, linkLines };
}

// A Markdown text's "## " blocks, outside fenced code: { pre, list: [{ name, text }] }, where
// each block's text runs from its heading line to the next "## " heading (or the end).
export function splitBlocks(text) {
  const lines = text.split('\n');
  const list = [];
  let pre = [];
  let cur = null;
  let fence = null;
  for (const line of lines) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^ {0,3}(`{3,}|~{3,})[ \t]*$/.test(line)) fence = null;
    } else if (f) fence = f[1];
    else {
      const h = /^## +(.*?)[ \t]*#*[ \t]*$/.exec(line);
      if (h) {
        cur = { name: h[1].trim(), lines: [line] };
        list.push(cur);
        continue;
      }
    }
    (cur ? cur.lines : pre).push(line);
  }
  return { pre: pre.join('\n'), list: list.map((b) => ({ name: b.name, text: b.lines.join('\n') })) };
}

// MIRAI's template with a section overlay applied: its blocks in the effective order, each
// added section's fragment where it goes (or just its heading), and every renamed "## "/"### "
// heading under the project's name. MIRAI's frontmatter and its text before the first section
// stay as they are, so a MIRAI template change reaches the project.
export function renderTemplate(coreText, { order, rename = {}, fragments = new Map(), added = new Map() }) {
  const body = coreText.replace(/\r\n/g, '\n');
  const fm = /^(﻿?---\n[\s\S]*?\n---\n)/.exec(body);
  const head = fm ? fm[1] : '';
  const { pre, list } = splitBlocks(body.slice(head.length));
  const byName = new Map(list.map((b) => [b.name, b]));
  const out = [];
  const trim = (t) => t.replace(/\n+$/, '');
  for (const name of order) {
    if (byName.has(name)) out.push(trim(byName.get(name).text));
    else if (fragments.has(name)) out.push(trim(fragments.get(name)));
    else if (added.has(name)) out.push(`## ${name}`);
  }
  for (const b of list) if (!order.includes(b.name)) out.push(trim(b.text));
  const text = `${head}${trim(pre)}\n\n${out.join('\n\n')}\n`;
  return renameGuidance(renameHeadings(text, rename), rename);
}

// MIRAI's guidance under the project's names (P1's findings): every quoted mention of a renamed
// section or part, in the HTML comments, the "done when:" lines and the checklist, as "the
// project's name". Only quoted names change: a section's name in running prose ("the summary")
// stays as it is.
export function renameGuidance(text, rename) {
  let out = text;
  for (const [from, to] of Object.entries(rename)) {
    out = out.split(`"${from}"`).join(`"${to}"`).split(`“${from}”`).join(`“${to}”`);
  }
  return out;
}

// Every "## " and "### " heading (outside fences) whose text MIRAI's map renames, under the
// project's name.
export function renameHeadings(text, rename) {
  if (!Object.keys(rename).length) return text;
  let fence = null;
  return text.split('\n').map((line) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && /^ {0,3}(`{3,}|~{3,})[ \t]*$/.test(line)) fence = null;
      return line;
    }
    if (f) {
      fence = f[1];
      return line;
    }
    // A CRLF file keeps its line ending.
    const h = /^(#{2,3}) +(.*?)[ \t]*(\r?)$/.exec(line);
    return h && Object.hasOwn(rename, h[2]) ? `${h[1]} ${rename[h[2]]}${h[3]}` : line;
  }).join('\n');
}

// ---- Agents -----------------------------------------------------------------------------

// An agent overlay applied to MIRAI's definition: o.result = { def, prompt, change, why }, where
// `change` is `instructions` (text only), `narrowing` (fewer tools, read-only, or a read-only
// role) or `widening` (anything its MIRAI definition or its role's mode doesn't allow: a tool, a
// role that may write, read_only = false), and `why` lists what widens or narrows it.
function applyAgent(o, registry, roles) {
  const v = o.value.value;
  const core = Object.hasOwn(registry.agents, v.name) ? registry.agents[v.name] : null;
  if (!core) return o.problems.push(`there's no agent "${v.name}" (agents: ${Object.keys(registry.agents).sort().join(', ')}); a new agent comes with its own unit`);
  const problems = o.problems;
  if (v.may_write !== undefined) problems.push('may_write: an agent\'s own write scope isn\'t applied by MIRAI; give it a role of its own in .mirai/custom/roles/ and name it in role');
  if (v.persona !== undefined) problems.push(`persona: an agent's persona is MIRAI's (${core.persona ?? v.name}); an overlay can't change it`);
  const role = v.role ?? core.role;
  const renamed = renamedRoleMessage(role);
  const roleDef = !renamed && Object.hasOwn(roles, role) ? roles[role] : null;
  if (renamed) problems.push(renamed);
  else if (!roleDef) problems.push(`role "${role}" isn't a role (roles: ${Object.keys(roles).sort().join(', ')})`);
  // Unit 39 (decision 3): a project role's write scope stays out of MIRAI's protected paths.
  if (roleDef && roleDef !== registry.roles?.[role]) {
    for (const w of roleProtectedWrites(roleDef, registry)) problems.push(`role "${role}" may write ${w.pattern}, which MIRAI protects (${w.rule}: ${w.protected}); give the role a write scope outside it`);
  }
  const profile = Object.values(registry.adapters ?? {}).find((a) => a.strict)?.strict ?? null;
  const floor = new Set([...FLOOR_DENY_TOOLS, ...(profile?.deny_tools ?? [])]);
  const tools = v.tools?.allowed ?? core.tools.allowed;
  for (const t of tools) if (floor.has(t)) problems.push(`tools.allowed: ${t} is never an agent's tool (the strict bundle denies it in every launch)`);
  if (new Set(tools).size !== tools.length) problems.push('tools.allowed names a tool twice');
  const readOnly = v.read_only ?? core.read_only;
  if (roleDef && roleDef.mode === 'read-only' && readOnly !== true) problems.push(`the ${role} role is read-only, so the agent must be too (read_only = true)`);
  const corePrompt = readFileSync(join(registry.dir, core.prompt), 'utf8');
  let prompt = corePrompt;
  const mode = v.instructions?.mode ?? (o.text !== null ? 'append' : null);
  if (v.instructions && o.text === null) problems.push(`[instructions] needs the text: ${CUSTOM_DIR}/agents/${v.name}.md`);
  else if (mode) {
    const p = withText(corePrompt, o.text, mode, v.instructions?.part);
    if (p.problem) problems.push(p.problem);
    else prompt = p.text;
  }
  if (problems.length) return undefined;
  const coreTools = new Set(core.tools.allowed);
  const why = [];
  const narrower = [];
  // A tool beyond MIRAI's definition, or beyond what its role's mode gives (the strict profile's
  // tools for read-only or read-write), widens it.
  const modeTools = roleDef.mode === 'read-only' ? profile?.read_only_tools : profile?.read_write_tools;
  const extra = tools.filter((t) => !coreTools.has(t) || (modeTools && !modeTools.includes(t)));
  if (extra.length) why.push(`adds ${extra.join(', ')}${modeTools && extra.some((t) => coreTools.has(t)) ? ` beyond the ${roleDef.mode} mode's tools` : ''}`);
  if (core.read_only === true && readOnly === false) why.push('may write (read_only = false)');
  const coreRole = roles[core.role];
  if (role !== core.role) {
    if (roleDef.mode === 'read-only') narrower.push(`runs as ${role}, a read-only role`);
    else why.push(`runs as ${role}${coreRole?.mode === 'read-only' ? ', a role that may write' : ''}`);
  }
  const fewer = core.tools.allowed.filter((t) => !tools.includes(t));
  if (fewer.length) narrower.push(`drops ${fewer.join(', ')}`);
  if (core.read_only !== true && readOnly === true) narrower.push('read-only');
  const change = why.length ? 'widening' : narrower.length ? 'narrowing' : 'instructions';
  const def = { ...JSON.parse(JSON.stringify(core)), role, read_only: readOnly, tools: { allowed: [...tools] }, overlay: { path: o.path, hash: overlayHash(o), change, why: why.length ? why : narrower, core_role: core.role } };
  o.result = { def, prompt, change, why: why.length ? why : narrower };
  return undefined;
}

// `base` with `text` appended, or in place of the part under the heading line `part` (down to the
// next heading of the same or a higher level): { text } or { problem }.
function withText(base, text, mode, part) {
  const add = text.replace(/^﻿/, '').replace(/\s+$/, '');
  if (mode === 'append') return { text: `${base.replace(/\s+$/, '')}\n\n${add}\n` };
  const lines = base.split('\n');
  const at = lines.findIndex((l) => l.trimEnd() === part);
  if (at < 0) return { problem: `instructions.part: there's no heading line "${part}" to replace` };
  const level = /^#+/.exec(part)[0].length;
  let end = lines.findIndex((l, i) => i > at && /^(#{1,6}) /.test(l) && /^#+/.exec(l)[0].length <= level);
  if (end < 0) end = lines.length;
  return { text: `${[...lines.slice(0, at), add, ...(end < lines.length ? ['', ...lines.slice(end)] : [])].join('\n').replace(/\s+$/, '')}\n` };
}

// ---- Skills -----------------------------------------------------------------------------

function applySkill(o, registry) {
  const v = o.value.value;
  const skill = Object.hasOwn(registry.skills ?? {}, v.name) ? registry.skills[v.name] : null;
  if (!skill) return o.problems.push(`there's no skill "${v.name}" (skills: ${Object.keys(registry.skills ?? {}).sort().join(', ')})`);
  if (o.text === null) return o.problems.push(`the skill overlay needs its text: ${CUSTOM_DIR}/skills/${v.name}/overlay.md`);
  const base = readFileSync(join(registry.dir, skill.folder, 'SKILL.md'), 'utf8');
  const r = withText(base, o.text, v.instructions.mode, v.instructions.part);
  if (r.problem) return o.problems.push(r.problem);
  o.result = { text: r.text };
  return undefined;
}

// ---- Approval and use -------------------------------------------------------------------

// What an overlay's approval line binds: the main file's hash and each bound file's (sorted), so a
// change to either needs a new approval. Also the hash a widened agent's red-team result covers.
export function overlayHash(o) {
  return sha256(Buffer.from([`${o.path} ${o.hash}`, ...o.bound.map((b) => `${b.path} ${b.content_hash ?? 'unreadable'}`)].sort().join('\n'), 'utf8'));
}
const boundSignature = (list) => (list ?? []).map((f) => `${f.path} ${f.content_hash}`).sort().join('\n');

// ---- Approval records (unit 37, Jet's answer to Q3) ----------------------------------------

// The record file for an overlay's main file: approvals/<kind>-<name>.json, under .mirai/custom.
export function recordPathOf(o) {
  return `${CUSTOM_DIR}/${RECORDS_FOLDER}/${o.kind}-${o.name}.json`;
}
// The overlay a record file is for, from its name: its main file's path, or null.
// A script's path has its extension, which the record's name leaves out: `script:<name>` stands for
// it until the record says which file it is.
function overlayPathOfRecord(rel, record = null) {
  const m = /^approvals\/(document-type|agent|skill|project-skill|hook|script|mcp)-([a-z][a-z0-9-]{0,80})\.json$/.exec(rel);
  if (!m) return null;
  const [, kind, name] = m;
  if (kind === 'script') {
    const p = typeof record?.path === 'string' ? record.path : '';
    const s = /^\.mirai\/custom\/scripts\/([a-z][a-z0-9-]{0,80})\.(sh|bash|js|mjs|py)$/.exec(p);
    return s && s[1] === name ? p : `script:${name}`;
  }
  return { 'document-type': `${CUSTOM_DIR}/document-types/${name}.toml`, agent: `${CUSTOM_DIR}/agents/${name}.toml`, skill: `${CUSTOM_DIR}/skills/${name}/overlay.toml`, 'project-skill': `${CUSTOM_DIR}/project-skills/${name}/SKILL.md`, hook: `${CUSTOM_DIR}/hooks/${name}.toml`, mcp: `${CUSTOM_DIR}/mcp/${name}.toml` }[kind];
}
// The key a record is kept under in verifyRecords' map: the item's path (a script's own once its
// record reads).
const recordKeyOf = (o) => (o.kind === 'script' ? `script:${o.name}` : o.path);

// The record `mirai approve --file` writes: the overlay's path, its bound hash (overlayHash: the
// main file and every file it binds), your decision, and for a replacement template MIRAI's
// template version and hash then. Signed with your key, as a decision (never the machine key).
export function overlayRecord(o, { decision, templateVersion = null, templateHash = null, now = () => new Date() }) {
  return {
    schema: OVERLAY_RECORD_SCHEMA, path: o.path, hash: overlayHash(o), content_hash: o.hash, decision, approved_at: now().toISOString(),
    ...(Number.isInteger(templateVersion) ? { template_version: templateVersion } : {}), ...(templateHash ? { template_hash: templateHash } : {}),
  };
}
export const recordText = (record) => `${JSON.stringify(record, null, 2)}\n`;

// The approval records in `files` (overlayFilesIn or overlayFilesFrom), each checked against the
// committed public keys (`keys`, committedKeys) and this repo (`repoId`): Map from the overlay's
// path to { ok, record?, reason? }. A record that doesn't read, isn't signed by one of your
// committed keys, or names another overlay than its file name says is `ok: false`.
export function verifyRecords(files, { keys, repoId, verify = verifySigned }) {
  const out = new Map();
  for (const [rel, bytes] of files) {
    if (!rel.startsWith(`${RECORDS_FOLDER}/`)) continue;
    if (!overlayPathOfRecord(rel)) continue;
    let record = null;
    try {
      record = bytes ? JSON.parse(bytes.toString('utf8')) : null;
    } catch {
      record = null;
    }
    const path = overlayPathOfRecord(rel, record);
    if (!record || typeof record !== 'object' || record.schema !== OVERLAY_RECORD_SCHEMA) {
      out.set(path, { ok: false, reason: 'it isn\'t an approval record MIRAI reads' });
      continue;
    }
    if (record.path !== path) {
      out.set(path, { ok: false, reason: `it's for ${String(record.path).slice(0, 120)}` });
      continue;
    }
    const v = verify(record, keys, { context: overlayRecordContext(repoId), decision: true });
    out.set(path, v.ok ? { ok: true, record, keyId: v.keyId } : { ok: false, reason: v.reason });
  }
  return out;
}

// Where an overlay stands against your approvals: { state, seq, line, reason? } with state
// `approved` (approved as it is now), `changed` (approved before, changed since), `rejected`,
// `not-approved` or `invalid` (it doesn't validate; its approval, if any, doesn't matter).
// `records` (verifyRecords): a committed record is the approval for everyone. When there is one,
// it decides: one that doesn't verify makes the overlay not approved, one for other bytes makes it
// changed, whatever the local journal says. With none, your local journal (`events`) does.
export function overlayState(o, events, records = null) {
  const rec = records?.get(o.path) ?? records?.get(recordKeyOf(o)) ?? null;
  const last = (events ?? []).filter((e) => e.type === 'approval' && e.by === 'human' && e.kind === 'overlay' && e.path === o.path).at(-1) ?? null;
  if (o.problems.length) return { state: 'invalid', seq: last?.seq ?? null, line: rec?.record ?? last };
  if (rec) {
    if (!rec.ok) return { state: 'not-approved', seq: null, line: null, reason: `its approval record doesn't verify: ${rec.reason}` };
    if (rec.record.decision === 'rejected') return { state: 'rejected', seq: null, line: rec.record };
    return { state: rec.record.hash === overlayHash(o) ? 'approved' : 'changed', seq: null, line: rec.record, via: 'record' };
  }
  if (!last) return { state: 'not-approved', seq: null, line: null };
  if (last.decision === 'rejected') return { state: 'rejected', seq: last.seq, line: last };
  const same = last.content_hash === o.hash && boundSignature(last.files) === boundSignature(o.bound.filter((b) => b.content_hash));
  return { state: same ? 'approved' : 'changed', seq: last.seq, line: last };
}

export const STATE_TEXT = Object.freeze({ approved: 'approved', changed: 'changed since approval', rejected: 'rejected', 'not-approved': 'not approved', invalid: 'doesn\'t validate' });

// The one line a command prints for an overlay it skips, naming it and the way to use it.
export function skipLine(o, state, reason = null) {
  const what = o.kind === 'document-type' ? `MIRAI's ${o.name} type` : o.kind === 'agent' ? `MIRAI's ${o.name}` : o.kind === 'skill' ? `MIRAI's ${o.name} skill` : null;
  if (what === null) {
    // Unit 39: a project's own item isn't used at all until it's approved.
    if (state === 'invalid') return `note: ${o.path} doesn't validate (${o.problems[0]}), so it isn't used; mirai show overlays lists every problem`;
    const why = state === 'changed' ? 'changed since its approval' : state === 'rejected' ? 'rejected' : reason ? `not approved (${reason})` : 'not approved';
    return `note: ${o.path} is ${why}, so it isn't used; to use it: mirai approve --file ${o.path}`;
  }
  if (state === 'invalid') return `note: ${o.path} doesn't validate (${o.problems[0]}), so ${what} is used; mirai show overlays lists every problem`;
  const why = state === 'changed' ? 'changed since its approval' : state === 'rejected' ? 'rejected' : reason ? `not approved (${reason})` : 'not approved';
  return `note: ${o.path} is ${why}, so ${what} is used; to use it: mirai approve --file ${o.path}`;
}

// MIRAI's registry with every overlay approved as it is now applied: { registry, overlays,
// skipped }. `overlays` is readOverlays' list with each one's `state`; `skipped` the lines for
// those not used. The registry is a new frozen object: documentTypes and agents replaced where an
// overlay applies, `agentPrompts` (name → prompt text) and `skillTexts` (name → SKILL.md text)
// for the overlaid ones, and `overlays` (what was applied).
// `keys` (committedKeys) and `repoId`: to read the committed approval records; without
// them only the journal counts. `kinds`: the overlay kinds to apply (all by default; mirai render
// and the trust root's bundle take agents and skills).
export function applyOverlays(registry, files, events, { roles, keys = null, repoId = null, kinds = OVERLAY_KINDS } = {}) {
  const records = keys && repoId ? verifyRecords(files, { keys, repoId }) : null;
  const overlays = readOverlays(files, registry, { roles }).filter((o) => kinds.includes(o.kind)).map((o) => ({ ...o, ...overlayState(o, events, records) }));
  // Unit 39: a script an approved hook binds is approved with it, as its bytes are now.
  for (const s of overlays) {
    if (s.kind !== 'script' || s.state === 'approved' || s.problems.length) continue;
    const hook = overlays.find((h) => h.kind === 'hook' && h.state === 'approved' && h.bound.some((b) => b.path === s.path && b.content_hash === s.hash));
    if (hook) Object.assign(s, { state: 'approved', via: 'hook', reason: undefined, line: hook.line });
  }
  const documentTypes = { ...registry.documentTypes };
  const agents = { ...registry.agents };
  const agentPrompts = {};
  const skillTexts = {};
  const skipped = [];
  for (const o of overlays) {
    if (o.state !== 'approved' || !o.result) {
      skipped.push({ path: o.path, kind: o.kind, name: o.name, state: o.state, line: skipLine(o, o.state, o.reason) });
      continue;
    }
    if (o.kind === 'document-type') documentTypes[o.name] = o.result.def;
    else if (o.kind === 'agent') {
      agents[o.name] = o.result.def;
      agentPrompts[o.name] = o.result.prompt;
    } else skillTexts[o.name] = o.result.text;
  }
  const applied = overlays.filter((o) => o.state === 'approved' && o.result).map((o) => ({ path: o.path, kind: o.kind, name: o.name, hash: o.hash, files: [o.path, ...o.bound.map((b) => b.path)] }));
  const out = { ...registry, documentTypes, agents, agentPrompts, skillTexts, overlays: applied };
  // Unit 39: the project's own items approved as they are now, for your sessions' files (mirai
  // render). Never part of what a launch reads.
  const custom = overlays.filter((o) => CUSTOM_KINDS.includes(o.kind) && o.state === 'approved' && o.result).map((o) => ({ path: o.path, kind: o.kind, name: o.name, hash: o.hash, files: [o.path, ...o.bound.map((b) => b.path)], result: o.result }));
  return { registry: deepFreeze(out), overlays, skipped, custom };
}

// The agent and skill overlays for your own sessions' files and the trust root's bundle (unit 37,
// Jet's answer to Q1 and Q2, "A"): only those with a valid committed approval record count, so
// `mirai render` and the trust root render the same files from the same commit. `dir`: a
// .mirai/custom folder (the work tree's, or the trust root's tree). Returns applyOverlays' result.
export function sessionOverlays(registry, { dir, keys, repoId }) {
  let roles = registry.roles;
  try {
    roles = { ...roles, ...loadCustomRoles(dir, roles) };
  } catch {
    // a broken project role shows on the overlay that names it
  }
  return applyOverlays(registry, overlayFilesIn(dir), [], { roles, keys, repoId, kinds: ['agent', 'skill', ...CUSTOM_KINDS] });
}

// A type's template text as the project uses it: the overlay's rendering when one applies, else
// MIRAI's file.
export function templateTextOf(registry, def) {
  if (typeof def.template_text === 'string') return def.template_text;
  return readFileSync(join(registry.dir, def.template), 'utf8');
}

// A type's checklist as the project uses it: the overlay's (MIRAI's lines under the project's
// names, then the added sections' lines) when one applies, else MIRAI's file.
export function checklistTextOf(registry, def) {
  if (typeof def.checklist_text === 'string') return def.checklist_text;
  return readFileSync(join(registry.dir, def.checklist), 'utf8');
}

// The overlay files a work tree has under .mirai/custom, for a note when they can't be read from
// the trust root.
export function hasOverlayFiles(checkout) {
  return overlayFilesIn(join(checkout, CUSTOM_DIR)).size > 0;
}
