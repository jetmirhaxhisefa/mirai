// Unit 41: the two documents Nora's work adds beside the brief, and the PRD's check against the
// first (Jet's decisions 2 and 6, 2026-11-20).
//
// - **requirements.md** (decision 6): your own list of requirements, kept as a source of the
//   initiative. Each line is a bullet `- REQ-n: <your line, as you gave it>`, numbered REQ-1,
//   REQ-2 … with no gap, so a PRD can cite it. (`REQ`, not the spec's `R`: a PRD's and a brief's
//   `R-n` are their risks.) Its frontmatter's `source` says where the list came from.
// - **business-change.md** (decision 2, D-43): a proposal to change business.md. Each change is
//   `### C-n: <what>`, then a `Replace:` quote (the lines of business.md as they are now, word for
//   word), a `With:` quote (the new text), `Source:` (where the new text comes from: "you said,
//   <date>") and `Why:`. `mirai approve --file …/business-change.md` applies it.
// - **The PRD against requirements.md** (decision 6, Scope 9): when the PRD's folder has a
//   requirements.md, every REQ-n it defines is cited in the PRD (an FR, NFR or AC that carries it,
//   or "Not in this" / "Non-goals" with the reason it's left out), and every REQ-n the PRD cites
//   is one the list defines. Whether a citing requirement keeps the line's meaning and numbers is
//   Vera's to judge (src/verify/findings.js).

export const REQ = /\bREQ-([0-9]{1,4})\b/g;
const BULLET = /^ *[-*+][ \t]+(?:\*\*)?REQ-([0-9]{1,4})(?:\*\*)?:[ \t]*(.*)$/;

function section(scan, name) {
  const h = scan.headings.find((x) => x.level === 2 && x.text === name);
  if (!h) return null;
  const next = scan.headings.find((x) => x.line > h.line && x.level <= 2);
  return { h, end: next?.line ?? Infinity, lines: scan.lines.filter((l) => l.line > h.line && (!next || l.line < next.line)) };
}

// The requirements a requirements.md defines: [{ id, n, text, line }], in file order.
export function requirementsOf(doc) {
  const s = section(doc.scan, 'Requirements');
  if (!s) return [];
  const out = [];
  for (const l of s.lines) {
    if (l.kind !== 'text') continue;
    const m = BULLET.exec(l.visible ?? l.text);
    if (m) out.push({ id: `REQ-${Number(m[1])}`, n: Number(m[1]), text: m[2].trim(), line: l.line });
  }
  return out;
}

export function checkRequirements(doc, def, ctx, add) {
  const s = section(doc.scan, 'Requirements');
  if (!s) return;
  const reqs = requirementsOf(doc);
  reqs.forEach((r, i) => {
    if (r.n !== i + 1) add({ code: 'requirements-numbering', line: r.line, column: 1, reason: `${r.id} should be REQ-${i + 1}: requirements run REQ-1, REQ-2 … in order, with no gap`, hint: 'renumber them; a PRD cites each by its number' });
    if (!r.text) add({ code: 'requirements-empty', line: r.line, column: 1, reason: `${r.id} has no text`, hint: 'each line is one requirement, as the owner gave it' });
  });
  for (const l of s.lines) {
    if (l.kind !== 'text' || !(l.visible ?? l.text).trim()) continue;
    if (!BULLET.test(l.visible ?? l.text)) add({ code: 'requirements-line', line: l.line, column: 1, reason: 'each line under "Requirements" is one requirement: "- REQ-n: <the line>"', hint: 'mirai requirements <initiative> numbers a pasted list for you' });
  }
}

// ---- business-change.md ----------------------------------------------------------------------

const CHANGE = /^C-([0-9]{1,4}):[ \t]*(.*)$/;
const LABEL = /^(Replace|With|Source|Why):[ \t]*(.*)$/;

// The changes a business-change.md proposes: [{ id, n, title, line, replace, with, source, why }],
// `replace` and `with` the quoted text (the ">" taken off each line, lines joined by "\n").
export function changesOf(doc) {
  const s = section(doc.scan, 'Changes');
  if (!s) return [];
  const heads = doc.scan.headings.filter((h) => h.level === 3 && h.line > s.h.line && h.line < s.end);
  return heads.map((h, i) => {
    const m = CHANGE.exec(h.text);
    const end = Math.min(heads[i + 1]?.line ?? Infinity, s.end);
    const c = { id: m ? `C-${Number(m[1])}` : null, n: m ? Number(m[1]) : null, title: m ? m[2].trim() : h.text, line: h.line, replace: null, with: null, source: null, why: null, labels: {} };
    let into = null;
    for (const l of doc.text.replace(/\r\n?/g, '\n').split('\n').map((text, k) => ({ text, line: k + 1 })).filter((x) => x.line > h.line && x.line < end)) {
      const t = l.text.trim();
      const lab = LABEL.exec(t);
      if (lab) {
        c.labels[lab[1]] = l.line;
        into = lab[1] === 'Replace' || lab[1] === 'With' ? lab[1].toLowerCase() : null;
        if (lab[1] === 'Source') c.source = lab[2].trim() || null;
        if (lab[1] === 'Why') c.why = lab[2].trim() || null;
        continue;
      }
      if (into && /^>/.test(t)) {
        const q = t.replace(/^> ?/, '');
        c[into] = c[into] === null ? q : `${c[into]}\n${q}`;
      } else if (t) into = null;
    }
    return c;
  });
}

export function checkBusinessChange(doc, def, ctx, add) {
  const changes = changesOf(doc);
  changes.forEach((c, i) => {
    const at = { line: c.line, column: 1 };
    if (!c.id) return add({ ...at, code: 'business-change-heading', reason: 'each change is a heading "### C-n: <what changes>"' });
    if (c.n !== i + 1) add({ ...at, code: 'business-change-numbering', reason: `${c.id} should be C-${i + 1}: changes run C-1, C-2 … with no gap` });
    if (!c.replace?.trim()) add({ ...at, code: 'business-change-replace', reason: `${c.id} has no "Replace:" quote: the lines of business.md as they are now, word for word, each starting with ">"` });
    if (!c.with?.trim()) add({ ...at, code: 'business-change-with', reason: `${c.id} has no "With:" quote: the new text, each line starting with ">"` });
    if (!c.source) add({ ...at, code: 'business-change-source', reason: `${c.id} has no "Source:": where the new text comes from ("you said, YYYY-MM-DD (interview.md Q-n)")` });
    if (!c.why) add({ ...at, code: 'business-change-why', reason: `${c.id} has no "Why:": the reason, in one sentence` });
  });
}

// What business.md becomes with every change applied: { text } or { problem, change }. Each
// "Replace:" text must be in business.md exactly once (whitespace at the line ends aside), so a
// change can never land in the wrong place or twice.
export function applyChanges(businessText, changes) {
  let text = businessText.replace(/\r\n?/g, '\n');
  for (const c of changes) {
    const from = c.replace.replace(/[ \t]+$/gm, '');
    const lines = text.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n');
    const at = lines.indexOf(from);
    if (at < 0) return { problem: `${c.id}'s "Replace:" text isn't in business.md as it is now`, change: c.id };
    if (lines.indexOf(from, at + 1) >= 0) return { problem: `${c.id}'s "Replace:" text is in business.md more than once`, change: c.id };
    text = lines.slice(0, at) + c.with + lines.slice(at + from.length);
  }
  return { text };
}

// ---- The PRD against requirements.md ----------------------------------------------------------

const LEFT_OUT = ['Not in this', 'Non-goals'];
// Where a requirement is carried: an FR, an NFR or one of their ACs.
const CARRIERS = ['Functional requirements', 'Non-functional requirements'];

// The REQ-n a PRD cites: Map id -> [{ line, section }] (`section`: the h2 or h3 the line is in).
export function requirementCitations(doc) {
  const out = new Map();
  let h2 = null;
  let h3 = null;
  for (const l of doc.scan.lines) {
    if (l.kind === 'heading') {
      const level = /^ {0,3}(#+)/.exec(l.text)?.[1].length ?? 0;
      if (level === 2) [h2, h3] = [l.visible.trim(), null];
      else if (level === 3) h3 = l.visible.trim();
      continue;
    }
    if (l.kind !== 'text') continue;
    for (const m of (l.visible ?? l.text).matchAll(REQ)) {
      const id = `REQ-${Number(m[1])}`;
      if (!out.has(id)) out.set(id, []);
      out.get(id).push({ line: l.line, section: h3 ?? h2, h2, text: (l.visible ?? l.text).trim() });
    }
  }
  return out;
}

// The REQ-n a PRD leaves out on purpose: cited in "Not in this" or "Non-goals" on a line that says
// why (more than the ID). Set of ids.
export function leftOutRequirements(doc) {
  const out = new Set();
  for (const [id, places] of requirementCitations(doc)) {
    if (places.some((p) => (LEFT_OUT.includes(p.section) || LEFT_OUT.includes(p.h2)) && p.text.replace(REQ, '').replace(/[\s()[\]\-–—:;,.]+/g, '').length >= 8)) out.add(id);
  }
  return out;
}

// Called by the PRD's lint (src/lint/prd.js).
export function checkPrdRequirements(doc, ctx, add) {
  const cited = requirementCitations(doc);
  const found = ctx.readDocument ? ctx.readDocument('requirements.md') : { problem: 'unavailable' };
  if (found.problem === 'unavailable' || found.problem === 'unreadable') return;
  const top = { line: doc.scan.headings.find((h) => h.level === 1)?.line ?? doc.bodyLine, column: 1 };
  if (found.problem) {
    for (const [id, places] of cited) add({ code: 'prd-requirement-undefined', line: places[0].line, column: 1, reason: `${id} is cited, but there is no requirements.md beside the PRD to define it`, hint: 'cite only lines of the initiative\'s requirements.md' });
    return;
  }
  if (found.value?.type !== 'requirements') return;
  const defined = new Map(requirementsOf(found).map((r) => [r.id, r]));
  for (const [id, places] of cited) {
    if (!defined.has(id)) add({ code: 'prd-requirement-undefined', line: places[0].line, column: 1, reason: `${id} isn't a line of requirements.md (it has REQ-1 to REQ-${defined.size})`, hint: 'cite the line it comes from, or take the ID out' });
  }
  const out = leftOutRequirements(doc);
  const carried = (id) => (cited.get(id) ?? []).some((p) => CARRIERS.includes(p.h2));
  for (const [id, r] of defined) {
    if (!carried(id) && !out.has(id)) add({ ...top, code: 'prd-requirement-uncovered', reason: `${id} of requirements.md ("${r.text.slice(0, 80)}") isn't cited by any requirement, and isn't left out under "Not in this" with a reason`, hint: `cite (${id}) on the FR, NFR or AC that carries it, or list it under "Not in this" with why it's left out` });
  }
}
