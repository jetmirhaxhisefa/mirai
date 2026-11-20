import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { posix } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { checkTicketArg, confirmByTyping, readApprovedFile, ticketNow } from '../human-move.js';
import { createPrompter, requireTty } from '../tty.js';
import { TICKET } from '../../status/machines.js';
import { move } from '../../status/move.js';
import { openStore } from '../../store/home.js';
import { checkEvent, readJournal, withSeq } from '../../store/journal.js';
import { checkTicketStatusWrite, writeTicketStatusIn } from '../../store/tickets.js';
import { contentHash, signObject } from '../../sign/sign.js';
import { approvalPath, declaredChanges, gateFor, lintPlan, planApproval, planContext, planPath, readPlan, ticketRecord } from '../../agent/plan.js';
import { approvalHash } from '../../lint/frozen.js';
import { plain } from '../../status/text.js';
import { atomicWrite } from '../../store/files.js';
import { snapshot, trustedConfig, trustedRegistry } from '../../trust/snapshot.js';
import { decisionSigner } from '../../sign/signer.js';
import { branchKeys } from '../../sign/keys.js';
import { noteAgainstTicket } from '../../agent/review-notes.js';
import { readFrontmatter } from '../../lint/frontmatter.js';
import { lintText, parseDocument, projectOf as projectOfConfig } from '../../lint/lint.js';
import { upstreamLine } from '../../lint/rules.js';

// mirai approve <ticket> --file <path> (unit 06; D-17, D-34). In a real terminal only. Signs your
// decision on the file's exact bytes ("accepted as is / edited / rejected", with an optional
// one-line reason, R-M18) and, unless rejected, moves the ticket draft → ready-for-dev, signed,
// in one step.
const DECISIONS = { a: 'accepted', e: 'edited', r: 'rejected' };

export default {
  name: 'approve',
  summary: 'Approve a ticket, a plan or a brief, signed, in a real terminal',
  usage: 'mirai approve <ticket> --file <path> | mirai approve <ticket> --plan | mirai approve <brief-id> --file <brief.md> | mirai approve <prd-id> --file <prd.md>',
  positionals: { min: 1, max: 1 },
  options: {
    file: { type: 'string', description: 'the ticket file you approve' },
    plan: { type: 'boolean', description: 'approve or reject the ticket\'s plan, from the store (unit 21a)' },
  },
  async run(args, io, { now = () => new Date() } = {}) {
    const [ticket] = args.positionals;
    checkTicketArg(ticket);
    requireTty(io, 'mirai approve');
    if (args.values.plan) {
      if (args.values.file !== undefined) throw new UsageError('give --file or --plan, not both');
      return approvePlan(ticket, io, now);
    }
    const store = openStore({ cwd: io.cwd, env: io.env });
    const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
    const file = readApprovedFile(store.checkout, io.cwd, args.values.file);
    // Unit 31: a document (a brief; unit 32: a PRD), not a ticket.
    const docType = documentTypeOf(file.bytes);
    if (DOCUMENTS.has(docType)) return approveDocument({ id: ticket, type: docType, file, store, io, now, fileArg: args.values.file });
    const current = ticketNow(store, ticket, keys);
    // A ticket already ready-for-dev may be approved again, as merged (unit 21a: a plan refuses a
    // ticket that isn't the file you approved): a new signed line, no move.
    const again = current.state === 'ready-for-dev';
    if (!again) move(TICKET, current.state, 'ready-for-dev', { by: 'human', item: ticket }); // refused unless draft
    const hash = contentHash(file.bytes);

    io.stdout.write(`ticket: ${ticket} (${current.state})\nfile:   ${file.path}\nhash:   ${hash}\n`);
    const prompter = createPrompter(io);
    try {
      const asked = now().getTime();
      const answer = (await prompter.ask('accepted as is / edited / rejected? [a/e/r] ')).toLowerCase();
      const decision = DECISIONS[answer];
      if (!decision) throw new UsageError(`${JSON.stringify(answer.slice(0, 10))} is not a, e or r; nothing was written`, 'run it again');
      const answeredAfter = Math.round((now().getTime() - asked) / 100) / 10;
      let reason;
      if (decision !== 'accepted') {
        reason = await prompter.ask('reason (optional, one line): ');
        if (reason.length > 500) throw new UsageError('the reason is longer than 500 characters; nothing was written', 'keep it to one line');
        if (reason === '') reason = undefined;
      }
      // Unit 29b: your passphrase (or the typed key, for a plain key or an unlocked one).
      const signer = await decisionSigner(io, store, { prompter, ticket, confirm: confirmByTyping });
      // What you approved is what was shown: the file must not have changed while you answered.
      if (contentHash(readApprovedFile(store.checkout, io.cwd, args.values.file).bytes) !== hash) {
        throw new MiraiError(`${file.path} changed while you were answering; nothing was written`, EXIT.FAILURE);
      }

      const approval = checkEvent({
        type: 'approval', by: 'human', item: ticket, kind: 'ticket', path: file.path, content_hash: hash, decision,
        ...(reason ? { reason } : {}), answered_after_s: answeredAfter,
      });
      const moveTo = { ticket, state: 'ready-for-dev', written_by: 'human' };
      const seq = withSeq(store, (ctx) => {
        // The move's checks come first, so a refused move leaves no approval behind.
        const moving = decision !== 'rejected' && !again;
        if (moving) checkTicketStatusWrite(store, moveTo, { expectSeq: current.seq, signer });
        const n = ctx.take();
        ctx.event(n, approval, { signer });
        if (moving) writeTicketStatusIn(ctx, store, moveTo, { expectSeq: current.seq, signer });
        return n;
      });
      io.stdout.write(decision === 'rejected'
        ? `recorded: ${ticket} rejected (signed with ${signer.keyId}, seq ${seq}); it stays ${current.state}\n`
        : again ? `approved again: ${ticket}, as ${file.path} is now (${decision}; signed with ${signer.keyId}, seq ${seq}); it stays ready-for-dev\n`
          : `approved: ${ticket} is ready-for-dev (${decision}; signed with ${signer.keyId}, seq ${seq})\n`);
      return EXIT.OK;
    } finally {
      prompter.close();
    }
  },
};

// mirai approve <ticket> --plan (unit 21a; R2-M11, 08b). The plan gate: you read the plan in the
// store, and your answer is signed. Approved: your signature over its approvalHash (the frozen
// block, the declared changes and the approved fields) under mirai/plan-approval/1, kept beside
// the plan, and an approval line in the journal. Rejected: the line, and the ticket goes back to
// ready-for-dev for a re-plan, which counts as its one (04, 20). The plan is linted again first.
const PLAN_DECISIONS = { a: 'accepted', r: 'rejected' };

async function approvePlan(ticket, io, now) {
  const store = openStore({ cwd: io.cwd, env: io.env });
  const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
  const current = ticketNow(store, ticket, keys);
  if (current.state !== 'in-progress') throw new MiraiError(`${ticket} is ${current.state}; a plan waits at the gate while the ticket is in-progress`, EXIT.BLOCKED);
  const text = readPlan(store, ticket);
  if (text === null) throw Object.assign(new MiraiError(`${ticket} has no plan yet`, EXIT.BLOCKED), { hint: `mirai plan ${ticket}` });
  // Already approved: you may still reject it, before the build (21a re-review).
  const already = planApproval(store, ticket, keys).ok;
  if (already) io.stdout.write(`note: ${ticket}'s plan is already approved, as it is now; answer r to take that back\n`);
  const trust = snapshot({ cwd: io.cwd, env: io.env });
  const config = trustedConfig(trust);
  // The lint is for an approval only: a plan that fails it (a newer rule, a stored plan cut short)
  // can always be rejected, so the ticket never sticks at in-progress (21a review).
  const problems = lintPlan(text, { registry: trustedRegistry(trust), config, ticket }).filter((p) => p.severity === 'error');
  const hash = approvalHash(text);
  const unapprovable = problems.length ? `it fails the lint (${problems.length} problem(s), such as line ${problems[0].line}: ${problems[0].reason})` : hash === null ? 'it has no readable frozen block' : null;
  if (unapprovable) io.stdout.write(`note: ${ticket}'s plan can't be approved: ${plain(unapprovable)}; you can reject it\n`);
  const gate = gateFor({ preset: config.preset, text });
  const declared = declaredChanges(text).filter((r) => r.kind !== 'none');

  // The plan itself, so what you approve is in front of you (Jet, 2026-11-15): Kai's text, each
  // line shown not acted on (no escape sequence reaches your terminal).
  const rule = '─'.repeat(72);
  io.stdout.write(`${rule}\n${text.replace(/\n$/, '').split('\n').map((l) => plain(l)).join('\n')}\n${rule}\n`);
  io.stdout.write(`ticket: ${ticket} (${current.state})\nplan:   ${planPath(store, ticket)}\nhash:   ${hash ?? 'none (no frozen block)'}\nwhy you: ${gate.why.join('; ')}\n`);
  io.stdout.write(`declared: ${declared.length ? declared.map((r) => `${r.kind} ${plain(r.item)}`).join(', ') : 'none'}\n`);
  const prompter = createPrompter(io);
  try {
    const asked = now().getTime();
    const answer = (await prompter.ask('approved / rejected? [a/r] ')).toLowerCase();
    const decision = PLAN_DECISIONS[answer];
    if (!decision) throw new UsageError(`${JSON.stringify(answer.slice(0, 10))} is not a or r; nothing was written`, 'run it again');
    if (decision === 'accepted' && already) {
      io.stdout.write(`${ticket}'s plan stays approved; nothing was written\n`);
      return EXIT.OK;
    }
    if (decision === 'accepted' && unapprovable) throw new MiraiError(`${ticket}'s plan can't be approved: ${unapprovable}; nothing was written`, EXIT.BLOCKED);
    const answeredAfter = Math.round((now().getTime() - asked) / 100) / 10;
    let reason;
    if (decision === 'rejected') {
      reason = await prompter.ask('reason (optional, one line): ');
      if (reason.length > 500) throw new UsageError('the reason is longer than 500 characters; nothing was written', 'keep it to one line');
      if (reason === '') reason = undefined;
      // Unit 30c (F21): a note can't overrule the approved ticket; Kai follows the ticket.
      if (reason) {
        const against = noteAgainstTicketFile(store, keys, ticket, reason);
        if (against) io.stdout.write(`note: your reason names ${against.note.join(', ')}, which ${ticket}'s approved ticket doesn't (it names ${against.ticket.join(', ')}). Kai follows the ticket where they disagree: if the ticket is wrong, edit it and approve it again (mirai approve ${ticket} --file <path>) before the re-plan.\n`);
      }
    }
    const signer = await decisionSigner(io, store, { prompter, ticket, confirm: confirmByTyping });
    // What you approved is what was shown: the plan must not have changed while you answered.
    if (approvalHash(readPlan(store, ticket) ?? '') !== hash || (readPlan(store, ticket) ?? '') !== text) throw new MiraiError(`${ticket}'s plan changed while you were answering; nothing was written`, EXIT.FAILURE);

    const approval = checkEvent({
      type: 'approval', by: 'human', item: ticket, kind: 'plan', path: `tickets/${ticket}/plan.md`, content_hash: hash ?? contentHash(Buffer.from(text)), decision,
      ...(reason ? { reason } : {}), answered_after_s: answeredAfter,
    });
    const back = { ticket, state: 'ready-for-dev', written_by: 'human', replans: Math.min(1, (current.status?.replans ?? 0) + 1) };
    const moveContext = { move: { reason: 'plan-rejected' } };
    const seq = withSeq(store, (ctx) => {
      if (decision === 'rejected') checkTicketStatusWrite(store, back, { expectSeq: current.seq, signer, ...moveContext });
      const n = ctx.take();
      ctx.event(n, approval, { signer });
      if (decision === 'rejected') {
        writeTicketStatusIn(ctx, store, back, { expectSeq: current.seq, signer, ...moveContext });
        rmSync(approvalPath(store, ticket), { force: true });
      }
      else atomicWrite(approvalPath(store, ticket), `${JSON.stringify(signObject({ kind: 'plan', ticket, approval_hash: hash }, signer, { context: planContext(store), now }), null, 2)}\n`);
      return n;
    });
    io.stdout.write(decision === 'rejected'
      ? `recorded: ${ticket}'s plan rejected (signed with ${signer.keyId}, seq ${seq}); the ticket is ready-for-dev for its re-plan: mirai plan ${ticket}\n`
      : `approved: ${ticket}'s plan (signed with ${signer.keyId}, seq ${seq}); an edit to its frozen block, declared changes or key fields now needs a new approval\n`);
    return EXIT.OK;
  } finally {
    prompter.close();
  }
}

// The approved ticket's text on the integration branch, checked against a rejection note.
function noteAgainstTicketFile(store, keys, ticket, reason) {
  try {
    const path = ticketRecord(store, ticket, keys).approved?.path;
    if (!path) return null;
    const text = execFileSync('git', ['show', `${store.branch}:${path}`], { cwd: store.checkout, env: store.gitEnv, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    return noteAgainstTicket(reason, text);
  } catch {
    return null;
  }
}

// ---- Documents (unit 31) -----------------------------------------------------------------

// The document types approved with --file that aren't tickets. More come with B's units (epic,
// HLD …); each is approved on its exact bytes, after the lint as at approval. Unit 32 adds the
// PRD, approved with its brief (approvePrd).
const DOCUMENTS = new Set(['brief', 'prd']);

function documentTypeOf(bytes) {
  try {
    const t = readFrontmatter(bytes)?.value?.type;
    return typeof t === 'string' ? t : null;
  } catch {
    return null;
  }
}

// mirai approve <id> --file <brief.md>: the lint first, as at approval (no open question left),
// then your decision, signed, on the file's exact bytes. A brief changed after its approval
// needs a new one (documentApproval).
async function approveDocument({ id, type, file, store, io, now, fileArg }) {
  const fm = readFrontmatter(file.bytes);
  if (fm.value.id !== id) throw new UsageError(`${file.path} is the ${type} "${fm.value.id}", not "${id}"; nothing was written`, `run: mirai approve ${fm.value.id} --file ${fileArg}`);
  const trust = snapshot({ cwd: io.cwd, env: io.env });
  const config = trustedConfig(trust);
  const registry = trustedRegistry(trust);
  if (type === 'prd') return approvePrd({ id, fm, file, store, io, now, fileArg, registry, project: projectOfConfig(config) });
  const text = file.bytes.toString('utf8');
  refuseOnLint(io, [{ path: file.path, errors: lintText(text, { source: file.path, registry, project: projectOfConfig(config), approving: true }) }]);
  const hash = contentHash(file.bytes);
  const before = documentApproval(store, id, file.bytes);
  io.stdout.write(`${type}: ${id}${before.approved ? ' (approved before, as it is now)' : before.stale ? ' (approved before; it has changed since)' : ''}\nfile:   ${file.path}\nhash:   ${hash}\n`);
  const prompter = createPrompter(io);
  try {
    const asked = now().getTime();
    const answer = (await prompter.ask('accepted as is / edited / rejected? [a/e/r] ')).toLowerCase();
    const decision = DECISIONS[answer];
    if (!decision) throw new UsageError(`${JSON.stringify(answer.slice(0, 10))} is not a, e or r; nothing was written`, 'run it again');
    const answeredAfter = Math.round((now().getTime() - asked) / 100) / 10;
    let reason;
    if (decision !== 'accepted') {
      reason = await prompter.ask('reason (optional, one line): ');
      if (reason.length > 500) throw new UsageError('the reason is longer than 500 characters; nothing was written', 'keep it to one line');
      if (reason === '') reason = undefined;
    }
    const signer = await decisionSigner(io, store, { prompter, ticket: id, confirm: confirmByTyping });
    if (contentHash(readApprovedFile(store.checkout, io.cwd, fileArg).bytes) !== hash) {
      throw new MiraiError(`${file.path} changed while you were answering; nothing was written`, EXIT.FAILURE);
    }
    const approval = checkEvent({ type: 'approval', by: 'human', item: id, kind: type, path: file.path, content_hash: hash, decision, ...(reason ? { reason } : {}), answered_after_s: answeredAfter });
    const seq = withSeq(store, (ctx) => {
      const n = ctx.take();
      ctx.event(n, approval, { signer });
      return n;
    });
    io.stdout.write(decision === 'rejected'
      ? `recorded: the ${type} ${id} rejected (signed with ${signer.keyId}, seq ${seq})\n`
      : `approved: the ${type} ${id}, as ${file.path} is now (${decision}; signed with ${signer.keyId}, seq ${seq}); a change to it needs a new approval\n`);
    return EXIT.OK;
  } finally {
    prompter.close();
  }
}

// The lint as at approval, for one or more files: every error is listed, and nothing is written
// while any is left (31; unit 32: a PRD and its brief are refused together).
function refuseOnLint(io, results) {
  const failing = results.map((r) => ({ ...r, errors: r.errors.filter((p) => p.severity === 'error') })).filter((r) => r.errors.length);
  if (!failing.length) return;
  for (const r of failing) for (const p of r.errors.slice(0, 10)) io.stderr.write(`${r.path}:${p.line}: ${p.reason}${p.hint ? ` (${p.hint})` : ''}\n`);
  const n = failing.reduce((s, r) => s + r.errors.length, 0);
  throw Object.assign(new MiraiError(`${failing.map((r) => r.path).join(' and ')} can't be approved yet: ${n} lint problem${n === 1 ? '' : 's'}, listed above; nothing was written`, EXIT.BLOCKED), { hint: 'fix them, run mirai lint, then approve again' });
}

// The brief a PRD links to in the line under its title ("Brief: [title](brief.md)", decision 8),
// as a repo path, read as `mirai approve` reads any file: in the repo, a regular file.
function linkedBrief(store, prdPath, text, def) {
  const doc = parseDocument(text, prdPath);
  const title = doc.scan.headings.find((h) => h.level === 1);
  const first = title && doc.scan.lines.find((l) => l.line > title.line && (l.kind === 'text' || l.kind === 'fence' || l.kind === 'heading'));
  const m = first?.kind === 'text' ? upstreamLine(def).exec((first.visible ?? first.text).trim()) : null;
  if (!m) throw Object.assign(new MiraiError(`${prdPath} doesn't link its brief in the line under its title; nothing was written`, EXIT.BLOCKED), { hint: 'add "Brief: [<its title>](brief.md)" under the # title, then approve again' });
  const link = m[1];
  const rel = posix.normalize(posix.join(posix.dirname(prdPath), link));
  const brief = readApprovedFile(store.checkout, store.checkout, rel);
  return { link, file: brief, value: readFrontmatter(brief.bytes)?.value ?? {} };
}

// mirai approve <prd-id> --file <prd.md> (unit 32, Scope 7; decision 7). The PRD is linted with
// its brief, both as at approval.
// - standard (and quick): you read the PRD's summary, which covers both documents, and decide
//   once; two signed approval lines are written, one per file's exact bytes (kind brief, kind
//   prd), so a later change to either needs a new approval of that file only.
// - full: the brief was approved at its own step (U4 is only for standard), so the PRD is refused
//   unless the brief is approved as it is now.
async function approvePrd({ id, fm, file, store, io, now, fileArg, registry, project }) {
  const def = registry.documentTypes.prd;
  const text = file.bytes.toString('utf8');
  const brief = linkedBrief(store, file.path, text, def);
  const briefId = typeof brief.value.id === 'string' ? brief.value.id : null;
  if (brief.value.type !== 'brief' || !briefId) throw Object.assign(new MiraiError(`${brief.file.path}, which ${file.path} links, is not a brief; nothing was written`, EXIT.BLOCKED), { hint: 'link the brief this PRD comes from' });
  const pair = fm.value.track !== 'full';
  const briefText = brief.file.bytes.toString('utf8');
  const results = [{ path: file.path, errors: lintText(text, { source: file.path, registry, project, approving: true, linked: { [brief.link]: briefText } }) }];
  if (pair) results.unshift({ path: brief.file.path, errors: lintText(briefText, { source: brief.file.path, registry, project, approving: true }) });
  refuseOnLint(io, results);
  const briefBefore = documentApproval(store, briefId, brief.file.bytes);
  if (!pair && !briefBefore.approved) {
    throw Object.assign(new MiraiError(`the brief ${briefId} isn't approved${briefBefore.stale ? ' as it is now (it changed since its approval)' : ''}; on the full track it's approved before its PRD; nothing was written`, EXIT.BLOCKED), { hint: `run: mirai approve ${briefId} --file ${brief.file.path}` });
  }
  const prdHash = contentHash(file.bytes);
  const briefHash = contentHash(brief.file.bytes);
  const prdBefore = documentApproval(store, id, file.bytes);
  const state = (b) => (b.approved ? ' (approved before, as it is now)' : b.stale ? ' (approved before; it has changed since)' : '');
  io.stdout.write(`prd:    ${id}${state(prdBefore)}\nfile:   ${file.path}\nhash:   ${prdHash}\n`);
  io.stdout.write(`brief:  ${briefId}${pair ? state(briefBefore) : ' (approved, as it is now)'}\nfile:   ${brief.file.path}\nhash:   ${briefHash}\n`);
  if (pair) io.stdout.write(`one decision approves both: the brief and its PRD (track ${fm.value.track})\n`);
  const prompter = createPrompter(io);
  try {
    const asked = now().getTime();
    const answer = (await prompter.ask('accepted as is / edited / rejected? [a/e/r] ')).toLowerCase();
    const decision = DECISIONS[answer];
    if (!decision) throw new UsageError(`${JSON.stringify(answer.slice(0, 10))} is not a, e or r; nothing was written`, 'run it again');
    const answeredAfter = Math.round((now().getTime() - asked) / 100) / 10;
    let reason;
    if (decision !== 'accepted') {
      reason = await prompter.ask('reason (optional, one line): ');
      if (reason.length > 500) throw new UsageError('the reason is longer than 500 characters; nothing was written', 'keep it to one line');
      if (reason === '') reason = undefined;
    }
    const signer = await decisionSigner(io, store, { prompter, ticket: id, confirm: confirmByTyping });
    // What you approved is what was shown: neither file may have changed while you answered.
    for (const [path, hash] of [[file.path, prdHash], [brief.file.path, briefHash]]) {
      if (contentHash(readApprovedFile(store.checkout, store.checkout, path).bytes) !== hash) throw new MiraiError(`${path} changed while you were answering; nothing was written`, EXIT.FAILURE);
    }
    const line = (item, kind, path, hash) => checkEvent({ type: 'approval', by: 'human', item, kind, path, content_hash: hash, decision, ...(reason ? { reason } : {}), answered_after_s: answeredAfter });
    const events = [...(pair ? [line(briefId, 'brief', brief.file.path, briefHash)] : []), line(id, 'prd', file.path, prdHash)];
    const seqs = withSeq(store, (ctx) => events.map((ev) => {
      const n = ctx.take();
      ctx.event(n, ev, { signer });
      return n;
    }));
    const what = pair ? `the brief ${briefId} and the PRD ${id}, as ${brief.file.path} and ${file.path} are now` : `the PRD ${id}, as ${file.path} is now`;
    io.stdout.write(decision === 'rejected'
      ? `recorded: ${pair ? `the brief ${briefId} and the PRD ${id}` : `the PRD ${id}`} rejected (signed with ${signer.keyId}, seq ${seqs.join(', ')})\n`
      : `approved: ${what} (${decision}; signed with ${signer.keyId}, seq ${seqs.join(', ')}); a change to ${pair ? 'either' : 'it'} needs a new approval\n`);
    return EXIT.OK;
  } finally {
    prompter.close();
  }
}

// Whether `bytes` are the document `id` as you last approved it: { approved, stale, seq }.
// Only your signed lines count (readJournal verifies them); your last decision on the document
// is the one that holds.
export function documentApproval(store, id, bytes) {
  const last = readJournal(store).events.filter((e) => e.type === 'approval' && e.by === 'human' && DOCUMENTS.has(e.kind) && e.item === id).at(-1);
  if (!last || last.decision === 'rejected') return { approved: false, stale: false, seq: last?.seq ?? null };
  const same = last.content_hash === contentHash(bytes);
  return { approved: same, stale: !same, seq: last.seq };
}
