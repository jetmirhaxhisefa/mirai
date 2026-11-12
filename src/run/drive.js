import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { recordBaseline } from '../baseline/record.js';
import { runBuild, buildRecordPath } from '../agent/build.js';
import { fixFrom, CARRIED, runFix } from '../agent/fix.js';
import { planApproval, planPath, runPlan } from '../agent/plan.js';
import { mintLaunchToken } from '../agent/requests.js';
import { reviewsOf, runReview } from '../agent/review.js';
import { launchInRun, takeOver } from '../agent/run.js';
import { checkProofs } from '../proofs/check.js';
import { recordProofs } from '../proofs/record.js';
import { protectionRules } from '../trust/protected.js';
import { recordFault } from '../loop/guard.js';
import { usageCheck } from '../loop/ledger.js';
import { shipTicket } from '../ship/ship.js';
import { contentHash } from '../sign/sign.js';
import { branchKeys } from '../sign/keys.js';
import { acquireRunLock } from '../store/global.js';
import { commitOf, isAncestor, symbolicBranch, switchBranch, workTreeChanges } from '../store/git.js';
import { openStore } from '../store/home.js';
import { readJournal, ticketFacts, withSeq } from '../store/journal.js';
import { newRunId, readRunState, recordProgress, startRun, writeHeartbeat, writeRunState } from '../store/run.js';
import { readRunLog } from '../store/run-log.js';
import { readTicketStatus } from '../store/tickets.js';
import { snapshot, trustedConfig, trustedRegistry } from '../trust/snapshot.js';
import { waitForReset } from './pause.js';

// `mirai run <ticket>` (unit 28; design/01 §14, D-07's run machine): one ticket from wherever it is
// to its merge request, under one run and one lock, stopping only where you're needed. The next step
// is read from the ticket's state every time, never remembered, so running it again after any stop
// (or a crash) is the same command. Every step is the step's own function, unchanged; this only
// chains them, decides from their outcome words, and stops with one line saying what to do next.

const fail = (message, code, hint, exit = EXIT.BLOCKED) => Object.assign(new MiraiError(message, exit), { code, hint });

// At most this many steps in one run: a step that keeps coming back is a bug, never a loop.
export const MAX_STEPS = 40;
const REFUSED_STATES = Object.freeze({
  draft: 'a draft isn\'t ready to build: approve the ticket first (mirai approve <ticket> --file <path>)',
  dropped: 'it was dropped',
  done: 'it\'s done',
  waiting: 'it waits for another ticket (stacking, unit 53)',
});

// What to do next for `ticket`, from the store and the checkout (the spec's table). Returns
// { step } for a step to run, or { stop: { kind, why, next } } for a stop, or { done: { mr } }.
export function nextStep({ store, ticket, trust, config, keys }) {
  const status = readTicketStatus(store, ticket)?.status ?? null;
  if (!status) throw fail(`${ticket} has no status in MIRAI`, 'unknown-ticket', `approve the ticket first: mirai approve ${ticket} --file <path>`);
  if (REFUSED_STATES[status.state]) throw fail(`${ticket} is ${status.state}: ${REFUSED_STATES[status.state]}`, 'not-runnable');
  if (status.state === 'blocked') return { stop: { kind: 'parked', why: `${ticket} is parked (${status.park_reason ?? 'no reason'})${status.note ? `: ${status.note}` : ''}`, next: `look at it: mirai show ${ticket}; then mirai unpark ${ticket}` } };
  if (status.state === 'ready-for-dev') return { step: 'plan' };
  let last = null;
  try {
    last = JSON.parse(readFileSync(buildRecordPath(store, ticket), 'utf8'));
  } catch {
    last = null;
  }
  if (status.state === 'in-progress') {
    if (!existsSync(planPath(store, ticket))) return { stop: { kind: 'needs-you', why: `${ticket} is in-progress with no plan`, next: `mirai show ${ticket}` } };
    const plan = readFileSync(planPath(store, ticket));
    if (!planApproval(store, ticket, keys).ok) return { stop: { kind: 'gate-plan', why: `${ticket}'s plan waits for your approval`, next: `read it, then: mirai approve ${ticket} --plan` } };
    if (!last || last.plan_sha256 !== contentHash(plan)) return { step: 'build' };
    if (fixFrom(store, ticket, last)) return { step: 'fix' };
    if (CARRIED.includes(last.outcome)) return { step: 'build' };
    return { stop: { kind: 'needs-you', why: `${ticket}'s last step ended ${last.outcome}${last.why ? `: ${last.why}` : ''}`, next: `look at it (mirai show ${ticket}), then mirai build ${ticket}, mirai discard ${ticket} or mirai unpark ${ticket}` } };
  }
  if (status.state === 'in-review') {
    const branch = last?.branch;
    if (typeof branch !== 'string') return { stop: { kind: 'needs-you', why: `${ticket} is in-review with no branch MIRAI built`, next: `mirai show ${ticket}` } };
    const head = commitOf(store.checkout, `refs/heads/${branch}`, store.gitEnv);
    const facts = ticketFacts(readJournal(store).events, ticket);
    if (facts.mr === 'open' && facts.proofsValidAtHead === true && facts.head === head) return { done: { mr: facts.url ?? null, branch } };
    // Proofs valid at the head: ship. (Minting them adds a records-only commit, so the review's
    // own commit is behind the head from then on.)
    const proofs = checkProofs({ root: store.checkout, env: store.gitEnv, ticket, commit: head, integration: trust.baseSha, codePaths: config.gate?.code_paths, keys, repoId: store.repoId, rules: protectionRules(trustedRegistry(trust), config).rules, docsRoot: config.docs?.root });
    if (proofs.outcome === 'pass') return { step: 'ship', branch };
    // A passed, complete review of this branch's code: the proofs (they refuse a review whose code
    // changed since, `review-stale`).
    const latest = reviewsOf(store, ticket).at(-1)?.record ?? null;
    const onBranch = latest?.commit && head && (latest.commit === head || isAncestor(store.checkout, latest.commit, head, store.gitEnv));
    if (latest && onBranch && latest.complete === true && latest.outcome === 'pass') return { step: 'proofs', branch };
    if (latest && latest.commit === head && latest.outcome === 'needs-you') return { stop: { kind: 'needs-you', why: `Rex's review of ${ticket} stopped for you: ${latest.why ?? 'a protected path'}`, next: `mirai show ${ticket}` } };
    return { step: 'review', branch };
  }
  return { stop: { kind: 'needs-you', why: `${ticket} is ${status.state}`, next: `mirai show ${ticket}` } };
}

// Keeps the Mac awake for the run (R-M6): caffeinate watches this process, so it ends with it,
// even after a crash. A machine without it runs on, with a note.
export function stayAwake({ path = '/usr/bin/caffeinate', spawnFn = spawn } = {}) {
  if (!existsSync(path)) return { stop: () => {}, note: `${path} isn't here, so the Mac may sleep during the run` };
  try {
    const child = spawnFn(path, ['-i', '-w', String(process.pid)], { stdio: 'ignore', detached: false });
    child.unref?.();
    child.on?.('error', () => {});
    return { stop: () => { try { child.kill('SIGTERM'); } catch { /* gone */ } }, note: null, pid: child.pid };
  } catch (err) {
    return { stop: () => {}, note: `caffeinate didn't start (${err.message})` };
  }
}

// Your usage reading is out of date (usageCheck's `probe`): one Haiku launch with no tools and one
// turn reads it (D-18's probe; your decision 1A in unit 20). Readings only come from launches.
export async function probeUsage({ cwd, env, store, runId, launchOptions = {} }) {
  const r = await launchInRun({
    cwd, env, store, runId, launchToken: mintLaunchToken(), role: 'verifier', tier: 'light', item: 'run', maxTurns: 1,
    prompt: 'Reply with the single word OK. Use no tools.', ...(launchOptions.claude ? { claude: launchOptions.claude } : {}), ...(launchOptions.status ? { status: launchOptions.status } : {}),
  });
  return { outcome: r.outcome, why: r.why ?? null, line: r.line ?? null };
}

// The step functions, replaceable in tests.
export const STEPS = Object.freeze({ runPlan, runBuild, runFix, runReview, recordProofs, shipTicket, recordBaseline, probeUsage });

// One step, under the run. Returns its result with `outcome` (and `launch`/`launches` as the step
// gives them). A thrown refusal is left to the caller.
async function runStep(step, { cwd, env, ticket, run, launchOptions, steps }) {
  const common = { cwd, env, ticket, run, launchOptions };
  switch (step) {
    case 'plan': return await steps.runPlan({ ...common, launchTokens: [mintLaunchToken(), mintLaunchToken()] });
    case 'build': return await steps.runBuild({ ...common, launchToken: mintLaunchToken() });
    case 'fix': return await steps.runFix({ ...common, nextToken: mintLaunchToken });
    case 'review': return await steps.runReview({ ...common, launchToken: mintLaunchToken(), nextToken: mintLaunchToken });
    case 'proofs': return await steps.recordProofs({ cwd, env, ticket, signal: launchOptions.signal ?? null, onCheck: launchOptions.onCheck ?? null });
    case 'ship': return await steps.shipTicket({ cwd, env, ticket, ...(launchOptions.hostOf ? { hostOf: launchOptions.hostOf } : {}) });
    default: throw new TypeError(`no step ${step}`);
  }
}

// The launch line a step's result carries last (a usage limit or a fault is decided from it).
const lastLaunch = (r) => r?.launch ?? r?.launches?.at(-1) ?? r?.rounds?.at(-1)?.launch ?? null;

// What a step's outcome means for the run: 'go' (decide again), or a stop.
export function afterStep(step, r, ticket) {
  const o = r.outcome;
  const why = r.why ?? null;
  const stop = (kind, next, w = why) => ({ stop: { kind, why: `${step} of ${ticket}: ${o}${w ? `: ${w}` : ''}`, next } });
  if (o === 'usage-limit') return { limit: true };
  // An environment fault runs the step again; the breaker (loop.breaker in a row) stops the run.
  if (o === 'env-fault') return { go: true };
  if (o === 'killed') return stop('interrupted', `continue: mirai resume (or mirai run ${ticket})`);
  if (o === 'parked' || o === 'bad-plan') return stop('parked', `look at it: mirai show ${ticket}; then mirai unpark ${ticket}`);
  switch (step) {
    case 'plan': return o === 'waiting' ? stop('gate-plan', `read the plan, then: mirai approve ${ticket} --plan; then mirai run ${ticket}`, r.gate?.why?.join('; ') ?? null) : stop('needs-you', `mirai show ${ticket}`);
    case 'build': return ['handed-over', 'checks-failed'].includes(o) ? { go: true } : stop('needs-you', `look at it (mirai show ${ticket}), then mirai run ${ticket} again`);
    case 'fix': return ['handed-over', 'checks-failed', 'replan'].includes(o) || (o === 'needs-you' && /rounds in one command/.test(why ?? '')) ? { go: true } : stop('needs-you', `look at it (mirai show ${ticket}), then mirai run ${ticket} again`);
    case 'review': return ['pass', 'changes', 'replan'].includes(o) ? { go: true } : stop('needs-you', `look at it (mirai show ${ticket}), then mirai run ${ticket} again`);
    case 'proofs': return o === 'recorded' ? { go: true } : stop('needs-you', `look at it (mirai show ${ticket}); the failing tests are above`);
    case 'ship': return ['opened', 'updated', 'unchanged'].includes(o) ? { shipped: true } : stop('needs-you', `mirai show ${ticket}`);
    default: return stop('needs-you', `mirai show ${ticket}`);
  }
}

// Where the run may start: the integration branch with a clean tree, or the ticket's own branch.
function checkStart(store, ticket, trust) {
  if (workTreeChanges(store.checkout, store.gitEnv).length) throw fail('the work tree has uncommitted changes', 'dirty-tree', 'commit or stash them first');
  const here = symbolicBranch(store.checkout, 'HEAD', store.gitEnv);
  if (here === trust.branch) return;
  let last = null;
  try {
    last = JSON.parse(readFileSync(buildRecordPath(store, ticket), 'utf8'));
  } catch {
    last = null;
  }
  if (last?.branch && here === last.branch) return;
  throw fail(`the checkout is on ${here ?? 'no branch'}; a run starts on ${trust.branch} or on ${ticket}'s own branch`, 'wrong-branch', `git switch ${last?.branch ?? trust.branch}`);
}

// A stopped run of another ticket is open until it's resumed or given up (decision 6).
export function openStoppedRun(store) {
  const s = readRunState(store);
  return s && s.state === 'stopped' && s.ticket && s.abandoned !== true ? s : null;
}

// The run. `via`: 'terminal' or 'session'. `resume`: { runId, move(store) } to continue a stopped
// run: `move` makes your stopped → running move (signed, or request-confirmed). Returns
// { ticket, runId, outcome: 'finished' | 'stopped', stop, steps, mr, branch, notes }.
export async function driveTicket({ cwd, env, ticket, via = 'terminal', resume = null, launchOptions = {}, steps = STEPS, onEvent = () => {}, now = () => new Date(), sleep, caffeinate = stayAwake, configOverride = null }) {
  const store = openStore({ cwd, env });
  const notes = [];
  const say = (e) => {
    try {
      onEvent(e);
    } catch {
      // a display only
    }
  };
  // Another ticket's stopped run is resumed or given up first.
  const open = openStoppedRun(store);
  if (!resume && open && open.ticket !== ticket) throw fail(`a stopped run of ${open.ticket} (${open.run_id}) isn't finished`, 'run-open', `continue it: mirai resume; or give it up: mirai resume --abandon`);
  const runId = resume?.runId ?? newRunId(now());
  const { release } = acquireRunLock(store, runId, env);
  let awake = { stop: () => {} };
  const done = [];
  let endState = 'stopped';
  let stopped = null;
  let mr = null;
  let branch = null;
  try {
    const took = await takeOver(store);
    if (took) notes.push(took);
    const trust0 = snapshot({ cwd, env });
    checkStart(store, ticket, trust0);
    const config0 = configOverride ?? trustedConfig(trust0);
    if (resume) {
      // Your move (decision 6): after the takeover above, so a crashed run is stopped first; signed
      // from your terminal, or confirmed by your session's request (`resume.move`).
      const s = readRunState(store);
      if (s?.state !== 'stopped' || s.run_id !== runId) throw fail(`run ${runId} isn't stopped (it's ${s?.run_id === runId ? s.state : 'not the last run'})`, 'not-resumable');
      resume.move(store);
    } else {
      // A new run, over a stopped one of this same ticket, which it carries on (decision 1).
      startRun(store, { runId, preset: config0.preset ?? 'supervised', now });
    }
    recordProgress(store, { ticket });
    awake = caffeinate();
    if (awake.note) notes.push(awake.note);
  } catch (err) {
    // A refusal before the first step: the run (if it started) ends stopped, nothing else is left.
    awake.stop();
    try {
      const s = readRunState(store);
      if (s?.run_id === runId && s.state === 'running') writeRunState(store, 'stopped', { ticket });
    } finally {
      release();
    }
    throw err;
  }
  try {
    // An out-of-date usage reading is refreshed before the first launch (decision 5's settings:
    // usage.stale_hours). A probe that fails is a note: your terminal warns, as before.
    if (usageCheck({ env, unattended: false }).probe && steps.probeUsage) {
      say({ type: 'step', step: 'usage-check', ticket });
      try {
        const p = await steps.probeUsage({ cwd, env, store, runId, launchOptions });
        if (p.outcome === 'usage-limit') {
          const w = await waitForReset({ store, runId, ticket, step: 'usage-check', line: p.line, config: configOverride ?? trustedConfig(snapshot({ cwd, env })), signal: launchOptions.signal ?? null, now, sleep, say, env });
          if (w.stop) stopped = w.stop;
        } else if (p.outcome !== 'ok') notes.push(`the usage check launch ended ${p.outcome}${p.why ? `: ${p.why}` : ''}`);
      } catch (err) {
        notes.push(`the usage check launch was refused: ${err.message}`);
      }
    }
    for (let i = 0; i < MAX_STEPS && !stopped; i++) {
      if (launchOptions.signal?.aborted) {
        stopped = { kind: 'interrupted', why: 'stopped by you', next: 'continue: mirai resume' };
        break;
      }
      const trust = snapshot({ cwd, env });
      const config = configOverride ?? trustedConfig(trust);
      const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
      const n = nextStep({ store, ticket, trust, config, keys });
      if (n.done) {
        mr = n.done.mr;
        branch = n.done.branch;
        endState = 'finished';
        break;
      }
      if (n.stop) {
        stopped = n.stop;
        break;
      }
      // The session stops before your key signs (decision 2).
      if (n.step === 'proofs' && via === 'session') {
        stopped = { kind: 'gate-proofs', why: `${ticket}'s review passed; its proofs are signed with your key, in your terminal only (until row 29b)`, next: `in your terminal: mirai gate record ${ticket}; then /mirai run ${ticket}` };
        break;
      }
      // The ticket's branch, for the steps that work on it.
      if (n.branch && symbolicBranch(store.checkout, 'HEAD', store.gitEnv) !== n.branch) switchBranch(store.checkout, n.branch, null, store.gitEnv);
      // The baseline before a build from the integration branch (decision 4a): reused when this
      // commit has one; never allowed to grow without you.
      if (n.step === 'build' && symbolicBranch(store.checkout, 'HEAD', store.gitEnv) === trust.branch) {
        say({ type: 'step', step: 'baseline', ticket });
        let b;
        try {
          b = await steps.recordBaseline({ cwd, env, refuseGrowth: true, onEvent: (e) => say({ type: 'baseline', event: e }) });
        } catch (err) {
          stopped = { kind: 'baseline', why: `the baseline of ${trust.branch}: ${err.message}`, next: err.hint ?? `look at it, then: mirai baseline` };
          break;
        }
        if (b.baseline?.complete === false) {
          stopped = { kind: 'baseline', why: `the baseline of ${trust.branch} is incomplete`, next: 'mirai baseline show, then mirai baseline' };
          break;
        }
      }
      say({ type: 'step', step: n.step, ticket });
      recordProgress(store, { ticket, step: n.step });
      writeHeartbeat(store, { runId, ticket, step: n.step });
      let r;
      try {
        r = await runStep(n.step, { cwd, env, ticket, run: { store, runId }, launchOptions, steps });
      } catch (err) {
        stopped = { kind: err?.code?.startsWith?.('usage-') ? 'limit' : 'refused', why: `${n.step} of ${ticket}: ${err.message}`, next: err.hint ?? `mirai show ${ticket}`, code: err.code ?? null, exit: err.exitCode ?? null };
        break;
      }
      done.push({ step: n.step, outcome: r.outcome, why: r.why ?? null });
      say({ type: 'step-done', step: n.step, ticket, outcome: r.outcome, why: r.why ?? null, result: r });
      // The breaker (D-18): faults in a row across the run's launches; a good launch resets it.
      const launch = lastLaunch(r);
      if (launch || r.outcome === 'env-fault') {
        const fault = launch?.outcome === 'env-fault' || r.outcome === 'env-fault';
        const b = recordFault(store, runId, { fault, limit: config.loop?.breaker ?? 3 });
        if (b.trip) {
          stopped = { kind: 'breaker', why: `${b.count} environment faults in a row (the last: ${launch?.why ?? r.why ?? 'see the run log'})`, next: 'fix what the faults name (Docker, the login, the machine), then: mirai resume' };
          break;
        }
      }
      const a = afterStep(n.step, r, ticket);
      if (a.limit) {
        const line = launch?.line ?? null;
        const w = await waitForReset({ store, runId, ticket, step: n.step, line, config, signal: launchOptions.signal ?? null, now, sleep, say, env });
        if (w.stop) {
          stopped = w.stop;
          break;
        }
        continue;
      }
      if (a.shipped) {
        mr = r.mr?.url ?? null;
        branch = r.branch ?? null;
        endState = 'finished';
        break;
      }
      if (a.stop) {
        stopped = a.stop;
        break;
      }
    }
    if (!stopped && endState !== 'finished') stopped = { kind: 'needs-you', why: `${MAX_STEPS} steps in one run`, next: `mirai show ${ticket}` };
  } finally {
    try {
      // After the MR, back on the integration branch with a clean tree (design/03).
      if (endState === 'finished') {
        const t = snapshot({ cwd, env });
        if (!workTreeChanges(store.checkout, store.gitEnv).length && symbolicBranch(store.checkout, 'HEAD', store.gitEnv) !== t.branch) switchBranch(store.checkout, t.branch, null, store.gitEnv);
      }
    } catch (err) {
      notes.push(`couldn't switch back to the integration branch: ${err.message}`);
    }
    try {
      const s = readRunState(store);
      if (s?.run_id === runId && ['running', 'paused'].includes(s.state)) writeRunState(store, endState, { ticket });
      // The run's whole measured share (D-57), from its own launch lines.
      let share = 0;
      try {
        share = readRunLog(store, runId).lines.filter((l) => l.event === 'agent_run' && typeof l.limit_share === 'number').reduce((t, l) => t + l.limit_share, 0);
      } catch {
        share = 0;
      }
      withSeq(store, ({ take, runLine }) => runLine(runId, take(), { item: 'run', event: 'run_finished', tickets_done: endState === 'finished' ? 1 : 0, tickets_parked: stopped?.kind === 'parked' ? 1 : 0, limit_share: Math.min(100, Math.round(share * 100) / 100) }));
    } finally {
      awake.stop();
      release();
    }
  }
  const here = symbolicBranch(store.checkout, 'HEAD', store.gitEnv);
  return { ticket, runId, outcome: endState, stop: stopped, steps: done, mr, branch: branch ?? here, here, notes };
}
