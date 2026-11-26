import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWrite, ensurePrivateDir } from '../store/files.js';
import { testNamesAdr } from './confirm.js';

// The tests that name an ADR, from a ticket's gate run (unit 61, Scope 4; 43's naming: a test
// whose name starts with the ADR's id, such as test_adr_0007_…). The gate writes them beside the
// ticket's records when it passes; trace reads them for the initiative's ADR Confirmations
// (`test: ADR-0007`). Only passed tests count.

const ADR_NAME = /(?:^|[^A-Za-z0-9])adr[ _-]?[0-9]{1,6}(?![0-9])/i;
export const adrTestsPath = (store, ticket) => join(store.dir, 'tickets', ticket, 'adr-tests.json');

export function recordAdrTests(store, ticket, commit, cases) {
  const tests = cases.filter((c) => c.outcome === 'pass' && ADR_NAME.test(String(c.name ?? ''))).map((c) => ({ name: String(c.name).slice(0, 300), level: c.level ?? null })).slice(0, 500);
  ensurePrivateDir(join(store.dir, 'tickets', ticket));
  atomicWrite(adrTestsPath(store, ticket), `${JSON.stringify({ schema: 1, ticket, commit, tests }, null, 2)}\n`);
  return tests;
}

// The passed ADR tests of these tickets: { shipped: the tickets with a record, names: [test names] }.
export function readAdrTests(store, tickets) {
  const shipped = [];
  const names = [];
  for (const t of tickets) {
    try {
      const r = JSON.parse(readFileSync(adrTestsPath(store, t), 'utf8'));
      shipped.push(t);
      for (const x of Array.isArray(r.tests) ? r.tests : []) if (typeof x?.name === 'string') names.push(x.name);
    } catch {
      // no gate run passed for it yet
    }
  }
  return { shipped, names };
}

export { testsFor } from './confirm.js';
