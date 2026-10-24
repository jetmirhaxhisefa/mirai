import { posix } from 'node:path';

// `@` imports in an instruction file (unit 12; R3-M9). Claude Code pulls `@path` into the
// context (research/08 §2.1), so a file a CLAUDE.md or AGENTS.md imports is as much an
// instruction file as they are. Imports inside code fences and code spans don't count, and only
// paths inside the repo are returned (a `~/` or absolute import is outside it).

export const INSTRUCTION_FILES = Object.freeze(['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md']);
export const IMPORT_DEPTH = 5;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// The repo-relative paths `text` (the file at `file`) imports.
export function importsOf(text, file) {
  const out = new Set();
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (f) { fence = f[1]; continue; }
    const plain = line.replace(/`+[^`]*`+/g, ' ');
    for (const m of plain.matchAll(/(?:^|\s)@([^\s`<>]+)/g)) {
      const target = m[1].replace(/[),.;:]+$/, '');
      if (target.startsWith('~') || target.startsWith('/') || target.includes('\\')) continue;
      const path = posix.normalize(posix.join(posix.dirname(file), target));
      if (path === '..' || path.startsWith('../') || path === '.') continue;
      out.add(path);
    }
  }
  return [...out].sort();
}

// Every file imported, directly or through other imports (up to IMPORT_DEPTH), by `files`.
// `read(path)` gives a file's text, or null when it doesn't exist.
export function importClosure(files, read) {
  const seen = new Set();
  let level = [...files];
  for (let depth = 0; depth < IMPORT_DEPTH && level.length; depth++) {
    const next = [];
    for (const file of level) {
      const text = read(file);
      if (text === null) continue;
      for (const path of importsOf(text, file)) {
        if (seen.has(path) || files.includes(path)) continue;
        seen.add(path);
        next.push(path);
      }
    }
    level = next;
  }
  return [...seen].sort();
}
