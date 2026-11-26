import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { confirmByTyping } from '../human-move.js';
import { createPrompter, requireTty } from '../tty.js';
import { adrSettings, adrState, indexPathOf, keepSignedCopy, listAdrs, nextAdr, renderIndex, signedCopyOf, slugOk, withFields, workTreeReader, OTHER_INDEX } from '../../adr/adr.js';
import { readFrontmatter } from '../../lint/frontmatter.js';
import { scanMarkdown } from '../../lint/markdown.js';
import { checkEvent, readJournal, withSeq } from '../../store/journal.js';
import { contentHash } from '../../sign/sign.js';
import { decisionSigner } from '../../sign/signer.js';
import { plain, shown } from '../../status/text.js';
import { openStore } from '../../store/home.js';
import { checkInitiative } from '../../store/connectors/common.js';
import { effectiveRegistry } from '../../trust/overlays.js';
import { snapshot, trustedConfig } from '../../trust/snapshot.js';

// mirai adr | mirai adr index | mirai adr new <slug> [--initiative <name>] [--supersedes <id>] |
// mirai adr review [<id>] [--list] (unit 61, Scopes 5, 6 and 8).
// - the list: every ADR of the project's ADR folder, with its status and whether it is as you
//   signed it;
// - `index`: renders the index (README.md) from the ADRs beside it; the lint fails while it
//   doesn't match, and every ADR approval renders it too;
// - `new`: the next number and the template, filled with what MIRAI knows (the id, the date, the
//   initiative and its PRD link, what it supersedes), status proposed;
// - `review`: the accepted ADRs with their Revisit triggers; for each, still true or deprecated
//   (with your reason, written into the file), signed (`adr_review`). The release record (60, 67)
//   calls it. In a real terminal only; `--list` (and the session's /mirai adr review) shows them.

const VERDICTS = { k: 'still-true', d: 'deprecated', s: null };

function setup(io) {
  const store = openStore({ cwd: io.cwd, env: io.env });
  const trust = snapshot({ cwd: io.cwd, env: io.env });
  const config = trustedConfig(trust);
  const s = adrSettings(config);
  return { store, trust, config, s, root: store.checkout, reader: workTreeReader(store.checkout) };
}

function list(io, json) {
  const { store, s, reader } = setup(io);
  const adrs = listAdrs(reader, s);
  const { events } = readJournal(store);
  const copies = signedCopyOf(store);
  const rows = adrs.map((a) => ({ id: a.id, title: a.title, status: a.status, date: a.date, initiative: a.initiative, superseded_by: a.superseded_by, path: a.path, mirai: a.mirai, signed: a.mirai ? adrState({ events, path: a.path, bytes: a.bytes, approvedTextOf: copies }).state : 'the project\'s own' }));
  if (json) {
    io.stdout.write(`${JSON.stringify({ folder: s.folder, numbering: s.numbering, adrs: rows }, null, 2)}\n`);
    return EXIT.OK;
  }
  io.stdout.write(`ADRs in ${s.folder}/ (numbered like ${s.numbering}): ${rows.length}\n`);
  for (const r of rows) io.stdout.write(`${r.id.padEnd(10)} ${r.status.padEnd(11)} ${plain(r.title).slice(0, 70)}${r.superseded_by ? ` (superseded by ${plain(r.superseded_by)})` : ''}${r.mirai && r.signed !== 'signed' && r.status !== 'proposed' ? ` [${r.signed === 'typo-fix' ? 'typo fix since your signature' : r.signed === 'unsigned' ? 'no signed line of yours' : 'changed since your signature'}]` : ''}\n`);
  if (!rows.length) io.stdout.write(`none yet: mirai adr new <slug> --initiative <name> writes the first one\n`);
  return EXIT.OK;
}

function index(io) {
  const { s, root, reader } = setup(io);
  const text = renderIndex(listAdrs(reader, s));
  const rel = indexPathOf(reader, s);
  const path = join(root, rel);
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (before === text) {
    io.stdout.write(`${rel} is up to date\n`);
    return EXIT.OK;
  }
  mkdirSync(join(root, s.folder), { recursive: true });
  writeFileSync(path, text);
  io.stdout.write(`${before === null ? 'wrote' : 'rendered again'}: ${rel}; commit it with the ADRs${rel.endsWith(OTHER_INDEX) ? ` (the folder's README.md is your own, so MIRAI leaves it as it is)` : ''}\n`);
  return EXIT.OK;
}

function create(io, slug, { initiative = null, supersedes = null }) {
  if (!slugOk(slug)) throw new UsageError(`${shown(slug)} isn't a slug`, 'lower-case letters, digits and dashes, such as reminder-queue');
  if (initiative !== null) checkInitiative(initiative);
  const { store, trust, config, s, root, reader } = setup(io);
  const adrs = listAdrs(reader, s);
  const next = nextAdr(adrs, s, slug);
  if (supersedes !== null) {
    const old = adrs.find((a) => a.id.toLowerCase() === supersedes.toLowerCase());
    if (!old) throw new UsageError(`there is no ADR ${shown(supersedes)} in ${s.folder}/`, 'mirai adr lists them');
    if (old.status !== 'accepted') throw new MiraiError(`${old.id} is ${old.status}: only an accepted ADR is superseded`, EXIT.BLOCKED);
  }
  const registry = effectiveRegistry(trust, store);
  const def = registry.documentTypes.adr;
  let text = typeof def.template_text === 'string' ? def.template_text : readFileSync(join(registry.dir, def.template), 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  const docsRoot = config.docs?.root ?? 'docs/mirai';
  let prdId = null;
  let prdTitle = null;
  if (initiative) {
    try {
      const fm = readFrontmatter(readFileSync(join(root, docsRoot, initiative, 'prd.md')));
      prdId = typeof fm?.value?.id === 'string' ? fm.value.id : null;
      prdTitle = scanMarkdown(fm?.body ?? '').headings.find((h) => h.level === 1)?.text ?? null;
    } catch {
      prdId = null;
    }
  }
  text = withFields(text, { id: next.id, date: today, created: today, initiative: initiative ?? null, upstream: null, supersedes: supersedes ?? null });
  // `upstream` is a list: written as one.
  if (prdId) text = text.replace(/^(status: proposed\n)/m, `$1upstream: [${prdId}]\n`);
  const prdRel = posix.relative(s.folder, `${docsRoot}/${initiative ?? 'initiative'}/prd.md`);
  text = initiative
    ? text.replace('PRD: [The PRD\'s title](../mirai/initiative/prd.md)', `PRD: [${prdTitle ?? 'The PRD'}](${prdRel})`).replace('(../mirai/initiative/hld.md)', `(${posix.relative(s.folder, `${docsRoot}/${initiative}/hld.md`)})`)
    : text.replace(/<!-- done when: the PRD of the initiative[^\n]*\n(?:PRD: [^\n]*\n\n)?/, '');
  if (supersedes) text = text.replace('- [The design section it records]', `- Supersedes [${supersedes}](${adrs.find((a) => a.id.toLowerCase() === supersedes.toLowerCase()).name})\n- [The design section it records]`);
  mkdirSync(join(root, s.folder), { recursive: true });
  const abs = join(root, next.path);
  try {
    writeFileSync(abs, text, { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') throw new MiraiError(`${next.path} exists already`, EXIT.BLOCKED);
    throw err;
  }
  io.stdout.write(`wrote: ${next.path} (${next.id}, proposed)${initiative ? `, for the initiative ${initiative}` : ''}${supersedes ? `, superseding ${supersedes}` : ''}\n`);
  io.stdout.write(`write it (or in your session, with the mirai-write skill), then: mirai lint ${next.path}; mirai verify ${next.path}; mirai approve ${next.id} --file ${next.path}\n`);
  return EXIT.OK;
}

// The ADRs in force: accepted ones, with their Revisit triggers.
function inForce(adrs, id) {
  const all = adrs.filter((a) => a.status === 'accepted');
  if (id === undefined) return all;
  const one = adrs.find((a) => a.id.toLowerCase() === id.toLowerCase());
  if (!one) throw new UsageError(`there is no ADR ${shown(id)}`, 'mirai adr lists them');
  if (one.status !== 'accepted') throw new MiraiError(`${one.id} is ${one.status}: only an accepted ADR is reviewed`, EXIT.BLOCKED);
  return [one];
}
export function revisitOf(adr) {
  const m = /^## +Revisit when[ \t]*\n([^]*?)(?=^## |(?![^]))/m.exec(adr.text);
  return m ? m[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('<!--')).map((l) => l.replace(/^[-*+][ \t]+/, '')) : [];
}

async function review(io, id, listOnly) {
  const { store, s, root, reader } = setup(io);
  const adrs = inForce(listAdrs(reader, s), id);
  if (!adrs.length) {
    io.stdout.write('no accepted ADR to review\n');
    return EXIT.OK;
  }
  io.stdout.write(`the ADRs in force (${adrs.length}), with what would reopen each:\n`);
  for (const a of adrs) {
    io.stdout.write(`\n${a.id}: ${plain(a.title)} (${a.date ?? 'no date'})\n`);
    const triggers = revisitOf(a);
    io.stdout.write(triggers.length ? triggers.map((t) => `  revisit when: ${plain(t)}`).join('\n') + '\n' : '  revisit when: (none named)\n');
  }
  if (listOnly) {
    io.stdout.write('\nto mark each still true or deprecated, signed, in your terminal: mirai adr review\n');
    return EXIT.OK;
  }
  requireTty(io, 'mirai adr review');
  const { events } = readJournal(store);
  const copies = signedCopyOf(store);
  const prompter = createPrompter(io);
  try {
    const answers = [];
    for (const a of adrs) {
      const st = adrState({ events, path: a.path, bytes: a.bytes, approvedTextOf: copies });
      if (a.mirai && st.state === 'changed') io.stdout.write(`${a.id} has changed since your signature (${plain(st.why ?? '')}): restore it, or supersede it\n`);
      const answer = (await prompter.ask(`${a.id}: still true / deprecated / skip? [k/d/s] `)).toLowerCase();
      if (!Object.hasOwn(VERDICTS, answer)) throw new UsageError(`${JSON.stringify(answer.slice(0, 10))} is not k, d or s; nothing was written`, 'run it again');
      const verdict = VERDICTS[answer];
      if (!verdict) continue;
      let reason;
      if (verdict === 'deprecated') {
        reason = (await prompter.ask('reason (one line; it stays in the ADR): ')).trim();
        if (!reason) throw new UsageError('a deprecated ADR keeps your reason; nothing was written', 'run it again');
        if (reason.length > 500) throw new UsageError('the reason is longer than 500 characters; nothing was written', 'keep it to one line');
        if (!a.mirai) throw new MiraiError(`${a.id} is one of the project's own ADRs: MIRAI never rewrites those; mark it deprecated in its own format`, EXIT.BLOCKED);
      }
      answers.push({ a, verdict, reason });
    }
    if (!answers.length) {
      io.stdout.write('nothing marked; nothing was written\n');
      return EXIT.OK;
    }
    const signer = await decisionSigner(io, store, { prompter, ticket: answers[0].a.id, confirm: confirmByTyping });
    const writes = [];
    const lines = [];
    for (const { a, verdict, reason } of answers) {
      const now = reader.read(a.path);
      if (!now || contentHash(now) !== contentHash(a.bytes)) throw new MiraiError(`${a.path} changed while you were answering; nothing was written`, EXIT.FAILURE);
      const bytes = verdict === 'deprecated' ? Buffer.from(withFields(a.text, { status: 'deprecated', status_reason: reason })) : a.bytes;
      if (verdict === 'deprecated') writes.push({ path: a.path, bytes, was: a.bytes });
      lines.push(checkEvent({ type: 'adr_review', by: 'human', item: a.id, path: a.path, content_hash: contentHash(bytes), verdict, ...(reason ? { reason } : {}) }));
    }
    for (const w of writes) writeFileSync(join(root, w.path), w.bytes);
    let seqs;
    try {
      seqs = withSeq(store, (ctx) => lines.map((ev) => {
        const n = ctx.take();
        ctx.event(n, ev, { signer });
        return n;
      }));
    } catch (err) {
      for (const w of writes) writeFileSync(join(root, w.path), w.was);
      throw err;
    }
    for (const { a } of answers) keepSignedCopy(store, reader.read(a.path) ?? a.bytes);
    if (writes.length) writeFileSync(join(root, indexPathOf(reader, s)), renderIndex(listAdrs(workTreeReader(root), s)));
    for (const [i, { a, verdict }] of answers.entries()) io.stdout.write(`${verdict === 'deprecated' ? 'deprecated' : 'still true'}: ${a.id} (signed with ${signer.keyId}, seq ${seqs[i]})\n`);
    if (writes.length) io.stdout.write(`commit the ADR${writes.length === 1 ? '' : 's'} and the index: git add ${s.folder} && git commit -m "ADR review"\n`);
    return EXIT.OK;
  } finally {
    prompter.close();
  }
}

export default {
  name: 'adr',
  summary: 'List the architecture decision records, render their index, write a new one, or review the accepted ones',
  usage: 'mirai adr [--json] | mirai adr index | mirai adr new <slug> [--initiative <name>] [--supersedes <id>] | mirai adr review [<id>] [--list]',
  positionals: { min: 0, max: 2 },
  options: {
    json: { type: 'boolean', description: 'the list as JSON' },
    initiative: { type: 'string', description: 'with new: the initiative the decision comes from (its PRD is linked)' },
    supersedes: { type: 'string', description: 'with new: the accepted ADR this one replaces' },
    list: { type: 'boolean', description: 'with review: show the ADRs in force and their triggers, change nothing' },
  },
  async run(args, io) {
    const [action, arg] = args.positionals;
    if (action === undefined || action === 'list') return list(io, Boolean(args.values.json));
    if (action === 'index') return index(io);
    if (action === 'new') {
      if (arg === undefined) throw new UsageError('new takes a slug', 'mirai adr new reminder-queue --initiative due-dates');
      return create(io, arg, { initiative: args.values.initiative ?? null, supersedes: args.values.supersedes ?? null });
    }
    if (action === 'review') return review(io, arg, Boolean(args.values.list));
    throw new UsageError(`unknown action ${shown(action)}`, 'mirai adr, mirai adr index, mirai adr new <slug>, or mirai adr review');
  },
};
