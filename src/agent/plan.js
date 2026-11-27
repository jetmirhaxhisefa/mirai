import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { DEPENDENCY_KINDS } from './dependency-rows.js';
import { join } from 'node:path';
import { checkGap, moveAtStart } from '../redteam/move.js';
import { runRedTeam } from '../redteam/run.js';

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
import { ADR_RULES } from '../adr/context.js';
import { techNoteFlags } from './tech-note.js';
import { TICKET } from '../status/machines.js';
import { move } from '../status/move.js';
import { verifyPlanApproval } from '../lint/frozen.js';
import { branchKeys } from '../sign/keys.js';
import { atomicWrite, ensurePrivateDir } from '../store/files.js';
import { readJournal } from '../store/journal.js';
import { isQuickTicket } from '../tickets/quick.js';
import { contentHash } from '../sign/sign.js';
import { sameKey, tableIn } from '../lint/checks.js';
import { renderNotes, reviewNotes } from './review-notes.js';
import { normalizePlan } from '../lint/normalize.js';
import { readRunState, writeRunState } from '../store/run.js';
import { readTicketStatus, writeTicketStatus } from '../store/tickets.js';
import { effectiveRegistry } from '../trust/overlays.js';
import { templateTextOf } from '../config/overlays.js';
import { snapshot, trustedConfig, trustedRegistry } from '../trust/snapshot.js';
import { planInputs, ticketAcs } from './inputs.js';
import { checkLaunchToken } from './requests.js';
import { inRun, launchInRun } from './run.js';
import { agentNamer } from './names.js';
import { investigationRefusal } from '../tickets/types.js';

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
// The lint problems of a plan that parked `bad-plan` (unit 28's session check): the status note is
// one short line, so `mirai show` reads them here, tied to the plan they're about by its hash.
export const planLintPath = (store, ticket) => join(store.dir, 'tickets', ticket, 'plan-lint.json');
export function readPlanLint(store, ticket, planText) {
  try {
    const r = JSON.parse(readFileSync(planLintPath(store, ticket), 'utf8'));
    return planText !== null && r?.plan_sha256 === contentHash(planText) && Array.isArray(r.problems) ? r.problems : null;
  } catch {
    return null;
  }
}
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
  // Unit 61 (decision 5): no plan, because it would go against an accepted ADR.
  const conflict = ADR_CONFLICT.exec(text.trim());
  if (conflict) return { conflict: { adr: conflict[1], why: conflict[2].trim().slice(0, 300) } };
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
export function planFrontmatter({ ticket, acs, risk, tdd, tests, round, ticketType = null }) {
  return ['---', `id: ${ticket}-plan`, 'type: plan', 'template: plan@v2', `ticket: ${ticket}`, `acs: [${acs.join(', ')}]`, `risk: ${risk}`, `tdd: ${tdd}`, `tests: ${tests}`, `round: ${round}`, ...(ticketType ? [`ticket_type: ${ticketType}`] : []), '---', ''].join('\n');
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
  const dependency = declaredChanges(`---\n---\n${body}`).some((r) => DEPENDENCY_KINDS.includes(r.kind));
  return `${planFrontmatter({ ...fields, risk: fields.risk === 'high' || dependency ? 'high' : 'normal' })}${body.replace(/^\n+/, '')}`;
}

// Who approves the plan (design/01 §6): the preset's plan gate (PRESETS), and you whatever the
// preset for a high-risk ticket or a plan that declares protected paths or new dependencies.
// { gate: 'human' | 'auto', required, why }. Nothing approves automatically before unit 28: an
// `auto` gate still waits for you meanwhile.
// Unit 45 (Scope 6; U4): `quick`, a lone ticket on the quick track: the preset's gate is `auto`.
export function gateFor({ preset, text, quick = false, flags = [] }) {
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
  if (rows.some((r) => DEPENDENCY_KINDS.includes(r.kind))) required.push(`it declares new dependencies (${rows.filter((r) => DEPENDENCY_KINDS.includes(r.kind)).map((r) => r.item).join(', ').slice(0, 300)}), which MIRAI installs once you approve`);
  // Unit 23 (decision 2): changing an existing test is always yours to see.
  if (rows.some((r) => r.kind === 'test-change')) required.push('it changes existing tests');
  // Unit 62b (Scope 6): a departure from the approved technical note is yours to accept or send back.
  if (flags.length) required.push(`it departs from the technical note (${flags.map((f) => f.d ?? 'no D-n cited').join(', ')})`);
  const byPreset = quick ? 'auto' : PRESETS[preset]?.plan ?? 'human';
  const why = [...(byPreset === 'human' ? [`the ${preset} preset`] : []), ...required];
  return { gate: why.length ? 'human' : 'auto', required: required.length > 0, why };
}

// Kai's answer instead of a plan when the ticket can't be planned without going against an
// accepted ADR (unit 61): one line, the ADR's id and why.
export const ADR_CONFLICT = /^ADR-CONFLICT:[ \t]*([A-Za-z0-9][A-Za-z0-9._-]{0,63}):[ \t]*(\S[^\n]*)$/;

export function planPrompt({ ticket, fields, via, problems = null, notes = 0, techNote = false }) {
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
    '',
    ADR_RULES,
    // Unit 62b (decision 4): the approved technical note holds.
    ...(techNote ? ['tech-note.md is the approved technical note: build as it says. Add "## Technical note" to the plan with "Relies on: D-n, …" (the decisions you build on) and, for each decision you can\'t follow, "Departs from D-n: <why>"; the owner accepts or sends the plan back at the gate.'] : []),
    `To stop on an ADR, return instead of the plan exactly one line: ADR-CONFLICT: <the ADR's id>: <why the ticket can't be planned within it>${via === 'schema' ? ' (as your structured output\'s `plan`)' : ' (as the only fenced ```markdown block)'}.`,
  ];
  if (notes > 0) {
    lines.push('', `Your reviewer rejected or sent back earlier plans for ${ticket}: review-notes.md in the input folder holds ${notes === 1 ? 'the note' : `all ${notes} notes`}, oldest first. Each still holds unless a later note or the ticket says otherwise; where a note and the approved ticket disagree, follow the ticket and say so in Design notes.`);
  }
  if (problems) {
    // Unit 30c: grouped by rule, so one fix covers every row a rule names.
    const groups = new Map();
    for (const p of problems.slice(0, 50)) {
      const key = p.code ?? 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    lines.push('', 'Your last plan failed MIRAI\'s lint; it is last-plan.md in the input folder. Fix exactly these problems, every row each rule names, and return the whole plan again:');
    for (const [key, list] of groups) {
      lines.push(`${key} (${list.length}):`, ...list.map((p) => `- line ${p.line}: ${p.reason}${p.hint ? ` (${p.hint})` : ''}`));
    }
  }
  return lines.join('\n');
}

// The plan lint (08b) with the trust root's registry and the project's levels.
export function lintPlan(text, { registry, config, ticket, files = null }) {
  return lintText(text, { source: `tickets/${ticket}/plan.md`, registry, project: projectOf(config), files });
}

// The repo's files at a commit (unit 30c: the plan's Test IDs are checked against them), or null.
export function filesAt(store, commit) {
  try {
    const out = execFileSync('git', ['ls-tree', '-r', '-z', '--name-only', commit], { cwd: store.checkout, env: store.gitEnv, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    return new Set(out.toString('utf8').split('\0').filter(Boolean));
  } catch {
    return null;
  }
}

// `mirai plan <ticket>`: { outcome, ticket, problems, gate, launches, path, why }. `launchTokens`:
// two one-time tokens (the launch and its one fix), minted by the caller, your terminal or the
// orchestrator (D-14): a plan library never mints its own. `launchOptions`: from trusted in-process
// callers only, the ways a launch is stopped (signals, time limits) and the hooks the tests and
// the CLI's own test io use (the binary, the red-team status, the init check); never its role,
// agent, inputs, prompt or token (LAUNCH_OPTIONS). `launch` is for the tests.
// `who`: the command's namer (unit 38b, src/agent/names.js), so one command introduces an agent once.
export const LAUNCH_OPTIONS = ['signal', 'hardSignal', 'claude', 'status', 'check', 'timeoutMs', 'initDeadlineMs', 'onProgress', 'onCheck', 'who'];
// The namer a step uses: the command's, or one of its own.
export const namerOf = (watch) => (typeof watch.who === 'function' ? watch.who : agentNamer());

// The ticket's last approval in the journal (unit 06), and how many times you rejected its plan.
export function ticketRecord(store, ticket, keys) {
  const { events } = readJournal(store, { keys });
  const mine = events.filter((e) => e.type === 'approval' && sameKey(e.item, ticket));
  const approved = mine.filter((e) => e.kind === 'ticket' && e.decision !== 'rejected').at(-1) ?? null;
  return { approved, rejections: mine.filter((e) => e.kind === 'plan' && e.decision === 'rejected').length, notes: reviewNotes(events, ticket) };
}

export async function runPlan({ cwd, env, ticket, launchTokens, via = 'schema', unattended = false, launchOptions = {}, launch = launchInRun, run: outerRun = null, now = () => new Date() }) {
  // Checked here, spent by each launch: no plan runs without them.
  if (!Array.isArray(launchTokens) || launchTokens.length !== 2) checkLaunchToken(null);
  for (const t of launchTokens) checkLaunchToken(t);
  const watch = Object.fromEntries(Object.entries(launchOptions).filter(([k]) => LAUNCH_OPTIONS.includes(k)));
  const who = namerOf(watch);
  // The first sign of life (unit 21e), before MIRAI's own checks.
  try {
    watch.onProgress?.({ kind: 'preparing', agent: who(AGENT), model: null, turns: 0, minutes: 0 });
  } catch {
    // a display only
  }
  return await inRun({ cwd, env, run: outerRun }, async ({ store, runId, tookOver, outer }) => {
    const status = readTicketStatus(store, ticket)?.status ?? null;
    if (status?.state !== 'ready-for-dev') throw fail(`${ticket} is ${status?.state ?? 'not approved yet'}; a plan starts from ready-for-dev`, 'not-ready', EXIT.BLOCKED, status ? undefined : 'approve the ticket first: mirai approve <ticket> --file <path>');
    // Unit 18h: a ticket with no pin starts on the newest Claude Code MIRAI can move to (a red team
    // first, with your consent), and doesn't start once a move has waited too long. A Claude Code
    // given for the launch (a test, a probe) is used as it is.
    if (!watch.claude) {
      await moveAtStart({ cwd, env, store, ticket, run: runRedTeam, say: watch.onCheck ?? (() => {}), now });
      checkGap(store, ticket, { now });
    }
    // The usage check before a ticket (unit 20), then the trust root and the inputs.
    const usage = usageCheck({ env, unattended });
    if (!usage.go) throw usageStop(usage);
    const trust = snapshot({ cwd, env });
    const config = trustedConfig(trust);
    // Unit 37: with the project's approved overlays (the plan's template as the project renders it).
    const registry = effectiveRegistry(trust, store);
    const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
    const template = templateTextOf(registry, registry.documentTypes.plan);
    // Room left for the fix launch's last-plan.md. Sibling plans only when you approved them.
    const limits = { files: INPUT_LIMITS.files - 1, bytes: INPUT_LIMITS.bytes - PLAN_MAX_BYTES };
    // Unit 30c (F21): your rejection and unpark notes, for the plan and its fix launch.
    const record = ticketRecord(store, ticket, keys);
    const notesText = renderNotes(ticket, record.notes);
    const extra = notesText ? [{ name: 'review-notes.md', from: 'journal: your plan rejections and unpark notes', why: 'your notes on earlier plans of this ticket, oldest first', text: notesText }] : [];
    const given = planInputs({ root: store.checkout, env: store.gitEnv, commit: trust.baseSha, ticketId: ticket, config, store, template, limits, approved: (id) => planApproval(store, id, keys).ok, extra });
    // The ticket on the integration branch must be the one you approved (unit 06's content hash): a
    // ticket edited and merged after that would drive the plan's fields and its gate.
    if (!record.approved) throw fail(`${ticket} has no approval of yours in the journal`, 'no-ticket-approval', EXIT.BLOCKED, `approve it: mirai approve ${ticket} --file ${given.ticket.path}`);
    if (record.approved.content_hash !== contentHash(given.ticket.bytes)) throw fail(`${ticket} on the integration branch (${given.ticket.path}) isn't the file you approved`, 'ticket-changed', EXIT.BLOCKED, `on the integration branch, read it and approve it as merged: mirai approve ${ticket} --file ${given.ticket.path}`);
    const fm = given.ticket.fm;
    // Unit 42 (Scope 6): an investigation (research and a written finding, no code merge) runs in
    // its own run, unit 42b. Until it's built, it isn't planned or built here.
    const notYet = investigationRefusal(fm, ticket, config);
    if (notYet) throw fail(notYet.message, 'investigation-not-yet', EXIT.BLOCKED, notYet.hint);
    const fields = {
      ticket, acs: ticketAcs(given.ticket), risk: fm.risk === 'high' ? 'high' : 'normal',
      tdd: ['auto', 'first', 'after'].includes(fm.tdd) ? fm.tdd : config.testing?.tdd ?? 'auto', tests: ['required', 'optional'].includes(fm.tests) ? fm.tests : config.testing?.tests ?? 'required',
      // Every plan you rejected and the orchestrator's re-plan (the loop counters', L4) count apart,
      // so a later plan is never an earlier round. A plan cut short isn't a round.
      round: 1 + record.rejections + readLoop(store, ticket).replans_used,
      // Unit 23: a bug's plan needs a red row (the lint's tdd rule).
      ticketType: fm.type === 'bug' ? 'bug' : 'story',
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
      let baseFiles;
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
            ...watch, cwd, env, store, runId, startRun: !outer && !started, ownsRun: false, launchToken: launchTokens[attempt - 1], agent: AGENT, progressLabel: who(AGENT), role: PLAN_ROLE, step: 'plan', risk: fields.risk, expectBase: trust.baseSha,
            prompt: planPrompt({ ticket, fields, via, problems, notes: record.notes.length, techNote: Boolean(given.inputs['tech-note.md']) }), item: ticket, maxTurns: PLAN_MAX_TURNS, inputs: problems ? { ...given.inputs, 'last-plan.md': problems.text } : given.inputs, jsonSchema: via === 'schema' ? PLAN_SCHEMA : null, now,
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
        // Unit 61: a conflict with an accepted ADR parks the ticket for you (decision_type adr-conflict).
        if (got.conflict) {
          toInProgress();
          parkTicket(store, ticket, { reason: 'adr-conflict', why: `${got.conflict.adr}: ${got.conflict.why}`, evidence: [`tickets/${ticket}/plan.md`] });
          result.outcome = 'parked';
          result.decision_type = 'adr-conflict';
          result.conflict = got.conflict;
          result.why = `parked: adr-conflict (${got.conflict.adr}: ${got.conflict.why})`;
          endState = 'finished';
          return result;
        }
        let text = null;
        if (got.problem) problems = Object.assign([{ line: 1, reason: got.problem }], { text: String(r.text ?? '').slice(0, 20_000) });
        else {
          text = withFrontmatter(got.text, fields);
          // Unit 30c (Jet's decision 1): format slips whose meaning is certain are fixed here, and
          // logged in the plan; the lint sees the rest.
          baseFiles ??= filesAt(store, trust.baseSha);
          text = normalizePlan(text, { files: baseFiles }).text;
          // A new plan is never covered by an older approval: the approval goes first.
          rmSync(approvalPath(store, ticket), { force: true });
          storePlan(store, ticket, text);
          stored = true;
          const found = lintPlan(text, { registry, config, ticket, files: baseFiles }).filter((p) => p.severity === 'error');
          problems = found.length ? Object.assign(found, { text }) : null;
          // The plan step's stages (unit 21e): its lint, and whether the one fix launch follows.
          try {
            watch.onCheck?.({ kind: 'check', name: 'plan-lint', state: problems ? `fail (${problems.length} problem${problems.length === 1 ? '' : 's'})${attempt === 1 ? ': one fix launch' : ''}` : 'pass' });
          } catch {
            // a display only
          }
        }
        if (!problems) {
          toInProgress();
          result.outcome = 'waiting';
          result.gate = gateFor({ preset: config.preset, text, quick: isQuickTicket(readJournal(store).events, ticket, config.docs?.root ?? 'docs/mirai'), flags: techNoteFlags(text, given.inputs['tech-note.md'] ?? null) });
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
        // Each problem, for `mirai show` (the parking note has room for the count only).
        const planText = readPlan(store, ticket);
        if (planText !== null) {
          const problems = result.problems.slice(0, 50).map((p) => ({ line: Number.isSafeInteger(p.line) ? p.line : null, code: typeof p.code === 'string' ? p.code.slice(0, 40) : null, reason: String(p.reason ?? '').slice(0, 400), ...(p.hint ? { hint: String(p.hint).slice(0, 400) } : {}) }));
          atomicWrite(planLintPath(store, ticket), `${JSON.stringify({ plan_sha256: contentHash(planText), problems })}\n`);
        }
        parkTicket(store, ticket, { reason: 'bad-plan', why: `its plan failed MIRAI's lint twice (${result.problems.length} problem(s): mirai show ${ticket} lists them)`, evidence: [`tickets/${ticket}/plan.md`] });
        result.why = 'parked: bad-plan';
      } else result.why = 'no plan came back twice; the ticket stays ready-for-dev';
      return result;
    } finally {
      // The run ends here, whichever launch it got to (a launch that threw may have started it).
      const run = readRunState(store);
      if (!outer && run?.state === 'running' && run.run_id === runId) writeRunState(store, endState, { clear: true });
    }
  });
}
