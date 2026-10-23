import { StatusError } from '../cli/errors.js';
import { DOCUMENT } from './machines.js';
import { shown } from './text.js';

// Document helpers (unit 04; D-07). Frontmatter holds a document's current state and the run
// log holds its history; they must agree. An approved version is frozen, and a change starts
// a new draft beside it, with its own history.

// Checks one version of a document. `history`: that version's moves in order,
// `[{ from, to, by? }]` (from the run log, unit 05). Throws a StatusError when the history isn't
// a chain of allowed moves from `draft` made by allowed movers, or when the frontmatter
// disagrees with where it ends.
export function checkDocumentState(frontmatterState, history, { item = 'document' } = {}) {
  const fail = (message) => {
    throw new StatusError(`${shown(item)}: ${message}`, { machine: 'document', item, code: 'mismatch' });
  };
  if (!Array.isArray(history)) fail('the history must be a list of moves');
  if (!DOCUMENT.states.includes(frontmatterState)) fail(`the frontmatter status ${shown(frontmatterState)} is not a document state`);
  let state = DOCUMENT.initial;
  history.forEach((step, i) => {
    const n = i + 1;
    if (step?.from !== state) fail(`history step ${n} starts from ${shown(step?.from)}, but the document was ${state}`);
    const rule = DOCUMENT.moves.find((m) => m.from === step.from && m.to === step.to);
    if (!rule) fail(`history step ${n} (${shown(step.from)} → ${shown(step.to)}) is not an allowed move`);
    if (step.by !== undefined && !rule.by.includes(step.by)) fail(`history step ${n} (${step.from} → ${step.to}) was made by ${shown(step.by)}, who may not make it`);
    state = step.to;
  });
  if (state !== frontmatterState) fail(`the frontmatter says ${frontmatterState}, but the history ends at ${state}`);
  return state;
}

// The file name of the next draft beside an approved document: prd.md, 2 → prd.v2.draft.md.
// The version must be higher than the one in the name, if any.
export function nextDraftName(path, version) {
  if (!Number.isInteger(version) || version < 2) throw new RangeError('a new draft starts at version 2');
  const m = /^(.*\/)?([^/]+?)(?:\.v(\d+)\.draft)?\.md$/.exec(path);
  if (!m || m[2] === '') throw new RangeError('documents are named <name>.md');
  if (m[3] !== undefined && version <= Number(m[3])) throw new RangeError(`version ${version} is not newer than v${m[3]}`);
  return `${m[1] ?? ''}${m[2]}.v${version}.draft.md`;
}
