import { lstatSync } from 'node:fs';
import { join } from 'node:path';

import { checkPathForm, PATH_MAX } from '../args.js';
import { lintPaths, LintPathError, projectOf } from '../../lint/lint.js';
import { lsFiles } from '../../store/git.js';
import { escapeInvisible } from '../../status/text.js';
import { trustedConfig, trustedRegistry } from '../../trust/snapshot.js';
import { trustedOverlays } from '../../trust/overlays.js';

// lint(paths?) (unit 15b; D-53): `mirai lint` for your own Claude Code session. The document
// rules, the [docs] root and the project's names come from the trust root (the integration
// branch's MIRAI), never from the work tree, so a branch can't loosen them; the files are the
// work tree's, as git lists them (pinned host git). Writes nothing. The paths take run_tests'
// form (no leading - or /, no . or .. parts). It runs in the server's event loop: a whole-project
// lint of a huge repo holds other calls (a log, a cancel) until it's done.

export const MAX_PATHS = 32;
// At most this many problems, and this many bytes of them, come back inline (an MCP reply has a
// size limit in Claude Code); the counts are always whole.
export const MAX_PROBLEMS = 500;
export const MAX_PROBLEM_BYTES = 32 * 1024;

const clean = (v) => (typeof v === 'string' ? escapeInvisible(v) : v);

// An agent run's lint (unit 41, A2): the paths it may name, or why not. Each a .md file under the
// docs root, no part starting with ".", a regular file reached through no link.
export function headlessRefusal(paths, docsRoot, checkout) {
  if (!paths.length) return 'name the documents to lint: an agent run lints files under the docs root, one by one';
  const root = String(docsRoot ?? 'docs/mirai').replace(/\/+$/, '');
  for (const p of paths) {
    if (!p.startsWith(`${root}/`) || !p.endsWith('.md')) return `${p} isn't a document under ${root}/: an agent run lints only those`;
    if (p.split('/').some((part) => part.startsWith('.'))) return `${p} has a part starting with ".": an agent run doesn't lint those`;
    let at = checkout;
    for (const part of p.split('/')) {
      at = join(at, part);
      let info;
      try {
        info = lstatSync(at);
      } catch {
        return `${p} doesn't exist`;
      }
      if (info.isSymbolicLink()) return `${p} leads through a symbolic link`;
    }
    if (!lstatSync(at).isFile()) return `${p} isn't a file`;
  }
  return null;
}

export default Object.freeze({
  name: 'lint',
  description: (policy) => (policy?.kind === 'headless'
    ? 'Check the shape and wording of MIRAI documents you write (frontmatter, sections, IDs, links, the writing rules) with the integration branch\'s rules: the same lint MIRAI runs after your launch. Give the documents\' paths under the docs root, such as docs/mirai/<initiative>/prd.md. Returns the problems found; changes nothing.'
    : 'Check the shape of MIRAI documents (frontmatter, sections, IDs, links) with the integration branch\'s rules. Give files or folders of the project, or nothing for the whole project. Returns the problems found; changes nothing.'),
  exclusive: false,
  // Unit 41 (Jet, 2026-11-23, A2): an agent run's server offers it too (Nora lints her draft inside
  // her launch). There it lints only Markdown files under the docs root, named one by one, with no
  // part starting with "." and no folder: only documents the agent may read and write anyway, never
  // a file the sandbox denies it (a `.env*` file is read-denied, and this server runs outside the
  // sandbox).
  contexts: Object.freeze(['headless', 'interactive']),
  enabled: (policy) => Boolean(policy.tools.lint),
  schema: () => ({
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        maxItems: MAX_PATHS,
        items: { type: 'string', maxLength: PATH_MAX, pattern: '^[A-Za-z0-9_][A-Za-z0-9_./@-]*$' },
        description: 'optional: files or folders, relative to the project\'s top',
      },
    },
    additionalProperties: false,
  }),
  check(args) {
    if (args.paths === undefined) return { args: { paths: [] } };
    if (!Array.isArray(args.paths) || args.paths.length > MAX_PATHS) return { refused: `paths must be a list of at most ${MAX_PATHS}` };
    const paths = [];
    for (const p of args.paths) {
      if (typeof p !== 'string') return { refused: 'each path must be a string' };
      try {
        paths.push(checkPathForm(p));
      } catch (err) {
        return { refused: err.message };
      }
    }
    return { args: { paths: [...new Set(paths)] } };
  },
  async run({ paths }, ctx) {
    const { policy, trust } = ctx;
    const config = trustedConfig(trust);
    if (policy.kind === 'headless') {
      const refused = headlessRefusal(paths, config.docs.root, policy.checkout);
      if (refused) return { body: { outcome: 'refused', code: 'bad-path', message: ctx.clean(escapeInvisible(refused)) }, isError: true };
    }
    // Unit 37: with the project's overlays from the trust root, approved as they are now (your
    // journal, when this registration knows the store).
    let registry = trustedRegistry(trust);
    let overlays = [];
    if (policy.store) {
      const store = { dir: policy.store.dir, repoId: policy.store.repo_id, checkout: policy.checkout, branch: trust.branch, gitEnv: { PATH: '/usr/bin:/bin', HOME: ctx.env?.HOME ?? policy.home } };
      const r = trustedOverlays(trust, store, { registry });
      registry = r.registry;
      overlays = r.skipped.map((x) => x.line);
    }
    const files = lsFiles(policy.checkout, ['.'], ctx.env);
    if (files === null) return { body: { outcome: 'env-fault', code: 'git', message: 'git couldn\'t list the project\'s files' }, isError: true };
    let result;
    try {
      result = lintPaths({ root: policy.checkout, paths: paths.map((p) => join(policy.checkout, p)), files, registry, docsRoot: config.docs.root, project: projectOf(config) });
    } catch (err) {
      if (err instanceof LintPathError) return { body: { outcome: 'refused', code: 'bad-path', message: ctx.clean(escapeInvisible(err.message)) }, isError: true };
      throw err;
    }
    const errors = result.problems.filter((p) => p.severity === 'error').length;
    const problems = [];
    let bytes = 0;
    for (const p of result.problems.slice(0, MAX_PROBLEMS)) {
      const shown = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, clean(v)]));
      bytes += Buffer.byteLength(JSON.stringify(shown));
      if (bytes > MAX_PROBLEM_BYTES) break;
      problems.push(shown);
    }
    return {
      // The trust root's base, so a result from a registration that's behind says which rules it used.
      body: { outcome: errors ? 'fail' : 'pass', trust_base: trust.baseSha ?? null, files: result.files, skipped: result.skipped, errors, warnings: result.problems.length - errors, problems, problems_truncated: problems.length < result.problems.length, ...(overlays.length ? { overlays_skipped: overlays.map(clean) } : {}) },
      isError: false,
    };
  },
});
