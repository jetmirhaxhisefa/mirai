import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';

import { MiraiError, UsageError } from '../../cli/errors.js';
import { EXIT } from '../../cli/exit-codes.js';
import { CONTEXT_DIR } from '../../lint/context.js';
import { readFrontmatter } from '../../lint/frontmatter.js';
import { shown } from '../../status/text.js';

// What the repo and local stores share (unit 38, Scope 2): where a document lives (pathOf), and
// reading and writing it as a regular file under the store's folder. A store is { base, docsRoot }:
// documents are under `<base>/<docsRoot>/<initiative>/`, a lone ticket under
// `<base>/<docsRoot>/tickets/`. Approval lines name a document by its path relative to `base`, so
// for the repo store that's the repo path they always had (docs/mirai/<initiative>/prd.md).

export const INITIATIVE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.md$/;
const CONTEXT_TYPES = new Set(['business', 'journeys', 'feature-map', 'project', 'conventions']);
const DOC_MAX = 1024 * 1024;

export function checkInitiative(name) {
  if (typeof name !== 'string' || !INITIATIVE.test(name) || name === 'tickets') throw Object.assign(new UsageError(`${shown(String(name))} isn't an initiative's name`, 'an initiative is a folder under the docs root, named like due-dates'), { code: 'bad-initiative' });
}

// The file name a type has when none is given: a brief is brief.md, and so on (unit 31–35's
// layout). An epic and a ticket are named by the caller.
function defaultName(type, initiative) {
  if (type === 'brief' || type === 'prd' || type === 'interview') return `${type}.md`;
  if (type === 'epic') return `epic-${initiative}.md`;
  return null;
}

// pathOf(type, initiative, name): the one path of a document, absolute. Context files (unit 36)
// are the repo's, in .mirai/context/, whatever the store.
export function pathOfIn({ base, docsRoot, checkout }, type, initiative, name) {
  if (CONTEXT_TYPES.has(type)) {
    const file = name ?? `${type}.md`;
    if (!FILE.test(file)) throw new UsageError(`${shown(file)} isn't a context file's name`);
    return join(checkout, CONTEXT_DIR, file);
  }
  const file = name ?? defaultName(type, initiative);
  if (!file || !FILE.test(file)) throw new UsageError(`${shown(String(file))} isn't a document's file name`, 'a name like prd.md or SAMPLE-12.md');
  const ticket = type === 'story' || type === 'bug';
  if (initiative === null || initiative === undefined) {
    if (!ticket) throw new UsageError(`a ${type} belongs to an initiative`, 'name the initiative');
    return join(base, docsRoot, 'tickets', file);
  }
  checkInitiative(initiative);
  return join(base, docsRoot, initiative, ...(ticket ? ['tickets'] : []), file);
}

// A path relative to the store's base, with / between parts, or null when it isn't inside it.
export function relIn(base, abs) {
  const rel = relative(base, abs);
  if (!rel || rel.startsWith('..') || rel.startsWith(sep)) return null;
  return rel.split(sep).join('/');
}

// A regular file under `base`, read once (no link, at most 1 MB): its bytes.
export function readUnder(base, abs) {
  let info;
  try {
    info = lstatSync(abs);
  } catch {
    throw Object.assign(new UsageError(`${shown(abs)} doesn't exist`), { code: 'not-found' });
  }
  if (info.isSymbolicLink() || !info.isFile()) throw new UsageError(`${shown(abs)} is not a regular file`, 'documents are real files, not links');
  const real = realpathSync(abs);
  if (!real.startsWith(realpathSync(base) + sep)) throw new UsageError(`${shown(abs)} is outside the store's folder`);
  const fd = openSync(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > DOC_MAX) throw new UsageError(`${shown(abs)} is not a regular file of at most 1 MB`);
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

// Writes a document in one step (a temp file, then a rename), its folders made on the way with
// `mode` (0o755 in the repo, 0o700 in MIRAI's store). A link on the way is refused.
export function writeUnder(base, abs, bytes, { dirMode = 0o755, fileMode = 0o644 } = {}) {
  if (!relIn(base, abs)) throw new UsageError(`${shown(abs)} is outside the store's folder`);
  mkdirSync(dirname(abs), { recursive: true, mode: dirMode });
  const realDir = realpathSync(dirname(abs));
  if (!realDir.startsWith(realpathSync(base))) throw new MiraiError(`${shown(abs)}: a folder on the way leads outside the store`, EXIT.BLOCKED);
  try {
    if (lstatSync(abs).isSymbolicLink()) throw new MiraiError(`${shown(abs)} is a symbolic link; nothing was written`, EXIT.BLOCKED);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const tmp = join(dirname(abs), `.${abs.split(sep).at(-1)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    writeFileSync(tmp, bytes, { flag: 'wx', mode: fileMode });
    renameSync(tmp, abs);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  return abs;
}

// The Markdown files of an initiative's folder (its tickets/ too), as [{ abs, rel, file }], sorted.
// Links and other entries are left out (the lint reports them).
export function filesOf(dir, base) {
  const out = [];
  const walk = (d, prefix) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.isDirectory() && prefix === '' && e.name === 'tickets') walk(join(d, e.name), 'tickets/');
      else if (e.isFile() && /\.md$/i.test(e.name)) out.push({ abs: join(d, e.name), rel: relIn(base, join(d, e.name)), file: `${prefix}${e.name}` });
    }
  };
  walk(dir, '');
  return out;
}

// A document's frontmatter fields, or {} when it has none that reads.
export function fieldsOf(bytes) {
  try {
    return readFrontmatter(bytes)?.value ?? {};
  } catch {
    return {};
  }
}
