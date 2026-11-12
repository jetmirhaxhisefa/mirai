import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { againstBaseline } from '../baseline/compare.js';
import { knownFailures, readBaseline } from '../baseline/store.js';
import { INPUT_LIMITS } from '../launch/strict.js';
import { readFrontmatter } from '../lint/frontmatter.js';
import { tableIn } from '../lint/checks.js';
import { scanMarkdown } from '../lint/markdown.js';
import { parkTicket } from '../loop/park.js';
import { beforeLaunch, settleLaunch } from '../loop/guard.js';
import { usageCheck, usageStop } from '../loop/ledger.js';
import { TICKET } from '../status/machines.js';
import { move } from '../status/move.js';
import { branchKeys } from '../sign/keys.js';
import { contentHash } from '../sign/sign.js';
import { atomicWrite, ensurePrivateDir, readPrivateFile } from '../store/files.js';
import { commitOf, lsTree, symbolicBranch } from '../store/git.js';
import { withSeq } from '../store/journal.js';
import { readRunState, writeRunState } from '../store/run.js';
import { readTicketStatus, writeTicketStatus } from '../store/tickets.js';
import { runTest } from '../tests/run.js';
import { changeOf, classify, ignoredFingerprint, protectionRules } from '../trust/protected.js';
import { snapshot, trustedConfig, trustedRegistry } from '../trust/snapshot.js';
import { branchName, prepareBranch, ticketSlug } from './branch.js';
import { checkLine } from './progress.js';
import { verifyBranchAt } from '../store/branch-record.js';
import { writeHeartbeat } from '../store/run.js';
import { addCheckpoint } from './checkpoints.js';
import { commitStep } from './commit.js';
import { loadSigner } from '../sign/signer.js';
import { newDependencies } from './deps.js';
import { planInputs } from './inputs.js';
import { AGENT, AGENT_LABEL, declaredChanges, LAUNCH_OPTIONS, planApproval, ticketRecord } from './plan.js';
import { checkLaunchToken } from './requests.js';
import { inRun, launchInRun, preGate } from './run.js';
import { checkNothingHidden } from './scope.js';

// The build step (unit 21b; design/01 §7, R-M4, R3-C2, R3-M2). Kai, as author, works from the plan
// you approved, on the ticket's own branch, and runs the tests and checks itself through MIRAI's
// server before it hands over: what fails inside its session costs no round. Then MIRAI checks
// what it did: the launch's own checks (19a, 19b), protected paths against the plan's declared
// ones, new dependencies against the plan's, and a test run of its own, judged against your
// baseline. Nothing is committed (unit 22); a refused run's files stay for you.

export const BUILD_ROLE = 'author';
export const BUILD_MAX_TURNS = 150;
export const BUILD_TIMEOUT_MS = 60 * 60_000;
export const HANDOVER_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    summary: { type: 'string', description: 'what you changed, file by file, in a few lines' },
    tests_run: { type: 'array', items: { type: 'string' }, description: 'the test levels or files you ran, with their results' },
    checks_run: { type: 'array', items: { type: 'string' }, description: 'the named checks you ran, with their results' },
    blocked_reason: { type: 'string', description: 'with status blocked: why you stopped' },
  },
  required: ['status', 'summary'],
  additionalProperties: false,
});

const fail = (message, code, exit = EXIT.BLOCKED, hint) => Object.assign(new MiraiError(message, exit), { code, hint });
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max) : null);

// The handover from the run's structured output, or { problem }. A file the agent wrote is never it.
export function handoverFrom(structured) {
  const s = structured;
  if (s === null || typeof s !== 'object' || Array.isArray(s)) return { problem: 'the run\'s structured output has no handover' };
  if (Object.keys(s).some((k) => !Object.hasOwn(HANDOVER_SCHEMA.properties, k))) return { problem: 'the handover has fields MIRAI doesn\'t take' };
  if (!['done', 'blocked'].includes(s.status) || typeof s.summary !== 'string') return { problem: 'the handover needs a status (done or blocked) and a summary' };
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 50).map((x) => text(x, 300)) : []);
  return { status: s.status, summary: text(s.summary, 4000), tests_run: list(s.tests_run), checks_run: list(s.checks_run), blocked_reason: text(s.blocked_reason, 1000) };
}

export function buildPrompt({ ticket, branch }) {
  return [
    `Your step: build. The ticket: ${ticket}. You're on its branch, ${branch}.`,
    'The input folder holds plan.md (the plan the human approved: your only source of truth), ticket.md and index.json.',
    'Follow the plan\'s tasks and test list. Write tests the way this project already does. Change nothing the plan doesn\'t name, add no dependency it doesn\'t declare, and never commit.',
    'Before you hand over, run the tests with mcp__mirai__run_tests and the named checks with mcp__mirai__run_check, and fix what fails.',
    'Hand over with your structured output: status done, or blocked with the reason when you can\'t go on without guessing.',
  ].join('\n');
}

// MIRAI's own test run after a handover: every named check, then every test level, each judged
// against the baseline for `base` (D-45). { verdict: 'pass' | 'fail' | 'unknown', runs, why? }.
// No baseline is never green, even when every run passed (the spec; 21b review), and a baseline
// that doesn't verify stops (`baseline-invalid`): it may have been tampered with. Until unit 23's
// floor guard, a level that ran fewer tests, or skipped more, than at baseline can't be called
// green either: deleting or skipping a test must not buy a pass (21b review).
export async function testsAfter({ cwd, env, store, trust, config, keys, base, run = runTest, signal = null, onCheck = null }) {
  const names = [...Object.keys(config.checks ?? {}).sort(), ...(config.testing?.levels ?? []).map((l) => l.name)];
  const baseline = readBaseline(store, base, { keys });
  const runs = [];
  // Each check and level as it starts and ends (unit 21e); a display only, never the run's cost.
  const told = (c) => {
    try {
      onCheck?.(c);
    } catch {
      // the caller's display
    }
  };
  for (const name of names) {
    let result;
    const startedAt = Date.now();
    told({ kind: 'check', name, state: 'running' });
    try {
      result = await run({ cwd, env, name, store, trust, by: 'build', signal });
    } catch (err) {
      result = err.result ?? { outcome: 'env-fault', code: err.code ?? 'error', message: String(err.message).slice(0, 300) };
    }
    let judged = againstBaseline(result, baseline ? knownFailures(baseline, name) : null);
    const then = baseline?.levels?.[name]?.tests;
    const now = result.tests;
    if (judged.verdict === 'pass' && then && now && ((now.total ?? 0) < (then.total ?? 0) || (now.skipped ?? 0) > (then.skipped ?? 0))) {
      judged = { verdict: 'unknown', fresh: [], why: `fewer tests ran (${now.total ?? 0} against ${then.total ?? 0}) or more were skipped (${now.skipped ?? 0} against ${then.skipped ?? 0}) than at baseline` };
    } else if (judged.verdict === 'pass' && Boolean(then) !== Boolean(now)) {
      judged = { verdict: 'unknown', fresh: [], why: `its test counts can't be compared with the baseline's (${then ? 'none now' : 'none at baseline'})` };
    }
    // What a fix round is given (unit 21c): the failing tests' messages and the output's tail,
    // from MIRAI's own run, capped, the new failures first (21c re-review).
    const isNew = new Set(judged.fresh ?? []);
    const failing = Array.isArray(result.failing) ? [...result.failing].sort((a, b) => Number(isNew.has(b.id ?? b.name)) - Number(isNew.has(a.id ?? a.name))).slice(0, 50).map((f) => ({ id: f.id ?? null, ...(f.name ? { name: f.name } : {}), kind: f.kind ?? null, message: typeof f.message === 'string' ? f.message.slice(0, 500) : null })) : [];
    const tail = typeof result.output?.tail === 'string' ? result.output.tail.slice(-4000) : null;
    runs.push({ name, outcome: result.outcome, id: result.id ?? null, tests: now ?? null, ...judged, ...(judged.verdict === 'fail' ? { failing, output_tail: tail } : {}) });
    told({ kind: 'check', name, state: judged.verdict === 'fail' ? `fail (${(judged.fresh ?? []).length} new)` : judged.verdict === 'pass' && result.outcome === 'fail' ? 'pass, only known failures' : judged.verdict === 'unknown' ? `unknown${judged.why ? `: ${String(judged.why).slice(0, 80)}` : ''}` : judged.verdict, seconds: (Date.now() - startedAt) / 1000 });
  }
  const incomplete = baseline && baseline.complete === false;
  const verdict = runs.some((r) => r.verdict === 'fail') ? 'fail' : !baseline || incomplete || names.length === 0 || runs.some((r) => r.verdict === 'unknown') ? 'unknown' : 'pass';
  const why = names.length === 0 ? 'the project has no named checks or test levels' : !baseline ? `there's no baseline for ${base.slice(0, 12)}: record it on the integration branch (mirai baseline)` : incomplete ? `the baseline for ${base.slice(0, 12)} isn't complete: finish it (mirai baseline)` : null;
  return { verdict, runs, ...(why ? { why } : {}) };
}

// The work tree as a build left it, from where its branch left base: HEAD, and every changed path
// with a hash of its bytes (or its link's target), so a recheck runs on exactly that tree.
// `ignored`: ignoredFingerprint's map of the ignored files under protected paths, so an edit inside
// an ignored protected folder changes it too; file modes count (21b re-review).
export function treeFingerprint(root, env, changes, ignored = {}) {
  const h = createHash('sha256');
  h.update(`${commitOf(root, 'HEAD', env) ?? 'none'}\n`);
  for (const p of [...changes].sort()) {
    let what;
    try {
      const st = lstatSync(join(root, p));
      what = `${st.mode.toString(8)} ${st.isSymbolicLink() ? `link ${readlinkSync(join(root, p))}` : st.isFile() ? createHash('sha256').update(readFileSync(join(root, p))).digest('hex') : 'other'}`;
    } catch {
      what = 'gone';
    }
    h.update(`${p}\0${what}\n`);
  }
  for (const k of Object.keys(ignored).sort()) h.update(`ignored ${k}\0${ignored[k]}\n`);
  return h.digest('hex');
}

// The paths the plan's code map says are removed.
function removedInPlan(plan) {
  let fm = null;
  try {
    fm = readFrontmatter(plan);
  } catch {
    fm = null;
  }
  const body = fm ? fm.body : plan;
  const map = tableIn({ scan: scanMarkdown(body, { firstLine: fm?.bodyLine ?? 1 }) }, 'Code map');
  return (map?.rows ?? []).filter((r) => (r.cells.change ?? '').trim().toLowerCase() === 'remove').map((r) => (r.cells.path ?? '').replace(/`/g, '').trim().replace(/^\.\//, '')).filter(Boolean);
}
// Whether a path is one the code map removes: the file itself, or under a folder row ending "/".
const removes = (rows, p) => rows.some((r) => r === p || (r.endsWith('/') && p.startsWith(r)));

// MIRAI's checks on what a build left, in order (spec item 4): protected paths, dependencies,
// deleted files, then its own test run. Shared by the build and `--recheck`. Returns { outcome,
// why, protectedPaths, dependencies, tests, fingerprint, park? }.
// The tree a build left: its changes (unit 12) and their fingerprint. A recheck compares the
// fingerprint before running anything.
// `base`: the step's checkpoint (unit 22), so only this step's work is measured.
export function observe({ store, base, rules, ignoredBefore }) {
  const change = changeOf({ root: store.checkout, env: store.gitEnv, base, rules, ignoredBefore });
  const ignored = ignoredFingerprint({ root: store.checkout, env: store.gitEnv, rules });
  return { change, fingerprint: treeFingerprint(store.checkout, store.gitEnv, change.changes, ignored) };
}

// `stepBase`: the step's checkpoint, what its changes are measured from; `branchBase`: the commit the
// branch started from, whose baseline judges the test run.
async function checkAfter({ cwd, env, store, trust, config, registry, keys, plan, branchBase, stepBase, rules, ignoredBefore, tests, testRun, signal, onCheck = null, seen = null }) {
  const declared = declaredChanges(plan);
  const observed = seen ?? observe({ store, base: stepBase, rules, ignoredBefore });
  const { fingerprint } = observed;
  // Claude Code's own write staging (an empty `.claude/.cc-writes/`, made whenever it writes a
  // file: 21b's walkthrough) is no change of the agent's. Only empty, and only that name directly
  // inside a `.claude` folder: anything in it, or anything else under `.claude/`, still counts.
  const staging = (p) => {
    if (!/(^|\/)\.claude\/\.cc-writes$/.test(p)) return false;
    try {
      const st = lstatSync(join(store.checkout, p));
      return st.isDirectory() && readdirSync(join(store.checkout, p)).length === 0;
    } catch {
      return false;
    }
  };
  const change = { ...observed.change, changes: observed.change.changes.filter((p) => !staging(p)), ignored: new Set([...(observed.change.ignored ?? [])].filter((p) => !staging(p))) };
  const deps = newDependencies({ root: store.checkout, env: store.gitEnv, base: stepBase, changed: change.changes, stacks: registry.stacks, declared: declared.filter((d) => d.kind === 'dependency').map((d) => d.item) });
  // A manifest whose every change is a declared dependency is declared as a protected path too,
  // with its lock files (21b review: node's and php's packs protect them).
  const paths = classify({ change, rules, declared: [...declared.filter((d) => d.kind === 'protected-path').map((d) => d.item), ...deps.covered], actor: BUILD_ROLE });
  const protectedPaths = { touched: paths.touched, undeclared: paths.undeclared, autoRun: paths.autoRun, instructionFiles: paths.instructionFiles, needsYou: paths.needsYou };
  const removable = removedInPlan(plan);
  // Deleted: in the base commit, gone from the work tree. A removed test is never a pass (21b
  // review); a removal the plan's code map names is the plan's.
  const deleted = change.changes.filter((p) => {
    try {
      lstatSync(join(store.checkout, p));
      return false;
    } catch {
      return (lsTree(store.checkout, stepBase, p, store.gitEnv) ?? []).some((e) => e.path === p);
    }
  }).filter((p) => !removes(removable, p));
  const base = { protectedPaths, dependencies: deps, fingerprint, tests: null };
  // MIRAI's records and your keys are never a build's to change, declared or not (D-17): a record
  // rewritten by an agent would be committed as MIRAI's (unit 22 review).
  const own = change.changes.filter((p) => /^\.mirai\/(records|keys)(\/|$)/.test(p));
  if (own.length) return { ...base, outcome: 'parked', park: true, why: `it changed MIRAI's records or keys: ${own.slice(0, 10).join(', ')}` };
  // A path that runs by itself parks the ticket, declared or not (D-15).
  if (paths.autoRun.length) return { ...base, outcome: 'parked', park: true, why: `it changed paths that run by themselves: ${paths.autoRun.slice(0, 10).join(', ')}` };
  const stops = [];
  if (paths.undeclared.length) stops.push(`it changed protected paths the plan didn't declare: ${paths.undeclared.slice(0, 10).join(', ')}`);
  if (deps.undeclared.length) stops.push(`it added or changed dependencies the plan didn't declare: ${deps.undeclared.slice(0, 10).map((d) => `${d.dependency} (${d.path})`).join(', ')}`);
  if (deps.sources.length) stops.push(`it changed where dependencies come from: ${deps.sources.slice(0, 10).join(', ')}`);
  if (deps.scripts.length) stops.push(`it changed the scripts the named checks run: ${deps.scripts.slice(0, 10).join(', ')}`);
  if (deps.unreadable.length) stops.push(`a dependency manifest MIRAI can't compare changed: ${deps.unreadable.slice(0, 10).join(', ')}`);
  if (deps.unchecked.length) stops.push(`a manifest MIRAI has no dependency data for changed, so its dependencies weren't checked: ${deps.unchecked.slice(0, 10).join(', ')}`);
  if (deleted.length) stops.push(`it deleted files the plan's code map doesn't remove: ${deleted.slice(0, 10).join(', ')}`);
  if (stops.length) return { ...base, outcome: 'needs-you', why: stops.join('; ') };
  let t;
  try {
    t = await tests({ cwd, env, store, trust, config, keys, base: branchBase, signal, onCheck, ...(testRun ? { run: testRun } : {}) });
  } catch (err) {
    if (err.code !== 'baseline-invalid') throw err;
    return { ...base, outcome: 'needs-you', why: `${err.message}: it may have been changed; record it again (mirai baseline --force)` };
  }
  // Past every safety check: what's left is the test run's word (unit 22 commits from here on).
  base.safe = true;
  if (t.verdict === 'fail') return { ...base, tests: t, outcome: 'checks-failed', why: t.runs.filter((x) => x.verdict === 'fail').map((x) => `${x.name}: ${x.why}`).join('; ') };
  if (t.verdict === 'unknown') return { ...base, tests: t, outcome: 'needs-you', why: [t.why, ...t.runs.filter((x) => x.verdict === 'unknown').map((x) => `${x.name}: ${x.why}`)].filter(Boolean).join('; ') };
  return { ...base, tests: t, outcome: 'handed-over' };
}

// Whether MIRAI can judge a step against `base` (unit 21e): the project has test levels or checks,
// and a complete baseline for that commit covers each of them. Refused before any launch.
export function checkJudgeable({ store, config, keys, base, branch, integration = null }) {
  const levels = [...Object.keys(config.checks ?? {}), ...(config.testing?.levels ?? []).map((l) => l.name)];
  if (!levels.length) throw fail('the project has no test levels or named checks, so MIRAI couldn\'t judge the work', 'no-levels', EXIT.BLOCKED, 'name them in .mirai/config.toml ([[testing.levels]], [checks]), commit, then mirai baseline');
  const baseline = readBaseline(store, base, { keys });
  const missing = baseline ? levels.filter((n) => !Object.hasOwn(baseline.levels ?? {}, n)) : [];
  if (!baseline || baseline.complete === false || missing.length) {
    // A baseline is recorded for the integration branch's HEAD only: for an older base (an existing
    // branch from before main moved), `mirai baseline` can't make one (21e re-review).
    const older = integration !== null && base !== integration;
    throw fail(`${!baseline ? 'there\'s no test baseline' : baseline.complete === false ? 'the test baseline is incomplete' : `the test baseline doesn't cover ${missing.join(', ')}`} for ${base.slice(0, 12)}${older ? `, the commit this ticket's branch starts from (older than ${branch})` : ''}, so MIRAI couldn't judge the work`, 'no-baseline', EXIT.BLOCKED, older ? 'mirai baseline records one for the current integration commit only: start the ticket again from it (discard the step, or delete the branch), or record the old commit\'s baseline by checking it out' : `record it first, on ${branch}: mirai baseline`);
  }
}

// While MIRAI's own checks run after a launch (21e review): the heartbeat keeps going, and carries
// the running check, so `mirai status` doesn't show "handed over" growing old.
export function checkBeat({ store, runId, ticket, step, onCheck = null }) {
  let line = null;
  const beat = () => {
    try {
      writeHeartbeat(store, { runId, ticket, step, ...(line ? { progress: line } : {}) });
    } catch {
      try {
        writeHeartbeat(store, { runId, ...(line ? { progress: line } : {}) });
      } catch {
        // a status detail
      }
    }
  };
  const timer = setInterval(beat, 60_000);
  timer.unref?.();
  return {
    onCheck: (c) => {
      line = checkLine(c).slice(0, 300);
      beat();
      onCheck?.(c);
    },
    stop: () => clearInterval(timer),
  };
}

// The build's record beside the plan, on every outcome after the launch: what happened, MIRAI's
// checks, the tree's fingerprint (what --recheck verifies), and the test runs by id.
export const buildRecordPath = (store, ticket) => join(store.dir, 'tickets', ticket, 'build.json');
// A step that ended checks-failed is where fix rounds start (21c): its commit, its tests and its
// plan, kept as `fix_from` and carried by a fix round's later records, so a round that stops for
// another reason (a usage limit, a fault, Ctrl-C) doesn't lose the way back (21c review).
export function keepBuild(store, ticket, given) {
  // The one before is kept too, so a discard back to it can start there again (21c re-review).
  const from = { commit: given.head, branch: given.branch, tests: given.tests ?? null, plan_sha256: given.plan_sha256 ?? null, launch: given.launch ?? null };
  const record = given.outcome === 'checks-failed' && given.head
    ? { ...given, fix_from: from, fix_from_prev: given.fix_from && given.fix_from.commit !== from.commit ? given.fix_from : given.fix_from_prev ?? null }
    : given;
  ensurePrivateDir(join(store.dir, 'tickets'));
  ensurePrivateDir(join(store.dir, 'tickets', ticket));
  atomicWrite(buildRecordPath(store, ticket), `${JSON.stringify(record, null, 2)}\n`);
}

// What the build's outcome does to the ticket: green moves it to in-review; an auto-run path parks
// it (scope); anything else leaves it in-progress for you or 21c's fix round.
function settleTicket(store, ticket, checked) {
  const current = readTicketStatus(store, ticket).status;
  if (checked.outcome === 'handed-over') {
    move(TICKET, 'in-progress', 'in-review', { by: 'script', item: ticket });
    writeTicketStatus(store, { ticket, state: 'in-review', ...(current.replans !== undefined ? { replans: current.replans } : {}) }, { expectSeq: current.seq });
  } else if (checked.park) parkTicket(store, ticket, { reason: 'scope', why: checked.why, evidence: [`tickets/${ticket}/build.json`] });
}

// The checks that hold before any build work, for a build and a recheck alike, and (unit 24a) a
// review: `state` is where the step starts, `limits` the room its plan inputs may take.
export function preflight({ cwd, env, store, ticket, unattended, state = 'in-progress', limits = INPUT_LIMITS }) {
  const status = readTicketStatus(store, ticket)?.status ?? null;
  if (status?.state !== state) throw fail(`${ticket} is ${status?.state ?? 'not approved yet'}; ${state === 'in-review' ? 'a review starts from in-review, after a green build or fix round' : 'a build starts from in-progress, with an approved plan'}`, 'not-ready');
  const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
  const approved = planApproval(store, ticket, keys);
  if (!approved.ok) throw fail(`${ticket}'s plan can't be built: ${approved.reason}`, 'plan-not-approved', EXIT.BLOCKED, `read it, then: mirai approve ${ticket} --plan`);
  const usage = usageCheck({ env, unattended });
  if (!usage.go) throw usageStop(usage);
  const trust = snapshot({ cwd, env });
  const config = trustedConfig(trust);
  const registry = trustedRegistry(trust);
  const given = planInputs({ root: store.checkout, env: store.gitEnv, commit: trust.baseSha, ticketId: ticket, config, store, plan: approved.text, limits });
  const record = ticketRecord(store, ticket, keys);
  if (!record.approved || record.approved.content_hash !== contentHash(given.ticket.bytes)) throw fail(`${ticket} on the integration branch isn't the file you approved`, 'ticket-changed', EXIT.BLOCKED, `read it and approve it as merged: mirai approve ${ticket} --file ${given.ticket.path}`);
  let fm = {};
  try {
    fm = readFrontmatter(approved.text)?.value ?? {};
  } catch {
    fm = {};
  }
  return { keys, plan: approved.text, usage, trust, config, registry, given, fm };
}

// `mirai build <ticket>`: { outcome, ticket, branch, handover, launch, protectedPaths, dependencies,
// tests, why }. Outcomes: `handed-over` (in-review), `checks-failed`, `needs-you`, `blocked`,
// `parked`, or the launch's own (agent-failed, refused, env-fault, usage-limit, killed).
// With `recheck`, no launch: MIRAI's checks again, on exactly the tree the last build left (its
// fingerprint in build.json), after you fixed what stopped it outside the tree (a baseline, Docker).
export async function runBuild({ cwd, env, ticket, launchToken = null, recheck = false, unattended = false, launchOptions = {}, launch = launchInRun, tests = testsAfter, testRun = undefined, run: outerRun = null, now = () => new Date() }) {
  if (!recheck) checkLaunchToken(launchToken);
  const watch = Object.fromEntries(Object.entries(launchOptions).filter(([k]) => LAUNCH_OPTIONS.includes(k)));
  // The first sign of life (unit 21e), before MIRAI's own checks.
  try {
    if (!recheck) watch.onProgress?.({ kind: 'preparing', agent: AGENT_LABEL, model: null, turns: 0, minutes: 0 });
  } catch {
    // a display only
  }
  return await inRun({ cwd, env, run: outerRun }, async ({ store, runId, tookOver, outer }) => {
    const { keys, plan, usage, trust, config, registry, given, fm } = preflight({ cwd, env, store, ticket, unattended });
    const rules = protectionRules(registry, config);
    if (recheck) return await recheckBuild({ cwd, env, store, runId, fm, ticket, keys, plan, trust, config, registry, rules, tests, testRun, watch, now, tookOver });
    const risk = fm.risk === 'high' ? 'high' : 'normal';
    const size = given.ticket.fm.size === 'L' ? 'L' : null;
    // Before anything is made (unit 21e, from 21d's checkpoint): a build MIRAI can't judge isn't
    // started, and a stale red team refuses before the branch, not after it.
    // The commit the build will be judged against: an existing branch's own base (its record),
    // else the integration commit (21e review).
    const name = branchName(config.git?.branch_pattern ?? 'feature/{ticket}-{slug}', ticket, ticketSlug(given.ticket.text));
    const existing = commitOf(store.checkout, `refs/heads/${name}`, store.gitEnv) !== null ? verifyBranchAt({ root: store.checkout, env: store.gitEnv, branch: name, keys, repoId: store.repoId }) : null;
    checkJudgeable({ store, config, keys, base: existing?.ok ? existing.record.base_sha : trust.baseSha, branch: trust.branch, integration: trust.baseSha });
    await preGate({ cwd, env, store, trust, role: BUILD_ROLE, claude: watch.claude ?? null, ...(watch.status ? { status: watch.status } : {}) });
    // The ticket's branch (unit 22): made with its signed record and registered, or an existing
    // MIRAI branch as it is. Its base is the integration commit until stacking (D2) gives a parent.
    const prep = prepareBranch({ store, env, trust, config, keys, signer: () => loadSigner(env, store), unattended, ticket, ticketText: given.ticket.text, now });
    const { branch } = prep;
    const branchBase = prep.base;
    // The step's start: its checkpoint, once the launch has run (a refused one adds none, so a
    // discard can still throw the last real step away: unit 22 review).
    const stepBase = prep.head;
    // Ignored files under protected paths as they are right before the launch (unit 12's change).
    const ignoredBefore = ignoredFingerprint({ root: store.checkout, env: store.gitEnv, rules });
    const result = { ticket, branch, outcome: null, why: null, handover: null, launch: null, protectedPaths: null, dependencies: null, tests: null, warn: usage.warn ?? null, tookOver };
    let endState = 'stopped';
    try {
      // A build session isn't a round (unit 20): a fix after handover is (21c).
      const guard = beforeLaunch(store, ticket, { round: false, risk });
      if (!guard.go) return { ...result, outcome: 'parked', why: guard.park.why ?? guard.park.reason };
      let r;
      try {
        r = await launch({
          ...watch, cwd, env, store, runId, startRun: !outer, ownsRun: false, launchToken, agent: AGENT, progressLabel: AGENT_LABEL, role: BUILD_ROLE, step: 'build', risk, size, expectBase: trust.baseSha,
          prompt: buildPrompt({ ticket, branch }), item: ticket, maxTurns: BUILD_MAX_TURNS, timeoutMs: watch.timeoutMs ?? BUILD_TIMEOUT_MS, inputs: given.inputs, jsonSchema: HANDOVER_SCHEMA, now,
          // Kept for a fix round to resume (unit 21c); a new build starts a new session.
          session: { keep: true },
        });
      } catch (err) {
        settleLaunch(store, ticket, { launch: guard.launch, outcome: 'refused', refundable: true });
        throw err;
      }
      settleLaunch(store, ticket, { launch: guard.launch, outcome: r.outcome, refundable: r.refundable, line: r.line });
      addCheckpoint(store, ticket, { step: 'build', sha: stepBase, creationSha: prep.creationSha, now });
      result.launch = { id: r.launchId, outcome: r.outcome, why: r.why, line: r.line };
      const record = (extra) => keepBuild(store, ticket, { branch, head: commitOf(store.checkout, 'HEAD', store.gitEnv), base: branchBase, step_base: stepBase, creation_sha: prep.creationSha, launch: r.launchId, plan_sha256: contentHash(Buffer.from(plan)), at: now().toISOString(), ignored_before: ignoredBefore, ...extra });
      const checking = checkBeat({ store, runId, ticket, step: 'build', onCheck: watch.onCheck ?? null });
      let after;
      try {
        after = await afterLaunch({ r, cwd, env, store, runId, trust, config, registry, keys, plan, fm, ticket, branchBase, stepBase, rules, ignoredBefore, tests, testRun, signal: watch.signal ?? null, onCheck: checking.onCheck, record, what: 'build from the approved plan' });
      } finally {
        checking.stop();
      }
      if (after.outcome === 'handed-over') endState = 'finished';
      return { ...result, ...after };
    } finally {
      const run = readRunState(store);
      if (!outer && run?.state === 'running' && run.run_id === runId) writeRunState(store, endState, { clear: true });
    }
  });
}

// After a build's or a fix round's launch (units 21b, 21c, 22): the handover, MIRAI's checks, its
// commit when the safety checks pass, the run log's checks line, the record, and the ticket's state.
// Returns the result's fields: { outcome, why, handover, commit, protectedPaths, dependencies, tests }.
export async function afterLaunch({ r, cwd, env, store, runId, trust, config, registry, keys, plan, fm, ticket, branchBase, stepBase, rules, ignoredBefore, tests, testRun, signal, onCheck = null, record, what }) {
  if (r.outcome !== 'ok') {
    record({ outcome: r.outcome, why: r.why });
    return { outcome: r.outcome, why: r.why };
  }
  const handover = handoverFrom(r.structured);
  if (handover.problem) {
    record({ outcome: 'agent-failed', why: handover.problem });
    return { outcome: 'agent-failed', why: handover.problem };
  }
  if (handover.status === 'blocked') {
    const why = handover.blocked_reason ?? 'Kai stopped without a reason';
    record({ outcome: 'blocked', why, handover });
    return { outcome: 'blocked', why, handover };
  }
  let checked;
  try {
    checked = await checkAfter({ cwd, env, store, trust, config, registry, keys, plan, branchBase, stepBase, rules, ignoredBefore, tests, testRun, signal, onCheck });
    // Past the safety checks, whatever the tests said: MIRAI commits what Kai produced, so the
    // next step starts from a clean tree (unit 22, open point 3). A safety stop never is.
    if (checked.safe) {
      // What's committed is exactly what passed the checks: the tree looked at again right
      // before, and the ignored files right after (unit 22 review).
      const checkedPrint = checked.fingerprint;
      checked.commit = commitStep({
        store, env, config, ticket, what, body: handover.summary,
        before: () => {
          if (observe({ store, base: stepBase, rules, ignoredBefore }).fingerprint !== checkedPrint) throw fail('the tree changed between MIRAI\'s checks and its commit: something else is writing to the project', 'changed-before-commit', EXIT.BLOCKED, 'look for a process still working in the project, then build again');
        },
        ignored: () => ignoredFingerprint({ root: store.checkout, env: store.gitEnv, rules }),
      });
      checked.checked_fingerprint = checkedPrint;
      checked.fingerprint = observe({ store, base: stepBase, rules, ignoredBefore }).fingerprint;
    }
  } catch (err) {
    // Kept, so --recheck has the build to work from (its fingerprint, taken again).
    let fingerprint = null;
    try {
      fingerprint = observe({ store, base: stepBase, rules, ignoredBefore }).fingerprint;
    } catch {
      fingerprint = null;
    }
    record({ outcome: 'error', why: String(err.message).slice(0, 500), handover, fingerprint });
    throw err;
  }
  if (checked.tests) writeChecks(store, runId, ticket, { fm, t: checked.tests });
  record({ outcome: checked.outcome, why: checked.why ?? null, handover, commit: checked.commit ?? null, checked_fingerprint: checked.checked_fingerprint ?? null, fingerprint: checked.fingerprint, protectedPaths: checked.protectedPaths, dependencies: checked.dependencies, tests: checked.tests });
  settleTicket(store, ticket, checked);
  return { ...checked, handover, park: undefined, fingerprint: undefined, checked_fingerprint: undefined, safe: undefined };
}

// `mirai build <ticket> --recheck`: no agent. The tree must be exactly what the last build left:
// the same branch, HEAD (the step's commit, unit 22, when it was committed) and fingerprint, so
// nothing but Kai's work is judged.
async function recheckBuild({ cwd, env, store, runId, fm = {}, ticket, keys, plan, trust, config, registry, rules, tests, testRun, watch, now, tookOver }) {
  let last;
  try {
    last = JSON.parse(String(readPrivateFile(buildRecordPath(store, ticket), { maxBytes: 4 * 1024 * 1024 })));
  } catch {
    last = null;
  }
  if (!last?.fingerprint) throw fail(`${ticket} has no build whose checks can run again`, 'no-build', EXIT.BLOCKED, `mirai build ${ticket}`);
  const branch = symbolicBranch(store.checkout, 'HEAD', store.gitEnv);
  if (branch !== last.branch || commitOf(store.checkout, 'HEAD', store.gitEnv) !== last.head) throw fail(`the checkout isn't where ${ticket}'s build left it (${last.branch} at ${String(last.head).slice(0, 12)})`, 'build-moved', EXIT.BLOCKED, `git switch ${last.branch}`);
  // The plan Kai built from, and nothing git is told to look past (as every launch: 19b).
  if (last.plan_sha256 !== contentHash(Buffer.from(plan))) throw fail(`${ticket}'s approved plan changed since its build; a recheck judges only what Kai built from`, 'plan-changed', EXIT.BLOCKED, `build it again: mirai build ${ticket}`);
  checkNothingHidden(store.checkout, store.gitEnv);
  const seen = observe({ store, base: last.step_base ?? last.base, rules, ignoredBefore: last.ignored_before ?? null });
  if (seen.fingerprint !== last.fingerprint) throw fail(`the tree changed since ${ticket}'s build; only Kai's work is checked again`, 'tree-changed', EXIT.BLOCKED, 'put it back as the build left it, or start the ticket again');
  // A recheck runs no launch and no run state, so no heartbeat is shown for it: its checks print only.
  const checked = await checkAfter({ onCheck: watch.onCheck ?? null, cwd, env, store, trust, config, registry, keys, plan, branchBase: last.base, stepBase: last.step_base ?? last.base, rules, ignoredBefore: last.ignored_before ?? null, tests, testRun, signal: watch.signal ?? null, seen });
  // A tree that wasn't committed (stopped before the safety checks passed, under older rules) and
  // passes them now is committed here, so the next step starts from a clean tree.
  let commit = last.commit ?? null;
  let fingerprint = last.fingerprint;
  if (!commit && checked.safe) {
    commit = commitStep({
      store, env, config, ticket, what: 'build from the approved plan', body: last.handover?.summary ?? '',
      before: () => {
        if (observe({ store, base: last.step_base ?? last.base, rules, ignoredBefore: last.ignored_before ?? null }).fingerprint !== seen.fingerprint) throw fail('the tree changed between MIRAI\'s checks and its commit', 'changed-before-commit', EXIT.BLOCKED);
      },
      ignored: () => ignoredFingerprint({ root: store.checkout, env: store.gitEnv, rules }),
    });
    fingerprint = observe({ store, base: last.step_base ?? last.base, rules, ignoredBefore: last.ignored_before ?? null }).fingerprint;
  }
  // The recheck's own results in the run log (unit 21e, from 21d's checkpoint: a report showed the
  // first run's).
  if (checked.tests && runId) writeChecks(store, runId, ticket, { fm, t: checked.tests });
  keepBuild(store, ticket, { ...last, rechecked_at: now().toISOString(), outcome: checked.outcome, why: checked.why ?? null, commit, fingerprint, head: commitOf(store.checkout, 'HEAD', store.gitEnv), protectedPaths: checked.protectedPaths, dependencies: checked.dependencies, tests: checked.tests });
  settleTicket(store, ticket, checked);
  return { ticket, branch, outcome: checked.outcome, why: checked.why ?? null, handover: last.handover ?? null, commit, launch: null, protectedPaths: checked.protectedPaths, dependencies: checked.dependencies, tests: checked.tests, warn: null, tookOver, rechecked: true };
}

// The run log's checks line (05b): MIRAI's own run, one result per level and check.
function writeChecks(store, runId, ticket, { fm, t }) {
  const sum = (k) => t.runs.reduce((n, r) => n + (Number.isSafeInteger(r.tests?.[k]) ? r.tests[k] : 0), 0);
  const line = {
    item: ticket, event: 'checks', tdd: ['auto', 'first', 'after'].includes(fm.tdd) ? fm.tdd : 'auto', tests_policy: fm.tests === 'optional' ? 'optional' : 'required',
    tests: { passed: sum('passed'), failed: sum('failed') + sum('errors'), skipped: sum('skipped') },
    named: t.runs.map((r) => ({ name: r.name, result: r.verdict })),
  };
  withSeq(store, ({ take, runLine }) => runLine(runId, take(), line));
}
