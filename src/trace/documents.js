import { coverage, prdItems, ticketsOf } from '../lint/graph.js';
import { parseDocument } from '../lint/lint.js';
import { METHODS, requirementItems, VERIFIED } from '../lint/prd.js';
import { checkIds } from '../lint/rules.js';
import { isRetired } from '../lint/retired.js';
import { confirmationsOf, testsFor } from '../adr/confirm.js';

// `mirai trace <initiative>`, the documents' scope (unit 43; Jet's decision 4, 2026-11-21):
// - BR → FR: every BR the brief defines is cited by at least one FR or NFR of the PRD;
// - PRD FR, NFR and AC → ticket: 33's graph-lint coverage (prdItems and coverage, called, never
//   copied): every one is in a ticket's covers_fr or covers_ac; an NFR reaches tickets through
//   covers_fr (42, 37's item 2);
// - NFR → its "Verified by" method, or its own ACs (32's rule), and when the method is a test,
//   a ticket that covers it (the coverage above);
// - ADR "Confirmation" → what checks it (unit 61, Scope 4), for each of the initiative's ADRs in
//   force: `check: <name>` passes when the project's [checks] has it; `test: <id>` when a ticket of
//   the initiative passed the gate with a test named for it (pending until one has shipped);
//   `review: …` goes to the reviewer's checklist. Anything else is a missing link;
// - FR → a technical note's component: a no-op until 62b, shown as "no technical note yet".
// A lone ticket's interview folder (`for: ticket`, no PRD) has no documents' scope: its ticket is
// traced on its own (the code's scope). No model runs.

const ITEM_OF = (d) => (d?.doc ? d : null);
const IDS_OF = (doc, def) => checkIds(doc, def, () => {}, null);

// The trace of an initiative's documents, from their texts: { result, scope: 'initiative', item,
// links, missing, notes }. Each document: { path, text } or null. `tickets`: every ticket file
// in the initiative's tickets/ folder: [{ path, text }]. `registry`: the effective registry.
export function traceDocuments({ initiative, brief = null, prd = null, epic = null, tickets = [], interview = null, registry, track = null, adrs = null, checks = null, adrTests = null }) {
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
  // Unit 43: a retired ID ("FR-4: Retired — <why>") is in no link: it is reserved, never covered.
  const items = requirementItems(p.doc).filter((x) => !isRetired(x.statement));
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
  // ---- ADR "Confirmation" → what checks it (unit 61) ------------------------------------------
  if (!registry.documentTypes.adr) out.notes.push('no ADRs yet: their "Confirmation" checks are traced once ADRs exist (units 62–65)');
  else if (adrs === null) out.notes.push('the ADRs weren\'t read here: their Confirmation links aren\'t checked');
  else traceConfirmations({ out, adrs: adrs.filter((a) => a.mirai && a.initiative === initiative && (a.status === 'accepted' || a.status === 'proposed')), checks: checks ?? [], adrTests, ok, miss });
  // ---- Not built yet: the technical note (62b) ----------------------------------------------
  if (!registry.documentTypes['technical-note']) out.notes.push('no technical note yet: the FR → component links are traced once it exists (unit 62b)');
  return { ...out, result: out.missing.length ? 'fail' : 'pass' };
}

// Each ADR's Confirmation lines as links. `adrTests`: { shipped, names } from the gate runs of the
// initiative's tickets, or null when not read.
function traceConfirmations({ out, adrs, checks, adrTests, ok, miss }) {
  for (const a of adrs) {
    let doc = null;
    try {
      doc = parseDocument(a.text, a.path);
    } catch {
      doc = null;
    }
    const lines = doc ? confirmationsOf(doc.scan) : [];
    if (!lines.length) miss(a.id, `${a.id} has no Confirmation MIRAI can follow (check:, test: or review:)`, a.path, 'adr');
    for (const c of lines) {
      if (c.form === null) miss(a.id, `${a.id}'s Confirmation "${c.text.slice(0, 60)}" names nothing MIRAI can find`, a.path, 'adr');
      else if (c.form === 'check') {
        if (checks.includes(c.what)) ok(a.id, `check: ${c.what}`, a.path);
        else miss(a.id, `${a.id}'s Confirmation names the check ${c.what}, which isn't in the project's [checks]`, '.mirai/config.toml', 'adr');
      } else if (c.form === 'test') {
        const found = adrTests ? testsFor(adrTests.names, a.id) : [];
        if (found.length) ok(a.id, `test: ${found.slice(0, 3).join(', ')}${found.length > 3 ? ` and ${found.length - 3} more` : ''}`, a.path);
        else if (!adrTests || !adrTests.shipped.length) out.links.push({ from: a.id, to: null, state: 'pending', where: a.path, what: `${a.id}'s test isn't seen yet: no ticket of the initiative has passed the gate` });
        else miss(a.id, `no test named for ${a.id} passed in the gate's results (${adrTests.shipped.length} ticket${adrTests.shipped.length === 1 ? '' : 's'} shipped): name one test_${a.id.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_…`, a.path, 'adr');
      } else ok(a.id, `review: ${c.what.slice(0, 100)} (the reviewer checks it)`, a.path);
    }
  }
}

// The missing links as lint problems (Q1 "A", 2026-11-25): what Tess's next launch gets in lint.json,
// each with its file.
export function traceProblems(t) {
  return t.missing.map((m) => ({ severity: 'error', file: m.where, line: 1, column: 1, code: `trace-${m.kind}`, reason: m.what, hint: 'mirai trace names every link of the chain; fix the document that is missing one' }));
}
