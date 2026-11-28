// The design set's sitting (unit 65, decision 3): what `mirai approve <hld-id> --file …/hld.md`
// shows and asks on `full`, beside the screen code in src/cli/commands/approve-tech-note.js.
//
//   decisionsForYou: the HLD summary's numbered "Decisions for you", each with its lettered options,
//     the one marked (recommended) and the one the HLD is "Written for:" (62's lint holds the form);
//   arloCalls: the D-n lines the architect decided alone, "(Arlo's call)";
//   notesText / designNotesNotSigned: design-notes.md, written from your answers when they don't
//     match what's written, and checked line by line against your signed design_decision lines.

const LETTERS = ['A', 'B', 'C', 'D'];

function summarySection(doc, name) {
  const h = doc.scan.headings.find((x) => x.level === 3 && x.text === name);
  if (!h) return [];
  const next = doc.scan.headings.find((x) => x.line > h.line && x.level <= 3);
  return doc.scan.lines.filter((l) => l.kind === 'text' && l.line > h.line && (!next || l.line < next.line));
}

// [{ n, question, options: { A: text, … }, recommended, writtenFor, line }]
export function decisionsForYou(doc) {
  const out = [];
  for (const l of summarySection(doc, 'Decisions for you')) {
    const t = (l.visible ?? l.text).trim();
    const m = /^([0-9]{1,2})\.\s+(.*)$/.exec(t);
    if (!m) continue;
    const body = m[2];
    const written = /Written for:\s*([A-D])\b/.exec(body)?.[1] ?? null;
    const parts = body.split(/\b([A-D]):\s+/);
    const question = parts[0].trim();
    const options = {};
    let recommended = null;
    for (let i = 1; i + 1 < parts.length; i += 2) {
      const text = parts[i + 1].replace(/\s*Written for:\s*[A-D]\.?\s*$/, '').replace(/[.;]\s*$/, '').trim();
      if (/\(recommended\)/i.test(text)) recommended = parts[i];
      options[parts[i]] = text.replace(/\s*\(recommended\)/i, '');
    }
    if (Object.keys(options).length >= 2 && written) out.push({ n: Number(m[1]), question, options, recommended, writtenFor: written, line: l.line });
  }
  return out;
}

// The D-n lines marked "(Arlo's call)": [{ id, text, line }].
export function arloCalls(doc) {
  const h = doc.scan.headings.find((x) => x.level === 2 && x.text === 'Decisions');
  if (!h) return [];
  const next = doc.scan.headings.find((x) => x.line > h.line && x.level <= 2);
  return doc.scan.lines
    .filter((l) => l.kind === 'text' && l.line > h.line && (!next || l.line < next.line))
    .map((l) => ({ l, m: /^ {0,3}[-*+][ \t]+(?:\*\*)?(D-[0-9]+)(?:\*\*)?:\s*(.*\(Arlo's call\).*)$/.exec(l.visible ?? l.text) }))
    .filter((x) => x.m)
    .map((x) => ({ id: x.m[1], text: x.m[2].trim(), line: x.l.line }));
}

export const answerOk = (letter, d) => LETTERS.includes(letter) && Object.hasOwn(d.options, letter);

// The line for one note: "- Decision 2 (answer, 2026-11-27): B, where the HLD is written for A." or
// "- ADR-0002 (reject, 2026-11-27): <your reason>".
export function noteLine(n, date) {
  const one = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();
  return n.decision === 'answer' ? `- ${n.ref} (answer, ${date}): ${n.answer}, where the HLD is written for ${n.written_for}.` : `- ${n.ref} (reject, ${date}): ${one(n.reason)}`;
}

export function notesText({ initiative, hld, round, notes, date }) {
  return [
    '---',
    `id: ${initiative}-design-notes`,
    'type: design-notes',
    'template: design-notes@v1',
    'owner: you',
    `created: "${date}"`,
    `hld: ${hld}`,
    `round: ${round}`,
    '---',
    `# Design notes: ${initiative}'s design set`,
    '',
    '## Notes',
    '',
    ...notes.map((n) => noteLine(n, date)),
    '',
  ].join('\n');
}

// The note lines that aren't one of your signed design_decision lines (the docs merge's check).
export function designNotesNotSigned(text, events) {
  const signed = new Set(events.filter((e) => e.type === 'design_decision' && e.by === 'human' && e.decision !== 'accept' && !(e.decision === 'answer' && e.answer === e.written_for)).map((e) => noteLine(e, '').replace(/, \)/, ')')));
  const bad = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!/^- /.test(line)) continue;
    const bare = line.replace(/, \d{4}-\d{2}-\d{2}\)/, ')');
    if (!signed.has(bare)) bad.push(line.slice(0, 60));
  }
  return bad;
}

// The sitting's round: one more than the last round your design decisions on this HLD had.
export function sittingRound(events, hld) {
  const last = events.filter((e) => e.type === 'design_decision' && e.hld === hld).map((e) => e.round).reduce((a, b) => Math.max(a, b), 0);
  return last + 1;
}
