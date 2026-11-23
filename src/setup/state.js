import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { atomicWrite, readPrivateFile } from '../store/files.js';

// Setup's state (unit 39, Scope 2): `<store>/setup.json`, outside the repo. Each stage's state
// (`not started`, `in progress`, `done` with its commit), each ledger item's decision, and the
// context files you chose to review later. `/mirai setup` resumes from it; `mirai setup status`
// prints it.

export const SETUP_FILE = 'setup.json';
export const STAGES = Object.freeze(['scan', 'migrate', 'context', 'connect', 'finish']);
export const STAGE_TITLES = Object.freeze({ scan: 'scan: the ledger of every AI item', migrate: 'migrate: each item kept in .mirai/custom/ or dropped', context: 'context: the five context files, reviewed', connect: 'connect: the host, the store and CI', finish: 'finish: the hand checklist, doctor green' });
export const DECISIONS = Object.freeze(['keep', 'drop']);
const SCHEMA_VERSION = 1;

export const emptySetup = () => ({ schema_version: SCHEMA_VERSION, stages: Object.fromEntries(STAGES.map((s) => [s, { state: 'not started' }])), items: {}, deferred: [] });

const pathOf = (store) => join(store.dir, SETUP_FILE);

export function readSetup(store) {
  const text = readPrivateFile(pathOf(store), { maxBytes: 4 * 1024 * 1024, optional: true });
  if (text === null) return emptySetup();
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    v = null;
  }
  const ok = v && v.schema_version === SCHEMA_VERSION && v.stages && typeof v.stages === 'object' && STAGES.every((s) => typeof v.stages[s]?.state === 'string')
    && v.items && typeof v.items === 'object' && !Array.isArray(v.items) && Array.isArray(v.deferred);
  if (!ok) throw new StoreError(`${pathOf(store)} isn't a setup state MIRAI reads`, { path: pathOf(store), code: 'setup-state', hint: `move it away to start setup's record again: mv '${pathOf(store)}' '${pathOf(store)}.old'` });
  return v;
}

export function writeSetup(store, state) {
  atomicWrite(pathOf(store), `${JSON.stringify(state, null, 2)}\n`);
}

// The first stage not done, or null when every one is.
export const nextStage = (state) => STAGES.find((s) => state.stages[s].state !== 'done') ?? null;

export function markStage(state, stage, value) {
  state.stages[stage] = { ...value };
  return state;
}
