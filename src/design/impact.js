// A change to an approved design (unit 65, decision 4): which IDs it changed, and which tickets cite
// them. The IDs: a D-n line whose text changed or that is gone; an LLD item (C-n, S-n) whose row
// changed or is gone; an ADR the change supersedes. A ticket cites an ADR in `governed_by` and an
// LLD item in `uses` (63). A ticket merged into the integration branch is built: it's flagged for
// you; any other goes back to the ticket planner for a re-cut, with the change as her notes.

const dLines = (text) => {
  const out = new Map();
  for (const line of String(text ?? '').split('\n')) {
    const m = /^ {0,3}[-*+][ \t]+(?:\*\*)?(D-[0-9]+)(?:\*\*)?:\s*(.*)$/.exec(line);
    if (m) out.set(m[1], m[2].trim());
  }
  return out;
};
const itemRows = (text) => {
  const out = new Map();
  for (const line of String(text ?? '').split('\n')) {
    const m = /^ *\| *`?([CS]-[0-9]+)`? *\|(.*)$/.exec(line);
    if (m) out.set(m[1], m[2].trim());
  }
  return out;
};
const changedKeys = (a, b) => [...a.keys()].filter((k) => !b.has(k) || b.get(k) !== a.get(k));

// { decisions: [D-n], items: [C-n, S-n], adrs: [ADR ids] }
export function changedIds({ before = {}, after = {}, superseded = [] }) {
  return {
    decisions: changedKeys(dLines(before.hld ?? before['tech-note']), dLines(after.hld ?? after['tech-note'])).sort(),
    items: changedKeys(itemRows(before.lld), itemRows(after.lld)).sort(),
    adrs: [...new Set(superseded)].sort(),
  };
}

// tickets: [{ id, value }] (the initiative's tickets); merged: Set of ticket ids merged into the
// integration branch. Returns { unbuilt: [{ id, cites }], built: [{ id, cites }] }.
export function ticketImpact({ tickets, ids, merged }) {
  const hit = new Set([...ids.items, ...ids.adrs]);
  const unbuilt = [];
  const built = [];
  for (const t of tickets) {
    const cites = [...(Array.isArray(t.value.governed_by) ? t.value.governed_by : []), ...(Array.isArray(t.value.uses) ? t.value.uses : [])].filter((x) => typeof x === 'string' && hit.has(x));
    if (!cites.length) continue;
    (merged.has(t.id) ? built : unbuilt).push({ id: t.id, cites: [...new Set(cites)].sort() });
  }
  return { unbuilt, built };
}
