import { gateUrl } from '../launch/hook.js';

// The lints of unit 65b's three documents (Scope 6 and 7), beyond the generic rules (sections,
// frontmatter):
// - research-questions: one or more "### Q-n: …" under Questions, numbered 1, 2, … in order, each
//   with its "Why it matters:" line; a stack summary that says something;
// - research: one "### Q-n" per approved question (research-questions.md, beside it), each with two
//   or more options, a pick, a runner-up and the argument against the pick, every one citing [S-n];
//   every cited S-n defined under Sources with a title, an http(s) URL, an access date and a quote;
//   "Sources consulted" and "Suspicious pages" each a list or "None.". With the run's evidence
//   (`ctx.research`, given only by the research run's own check, src/design/research.js): each
//   source's URL is one the run's searches returned, and each quote is in what the run's fetch of
//   that URL returned (decision 3.4);
// - design-decisions: one "### Q-n" per question of research.md, each with its options citing
//   research.md's sources, a pick (a letter of its options, or "(Arlo's call)"), a reason (unless
//   Arlo's call) and "hard to reverse: yes|no"; a Log of dated answers.

const clip = (t) => (t.length > 70 ? `${t.slice(0, 67)}…` : t);
const BULLET = /^ {0,3}[-*+][ \t]+/;
const CITE = /\[(S-[0-9]+)\]/g;
const QUESTION = /^(Q-([0-9]+)):[ \t]*(\S.*)$/;
const NONE = /^None\.?$/i;

function section(doc, name) {
  const h = doc.scan.headings.find((x) => x.level === 2 && x.text === name);
  if (!h) return null;
  const next = doc.scan.headings.find((x) => x.line > h.line && x.level <= 2);
  const end = next ? next.line : Infinity;
  return { heading: h, end, lines: doc.scan.lines.filter((l) => l.line > h.line && l.line < end && l.kind === 'text' && (l.visible ?? l.text).trim() !== '') };
}

// The "### Q-n: …" blocks of a section: [{ id, n, text, line, lines }].
function questionBlocks(doc, sec, add, code) {
  if (!sec) return [];
  const heads = doc.scan.headings.filter((h) => h.level === 3 && h.line > sec.heading.line && h.line < sec.end);
  return heads.map((h, i) => {
    const m = QUESTION.exec(h.text);
    if (!m) add({ code, line: h.line, column: 1, reason: `"${clip(h.text)}" isn't a question heading`, hint: 'each question is "### Q-n: <the question>"' });
    const stop = heads[i + 1]?.line ?? sec.end;
    return { id: m?.[1] ?? null, n: m ? Number(m[2]) : null, text: m?.[3]?.trim() ?? h.text, line: h.line, lines: sec.lines.filter((l) => l.line > h.line && l.line < stop) };
  }).filter((b) => b.id);
}

// A "- **Label:** rest" bullet's label and rest.
const labelled = (t) => {
  const m = /^ {0,3}[-*+][ \t]+\*\*([^*]+?):?\*\*:?[ \t]*(.*)$/.exec(t);
  return m ? { label: m[1].trim().replace(/:$/, ''), rest: m[2].trim() } : null;
};
const text = (l) => l.visible ?? l.text;
const cites = (t) => [...t.matchAll(CITE)].map((x) => x[1]);

function numbered(blocks, add, code, what) {
  blocks.forEach((b, i) => {
    if (b.n !== i + 1) add({ code, line: b.line, column: 1, reason: `${b.id} is out of order (the ${what} are numbered Q-1, Q-2, … in order)`, hint: `number it Q-${i + 1}` });
  });
}

function listOrNone(sec, add, code, name) {
  if (!sec) return;
  const lines = sec.lines.map(text);
  if (lines.length === 1 && NONE.test(lines[0].trim())) return;
  if (!lines.length) {
    add({ code, line: sec.heading.line, column: 1, reason: `${name} is empty`, hint: 'list them, or write "None."' });
    return;
  }
  sec.lines.forEach((l) => {
    if (!BULLET.test(text(l)) && !/^\s/.test(text(l))) add({ code, line: l.line, column: 1, reason: `"${clip(text(l).trim())}" in ${name} isn't a list item`, hint: 'one "- <url>: …" per page, or "None."' });
  });
}

// ---- research-questions -------------------------------------------------------------------------

export function questionsOf(doc) {
  const sec = section(doc, 'Questions');
  return questionBlocks(doc, sec, () => {}, '').map((b) => ({ id: b.id, text: b.text }));
}

export function checkResearchQuestions(doc, def, ctx, add) {
  const stack = section(doc, 'Stack summary');
  if (stack && !stack.lines.length) add({ code: 'research-questions-stack', line: stack.heading.line, column: 1, reason: 'the stack summary is empty', hint: 'a few lines: the language and framework with versions, the database, how it\'s deployed' });
  const sec = section(doc, 'Questions');
  const blocks = questionBlocks(doc, sec, add, 'research-questions-question');
  if (sec && !blocks.length) add({ code: 'research-questions-question', line: sec.heading.line, column: 1, reason: 'there are no questions', hint: 'one "### Q-n: <the question>" each, or skip the research: mirai design <initiative> --no-explore' });
  numbered(blocks, add, 'research-questions-question', 'questions');
  for (const b of blocks) {
    if (!b.lines.some((l) => /^Why it matters:[ \t]*\S/i.test(text(l).trim()))) add({ code: 'research-questions-why', line: b.line, column: 1, reason: `${b.id} doesn't say why it matters`, hint: 'add a line "Why it matters: <what the design decides by it>"' });
  }
}

// ---- research ---------------------------------------------------------------------------------

const SOURCE = /^ {0,3}[-*+][ \t]+\*\*(S-[0-9]+):?\*\*:?[ \t]*\[([^\]]+)\]\((\S+?)\)[ \t]*[—–-]+[ \t]*accessed[ \t]+([0-9]{4}-[0-9]{2}-[0-9]{2})[ \t]*[—–-]+[ \t]*["“](.+)["”][ \t]*$/;
const SLOTS = [['Pick', /^Pick$/i], ['Runner-up', /^Runner-up$/i], ['Against the pick', /^Against the pick$/i]];

// The sources of a research document: Map S-n → { title, url, date, quote, line }.
export function sourcesOf(doc, add = () => {}) {
  const out = new Map();
  const sec = section(doc, 'Sources');
  for (const l of sec?.lines ?? []) {
    const t = text(l);
    if (!BULLET.test(t)) continue;
    const m = SOURCE.exec(t);
    if (!m) {
      add({ code: 'research-source', line: l.line, column: 1, reason: `"${clip(t.trim())}" isn't a source line`, hint: '- **S-n:** [<title>](<url>) — accessed <YYYY-MM-DD> — "<a short quote>"' });
      continue;
    }
    if (out.has(m[1])) add({ code: 'research-source', line: l.line, column: 1, reason: `${m[1]} is defined twice` });
    out.set(m[1], { title: m[2], url: m[3], date: m[4], quote: m[5], line: l.line });
  }
  return out;
}

// A quote as it's compared: spaces folded, quotes and dashes plain, case ignored.
export const plainQuote = (t) => String(t).normalize('NFKC').replace(/[“”«»„]/g, '"').replace(/[‘’‚]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();

export function checkResearch(doc, def, ctx, add) {
  const sources = sourcesOf(doc, add);
  const cited = new Set();
  const sec = section(doc, 'Answers');
  const blocks = questionBlocks(doc, sec, add, 'research-answer');
  numbered(blocks, add, 'research-answer', 'answers');
  for (const b of blocks) {
    const items = b.lines.map((l) => ({ l, b: labelled(text(l)) })).filter((x) => x.b);
    const options = items.filter((x) => /^Option [A-Z]$/i.test(x.b.label));
    if (options.length < 2) add({ code: 'research-answer', line: b.line, column: 1, reason: `${b.id} has ${options.length} option${options.length === 1 ? '' : 's'}; it needs two or more`, hint: '"- **Option A:** … [S-n]", "- **Option B:** … [S-n]"' });
    for (const [name, re] of SLOTS) if (!items.some((x) => re.test(x.b.label))) add({ code: 'research-answer', line: b.line, column: 1, reason: `${b.id} has no "${name}"`, hint: `add "- **${name}:** … [S-n]"` });
    for (const { l, b: x } of items) {
      const ids = cites(x.rest);
      if (!ids.length) add({ code: 'research-cite', line: l.line, column: 1, reason: `${b.id}'s "${x.label}" cites no source`, hint: 'every claim cites a source: end it with [S-n]' });
      for (const id of ids) {
        cited.add(id);
        if (!sources.has(id)) add({ code: 'research-cite', line: l.line, column: 1, reason: `${b.id} cites ${id}, which Sources doesn't define`, hint: 'define it under Sources, or cite one that is there' });
      }
    }
  }
  for (const [id, s] of sources) {
    if (!cited.has(id)) add({ code: 'research-source-uncited', severity: 'warning', line: s.line, column: 1, reason: `${id} isn't cited`, hint: 'cite it, or move it to "Sources consulted"' });
    if (!gateUrl(s.url)) add({ code: 'research-source', line: s.line, column: 1, reason: `${id}'s URL isn't a plain http(s) URL`, hint: 'the page\'s address as the search returned it' });
    if (s.quote.trim().length < 8 || s.quote.length > 400) add({ code: 'research-quote', line: s.line, column: 1, reason: `${id}'s quote is ${s.quote.trim().length < 8 ? 'too short to check' : 'longer than 400 characters'}`, hint: 'a short sentence as the page has it' });
  }
  listOrNone(section(doc, 'Sources consulted'), add, 'research-consulted', 'Sources consulted');
  listOrNone(section(doc, 'Suspicious pages'), add, 'research-suspicious', 'Suspicious pages');

  // The approved questions, beside it: each answered, in order, by its own words' number.
  const q = typeof doc.value?.questions === 'string' && ctx.readDocument ? ctx.readDocument(doc.value.questions) : null;
  if (q && !q.problem && q.value?.type === 'research-questions') {
    const asked = questionsOf(q);
    const answered = new Set(blocks.map((b) => b.id));
    for (const a of asked) if (!answered.has(a.id)) add({ code: 'research-answer', line: sec?.heading.line ?? doc.bodyLine, column: 1, reason: `${a.id} (${clip(a.text)}) has no answer`, hint: `add "### ${a.id}: ${clip(a.text)}" with its options, pick, runner-up and the argument against` });
    for (const b of blocks) if (!asked.some((a) => a.id === b.id)) add({ code: 'research-answer', line: b.line, column: 1, reason: `${b.id} isn't one of the approved questions`, hint: 'answer exactly the approved questions' });
  }

  // The run's evidence (decision 3.4).
  const ev = ctx.research;
  if (ev) {
    const listed = new Set(ev.listed);
    for (const [id, s] of sources) {
      const url = gateUrl(s.url);
      if (!url) continue;
      if (!listed.has(url)) {
        add({ code: 'research-source-outside', line: s.line, column: 1, reason: `${id}'s URL ${clip(s.url)} isn't one this run's searches returned`, hint: 'cite only pages the run found by searching and read' });
        continue;
      }
      const fetched = ev.evidence.filter((e) => e.url === url);
      if (!fetched.length) add({ code: 'research-quote', line: s.line, column: 1, reason: `${id} (${clip(s.url)}) was never fetched in this run`, hint: 'fetch the page and quote what it says' });
      else if (!fetched.some((e) => plainQuote(e.result).includes(plainQuote(s.quote)))) add({ code: 'research-quote', line: s.line, column: 1, reason: `${id}'s quote isn't in what the run's fetch of ${clip(s.url)} returned`, hint: 'quote the page as the fetch returned it, word for word' });
    }
  }
}

// ---- design-decisions ---------------------------------------------------------------------------

export function decisionsOf(doc) {
  const sec = section(doc, 'Decisions');
  return questionBlocks(doc, sec, () => {}, '').map((b) => {
    const get = (re) => b.lines.map((l) => labelled(text(l))).find((x) => x && re.test(x.label))?.rest ?? null;
    const pick = get(/^Pick$/i);
    return { id: b.id, text: b.text, options: get(/^Options$/i), pick, arlo: pick !== null && /^\(Arlo['’]s call\)$/i.test(pick.trim()), reason: get(/^Reason$/i), hard: /^yes\b/i.test(get(/^Hard to reverse$/i) ?? '') };
  });
}

export function checkDesignDecisions(doc, def, ctx, add) {
  const sec = section(doc, 'Decisions');
  const blocks = questionBlocks(doc, sec, add, 'design-decision');
  numbered(blocks, add, 'design-decision', 'decisions');
  const r = typeof doc.value?.research === 'string' && ctx.readDocument ? ctx.readDocument(doc.value.research) : null;
  const research = r && !r.problem && r.value?.type === 'research' ? r : null;
  const sources = research ? sourcesOf(research) : null;
  for (const b of blocks) {
    const items = b.lines.map((l) => ({ l, x: labelled(text(l)) })).filter((y) => y.x);
    const one = (re) => items.find((y) => re.test(y.x.label));
    const options = one(/^Options$/i);
    const pick = one(/^Pick$/i);
    const reason = one(/^Reason$/i);
    const hard = one(/^Hard to reverse$/i);
    if (!options) add({ code: 'design-decision', line: b.line, column: 1, reason: `${b.id} lists no options`, hint: '"- **Options:** A: … [S-n]; B: … [S-n]"' });
    else {
      const ids = cites(options.x.rest);
      if (!ids.length) add({ code: 'design-decision-cite', line: options.l.line, column: 1, reason: `${b.id}'s options cite nothing in research.md`, hint: 'cite research.md\'s sources: [S-n]' });
      if (sources) for (const id of ids) if (!sources.has(id)) add({ code: 'design-decision-cite', line: options.l.line, column: 1, reason: `${b.id} cites ${id}, which research.md doesn't have` });
    }
    const letters = options ? [...options.x.rest.matchAll(/(?:^|;\s*)([A-Z]):/g)].map((m) => m[1]) : [];
    const arlo = pick && /^\(Arlo['’]s call\)$/i.test(pick.x.rest.trim());
    if (!pick) add({ code: 'design-decision', line: b.line, column: 1, reason: `${b.id} has no pick`, hint: '"- **Pick:** A", or "- **Pick:** (Arlo\'s call)"' });
    else if (!arlo && !letters.includes((/^([A-Z])\b/.exec(pick.x.rest.trim()) ?? [])[1])) add({ code: 'design-decision', line: pick.l.line, column: 1, reason: `${b.id}'s pick "${clip(pick.x.rest)}" isn't one of its options (${letters.join(', ') || 'none'}) or "(Arlo's call)"` });
    if (pick && !arlo && !(reason && reason.x.rest.trim())) add({ code: 'design-decision', line: b.line, column: 1, reason: `${b.id} gives no reason for its pick`, hint: '"- **Reason:** <why, in your words>"' });
    if (!hard || !/^(?:yes|no)\b/i.test(hard.x.rest.trim())) add({ code: 'design-decision', line: hard?.l.line ?? b.line, column: 1, reason: `${b.id} doesn't say whether it's hard to reverse`, hint: '"- **Hard to reverse:** yes" or "no", with why if you like' });
  }
  if (research) {
    const answers = questionBlocks(research, section(research, 'Answers'), () => {}, '').map((b) => b.id);
    for (const id of answers) if (!blocks.some((b) => b.id === id)) add({ code: 'design-decision', line: sec?.heading.line ?? doc.bodyLine, column: 1, reason: `${id} of research.md has no decision`, hint: `decide it, or "- **Pick:** (Arlo's call)"` });
  }
  const log = section(doc, 'Log');
  for (const l of log?.lines ?? []) if (!/^ {0,3}[-*+][ \t]+[0-9]{4}-[0-9]{2}-[0-9]{2}[ \t]+Q-[0-9]+:[ \t]*\S/.test(text(l))) add({ code: 'design-decision-log', line: l.line, column: 1, reason: `"${clip(text(l).trim())}" isn't a log line`, hint: '"- <YYYY-MM-DD> Q-n: <the answer as given>"' });
  if (log && !log.lines.length && blocks.length) add({ code: 'design-decision-log', line: log.heading.line, column: 1, reason: 'the Log is empty', hint: 'one dated line per answer' });
}
