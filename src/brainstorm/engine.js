// The brainstorm engine (unit 65b, decision 6; Scope 1): a topic-neutral conversation for your
// session. Its caller gives the topic, the persona that leads, the items to settle and the file the
// answers go to; the engine gives the session its brief (questions one at a time, each with a
// recommendation and a confidence, your answer before the next), and writes each answer: into the
// caller's file through the caller's own formatter, and as one dated line of the file's Q → A log.
// Design is its first caller (src/design/explore.js); post-MVP P42 points it at product questions.
// Nothing here knows "design".

const oneLine = (s, max = 500) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

// The brief the session follows: Markdown. `items`: [{ id, text, options: [{ letter, text }],
// recommendation: { letter, why } | null, settled: string | null }]; `record`: how the session
// records one answer (the exact command); `rules`: the caller's own lines.
export function brief({ topic, persona, purpose, items, record, rules = [], after }) {
  const open = items.filter((i) => !i.settled);
  const lines = [
    `# ${topic}`,
    '',
    `${persona} leads this conversation with the owner. ${purpose}`,
    '',
    '## How the conversation goes',
    '',
    '- One question at a time, in the order below. Never two in one message.',
    '- For each: the question in one line, the options with what each costs, your recommendation with a confidence (the chance the owner picks it) and why, then wait for the owner\'s answer.',
    '- The owner may pick an option, give their own, or leave it to you ("your call"). Restate their answer in one line before you record it.',
    `- Record each answer as soon as it is given: ${record}. The file and its log are written by MIRAI, never by hand.`,
    '- Don\'t ask about what\'s already settled (marked below), and don\'t add questions of your own: a new question goes back to the list first.',
    ...rules.map((r) => `- ${r}`),
    '',
    `## Still open (${open.length} of ${items.length})`,
    '',
  ];
  for (const i of items) {
    lines.push(`### ${i.id}: ${oneLine(i.text)}${i.settled ? ` (settled: ${oneLine(i.settled, 120)})` : ''}`);
    if (i.settled) {
      lines.push('');
      continue;
    }
    lines.push('');
    for (const o of i.options ?? []) lines.push(`- ${o.letter}: ${oneLine(o.text, 300)}`);
    if (i.recommendation) lines.push('', `Recommendation: ${i.recommendation.letter}, ${oneLine(i.recommendation.why, 300)}`);
    lines.push('');
  }
  lines.push('## When every question is answered', '', after, '');
  return `${lines.join('\n')}`;
}

// One line of the Q → A log: "- <YYYY-MM-DD> Q-n: <the answer as given>".
export const logLine = (date, id, answer) => `- ${date} ${id}: ${oneLine(answer, 300) || '-'}`;

// `text` with `entry` put in `section` (## name) under its "### <id>: …" heading, replacing one there,
// and `line` added to the Log section; both sections made when missing, before anything after them.
export function withAnswer(text, { section, id, heading, entry, log }) {
  let out = text.replace(/\r\n?/g, '\n');
  if (!new RegExp(`^## ${section}[ \\t]*$`, 'm').test(out)) out = out.replace(/\n*$/, `\n\n## ${section}\n`);
  if (!/^## Log[ \t]*$/m.test(out)) out = out.replace(/\n*$/, '\n\n## Log\n');
  const block = `### ${id}: ${heading}\n\n${entry.replace(/\n*$/, '\n')}`;
  const sec = new RegExp(`(^## ${section}[ \\t]*\\n)([^]*?)(?=^## |(?![^]))`, 'm');
  out = out.replace(sec, (all, head, body) => {
    const parts = body.split(/^(?=### )/m);
    const at = parts.findIndex((p) => p.startsWith(`### ${id}:`));
    if (at >= 0) parts[at] = `${block}\n`;
    else {
      const n = Number(id.replace(/^\D+/, ''));
      const before = parts.findIndex((p) => /^### [A-Z]+-([0-9]+):/.test(p) && Number(/^### [A-Z]+-([0-9]+):/.exec(p)[1]) > n);
      if (before >= 0) parts.splice(before, 0, `${block}\n`);
      else parts.push(`${parts.length && !parts.at(-1).endsWith('\n\n') ? '\n' : ''}${block}\n`);
    }
    return `${head}${parts.join('').replace(/^\n*/, '\n').replace(/\n*$/, '\n\n')}`;
  });
  out = out.replace(/(^## Log[ \t]*\n)([^]*?)(?=^## |(?![^]))/m, (all, head, body) => `${head}\n${[...body.split('\n').filter((l) => l.trim()), log].join('\n')}\n${/^## /m.test(out.slice(out.indexOf(head) + head.length + body.length)) ? '\n' : ''}`);
  return out.replace(/\n{3,}/g, '\n\n');
}
