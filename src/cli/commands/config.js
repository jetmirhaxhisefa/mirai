import { join } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { loadConfig, globalConfigPath } from '../../config/load.js';

// mirai config check|show (unit 03b). Reads the project config of the current folder and your
// global personal config. The per-repo personal file joins when the MIRAI home exists (unit 05).
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
    const { config, sources, warnings } = loadConfig({ projectRoot: io.cwd, globalFile });

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
