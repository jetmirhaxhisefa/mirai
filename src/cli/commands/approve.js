import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, rmSync } from 'node:fs';
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
import { ROUNDS, failedLabels, needsReaderTest, resultLines, summaryHash, summaryText } from '../../write/reader.js';
import { CONTEXT_DIR, contextKindOf, isContextFile } from '../../lint/context.js';
import { CUSTOM_DIR, CUSTOM_KINDS, RECORDS_FOLDER, overlayFilesIn, overlayRecord, overlayRecordContext, overlayState, readOverlays, recordPathOf, recordText, verifyRecords } from '../../config/overlays.js';
import { trustedRoles } from '../../agent/scope.js';
import { baseForArg, docsStoreFor } from '../../store/connectors/index.js';
import { documentLine } from '../../store/connectors/links.js';

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
      if (contentHash(readApprovedFile(base, io.cwd, args.values.file).bytes) !== hash) {
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
  const { linked, files: bound } = type === 'brief' ? interviewOf(base, file.path, text, registry) : { linked: {}, files: [] };
  refuseOnLint(io, [{ path: file.path, errors: lintText(text, { source: file.path, registry, project: projectOfConfig(config), approving: true, linked }) }]);
  const reader = readerFor({ store, config, def: registry.documentTypes[type], value: fm.value, id, path: file.path, text });
  const hash = contentHash(file.bytes);
  const files = fileHashes(bound);
  const before = documentApproval(store, id, file.bytes, bound);
  io.stdout.write(`${type}: ${id}${before.approved ? ' (approved before, as it is now)' : before.stale ? ' (approved before; it or its interview has changed since)' : ''}\nfile:   ${file.path}\nhash:   ${hash}\n`);
  for (const f of files) io.stdout.write(`interview: ${plain(f.path)}   ${f.content_hash}, signed with the brief\n`);
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
    const approval = checkEvent({ type: 'approval', by: 'human', item: id, kind: type, path: file.path, content_hash: hash, ...(files.length ? { files } : {}), decision, ...(reason ? { reason } : {}), answered_after_s: answeredAfter, ...readerField(reader) });
    const seq = withSeq(store, (ctx) => {
      const n = ctx.take();
      ctx.event(n, approval, { signer });
      return n;
    });
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
  const results = [{ path: file.path, errors: lintText(text, { source: file.path, registry, project, approving: true, linked: { [brief.link]: briefText } }) }];
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
  // Unit 34: the PRD's summary (on standard it covers the brief too) has its reader-test result.
  const reader = readerFor({ store, config, def, value: fm.value, id, path: file.path, text });
  const prdHash = contentHash(file.bytes);
  const briefHash = contentHash(brief.file.bytes);
  const prdBefore = documentApproval(store, id, file.bytes);
  const state = (b) => (b.approved ? ' (approved before, as it is now)' : b.stale ? ' (approved before; it has changed since)' : '');
  io.stdout.write(`prd:    ${id}${state(prdBefore)}\nfile:   ${file.path}\nhash:   ${prdHash}\n`);
  io.stdout.write(`brief:  ${briefId}${pair ? state(briefBefore) : ' (approved, as it is now)'}\nfile:   ${brief.file.path}\nhash:   ${briefHash}\n`);
  for (const f of briefBound) io.stdout.write(`interview: ${plain(f.path)}   ${f.content_hash}, signed with the brief\n`);
  if (pair) io.stdout.write(`one decision approves both: the brief and its PRD (track ${fm.value.track})\n`);
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
    // What you approved is what was shown: neither file may have changed while you answered.
    for (const [path, hash] of [[file.path, prdHash], [brief.file.path, briefHash], ...briefBound.map((f) => [f.path, f.content_hash])]) {
      if (contentHash(readApprovedFile(base, base, path).bytes) !== hash) throw new MiraiError(`${path} changed while you were answering; nothing was written`, EXIT.FAILURE);
    }
    const line = (item, kind, path, hash, extra = {}) => checkEvent({ type: 'approval', by: 'human', item, kind, path, content_hash: hash, decision, ...(reason ? { reason } : {}), answered_after_s: answeredAfter, ...extra });
    const events = [...(pair ? [line(briefId, 'brief', brief.file.path, briefHash, briefBound.length ? { files: briefBound } : {})] : []), line(id, 'prd', file.path, prdHash, readerField(reader))];
    const seqs = withSeq(store, (ctx) => events.map((ev) => {
      const n = ctx.take();
      ctx.event(n, ev, { signer });
      return n;
    }));
    const what = pair ? `the brief ${briefId} and the PRD ${id}, as ${brief.file.path} and ${file.path} are now` : `the PRD ${id}, as ${file.path} is now`;
    io.stdout.write(decision === 'rejected'
      ? `recorded: ${pair ? `the brief ${briefId} and the PRD ${id}` : `the PRD ${id}`} rejected (signed with ${signer.keyId}, seq ${seqs.join(', ')})\n`
      : `approved: ${what} (${decision}; signed with ${signer.keyId}, seq ${seqs.join(', ')}); a change to ${pair ? 'either' : 'it'} needs a new approval\n`);
    if (pair) io.stdout.write(`${documentLine({ store, config, conn, abs: join(base, brief.file.path), rel: brief.file.path, bytes: brief.file.bytes })}\n`);
    io.stdout.write(`${documentLine({ store, config, conn, abs: join(base, file.path), rel: file.path, bytes: file.bytes })}\n`);
    return EXIT.OK;
  } finally {
    prompter.close();
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
  return { entry };
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
    : `reader test failed (round ${e.round}${e.round <= ROUNDS ? ` of ${ROUNDS}` : ''}, model ${plain(e.model)}): ${failedLabels(e).join(', ')}`;
  io.stdout.write(`${[head, ...resultLines(e).map((l) => plain(l))].join('\n')}\n`);
  if (e.result !== 'pass') io.stdout.write('you can still decide: approve anyway (a), reject with a note (r), or answer the gap yourself: fix the summary, run mirai reader-test, then approve again\n');
}

const readerField = (reader) => (reader?.entry ? { reader_test: reader.entry.hash } : {});

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
// each ticket file's bytes, so a later change to any of them needs a new approval. The inbox
// screen and the docs MR merge are unit 45's.
async function approveEpic({ id, file, store, io, now, registry, config, project, base = store.checkout, conn = null }) {
  const text = file.bytes.toString('utf8');
  const input = epicInputs(base, file.path, text, registry);
  const results = [{ path: file.path, errors: lintText(text, { source: file.path, registry, project, approving: true, linked: { [input.prdLink]: input.prd.bytes.toString('utf8') }, tickets: input.folder }) }];
  for (const t of input.tickets) results.push({ path: t.path, errors: lintText(t.bytes.toString('utf8'), { source: t.path, registry, project, approving: true }) });
  refuseOnLint(io, results);
  const prdId = typeof input.prdValue.id === 'string' ? input.prdValue.id : null;
  const prdBefore = prdId ? documentApproval(store, prdId, input.prd.bytes) : { approved: false, stale: false };
  if (!prdBefore.approved) {
    throw Object.assign(new MiraiError(`the PRD ${prdId ?? input.prd.path} isn't approved${prdBefore.stale ? ' as it is now (it changed since its approval)' : ''}; its tickets are approved after it; nothing was written`, EXIT.BLOCKED), { hint: `run: mirai approve ${prdId ?? '<prd-id>'} --file ${input.prd.path}` });
  }
  const reader = readerFor({ store, config, def: registry.documentTypes.epic, value: input.doc.value, id, path: file.path, text });
  const hash = contentHash(file.bytes);
  const files = input.tickets.map((t) => ({ path: t.path, content_hash: contentHash(t.bytes) }));
  const signature = (list) => list.map((f) => `${f.path} ${f.content_hash}`).join('\n');
  const before = epicApproval(store, id, file.bytes, input.tickets);
  const n = files.length;
  io.stdout.write(`epic:    ${id}${before.approved ? ' (approved before, as it is now)' : before.stale ? ' (approved before; it or a ticket has changed since)' : ''}\nfile:    ${file.path}\nhash:    ${hash}\nprd:     ${prdId} (approved, as it is now)\ntickets: ${n}, signed with the epic\n`);
  for (const f of files) io.stdout.write(`  ${plain(f.path)}   ${f.content_hash}\n`);
  io.stdout.write(`${plain(join(base, file.path))}\n`);
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
    // What you approved is what was shown: no file may have changed while you answered, and no
    // ticket may have joined or left the epic.
    const nowBytes = readApprovedFile(base, base, file.path).bytes;
    const again = epicInputs(base, file.path, nowBytes.toString('utf8'), registry);
    if (contentHash(nowBytes) !== hash || signature(again.tickets.map((t) => ({ path: t.path, content_hash: contentHash(t.bytes) }))) !== signature(files)) {
      throw new MiraiError(`${file.path} or one of its tickets changed while you were answering; nothing was written`, EXIT.FAILURE);
    }
    const approval = checkEvent({ type: 'approval', by: 'human', item: id, kind: 'epic', path: file.path, content_hash: hash, files, decision, ...(reason ? { reason } : {}), answered_after_s: answeredAfter, ...readerField(reader) });
    const seq = withSeq(store, (ctx) => {
      const k = ctx.take();
      ctx.event(k, approval, { signer });
      return k;
    });
    io.stdout.write(decision === 'rejected'
      ? `recorded: the epic ${id} and its ${n} tickets rejected (signed with ${signer.keyId}, seq ${seq})\n`
      : `approved: the epic ${id} and its ${n} tickets, as they are now (${decision}; signed with ${signer.keyId}, seq ${seq}); a change to any of them needs a new approval\n`);
    io.stdout.write(`${documentLine({ store, config, conn, abs: join(base, file.path), rel: file.path, bytes: file.bytes })}\n`);
    return EXIT.OK;
  } finally {
    prompter.close();
  }
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
  const hash = contentHash(file.bytes);
  const before = contextApproval(store, file.path, file.bytes);
  io.stdout.write(`context: ${name} (${kind.type}, ${plain(docId)})${before.approved ? ' (approved before, as it is now)' : before.stale ? ' (approved before; it has changed since)' : ''}
file:    ${file.path}
hash:    ${hash}
${plain(join(store.checkout, file.path))}
you approve the whole file: read it all before you answer
`);
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
    const approval = checkEvent({ type: 'approval', by: 'human', item: docId, kind: 'context', file_type: kind.type, path: file.path, content_hash: hash, decision, ...(reason ? { reason } : {}), answered_after_s: answeredAfter });
    const seq = withSeq(store, (ctx) => {
      const n = ctx.take();
      ctx.event(n, approval, { signer });
      return n;
    });
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
    if (o.kind === 'document-type' || o.kind === 'script') io.stdout.write(`record:  ${recordFile}: commit it with the ${o.kind === 'script' ? 'script' : 'overlay'}\n`);
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
