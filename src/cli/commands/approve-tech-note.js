import { writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { confirmByTyping, readApprovedFile } from '../human-move.js';
import { createPrompter } from '../tty.js';
import { adrSettings, listAdrs, workTreeReader } from '../../adr/adr.js';
import { readFrontmatter } from '../../lint/frontmatter.js';
import { lintText, parseDocument, projectOf } from '../../lint/lint.js';
import { linkLinesOf } from '../../lint/rules.js';
import { checkEvent, withSeq } from '../../store/journal.js';
import { contentHash } from '../../sign/sign.js';
import { decisionSigner } from '../../sign/signer.js';
import { plain } from '../../status/text.js';
import { documentLine } from '../../store/connectors/links.js';
import { snapshot, trustedConfig } from '../../trust/snapshot.js';
import { verifierField, verifierFor } from '../../verify/gate.js';
import { documentApproval, missesOf, publishAfter, refuseOnLint, showMisses, showVerifier, startTess, tessOffer, withOverlays } from './approve.js';
import { adrDecision, adrsSigned, proposedAdrReady } from './approve-adr.js';

// mirai approve <id> --file docs/mirai/<initiative>/tech-note.md (unit 62b, Scope 4; decision 2):
// the technical note, after the PRD and before the ticket set. The lint as at approval (the PRD it
// builds linked, the ADRs its Decisions link read, its cited paths checked in the repo), the PRD
// approved as it is now, Vera's result; then you: accepted as is, edited or rejected. 61's re-check:
// the ADRs its D-n lines link that are still proposed are signed on this screen, one line each
// (MIRAI writes their status, marks any they supersede), when you accept the note. Then 44's
// publish, and 45's offer to start the ticket planner (the note completes standard's list).

const DECISIONS = { a: 'accepted', e: 'edited', r: 'rejected' };

// The D-n lines' links to files: [{ d, link, rel }], `rel` the repo path.
export function decisionLinks(doc, path) {
  const h = doc.scan.headings.find((x) => x.level === 2 && x.text === 'Decisions');
  if (!h) return [];
  const next = doc.scan.headings.find((x) => x.line > h.line && x.level <= 2);
  const out = [];
  for (const l of doc.scan.lines) {
    if (l.line <= h.line || (next && l.line >= next.line) || l.kind !== 'text') continue;
    const m = /^ {0,3}[-*+][ \t]+(?:\*\*)?(D-[0-9]+)(?:\*\*)?:(.*)$/.exec(l.visible ?? l.text);
    if (!m) continue;
    for (const x of m[2].matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(x[1])) continue;
      out.push({ d: m[1], link: x[1], rel: posix.normalize(posix.join(posix.dirname(path), x[1])) });
    }
  }
  return out;
}

export async function approveTechNote({ id, fm, file, store, io, now, fileArg, base = store.checkout, conn = null }) {
  const trust = snapshot({ cwd: io.cwd, env: io.env });
  const config = trustedConfig(trust);
  const registry = withOverlays(trust, store, io, ['tech-note', 'prd', 'adr']);
  const def = registry.documentTypes['tech-note'];
  const text = file.bytes.toString('utf8');
  let doc;
  try {
    doc = parseDocument(text.replace(/\r\n?/g, '\n'), file.path);
  } catch {
    doc = null;
  }

  // The PRD it builds, approved as it is now.
  const prdLine = doc ? linkLinesOf(doc.scan, def).find((l) => l.link.label === 'PRD') : null;
  const prdLink = prdLine?.targets[0]?.split('#')[0] ?? null;
  if (!prdLink) throw Object.assign(new MiraiError(`${file.path} doesn't link its PRD in the line under its title; nothing was written`, EXIT.BLOCKED), { hint: 'add "PRD: [<its title>](prd.md)" under the # title, then approve again' });
  let prd;
  try {
    prd = readApprovedFile(base, base, posix.normalize(posix.join(posix.dirname(file.path), prdLink)));
  } catch {
    throw Object.assign(new MiraiError(`${file.path} links its PRD ${plain(prdLink)}, which isn't a file in the repo; nothing was written`, EXIT.BLOCKED), { hint: 'correct the "PRD:" line, then approve again' });
  }
  const prdValue = readFrontmatter(prd.bytes)?.value ?? {};
  const prdId = typeof prdValue.id === 'string' ? prdValue.id : null;
  if (prdValue.type !== 'prd' || !prdId) throw Object.assign(new MiraiError(`${prd.path}, which ${file.path} links, is not a PRD; nothing was written`, EXIT.BLOCKED), { hint: 'link the PRD this note builds' });
  const prdState = documentApproval(store, prdId, prd.bytes);
  if (!prdState.approved) throw Object.assign(new MiraiError(`the PRD ${prdId} isn't approved${prdState.stale ? ' as it is now' : ''}: the technical note builds an approved PRD; nothing was written`, EXIT.BLOCKED), { code: 'prd-not-approved', hint: `approve it first: mirai approve ${prdId} --file ${prd.path}` });

  // The ADRs its Decisions link: read for the lint, and the proposed ones made ready for this screen.
  const s = adrSettings(config);
  const adrs = listAdrs(workTreeReader(base), s);
  const linked = { [prdLink]: prd.bytes.toString('utf8') };
  const proposed = [];
  for (const x of doc ? decisionLinks(doc, file.path) : []) {
    const adr = adrs.find((a) => a.path === x.rel);
    if (!adr) continue; // not an ADR of the folder: the lint says so
    linked[x.link] = adr.text;
    if (adr.mirai && adr.status === 'proposed' && !proposed.some((p) => p.adr.path === adr.path)) proposed.push({ d: x.d, ...proposedAdrReady({ io, store, config, registry, base, s, adr, adrs }) });
  }
  refuseOnLint(io, [{ path: file.path, errors: lintText(text, { source: file.path, registry, project: projectOf(config), approving: true, linked, repo: base }) }]);
  const vera = verifierFor({ store, config, def, id, path: file.path, bytes: file.bytes });
  const hash = contentHash(file.bytes);
  const before = documentApproval(store, id, file.bytes);
  io.stdout.write(`technical note: ${id}${before.approved ? ' (approved before, as it is now)' : before.stale ? ' (approved before; it has changed since)' : ''}\nfile:   ${file.path}\nhash:   ${hash}\nPRD:    ${prdId}, approved as it is now (seq ${prdState.seq})\n`);
  showVerifier(io, vera);
  for (const p of proposed) {
    io.stdout.write(`ADR ${p.adr.id} (${p.d}): ${plain(p.adr.title)}: proposed; accepting the note accepts it too${p.old ? `, and marks ${p.old.id} superseded` : ''}\n`);
    showVerifier(io, p.vera);
  }
  const prompter = createPrompter(io);
  let start = null;
  try {
    const asked = now().getTime();
    const answer = (await prompter.ask(`accepted as is / edited / rejected?${proposed.length ? ` (with ${proposed.length === 1 ? 'its ADR' : `its ${proposed.length} ADRs`})` : ''} [a/e/r] `)).toLowerCase();
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
    if (contentHash(readApprovedFile(base, io.cwd, fileArg).bytes) !== hash) throw new MiraiError(`${file.path} changed while you were answering; nothing was written`, EXIT.FAILURE);
    for (const p of proposed) {
      for (const f of [p.adr, ...(p.old ? [p.old] : [])]) {
        if (contentHash(readApprovedFile(base, base, f.path).bytes) !== contentHash(f.bytes)) throw new MiraiError(`${f.path} changed while you were answering; nothing was written`, EXIT.FAILURE);
      }
    }
    const approval = checkEvent({ type: 'approval', by: 'human', item: id, kind: 'tech-note', path: file.path, content_hash: hash, decision, ...(reason ? { reason } : {}), answered_after_s: answeredAfter, ...verifierField(vera) });
    // The ADRs go with an accepted note; a rejected note leaves them proposed.
    const adrMade = decision === 'rejected' ? [] : proposed.map((p) => adrDecision({ ready: p, decision: 'accepted', answeredAfter }));
    const writes = adrMade.flatMap((m) => m.writes);
    const misses = decision === 'rejected' ? missesOf([{ item: id, kind: 'tech-note', path: file.path, vera }], reason) : [];
    for (const w of writes) writeFileSync(join(base, w.path), w.bytes);
    let seqs;
    try {
      seqs = withSeq(store, (ctx) => {
        const out = [];
        for (const ev of [approval, ...adrMade.map((m) => m.approval)]) {
          const n = ctx.take();
          ctx.event(n, ev, { signer });
          out.push(n);
        }
        for (const m of misses) ctx.event(ctx.take(), m);
        return out;
      });
    } catch (err) {
      for (const w of writes) writeFileSync(join(base, w.path), w.was);
      throw err;
    }
    const indexPath = writes.length ? adrsSigned({ store, base, s, writes }) : null;
    showMisses(io, misses);
    io.stdout.write(decision === 'rejected'
      ? `recorded: the technical note ${id} rejected (signed with ${signer.keyId}, seq ${seqs[0]})${proposed.length ? `; its ADR${proposed.length === 1 ? ' stays' : 's stay'} proposed` : ''}\n`
      : `approved: the technical note ${id}, as ${file.path} is now (${decision}; signed with ${signer.keyId}, seq ${seqs.join(', ')}); a change to it needs a new approval\n`);
    for (const [i, p] of (decision === 'rejected' ? [] : proposed).entries()) io.stdout.write(`accepted: the ADR ${p.adr.id}${p.old ? `; ${p.old.id} is now superseded by it` : ''} (seq ${seqs[i + 1]})\n`);
    if (indexPath) io.stdout.write(`index:  ${indexPath} rendered; commit the ADRs and the index: git add ${s.folder} && git commit -m "ADRs of ${id}"\n`);
    if (decision !== 'rejected') {
      await publishAfter({ io, file });
      start = await tessOffer({ io, prompter, store, conn, registry, config, initiative: posix.basename(posix.dirname(file.path)), track: typeof prdValue.track === 'string' ? prdValue.track : null });
    }
    for (const w of writes) io.stdout.write(`${documentLine({ store, config, conn, abs: join(base, w.path), rel: w.path, bytes: w.bytes })}\n`);
    io.stdout.write(`${documentLine({ store, config, conn, abs: join(base, file.path), rel: file.path, bytes: file.bytes })}\n`);
  } finally {
    prompter.close();
  }
  return start ? startTess(io, start) : EXIT.OK;
}
