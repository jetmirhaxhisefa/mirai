import { tableIn } from './checks.js';
import { clip } from './summary.js';
import { checkDocument, linkLinesOf } from './rules.js';
import { intakeOf, listed, openQuestions } from './interview.js';
import { ACCEPTED_OPEN, checkOpenMarks } from './open.js';

// The business brief's own lint (unit 31; research/13 §9b, Jet's decision 2): Lenny's 1-pager
// plus Shape Up's appetite, no-gos and rabbit holes. What the generic rules can't say:
// - BR, SM, NG, R and Q are numbered 1, 2, 3 … with no gap (a gap is a deleted item someone may
//   still cite);
// - each success metric has a baseline (or UNKNOWN), a target and a counter-metric;
// - a business requirement is an outcome: one naming a screen, button, field, endpoint or API is
//   a solution, so it warns;
// - "Appetite and track" names the frontmatter's track;
// - at approval, no open question is left (ctx.approving);
// - unit 35: an interview.md beside the brief is linked in the "Interview:" line, and a linked
//   interview lints clean (it is confirmed), so a brief can't be approved while its interview
//   has an open question.
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

  // Unit 44 (decision 4): an (open) decision warns, and blocks approval.
  checkOpenMarks(doc, ctx, add, 'brief');

  // At approval, no open question is left (unit 44: but one the owner accepted as open).
  if (ctx.approving) {
    const open = sectionOf('Open questions');
    const q = open?.lines.find((l) => l.kind === 'text' && /^ *[-*+] (?:\*\*)?Q-[0-9]+/.test(l.text) && !ACCEPTED_OPEN.test(l.text));
    if (q) add({ code: 'brief-open-question', line: q.line, column: 1, reason: 'a brief with an open question can\'t be approved', hint: 'answer it in the detail (or decide it under "Decisions for you"), then remove it' });
  }

  checkInterviewLink(doc, def, ctx, add);
}

// The interview the brief came from (unit 35, Scope 4). Linted alone (no file around it), an
// unlinked interview.md can't be seen and a linked one can't be read: then nothing is checked.
function checkInterviewLink(doc, def, ctx, add) {
  if (!ctx.readDocument) return;
  const title = doc.scan.headings.find((h) => h.level === 1);
  const own = linkLinesOf(doc.scan, def).find((l) => l.link.label === 'Interview');
  const at = { line: own?.line ?? title?.line ?? doc.bodyLine, column: 1 };
  if (!own) {
    const beside = ctx.readDocument('interview.md');
    if (['missing', 'unavailable', 'outside'].includes(beside.problem)) return;
    add({ code: 'brief-interview', ...at, reason: 'interview.md beside the brief isn\'t linked', hint: 'add "Interview: [<its title>](interview.md)" right under the # title: the brief cites the interview it came from' });
    return;
  }
  const target = own.targets[0].split('#')[0];
  const found = ctx.readDocument(target);
  if (found.problem === 'unreadable') add({ code: 'brief-interview', ...at, reason: `the linked interview ${target} can't be read`, hint: 'check that it is a MIRAI interview with frontmatter' });
  if (found.problem) return; // missing or outside: the link rules say so
  const idef = ctx.registry?.documentTypes?.interview;
  if (found.value.type !== 'interview' || !idef) {
    add({ code: 'brief-interview', ...at, reason: `${target} is not an interview`, hint: 'link the interview.md the brief came from, or remove the "Interview:" line' });
    return;
  }
  // Unit 44 (decision 10): the track you confirmed at the intake is the brief's.
  const intake = intakeOf(found);
  if (intake?.track && typeof doc.value.track === 'string' && intake.track !== doc.value.track) add({ code: 'brief-track', ...at, reason: `the interview's intake confirmed track ${intake.track}, the brief says ${doc.value.track}`, hint: 'make them the same, or ask the owner again' });
  const errors = checkDocument(found, idef, { registry: ctx.registry, project: ctx.project, linkTarget: () => ({ slugs: null }), readDocument: () => ({ problem: 'unavailable' }) }).filter((p) => p.severity === 'error');
  if (!errors.length) return;
  const open = openQuestions(found);
  add({
    code: 'brief-interview', ...at,
    reason: open.length ? `the interview ${target} has open questions: ${listed(open)}` : `the interview ${target} isn't confirmed: ${errors[0].reason}`,
    hint: open.length ? 'answer them in your session, then run mirai lint' : `run mirai lint on ${target} and fix what it reports`,
  });
}
