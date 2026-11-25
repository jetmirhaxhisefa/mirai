import { escapeInvisible } from '../../status/text.js';
import { trustedRegistry } from '../../trust/snapshot.js';
import { trustedOverlays } from '../../trust/overlays.js';
import { ITEM, traceItem } from '../../trace/item.js';

// trace(item) (unit 43, Scope 5; D-53): `mirai trace` as a broker tool, read-only, no model. For an
// initiative (a folder under the docs root): its documents' chain. For a ticket: each AC → a passing
// test named with its ID in the gate's signed results for its branch's head (none yet during a
// build: then the links say what the tests must be named), its journey's test when it's e2e, and
// the plan's test list. Kai sees what's missing before he hands over; Rex, before he passes. The
// rules come from the trust root (the integration branch's MIRAI); the results from MIRAI's store;
// nothing is written. An initiative is read from the repo: documents in MIRAI's local store are
// traced from your terminal (mirai trace <initiative>).

export const MAX_LINKS = 300;
const clean = (v) => (typeof v === 'string' ? escapeInvisible(v) : v);

export default Object.freeze({
  name: 'trace',
  description: 'Check MIRAI\'s trace chain for one item, read-only. For a ticket key: each acceptance criterion (AC-<ticket>.n) needs a passing test whose name starts with its ID and a colon ("AC-PROJ-12.2: …"), read from the gate\'s signed results; an e2e ticket also needs a test named with its journey ("J-1, AC-PROJ-12.1: …"); each row of the plan\'s test list must be such a test. For an initiative\'s folder name: every BR is cited by an FR, every PRD FR, NFR and AC is covered by a ticket, every NFR names how it is verified. Returns each link and what is missing, with where to fix it; changes nothing.',
  exclusive: false,
  contexts: Object.freeze(['headless', 'interactive']),
  enabled: (policy) => Boolean(policy.tools.trace),
  schema: () => ({
    type: 'object',
    properties: {
      item: { type: 'string', maxLength: 64, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', description: 'a ticket key (PROJ-12) or an initiative\'s folder name under the docs root' },
    },
    required: ['item'],
    additionalProperties: false,
  }),
  check(args) {
    if (typeof args.item !== 'string' || !ITEM.test(args.item)) return { refused: 'item must be a ticket key or an initiative\'s folder name' };
    return { args: { item: args.item } };
  },
  async run({ item }, ctx) {
    const { policy, trust } = ctx;
    if (!policy.store) return { body: { outcome: 'refused', code: 'no-store', message: 'this server has no MIRAI store to read the results from' }, isError: true };
    const store = { dir: policy.store.dir, repoId: policy.store.repo_id, checkout: policy.checkout, branch: trust.branch, gitEnv: { PATH: '/usr/bin:/bin', HOME: ctx.env?.HOME ?? policy.home } };
    let registry = trustedRegistry(trust);
    registry = trustedOverlays(trust, store, { registry }).registry;
    let t;
    try {
      t = traceItem({ store, trust, registry, item });
    } catch (err) {
      return { body: { outcome: 'refused', code: err.code ?? 'trace', message: ctx.clean(escapeInvisible(String(err.message).slice(0, 500))) }, isError: true };
    }
    const links = t.links.slice(0, MAX_LINKS).map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, clean(v)])));
    return {
      body: {
        outcome: t.result, scope: t.scope, item: t.item, trust_base: trust.baseSha ?? null,
        ...(t.why ? { why: clean(t.why) } : {}), ...(t.scope === 'ticket' ? { qa: t.qa, gate_run: Boolean(t.gate_run) } : {}),
        links, links_truncated: links.length < t.links.length,
        missing: t.missing.slice(0, MAX_LINKS).map((m) => ({ id: clean(m.id), what: clean(m.what), where: clean(m.where) })),
        notes: [...(t.notes ?? []), ...(t.note ? [t.note] : [])].map(clean),
      },
      isError: false,
    };
  },
});
