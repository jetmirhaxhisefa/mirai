// The project's ticket types (unit 42; Jet's decisions 6 and 7, 2026-11-21). Each type has a name
// and a description of what it's for, which the ticket planner reads to choose a ticket's type,
// and runs as one of MIRAI's behaviours: `change` (code and tests), `bug` (a test that reproduces
// it first) or `investigation` (research and a written finding, no code merge). A type can't
// invent a new way to run, so the safety model stays the same. Optional: its own template (a
// ticket type overlay, .mirai/custom/ticket-types/<template>.toml + .md, approved as an overlay),
// its own checklist lines, and the tracker's issue type (38).
//
// `[[tickets.types]]` in .mirai/config.toml (project layer). With none, the defaults below.

export const RUNS_AS = Object.freeze(['change', 'bug', 'investigation']);
// The document type each behaviour is written as.
export const DOC_OF_RUNS_AS = Object.freeze({ change: 'story', bug: 'bug', investigation: 'investigation' });
export const TICKET_DOC_TYPES = Object.freeze(['story', 'bug', 'investigation']);

export const DEFAULT_TICKET_TYPES = Object.freeze([
  Object.freeze({ name: 'Story', description: 'A slice of user-facing or system behaviour to build: code and its tests.', runs_as: 'change', tracker_type: 'Story' }),
  Object.freeze({ name: 'Bug', description: 'Something that works wrongly today: reproduce it with a failing test, then fix it.', runs_as: 'bug', tracker_type: 'Bug' }),
  Object.freeze({ name: 'Investigation', description: 'A question to answer before building: research and a written finding, no code merge.', runs_as: 'investigation', tracker_type: 'Task' }),
]);

// The project's types: from a checked config's `tickets.types`, or a lint project (projectOf), or
// the defaults.
export function ticketTypesOf(source) {
  const list = source?.tickets?.types ?? source?.ticketTypes ?? null;
  return Array.isArray(list) && list.length ? list : DEFAULT_TICKET_TYPES;
}

// The type a ticket names (case-insensitive), or null.
export function ticketTypeNamed(source, name) {
  if (typeof name !== 'string') return null;
  return ticketTypesOf(source).find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? null;
}

// The config check (unit 42, Scope 6): each type has a description and a known runs_as, and no two
// share a name. `report(path, reason, hint, code)`.
export function checkTicketTypes(types, path, report) {
  const seen = new Map();
  types.forEach((t, i) => {
    const at = `${path}[${i}]`;
    if (typeof t?.description !== 'string' || t.description.trim() === '') report(`${at}.description`, `${at} (${t?.name ?? 'no name'}) has no description: the ticket planner reads it to choose a ticket's type`, 'say what the type is for, and when to use it', 'required');
    if (t?.runs_as !== undefined && !RUNS_AS.includes(t.runs_as)) report(`${at}.runs_as`, `${at} (${t?.name ?? 'no name'}) runs as "${t.runs_as}", which isn't one of MIRAI's behaviours`, `use one of: ${RUNS_AS.join(', ')}; a new behaviour is a MIRAI change, never a project setting`, 'enum');
    const key = typeof t?.name === 'string' ? t.name.toLowerCase() : null;
    if (key !== null && seen.has(key)) report(`${at}.name`, `${at} and ${path}[${seen.get(key)}] are both named "${t.name}"`, 'give each type its own name', 'duplicate');
    if (key !== null && !seen.has(key)) seen.set(key, i);
  });
}

// Unit 42 (Scope 6): an investigation ticket (its document type, or a ticket type that runs as
// one) isn't started until its run is built (unit 42b): { message, hint }, or null.
export function investigationRefusal(fm, ticket, source = null) {
  const t = ticketTypeNamed(source, fm?.ticket_type);
  if (fm?.type !== 'investigation' && t?.runs_as !== 'investigation') return null;
  return {
    message: `${ticket} is an investigation${typeof fm?.ticket_type === 'string' ? ` (${fm.ticket_type})` : ''}: research and a written finding, with no code merge; its run (unit 42b) isn't built yet, so MIRAI doesn't start one`,
    hint: 'answer its question by hand for now, and record the finding in the ticket',
  };
}

// The definition a ticket is linted with (unit 42, Scope 6): its type's own template when the
// project has one approved (registry.ticketTemplates, by the type's `template`), on the same
// MIRAI type; else MIRAI's (or 37's overlaid) definition. An unapproved template isn't in the
// registry, so it isn't used.
export function ticketDefOf(registry, source, def, value) {
  if (!def || !TICKET_DOC_TYPES.includes(def.name)) return def;
  const t = ticketTypeNamed(source, value?.ticket_type);
  const own = t?.template ? registry?.ticketTemplates?.[t.template] : null;
  return own && own.name === def.name ? own : def;
}
