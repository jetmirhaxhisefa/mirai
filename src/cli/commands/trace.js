import { lstatSync } from 'node:fs';

import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { plain } from '../../status/text.js';
import { docsStoreFor } from '../../store/connectors/index.js';
import { openStore } from '../../store/home.js';
import { snapshot } from '../../trust/snapshot.js';
import { traceInitiative } from '../../trace/initiative.js';
import { ITEM, traceLines, traceTicketIn } from '../../trace/item.js';

// mirai trace <initiative|ticket> (unit 43, Scope 6): the chain, link by link, read-only, no model.
// - an initiative (a folder under the docs root, in either docs store): BR → FR, the PRD's FRs,
//   NFRs and ACs → tickets, each NFR → how it's verified;
// - a ticket: each AC → a passing test named with its ID in the gate's signed results (the newest
//   gate run of its branch's head), its journey's test when it's e2e, the plan's test list.
// Each link is printed: ok, or what's missing and where to fix it. A fail exits non-zero; a scope
// that doesn't apply (a lone ticket's interview folder, an investigation) says so and exits 0.

const isDir = (p) => {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
};

export default {
  name: 'trace',
  summary: 'Check the chain: an initiative\'s documents (BR → FR → AC → ticket), or a ticket\'s ACs to its passing tests',
  usage: 'mirai trace <initiative-or-ticket> [--json]',
  positionals: { min: 1, max: 1 },
  options: {
    json: { type: 'boolean', description: 'the result as JSON' },
  },
  run(args, io) {
    const [item] = args.positionals;
    if (!ITEM.test(item)) throw new UsageError(`${plain(item).slice(0, 70)} isn't an initiative's folder name or a ticket key`, 'mirai trace <initiative>, or mirai trace <ticket>');
    const store = openStore({ cwd: io.cwd, env: io.env });
    const trust = snapshot({ cwd: io.cwd, env: io.env });
    const { conn } = docsStoreFor({ cwd: io.cwd, env: io.env, store });
    const initiative = /^[a-z0-9][a-z0-9._-]{0,63}$/.test(item) && isDir(conn.dir(item));
    let t;
    try {
      t = initiative ? traceInitiative({ cwd: io.cwd, env: io.env, initiative: item, store, trust }) : traceTicketIn({ store, trust, ticket: item });
    } catch (err) {
      if (err.code === 'no-ticket') throw Object.assign(new UsageError(`nothing named "${plain(item).slice(0, 70)}": no initiative folder ${plain(conn.kind === 'repo' ? `${conn.docsRoot}/${item}` : item)}/, and ${err.message}`, 'an initiative is a folder under the docs root; a ticket is traced once it is merged into the integration branch'), { code: 'unknown-item' });
      throw err;
    }
    if (args.values.json) io.stdout.write(`${JSON.stringify(t, null, 2)}\n`);
    else for (const l of traceLines(t)) io.stdout.write(`${plain(l)}\n`);
    return t.result === 'fail' ? EXIT.FAILURE : EXIT.OK;
  },
};
