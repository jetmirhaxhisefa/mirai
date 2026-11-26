import { posix } from 'node:path';

import { tableIn } from './checks.js';
import { checkOpenMarks } from './open.js';
import { documentWords } from './prd.js';
import { repoPath } from './repo.js';
import { isRetired } from './retired.js';

// The technical note's own lint (unit 62b, Scope 2), beyond the generic rules (the seven sections,
// the PRD link, the cited IDs, D-n defined once in Decisions):
// - the length: past [docs.limits] tech_note_words (800) it fails, saying the feature belongs on full;
// - Coverage: every FR and NFR of the linked PRD has a row with a component; no row for anything else;
// - Decisions: each D-n is one line, or a link to an ADR of the folder that is accepted or proposed
//   (61's re-check: never rejected, superseded or deprecated, naming the one that replaced it);
// - Components touched and Data changes: each bullet cites a path in backticks that exists in the
//   repo (one to be created ends with "(new)": a warning, so you see it);
// - Data changes: each says "reversible" or "not reversible";
// - `(open)` (44's rule).

const NOT_APPLICABLE = /^Not applicable — \S/;
const BULLET = /^ {0,3}[-*+][ \t]+/;
const clip = (t) => (t.length > 60 ? `${t.slice(0, 57)}…` : t);

function sectionLines(doc, name) {
  const h = doc.scan.headings.find((x) => x.level === 2 && x.text === name);
  if (!h) return null;
  const next = doc.scan.headings.find((x) => x.line > h.line && x.level <= 2);
  return { heading: h, lines: doc.scan.lines.filter((l) => l.line > h.line && (!next || l.line < next.line) && l.kind === 'text' && (l.visible ?? l.text).trim() !== '') };
}

export function checkTechNote(doc, def, ctx, add) {
  const title = doc.scan.headings.find((h) => h.level === 1);
  const top = { line: title?.line ?? doc.bodyLine, column: 1 };

  // The length: a bigger note means the feature belongs on full.
  const cap = ctx.project?.limits?.tech_note_words ?? def.document_words;
  if (cap) {
    const n = documentWords(doc, def);
    if (n > cap) add({ code: 'tech-note-length', ...top, reason: `the technical note has ${n} words; the cap is ${cap}`, hint: 'a note that needs more means the feature belongs on the full track (an HLD): move it to full rather than cutting detail' });
  }

  // Coverage: every FR and NFR of the PRD, each with its component.
  const table = tableIn(doc, 'Coverage');
  const cov = sectionLines(doc, 'Coverage');
  if (cov && !table) add({ code: 'tech-note-coverage', line: cov.heading.line, column: 1, reason: 'Coverage has no table', hint: 'one row per FR and NFR of the PRD: | Requirement | Component |' });
  if (table) {
    for (const p of table.problems ?? []) add({ code: 'tech-note-coverage', line: p.line, column: 1, reason: p.reason });
    const first = table.columns[0];
    const comp = table.columns[1];
    const seen = new Set();
    for (const row of table.rows) {
      const id = (row.cells[first] ?? '').trim();
      if (!/^N?FR-[0-9]+$/.test(id)) {
        add({ code: 'tech-note-coverage', line: row.line, column: 1, reason: `a Coverage row names "${clip(id)}", which isn't an FR or NFR of the PRD`, hint: 'one row per FR-n and NFR-n' });
        continue;
      }
      seen.add(id);
      if (!comp || !(row.cells[comp] ?? '').trim()) add({ code: 'tech-note-coverage', line: row.line, column: 1, reason: `${id} names no component`, hint: 'name the component, from Components touched, that delivers it' });
    }
    const up = ctx.upstream;
    if (up?.status === 'ok') {
      const retired = (text) => isRetired(text ?? '');
      for (const prefix of ['FR', 'NFR']) {
        for (const id of up.ids.get(prefix)?.keys() ?? []) {
          const line = up.doc.scan.lines.find((l) => new RegExp(`^ *[-*+][ \\t]+(?:\\*\\*)?${id}(?:\\*\\*)?:`).test(l.text));
          if (line && retired(line.text.replace(/^ *[-*+][ \t]+/, ''))) continue;
          if (!seen.has(id)) add({ code: 'tech-note-coverage', line: table.line ?? cov.heading.line, column: 1, reason: `${id} of the PRD isn't in Coverage`, hint: `add a row: | ${id} | <the component that delivers it> |` });
        }
      }
    }
  }

  checkDecisionLines(doc, ctx, add, 'tech-note-decision');

  // Components and data changes cite files that exist.
  const cite = (name, { reversible = false } = {}) => {
    const sec = sectionLines(doc, name);
    if (!sec) return;
    for (const l of sec.lines) {
      const t = (l.visible ?? l.text).trim();
      if (NOT_APPLICABLE.test(t)) continue;
      if (!BULLET.test(l.visible ?? l.text)) continue;
      const span = /^[-*+][ \t]+`([^`]+)`/.exec(t);
      const path = span ? repoPath(span[1].replace(/:[0-9]+(?:-[0-9]+)?$/, '')) : null;
      if (!path) add({ code: 'tech-note-cite', line: l.line, column: 1, reason: `"${clip(t.replace(/^[-*+][ \t]+/, ''))}" cites no file`, hint: 'start the bullet with the path in backticks, from the repo\'s top folder; a file to be created ends with (new)' });
      else if (/\(new\)/i.test(t)) add({ code: 'tech-note-new-file', severity: 'warning', line: l.line, column: 1, reason: `${clip(path)} is to be created`, hint: 'check it is new, not a path mistyped' });
      else if (ctx.repo && !ctx.repo.exists(path)) add({ code: 'tech-note-cite', line: l.line, column: 1, reason: `${clip(path)} doesn't exist in the repo`, hint: 'correct the path, from the repo\'s top folder, or mark a file to be created with (new)' });
      if (reversible && !/\b(?:not reversible|reversible)\b/i.test(t)) add({ code: 'tech-note-reversible', line: l.line, column: 1, reason: `the data change at ${clip(path ?? t)} doesn't say whether it can be undone`, hint: 'end it with "reversible: <how>" or "not reversible: <why>"' });
    }
  };
  cite('Components touched');
  cite('Data changes', { reversible: true });

  checkOpenMarks(doc, ctx, add, 'tech-note');
}

// The Decisions section's D-n lines (unit 62b; the HLD's too, unit 62): each one line, the choice
// and its reason, or a link to an ADR of the folder that is accepted or proposed (61's re-check: a
// superseded one names its successor; the index or another file is refused). A line may end with
// "(Arlo's call)" (unit 64). `code`: the problem code.
export function checkDecisionLines(doc, ctx, add, code) {
  const dec = sectionLines(doc, 'Decisions');
  if (dec) {
    const lines = dec.lines;
    lines.forEach((l, i) => {
      const t = (l.visible ?? l.text);
      const m = /^ {0,3}[-*+][ \t]+(?:\*\*)?(D-[0-9]+)(?:\*\*)?:[ \t]*(.*)$/.exec(t);
      if (!m) {
        if (BULLET.test(t) || !/^\s/.test(t)) add({ code: code, line: l.line, column: 1, reason: `"${clip(t.trim())}" isn't a D-n line`, hint: 'each decision is "- D-n: <the choice and its reason>" on one line, or "- D-n: [ADR-n: title](<its file>)"' });
        return;
      }
      const next = lines[i + 1];
      if (next && !BULLET.test(next.visible ?? next.text) && /^\s+\S/.test(next.visible ?? next.text)) add({ code: code, line: next.line, column: 1, reason: `${m[1]} runs over more than one line`, hint: 'one line per decision; a decision that needs more is an ADR, linked from the line' });
      if (!m[2].trim()) add({ code: code, line: l.line, column: 1, reason: `${m[1]} says nothing`, hint: 'the choice and its reason, or a link to its ADR' });
      for (const link of [...m[2].matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)].map((x) => x[1])) {
        if (/^[a-z]+:/i.test(link)) continue;
        const found = ctx.readDocument ? ctx.readDocument(link) : { problem: 'unavailable' };
        if (found.problem) continue; // missing: the link rules say so; unreadable or unavailable: not checked here
        if (found.value?.type !== 'adr') {
          add({ code: code, line: l.line, column: 1, reason: `${m[1]} links ${clip(link)}, which isn't an ADR`, hint: 'link the ADR file itself (in the ADR folder), never its index' });
          continue;
        }
        const st = found.value.status;
        if (st !== 'accepted' && st !== 'proposed') add({ code: code, line: l.line, column: 1, reason: `${m[1]} links ${found.value.id ?? posix.basename(link)}, which is ${st}`, hint: st === 'superseded' && found.value.superseded_by ? `link the ADR that replaced it: ${found.value.superseded_by}` : 'link an accepted ADR, or write a new one (mirai adr new <slug>)' });
      }
    });
  }

}
