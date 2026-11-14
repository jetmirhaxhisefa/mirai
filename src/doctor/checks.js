import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { readBaseline } from '../baseline/store.js';
import { readHooksRecord, hooksState } from '../hooks/install.js';
import { checkLock } from '../install/lock.js';
import { MODES } from '../launch/strict.js';
import { usageCaps, usageCheck } from '../loop/ledger.js';
import { status as sessionStatus } from '../mcp/session.js';
import { redTeamStatus } from '../redteam/run.js';
import { readTested } from '../redteam/tested.js';
import { TOOLS_FILE } from '../ship/host.js';
import { branchKeys, loadSigningKey, readCommittedKeys, integrationRef } from '../sign/keys.js';
import { RENEW_AFTER_DAYS, readToken, tokenSetAt } from '../sign/token.js';
import { readRegistry } from '../store/branches.js';
import { blobAt, commitOf } from '../store/git.js';
import { runLockHolder, globalPaths } from '../store/global.js';
import { checkPrivateDir, lockHolder } from '../store/files.js';
import { openStore } from '../store/home.js';
import { checkCounter, readJournal } from '../store/journal.js';
import { miraiHome } from '../store/mirai-home.js';
import { readRunLog, runIds } from '../store/run-log.js';
import { readRunState, runStateMatchesLog } from '../store/run.js';
import { verifyBranchRecord } from '../store/branch-record.js';
import { openTrustRoot, trustedStrict } from '../trust/snapshot.js';

// `mirai doctor`'s checks (unit 29c, Jet's decisions 1–2): each item ok, yellow (works, worth
// knowing) or red (something will fail), with a fix hint for every yellow and red one. `fix`
// names the `--fix` repair that clears it. A check that throws is red with its error's own hint,
// never skipped: an item that can't be checked says so.

export const STATES = Object.freeze(['ok', 'yellow', 'red']);
const ok = (detail) => ({ state: 'ok', detail });
const yellow = (detail, hint) => ({ state: 'yellow', detail, hint });
const red = (detail, hint, fix) => ({ state: 'red', detail, hint, ...(fix ? { fix } : {}) });
const DAY = 86_400_000;

// The CPU a Mach-O file is for (unit 29c: the agents' kept binary), from its header: 'arm64',
// 'x64', 'universal' (a fat file carries several), or null when it isn't one.
export function machoCpu(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const b = Buffer.alloc(8);
    if (readSync(fd, b, 0, 8, 0) < 8) return null;
    const magic = b.subarray(0, 4).toString('hex');
    if (magic === 'cafebabe' || magic === 'bebafeca') return 'universal';
    const le = magic === 'cffaedfe';
    if (!le && magic !== 'feedfacf') return null;
    const cpu = le ? b.readUInt32LE(4) : b.readUInt32BE(4);
    return cpu === 0x0100000c ? 'arm64' : cpu === 0x01000007 ? 'x64' : `cpu 0x${cpu.toString(16)}`;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const runnable = (p) => {
  try {
    const s = statSync(p);
    return s.isFile() && (s.mode & 0o111) !== 0;
  } catch {
    return false;
  }
};

// The lock files MIRAI keeps (and their breakers): [{ path, holder }] with each holder's state.
export function lockFiles(store, env) {
  const dirs = [store.dir, join(store.dir, 'locks'), join(store.dir, 'baseline'), globalPaths(env).dir, join(globalPaths(env).dir, 'locks'), miraiHome(env), join(store.repoHome, 'session', 'state')];
  const out = [];
  for (const dir of dirs) {
    let names;
    try {
      if (!checkPrivateDir(dir)) continue;
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!/\.lock(\.break)?$/.test(n) || n === 'mirai.lock') continue;
      const path = join(dir, n);
      let holder;
      try {
        holder = lockHolder(path);
      } catch {
        holder = { unreadable: true, alive: false };
      }
      if (holder) out.push({ path, holder });
    }
  }
  return out;
}

// The branch registry as the journal and the signed branch records say it should be (unit 29c's
// rebuild): each branch registered and not cleared since, its base from its record, verified with
// the integration branch's keys. { entries, skipped: [{ branch, why }] }.
// `current`: the registry's own entries when it's readable: an entry whose record can't be read
// here (its commit isn't in this clone) is kept from it, never dropped (it may be another clone's
// discarded build), and listed as `unchecked`.
export function registryFromRecords(store, { events, keys, current = null }) {
  const active = new Map();
  for (const e of events) {
    if (e.type === 'branch_registered') active.set(`${e.branch}\0${e.creation_sha}`, e);
    if (e.type === 'branch_cleared') active.delete(`${e.branch}\0${e.creation_sha}`);
  }
  const entries = [];
  const skipped = [];
  const unchecked = [];
  for (const e of active.values()) {
    const here = commitOf(store.checkout, e.creation_sha, store.gitEnv);
    if (!here) {
      const kept = current?.find((c) => c.branch === e.branch && c.creation_sha === e.creation_sha);
      if (kept) {
        entries.push({ ...kept });
        unchecked.push({ branch: e.branch, why: 'its record\'s commit isn\'t in this clone' });
      } else skipped.push({ branch: e.branch, why: 'its record\'s commit isn\'t in this clone, and the registry has no entry to keep' });
      continue;
    }
    const bytes = blobAt(store.checkout, e.creation_sha, `.mirai/records/${e.ticket}/branch.json`, store.gitEnv, { maxBytes: 64 * 1024 });
    const v = bytes ? verifyBranchRecord(bytes, { branch: e.branch, keys, repoId: store.repoId }) : { ok: false, reason: 'its commit has no branch record' };
    if (!v.ok || v.record.ticket !== e.ticket) {
      skipped.push({ branch: e.branch, why: v.ok ? 'its record is for another ticket' : v.reason });
      continue;
    }
    entries.push({ branch: e.branch, creation_sha: e.creation_sha, ticket: e.ticket, base_sha: v.record.base_sha, seq: e.seq });
  }
  entries.sort((a, b) => a.seq - b.seq);
  return { entries, skipped, unchecked };
}

// The run state as the newest run log says it should be, or null when there's no run log.
export function runStateFromLog(store, runId = null) {
  const ids = runIds(store);
  const id = runId ?? ids.at(-1);
  if (!id || !ids.includes(id)) return null;
  const lines = readRunLog(store, id).lines;
  const moves = lines.filter((l) => l.event === 'run_started' || l.event === 'run_state');
  const started = lines.find((l) => l.event === 'run_started');
  const last = moves.at(-1);
  if (!last || !started) return null;
  return { schema_version: 1, run_id: id, state: last.event === 'run_started' ? 'running' : last.to, started_at: started.ts, seq: last.seq, ...(last.item && last.item !== 'run' ? { ticket: last.item } : {}) };
}

// Every check, in the order doctor prints them: [{ id, title, state, detail, hint?, fix? }].
// Damaged history, as doctor words it: never rewritten by MIRAI; what you can do by hand.
const HISTORY = new Set(['corrupt-line', 'order', 'counter-behind', 'bad-signature', 'unknown-event', 'encoding', 'too-large']);
export const historyHint = (err) => (HISTORY.has(err?.code)
  ? `MIRAI never rewrites its history. Keep a copy of ${err.path ?? 'the file'}, then${err.code === 'corrupt-line' ? ' remove the broken line by hand (a crash while writing leaves a torn last line), or' : ''} ask for help with the copy (docs/doctor.md)`
  : err?.hint ?? 'see docs/doctor.md');

export async function runChecks({ cwd, env, now = () => new Date(), redTeam = redTeamStatus, session = sessionStatus }) {
  let store;
  try {
    store = openStore({ cwd, env });
  } catch (err) {
    // The store can't even be opened (its journal or counter is damaged): that's the finding.
    return [{ id: 'store', title: 'Store', ...red(String(err.message ?? err).slice(0, 400), historyHint(err)) }, ...(await loginOnly(env, now))];
  }
  const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
  let trust = null;
  let trustError = null;
  try {
    trust = openTrustRoot({ cwd, env });
  } catch (err) {
    trustError = err;
  }
  let events = null;
  let journalError = null;
  try {
    events = readJournal(store, { keys }).events;
  } catch (err) {
    journalError = err;
  }
  const items = [];
  const check = async (id, title, fn) => {
    let r;
    try {
      r = await fn();
    } catch (err) {
      r = red(String(err.message ?? err).slice(0, 400), historyHint(err));
    }
    items.push({ id, title, ...r });
  };

  await check('login', 'Login', () => loginCheck(env, now));
  await check('strict', 'Strict bundle', () => {
    if (trustError) throw trustError;
    if (!trust) return yellow('no trust root for the integration branch\'s commit yet, so the strict templates aren\'t checked', 'the next MIRAI step builds it (or: mirai trust snapshot)');
    for (const m of MODES) trustedStrict(trust, m);
    return ok(`the strict templates for ${MODES.join(' and ')} match their hashes`);
  });
  await check('redteam', 'Red team', async () => {
    const s = await redTeam({ cwd, env, installed: true });
    if (s.state !== 'green') return red(`the red team is ${s.state} for the Claude Code agents run${s.state === 'stale' ? ' (MIRAI or this machine changed since the last green run)' : ''}`, 'mirai redteam run --kept, in your terminal');
    const version = s.parts?.claude_code?.version;
    if (s.installed?.version && version && s.installed.version !== version) return yellow(`green for ${version}; Claude Code ${s.installed.version} is installed and not tested yet`, `agents stay on ${version} until a red-team run on ${s.installed.version} is green: mirai redteam status`);
    return ok(`green${s.result?.created_at ? ` (${s.result.created_at.slice(0, 10)})` : ''} for Claude Code ${version ?? 'the agents run'}`);
  });
  await check('trust', 'Trust root', () => {
    if (trustError) throw trustError;
    const lock = checkLock(store.checkout);
    const off = [...lock.changed.map((p) => `${p} changed`), ...lock.missing.map((p) => `${p} missing`), ...lock.added.map((p) => `${p} added`)];
    if (off.length) return red(`MIRAI's files here don't match mirai.lock: ${off.slice(0, 4).join(', ')}${off.length > 4 ? `, ${off.length - 4} more` : ''}`, 'mirai init --refresh, then commit it (or git checkout -- the files)');
    return trust ? ok(`the trust root for ${trust.baseSha.slice(0, 12)} is unchanged; MIRAI's files match mirai.lock`) : yellow('MIRAI\'s files match mirai.lock; no trust root for the integration branch\'s commit yet', 'the next MIRAI step builds it (or: mirai trust snapshot)');
  });
  await check('registry', 'Branch registry', () => {
    if (journalError) throw journalError;
    let have;
    try {
      have = readRegistry(store);
    } catch (err) {
      return red(err.message, 'mirai doctor --fix rebuilds it from the branch records', 'registry');
    }
    const r = registryFromRecords(store, { events, keys, current: have });
    const key = (e) => `${e.branch}\0${e.creation_sha}`;
    const a = new Set(have.map(key));
    const same = r.entries.length === have.length && r.entries.every((e) => a.has(key(e)));
    if (!same) return red(`the registry lists ${have.length} branch entr${have.length === 1 ? 'y' : 'ies'}, the journal and the signed records ${r.entries.length}${r.skipped.length ? ` (${r.skipped.length} that don't verify: ${r.skipped[0].why})` : ''}`, 'mirai doctor --fix rebuilds it from the branch records', 'registry');
    return ok(`${have.length} MIRAI branch entr${have.length === 1 ? 'y' : 'ies'}, as the journal and the signed records say${r.unchecked.length ? ` (${r.unchecked.length} can't be checked here: its commit isn't in this clone)` : ''}`);
  });
  await check('merge-gate', 'Merge gate', () => yellow('local-only: no CI checks MIRAI\'s proofs yet, so your merge is the gate', 'CI comes with unit 54; until then merge only what mirai review-mr (29d) or the host shows you'));
  await check('usage', 'Plan and week', () => {
    const caps = usageCaps(env);
    if (caps.error) return red(`your usage caps can't be read (${caps.error})`, 'fix ~/.config/mirai/config.toml');
    const c = usageCheck({ env, unattended: false, caps, now: now().getTime() });
    if (c.warn) return yellow(c.warn, 'the next run reads your usage first (a short Haiku launch)');
    const n = c.numbers;
    if (!c.go) return red(c.why, 'wait for the week to reset, or raise usage.week_max in ~/.config/mirai/config.toml');
    return ok(`MIRAI ${n.week}% of your week so far (cap ${n.week_max}%), ${n.night}% in the last 12 hours (cap ${n.night_max}%); ${100 - n.used}% of the week left`);
  });
  await check('store', 'Store', () => {
    if (journalError) throw journalError;
    checkCounter(store);
    const ids = runIds(store);
    for (const id of ids) readRunLog(store, id);
    const locks = lockFiles(store, env);
    const dead = locks.filter((l) => !l.holder.unreadable && !l.holder.alive);
    const bad = locks.filter((l) => l.holder.unreadable);
    if (bad.length) return red(`${bad.length} lock file${bad.length === 1 ? '' : 's'} can't be read: ${bad.map((l) => l.path).slice(0, 2).join(', ')}`, `if no MIRAI command is running, remove it: rm '${bad[0].path}'`);
    let state;
    try {
      state = readRunState(store);
    } catch (err) {
      return red(err.message, 'mirai doctor --fix rebuilds it from the run log', 'run-state');
    }
    if (dead.length) return red(`${dead.length} lock${dead.length === 1 ? '' : 's'} left by a process that's gone (${dead.map((l) => `pid ${l.holder.pid}`).slice(0, 3).join(', ')})`, 'mirai doctor --fix removes them', 'locks');
    if (state === null && ids.length) return red(`the run state is missing; the newest run log is ${ids.at(-1)}`, 'mirai doctor --fix rebuilds it from the run log', 'run-state');
    if (state !== null && !runStateMatchesLog(store)) return red(`the run state (${state.state}) doesn't match run ${state.run_id}'s log`, 'mirai doctor --fix rebuilds it from the run log', 'run-state');
    return ok(`journal, ${ids.length} run log${ids.length === 1 ? '' : 's'}, the counter and the run state read cleanly`);
  });
  await check('hook', 'Hook\'s Node', () => {
    const record = readHooksRecord(store);
    if (!record) return red('MIRAI\'s hooks aren\'t installed on this machine', 'mirai init --refresh');
    if (!runnable(record.node)) return red(`the pre-push hook runs ${record.node}, which isn't there: every push fails`, 'mirai init --refresh (it records the Node you run now)');
    const s = hooksState({ store, env });
    if (s.state !== 'ok') return red(s.why, 'mirai init --refresh');
    return ok(`the pre-push hook runs ${record.node}`);
  });
  await check('host-cli', 'Host CLIs', () => {
    let rec = null;
    try {
      rec = JSON.parse(readFileSync(join(store.dir, TOOLS_FILE), 'utf8'));
    } catch {
      rec = null;
    }
    const named = Object.entries(rec ?? {}).filter(([k, v]) => k !== 'schema_version' && typeof v === 'string');
    if (!named.length) return yellow('no gh or glab recorded, so mirai ship can\'t open an MR', 'install gh (or glab), then mirai init --refresh');
    const gone = named.filter(([, p]) => !runnable(p));
    if (gone.length) return red(`${gone.map(([k, p]) => `${k}: ${p}`).join(', ')} isn't there: mirai ship refuses`, 'mirai init --refresh (it records the ones on your PATH)');
    return ok(named.map(([k, p]) => `${k}: ${p}`).join(', '));
  });
  await check('cpu', 'Agents\' binary', () => {
    const t = readTested(store, { keys });
    if (!t) return yellow('no kept Claude Code yet: agents run the one on your PATH', 'a green mirai redteam run keeps the one it tested');
    const path = t.current?.path;
    if (!path || !existsSync(path)) return red('the kept Claude Code is gone', 'mirai redteam run --kept, in your terminal');
    const cpu = machoCpu(path);
    const here = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : process.arch;
    if (cpu === 'universal' || cpu === here) return ok(`Claude Code ${t.current.version ?? ''} for ${cpu === 'universal' ? 'both CPU types' : here}`.replace('  ', ' '));
    if (cpu === 'x64' && here === 'arm64') return yellow(`the kept Claude Code ${t.current.version ?? ''} is an Intel binary: on this Mac agents run it through Rosetta`.replace('  ', ' '), 'agents move to a native one when a red-team run on a newer Claude Code is green (S1/S2 wait for MIRAI to list its new settings)');
    return red(`the kept Claude Code is for ${cpu ?? 'no CPU MIRAI knows'}, and this Mac is ${here}`, 'mirai redteam run, in your terminal, on the Claude Code installed here');
  });
  await check('key', 'Your key', () => {
    let key;
    try {
      key = loadSigningKey(env);
    } catch (err) {
      return red(`no signing key on this machine (${String(err.message).slice(0, 120)})`, 'mirai key new, in your terminal; then commit its .pub by itself');
    }
    const committed = keys.get(key.keyId);
    if (!committed) return red(`${key.keyId} isn't on ${store.branch}: your approvals and proofs won't verify`, `commit and push .mirai/keys/${key.keyId}.pub to ${store.branch} (mirai key new writes it)`);
    if (committed.revokedAt !== null) return red(`${key.keyId} is revoked`, 'mirai key new --replace, in your terminal');
    const ref = integrationRef(store.checkout, store.branch, store.gitEnv);
    const problems = readCommittedKeys(store.checkout, ref, store.gitEnv).problems ?? [];
    if (problems.length) return yellow(`${key.keyId} verifies; .mirai/keys has ${problems.length} file${problems.length === 1 ? '' : 's'} that aren't keys: ${problems[0].path} (${problems[0].reason})`, 'remove them from .mirai/keys on the integration branch');
    return ok(`${key.keyId} is on ${store.branch}; signatures verify`);
  });
  await check('session', 'Session server', () => {
    const s = session({ store, env, trust });
    if (s.state === 'current') return ok('registered for the current trust root');
    if (s.state === 'unknown') return yellow('Claude Code didn\'t answer, so MIRAI can\'t tell', 'claude mcp list');
    if (s.state === 'missing') return yellow('not registered for this project: /mirai in your sessions won\'t work', 'mirai session-server install, in your terminal');
    if (s.state === 'foreign') return red('Claude Code has a server named mirai here that MIRAI didn\'t register', 'claude mcp get mirai; then mirai session-server install');
    return yellow(`behind${s.behind ? ' (an older trust root)' : ''}${s.connected === false ? ', and it doesn\'t start' : ''}`, 'mirai session-server install, in your terminal');
  });
  await check('baseline', 'Baseline', () => {
    const sha = trust?.baseSha ?? commitOf(store.checkout, `refs/heads/${store.branch}`, store.gitEnv);
    if (!sha) return yellow(`${store.branch} has no commit MIRAI can read`, `git switch ${store.branch}`);
    const b = readBaseline(store, sha, { keys });
    if (!b) return yellow(`none for ${store.branch} at ${sha.slice(0, 12)}: the next run records it first`, 'to record it now: mirai baseline');
    return ok(`recorded for ${sha.slice(0, 12)}${b.complete ? '' : ' (incomplete)'}`);
  });
  return items;
}

function loginCheck(env, now) {
  const token = readToken(env);
  if (!token) return red('no login token: agents can\'t sign in to Claude', 'mirai token set');
  const at = tokenSetAt(env);
  const days = at ? Math.floor((now() - at) / DAY) : null;
  const apiKey = typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY !== '';
  if (days !== null && days >= RENEW_AFTER_DAYS) return yellow(`the token is ${days} days old (it lasts a year)`, 'make a new one: claude setup-token, then mirai token set');
  if (apiKey) return yellow('your shell has ANTHROPIC_API_KEY set: agents never get it, but your own Claude Code sessions may use it instead of your subscription', 'unset ANTHROPIC_API_KEY unless you mean it');
  return ok(`subscription token, set ${days === null ? 'on an unknown date' : `${days} day${days === 1 ? '' : 's'} ago`}`);
}

async function loginOnly(env, now) {
  try {
    return [{ id: 'login', title: 'Login', ...loginCheck(env, now) }];
  } catch (err) {
    return [{ id: 'login', title: 'Login', ...red(String(err.message).slice(0, 300), err.hint ?? 'mirai token set') }];
  }
}

export const summary = (items) => {
  const n = (s) => items.filter((i) => i.state === s).length;
  return `doctor: ${n('ok')} ok, ${n('yellow')} yellow, ${n('red')} red`;
};
