import { closest } from '../util/closest.js';
import { linkHasCredential, hasTokenShape, SECRET_PARAM } from '../config/credentials.js';
import { SHARED_FIELDS, OWN_ID, escapeRegex } from '../config/registry.js';
import { headingSlugs } from './markdown.js';
import { CHECKS } from './checks.js';
import { frozenBlock, FROZEN_START, FROZEN_END } from './frozen.js';

// The lint rules (unit 07b, D-41, D-35, D-40): frontmatter fields, sections, IDs, links and
// Mermaid blocks, for one document with a known type. Every rule adds to the same list; none
// stops the others. A problem is { code, severity, line, column, reason, hint? }.

export const DEFAULT_ID = '[A-Za-z0-9][A-Za-z0-9._-]{0,63}';
const TEMPLATE = /^([a-z][a-z0-9-]*)@v([1-9][0-9]{0,5})$/;
const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const NOT_APPLICABLE = /^Not applicable\b/i;
const NOT_APPLICABLE_OK = /^Not applicable — \S/;

export const MERMAID_KEYWORDS = Object.freeze([
  'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'stateDiagram-v2', 'erDiagram',
  'gantt', 'journey', 'pie', 'mindmap', 'timeline', 'gitGraph', 'quadrantChart', 'requirementDiagram',
  'C4Context', 'C4Container', 'C4Component',
]);
// Brackets are counted only in diagrams where they are shapes and blocks. Elsewhere they are
// syntax that doesn't pair (`||--o{` in ER, `)cloud(` in mind maps, the `-)` arrow in sequence
// diagrams) or free text (notes, titles, tasks).
const BRACKET_DIAGRAMS = new Set(['graph', 'flowchart', 'classDiagram', 'C4Context', 'C4Container', 'C4Component']);

const fullMatch = (pattern) => new RegExp(`^(?:${pattern})$`, 'u');

// `doc`: { value, positions, scan, bodyLine }; `def`: the document type; `ctx`: { linkTarget }
// for links to other files, and `repos` (the config's repo names) for the built-in checks
// (see lint.js).
export function checkDocument(doc, def, ctx) {
  const problems = [];
  const add = (p) => problems.push({ severity: 'error', ...p });
  checkFrontmatter(doc, def, add);
  checkSections(doc, def, add);
  checkIds(doc, def, add);
  checkLinks(doc, ctx, add);
  checkMermaid(doc, add);
  if (def.frozen_sections?.length) checkFrozen(doc, def, add);
  if (ctx.template) checkTemplateText(doc, def, ctx.template, add);
  for (const name of def.lint_checks ?? []) CHECKS[name](doc, def, ctx, add);
  return problems;
}

// ---- The frozen block (unit 08b) ----------------------------------------------------------

// The markers are there once each, in order, and enclose exactly the frozen sections; nothing
// that renders sits between the end marker and the next section (it would show as part of the
// last frozen section, unsigned); and inside the block nothing is hidden from the rendered view
// you approve: no other HTML comment, no invisible character. `doc.text` is the whole file, so
// lines are file lines.
const INVISIBLE = /[\u00ad\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/u;

function checkFrozen(doc, def, add) {
  const block = frozenBlock(doc.text ?? '');
  if (block.problem) {
    const reason = { missing: 'the frozen block markers are missing', repeated: 'a frozen block marker appears twice', order: 'the frozen block ends before it starts' }[block.problem];
    add({ code: 'frozen', line: block.line, column: 1, reason, hint: `put ${def.frozen_sections.join(', ')} between ${FROZEN_START} and ${FROZEN_END}` });
    return;
  }
  const h2 = doc.scan.headings.filter((h) => h.level === 2);
  const inside = h2.filter((h) => h.line > block.start && h.line < block.end).map((h) => h.text);
  if (inside.join('\n') !== def.frozen_sections.join('\n')) {
    add({ code: 'frozen', line: block.start, column: 1, reason: `the frozen block must hold exactly: ${def.frozen_sections.join(', ')}`, hint: 'move the agent-owned sections after the end marker' });
  }
  const nextSection = h2.find((h) => h.line > block.end)?.line ?? Infinity;
  const after = doc.scan.lines.find((l) => l.line > block.end && l.line < nextSection && l.kind !== 'blank' && l.kind !== 'comment');
  if (after) add({ code: 'frozen', line: after.line, column: 1, reason: 'text after the frozen block\'s end marker would show as part of it, unsigned', hint: `put ${FROZEN_END} right before the next ## section` });
  for (const l of doc.scan.lines) {
    if (l.line <= block.start || l.line >= block.end) continue;
    if (l.hadComment || l.kind === 'comment') add({ code: 'frozen', line: l.line, column: 1, reason: 'an HTML comment inside the frozen block hides text from what you approve', hint: 'write it as visible text, or remove it' });
    else if (INVISIBLE.test(l.visible ?? '')) add({ code: 'frozen', line: l.line, column: 1, reason: 'an invisible character inside the frozen block', hint: 'remove it' });
  }
}

// ---- Leftover template text (unit 08a) ----------------------------------------------------

// Inside the docs root, a line of the body, the `id`, or a sentence-like string field that is
// word for word the type's template is a leftover: the template wasn't filled in. `template`
// is { lines: Set, fields: Map } from lint.js.
function checkTemplateText(doc, def, template, add) {
  for (const [key, text] of template.fields) {
    if (doc.value[key] === text) {
      const p = doc.positions.get(key);
      add({ code: 'template-text', line: p?.line ?? 1, column: p?.valueColumn ?? p?.column ?? 1, reason: `"${key}" is still the template's example`, hint: 'write this document\'s own value' });
    }
  }
  for (const l of doc.scan.lines) {
    if (l.kind !== 'text') continue;
    const text = (l.visible ?? l.text).trim();
    if (template.lines.has(text)) add({ code: 'template-text', line: l.line, column: l2col(l.text), reason: 'this line is still the template\'s text', hint: 'replace it with this document\'s own text' });
  }
}

// ---- Frontmatter --------------------------------------------------------------------------

function realDate(text) {
  const m = DATE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d); // not Date.UTC, which reads years 0–99 as 1900–1999
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function checkFrontmatter(doc, def, add) {
  const { value, positions } = doc;
  const at = (key) => {
    const p = positions.get(key);
    return p ? { line: p.line, column: p.valueColumn ?? p.column } : { line: 1, column: 1 };
  };
  const keyAt = (key) => {
    const p = positions.get(key);
    return p ? { line: p.line, column: p.column } : { line: 1, column: 1 };
  };
  const present = (key) => Object.hasOwn(value, key);
  const required = (key, hint) => {
    if (!present(key)) {
      add({ code: 'required', line: 1, column: 1, reason: `the frontmatter needs "${key}"`, hint });
      return false;
    }
    if (value[key] === null) {
      add({ code: 'type', ...at(key), reason: `"${key}" needs a value` });
      return false;
    }
    return true;
  };
  const string = (key) => {
    if (typeof value[key] !== 'string' || value[key] === '') {
      add({ code: 'type', ...at(key), reason: `"${key}" must be text` });
      return false;
    }
    return true;
  };

  // id
  if (required('id') && string('id')) {
    if (!fullMatch(def.id_pattern ?? DEFAULT_ID).test(value.id)) {
      add({ code: 'pattern', ...at('id'), reason: `"id" doesn't have the shape of a ${def.name} id`, hint: `it must match ${def.id_pattern ?? DEFAULT_ID}` });
    }
  }

  // template: <type>@v<N>, compared with the definition's version.
  if (required('template', `add template: ${def.name}@v${def.template_version ?? 1}`) && string('template')) {
    const m = TEMPLATE.exec(value.template);
    if (!m) {
      add({ code: 'template', ...at('template'), reason: '"template" must be <type>@v<number>', hint: `for example ${def.name}@v${def.template_version ?? 1}` });
    } else if (m[1] !== def.name) {
      add({ code: 'template', ...at('template'), reason: `"template" names the type "${m[1]}", but the document's type is "${def.name}"` });
    } else {
      const current = def.template_version ?? 1;
      const used = Number(m[2]);
      if (used > current) {
        add({ code: 'template-newer', ...at('template'), reason: `written for a newer template (v${used}; this MIRAI knows v${current})`, hint: 'update MIRAI' });
      } else if (used < current) {
        add({ code: 'template-older', severity: 'warning', ...at('template'), reason: `written for an older template (v${used}; the current one is v${current})`, hint: 'bring the document up to date when you next edit it' });
      }
    }
  }

  // status: from the type's states, or not at all for tickets (D-06).
  if ((def.status ?? 'required') === 'forbidden') {
    if (present('status')) {
      add({ code: 'status-forbidden', ...keyAt('status'), reason: `a ${def.name} has no "status" field`, hint: 'its status lives in the store (D-06); see mirai status' });
    }
  } else if (required('status') && string('status')) {
    const names = def.states?.names ?? [];
    if (!names.includes(value.status)) {
      add({ code: 'enum', ...at('status'), reason: `"status" is not a ${def.name} state`, hint: `use one of: ${names.join(', ')}` });
    }
  }

  // version: only for versioned types.
  if (def.versioned) {
    if (required('version') && !(Number.isInteger(value.version) && value.version >= 1)) {
      add({ code: 'type', ...at('version'), reason: '"version" must be a whole number of at least 1' });
    }
  } else if (present('version')) {
    add({ code: 'unknown-field', ...keyAt('version'), reason: `a ${def.name} isn't versioned, so it has no "version"` });
  }

  for (const key of ['derived_from', 'upstream', 'downstream']) {
    if (present(key)) checkValue(doc, key, { type: 'list', pattern: DEFAULT_ID }, add, at, 'a list of document ids');
  }
  if (present('owner')) checkValue(doc, 'owner', { type: 'string' }, add, at);
  if (present('updated')) checkValue(doc, 'updated', { type: 'date' }, add, at);

  // The type's own fields.
  const own = def.frontmatter?.fields ?? {};
  for (const [key, field] of Object.entries(own)) {
    if (present(key)) checkValue(doc, key, field, add, at);
    else if (field.required) add({ code: 'required', line: 1, column: 1, reason: `the frontmatter needs "${key}"` });
  }

  for (const key of Object.keys(value)) {
    if (SHARED_FIELDS.includes(key) || Object.hasOwn(own, key)) continue;
    const near = closest(key, [...SHARED_FIELDS, ...Object.keys(own)]);
    add({ code: 'unknown-field', ...keyAt(key), reason: `"${key}" is not a ${def.name} field`, hint: near ? `did you mean "${near}"?` : undefined });
  }
}

function checkValue(doc, key, field, add, at, what) {
  const v = doc.value[key];
  const where = at(key);
  if (v === null) return add({ code: 'type', ...where, reason: `"${key}" needs a value` });
  const itemAt = (i) => {
    const p = doc.positions.get(`${key}[${i}]`);
    return p ? { line: p.line, column: p.column } : where;
  };
  switch (field.type) {
    case 'string':
      if (typeof v !== 'string' || v === '') return add({ code: 'type', ...where, reason: `"${key}" must be text` });
      if (field.pattern && !fullMatch(field.pattern).test(v)) return add({ code: 'pattern', ...where, reason: `"${key}" doesn't have the expected shape`, hint: `it must match ${field.pattern}` });
      return undefined;
    case 'integer':
      if (!Number.isInteger(v)) return add({ code: 'type', ...where, reason: `"${key}" must be a whole number` });
      return undefined;
    case 'boolean':
      if (typeof v !== 'boolean') return add({ code: 'type', ...where, reason: `"${key}" must be true or false` });
      return undefined;
    case 'date':
      if (typeof v !== 'string' || !realDate(v)) return add({ code: 'date', ...where, reason: `"${key}" must be a real date, YYYY-MM-DD`, hint: 'for example "2026-10-24" (quoted)' });
      return undefined;
    case 'enum':
      if (!field.values.includes(v)) return add({ code: 'enum', ...where, reason: `"${key}" must be one of: ${field.values.join(', ')}` });
      return undefined;
    case 'list':
      if (!Array.isArray(v)) return add({ code: 'type', ...where, reason: `"${key}" must be ${what ?? 'a list'}`, hint: `write ${key}: [a, b], or a block list` });
      v.forEach((item, i) => {
        if (typeof item !== 'string' || item === '') return add({ code: 'type', ...itemAt(i), reason: `${key}[${i}] must be text` });
        if (field.values && !field.values.includes(item)) return add({ code: 'enum', ...itemAt(i), reason: `${key}[${i}] must be one of: ${field.values.join(', ')}` });
        if (field.pattern && !fullMatch(field.pattern).test(item)) return add({ code: 'pattern', ...itemAt(i), reason: `${key}[${i}] doesn't have the expected shape`, hint: `it must match ${field.pattern}` });
        return undefined;
      });
      return undefined;
    default:
      return undefined;
  }
}

// ---- Sections (D-41) ----------------------------------------------------------------------

function checkSections(doc, def, add) {
  const { headings, lines } = doc.scan;
  const titles = headings.filter((h) => h.level === 1);
  // A document with no body gets its problems on the closing --- line.
  const bodyStart = lines.length ? lines[0].line : doc.bodyLine - 1;
  if (titles.length === 0) {
    add({ code: 'title', line: bodyStart, column: 1, reason: 'the document has no # title', hint: 'start the body with one # heading' });
  } else {
    if (headings[0].level !== 1) add({ code: 'title', line: headings[0].line, column: headings[0].column, reason: 'the # title must be the first heading' });
    const before = lines.find((l) => l.line < titles[0].line && (l.kind === 'text' || l.kind === 'fence'));
    if (headings[0].level === 1 && before) add({ code: 'title', line: before.line, column: 1, reason: 'text comes before the # title', hint: 'start the body with the # title' });
    for (const extra of titles.slice(1)) add({ code: 'title', line: extra.line, column: extra.column, reason: 'a document has one # title', hint: 'use ## for sections' });
  }

  const required = def.required_sections;
  const optional = def.optional_sections ?? [];
  const order = def.section_order ?? [...required, ...optional];
  const known = new Set(order);
  const h2 = headings.filter((h) => h.level === 2);
  const lastLine = lines.length ? lines.at(-1).line : bodyStart;

  const firstOf = new Map();
  h2.forEach((h, i) => {
    if (!known.has(h.text)) {
      const near = closest(h.text, order) ?? order.find((name) => name.toLowerCase() === h.text.toLowerCase());
      add({
        code: 'unknown-section', line: h.line, column: h.column,
        reason: `"${h.text}" is not a ${def.name} section`,
        hint: near ? `did you mean "${near}"?` : 'put it in an existing section, or log a template_gap',
      });
      return;
    }
    if (firstOf.has(h.text)) {
      add({ code: 'duplicate-section', line: h.line, column: h.column, reason: `"${h.text}" appears twice` });
      return;
    }
    firstOf.set(h.text, i);
  });

  const where = titles[0] ? { line: titles[0].line, column: titles[0].column } : { line: bodyStart, column: 1 };
  for (const name of order) {
    if (!firstOf.has(name)) {
      const isOptional = !required.includes(name);
      add({
        code: 'missing-section', ...where,
        reason: `the ${isOptional ? 'optional ' : ''}section "${name}" is missing`,
        hint: isOptional ? `add ## ${name} with "Not applicable — <reason>" if it doesn't apply` : `add ## ${name}`,
      });
    }
  }

  // Order: the known sections follow the template's order. The sections outside the longest
  // run that is already in order are the ones out of place, so one moved section is one problem.
  const placed = h2.filter((h, i) => firstOf.get(h.text) === i);
  const inOrder = longestIncreasing(placed.map((h) => order.indexOf(h.text)));
  placed.forEach((h, i) => {
    if (!inOrder.has(i)) add({ code: 'section-order', line: h.line, column: h.column, reason: `"${h.text}" is out of order`, hint: `the order is: ${order.join(', ')}` });
  });

  // Content: not empty; "Not applicable — reason" only in optional sections, alone.
  h2.forEach((h, i) => {
    if (!known.has(h.text) || firstOf.get(h.text) !== i) return;
    const next = headings.find((x) => x.line > h.line && x.level <= 2);
    const end = next ? next.line : lastLine + 1;
    const content = lines.filter((l) => l.line > h.line && l.line < end && (l.kind === 'text' || l.kind === 'fence' || l.kind === 'heading'));
    if (content.length === 0) {
      if ((def.may_be_empty ?? []).includes(h.text)) return;
      add({ code: 'empty-section', line: h.line, column: h.column, reason: `the section "${h.text}" is empty`, hint: required.includes(h.text) ? undefined : 'write "Not applicable — <reason>" if it doesn\'t apply' });
      return;
    }
    // Hard-wrapped lines form one paragraph.
    const paragraphs = [];
    let last = -2;
    for (const l of content) {
      if (l.kind === 'text' && l.line === last + 1 && paragraphs.at(-1).kind === 'text') paragraphs.at(-1).text += ` ${l.text.trim()}`;
      else paragraphs.push({ kind: l.kind, line: l.line, text: l.text.trim(), raw: l.text });
      last = l.line;
    }
    const na = paragraphs.find((p) => p.kind === 'text' && NOT_APPLICABLE.test(p.text));
    if (!na) return;
    const column = l2col(na.raw);
    if (required.includes(h.text)) {
      add({ code: 'not-applicable', line: na.line, column, reason: `"${h.text}" is required, so it can't be "Not applicable"` });
    } else if (paragraphs.length !== 1 || !NOT_APPLICABLE_OK.test(na.text)) {
      add({ code: 'not-applicable', line: na.line, column, reason: '"Not applicable" needs a reason, as the section\'s only line', hint: 'write: Not applicable — <reason>' });
    }
  });
}

// The positions of one longest strictly increasing subsequence of `ranks`.
function longestIncreasing(ranks) {
  const length = ranks.map(() => 1);
  const previous = ranks.map(() => -1);
  for (let i = 0; i < ranks.length; i++) {
    for (let j = 0; j < i; j++) {
      if (ranks[j] < ranks[i] && length[j] + 1 > length[i]) { length[i] = length[j] + 1; previous[i] = j; }
    }
  }
  const out = new Set();
  let i = length.indexOf(Math.max(0, ...length));
  while (i !== -1) { out.add(i); i = previous[i]; }
  return out;
}

// The ## section each line belongs to.
function sectionOfLine(scan) {
  const out = new Map();
  let current = null;
  const h2 = new Map(scan.headings.filter((h) => h.level <= 2).map((h) => [h.line, h]));
  for (const l of scan.lines) {
    const h = h2.get(l.line);
    if (h) current = h.level === 2 ? h.text : null;
    out.set(l.line, current);
  }
  return out;
}

// An id is repeated in a message unless it looks like a credential.
const shownId = (id) => (hasTokenShape(id) ? '<id>' : id);

const l2col = (text) => [...text.slice(0, text.search(/\S/))].length + 1;

// ---- IDs (D-35) ---------------------------------------------------------------------------

// The ticket-key shape {id} stands for when a definition names another document's id.
const ANY_ID = '[A-Za-z0-9][A-Za-z0-9._-]{0,63}?';

function checkIds(doc, def, add) {
  // `{id}` is this document's own id. Without a usable id (missing, or not the type's shape,
  // which the frontmatter rules report), an {id} kind matches nothing and isn't required.
  const id = doc.value.id;
  const usable = typeof id === 'string' && id !== '' && fullMatch(def.id_pattern ?? DEFAULT_ID).test(id);
  const own = usable ? escapeRegex(id) : '(?!)';
  const sections = sectionOfLine(doc.scan);
  const kinds = (def.ids ?? []).map((k) => ({
    ...k,
    ownId: k.pattern.includes(OWN_ID),
    foreign: k.pattern.includes(OWN_ID) ? new RegExp(`^(?:\\*\\*)?(${k.pattern.split(OWN_ID).join(ANY_ID)})(?:\\*\\*)?(?::|[ \\t]+—[ \\t])`, 'u') : null,
    pattern: k.pattern.split(OWN_ID).join(own),
  })).map((k) => ({
    ...k,
    search: new RegExp(`(?<![\\p{L}\\p{N}_.-])(?:${k.pattern})(?![\\p{L}\\p{N}_]|[.-][\\p{L}\\p{N}])`, 'gu'),
    // A definition is the ID in its definition form: "FR-1: …" or "FR-1 — …" at the start of
    // a heading or list item, or the whole first cell of a table row (D-35, unit 07b).
    start: k.defined_by === 'table'
      ? new RegExp(`^(?:\\*\\*)?(${k.pattern})(?:\\*\\*)?[ \\t]*\\|`, 'u')
      : new RegExp(`^(?:\\*\\*)?(${k.pattern})(?:\\*\\*)?(?::|[ \\t]+—[ \\t])`, 'u'),
    parentOf: k.parent === undefined ? null : fullMatch(k.pattern),
  }));
  if (kinds.length === 0) return;

  const defined = new Map(kinds.map((k) => [k.prefix, new Map()]));
  const mentions = [];
  const colOf = (text, index) => [...text.slice(0, index)].length + 1;

  for (const l of doc.scan.lines) {
    if (l.kind !== 'text' && l.kind !== 'heading') continue;
    for (const k of kinds) {
      for (const m of l.text.matchAll(k.search)) mentions.push({ kind: k, id: m[0], line: l.line, column: colOf(l.text, m.index) });
      // Definitions: at the start of a heading, a list item or a table's first cell.
      const lead = k.defined_by === 'heading' ? (l.kind === 'heading' ? /^ {0,3}#{1,6}[ \t]+(?:\*\*)?/.exec(l.text) : null)
        : k.defined_by === 'bullet' ? (l.kind === 'text' ? /^ *(?:[-*+]|[0-9]{1,9}[.)])[ \t]+(?:\*\*)?/.exec(l.text) : null)
          : (l.kind === 'text' ? /^ *\|[ \t]*(?:\*\*)?/.exec(l.text) : null);
      if (!lead) continue;
      const rest = l.text.slice(lead[0].length);
      const m = k.start.exec(rest);
      const column = colOf(l.text, lead[0].length);
      if (!m) {
        // A definition under another id (a stale copy, a typo) would silently not count: a
        // document never defines another document's IDs.
        const other = k.foreign?.exec(rest);
        if (other && usable) add({ code: 'foreign-id', line: l.line, column, reason: `${shownId(other[1])} is defined here, but this document's ${k.prefix} IDs are ${k.prefix}-${shownId(id)}.n`, hint: 'use this document\'s own id in the AC' });
        continue;
      }
      // Defined outside its section: a problem, but still a definition, so its mentions
      // aren't reported a second time as unknown.
      if (k.section && sections.get(l.line) !== k.section) {
        add({ code: 'misplaced-id', line: l.line, column, reason: `${m[1]} is defined outside "${k.section}"`, hint: `define ${k.prefix} IDs in the "${k.section}" section` });
      }
      const seen = defined.get(k.prefix);
      if (seen.has(m[1])) {
        const first = seen.get(m[1]);
        add({ code: 'duplicate-id', line: l.line, column, reason: `${m[1]} is defined twice`, hint: `first defined on line ${first.line}` });
      } else {
        seen.set(m[1], { line: l.line, column });
      }
    }
  }

  for (const { kind, id, line, column } of mentions) {
    if (!defined.get(kind.prefix).has(id)) add({ code: 'unknown-id', line, column, reason: `${id} is mentioned but not defined in this document` });
  }
  // A required kind needs at least one definition (a ticket's own ACs, unit 08a).
  for (const kind of kinds) {
    if (kind.required && defined.get(kind.prefix).size === 0 && (usable || !kind.ownId)) {
      const title = doc.scan.headings.find((h) => h.level === 1);
      const example = kind.ownId ? `${kind.prefix}-${shownId(id)}.1` : `${kind.prefix}-1`;
      add({
        code: 'missing-id', line: title?.line ?? doc.bodyLine, column: 1,
        reason: `the document defines no ${kind.prefix} IDs`,
        hint: kind.defined_by === 'heading' ? `add a heading such as ### ${example}: …` : kind.defined_by === 'bullet' ? `add a list item such as - ${example}: …` : `add a table row whose first cell is ${example}`,
      });
    }
  }
  // A dependent ID (AC-FR-2.1) needs its parent (FR-2), captured by its pattern.
  for (const kind of kinds) {
    if (!kind.parentOf) continue;
    for (const [id, at] of defined.get(kind.prefix)) {
      const parentId = kind.parentOf.exec(id)?.[1];
      if (parentId !== undefined && !defined.get(kind.parent)?.has(parentId)) {
        add({ code: 'missing-parent', ...at, reason: `${id} belongs to ${parentId}, which isn't defined` });
      }
    }
  }
}

// ---- Links --------------------------------------------------------------------------------

function checkLinks(doc, ctx, add) {
  let ownSlugs = null;
  for (const link of doc.scan.links) {
    const { target, line, column } = link;
    const at = { line, column };
    if (target === '') {
      add({ code: 'link', ...at, reason: 'a link has no target' });
      continue;
    }
    if (linkHasCredential(target) || relativeHasCredential(target)) {
      add({ code: 'link-credential', ...at, reason: 'a link looks like it contains a credential', hint: 'keep links without tokens or passwords' });
      continue;
    }
    const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(target)?.[1].toLowerCase();
    if (scheme || link.kind === 'bare') {
      if (scheme && !['http', 'https', 'mailto'].includes(scheme)) add({ code: 'link-scheme', ...at, reason: `"${scheme}:" links are not allowed`, hint: 'use a relative link to a file in the repo, or an http(s) link' });
      continue;
    }
    if (target.startsWith('//') || target.startsWith('/')) {
      add({ code: 'link-absolute', ...at, reason: 'a link is an absolute path', hint: 'use a path relative to this file' });
      continue;
    }
    const hash = target.indexOf('#');
    const pathPart = (hash === -1 ? target : target.slice(0, hash)).split('?')[0];
    let anchor = hash === -1 ? null : target.slice(hash + 1);
    let path;
    try {
      path = decodeURIComponent(pathPart);
      if (anchor !== null) anchor = decodeURIComponent(anchor);
    } catch {
      add({ code: 'link', ...at, reason: 'a link has a broken %-escape' });
      continue;
    }
    if (path === '') {
      ownSlugs ??= headingSlugs(doc.scan.headings);
      if (anchor && !ownSlugs.has(anchor)) add({ code: 'missing-anchor', ...at, reason: `no heading in this document has the anchor ${shownAnchor(anchor)}` });
      continue;
    }
    const found = ctx.linkTarget(path);
    if (found.problem === 'outside') {
      add({ code: 'link-outside', ...at, reason: 'a link leads outside the repo' });
    } else if (found.problem === 'missing') {
      add({ code: 'missing-file', ...at, reason: 'a link points to a file that does not exist', hint: 'check the path, relative to this file' });
    } else if (anchor && found.slugs && !found.slugs.has(anchor)) {
      add({ code: 'missing-anchor', ...at, reason: `the linked file has no heading with the anchor ${shownAnchor(anchor)}` });
    }
  }
}

// A relative link's query or fragment can carry a secret too (`#access_token=…`): the same
// parameter names as for full links, but only with a value, so `#session-timeout` (a heading
// anchor) is not one.
function relativeHasCredential(target) {
  if (hasTokenShape(target)) return true;
  const parts = [];
  const q = target.indexOf('?');
  const h = target.indexOf('#');
  if (q !== -1) parts.push(target.slice(q + 1, h > q ? h : undefined));
  if (h !== -1) parts.push(target.slice(h + 1));
  return parts.some((part) => [...new URLSearchParams(part)].some(([name, value]) => value !== '' && SECRET_PARAM.test(name)));
}

// An anchor is repeated in a message only when it looks like a heading slug.
const shownAnchor = (anchor) => (/^[\p{L}\p{N}_-]{1,80}$/u.test(anchor) ? `#${anchor}` : '(not shown)');

// ---- Mermaid (D-40) -----------------------------------------------------------------------

function checkMermaid(doc, add) {
  for (const block of doc.scan.fences) {
    if (block.info !== 'mermaid') continue;
    let body = block.body;
    let i = 0;
    const skipBlank = () => { while (i < body.length && (/^\s*$/.test(body[i].text) || /^\s*%%/.test(body[i].text))) i += 1; };
    skipBlank();
    if (i < body.length && body[i].text.trim() === '---') {
      // A Mermaid front-matter block (title, config).
      i += 1;
      while (i < body.length && body[i].text.trim() !== '---') i += 1;
      i += 1;
      skipBlank();
    }
    if (i >= body.length) {
      add({ code: 'mermaid', line: block.line, column: 1, reason: 'a mermaid block is empty' });
      continue;
    }
    const first = body[i];
    const keyword = /^\s*([A-Za-z0-9-]+)/.exec(first.text)?.[1];
    if (!MERMAID_KEYWORDS.includes(keyword)) {
      add({ code: 'mermaid', line: first.line, column: l2col(first.text), reason: 'a mermaid block must start with a diagram type', hint: `for example: ${MERMAID_KEYWORDS.slice(0, 4).join(', ')}` });
      continue;
    }
    if (!BRACKET_DIAGRAMS.has(keyword)) continue;
    // The keyword line counts too (`graph LR; A[x`).
    body = [{ line: first.line, text: first.text.replace(/^\s*[A-Za-z0-9-]+/, (m) => ' '.repeat(m.length)) }, ...body.slice(i + 1)];
    const problem = unbalanced(body, keyword === 'graph' || keyword === 'flowchart');
    if (problem) add({ code: 'mermaid', ...problem });
  }
}

// The first bracket that doesn't pair, outside "quoted strings" and %% comments, or null. In
// flowcharts, `id>text]` (the asymmetric shape) opens with `>`, but only outside other
// brackets: `A[one<br>two]` is a label.
function unbalanced(lines, flowchart) {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  for (const { line, text } of lines) {
    if (/^\s*%%/.test(text)) continue;
    let inString = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      const col = [...text.slice(0, i)].length + 1;
      if (c === '(' || c === '[' || c === '{') stack.push({ c, line, column: col });
      else if (flowchart && c === '>' && stack.length === 0 && i > 0 && /[\p{L}\p{N}_]/u.test(text[i - 1])) stack.push({ c: '[', line, column: col });
      else if (c in pairs) {
        const open = stack.pop();
        if (!open || open.c !== pairs[c]) return { line, column: col, reason: `"${c}" in the mermaid block has no matching "${pairs[c]}"` };
      }
    }
  }
  const open = stack.pop();
  return open ? { line: open.line, column: open.column, reason: `"${open.c}" in the mermaid block is never closed` } : null;
}
