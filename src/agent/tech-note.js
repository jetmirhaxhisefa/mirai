// A plan and the technical note (unit 62b, decision 4, Scope 6): the plan's "## Technical note"
// section says which of the note's decisions it relies on ("Relies on: D-1, D-3") and, for each it
// goes against, "Departs from D-n: <why>". At the plan gate a departure, or a D-n the note doesn't
// have, is flagged (`plan-departs-tech-note`): shown, never blocking; you accept it with a reason
// (signed in the approval line) or send the plan back. Kai declares; Rex checks the code.

const D = /\bD-[0-9]+\b/g;

// { reliesOn: ['D-1'], departs: [{ d, why }] } from the plan's text, or null with no such section.
export function planTechNote(text) {
  const m = /^## +Technical note[ \t]*\n([^]*?)(?=^## |(?![^]))/m.exec(String(text).replace(/\r\n?/g, '\n'));
  if (!m) return null;
  const reliesOn = [];
  const departs = [];
  for (const raw of m[1].split('\n')) {
    const line = raw.replace(/^ *[-*+][ \t]+/, '').trim();
    const r = /^Relies on:[ \t]*(.*)$/i.exec(line);
    if (r) for (const d of r[1].match(D) ?? []) if (!reliesOn.includes(d)) reliesOn.push(d);
    const dep = /^Departs from (D-[0-9]+):[ \t]*(.*)$/i.exec(line);
    if (dep) departs.push({ d: dep[1], why: dep[2].trim() });
  }
  return { reliesOn, departs };
}

// The note's D-n lines: Map d → its text.
export function noteDecisions(noteText) {
  const out = new Map();
  const m = /^## +Decisions[ \t]*\n([^]*?)(?=^## |(?![^]))/m.exec(String(noteText ?? '').replace(/\r\n?/g, '\n'));
  for (const raw of (m ? m[1] : '').split('\n')) {
    const d = /^ {0,3}[-*+][ \t]+(?:\*\*)?(D-[0-9]+)(?:\*\*)?:[ \t]*(.*)$/.exec(raw);
    if (d) out.set(d[1], d[2].trim());
  }
  return out;
}

// The plan gate's flags: [{ code: 'plan-departs-tech-note', d, why }]. With no approved note given,
// none (a plan of a ticket with no note is never flagged for it).
export function techNoteFlags(planText, noteText) {
  if (noteText === null || noteText === undefined) return [];
  const p = planTechNote(planText);
  const decisions = noteDecisions(noteText);
  const flags = [];
  for (const d of p?.departs ?? []) flags.push({ code: 'plan-departs-tech-note', d: d.d, why: `departs from the technical note's ${d.d}${decisions.has(d.d) ? ` ("${decisions.get(d.d).slice(0, 80)}")` : ''}: ${d.why || 'no reason given'}` });
  for (const d of p?.reliesOn ?? []) if (!decisions.has(d)) flags.push({ code: 'plan-departs-tech-note', d, why: `cites ${d}, which the technical note doesn't have` });
  if (!p && decisions.size) flags.push({ code: 'plan-departs-tech-note', d: null, why: 'names none of the technical note\'s decisions (no "## Technical note" section)' });
  return flags;
}
