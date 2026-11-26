import { lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';

import { atomicWrite } from '../store/files.js';
import { contentHash } from '../sign/sign.js';
import { readFrontmatter } from '../lint/frontmatter.js';

// Architecture decision records (unit 61): where they live, how they are numbered, the list of
// them, the index MIRAI renders, the typo-fix rule and their signed state. One place for every
// command that reads them (the lint, approval, the pre-commit hook, trace, the docs merge, the
// agents' inputs).

export const ADR_DEFAULTS = Object.freeze({ folder: 'docs/decisions', numbering: 'ADR-0001' });
export const INDEX_NAME = 'README.md';
// When the folder's README.md is the project's own (Thudos's is a usage note), MIRAI never rewrites
// it (D-20): its index is index.md instead.
export const OTHER_INDEX = 'index.md';
export const INDEX_MARK = '<!-- MIRAI renders this file from the ADRs beside it (mirai adr index): don\'t edit it by hand. -->';
const FILE_MAX = 1024 * 1024;
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
// The statuses a project's own ADRs use besides MADR's (Nygard's "Approved", "Done").
const FOREIGN_STATUS = Object.freeze({ approved: 'accepted', done: 'accepted', adopted: 'accepted', draft: 'proposed', open: 'proposed', replaced: 'superseded' });
export const STATUSES = Object.freeze(['proposed', 'accepted', 'rejected', 'deprecated', 'superseded']);

// The project's [adr] settings, with the defaults: { folder, prefix, width, numbering }.
// `numbering` is the first number as the project writes it: "ADR-0001", "adr-0001", "0001".
export function adrSettings(config) {
  const folder = String(config?.adr?.folder ?? ADR_DEFAULTS.folder).replace(/\/+$/, '');
  const numbering = String(config?.adr?.numbering ?? ADR_DEFAULTS.numbering);
  const m = /^([A-Za-z]{0,8}-?)([0-9]{1,6})$/.exec(numbering);
  return { folder, numbering, prefix: m ? m[1] : 'ADR-', width: m ? m[2].length : 4 };
}

// The number in a file name of the folder, or null when the file isn't an ADR ("README.md").
export function numberOf(name, s) {
  const re = new RegExp(`^${s.prefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}([0-9]{1,6})(?:-[^/]*)?\\.md$`, 'i');
  const m = re.exec(name);
  return m ? Number(m[1]) : null;
}
export const idOf = (n, s) => `${s.prefix}${String(n).padStart(s.width, '0')}`;
export const fileNameOf = (n, slug, s) => `${idOf(n, s)}-${slug}.md`;

// The ADRs of a folder, read through `reader` ({ list(folder) → names, read(path) → Buffer|null }):
// [{ path, name, number, id, title, status, date, superseded_by, supersedes, initiative, mirai,
// value, bytes }], by number. A MIRAI ADR (type: adr) reads its frontmatter; a project's own one
// (D-20) is read as it is: its title, and a status from a `status:` field or a "Status:" line,
// accepted unless it says otherwise.
export function listAdrs(reader, s) {
  const out = [];
  for (const name of (reader.list(s.folder) ?? []).sort()) {
    if (name.toLowerCase() === INDEX_NAME.toLowerCase() || name.toLowerCase() === OTHER_INDEX) continue;
    const number = numberOf(name, s);
    if (number === null) continue;
    const path = `${s.folder}/${name}`;
    const bytes = reader.read(path);
    if (!bytes) continue;
    out.push(readAdr(path, name, number, bytes, s));
  }
  return out.sort((a, b) => a.number - b.number || (a.name < b.name ? -1 : 1));
}

export function readAdr(path, name, number, bytes, s) {
  const text = bytes.toString('utf8').replace(/\r\n?/g, '\n');
  let value = {};
  let body = text;
  try {
    const fm = readFrontmatter(bytes);
    if (fm) {
      value = fm.value ?? {};
      body = fm.body;
    }
  } catch {
    value = {};
  }
  const mirai = value.type === 'adr';
  // A project's own title often repeats its number ("ADR-0001: Local development …").
  const title = (/^# +(.+)$/m.exec(body)?.[1] ?? name.replace(/\.md$/i, '')).trim().replace(/^(?:ADR|adr)?[ _-]?0*[0-9]{1,6}[ \t]*[:.—-][ \t]*/, '');
  let status = typeof value.status === 'string' ? value.status.toLowerCase() : null;
  if (!status) {
    const line = /^(?:[-*+][ \t]+)?(?:\*\*)?Status(?:\*\*)?:?(?:\*\*)?[ \t]*:?[ \t]*(\w+)/im.exec(body) ?? /^#{2,3} +Status[ \t]*\n+[ \t]*(?:[-*][ \t]+)?(\w+)/im.exec(body);
    status = line ? line[1].toLowerCase() : 'accepted';
  }
  status = FOREIGN_STATUS[status] ?? status;
  const str = (k) => (typeof value[k] === 'string' && value[k] !== '' ? value[k] : null);
  const id = mirai && str('id') ? str('id') : idOf(number, s);
  const dated = /^(?:[-*+][ \t]+)?(?:\*\*)?Date(?:\*\*)?:?(?:\*\*)?[ \t]*:?[ \t]*([0-9]{4}-[0-9]{2}-[0-9]{2})/im.exec(body)?.[1] ?? null;
  return { path, name, number, id, title, status, date: str('date') ?? str('created') ?? dated, superseded_by: str('superseded_by'), supersedes: str('supersedes'), initiative: str('initiative'), components: Array.isArray(value.components) ? value.components.filter((c) => typeof c === 'string') : [], gate: Array.isArray(value.gate) ? value.gate : [], mirai, value, bytes, text };
}

// A reader on a folder of the work tree (regular files only, never a link).
export function workTreeReader(root) {
  return {
    list(folder) {
      try {
        const dir = join(root, folder);
        if (!lstatSync(dir).isDirectory()) return [];
        return readdirSync(dir).filter((n) => {
          try {
            return lstatSync(join(dir, n)).isFile();
          } catch {
            return false;
          }
        });
      } catch {
        return [];
      }
    },
    read(path) {
      try {
        const abs = join(root, path);
        const st = lstatSync(abs);
        if (!st.isFile() || st.size > FILE_MAX) return null;
        return readFileSync(abs);
      } catch {
        return null;
      }
    },
  };
}

// The next number and the file for a new ADR: one past the highest in the folder.
export function nextAdr(adrs, s, slug) {
  if (!SLUG.test(slug)) throw Object.assign(new Error(`"${String(slug).slice(0, 60)}" isn't a slug: lower-case letters, digits and dashes`), { code: 'bad-slug' });
  const n = Math.max(0, ...adrs.map((a) => a.number)) + 1;
  return { number: n, id: idOf(n, s), name: fileNameOf(n, slug, s), path: `${s.folder}/${fileNameOf(n, slug, s)}` };
}

// ---- The index -------------------------------------------------------------------------------

const cell = (t) => String(t ?? '—').replace(/[|\n]/g, ' ').trim() || '—';

// The index README.md MIRAI writes beside the ADRs: one row per ADR, in number order.
export function renderIndex(adrs) {
  const lines = [
    INDEX_MARK,
    '# Architecture decisions',
    '',
    'One row per decision record in this folder. Accepted decisions are binding; a superseded one is',
    'history, replaced by the ADR named; a rejected one stays so it isn\'t proposed again.',
    '',
    '| ADR | Decision | Status | Date | Superseded by |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const a of adrs) {
    const by = a.superseded_by ? adrs.find((x) => x.id.toLowerCase() === a.superseded_by.toLowerCase()) : null;
    lines.push(`| [${cell(a.id)}](${encodeURI(a.name)}) | ${cell(a.title)} | ${cell(a.status)} | ${cell(a.date)} | ${by ? `[${cell(by.id)}](${encodeURI(by.name)})` : cell(a.superseded_by)} |`);
  }
  if (!adrs.length) lines.push('| — | none yet | — | — | — |');
  return `${lines.join('\n')}\n`;
}

// The index's path in the folder: README.md, unless the folder's README.md is the project's own.
export function indexPathOf(reader, s) {
  const readme = reader.read(`${s.folder}/${INDEX_NAME}`);
  const own = readme && !readme.toString('utf8').replace(/^\uFEFF/, '').startsWith(INDEX_MARK);
  return `${s.folder}/${own ? OTHER_INDEX : INDEX_NAME}`;
}

// Why the index on disk isn't what MIRAI renders from the ADRs: null when it matches (or there are
// no ADRs and no index). { code, reason, path }.
export function indexProblem(reader, s) {
  const adrs = listAdrs(reader, s);
  const path = indexPathOf(reader, s);
  const now = reader.read(path);
  if (!now) return adrs.length ? { code: 'adr-index-missing', path, reason: `the ADR folder has ${adrs.length} ADR${adrs.length === 1 ? '' : 's'} and no index (${path})` } : null;
  if (now.toString('utf8').replace(/\r\n?/g, '\n') === renderIndex(adrs)) return null;
  return { code: 'adr-index', path, reason: `${path} isn't the index of the ADRs beside it (a hand edit, or an ADR changed since it was rendered)` };
}

// ---- The typo-fix rule (decision 6) -----------------------------------------------------------

// Whether `after` changes `before` by typo and link fixes only: the same frontmatter (but
// `updated`), the same sections, and in each section the same number of words with each changed
// word a small spelling fix (at most two letters), at most one word in twenty (and three a
// section); link targets may change freely. { ok, why }.
export function typoFixOnly(before, after) {
  const a = splitDoc(before);
  const b = splitDoc(after);
  if (!a || !b) return { ok: false, why: 'the frontmatter doesn\'t read' };
  const keys = new Set([...Object.keys(a.value), ...Object.keys(b.value)]);
  for (const k of keys) {
    if (k === 'updated') continue;
    if (JSON.stringify(a.value[k]) !== JSON.stringify(b.value[k])) return { ok: false, why: `its "${k}" changed` };
  }
  const as = sectionsOf(a.body);
  const bs = sectionsOf(b.body);
  if (as.map((x) => x.name).join('\n') !== bs.map((x) => x.name).join('\n')) return { ok: false, why: 'its sections changed' };
  for (let i = 0; i < as.length; i++) {
    const wa = wordsOf(as[i].text);
    const wb = wordsOf(bs[i].text);
    const where = as[i].name || 'the title';
    if (wa.length !== wb.length) return { ok: false, why: `${where} has ${wb.length > wa.length ? 'more' : 'fewer'} words than you approved` };
    let changed = 0;
    for (let j = 0; j < wa.length; j++) {
      if (wa[j] === wb[j]) continue;
      if (wa[j].toLowerCase() === wb[j].toLowerCase()) continue;
      if (distance(wa[j].toLowerCase(), wb[j].toLowerCase()) > 2) return { ok: false, why: `${where}: "${wa[j]}" became "${wb[j]}", more than a spelling fix` };
      changed += 1;
    }
    if (changed > Math.max(3, Math.floor(wa.length / 20))) return { ok: false, why: `${where}: ${changed} words changed, more than typo fixes` };
  }
  return { ok: true, why: null };
}

function splitDoc(text) {
  try {
    const fm = readFrontmatter(Buffer.from(String(text)));
    return fm ? { value: fm.value ?? {}, body: fm.body } : { value: {}, body: String(text) };
  } catch {
    return null;
  }
}
function sectionsOf(body) {
  const out = [{ name: '', text: '' }];
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const h = /^##[ \t]+(.+?)[ \t]*$/.exec(line);
    if (h) out.push({ name: h[1], text: '' });
    else out[out.length - 1].text += `${line}\n`;
  }
  return out;
}
// Words, with link targets and HTML comments taken out (a link's target may change).
function wordsOf(text) {
  const plainText = text.replace(/<!--[^]*?-->/g, ' ').replace(/\]\([^)]*\)/g, '] ').replace(/<https?:[^>]*>/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  return plainText.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
}
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// ---- Status in the file: only MIRAI writes it (Jet's "A", 61's re-check against 44) ----------

// The text with its frontmatter's `status` (and the other fields MIRAI writes with it) set:
// `fields` maps a key to its value (a string) or null (taken out). Each key keeps its line; a new
// key goes right after `status:`.
export function withFields(text, fields) {
  const src = String(text).replace(/\r\n?/g, '\n');
  const m = /^(\uFEFF?---\n)([^]*?\n)(---\n)/.exec(src);
  if (!m) throw new Error('no frontmatter');
  let lines = m[2].split('\n');
  if (lines.at(-1) === '') lines = lines.slice(0, -1);
  for (const [key, value] of Object.entries(fields)) {
    const at = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
    const line = value === null ? null : `${key}: ${/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(value) && !/^(?:true|false|null|yes|no|~)$/i.test(value) && !/^[0-9]/.test(value) ? value : JSON.stringify(value)}`;
    if (at !== -1) {
      if (line === null) lines.splice(at, 1);
      else lines[at] = line;
    } else if (line !== null) {
      const after = lines.findIndex((l) => /^status:/.test(l));
      lines.splice(after === -1 ? lines.length : after + 1, 0, line);
    }
  }
  return `${m[1]}${lines.join('\n')}\n${m[3]}${src.slice(m[0].length)}`;
}

// ---- The signed state of an ADR file ----------------------------------------------------------

// Every hash you signed for the file at `path`, oldest first: from an ADR's approval (its own file
// and, for a superseding one, the old one in `files`) and from an ADR review line.
export function signedHashes(events, path) {
  const out = [];
  for (const e of events) {
    if (e.by !== 'human') continue;
    if (e.type === 'approval' && e.kind === 'adr') {
      if (e.path === path) out.push({ hash: e.content_hash, seq: e.seq, item: e.item, decision: e.decision });
      for (const f of e.files ?? []) if (f.path === path) out.push({ hash: f.content_hash, seq: e.seq, item: e.item, decision: 'superseded' });
    } else if (e.type === 'adr_review' && e.path === path) {
      out.push({ hash: e.content_hash, seq: e.seq, item: e.item, decision: e.verdict });
    }
  }
  return out;
}

// The ADR file against your signed lines: { state, last } where state is
//   `signed` (the bytes are the last ones you signed), `typo-fix` (a typo or link fix of them, the
//   approved text read from the store's copy), `changed` (anything else; `why`), or `unsigned`
//   (no line of yours: proposed, or written by hand).
export function adrState({ events, path, bytes, approvedTextOf = () => null }) {
  const lines = signedHashes(events, path);
  const last = lines.at(-1) ?? null;
  if (!last) return { state: 'unsigned', last: null };
  const hash = contentHash(bytes);
  if (hash === last.hash) return { state: 'signed', last };
  const then = approvedTextOf(last.hash);
  if (then !== null) {
    const fix = typoFixOnly(then, bytes.toString('utf8'));
    if (fix.ok) return { state: 'typo-fix', last };
    return { state: 'changed', last, why: fix.why };
  }
  return { state: 'changed', last, why: 'the signed text isn\'t kept here, so the change can\'t be read' };
}

// The store keeps a copy of every ADR text you sign, by its hash: the typo-fix rule compares a
// later change with it, wherever the file is.
export const signedCopyPath = (store, hash) => join(store.dir, 'adr', `${String(hash).replace(/^sha256:/, '')}.md`);
export function keepSignedCopy(store, bytes) {
  const hash = contentHash(bytes);
  mkdirSync(join(store.dir, 'adr'), { recursive: true, mode: 0o700 });
  atomicWrite(signedCopyPath(store, hash), bytes.toString('utf8'));
  return hash;
}
export function signedCopyOf(store) {
  return (hash) => {
    try {
      const text = readFileSync(signedCopyPath(store, hash), 'utf8');
      return contentHash(Buffer.from(text)) === hash ? text : null;
    } catch {
      return null;
    }
  };
}

export { confirmationsOf, testNamesAdr } from './confirm.js';

export const slugOk = (slug) => SLUG.test(slug);
export const adrPathIn = (s, path) => posix.dirname(path) === s.folder;

// A reader on a folder at a commit (git objects, never the work tree): the docs merge reads the ADRs
// at the merge request's head, the agents' inputs at the integration branch's commit. `overlay`
// ([{ path, bytes }]) replaces or adds files, as a docs commit would.
export function treeReader({ lsTree, catBlobs }, root, ref, env, overlay = []) {
  const cache = new Map();
  const entriesOf = (folder) => {
    if (!cache.has(folder)) {
      const entries = (ref ? lsTree(root, ref, `${folder}/`, env, { recursive: false, sizes: true }) ?? [] : []).filter((e) => e.type === 'blob' && e.mode !== '120000' && (e.size ?? 0) <= FILE_MAX);
      const blobs = entries.length ? catBlobs(root, entries.map((e) => e.sha), env, { maxBytes: FILE_MAX, maxTotal: entries.reduce((n, e) => n + (e.size ?? 0), 0) + 1024 }) : new Map();
      cache.set(folder, new Map(entries.map((e) => [e.path, blobs.get(e.sha) ?? null])));
    }
    return cache.get(folder);
  };
  const mine = new Map(overlay.map((f) => [f.path, f.bytes]));
  return {
    list(folder) {
      const names = new Set([...entriesOf(folder).keys()].map((p) => posix.basename(p)));
      for (const p of mine.keys()) if (posix.dirname(p) === folder) names.add(posix.basename(p));
      return [...names];
    },
    read(path) {
      if (mine.has(path)) return mine.get(path);
      return entriesOf(posix.dirname(path)).get(path) ?? null;
    },
  };
}

// The files of the ADR folder an initiative's docs merge request carries (45's re-check, Jet's
// "A"): its ADRs (their `initiative` field), each ADR their signed lines marked superseded, and the
// index as it would be with them. `reader` reads the work tree (publish) or the head (merge).
export function initiativeAdrPaths(adrs, events, initiative) {
  const own = adrs.filter((a) => a.mirai && a.initiative === initiative);
  const paths = new Set(own.map((a) => a.path));
  for (const a of own) {
    for (const e of events) {
      if (e.type === 'approval' && e.by === 'human' && e.kind === 'adr' && e.path === a.path) for (const f of e.files ?? []) paths.add(f.path);
    }
  }
  return [...paths].sort();
}
