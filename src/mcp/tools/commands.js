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
// An initiative: a folder under the docs root (unit 38).
const INITIATIVE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
// A Markdown file's path in the repo, relative to its top: no leading / or -, no .., no spaces
// or control characters (the worker passes it to `mirai` as one argument).
const FILE = /^(?![-/.])(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+/-]{1,300}\.md$/;
// Unit 39: an item's path in the repo (relative, no ".."), with an optional "#part" (a hook in a
// settings file, a server in .mcp.json), as the ledger names it.
const ITEM = /^(?![-/])(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+/-]{1,300}(?:#[A-Za-z0-9._-]{1,100})?$/;
// One line of your words (a summary, where an item goes): no line breaks or control characters.
const LINE = /^[^\u0000-\u001f\u007f]{1,300}$/;
const WORD = /^[A-Za-z0-9][A-Za-z0-9._|*()-]{0,99}$/;
const STAGE = /^(scan|migrate|context|connect|finish)$/;
// The arguments a command may take besides those it needs (unit 39's optional ones).
const OPTIONAL = Object.freeze(['as', 'role', 'event', 'matcher', 'server', 'service', 'place', 'summary', 'n', 'drop']);
// What the red team costs, as the terminal says it before its y/N.
export const RED_TEAM_COST = 'Roughly (the terminal works out the exact numbers): the red team runs about 320 short Claude Code runs (Haiku; the adversarial ones on Opus), 6 at a time, roughly 25 to 35 minutes, on your Claude subscription. It works in clones of your integration branch under your home folder, with canary secrets and a canary keychain item and git credential it removes afterwards; your checkout isn\'t touched. If macOS asks whether a program may control Terminal or System Events, answer no. It also runs your test levels once in their containers (Docker Desktop must be running).';
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
  show: { quick: true, needs: ['ticket'], flags: ['full', 'json', 'docs'], argv: (a) => ['show', a.ticket, ...(a.full ? ['--full'] : []), ...(a.json ? ['--json'] : []), ...(a.docs ? ['--docs'] : [])] },
  // Unit 37: a type's template as the project's approved overlays render it (read-only). The
  // overlay list is `show` with ticket "overlays", as `show context` is.
  'show template': { quick: true, needs: ['type'], argv: (a) => ['show', 'template', a.type] },
  'show checklist': { quick: true, needs: ['type'], argv: (a) => ['show', 'checklist', a.type] },
  ship: { needs: ['ticket'], argv: (a) => ['ship', a.ticket] },
  // Read-only, or a draft for you to review (unit 28, the standing rule).
  // Unit 29c (decision 3): doctor and its safe repairs, from your session too.
  doctor: { quick: true, flags: ['fix', 'json'], argv: (a) => ['doctor', ...(a.fix ? ['--fix'] : []), ...(a.json ? ['--json'] : [])] },
  // Unit 29d: a ticket's MR on one screen (read-only here; the merge is a gate).
  'review-mr': { quick: true, needs: ['ticket'], flags: ['diff', 'json'], argv: (a) => ['review-mr', a.ticket, ...(a.diff ? ['--diff'] : []), ...(a.json ? ['--json'] : [])] },
  // Unit 29a: the last run's report, or the M1 rate (read-only; it saves a report not saved yet).
  report: { quick: true, flags: ['json', 'm1'], argv: (a) => ['report', ...(a.json ? ['--json'] : []), ...(a.m1 ? ['--m1'] : [])] },
  'config check': { quick: true, argv: () => ['config', 'check'] },
  'config show': { quick: true, argv: () => ['config', 'show'] },
  protected: { quick: true, argv: () => ['protected'] },
  'trust check': { quick: true, argv: () => ['trust', 'check'] },
  // Unit 33: an epic's generated sections, from its ticket files; it writes the repo's docs only.
  'epic render': { quick: true, needs: ['file'], argv: (a) => ['epic', 'render', a.file] },
  // Unit 34: the reader test of a document's summary; one short model run, recorded in the store.
  'reader-test': { needs: ['file'], argv: (a) => ['reader-test', a.file] },
  detect: { argv: () => ['detect'] },
  // Unit 38: the docs merge request. Neither decides anything new: publish pushes the documents
  // as they are, and merge needs your signed approvals, not a typed key.
  'docs publish': { needs: ['initiative'], argv: (a) => ['docs', 'publish', a.initiative] },
  'docs merge': { needs: ['initiative'], argv: (a) => ['docs', 'merge', a.initiative] },
  // Unit 39: the guided setup's record (/mirai setup alone loads the mirai-setup skill, which calls
  // these), and mirai custom add. None is a gate: stage commits and approvals stay yours.
  setup: { quick: true, argv: () => ['setup', 'status'] },
  'setup status': { quick: true, argv: () => ['setup', 'status'] },
  'setup scan': { quick: true, argv: () => ['setup', 'scan'] },
  'setup decide': { quick: true, needs: ['path'], opts: ['place', 'drop', 'summary'], argv: (a) => ['setup', 'decide', a.path, ...(a.place ? ['--keep', a.place] : []), ...(a.drop ? ['--drop'] : []), ...(a.summary ? ['--summary', a.summary] : [])] },
  'setup review': { quick: true, argv: () => ['setup', 'review'] },
  'setup defer': { quick: true, needs: ['path'], argv: (a) => ['setup', 'defer', a.path] },
  'setup checklist': { opts: ['n'], argv: (a) => ['setup', 'checklist', ...(a.n ? ['--done', String(a.n)] : [])] },
  'setup start': { quick: true, needs: ['stage'], argv: (a) => ['setup', 'start', a.stage] },
  'setup done': { quick: true, needs: ['stage'], argv: (a) => ['setup', 'done', a.stage] },
  'custom add': {
    quick: true, needs: ['path'], opts: ['as', 'role', 'event', 'matcher', 'server', 'service'],
    argv: (a) => ['custom', 'add', a.path, ...['as', 'role', 'server', 'service', 'matcher'].flatMap((k) => (a[k] ? [`--${k}`, a[k]] : [])), ...(a.event ? ['--hook', a.event] : [])],
  },
});

// Jet's standing rule (2026-11-12): every command also runs from your session, unless it's a gate
// (above) or here, with the reason. A test holds every command of the CLI to one of the three.
export const NOT_FROM_SESSION = Object.freeze({
  agent: 'its session form is the start_agent tool (19c)',
  hook: 'git runs it, never you or a session',
  log: 'its session form is the log_event tool, which marks a note as the session\'s (15b)',
  feedback: 'its session form is the log_event tool\'s feedback type, which marks the line as your session\'s (29a)',
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
  unpark: (a) => `mirai unpark ${a.ticket ?? '<ticket>'} --retry   (or, for a disputed finding you accept: mirai unpark ${a.ticket ?? '<ticket>'} --accept <finding-id>; for a package install you accept: mirai unpark ${a.ticket ?? '<ticket>'} --accept-deps)`,
  'redteam accept-blocker': () => 'mirai redteam accept-blocker <id> --note <why>',
  key: () => 'mirai key new',
  token: () => 'mirai token set',
  'session-server': () => 'mirai session-server install   (or remove)',
  // Unit 28 (decision 2): proofs are signed with your key, from your terminal only until row 29b.
  'gate record': (a) => `mirai gate record ${a.ticket ?? '<ticket>'}`,
  // Unit 29d (D-34): your merge is the gate; from your terminal only, the ticket key typed.
  merge: (a) => `mirai merge ${a.ticket ?? '<ticket>'}   (or mirai review-mr ${a.ticket ?? '<ticket>'} there, and answer m)`,
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
    if (!['ticket', 'level', 'file', 'type', 'initiative', 'recheck', 'kept', 'confirm', 'abandon', 'full', 'json', 'docs', 'm1', 'fix', 'diff', 'path', 'stage', ...OPTIONAL].includes(k)) return { refused: `${k} isn't an argument here` };
  }
  // Unit 39's arguments.
  if (args.path !== undefined) {
    if (typeof args.path !== 'string' || !ITEM.test(args.path)) return { refused: 'path must be an item\'s path in the repo, relative to its top, such as .claude/skills/deploy or .claude/settings.json#hooks.PostToolUse.0' };
    out.path = args.path;
  }
  if (args.stage !== undefined) {
    if (typeof args.stage !== 'string' || !STAGE.test(args.stage)) return { refused: 'stage is one of scan, migrate, context, connect, finish' };
    out.stage = args.stage;
  }
  for (const k of OPTIONAL) {
    if (args[k] === undefined) continue;
    if (!(spec.opts ?? []).includes(k)) return { refused: `${command} doesn't take ${k}` };
    if (k === 'drop') {
      if (typeof args.drop !== 'boolean') return { refused: 'drop is true or false' };
      if (args.drop) out.drop = true;
    } else if (k === 'n') {
      if (!Number.isInteger(args.n) || args.n < 1 || args.n > 50) return { refused: 'n is a checklist line\'s number' };
      out.n = args.n;
    } else if (typeof args[k] !== 'string' || !((k === 'place' || k === 'summary') ? LINE : WORD).test(args[k])) return { refused: `${k} isn't a value MIRAI takes here` };
    else out[k] = args[k];
  }
  // Unit 33: a document's path in the repo (`epic render`), relative, a Markdown file.
  if (args.file !== undefined) {
    if (typeof args.file !== 'string' || !FILE.test(args.file)) return { refused: 'file must be a Markdown file\'s path in the repo, relative to its top, such as docs/mirai/due-dates/epic-due-dates.md' };
    out.file = args.file;
  }
  if (args.ticket !== undefined) {
    if (typeof args.ticket !== 'string' || !TICKET.test(args.ticket)) return { refused: 'ticket must be a ticket key' };
    out.ticket = args.ticket;
  }
  if (args.level !== undefined) {
    if (typeof args.level !== 'string' || !NAME.test(args.level)) return { refused: 'level must be a test level or check name' };
    out.level = args.level;
  }
  if (args.type !== undefined) {
    if (typeof args.type !== 'string' || !NAME.test(args.type)) return { refused: 'type must be a document type\'s name, such as prd' };
    out.type = args.type;
  }
  if (args.initiative !== undefined) {
    if (typeof args.initiative !== 'string' || !INITIATIVE.test(args.initiative) || args.initiative === 'tickets') return { refused: 'initiative must be an initiative\'s folder name under the docs root, such as due-dates' };
    out.initiative = args.initiative;
  }
  if (args.confirm !== undefined) {
    if (command !== 'redteam run' || typeof args.confirm !== 'string' || !CODE.test(args.confirm)) return { refused: 'confirm is the one-time code redteam run gave you' };
    out.confirm = args.confirm;
  }
  for (const flag of ['recheck', 'kept', 'abandon', 'full', 'json', 'docs', 'm1', 'fix', 'diff']) {
    if (args[flag] === undefined) continue;
    if (typeof args[flag] !== 'boolean') return { refused: `${flag} is true or false` };
    if (!(spec.flags ?? []).includes(flag)) return { refused: `${command} doesn't take ${flag}` };
    if (args[flag]) out[flag] = true;
  }
  if (!Object.hasOwn(GATES, command)) {
    for (const need of spec.needs ?? []) if (out[need] === undefined) return { refused: `${command} needs ${need}` };
    for (const k of ['ticket', 'level', 'file', 'type', 'initiative', 'path', 'stage']) if (out[k] !== undefined && !(spec.needs ?? []).includes(k)) return { refused: `${command} doesn't take ${k}` };
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
      type: { type: 'string', pattern: NAME.source, description: 'a document type, for show template and show checklist (unit 37)' },
      initiative: { type: 'string', pattern: INITIATIVE.source, description: 'an initiative (its folder under the docs root), for docs publish and docs merge (unit 38)' },
      file: { type: 'string', pattern: FILE.source, description: 'a document\'s path in the repo: the epic file for epic render (unit 33), the document for reader-test (unit 34)' },
      recheck: { type: 'boolean', description: 'with build: MIRAI\'s checks again, no agent' },
      kept: { type: 'boolean', description: 'with redteam run: test the Claude Code agents run now' },
      confirm: { type: 'string', pattern: CODE.source, description: 'with redteam run: the one-time code its first answer gave, once the person agreed to the cost' },
      abandon: { type: 'boolean', description: 'with resume: give the stopped run up instead' },
      full: { type: 'boolean', description: 'with show: every finding\'s text, the plan, the parking note whole' },
      json: { type: 'boolean', description: 'with show or report: as JSON' },
      docs: { type: 'boolean', description: 'with show: the initiative\'s documents (docs/mirai/<name>/), when the name is also a ticket (unit 32)' },
      m1: { type: 'boolean', description: 'with report: the M1 acceptance rate over every merged or closed MR' },
      diff: { type: 'boolean', description: 'with review-mr: the whole diff of the code' },
      fix: { type: 'boolean', description: 'with doctor: repair what\'s safe (a dead process\'s locks, the run state, the branch registry)' },
      path: { type: 'string', pattern: ITEM.source, description: 'an item\'s path in the repo, for custom add, setup decide and setup defer (unit 39)' },
      stage: { type: 'string', enum: ['scan', 'migrate', 'context', 'connect', 'finish'], description: 'a setup stage, for setup start and setup done' },
      as: { type: 'string', pattern: WORD.source, description: 'with custom add: an agent\'s MIRAI agent (mirai-developer, mirai-reviewer) or skill; a hook\'s form: interactive, check or both' },
      role: { type: 'string', pattern: WORD.source, description: 'with custom add: an agent overlay\'s role' },
      event: { type: 'string', pattern: WORD.source, description: 'with custom add: a hook\'s event, such as PostToolUse' },
      matcher: { type: 'string', pattern: WORD.source, description: 'with custom add: the tools a hook matches, such as Edit|Write' },
      server: { type: 'string', pattern: WORD.source, description: 'with custom add of .mcp.json: the server' },
      service: { type: 'string', pattern: WORD.source, description: 'with custom add of a hook kept as a check: its compose service' },
      place: { type: 'string', description: 'with setup decide: where a kept item goes (one line)' },
      drop: { type: 'boolean', description: 'with setup decide: the item is dropped' },
      summary: { type: 'string', description: 'with setup decide: what the item does, from the research (one line)' },
      n: { type: 'integer', description: 'with setup checklist: a line you mark done' },
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
