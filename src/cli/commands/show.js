import { lstatSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { contentHash } from '../../sign/sign.js';

import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { checkTicketArg, readApprovedFile } from '../human-move.js';
import { showData, showText } from '../../run/show.js';
import { openStore } from '../../store/home.js';
import { snapshot, trustedRegistry } from '../../trust/snapshot.js';
import { trustOverlayFiles, trustedOverlays } from '../../trust/overlays.js';
import { CUSTOM_DIR, STATE_TEXT, checklistTextOf, overlayFilesIn, overlayState, readOverlays, templateTextOf, verifyRecords } from '../../config/overlays.js';
import { branchKeys } from '../../sign/keys.js';
import { loadRegistry } from '../../config/registry.js';
import { trustedRoles } from '../../agent/scope.js';
import { readJournal } from '../../store/journal.js';
import { readFrontmatter } from '../../lint/frontmatter.js';
import { plain } from '../../status/text.js';
import { contextApproval } from './approve.js';
import { docsStoreFor } from '../../store/connectors/index.js';
import { documentRows } from '../../store/connectors/state.js';
import { documentLine } from '../../store/connectors/links.js';
import { CONTEXT_DIR, CONTEXT_KINDS, contextKindOf } from '../../lint/context.js';

// mirai show <ticket> (unit 28, decision 7; design/03 "mirai show"): the ticket's page from the
// store: its plan, build, review rounds with every blocking finding, the MR, rounds, usage and why
// it's parked. Read-only, so it's safe from your session too (/mirai show).
// mirai show <initiative> (unit 32, Scope 8; Jet's decision 8): the documents in
// <docs_root>/<initiative>/, each with its type, id, approval state and full path, so you can
// open it with one click (unit 35: an interview with its own state instead). Also read-only: no
// store write.
export default {
  name: 'show',
  summary: 'Print one ticket\'s page (plan, build, reviews, MR, rounds, usage, parking), or one initiative\'s documents',
  usage: 'mirai show <ticket> [--full | --json] | mirai show <initiative> [--docs] | mirai show context | mirai show overlays | mirai show template <type> | mirai show checklist <type>',
  positionals: { min: 1, max: 2 },
  options: {
    full: { type: 'boolean', description: 'every finding\'s text, the plan, and the parking note whole' },
    json: { type: 'boolean', description: 'the page as JSON, for scripts' },
    docs: { type: 'boolean', description: 'the initiative\'s documents, when the name is also a ticket' },
  },
  async run(args, io) {
    const [name, second] = args.positionals;
    checkTicketArg(name);
    const plainView = !args.values.full && !args.values.json && !args.values.docs;
    // Unit 37: the project's overlays, and a type's template as the approved overlays render it.
    if ((name === 'template' || name === 'checklist') && second !== undefined && plainView) return showTemplate({ io, type: second, checklist: name === 'checklist' });
    if (second !== undefined) throw new UsageError('mirai show takes one name', 'mirai show <ticket>, or mirai show template <type>, or mirai show checklist <type>');
    if (name === 'overlays' && plainView) {
      io.stdout.write(overlaysText(overlaysOf({ cwd: io.cwd, env: io.env })));
      return EXIT.OK;
    }
    // Unit 36: the context files in .mirai/context/, each with its state and full path.
    if (name === 'context' && plainView) {
      io.stdout.write(contextText(contextOf({ cwd: io.cwd, env: io.env })));
      return EXIT.OK;
    }
    if (args.values.full && args.values.json) throw new UsageError('--full and --json don\'t go together', 'pick one');
    const initiative = initiativeOf({ cwd: io.cwd, env: io.env, name });
    if (args.values.docs) {
      if (args.values.full || args.values.json) throw new UsageError('--docs doesn\'t go with --full or --json', 'run: mirai show <initiative> --docs');
      if (!initiative.exists) throw Object.assign(new UsageError(`no initiative "${name}": there is no folder ${initiative.shown}/`, `an initiative is a folder under the docs root (${initiative.docsRoot}/)`), { code: 'unknown-initiative' });
      io.stdout.write(initiativeText(initiative));
      return EXIT.OK;
    }
    const d = showData({ cwd: io.cwd, env: io.env, ticket: name });
    const known = !(d.state === null && !d.plan && !d.build);
    // Telling a ticket from an initiative (Scope 8): a folder under the docs root is an
    // initiative; when the name is both, you choose, so neither view hides the other. --full and
    // --json are a ticket's, so they already choose the ticket.
    if (known && initiative.exists && !args.values.full && !args.values.json) throw Object.assign(new UsageError(`"${name}" is both a ticket MIRAI knows and the initiative folder ${initiative.shown}/`, `choose: mirai show ${name} --docs for its documents, or mirai show ${name} --full for the ticket`), { code: 'ambiguous' });
    if (!known && initiative.exists) {
      if (args.values.full || args.values.json) throw new UsageError(`"${name}" is an initiative; --full and --json are for a ticket`, `run: mirai show ${name}`);
      io.stdout.write(initiativeText(initiative));
      return EXIT.OK;
    }
    if (!known) throw Object.assign(new UsageError(`nothing named "${name}": no ticket ${name} in MIRAI, and no initiative folder ${initiative.shown}/`, `for a ticket, approve it first: mirai approve ${name} --file <path>; for an initiative, check the name under ${initiative.docsRoot}/`), { code: 'unknown-ticket' });
    if (args.values.json) {
      const { plan, ...rest } = d;
      io.stdout.write(`${JSON.stringify({ ...rest, plan: plan ? { ...plan, text: undefined } : null }, null, 2)}\n`);
    } else io.stdout.write(showText(d, { full: Boolean(args.values.full) }));
    return EXIT.OK;
  },
};

// The initiative folder and its documents: { exists, docsRoot, shown, dir, docs: [{ file, type,
// id, track, state, path, link }] }. Unit 38: the folder is the project's store's (`[docs] store`,
// read from the trust root like the docs root): the repo's docs root, or MIRAI's store on this Mac
// for the local store. A folder that's a symbolic link isn't one (documents are real files, 07b).
// A document on a pushed branch with these bytes also gets its host link.
function initiativeOf({ cwd, env, name }) {
  const store = openStore({ cwd, env });
  const { conn, config } = docsStoreFor({ cwd, env, store });
  const shown = `${conn.docsRoot}/${name}`;
  const dir = conn.dir(name);
  let exists = false;
  try {
    exists = lstatSync(dir).isDirectory();
  } catch {
    exists = false;
  }
  let docs = [];
  if (exists) {
    const { events } = readJournal(store);
    docs = documentRows({ store, conn, initiative: name }).map((d) => {
      let bytes = null;
      try {
        bytes = readApprovedFile(conn.base, conn.base, d.rel).bytes;
      } catch {
        bytes = null;
      }
      return { ...d, line: documentLine({ store, config, conn, abs: d.path, rel: d.rel, bytes, events }) };
    });
  }
  return { exists, docsRoot: conn.docsRoot, shown: conn.kind === 'local' ? dir : shown, dir, name, docs, store: conn.name };
}

// One header line (the initiative and its track, from the PRD or the brief), then a line per
// document. Everything read from a file is shown, not acted on (plain).
function initiativeText({ name, docs, shown }) {
  const track = docs.find((d) => d.type === 'prd')?.track ?? docs.find((d) => d.type === 'brief')?.track ?? null;
  const out = [`${plain(name)}   ${track ? plain(track) : 'no track yet'}`];
  if (!docs.length) out.push(`  no documents yet in ${plain(shown)}/`);
  // An epic's type says how many tickets it holds (unit 33): "epic (7 tickets)".
  const rows = docs.map((d) => ({ ...d, type: d.tickets === undefined ? d.type : `${d.type} (${d.tickets} ticket${d.tickets === 1 ? '' : 's'})` }));
  const w = (k) => Math.max(...rows.map((d) => plain(String(d[k] ?? '—')).length));
  for (const d of rows) {
    out.push(`  ${plain(d.file).padEnd(w('file'))}   ${plain(d.type ?? '—').padEnd(w('type'))}   ${plain(d.id ?? '—').padEnd(w('id'))}   ${d.state.padEnd(22)}   ${d.line ?? plain(d.path)}`);
  }
  return `${out.join('\n')}\n`;
}

// ---- The context files (unit 36, Scope 4) --------------------------------------------------

// The five kinds of context file, as they are in .mirai/context/: [{ file, type, id, state, path }].
// business.md, journeys.md and each conventions file are approved (approved, changed since
// approval, not approved); the feature map and each project file are "checked, not approved"
// (the lint checks them against the code). A kind with no file shows as missing.
export function contextOf({ cwd, env }) {
  const store = openStore({ cwd, env });
  // Unit 38: through the store's pathOf; context files are the repo's, whatever the store.
  const dir = dirname(docsStoreFor({ cwd, env, store, check: false }).conn.pathOf('business', null));
  let names = [];
  try {
    if (lstatSync(dir).isDirectory()) names = readdirSync(dir).sort();
  } catch {
    names = [];
  }
  const files = names.map((n) => ({ name: n, kind: contextKindOf(n) })).filter((f) => f.kind);
  const rows = [];
  for (const k of CONTEXT_KINDS) {
    const mine = files.filter((f) => f.kind.type === k.type);
    if (!mine.length) {
      rows.push({ file: k.file, type: k.type, id: null, state: 'missing', path: join(dir, k.file) });
      continue;
    }
    for (const f of mine) {
      const rel = `${CONTEXT_DIR}/${f.name}`;
      let bytes = null;
      let value = {};
      try {
        bytes = readApprovedFile(store.checkout, store.checkout, rel).bytes;
        value = readFrontmatter(bytes)?.value ?? {};
      } catch {
        value = {};
      }
      let state;
      if (bytes === null) state = 'unreadable';
      else if (!k.approved) state = 'checked, not approved';
      else {
        const a = contextApproval(store, rel, bytes);
        state = a.approved ? 'approved' : a.stale ? 'changed since approval' : 'not approved';
      }
      rows.push({ file: f.name, type: k.type, id: typeof value.id === 'string' ? value.id : null, state, path: join(dir, f.name) });
    }
  }
  return { dir, rows };
}

function contextText({ dir, rows }) {
  const out = [`context   ${plain(dir)}`];
  const w = (k) => Math.max(...rows.map((r) => plain(String(r[k] ?? '—')).length));
  for (const r of rows) out.push(`  ${plain(r.file).padEnd(w('file'))}   ${plain(r.type).padEnd(w('type'))}   ${plain(r.id ?? '—').padEnd(w('id'))}   ${r.state.padEnd(22)}   ${plain(r.path)}`);
  return `${out.join('\n')}\n`;
}

// ---- Overlays (unit 37, Scope 7) -----------------------------------------------------------

// Every overlay in your work tree's .mirai/custom/, each with its kind, the name it changes, its
// state and its full path: [{ kind, name, state, path, problems, base }]. The state is the work
// tree copy's against your approvals (approved, changed since approval, not approved, rejected,
// doesn't validate), checked against MIRAI's definitions in the trust root; `base` says whether
// the integration branch has it as it is here (MIRAI reads it only from there).
export function overlaysOf({ cwd, env }) {
  const store = openStore({ cwd, env });
  let trust = null;
  let registry;
  let roles;
  try {
    trust = snapshot({ cwd, env });
    registry = trustedRegistry(trust);
    roles = trustedRoles(trust);
  } catch {
    // No trust root yet (no pushed integration branch): this checkout's framework copy.
    registry = loadRegistry(join(store.checkout, '.mirai/framework/registry'));
    roles = registry.roles;
  }
  const events = readJournal(store).events;
  const base = trust ? trustOverlayFiles(trust) : new Map();
  const baseHash = (path) => {
    const bytes = base.get(path.slice(CUSTOM_DIR.length + 1));
    return bytes ? contentHash(bytes) : null;
  };
  const files = overlayFilesIn(join(store.checkout, CUSTOM_DIR));
  const records = verifyRecords(files, { keys: branchKeys(store.checkout, store.branch, store.gitEnv), repoId: store.repoId });
  const rows = readOverlays(files, registry, { roles }).map((o) => {
    const st = overlayState(o, events, records);
    let state = st.reason ? `${STATE_TEXT[st.state]} (${st.reason})` : STATE_TEXT[st.state];
    if (o.kind === 'agent' && o.result) state += o.result.change === 'widening' ? `; widens it (${o.result.why.join(', ')})` : o.result.change === 'narrowing' ? `; narrows it (${o.result.why.join(', ')})` : '; instructions only';
    if (o.kind === 'document-type' && o.result) state += o.result.replace ? '; replacement template' : '';
    const on = baseHash(o.path);
    const where = on === null ? `not on ${store.branch} yet` : on === o.hash ? null : `${store.branch} has another version`;
    return { kind: o.kind, name: o.name, state, base: where, problems: o.problems, path: join(store.checkout, o.path) };
  });
  return { dir: join(store.checkout, CUSTOM_DIR), branch: store.branch, rows };
}

function overlaysText({ dir, rows }) {
  const out = [`overlays   ${plain(dir)}`];
  if (!rows.length) out.push('  none yet: docs/overlays.md says how to add one');
  const w = (k) => Math.max(...rows.map((r) => plain(String(r[k])).length));
  for (const r of rows) {
    const state = r.base ? `${r.state} (${r.base})` : r.state;
    out.push(`  ${plain(r.kind).padEnd(w('kind'))}   ${plain(r.name).padEnd(w('name'))}   ${plain(state)}   ${plain(r.path)}`);
    for (const p of r.problems.slice(0, 10)) out.push(`      ${plain(p)}`);
  }
  return `${out.join('\n')}\n`;
}

// mirai show template <type>: the type's template as this project uses it, from the trust root
// with the overlays you approved applied: what an agent writing that document starts from.
// mirai show checklist <type>: the type's checklist the same way (MIRAI's lines under the project's
// names, then the questions for its added sections).
function showTemplate({ io, type, checklist = false }) {
  const store = openStore({ cwd: io.cwd, env: io.env });
  const trust = snapshot({ cwd: io.cwd, env: io.env });
  const r = trustedOverlays(trust, store);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(type) || !Object.hasOwn(r.registry.documentTypes, type)) throw Object.assign(new UsageError(`there's no document type ${JSON.stringify(type.slice(0, 40))}`, `types: ${Object.keys(r.registry.documentTypes).sort().join(', ')}`), { code: 'unknown-type' });
  for (const x of r.skipped.filter((y) => y.kind === 'document-type' && y.name === type)) io.stderr.write(`${plain(x.line)}\n`);
  const def = r.registry.documentTypes[type];
  io.stdout.write(checklist ? checklistTextOf(r.registry, def) : templateTextOf(r.registry, def));
  return EXIT.OK;
}
