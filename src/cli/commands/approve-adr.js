import { writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { confirmByTyping, readApprovedFile } from '../human-move.js';
import { createPrompter } from '../tty.js';
import { adrSettings, adrState, indexPathOf, keepSignedCopy, listAdrs, renderIndex, signedCopyOf, withFields, workTreeReader } from '../../adr/adr.js';
import { readFrontmatter } from '../../lint/frontmatter.js';
import { lintText, parseDocument, projectOf } from '../../lint/lint.js';
import { linkLinesOf } from '../../lint/rules.js';
import { checkEvent, readJournal, withSeq } from '../../store/journal.js';
import { contentHash } from '../../sign/sign.js';
import { decisionSigner } from '../../sign/signer.js';
import { plain } from '../../status/text.js';
import { documentLine } from '../../store/connectors/links.js';
import { snapshot, trustedConfig } from '../../trust/snapshot.js';
import { verifierField, verifierFor } from '../../verify/gate.js';
import { missesOf, publishAfterInitiative, refuseOnLint, showMisses, showVerifier, startTess, tessOffer, withOverlays } from './approve.js';

// mirai approve <adr-id> --file <docs/decisions/ADR-n-slug.md> (unit 61, Scope 7; decision 6).
// On its own until the design workflow (65) signs ADRs with their HLD. The lint as at approval (the
// PRD it cites linked, the other ADRs of the folder read), then Vera's result, then you: accept, or
// reject with a reason (kept in the file, so it isn't proposed again). MIRAI writes the status into
// the file (Jet's "A": the field mirrors your signed line) and signs those exact bytes; accepting
// an ADR that supersedes another marks the old one `superseded` with its successor, both files in
// the one signed line. The index is rendered again. An initiative's ADR is published with the
// initiative's documents (44's publish; 45's re-check: its docs MR carries its ADRs), and the offer
// to start the ticket planner follows when the track's inputs are then complete.

const ADR_DECISIONS = { a: 'accepted', r: 'rejected' };

export async function approveAdr({ id, file, store, io, now, fileArg, base = store.checkout, conn = null }) {
  const text = file.bytes.toString('utf8');
  const fm = readFrontmatter(file.bytes);
  const value = fm?.value ?? {};
  if (value.id !== id) throw new UsageError(`${file.path} is the ADR "${value.id}", not "${id}"; nothing was written`, `run: mirai approve ${value.id} --file ${fileArg}`);
  const trust = snapshot({ cwd: io.cwd, env: io.env });
  const config = trustedConfig(trust);
  const registry = withOverlays(trust, store, io, ['adr', 'prd']);
  const def = registry.documentTypes.adr;
  const s = adrSettings(config);
  if (posix.dirname(file.path) !== s.folder) throw Object.assign(new MiraiError(`${file.path} isn't in the project's ADR folder (${s.folder}/); nothing was written`, EXIT.BLOCKED), { code: 'adr-folder', hint: `ADRs live in ${s.folder}/ ([adr] folder): mirai adr new <slug> gives the next file there` });
  const { events } = readJournal(store);
  if (value.status !== 'proposed') {
    const st = adrState({ events, path: file.path, bytes: file.bytes, approvedTextOf: signedCopyOf(store) });
    throw Object.assign(new MiraiError(`the ADR ${id} is ${plain(String(value.status))}, not proposed: you approve a proposed ADR once; nothing was written`, EXIT.BLOCKED), { code: 'adr-not-proposed', hint: value.status === 'accepted' && st.state === 'changed' ? `an accepted decision is final: write a new ADR with supersedes: ${id} (mirai adr new <slug>), and approve that one` : value.status === 'accepted' ? `to review whether it still holds: mirai adr review ${id}` : 'a rejected, superseded or deprecated ADR stays as it is' });
  }

  // The lint as at approval, with the PRD its "PRD:" line links and the other ADRs of the folder.
  const linked = {};
  try {
    for (const l of linkLinesOf(parseDocument(text.replace(/\r\n?/g, '\n'), file.path).scan, def).filter((x) => x.link.label === 'PRD')) {
      const target = l.targets[0]?.split('#')[0];
      if (!target) continue;
      try {
        linked[target] = readApprovedFile(base, base, posix.normalize(posix.join(posix.dirname(file.path), target))).bytes.toString('utf8');
      } catch {
        // a link that doesn't resolve is the lint's to report
      }
    }
  } catch {
    // a document that doesn't parse: the lint below says why
  }
  refuseOnLint(io, [{ path: file.path, errors: lintText(text, { source: file.path, registry, project: projectOf(config), approving: true, linked, adrRoot: base }) }]);
  const adrs = listAdrs(workTreeReader(base), s);
  const old = typeof value.supersedes === 'string' && value.supersedes ? adrs.find((a) => a.id.toLowerCase() === value.supersedes.toLowerCase()) : null;

  const vera = verifierFor({ store, config, def, id, path: file.path, bytes: file.bytes });
  const hash = contentHash(file.bytes);
  io.stdout.write(`ADR: ${id}: ${plain(adrs.find((a) => a.path === file.path)?.title ?? '')}\nfile:   ${file.path}\nhash:   ${hash} (as proposed; MIRAI writes your decision into it)\n`);
  if (typeof value.initiative === 'string' && value.initiative) io.stdout.write(`from:   the initiative ${plain(value.initiative)}\n`);
  io.stdout.write(`gate:   ${(Array.isArray(value.gate) ? value.gate : []).map((g) => plain(String(g))).join(', ')}\n`);
  if (old) io.stdout.write(`supersedes: ${old.id} (${plain(old.title)}): accepting this marks it superseded\n`);
  showVerifier(io, vera);
  const prompter = createPrompter(io);
  let start = null;
  try {
    const asked = now().getTime();
    const answer = (await prompter.ask('accepted / rejected? [a/r] ')).toLowerCase();
    const decision = ADR_DECISIONS[answer];
    if (!decision) throw new UsageError(`${JSON.stringify(answer.slice(0, 10))} is not a or r; nothing was written`, 'run it again');
    const answeredAfter = Math.round((now().getTime() - asked) / 100) / 10;
    let reason;
    if (decision === 'rejected') {
      reason = (await prompter.ask('reason (one line; it stays in the ADR, so it isn\'t proposed again): ')).trim();
      if (!reason) throw new UsageError('a rejected ADR keeps your reason; nothing was written', 'run it again and give one line');
      if (reason.length > 500) throw new UsageError('the reason is longer than 500 characters; nothing was written', 'keep it to one line');
    }
    const signer = await decisionSigner(io, store, { prompter, ticket: id, confirm: confirmByTyping });
    // What you decided on is what was shown.
    if (contentHash(readApprovedFile(base, io.cwd, fileArg).bytes) !== hash) throw new MiraiError(`${file.path} changed while you were answering; nothing was written`, EXIT.FAILURE);
    if (old && contentHash(readApprovedFile(base, base, old.path).bytes) !== contentHash(old.bytes)) throw new MiraiError(`${old.path} changed while you were answering; nothing was written`, EXIT.FAILURE);

    // The files as your decision makes them, then the signed line over those bytes.
    const mine = Buffer.from(withFields(text, decision === 'accepted' ? { status: 'accepted' } : { status: 'rejected', status_reason: reason }));
    const superseded = decision === 'accepted' && old ? Buffer.from(withFields(old.text, { status: 'superseded', superseded_by: id })) : null;
    const files = superseded ? [{ path: old.path, content_hash: contentHash(superseded) }] : [];
    const approval = checkEvent({ type: 'approval', by: 'human', item: id, kind: 'adr', path: file.path, content_hash: contentHash(mine), decision, ...(reason ? { reason } : {}), answered_after_s: answeredAfter, ...(files.length ? { files } : {}), ...verifierField(vera) });
    const misses = decision === 'rejected' ? missesOf([{ item: id, kind: 'adr', path: file.path, vera }], reason) : [];
    const writes = [{ path: file.path, bytes: mine, was: file.bytes }, ...(superseded ? [{ path: old.path, bytes: superseded, was: old.bytes }] : [])];
    for (const w of writes) writeFileSync(join(base, w.path), w.bytes);
    let seq;
    try {
      seq = withSeq(store, (ctx) => {
        const n = ctx.take();
        ctx.event(n, approval, { signer });
        for (const m of misses) ctx.event(ctx.take(), m);
        return n;
      });
    } catch (err) {
      // Not signed: the files go back as they were.
      for (const w of writes) writeFileSync(join(base, w.path), w.was);
      throw err;
    }
    for (const w of writes) keepSignedCopy(store, w.bytes);
    const reader = workTreeReader(base);
    const indexPath = indexPathOf(reader, s);
    writeFileSync(join(base, indexPath), renderIndex(listAdrs(reader, s)));
    showMisses(io, misses);
    io.stdout.write(decision === 'rejected'
      ? `recorded: the ADR ${id} rejected, with your reason in it (signed with ${signer.keyId}, seq ${seq}); it stays in ${s.folder}/ so it isn't proposed again\n`
      : `accepted: the ADR ${id}${superseded ? `; ${old.id} is now superseded by it` : ''} (signed with ${signer.keyId}, seq ${seq}); it is final: a new decision is a new ADR that supersedes it\n`);
    io.stdout.write(`index:  ${indexPath} rendered; commit the ADR${superseded ? 's' : ''} and the index: git add ${s.folder} && git commit -m "ADR ${id}: ${decision}"\n`);
    const initiative = typeof value.initiative === 'string' && value.initiative ? value.initiative : null;
    if (initiative && conn) {
      await publishAfterInitiative({ io, initiative });
      if (decision === 'accepted') {
        const track = trackOf(conn, initiative);
        start = await tessOffer({ io, prompter, store, conn, registry, config, initiative, track });
      }
    }
    for (const w of writes) io.stdout.write(`${documentLine({ store, config, conn, abs: join(base, w.path), rel: w.path, bytes: w.bytes })}\n`);
  } finally {
    prompter.close();
  }
  return start ? startTess(io, start) : EXIT.OK;
}

// The initiative's track, from its PRD (the offer to start the ticket planner needs it).
function trackOf(conn, initiative) {
  try {
    const abs = conn.pathOf('prd', initiative);
    const read = readApprovedFile(conn.base, conn.base, abs);
    const t = readFrontmatter(read.bytes)?.value?.track;
    return typeof t === 'string' ? t : null;
  } catch {
    return null;
  }
}
