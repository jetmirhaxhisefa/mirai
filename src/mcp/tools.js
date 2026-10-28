import logEvent from './tools/log-event.js';
import { runCheck, runTests } from './tools/tests.js';

// MIRAI's MCP tools as data (unit 15a; D-53): the server knows the protocol, the stop rule,
// cancelling and progress; each tool is one entry here. Later units (15b, 19, 43) add entries.
//
// An entry: { name, description, exclusive, contexts, enabled(policy), schema(policy),
// check(args, policy), run(args, ctx) }.
// - `contexts`: the kinds of server that may offer it (`headless` for an agent run; 15b adds
//   your own session's). A policy offering a tool outside its kind is refused at start;
// - `enabled`: whether this launch's policy offers it; a tool not enabled is unknown;
// - `schema`: the input schema tools/list shows, with the policy's names as enums;
// - `check`: the checked arguments `{ args }`, or `{ refused }`. The shared check (an object, no
//   key the schema doesn't name) has run first;
// - `run`: the result, `{ body, isError }`. `ctx` has the policy, the server's environment, the
//   stop rule, the token (for secret checks) and, for an `exclusive` tool, the call's signal and
//   progress note. State a tool keeps across calls belongs in the launch folder, not the process
//   (a restarted server must not start again from nothing);
// - `exclusive`: takes the server's one-call-at-a-time slot (the test tools); the others are
//   answered while it's held.
export const TOOLS = Object.freeze([runTests, runCheck, logEvent]);

export const toolNamed = (policy, name) => TOOLS.find((t) => t.name === name && t.enabled(policy)) ?? null;

// The tools this launch offers, as tools/list shows them.
export function toolList(policy) {
  return TOOLS.filter((t) => t.enabled(policy)).map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema(policy) }));
}

// The shared check, then the tool's own: `{ args }` or `{ refused }`.
export function checkArgs(policy, tool, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return { refused: 'the arguments must be an object' };
  const allowed = Object.keys(tool.schema(policy).properties);
  // Own keys only, `__proto__` included (JSON.parse makes it an own key).
  const extra = Object.keys(args).filter((k) => !allowed.includes(k));
  if (extra.length) return { refused: `${tool.name} takes no ${extra.join(', ')}` };
  return tool.check(args, policy);
}
