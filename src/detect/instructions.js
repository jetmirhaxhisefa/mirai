import { blockHash, renderedHash } from '../install/lock.js';
import { scanMarkdown, LIMITS as MD_LIMITS } from '../lint/markdown.js';
import { IMPORT_DEPTH, INSTRUCTION_FILES, importsOf } from '../trust/imports.js';
import { filesNamed, filesUnderFolder, nameOf } from './walk.js';

// Agent-instruction files (unit 17a; P2): every one the data names (registry/instruction-flags/),
// every file they `@`-import, and what the project writes into MIRAI's own block
// (.mirai/context/agents-local.md), with the shell, network and install commands in them flagged
// for you to review. Flags are hints, not a verdict: unit 39's ledger asks about each file, by
// its blob id, so an edit after review shows.
//
// What's read: in Markdown, code spans, fenced blocks and lines that start with "$ ", plus the
// patterns marked `prose` on every other line (so prose that only mentions a word isn't flagged);
// in JSON, the keys the data names; in any other text file, every line. MIRAI's own block is
// skipped only when it's closed and matches the lock's hash; a file MIRAI rendered whole is listed,
// not read, only while it matches the lock (both are integration-branch content, which is the
// trust root's by design, D-15).

export const INSTRUCTION_LIMITS = Object.freeze({ files: 2000, fileBytes: 256 * 1024, perFile: 50, flags: 500, text: 200 });
const BEGIN = '<!-- mirai:begin -->';
const END = '<!-- mirai:end -->';
export const LOCAL_FILE = '.mirai/context/agents-local.md';

// The instruction files the data names, sorted: { files: [path], links: [path], more }.
export function findInstructionFiles(tree, data) {
  const all = new Set();
  const links = new Set();
  for (const d of Object.values(data)) {
    for (const f of d.files) {
      for (const p of filesNamed(tree, f)) all.add(p);
      for (const p of tree.links) if (p === f || p.endsWith(`/${f}`)) links.add(p);
    }
    for (const f of d.folders ?? []) {
      for (const p of filesUnderFolder(tree, f)) all.add(p);
      for (const p of tree.links) if (p.startsWith(`${f}/`) || p.includes(`/${f}/`)) links.add(p);
    }
  }
  const sorted = [...all].sort();
  return { files: sorted.slice(0, INSTRUCTION_LIMITS.files), links: [...links].sort(), more: Math.max(0, sorted.length - INSTRUCTION_LIMITS.files) };
}

// Code spans in one line: the text between a run of backticks and the next run of the same
// length. Linear: the runs of each length are walked by one pointer that only moves forward.
export function codeSpans(line) {
  const spans = [];
  const runs = [...line.matchAll(/`+/g)].map((m) => ({ at: m.index, len: m[0].length }));
  const byLen = new Map();
  runs.forEach((r, i) => {
    if (!byLen.has(r.len)) byLen.set(r.len, []);
    byLen.get(r.len).push(i);
  });
  const next = new Map();
  for (let i = 0; i < runs.length; i++) {
    const list = byLen.get(runs[i].len);
    let k = next.get(runs[i].len) ?? 0;
    while (k < list.length && list[k] <= i) k++;
    next.set(runs[i].len, k);
    if (k === list.length) continue;
    spans.push(line.slice(runs[i].at + runs[i].len, runs[list[k]].at));
    i = list[k];
  }
  return spans;
}

// The lines of MIRAI's block (1-based, both markers included), only when the block is closed and
// `skip` says it's MIRAI's as rendered.
function miraiLines(raw, skip) {
  if (!skip) return new Set();
  const begin = raw.findIndex((l) => l.replace(/\r$/, '').trim() === BEGIN);
  const end = begin === -1 ? -1 : raw.findIndex((l, i) => i > begin && l.replace(/\r$/, '').trim() === END);
  if (end === -1) return new Set();
  return new Set(Array.from({ length: end - begin + 1 }, (_, i) => begin + i + 1));
}

// The pieces of `text` to check, as { line, text, prose }, and how many lines were too long to
// read. `rules`: the data's markdown extensions and JSON keys; `skipBlock`: MIRAI's block matches
// the lock.
export function piecesOf(path, text, rules, { skipBlock = false } = {}) {
  const lower = path.toLowerCase();
  if (rules.markdown.some((ext) => lower.endsWith(ext))) {
    const scan = scanMarkdown(text);
    const raw = text.split('\n');
    const mine = miraiLines(raw, skipBlock);
    const out = [];
    const fenceBody = new Set(scan.fences.flatMap((f) => f.body.map((b) => b.line)));
    for (const l of scan.lines) {
      if (mine.has(l.line)) continue;
      if (fenceBody.has(l.line)) out.push({ line: l.line, text: raw[l.line - 1].replace(/\r$/, '') });
      else if (l.kind === 'text') {
        const shown = l.visible ?? '';
        const bare = shown.replace(/^\s*(?:>\s*)*(?:[-*+]\s+|[0-9]{1,9}[.)]\s+)?/, '');
        if (bare.startsWith('$ ')) out.push({ line: l.line, text: bare.slice(2) });
        else {
          for (const s of codeSpans(shown)) out.push({ line: l.line, text: s });
          out.push({ line: l.line, text: shown, prose: true });
        }
      }
    }
    return { pieces: out, skipped: scan.problems.filter((p) => p.code === 'long-line').length };
  }
  if (lower.endsWith('.json')) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      return { pieces: [], skipped: 0 };
    }
    const lines = text.split('\n');
    const lineOf = (s) => {
      const i = lines.findIndex((l) => l.includes(JSON.stringify(s).slice(1, -1)));
      return i === -1 ? 1 : i + 1;
    };
    const strings = (x) => (typeof x === 'string' || Array.isArray(x) ? [].concat(x).filter((e) => typeof e === 'string') : []);
    const out = [];
    const always = new Map(rules.json.always.map((a) => [a.key, a.kind]));
    // An object's command and its args are one command line; a scanned key's strings are each one.
    const walk = (v, depth) => {
      if (depth > 32 || out.length > 1000 || v === null || typeof v !== 'object') return;
      if (!Array.isArray(v)) {
        const parts = [...rules.json.command.flatMap((k) => strings(v[k])), ...rules.json.args.flatMap((k) => strings(v[k]))];
        if (parts.length) out.push({ line: lineOf(parts[0]), text: parts.join(' ') });
      }
      for (const [k, x] of Object.entries(v)) {
        if (rules.json.command.includes(k) || rules.json.args.includes(k)) continue;
        if (!Array.isArray(v) && always.has(k) && (typeof x === 'string' || Array.isArray(x))) {
          const s = strings(x).join(' ');
          out.push({ line: lineOf(strings(x)[0] ?? k), text: `${k}: ${s}`, always: always.get(k), key: k });
        } else if (!Array.isArray(v) && rules.json.scan.includes(k)) {
          for (const s of strings(x)) out.push({ line: lineOf(s), text: s });
        } else walk(x, depth + 1);
      }
    };
    walk(value, 0);
    return { pieces: out, skipped: 0 };
  }
  const all = text.split('\n').map((t, i) => ({ line: i + 1, text: t.replace(/\r$/, '') }));
  return { pieces: all.filter((p) => p.text.length <= MD_LIMITS.lineLength), skipped: all.filter((p) => p.text.length > MD_LIMITS.lineLength).length };
}

// The flags in one file's text: { flags: [{ line, pattern, kind, text }] (at most `perFile`),
// skipped }.
export function flagText(path, text, patterns, rules, options) {
  const { pieces, skipped } = piecesOf(path, text, rules, options);
  const flags = [];
  for (const piece of pieces) {
    if (piece.text.length > MD_LIMITS.lineLength) continue;
    if (piece.always) {
      flags.push({ line: piece.line, pattern: `key:${piece.key}`, kind: piece.always, text: piece.text.trim().slice(0, INSTRUCTION_LIMITS.text) });
    } else {
      for (const p of patterns) {
        if (piece.prose && !p.prose) continue;
        if (!p.re.test(piece.text)) continue;
        flags.push({ line: piece.line, pattern: p.name, kind: p.kind, text: piece.text.trim().slice(0, INSTRUCTION_LIMITS.text) });
        break;
      }
    }
    if (flags.length >= INSTRUCTION_LIMITS.perFile) break;
  }
  return { flags, skipped };
}

// The data's reading rules, merged.
export function rulesOf(data) {
  const ds = Object.values(data);
  return {
    markdown: [...new Set(ds.flatMap((d) => d.markdown ?? []))].map((e) => e.toLowerCase()),
    json: {
      command: [...new Set(ds.flatMap((d) => d.json_command ?? []))],
      args: [...new Set(ds.flatMap((d) => d.json_args ?? []))],
      scan: [...new Set(ds.flatMap((d) => d.json_scan ?? []))],
      always: ds.flatMap((d) => d.json_always ?? []),
    },
  };
}

// Every instruction file with its flags: { files: [{ path, bytes, sha, state, flags, skipped_lines?,
// imported_by? }], flags: [{ path, line, pattern, kind, text }], missing_imports, more, cut }.
// `state` is 'read', 'mirai' (rendered by MIRAI, unchanged), 'too-large', 'binary', 'read-limit'
// (detection's total read limit) or 'link' (never followed). `lockFiles`: the lock's Map of path
// to entry, or null; `readMirai(path)`: a file of .mirai/ from the trust root (a Buffer) or null.
export function instructionFacts(tree, reader, data, lockFiles, readMirai = () => null) {
  const patterns = Object.values(data).flatMap((d) => d.patterns.map((p) => ({ name: p.name, kind: p.kind, prose: p.prose === true, re: new RegExp(p.regex, 'iu') })));
  const rules = rulesOf(data);
  const found = findInstructionFiles(tree, data);
  const queue = [...found.files, ...found.links].sort().map((path) => ({ path, depth: 0 }));
  reader.prefetch(found.files.filter((p) => tree.files.get(p).size <= INSTRUCTION_LIMITS.fileBytes));
  if (readMirai(LOCAL_FILE) !== null) queue.push({ path: LOCAL_FILE, depth: 0 });
  const listed = new Map();
  const missing = new Set();
  const files = [];
  const flags = [];
  let cut = 0;
  for (let q = 0; q < queue.length && files.length < INSTRUCTION_LIMITS.files; q++) {
    const { path, depth, by } = queue[q];
    if (listed.has(path)) {
      if (by) listed.get(path).imported_by = [...new Set([...(listed.get(path).imported_by ?? []), by])];
      continue;
    }
    const mirai = path.startsWith('.mirai/');
    const meta = mirai ? null : tree.files.get(path);
    let body;
    let state = 'read';
    if (mirai) body = readMirai(path);
    else if (tree.links.includes(path)) state = 'link';
    else if (!meta) {
      missing.add(path);
      continue;
    } else if (meta.size > INSTRUCTION_LIMITS.fileBytes) state = 'too-large';
    else {
      body = reader.get(path);
      if (body === null) state = 'read-limit';
    }
    if (mirai && body === null) {
      missing.add(path);
      continue;
    }
    const entry = { path, bytes: body?.length ?? meta?.size ?? null, sha: meta?.sha ?? null, state, flags: 0, ...(by ? { imported_by: [by] } : {}) };
    listed.set(path, entry);
    files.push(entry);
    if (state !== 'read') continue;
    if (body.subarray(0, 8000).includes(0)) {
      entry.state = 'binary';
      continue;
    }
    const text = body.toString('utf8');
    const lock = lockFiles?.get(path);
    if (lock?.mark === 'rendered' && !lock.block && lock.sha256 === renderedHash(body)) {
      entry.state = 'mirai';
    } else {
      const skipBlock = lock?.block === 'mirai' && blockHash(text, path) === lock.sha256;
      const r = flagText(path, text, patterns, rules, { skipBlock });
      entry.flags = r.flags.length;
      if (r.skipped) entry.skipped_lines = r.skipped;
      for (const f of r.flags) {
        if (flags.length < INSTRUCTION_LIMITS.flags) flags.push({ path, ...f });
        else cut++;
      }
    }
    // What an instruction file imports is an instruction file too (unit 12's importsOf).
    if (INSTRUCTION_FILES.includes(nameOf(path)) && depth < IMPORT_DEPTH) {
      for (const target of importsOf(text, path)) queue.push({ path: target, depth: depth + 1, by: path });
    }
  }
  return { files, flags, links: found.links, missing_imports: [...missing].sort(), more: found.more, cut };
}
