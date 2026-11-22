import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { loadRegistry } from '../../config/registry.js';
import { projectOverlays } from '../../trust/overlays.js';
import { renameHeadings } from '../../config/overlays.js';
import { topLevel } from '../../store/git.js';
import { plain, shown } from '../../status/text.js';
import { parseDocument, readTicketFolder } from '../../lint/lint.js';
import { checkIds, linkLinesOf } from '../../lint/rules.js';
import { renderEpic, renderSections, ticketSet } from '../../lint/epic.js';
import { prdItems } from '../../lint/graph.js';
import { REGISTRY_DIR } from './lint.js';
import { openStore } from '../../store/home.js';
import { baseForArg, docsStoreFor } from '../../store/connectors/index.js';

// mirai epic render <epic file> (unit 33, Jet's decision 2). Writes the epic's four generated
// sections (Tickets, Dependencies, Coverage, Design decisions) from its ticket files (every
// ticket in tickets/ beside it whose `epic` names it) and its PRD, between the markers the lint
// knows; nothing else in the file changes. It writes the repo's docs only, so it runs from your
// session too (/mirai epic render, 21f). Its last line is the epic's full path (32's link rule).

const FILE_MAX = 1024 * 1024;

export function createEpicCommand({ registryDir = REGISTRY_DIR } = {}) {
  return {
    name: 'epic',
    summary: 'Write an epic\'s generated sections (tickets, dependencies, coverage, design decisions) from its ticket files',
    usage: 'mirai epic render <epic file>',
    positionals: { min: 2, max: 2 },
    options: {},
    run(args, io) {
      const [action, file] = args.positionals;
      if (action !== 'render') throw new UsageError(`unknown action ${shown(action)}`, 'run: mirai epic render <epic file>');
      const root = topLevel(io.cwd);
      if (!root) throw new UsageError('not inside a git repo', 'run it in the repo that holds the epic');
      // Unit 38: through the project's store: an epic in the local store is read and written there.
      const docRoot = documentRoot(io, root, file);
      const epic = readInRepo(docRoot, io.cwd, file);
      const text = epic.bytes.toString('utf8');
      let doc;
      try {
        doc = parseDocument(text, epic.rel);
      } catch {
        throw new UsageError(`${shown(epic.rel)} isn't a MIRAI document: its frontmatter doesn't read`, 'run: mirai lint on it to see why');
      }
      if (doc.value.type !== 'epic') throw new UsageError(`${shown(epic.rel)} is a ${shown(String(doc.value.type))}, not an epic`, 'name the epic-<slug>.md file');
      // Unit 37: with the project's approved overlays (a renamed section reads as MIRAI's).
      const own = projectOverlays({ cwd: io.cwd, env: io.env, registry: loadRegistry(registryDir), checkout: root });
      const { registry } = own;
      for (const x of own.skipped) io.stderr.write(`${plain(x.line)}\n`);
      const def = registry.documentTypes.epic;

      // The PRD, from the "PRD:" line under the title.
      const prdLine = linkLinesOf(doc.scan, def).find((l) => l.link.type === 'prd');
      if (!prdLine) throw new UsageError(`${shown(epic.rel)} has no "PRD:" line under its title`, 'add "PRD: [<its title>](prd.md)" right under the # title, then render again');
      let prd;
      try {
        const p = readInRepo(docRoot, dirname(epic.abs), prdLine.targets[0]);
        prd = parseDocument(p.bytes.toString('utf8'), p.rel);
      } catch (err) {
        throw new UsageError(`the PRD ${shown(prdLine.targets[0])} that ${shown(epic.rel)} links can't be read${err instanceof UsageError ? `: ${err.message}` : ''}`, 'correct the "PRD:" line, then render again');
      }
      if (prd.value.type !== 'prd') throw new UsageError(`${shown(prdLine.targets[0])} is not a PRD`, 'link the PRD this epic comes from');
      const up = { doc: prd, ids: checkIds(prd, registry.documentTypes.prd, () => {}, null) };

      const set = ticketSet(doc, { readTickets: () => readTicketFolder(dirname(epic.abs), { root: docRoot }), registry });
      const sections = renderSections({ track: doc.value.track, tickets: set.tickets, items: prdItems(up) });
      // Unit 37: a renamed generated section is found, and kept, under the project's name.
      const renames = def.renames ?? {};
      const inverse = Object.fromEntries(Object.entries(renames).map(([m, p]) => [p, m]));
      const rendered = renderEpic(renameHeadings(text, inverse), sections);
      const out = { ...rendered, text: renameHeadings(rendered.text, renames), missing: rendered.missing.map((n) => renames[n] ?? n) };
      if (out.missing.length) throw new UsageError(`${shown(epic.rel)} has no ${out.missing.map((n) => `"## ${n}"`).join(', ')}`, 'add the heading where the template has it, then render again');
      const n = set.tickets.length;
      if (out.text === text) {
        io.stdout.write(`${plain(String(doc.value.id))}: already up to date with its ${n} ticket${n === 1 ? '' : 's'} and the PRD\n`);
      } else {
        writeKeepingMode(epic.abs, out.text);
        io.stdout.write(`${plain(String(doc.value.id))}: rendered Tickets, Dependencies, Coverage and Design decisions from ${n} ticket${n === 1 ? '' : 's'} and the PRD\n`);
      }
      io.stdout.write(`next: mirai lint ${plain(epic.rel)}\n${plain(epic.abs)}\n`);
      return EXIT.OK;
    },
  };
}

export default createEpicCommand();

// The folder the epic is read from: the local store's, when the project keeps its documents there
// and the file is inside it; else the repo.
function documentRoot(io, root, file) {
  try {
    const store = openStore({ cwd: io.cwd, env: io.env });
    return baseForArg(docsStoreFor({ cwd: io.cwd, env: io.env, store, trusted: false }).conn, io.cwd, file);
  } catch (err) {
    if (err.code === 'store-change') throw err;
    return root;
  }
}

// A regular file inside the repo, not a link, read once: { abs, rel, bytes }.
function readInRepo(root, from, arg) {
  const full = isAbsolute(arg) ? arg : resolve(from, arg);
  let info;
  try {
    info = lstatSync(full);
  } catch {
    throw new UsageError(`${shown(arg)} doesn't exist`, 'name the epic file, relative to here');
  }
  if (info.isSymbolicLink() || !info.isFile()) throw new UsageError(`${shown(arg)} is not a regular file`, 'name the file itself, not a link');
  const real = realpathSync(full);
  if (!real.startsWith(root + sep)) throw new UsageError(`${shown(arg)} is outside this repo`, 'render epics in the repo only');
  if (relative(root, real).split(sep)[0] === '.git') throw new UsageError(`${shown(arg)} is inside .git`, 'name a file in the work tree');
  const fd = openSync(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) throw new UsageError(`${shown(arg)} is not a regular file`, 'name the file itself');
    if (opened.size > FILE_MAX) throw new UsageError(`${shown(arg)} is larger than 1 MB`, 'an epic is one page and its tables');
    return { abs: real, rel: relative(root, real).split(sep).join('/'), bytes: readFileSync(fd) };
  } finally {
    closeSync(fd);
  }
}

// Replaces the file in one step, keeping its permissions (a docs file stays readable to the team).
function writeKeepingMode(abs, text) {
  const mode = lstatSync(abs).mode & 0o777;
  const tmp = join(dirname(abs), `.${basename(abs)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    writeFileSync(tmp, text, { flag: 'wx', mode });
    renameSync(tmp, abs);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw new MiraiError(`${abs} couldn't be written (${err.code ?? err.message})`, EXIT.FAILURE);
  }
}
