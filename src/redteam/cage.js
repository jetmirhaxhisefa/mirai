import { posix } from 'node:path';

import { matches } from '../util/glob.js';

// The cage (unit 18f): the part of MIRAI's framework copy whose code decides what an agent can do,
// or how a launch is judged. The red-team result's `framework` key part hashes these files only, so
// a change to MIRAI's workflow (plan, the build's own checks, commits, the CLI's other commands)
// doesn't make an 18-minute run stale; a change to any cage file does.
//
// The cage is computed, not listed (18f review): its roots below, plus every file their code
// imports, directly or through other files, plus the data the templates and launches are built
// from. A file any cage code can reach is cage, so a new import pulls its file in by itself and
// nothing can be placed on the wrong side by hand. Only the few import edges in ALLOWED are left
// out, each with its reason.

export const ROOTS = Object.freeze([
  // What runs beside an agent, or decides its launch.
  'bin/hook.js', 'bin/mcp.js', 'bin/agent-worker.js', 'bin/launch.js',
  'src/launch/**', 'src/mcp/**', 'src/tests/**', 'src/trust/**', 'src/adapters/**',
  'src/agent/run.js', 'src/agent/process.js', 'src/agent/scope.js', 'src/agent/requests.js', 'src/agent/worker.js',
  // The red team itself, and the command that runs it (it checks the running copy is the trust root's).
  'src/redteam/**', 'src/cli/commands/redteam.js',
]);

// Data, not code: the registry the strict templates, roles and launches are built from.
export const DATA = Object.freeze([
  'package.json',
  'registry/adapters/**', 'registry/protected-paths/**', 'registry/secrets/**', 'registry/roles/**',
  // An agent's definition (its role and read_only decide the roles it may launch under), not its prompt.
  'registry/agents/*.toml',
]);

// Import edges left out of the cage, each with why.
export const ALLOWED = Object.freeze([
  // The launcher hands over to the CLI (bin/mirai.js, the router, the commands). The CLI's commands
  // are outside the cage: they parse your arguments and call into it, and the launches, the gate
  // and the checks they reach are cage code. The red team does run one command through it (the
  // a-mirai-agent case: an agent can't run `mirai agent run`); that refusal is the launch's.
  { from: 'bin/launch.js', to: 'bin/mirai.js' },
  // MIRAI's own package folder (PACKAGE_ROOT): install and the launcher find the copy's files from it,
  // by FRAMEWORK_PARTS, and hash them; it isn't code the cage runs.
  { from: 'src/install/parts.js', to: '.' },
]);

// A relative import's specifiers in a JavaScript file: static imports and re-exports, side-effect
// imports, dynamic imports of a literal path, and a URL built from a literal path relative to
// import.meta.url (a file found by path, to run or read).
const SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*|\bnew\s+URL\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;
export function importsOf(path, text) {
  const out = [];
  for (const m of String(text).matchAll(SPEC)) out.push(posix.normalize(posix.join(posix.dirname(path), m[2].replace(/[?#].*$/, ''))));
  return [...new Set(out)];
}

// Forms the closure can't follow: a computed import or URL, or node's require made at runtime. A
// cage file with one makes the cage unknowable, and the whole copy is hashed instead (fails closed:
// 18f re-review). Built from parts, so this file names none of them literally.
const OPAQUE = new RegExp(['\\bimport\\s*\\(\\s*(?![\'"])', '\\bnew\\s+URL\\s*\\(\\s*(?![\'"])[^)]*\\bimport\\.meta\\.url', `\\b${'create'}${'Require'}\\b`].join('|'));
// Comments aren't code: a line comment, or a block comment.
const uncommented = (text) => String(text).replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CODE = /\.(?:js|mjs|cjs)$/;

const isRoot = (p) => ROOTS.some((g) => matches(g, p));
// Data paths: `package.json` only at the top (a bare glob would match at any depth).
const isData = (p) => p === 'package.json' || DATA.some((g) => g.includes('/') && matches(g, p));
const allowed = (from, to) => ALLOWED.some((e) => e.from === from && e.to === to);

// The cage's files among `files` (framework-relative paths): the roots and their import closure,
// and the data. `read(path)` gives a file's text (or null). Returns the set, or null when the cage
// can't be known: a cage code file that can't be read, an import form the closure can't follow,
// or a relative import that names no file of the copy. The caller then hashes everything.
export function cageOf(files, read) {
  const known = new Set(files);
  const cage = new Set(files.filter((p) => isData(p)));
  const queue = files.filter((p) => isRoot(p));
  while (queue.length) {
    const p = queue.pop();
    if (cage.has(p)) continue;
    cage.add(p);
    if (!CODE.test(p)) continue;
    const raw = read(p);
    if (raw === null) return null;
    const text = uncommented(raw);
    if (OPAQUE.test(text)) return null;
    for (const spec of importsOf(p, text)) {
      const dep = spec.replace(/\/+$/, '') || '.';
      if (allowed(p, dep)) continue;
      if (known.has(dep)) {
        if (!cage.has(dep)) queue.push(dep);
        continue;
      }
      // A folder found by path: everything under it.
      const under = files.filter((f) => f.startsWith(`${dep}/`));
      if (!under.length) return null;
      for (const f of under) if (!cage.has(f)) queue.push(f);
    }
  }
  return cage;
}
