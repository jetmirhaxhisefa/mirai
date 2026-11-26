import { renderIndex } from './adr.js';

// What agents read of the ADRs (unit 61, decision 5; research.md: the index and a few recent ADRs,
// not the archive): every launch that has the project's documents as inputs gets the index; the
// full text only of the accepted ADRs that touch the work (its initiative, the FR and NFR IDs it
// covers, the ADRs its ticket is governed by, the components it names) and the last three accepted.
// A rejected, superseded or deprecated ADR is never given in full: the index names it.

export const LAST_ACCEPTED = 3;

// The rules each prompt carries (Kai's, Rex's, Tess's; Arlo's at 64). One text, so they can't drift.
export const ADR_RULES = [
  'The ADRs (architecture decision records) are the project\'s settled decisions: adr-index.md lists them all; the accepted ones that touch this work are given in full (adr-<id>.md).',
  'An accepted ADR is binding: follow it. A rejected option is never proposed again unless you have new evidence, which you name. A superseded or deprecated ADR is history: follow the one that replaced it.',
  'If the task can\'t be done without going against an accepted ADR, stop and say so (the ADR\'s id and why): never work around it quietly. The owner decides whether the task changes or the ADR is superseded.',
].join(' ');

// The accepted ADRs to give in full, newest last: [{ adr, why }].
export function relevantAdrs(adrs, { initiative = null, ids = [], governedBy = [], text = '' } = {}) {
  const accepted = adrs.filter((a) => a.status === 'accepted');
  const picked = new Map();
  const pick = (a, why) => {
    if (!picked.has(a.id)) picked.set(a.id, { adr: a, why });
  };
  const lower = (x) => String(x).toLowerCase();
  const gov = new Set(governedBy.map(lower));
  const hay = String(text).toLowerCase();
  for (const a of accepted) {
    if (gov.has(lower(a.id))) pick(a, `the ticket is governed by ${a.id}`);
    else if (initiative && a.initiative === initiative) pick(a, `decided for this initiative (${initiative})`);
    else {
      const cited = ids.find((id) => new RegExp(`(?<![A-Za-z0-9-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`).test(a.text));
      if (cited && (!initiative || !a.initiative || a.initiative === initiative)) pick(a, `serves ${cited}`);
      const comp = a.components.find((c) => c.length >= 3 && hay.includes(c.toLowerCase()));
      if (comp) pick(a, `governs ${comp}, which this work names`);
    }
  }
  for (const a of accepted.slice(-LAST_ACCEPTED)) pick(a, 'one of the last three accepted');
  return [...picked.values()].sort((x, y) => x.adr.number - y.adr.number);
}

// The input files: [{ name, text, why, from }]; none when the project has no ADR.
export function adrInputs(adrs, opts = {}) {
  if (!adrs.length) return [];
  const out = [{ name: 'adr-index.md', text: renderIndex(adrs), why: 'the index of the project\'s ADRs: every decision, its status and what superseded it', from: 'MIRAI: the ADR folder\'s index' }];
  for (const { adr, why } of relevantAdrs(adrs, opts)) out.push({ name: `adr-${adr.id.toLowerCase().replace(/[^a-z0-9._-]/g, '-')}.md`, text: adr.text, why: `an accepted ADR, binding: ${why}`, from: adr.path });
  return out;
}
