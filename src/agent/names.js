import { fileURLToPath } from 'node:url';

import { loadRegistry } from '../config/registry.js';
import { fullNameIn, personaIn } from './persona.js';

// How MIRAI's output names an agent (unit 38b; Jet's decision 2, 2026-11-22): "persona (id)" the
// first time a command's output names it, then the persona: "Rex (mirai-reviewer) reviewed
// SAMPLE-53 … Rex found 2 must-fix findings". The persona is data (`persona` in
// registry/agents/*.toml), read from MIRAI's own registry: an overlay can't change it. An agent
// with no persona is shown by its id. In Markdown (the run report, an MR description) the id is
// in backticks: Kai (`mirai-developer`).

const OWN_DIR = fileURLToPath(new URL('../../registry/', import.meta.url));
let own = null;
const ownRegistry = () => {
  own ??= loadRegistry(OWN_DIR);
  return own;
};

// The persona of an agent id, or null.
export const personaOf = (id, registry = null) => personaIn(registry ?? ownRegistry(), id);

// The full form, for text read alone (an error, a park reason, a command's help summary).
export const fullName = (id, { registry = null, markdown = false } = {}) => fullNameIn(registry ?? ownRegistry(), id, { markdown });

// One namer per command run: `who(id)` gives the full form the first time, then the persona.
// Passed down with a step's launch options (`who`), so `mirai run` introduces Kai once and Rex once.
export function agentNamer(registry = null, { markdown = false } = {}) {
  const seen = new Set();
  return (id) => {
    const persona = personaOf(id, registry);
    if (persona === null) return markdown ? `\`${id}\`` : String(id);
    if (seen.has(id)) return persona;
    seen.add(id);
    return fullName(id, { registry, markdown });
  };
}
