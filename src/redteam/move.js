import { join } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { globalConfigPath, readConfigFile } from '../config/load.js';
import { atomicWrite, ensurePrivateDir, readPrivateFile } from '../store/files.js';
import { snapshot, trustedRegistry } from '../trust/snapshot.js';
import { readBinaryFacts } from './binary.js';
import { binaryHash, resolveClaude } from './key.js';
import { isTicket, readPin } from './pin.js';
import { binaryCheck } from './static.js';
import { RESULT_FOLDER } from './store.js';
import { testedClaude } from './tested.js';

// MIRAI moves to a newer Claude Code at a ticket's start (unit 18h, Jet's decisions 2 and 3). A
// ticket with no pin starting while a newer Claude Code is installed than the one agents run:
// - S1/S2 (no model) find something new: no move; a person reads it, and a MIRAI update lists it;
// - clean, and you consented once (`[claude_code] move = "auto"` in ~/.config/mirai/config.toml):
//   the full red team on it, as `mirai redteam run` does. Green: it's kept (18g), and the ticket's
//   first launch pins it. Not green: the ticket pins the current one, and the next automatic try on
//   the same binary waits a day;
// - clean, no consent: no move, and you're told once how to give it.
// Meanwhile the gap is on record: from the first day it's named in every run, `mirai status` and
// doctor; after GAP_DAYS a ticket with no pin doesn't start until you act. A pinned one finishes.

export const GAP_DAYS = 7;
export const RETRY_MS = 24 * 3_600_000;
export const MOVE_FILE = 'claude-move.json';
const filePath = (store) => join(store.dir, RESULT_FOLDER, MOVE_FILE);

// Your consent, from your personal global file only: 'auto', 'off', or null (not set).
export function moveSetting(env) {
  try {
    const v = readConfigFile(globalConfigPath(env.HOME), { trust: 'personal', optional: true })?.value?.claude_code?.move;
    return v === 'auto' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

// The move's state in the store: { gap: { since, version, sha256, kind, why } | null, tries:
// { <sha256>: iso }, hinted }. MIRAI's own bookkeeping, out of agents' reach (the store); one that
// can't be read starts over, which only restarts the gap's clock from now.
export function readMove(store) {
  try {
    const v = JSON.parse(String(readPrivateFile(filePath(store), { optional: true, maxBytes: 64 * 1024 }) ?? 'null'));
    if (v && typeof v === 'object') return { gap: v.gap ?? null, tries: v.tries && typeof v.tries === 'object' ? v.tries : {}, hinted: v.hinted === true };
  } catch {
    // starts over
  }
  return { gap: null, tries: {}, hinted: false };
}
function writeMove(store, state) {
  ensurePrivateDir(join(store.dir, RESULT_FOLDER));
  atomicWrite(filePath(store), `${JSON.stringify(state, null, 2)}\n`);
}

// A green run kept `sha256` (yours or MIRAI's): what was waiting for it isn't any more.
export function clearGapFor(store, sha256) {
  const state = readMove(store);
  if (state.gap?.sha256 === sha256) writeMove(store, { ...state, gap: null });
}

// What's waiting, for a line: null when nothing is.
export function gapNote(store, { now = () => new Date() } = {}) {
  const { gap } = readMove(store);
  if (!gap) return null;
  const days = Math.floor((now().getTime() - Date.parse(gap.since)) / 86_400_000);
  const left = GAP_DAYS - days;
  return {
    ...gap,
    days,
    stopping: left <= 0,
    line: `Claude Code ${gap.version ?? 'newer'} is installed; agents still run the one tested before (${days} day(s)): ${gap.why}${left > 0 ? `; new tickets stop starting in ${left} day(s)` : '; new tickets don\'t start until it moves'}`,
  };
}

// The stop (decision 3): a ticket with no pin doesn't start once the gap is GAP_DAYS old.
export function checkGap(store, ticket, { now = () => new Date() } = {}) {
  if (readPin(store, ticket)) return;
  const g = gapNote(store, { now });
  if (g?.stopping) throw Object.assign(new MiraiError(`${ticket} doesn't start: ${g.line}`, EXIT.BLOCKED), { code: 'claude-gap', hint: g.next ?? 'mirai redteam run' });
}

// Whether version a (x.y.z) comes after b.
export function versionAfter(a, b) {
  const p = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

const cmd = 'mirai redteam run';

// At a ticket's start (`mirai plan`, and `mirai run` through it). Returns { moved, note } and
// tells `say` (a check line) as it goes. Never throws for a move that didn't happen: the ticket
// starts on the current one. `run`: runRedTeam, given by the caller (no import cycle).
export async function moveAtStart({ cwd, env, store, ticket, run, say = () => {}, facts = readBinaryFacts, now = () => new Date() }) {
  const tell = (name, state) => {
    try {
      say({ kind: 'check', name, state });
    } catch {
      // a display only
    }
  };
  if (!isTicket(store, ticket) || readPin(store, ticket)) return { moved: false, note: null };
  const kept = await testedClaude({ env, store });
  if (!kept) return { moved: false, note: null };
  let installed;
  let sha256;
  try {
    installed = resolveClaude(env);
    sha256 = await binaryHash(join(store.dir, RESULT_FOLDER), installed.real);
  } catch {
    return { moved: false, note: null };
  }
  const state = readMove(store);
  // Only ever forward: the same binary, or an older one installed (a downgrade), is no move.
  if (sha256 === kept.sha256 || !versionAfter(installed.version, kept.version)) {
    if (state.gap) writeMove(store, { ...state, gap: null });
    return { moved: false, note: null };
  }
  const gap = (kind, why, next) => {
    // The gap runs from the first newer one MIRAI couldn't move to, whichever is installed now.
    const since = state.gap?.since ?? now().toISOString();
    const g = { since, version: installed.version ?? null, sha256, kind, why, next };
    // Read again: a try may have been recorded since `state` was read.
    writeMove(store, { ...readMove(store), gap: g });
    return g;
  };
  // S1/S2 first: anything new waits for a person.
  let checks;
  try {
    checks = [].concat(binaryCheck(facts(installed.real), trustedRegistry(snapshot({ cwd, env })).adapters['claude-code'].strict.binary));
  } catch (err) {
    const g = gap('unread', `its settings and sandbox profile couldn't be read (${String(err.message).slice(0, 120)})`, 'mirai redteam status');
    return { moved: false, note: g.why };
  }
  const notOk = checks.filter((x) => x.state !== 'ok');
  if (notOk.length) {
    const g = gap('unread', `${notOk.map((x) => `${x.id}: ${x.note}`).join('; ')}`, 'mirai redteam status');
    tell(`Claude Code ${installed.version}: not moved, ${notOk.map((x) => x.id).join(' and ')} found something new for a person to read`, 'waiting');
    return { moved: false, note: g.why };
  }
  const setting = moveSetting(env);
  if (setting !== 'auto') {
    const g = gap('consent', `the red team hasn't run on it (MIRAI moves by itself with [claude_code] move = "auto" in ~/.config/mirai/config.toml; or run it yourself: ${cmd})`, cmd);
    if (!state.hinted && setting === null) {
      writeMove(store, { ...readMove(store), hinted: true });
      tell(`Claude Code ${installed.version} is installed; to move agents to it between tickets by themselves, set [claude_code] move = "auto" in ~/.config/mirai/config.toml (or run: ${cmd})`, 'note');
    }
    return { moved: false, note: g.why };
  }
  const last = Date.parse(state.tries[sha256] ?? '');
  if (Number.isFinite(last) && now().getTime() - last < RETRY_MS) {
    const g = gap('tried', `the red team on it wasn't green at ${state.tries[sha256]}; MIRAI tries again after a day (or run it yourself: ${cmd})`, cmd);
    return { moved: false, note: g.why };
  }
  const name = `Claude Code ${installed.version}: the red team, before ${ticket} starts (about 15 minutes)`;
  tell(name, 'running');
  let r;
  try {
    r = await run({ cwd, env, consent: true, onEvent: () => tell(name, 'running') });
  } catch (err) {
    // Another red team running (its lock) isn't a try: the next ticket's start tries again.
    const busy = /lock|running the red team/i.test(String(err.message));
    if (!busy) writeMove(store, { ...readMove(store), tries: { ...readMove(store).tries, [sha256]: now().toISOString() } });
    const g = gap('tried', `the red team on it couldn't run: ${String(err.message).slice(0, 160)}`, cmd);
    tell(name, `not run: ${String(err.message).slice(0, 160)}`);
    return { moved: false, note: g.why };
  }
  if (r?.kept?.ok) {
    writeMove(store, { ...readMove(store), gap: null });
    tell(`agents now run Claude Code ${r.kept.version}; ${ticket} pins it`, 'green');
    return { moved: true, note: null };
  }
  writeMove(store, { ...readMove(store), tries: { ...readMove(store).tries, [sha256]: now().toISOString() } });
  const what = r?.result?.state ?? 'not recorded';
  const cases = [...new Set((r?.result?.cases ?? []).filter((c) => c.outcome !== 'pass' && !c.informational).map((c) => c.id))].slice(0, 6);
  const g = gap('tried', `the red team on it was ${what}${cases.length ? ` (${cases.join(', ')})` : ''}; ${ticket} runs on the current one (mirai redteam show)`, 'mirai redteam show');
  tell(name, `${what}: ${ticket} stays on ${kept.version}`);
  return { moved: false, note: g.why };
}
