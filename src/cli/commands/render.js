import { EXIT } from '../exit-codes.js';
import { render } from '../../install/render.js';

// mirai render (unit 10). Renders MIRAI's block in AGENTS.md again, from the installed framework
// copy plus .mirai/config.toml and .mirai/context/agents-local.md, and updates its lock entry.
// Run it after changing either file. Nothing outside the block changes.
export default {
  name: 'render',
  summary: 'Render MIRAI\'s block in AGENTS.md again from your config and instructions',
  usage: 'mirai render',
  positionals: { min: 0, max: 0 },
  options: {},
  run(args, io) {
    const r = render({ cwd: io.cwd, env: io.env });
    for (const w of r.warnings) io.stderr.write(`warning: ${w}\n`);
    for (const f of r.files) {
      if (f.edited) io.stderr.write(`warning: ${f.path}: the MIRAI block had been edited by hand; it is rendered again\n`);
      io.stdout.write(`${f.path}: ${f.changed ? 'rendered again' : 'unchanged'}\n`);
    }
    if (r.files.some((f) => f.changed)) io.stdout.write(`Review and commit the change, with ${r.lockFile}.\n`);
    return EXIT.OK;
  },
};
