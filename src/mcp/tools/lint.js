import { join } from 'node:path';

import { checkPathForm, PATH_MAX } from '../args.js';
import { lintPaths, LintPathError, projectOf } from '../../lint/lint.js';
import { lsFiles } from '../../store/git.js';
import { escapeInvisible } from '../../status/text.js';
import { trustedConfig, trustedRegistry } from '../../trust/snapshot.js';

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

export default Object.freeze({
  name: 'lint',
  description: 'Check the shape of MIRAI documents (frontmatter, sections, IDs, links) with the integration branch\'s rules. Give files or folders of the project, or nothing for the whole project. Returns the problems found; changes nothing.',
  exclusive: false,
  contexts: Object.freeze(['interactive']),
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
    const registry = trustedRegistry(trust);
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
      body: { outcome: errors ? 'fail' : 'pass', trust_base: trust.baseSha ?? null, files: result.files, skipped: result.skipped, errors, warnings: result.problems.length - errors, problems, problems_truncated: problems.length < result.problems.length },
      isError: false,
    };
  },
});
