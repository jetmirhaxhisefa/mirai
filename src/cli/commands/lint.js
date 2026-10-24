import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { escapeInvisible } from '../../status/text.js';
import { readConfigFile, checkConfig, PROJECT_CONFIG } from '../../config/load.js';
import { loadRegistry } from '../../config/registry.js';
import { frameworkDefaults } from '../../config/defaults.js';
import { topLevel, lsFiles } from '../../store/git.js';
import { lintPaths, LintPathError } from '../../lint/lint.js';

// mirai lint [<path>...] [--json] (unit 07b). Checks the shape of MIRAI documents and writes
// nothing. Exit 0 when clean (warnings allowed), 1 with problems, 2 on a usage error, 3 on a
// broken registry or config.

// MIRAI's own definitions, shipped with it. The command takes no flag or environment variable
// for another registry, so nothing can point a real run at a looser one; tests build the
// command with a fixture registry.
export const REGISTRY_DIR = fileURLToPath(new URL('../../../registry/', import.meta.url));

const clean = (text) => escapeInvisible(String(text)).replace(/[\u0000-\u001f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function createLintCommand({ registryDir = REGISTRY_DIR } = {}) {
  return {
    name: 'lint',
    summary: 'Check the shape of MIRAI documents (frontmatter, sections, IDs, links)',
    usage: 'mirai lint [<path>...] [--json]',
    positionals: { min: 0, max: 100_000 },
    options: {
      json: { type: 'boolean', description: 'print the result as JSON' },
    },
    run(args, io) {
      const top = gitTop(io);
      const root = top ?? io.cwd;
      if (!top && args.positionals.length === 0) {
        throw new UsageError('not inside a git repo, so name the files or folders to lint', 'for example: mirai lint docs/');
      }
      const { docsRoot, project } = projectSettings(root);
      const registry = loadRegistry(registryDir);
      // In a git repo, the files are git's list: tracked and new ones, without what
      // .gitignore excludes.
      const files = top ? lsFiles(top, ['.'], io.env) : null;
      if (top && files === null) throw new MiraiError("git couldn't list the repo's files", EXIT.FAILURE);
      let result;
      try {
        result = lintPaths({ root, paths: args.positionals.map((p) => resolve(io.cwd, p)), files, registry, docsRoot, project });
      } catch (err) {
        if (err instanceof LintPathError) throw new UsageError(clean(err.message), 'lint files or folders inside the repo');
        throw err;
      }
      const errors = result.problems.filter((p) => p.severity === 'error').length;
      const warnings = result.problems.length - errors;
      if (args.values.json) {
        // Escaped like the text output, so a file name or heading can't reach a CI log raw.
        const data = { schema_version: 1, files: result.files, skipped: result.skipped, errors, warnings, problems: result.problems };
        io.stdout.write(`${escapeInvisible(JSON.stringify(data, null, 2))}\n`);
      } else {
        for (const p of result.problems) {
          io.stdout.write(clean(`${p.file}:${p.line}:${p.column}: ${p.severity === 'warning' ? 'warning: ' : ''}${p.reason}`) + '\n');
          if (p.hint) io.stdout.write(`  hint: ${clean(p.hint)}\n`);
        }
        io.stdout.write(`${plural(result.files, 'file')}, ${plural(errors, 'problem')}, ${plural(warnings, 'warning')}, ${result.skipped} skipped\n`);
      }
      return errors > 0 ? EXIT.FAILURE : EXIT.OK;
    },
  };
}

export default createLintCommand();

// The checkout's top folder, or null outside git (or without git).
function gitTop(io) {
  try {
    return topLevel(io.cwd, io.env);
  } catch (err) {
    if (err instanceof MiraiError) return null;
    throw err;
  }
}

// `[docs] root` and the repo names from the project config, or the defaults before
// `mirai init`. Only the project layer is read: both are team policy, which personal files
// can't change.
function projectSettings(root) {
  let config = frameworkDefaults();
  if (existsSync(join(root, PROJECT_CONFIG))) {
    const file = readConfigFile(join(root, PROJECT_CONFIG), { trust: 'project', source: PROJECT_CONFIG, within: root });
    config = checkConfig([{ kind: 'project', file }]).config;
  }
  return { docsRoot: config.docs.root, project: { repos: config.repos.map((r) => r.name) } };
}
