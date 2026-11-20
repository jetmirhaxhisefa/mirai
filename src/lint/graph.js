// The ticket graph lint (unit 33; design/01 §5, §5a, §6; D-09). It runs on an epic, with its
// tickets (every ticket in <initiative>/tickets/ whose `epic` names it) and its PRD, and checks
// that the set is complete and can be built:
// - fail: a cycle in `after`; an `after` naming a ticket that doesn't exist (one of another epic
//   is fine: this one waits until it's done); a PRD FR, NFR or AC (Failures and Unchanged
//   behaviour included) that no ticket covers; a ticket covering an ID the PRD doesn't define; a
//   size other than S, M or L; more tickets or L tickets than the caps; a ticket with no AC or no
//   `verify`;
// - warn: two tickets listing the same file in `files_likely` with no `after` between them; the
//   ticket count close to the cap.
// Stacking (at most 2 levels, inside one epic; §6) is a runtime limit the scheduler keeps, not a
// rule on how long an `after` chain may be, so it isn't linted (corrected 2026-11-20).
// Every message names the ticket and the fix. The caps come from `[docs.limits]` (project layer
// only, ranged), with no exception route: over a cap, the PRD is split or the work moves to `full`
// (Jet's decision 3); tickets are never merged to fit.

export const SIZES = Object.freeze(['S', 'M', 'L']);
export const CAPS = Object.freeze({ tickets: 20, l: 5 });

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x !== '') : []);
// Ticket keys in natural order: SAMPLE-9 before SAMPLE-10.
export const byKey = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

export function capsOf(limits = {}) {
  return { tickets: limits.epic_tickets ?? CAPS.tickets, l: limits.epic_l_tickets ?? CAPS.l };
}

// The PRD's coverable IDs in the PRD's order: [{ id, kind: 'FR' | 'NFR' | 'AC', parent?, group }],
// from the upstream's defined IDs (rules.js). `group` is the FR group ("Failures") or
// "Non-functional".
export function prdItems(up) {
  if (!up) return [];
  const groups = up.doc.scan.headings.filter((h) => h.level <= 3);
  const groupAt = (line) => {
    const h = groups.filter((x) => x.line < line).at(-1);
    return h?.level === 3 ? h.text : null;
  };
  const out = [];
  for (const [prefix, kind] of [['FR', 'FR'], ['AC', 'AC'], ['NFR', 'NFR'], ['ACNFR', 'AC']]) {
    for (const [id, at] of up.ids.get(prefix) ?? []) {
      const parent = kind === 'AC' ? /^AC-(N?FR-[0-9]+)\./.exec(id)?.[1] : undefined;
      out.push({ id, kind, parent, line: at.line, group: prefix === 'NFR' || prefix === 'ACNFR' ? 'Non-functional' : null });
    }
  }
  out.sort((a, b) => a.line - b.line);
  for (const item of out) {
    if (item.group) continue;
    const fr = item.kind === 'AC' ? out.find((x) => x.id === item.parent) : item;
    item.group = groupAt(fr?.line ?? item.line) ?? 'Functional';
  }
  return out;
}

// The tickets of one epic, in key order.
export const ticketsOf = (all, epicId) => all.filter((t) => same(t.value.epic, epicId)).sort((a, b) => byKey(String(a.value.id), String(b.value.id)));

// Which IDs a set of tickets covers: id → [ticket keys].
export function coverage(tickets) {
  const out = new Map();
  for (const t of tickets) {
    for (const id of [...list(t.value.covers_fr), ...list(t.value.covers_ac)]) {
      if (!out.has(id)) out.set(id, []);
      if (!out.get(id).includes(t.value.id)) out.get(id).push(t.value.id);
    }
  }
  return out;
}

// The problems: [{ code, severity, reason, hint }]. `tickets`: the epic's; `all`: every ticket in
// the folder; `items`: prdItems, or null when the PRD couldn't be read (coverage isn't checked).
export function graphProblems({ epicId, track, tickets, all, items, caps = CAPS }) {
  const out = [];
  const fail = (code, reason, hint) => out.push({ code, severity: 'error', reason, hint });
  const warn = (code, reason, hint) => out.push({ code, severity: 'warning', reason, hint });
  const keyOf = (t) => String(t.value.id);
  const inEpic = new Map(tickets.map((t) => [keyOf(t).toLowerCase(), t]));
  const inFolder = new Map(all.map((t) => [String(t.value.id).toLowerCase(), t]));

  // ---- Sizes and caps ------------------------------------------------------------------------
  if (tickets.length === 0) fail('graph-tickets', `no ticket names this epic: tickets/ holds no file with epic: ${epicId}`, `write the tickets in tickets/<key>.md, each with epic: ${epicId}, then run mirai epic render`);
  for (const t of tickets) {
    if (!SIZES.includes(t.value.size)) fail('graph-size', `${keyOf(t)} is size ${typeof t.value.size === 'string' ? t.value.size : 'unset'}; a ticket is S, M or L`, `split ${keyOf(t)} into tickets of size L or smaller, each a vertical slice (design/01 §5)`);
  }
  const split = track === 'full' ? 'split the epic in two (on full, one approval covers several epics)' : 'split the PRD into two, or move the work to the full track with several epics';
  if (tickets.length > caps.tickets) fail('graph-cap', `the epic has ${tickets.length} tickets; the cap is ${caps.tickets}`, `${split}; never merge tickets to fit the cap`);
  else if (tickets.length >= Math.ceil(caps.tickets * 0.8)) warn('graph-cap', `the epic has ${tickets.length} tickets, close to the cap of ${caps.tickets}`, `if it grows, ${split}`);
  const large = tickets.filter((t) => t.value.size === 'L');
  if (large.length > caps.l) fail('graph-cap', `the epic has ${large.length} L tickets (${large.map(keyOf).join(', ')}); the cap is ${caps.l}`, `split L tickets into smaller vertical slices, or ${split}; never merge tickets to fit`);

  // ---- Each ticket: its ACs and its verify line ------------------------------------------------
  for (const t of tickets) {
    if (!t.ownAcs) fail('graph-ac', `${keyOf(t)} has no acceptance criterion`, `add AC-${keyOf(t)}.1 under "## Acceptance criteria" in ${t.path}: Given …, when …, then …`);
    if (typeof t.value.verify !== 'string' || t.value.verify.trim() === '') fail('graph-verify', `${keyOf(t)} has no verify line`, `add verify: "<one sentence: how a person or a test checks it works>" to ${t.path}`);
  }

  // ---- after: known tickets, no cycle ----------------------------------------------------------
  const edges = new Map(); // key → keys it waits for, inside the epic
  for (const t of tickets) {
    const deps = [];
    for (const a of list(t.value.after)) {
      const k = a.toLowerCase();
      if (same(a, t.value.id)) continue; // the ticket check reports it
      if (inEpic.has(k)) deps.push(keyOf(inEpic.get(k)));
      // Another epic's ticket: this one waits until it's done (stacking is the scheduler's, §6).
      else if (inFolder.has(k)) continue;
      else fail('graph-after', `${keyOf(t)}'s after names ${a}, which isn't a ticket in tickets/`, `correct the key in ${t.path}, or write the missing ticket`);
    }
    edges.set(keyOf(t), deps);
  }
  const cycles = findCycles(edges);
  for (const c of cycles) fail('graph-cycle', `a cycle in after: ${[...c, c[0]].join(' → ')}`, `remove the after entry that isn't a real prerequisite, so ${c[0]} can start`);
  // No depth check: stacking (at most 2 levels, inside one epic; design/01 §6) is a runtime limit
  // the scheduler keeps. A ticket deeper in an after chain waits until its parents are merged.

  // ---- Coverage: every PRD FR, NFR and AC; nothing the PRD doesn't define ----------------------
  if (items) {
    const defined = new Set(items.map((i) => i.id));
    for (const t of tickets) {
      for (const id of [...list(t.value.covers_fr), ...list(t.value.covers_ac)]) {
        if (!defined.has(id)) fail('graph-unknown-id', `${keyOf(t)} covers ${id}, which the PRD doesn't define`, `correct ${t.path}'s covers_fr or covers_ac to the PRD's IDs; work the PRD doesn't ask for goes back to the PRD first`);
      }
    }
    // On full, several epics share the PRD: an ID covered in any of them counts.
    const pool = track === 'full' ? all.filter((t) => typeof t.value.epic === 'string') : tickets;
    const covered = coverage(pool);
    for (const item of items) {
      if (covered.has(item.id)) continue;
      const what = item.kind === 'AC' ? `${item.id} (an AC of ${item.parent}, ${item.group})` : `${item.id} (${item.group})`;
      const field = item.kind === 'AC' ? 'covers_ac' : 'covers_fr';
      fail('graph-coverage', `${what} isn't covered by any ticket`, `add ${item.id} to the ${field} of the ticket that builds it, or add a ticket for it; never drop it to fit`);
    }
  }

  // ---- Warn: the same file in two tickets with no after between them --------------------------
  const reach = (from, to) => {
    const seen = new Set();
    const stack = [from];
    while (stack.length) {
      const k = stack.pop();
      if (k === to) return true;
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push(...(edges.get(k) ?? []));
    }
    return false;
  };
  for (let i = 0; i < tickets.length; i++) {
    for (let j = i + 1; j < tickets.length; j++) {
      const [a, b] = [tickets[i], tickets[j]];
      const shared = list(a.value.files_likely).filter((f) => list(b.value.files_likely).includes(f));
      if (shared.length && !reach(keyOf(a), keyOf(b)) && !reach(keyOf(b), keyOf(a))) {
        warn('graph-files', `${keyOf(a)} and ${keyOf(b)} both list ${shared[0]}${shared.length > 1 ? ` (and ${shared.length - 1} more)` : ''} in files_likely, with no after between them`, `if one must go first, add after: [${keyOf(a)}] to ${keyOf(b)}; else check the two changes can't clash`);
      }
    }
  }
  return out;
}

// Every cycle in a graph of key → [keys], once each, starting at its smallest key.
export function findCycles(edges) {
  const cycles = new Map();
  const state = new Map(); // 1: on the path, 2: done
  const path = [];
  const walk = (k) => {
    state.set(k, 1);
    path.push(k);
    for (const d of edges.get(k) ?? []) {
      if (state.get(d) === 1) {
        // Shown in build order (A → B: A comes first), as the Dependencies diagram draws it.
        const c = path.slice(path.indexOf(d)).reverse();
        const start = c.indexOf([...c].sort(byKey)[0]);
        const norm = [...c.slice(start), ...c.slice(0, start)];
        cycles.set(norm.join('\n'), norm);
      } else if (!state.has(d)) walk(d);
    }
    path.pop();
    state.set(k, 2);
  };
  for (const k of [...edges.keys()].sort(byKey)) if (!state.has(k)) walk(k);
  return [...cycles.values()];
}
