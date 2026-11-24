import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readFrontmatter } from './frontmatter.js';
import { scanMarkdown, fixedParts } from './markdown.js';
import { summaryOf, clip } from './summary.js';
import { checkPrdRequirements } from './requirements.js';

// The PRD's own lint (unit 32; research/13 §7, §9d; Jet's decisions 2026-11-19). What the
// generic rules can't say:
// - IDs run 1, 2, 3 … with no gap; ACs run .1, .2 … under their requirement; NG, R and Q carry
//   on after the brief's highest (decision 7);
// - the functional requirements sit in four groups, each with its sentence shape (decision 2):
//   Capabilities "[Actor] can …", Triggers and states "When/While …", Failures "If …, then …",
//   Unchanged behaviour "Where …"; Failures and Unchanged behaviour hold FRs or "None — <reason>";
//   "must", never "shall";
// - every FR names the brief's BR it serves, every BR is served, every FR and NFR has an AC with
//   Given, When and Then, every NFR names how it's verified (D-35);
// - the glossary keeps the template's ID prefixes word for word and defines the terms (decision 3);
// - the whole PRD keeps to its variant's word cap, or carries a length exception you decide
//   (decisions 4–6);
// - at approval: no open question of its own and no [ASSUMPTION] tag outside "Assumptions".

export const FR_GROUPS = Object.freeze(['Capabilities', 'Triggers and states', 'Failures', 'Unchanged behaviour']);
const NONE_OK = /^None — \S/;
const SHAPES = {
  Capabilities: { test: (t) => /\bcan\b/.test(t) && !/^(When|While|If|Where)\b/.test(t), want: '"[Actor] can …"' },
  'Triggers and states': { test: (t) => /^(When|While)\b/.test(t) && /\bmust\b/.test(t), want: '"When …, the system must …" or "While …, … must …"' },
  Failures: { test: (t) => /^If\b/.test(t) && /\bthen\b/.test(t) && /\bmust\b/.test(t), want: '"If …, then … must …"' },
  'Unchanged behaviour': { test: (t) => /^Where\b/.test(t) && /\bmust\b/.test(t), want: '"Where …, … must …"' },
};
const OWN_NUMBERED = ['UJ', 'FR', 'NFR', 'A', 'DEP', 'PH'];
const CONTINUED = ['NG', 'R', 'Q'];
const VERIFIED = /^Verified by: *(.*)$/i;
// Singular or plural (P1's finding: "API tests that …" read as no method).
const METHODS = /\b(unit tests?|integration tests?|api tests?|e2e tests?|end-to-end tests?|tests?|measurements?|measured|manual checks?)\b/i;
const ITEM = /^( *)(?:[-*+]|[0-9]{1,9}[.)])[ \t]+/;

export function checkPrd(doc, def, ctx, add) {
  const { scan, value } = doc;
  const up = ctx.upstream?.status === 'ok' ? ctx.upstream : null;
  const sectionOf = (name) => {
    const h = scan.headings.find((x) => x.level === 2 && x.text === name);
    if (!h) return null;
    const next = scan.headings.find((x) => x.line > h.line && x.level <= 2);
    return { h, lines: scan.lines.filter((l) => l.line > h.line && (!next || l.line < next.line)) };
  };
  const title = scan.headings.find((h) => h.level === 1);
  const top = { line: title?.line ?? doc.bodyLine, column: 1 };

  // ---- Numbering -------------------------------------------------------------------------
  const defs = definitions(doc);
  for (const prefix of OWN_NUMBERED) {
    defs.filter((d) => d.prefix === prefix).forEach((d, i) => {
      if (d.n !== i + 1) add({ code: 'prd-numbering', line: d.line, column: 1, reason: `${d.id} should be ${prefix}-${i + 1}: ${prefix} IDs run 1, 2, 3 … in order, with no gap`, hint: `renumber, and update every mention of the old ${prefix} IDs` });
    });
  }
  for (const prefix of CONTINUED) {
    const theirs = up ? [...(up.ids.get(prefix)?.keys() ?? [])].map((id) => Number(id.split('-')[1])) : [];
    const start = Math.max(0, ...theirs) + 1;
    defs.filter((d) => d.prefix === prefix && !theirs.includes(d.n)).forEach((d, i) => {
      if (up && d.n !== start + i) add({ code: 'prd-numbering', line: d.line, column: 1, reason: `${d.id} should be ${prefix}-${start + i}: the PRD's own ${prefix} IDs carry on after the brief's${theirs.length ? ` (it ends at ${prefix}-${start - 1})` : ''}`, hint: 'one ID means one thing across the brief and the PRD' });
    });
  }
  for (const parent of ['FR', 'NFR']) {
    const byParent = new Map();
    for (const d of defs.filter((x) => x.prefix === `AC-${parent}`)) {
      if (!byParent.has(d.parent)) byParent.set(d.parent, []);
      byParent.get(d.parent).push(d);
    }
    for (const [p, acs] of byParent) {
      acs.forEach((d, i) => {
        if (d.m !== i + 1) add({ code: 'prd-numbering', line: d.line, column: 1, reason: `${d.id} should be AC-${p}.${i + 1}: a requirement's ACs run .1, .2, .3 …`, hint: 'renumber the ACs under this requirement' });
      });
    }
  }

  // ---- Functional requirements ----------------------------------------------------------
  const frSec = sectionOf('Functional requirements');
  const items = requirementItems(doc);
  if (frSec) {
    const h3s = scan.headings.filter((h) => h.level === 3 && h.line > frSec.h.line && (frSec.lines.length === 0 || h.line <= frSec.lines.at(-1).line));
    const names = h3s.map((h) => h.text);
    for (const g of FR_GROUPS) {
      if (!names.includes(g)) add({ code: 'prd-groups', line: frSec.h.line, column: 1, reason: `"Functional requirements" has no "### ${g}"`, hint: `the four groups, in order: ${FR_GROUPS.join(', ')}` });
    }
    for (const h of h3s) {
      if (!FR_GROUPS.includes(h.text)) add({ code: 'prd-groups', line: h.line, column: 1, reason: `"### ${h.text}" is not one of the requirement groups`, hint: `use: ${FR_GROUPS.join(', ')}` });
    }
    const known = names.filter((n) => FR_GROUPS.includes(n));
    if (known.join('\n') !== FR_GROUPS.filter((g) => known.includes(g)).join('\n')) add({ code: 'prd-groups', line: frSec.h.line, column: 1, reason: `the requirement groups are out of order (${known.join(', ')})`, hint: `put them in this order: ${FR_GROUPS.join(', ')}` });
    const before = frSec.lines.find((l) => l.kind === 'text' && ITEM.test(l.text) && /FR-[0-9]/.test(l.text) && (!h3s[0] || l.line < h3s[0].line));
    if (before) add({ code: 'prd-groups', line: before.line, column: 1, reason: 'a requirement sits before the first group', hint: 'put every FR under one of the four groups' });
    h3s.forEach((h, i) => {
      if (!FR_GROUPS.includes(h.text)) return;
      const end = h3s[i + 1]?.line ?? (frSec.lines.at(-1)?.line ?? h.line) + 1;
      const lines = frSec.lines.filter((l) => l.line > h.line && l.line < end && l.kind === 'text');
      const frs = items.filter((it) => it.prefix === 'FR' && it.line > h.line && it.line < end);
      if (frs.length === 0) {
        const none = lines.find((l) => /^None\b/.test(l.text.trim()));
        if (h.text === 'Failures' || h.text === 'Unchanged behaviour') {
          if (!none || !NONE_OK.test(none.text.trim())) add({ code: 'prd-groups', line: h.line, column: 1, reason: `"### ${h.text}" has no requirement`, hint: h.text === 'Failures' ? 'name what can go wrong (bad input, an outage, an edge case) as "If …, then … must …"; or write: None — <why nothing can fail>' : 'name what must stay as it is today as "Where …, … must …"; or write: None — <why nothing existing is touched>' });
        } else if (h.text === 'Capabilities' && !none) {
          add({ code: 'prd-groups', line: h.line, column: 1, reason: '"### Capabilities" has no requirement', hint: 'add "[Actor] can …" requirements, or write: None — <reason>' });
        }
      }
      for (const fr of frs) {
        const shape = SHAPES[h.text];
        if (!shape.test(fr.statement)) add({ code: 'prd-shape', severity: 'warning', line: fr.line, column: 1, reason: `${fr.id} under "${h.text}" reads "${clip(fr.statement, 50)}"`, hint: `write it as ${shape.want}, or move it to the group it belongs to` });
      }
    });
  }
  for (const it of items.filter((x) => x.prefix === 'FR' || x.prefix === 'NFR')) {
    if (/\bshall\b/i.test(it.statement)) add({ code: 'prd-must', line: it.line, column: 1, reason: `${it.id} says "shall"`, hint: 'say "must": it is plain, and every reader takes it the same way' });
    if (it.prefix === 'FR' && !/\(BR-[0-9]+(?:, *BR-[0-9]+)*\)(?: *\((?:A|REQ)-[0-9]+(?:, *(?:A|REQ)-[0-9]+)*\))*\.?$/.test(it.statement)) add({ code: 'prd-trace', line: it.line, column: 1, reason: `${it.id} doesn't name the business requirement it serves`, hint: 'end it with the brief\'s BR in brackets, then any assumptions it rests on and the lines of your own list it carries (unit 41): (BR-2), (BR-2) (A-1) or (BR-2) (REQ-23)' });
    const acs = items.filter((a) => a.prefix === `AC-${it.prefix}` && a.parent === it.id);
    const verified = it.prefix === 'NFR' ? it.lines.map((l) => VERIFIED.exec(l.replace(ITEM, '').trim())).find(Boolean) : null;
    if (it.prefix === 'NFR') {
      // "Verified by: AC-NFR-2.1" points at the NFR's own AC, which is a method (P2, unit 32).
      const byOwnAc = verified && acs.some((a) => verified[1].includes(a.id));
      if (verified && !byOwnAc && !METHODS.test(verified[1])) add({ code: 'prd-verify', line: it.line, column: 1, reason: `${it.id}'s "Verified by:" names no method: "${clip(verified[1], 40)}"`, hint: 'name a test level (unit, integration, API, E2E), a measurement, or a manual check, and what it looks at' });
      if (!verified && acs.length === 0) add({ code: 'prd-verify', line: it.line, column: 1, reason: `${it.id} doesn't say how it's verified`, hint: `add AC-${it.id}.1 (Given / When / Then), or a line "Verified by: <a test level, a measurement or a manual check>"` });
    } else if (acs.length === 0) {
      add({ code: 'prd-ac', line: it.line, column: 1, reason: `${it.id} has no acceptance criterion`, hint: `add AC-${it.id}.1 under it: Given …, when …, then …` });
    }
  }
  for (const ac of items.filter((x) => x.prefix.startsWith('AC-'))) {
    const t = ac.statement;
    const missing = ['Given', 'when', 'then'].filter((w) => !new RegExp(`\\b${w}\\b`, 'i').test(t));
    if (missing.length) add({ code: 'prd-ac', line: ac.line, column: 1, reason: `${ac.id} has no ${missing.map((w) => `"${w[0].toUpperCase()}${w.slice(1)}"`).join(' or ')}`, hint: 'write it as: Given <the state>, when <the action>, then <what anyone can check>' });
  }

  // ---- Every BR of the brief is served ----------------------------------------------------
  if (up) {
    const served = new Set(items.filter((x) => x.prefix === 'FR' || x.prefix === 'NFR').flatMap((x) => x.statement.match(/\bBR-[0-9]+\b/g) ?? []));
    for (const [br] of up.ids.get('BR') ?? []) {
      if (!served.has(br)) add({ code: 'prd-trace', ...top, reason: `the brief's ${br} isn't served by any FR or NFR`, hint: `add the requirement that delivers ${br}, ending with (${br}); if it's out of scope, the brief must change first` });
    }
  }

  // ---- Your own requirements list (unit 41, decision 6) -------------------------------------
  // With a requirements.md beside it: every REQ-n is carried by an FR, NFR or AC, or left out under
  // "Not in this" with its reason; and every REQ-n cited is one the list defines.
  checkPrdRequirements(doc, ctx, add);

  // ---- Variant and track -------------------------------------------------------------------
  const variant = def.variants?.[value.variant] ? value.variant : null;
  const expected = { standard: 'lite', full: 'full' }[value.track];
  if (variant && expected && variant !== expected) add({ code: 'prd-variant', severity: 'warning', ...top, reason: `a ${variant} PRD on the ${value.track} track`, hint: `${value.track} usually takes a ${expected} PRD; say why under "Decisions for you", or change the variant` });

  // ---- The glossary ------------------------------------------------------------------------
  const gloss = sectionOf('Glossary');
  if (gloss) {
    const h3s = scan.headings.filter((h) => h.level === 3 && gloss.lines.some((l) => l.line === h.line));
    for (const part of ['ID prefixes', 'Terms']) {
      if (!h3s.some((h) => h.text === part)) add({ code: 'prd-glossary', line: gloss.h.line, column: 1, reason: `the glossary has no "### ${part}"`, hint: part === 'Terms' ? 'define each term the requirements depend on, once, as "- <term>: <meaning>"' : 'copy "### ID prefixes" from the template as it is' });
    }
    const want = fixedText(ctx, def).get('ID prefixes');
    const have = fixedParts(scan, def).get('ID prefixes');
    if (want !== undefined && have && have.text !== want) add({ code: 'prd-glossary', line: have.line, column: 1, reason: 'the glossary\'s ID prefixes differ from the template\'s', hint: 'copy "### ID prefixes" from the template word for word; it is the same in every PRD' });
  }

  // ---- Length (decisions 4–6) ------------------------------------------------------------
  if (variant) {
    const cap = ctx.project?.limits?.[`${def.name}_${variant}_words`] ?? def.variants[variant].document_words;
    const count = documentWords(doc, def);
    const exception = typeof value.length_exception === 'string' && value.length_exception.trim() !== '';
    const capText = [String(cap), cap.toLocaleString('en-US')];
    if (count > cap && !exception) {
      add({ code: 'prd-length', ...top, reason: `the PRD has ${count} words; a ${variant} PRD's cap is ${cap}`, hint: `split the feature into two PRDs, each with its own BRs${variant === 'lite' ? ', or move it to the full track and put the "how" into the design' : ''}; don't remove requirements or ACs to fit. If it can't be split, set length_exception: "<why>" and ask the approver under "Decisions for you"` });
    } else if (count > cap) {
      add({ code: 'prd-length', severity: 'warning', ...top, reason: `the PRD has ${count} words, over its cap of ${cap}, with a length exception: "${clip(value.length_exception, 60)}"`, hint: 'the approver decides it under "Decisions for you"' });
      const s = summaryOf(scan);
      const decisions = s?.parts.find((p) => p.heading.text === 'Decisions for you');
      const text = (decisions?.lines ?? []).filter((l) => l.kind === 'text').map((l) => l.text).join(' ');
      if (!(capText.some((c) => text.includes(c)) && /\bwords\b/.test(text))) add({ code: 'prd-length', line: decisions?.heading.line ?? top.line, column: 1, reason: 'the length exception isn\'t under "Decisions for you"', hint: `add an item: "This PRD is ${count} words, over the ${cap} cap, because <reason>. Approve it as one PRD, or ask for a split?"` });
    } else {
      if (exception) add({ code: 'prd-length', ...top, reason: `length_exception is set, but the PRD has ${count} words, within its cap of ${cap}`, hint: 'remove length_exception' });
      else if (count >= Math.ceil(cap * 0.8)) add({ code: 'prd-length', severity: 'warning', ...top, reason: `the PRD has ${count} words, close to a ${variant} PRD's cap of ${cap}`, hint: 'if it keeps growing, plan the split now' });
    }
  }

  // ---- At approval ---------------------------------------------------------------------
  if (ctx.approving) {
    const open = defs.filter((d) => d.prefix === 'Q');
    for (const q of open) add({ code: 'prd-open', line: q.line, column: 1, reason: `${q.id} is still open`, hint: 'answer it, put the answer into the requirements, and remove it before approval' });
    const assumptions = sectionOf('Assumptions');
    const inAssumptions = new Set((assumptions?.lines ?? []).map((l) => l.line));
    for (const l of scan.lines) {
      if (l.kind === 'text' && /\[ASSUMPTION\b/.test(l.text) && !inAssumptions.has(l.line)) add({ code: 'prd-assumption', line: l.line, column: 1, reason: 'an [ASSUMPTION] tag is still in the body', hint: 'confirm it and remove the tag, or move it to "Assumptions" as an A-n' });
    }
  }
}

// The defined IDs in order: { prefix, id, n, m?, parent?, line }. AC-FR-3.2 has prefix
// "AC-FR", parent "FR-3", m 2.
function definitions(doc) {
  const out = [];
  const re = /^ *(?:[-*+]|[0-9]{1,9}[.)])[ \t]+(?:\*\*)?((AC-((FR|NFR)-([0-9]+))\.([0-9]+))|((UJ|FR|NFR|NG|R|Q|A|DEP|PH)-([0-9]+)))(?:\*\*)?(?::|[ \t]+—[ \t])/;
  for (const l of doc.scan.lines) {
    if (l.kind !== 'text') continue;
    const m = re.exec(l.text);
    if (!m) continue;
    if (m[2]) out.push({ prefix: `AC-${m[4]}`, id: m[1], parent: m[3], n: Number(m[5]), m: Number(m[6]), line: l.line });
    else out.push({ prefix: m[8], id: m[7], n: Number(m[9]), line: l.line });
  }
  return out;
}

// The requirement and AC list items with their full statement (continuation lines joined, the
// nested items cut off): { prefix, id, parent?, line, statement, lines }.
function requirementItems(doc) {
  const out = [];
  const lines = doc.scan.lines;
  const re = /^( *)(?:[-*+]|[0-9]{1,9}[.)])[ \t]+(?:\*\*)?(AC-((?:FR|NFR)-[0-9]+)\.[0-9]+|FR-[0-9]+|NFR-[0-9]+)(?:\*\*)?(?::|[ \t]+—[ \t])[ \t]*(.*)$/;
  lines.forEach((l, i) => {
    if (l.kind !== 'text') return;
    const m = re.exec(l.visible ?? l.text);
    if (!m) return;
    const indent = m[1].length;
    const parts = [m[4]];
    const own = [l.text];
    for (let j = i + 1; j < lines.length; j++) {
      const n = lines[j];
      if (n.kind === 'blank' || n.kind === 'heading') break;
      if (n.kind !== 'text') continue;
      const item = ITEM.exec(n.text);
      if (item) {
        if (item[1].length <= indent) break;
        // A nested item: an AC (stop the statement), or a line such as "Verified by:".
        own.push(n.text);
        if (/^ *(?:[-*+]|[0-9]{1,9}[.)])[ \t]+(?:\*\*)?AC-/.test(n.text)) break;
        continue;
      }
      parts.push((n.visible ?? n.text).trim());
      own.push(n.text);
    }
    const id = m[2];
    const prefix = id.startsWith('AC-') ? `AC-${m[3].split('-')[0]}` : id.split('-')[0];
    out.push({ prefix, id, parent: m[3], line: l.line, statement: parts.join(' ').replace(/\s+/g, ' ').trim(), lines: own });
  });
  // An NFR's "Verified by:" line can sit anywhere in its nested items.
  for (const it of out.filter((x) => x.prefix === 'NFR')) {
    const start = lines.findIndex((l) => l.line === it.line);
    for (let j = start + 1; j < lines.length; j++) {
      const n = lines[j];
      if (n.kind === 'heading') break;
      if (n.kind !== 'text') continue;
      const item = ITEM.exec(n.text);
      if (item && item[1].length === 0) break;
      if (!it.lines.includes(n.text)) it.lines.push(n.text);
    }
  }
  return out;
}

// The words below the frontmatter: headings and text (tables included); code blocks, comments,
// the fixed parts and the uncounted sections (Glossary, Open questions; Jet, 2026-11-20) left out.
export function documentWords(doc, def) {
  const fixed = [...fixedParts(doc.scan, def).values()];
  const inFixed = (line) => fixed.some((f) => line > f.start && line < f.end);
  const h2 = doc.scan.headings.filter((h) => h.level <= 2);
  const skipped = h2.filter((h) => h.level === 2 && (def.uncounted_sections ?? []).includes(h.text)).map((h) => ({ start: h.line, end: h2.find((x) => x.line > h.line)?.line ?? Infinity }));
  const inSkipped = (line) => skipped.some((r) => line >= r.start && line < r.end);
  return doc.scan.lines
    .filter((l) => (l.kind === 'text' || l.kind === 'heading') && !inFixed(l.line) && !inSkipped(l.line))
    .reduce((n, l) => n + ((l.visible ?? l.text).replace(/^ *#{1,6}[ \t]+/, '').match(/[\p{L}\p{N}][\p{L}\p{N}'’%.-]*/gu) ?? []).length, 0);
}

// The template's fixed parts (name → text), read once per template file.
const FIXED = new Map();
function fixedText(ctx, def) {
  if (ctx.template?.fixed) return ctx.template.fixed;
  const dir = ctx.registry?.dir;
  if (!dir) return new Map();
  const path = join(dir, def.template);
  if (!FIXED.has(path)) {
    try {
      const fm = readFrontmatter(readFileSync(path));
      FIXED.set(path, new Map([...fixedParts(scanMarkdown(fm?.body ?? ''), def)].map(([n, f]) => [n, f.text])));
    } catch {
      FIXED.set(path, new Map());
    }
  }
  return FIXED.get(path);
}
