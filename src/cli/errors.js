import { EXIT } from './exit-codes.js';
import { escapeInvisible } from '../status/text.js';

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

// A status move that isn't allowed, or that the mover may not make (unit 04). Exit code 4,
// "refused by a gate or safety rule". `code` is stable: not-allowed, derived, human-only,
// missing, replan-limit, mismatch, unknown-state.
export class StatusError extends MiraiError {
  constructor(message, { machine, item, from, to, code } = {}) {
    super(message, EXIT.BLOCKED);
    this.name = 'StatusError';
    this.machine = machine;
    this.item = item;
    this.from = from;
    this.to = to;
    this.code = code;
  }
}

// The orchestrator store or the repo around it is wrong (unit 05): a corrupt line, a counter
// behind the journal, a wrong owner or mode, a second checkout, no store yet. Exit code 3, like
// a config error: the setup or its files need fixing. `code` is stable; `hint` often names
// `mirai doctor`. A refusal (a lock held too long, a stale write) passes `exitCode: BLOCKED`.
export class StoreError extends MiraiError {
  constructor(message, { path, line, code, hint, exitCode = EXIT.CONFIG } = {}) {
    super(message, exitCode);
    this.name = 'StoreError';
    this.path = path;
    this.line = line;
    this.code = code;
    this.hint = hint;
  }
}

// Anything thrown (even `throw null` or a string) becomes an Error, so the
// error path itself can never crash.
export function toError(thrown) {
  if (thrown instanceof Error) return thrown;
  return new Error(thrown === undefined || thrown === null ? 'unknown error' : String(thrown));
}

// Messages can carry paths and names from files (a folder name, a checkout path); control and
// invisible characters in them are escaped, so nothing reaches the terminal raw (unit 05a).
const clean = (text) => escapeInvisible(String(text)).replace(/[\u0000-\u001f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

// One line for the user; the stack (without the repeated message) only when MIRAI_DEBUG=1.
export function formatError(err, env) {
  const lines = [`mirai: ${clean(String(err.message).split('\n')[0])}`];
  if (err.hint) lines.push(clean(err.hint));
  for (const e of err.listed ? err.errors : []) {
    lines.push(clean(`${e.source}:${e.line}:${e.column}: ${e.reason}`));
    if (e.hint) lines.push(`  hint: ${clean(e.hint)}`);
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
