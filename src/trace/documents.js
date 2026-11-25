import { coverage, prdItems, ticketsOf } from '../lint/graph.js';
import { parseDocument } from '../lint/lint.js';
import { METHODS, requirementItems, VERIFIED } from '../lint/prd.js';
import { checkIds } from '../lint/rules.js';

// `mirai trace <initiative>`, the documents' scope (unit 43; Jet's decision 4, 2026-11-21):
// - BR → FR: every BR the brief defines is cited by at least one FR or NFR of the PRD;
// - PRD FR, NFR and AC → ticket: 33's graph-lint coverage (prdItems and coverage, called, never
//   copied): every one is in a ticket's covers_fr or covers_ac; an NFR reaches tickets through
//   covers_fr (42, 37's item 2);
// - NFR → its "Verified by" method, or its own ACs (32's rule), and when the method is a test,
//   a ticket that covers it (the coverage above);
// - ADR "Confirmation" → a named check: a no-op until ADRs exist (62–65), shown as "no ADRs yet";
// - FR → a technical note's component: a no-op until 62b, shown as "no technical note yet".
// A lone ticket's interview folder (`for: ticket`, no PRD) has no documents' scope: its ticket is
// traced on its own (the code's scope). No model runs.

const ITEM_OF = (d) => (d?.doc ? d : null);
const IDS_OF = (doc, def) => checkIds(doc, def, () => {}, null);

// The trace of an initiative's documents, from their texts: { result, scope: 'initiative', item,
// links, missing, notes }. Each document: { path, text } or null. `tickets`: every ticket file
// in the initiative's tickets/ folder: [{ path, text }]. `registry`: the effective registry.
export function traceDocuments({ initiative, brief = null, prd = null, epic = null, tickets = [], interview = null, registry, track = null }) {
  const out = { scope: 'initiative', item: initiative, links: [], missing: [], notes: [] };
  const parse = (d) => {
    if (!d) return null;
    try {
      return { ...d, doc: parseDocument(d.text.replace(/\r\n?/g, '\n'), d.path) };
    } catch {
      return { ...d, doc: null };
    }
  };
  const i = ITEM_OF(parse(interview));
  const p = ITEM_OF(parse(prd));
  if (!p && i?.doc.value.for === 'ticket') {
    return { ...out, result: 'n/a', why: `${initiative} is a lone ticket's interview folder: it has no PRD, so the documents' scope doesn't apply; trace its ticket instead: mirai trace <KEY>` };
  }
  const miss = (id, what, where, kind) => {
    out.missing.push({ id, what, where, kind });
    out.links.push({ from: id, to: null, state: 'missing', where, what });
  };
  const ok = (from, to, where) => out.links.push({ from, to, state: 'pass', where });
  if (!p) {
    miss(initiative, `${initiative} has no PRD (prd.md) to trace`, prd?.path ?? `${initiative}/prd.md`, 'prd');
    return { ...out, result: 'fail' };
  }
  const prdDef = registry.documentTypes.prd;
  const items = requirementItems(p.doc);
  // ---- BR → FR ------------------------------------------------------------------------------
  const b = ITEM_OF(parse(brief));
  if (b && registry.documentTypes.brief) {
    const brs = [...(IDS_OF(b.doc, registry.documentTypes.brief).get('BR')?.keys() ?? [])];
    for (const br of brs) {
      const by = items.filter((x) => (x.prefix === 'FR' || x.prefix === 'NFR') && new RegExp(`\\b${br}\\b`).test(x.statement)).map((x) => x.id);
      if (by.length) ok(br, by.join(', '), p.path);
      else miss(br, `the brief's ${br} isn't cited by any FR or NFR`, p.path, 'br');
    }
  } else out.notes.push('no brief: the BR → FR links aren\'t checked');
  // ---- NFR → its verification method ------------------------------------------------------------
  for (const nfr of items.filter((x) => x.prefix === 'NFR')) {
    const verified = nfr.lines.map((l) => VERIFIED.exec(l.replace(/^ *(?:[-*+]|[0-9]{1,9}[.)])[ \t]+/, '').trim())).find(Boolean);
    const acs = items.filter((a) => a.prefix === 'AC-NFR' && a.parent === nfr.id);
    if (verified && (METHODS.test(verified[1]) || acs.some((a) => verified[1].includes(a.id)))) ok(nfr.id, `verified by: ${verified[1].trim().slice(0, 120)}`, p.path);
    else if (acs.length) ok(nfr.id, `verified by its ACs (${acs.map((a) => a.id).join(', ')})`, p.path);
    else miss(nfr.id, `${nfr.id} names no verification method ("Verified by: <a test level, a measurement or a manual check>") and has no AC`, p.path, 'nfr');
  }
  // ---- PRD FR, NFR and AC → a ticket (33's coverage) ------------------------------------------------
  const e = ITEM_OF(parse(epic));
  const up = { status: 'ok', doc: p.doc, def: prdDef, ids: IDS_OF(p.doc, prdDef) };
  const coverable = prdItems(up);
  if (!e) {
    for (const item of coverable) miss(item.id, `${item.id} isn't covered by any ticket: the initiative has no epic yet`, `${initiative}/epic-${initiative}.md`, 'coverage');
  } else {
    const all = tickets.map((t) => parse(t)).filter((t) => t?.doc).map((t) => ({ path: t.path, value: t.doc.value, doc: t.doc }));
    const own = ticketsOf(all, e.doc.value.id);
    const pool = (track ?? p.doc.value.track) === 'full' ? all.filter((t) => typeof t.value.epic === 'string') : own;
    const covered = coverage(pool);
    for (const item of coverable) {
      const by = covered.get(item.id);
      const field = item.kind === 'AC' ? 'covers_ac' : 'covers_fr';
      if (by?.length) ok(item.id, by.join(', '), e.path);
      else miss(item.id, `${item.id} isn't covered by any ticket`, `${e.path.replace(/[^/]*$/, '')}tickets/ (add it to the ${field} of the ticket that builds it)`, 'coverage');
    }
  }
  // ---- Not built yet: ADR Confirmations (62–65) and the technical note (62b) -------------------
  if (!registry.documentTypes.adr) out.notes.push('no ADRs yet: their "Confirmation" checks are traced once ADRs exist (units 62–65)');
  if (!registry.documentTypes['technical-note']) out.notes.push('no technical note yet: the FR → component links are traced once it exists (unit 62b)');
  return { ...out, result: out.missing.length ? 'fail' : 'pass' };
}

// The missing links as lint problems (Q1 "A", 2026-11-25): what Tess's next launch gets in lint.json,
// each with its file.
export function traceProblems(t) {
  return t.missing.map((m) => ({ severity: 'error', file: m.where, line: 1, column: 1, code: `trace-${m.kind}`, reason: m.what, hint: 'mirai trace names every link of the chain; fix the document that is missing one' }));
}
