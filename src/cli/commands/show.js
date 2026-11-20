import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { checkTicketArg, readApprovedFile } from '../human-move.js';
import { showData, showText } from '../../run/show.js';
import { openStore } from '../../store/home.js';
import { snapshot, trustedConfig } from '../../trust/snapshot.js';
import { readFrontmatter } from '../../lint/frontmatter.js';
import { plain } from '../../status/text.js';
import { briefFiles, contextApproval, documentApproval, epicApproval } from './approve.js';
import { CONTEXT_DIR, CONTEXT_KINDS, contextKindOf } from '../../lint/context.js';
import { readTicketFolder } from '../../lint/lint.js';
import { ticketsOf } from '../../lint/graph.js';

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
  usage: 'mirai show <ticket> [--full | --json] | mirai show <initiative> [--docs] | mirai show context',
  positionals: { min: 1, max: 1 },
  options: {
    full: { type: 'boolean', description: 'every finding\'s text, the plan, and the parking note whole' },
    json: { type: 'boolean', description: 'the page as JSON, for scripts' },
    docs: { type: 'boolean', description: 'the initiative\'s documents, when the name is also a ticket' },
  },
  async run(args, io) {
    const [name] = args.positionals;
    checkTicketArg(name);
    // Unit 36: the context files in .mirai/context/, each with its state and full path.
    if (name === 'context' && !args.values.full && !args.values.json && !args.values.docs) {
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
// id, track, state, path }] }. The docs root comes from the trusted config, as the lint and
// approval read it; a folder that's a symbolic link isn't one (documents are real files, 07b).
function initiativeOf({ cwd, env, name }) {
  const store = openStore({ cwd, env });
  let docsRoot = 'docs/mirai';
  try {
    docsRoot = trustedConfig(snapshot({ cwd, env })).docs?.root ?? docsRoot;
  } catch {
    // No trusted config yet: the default root.
  }
  const shown = `${docsRoot}/${name}`;
  const dir = join(store.checkout, docsRoot, name);
  let exists = false;
  try {
    exists = lstatSync(dir).isDirectory();
  } catch {
    exists = false;
  }
  const docs = [];
  if (exists) {
    for (const file of readdirSync(dir).filter((f) => /\.md$/i.test(f)).sort()) {
      const rel = `${shown}/${file}`;
      let value = {};
      let bytes = null;
      try {
        bytes = readApprovedFile(store.checkout, store.checkout, rel).bytes;
        value = readFrontmatter(bytes)?.value ?? {};
      } catch {
        value = {};
      }
      const id = typeof value.id === 'string' ? value.id : null;
      // Unit 33: an epic is approved with its tickets (tickets/ beside it, by their `epic` field),
      // so its state and its ticket count come from them.
      let tickets = null;
      if (value.type === 'epic' && id) {
        tickets = [];
        for (const t of ticketsOf(readTicketFolder(dir, { root: store.checkout }).all, id)) {
          try {
            tickets.push({ path: `${shown}/${t.path}`, ...readApprovedFile(store.checkout, store.checkout, `${shown}/${t.path}`) });
          } catch {
            // a ticket file that can't be read can't be approved: the epic shows as not approved
            tickets.push({ path: `${shown}/${t.path}`, bytes: Buffer.alloc(0) });
          }
        }
      }
      const a = !id || !bytes ? { approved: false, stale: false } : tickets ? epicApproval(store, id, bytes, tickets) : documentApproval(store, id, bytes, value.type === 'brief' ? briefFiles(store.checkout, rel, bytes) : undefined);
      // Unit 35: an interview isn't approved; its state (open, paused, confirmed) is its own.
      const interview = value.type === 'interview';
      docs.push({
        file, type: typeof value.type === 'string' ? value.type : null, id, track: typeof value.track === 'string' ? value.track : null,
        state: bytes === null ? 'unreadable' : interview ? (typeof value.state === 'string' ? value.state : 'no state') : a.approved ? 'approved' : a.stale ? 'changed since approval' : 'not approved',
        path: join(dir, file),
        ...(tickets ? { tickets: tickets.length } : {}),
      });
    }
  }
  return { exists, docsRoot, shown, dir, name, docs };
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
    out.push(`  ${plain(d.file).padEnd(w('file'))}   ${plain(d.type ?? '—').padEnd(w('type'))}   ${plain(d.id ?? '—').padEnd(w('id'))}   ${d.state.padEnd(22)}   ${plain(d.path)}`);
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
  const dir = join(store.checkout, CONTEXT_DIR);
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
