import { rmSync } from 'node:fs';

import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { checkTicketArg, confirmByTyping, readApprovedFile, ticketNow } from '../human-move.js';
import { createPrompter, requireTty } from '../tty.js';
import { TICKET } from '../../status/machines.js';
import { move } from '../../status/move.js';
import { openStore } from '../../store/home.js';
import { checkEvent, withSeq } from '../../store/journal.js';
import { checkTicketStatusWrite, writeTicketStatusIn } from '../../store/tickets.js';
import { contentHash, signObject } from '../../sign/sign.js';
import { approvalPath, declaredChanges, gateFor, lintPlan, planApproval, planContext, planPath, readPlan } from '../../agent/plan.js';
import { approvalHash } from '../../lint/frozen.js';
import { plain } from '../../status/text.js';
import { atomicWrite } from '../../store/files.js';
import { snapshot, trustedConfig, trustedRegistry } from '../../trust/snapshot.js';
import { loadSigner } from '../../sign/signer.js';

// mirai approve <ticket> --file <path> (unit 06; D-17, D-34). In a real terminal only. Signs your
// decision on the file's exact bytes ("accepted as is / edited / rejected", with an optional
// one-line reason, R-M18) and, unless rejected, moves the ticket draft → ready-for-dev, signed,
// in one step.
const DECISIONS = { a: 'accepted', e: 'edited', r: 'rejected' };

export default {
  name: 'approve',
  summary: 'Approve a ticket, signed, in a real terminal',
  usage: 'mirai approve <ticket> --file <path> | mirai approve <ticket> --plan',
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
    const signer = loadSigner(io.env, store);
    const file = readApprovedFile(store.checkout, io.cwd, args.values.file);
    const current = ticketNow(store, ticket, signer.keys);
    // A ticket already ready-for-dev may be approved again, as merged (unit 21a: a plan refuses a
    // ticket that isn't the file you approved): a new signed line, no move.
    const again = current.state === 'ready-for-dev';
    if (!again) move(TICKET, current.state, 'ready-for-dev', { by: 'human', item: ticket }); // refused unless draft
    const hash = contentHash(file.bytes);

    io.stdout.write(`ticket: ${ticket} (${current.state})\nfile:   ${file.path}\nhash:   ${hash}\nkey:    ${signer.keyId}\n`);
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
      await confirmByTyping(prompter, ticket);
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
  const signer = loadSigner(io.env, store);
  const current = ticketNow(store, ticket, signer.keys);
  if (current.state !== 'in-progress') throw new MiraiError(`${ticket} is ${current.state}; a plan waits at the gate while the ticket is in-progress`, EXIT.BLOCKED);
  const text = readPlan(store, ticket);
  if (text === null) throw Object.assign(new MiraiError(`${ticket} has no plan yet`, EXIT.BLOCKED), { hint: `mirai plan ${ticket}` });
  // Already approved: you may still reject it, before the build (21a re-review).
  const already = planApproval(store, ticket, signer.keys).ok;
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

  io.stdout.write(`ticket: ${ticket} (${current.state})\nplan:   ${planPath(store, ticket)}\nhash:   ${hash ?? 'none (no frozen block)'}\nwhy you: ${gate.why.join('; ')}\n`);
  io.stdout.write(`declared: ${declared.length ? declared.map((r) => `${r.kind} ${plain(r.item)}`).join(', ') : 'none'}\nkey:    ${signer.keyId}\n`);
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
    }
    await confirmByTyping(prompter, ticket);
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
