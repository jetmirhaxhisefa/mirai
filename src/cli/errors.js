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
  if (env.MIRAI_DEBUG === '1' && err.stack) {
    const frames = err.stack.split('\n').filter((l) => /^\s+at /.test(l));
    lines.push(...frames);
  }
  return lines.join('\n') + '\n';
}

export function exitCodeOf(err) {
  return Number.isInteger(err.exitCode) ? err.exitCode : EXIT.FAILURE;
}
