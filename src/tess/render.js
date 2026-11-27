import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { adrPathFor } from '../adr/adr.js';

import { renameHeadings } from '../config/overlays.js';
import { renderEpic, renderSections, ticketSet } from '../lint/epic.js';
import { prdItems } from '../lint/graph.js';
import { parseDocument, readTicketFolder } from '../lint/lint.js';
import { checkIds, linkLinesOf } from '../lint/rules.js';

// `mirai epic render`'s work on an epic file (unit 33), as MIRAI runs it between the ticket
// planner's launches (unit 42, re-check Q1 "A": she has no broker tool for it). The four generated
// sections are written from the ticket files beside it and its PRD; nothing else changes. Returns
// { changed, tickets } or { problem } (no PRD line, a PRD that doesn't read, a section missing):
// the lint then names it, and her next launch fixes it.
export function renderEpicFile({ abs, root, registry, repo = root, config = null }) {
  let text;
  let doc;
  try {
    text = readFileSync(abs, 'utf8');
    doc = parseDocument(text, abs);
  } catch {
    return { problem: 'the epic doesn\'t read as a document' };
  }
  if (doc.value.type !== 'epic') return { problem: 'the epic file isn\'t an epic' };
  const def = registry.documentTypes.epic;
  const prdLine = linkLinesOf(doc.scan, def).find((l) => l.link.type === 'prd');
  if (!prdLine) return { problem: 'the epic has no "PRD:" line under its title' };
  let prd;
  try {
    prd = parseDocument(readFileSync(join(dirname(abs), prdLine.targets[0].split('#')[0]), 'utf8'), 'prd.md');
  } catch {
    return { problem: `the PRD ${prdLine.targets[0]} doesn't read` };
  }
  const up = { doc: prd, ids: checkIds(prd, registry.documentTypes.prd, () => {}, null) };
  const set = ticketSet(doc, { readTickets: () => readTicketFolder(dirname(abs), { root }), registry });
  const sections = renderSections({ track: doc.value.track, tickets: set.tickets, items: prdItems(up), adrPath: adrPathFor({ repo, fromDir: dirname(abs), config }) });
  const renames = def.renames ?? {};
  const inverse = Object.fromEntries(Object.entries(renames).map(([m, p]) => [p, m]));
  const rendered = renderEpic(renameHeadings(text, inverse), sections);
  if (rendered.missing.length) return { problem: `the epic has no ${rendered.missing.map((n) => `"## ${n}"`).join(', ')}` };
  const out = renameHeadings(rendered.text, renames);
  if (out === text) return { changed: false, tickets: set.tickets.length };
  writeFileSync(abs, out, { mode: statSync(abs).mode & 0o777 });
  return { changed: true, tickets: set.tickets.length };
}
