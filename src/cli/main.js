import { EXIT } from './exit-codes.js';
import { UsageError, MiraiError, exitCodeOf, formatError, toError } from './errors.js';
import { createRouter, parseCommandArgs } from './router.js';
import { createHelp, detail, overview } from './commands/help.js';
import { VERSION } from './commands/version.js';
import { COMMANDS } from './commands/index.js';

export { COMMANDS };

// Runs one CLI invocation and returns its exit code. `io` holds stdout, stderr, env and cwd,
// so nothing here touches the process directly.
export async function main(argv, io, commands = COMMANDS) {
  try {
    let router;
    const help = createHelp(() => router);
    router = createRouter([help, ...commands]);

    const [first, ...rest] = argv;
    if (first === undefined || first === '--help' || first === '-h') {
      noTrailing(rest, '--help');
      io.stdout.write(overview(router));
      return EXIT.OK;
    }
    if (first === '--version') {
      noTrailing(rest, '--version');
      io.stdout.write(`${VERSION}\n`);
      return EXIT.OK;
    }
    if (first.startsWith('-')) {
      throw new UsageError(`unknown option "${first}"`, 'see: mirai --help');
    }

    const cmd = router.get(first);
    if (!cmd) throw router.unknown(first);

    const args = parseCommandArgs(cmd, rest);
    if (args.values.help) {
      io.stdout.write(detail(cmd));
      return EXIT.OK;
    }
    const code = await cmd.run(args, io);
    // Fail closed: a command that forgets its exit code must never look like success.
    if (!Number.isInteger(code)) {
      throw new MiraiError(`command "${cmd.name}" returned no exit code`, EXIT.FAILURE);
    }
    return code;
  } catch (thrown) {
    const err = toError(thrown);
    io.stderr.write(formatError(err, io.env));
    return exitCodeOf(err);
  }
}

function noTrailing(rest, flag) {
  if (rest.length > 0) {
    throw new UsageError(`unexpected argument "${rest[0]}" after ${flag}`, 'see: mirai --help');
  }
}
