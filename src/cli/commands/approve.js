import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

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
import { trustedOverlays } from '../../trust/overlays.js';
import { decisionSigner } from '../../sign/signer.js';
import { branchKeys } from '../../sign/keys.js';
import { noteAgainstTicket } from '../../agent/review-notes.js';
import { readFrontmatter } from '../../lint/frontmatter.js';
import { lintText, parseDocument, projectOf as projectOfConfig, readTicketFolder } from '../../lint/lint.js';
import { ticketsOf } from '../../lint/graph.js';
import { linkLinesOf, upstreamLine } from '../../lint/rules.js';
import { readerResultFor } from '../../store/reader-tests.js';
import { failedLabels, needsReaderTest, readerRuns, resultLines, summaryHash, summaryText } from '../../write/reader.js';
import { VERIFY_AGENT, verifierField, verifierFor, verifierLines } from '../../verify/gate.js';
import { CONTEXT_DIR, contextKindOf, isContextFile } from '../../lint/context.js';
import { CUSTOM_DIR, CUSTOM_KINDS, RECORDS_FOLDER, overlayFilesIn, overlayRecord, overlayRecordContext, overlayState, readOverlays, recordPathOf, recordText, verifyRecords } from '../../config/overlays.js';
import { trustedRoles } from '../../agent/scope.js';
import { baseForArg, docsStoreFor } from '../../store/connectors/index.js';
import { documentLine } from '../../store/connectors/links.js';
import { agentNamer, fullName } from '../../agent/names.js';
import { applyChanges, changesOf } from '../../lint/requirements.js';
import { addJourneys, newJourneys } from '../../tickets/journeys.js';
import { traceDocuments } from '../../trace/documents.js';
import { approvedText, changedLines } from '../../util/line-diff.js';
import { docsMerge, docsPublish } from '../../store/connectors/publish.js';
import { coverageOf, dependsOnDropped, notesText, releaseOf, roundOf, rowLine, ticketRows } from '../../tickets/set-screen.js';
import { renderEpicFile } from '../../tess/render.js';
import { inputStates, missingLine, missingOf, notBuiltLine, readInput } from '../../tickets/inputs.js';
import { lastTessRun } from '../../tess/run.js';
import { isQuickTicket } from '../../tickets/quick.js';

// Unit 45 (Scope 6): a quick ticket's plan gate is auto, but nothing signs an auto approval yet.
export const QUICK_AUTO = 'the quick track\'s plan gate is auto for this ticket, but MIRAI can\'t sign an automatic approval yet (unit 55), so you approve it';
import { longRef } from '../../ship/words.js';

export { changedLines };

// mirai approve <ticket> --file <path> (unit 06; D-17, D-34). In a real terminal only. Signs your
// decision on the file's exact bytes ("accepted as is / edited / rejected", with an optional
// one-line reason, R-M18) and, unless rejected, moves the ticket draft → ready-for-dev, signed,
// in one step.
const DECISIONS = { a: 'accepted', e: 'edited', r: 'rejected' };

// Unit 37: the trust root's registry with your approved overlays applied; an overlay of one of
// `types` that's skipped (not approved as it is now) gets its one line, so you know MIRAI's type
// is what's checked.
function withOverlays(trust, store, io, types) {
  const r = trustedOverlays(trust, store);
  for (const x of r.skipped.filter((y) => y.kind === 'document-type' && types.includes(y.name))) io.stderr.write(`${plain(x.line)}\n`);
  return r.registry;
}

export default {
  name: 'approve',
  summary: 'Approve a ticket, a plan, a brief, a PRD, an epic with its tickets, a context file, or an overlay, signed, in a real terminal',
  usage: 'mirai approve <ticket> --file <path> | mirai approve <ticket> --plan | mirai approve <brief-id> --file <brief.md> | mirai approve <prd-id> --file <prd.md> | mirai approve <epic-id> --file <epic.md> | mirai approve --file .mirai/context/<file>.md | mirai approve --file .mirai/custom/<overlay>',
  positionals: { min: 0, max: 1 },
  options: {
    file: { type: 'string', description: 'the ticket file you approve' },
    plan: { type: 'boolean', description: 'approve or reject the ticket\'s plan, from the store (unit 21a)' },
  },
  async run(args, io, { now = () => new Date() } = {}) {
    const [ticket] = args.positionals;
    // Unit 36: a context file is named by its path alone; everything else needs its key or id.
    if (ticket === undefined && args.values.file === undefined) throw new UsageError('name what you approve', 'mirai approve <ticket> --file <path>, or mirai approve --file .mirai/context/<file>.md');
    if (ticket !== undefined) checkTicketArg(ticket);
    requireTty(io, 'mirai approve');
    if (args.values.plan) {
      if (ticket === undefined) throw new UsageError('--plan needs the ticket\'s key', 'mirai approve <ticket> --plan');
      if (args.values.file !== undefined) throw new UsageError('give --file or --plan, not both');
      return approvePlan(ticket, io, now);
    }
    const store = openStore({ cwd: io.cwd, env: io.env });
    const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
    // Unit 38: a document in the local store is read from there; everything else from the repo.
    const { conn, config: docsConfig } = docsStoreFor({ cwd: io.cwd, env: io.env, store });
    const base = baseForArg(conn, io.cwd, args.values.file);
    const file = readApprovedFile(base, io.cwd, args.values.file);
    // Unit 36: a file in .mirai/context/.
    if (file.path.startsWith(`${CONTEXT_DIR}/`)) return approveContext({ id: ticket, file, store, io, now, fileArg: args.values.file });
    // Unit 37: an overlay in .mirai/custom/.
    if (file.path.startsWith(`${CUSTOM_DIR}/`)) return approveOverlay({ id: ticket, file, store, io, now, fileArg: args.values.file });
    // Unit 41: a proposal to change business.md, named by its path alone, as a context file is.
    if (documentTypeOf(file.bytes) === 'business-change') return approveBusinessChange({ id: ticket, file, store, io, now, fileArg: args.values.file, base, conn });
    if (ticket === undefined) throw new UsageError(`name the ${documentTypeOf(file.bytes) ?? 'ticket'}'s key or id before --file`, `mirai approve <key-or-id> --file ${args.values.file}`);
    // Unit 31: a document (a brief; unit 32: a PRD), not a ticket.
    const docType = documentTypeOf(file.bytes);
    if (DOCUMENTS.has(docType)) return approveDocument({ id: ticket, type: docType, file, store, io, now, fileArg: args.values.file, base, conn });
    const current = ticketNow(store, ticket, keys);
    // A ticket already ready-for-dev may be approved again, as merged (unit 21a: a plan refuses a
    // ticket that isn't the file you approved): a new signed line, no move.
    const again = current.state === 'ready-for-dev';
    if (!again) move(TICKET, current.state, 'ready-for-dev', { by: 'human', item: ticket }); // refused unless draft
    const hash = contentHash(file.bytes);
    // Unit 42 (decision 2): a lone ticket written from its interview (/mirai ticket) is approved on
    // its own after the lint and Vera, as a document is.
    const lone = loneTicketGate({ io, store, file, ticket, base });

    io.stdout.write(`ticket: ${ticket} (${current.state})\nfile:   ${file.path}\nhash:   ${hash}\n`);
    if (lone) showVerifier(io, lone.vera);
    if (lone?.vera?.state === 'early') io.stdout.write(`or have her fix it first: mirai tickets fix ${ticket} (/mirai ticket fix ${ticket})\n`);
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
      if (contentHash(readApprovedFile(base, io.cwd, args.values.file).bytes) !== hash) {
        throw new MiraiError(`${file.path} changed while you were answering; nothing was written`, EXIT.FAILURE);
      }

      const approval = checkEvent({
        type: 'approval', by: 'human', item: ticket, kind: 'ticket', path: file.path, content_hash: hash, decision,
        ...(reason ? { reason } : {}), answered_after_s: answeredAfter, ...(lone ? verifierField(lone.vera) : {}),
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
      // Unit 38 (decision 8): the last line is the file's full path, and its host link once pushed.
      io.stdout.write(`${documentLine({ store, config: docsConfig, conn, abs: join(base, file.path), rel: file.path, bytes: file.bytes })}\n`);
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
  const problems = lintPlan(text, { registry: withOverlays(trust, store, io, ['plan']), config, ticket }).filter((p) => p.severity === 'error');
  const hash = approvalHash(text);
  const unapprovable = problems.length ? `it fails the lint (${problems.length} problem(s), such as line ${problems[0].line}: ${problems[0].reason})` : hash === null ? 'it has no readable frozen block' : null;
  if (unapprovable) io.stdout.write(`note: ${ticket}'s plan can't be approved: ${plain(unapprovable)}; you can reject it\n`);
  const gate = gateFor({ preset: config.preset, text, quick: isQuickTicket(readJournal(store).events, ticket, config.docs?.root ?? 'docs/mirai') });
  const declared = declaredChanges(text).filter((r) => r.kind !== 'none');

  // The plan itself, so what you approve is in front of you (Jet, 2026-11-15): Kai's text, each
  // line shown not acted on (no escape sequence reaches your terminal).
  const rule = '─'.repeat(72);
  io.stdout.write(`${rule}\n${text.replace(/\n$/, '').split('\n').map((l) => plain(l)).join('\n')}\n${rule}\n`);
  io.stdout.write(`ticket: ${ticket} (${current.state})\nplan:   ${planPath(store, ticket)}\nhash:   ${hash ?? 'none (no frozen block)'}\nwhy you: ${gate.why.length ? gate.why.join('; ') : QUICK_AUTO}\n`);
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
        if (against) io.stdout.write(`note: your reason names ${against.note.join(', ')}, which ${ticket}'s approved ticket doesn't (it names ${against.ticket.join(', ')}). ${fullName('mirai-developer')} follows the ticket where they disagree: if the ticket is wrong, edit it and approve it again (mirai approve ${ticket} --file <path>) before the re-plan.\n`);
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

// Unit 42 (decision 2; Jet's answer 3 "B, plus A+", 2026-11-24): every story or bug that belongs to
// no epic needs Vera's result for it as it is now, whoever wrote it; one of an epic is checked with
// its epic, and approved with it. A lone ticket that links its interview ("Interview:" under its
// title) is also linted as at approval, with its interview. A person's own ticket (no `tess_run`
// line of MIRAI's names it: the journal's record, which only MIRAI writes) may be approved anyway
// right after her first check, with must-fix findings open; one Tess wrote keeps the rounds. Null
// for any other ticket.
function loneTicketGate({ io, store, file, ticket, base }) {
  let doc;
  try {
    doc = parseDocument(file.bytes.toString('utf8'), file.path);
  } catch {
    return null;
  }
  const type = doc.value.type;
  if ((type !== 'story' && type !== 'bug') || (typeof doc.value.epic === 'string' && doc.value.epic !== '')) return null;
  const trust = snapshot({ cwd: io.cwd, env: io.env });
  const config = trustedConfig(trust);
  const registry = withOverlays(trust, store, io, [type, 'interview']);
  const own = linkLinesOf(doc.scan, registry.documentTypes[type]).find((l) => l.link.label === 'Interview');
  if (own) {
    const target = own.targets[0].split('#')[0];
    let interview;
    try {
      interview = readApprovedFile(base, base, posix.normalize(posix.join(posix.dirname(file.path), target)));
    } catch {
      throw Object.assign(new MiraiError(`${file.path} links its interview ${plain(target)}, which isn't a file; nothing was written`, EXIT.BLOCKED), { hint: 'correct the "Interview:" line, then approve again' });
    }
    refuseOnLint(io, [{ path: file.path, errors: lintText(file.bytes.toString('utf8'), { source: file.path, registry, project: projectOfConfig(config), approving: true, linked: { [target]: interview.bytes.toString('utf8') } }) }]);
  }
  const byTess = readJournal(store).events.some((e) => e.type === 'tess_run' && e.by === 'script' && typeof e.ticket === 'string' && e.ticket.toLowerCase() === String(ticket).toLowerCase());
  const vera = verifierFor({ store, config, def: registry.documentTypes[type], id: ticket, path: file.path, bytes: file.bytes, early: !byTess });
  return { vera, byTess };
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
const DOCUMENTS = new Set(['brief', 'prd', 'epic']);

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
async function approveDocument({ id, type, file, store, io, now, fileArg, base = store.checkout, conn = null }) {
  const fm = readFrontmatter(file.bytes);
  if (fm.value.id !== id) throw new UsageError(`${file.path} is the ${type} "${fm.value.id}", not "${id}"; nothing was written`, `run: mirai approve ${fm.value.id} --file ${fileArg}`);
  const trust = snapshot({ cwd: io.cwd, env: io.env });
  const config = trustedConfig(trust);
  // Unit 37: the type as the project's approved overlays make it.
  const registry = withOverlays(trust, store, io, type === 'prd' ? ['prd', 'brief'] : type === 'brief' ? ['brief', 'interview'] : [type, 'prd', 'story', 'bug']);
  if (type === 'epic') return approveEpic({ id, file, store, io, now, registry, config, project: projectOfConfig(config), base, conn });
  if (type === 'prd') return approvePrd({ id, fm, file, store, io, now, fileArg, registry, config, project: projectOfConfig(config), base, conn });
  const text = file.bytes.toString('utf8');
  // Unit 41 (Scope 4): a brief waits for the business.md proposal beside it.
  if (type === 'brief') refuseOpenProposal(store, base, file.path);
  const { linked, files: bound } = type === 'brief' ? interviewOf(base, file.path, text, registry) : { linked: {}, files: [] };
  refuseOnLint(io, [{ path: file.path, errors: lintText(text, { source: file.path, registry, project: projectOfConfig(config), approving: true, linked }) }]);
  // Unit 40: the lint, then Vera, then the reader test, then you.
  const vera = verifierFor({ store, config, def: registry.documentTypes[type], id, path: file.path, bytes: file.bytes });
  const reader = readerFor({ store, config, def: registry.documentTypes[type], value: fm.value, id, path: file.path, text });
  const hash = contentHash(file.bytes);
  const files = fileHashes(bound);
  const before = documentApproval(store, id, file.bytes, bound);
  io.stdout.write(`${type}: ${id}${before.approved ? ' (approved before, as it is now)' : before.stale ? ' (approved before; it or its interview has changed since)' : ''}\nfile:   ${file.path}\nhash:   ${hash}\n`);
  for (const f of files) io.stdout.write(`interview: ${plain(f.path)}   ${f.content_hash}, signed with the brief\n`);
  showVerifier(io, vera);
  showReader(io, reader);
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
    if (contentHash(readApprovedFile(base, io.cwd, fileArg).bytes) !== hash || signatureOf(fileHashes(briefFilesOf(base, type, file))) !== signatureOf(files)) {
      throw new MiraiError(`${file.path} or its interview changed while you were answering; nothing was written`, EXIT.FAILURE);
    }
    const approval = checkEvent({ type: 'approval', by: 'human', item: id, kind: type, path: file.path, content_hash: hash, ...(files.length ? { files } : {}), decision, ...(reason ? { reason } : {}), answered_after_s: answeredAfter, ...readerField(reader), ...verifierField(vera) });
    const misses = decision === 'rejected' ? missesOf([{ item: id, kind: type, path: file.path, vera }], reason) : [];
    const seq = withSeq(store, (ctx) => {
      const n = ctx.take();
      ctx.event(n, approval, { signer });
      for (const m of misses) ctx.event(ctx.take(), m);
      return n;
    });
    showMisses(io, misses);
    io.stdout.write(decision === 'rejected'
      ? `recorded: the ${type} ${id} rejected (signed with ${signer.keyId}, seq ${seq})\n`
      : `approved: the ${type} ${id}, as ${file.path} is now (${decision}; signed with ${signer.keyId}, seq ${seq}); a change to it needs a new approval\n`);
    io.stdout.write(`${documentLine({ store, config, conn, abs: join(base, file.path), rel: file.path, bytes: file.bytes })}\n`);
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
function linkedBrief(base, prdPath, text, def) {
  const doc = parseDocument(text, prdPath);
  const title = doc.scan.headings.find((h) => h.level === 1);
  const first = title && doc.scan.lines.find((l) => l.line > title.line && (l.kind === 'text' || l.kind === 'fence' || l.kind === 'heading'));
  const m = first?.kind === 'text' ? upstreamLine(def).exec((first.visible ?? first.text).trim()) : null;
  if (!m) throw Object.assign(new MiraiError(`${prdPath} doesn't link its brief in the line under its title; nothing was written`, EXIT.BLOCKED), { hint: 'add "Brief: [<its title>](brief.md)" under the # title, then approve again' });
  const link = m[1];
  const rel = posix.normalize(posix.join(posix.dirname(prdPath), link));
  const brief = readApprovedFile(base, base, rel);
  return { link, file: brief, value: readFrontmatter(brief.bytes)?.value ?? {} };
}

// The interview beside a brief (unit 35, Scope 4), for the brief's lint as `linked`: the one its
// "Interview:" line links, or else an interview.md beside it, which then fails as unlinked. A
// linked interview that isn't a file in the repo refuses the approval: the gate can't be
// checked without it. An entry beside the brief that isn't a regular file is passed empty, so
// the lint still reports it.
// Returns { linked, files }: `linked` for lintText, and `files`, the linked interview as
// [{ path, bytes }] (empty with no link), which the brief's approval line binds (see briefFiles).
function interviewOf(base, briefPath, text, registry) {
  let doc;
  try {
    doc = parseDocument(text, briefPath);
  } catch {
    return { linked: {}, files: [] };
  }
  const own = linkLinesOf(doc.scan, registry.documentTypes.brief).find((l) => l.link.label === 'Interview');
  const target = own ? own.targets[0].split('#')[0] : 'interview.md';
  const rel = posix.normalize(posix.join(posix.dirname(briefPath), target));
  try {
    const read = readApprovedFile(base, base, rel);
    return { linked: { [target]: read.bytes.toString('utf8') }, files: own ? [read] : [] };
  } catch {
    if (own) throw Object.assign(new MiraiError(`${briefPath} links its interview ${plain(target)}, which isn't a file in the repo; nothing was written`, EXIT.BLOCKED), { hint: 'correct the "Interview:" line, then approve again' });
    try {
      lstatSync(join(base, rel));
      return { linked: { [target]: '' }, files: [] };
    } catch {
      return { linked: {}, files: [] };
    }
  }
}

// The files a brief's approval binds besides the brief itself (unit 35): the interview its
// "Interview:" line links, as [{ path, bytes }], read as approval reads it. A linked interview
// that can't be read is given with no bytes, so it never matches an approved hash. It tells
// whether a brief is still approved as it is now (documentApproval), here and in mirai show.
const INTERVIEW_LINK = Object.freeze({ upstream_link: [{ label: 'Interview', required: false }] });
export function briefFiles(checkout, briefPath, bytes) {
  let doc;
  try {
    doc = parseDocument(bytes.toString('utf8'), briefPath);
  } catch {
    return [];
  }
  const own = linkLinesOf(doc.scan, INTERVIEW_LINK)[0];
  if (!own) return [];
  const rel = posix.normalize(posix.join(posix.dirname(briefPath), own.targets[0].split('#')[0]));
  try {
    return [readApprovedFile(checkout, checkout, rel)];
  } catch {
    return [{ path: rel, bytes: Buffer.alloc(0) }];
  }
}
const briefFilesOf = (base, type, file) => (type === 'brief' ? briefFiles(base, file.path, readApprovedFile(base, base, file.path).bytes) : []);
const fileHashes = (files) => files.map((f) => ({ path: f.path, content_hash: contentHash(f.bytes) }));
const signatureOf = (list) => list.map((f) => `${f.path} ${f.content_hash}`).sort().join('\n');

// mirai approve <prd-id> --file <prd.md> (unit 32, Scope 7; decision 7). The PRD is linted with
// its brief, both as at approval.
// - standard (and quick): you read the PRD's summary, which covers both documents, and decide
//   once; two signed approval lines are written, one per file's exact bytes (kind brief, kind
//   prd), so a later change to either needs a new approval of that file only.
// - full: the brief was approved at its own step (U4 is only for standard), so the PRD is refused
//   unless the brief is approved as it is now.
async function approvePrd({ id, fm, file, store, io, now, fileArg, registry, config, project, base = store.checkout, conn = null }) {
  const def = registry.documentTypes.prd;
  const text = file.bytes.toString('utf8');
  const brief = linkedBrief(base, file.path, text, def);
  const briefId = typeof brief.value.id === 'string' ? brief.value.id : null;
  if (brief.value.type !== 'brief' || !briefId) throw Object.assign(new MiraiError(`${brief.file.path}, which ${file.path} links, is not a brief; nothing was written`, EXIT.BLOCKED), { hint: 'link the brief this PRD comes from' });
  const pair = fm.value.track !== 'full';
  const briefText = brief.file.bytes.toString('utf8');
  // Unit 41: the brief waits for an open business.md proposal; the PRD is checked against the owner's
  // own list beside it (requirements.md), as `mirai lint` checks it.
  if (pair) refuseOpenProposal(store, base, brief.file.path);
  const requirements = besideText(base, file.path, 'requirements.md');
  // Unit 43 (Scope 8): the ID-stability lint against the version you last approved.
  const previous = lastApprovedText(store, conn, 'prd', id, file.path);
  const results = [{ path: file.path, errors: lintText(text, { source: file.path, registry, project, approving: true, previous, linked: { [brief.link]: briefText, ...(requirements === null ? {} : { 'requirements.md': requirements }) } }) }];
  const interview = pair ? interviewOf(base, brief.file.path, briefText, registry) : { linked: {}, files: [] };
  if (pair) results.unshift({ path: brief.file.path, errors: lintText(briefText, { source: brief.file.path, registry, project, approving: true, linked: interview.linked }) });
  refuseOnLint(io, results);
  // Unit 35: the brief's approval covers the interview it links, as it is now (on full, from the
  // brief's own approval; on standard, the brief's line here binds it).
  const briefBefore = documentApproval(store, briefId, brief.file.bytes, pair ? interview.files : briefFiles(base, brief.file.path, brief.file.bytes));
  const briefBound = fileHashes(interview.files);
  if (!pair && !briefBefore.approved) {
    throw Object.assign(new MiraiError(`the brief ${briefId} isn't approved${briefBefore.stale ? ' as it is now (it or its interview changed since its approval)' : ''}; on the full track it's approved before its PRD; nothing was written`, EXIT.BLOCKED), { hint: `run: mirai approve ${briefId} --file ${brief.file.path}` });
  }
  // Unit 40: Vera's result for each document this decision approves (on standard, the brief too),
  // before the reader test. Unit 34: the PRD's summary (on standard it covers the brief too) has its
  // reader-test result.
  // Unit 44: a finding you dismissed ("Vera is wrong") on this version no longer counts (gate.js).
  const briefVera = pair ? verifierFor({ store, config, def: registry.documentTypes.brief, id: briefId, path: brief.file.path, bytes: brief.file.bytes }) : null;
  const vera = verifierFor({ store, config, def, id, path: file.path, bytes: file.bytes });
  const reader = readerFor({ store, config, def, value: fm.value, id, path: file.path, text });
  const prdHash = contentHash(file.bytes);
  const briefHash = contentHash(brief.file.bytes);
  const prdBefore = documentApproval(store, id, file.bytes);
  const state = (b) => (b.approved ? ' (approved before, as it is now)' : b.stale ? ' (approved before; it has changed since)' : '');
  io.stdout.write(`prd:    ${id}${state(prdBefore)}\nfile:   ${file.path}\nhash:   ${prdHash}\n`);
  // Unit 42 (decision 3): approving the PRD again after an answer changed it shows only what changed
  // since your last approval (on the repo store, from the commit that holds the approved bytes); the
  // whole file is at its full path below.
  if (prdBefore.stale) showChangedSince(io, store, conn, id, file);
  io.stdout.write(`brief:  ${briefId}${pair ? state(briefBefore) : ' (approved, as it is now)'}\nfile:   ${brief.file.path}\nhash:   ${briefHash}\n`);
  for (const f of briefBound) io.stdout.write(`interview: ${plain(f.path)}   ${f.content_hash}, signed with the brief\n`);
  if (pair) io.stdout.write(`one decision approves both: the brief and its PRD (track ${fm.value.track})\n`);
  const who = agentNamer();
  if (briefVera && !briefVera.off) io.stdout.write(`the brief ${briefId}:\n`);
  showVerifier(io, briefVera, who);
  if (briefVera && !briefVera.off) io.stdout.write(`the PRD ${id}:\n`);
  showVerifier(io, briefVera?.off ? null : vera, who);
  showReader(io, reader);
  const prompter = createPrompter(io);
  let start = null;
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
    for (const [path, hash] of [[file.path, prdHash], [brief.file.path, briefHash], ...briefBound.map((f) => [f.path, f.content_hash])]) {
      if (contentHash(readApprovedFile(base, base, path).bytes) !== hash) throw new MiraiError(`${path} changed while you were answering; nothing was written`, EXIT.FAILURE);
    }
    const line = (item, kind, path, hash, extra = {}) => checkEvent({ type: 'approval', by: 'human', item, kind, path, content_hash: hash, decision, ...(reason ? { reason } : {}), answered_after_s: answeredAfter, ...extra });
    const events = [...(pair ? [line(briefId, 'brief', brief.file.path, briefHash, { ...(briefBound.length ? { files: briefBound } : {}), ...verifierField(briefVera) })] : []), line(id, 'prd', file.path, prdHash, { ...readerField(reader), ...verifierField(vera) })];
    const misses = decision === 'rejected' ? missesOf([...(pair ? [{ item: briefId, kind: 'brief', path: brief.file.path, vera: briefVera }] : []), { item: id, kind: 'prd', path: file.path, vera }], reason) : [];
    const seqs = withSeq(store, (ctx) => {
      const out = events.map((ev) => {
        const n = ctx.take();
        ctx.event(n, ev, { signer });
        return n;
      });
      for (const m of misses) ctx.event(ctx.take(), m);
      return out;
    });
    showMisses(io, misses);
    const what = pair ? `the brief ${briefId} and the PRD ${id}, as ${brief.file.path} and ${file.path} are now` : `the PRD ${id}, as ${file.path} is now`;
    io.stdout.write(decision === 'rejected'
      ? `recorded: ${pair ? `the brief ${briefId} and the PRD ${id}` : `the PRD ${id}`} rejected (signed with ${signer.keyId}, seq ${seqs.join(', ')})\n`
      : `approved: ${what} (${decision}; signed with ${signer.keyId}, seq ${seqs.join(', ')}); a change to ${pair ? 'either' : 'it'} needs a new approval\n`);
    // Unit 44 (decision 8): your approval publishes the initiative (38's docs publish). A failed
    // publish doesn't undo the approval: it says so, and names the command. The documents' lines
    // come last (38's rule), with their host link once pushed.
    if (decision !== 'rejected') await publishAfter({ io, file });
    // Unit 45 (decision 1, Scope 1): when this approval completes what the track needs, the offer to
    // start the ticket planner; never without asking. The documents' lines still come last (38).
    start = decision === 'rejected' ? null : await tessOffer({ io, prompter, store, conn, registry, config, initiative: posix.basename(posix.dirname(file.path)), track: fm.value.track });
    if (pair) io.stdout.write(`${documentLine({ store, config, conn, abs: join(base, brief.file.path), rel: brief.file.path, bytes: brief.file.bytes })}\n`);
    io.stdout.write(`${documentLine({ store, config, conn, abs: join(base, file.path), rel: file.path, bytes: file.bytes })}\n`);
  } finally {
    prompter.close();
  }
  return start ? startTess(io, start) : EXIT.OK;
}

// ---- The offer to start the ticket planner (unit 45, decision 1, Scope 1) -------------------------

// After an approval: the track's inputs (src/tickets/inputs.js). All approved (a type MIRAI hasn't
// built yet skipped, with a warning naming its unit): asks whether to start her now, [y/N]; after her
// pause on this PRD (45's re-check Q1 "A"), whether to continue her run, [Y/n]. Not complete: says
// what's still needed. Returns the initiative to start, or null.
async function tessOffer({ io, prompter, store, conn, registry, config, initiative, track }) {
  if (!conn || (track !== 'standard' && track !== 'full')) return null;
  let states;
  try {
    states = inputStates({ store, registry, config, track, readDoc: (type) => readInput(conn, initiative, type) });
  } catch {
    return null;
  }
  const tess = fullName(TESS_PLANNER);
  const later = `mirai tickets ${plain(initiative)} (/mirai tickets ${plain(initiative)} in your session)`;
  const missing = missingOf(states);
  if (missing.length) {
    io.stdout.write(`tickets: still needed before ${tess} cuts the set: ${missing.map(missingLine).join('; ')}\n`);
    return null;
  }
  const warn = notBuiltLine(states);
  if (warn) io.stdout.write(`tickets: ${warn}\n`);
  const last = lastTessRun(readJournal(store).events, initiative);
  const paused = last?.state === 'paused' && last.mode === 'set';
  let answer;
  try {
    answer = (await prompter.ask(paused ? `${who(TESS_PLANNER)} paused on ${plain(last.question_id ?? 'a question')} for this; continue her run now? [Y/n] ` : `Start ${tess} on the ticket set now? [y/N] `)).toLowerCase();
  } catch (err) {
    if (err instanceof MiraiError && err.exitCode === EXIT.INTERRUPTED) answer = 'n';
    else throw err;
  }
  const yes = paused ? answer === '' || answer === 'y' || answer === 'yes' : answer === 'y' || answer === 'yes';
  if (!yes) {
    io.stdout.write(`\nnot started; when you're ready: ${later}\n`);
    return null;
  }
  return initiative;
}

// Starts her run in this terminal, as `mirai tickets <initiative>` does (tests give io.startTess).
async function startTess(io, initiative) {
  if (io.startTess) return io.startTess(initiative, io);
  const { createTicketsCommand } = await import('./tickets.js');
  return createTicketsCommand().run({ positionals: [initiative], values: {} }, io);
}

// After your approval of a PRD (unit 44, decision 8): 38's publish for its initiative (the folder it
// is in). On the local store it does nothing, and says so.
async function publishAfter({ io, file }) {
  const initiative = posix.basename(posix.dirname(file.path));
  try {
    const r = await docsPublish({ cwd: io.cwd, env: io.env, initiative, ...(io.hostOf ? { hostOf: io.hostOf } : {}) });
    if (r.outcome === 'local') {
      io.stdout.write(`published: nothing to do (${plain(r.message)})\n`);
      return;
    }
    io.stdout.write(`published: ${plain(initiative)}, ${r.outcome} (${longRef(r.words, r.mr.number)}: ${plain(r.mr.url ?? '')}); MIRAI merges it after the ticket set's approval: mirai docs merge ${plain(initiative)}\n`);
  } catch (err) {
    io.stdout.write(`published: not yet: ${plain(String(err.message ?? err)).slice(0, 300)}; your approval stands. Publish it when that's fixed: mirai docs publish ${plain(initiative)}\n`);
  }
}

// ---- The reader test at approval (unit 34, Scope 5) ----------------------------------------

// The reader-test result for the document's summary as it is now: { entry } to show and record,
// { off: true } when the project turned it off, or null when the document doesn't take it (a
// brief on quick or standard, a ticket). With no result for the current summary it refuses, with
// the command that makes one. A failed result still lets you decide (decision 4).
function readerFor({ store, config, def, value, id, path, text }) {
  if (!needsReaderTest(def, value)) return null;
  if (config.docs?.reader_test === false) return { off: true };
  const summary = summaryText(text, def.renames);
  const entry = summary ? readerResultFor(store, id, summaryHash(summary)) : null;
  if (!entry) throw Object.assign(new MiraiError(`${path} has no reader-test result for its summary as it is now; nothing was written`, EXIT.BLOCKED), { code: 'no-reader-test', hint: `run: mirai reader-test ${path}, then approve again` });
  return { entry, runs: readerRuns(config) };
}

function showReader(io, reader) {
  if (!reader) return;
  if (reader.off) {
    io.stdout.write('reader test: off for this project ([docs] reader_test = false); you approve without it\n');
    return;
  }
  const e = reader.entry;
  const head = e.result === 'pass'
    ? `reader test: pass (round ${e.round}, model ${plain(e.model)})`
    : `reader test failed (round ${e.round}${e.round <= reader.runs ? ` of ${reader.runs}` : ''}, model ${plain(e.model)}): ${failedLabels(e).join(', ')}`;
  io.stdout.write(`${[head, ...resultLines(e).map((l) => plain(l))].join('\n')}\n`);
  if (e.result !== 'pass') io.stdout.write('you can still decide: approve anyway (a), reject with a note (r), or answer the gap yourself: fix the summary, run mirai reader-test, then approve again\n');
}

const readerField = (reader) => (reader?.entry ? { reader_test: reader.entry.hash } : {});

// ---- Vera at approval (unit 40, Scopes 5 and 8) ------------------------------------------------

function showVerifier(io, vera, who = undefined) {
  const lines = verifierLines(vera, who);
  if (lines.length) io.stdout.write(`${lines.join('\n')}\n`);
}

// Decision 7: a rejection of a document whose Vera result passed is her miss, recorded against the
// type with the problem you named (your reason) and the result's hash. MIRAI's lines, written with
// your signed rejection. [{ item, kind, path, vera }] → the events.
function missesOf(docs, reason) {
  return docs.filter((d) => d.vera?.state === 'pass').map((d) => checkEvent({ type: 'verifier_miss', by: 'script', item: d.item, kind: d.kind, path: d.path, ...(reason ? { note: reason } : {}), verifier: d.vera.entry.hash }));
}
function showMisses(io, misses) {
  for (const m of misses) io.stdout.write(`recorded as a miss of ${fullName('mirai-verifier')}: she passed ${plain(m.path)}, and you rejected it${m.note ? ` (${plain(m.note)})` : ''}\n`);
}

// Whether `bytes` are the document `id` as you last approved it: { approved, stale, seq }.
// Only your signed lines count (readJournal verifies them); your last decision on the document
// is the one that holds. `files` (unit 35: a brief's interview, from briefFiles) are the other
// files its line binds, as they are now, [{ path, bytes }]: the same paths with the same bytes,
// or it's stale. Left out, only the document's own bytes are compared.
export function documentApproval(store, id, bytes, files) {
  const last = readJournal(store).events.filter((e) => e.type === 'approval' && e.by === 'human' && DOCUMENTS.has(e.kind) && e.kind !== 'epic' && e.item === id).at(-1);
  if (!last || last.decision === 'rejected') return { approved: false, stale: false, seq: last?.seq ?? null };
  const same = last.content_hash === contentHash(bytes) && (files === undefined || signatureOf(last.files ?? []) === signatureOf(fileHashes(files)));
  return { approved: same, stale: !same, seq: last.seq };
}

// ---- The epic (unit 33, Scope 6) -----------------------------------------------------------

// The epic's inputs, read from the repo as `mirai approve` reads any file (in the repo, a regular
// file): its PRD (the "PRD:" line), its design links (the "Design:" line, which must resolve), and
// every ticket in tickets/ beside it, the epic's own marked by their `epic` field.
export function epicInputs(checkout, epicPath, text, registry) {
  const def = registry.documentTypes.epic;
  const doc = parseDocument(text, epicPath);
  const id = String(doc.value.id);
  const lines = linkLinesOf(doc.scan, def);
  const dir = posix.dirname(epicPath);
  const inRepo = (link) => posix.normalize(posix.join(dir, link));
  const prdLine = lines.find((l) => l.link.type === 'prd');
  if (!prdLine) throw Object.assign(new MiraiError(`${epicPath} doesn't link its PRD in the line under its title; nothing was written`, EXIT.BLOCKED), { hint: 'add "PRD: [<its title>](prd.md)" under the # title, then approve again' });
  const prd = readApprovedFile(checkout, checkout, inRepo(prdLine.targets[0]));
  const prdValue = readFrontmatter(prd.bytes)?.value ?? {};
  for (const target of lines.filter((l) => l.link.label === 'Design').flatMap((l) => l.targets)) {
    try {
      readApprovedFile(checkout, checkout, inRepo(target.split('#')[0]));
    } catch {
      throw Object.assign(new MiraiError(`${epicPath}'s "Design:" line links ${plain(target)}, which isn't a file in the repo; nothing was written`, EXIT.BLOCKED), { hint: 'correct the link, then approve again' });
    }
  }
  const folder = readTicketFolder(join(checkout, dir), { root: checkout });
  const tickets = ticketsOf(folder.all, id).map((t) => ({ ...readApprovedFile(checkout, checkout, inRepo(t.path)), id: String(t.value.id) }));
  return { id, doc, prdLink: prdLine.targets[0], prd, prdValue, tickets, folder: Object.fromEntries(folder.all.map((t) => [t.path, t.doc.text])) };
}

// mirai approve <epic-id> --file <epic.md> (unit 33, Scope 6; Jet's decision 1). The `tickets`
// gate, always yours (D6): the epic is linted with its PRD and every ticket, the graph included,
// and each ticket on its own, all as at approval; the PRD must be approved as it is now (as a full
// PRD waits for its brief, 32). You decide once, and one signed line covers the epic's bytes and
// each ticket file's bytes, so a later change to any of them needs a new approval.
// Unit 45 (Scope 3; Jet's decisions 4 and 5): the screen shows one line per ticket and the release
// mode, and you may go through the tickets: keep (the default), drop (a reason; MIRAI removes it,
// renders the epic again, lints and traces it, and asks again) or change (merge, split or fix: a
// note; nothing is signed, the notes go to ticket-notes.md for the ticket planner's next run); and
// keep or switch the release mode (a reason when you switch it). After the signature: the docs
// publish and MIRAI's merge of the docs MR (38). Every drop and change is a signed ticket_decision
// line.
async function approveEpic({ id, file, store, io, now, registry, config, project, base = store.checkout, conn = null }) {
  const dir = posix.dirname(file.path);
  const initiative = posix.basename(dir);
  const round = roundOf(readJournal(store).events, id);
  const dropped = []; // [{ ticket, reason }], applied to the work tree, signed with the set
  let before = null; // the set as it was before the first drop: { vera, coverage }
  let releaseChoice = null; // { mode, reason } when you switched it
  const prompter = createPrompter(io);
  try {
    for (;;) {
      const g = epicState({ id, file, store, io, registry, config, project, base, conn, dropped: dropped.length > 0, before });
      const { text, input, hash, files, rows, vera, reader, journeys } = g;
      const n = files.length;
      const release = releaseOf(text);
      const mode = releaseChoice?.mode ?? release.mode;
      io.stdout.write(`release: ${mode}${releaseChoice ? ` (you switched it from ${release.mode}: ${plain(releaseChoice.reason)})` : release.reason ? ` (${who(TESS_PLANNER)}: ${plain(release.reason)})` : ''}\n`);
      if (dropped.length) io.stdout.write(`dropped on this screen: ${dropped.map((d) => plain(d.ticket)).join(', ')} (MIRAI removed ${dropped.length === 1 ? 'its file' : 'their files'} and rendered the epic again; lint clean, trace passes, coverage unchanged)\n`);
      io.stdout.write(`the tickets (key, type, priority, order, size, blocks, title):\n`);
      for (const r of rows) io.stdout.write(`${rowLine(r)}\n`);
      const asked = now().getTime();
      const answer = (await prompter.ask('accepted as is / edited / rejected, or go through the tickets and the release mode? [a/e/r/t] ')).toLowerCase();
      if (answer === 't') {
        const choice = await goThrough({ io, prompter, rows, mode, release });
        if (choice.release) releaseChoice = choice.release.reason === null ? null : choice.release;
        const changes = choice.decisions.filter((d) => d.decision !== 'drop');
        const drops = choice.decisions.filter((d) => d.decision === 'drop');
        const blocked = dependsOnDropped(rows, drops.map((d) => d.ticket));
        if (blocked.length) {
          throw Object.assign(new MiraiError(`${blocked.map((b) => `${b.kept} comes after ${b.dropped}`).join('; ')}: dropping ${blocked.length === 1 ? 'it' : 'them'} would leave ${blocked.length === 1 ? 'that ticket' : 'those tickets'} waiting on nothing; nothing was changed`, EXIT.BLOCKED), { code: 'drop-blocked', hint: 'change the ticket that comes after it instead (c, with a note), or keep both' });
        }
        if (!drops.length && !changes.length) continue; // only the release mode changed: ask again
        if (!before) before = { vera, coverage: coverageOf(rows) };
        const undo = dropFiles({ base, dir, rows, drops });
        if (changes.length) {
          // Any change: nothing is signed; your notes go to the ticket planner's next run.
          const date = now().toISOString().slice(0, 10);
          const notesAbs = join(base, dir, 'ticket-notes.md');
          writeFileSync(notesAbs, notesText({ initiative, epic: id, round, notes: changes, date }));
          if (drops.length) renderEpicFile({ abs: join(base, file.path), root: base, registry });
          const signer = await decisionSigner(io, store, { prompter, ticket: id, confirm: confirmByTyping });
          logDecisions(store, signer, { initiative, epic: id, round, decisions: [...dropped, ...choice.decisions] });
          prompter.close();
          io.stdout.write(`nothing was signed: ${changes.length} change${changes.length === 1 ? '' : 's'}${drops.length || dropped.length ? ` and ${drops.length + dropped.length} drop${drops.length + dropped.length === 1 ? '' : 's'}` : ''} logged (signed with ${signer.keyId})\n`);
          io.stdout.write(`your notes: ${plain(join(base, dir, 'ticket-notes.md'))}\n`);
          io.stdout.write(`next: ${who(TESS_PLANNER)} changes the set from your notes, ${who(VERIFY_PLANNER)} checks it, and you approve it: /mirai tickets ${plain(initiative)} (mirai tickets ${plain(initiative)}); commit the notes${drops.length || dropped.length ? ' and the removed tickets' : ''} first\n`);
          return EXIT.OK;
        }
        // Drops only: the epic rendered again, the lint and trace as at approval, then the screen again.
        renderEpicFile({ abs: join(base, file.path), root: base, registry });
        try {
          epicState({ id, file, store, io, registry, config, project, base, conn, dropped: true, before });
        } catch (err) {
          undo();
          io.stderr.write(`the drop was undone: ${plain(drops.map((d) => d.ticket).join(', '))} ${drops.length === 1 ? 'is' : 'are'} back, and the epic as it was\n`);
          throw err;
        }
        dropped.push(...drops);
        continue;
      }
      const decision = DECISIONS[answer];
      if (!decision) throw new UsageError(`${JSON.stringify(answer.slice(0, 10))} is not a, e, r or t; nothing was written`, 'run it again');
      const answeredAfter = Math.round((now().getTime() - asked) / 100) / 10;
      let reason;
      if (decision !== 'accepted') {
        reason = await prompter.ask('reason (optional, one line): ');
        if (reason.length > 500) throw new UsageError('the reason is longer than 500 characters; nothing was written', 'keep it to one line');
        if (reason === '') reason = undefined;
      }
      const signer = await decisionSigner(io, store, { prompter, ticket: id, confirm: confirmByTyping });
      // What you approved is what was shown: no file may have changed while you answered, and no
      // ticket may have joined or left the epic.
      const signature = (list) => list.map((f) => `${f.path} ${f.content_hash}`).join('\n');
      const nowBytes = readApprovedFile(base, base, file.path).bytes;
      const again = epicInputs(base, file.path, nowBytes.toString('utf8'), registry);
      if (contentHash(nowBytes) !== hash || signature(again.tickets.map((t) => ({ path: t.path, content_hash: contentHash(t.bytes) }))) !== signature(files)) {
        throw new MiraiError(`${file.path} or one of its tickets changed while you were answering; nothing was written`, EXIT.FAILURE);
      }
      const approval = checkEvent({
        type: 'approval', by: 'human', item: id, kind: 'epic', path: file.path, content_hash: hash, files, decision, ...(reason ? { reason } : {}), answered_after_s: answeredAfter, ...readerField(reader), ...verifierField(vera),
        ...(decision !== 'rejected' ? { release_mode: mode, ...(releaseChoice ? { release_reason: releaseChoice.reason } : {}) } : {}),
        ...(dropped.length ? { dropped: dropped.map((d) => d.ticket) } : {}),
      });
      const misses = decision === 'rejected' ? missesOf([{ item: id, kind: 'epic', path: file.path, vera }], reason) : [];
      const journeyLine = decision === 'rejected' || !journeys ? null : checkEvent({ type: 'approval', by: 'human', item: journeys.id, kind: 'context', file_type: 'journeys', path: journeys.rel, content_hash: contentHash(journeys.after), proposal: file.path, decision, answered_after_s: answeredAfter });
      if (journeyLine) {
        if (contentHash(readApprovedFile(store.checkout, store.checkout, journeys.rel).bytes) !== contentHash(journeys.before)) throw new MiraiError(`${journeys.rel} changed while you were answering; nothing was written`, EXIT.FAILURE);
        writeFileSync(journeys.abs, journeys.after, { mode: statSync(journeys.abs).mode & 0o777 });
      }
      let seq;
      try {
        seq = withSeq(store, (ctx) => {
          for (const d of dropped) ctx.event(ctx.take(), decisionEvent({ initiative, epic: id, round, d }), { signer });
          const k = ctx.take();
          ctx.event(k, approval, { signer });
          if (journeyLine) ctx.event(ctx.take(), journeyLine, { signer });
          for (const m of misses) ctx.event(ctx.take(), m);
          return k;
        });
      } catch (err) {
        // Nothing signed: journeys.md goes back to what it was.
        if (journeyLine) writeFileSync(journeys.abs, journeys.before);
        throw err;
      }
      prompter.close();
      showMisses(io, misses);
      if (journeyLine) io.stdout.write(`added to ${journeys.rel}: ${journeys.blocks.map((b) => b.id).join(', ')}, approved with the set (seq ${seq + 1}); commit it\n`);
      io.stdout.write(decision === 'rejected'
        ? `recorded: the epic ${id} and its ${n} tickets rejected (signed with ${signer.keyId}, seq ${seq})\n`
        : `approved: the epic ${id} and its ${n} tickets, as they are now (${decision}; signed with ${signer.keyId}, seq ${seq}); a change to any of them needs a new approval\nrelease: ${mode}, signed with the set${dropped.length ? `; dropped: ${dropped.map((d) => plain(d.ticket)).join(', ')}` : ''}\n`);
      // Unit 45 (Scope 5): the documents go to the integration branch: MIRAI publishes the initiative
      // (the set as you signed it) and merges its docs MR (38), the only merge MIRAI performs.
      if (decision !== 'rejected') await publishAndMerge({ io, initiative });
      io.stdout.write(`${documentLine({ store, config, conn, abs: join(base, file.path), rel: file.path, bytes: g.bytes })}\n`);
      return EXIT.OK;
    }
  } finally {
    prompter.close();
  }
}

const TESS_PLANNER = 'mirai-ticket-planner';
const VERIFY_PLANNER = 'mirai-verifier';
const who = (id) => agentNamer()(id);

// The set as approval reads it now (unit 33's checks, then 45's rows): the lint and trace refuse,
// the PRD must be approved as it is now; then the header lines, the journeys change and Vera's and
// the reader test's results are shown. After a drop on this screen, Vera's earlier result stands
// unless the drop changed the set's coverage (Scope 3).
function epicState({ id, file, store, io, registry, config, project, base, conn, dropped, before }) {
  const bytes = readApprovedFile(base, base, file.path).bytes;
  const text = bytes.toString('utf8');
  const input = epicInputs(base, file.path, text, registry);
  const results = [{ path: file.path, errors: lintText(text, { source: file.path, registry, project, approving: true, linked: { [input.prdLink]: input.prd.bytes.toString('utf8') }, tickets: input.folder }) }];
  // Unit 43 (Scope 8): each ticket's IDs against the version the set's last approval signed.
  const lastSet = readJournal(store).events.filter((e) => e.type === 'approval' && e.by === 'human' && e.kind === 'epic' && e.item === id && e.decision !== 'rejected').at(-1);
  const repoStore = !conn || conn.kind === 'repo';
  for (const t of input.tickets) {
    const signed = (lastSet?.files ?? []).find((f) => f.path === t.path);
    const previous = signed && repoStore ? approvedText(store, t.path, signed.content_hash) : null;
    results.push({ path: t.path, errors: lintText(t.bytes.toString('utf8'), { source: t.path, registry, project, approving: true, previous }) });
  }
  refuseOnLint(io, results);
  // Unit 43 (Scope 2): trace's documents scope, once more as the gate (Tess's run already ran it
  // between her launches): a set with a broken link is refused, each link named with its place.
  refuseOnTrace(io, traceOfSet({ base, file: { path: file.path }, text, input, registry }));
  const prdId = typeof input.prdValue.id === 'string' ? input.prdValue.id : null;
  const prdBefore = prdId ? documentApproval(store, prdId, input.prd.bytes) : { approved: false, stale: false };
  if (!prdBefore.approved) {
    throw Object.assign(new MiraiError(`the PRD ${prdId ?? input.prd.path} isn't approved${prdBefore.stale ? ' as it is now (it changed since its approval)' : ''}; its tickets are approved after it; nothing was written`, EXIT.BLOCKED), { hint: `run: mirai approve ${prdId ?? '<prd-id>'} --file ${input.prd.path}` });
  }
  const rows = ticketRows(input.tickets);
  let vera;
  if (dropped && before) {
    const now = coverageOf(rows);
    if (now.join(' ') !== before.coverage.join(' ')) {
      throw Object.assign(new MiraiError(`the drop changed what the set covers (${before.coverage.filter((x) => !now.includes(x)).slice(0, 10).join(', ') || 'its IDs'}), so ${fullName(VERIFY_AGENT)} checks the set again first; nothing was written`, EXIT.BLOCKED), { code: 'verify-again', hint: `run: mirai verify ${file.path}, then approve again` });
    }
    vera = before.vera;
  } else {
    vera = verifierFor({ store, config, def: registry.documentTypes.epic, id, path: file.path, bytes, files: input.tickets });
  }
  const reader = readerFor({ store, config, def: registry.documentTypes.epic, value: input.doc.value, id, path: file.path, text });
  const hash = contentHash(bytes);
  const files = input.tickets.map((t) => ({ path: t.path, content_hash: contentHash(t.bytes) }));
  const prior = epicApproval(store, id, bytes, input.tickets);
  io.stdout.write(`epic:    ${id}${prior.approved ? ' (approved before, as it is now)' : prior.stale ? ' (approved before; it or a ticket has changed since)' : ''}\nfile:    ${file.path}\nhash:    ${hash}\nprd:     ${prdId} (approved, as it is now)\ntickets: ${files.length}, signed with the epic\n`);
  for (const f of files) io.stdout.write(`  ${plain(f.path)}   ${f.content_hash}\n`);
  io.stdout.write(`${plain(join(base, file.path))}\n`);
  // Unit 42 (Scope 7): a new critical journey in the epic is added to journeys.md by this approval.
  const journeys = journeysChange({ io, store, text, registry, project });
  showVerifier(io, vera);
  showReader(io, reader);
  return { bytes, text, input, hash, files, rows, vera, reader, journeys };
}

// The per-ticket pass (Scope 3): keep (Enter), drop (a reason) or change (merge, split or fix, and
// a note); then the release mode, kept or switched (a reason). Returns { decisions, release }.
async function goThrough({ io, prompter, rows, mode, release }) {
  const decisions = [];
  const line = async (q) => {
    const a = await prompter.ask(q);
    if (a.length > 500) throw new UsageError('that is longer than 500 characters; nothing was written', 'keep it to one line');
    return a;
  };
  for (const r of rows) {
    const a = (await prompter.ask(`${plain(r.key)} ${plain(r.title).slice(0, 60)}: keep, drop or change? [K/d/c] `)).toLowerCase();
    if (a === '' || a === 'k') continue;
    if (a === 'd') {
      const reason = await line(`why drop ${plain(r.key)} (one line, required): `);
      if (!reason) throw new UsageError(`a drop needs its reason; nothing was written`, 'run it again, and give one line');
      decisions.push({ ticket: r.key, decision: 'drop', reason });
    } else if (a === 'c') {
      const kind = (await prompter.ask(`merge it with another ticket, split it, or another change? [m/s/c] `)).toLowerCase();
      const decision = { m: 'merge', s: 'split', c: 'change' }[kind];
      if (!decision) throw new UsageError(`${JSON.stringify(kind.slice(0, 10))} is not m, s or c; nothing was written`, 'run it again');
      const note = await line(`your note for ${who(TESS_PLANNER)} (what to change in ${plain(r.key)}, one line, required): `);
      if (!note) throw new UsageError(`a change needs its note; nothing was written`, 'run it again, and say what to change');
      decisions.push({ ticket: r.key, decision, reason: note });
    } else throw new UsageError(`${JSON.stringify(a.slice(0, 10))} is not k, d or c; nothing was written`, 'run it again');
  }
  const other = mode === 'together' ? 'per-ticket' : 'together';
  io.stdout.write(`release: ${mode} (${mode === 'together' ? 'the whole epic goes live at once, from its feature branch' : 'each ticket goes live on its own after its merge'})\n`);
  const r = (await prompter.ask(`keep the release mode, or switch it to ${other}? [K/s] `)).toLowerCase();
  if (r === 's') {
    const reason = await line(`why ${other} (one line, required): `);
    if (!reason) throw new UsageError('switching the release mode needs its reason; nothing was written', 'run it again, and give one line');
    // Switching back to the ticket planner's own proposal is no switch at all.
    return { decisions, release: other === release.mode ? { mode: other, reason: null } : { mode: other, reason } };
  }
  if (r !== '' && r !== 'k') throw new UsageError(`${JSON.stringify(r.slice(0, 10))} is not k or s; nothing was written`, 'run it again');
  return { decisions, release: null };
}

// Removes the dropped tickets' files; returns an undo that writes them back, and the epic as it was.
function dropFiles({ base, dir, rows, drops }) {
  const saved = drops.map((d) => {
    const r = rows.find((x) => x.key === d.ticket);
    const abs = join(base, r.path);
    return { abs, bytes: readApprovedFile(base, base, r.path).bytes };
  });
  const epicFiles = readdirSync(join(base, dir)).filter((n) => /^epic-.*\.md$/.test(n)).map((n) => ({ abs: join(base, dir, n), bytes: readFileSync(join(base, dir, n)) }));
  for (const f of saved) rmSync(f.abs);
  return () => {
    for (const f of saved) writeFileSync(f.abs, f.bytes);
    for (const f of epicFiles) writeFileSync(f.abs, f.bytes);
  };
}

const decisionEvent = ({ initiative, epic, round, d }) => checkEvent({ type: 'ticket_decision', by: 'human', item: initiative, ticket: d.ticket, decision: d.decision, reason: d.reason, epic, round });

function logDecisions(store, signer, { initiative, epic, round, decisions }) {
  const events = decisions.map((d) => decisionEvent({ initiative, epic, round, d }));
  withSeq(store, (ctx) => {
    for (const ev of events) ctx.event(ctx.take(), ev, { signer });
  });
}

// After the set's signature (Scope 5): the docs publish, then the merge. A failed or waiting step
// doesn't undo your approval: it says so, with the command that tries again.
async function publishAndMerge({ io, initiative }) {
  const hostOf = io.hostOf ? { hostOf: io.hostOf } : {};
  let pub;
  try {
    pub = await docsPublish({ cwd: io.cwd, env: io.env, initiative, ...hostOf });
  } catch (err) {
    io.stdout.write(`published: not yet: ${plain(String(err.message ?? err)).slice(0, 300)}; your approval stands. When that's fixed: mirai docs publish ${plain(initiative)}, then mirai docs merge ${plain(initiative)}\n`);
    return;
  }
  if (pub.outcome === 'local') {
    io.stdout.write(`published: nothing to do (${plain(pub.message)})\n`);
    return;
  }
  io.stdout.write(`published: ${plain(initiative)}, ${pub.outcome} (${longRef(pub.words, pub.mr.number)}: ${plain(pub.mr.url ?? '')})\n`);
  try {
    const m = await docsMerge({ cwd: io.cwd, env: io.env, initiative, ...hostOf, log: (line) => io.stderr.write(`${plain(line)}\n`) });
    if (m.outcome === 'waiting') io.stdout.write(`merged: not yet: ${plain(m.waitingFor)}; the ${(m.words ?? pub.words).long} stays open, and MIRAI merges it when you run: mirai docs merge ${plain(initiative)}\n`);
    else if (m.outcome === 'already-merged') io.stdout.write(`merged: already (${plain(m.mr.url ?? '')})\n`);
    else io.stdout.write(`merged: ${plain(m.mr.url ?? '')} at ${m.head.slice(0, 12)} as ${m.mergeSha.slice(0, 12)} into ${plain(m.integration)} (documents only)\n`);
  } catch (err) {
    if (err instanceof MiraiError && err.gaps) for (const g of err.gaps) io.stderr.write(`${plain(g.path)}: ${plain(g.gap)}\n`);
    io.stdout.write(`merged: not yet: ${plain(String(err.message ?? err)).slice(0, 300)}; your approval stands. When that's fixed: mirai docs merge ${plain(initiative)}\n`);
  }
}

// Unit 43: the epic's set as trace's documents scope reads it: the brief its PRD links (when it
// reads), the PRD, the epic and every ticket in tickets/ beside it.
function traceOfSet({ base, file, text, input, registry }) {
  const dir = posix.dirname(file.path);
  const prdText = input.prd.bytes.toString('utf8');
  let brief = null;
  try {
    const b = linkedBrief(base, input.prd.path, prdText, registry.documentTypes.prd);
    brief = { path: b.file.path, text: b.file.bytes.toString('utf8') };
  } catch {
    brief = null;
  }
  return traceDocuments({
    initiative: posix.basename(dir), registry, brief, prd: { path: input.prd.path, text: prdText }, epic: { path: file.path, text },
    tickets: Object.entries(input.folder).map(([p, t]) => ({ path: posix.join(dir, p), text: t })),
  });
}

function refuseOnTrace(io, t) {
  if (t.result !== 'fail') return;
  for (const m of t.missing.slice(0, 20)) io.stderr.write(`trace: ${plain(m.what)} (${plain(m.where)})\n`);
  if (t.missing.length > 20) io.stderr.write(`trace: … and ${t.missing.length - 20} more\n`);
  throw Object.assign(new MiraiError(`the set can't be approved yet: mirai trace finds ${t.missing.length} missing link${t.missing.length === 1 ? '' : 's'}, listed above; nothing was written`, EXIT.BLOCKED), { code: 'trace-fail', hint: `fix them (or run the ticket planner again: mirai tickets ${t.item}), check with mirai trace ${t.item}, then approve again` });
}

// The text of the document's last accepted approval, from git (on the repo store), or null.
function lastApprovedText(store, conn, kind, id, path) {
  const last = readJournal(store).events.filter((e) => e.type === 'approval' && e.by === 'human' && e.kind === kind && e.item === id && e.decision !== 'rejected').at(-1);
  return last && (!conn || conn.kind === 'repo') ? approvedText(store, last.path ?? path, last.content_hash) : null;
}

// The lines changed since the document's last accepted approval (unit 42, decision 3): the approved
// text is read from git (the newest commit whose file at that path has the approved hash), so only
// on the repo store; elsewhere, or with no such commit, it says so and the whole file is read.
function showChangedSince(io, store, conn, id, file) {
  const last = readJournal(store).events.filter((e) => e.type === 'approval' && e.by === 'human' && e.kind === 'prd' && e.item === id && e.decision !== 'rejected').at(-1);
  const then = last && (!conn || conn.kind === 'repo') ? approvedText(store, last.path ?? file.path, last.content_hash) : null;
  if (then === null) {
    io.stdout.write(`changed since your approval (seq ${last?.seq ?? '?'}): the approved text isn't in git here, so read the whole file: ${plain(join(store.checkout, file.path))}\n`);
    return;
  }
  const changes = changedLines(then, file.bytes.toString('utf8'));
  io.stdout.write(`changed since your approval (seq ${last.seq}): ${changes.length} line${changes.length === 1 ? '' : 's'}; the whole file: ${plain(join(store.checkout, file.path))}\n`);
  for (const c of changes.slice(0, 200)) io.stdout.write(`  ${c.sign} ${String(c.line).padStart(4)}  ${plain(c.text)}\n`);
  if (changes.length > 200) io.stdout.write(`  … and ${changes.length - 200} more\n`);
}

// The epic's new critical journeys and journeys.md as approving the set makes it (unit 42, Scope
// 7): null when the epic proposes none, else { blocks, rel, abs, id, before, after }, shown here.
// journeys.md as it would be is linted with its own rules first; a J-n already there is refused.
function journeysChange({ io, store, text, registry, project }) {
  const blocks = newJourneys(text);
  if (!blocks.length) return null;
  const rel = `${CONTEXT_DIR}/journeys.md`;
  let read;
  try {
    read = readApprovedFile(store.checkout, store.checkout, rel);
  } catch {
    throw Object.assign(new MiraiError(`the epic proposes ${blocks.map((b) => b.id).join(', ')}, but there is no ${rel} to add ${blocks.length === 1 ? 'it' : 'them'} to; nothing was written`, EXIT.BLOCKED), { code: 'no-journeys', hint: 'write and approve journeys.md first (mirai setup, the context stage), then approve the set again' });
  }
  const added = addJourneys(read.bytes.toString('utf8'), blocks);
  if (added.problem) throw Object.assign(new MiraiError(`${added.problem}; nothing was written`, EXIT.BLOCKED), { code: 'journey-numbering' });
  let linked = {};
  try {
    linked = { 'feature-map.md': readApprovedFile(store.checkout, store.checkout, `${CONTEXT_DIR}/feature-map.md`).bytes.toString('utf8') };
  } catch {
    linked = {};
  }
  refuseOnLint(io, [{ path: `${rel} (as the set's approval would make it)`, errors: lintText(added.text, { source: rel, registry, project, approving: true, linked, repo: store.checkout }) }]);
  io.stdout.write(`new critical journeys: ${blocks.map((b) => `${b.id} (${plain(b.title)})`).join(', ')}; approving the set adds ${blocks.length === 1 ? 'it' : 'them'} to ${rel}, and approves journeys.md as it then is\n`);
  for (const b of blocks) for (const l of b.text.split('\n')) io.stdout.write(`  + ${plain(l)}\n`);
  const id = readFrontmatter(read.bytes)?.value?.id;
  return { blocks, rel, abs: join(store.checkout, rel), id: typeof id === 'string' ? id : 'journeys', before: read.bytes, after: Buffer.from(added.text, 'utf8') };
}

// Whether the epic `id` and its tickets ([{ path, bytes }]) are as you last approved them:
// { approved, stale, seq }: the epic's bytes, and the same ticket files with the same bytes.
export function epicApproval(store, id, bytes, tickets) {
  const last = readJournal(store).events.filter((e) => e.type === 'approval' && e.by === 'human' && e.kind === 'epic' && e.item === id).at(-1);
  if (!last || last.decision === 'rejected') return { approved: false, stale: false, seq: last?.seq ?? null };
  const now = tickets.map((t) => `${t.path} ${contentHash(t.bytes)}`).sort().join('\n');
  const then = (last.files ?? []).map((f) => `${f.path} ${f.content_hash}`).sort().join('\n');
  const same = last.content_hash === contentHash(bytes) && now === then;
  return { approved: same, stale: !same, seq: last.seq };
}

// ---- Context files (unit 36, Scope 4) ------------------------------------------------------

// mirai approve --file .mirai/context/<file>.md (Jet's decision 1): you approve the whole file, not
// a summary, and there's no reader test. business.md, journeys.md and conventions-<service>.md are
// approved; feature-map.md and project-<service>.md are refused, since the lint checks them
// against the code. The lint first, as at approval and against the repo's code; then your
// decision, signed, on the file's exact bytes: one line, kind context, with the file's type.
async function approveContext({ id, file, store, io, now, fileArg }) {
  const name = file.path.slice(CONTEXT_DIR.length + 1);
  const kind = isContextFile(file.path) ? contextKindOf(name) : null;
  if (!kind) throw new UsageError(`${plain(file.path)} isn't a context file; nothing was written`, `the context files you approve are ${CONTEXT_DIR}/business.md, journeys.md and conventions-<service>.md`);
  if (!kind.approved) {
    throw Object.assign(new MiraiError(`${plain(file.path)} isn't approved: it's checked against the code (its ${kind.type === 'project' ? 'paths and commands' : 'handles and routes'}), so mirai lint is its check; nothing was written`, EXIT.BLOCKED), { code: 'not-approved-kind', hint: `run: mirai lint ${CONTEXT_DIR}/` });
  }
  let value = {};
  try {
    value = readFrontmatter(file.bytes)?.value ?? {};
  } catch {
    value = {};
  }
  const docId = typeof value.id === 'string' ? value.id : null;
  if (id !== undefined && docId !== null && id !== docId) throw new UsageError(`${plain(file.path)} is "${plain(docId)}", not "${id}"; nothing was written`, `run: mirai approve --file ${fileArg}`);
  const trust = snapshot({ cwd: io.cwd, env: io.env });
  const config = trustedConfig(trust);
  // Unit 37: the type as the project's approved overlays make it.
  const registry = withOverlays(trust, store, io, [kind.type]);
  const text = file.bytes.toString('utf8');
  // The journeys' screens are the feature map's, beside it.
  const linked = {};
  if (kind.type === 'journeys') {
    try {
      linked['feature-map.md'] = readApprovedFile(store.checkout, store.checkout, `${CONTEXT_DIR}/feature-map.md`).bytes.toString('utf8');
    } catch {
      // no feature map yet: the screens aren't checked
    }
  }
  refuseOnLint(io, [{ path: file.path, errors: lintText(text, { source: file.path, registry, project: projectOfConfig(config), approving: true, linked, repo: store.checkout }) }]);
  if (docId === null) throw new MiraiError(`${plain(file.path)} has no id; nothing was written`, EXIT.BLOCKED);
  // Unit 40 (decision 6): business.md, journeys.md and each conventions file are Vera's too.
  const vera = verifierFor({ store, config, def: registry.documentTypes[kind.type], id: docId, path: file.path, bytes: file.bytes });
  const hash = contentHash(file.bytes);
  const before = contextApproval(store, file.path, file.bytes);
  io.stdout.write(`context: ${name} (${kind.type}, ${plain(docId)})${before.approved ? ' (approved before, as it is now)' : before.stale ? ' (approved before; it has changed since)' : ''}
file:    ${file.path}
hash:    ${hash}
${plain(join(store.checkout, file.path))}
you approve the whole file: read it all before you answer
`);
  showVerifier(io, vera);
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
    const signer = await decisionSigner(io, store, { prompter, ticket: docId, confirm: confirmByTyping });
    if (contentHash(readApprovedFile(store.checkout, io.cwd, fileArg).bytes) !== hash) {
      throw new MiraiError(`${file.path} changed while you were answering; nothing was written`, EXIT.FAILURE);
    }
    const approval = checkEvent({ type: 'approval', by: 'human', item: docId, kind: 'context', file_type: kind.type, path: file.path, content_hash: hash, decision, ...(reason ? { reason } : {}), answered_after_s: answeredAfter, ...verifierField(vera) });
    const misses = decision === 'rejected' ? missesOf([{ item: docId, kind: kind.type, path: file.path, vera }], reason) : [];
    const seq = withSeq(store, (ctx) => {
      const n = ctx.take();
      ctx.event(n, approval, { signer });
      for (const m of misses) ctx.event(ctx.take(), m);
      return n;
    });
    showMisses(io, misses);
    io.stdout.write(decision === 'rejected'
      ? `recorded: ${file.path} rejected (signed with ${signer.keyId}, seq ${seq})\n`
      : `approved: ${file.path}, as it is now (${decision}; signed with ${signer.keyId}, seq ${seq}); a change to it needs a new approval\n`);
    io.stdout.write(`${documentLine({ store, config, abs: join(store.checkout, file.path), rel: file.path, bytes: file.bytes })}\n`);
    return EXIT.OK;
  } finally {
    prompter.close();
  }
}

// Whether `bytes` are the context file at `path` as you last approved it: { approved, stale, seq,
// ts } (ts: when that approval was written). The file's place is what's approved: its id may
// change with it. `events` may be passed in (doctor has read them).
export function contextApproval(store, path, bytes, events = null) {
  const last = (events ?? readJournal(store).events).filter((e) => e.type === 'approval' && e.by === 'human' && e.kind === 'context' && e.path === path).at(-1);
  if (!last || last.decision === 'rejected') return { approved: false, stale: false, seq: last?.seq ?? null, ts: null };
  const same = bytes !== null && last.content_hash === contentHash(bytes);
  return { approved: same, stale: !same, seq: last.seq, ts: last.ts ?? null };
}

// ---- Overlays (unit 37, Scope 5) ----------------------------------------------------------

// mirai approve --file .mirai/custom/<overlay> (decision 2): the overlay as your work tree has it,
// checked against MIRAI's definitions in the trust root; one that doesn't validate (drops a
// protected part, removes a check, names a tool no launch gets) is refused with every problem,
// nothing written. Then your decision, signed: one line, kind overlay, over its main file's hash
// and the files it binds (a type overlay's template, an agent's text); for a replacement
// template, MIRAI's template version and hash too, so doctor can say when MIRAI's moved on.
async function approveOverlay({ id, file, store, io, now, fileArg }) {
  const trust = snapshot({ cwd: io.cwd, env: io.env });
  const registry = trustedRegistry(trust);
  let roles = registry.roles;
  try {
    roles = trustedRoles(trust);
  } catch {
    // a broken project role shows on the overlay that names it
  }
  const overlays = readOverlays(overlayFilesIn(join(store.checkout, CUSTOM_DIR)), registry, { roles });
  const o = overlays.find((x) => x.path === file.path) ?? null;
  const owner = o ? null : overlays.find((x) => x.bound.some((b) => b.path === file.path));
  if (owner) throw new UsageError(`${plain(file.path)} is approved with its overlay ${owner.path}; nothing was written`, `mirai approve --file ${owner.path}`);
  if (!o) throw new UsageError(`${plain(file.path)} isn't an overlay; nothing was written`, 'an overlay is .mirai/custom/document-types/<type>.toml, agents/<name>.toml or skills/<name>/overlay.toml; a custom item (unit 39) is project-skills/<name>/SKILL.md, hooks/<name>.toml, scripts/<name>.<ext> or mcp/<name>.toml');
  if (o.problems.length) {
    for (const p of o.problems.slice(0, 20)) io.stderr.write(`${o.path}: ${plain(p)}\n`);
    const n = o.problems.length;
    throw Object.assign(new MiraiError(`${o.path} can't be approved: ${n} problem${n === 1 ? '' : 's'}, listed above; nothing was written`, EXIT.BLOCKED), { code: 'overlay-invalid', hint: 'fix them, then approve again' });
  }
  // Unit 39: a project's own item is typed as <kind>-<name> (a script and a hook may share a name).
  const item = (CUSTOM_KINDS.includes(o.kind) ? `${o.kind}-${o.name}` : `overlay-${o.name}`).slice(0, 64);
  if (id !== undefined && id !== item) throw new UsageError(`${plain(file.path)} is approved as "${item}", not "${id}"; nothing was written`, `run: mirai approve --file ${fileArg}`);
  const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
  const before = overlayState(o, readJournal(store).events, verifyRecords(overlayFilesIn(join(store.checkout, CUSTOM_DIR)), { keys, repoId: store.repoId }));
  const r = o.result;
  const what = o.kind === 'project-skill' ? `the project's own skill ${o.name}, for your sessions` : o.kind === 'hook' ? `a hook for your sessions only (${r.event}${r.group.matcher ? ` ${r.group.matcher}` : ''}), never a MIRAI run; it runs ${r.script}` : o.kind === 'script' ? `a script (${r.runner})` : o.kind === 'mcp' ? 'an MCP server for your sessions only, never a MIRAI run'
    : o.kind === 'document-type' ? `the ${o.name} type, ${r.replace ? 'a replacement template' : 'a section overlay'}`
      : o.kind === 'ticket-type' ? `the ${o.name} ticket type's own template, on MIRAI's ${r.base} type`
    : o.kind === 'agent' ? `${o.name}, ${r.change === 'instructions' ? 'instructions only' : `${r.change}: ${r.why.join(', ')}`}` : `the ${o.name} skill, instructions`;
  io.stdout.write(`overlay: ${o.path} (${what})${before.state === 'approved' ? ' (approved before, as it is now)' : before.state === 'changed' ? ' (approved before; it has changed since)' : ''}\nhash:    ${o.hash}\n`);
  for (const b of o.bound) io.stdout.write(`with:    ${b.path}   ${b.content_hash}, signed with it\n`);
  if (r.replace) io.stdout.write(`MIRAI's template: ${o.name} version ${r.coreTemplate.version ?? 'unknown'}, ${r.coreTemplate.hash} (doctor says when MIRAI's moves on)\n`);
  if (o.kind === 'agent' && r.change === 'widening') io.stdout.write(`it widens ${o.name} (${r.why.join(', ')}): its launches are refused until a red-team run covers this overlay (mirai redteam run)\n`);
  io.stdout.write(`${plain(join(store.checkout, o.path))}\nyou approve the whole file${o.bound.length ? ' and the files it binds' : ''}: read it all before you answer\n`);
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
    const signer = await decisionSigner(io, store, { prompter, ticket: item, confirm: confirmByTyping });
    // What you approved is what was shown: none of its files may have changed while you answered.
    const again = readOverlays(overlayFilesIn(join(store.checkout, CUSTOM_DIR)), registry, { roles }).find((x) => x.path === o.path);
    const sig = (x) => [x?.hash, ...(x?.bound ?? []).map((b) => `${b.path} ${b.content_hash}`)].join('\n');
    if (!again || sig(again) !== sig(o)) throw new MiraiError(`${o.path} or a file it binds changed while you were answering; nothing was written`, EXIT.FAILURE);
    const files = o.bound.map((b) => ({ path: b.path, content_hash: b.content_hash }));
    const approval = checkEvent({
      type: 'approval', by: 'human', item, kind: 'overlay', path: o.path, content_hash: o.hash, ...(files.length ? { files } : {}), decision, ...(reason ? { reason } : {}), answered_after_s: answeredAfter,
      ...(r.replace ? { ...(Number.isInteger(r.coreTemplate.version) ? { template_version: r.coreTemplate.version } : {}), template_hash: r.coreTemplate.hash } : {}),
    });
    // Unit 37 (Jet's answer to Q3): the same decision as a signed record beside the overlays, so the
    // approval travels with the repo (a teammate's checkout, CI). It's written first: a journal
    // line with no record is still your approval here; a record with no line never happens.
    const record = signObject(overlayRecord(o, { decision, templateVersion: r.replace ? r.coreTemplate.version : null, templateHash: r.replace ? r.coreTemplate.hash : null, now }), signer, { context: overlayRecordContext(store.repoId), now });
    const recordFile = recordPathOf(o);
    mkdirSync(join(store.checkout, CUSTOM_DIR, RECORDS_FOLDER), { recursive: true });
    atomicWrite(join(store.checkout, recordFile), recordText(record));
    const seq = withSeq(store, (ctx) => {
      const n = ctx.take();
      ctx.event(n, approval, { signer });
      return n;
    });
    io.stdout.write(decision === 'rejected'
      ? `recorded: ${o.path} rejected (signed with ${signer.keyId}, seq ${seq})\n`
      : `approved: ${o.path}, as it is now (${decision}; signed with ${signer.keyId}, seq ${seq}); MIRAI uses it once it's on ${store.branch}, and a change to it needs a new approval\n`);
    if (o.kind === 'document-type' || o.kind === 'ticket-type' || o.kind === 'script') io.stdout.write(`record:  ${recordFile}: commit it with the ${o.kind === 'script' ? 'script' : 'overlay'}\n`);
    else {
      // An agent or skill overlay also changes your sessions' copy, which mirai render writes.
      const files = [o.path, ...o.bound.map((b) => b.path), recordFile];
      io.stdout.write(`record:  ${recordFile}\nnext:\n  1. mirai render       (your sessions' copy of ${o.name}, from the approved overlay)\n  2. git add ${files.join(' ')} ${o.kind === 'mcp' ? '.mcp.json' : '.claude/'} .mirai/mirai.lock\n  3. git commit, then merge it into ${store.branch}: the overlay, its record and the rendered files together\n`);
    }
    return EXIT.OK;
  } finally {
    prompter.close();
  }
}

// ---- business.md proposals (unit 41, Scope 4; Jet's decision 2, D-43) --------------------------

// The text of a file beside `docPath` (in the same folder), read as approval reads files, or null.
function besideText(base, docPath, name) {
  try {
    return readApprovedFile(base, base, posix.join(posix.dirname(docPath), name)).bytes.toString('utf8');
  } catch {
    return null;
  }
}

// Whether the business.md proposal beside a brief is still open: your last decision on it doesn't
// cover it as it is now. Rejected or approved as it is: closed. null when there's no proposal.
export function proposalState(store, base, docPath, events = null) {
  const rel = posix.join(posix.dirname(docPath), 'business-change.md');
  let read;
  try {
    read = readApprovedFile(base, base, rel);
  } catch {
    return null;
  }
  const last = (events ?? readJournal(store).events).filter((e) => e.type === 'approval' && e.by === 'human' && e.kind === 'business-change' && e.path === read.path).at(-1);
  const decided = Boolean(last) && last.content_hash === contentHash(read.bytes);
  return { path: read.path, open: !decided, decision: decided ? last.decision : null };
}

function refuseOpenProposal(store, base, briefPath) {
  const p = proposalState(store, base, briefPath);
  if (!p?.open) return;
  throw Object.assign(new MiraiError(`${plain(p.path)}, a proposal to change business.md, is still open, and the brief beside it depends on it; nothing was written`, EXIT.BLOCKED), { code: 'proposal-open', hint: `decide it first: mirai approve --file ${plain(p.path)}` });
}

// mirai approve --file docs/mirai/<initiative>/business-change.md: the proposal's changes, each
// "Replace:" text found in business.md exactly once, and business.md as it would become, linted.
// You approve or reject it. Approved: MIRAI writes business.md as it becomes, and signs two lines
// in one step: the proposal (kind business-change, business.md's new hash in `files`) and
// business.md's own approval (kind context, naming the proposal). Rejected: one signed line, and
// business.md is left as it was. The verifier doesn't check business.md here: every changed line is
// the text of a proposal you read line by line, from your own answer (the screen says so).
async function approveBusinessChange({ id, file, store, io, now, fileArg, base = store.checkout, conn = null }) {
  const value = readFrontmatter(file.bytes)?.value ?? {};
  const docId = typeof value.id === 'string' ? value.id : null;
  if (id !== undefined && docId !== null && id !== docId) throw new UsageError(`${plain(file.path)} is "${plain(docId)}", not "${id}"; nothing was written`, `run: mirai approve --file ${fileArg}`);
  if (posix.basename(file.path) !== 'business-change.md') throw new UsageError(`${plain(file.path)} is a business change, but isn't named business-change.md in an initiative's folder; nothing was written`, 'docs/mirai/<initiative>/business-change.md');
  const trust = snapshot({ cwd: io.cwd, env: io.env });
  const config = trustedConfig(trust);
  const registry = withOverlays(trust, store, io, ['business-change', 'business']);
  const project = projectOfConfig(config);
  const text = file.bytes.toString('utf8');
  refuseOnLint(io, [{ path: file.path, errors: lintText(text, { source: file.path, registry, project, approving: true }) }]);
  if (docId === null) throw new MiraiError(`${plain(file.path)} has no id; nothing was written`, EXIT.BLOCKED);
  const businessRel = `${CONTEXT_DIR}/business.md`;
  let business;
  try {
    business = readApprovedFile(store.checkout, store.checkout, businessRel);
  } catch {
    throw Object.assign(new MiraiError(`${businessRel} isn't there, so there's nothing to change; nothing was written`, EXIT.BLOCKED), { code: 'no-business', hint: 'setup writes it (mirai setup start context)' });
  }
  const businessId = readFrontmatter(business.bytes)?.value?.id;
  const changes = changesOf(parseDocument(text, file.path));
  const applied = applyChanges(business.bytes.toString('utf8'), changes);
  if (applied.problem) throw Object.assign(new MiraiError(`${applied.problem}; nothing was written`, EXIT.BLOCKED), { code: 'business-change-stale', hint: `business.md changed since the proposal was written: correct ${applied.change}'s "Replace:" text to match it, then approve again` });
  const after = Buffer.from(applied.text, 'utf8');
  refuseOnLint(io, [{ path: `${businessRel} (as the change would make it)`, errors: lintText(applied.text, { source: businessRel, registry, project, approving: true, repo: store.checkout }) }]);
  const hash = contentHash(file.bytes);
  const afterHash = contentHash(after);
  const before = proposalState(store, base, file.path);
  io.stdout.write(`business change: ${plain(docId)}${before && !before.open ? ` (${before.decision} before, as it is now)` : ''}
file:   ${file.path}
hash:   ${hash}
it changes ${businessRel} (${plain(String(businessId ?? 'business'))}), and approving it approves business.md as it then is
`);
  for (const c of changes) {
    io.stdout.write(`${c.id}: ${plain(c.title)}\n`);
    for (const l of c.replace.split('\n')) io.stdout.write(`  - ${plain(l)}\n`);
    for (const l of c.with.split('\n')) io.stdout.write(`  + ${plain(l)}\n`);
    io.stdout.write(`  source: ${plain(c.source)}\n  why: ${plain(c.why)}\n`);
  }
  io.stdout.write(`${fullName('mirai-verifier')}: not run on this change: each changed line is the proposal's text, which you read above\n`);
  const prompter = createPrompter(io);
  try {
    const asked = now().getTime();
    const answer = (await prompter.ask('apply and approve, or reject? [a/r] ')).toLowerCase();
    const decision = { a: 'accepted', r: 'rejected' }[answer];
    if (!decision) throw new UsageError(`${JSON.stringify(answer.slice(0, 10))} is not a or r; nothing was written`, 'run it again');
    const answeredAfter = Math.round((now().getTime() - asked) / 100) / 10;
    let reason;
    if (decision === 'rejected') {
      reason = await prompter.ask('reason (optional, one line): ');
      if (reason.length > 500) throw new UsageError('the reason is longer than 500 characters; nothing was written', 'keep it to one line');
      if (reason === '') reason = undefined;
    }
    const signer = await decisionSigner(io, store, { prompter, ticket: docId, confirm: confirmByTyping });
    if (contentHash(readApprovedFile(base, io.cwd, fileArg).bytes) !== hash || contentHash(readApprovedFile(store.checkout, store.checkout, businessRel).bytes) !== contentHash(business.bytes)) {
      throw new MiraiError(`${file.path} or ${businessRel} changed while you were answering; nothing was written`, EXIT.FAILURE);
    }
    const proposalLine = checkEvent({ type: 'approval', by: 'human', item: docId, kind: 'business-change', path: file.path, content_hash: hash, ...(decision === 'rejected' ? {} : { files: [{ path: businessRel, content_hash: afterHash }] }), decision, ...(reason ? { reason } : {}), answered_after_s: answeredAfter });
    const businessLine = decision === 'rejected' ? null : checkEvent({ type: 'approval', by: 'human', item: String(businessId ?? 'business'), kind: 'context', file_type: 'business', path: businessRel, content_hash: afterHash, proposal: file.path, decision, answered_after_s: answeredAfter });
    const abs = join(store.checkout, businessRel);
    if (businessLine) writeFileSync(abs, after, { mode: statSync(abs).mode & 0o777 });
    let seq;
    try {
      seq = withSeq(store, (ctx) => {
        const n = ctx.take();
        ctx.event(n, proposalLine, { signer });
        if (businessLine) ctx.event(ctx.take(), businessLine, { signer });
        return n;
      });
    } catch (err) {
      // Nothing signed: business.md goes back to what it was.
      if (businessLine) writeFileSync(abs, business.bytes);
      throw err;
    }
    io.stdout.write(decision === 'rejected'
      ? `recorded: ${file.path} rejected (signed with ${signer.keyId}, seq ${seq}); ${businessRel} is unchanged\n`
      : `applied and approved: ${businessRel} now has ${changes.length} change${changes.length === 1 ? '' : 's'} from ${file.path}, and both are approved as they are now (signed with ${signer.keyId}, seq ${seq} and ${seq + 1}); commit both\n`);
    if (businessLine) io.stdout.write(`${documentLine({ store, config, abs, rel: businessRel, bytes: after })}\n`);
    io.stdout.write(`${documentLine({ store, config, conn, abs: join(base, file.path), rel: file.path, bytes: file.bytes })}\n`);
    return EXIT.OK;
  } finally {
    prompter.close();
  }
}
