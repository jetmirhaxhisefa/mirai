import { readFrontmatter } from './frontmatter.js';
import { scanMarkdown } from './markdown.js';
import { requirementItems } from './prd.js';
import { isRetired } from './retired.js';

// A document's text, parsed as lint.js's parseDocument does (here, so the lint's checks don't import lint.js).
function parsed(text) {
  const fm = readFrontmatter(text, { source: 'approved', positions: true });
  if (fm === null) throw new Error('no frontmatter');
  return { value: fm.value, scan: scanMarkdown(fm.body, { firstLine: fm.bodyLine }), bodyLine: fm.bodyLine, text };
}

// The ID-stability lint (unit 43, Scope 8; design/01 §5a: "retired IDs are never reused"). An FR,
// NFR, AC or ticket ID that existed in the last approved version of a document can't come back
// with another meaning. It runs where the last approved version is known: at approval (the PRD,
// the epic's tickets), with that version's text as `previous`. Another meaning: the definition's
// words share less than a third with the approved one's (a rewording keeps most of its words; a
// new requirement under an old number doesn't). No model runs.

export const SAME_MEANING = 1 / 3;
const clip = (t) => (t.length > 160 ? `${t.slice(0, 159)}…` : t);
const words = (text) => new Set((String(text).toLowerCase().match(/\p{L}[\p{L}\p{N}'’-]{2,}|\p{N}+/gu) ?? []));

// How much two statements share, 0 to 1 (Jaccard over their words).
export function overlap(a, b) {
  const x = words(a);
  const y = words(b);
  if (!x.size && !y.size) return 1;
  let both = 0;
  for (const w of x) if (y.has(w)) both += 1;
  return both / (x.size + y.size - both);
}

// A document's defined IDs and what each says: Map id → statement. A PRD: its FRs, NFRs and ACs;
// a ticket (story or bug): its key (its title) and its own ACs (AC-<key>.n).
export function definitionsOf(doc) {
  const out = new Map();
  if (!doc) return out;
  if (doc.value?.type === 'prd') {
    for (const it of requirementItems(doc)) out.set(it.id, it.statement.replace(/\s*(?:\((?:BR|A|REQ)-[0-9]+(?:, *(?:BR|A|REQ)-[0-9]+)*\)\s*)+\.?$/, ''));
    return out;
  }
  const key = typeof doc.value?.id === 'string' ? doc.value.id : null;
  if (!key) return out;
  const title = doc.scan.headings.find((h) => h.level === 1)?.text ?? '';
  out.set(key, title);
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\s*[-*+]\\s+(?:\\*\\*)?(AC-${escaped}\\.[0-9]+)(?:\\*\\*)?(?::|\\s+—\\s)\\s*(.*)$`);
  for (const l of doc.scan.lines) {
    if (l.kind !== 'text') continue;
    const m = re.exec(l.visible ?? l.text);
    if (m && !out.has(m[1])) out.set(m[1], m[2]);
  }
  return out;
}

// The problems: one per ID whose meaning changed since `previous` (the approved text), each with
// the line it's defined on now.
export function idStabilityProblems(doc, previous) {
  if (typeof previous !== 'string') return [];
  let before;
  try {
    before = definitionsOf(parsed(previous.replace(/\r\n?/g, '\n')));
  } catch {
    return [];
  }
  const now = definitionsOf(doc);
  const lineOf = (id) => doc.scan.lines.find((l) => (l.kind === 'text' || l.kind === 'heading') && new RegExp(`(?<![A-Za-z0-9.-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`).test(l.text))?.line ?? doc.bodyLine ?? 1;
  const out = [];
  for (const [id, then] of before) {
    if (!now.has(id)) continue;
    const said = now.get(id);
    // Unit 43 (Jet's answer 1, "A"): retiring an ID is allowed; bringing a retired one back isn't.
    if (isRetired(then) && !isRetired(said)) {
      out.push({ code: 'id-stability', line: lineOf(id), column: 1, reason: `${id} was retired in the version you approved ("${clip(then)}"); a retired ID never comes back: here it says "${clip(said)}"`, hint: `keep "${id}: Retired — …" as it is, and give the new item its own new ID` });
      continue;
    }
    if (isRetired(said) || overlap(then, said) >= SAME_MEANING) continue;
    out.push({
      code: 'id-stability', line: lineOf(id), column: 1,
      reason: `${id} meant "${clip(then)}" in the version you approved; it now says "${clip(said)}": an ID that existed in an approved version never comes back with another meaning`,
      hint: `keep ${id} for what it meant (reworded if need be), and give the new item its own new ID`,
    });
  }
  return out;
}
