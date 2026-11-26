// A ticket on the quick track (unit 45, Scope 6; U4): a lone ticket, one you asked for by hand
// (42's decision 2), approved at <docs root>/tickets/<KEY>.md with no epic. Its plan gate is `auto`
// for normal risk (design/02, "Gates by track"); a high-risk plan, protected paths, new
// dependencies or changed tests still need you (gateFor). Nothing signs an `auto` plan approval yet
// (unit 55's signer), so until then the plan still waits for you, and says why.
export function isQuickTicket(events, ticket, docsRoot) {
  const last = events.filter((e) => e.type === 'approval' && e.by === 'human' && e.kind === 'ticket' && e.item === ticket && e.decision !== 'rejected').at(-1);
  const path = last?.path;
  return typeof path === 'string' && path.startsWith(`${docsRoot}/tickets/`) && !path.slice(docsRoot.length + 9).includes('/');
}
