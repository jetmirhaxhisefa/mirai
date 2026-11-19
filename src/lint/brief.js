import { tableIn } from './checks.js';
import { clip } from './summary.js';

// The business brief's own lint (unit 31; research/13 §9b, Jet's decision 2): Lenny's 1-pager
// plus Shape Up's appetite, no-gos and rabbit holes. What the generic rules can't say:
// - BR, SM, NG, R and Q are numbered 1, 2, 3 … with no gap (a gap is a deleted item someone may
//   still cite);
// - each success metric has a baseline (or UNKNOWN), a target and a counter-metric;
// - a business requirement is an outcome: one naming a screen, button, field, endpoint or API is
//   a solution, so it warns;
// - "Appetite and track" names the frontmatter's track;
// - at approval, no open question is left (ctx.approving).
export const TRACKS = Object.freeze(['quick', 'standard', 'full']);
const SOLUTION_WORDS = /\b(screens?|buttons?|fields?|endpoints?|APIs?|modals?|dropdowns?|checkbox(?:es)?|database tables?)\b/i;
const NUMBERED = ['BR', 'SM', 'NG', 'R', 'Q'];

export function checkBrief(doc, def, ctx, add) {
  const { scan, value } = doc;
  const sectionOf = (name) => {
    const h = scan.headings.find((x) => x.level === 2 && x.text === name);
    if (!h) return null;
    const next = scan.headings.find((x) => x.line > h.line && x.level <= 2);
    return { h, lines: scan.lines.filter((l) => l.line > h.line && (!next || l.line < next.line)) };
  };

  // Numbering with no gap, per kind, in the kind's own section.
  for (const prefix of NUMBERED) {
    const kind = (def.ids ?? []).find((k) => k.prefix === prefix);
    const sec = kind?.section ? sectionOf(kind.section) : null;
    if (!sec) continue;
    const re = new RegExp(`^ *(?:[-*+]|[0-9]{1,9}[.)]|\\|)?[ \\t]*(?:\\*\\*)?${prefix}-([0-9]+)(?:\\*\\*)?(?::|[ \\t]+—[ \\t]|[ \\t]*\\|)`);
    const nums = [];
    for (const l of sec.lines) {
      if (l.kind !== 'text') continue;
      const m = re.exec(l.text);
      if (m) nums.push({ n: Number(m[1]), line: l.line });
    }
    nums.forEach((x, i) => {
      if (x.n !== i + 1) add({ code: 'brief-numbering', line: x.line, column: 1, reason: `${prefix}-${x.n} should be ${prefix}-${i + 1}: ${prefix} IDs run 1, 2, 3 … in order, with no gap`, hint: `renumber, and update every mention of the old ${prefix} IDs` });
    });
  }

  // Success metrics: baseline, target, counter-metric on every row.
  const success = tableIn(doc, 'Success');
  if (success) {
    const col = (want) => success.columns.find((c) => c.startsWith(want));
    const [baseline, target, counter] = [col('baseline'), col('target'), col('counter')];
    if (!baseline || !target || !counter) {
      add({ code: 'brief-success', line: success.line, column: 1, reason: 'the success table needs Baseline, Target and Counter-metric columns', hint: 'columns: ID | Metric | Baseline | Target | How measured | Counter-metric' });
    } else {
      for (const r of success.rows) {
        for (const [name, c] of [['a baseline (or UNKNOWN)', baseline], ['a target', target], ['a counter-metric', counter]]) {
          if (!String(r.cells[c] ?? '').trim()) add({ code: 'brief-success', line: r.line, column: 1, reason: `${clip(r.raw, 40)} has no ${name}`, hint: name === 'a counter-metric' ? 'name what must not get worse while this metric improves' : `fill in ${name}` });
        }
      }
    }
  }

  // Business requirements are outcomes.
  const brs = sectionOf('Business requirements');
  for (const l of brs?.lines ?? []) {
    if (l.kind !== 'text' || !/^ *[-*+] (?:\*\*)?BR-[0-9]+/.test(l.text)) continue;
    const m = SOLUTION_WORDS.exec(l.text);
    if (m) add({ code: 'brief-outcome', severity: 'warning', line: l.line, column: 1, reason: `${clip(l.text.replace(/^ *[-*+] /, ''), 50)} names "${m[0]}", a solution`, hint: 'a business requirement says what the business needs; screens, fields and APIs are the PRD\'s' });
  }

  // The track: named in "Appetite and track", the same as the frontmatter.
  const appetite = sectionOf('Appetite and track');
  if (appetite) {
    const text = appetite.lines.filter((l) => l.kind === 'text').map((l) => l.text).join(' ');
    const named = TRACKS.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(text));
    const where = { line: appetite.h.line, column: 1 };
    if (named.length !== 1) add({ code: 'brief-track', ...where, reason: named.length ? `"Appetite and track" names ${named.join(' and ')}: one track only` : '"Appetite and track" names no track', hint: `name one of ${TRACKS.join(', ')}, with a one-line reason` });
    else if (typeof value.track === 'string' && value.track !== named[0]) add({ code: 'brief-track', ...where, reason: `"Appetite and track" says ${named[0]}, the frontmatter says ${value.track}`, hint: 'make them the same' });
  }

  // At approval, no open question is left.
  if (ctx.approving) {
    const open = sectionOf('Open questions');
    const q = open?.lines.find((l) => l.kind === 'text' && /^ *[-*+] (?:\*\*)?Q-[0-9]+/.test(l.text));
    if (q) add({ code: 'brief-open-question', line: q.line, column: 1, reason: 'a brief with an open question can\'t be approved', hint: 'answer it in the detail (or decide it under "Decisions for you"), then remove it' });
  }
}
