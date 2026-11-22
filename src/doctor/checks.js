import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readInstall, ticketImages } from '../agent/install.js';
import { join } from 'node:path';

import { latestOther, readBaseline } from '../baseline/store.js';
import { readHooksRecord, hooksState } from '../hooks/install.js';
import { checkLock, readLock } from '../install/lock.js';
import { agentTemplate, canonicalSha256, MODES } from '../launch/strict.js';
import { usageCaps, usageCheck } from '../loop/ledger.js';
import { claudeConfigDir, otherConfigs, status as sessionStatus } from '../mcp/session.js';
import { redTeamStatus } from '../redteam/run.js';
import { readTested } from '../redteam/tested.js';
import { gapNote } from '../redteam/move.js';
import { TOOLS_FILE } from '../ship/host.js';
import { branchKeys, keyIsProtected, loadMachineKey, publicPemOf, readCommittedKeys, integrationRef } from '../sign/keys.js';
import { userSettings } from '../sign/denies.js';
import { holderStatus } from '../sign/unlock.js';
import { RENEW_AFTER_DAYS, readToken, tokenSetAt } from '../sign/token.js';
import { readRegistry } from '../store/branches.js';
import { blobAt, commitOf, isAncestor } from '../store/git.js';
import { runLockHolder, globalPaths } from '../store/global.js';
import { checkPrivateDir, lockHolder } from '../store/files.js';
import { openStore } from '../store/home.js';
import { checkCounter, readJournal } from '../store/journal.js';
import { miraiHome } from '../store/mirai-home.js';
import { readRunLog, runIds } from '../store/run-log.js';
import { readRunState, runStateMatchesLog } from '../store/run.js';
import { verifyBranchRecord } from '../store/branch-record.js';
import { openTrustRoot, trustedRegistry, trustedStrict } from '../trust/snapshot.js';
import { agentModes, trustedOverlays } from '../trust/overlays.js';
import { hasOverlayFiles, STATE_TEXT } from '../config/overlays.js';
import { loadRegistry } from '../config/registry.js';
import { overlayKeys, projectInputs, renderPlan, REGISTRY_DIR as RENDER_REGISTRY_DIR } from '../install/render.js';
import { contextApproval } from '../cli/commands/approve.js';
import { readApprovedFile } from '../cli/human-move.js';
import { committedNotRendered, itemRoot } from '../setup/pre-commit.js';
import { docsStoreFor } from '../store/connectors/index.js';
import { CONTEXT_DIR, contextKindOf } from '../lint/context.js';

// `mirai doctor`'s checks (unit 29c, Jet's decisions 1–2): each item ok, yellow (works, worth
// knowing) or red (something will fail), with a fix hint for every yellow and red one. `fix`
// names the `--fix` repair that clears it. A check that throws is red with its error's own hint,
// never skipped: an item that can't be checked says so.

export const STATES = Object.freeze(['ok', 'yellow', 'red']);
const ok = (detail) => ({ state: 'ok', detail });
const yellow = (detail, hint) => ({ state: 'yellow', detail, hint });
// A yellow MIRAI itself expects until a later unit builds the missing part (unit 39, P1's F4): the
// unit is named, so setup's last checklist line and its probe can tell it from a yellow to fix.
const expectedYellow = (detail, hint, unit) => ({ ...yellow(detail, hint), expected_until: unit });
// An advisory yellow (unit 39, P1's F8 and F10; Jet, 2026-11-22): a note that isn't a fault, as
// the design means it (a session server behind still runs the rules it was registered with, 15b;
// a baseline missing at the head is recorded by the next run first, 17b). Its hint says how to
// clear it; setup's last checklist line and finish don't count it.
const advisoryYellow = (detail, hint) => ({ ...yellow(detail, hint), advisory: true });
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

export async function runChecks({ cwd, env, now = () => new Date(), redTeam = redTeamStatus, session = sessionStatus, images = ticketImages }) {
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
  let redTeamNow = null;
  await check('redteam', 'Red team', async () => {
    const s = await redTeam({ cwd, env, installed: true });
    redTeamNow = s;
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
  await check('merge-gate', 'Merge gate', () => expectedYellow('local-only: no CI checks MIRAI\'s proofs yet, so your merge is the gate', 'CI comes with unit 54; until then merge only what mirai review-mr (29d) or the host shows you', '54'));
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
    // Unit 39: a folder written before the pre-commit hook was added.
    if (!record.pre_commit) return yellow(`the pre-push hook runs ${record.node}; MIRAI's pre-commit (unit 39) isn't installed yet`, 'mirai init --refresh');
    return ok(`the pre-push and pre-commit hooks run ${record.node}`);
  });
  await check('host-cli', 'Host CLIs', () => {
    let rec = null;
    try {
      rec = JSON.parse(readFileSync(join(store.dir, TOOLS_FILE), 'utf8'));
    } catch {
      rec = null;
    }
    const named = Object.entries(rec ?? {}).filter(([k, v]) => k !== 'schema_version' && typeof v === 'string');
    if (!named.length) return yellow('no gh or glab recorded, so mirai ship can\'t reach the host', 'install gh (or glab), then mirai init --refresh');
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
  // Unit 18h: a newer Claude Code agents haven't moved to, and when new tickets stop for it.
  await check('claude-move', 'Claude Code moves', () => {
    const g = gapNote(store);
    if (!g) return ok('agents run the newest Claude Code MIRAI could move to');
    return (g.stopping ? red : yellow)(g.line, g.next ?? 'mirai redteam run, in your terminal');
  });
  await check('key', 'Your key', () => {
    let key;
    try {
      key = publicPemOf(env);
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
  // Unit 29b: your key at rest: protected, unlocked (until when), the machine key, the denies.
  await check('key-rest', 'Key at rest', () => {
    const notes = [];
    const held = holderStatus(env);
    const protectedKey = keyIsProtected(env);
    const m = loadMachineKey(env);
    const mc = m ? keys.get(m.keyId) : null;
    const machineOk = Boolean(mc && mc.kind === 'machine' && mc.revokedAt === null);
    const deniesMissing = userSettings(env).filter((u) => u.missing.length);
    if (!protectedKey) return yellow('your key is a plain file: a session that reads it can sign as you', 'mirai key protect, in your terminal');
    if (!m) notes.push('no machine key: MIRAI\'s records need your passphrase, and a session run stops before the proofs');
    else if (!machineOk) notes.push(`the machine key ${m.keyId} isn't on ${store.branch} yet`);
    if (deniesMissing.length) notes.push(`MIRAI's deny rules are missing in ${deniesMissing.map((u) => u.file).join(', ')}`);
    if (held) return yellow(`protected, but unlocked until ${new Date(held.until).toLocaleString()}: any program running as you can sign with it meanwhile${notes.length ? `; ${notes.join('; ')}` : ''}`, 'mirai key lock, when you\'re done');
    if (notes.length) return yellow(`protected; ${notes.join('; ')}`, !m ? 'mirai key new --machine, then commit its .machine.pub by itself' : !machineOk ? `commit and push .mirai/keys/${m.keyId}.machine.pub` : 'mirai key status (mirai key protect or token set writes them)');
    return ok(`protected with your passphrase; the machine key ${m.keyId} signs MIRAI's records; MIRAI's deny rules are in your Claude settings`);
  });
  await check('session', 'Session server', () => {
    const s = session({ store, env, trust });
    if (s.state === 'current') return ok('registered for the current trust root');
    if (s.state === 'unknown') return yellow('Claude Code didn\'t answer, so MIRAI can\'t tell', 'claude mcp list');
    // P1's F3: the registration is per Claude Code config; say which one was checked.
    const config = env?.CLAUDE_CONFIG_DIR ? `CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}` : 'the default Claude Code config (~/.claude.json)';
    // F7: another config MIRAI registered this folder in, current there: said, so a stale default
    // doesn't read as your sessions' problem.
    const elsewhere = () => {
      try {
        const found = otherConfigs(store, claudeConfigDir(env)).filter((c) => {
          const e = { ...env };
          if (c) e.CLAUDE_CONFIG_DIR = c;
          else delete e.CLAUDE_CONFIG_DIR;
          return session({ store, env: e, trust }).state === 'current';
        });
        return found.length ? `; current in ${found.map((c) => (c ? `CLAUDE_CONFIG_DIR=${c}` : 'the default config')).join(', ')}` : '';
      } catch {
        return '';
      }
    };
    if (s.state === 'missing') return yellow(`not registered for this project in ${config}${elsewhere()}: /mirai in sessions with this config won't work`, 'mirai session-server install, in your terminal; for sessions with another Claude Code config: CLAUDE_CONFIG_DIR=<its folder> mirai session-server install');
    if (s.state === 'foreign') return red('Claude Code has a server named mirai here that MIRAI didn\'t register', 'claude mcp get mirai; then mirai session-server install');
    // Behind and still starting: the pin (15b, D-53) by design; it runs the rules it was registered with.
    if (s.behind && s.connected !== false) return advisoryYellow(`behind (registered at an older trust root, in ${config}); it still starts and runs the rules it was registered with`, 'to bring it up to date: mirai render, or mirai session-server install, in your terminal');
    return yellow(`behind${s.behind ? ' (an older trust root)' : ''}${s.connected === false ? ', and it doesn\'t start' : ''} (in ${config})${elsewhere()}`, 'mirai session-server install, in your terminal (with the CLAUDE_CONFIG_DIR your sessions use)');
  });
  await check('baseline', 'Baseline', () => {
    const sha = trust?.baseSha ?? commitOf(store.checkout, `refs/heads/${store.branch}`, store.gitEnv);
    if (!sha) return yellow(`${store.branch} has no commit MIRAI can read`, `git switch ${store.branch}`);
    const b = readBaseline(store, sha, { keys });
    if (!b) {
      // F10: one that verifies at an ancestor of the head: the next run records the head's first.
      const prev = latestOther(store, sha);
      if (prev && isAncestor(store.checkout, prev.baseline.sha, sha, store.gitEnv)) return advisoryYellow(`none for ${store.branch} at ${sha.slice(0, 12)} yet (one at ${prev.baseline.sha.slice(0, 12)}, an earlier commit): the next run records it first`, 'to record it now: mirai baseline');
      return yellow(`none for ${store.branch} at ${sha.slice(0, 12)}: the next run records it first`, 'to record it now: mirai baseline');
    }
    return ok(`recorded for ${sha.slice(0, 12)}${b.complete ? '' : ' (incomplete)'}`);
  });
  // Unit 30b: per-ticket images whose ticket no longer has an install record (done, dropped, or
  // released while Docker was down).
  await check('ticket-images', 'Ticket images', async () => {
    let found;
    try {
      found = await images({ store, env });
    } catch {
      found = null;
    }
    if (found === null) return yellow('Docker didn\'t answer, so the tickets\' own images weren\'t checked', 'start Docker Desktop');
    const left = found.filter((i) => !i.ticket || !readInstall(store, i.ticket));
    if (left.length) return yellow(`${left.length} image(s) of tickets that no longer need them: ${left.slice(0, 4).map((i) => i.tag).join(', ')}`, `docker image rm ${left.slice(0, 4).map((i) => i.tag).join(' ')}`);
    return ok(found.length ? `${found.length} ticket image(s), each for a ticket with installed packages` : 'no ticket has its own image');
  });
  await check('word-list', 'Banned words', () => wordListCheck(readFileSync(WORDS_FILE, 'utf8'), now));
  await check('context', 'Context files', () => {
    if (journalError) throw journalError;
    return contextCheck({ store, events, now });
  });
  // Unit 38: the document store and its proof step (setup), as at mirai init.
  await check('docs-store', 'Document store', () => {
    const { conn } = docsStoreFor({ cwd, env, store });
    const r = conn.setup();
    if (!r.ok) return red(r.detail, r.hint ?? 'run: mirai doctor again once it\'s fixed');
    if (!conn.teamCanSee) return ok(`${r.detail}; teammates can't see these documents (they never leave this Mac)`);
    return ok(r.detail);
  });
  await check('overlays', 'Overlays', () => {
    if (journalError) throw journalError;
    if (trustError) throw trustError;
    return overlaysCheck({ store, trust, events, redTeam: redTeamNow, env });
  });
  // Unit 39 (Scope 9): what got past the pre-commit hook (git commit --no-verify).
  await check('custom', 'Not rendered by MIRAI', () => customCheck({ store }));
  return items;
}

// Unit 34 (Scope 7): the banned-word list's review. src/lint/words.js opens with a dated line,
// "// Reviewed: YYYY-MM-DD"; past 90 days it's yellow, with what a review is.
export const WORDS_FILE = fileURLToPath(new URL('../lint/words.js', import.meta.url));
export const WORDS_REVIEW_DAYS = 90;
export function wordListCheck(text, now) {
  const m = /^\/\/ Reviewed: ([0-9]{4}-[0-9]{2}-[0-9]{2})$/m.exec(String(text).split('\n').slice(0, 5).join('\n'));
  const at = m ? Date.parse(`${m[1]}T00:00:00Z`) : NaN;
  const hint = `review it: check the lists in ${WORDS_FILE} against the last ${WORDS_REVIEW_DAYS} days' lint warnings and findings, change them, then update the "// Reviewed:" date at its top`;
  if (!Number.isFinite(at)) return yellow('the banned-word list has no review date', hint);
  const days = Math.floor((now().getTime() - at) / DAY);
  if (days > WORDS_REVIEW_DAYS) return yellow(`the banned-word list was last reviewed ${days} days ago (${m[1]}), more than ${WORDS_REVIEW_DAYS}`, hint);
  return ok(`reviewed ${m[1]}, ${days} day${days === 1 ? '' : 's'} ago`);
}

// Unit 36 (Scope 5): the context files you approve. business.md's age since its last approval
// (yellow past BUSINESS_REVIEW_DAYS: the business moves on), and any approved context file that
// changed since its approval or was never approved. `events`: the journal, read and verified.
export const BUSINESS_REVIEW_DAYS = 180;
export function contextCheck({ store, events, now }) {
  let names = [];
  try {
    names = readdirSync(join(store.checkout, CONTEXT_DIR)).sort();
  } catch {
    names = [];
  }
  const approved = names.map((n) => ({ name: n, kind: contextKindOf(n) })).filter((f) => f.kind?.approved);
  if (!approved.length) return ok('no context files to approve yet (setup writes them)');
  const notes = [];
  let hint = null;
  for (const f of approved) {
    const rel = `${CONTEXT_DIR}/${f.name}`;
    let bytes = null;
    try {
      bytes = readApprovedFile(store.checkout, store.checkout, rel).bytes;
    } catch {
      bytes = null;
    }
    const a = contextApproval(store, rel, bytes, events);
    if (a.stale) notes.push(`${f.name} changed since its approval`);
    else if (!a.approved) notes.push(`${f.name} isn't approved`);
    if (!a.approved) hint ??= `read it, then: mirai approve --file ${rel}`;
    if (f.kind.type === 'business' && a.ts) {
      const days = Math.floor((now().getTime() - Date.parse(a.ts)) / DAY);
      if (days > BUSINESS_REVIEW_DAYS) {
        notes.push(`business.md was last approved ${days} days ago (${a.ts.slice(0, 10)}), more than ${BUSINESS_REVIEW_DAYS}`);
        hint ??= `read it against what has changed in the business, update it, then: mirai approve --file ${rel}`;
      }
    }
  }
  if (notes.length) return yellow(notes.join('; '), hint);
  return ok(`${approved.length} approved context file${approved.length === 1 ? '' : 's'}, each as it is now`);
}

// Unit 37 (Scope 6, Scope 3): each agent as launches take it ("MIRAI's", "overlay (approved)",
// "overlay (not approved)", "widened: red team needed"), every overlay that isn't approved as it
// is now, and a replacement template approved against an older MIRAI template version.
// `redTeam`: the red-team status the doctor read (its result's templates say which widened
// agents a run covered).
export function overlaysCheck({ store, trust, events, redTeam = null, registry = null, env = null }) {
  if (!trust) return hasOverlayFiles(store.checkout) ? yellow('no trust root for the integration branch\'s commit yet, so the overlays aren\'t checked', 'the next MIRAI step builds it (or: mirai trust snapshot)') : ok('no overlays: MIRAI\'s agents and templates as they are');
  registry ??= trustedRegistry(trust);
  const r = trustedOverlays(trust, store, { registry, events });
  const notes = [];
  let hint = null;
  const agents = [];
  for (const name of Object.keys(registry.agents).sort()) {
    const o = r.overlays.find((x) => x.kind === 'agent' && x.name === name);
    if (!o) {
      agents.push(`${name} MIRAI's`);
      continue;
    }
    if (o.state !== 'approved' || !o.result) {
      agents.push(`${name} overlay (not approved)`);
      hint ??= o.state === 'invalid' ? 'mirai show overlays lists its problems' : `read it, then: mirai approve --file ${o.path}`;
      continue;
    }
    if (o.result.change === 'widening') {
      const covered = agentModes(o.result.def, registry.roles).every((mode) => {
        const t = agentTemplate(trustedStrict(trust, mode), { agent: name, tools: o.result.def.tools.allowed, overlay: o.result.def.overlay });
        const cov = redTeam?.result?.templates?.[t.name];
        return redTeam?.state === 'green' && cov?.tested === true && cov.bundle === canonicalSha256(t);
      });
      if (!covered) {
        agents.push(`${name} widened: red team needed`);
        hint ??= 'its launches are refused until a red-team run covers it: mirai redteam run, in your terminal';
        continue;
      }
    }
    agents.push(`${name} overlay (approved)`);
  }
  for (const o of r.overlays.filter((x) => x.kind !== 'agent' && x.state !== 'approved')) {
    notes.push(`${o.path} is ${STATE_TEXT[o.state]}`);
    hint ??= o.state === 'invalid' ? 'mirai show overlays lists its problems' : `read it, then: mirai approve --file ${o.path}`;
  }
  // A replacement template: MIRAI's updates don't flow in, so say when MIRAI's moved on.
  for (const o of r.overlays.filter((x) => x.kind === 'document-type' && x.state === 'approved' && x.result?.replace)) {
    const then = o.line?.template_version;
    const current = registry.documentTypes[o.name]?.template_version;
    if (Number.isInteger(then) && Number.isInteger(current) && current > then) {
      notes.push(`MIRAI's ${o.name} template is at version ${current}; your replacement ${o.path} was approved against version ${then}`);
      hint ??= `compare it with MIRAI's, update it, then: mirai approve --file ${o.path}`;
    } else if (typeof o.line?.template_hash === 'string' && o.line.template_hash !== o.result.coreTemplate.hash) {
      // Jet's answer to Q5 ("C", 2026-11-21): a text change under the same version counts too.
      notes.push(`MIRAI's ${o.name} template text changed since your replacement ${o.path} was approved (version ${current ?? 'unknown'} both times)`);
      hint ??= `compare it with MIRAI's, update it, then: mirai approve --file ${o.path}`;
    }
  }
  // Approved but not rendered: your sessions' agent and skill files aren't what mirai render would
  // write from the approved overlays (the coordinator's review, 2026-11-21).
  const stale = env ? unrenderedSessionFiles(store.checkout, env) : [];
  if (stale.length) {
    notes.push(`your sessions' ${stale.length === 1 ? 'file' : 'files'} ${stale.slice(0, 3).join(', ')}${stale.length > 3 ? ` and ${stale.length - 3} more` : ''} ${stale.length === 1 ? 'isn\'t' : 'aren\'t'} what the approved overlays render`);
    hint ??= 'mirai render, then commit the rendered files with the overlay and its record';
  }
  const agentLine = `agents: ${agents.join(', ')}`;
  const warn = notes.length || agents.some((a) => /not approved|red team needed/.test(a));
  return warn ? yellow([agentLine, ...notes].join('; '), hint) : ok(`${agentLine}; ${r.overlays.length} overlay${r.overlays.length === 1 ? '' : 's'}, each approved as it is now`);
}

// Unit 39 (Scope 9, decision 6): files committed under .claude/, .cursor/ or .codex/ that the lock
// doesn't mark rendered: an item added by hand (or before setup), which nothing checked.
export function customCheck({ store }) {
  const left = committedNotRendered({ root: store.checkout, env: store.gitEnv });
  if (!left.length) return ok('everything under .claude/, .cursor/ and .codex/ is rendered by MIRAI');
  const roots = [...new Set(left.map(itemRoot))];
  return yellow(`not rendered by MIRAI: ${left.slice(0, 5).join(', ')}${left.length > 5 ? ` and ${left.length - 5} more` : ''}`, `mirai custom add ${roots[0]}${roots.length > 1 ? ` (and the ${roots.length - 1} other${roots.length === 2 ? '' : 's'}; /mirai setup goes through them all)` : ''}`);
}

// The agent and skill files under your sessions' folders that mirai render would write
// differently now (from the work tree's framework copy, config and approved overlays): their
// paths. Read-only: the render's plan, never applied. A plan that can't be made says nothing here
// (the trust item reports a broken install).
export function unrenderedSessionFiles(root, env) {
  let plan;
  try {
    const lock = readLock(root);
    if (!lock) return [];
    const { configBytes, config, local } = projectInputs(root);
    plan = renderPlan({ root, registryDir: join(root, RENDER_REGISTRY_DIR), config, configBytes, local, lock, overlays: overlayKeys(root, env) });
  } catch {
    return [];
  }
  const profile = loadRegistry(join(root, RENDER_REGISTRY_DIR)).adapters['claude-code']?.interactive;
  if (!profile) return [];
  const inSessions = (p) => p.startsWith(`${profile.agents}/`) || p.startsWith(`${profile.skills}/`);
  return [...plan.files.filter((f) => f.changed && inSessions(f.path)).map((f) => f.path), ...plan.removed.filter(inSessions)].sort();
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
