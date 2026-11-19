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
import { documentApproval } from './approve.js';

// mirai show <ticket> (unit 28, decision 7; design/03 "mirai show"): the ticket's page from the
// store: its plan, build, review rounds with every blocking finding, the MR, rounds, usage and why
// it's parked. Read-only, so it's safe from your session too (/mirai show).
// mirai show <initiative> (unit 32, Scope 8; Jet's decision 8): the documents in
// <docs_root>/<initiative>/, each with its type, id, approval state and full path, so you can
// open it with one click. Also read-only: no store write.
export default {
  name: 'show',
  summary: 'Print one ticket\'s page (plan, build, reviews, MR, rounds, usage, parking), or one initiative\'s documents',
  usage: 'mirai show <ticket> [--full | --json] | mirai show <initiative> [--docs]',
  positionals: { min: 1, max: 1 },
  options: {
    full: { type: 'boolean', description: 'every finding\'s text, the plan, and the parking note whole' },
    json: { type: 'boolean', description: 'the page as JSON, for scripts' },
    docs: { type: 'boolean', description: 'the initiative\'s documents, when the name is also a ticket' },
  },
  async run(args, io) {
    const [name] = args.positionals;
    checkTicketArg(name);
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
      const a = id && bytes ? documentApproval(store, id, bytes) : { approved: false, stale: false };
      docs.push({
        file, type: typeof value.type === 'string' ? value.type : null, id, track: typeof value.track === 'string' ? value.track : null,
        state: bytes === null ? 'unreadable' : a.approved ? 'approved' : a.stale ? 'changed since approval' : 'not approved',
        path: join(dir, file),
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
  const w = (k) => Math.max(...docs.map((d) => plain(String(d[k] ?? '—')).length));
  for (const d of docs) {
    out.push(`  ${plain(d.file).padEnd(w('file'))}   ${plain(d.type ?? '—').padEnd(w('type'))}   ${plain(d.id ?? '—').padEnd(w('id'))}   ${d.state.padEnd(22)}   ${plain(d.path)}`);
  }
  return `${out.join('\n')}\n`;
}
