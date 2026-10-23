import { join } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { loadConfig, globalConfigPath } from '../../config/load.js';
import { openStore, repoIdentity } from '../../store/home.js';
import { checkPrivateFile } from '../../store/files.js';

// mirai config check|show (unit 03b). Reads the project config of the current folder and your
// global personal config, plus your per-repo personal file (`store/config.user.toml`) when
// this repo has a store (unit 05a).
export default {
  name: 'config',
  summary: 'Check the config, or show the effective config',
  usage: 'mirai config <check|show> [--sources]',
  positionals: { min: 1, max: 1 },
  options: {
    sources: { type: 'boolean', description: 'with show: where each value comes from' },
  },
  run(args, io) {
    const [action] = args.positionals;
    if (action !== 'check' && action !== 'show') {
      throw new UsageError(`unknown action "${action}"`, 'see: mirai config --help');
    }
    if (args.values.sources && action !== 'show') {
      throw new UsageError('--sources works with "show" only', 'see: mirai config --help');
    }
    const globalFile = io.env.HOME ? globalConfigPath(io.env.HOME) : join('/nonexistent', 'config.toml');
    const personalRepoFile = personalRepoConfig(io);
    const { config, sources, warnings } = loadConfig({ projectRoot: io.cwd, personalRepoFile, globalFile });

    if (action === 'check') {
      const fromGlobal = Object.values(sources).some((s) => s.source.startsWith('~/'));
      const where = (s) => (s.line ? `${s.source}:${s.line}` : s.source);
      io.stdout.write(`config OK (project${fromGlobal ? ' + global' : ''})\n`);
      io.stdout.write(`models: ${['light', 'standard', 'deep'].map((t) => `${t} = ${config.models[t]} (${where(sources[`models.${t}`])})`).join(', ')}\n`);
      for (const w of warnings) io.stdout.write(`warning: ${w.message}\n`);
      return EXIT.OK;
    }
    const out = args.values.sources
      ? { config, sources: Object.fromEntries(Object.entries(sources).map(([k, s]) => [k, s.line ? `${s.source}:${s.line}:${s.column}` : s.source])) }
      : config;
    io.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return EXIT.OK;
  },
};

// Your per-repo personal file, `store/config.user.toml`, or undefined. When this repo's
// identity can't be worked out (not a git repo, a shallow CI clone, no commits yet, an odd
// remote, no git), there is no per-repo file, and the project file's own problems are reported
// by loadConfig. A store that exists but fails its checks (mode, owner, a second checkout, an
// id that changed) is an error. The file gets the store's checks: real, yours, private.
function personalRepoConfig(io) {
  let identity;
  try {
    identity = repoIdentity({ cwd: io.cwd, env: io.env });
  } catch (err) {
    if (err instanceof MiraiError) return undefined;
    throw err;
  }
  if (!io.env.HOME) return undefined;
  const store = openStore({ cwd: io.cwd, env: io.env, optional: true, identity });
  if (!store) return undefined;
  const file = join(store.dir, 'config.user.toml');
  return checkPrivateFile(file) ? file : undefined;
}
