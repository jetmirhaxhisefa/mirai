import { checkOpenMarks } from './open.js';
import { tableIn } from './checks.js';

// The LLD's own lint (unit 63, Scope 2), beyond the generic rules (the sections, the HLD link, the
// cited FR/NFR IDs, C-n and S-n defined once in their sections):
// - Contracts (when not "Not applicable"): at least one failure table (Failure | Status | Code |
//   Retryable), and a "Retry:" line for each write (POST, PUT, PATCH, DELETE, or a row whose
//   operation says "write");
// - Schema changes: each S-n row with its migration, rollback and backfill;
// - Names: each name once;
// - Failures: each row named in the test map; the test map covers every AC of the PRD's FRs and
//   NFRs this LLD's Scope cites (every AC when it cites none);
// - every D-n it cites exists in the HLD; no section of decisions or alternatives (the generic
//   rules refuse an unknown section);
// - Open questions empty at approval; `(open)` (44);
// - prose (tables and code blocks not counted): warns past [docs.limits] lld_warn_words (2,500),
//   fails past lld_words (4,000).

const NA = /^Not applicable — \S/;
const clip = (t) => (t.length > 60 ? `${t.slice(0, 57)}…` : t);

function section(doc, name) {
  const h = doc.scan.headings.find((x) => x.level === 2 && x.text === name);
  if (!h) return null;
  const next = doc.scan.headings.find((x) => x.line > h.line && x.level <= 2);
  const lines = doc.scan.lines.filter((l) => l.line > h.line && (!next || l.line < next.line));
  const text = lines.filter((l) => l.kind === 'text' && (l.visible ?? l.text).trim());
  return { heading: h, lines, text, na: text.length === 1 && NA.test((text[0].visible ?? text[0].text).trim()) };
}
// Every table in a section: [{ columns, rows: [{ line, cells }] }] (lower-cased column names).
function tablesIn(sec) {
  const out = [];
  const lines = sec.lines.filter((l) => l.kind === 'text');
  for (let i = 0; i + 1 < lines.length; i++) {
    const head = lines[i];
    const sep = lines[i + 1];
    if (!(head.visible ?? head.text).includes('|') || !/^ {0,3}\|?(?: *:?-+:? *\|)+ *:?-*:? *$/.test(sep.visible ?? sep.text) || sep.line !== head.line + 1) continue;
    const split = (t) => t.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim().replace(/`/g, ''));
    const columns = split(head.visible ?? head.text).map((c) => c.toLowerCase());
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].line === lines[j - 1].line + 1 && (lines[j].visible ?? lines[j].text).includes('|'); j++) {
      const cells = split(lines[j].visible ?? lines[j].text);
      rows.push({ line: lines[j].line, cells: Object.fromEntries(columns.map((c, k) => [c, cells[k] ?? ''])) });
    }
    out.push({ columns, rows, line: head.line });
    i = j - 1;
  }
  return out;
}

export function checkLld(doc, def, ctx, add) {
  const title = doc.scan.headings.find((h) => h.level === 1);
  const top = { line: title?.line ?? doc.bodyLine, column: 1 };

  // Contracts: failure rows, and a retry line per write.
  const contracts = section(doc, 'Contracts');
  if (contracts && !contracts.na) {
    const tables = tablesIn(contracts);
    const failures = tables.filter((t) => t.columns.includes('failure') && t.columns.some((c) => /retry/.test(c)));
    if (!failures.length || !failures.some((t) => t.rows.length)) add({ code: 'lld-failures', line: contracts.heading.line, column: 1, reason: 'Contracts has no failure rows', hint: 'per operation, | Failure | Status | Code | Retryable |: "a contract listing only success fails"' });
    const ops = tables.filter((t) => t.columns[0] === 'id').flatMap((t) => t.rows.filter((r) => /^C-[0-9]+$/.test(r.cells.id)));
    const writes = ops.filter((r) => /\b(POST|PUT|PATCH|DELETE)\b|\bwrite\b/i.test(Object.values(r.cells).join(' ')));
    const retries = contracts.text.filter((l) => /^Retry:\s*\S/.test((l.visible ?? l.text).trim())).length;
    if (writes.length > retries) add({ code: 'lld-retry', line: (writes[retries] ?? writes[0]).line, column: 1, reason: `${writes.length} write${writes.length === 1 ? '' : 's'} and ${retries} "Retry:" line${retries === 1 ? '' : 's'}: ${writes.slice(retries).map((w) => w.cells.id).join(', ')} doesn't say how a retried call stays safe`, hint: 'after each write\'s table, "Retry: <the idempotency key, or why a repeat is harmless>"' });
  }

  // Schema changes: migration, rollback, backfill.
  const schema = section(doc, 'Schema changes');
  if (schema && !schema.na) {
    const t = tableIn(doc, 'Schema changes');
    if (!t) add({ code: 'lld-schema', line: schema.heading.line, column: 1, reason: 'Schema changes has no table', hint: '| ID | Change | Type | Null | Default | Index | Migration | Rollback | Backfill |' });
    for (const r of t?.rows ?? []) {
      for (const col of ['migration', 'rollback', 'backfill']) {
        if (!(r.cells[col] ?? '').trim()) add({ code: 'lld-schema', line: r.line, column: 1, reason: `${r.cells.id || 'a schema change'} has no ${col}`, hint: col === 'backfill' ? 'say what existing rows get, or "none: <why>"' : `say the ${col}` });
      }
    }
  }

  // Names: once each.
  const names = tableIn(doc, 'Names');
  const seen = new Map();
  for (const r of names?.rows ?? []) {
    const n = (r.cells[names.columns[0]] ?? '').trim();
    if (!n) continue;
    if (seen.has(n)) add({ code: 'lld-names', line: r.line, column: 1, reason: `the name ${clip(n)} is listed twice`, hint: `first on line ${seen.get(n)}` });
    else seen.set(n, r.line);
  }

  // The test map covers the failures and the ACs in scope.
  const map = tableIn(doc, 'Test map');
  const mapSec = section(doc, 'Test map');
  const mapped = new Set((map?.rows ?? []).map((r) => (r.cells[map.columns[0]] ?? '').trim().toLowerCase()));
  const failures = tableIn(doc, 'Failures');
  for (const r of failures?.rows ?? []) {
    const c = (r.cells[failures.columns[0]] ?? '').trim();
    if (c && !mapped.has(c.toLowerCase())) add({ code: 'lld-test-map', line: r.line, column: 1, reason: `the failure "${clip(c)}" has no row in the test map`, hint: 'add a row naming it, with its level, seam and case' });
  }
  const prd = ctx.readDocument ? ctx.readDocument('prd.md') : { problem: 'unavailable' };
  if (prd && !prd.problem && prd.value?.type === 'prd' && mapSec) {
    const scope = section(doc, 'Scope');
    const cited = new Set((scope?.text ?? []).flatMap((l) => (l.visible ?? l.text).match(/\bN?FR-[0-9]+\b/g) ?? []));
    const acs = new Set();
    for (const l of prd.scan.lines) {
      const m = /^ *[-*+][ \t]+(?:\*\*)?(AC-(N?FR-[0-9]+)\.[0-9]+)(?:\*\*)?:/.exec(l.text);
      if (m && (!cited.size || cited.has(m[2]))) acs.add(m[1]);
    }
    for (const ac of acs) if (!mapped.has(ac.toLowerCase())) add({ code: 'lld-test-map', line: mapSec.heading.line, column: 1, reason: `${ac} has no row in the test map`, hint: `add | ${ac} | <level> | <seam> | <the case> |` });
  }

  // The D-n it cites are the HLD's.
  const up = ctx.upstream;
  if (up?.status === 'ok') {
    const ds = up.ids.get('D');
    for (const l of doc.scan.lines) {
      if (l.kind !== 'text') continue;
      for (const d of (l.visible ?? l.text).match(/\bD-[0-9]+\b/g) ?? []) if (ds && !ds.has(d)) add({ code: 'lld-decision', line: l.line, column: 1, reason: `${d} isn't one of the HLD's decisions`, hint: 'cite the HLD\'s D-n lines; the LLD decides nothing' });
    }
  }

  // Open questions: none left when you approve.
  const open = section(doc, 'Open questions');
  if (ctx.approving && open?.text.length) add({ code: 'lld-open-questions', line: open.heading.line, column: 1, reason: `${open.text.length} open question${open.text.length === 1 ? '' : 's'} left`, hint: 'settle each in the sections above, or ask in interview.md, before approving' });

  checkOpenMarks(doc, ctx, add, 'lld');

  // Prose only: tables and code blocks don't count.
  const prose = doc.scan.lines.filter((l) => (l.kind === 'text' || l.kind === 'heading') && !/^\s*\|/.test(l.visible ?? l.text));
  const n = prose.reduce((s, l) => s + (((l.visible ?? l.text).replace(/^ *#{1,6}[ \t]+/, '')).match(/[\p{L}\p{N}][\p{L}\p{N}'’%.-]*/gu) ?? []).length, 0);
  const cap = ctx.project?.limits?.lld_words ?? 4000;
  const warnAt = ctx.project?.limits?.lld_warn_words ?? 2500;
  if (n > cap) add({ code: 'lld-length', ...top, reason: `the LLD has ${n} words of prose; the cap is ${cap}`, hint: 'tables and code don\'t count: keep the shapes, cut the narrative' });
  else if (n > warnAt) add({ code: 'lld-length', severity: 'warning', ...top, reason: `the LLD has ${n} words of prose, past ${warnAt}`, hint: 'tables and code don\'t count: keep the shapes, cut the narrative' });
}
