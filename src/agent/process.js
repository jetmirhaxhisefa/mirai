import { execFile, spawn } from 'node:child_process';

// An agent's processes (unit 19a; R3-M8, G21). 19a's R4 probe: on macOS a background job gets its
// own process group, and a double fork or a setsid leaves the tree, so killing the agent's group
// isn't enough. So:
// - the tree is followed during the run, by polling `ps`, and killed at the end, group and pids;
// - a new orphan working under `killRoots` (the launch's own scratch folder, nothing of yours is
//   there) is killed too;
// - a new orphan working under `reportRoots` (your checkout, where your own dev server might be) is
//   named as a suspect and left alone: only a worktree of the launch's own makes that safe (unit 21);
// - anything else new and orphaned is reported, never killed.
// What's left: a process that detaches before a poll sees it, which a plain `nohup … &` often does.
// Named if it's working in your checkout; not even that if it left first (`cd /`). Its environment
// would prove whose it is, but macOS doesn't show it (`ps -E`, sysctl: 19a's probes). It stays in the
// sandbox, but could still change the project after the run ends (docs/agent-safety.md; units 21, 22).

export const POLL_MS = 500;
const SYSTEM_PATHS = /^(\/System|\/usr\/libexec|\/usr\/sbin|\/Library|\/Applications|\/sbin)\//;

const exec = (file, args, options) => new Promise((done) => {
  execFile(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, ...options }, (err, stdout) => done(err ? null : stdout));
});

// Every process of yours: [{ pid, ppid, pgid, started, startedText, command }], or null if `ps` failed.
export async function processTable() {
  const out = await exec('/bin/ps', ['-axww', '-o', 'pid=,ppid=,pgid=,uid=,lstart=,command='], { timeout: 10_000 });
  if (out === null) return null;
  const uid = process.getuid();
  return out.split('\n').flatMap((l) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(l);
    return m && Number(m[4]) === uid ? [{ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), started: Date.parse(m[5]), startedText: m[5], command: m[6] }] : [];
  });
}

// One `ps` however many runs ask within a poll: six red-team workers each polling would keep the
// event loop busy (18e's measure: 86% blocked).
let cached = null;
export function sharedTable(maxAgeMs = POLL_MS / 2) {
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.table;
  const table = processTable();
  cached = { at: Date.now(), table };
  return table;
}

// The pids whose working folder is under one of `roots` (lsof ships with macOS), or null if it failed.
export async function cwdsUnder(roots) {
  // lsof exits 1 with some results when a process has gone mid-listing, so `exec`'s null alone isn't
  // a failure of the whole look; no output at all is.
  const out = await new Promise((done) => {
    execFile('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fpn', '-u', String(process.getuid())], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30_000, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } }, (err, stdout) => done(stdout || null));
  });
  if (out === null) return null;
  const hits = new Set();
  let pid = null;
  for (const l of out.split('\n')) {
    if (l[0] === 'p') pid = Number(l.slice(1));
    if (l[0] === 'n' && roots.some((root) => l.slice(1) === root || l.slice(1).startsWith(`${root}/`))) hits.add(pid);
  }
  return hits;
}

export class Tracker {
  constructor(rootPid, table = sharedTable) {
    this.root = rootPid;
    this.table = table;
    // pid → its start time. A pid counts only with the same start time, and a group only while a
    // process known to be the agent's is alive in it, so a reused one is never followed or signalled.
    this.seen = new Map();
    this.groups = new Set();
    this.polled = false;
    this.failed = false;
  }

  ours(p) {
    return this.seen.get(p.pid) === p.startedText;
  }

  // Adds what's new to the tree; returns the whole table, or null if `ps` failed.
  async poll() {
    const rows = await this.table();
    if (rows === null) {
      this.failed = true;
      return null;
    }
    const byPid = new Map(rows.map((p) => [p.pid, p]));
    if (!this.polled) {
      this.polled = true;
      // The root's own group, even if the root has already gone: its children start in it.
      for (const p of rows) if (p.pid === this.root || p.pgid === this.root) this.seen.set(p.pid, p.startedText);
    }
    this.groups = new Set(rows.filter((p) => this.ours(p)).map((p) => p.pgid));
    for (let grew = true; grew;) {
      grew = false;
      for (const p of rows) {
        if (this.ours(p)) continue;
        const parent = byPid.get(p.ppid);
        if ((parent && this.ours(parent)) || this.groups.has(p.pgid)) {
          this.seen.set(p.pid, p.startedText);
          this.groups.add(p.pgid);
          grew = true;
        }
      }
    }
    return rows;
  }
}

const signal = (pid, sig) => {
  try {
    process.kill(pid, sig);
    return true;
  } catch {
    return false;
  }
};

// Ends a run's processes: { killed, survivors, suspects, unproven, unverified }. `since`: when the
// launch started (ms). SIGTERM first, and a wait until they've gone: MIRAI's server cleans up its
// containers on the way out (14d). `graceMs`: how long that may take.
export async function endProcesses(tracker, { killRoots = [], reportRoots = [], since = 0, table = sharedTable, cwds = cwdsUnder, graceMs = 3000, stopWaiting = () => false } = {}) {
  const killed = new Set();
  const alive = async () => {
    const rows = await tracker.poll();
    return { rows: rows ?? [], ours: (rows ?? []).filter((p) => p.pid !== process.pid && tracker.ours(p)) };
  };
  const hit = (rows, sig) => {
    for (const p of rows) if (signal(p.pid, sig)) killed.add(p.pid);
  };
  // A group only if every process in it is known to be the agent's; otherwise pid by pid.
  const groups = (rows, sig) => {
    // With no table (`ps` failed) nothing is known about a group, so none is signalled.
    if (!rows.length) return;
    for (const g of tracker.groups) {
      if (g > 1 && g !== process.pid && rows.filter((p) => p.pgid === g).every((p) => tracker.ours(p))) signal(-g, sig);
    }
  };
  let now = await alive();
  groups(now.rows, 'SIGTERM');
  hit(now.ours, 'SIGTERM');
  const until = Date.now() + graceMs;
  now = await alive();
  while (now.ours.length && Date.now() < until && !stopWaiting()) {
    await new Promise((done) => setTimeout(done, 200));
    now = await alive();
  }
  groups(now.rows, 'SIGKILL');
  hit(now.ours, 'SIGKILL');
  const floor = Math.floor(since / 1000) * 1000;
  const orphans = (rows) => rows.filter((p) => p.ppid === 1 && p.started >= floor);
  const loose = orphans(now.rows);
  const suspects = [];
  // lsof is slow, and most runs leave nothing to ask it about.
  if (loose.length && (killRoots.length || reportRoots.length)) {
    const inKill = killRoots.length ? await cwds(killRoots) : new Set();
    const inReport = reportRoots.length ? await cwds(reportRoots) : new Set();
    if (inKill === null || inReport === null) tracker.failed = true;
    hit(loose.filter((p) => inKill?.has(p.pid)), 'SIGKILL');
    for (const p of loose) if (inReport?.has(p.pid) && !inKill?.has(p.pid)) suspects.push(p.pid);
  }
  await new Promise((done) => setTimeout(done, 200));
  // A fresh table: a cached one could be from before the kill.
  const last = await (table === sharedTable ? processTable : table)();
  const name = (p) => `${p.pid} ${p.command.split(/\s+/)[0].split('/').pop()}`;
  if (last === null) return { killed: killed.size, survivors: [], suspects: [], unproven: [], unverified: true };
  const survivors = last.filter((p) => tracker.ours(p) && p.pid !== process.pid).map((p) => p.pid);
  const suspectRows = last.filter((p) => suspects.includes(p.pid));
  const unproven = orphans(last).filter((p) => !killed.has(p.pid) && !suspects.includes(p.pid) && !SYSTEM_PATHS.test(p.command)).map(name);
  return { killed: killed.size, survivors, suspects: suspectRows.map(name), unproven: unproven.slice(0, 10), unverified: tracker.failed };
}

// Starts `claude` in its own process group, follows its tree, and ends everything: the shape of
// runClaude's result, plus `processes` and `killedBy`. `onLine(line, kill)`: each whole line of
// stdout. `abort`: a signal that ends it (with a grace for cleanup); `hardAbort`: no grace.
export function runInGroup(claude, { args, env, cwd, fdToken }, { timeoutMs = 240_000, signal: abort = null, hardAbort = null, onLine = null, killRoots = null, reportRoots = [], onStart = null, pollMs = POLL_MS, table = sharedTable, cwds = cwdsUnder } = {}) {
  return new Promise((done) => {
    const since = Date.now();
    const child = spawn(claude, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe', ...(fdToken ? ['pipe'] : [])] });
    if (fdToken) {
      child.stdio[3].on('error', () => {});
      child.stdio[3].end(fdToken);
    }
    const tracker = child.pid ? new Tracker(child.pid, table) : null;
    tracker?.poll();
    let stdout = '';
    let stderr = '';
    let pending = '';
    let timedOut = false;
    let killedBy = null;
    let hard = null;
    let noGrace = false;
    const kill = (why) => {
      killedBy ??= why;
      if (!child.pid) return;
      signal(-child.pid, 'SIGTERM');
      // Claude Code itself only: MIRAI's server, in its group, may need longer to clean up.
      hard ??= setTimeout(() => signal(child.pid, 'SIGKILL'), 3000);
    };
    if (child.pid) onStart?.(child.pid, kill);
    child.stdout.on('data', (d) => {
      stdout += d;
      if (!onLine) return;
      pending += d;
      const parts = pending.split('\n');
      pending = parts.pop();
      for (const l of parts) onLine(l, kill);
    });
    child.stderr.on('data', (d) => (stderr += d));
    const poll = tracker ? setInterval(() => tracker.poll(), pollMs) : null;
    const timer = setTimeout(() => {
      timedOut = true;
      kill('timeout');
    }, timeoutMs);
    const onAbort = () => kill('interrupted');
    const onHard = () => {
      noGrace = true;
      kill('interrupted');
    };
    abort?.addEventListener('abort', onAbort, { once: true });
    hardAbort?.addEventListener('abort', onHard, { once: true });
    if (abort?.aborted) kill('interrupted');
    let ended = false;
    const end = async (result) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      clearInterval(poll);
      // A last line with no newline is still a line: a check must see it.
      if (onLine && pending) onLine(pending, kill);
      clearTimeout(hard);
      abort?.removeEventListener('abort', onAbort);
      const processes = tracker
        ? await endProcesses(tracker, { killRoots: killRoots ?? [], reportRoots, since, table, cwds, graceMs: noGrace ? 0 : killedBy ? 30_000 : 3000, stopWaiting: () => noGrace })
        : { killed: 0, survivors: [], suspects: [], unproven: [], unverified: false };
      hardAbort?.removeEventListener('abort', onHard);
      done({ ...result, stdout, stderr: `${stderr}${result.stderr ?? ''}`, timedOut, killedBy, processes });
    };
    child.on('error', (err) => end({ exit: -1, stderr: err.message }));
    // A process left behind may hold stdout open, so `close` might never come: after the agent's
    // exit, a short wait for the rest of its output, then the cleanup that ends those too.
    child.on('exit', (code, sig) => setTimeout(() => {
      child.stdout.destroy();
      child.stderr.destroy();
      end({ exit: code ?? (sig ? -1 : 0) });
    }, 1500).unref());
    child.on('close', (code, sig) => end({ exit: code ?? (sig ? -1 : 0) }));
  });
}
