import { join } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { plain, shown } from '../../status/text.js';
import { topLevel } from '../../store/git.js';
import { customAdd } from '../../setup/custom-add.js';
import { fullName } from '../../agent/names.js';

// mirai custom add <path> (unit 39, Scope 6; decision 6): moves one AI item into .mirai/custom/,
// deletes the original, and ends with the next steps and the item's full path. It refuses an item
// that fails the static checks, naming the check; nothing moves then. Also /mirai custom add.

const shellWord = (w) => (/^[A-Za-z0-9_./~@%+=:,-]+$/.test(w) ? w : `'${String(w).replaceAll("'", "'\\''")}'`);

export default {
  name: 'custom',
  summary: 'Move a skill, agent, command, hook, script or MCP server into .mirai/custom/, for your approval',
  usage: 'mirai custom add <path> [--as <skill|mirai-developer|mirai-reviewer|mirai-verifier|interactive|check|both>] [--role <role>] [--hook <event>] [--matcher <tools>] [--server <name>] [--service <service>]',
  positionals: { min: 2, max: 2 },
  options: {
    as: { type: 'string', description: 'an agent: the MIRAI agent it becomes an overlay of, or skill; a hook: interactive (default), check or both' },
    role: { type: 'string', description: 'an agent kept as an overlay: its role (a project role in .mirai/custom/roles/)' },
    hook: { type: 'string', description: 'a script that a hook runs: the hook\'s event (PreToolUse, PostToolUse, …)' },
    matcher: { type: 'string', description: 'with --hook: the tools it matches, such as "Edit|Write"' },
    server: { type: 'string', description: 'with .mcp.json: the server to move' },
    service: { type: 'string', description: 'a hook kept as a check: the compose service it runs in' },
  },
  run(args, io) {
    const [action, path] = args.positionals;
    if (action !== 'add') throw new UsageError(`unknown action ${shown(action)}`, 'run: mirai custom add <path>');
    const root = topLevel(io.cwd);
    if (!root) throw new UsageError('this folder is not inside a git repository');
    const v = args.values;
    const r = customAdd({ root, cwd: io.cwd, path, opts: { as: v.as, role: v.role, event: v.hook, matcher: v.matcher, server: v.server, service: v.service } });
    const say = (s) => io.stdout.write(`${plain(s)}\n`);
    say(`moved: ${r.from} -> ${r.to.join(', ')} (${r.kind}${r.kind === 'agent' ? `, an overlay of ${r.name}` : ''})`);
    for (const p of r.removed) say(`deleted: ${p}`);
    for (const p of r.edited) say(`changed: ${p} (the item taken out of it)`);
    for (const f of (r.item.flags ?? []).slice(0, 10)) say(`flagged: line ${f.line}: ${f.pattern} (${f.text})`);
    if (r.widening) say(`it widens ${fullName(r.name) ?? r.name} (${r.widening.join(', ')}): once approved, its launches are refused until a red-team run covers it (mirai redteam run)`);
    if (r.checkLine) {
      say('as a check: add this line under [checks] in .mirai/config.toml (it runs in the sandbox, at the build\'s checks step):');
      say(`  ${r.checkLine}`);
    }
    // F11 + F7: the exact commands, with the Claude Code config this runs under (a session's).
    const cfg = io.env?.CLAUDE_CONFIG_DIR ? `CLAUDE_CONFIG_DIR=${shellWord(io.env.CLAUDE_CONFIG_DIR)} ` : '';
    say('next:');
    say(`  1. read it, then in your terminal: ${cfg}mirai approve --file ${r.main}`);
    say(`  2. ${cfg}mirai render${r.kind === 'script' ? '   (nothing renders for a script; a hook or a check calls it)' : '   (it reaches your sessions\' folders only once approved)'}`);
    say(`  3. commit together: ${[...r.to, ...r.removed, ...r.edited].join(' ')} ${r.record} .claude/ .mirai/mirai.lock${r.kind === 'mcp' ? ' .mcp.json' : ''}`);
    say('Until you approve it, it isn\'t used.');
    say(join(root, r.main));
    return EXIT.OK;
  },
};
