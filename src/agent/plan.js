import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { PRESETS } from '../config/defaults.js';
import { INPUT_LIMITS } from '../launch/strict.js';
import { lintText, projectOf } from '../lint/lint.js';
import { readFrontmatter } from '../lint/frontmatter.js';
import { scanMarkdown } from '../lint/markdown.js';
import { beforeLaunch, readLoop, settleLaunch } from '../loop/guard.js';
import { usageCheck, usageStop } from '../loop/ledger.js';
import { parkTicket } from '../loop/park.js';
import { TICKET } from '../status/machines.js';
import { move } from '../status/move.js';
import { verifyPlanApproval } from '../lint/frozen.js';
import { branchKeys } from '../sign/keys.js';
import { atomicWrite, ensurePrivateDir } from '../store/files.js';
import { readJournal } from '../store/journal.js';
import { contentHash } from '../sign/sign.js';
import { sameKey, tableIn } from '../lint/checks.js';
import { readRunState, writeRunState } from '../store/run.js';
import { readTicketStatus, writeTicketStatus } from '../store/tickets.js';
import { snapshot, trustedConfig, trustedRegistry } from '../trust/snapshot.js';
import { planInputs, ticketAcs } from './inputs.js';
import { checkLaunchToken } from './requests.js';
import { launchInRun, withRun } from './run.js';

// The plan step (unit 21a; design/01 §6, D-15, R2-C1, R2-M11). Kai, on the planner role (it may
// change nothing), reads the ticket's inputs and returns the plan as its run's structured output;
// MIRAI stores it in the store, where agents can't write, and lints it (08b). One fix launch for a
// plan that fails lint, then the ticket parks `bad-plan`. A plan that passes waits at your gate:
// `mirai approve <ticket> --plan` signs its approvalHash.

export const AGENT = 'mirai-developer';
export const PLAN_ROLE = 'planner';
export const PLAN_MAX_BYTES = 256 * 1024;
export const PLAN_MAX_TURNS = 60;
// How the plan comes back: Claude Code's --json-schema (R1), or a fenced block in the reply.
export const PLAN_SCHEMA = Object.freeze({
  type: 'object',
  properties: { plan: { type: 'string', description: 'the whole plan, frontmatter first, in MIRAI\'s plan template' } },
  required: ['plan'],
  additionalProperties: false,
});

const fail = (message, code, exit = EXIT.BLOCKED, hint) => Object.assign(new MiraiError(message, exit), { code, hint });

export const planPath = (store, ticket) => join(store.dir, 'tickets', ticket, 'plan.md');
export const approvalPath = (store, ticket) => join(store.dir, 'tickets', ticket, 'plan-approval.json');
export const planContext = (store) => `mirai/plan-approval/1:${store.repoId}`;

export function readPlan(store, ticket) {
  try {
    return readFileSync(planPath(store, ticket), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// Whether the ticket's plan, as it is now, carries your approval (08b's verifyPlanApproval, with
// the keys on the integration branch): { ok, reason }. An edit to the frozen block, the declared
// changes or the approved fields after you approved it fails here; 21b's build refuses then.
export function planApproval(store, ticket, keys = branchKeys(store.checkout, store.branch, store.gitEnv)) {
  const text = readPlan(store, ticket);
  if (text === null) return { ok: false, reason: 'there is no plan' };
  let approval;
  try {
    approval = JSON.parse(readFileSync(approvalPath(store, ticket), 'utf8'));
  } catch (err) {
    return { ok: false, reason: err.code === 'ENOENT' ? 'the plan isn\'t approved' : 'the approval can\'t be read' };
  }
  // The text that was verified, so a build uses exactly what passed.
  const v = verifyPlanApproval(approval, text, keys, { context: planContext(store) });
  return v.ok ? { ...v, text } : v;
}

function storePlan(store, ticket, text) {
  ensurePrivateDir(join(store.dir, 'tickets'));
  ensurePrivateDir(join(store.dir, 'tickets', ticket));
  atomicWrite(planPath(store, ticket), text);
}

// The plan's text from a launch's result: the structured output's `plan` (schema), or the one
// fenced markdown block of the reply (fenced). { text } or { problem }. A file the agent wrote is
// never looked at.
export function planFrom(result, { via = 'schema' } = {}) {
  let text;
  if (via === 'schema') {
    const s = result.structured;
    if (s === null || typeof s !== 'object' || Array.isArray(s) || typeof s.plan !== 'string' || Object.keys(s).some((k) => k !== 'plan')) return { problem: 'the run\'s structured output has no plan' };
    text = s.plan;
  } else {
    const blocks = [...String(result.text ?? '').matchAll(/^```(?:markdown|md)[ \t]*\n([^]*?)\n```[ \t]*$/gm)];
    if (blocks.length !== 1) return { problem: `the reply has ${blocks.length} fenced markdown blocks; the plan is exactly one` };
    text = blocks[0][1];
  }
  text = text.replace(/\r\n/g, '\n');
  if (!text.endsWith('\n')) text += '\n';
  if (Buffer.byteLength(text) > PLAN_MAX_BYTES) return { problem: `the plan is larger than ${PLAN_MAX_BYTES / 1024} KiB` };
  if (text.includes('\0')) return { problem: 'the plan has a NUL character' };
  return { text };
}

// The Declared changes rows: [{ kind, item, why }].
export function declaredChanges(text) {
  let fm;
  try {
    fm = readFrontmatter(text);
  } catch {
    return [];
  }
  const body = fm ? fm.body : text;
  const declared = tableIn({ scan: scanMarkdown(body, { firstLine: fm?.bodyLine ?? 1 }) }, 'Declared changes');
  return (declared?.rows ?? []).map((r) => ({ kind: (r.cells.kind ?? '').trim().toLowerCase(), item: (r.cells.item ?? '').trim(), why: (r.cells.why ?? '').trim() }));
}

// The frontmatter MIRAI gives a plan: the ticket's fields, never the agent's. `risk` is high when
// the ticket is, or when the plan declares a new dependency (design/01 §6).
export function planFrontmatter({ ticket, acs, risk, tdd, tests, round }) {
  return ['---', `id: ${ticket}-plan`, 'type: plan', 'template: plan@v1', `ticket: ${ticket}`, `acs: [${acs.join(', ')}]`, `risk: ${risk}`, `tdd: ${tdd}`, `tests: ${tests}`, `round: ${round}`, '---', ''].join('\n');
}

// The plan with MIRAI's frontmatter in place of whatever the agent wrote there: the approved
// fields (ticket, acs, risk, tdd, tests, round) are never the agent's to choose.
export function withFrontmatter(text, fields) {
  let body = text;
  try {
    const fm = readFrontmatter(text);
    if (fm) body = fm.body;
  } catch {
    // unreadable frontmatter: the whole text is the body, and the lint will say what's wrong
  }
  const dependency = declaredChanges(`---\n---\n${body}`).some((r) => r.kind === 'dependency');
  return `${planFrontmatter({ ...fields, risk: fields.risk === 'high' || dependency ? 'high' : 'normal' })}${body.replace(/^\n+/, '')}`;
}

// Who approves the plan (design/01 §6): the preset's plan gate (PRESETS), and you whatever the
// preset for a high-risk ticket or a plan that declares protected paths or new dependencies.
// { gate: 'human' | 'auto', required, why }. Nothing approves automatically before unit 28: an
// `auto` gate still waits for you meanwhile.
export function gateFor({ preset, text }) {
  const required = [];
  let risk = null;
  try {
    risk = readFrontmatter(text)?.value.risk ?? null;
  } catch {
    risk = null;
  }
  if (risk === 'high') required.push('a high-risk ticket');
  const rows = declaredChanges(text);
  if (rows.some((r) => r.kind === 'protected-path')) required.push('it declares protected paths');
  if (rows.some((r) => r.kind === 'dependency')) required.push('it declares new dependencies');
  const byPreset = PRESETS[preset]?.plan ?? 'human';
  const why = [...(byPreset === 'human' ? [`the ${preset} preset`] : []), ...required];
  return { gate: why.length ? 'human' : 'auto', required: required.length > 0, why };
}

export function planPrompt({ ticket, fields, via, problems = null }) {
  const out = via === 'schema'
    ? 'Return the whole plan, frontmatter first, as your structured output\'s `plan`.'
    : 'Return the whole plan, frontmatter first, as the only fenced ```markdown block in your final reply.';
  const lines = [
    `Your step: plan. The ticket: ${ticket}.`,
    'The input folder holds ticket.md, plan-template.md and index.json; read index.json first.',
    'Start the plan with this frontmatter (MIRAI sets these fields itself, whatever you write):',
    '',
    planFrontmatter(fields).trimEnd(),
    '',
    out,
    'Change nothing in the project.',
  ];
  if (problems) {
    lines.push('', 'Your last plan failed MIRAI\'s lint; it is last-plan.md in the input folder. Fix exactly these problems and return the whole plan again:', ...problems.slice(0, 50).map((p) => `- line ${p.line}: ${p.reason}${p.hint ? ` (${p.hint})` : ''}`));
  }
  return lines.join('\n');
}

// The plan lint (08b) with the trust root's registry and the project's levels.
export function lintPlan(text, { registry, config, ticket }) {
  return lintText(text, { source: `tickets/${ticket}/plan.md`, registry, project: projectOf(config) });
}

// `mirai plan <ticket>`: { outcome, ticket, problems, gate, launches, path, why }. `launchTokens`:
// two one-time tokens (the launch and its one fix), minted by the caller, your terminal or the
// orchestrator (D-14): a plan library never mints its own. `launchOptions`: from trusted in-process
// callers only, the ways a launch is stopped (signals, time limits) and the hooks the tests and
// the CLI's own test io use (the binary, the red-team status, the init check); never its role,
// agent, inputs, prompt or token (LAUNCH_OPTIONS). `launch` is for the tests.
const LAUNCH_OPTIONS = ['signal', 'hardSignal', 'claude', 'status', 'check', 'timeoutMs', 'initDeadlineMs'];

// The ticket's last approval in the journal (unit 06), and how many times you rejected its plan.
function ticketRecord(store, ticket, keys) {
  const { events } = readJournal(store, { keys });
  const mine = events.filter((e) => e.type === 'approval' && sameKey(e.item, ticket));
  const approved = mine.filter((e) => e.kind === 'ticket' && e.decision !== 'rejected').at(-1) ?? null;
  return { approved, rejections: mine.filter((e) => e.kind === 'plan' && e.decision === 'rejected').length };
}

export async function runPlan({ cwd, env, ticket, launchTokens, via = 'schema', unattended = false, launchOptions = {}, launch = launchInRun, now = () => new Date() }) {
  // Checked here, spent by each launch: no plan runs without them.
  if (!Array.isArray(launchTokens) || launchTokens.length !== 2) checkLaunchToken(null);
  for (const t of launchTokens) checkLaunchToken(t);
  const watch = Object.fromEntries(Object.entries(launchOptions).filter(([k]) => LAUNCH_OPTIONS.includes(k)));
  return await withRun({ cwd, env }, async ({ store, runId, tookOver }) => {
    const status = readTicketStatus(store, ticket)?.status ?? null;
    if (status?.state !== 'ready-for-dev') throw fail(`${ticket} is ${status?.state ?? 'not approved yet'}; a plan starts from ready-for-dev`, 'not-ready', EXIT.BLOCKED, status ? undefined : 'approve the ticket first: mirai approve <ticket> --file <path>');
    // The usage check before a ticket (unit 20), then the trust root and the inputs.
    const usage = usageCheck({ env, unattended });
    if (!usage.go) throw usageStop(usage);
    const trust = snapshot({ cwd, env });
    const config = trustedConfig(trust);
    const registry = trustedRegistry(trust);
    const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
    const template = readFileSync(join(registry.dir, registry.documentTypes.plan.template), 'utf8');
    // Room left for the fix launch's last-plan.md. Sibling plans only when you approved them.
    const limits = { files: INPUT_LIMITS.files - 1, bytes: INPUT_LIMITS.bytes - PLAN_MAX_BYTES };
    const given = planInputs({ root: store.checkout, env: store.gitEnv, commit: trust.baseSha, ticketId: ticket, config, store, template, limits, approved: (id) => planApproval(store, id, keys).ok });
    // The ticket on the integration branch must be the one you approved (unit 06's content hash): a
    // ticket edited and merged after that would drive the plan's fields and its gate.
    const record = ticketRecord(store, ticket, keys);
    if (!record.approved) throw fail(`${ticket} has no approval of yours in the journal`, 'no-ticket-approval', EXIT.BLOCKED, `approve it: mirai approve ${ticket} --file ${given.ticket.path}`);
    if (record.approved.content_hash !== contentHash(given.ticket.bytes)) throw fail(`${ticket} on the integration branch (${given.ticket.path}) isn't the file you approved`, 'ticket-changed', EXIT.BLOCKED, `on the integration branch, read it and approve it as merged: mirai approve ${ticket} --file ${given.ticket.path}`);
    const fm = given.ticket.fm;
    const fields = {
      ticket, acs: ticketAcs(given.ticket), risk: fm.risk === 'high' ? 'high' : 'normal',
      tdd: ['auto', 'first', 'after'].includes(fm.tdd) ? fm.tdd : config.testing?.tdd ?? 'auto', tests: ['required', 'optional'].includes(fm.tests) ? fm.tests : config.testing?.tests ?? 'required',
      // Every plan you rejected and the orchestrator's re-plan (the loop counters', L4) count apart,
      // so a later plan is never an earlier round. A plan cut short isn't a round.
      round: 1 + record.rejections + readLoop(store, ticket).replans_used,
    };
    if (fields.acs.length === 0) throw fail(`${ticket} has no acceptance criteria (AC-${ticket}.n) on the integration branch`, 'no-acs');
    const result = { ticket, outcome: null, problems: [], gate: null, launches: [], path: planPath(store, ticket), why: null, warn: usage.warn ?? null, tookOver, inputs: given.index };
    // The ticket moves once a plan is through (04's "plan written"): on to the gate, or to a park. A
    // run cut short leaves it ready-for-dev, so `mirai plan` can simply run again.
    const toInProgress = () => {
      const current = readTicketStatus(store, ticket)?.status;
      if (current?.state !== 'ready-for-dev') return;
      move(TICKET, 'ready-for-dev', 'in-progress', { by: 'script', item: ticket });
      writeTicketStatus(store, { ticket, state: 'in-progress', ...(current.replans !== undefined ? { replans: current.replans } : {}) }, { expectSeq: current.seq });
    };
    let started = false;
    let endState = 'stopped';
    try {
      let problems = null;
      let stored = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        // A plan launch isn't a round (unit 20): the loop guard counts it, and a parked ticket stops here.
        const guard = beforeLaunch(store, ticket, { round: false, risk: fields.risk });
        if (!guard.go) {
          result.outcome = 'parked';
          result.why = guard.park.why ?? guard.park.reason;
          return result;
        }
        let r;
        try {
          r = await launch({
            ...watch, cwd, env, store, runId, startRun: !started, ownsRun: false, launchToken: launchTokens[attempt - 1], agent: AGENT, role: PLAN_ROLE, step: 'plan', risk: fields.risk, expectBase: trust.baseSha,
            prompt: planPrompt({ ticket, fields, via, problems }), item: ticket, maxTurns: PLAN_MAX_TURNS, inputs: problems ? { ...given.inputs, 'last-plan.md': problems.text } : given.inputs, jsonSchema: via === 'schema' ? PLAN_SCHEMA : null, now,
          });
        } catch (err) {
          // A launch that threw: almost always refused before it started. Its numbers, if it ran,
          // are in the run log only; a plan launch is never a round either way.
          settleLaunch(store, ticket, { launch: guard.launch, outcome: 'refused', refundable: true });
          throw err;
        }
        started = true;
        settleLaunch(store, ticket, { launch: guard.launch, outcome: r.outcome, refundable: r.refundable, line: r.line });
        result.launches.push({ id: r.launchId, outcome: r.outcome, why: r.why, line: r.line });
        if (r.outcome !== 'ok') {
          result.outcome = r.outcome;
          result.why = r.why;
          return result;
        }
        const got = planFrom(r, { via });
        let text = null;
        if (got.problem) problems = Object.assign([{ line: 1, reason: got.problem }], { text: String(r.text ?? '').slice(0, 20_000) });
        else {
          text = withFrontmatter(got.text, fields);
          // A new plan is never covered by an older approval: the approval goes first.
          rmSync(approvalPath(store, ticket), { force: true });
          storePlan(store, ticket, text);
          stored = true;
          const found = lintPlan(text, { registry, config, ticket }).filter((p) => p.severity === 'error');
          problems = found.length ? Object.assign(found, { text }) : null;
        }
        if (!problems) {
          toInProgress();
          result.outcome = 'waiting';
          result.gate = gateFor({ preset: config.preset, text });
          endState = 'finished';
          return result;
        }
        result.problems = [...problems];
      }
      // A second plan that fails: the ticket parks, through in-progress (04's machine), when a plan
      // was stored; with no plan at all it stays ready-for-dev.
      result.outcome = 'bad-plan';
      if (stored) {
        toInProgress();
        parkTicket(store, ticket, { reason: 'bad-plan', why: `its plan failed MIRAI's lint twice (${result.problems.length} problem(s))`, evidence: [`tickets/${ticket}/plan.md`] });
        result.why = 'parked: bad-plan';
      } else result.why = 'no plan came back twice; the ticket stays ready-for-dev';
      return result;
    } finally {
      // The run ends here, whichever launch it got to (a launch that threw may have started it).
      const run = readRunState(store);
      if (run?.state === 'running' && run.run_id === runId) writeRunState(store, endState, { clear: true });
    }
  });
}
