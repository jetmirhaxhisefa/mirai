import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { shown } from '../../status/text.js';
import { openStore } from '../../store/home.js';
import { snapshot } from '../../trust/snapshot.js';
import { install, remove, sessionDir, status } from '../../mcp/session.js';

// mirai session-server install | remove | status (unit 15b; D-53): MIRAI's MCP server in your own
// Claude Code sessions in this project (lint, log_event, run_tests, run_check). `install`
// registers it at Claude Code's local scope (yours, this project only) through Claude Code's own
// CLI, from the integration branch's trust root, and adds the tools' allow rules to your
// .claude/settings.local.json; `remove` takes both out again. `mirai render`, in a terminal,
// registers again only a registration that's behind.

const STATES = {
  current: 'registered, for the current trust root',
  stale: 'registered, but behind (an older trust root or policy, or it can\'t start); run: mirai session-server install',
  missing: 'not registered for this project folder; to use it: mirai session-server install',
  foreign: 'Claude Code has a server named mirai here that MIRAI didn\'t register; see: claude mcp get mirai',
  unknown: 'claude isn\'t on your PATH, or didn\'t answer, so MIRAI can\'t ask Claude Code',
};

export default {
  name: 'session-server',
  summary: 'Register MIRAI\'s MCP server for your own Claude Code sessions here',
  usage: 'mirai session-server <install|remove|status>',
  positionals: { min: 1, max: 1 },
  options: {},
  run(args, io) {
    const [action] = args.positionals;
    if (!['install', 'remove', 'status'].includes(action)) throw new UsageError(`unknown action ${shown(action)}`, 'see: mirai session-server --help');
    const store = openStore({ cwd: io.cwd, env: io.env });
    if (action === 'install') {
      const trust = snapshot({ cwd: io.cwd, env: io.env });
      const r = install({ store, trust, env: io.env });
      io.stdout.write(r.done
        ? `registered MIRAI's server for your sessions in this project (Claude Code, local scope), from the trust root at ${trust.baseSha.slice(0, 12)}\n  tools: ${Object.keys(r.policy.tools).join(', ')}\n  start a new Claude Code session to use it\n`
        : `claude isn't on your PATH; to register MIRAI's server, run:\n  ${r.command}\n`);
      if (r.note) io.stderr.write(`note: ${r.note}\n`);
      return EXIT.OK;
    }
    if (action === 'remove') {
      const r = remove({ store, env: io.env });
      io.stdout.write(r.done ? 'removed MIRAI\'s server from your sessions in this project\n'
        : r.absent ? 'MIRAI\'s server wasn\'t registered for this project folder\n'
          : `claude isn't on your PATH; to remove MIRAI's server, run:\n  ${r.command}\n`);
      if (r.note) io.stderr.write(`note: ${r.note}\n`);
      return EXIT.OK;
    }
    const trust = snapshot({ cwd: io.cwd, env: io.env });
    const s = status({ store, env: io.env, trust });
    io.stdout.write([
      `MIRAI's server for your sessions: ${STATES[s.state]}`,
      ...(s.base ? [`  registered from the trust root at ${s.base.slice(0, 12)}${s.behind ? `; the integration branch is now at ${trust.baseSha.slice(0, 12)}` : ''}`] : []),
      ...(s.connected === false ? ['  Claude Code can\'t start it now (see: claude mcp get mirai)'] : []),
      `  policies: ${sessionDir(store)}/`,
      '',
    ].join('\n'));
    return s.state === 'current' ? EXIT.OK : EXIT.NEEDS_HUMAN;
  },
};
