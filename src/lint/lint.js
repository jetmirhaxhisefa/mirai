import { openSync, fstatSync, readFileSync, readdirSync, lstatSync, realpathSync, closeSync, constants } from 'node:fs';
import { join, relative, resolve, dirname, sep, isAbsolute } from 'node:path';

import { ConfigError } from '../cli/errors.js';
import { closest } from '../util/closest.js';
import { readFrontmatter } from './frontmatter.js';
import { scanMarkdown, headingSlugs, fixedParts } from './markdown.js';
import { aliased, checkDocument } from './rules.js';
import { frameworkDefaults } from '../config/defaults.js';
import { isContextFile } from './context.js';
import { repoReader } from './repo.js';
import { ticketDefOf } from '../tickets/types.js';
import { adrSettings, indexProblem, listAdrs, workTreeReader } from '../adr/adr.js';

// Linting files (unit 07b).
// - Inside the docs root (`[docs] root`, default docs/mirai) every Markdown file is a MIRAI
//   document, so a missing or broken frontmatter, an unknown type, a symbolic link or anything
//   that isn't a regular file is a problem: an agent can't escape the lint by breaking its own
//   frontmatter, renaming the extension's case or linking a file in.
// - Outside it, a file is linted only when its frontmatter names a known type and carries
//   `template:` (MIRAI's marker), so a blog page with `type: story` is left alone. A broken
//   frontmatter there is a warning only when a `type:` line names a known type.
// "Inside" is decided on the path's place in the repo, case-insensitively, with symbolic
// links on the way resolved one by one, so neither a link nor letter case moves a file out.

export const LIMITS = Object.freeze({ fileBytes: 1024 * 1024 });
const MARKDOWN = /\.(?:md|markdown)$/i;
const SKIP_FOLDERS = new Set(['.git', 'node_modules', '.mirai']);

export class LintPathError extends Error {}

// Lints inside `root`. `paths` are absolute paths (files or folders); with none, `files` (the
// repo's file list from git, relative) is used. Returns { files, skipped, problems }, the
// problems sorted by file, line and column. Throws a LintPathError for a path outside the
// repo or one that doesn't exist.
// `project` holds what the built-in checks need from the project config: `repos` (the repo
// names, unit 08a) and `levels` (the test level names, unit 08b). Missing, it's the defaults,
// never "skip the check".
export function lintPaths({ root, paths = [], files = null, registry, docsRoot, project = projectDefaults() }) {
  const realRoot = realpathSync.native(root);
  const ctx = { root: realRoot, registry, docsRoot: docsRoot.toLowerCase(), project, headings: new Map(), templates: new Map() };
  const result = { files: 0, skipped: 0, problems: [] };
  const seen = new Set();
  const visit = (rel, kind) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const r = kind === 'link' ? linkProblem(rel, ctx) : lintFile(rel, ctx);
    if (r.linted) result.files += 1;
    else if (r.counted !== false) result.skipped += 1;
    result.problems.push(...r.problems);
  };

  if (paths.length === 0) {
    for (const rel of files ?? []) visitEntry(rel, ctx, visit);
  }
  for (const p of paths) {
    const { real, links } = canonical(p, realRoot);
    // A symbolic link on the way, at a place inside the docs root, is a problem in itself.
    const inLink = links.find((l) => isStrict(l, ctx));
    if (inLink) {
      visit(inLink, 'link');
      continue;
    }
    const rel = toPosix(relative(realRoot, real));
    if (lstatSync(real).isDirectory()) {
      const listed = files ? files.filter((f) => rel === '' || f === rel || f.startsWith(`${rel}/`)) : walk(real, realRoot, ctx, result);
      for (const f of listed) visitEntry(f, ctx, visit);
    } else {
      visit(rel, 'file');
    }
  }
  // Unit 61 (Scope 5): the ADR index matches the ADRs beside it, when the folder was linted.
  const s = adrSettings({ adr: project.adr });
  if ([...seen].some((rel) => rel.startsWith(`${s.folder}/`))) {
    const p = indexProblem(workTreeReader(realRoot), s);
    if (p) result.problems.push({ severity: 'error', file: p.path, line: 1, column: 1, code: p.code, reason: p.reason, hint: 'MIRAI renders it: mirai adr index' });
  }
  result.problems.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.column - b.column));
  return result;
}

export function projectDefaults() {
  return projectOf(frameworkDefaults());
}

// What the checks need from a checked config.
export function projectOf(config) {
  return { repos: (config.repos ?? []).map((r) => r.name), levels: (config.testing?.levels ?? []).map((l) => l.name), adapters: Object.fromEntries((config.testing?.levels ?? []).map((l) => [l.name, l.adapter ?? null])), limits: { ...(config.docs?.limits ?? {}) }, ticketTypes: Array.isArray(config.tickets?.types) ? config.tickets.types : null, checks: Object.fromEntries(Object.entries(config.checks ?? {}).map(([name, c]) => [name, [...((Array.isArray(c) ? c : c?.command) ?? [])]])), adr: { ...(config.adr ?? {}) } };
}

const toPosix = (p) => p.split(sep).join('/');
const isInside = (rel, ctx) => {
  const lower = rel.toLowerCase();
  return lower === ctx.docsRoot || lower.startsWith(`${ctx.docsRoot}/`);
};
// Unit 36: the context files in .mirai/context/ are MIRAI documents too, linted as strictly as
// the docs root's, and checked against the code.
const isStrict = (rel, ctx) => isInside(rel, ctx) || isContextFile(rel);

// A listed entry: inside the docs root, every entry counts (a link or a non-file is a
// problem; other files such as images are assets and left alone); outside, only regular
// Markdown files.
function visitEntry(rel, ctx, visit) {
  if (rel.split('/').some((part) => SKIP_FOLDERS.has(part)) && !isContextFile(rel)) return;
  let info;
  try {
    info = lstatSync(join(ctx.root, rel));
  } catch {
    return; // listed by git but deleted in the work tree
  }
  if (isStrict(rel, ctx)) {
    if (info.isSymbolicLink()) return visit(rel, 'link');
    if (!info.isFile() || MARKDOWN.test(rel)) return visit(rel, 'file');
    return undefined;
  }
  if (info.isFile() && MARKDOWN.test(rel)) visit(rel, 'file');
  return undefined;
}

// Without git: every entry under `dir`, without following links. An unreadable folder inside
// the docs root is a problem; outside, a warning.
function walk(dir, realRoot, ctx, result) {
  const out = [];
  const rel = toPosix(relative(realRoot, dir));
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const p = { file: rel || '.', line: 1, column: 1, code: 'unreadable', reason: `the folder can't be read (${err.code})` };
    result.problems.push(isInside(rel, ctx) ? { severity: 'error', ...p } : { severity: 'warning', ...p, reason: `${p.reason}, so it isn't linted` });
    return out;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (SKIP_FOLDERS.has(e.name)) {
      // Unit 36: from .mirai/, only the context files.
      if (child === '.mirai' && e.isDirectory()) {
        try {
          for (const n of readdirSync(join(dir, '.mirai', 'context')).sort()) if (isContextFile(`.mirai/context/${n}`)) out.push(`.mirai/context/${n}`);
        } catch {
          // no context folder
        }
      }
      continue;
    }
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), realRoot, ctx, result));
    else out.push(child);
  }
  return out;
}

// Resolves `path` one part at a time. Returns its real path and the repo-relative places of
// the symbolic links met on the way (inside the repo). Throws a LintPathError when a part is
// missing or the result is outside the repo.
function canonical(path, realRoot) {
  if (!isAbsolute(path)) throw new LintPathError(`${path} is not an absolute path`);
  let cur = realpathSync.native('/');
  const links = [];
  for (const part of path.split(sep).filter(Boolean)) {
    const next = join(cur, part);
    let info;
    try {
      info = lstatSync(next);
    } catch {
      throw new LintPathError(`${path} does not exist`);
    }
    if (info.isSymbolicLink()) {
      const at = relative(realRoot, next);
      if (!at.startsWith('..') && !isAbsolute(at)) links.push(toPosix(at));
    }
    try {
      cur = realpathSync.native(next);
    } catch {
      throw new LintPathError(`${path} does not exist`);
    }
  }
  if (cur !== realRoot && !cur.startsWith(realRoot + sep)) throw new LintPathError(`${path} is outside the repo`);
  return { real: cur, links };
}

function linkProblem(rel, ctx) {
  return {
    linted: true,
    problems: [{ severity: 'error', file: rel, line: 1, column: 1, code: 'symlink', reason: 'a symbolic link in the docs root', hint: 'documents must be real files and folders' }],
  };
}

export function lintFile(file, ctx) {
  const abs = join(ctx.root, file);
  const inside = isStrict(file, ctx);
  const problems = [];
  const problem = (p) => problems.push({ severity: 'error', file, line: 1, column: 1, ...p });
  // Inside the docs root, a file that can't be linted is a problem; outside, it's skipped.
  const notADocument = (p) => {
    if (inside) problem(p);
    return { linted: inside, problems };
  };

  let info;
  try {
    info = lstatSync(abs);
  } catch (err) {
    return notADocument({ code: 'unreadable', reason: `the file can't be read (${err.code})` });
  }
  if (info.isSymbolicLink()) return notADocument({ code: 'symlink', reason: 'a symbolic link in the docs root', hint: 'documents must be real files' });
  if (!info.isFile()) return notADocument({ code: 'not-a-file', reason: 'not a regular file', hint: 'the docs root holds only files and folders' });
  if (!MARKDOWN.test(file)) return { linted: false, problems };
  if (info.size > LIMITS.fileBytes) return notADocument({ code: 'too-large', reason: `the file is larger than ${LIMITS.fileBytes} bytes` });

  let bytes;
  try {
    bytes = readRegularFile(abs);
  } catch (err) {
    if (inside) return notADocument({ code: 'unreadable', reason: `the file can't be read (${err.code ?? 'not a regular file'})` });
    problems.push({ severity: 'warning', file, line: 1, column: 1, code: 'unreadable', reason: `the file can't be read (${err.code ?? 'not a regular file'}), so it isn't linted` });
    return { linted: false, problems };
  }

  let fm;
  try {
    fm = readFrontmatter(bytes, { source: file, positions: true });
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    const p = { code: `frontmatter-${err.code}`, line: err.line ?? 1, column: err.column ?? 1, reason: err.reason, hint: err.hint };
    if (inside) problem(p);
    else if (namesKnownType(bytes, ctx)) problems.push({ severity: 'warning', file, ...p, reason: `${err.reason} (not linted)` });
    return { linted: inside, problems };
  }
  if (fm === null) return notADocument({ code: 'no-frontmatter', reason: 'a MIRAI document needs frontmatter', hint: 'start the file with --- and the shared fields' });
  const type = fm.value.type;
  if (typeof type !== 'string' || type === '') {
    const at = fm.positions.get('type');
    return notADocument({ code: 'required', line: at?.line ?? 1, column: at?.valueColumn ?? 1, reason: 'the frontmatter needs a "type"' });
  }
  const def = Object.hasOwn(ctx.registry.documentTypes, type) ? ctx.registry.documentTypes[type] : null;
  if (!def) {
    const at = fm.positions.get('type');
    const near = closest(type, Object.keys(ctx.registry.documentTypes));
    return notADocument({ code: 'unknown-type', line: at.line, column: at.valueColumn ?? at.column, reason: `"${type}" is not a document type MIRAI knows`, hint: near ? `did you mean "${near}"?` : undefined });
  }
  if (!inside && !Object.hasOwn(fm.value, 'template')) return { linted: false, problems };
  // Unit 42: a ticket of a type with its own approved template is linted with it.
  const own = ticketDefOf(ctx.registry, ctx.project, def, fm.value);

  const scan = scanMarkdown(fm.body, { firstLine: fm.bodyLine });
  for (const p of scan.problems) problem(p);
  const doc = { value: fm.value, positions: fm.positions, scan, bodyLine: fm.bodyLine, text: bytes.toString('utf8') };
  const linkTarget = (path) => resolveLink(dirname(abs), path, ctx);
  const readDocument = (path) => readLinked(dirname(abs), path, ctx);
  const readTickets = () => readTicketFolder(dirname(abs), ctx);
  // Unit 61: an ADR lives outside the docs root (its own folder), and is still a MIRAI document whose
  // template text must be replaced.
  const template = inside || type === 'adr' ? templateOf(type, own, ctx) : null;
  // Unit 36: a context file is checked against the repo's code.
  // Unit 62b: a technical note's cited paths are checked against the repo too.
  const repo = isContextFile(file) || type === 'tech-note' || type === 'hld' ? (ctx.repo ??= repoReader(ctx.root)) : null;
  // Unit 61: an ADR is checked against the other ADRs of its folder (supersedes).
  const adr = type === 'adr' ? adrContext(ctx.project, dirname(file).split(sep).join('/'), workTreeReader(ctx.root)) : {};
  for (const p of checkDocument(doc, own, { linkTarget, readDocument, readTickets, file, project: ctx.project, template, registry: ctx.registry, repo, ...adr })) problems.push({ file, ...p });
  return { linted: true, problems };
}

// The tickets beside a document (unit 33: an epic's), every Markdown file in its tickets/ folder
// that reads as a MIRAI document: { status: 'ok', all: [{ path, value, doc }] }, `path` relative
// to the document's folder. A file that doesn't read is left out here; it is linted on its own.
// The folder must be a real folder inside the repo, as documents are.
export function readTicketFolder(fromDir, ctx) {
  const dir = join(fromDir, 'tickets');
  const all = [];
  let names = [];
  try {
    if (!lstatSync(dir).isDirectory()) return { status: 'ok', all };
    const real = realpathSync.native(dir);
    const root = realpathSync.native(ctx.root);
    if (!real.startsWith(root + sep)) return { status: 'ok', all };
    names = readdirSync(dir).filter((n) => MARKDOWN.test(n)).sort();
  } catch {
    return { status: 'ok', all };
  }
  for (const name of names) {
    try {
      const doc = parseDocument(readRegularFile(join(dir, name)).toString('utf8'), `tickets/${name}`);
      all.push({ path: `tickets/${name}`, value: doc.value, doc });
    } catch {
      // not a document: its own lint says why
    }
  }
  return { status: 'ok', all };
}

// The document a relative link leads to, parsed (unit 32: a PRD's brief): { value, scan, text }
// or { problem: 'outside' | 'missing' | 'unreadable' }.
function readLinked(fromDir, path, ctx) {
  const found = resolveLink(fromDir, path, ctx);
  if (found.problem) return found;
  try {
    return parseDocument(readRegularFile(resolve(fromDir, path)).toString('utf8'), path);
  } catch {
    return { problem: 'unreadable' };
  }
}

// A document's text, parsed for another document's checks; throws when its frontmatter doesn't
// read.
export function parseDocument(text, source) {
  const fm = readFrontmatter(text, { source, positions: true });
  if (fm === null) throw new Error('no frontmatter');
  return { value: fm.value, positions: fm.positions, scan: scanMarkdown(fm.body, { firstLine: fm.bodyLine }), bodyLine: fm.bodyLine, text };
}

// A type's template text, for the leftover check: its body's text lines, and its `id` plus any
// string field whose example is a sentence (has a space). Null when the template can't be read.
function templateOf(type, def, ctx) {
  const cacheKey = def.ticket_template ? `${type}:${def.ticket_template}` : type;
  if (ctx.templates.has(cacheKey)) return ctx.templates.get(cacheKey);
  let template = null;
  try {
    // Unit 37: the template as the project's overlay renders it, when one applies.
    const fm = readFrontmatter(typeof def.template_text === 'string' ? def.template_text : readRegularFile(join(ctx.registry.dir, def.template)));
    // Lines are compared as they show (code spans kept), so `npm test` in a real plan isn't
    // the template's `npm test` line unless the whole line matches. Structure the template
    // prescribes isn't a leftover: table header and |---| rows, and lines of fewer than three
    // words (such as a "none" row).
    const lines = new Set();
    const scannedBody = scanMarkdown(fm?.body ?? '');
    const body = def.renames ? aliased({ scan: scannedBody }, def).scan : scannedBody;
    const scanned = body.lines;
    const isRule = (l) => l && /^ *\|?[ :|-]+$/.test(l.visible ?? '') && (l.visible ?? '').includes('-');
    // Unit 32: the fixed parts are kept word for word, so they aren't leftovers; their text is
    // what the document must hold.
    const fixed = fixedParts(body, def);
    const inFixed = (line) => [...fixed.values()].some((f) => line > f.start && line < f.end);
    scanned.forEach((l, i) => {
      if (l.kind !== 'text' || isRule(l) || isRule(scanned[i + 1]) || inFixed(l.line)) return;
      const text = l.visible.trim();
      if ((text.match(/[\p{L}\p{N}_./:-]{2,}/gu) ?? []).length >= 3) lines.add(text);
    });
    const fields = new Map();
    for (const [key, value] of Object.entries(fm?.value ?? {})) {
      // Unit 42: a ticket type's name ("Tech Debt") is a name to keep, not an example to replace.
      if (key === 'ticket_type') continue;
      if (typeof value === 'string' && (key === 'id' || / /.test(value))) fields.set(key, value);
    }
    template = { lines, fields, fixed: new Map([...fixed].map(([name, f]) => [name, f.text])) };
  } catch {
    template = null;
  }
  ctx.templates.set(cacheKey, template);
  return template;
}

// Whether a frontmatter that didn't read has a top-level `type:` line naming a known type.
function namesKnownType(bytes, ctx) {
  const head = bytes.subarray(0, 16 * 1024 + 8).toString('utf8');
  const m = /^type:[ ]*["']?([a-z][a-z0-9-]*)["']?[ ]*(?:#.*)?\r?$/m.exec(head);
  return Boolean(m && Object.hasOwn(ctx.registry.documentTypes, m[1]));
}

// Reads a regular file without following a link and without blocking on a FIFO swapped in.
function readRegularFile(abs) {
  const fd = openSync(abs, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) throw new Error('not a regular file');
    if (info.size > LIMITS.fileBytes) throw Object.assign(new Error('too large'), { code: 'EFBIG' });
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

// Where a relative link leads: { problem: 'outside' | 'missing' } or { slugs } (the target's
// heading anchors when it's a Markdown file, else null). Whether a path is outside is decided
// from its deepest existing part, before asking whether it exists, so a link can't tell
// what exists outside the repo.
function resolveLink(fromDir, path, ctx) {
  const target = resolve(fromDir, path);
  if (target !== ctx.root && !target.startsWith(ctx.root + sep)) return { problem: 'outside' };
  let existing = target;
  for (;;) {
    try {
      lstatSync(existing);
      break;
    } catch {
      existing = dirname(existing);
    }
  }
  const real = realpathSync.native(existing);
  if (real !== ctx.root && !real.startsWith(ctx.root + sep)) return { problem: 'outside' };
  if (existing !== target) return { problem: 'missing' };
  return { slugs: MARKDOWN.test(real) ? slugsOf(real, ctx) : null };
}

// A linked Markdown file's heading anchors, or null when they can't be read (then anchors
// into it aren't checked).
function slugsOf(real, ctx) {
  if (ctx.headings.has(real)) return ctx.headings.get(real);
  let slugs = null;
  try {
    slugs = headingSlugs(scanMarkdown(bodyOf(readRegularFile(real).toString('utf8'))).headings);
  } catch {
    slugs = null;
  }
  ctx.headings.set(real, slugs);
  return slugs;
}

// The text after a frontmatter block, if there is one, without reading the YAML: a linked
// file's anchors don't depend on its frontmatter being valid.
function bodyOf(text) {
  if (!/^﻿?---\r?\n/.test(text)) return text;
  const lines = text.split('\n');
  const end = lines.findIndex((l, i) => i > 0 && (l === '---' || l === '---\r'));
  return end === -1 ? text : lines.slice(end + 1).join('\n');
}

// Lints one document's text (unit 08b): a plan in the store, which `mirai lint` can't reach
// because it's outside the repo. It's treated as a MIRAI document (as inside the docs root): a
// missing frontmatter or an unknown type is a problem, and leftover template text counts.
// Relative links aren't followed: there's no repo around the text. Returns the problems.
// `linked` maps a relative link's path to the linked document's text (unit 32: approval passes
// a PRD's brief); a link not in it can't be read, and checks that need it are skipped.
// `tickets` (unit 33: an epic's) maps each ticket file's path, relative to the document
// (tickets/<key>.md), to its text; without it, the checks that need the tickets are skipped.
// `repo` (unit 36): the repo's top folder, for a context file's checks against the code (at its
// approval); without it they're skipped. `previous` (unit 43): the text of the document's last
// approved version, for the ID-stability lint; without it, that lint is skipped.
export function lintText(text, { source = '<text>', registry, project = projectDefaults(), files = null, approving = false, linked = {}, tickets = null, repo = null, previous = null, adrRoot = null }) {
  const problems = [];
  const problem = (p) => problems.push({ severity: 'error', file: source, line: 1, column: 1, ...p });
  if (Buffer.byteLength(text, 'utf8') > LIMITS.fileBytes) {
    problem({ code: 'too-large', reason: `the text is larger than ${LIMITS.fileBytes} bytes` });
    return problems;
  }
  let fm;
  try {
    fm = readFrontmatter(text, { source, positions: true });
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    problem({ code: `frontmatter-${err.code}`, line: err.line ?? 1, column: err.column ?? 1, reason: err.reason, hint: err.hint });
    return problems;
  }
  if (fm === null) {
    problem({ code: 'no-frontmatter', reason: 'a MIRAI document needs frontmatter' });
    return problems;
  }
  const type = fm.value.type;
  const at = fm.positions.get('type');
  if (typeof type !== 'string' || type === '') {
    problem({ code: 'required', line: at?.line ?? 1, column: at?.valueColumn ?? 1, reason: 'the frontmatter needs a "type"' });
    return problems;
  }
  const def = Object.hasOwn(registry.documentTypes, type) ? registry.documentTypes[type] : null;
  if (!def) {
    const near = closest(type, Object.keys(registry.documentTypes));
    problem({ code: 'unknown-type', line: at.line, column: at.valueColumn ?? at.column, reason: `"${type}" is not a document type MIRAI knows`, hint: near ? `did you mean "${near}"?` : undefined });
    return problems;
  }
  const scan = scanMarkdown(fm.body, { firstLine: fm.bodyLine });
  for (const p of scan.problems) problem(p);
  const doc = { value: fm.value, positions: fm.positions, scan, bodyLine: fm.bodyLine, text: text.startsWith('\uFEFF') ? text.slice(1) : text };
  const ctx = { registry, templates: new Map() };
  // Unit 42: a ticket of a type with its own approved template is linted with it.
  const own = ticketDefOf(registry, project, def, fm.value);
  const template = templateOf(type, own, ctx);
  const linkTarget = () => ({ slugs: null });
  const readDocument = (path) => {
    if (!Object.hasOwn(linked, path)) return { problem: 'unavailable' };
    try {
      return parseDocument(linked[path], path);
    } catch {
      return { problem: 'unreadable' };
    }
  };
  const readTickets = () => {
    if (tickets === null) return { status: 'unavailable' };
    const all = [];
    for (const [path, t] of Object.entries(tickets).sort(([a], [b]) => (a < b ? -1 : 1))) {
      try {
        const parsed = parseDocument(t, path);
        all.push({ path, value: parsed.value, doc: parsed });
      } catch {
        // not a document: its own lint says why
      }
    }
    return { status: 'ok', all };
  };
  const code = repo ? repoReader(repo) : null;
  // Unit 61: an ADR, with the other ADRs of its folder when `adrRoot` (the repo) is given.
  const adr = type === 'adr' && adrRoot ? adrContext(project, dirname(source), workTreeReader(adrRoot)) : {};
  for (const p of checkDocument(doc, own, { linkTarget, readDocument, readTickets, file: source, project, template, registry, files, approving, repo: code, previous, ...adr })) problems.push({ file: source, ...p });
  return problems.sort((a, b) => a.line - b.line || a.column - b.column);
}

// The ADR folder's settings and its ADRs, for an ADR's checks (unit 61): the project's [adr]
// folder when the file is in it, else the file's own folder with the project's numbering.
function adrContext(project, folder, reader) {
  const base = adrSettings({ adr: project?.adr });
  const s = { ...base, folder };
  return { adrSettings: s, adrs: listAdrs(reader, s) };
}
