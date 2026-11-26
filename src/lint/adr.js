import { posix } from 'node:path';

import { adrSettings, confirmationsOf, idOf, numberOf } from '../adr/adr.js';
import { linkLinesOf } from './rules.js';
import { checkOpenMarks } from './open.js';
import { documentWords } from './prd.js';

// The ADR's own lint (unit 61, Scope 2), beyond the generic rules (sections, frontmatter, the cited
// FR and NFR IDs against the linked PRD):
// - the Y-statement summary, in its order, at most 80 words (a warning past it; an error past 120);
// - at least two options (### headings under "Options considered");
// - a bad consequence ("- Bad, because …");
// - `gate` names at least one test;
// - with an `initiative`, the "PRD:" line under the title;
// - Confirmation: each line `check: <name>` (a check in the project's [checks]), `test: <id>` or
//   `review: <what>`;
// - `supersedes` names an ADR in the folder that exists and is accepted (or superseded by this one);
// - a rejected or deprecated ADR keeps your reason (`status_reason`); a superseded one names its
//   successor;
// - the id matches the file's number;
// - `(open)` marks (44's rule), and the length: past 600 words a warning, past 900 an error.
// Immutability (an accepted ADR changed beyond typo and link fixes) needs your signed lines: the
// pre-commit hook, approval and the docs merge check it (src/adr/adr.js, adrState).

const Y_STATEMENT = /\bIn the context of\b[^]*?,[^]*?\bfacing\b[^]*?,[^]*?\bwe decided (?:for|on|to)\b[^]*?\bto achieve\b[^]*?,[^]*?\baccepting\b/i;
export const Y_WORDS = 80;
const Y_MAX = 120;

const sectionLines = (doc, name, kinds = ['text']) => {
  const h = doc.scan.headings.find((x) => x.level === 2 && x.text === name);
  if (!h) return null;
  const next = doc.scan.headings.find((x) => x.line > h.line && x.level <= 2);
  return { heading: h, lines: doc.scan.lines.filter((l) => l.line > h.line && (!next || l.line < next.line) && kinds.includes(l.kind)), next };
};
const words = (t) => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’%.-]*/gu) ?? []).length;

export function checkAdr(doc, def, ctx, add) {
  const { value } = doc;
  const title = doc.scan.headings.find((h) => h.level === 1);
  const top = { line: title?.line ?? doc.bodyLine, column: 1 };

  // The Y-statement.
  const summary = sectionLines(doc, 'Summary');
  if (summary) {
    const text = summary.lines.map((l) => (l.visible ?? l.text).trim()).filter(Boolean).join(' ');
    const at = { line: summary.heading.line, column: 1 };
    if (text && !Y_STATEMENT.test(text)) add({ code: 'adr-y-statement', ...at, reason: 'the Summary isn\'t a Y-statement', hint: 'write it as: In the context of <the situation>, facing <the concern>, we decided for <the option> to achieve <the quality>, accepting <the cost>' });
    const n = words(text);
    if (n > Y_MAX) add({ code: 'adr-summary-length', ...at, reason: `the Summary has ${n} words; a Y-statement is at most ${Y_WORDS} (the cap is ${Y_MAX})`, hint: 'one sentence: the detail goes in the sections below' });
    else if (n > Y_WORDS) add({ code: 'adr-summary-length', severity: 'warning', ...at, reason: `the Summary has ${n} words, past ${Y_WORDS}`, hint: 'one sentence: the detail goes in the sections below' });
  }

  // At least two options.
  const options = sectionLines(doc, 'Options considered', ['heading']);
  if (options) {
    const n = options.lines.filter((l) => /^ {0,3}###[ \t]/.test(l.text)).length;
    if (n < 2) add({ code: 'adr-options', line: options.heading.line, column: 1, reason: `"Options considered" has ${n === 0 ? 'no option' : 'one option'}; an ADR weighs at least two real ones`, hint: 'add each option as a ### heading with its Good and Bad bullets; "Do nothing" counts where it fits' });
  }

  // A bad consequence.
  const cons = sectionLines(doc, 'Consequences');
  if (cons && !cons.lines.some((l) => /^ *[-*+][ \t]+(?:\*\*)?Bad\b/i.test(l.visible ?? l.text))) {
    add({ code: 'adr-no-bad', line: cons.heading.line, column: 1, reason: 'the Consequences name no bad one', hint: 'add "- Bad, because …": the cost the decision accepts, honestly' });
  }

  // The gate names a test.
  if (Array.isArray(value.gate) && value.gate.length === 0) {
    const p = doc.positions.get('gate');
    add({ code: 'adr-gate', line: p?.line ?? 1, column: p?.valueColumn ?? 1, reason: 'the gate names no test: an ADR is only for a decision that passes one', hint: 'name each it passes: hard-to-reverse, cross-cutting, nfr, external, first-of-kind; if none, make it one line in the HLD or technical note instead' });
  }

  // With an initiative, the PRD it serves is linked.
  if (typeof value.initiative === 'string' && value.initiative !== '' && !linkLinesOf(doc.scan, def).some((l) => l.link.label === 'PRD')) {
    add({ code: 'adr-prd-link', ...top, reason: `the ADR comes from the initiative ${value.initiative}, but the line under its title doesn't link its PRD`, hint: `add "PRD: [<its title>](<the path to ${value.initiative}/prd.md>)" right under the # title` });
  }

  // Confirmation.
  const conf = sectionLines(doc, 'Confirmation');
  if (conf) {
    const lines = confirmationsOf(doc.scan);
    if (!lines.length) add({ code: 'adr-confirmation', line: conf.heading.line, column: 1, reason: 'the Confirmation names no check', hint: 'one line of check: <a check in [checks]>, test: <this ADR\'s id> or review: <what the reviewer checks>' });
    const checks = ctx.project?.checks ?? {};
    for (const c of lines) {
      if (c.form === null) add({ code: 'adr-confirmation', line: c.line, column: 1, reason: `"${c.text.slice(0, 60)}" isn't a Confirmation MIRAI can follow`, hint: 'start it with check:, test: or review:' });
      else if (c.form === 'check' && !Object.hasOwn(checks, c.what)) add({ code: 'adr-confirmation', line: c.line, column: 1, reason: `check: ${c.what.slice(0, 60)} names no check in the project's [checks]`, hint: Object.keys(checks).length ? `the project's checks: ${Object.keys(checks).slice(0, 10).join(', ')}` : 'add it to [checks] in .mirai/config.toml, or use test: or review:' });
      else if (c.form === 'test' && typeof value.id === 'string' && c.what.replace(/[^A-Za-z0-9]/g, '').toLowerCase() !== value.id.replace(/[^A-Za-z0-9]/g, '').toLowerCase()) add({ code: 'adr-confirmation', line: c.line, column: 1, reason: `test: ${c.what.slice(0, 60)} isn't this ADR's id`, hint: `write test: ${value.id}: its tests' names start with it (test_${value.id.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_…)` });
      else if (c.form === 'review' && words(c.what) < 3) add({ code: 'adr-confirmation', line: c.line, column: 1, reason: 'the review line doesn\'t say what the reviewer checks', hint: 'say what each change must keep, in a sentence' });
    }
  }

  // Status fields MIRAI writes, kept consistent.
  if ((value.status === 'rejected' || value.status === 'deprecated') && !(typeof value.status_reason === 'string' && value.status_reason.trim())) {
    const p = doc.positions.get('status');
    add({ code: 'adr-reason', line: p?.line ?? 1, column: 1, reason: `a ${value.status} ADR keeps the reason`, hint: 'MIRAI writes status_reason with your signature; restore it' });
  }
  if (value.status === 'superseded' && !(typeof value.superseded_by === 'string' && value.superseded_by)) {
    const p = doc.positions.get('status');
    add({ code: 'adr-superseded', line: p?.line ?? 1, column: 1, reason: 'a superseded ADR names the one that replaced it', hint: 'MIRAI writes superseded_by with your signature; restore it' });
  }

  // The folder: the id matches the file's number; `supersedes` names an accepted ADR.
  const adrs = ctx.adrs ?? null;
  const s = ctx.adrSettings ?? adrSettings({ adr: ctx.project?.adr });
  const name = ctx.file ? posix.basename(ctx.file) : null;
  const n = name ? numberOf(name, s) : null;
  if (n !== null && typeof value.id === 'string' && value.id.toLowerCase() !== idOf(n, s).toLowerCase()) {
    const p = doc.positions.get('id');
    add({ code: 'adr-number', line: p?.line ?? 1, column: p?.valueColumn ?? 1, reason: `the id ${value.id} isn't the file's number (${idOf(n, s)})`, hint: `make the id ${idOf(n, s)}` });
  }
  if (typeof value.supersedes === 'string' && value.supersedes !== '' && adrs) {
    const p = doc.positions.get('supersedes');
    const at = { line: p?.line ?? 1, column: p?.valueColumn ?? 1 };
    const old = adrs.find((a) => a.id.toLowerCase() === value.supersedes.toLowerCase());
    if (!old) add({ code: 'adr-supersedes', ...at, reason: `supersedes names ${value.supersedes}, which isn't an ADR in ${s.folder}/`, hint: 'name the accepted ADR this one replaces' });
    else if (old.status !== 'accepted' && !(old.status === 'superseded' && String(old.superseded_by ?? '').toLowerCase() === String(value.id ?? '').toLowerCase())) add({ code: 'adr-supersedes', ...at, reason: `${old.id} is ${old.status}, not accepted: only an accepted ADR is superseded`, hint: old.status === 'superseded' ? `supersede the one that replaced it: ${old.superseded_by}` : 'a proposed or rejected ADR is changed or written again, not superseded' });
  }

  checkOpenMarks(doc, ctx, add, 'adr');

  // About one page.
  const cap = ctx.project?.limits?.adr_words ?? def.document_words;
  const warnAt = ctx.project?.limits?.adr_warn_words ?? def.document_warn_words;
  if (cap) {
    const n2 = documentWords(doc, def);
    if (n2 > cap) add({ code: 'adr-length', ...top, reason: `the ADR has ${n2} words; the cap is ${cap}`, hint: 'one decision, about one page: the design itself belongs in the HLD or technical note' });
    else if (warnAt && n2 > warnAt) add({ code: 'adr-length', severity: 'warning', ...top, reason: `the ADR has ${n2} words, past ${warnAt} (about one page; the cap is ${cap})`, hint: 'keep the why; move the how to the HLD or technical note' });
  }
}
