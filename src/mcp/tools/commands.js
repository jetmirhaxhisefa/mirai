import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { createRequest, readStatus, REQUEST_ID, writeStatus } from '../../agent/requests.js';
import { escapeInvisible } from '../../status/text.js';
import { startOf, workerGone } from './agents.js';

// `/mirai <command>` in your own Claude Code session (unit 21f): the commands that aren't gates run
// from the session as they do in your terminal, through this server and the detached worker
// (19c's), never by the session calling `mirai` itself (R3-C3). No allow rule is added: Claude
// Code asks you each time, as for start_agent, so a file that talks the session's model into a call
// shows you the prompt. The gates (approve, discard, unpark, your key and token) need your key and
// your typed confirmation: here they answer with the terminal command, and run nothing.

const TICKET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CODE = /^[0-9a-f]{16}$/;
// What the red team costs, as the terminal says it before its y/N.
export const RED_TEAM_COST = 'Roughly (the terminal works out the exact numbers): the red team runs about 320 short Claude Code runs (Haiku; the adversarial ones on Sonnet), 6 at a time, roughly 25 to 35 minutes, on your Claude subscription. It works in clones of your integration branch under your home folder, with canary secrets and a canary keychain item and git credential it removes afterwards; your checkout isn\'t touched. If macOS asks whether a program may control Terminal or System Events, answer no. It also runs your test levels once in their containers (Docker Desktop must be running).';
// One-time codes for a red-team run, kept in this server only, for ten minutes.
const codes = new Map();
const CODE_MS = 10 * 60_000;

// Each command: the arguments it takes, and its argv for `mirai`. `quick`: answered at once (the
// tool waits for its worker, a few seconds); else it runs on and `mirai_status` follows it.
export const COMMANDS = Object.freeze({
  status: { quick: true, argv: () => ['status'] },
  lint: { quick: true, argv: () => ['lint'] },
  test: { needs: ['level'], argv: (a) => ['test', a.level] },
  baseline: { argv: () => ['baseline'] },
  'baseline show': { quick: true, argv: () => ['baseline', 'show'] },
  'redteam status': { quick: true, argv: () => ['redteam', 'status'] },
  'redteam show': { quick: true, argv: () => ['redteam', 'show'] },
  // Two steps (21f review): the first call answers with what it costs and a one-time code; the second,
  // with that code, is your consent in place of the terminal's y/N.
  'redteam run': { flags: ['kept'], consent: true, argv: (a) => ['redteam', 'run', ...(a.kept ? ['--kept'] : [])] },
  'branch verify': { quick: true, needs: ['ticket'], argv: (a) => ['branch', 'verify', a.ticket] },
  'sandbox show': { quick: true, argv: () => ['sandbox', 'show'] },
  version: { quick: true, argv: () => ['version'] },
  help: { quick: true, argv: () => ['help'] },
  plan: { needs: ['ticket'], tty: true, argv: (a) => ['plan', a.ticket] },
  build: { needs: ['ticket'], flags: ['recheck'], tty: true, argv: (a) => ['build', a.ticket, ...(a.recheck ? ['--recheck'] : [])] },
  fix: { needs: ['ticket'], tty: true, argv: (a) => ['fix', a.ticket] },
  // Unit 24a: Rex's review, a step like fix (21f's rule: what isn't a gate runs from your session).
  review: { needs: ['ticket'], tty: true, argv: (a) => ['review', a.ticket] },
  // Unit 28 (Jet's standing rule: every command runs from the session unless it's a gate): the run,
  // which stops before the proofs from here (they're signed with your key, in your terminal); its
  // resume; a ticket's page; and ship, which signs nothing.
  run: { needs: ['ticket'], tty: true, run: true, argv: (a) => ['run', a.ticket] },
  resume: { flags: ['abandon'], tty: true, run: true, argv: (a) => ['resume', ...(a.abandon ? ['--abandon'] : [])] },
  show: { quick: true, needs: ['ticket'], flags: ['full', 'json'], argv: (a) => ['show', a.ticket, ...(a.full ? ['--full'] : []), ...(a.json ? ['--json'] : [])] },
  ship: { needs: ['ticket'], argv: (a) => ['ship', a.ticket] },
  // Read-only, or a draft for you to review (unit 28, the standing rule).
  'config check': { quick: true, argv: () => ['config', 'check'] },
  'config show': { quick: true, argv: () => ['config', 'show'] },
  protected: { quick: true, argv: () => ['protected'] },
  'trust check': { quick: true, argv: () => ['trust', 'check'] },
  detect: { argv: () => ['detect'] },
});

// Jet's standing rule (2026-11-12): every command also runs from your session, unless it's a gate
// (above) or here, with the reason. A test holds every command of the CLI to one of the three.
export const NOT_FROM_SESSION = Object.freeze({
  agent: 'its session form is the start_agent tool (19c)',
  hook: 'git runs it, never you or a session',
  log: 'its session form is the log_event tool, which marks a note as the session\'s (15b)',
  session: 'its session form is the session_start and session_end tools (19c)',
  init: 'a session\'s copy of MIRAI can\'t bring a newer one, and it rewrites files in your work tree (21f)',
  render: 'it rewrites files in your work tree (21f)',
  'trust snapshot': 'MIRAI builds the trust root itself before every step',
});

// The gates: never run here. Each answers with the command to type in your terminal.
export const GATES = Object.freeze({
  approve: (a) => `mirai approve ${a.ticket ?? '<ticket>'} --file <the ticket's path>`,
  'approve --plan': (a) => `mirai approve ${a.ticket ?? '<ticket>'} --plan`,
  drop: (a) => `mirai drop ${a.ticket ?? '<ticket>'}`,
  discard: (a) => `mirai discard ${a.ticket ?? '<ticket>'}`,
  // Unit 24a: a dispute is settled either way, both signed, in your terminal.
  unpark: (a) => `mirai unpark ${a.ticket ?? '<ticket>'} --retry   (or, for a disputed finding you accept: mirai unpark ${a.ticket ?? '<ticket>'} --accept <finding-id>)`,
  'redteam accept-blocker': () => 'mirai redteam accept-blocker <id> --note <why>',
  key: () => 'mirai key new',
  token: () => 'mirai token set',
  'session-server': () => 'mirai session-server install   (or remove)',
  // Unit 28 (decision 2): proofs are signed with your key, from your terminal only until row 29b.
  'gate record': (a) => `mirai gate record ${a.ticket ?? '<ticket>'}`,
});

const refuse = (code, message) => ({ body: { outcome: 'refused', code, message }, isError: true });
const storeOf = (policy) => ({ dir: policy.store.dir, repoId: policy.store.repo_id });

// The arguments, checked: { command, ticket?, level?, recheck?, kept? } → { args } or { refused }.
export function checkCommand(args) {
  const command = args?.command;
  if (typeof command !== 'string' || (!Object.hasOwn(COMMANDS, command) && !Object.hasOwn(GATES, command))) return { refused: `command must be one of: ${[...Object.keys(COMMANDS), ...Object.keys(GATES)].join(', ')}` };
  const spec = COMMANDS[command] ?? { needs: [], flags: [] };
  const out = { command };
  for (const k of Object.keys(args)) {
    if (k === 'command') continue;
    if (!['ticket', 'level', 'recheck', 'kept', 'confirm', 'abandon', 'full', 'json'].includes(k)) return { refused: `${k} isn't an argument here` };
  }
  if (args.ticket !== undefined) {
    if (typeof args.ticket !== 'string' || !TICKET.test(args.ticket)) return { refused: 'ticket must be a ticket key' };
    out.ticket = args.ticket;
  }
  if (args.level !== undefined) {
    if (typeof args.level !== 'string' || !NAME.test(args.level)) return { refused: 'level must be a test level or check name' };
    out.level = args.level;
  }
  if (args.confirm !== undefined) {
    if (command !== 'redteam run' || typeof args.confirm !== 'string' || !CODE.test(args.confirm)) return { refused: 'confirm is the one-time code redteam run gave you' };
    out.confirm = args.confirm;
  }
  for (const flag of ['recheck', 'kept', 'abandon', 'full', 'json']) {
    if (args[flag] === undefined) continue;
    if (typeof args[flag] !== 'boolean') return { refused: `${flag} is true or false` };
    if (!(spec.flags ?? []).includes(flag)) return { refused: `${command} doesn't take ${flag}` };
    if (args[flag]) out[flag] = true;
  }
  if (!Object.hasOwn(GATES, command)) {
    for (const need of spec.needs ?? []) if (out[need] === undefined) return { refused: `${command} needs ${need}` };
    for (const k of ['ticket', 'level']) if (out[k] !== undefined && !(spec.needs ?? []).includes(k)) return { refused: `${command} doesn't take ${k}` };
  }
  return { args: out };
}

export const miraiCommand = Object.freeze({
  name: 'mirai_command',
  description: 'Run one MIRAI command in this project, as `mirai <command>` in your terminal would (status, run, resume, show, plan, build, fix, review, ship, baseline, lint, test, redteam status/run, …). Approvals and your key and token are never run here: the answer is the terminal command to type. A long command runs on: follow it with mirai_status.',
  exclusive: false,
  contexts: Object.freeze(['interactive']),
  enabled: (policy) => Boolean(policy.tools.mirai_command),
  schema: () => ({
    type: 'object',
    properties: {
      command: { type: 'string', enum: [...Object.keys(COMMANDS), ...Object.keys(GATES)] },
      ticket: { type: 'string', pattern: TICKET.source, description: 'the ticket key, for plan, build, fix, review, run, show, ship, branch verify and the gates' },
      level: { type: 'string', pattern: NAME.source, description: 'the test level or check, for test' },
      recheck: { type: 'boolean', description: 'with build: MIRAI\'s checks again, no agent' },
      kept: { type: 'boolean', description: 'with redteam run: test the Claude Code agents run now' },
      confirm: { type: 'string', pattern: CODE.source, description: 'with redteam run: the one-time code its first answer gave, once the person agreed to the cost' },
      abandon: { type: 'boolean', description: 'with resume: give the stopped run up instead' },
      full: { type: 'boolean', description: 'with show: every finding\'s text, the plan, the parking note whole' },
      json: { type: 'boolean', description: 'with show: the page as JSON' },
    },
    required: ['command'],
    additionalProperties: false,
  }),
  check: checkCommand,
  async run(args, ctx) {
    const { policy } = ctx;
    if (Object.hasOwn(GATES, args.command)) {
      return { body: { outcome: 'yours', command: args.command, run_in_your_terminal: GATES[args.command](args), why: 'it needs your key and your typed confirmation, in a terminal: the model in this session can\'t give either' }, isError: false };
    }
    // The red team: what it costs first, with a one-time code; it runs only when the code comes back.
    if (COMMANDS[args.command].consent) {
      const now = (ctx.deps.now ?? Date.now)();
      for (const [k, v] of codes) if (now - v.at > CODE_MS) codes.delete(k);
      // A code is for the run it was given for: with or without --kept (21f re-review).
      const asked = codes.get(args.confirm);
      if (!args.confirm || !asked || asked.kept !== Boolean(args.kept)) {
        const code = (ctx.deps.randomCode ?? (() => randomBytes(8).toString('hex')))();
        codes.set(code, { at: now, kept: Boolean(args.kept) });
        return { body: { outcome: 'confirm', command: args.command, cost: RED_TEAM_COST, confirm: code, next: 'show the cost to the person; only if they agree, call mirai_command again with confirm set to this code' }, isError: false };
      }
      codes.delete(args.confirm);
    }
    const worker = join(policy.trust_dir, 'tree', '.mirai', 'framework', 'bin', 'agent-worker.js');
    if (!existsSync(worker)) return refuse('no-worker', 'this trust root\'s MIRAI has no worker');
    const claude = policy.tools.start_agent?.claude ?? '';
    let node;
    try {
      node = realpathSync(process.execPath);
    } catch {
      return refuse('no-node', 'node isn\'t where it was when the server started');
    }
    const store = storeOf(policy);
    const { id, token } = createRequest(store, { kind: 'command', ...args });
    const child = (ctx.deps.spawn ?? spawn)('/usr/bin/env', ['-i', `HOME=${policy.home}`, 'PATH=/usr/bin:/bin', node, worker, policy.checkout, id, claude], { detached: true, stdio: ['pipe', 'ignore', 'ignore'], cwd: policy.checkout });
    child.on?.('error', (err) => writeStatus(store, id, { state: 'done', outcome: 'refused', why: `the worker didn't start: ${err.message}` }));
    // Only while it's still queued: a fast worker may already be running it (21f review).
    if (child.pid && ['queued', undefined].includes(readStatus(store, id)?.state)) writeStatus(store, id, { state: 'queued', pid: child.pid, started: startOf(child.pid) });
    child.stdin.on('error', () => {});
    child.stdin.end(`${token}\n`);
    child.unref();
    // A quick command's answer comes back at once (a few seconds at most).
    if (COMMANDS[args.command].quick) {
      const wait = ctx.deps.quickWaitMs ?? 20_000;
      const until = Date.now() + wait;
      while (Date.now() < until) {
        const s = readStatus(store, id);
        if (s?.state === 'done') return { body: shownStatus(s), isError: false };
        await new Promise((done) => setTimeout(done, 200));
      }
    }
    return { body: { request: id, state: 'running', command: args.command, next: 'ask mirai_status with this request id about every 30 seconds' }, isError: false };
  },
});

// A status for the session: strings stripped of invisible characters; the progress lines are 21e's
// filtered ones, and the output is MIRAI's own text for the command.
function shownStatus(s) {
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'string' ? escapeInvisible(v) : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? escapeInvisible(x) : x)) : v]));
}

export const miraiStatus = Object.freeze({
  name: 'mirai_status',
  description: 'Where a command started by mirai_command stands: running (with its newest progress lines) or done (with what it printed and its exit code).',
  exclusive: false,
  contexts: Object.freeze(['interactive']),
  enabled: (policy) => Boolean(policy.tools.mirai_status),
  schema: () => ({ type: 'object', properties: { request: { type: 'string', pattern: REQUEST_ID.source } }, required: ['request'], additionalProperties: false }),
  check(args) {
    return typeof args.request === 'string' && REQUEST_ID.test(args.request) ? { args: { request: args.request } } : { refused: 'request must be a request id from mirai_command' };
  },
  async run({ request }, ctx) {
    let s = readStatus(storeOf(ctx.policy), request);
    if (!s) return refuse('unknown-request', `no request ${request} here`);
    if (['queued', 'running'].includes(s.state) && workerGone(s)) s = { ...s, state: 'lost', why: 'its worker is gone' };
    return { body: shownStatus(s), isError: false };
  },
});
