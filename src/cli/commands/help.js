import { EXIT } from '../exit-codes.js';

// Help is built per router, so it lists exactly the commands that exist.
export function createHelp(getRouter) {
  return {
    name: 'help',
    summary: 'Show all commands, or one command in detail',
    usage: 'mirai help [command]',
    positionals: { min: 0, max: 1 },
    run(args, io) {
      const router = getRouter();
      const [name] = args.positionals;
      if (name === undefined) {
        io.stdout.write(overview(router));
        return EXIT.OK;
      }
      const cmd = router.get(name);
      if (!cmd) throw router.unknown(name);
      io.stdout.write(detail(cmd));
      return EXIT.OK;
    },
  };
}

export function overview(router) {
  const cmds = router.list();
  const width = Math.max(...cmds.map((c) => c.name.length));
  const rows = cmds.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`);
  return [
    'Usage: mirai <command> [options]',
    '',
    'Commands:',
    ...rows,
    '',
    'Run "mirai help <command>" for details.',
    '',
  ].join('\n');
}

export function detail(cmd) {
  const lines = [`Usage: ${cmd.usage}`, '', cmd.summary, '', 'Options:'];
  for (const [flag, spec] of Object.entries(cmd.options ?? {})) {
    const short = spec.short ? `-${spec.short}, ` : '';
    const value = spec.type === 'string' ? ' <value>' : '';
    const text = spec.description ? `  ${spec.description}` : '';
    lines.push(`  ${short}--${flag}${value}${text}`);
  }
  lines.push('  -h, --help  Show this help', '');
  return lines.join('\n');
}
