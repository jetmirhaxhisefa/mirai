import { EXIT } from './exit-codes.js';

// An expected failure with a known exit code. The message is shown to the user as one line.
export class MiraiError extends Error {
  constructor(message, exitCode = EXIT.FAILURE) {
    super(message);
    this.name = 'MiraiError';
    this.exitCode = exitCode;
  }
}

// Wrong command, flag or argument.
export class UsageError extends MiraiError {
  constructor(message, hint) {
    super(message, EXIT.USAGE);
    this.name = 'UsageError';
    this.hint = hint;
  }
}

// A config or definition file is missing, unreadable or invalid.
// - `message` is one line: `<source>:<line>:<column>: <reason>` (position when there is one);
// - `reason` is the problem without the position; `hint` is printed on its own line;
// - `line` and `column` are 1-based; `path` is the key path (`git.branch`) when known;
// - `code` is a stable name for the kind of problem (`syntax`, `required`, `credential`, …);
// - `errors` always lists the problems as `{ code, source, line, column, path, reason, hint }`:
//   one entry for a single problem, all of them when several were collected (`listed`).
export class ConfigError extends MiraiError {
  constructor(message, { source, line, column, reason, hint, path, code, errors } = {}) {
    super(message, EXIT.CONFIG);
    this.name = 'ConfigError';
    this.source = source;
    this.line = line;
    this.column = column;
    this.reason = reason ?? message;
    this.hint = hint;
    this.path = path;
    this.code = code ?? (errors ? 'problems' : line ? 'syntax' : 'file');
    this.listed = Array.isArray(errors);
    this.errors = errors ?? [{ code: this.code, source, line, column, path, reason: this.reason, hint }];
  }
}

// Anything thrown (even `throw null` or a string) becomes an Error, so the
// error path itself can never crash.
export function toError(thrown) {
  if (thrown instanceof Error) return thrown;
  return new Error(thrown === undefined || thrown === null ? 'unknown error' : String(thrown));
}

// One line for the user; the stack (without the repeated message) only when MIRAI_DEBUG=1.
export function formatError(err, env) {
  const lines = [`mirai: ${String(err.message).split('\n')[0]}`];
  if (err.hint) lines.push(err.hint);
  for (const e of err.listed ? err.errors : []) {
    lines.push(`${e.source}:${e.line}:${e.column}: ${e.reason}`);
    if (e.hint) lines.push(`  hint: ${e.hint}`);
  }
  if (env.MIRAI_DEBUG === '1' && err.stack) {
    const frames = err.stack.split('\n').filter((l) => /^\s+at /.test(l));
    lines.push(...frames);
  }
  return lines.join('\n') + '\n';
}

export function exitCodeOf(err) {
  return Number.isInteger(err.exitCode) ? err.exitCode : EXIT.FAILURE;
}
