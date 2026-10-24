import { EXIT } from '../exit-codes.js';
import { render } from '../../install/render.js';

// mirai render (units 10, 11). Renders MIRAI's files again from the installed framework copy plus
// .mirai/config.toml and .mirai/context/agents-local.md, and updates their lock entries: the
// blocks in AGENTS.md and CLAUDE.md, and the skills and agents under .claude/. Run it after
// changing either file. Nothing outside MIRAI's parts changes.
export default {
  name: 'render',
  summary: 'Render MIRAI\'s files again from your config and instructions',
  usage: 'mirai render',
  positionals: { min: 0, max: 0 },
  options: {},
  run(args, io) {
    const r = render({ cwd: io.cwd, env: io.env });
    for (const w of r.warnings) io.stderr.write(`warning: ${w}\n`);
    for (const f of r.files) {
      if (f.edited) io.stderr.write(`warning: ${f.path}: MIRAI's part had been edited by hand; it is rendered again\n`);
      io.stdout.write(`${f.path}: ${f.changed ? 'rendered again' : 'unchanged'}\n`);
    }
    for (const path of r.removed) io.stdout.write(`${path}: removed\n`);
    if (r.files.some((f) => f.changed) || r.removed.length) io.stdout.write(`Review and commit the change, with ${r.lockFile}.\n`);
    return EXIT.OK;
  },
};
