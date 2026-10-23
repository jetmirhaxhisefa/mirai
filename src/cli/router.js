import { parseArgs } from 'node:util';
import { UsageError } from './errors.js';

// Checks every command module against the contract and returns them by name.
// The list is passed in explicitly; nothing is discovered from the file system.
export function createRouter(commands) {
  const byName = new Map();
  for (const cmd of commands) {
    validate(cmd);
    if (byName.has(cmd.name)) {
      throw new Error(`command "${cmd.name}" is registered twice`);
    }
    byName.set(cmd.name, cmd);
  }

  return {
    get: (name) => byName.get(name),
    list: () => [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unknown: (name) => {
      const near = closest(name, [...byName.keys()]);
      return new UsageError(
        `unknown command "${name}"`,
        near ? `did you mean "${near}"?` : 'see: mirai --help',
      );
    },
  };
}

function validate(cmd) {
  const label = cmd?.name ?? '<unnamed>';
  for (const key of ['name', 'summary', 'usage']) {
    if (typeof cmd?.[key] !== 'string' || cmd[key] === '') {
      throw new Error(`command module "${label}" is missing "${key}"`);
    }
  }
  if (typeof cmd.run !== 'function') {
    throw new Error(`command module "${label}" is missing "run"`);
  }
  // -h/--help belong to the CLI; a command can't take them over.
  for (const [flag, spec] of Object.entries(cmd.options ?? {})) {
    if (flag === 'help' || spec?.short === 'h') {
      throw new Error(`command module "${label}" redefines the built-in --help/-h`);
    }
  }
  const { min = 0, max = 0 } = cmd.positionals ?? {};
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
    throw new Error(`command module "${label}" has an invalid "positionals" range`);
  }
}

// Strict parsing: an unknown flag, a wrong value or a wrong number of arguments is a
// usage error. Any other error is a bug in the command definition and passes through.
export function parseCommandArgs(cmd, argv) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: { help: { type: 'boolean', short: 'h' }, ...(cmd.options ?? {}) },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    if (!String(err.code).startsWith('ERR_PARSE_ARGS_')) throw err;
    throw new UsageError(shortParseMessage(err), `see: mirai ${cmd.name} --help`);
  }
  if (args.values.help) return args;

  const { min = 0, max = 0 } = cmd.positionals ?? {};
  const n = args.positionals.length;
  if (n > max) {
    const extra = args.positionals.slice(max).map((p) => `"${p}"`).join(', ');
    throw new UsageError(`unexpected argument ${extra}`, `see: mirai ${cmd.name} --help`);
  }
  if (n < min) {
    throw new UsageError(`missing argument (needs at least ${min})`, `see: mirai ${cmd.name} --help`);
  }
  return args;
}

// Node's parseArgs messages are long; keep the one fact the user needs.
function shortParseMessage(err) {
  const flag = /'([^']+)'/.exec(err.message)?.[1];
  if (err.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && flag) return `unknown option "${flag}"`;
  return err.message.split('\n')[0];
}

// The registered name within edit distance 2, if exactly one is closest.
function closest(name, names) {
  let best = null;
  let bestDist = 3;
  let tie = false;
  for (const candidate of names) {
    const d = distance(name, candidate);
    if (d < bestDist) {
      best = candidate;
      bestDist = d;
      tie = false;
    } else if (d === bestDist) {
      tie = true;
    }
  }
  return tie ? null : best;
}

function distance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}
