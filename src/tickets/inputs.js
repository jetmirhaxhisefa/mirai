import { documentApproval } from '../documents/approval.js';
import { readApprovedFile } from '../cli/human-move.js';
import { readFrontmatter } from '../lint/frontmatter.js';
import { adrSettings, adrState, listAdrs, signedCopyOf, workTreeReader } from '../adr/adr.js';
import { readJournal } from '../store/journal.js';

// The documents a track needs approved before the ticket planner cuts (unit 45, decision 2; Jet,
// 2026-11-24): data, not code, so a document type plugs in when its unit lands.
// - `quick`: none (one ticket by hand, 42's decision 2);
// - `standard`: the PRD and the technical note (62b);
// - `full`: the PRD, the HLD (62), the ADRs (61) and the LLD (63).
// A project's `[tickets.inputs]` may only add types. A type MIRAI doesn't have yet is skipped with a
// warning that names its unit; one it has must be approved as it is now.
export const DEFAULT_INPUTS = Object.freeze({
  quick: Object.freeze([]),
  standard: Object.freeze(['prd', 'tech-note']),
  full: Object.freeze(['prd', 'hld', 'adr', 'lld']),
});

// The unit that brings each type not built yet, for the warning.
export const UNIT_OF = Object.freeze({ 'tech-note': '62b', hld: '62', adr: '61', lld: '63' });
// Unit 62b (decision 5, Scope 5): a type needed only from a later unit on. Until that unit is
// built, a missing document is a warning, and an approved one is still the planner's input. The
// technical note is required once the architect (64) writes it.
export const REQUIRED_FROM = Object.freeze({ 'tech-note': '64' });
// The units of REQUIRED_FROM that are built: 64 adds itself here.
export const UNITS_BUILT = Object.freeze(['64']);
const WORDS = Object.freeze({ prd: 'PRD', 'tech-note': 'technical note', hld: 'HLD', adr: 'ADR', lld: 'LLD' });
export const wordsOf = (type) => WORDS[type] ?? type;

// The track's list: MIRAI's defaults, then the project's additions, each once.
export function inputsOf(config, track) {
  const base = DEFAULT_INPUTS[track] ?? DEFAULT_INPUTS.standard;
  const added = config?.tickets?.inputs?.[track] ?? [];
  return [...new Set([...base, ...added])];
}

// Each input's state for the initiative: [{ type, state, … }] where state is
//   `approved` (as it is now), `unapproved` (with `id`, `shown`, `stale`), `absent` (the type exists,
//   the document doesn't: `shown` its path), or `no-type` (MIRAI hasn't the type yet: `unit`).
// `readDoc(type)` returns { value, bytes, shown } or null; it's given so this works for either store.
export function inputStates({ store, registry, config, track, readDoc, initiative = null, built = UNITS_BUILT }) {
  return inputsOf(config, track).map((type) => {
    if (!registry.documentTypes[type]) return { type, state: 'no-type', unit: UNIT_OF[type] ?? null };
    // Unit 61 (45's re-check): ADRs are many files in the ADR folder, not one beside the PRD.
    if (type === 'adr') return adrInputState({ store, config, initiative });
    // Unit 63 (Scope 5): the LLD is needed only when the HLD says `lld: required`.
    if (type === 'lld') {
      let h = null;
      try {
        h = readDoc('hld');
      } catch {
        h = null;
      }
      if (h?.value?.lld !== 'required') {
        let d = null;
        try {
          d = readDoc('lld');
        } catch {
          d = null;
        }
        const id = typeof d?.value?.id === 'string' ? d.value.id : null;
        if (id && documentApproval(store, id, d.bytes).approved) return { type, state: 'approved', id, shown: d.shown };
        return { type, state: 'not-needed', because: h ? `the HLD says lld: ${h.value?.lld ?? 'unset'}` : 'no HLD yet' };
      }
    }
    let d = null;
    try {
      d = readDoc(type);
    } catch {
      d = null;
    }
    if (!d) return REQUIRED_FROM[type] && !built.includes(REQUIRED_FROM[type]) ? { type, state: 'optional', from: REQUIRED_FROM[type] } : { type, state: 'absent' };
    const id = typeof d.value?.id === 'string' ? d.value.id : null;
    const a = id ? documentApproval(store, id, d.bytes) : { approved: false, stale: false };
    return a.approved ? { type, state: 'approved', id, shown: d.shown } : { type, state: 'unapproved', id, shown: d.shown, stale: a.stale };
  });
}

// What still blocks the planner ([] when nothing does), and the warnings for types not built yet.
export const missingOf = (states) => states.filter((s) => s.state === 'unapproved' || s.state === 'absent');
export const notBuiltOf = (states) => states.filter((s) => s.state === 'no-type');
export const notBuiltLine = (states) => {
  const n = notBuiltOf(states);
  const o = states.filter((s) => s.state === 'optional');
  const parts = [
    ...(n.length ? [`not built yet, so not needed: ${n.map((s) => `no ${wordsOf(s.type)} yet${s.unit ? ` (unit ${s.unit})` : ''}`).join(', ')}`] : []),
    ...o.map((s) => `no ${wordsOf(s.type)} yet: not required until unit ${s.from}; with one approved, the tickets follow it`),
    ...states.filter((s) => s.state === 'not-needed' && s.because !== 'no HLD yet').map((s) => `no ${wordsOf(s.type)} needed: ${s.because}`),
  ];
  return parts.length ? parts.join('; ') : null;
};
export const missingLine = (s) => (s.state === 'absent'
  ? `the ${wordsOf(s.type)} isn't written yet`
  : `the ${wordsOf(s.type)} ${s.id ?? s.shown} isn't approved${s.stale ? ' as it is now' : ''} (mirai approve ${s.id ?? '<id>'} --file ${s.shown})`);

// A document of the initiative read for the check above, through the docs store (`conn`).
export function readInput(conn, initiative, type) {
  let abs;
  try {
    abs = conn.pathOf(type, initiative, type === 'prd' ? undefined : `${type}.md`);
  } catch {
    return null;
  }
  let read;
  try {
    read = readApprovedFile(conn.base, conn.base, abs);
  } catch {
    return null;
  }
  let value = {};
  try {
    value = readFrontmatter(read.bytes)?.value ?? {};
  } catch {
    value = {};
  }
  return { value, bytes: read.bytes, shown: conn.kind === 'repo' ? conn.relOf(abs) ?? abs : abs };
}

// The initiative's ADRs as an input (unit 61): approved when each one you decided (accepted or
// rejected, by your signed line, as it is now or by a typo fix) and none is still proposed; an
// initiative with no ADR needs none. Unapproved names the first one left, with its file.
export function adrInputState({ store, config, initiative }) {
  if (!initiative || !store) return { type: 'adr', state: 'approved', id: null, shown: null, none: true };
  const s = adrSettings(config);
  const own = listAdrs(workTreeReader(store.checkout), s).filter((a) => a.mirai && a.initiative === initiative);
  if (!own.length) return { type: 'adr', state: 'approved', id: null, shown: null, none: true };
  const { events } = readJournal(store);
  const copies = signedCopyOf(store);
  for (const a of own) {
    const st = adrState({ events, path: a.path, bytes: a.bytes, approvedTextOf: copies });
    if (st.state === 'unsigned' || st.state === 'changed' || a.status === 'proposed') return { type: 'adr', state: 'unapproved', id: a.id, shown: a.path, stale: st.state === 'changed' };
  }
  return { type: 'adr', state: 'approved', id: own.map((a) => a.id).join(', '), shown: s.folder };
}
