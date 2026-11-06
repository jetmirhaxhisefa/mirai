import { spawnSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { MiraiError, UsageError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { checkInit, expectedInit, finishLaunch, prepareLaunch, removeLaunch } from '../launch/strict.js';
import { containsToken, parseStream, redact } from '../redteam/claude.js';
import { resolveClaude } from '../redteam/key.js';
import { HEALTH, redTeamStatus } from '../redteam/run.js';
import { readDecision } from '../redteam/store.js';
import { tokenFingerprint } from '../sign/token.js';
import { atomicWrite, ensurePrivateDir } from '../store/files.js';
import { acquireRunLock, appendUsage, runLockHolder } from '../store/global.js';
import { freshReading, latestWeekly, rateLimits, recordReadings, usageLimit } from '../loop/ledger.js';
import { workTreeChanges } from '../store/git.js';
import { openStore } from '../store/home.js';
import { withSeq } from '../store/journal.js';
import { readRunLog, runIds } from '../store/run-log.js';
import { newRunId, readRunState, startRun, writeHeartbeat, writeRunState } from '../store/run.js';
import { snapshot, trustedConfig, trustedRegistry, trustedStrict } from '../trust/snapshot.js';
import { agentsJson as renderAgentsJson } from '../adapters/claude-code.js';
import { trustFingerprint, verifyTrustRoot } from '../trust/verify.js';
import { cwdsUnder, processTable, runInGroup } from './process.js';
import { checkLaunchToken, spendLaunchToken } from './requests.js';
import { agentSessionDir, forgetSession, keepSession, restoreSession } from './session.js';
import { testedClaude } from '../redteam/tested.js';
import { progressLine, progressTracker } from './progress.js';
import { checkIgnoredCheckable, checkNothingHidden, checkPendingIgnored, findRole, IGNORED_ENTRY_BUDGET, ignoredState, recordPendingIgnored, scopeViolations, trustedRoles } from './scope.js';
import { familyNote, pickTier, pickVerifier } from './tiers.js';

// One agent run (unit 19a; D-12): the checks, the process, the end, the log. MIRAI's whole cage is in
// prepareLaunch; this decides whether to start at all, watches the first event, and leaves a true
// record. A verdict is what the run's own stream says: a file an agent wrote means nothing (R2-C1).

export const OUTCOME_EXIT = Object.freeze({ ok: EXIT.OK, 'agent-failed': EXIT.FAILURE, refused: EXIT.BLOCKED, 'env-fault': EXIT.NEEDS_HUMAN, 'usage-limit': EXIT.NEEDS_HUMAN, killed: EXIT.INTERRUPTED });
export const DEFAULT_MAX_TURNS = 40;
export const INIT_DEADLINE_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const KEEP_STREAMS = 50;
// How old the reading before a launch may be to count as its baseline (unit 20).
const BASELINE_MS = 30 * 60_000;
// The same weekly window, allowing for a reset time reported a minute apart.
const sameWindow = (a, b) => Boolean(a && b) && Math.abs((a.resets_at ?? 0) - (b.resets_at ?? 0)) <= 120;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

// Told to every agent (18d, 19a's R3): a long output is cut to a preview, and MIRAI's hook refuses a
// Read of the saved copy, as --restricted does of the scratch folder.
export const LONG_OUTPUTS = 'Long command output gets cut to a preview, and you can\'t read the saved copy. When a command may print a lot, redirect it to a file in $TMPDIR, then page it with Bash: tail, head, grep or sed -n. Test failures usually sit at the end.';

const refuse = (message, code, hint) => Object.assign(new MiraiError(message, EXIT.BLOCKED), { code, hint });

// Whether this launch may start, by the red team's result: throws, with its own code, unless it's
// green for this template and any blocker seen on this Claude Code and macOS has your signed decision.
export function checkRedTeam(status, store, readBlockerDecision = readDecision) {
  const hint = 'run it yourself: mirai redteam run';
  if (status.state !== 'green') throw refuse(`the red team isn't green for this launch: ${status.state}`, `redteam-${status.state}`, status.state === 'stale' ? `changed: ${status.changed.join(', ')}. ${hint}` : hint);
  if (status.blocker_seen && !readBlockerDecision(store, status.blocker_seen.id)) throw refuse(`a red-team run on this Claude Code and macOS found a blocker (${status.blocker_seen.created_at})`, 'redteam-blocker-seen', `read it (mirai redteam show ${status.blocker_seen.id}); to go on anyway: mirai redteam accept-blocker ${status.blocker_seen.id} --note <why>`);
}

function keepStream(store, launchId, text, token) {
  const dir = join(store.dir, 'agent-runs');
  ensurePrivateDir(dir);
  atomicWrite(join(dir, `${launchId}.jsonl`), redact(text, token));
  // Streams only, each with its evidence: the markers are kept.
  const all = readdirSync(dir).filter((n) => n.endsWith('.jsonl')).map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const old of all.slice(KEEP_STREAMS)) {
    rmSync(join(dir, old.n), { force: true });
    rmSync(join(dir, old.n.replace(/\.jsonl$/, '.scope.json')), { force: true });
  }
}

// The author launch's model and tier (the verifier ladder needs them), newest logs first; an
// unreadable log is passed over; refused if there's no such launch.
function authorRun(store, launchId) {
  const skipped = [];
  for (const id of runIds(store).slice().reverse()) {
    let lines;
    try {
      ({ lines } = readRunLog(store, id));
    } catch {
      skipped.push(id);
      continue;
    }
    const found = lines.find((l) => l.event === 'agent_run' && l.launch_id === launchId);
    if (found) return { model: found.model_used ?? found.model, tier: found.tier };
  }
  throw Object.assign(new UsageError(`no agent run ${JSON.stringify(String(launchId).slice(0, 40))} in this repo's log${skipped.length ? ` (${skipped.length} log(s) couldn't be read, such as ${skipped[0]})` : ''}`), { code: 'unknown-launch' });
}

// A model id as the log takes it: whatever Claude Code reported, made safe, so the line always writes.
const modelId = (m) => {
  const s = String(m).replace(/[^A-Za-z0-9._:@/[\]-]/g, '_').slice(0, 128);
  return /^[A-Za-z0-9]/.test(s) ? s : `x${s.slice(0, 127)}`;
};

// The run log takes only clean numbers: a run's work must never be lost to an odd one in its stream.
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);

// A crash of an earlier `mirai agent run` (a killed mirai, a power cut), found holding the run lock:
// the state still says `running`. Its agent, in its own session, may still be going: ended if it's
// the one on record, with a grace for its server to clean up. Its background jobs have groups of
// their own: any working in its scratch are killed, any in your checkout named. Nothing compared
// `.git` for that run, and the note says so.
async function takeOver(store) {
  const state = readRunState(store);
  if (state?.state !== 'running') return null;
  const file = join(store.dir, 'agent-runs', 'current.json');
  const notes = [];
  let was = null;
  try {
    was = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    notes.push('no agent on record');
  }
  if (was) {
    const started = spawnSync('/bin/ps', ['-p', String(was.pid), '-o', 'lstart='], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } }).stdout.trim();
    if (started && started === was.started) {
      const gone = () => !spawnSync('/bin/ps', ['-p', String(was.pid), '-o', 'pid='], { encoding: 'utf8' }).stdout.trim();
      try {
        process.kill(-was.pid, 'SIGTERM');
        for (let i = 0; i < 50 && !gone(); i++) await new Promise((done) => setTimeout(done, 200));
        if (!gone()) process.kill(-was.pid, 'SIGKILL');
      } catch {
        // gone in between
      }
      notes.push(`its agent (pid ${was.pid}) was still running, and was ended`);
    } else notes.push('its agent had already gone');
    const rows = (await processTable()) ?? [];
    const loose = rows.filter((p) => p.ppid === 1 && p.started >= (was.since ?? Infinity));
    if (loose.length) {
      const inScratch = was.scratchDir ? (await cwdsUnder([was.scratchDir])) ?? new Set() : new Set();
      const inProject = (await cwdsUnder([store.checkout])) ?? new Set();
      for (const p of loose) {
        if (inScratch.has(p.pid)) process.kill(p.pid, 'SIGKILL');
        else if (inProject.has(p.pid)) notes.push(`a process that may be its is still working in your project: pid ${p.pid}`);
      }
    }
    // Only a launch folder of this repo's: the path comes from a file.
    if (typeof was.launchDir === 'string' && dirname(was.launchDir) === realpathSync(join(store.repoHome, 'launches'))) removeLaunch(was.launchDir, was.scratchDir);
    rmSync(file, { force: true });
  }
  writeRunState(store, 'stopped', { clear: true });
  return `an earlier run (${state.run_id}) had crashed: ${notes.join('; ')}. Its result is unknown, and .git wasn't compared for it: look at your tree`;
}

// Claude Code's own tool for a structured result: --json-schema adds it to the init event (21a's R1).
export const STRUCTURED_TOOL = 'StructuredOutput';
// The tools a launch's init event must show: the template's, MIRAI's MCP tools, and the
// structured-output tool when a schema is passed.
export const launchTools = (template, { structured = false } = {}) => [...expectedInit(template).tools, ...(structured ? [STRUCTURED_TOOL] : [])].sort();

// Whether an agent may run under a role: its own, or a read-only one; and a read-only agent never
// under a role that may write (21a review: its own narrowing holds at the launch too).
export function checkAgentRole(def, role) {
  if (role.name !== def.role && role.mode !== 'read-only') throw refuse(`${def.name} is an ${def.role} agent: it may run as ${def.role} or under a read-only role, not as ${role.name}`, 'agent-role');
  if (def.read_only === true && role.mode !== 'read-only') throw refuse(`${def.name} is read-only: it can't run as ${role.name}, which may write`, 'agent-read-only');
}

// An agent's definition for this launch (unit 21a), from the trust root only: a branch's copy counts
// for nothing. It launches under its own role or a read-only one (Kai's plan step, as planner),
// never a role that may change more. Returns { name, json }.
export function agentFor(trust, name, role, template, { structured = false } = {}) {
  const registry = trustedRegistry(trust);
  if (!Object.hasOwn(registry.agents, name)) throw Object.assign(new UsageError(`there's no agent ${JSON.stringify(String(name).slice(0, 40))}; agents: ${Object.keys(registry.agents).sort().join(', ') || 'none'}`), { code: 'unknown-agent' });
  const def = registry.agents[name];
  checkAgentRole(def, role);
  const prompt = readFileSync(join(registry.dir, def.prompt));
  return { name, json: renderAgentsJson(def, prompt, launchTools(template, { structured })) };
}

function recordAgent(store, plan, pid) {
  const dir = join(store.dir, 'agent-runs');
  ensurePrivateDir(dir);
  const started = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } }).stdout.trim();
  atomicWrite(join(dir, 'current.json'), `${JSON.stringify({ pid, started, since: Math.floor(Date.now() / 1000) * 1000, launchDir: plan.launchDir, scratchDir: plan.scratchDir })}\n`);
}

// Returns { outcome, why, launchId, text, processes, line, tookOver }. Throws for a launch it refuses.
// `launchToken`: a one-time token minted in this process (unit 19c; D-14): your terminal, MIRAI's
// server's worker, or the orchestrator.
export async function runAgent(options) {
  const { cwd, env, signal = null, launchToken } = options;
  // Checked here, spent by launchInRun: no path launches without one.
  checkLaunchToken(launchToken);
  if (signal?.aborted) throw Object.assign(new MiraiError('stopped by you before it started', EXIT.INTERRUPTED), { code: 'interrupted' });
  return await withRun({ cwd, env }, ({ store, runId, tookOver }) => launchInRun({ ...options, store, runId, startRun: true, tookOver, ownsRun: true }));
}

// A run of one or more launches (runAgent's, and `mirai plan`'s): `fn({ store, runId, tookOver })`
// with the run lock held. The lock first: a crashed run is taken over with nothing else able to
// start, and before the checks, so its agent isn't left running because the tree it dirtied is
// refused.
export async function withRun({ cwd, env }, fn) {
  const store = openStore({ cwd, env });
  const runId = newRunId();
  const { release } = acquireRunLock(store, runId, env);
  try {
    const tookOver = await takeOver(store);
    return await fn({ store, runId, tookOver });
  } finally {
    release();
  }
}

// The red-team gate for a role, before anything is made for its launch (unit 21e: a refused build
// had already made and switched to its branch). The launch checks it again, as ever.
export async function preGate({ cwd, env, store, trust, role: roleName, claude = null, status = redTeamStatus }) {
  const role = findRole(trustedRoles(trust), roleName);
  const template = trustedStrict(trust, role.mode);
  const tested = claude ? null : await testedClaude({ env, store });
  const c = tested ? { path: tested.path, real: tested.real } : resolveClaude(env, claude);
  checkRedTeam(await status({ cwd, env, trust, template, claude: c.real }), store);
}

// One launch inside a run whose lock the caller holds (unit 19c, for unit 28's `mirai run`):
// every check, then the launch. With `startRun`, it starts the run state itself, as runAgent does.
export async function launchInRun({ cwd, env, store: given = null, runId, startRun: begin = false, ownsRun = false, tookOver = null, launchToken, agent = null, expectBase = null, role: roleName, step = null, risk = null, size = null, tier = null, verifies = null, fallbackClaude = null, onProgress = null, progressLabel = null, prompt, item = null, maxTurns = DEFAULT_MAX_TURNS, inputs = {}, jsonSchema = null, session = null, round = 1, signal = null, hardSignal = null, timeoutMs = DEFAULT_TIMEOUT_MS, initDeadlineMs = INIT_DEADLINE_MS, claude = null, status = redTeamStatus, launch = runInGroup, check = checkInit, now = () => new Date(), plan = 'unknown' }) {
  const stopped = () => {
    if (signal?.aborted) throw Object.assign(new MiraiError('stopped by you before it started', EXIT.INTERRUPTED), { code: 'interrupted' });
  };
  spendLaunchToken(launchToken);
  const store = given ?? openStore({ cwd, env });
  // The caller holds the run lock for this run: a launch never runs beside another.
  // The first sign of life (unit 21e): MIRAI's own checks before a launch take seconds.
  try {
    onProgress?.({ kind: 'preparing', agent: progressLabel ?? agent ?? roleName, model: null, turns: 0, minutes: 0 });
  } catch {
    // a display only
  }
  const holder = runLockHolder(env);
  if (!holder || holder.run_id !== runId || holder.pid !== process.pid || holder.repo_id !== store.repoId) throw refuse('a launch needs the run lock for its run, held by this process', 'no-run-lock');
  stopped();
  const trust = snapshot({ cwd, env });
  // A caller that read inputs from one commit launches on that same commit (21a review): the
  // integration branch may have moved in between.
  if (expectBase !== null && trust.baseSha !== expectBase) throw refuse(`the integration branch moved (${expectBase.slice(0, 12)} → ${trust.baseSha.slice(0, 12)}) since this launch's inputs were read`, 'base-moved', 'run it again');
  const role = findRole(trustedRoles(trust), roleName);
  const mode = role.mode;
  const template = trustedStrict(trust, mode);
  const config = trustedConfig(trust);
  const agentDef = agent === null ? null : agentFor(trust, agent, role, template, { structured: jsonSchema !== null });
  // The Claude Code the red team tested (unit 18g), never the PATH link the updater moves; one you
  // name (a test, a probe) as given. The gate below judges this same binary.
  // `fallbackClaude`: the broker worker's (found when your session server was registered), used only
  // while no tested one is kept (18g review: it had taken the test override's place).
  const tested = claude ? null : await testedClaude({ env, store });
  const c = tested ? { path: tested.path, real: tested.real, version: tested.version } : resolveClaude(env, claude ?? fallbackClaude);
  const picked = pickTier({ config, step: step ?? role.step, risk, size, asked: tier });
  let model = config.models?.[picked.tier];
  let rung = null;
  if (verifies) {
    if (role.mode !== 'read-only') throw new UsageError(`--verifies is for a role that checks work; ${role.name} changes it`);
    const author = authorRun(store, verifies);
    const v = pickVerifier({ config, tier: picked.tier, authorModel: author.model, authorTier: author.tier });
    ({ model, rung } = v);
    if (v.tier !== picked.tier) Object.assign(picked, { tier: v.tier, why: `${picked.why}; up to ${v.tier}, the author's tier` });
  }
  if (!model) throw new UsageError(`no model for the tier ${picked.tier} in the trust root's config`);
  if (!MODEL.test(model)) throw new UsageError(`the model ${JSON.stringify(model.slice(0, 40))} isn't a plain model id`);
  const changes = workTreeChanges(store.checkout, store.gitEnv);
  if (changes.length) throw refuse(`the work tree has ${changes.length} uncommitted change(s), so what an agent changes couldn't be told apart`, 'dirty-tree', 'commit or stash them first');
  checkNothingHidden(store.checkout, store.gitEnv);
  checkPendingIgnored(store);
  checkIgnoredCheckable(ignoredState(store.checkout, store.gitEnv));
  // The file it launches, not a link to it (18g re-review: an update could move a link in between).
  checkRedTeam(await status({ cwd, env, trust, template, claude: c.real }), store);
  stopped();
  if (begin) startRun(store, { runId, preset: config.preset, plan, now });
  const levels = [...Object.keys(config.checks ?? {}), ...(config.testing?.levels ?? []).map((l) => l.name)];
  return await launchAndLog({ store, env, trust, template, agentDef, c, model, runId, ownsRun, plan, mode, tier: picked.tier, why: picked.why, rung, role, step: picked.step, prompt, item, maxTurns, inputs, jsonSchema, session, round, signal, hardSignal, timeoutMs, initDeadlineMs, launch, check, tookOver, onProgress, progressLabel, levels });
}

async function launchAndLog({ store, env, trust, template, agentDef = null, c, model, runId, ownsRun, plan = 'unknown', mode, tier, why: tierWhy, rung, role, step, prompt, item, maxTurns, inputs, jsonSchema = null, session = null, round = 1, signal, hardSignal, timeoutMs, initDeadlineMs, launch, check, tookOver, onProgress = null, progressLabel = null, levels = null }) {
  let launched = null;
  let finished = false;
  let endState = 'stopped';
  let sessionClean = false;
  let spawned = false;
  let progress = () => {};
  let progressSeen = () => {};
  let progressEnd = () => {};
  let stopTrailing = () => {};
  let beat = null;
  try {
    // Right before the start: the whole trust root. The fingerprint comes first, so a change made
    // while this hashes shows up at the hook's first call.
    const fingerprint = trustFingerprint(trust.dir);
    verifyTrustRoot(trust);
    launched = prepareLaunch({ trust, template, checkout: store.checkout, env, item, inputs, fingerprint, ...(agentDef ? { agentsJson: agentDef.json, agent: agentDef.name } : {}) });
    launched.expectedInit.model = model;
    if (jsonSchema) launched.expectedInit.tools = launchTools(template, { structured: true });
    if (createHash('sha256').update(readFileSync(join(launched.launchDir, 'input', 'settings.json'))).digest('hex') !== launched.settingsSha256) throw refuse('the launch\'s settings changed before it started', 'settings-changed');
    // Progress (unit 21e): from the stream, filtered (src/agent/progress.js); to the caller, and as
    // the heartbeat's last line for `mirai status`, at most every few seconds. Never the run's cost.
    const tracker = progressTracker({ root: launched.cwd, agent: progressLabel ?? agentDef?.name ?? role.name, model, tools: launched.expectedInit.tools, levels });
    let lastLine;
    let lastBeat = 0;
    let trailing = null;
    // The run's liveness always lands: a ticket or step the heartbeat can't carry (an item such as
    // docs/prd.md from your session's start_agent) is left out, never the whole beat (21e review).
    const beatNow = () => {
      try {
        writeHeartbeat(store, { runId, ...(item ? { ticket: item } : {}), ...(step ? { step } : {}), ...(lastLine ? { progress: lastLine } : {}) });
      } catch {
        try {
          writeHeartbeat(store, { runId, ...(lastLine ? { progress: lastLine } : {}) });
        } catch {
          // a status detail; the run goes on
        }
      }
    };
    progress = (p) => {
      lastLine = progressLine(p).slice(0, 300);
      if (Date.now() - lastBeat > 5_000 || p.kind !== 'tool') {
        lastBeat = Date.now();
        beatNow();
      } else if (!trailing) {
        // A line inside the window still lands, at its end (21e review: status showed an older tool).
        trailing = setTimeout(() => {
          trailing = null;
          lastBeat = Date.now();
          beatNow();
        }, 5_000 - (Date.now() - lastBeat));
        trailing.unref?.();
      }
      stopTrailing = () => clearTimeout(trailing);
      try {
        onProgress?.(p);
      } catch {
        // the caller's display; the run goes on
      }
    };
    // The launch's last line lands now, and nothing of it comes later (21e re-review: a trailing beat
    // overwrote the check line MIRAI's tests had just written).
    progressEnd = (outcome) => {
      clearTimeout(trailing);
      trailing = null;
      progress(tracker.end(outcome));
      clearTimeout(trailing);
      trailing = null;
    };
    // Never at the run's cost: a stream event that can't be read as progress is no progress.
    progressSeen = (ev) => {
      try {
        // A launch whose init check failed is being stopped: not "started".
        if (ev?.type === 'system' && ev.subtype === 'init' && unsafe?.length) return;
        const p = tracker.seen(ev);
        if (p) progress(p);
      } catch {
        // a display only
      }
    };
    beatNow();
    beat = setInterval(beatNow, 60_000);
    beat.unref();
    // The ignored files as they are right before the start: the tree is clean, so a change after is
    // the run's, or something else's that ran meanwhile (the refusal says both).
    const before = ignoredState(store.checkout, store.gitEnv);
    // The last weekly usage reading before the start (unit 20), for this launch's measured share.
    // A broken readings file costs only precision, never the launch.
    let usageBefore = null;
    try {
      usageBefore = latestWeekly(env);
    } catch {
      usageBefore = null;
    }
    const launchedAt = Date.now();
    const started = Date.now();
    let unsafe = null;
    let health = false;
    let deadline = null;
    // Every init event is checked; any other event before the first one means no check was made.
    const judge = (ev) => {
      let problems;
      try {
        problems = check(ev, launched.expectedInit, { version: c.version });
      } catch (err) {
        problems = [`the init event can't be checked: ${err.message}`];
      }
      unsafe = [...(unsafe ?? []), ...problems];
      health = unsafe.length > 0 && unsafe.every((p) => HEALTH.test(p));
    };
    const onLine = (l, kill) => {
      let ev;
      try {
        ev = JSON.parse(l);
      } catch {
        return;
      }
      if (ev?.type === 'system' && ev.subtype === 'init') {
        judge(ev);
        if (unsafe.length) kill('init');
      } else if (unsafe === null && ['assistant', 'user'].includes(ev?.type)) {
        unsafe = ['it acted before any init event'];
        kill('init');
      }
      progressSeen(ev);
    };
    // A kept session (unit 21c): the ticket's own, in the store, and only the one the named launch
    // left. Restored into this launch's fresh config folder, then resumed. Where it lives is decided
    // here, in the cage, never by the caller (21c review).
    const configHome = join(launched.launchDir, 'claude-config');
    const sessionHome = session && item ? agentSessionDir(store, item) : null;
    const resumed = sessionHome && session.resumeFrom ? restoreSession({ src: sessionHome, configHome, launchId: session.resumeFrom }) : null;
    // After `--`, so a prompt that looks like a flag can't be one.
    // A structured result (unit 21a): Claude Code checks the answer against the schema.
    const args = ['-p', '--max-turns', String(maxTurns), '--model', model, '--append-system-prompt', LONG_OUTPUTS, ...(resumed ? ['--resume', resumed] : []), ...(jsonSchema ? ['--json-schema', JSON.stringify(jsonSchema)] : []), ...launched.args, '--', prompt];
    const raw = await launch(c.real, { args, env: { ...launched.env, DISABLE_AUTOUPDATER: '1' }, cwd: launched.cwd, fdToken: launched.fds[3] }, {
      signal, hardAbort: hardSignal, onLine, timeoutMs, killRoots: [launched.scratchDir], reportRoots: [launched.cwd],
      onStart: (pid, kill) => {
        spawned = true;
        recordAgent(store, launched, pid);
        deadline = setTimeout(() => {
          if (unsafe === null) kill('no-init');
        }, initDeadlineMs);
      },
    });
    clearTimeout(deadline);
    // The session, kept before the launch folder goes (unit 21c): never at the cost of the run.
    let kept = null;
    if (sessionHome && session.keep) {
      try {
        const init = raw.stdout.split('\n').map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        }).find((e) => e?.type === 'system' && e.subtype === 'init');
        kept = keepSession({ configHome, dest: sessionHome, sessionId: init?.session_id, launchId: launched.launchId });
      } catch (err) {
        kept = { kept: false, why: String(err.message).slice(0, 200) };
      }
    }
    const token = launched.fds[3];
    let repoChanged = null;
    const launchId = launched.launchId;
    const hashes = { settings: launched.settingsSha256, canonical: launched.canonicalSha256 };
    try {
      finishLaunch(launched);
    } catch (err) {
      repoChanged = err.message;
    }
    finished = true;
    // What the run changed, against its role: after its processes have ended.
    let scope;
    try {
      scope = scopeViolations({ root: store.checkout, env: store.gitEnv, role, before });
    } catch (err) {
      scope = { violations: [], partial: true, failed: err.message };
    }
    const parsed = parseStream(raw.stdout);
    keepStream(store, launchId, `${raw.stdout}\n`, token);
    const tokenLeaked = containsToken(`${raw.stdout}\n${raw.stderr}`, token);
    const text = redact(String(parsed.result?.result ?? ''), token);
    // Your usage, as Claude Code reported it in this stream (unit 20): kept globally, and a usage
    // limit is a pause for the run, never an agent's failure.
    const readings = rateLimits(raw.stdout);
    try {
      recordReadings(env, readings, { repoId: store.repoId, runId });
    } catch {
      // a reading lost costs only precision
    }
    // Only a limit the stream ends on: a window rejected along the way isn't what stopped the run.
    const lastReading = readings.at(-1);
    const limited = lastReading && usageLimit([lastReading]) ? lastReading : null;
    // A launch's share: the stream's own readings when it has two, else the last reading before
    // the launch, but only a fresh one of the same weekly window (19a's first run: one event per
    // stream). Anything else is unknown: never a day of other use booked as this launch's. It still
    // includes whatever else used the subscription at the same time.
    const weekly = readings.filter((r) => r.window === 'seven_day' && typeof r.utilization === 'number');
    const weeklyAfter = weekly.at(-1) ?? null;
    const baseline = weekly.length > 1 ? weekly[0]
      : usageBefore && freshReading(usageBefore, launchedAt) && launchedAt - Date.parse(usageBefore.ts) < BASELINE_MS && sameWindow(usageBefore, weeklyAfter) ? usageBefore : null;
    const share = baseline && weeklyAfter ? Math.max(0, Math.round((weeklyAfter.utilization - baseline.utilization) * 10000) / 100) : null;
    const succeeded = raw.exit === 0 && parsed.result?.type === 'result' && parsed.result.subtype === 'success' && parsed.result.is_error === false;
    // Only a run that failed: an agent's own text may well mention a 401.
    const needsRenewal = !succeeded && /\b401\b|authentication_error|invalid.{0,20}token/i.test(`${raw.stderr}\n${parsed.result?.is_error ? text : ''}`);
    const { survivors = [], suspects = [], unproven = [], unverified = false } = raw.processes ?? {};
    let outcome;
    let why = null;
    if (repoChanged) [outcome, why] = ['refused', repoChanged];
    else if (tokenLeaked) [outcome, why] = ['refused', 'the login token appeared in the run\'s output'];
    else if (scope.violations.length) [outcome, why] = ['refused', `these changed during the run, by the agent or something else, and the ${role.name} role may not change them (left as they are; the full list is in the store): ${scope.violations.slice(0, 20).join(', ')}${scope.violations.length > 20 ? ` and ${scope.violations.length - 20} more` : ''}`];
    else if (health) [outcome, why] = ['env-fault', `a part of the launch wasn't ready: ${unsafe.join('; ')}`];
    else if (unsafe?.length) [outcome, why] = ['refused', `the run wasn't what MIRAI launched: ${unsafe.join('; ')} (load ${loadavg()[0].toFixed(0)})`];
    else if (scope.failed) [outcome, why] = ['env-fault', `what it changed couldn't be checked: ${scope.failed}`];
    else if (scope.partial) [outcome, why] = ['env-fault', `there are more than ${IGNORED_ENTRY_BUDGET} ignored files, so not every change could be checked`];
    else if (raw.killedBy === 'interrupted') [outcome, why] = ['killed', 'stopped by you'];
    else if (raw.killedBy === 'no-init') [outcome, why] = ['env-fault', 'Claude Code said nothing to check in time'];
    else if (raw.timedOut) [outcome, why] = ['killed', 'it ran past its time limit'];
    else if (needsRenewal) [outcome, why] = ['env-fault', 'the login token was refused: renew it (claude setup-token, then mirai token set)'];
    else if (!parsed.init || unsafe === null) [outcome, why] = ['env-fault', `Claude Code never gave an init event to check (exit ${raw.exit})`];
    // A limit that stopped the run is a pause for the run, not the agent's failure; one reported on a
    // run that succeeded changes nothing about it.
    else if (limited && !succeeded && parsed.result?.subtype !== 'error_max_turns') [outcome, why] = ['usage-limit', `your ${limited.window.replace('_', '-')} usage limit was reached${limited.resets_at ? `; it resets at ${new Date(limited.resets_at * 1000).toISOString()}` : ''}`];
    else if (!succeeded) [outcome, why] = ['agent-failed', redact(String(parsed.result?.subtype ?? `exit ${raw.exit}, no result`), token)];
    else if (survivors.length) [outcome, why] = ['refused', `${survivors.length} of its processes outlived the end`];
    else if (suspects.length) [outcome, why] = ['refused', `a new process is working in your project, and may be the agent's (${suspects.join(', ')}): check it, and any change it makes`];
    else if (unverified) [outcome, why] = ['env-fault', 'its processes couldn\'t be checked (ps failed)'];
    else outcome = 'ok';
    if (outcome === 'ok') endState = 'finished';
    const usage = parsed.result?.usage ?? {};
    const line = {
      item: item ?? 'run', event: 'agent_run', launch_id: launchId, step, role: role.name, ...(agentDef ? { agent: agentDef.name } : {}), round: Number.isSafeInteger(round) && round > 0 ? round : 1, tier, model, tier_reason: tierWhy.slice(0, 300), ...(rung ? { rung } : {}), ...(parsed.init?.model ? { model_used: modelId(parsed.init.model) } : {}), scope_violations: scope.violations.length,
      // Cached input apart, as Claude Code reports it: it's most of a run's input.
      tokens_in: count(usage.input_tokens), tokens_cached: count(usage.cache_read_input_tokens) + count(usage.cache_creation_input_tokens), tokens_out: count(usage.output_tokens), turns: count(parsed.result?.num_turns), minutes: Math.round((Date.now() - started) / 600) / 100,
      ...(share === null ? { limit_share_source: 'unknown' } : { limit_share: share, limit_share_source: 'measured' }), ...(limited ? { limit_window: limited.window, ...(limited.resets_at ? { resets_at: new Date(limited.resets_at * 1000).toISOString() } : {}) } : {}), verdict: outcome === 'ok' ? 'pass' : outcome === 'agent-failed' ? 'fail' : 'error', outcome, survivors: survivors.length + suspects.length, unproven: unproven.length,
      settings_sha256: hashes.settings, canonical_sha256: hashes.canonical, token_fingerprint: tokenFingerprint(token),
      ...(Number.isFinite(parsed.result?.total_cost_usd) && parsed.result.total_cost_usd >= 0 ? { cost_usd: parsed.result.total_cost_usd } : {}),
    };
    const seq = withSeq(store, ({ take, runLine }) => {
      const n = take();
      runLine(runId, n, line);
      return n;
    });
    // The global ledger's delta, once per line (05b: never counted twice).
    if (share !== null) {
      try {
        appendUsage(env, { repoId: store.repoId, runId, plan, limitShare: share, kind: 'run', uptoSeq: seq });
      } catch {
        // the run log has it
      }
    }
    // After the log line, and never at its cost: the whole list, for you and unit 22, and a marker
    // so a planted ignored file can't pass on the next launch.
    try {
      if (scope.violations.length || scope.ignored?.length) atomicWrite(join(store.dir, 'agent-runs', `${launchId}.scope.json`), `${JSON.stringify({ role: role.name, violations: scope.violations, ignored_changed: scope.ignored ?? [], partial: scope.partial })}\n`);
      recordPendingIgnored(store, scope.ignoredViolations ?? []);
    } catch {
      // the outcome above already names them
    }
    // Whether a round spent on this launch may be given back (unit 20): only a fault decided before
    // the agent could act, or a usage limit. A fault found in what the agent did (its scope, its
    // processes) keeps the round, so an agent can't buy a free one.
    const refundable = outcome === 'usage-limit' || (outcome === 'env-fault' && (health || raw.killedBy === 'no-init' || !parsed.init || unsafe === null || needsRenewal));
    // The run's structured output, as its own stream reported it (never a file it wrote).
    const structured = parsed.result?.structured_output ?? null;
    // Only a clean launch's session is kept (21c review): one that hit a stop, or a resume Claude Code
    // refused, is forgotten, so the next round starts fresh instead of repeating it.
    sessionClean = outcome === 'ok' && !scope.violations.length;
    progressEnd(outcome === 'ok' ? 'handed over' : outcome);
    if (kept?.kept && !sessionClean) kept = { kept: false, why: `the launch ended ${outcome}` };
    return { outcome, why, launchId, text, structured, resumed, kept, processes: raw.processes, line, tookOver, scope, refundable, family: familyNote(tier, parsed.init?.model ?? model) };
  } catch (err) {
    // Thrown after Claude Code started: the agent ran, so a caller never gives its round back (21c
    // re-review).
    if (spawned && err && typeof err === 'object') err.launched = true;
    throw err;
  } finally {
    stopTrailing();
    progressEnd = () => {};
    clearInterval(beat);
    rmSync(join(store.dir, 'agent-runs', 'current.json'), { force: true });
    // A launch that started and didn't end clean leaves no session; one refused before it started
    // leaves the last step's as it was.
    if (session?.keep && item && spawned && !sessionClean) forgetSession(agentSessionDir(store, item));
    if (launched && !finished) {
      try {
        finishLaunch(launched);
      } catch {
        // the launch never ran, or the throw above says why
      }
    }
    // Only the run's owner ends it: inside unit 28's run, the next launch carries on (19c review).
    if (ownsRun) writeRunState(store, endState, { clear: true });
  }
}
