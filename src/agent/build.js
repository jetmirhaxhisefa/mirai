import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
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
import { ensureBranch } from './branch.js';
import { newDependencies } from './deps.js';
import { planInputs } from './inputs.js';
import { AGENT, declaredChanges, LAUNCH_OPTIONS, planApproval, ticketRecord } from './plan.js';
import { checkLaunchToken } from './requests.js';
import { launchInRun, withRun } from './run.js';
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
export async function testsAfter({ cwd, env, store, trust, config, keys, base, run = runTest, signal = null }) {
  const names = [...Object.keys(config.checks ?? {}).sort(), ...(config.testing?.levels ?? []).map((l) => l.name)];
  const baseline = readBaseline(store, base, { keys });
  const runs = [];
  for (const name of names) {
    let result;
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
    runs.push({ name, outcome: result.outcome, id: result.id ?? null, tests: now ?? null, ...judged });
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
export function observe({ store, branchBase, rules, ignoredBefore }) {
  const change = changeOf({ root: store.checkout, env: store.gitEnv, base: branchBase, rules, ignoredBefore });
  const ignored = ignoredFingerprint({ root: store.checkout, env: store.gitEnv, rules });
  return { change, fingerprint: treeFingerprint(store.checkout, store.gitEnv, change.changes, ignored) };
}

async function checkAfter({ cwd, env, store, trust, config, registry, keys, plan, branchBase, rules, ignoredBefore, tests, testRun, signal, seen = null }) {
  const declared = declaredChanges(plan);
  const { change, fingerprint } = seen ?? observe({ store, branchBase, rules, ignoredBefore });
  const deps = newDependencies({ root: store.checkout, env: store.gitEnv, base: branchBase, changed: change.changes, stacks: registry.stacks, declared: declared.filter((d) => d.kind === 'dependency').map((d) => d.item) });
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
      return (lsTree(store.checkout, branchBase, p, store.gitEnv) ?? []).some((e) => e.path === p);
    }
  }).filter((p) => !removes(removable, p));
  const base = { protectedPaths, dependencies: deps, fingerprint, tests: null };
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
    t = await tests({ cwd, env, store, trust, config, keys, base: branchBase, signal, ...(testRun ? { run: testRun } : {}) });
  } catch (err) {
    if (err.code !== 'baseline-invalid') throw err;
    return { ...base, outcome: 'needs-you', why: `${err.message}: it may have been changed; record it again (mirai baseline --force)` };
  }
  if (t.verdict === 'fail') return { ...base, tests: t, outcome: 'checks-failed', why: t.runs.filter((x) => x.verdict === 'fail').map((x) => `${x.name}: ${x.why}`).join('; ') };
  if (t.verdict === 'unknown') return { ...base, tests: t, outcome: 'needs-you', why: [t.why, ...t.runs.filter((x) => x.verdict === 'unknown').map((x) => `${x.name}: ${x.why}`)].filter(Boolean).join('; ') };
  return { ...base, tests: t, outcome: 'handed-over' };
}

// The build's record beside the plan, on every outcome after the launch: what happened, MIRAI's
// checks, the tree's fingerprint (what --recheck verifies), and the test runs by id.
export const buildRecordPath = (store, ticket) => join(store.dir, 'tickets', ticket, 'build.json');
function keepBuild(store, ticket, record) {
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

// The checks that hold before any build work, for a build and a recheck alike.
function preflight({ cwd, env, store, ticket, unattended }) {
  const status = readTicketStatus(store, ticket)?.status ?? null;
  if (status?.state !== 'in-progress') throw fail(`${ticket} is ${status?.state ?? 'not approved yet'}; a build starts from in-progress, with an approved plan`, 'not-ready');
  const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
  const approved = planApproval(store, ticket, keys);
  if (!approved.ok) throw fail(`${ticket}'s plan can't be built: ${approved.reason}`, 'plan-not-approved', EXIT.BLOCKED, `read it, then: mirai approve ${ticket} --plan`);
  const usage = usageCheck({ env, unattended });
  if (!usage.go) throw usageStop(usage);
  const trust = snapshot({ cwd, env });
  const config = trustedConfig(trust);
  const registry = trustedRegistry(trust);
  const given = planInputs({ root: store.checkout, env: store.gitEnv, commit: trust.baseSha, ticketId: ticket, config, store, plan: approved.text, limits: INPUT_LIMITS });
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
export async function runBuild({ cwd, env, ticket, launchToken = null, recheck = false, unattended = false, launchOptions = {}, launch = launchInRun, tests = testsAfter, testRun = undefined, now = () => new Date() }) {
  if (!recheck) checkLaunchToken(launchToken);
  const watch = Object.fromEntries(Object.entries(launchOptions).filter(([k]) => LAUNCH_OPTIONS.includes(k)));
  return await withRun({ cwd, env }, async ({ store, runId, tookOver }) => {
    const { keys, plan, usage, trust, config, registry, given, fm } = preflight({ cwd, env, store, ticket, unattended });
    const rules = protectionRules(registry, config);
    if (recheck) return await recheckBuild({ cwd, env, store, ticket, keys, plan, trust, config, registry, rules, tests, testRun, watch, now, tookOver });
    const risk = fm.risk === 'high' ? 'high' : 'normal';
    const size = given.ticket.fm.size === 'L' ? 'L' : null;
    // The commit the branch starts from: the integration commit until stacking (D2) gives a parent.
    const branchBase = trust.baseSha;
    const { branch } = ensureBranch({ root: store.checkout, env: store.gitEnv, base: branchBase, integration: trust.branch, pattern: config.git?.branch_pattern, ticket, ticketText: given.ticket.text });
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
          ...watch, cwd, env, store, runId, startRun: true, ownsRun: false, launchToken, agent: AGENT, role: BUILD_ROLE, step: 'build', risk, size, expectBase: trust.baseSha,
          prompt: buildPrompt({ ticket, branch }), item: ticket, maxTurns: BUILD_MAX_TURNS, timeoutMs: watch.timeoutMs ?? BUILD_TIMEOUT_MS, inputs: given.inputs, jsonSchema: HANDOVER_SCHEMA, now,
        });
      } catch (err) {
        settleLaunch(store, ticket, { launch: guard.launch, outcome: 'refused', refundable: true });
        throw err;
      }
      settleLaunch(store, ticket, { launch: guard.launch, outcome: r.outcome, refundable: r.refundable, line: r.line });
      result.launch = { id: r.launchId, outcome: r.outcome, why: r.why, line: r.line };
      const record = (extra) => keepBuild(store, ticket, { branch, head: commitOf(store.checkout, 'HEAD', store.gitEnv), base: branchBase, launch: r.launchId, plan_sha256: contentHash(Buffer.from(plan)), at: now().toISOString(), ignored_before: ignoredBefore, ...extra });
      if (r.outcome !== 'ok') {
        record({ outcome: r.outcome, why: r.why });
        return { ...result, outcome: r.outcome, why: r.why };
      }
      const handover = handoverFrom(r.structured);
      if (handover.problem) {
        record({ outcome: 'agent-failed', why: handover.problem });
        return { ...result, outcome: 'agent-failed', why: handover.problem };
      }
      result.handover = handover;
      if (handover.status === 'blocked') {
        const why = handover.blocked_reason ?? 'Kai stopped without a reason';
        record({ outcome: 'blocked', why, handover });
        return { ...result, outcome: 'blocked', why };
      }
      let checked;
      try {
        checked = await checkAfter({ cwd, env, store, trust, config, registry, keys, plan, branchBase, rules, ignoredBefore, tests, testRun, signal: watch.signal ?? null });
      } catch (err) {
        // Kept, so --recheck has the build to work from (its fingerprint, taken again).
        let fingerprint = null;
        try {
          fingerprint = observe({ store, branchBase, rules, ignoredBefore }).fingerprint;
        } catch {
          fingerprint = null;
        }
        record({ outcome: 'error', why: String(err.message).slice(0, 500), handover, fingerprint });
        throw err;
      }
      if (checked.tests) writeChecks(store, runId, ticket, { fm, t: checked.tests });
      record({ outcome: checked.outcome, why: checked.why ?? null, handover, fingerprint: checked.fingerprint, protectedPaths: checked.protectedPaths, dependencies: checked.dependencies, tests: checked.tests });
      settleTicket(store, ticket, checked);
      if (checked.outcome === 'handed-over') endState = 'finished';
      return { ...result, ...checked, park: undefined, fingerprint: undefined };
    } finally {
      const run = readRunState(store);
      if (run?.state === 'running' && run.run_id === runId) writeRunState(store, endState, { clear: true });
    }
  });
}

// `mirai build <ticket> --recheck`: no agent. The tree must be exactly what the last build left:
// the same branch, HEAD and fingerprint, so nothing but Kai's work is judged.
async function recheckBuild({ cwd, env, store, ticket, keys, plan, trust, config, registry, rules, tests, testRun, watch, now, tookOver }) {
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
  const seen = observe({ store, branchBase: last.base, rules, ignoredBefore: last.ignored_before ?? null });
  if (seen.fingerprint !== last.fingerprint) throw fail(`the tree changed since ${ticket}'s build; only Kai's work is checked again`, 'tree-changed', EXIT.BLOCKED, 'put it back as the build left it, or start the ticket again');
  const checked = await checkAfter({ cwd, env, store, trust, config, registry, keys, plan, branchBase: last.base, rules, ignoredBefore: last.ignored_before ?? null, tests, testRun, signal: watch.signal ?? null, seen });
  keepBuild(store, ticket, { ...last, rechecked_at: now().toISOString(), outcome: checked.outcome, why: checked.why ?? null, protectedPaths: checked.protectedPaths, dependencies: checked.dependencies, tests: checked.tests });
  settleTicket(store, ticket, checked);
  return { ticket, branch, outcome: checked.outcome, why: checked.why ?? null, handover: last.handover ?? null, launch: null, protectedPaths: checked.protectedPaths, dependencies: checked.dependencies, tests: checked.tests, warn: null, tookOver, rechecked: true };
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
