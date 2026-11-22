// An agent's name in full, "Kai (mirai-developer)", from a registry object (unit 38b). Pure: no
// file is read here, so cage code (src/agent/run.js) can use it with the trust root's registry
// without the whole registry folder joining the red team's cage. src/agent/names.js builds the
// command's namer on top of it.

// The persona of an agent id in `registry`, or null (none, or a framework copy from before 38b).
export function personaIn(registry, id) {
  const agents = registry?.agents ?? {};
  return typeof id === 'string' && Object.hasOwn(agents, id) ? agents[id].persona ?? null : null;
}

// "Kai (mirai-developer)", or ``Kai (`mirai-developer`)`` in Markdown; the id alone without a persona.
export function fullNameIn(registry, id, { markdown = false } = {}) {
  const persona = personaIn(registry, id);
  if (persona === null) return markdown ? `\`${id}\`` : String(id);
  return markdown ? `${persona} (\`${id}\`)` : `${persona} (${id})`;
}
