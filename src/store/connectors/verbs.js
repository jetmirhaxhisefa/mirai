import { contentHash } from '../../sign/sign.js';
import { readJournal } from '../journal.js';
import { readUnder } from './common.js';
import { hostWords } from '../../ship/words.js';
import { docsStoreFor, openDocsStore } from './index.js';
import { docsPublish } from './publish.js';
import { documentRows, publishedState, storeStateOf } from './state.js';

// The verbs that read your approvals or reach the host (unit 38, Scope 2): query, status and
// publish, added to a store opened by index.js. Kept apart so the code the red team's cage covers
// (the lint, init, the reader test) never imports the approval and publish code.

export function withVerbs(conn, store) {
  const query = (initiative) => documentRows({ store, conn, initiative }).map(({ tickets: _t, track: _k, ...d }) => d);
  if (conn.kind === 'local') {
    return {
      ...conn,
      query,
      status: (initiative) => ({ synced_at: new Date().toISOString(), documents: query(initiative).map((d) => ({ path: d.rel, state: storeStateOf(d.state) })) }),
      // Nothing leaves this Mac: publish does nothing, and says so.
      publish: async (initiative) => ({ outcome: 'local', initiative, message: `the local store keeps ${initiative}'s documents on this Mac only: publish does nothing (no branch, no ${hostWords(null).long}), and teammates can't see them` }),
    };
  }
  if (conn.kind === 'repo') {
    return {
      ...conn,
      query,
      // Approved or not from the journal; in_docs_mr and merged from the docs merge request MIRAI
      // published. Read now, so never stale.
      status(initiative) {
        const { events } = readJournal(store);
        const documents = query(initiative).map((d) => {
          let hash = null;
          try {
            hash = contentHash(readUnder(conn.base, d.path));
          } catch {
            hash = null;
          }
          const p = d.state === 'approved' && hash ? publishedState(events, initiative, d.rel, hash) : null;
          return { path: d.rel, state: p?.state ?? storeStateOf(d.state) };
        });
        return { synced_at: new Date().toISOString(), documents };
      },
      // The docs merge request (`mirai docs publish`).
      publish: (initiative, ctx) => docsPublish({ ...ctx, initiative }),
    };
  }
  return conn;
}

export const openStoreWithVerbs = ({ store, config, check = true }) => withVerbs(openDocsStore({ store, config, check }), store);
export function storeWithVerbsFor({ cwd, env, store, check = true }) {
  const { conn, config } = docsStoreFor({ cwd, env, store, check });
  return { conn: withVerbs(conn, store), config };
}
