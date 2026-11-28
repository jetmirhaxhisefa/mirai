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
import { documentApproval, missesOf, publishAfter, readerField, readerFor, refuseOnLint, showMisses, showReader, showVerifier, startTess, tessOffer, withOverlays } from './approve.js';
import { adrDecision, adrsSigned, proposedAdrReady } from './approve-adr.js';
import { readJournal } from '../../store/journal.js';
import { answerOk, arloCalls, decisionsForYou, notesText, sittingRound } from '../../design/sitting.js';

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

export async function approveTechNote(o) {
  return approveDesignDoc({ ...o, type: 'tech-note' });
}

// Unit 62: the HLD, approved the same way (its proposed ADRs on its screen), with the reader test
// of its summary. On `full` the set's sitting (65) takes it over.
export async function approveHld(o) {
  return approveDesignDoc({ ...o, type: 'hld' });
}

// Unit 63: the LLD, approved after its HLD: the HLD approved as it is now and saying `lld: required`.
export async function approveLld(o) {
  return approveDesignDoc({ ...o, type: 'lld' });
}

const WORDS = { 'tech-note': 'technical note', hld: 'HLD', lld: 'LLD' };

// ---- The design set's sitting (unit 65, decision 3) -----------------------------------------------

// The rest of the set beside the HLD: the LLD when the HLD says required (refused when it isn't
// written yet, or doesn't pass its lint as at approval), your decisions, Arlo's calls, the round.
function designSet({ io, store, config, registry, base, file, doc, prdText, hldText }) {
  const dir = posix.dirname(file.path);
  const initiative = posix.basename(dir);
  const out = { initiative, decisions: doc ? decisionsForYou(doc) : [], calls: doc ? arloCalls(doc) : [], lld: null, round: sittingRound(readJournal(store).events, typeof doc?.value.id === 'string' ? doc.value.id : '') };
  if (doc?.value.lld !== 'required') return out;
  const path = `${dir}/lld.md`;
  let read;
  try {
    read = readApprovedFile(base, base, path);
  } catch {
    throw Object.assign(new MiraiError(`the HLD says lld: required, and ${path} isn't written yet: the design set is signed whole; nothing was written`, EXIT.BLOCKED), { code: 'set-not-whole', hint: `have it written: mirai design ${initiative}` });
  }
  const lldText = read.bytes.toString('utf8');
  const value = readFrontmatter(read.bytes)?.value ?? {};
  if (value.type !== 'lld' || typeof value.id !== 'string') throw Object.assign(new MiraiError(`${path} isn't an LLD; nothing was written`, EXIT.BLOCKED), { code: 'set-not-whole' });
  refuseOnLint(io, [{ path, errors: lintText(lldText, { source: path, registry, project: projectOf(config), approving: true, linked: { 'hld.md': hldText, 'prd.md': prdText } }) }]);
  const vera = verifierFor({ store, config, def: registry.documentTypes.lld, id: value.id, path, bytes: read.bytes });
  out.lld = { id: value.id, path, bytes: read.bytes, vera };
  return out;
}

// Your answer to each decision for you (Enter: the option it's written for), and your yes to each
// proposed ADR (no: with your reason). Returns { events, notes }: every answer as an event; the notes
// are the answers that differ and the ADRs you rejected.
async function askSitting({ io, prompter, set, proposed }) {
  const events = [];
  const notes = [];
  for (const d of set.decisions) {
    io.stdout.write(`\nDecision ${d.n}: ${plain(d.question)}\n${Object.entries(d.options).map(([k, v]) => `  ${k}: ${plain(v)}${d.recommended === k ? ' (recommended)' : ''}`).join('\n')}\n`);
    const raw = (await prompter.ask(`your answer [${Object.keys(d.options).join('/')}] (Enter: ${d.writtenFor}, what it's written for) `)).trim().toUpperCase();
    const letter = raw === '' ? d.writtenFor : raw;
    if (!answerOk(letter, d)) throw new UsageError(`${JSON.stringify(raw.slice(0, 10))} isn't one of Decision ${d.n}'s options; nothing was written`, 'run it again');
    const e = { ref: `Decision ${d.n}`, decision: 'answer', answer: letter, written_for: d.writtenFor };
    events.push(e);
    if (letter !== d.writtenFor) notes.push(e);
  }
  for (const p of proposed) {
    const yes = (await prompter.ask(`accept ${p.adr.id} (${plain(p.adr.title)}) with the set? [Y/n] `)).trim().toLowerCase();
    if (yes === '' || yes === 'y' || yes === 'yes') {
      events.push({ ref: p.adr.id, decision: 'accept' });
      continue;
    }
    const reason = (await prompter.ask(`why not ${p.adr.id} (one line, for the architect): `)).trim();
    if (!reason || reason.length > 500) throw new UsageError('a rejected ADR needs your reason, in one line; nothing was written', 'run it again');
    const e = { ref: p.adr.id, decision: 'reject', reason };
    events.push(e);
    notes.push(e);
  }
  return { events, notes };
}

// An answer that differs, or an ADR rejected: nothing is approved. Your answers are signed (the
// design_decision lines), design-notes.md is written for the architect's next run, and the set
// comes back to this sitting.
async function notesOnly({ io, prompter, store, config, conn, base, file, set, sitting, id, now }) {
  const signer = await decisionSigner(io, store, { prompter, ticket: id, confirm: confirmByTyping });
  const date = now().toISOString().slice(0, 10);
  const rel = `${posix.dirname(file.path)}/design-notes.md`;
  const text = notesText({ initiative: set.initiative, hld: id, round: set.round, notes: sitting.notes, date });
  const events = sitting.events.map((e) => checkEvent({ type: 'design_decision', by: 'human', item: set.initiative, hld: id, round: set.round, ...e }));
  const seqs = withSeq(store, (ctx) => events.map((ev) => {
    const n = ctx.take();
    ctx.event(n, ev, { signer });
    return n;
  }));
  writeFileSync(join(base, rel), text);
  io.stdout.write(`\nnothing was approved: ${sitting.notes.length} of your answers ${sitting.notes.length === 1 ? 'differs' : 'differ'} from the set as written (signed with ${signer.keyId}, seq ${seqs.join(', ')})\nyour notes: ${plain(rel)}\nnext: commit them (git add ${plain(rel)} && git commit -m "${plain(set.initiative)}: design notes"), then the architect changes the set: mirai design ${plain(set.initiative)} (/mirai design ${plain(set.initiative)}); the set comes back to this sitting\n`);
  io.stdout.write(`${documentLine({ store, config, conn, abs: join(base, rel), rel, bytes: Buffer.from(text) })}\n`);
  return EXIT.OK;
}
// The document each type builds: the link line's label and that document's type.
const UPSTREAM = { 'tech-note': { label: 'PRD', type: 'prd' }, hld: { label: 'PRD', type: 'prd' }, lld: { label: 'HLD', type: 'hld' } };

async function approveDesignDoc({ type, id, fm, file, store, io, now, fileArg, base = store.checkout, conn = null }) {
  const trust = snapshot({ cwd: io.cwd, env: io.env });
  const config = trustedConfig(trust);
  const up = UPSTREAM[type];
  const registry = withOverlays(trust, store, io, [type, 'prd', 'adr', ...(up.type === 'prd' ? [] : [up.type])]);
  const def = registry.documentTypes[type];
  const word = WORDS[type];
  const text = file.bytes.toString('utf8');
  let doc;
  try {
    doc = parseDocument(text.replace(/\r\n?/g, '\n'), file.path);
  } catch {
    doc = null;
  }

  // The document it builds (the PRD; the HLD for an LLD), approved as it is now.
  const L = up.label;
  const prdLine = doc ? linkLinesOf(doc.scan, def).find((l) => l.link.label === L) : null;
  const prdLink = prdLine?.targets[0]?.split('#')[0] ?? null;
  if (!prdLink) throw Object.assign(new MiraiError(`${file.path} doesn't link its ${L} in the line under its title; nothing was written`, EXIT.BLOCKED), { hint: `add "${L}: [<its title>](${up.type}.md)" under the # title, then approve again` });
  let prd;
  try {
    prd = readApprovedFile(base, base, posix.normalize(posix.join(posix.dirname(file.path), prdLink)));
  } catch {
    throw Object.assign(new MiraiError(`${file.path} links its ${L} ${plain(prdLink)}, which isn't a file in the repo; nothing was written`, EXIT.BLOCKED), { hint: `correct the "${L}:" line, then approve again` });
  }
  const prdValue = readFrontmatter(prd.bytes)?.value ?? {};
  const prdId = typeof prdValue.id === 'string' ? prdValue.id : null;
  if (prdValue.type !== up.type || !prdId) throw Object.assign(new MiraiError(`${prd.path}, which ${file.path} links, is not ${L === 'HLD' ? 'an' : 'a'} ${L}; nothing was written`, EXIT.BLOCKED), { hint: `link the ${L} this ${word} builds` });
  const prdState = documentApproval(store, prdId, prd.bytes);
  if (!prdState.approved) throw Object.assign(new MiraiError(`the ${L} ${prdId} isn't approved${prdState.stale ? ' as it is now' : ''}: the ${word} builds an approved ${L}; nothing was written`, EXIT.BLOCKED), { code: `${up.type}-not-approved`, hint: `approve it first: mirai approve ${prdId} --file ${prd.path}` });
  if (type === 'lld' && prdValue.lld !== 'required') throw Object.assign(new MiraiError(`the HLD ${prdId} says \`lld: ${plain(String(prdValue.lld ?? 'unset'))}\`: an LLD is approved only where its HLD says it is required; nothing was written`, EXIT.BLOCKED), { code: 'lld-not-required', hint: 'set lld: required in the HLD with the triggers that fire, approve it again, then this LLD' });
  // An LLD's test map is checked against the PRD beside it; the track is the PRD's.
  let track = typeof prdValue.track === 'string' ? prdValue.track : null;
  const extra = {};
  if (type === 'lld') {
    try {
      const p = readApprovedFile(base, base, posix.join(posix.dirname(file.path), 'prd.md'));
      extra['prd.md'] = p.bytes.toString('utf8');
      const v = readFrontmatter(p.bytes)?.value ?? {};
      if (typeof v.track === 'string') track = v.track;
    } catch {
      // no PRD beside it: the lint skips the AC coverage
    }
  }

  // The ADRs its Decisions link: read for the lint, and the proposed ones made ready for this screen.
  const s = adrSettings(config);
  const adrs = listAdrs(workTreeReader(base), s);
  const linked = { ...extra, [prdLink]: prd.bytes.toString('utf8') };
  const proposed = [];
  for (const x of doc ? decisionLinks(doc, file.path) : []) {
    const adr = adrs.find((a) => a.path === x.rel);
    if (!adr) continue; // not an ADR of the folder: the lint says so
    linked[x.link] = adr.text;
    if (adr.mirai && adr.status === 'proposed' && !proposed.some((p) => p.adr.path === adr.path)) proposed.push({ d: x.d, ...proposedAdrReady({ io, store, config, registry, base, s, adr, adrs }) });
  }
  refuseOnLint(io, [{ path: file.path, errors: lintText(text, { source: file.path, registry, project: projectOf(config), approving: true, linked, repo: base }) }]);
  const vera = verifierFor({ store, config, def, id, path: file.path, bytes: file.bytes });
  // Unit 62: the HLD's summary is reader-tested, as the PRD's is.
  const reader = readerFor({ store, config, def, value: fm?.value ?? readFrontmatter(file.bytes)?.value ?? {}, id, path: file.path, text });
  const hash = contentHash(file.bytes);
  const before = documentApproval(store, id, file.bytes);
  io.stdout.write(`${word}: ${id}${before.approved ? ' (approved before, as it is now)' : before.stale ? ' (approved before; it has changed since)' : ''}\nfile:   ${file.path}\nhash:   ${hash}\n${`${L}:`.padEnd(8)}${prdId}, approved as it is now (seq ${prdState.seq})\n`);
  showVerifier(io, vera);
  showReader(io, reader);
  for (const p of proposed) {
    io.stdout.write(`ADR ${p.adr.id} (${p.d}): ${plain(p.adr.title)}: proposed; accepting the ${word} accepts it too${p.old ? `, and marks ${p.old.id} superseded` : ''}\n`);
    showVerifier(io, p.vera);
  }
  // Unit 65 (decision 3): on `full` the HLD's approval is the design set's sitting: the LLD (when the
  // HLD says required) comes with it, checked as at its own approval; your answer to each decision for
  // you; your yes to each proposed ADR; one signature for the set.
  const set = type === 'hld' && track === 'full' ? designSet({ io, store, config, registry, base, file, doc, prdText: prd.bytes.toString('utf8'), hldText: text }) : null;
  if (set) {
    if (set.lld) {
      io.stdout.write(`LLD:    ${set.lld.id}, signed with the set\nfile:   ${set.lld.path}\n`);
      showVerifier(io, set.lld.vera);
    }
    for (const c of set.calls) io.stdout.write(`Arlo's call ${c.id}: ${plain(c.text.replace(/\s*\(Arlo's call\)\s*/, ''))}\n`);
  }
  const prompter = createPrompter(io);
  let start = null;
  try {
    let sitting = null;
    if (set) {
      sitting = await askSitting({ io, prompter, set, proposed });
      if (sitting.notes.length) return await notesOnly({ io, prompter, store, config, conn, base, file, set, sitting, id, now });
    }
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
    const approval = checkEvent({ type: 'approval', by: 'human', item: id, kind: type, path: file.path, content_hash: hash, decision, ...(reason ? { reason } : {}), answered_after_s: answeredAfter, ...readerField(reader), ...verifierField(vera) });
    // The ADRs go with an accepted note; a rejected note leaves them proposed.
    const adrMade = decision === 'rejected' ? [] : proposed.map((p) => adrDecision({ ready: p, decision: 'accepted', answeredAfter }));
    const writes = adrMade.flatMap((m) => m.writes);
    const misses = decision === 'rejected' ? missesOf([{ item: id, kind: type, path: file.path, vera }], reason) : [];
    // The set: the LLD's line, and your answers, in the same step as the HLD's and its ADRs'.
    const setEvents = set && decision !== 'rejected' ? [...(set.lld ? [checkEvent({ type: 'approval', by: 'human', item: set.lld.id, kind: 'lld', path: set.lld.path, content_hash: contentHash(set.lld.bytes), decision, answered_after_s: answeredAfter, ...verifierField(set.lld.vera) })] : [])] : [];
    const answerEvents = sitting ? sitting.events.map((e) => checkEvent({ type: 'design_decision', by: 'human', item: set.initiative, hld: id, round: set.round, ...e })) : [];
    for (const w of writes) writeFileSync(join(base, w.path), w.bytes);
    let seqs;
    try {
      seqs = withSeq(store, (ctx) => {
        const out = [];
        for (const ev of [approval, ...adrMade.map((m) => m.approval), ...setEvents]) {
          const n = ctx.take();
          ctx.event(n, ev, { signer });
          out.push(n);
        }
        for (const ev of answerEvents) ctx.event(ctx.take(), ev, { signer });
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
      ? `recorded: the ${word} ${id} rejected (signed with ${signer.keyId}, seq ${seqs[0]})${proposed.length ? `; its ADR${proposed.length === 1 ? ' stays' : 's stay'} proposed` : ''}\n`
      : `approved: the ${word} ${id}, as ${file.path} is now (${decision}; signed with ${signer.keyId}, seq ${seqs.join(', ')}); a change to it needs a new approval\n`);
    for (const [i, p] of (decision === 'rejected' ? [] : proposed).entries()) io.stdout.write(`accepted: the ADR ${p.adr.id}${p.old ? `; ${p.old.id} is now superseded by it` : ''} (seq ${seqs[i + 1]})\n`);
    if (setEvents.length) io.stdout.write(`approved: the LLD ${set.lld.id}, with the set (seq ${seqs[1 + proposed.length]})\n`);
    if (indexPath) io.stdout.write(`index:  ${indexPath} rendered; commit the ADRs and the index: git add ${s.folder} && git commit -m "ADRs of ${id}"\n`);
    if (decision !== 'rejected') {
      await publishAfter({ io, file });
      start = await tessOffer({ io, prompter, store, conn, registry, config, initiative: posix.basename(posix.dirname(file.path)), track });
    }
    for (const w of writes) io.stdout.write(`${documentLine({ store, config, conn, abs: join(base, w.path), rel: w.path, bytes: w.bytes })}\n`);
    if (setEvents.length) io.stdout.write(`${documentLine({ store, config, conn, abs: join(base, set.lld.path), rel: set.lld.path, bytes: set.lld.bytes })}\n`);
    io.stdout.write(`${documentLine({ store, config, conn, abs: join(base, file.path), rel: file.path, bytes: file.bytes })}\n`);
  } finally {
    prompter.close();
  }
  return start ? startTess(io, start) : EXIT.OK;
}
