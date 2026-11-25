// A retired requirement (unit 43, Jet's answer to question 1, "A", 2026-11-25): an FR, NFR or AC
// that an approved version had and that is no longer wanted keeps its ID, written as
// `- FR-4: Retired — <why>`. Its place in the numbering stays filled, the ID stays reserved (the
// ID-stability lint refuses any later meaning for it), and no rule that asks something of a live
// requirement applies to it: its shape, its BR, its ACs, its testability, a ticket covering it.

export const RETIRED = /^Retired —[ \t]*\S/;
const DEFINITION = /^ *(?:[-*+]|[0-9]{1,9}[.)])[ \t]+(?:\*\*)?((?:AC-)?N?FR-[0-9]+(?:\.[0-9]+)?)(?:\*\*)?(?::|[ \t]+—[ \t])[ \t]*(.*)$/;

// Whether a definition's statement retires it.
export const isRetired = (statement) => RETIRED.test(String(statement ?? '').trim());

// The retired IDs a document defines: Set of IDs.
export function retiredIds(doc) {
  const out = new Set();
  for (const l of doc?.scan?.lines ?? []) {
    if (l.kind !== 'text') continue;
    const m = DEFINITION.exec(l.visible ?? l.text);
    if (m && isRetired(m[2])) out.add(m[1]);
  }
  return out;
}

export const RETIRED_HINT = 'an ID an approved version had is never reused: to drop it, keep its line as "<ID>: Retired — <why>"';
