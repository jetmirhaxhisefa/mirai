import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { parseJsonStrict } from '../findings/schema.js';
import { signObject, verifySigned } from '../sign/sign.js';
import { branchKeys } from '../sign/keys.js';
import { deriveTicketState } from '../status/derive.js';
import { TICKET_ID } from '../status/ticket-file.js';
import { atomicWrite, readPrivateFile } from '../store/files.js';
import { readJournal, ticketFacts } from '../store/journal.js';
import { readTicketStatus } from '../store/tickets.js';
import { miraiHome } from '../store/mirai-home.js';
import { binaryHash } from './key.js';
import { RESULT_FOLDER } from './store.js';
import { testedRoot } from './tested.js';

// One Claude Code per ticket (unit 18h, Jet's decision 1): a ticket's first agent launch records the
// binary it ran in `tickets/<ticket>/claude-code.json` in the store, signed with MIRAI's record key
// (the machine key), and every later launch for that ticket runs that same kept copy: plan, re-plan,
// build, fix rounds, review. The kept copy and its last green red-team result stay while the pin
// does; the pin goes once the ticket is done or dropped. MIRAI moves to a newer Claude Code between
// tickets, never under one (src/redteam/move.js).

export const PIN_FILE = 'claude-code.json';
const SHA = /^[0-9a-f]{64}$/;
const context = (repoId) => `mirai/ticket-claude/1:${repoId}`;
const pinPath = (store, ticket) => {
  if (!TICKET_ID.test(ticket ?? '')) throw new TypeError('not a ticket key');
  return join(store.dir, 'tickets', ticket, PIN_FILE);
};

// Whether `item` is a ticket in this store (a launch's item can be a run's own, such as `run`).
export const isTicket = (store, item) => {
  try {
    return typeof item === 'string' && TICKET_ID.test(item) && readTicketStatus(store, item) !== null;
  } catch {
    return false;
  }
};

// The ticket's pin: { version, sha256, path, pinned_at }, or null. One that's there but doesn't
// verify throws: never read as "no pin", which would move the ticket to another binary.
export function readPin(store, ticket, { keys = null } = {}) {
  const text = readPrivateFile(pinPath(store, ticket), { optional: true, maxBytes: 64 * 1024 });
  if (text === null) return null;
  const bad = (why) => new StoreError(`${ticket}'s record of its Claude Code ${why}`, { code: 'ticket-claude-invalid', hint: `look at it; if you know why, remove ${pinPath(store, ticket)} yourself and the ticket's next launch pins the current one` });
  let value;
  try {
    value = parseJsonStrict(String(text));
  } catch {
    throw bad('can\'t be read');
  }
  const check = verifySigned(value, keys ?? branchKeys(store.checkout, store.branch, store.gitEnv), { context: context(store.repoId) });
  if (!check.ok || value.ticket !== ticket || !SHA.test(value.sha256 ?? '') || typeof value.path !== 'string') throw bad(`doesn't verify${check.ok ? '' : `: ${check.reason}`}`);
  return value;
}

// Pins `claude` ({ version, sha256, path }, the kept copy the launch runs) to the ticket.
export function writePin(store, ticket, claude, signer, { now = () => new Date() } = {}) {
  if (!SHA.test(claude?.sha256 ?? '')) throw new StoreError('not a kept Claude Code', { code: 'bad-hash' });
  const signed = signObject({ schema_version: 1, ticket, version: claude.version ?? null, sha256: claude.sha256, path: claude.path, pinned_at: now().toISOString() }, signer, { context: context(store.repoId), now });
  atomicWrite(pinPath(store, ticket), `${JSON.stringify(signed, null, 2)}\n`);
  return signed;
}

// The pinned copy, checked as 18g checks the kept one: there, and unchanged. Never a silent fall
// back to another binary.
export async function pinnedClaude({ env, store, pin }) {
  const gone = () => new StoreError(`the Claude Code ${pin.version ?? pin.sha256.slice(0, 12)} pinned to ${pin.ticket} isn't where MIRAI kept it, or changed`, { code: 'ticket-claude-changed', hint: `the ticket can't finish on its own version; drop it (mirai drop ${pin.ticket}) or, if you accept a move, remove ${pinPath(store, pin.ticket)} yourself` });
  if (pin.path !== join(testedRoot(env), pin.sha256, 'claude') || !existsSync(pin.path)) throw gone();
  let now;
  try {
    now = await binaryHash(join(store.dir, RESULT_FOLDER), pin.path);
  } catch {
    throw gone();
  }
  if (now !== pin.sha256) throw gone();
  return { path: pin.path, real: pin.path, version: pin.version, sha256: pin.sha256 };
}

const FINAL = new Set(['done', 'dropped']);

// Removes the pins of tickets that are done or dropped (Jet's decision 1: kept while pinned).
// Returns the tickets released. A ticket whose state can't be read keeps its pin.
export function releaseFinished(store, { keys = null } = {}) {
  let names = [];
  try {
    names = readdirSync(join(store.dir, 'tickets'));
  } catch {
    return [];
  }
  const pinned = names.filter((t) => TICKET_ID.test(t) && existsSync(join(store.dir, 'tickets', t, PIN_FILE)));
  if (!pinned.length) return [];
  let events;
  try {
    ({ events } = readJournal(store, { keys: keys ?? branchKeys(store.checkout, store.branch, store.gitEnv) }));
  } catch {
    return [];
  }
  const released = [];
  for (const t of pinned) {
    try {
      const status = readTicketStatus(store, t, { events })?.status ?? null;
      if (!FINAL.has(deriveTicketState(status, ticketFacts(events, t)).state)) continue;
      rmSync(join(store.dir, 'tickets', t, PIN_FILE), { force: true });
      released.push(t);
    } catch {
      // kept
    }
  }
  return released;
}

// The binaries some ticket pins, in one store (unverified: a forged pin can only keep more).
export function pinnedIn(storeDir) {
  const out = new Set();
  let names = [];
  try {
    names = readdirSync(join(storeDir, 'tickets'));
  } catch {
    return out;
  }
  for (const t of names) {
    try {
      const v = JSON.parse(readFileSync(join(storeDir, 'tickets', t, PIN_FILE), 'utf8'));
      if (SHA.test(v?.sha256 ?? '')) out.add(v.sha256);
    } catch {
      // no pin
    }
  }
  return out;
}

// Every store under MIRAI's home: the binaries pinned anywhere (pruneTested keeps their copies).
export function pinnedEverywhere(env) {
  const out = new Set();
  let repos = [];
  try {
    repos = readdirSync(miraiHome(env), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return out;
  }
  for (const r of repos) for (const s of pinnedIn(join(miraiHome(env), r, 'store'))) out.add(s);
  return out;
}

// The Claude Code a launch runs (18g's kept copy, or 18h's pin): { claude, pin, toPin }.
// - `item` a ticket with a pin: its pinned copy, checked;
// - a ticket with none: the kept copy, and `toPin` (the launch pins it once its checks pass);
// - anything else, or no kept copy yet: the kept copy or null (your PATH's), as 18g does.
export async function claudeForLaunch({ env, store, item = null, tested: getTested }) {
  if (item !== null && isTicket(store, item)) {
    const pin = readPin(store, item);
    if (pin) return { claude: await pinnedClaude({ env, store, pin }), pin, toPin: null };
    const kept = await getTested({ env, store });
    return { claude: kept, pin: null, toPin: kept ? item : null };
  }
  return { claude: await getTested({ env, store }), pin: null, toPin: null };
}
