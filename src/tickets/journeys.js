// New critical journeys from an epic (unit 42, Scope 7; design/01 §10, unit 36). When a feature
// creates a critical journey, the ticket planner writes it under the epic's "## New critical
// journeys" in journeys.md's own form (### J-n, Steps, "Why critical:", "E2E test: none yet"), and
// lists it under "Decisions for you". Approving the set adds each block to
// .mirai/context/journeys.md, before its "## Sources", as a change you approve with it: a second
// signed line, journeys.md's own (kind context), in the same step.

export const NEW_JOURNEYS = 'New critical journeys';

// The journey blocks under the epic's section: [{ id, title, text }], `text` the block as written
// (its ### heading line to the next ### or ## heading). Empty when the section holds none.
export function newJourneys(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inSection = false;
  let fence = null;
  let cur = null;
  const close = () => {
    if (cur) {
      while (cur.lines.length && cur.lines.at(-1).trim() === '') cur.lines.pop();
      out.push({ id: cur.id, title: cur.title, text: cur.lines.join('\n') });
    }
    cur = null;
  };
  for (const l of lines) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (f) fence = fence ? (l.trim().startsWith(fence) ? null : fence) : f[1];
    if (!fence && /^ {0,3}#{1,2}[ \t]/.test(l)) {
      close();
      inSection = /^ {0,3}##[ \t]+New critical journeys[ \t]*#*[ \t]*$/.test(l);
      continue;
    }
    if (!inSection) continue;
    const h = !fence && /^ {0,3}###[ \t]+(J-[0-9]+)\b[: \t—-]*(.*)$/.exec(l);
    if (h) {
      close();
      cur = { id: h[1], title: h[2].trim(), lines: [l.trim()] };
      continue;
    }
    if (cur) cur.lines.push(l);
  }
  close();
  return out;
}

// journeys.md with the blocks added before its "## Sources" (or at its end): { text } or
// { problem } when a J-n is already in it.
export function addJourneys(journeysText, blocks) {
  const text = String(journeysText).replace(/\r\n?/g, '\n');
  for (const b of blocks) {
    if (new RegExp(`^ {0,3}###[ \\t]+${b.id}\\b`, 'm').test(text)) return { problem: `journeys.md already has ${b.id}: number the new journey on from the last one` };
  }
  const add = blocks.map((b) => b.text).join('\n\n');
  const at = text.search(/^## Sources[ \t]*$/m);
  if (at < 0) return { text: `${text.replace(/\n+$/, '')}\n\n${add}\n` };
  return { text: `${text.slice(0, at).replace(/\n+$/, '')}\n\n${add}\n\n${text.slice(at)}` };
}
