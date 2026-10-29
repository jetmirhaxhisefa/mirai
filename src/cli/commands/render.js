import { EXIT } from '../exit-codes.js';
import { render } from '../../install/render.js';
import { openStore } from '../../store/home.js';
import { snapshot } from '../../trust/snapshot.js';
import { install, status } from '../../mcp/session.js';

// mirai render (units 10, 11). Renders MIRAI's files again from the installed framework copy plus
// .mirai/config.toml and .mirai/context/agents-local.md, and updates their lock entries: the
// blocks in AGENTS.md and CLAUDE.md, and the skills and agents under .claude/. Run it after
// changing either file. Nothing outside MIRAI's parts changes. In a terminal it also checks
// MIRAI's server for your own Claude Code sessions, and registers it again when it's behind.

// Only a registration MIRAI made and that's now behind is made again: registering is yours to
// choose (`mirai session-server install`), and `remove` lasts (review).
function registerSessionServer(io) {
  try {
    const store = openStore({ cwd: io.cwd, env: io.env });
    const trust = snapshot({ cwd: io.cwd, env: io.env });
    const s = status({ store, env: io.env, trust, timeout: 15_000 });
    if (s.state !== 'stale') return;
    const r = install({ store, trust, env: io.env, timeout: 15_000 });
    io.stdout.write(r.done ? `MIRAI's server for your sessions: registered again (trust root ${trust.baseSha.slice(0, 12)}); start a new session to use it\n`
      : `MIRAI's server for your sessions: run: ${r.command}\n`);
  } catch (err) {
    io.stderr.write(`note: MIRAI's server for your sessions wasn't registered (${err.message}); once MIRAI is committed on the integration branch, run: mirai session-server install\n`);
  }
}
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
    // In your terminal (never in a script or a test): MIRAI's server for your own sessions,
    // registered again when the integration branch has moved (unit 15b). A failure here never
    // fails the render.
    if (io.stdout.isTTY) registerSessionServer(io);
    return EXIT.OK;
  },
};
