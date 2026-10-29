import { lstatSync } from 'node:fs';
import { join } from 'node:path';

import { TestRunError } from '../tests/docker.js';

// The argument rules for test runs (unit 14d; D-48, R3-M6, TL3-17): what `run_tests` and
// `mirai test --path` accept, checked before anything runs, and the path checked again against
// the copy, the tree that actually runs.
//
// A path is a file or folder only: it never starts with "-" or "/", has no space, quote, "$",
// ";", "|", backquote or newline, and no "." or ".." part.
//
// A test ID (unit 16a) is `<path>::<name>`: the file by the path's rules, and the test's name as
// its runner reports it, as plain printable text. A level's test adapter (src/tests/adapters.js)
// passes the name to the runner as one argument, escaped for how that runner matches names.

export const PATH_MAX = 512;
export const PATH_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_./@-]*$/;

const refuse = (message, hint) => new TestRunError(message, { code: 'bad-path', hint: hint ?? 'pass a file or folder of the project, relative to its top, such as tests/' });

// The path's form. Returns it without a trailing "/".
export function checkPathForm(path) {
  if (typeof path !== 'string' || path === '') throw refuse('the path is empty');
  if (path.length > PATH_MAX) throw refuse(`the path is longer than ${PATH_MAX} characters`);
  if (!PATH_PATTERN.test(path)) throw refuse(`the path ${JSON.stringify(path.slice(0, 80))} has a character test runs don't take`, 'letters, digits and _ . / @ - only, not starting with "-" or "/"');
  const trimmed = path.replace(/\/+$/, '');
  const parts = trimmed.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) throw refuse(`the path ${path} has an empty, "." or ".." part`);
  return trimmed;
}

// Long enough for the nested and data-set names reports hold.
export const TEST_NAME_MAX = 1000;
export const TEST_ID_MAX = PATH_MAX + 2 + TEST_NAME_MAX;
// No control character (tab and newline included), format character (bidi marks and overrides,
// zero-width characters, the soft hyphen, tags), line or paragraph separator, or lone surrogate.
const NAME_BAD = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;
// Something visible: not only spaces, or fillers that render blank (Hangul fillers, the Braille
// blank).
const NAME_VISIBLE = /[^\s\p{Zs}\u115f\u1160\u2800\u3164\uffa0]/u;

// The ID's form: { path, name }. The path is checked as checkPathForm checks it.
export function checkTestId(id) {
  if (typeof id !== 'string' || id === '') throw refuse('the test ID is empty', 'a test ID is <file>::<test name>, such as tests/login.test::rejects a wrong password');
  const at = id.indexOf('::');
  if (at < 0) throw refuse('a test ID is <file>::<test name>', 'such as tests/login.test::rejects a wrong password; for a file or folder, pass path instead');
  const name = id.slice(at + 2);
  if (name.length < 1 || name.length > TEST_NAME_MAX) throw refuse(`the test name must be 1 to ${TEST_NAME_MAX} characters`);
  if (NAME_BAD.test(name) || !NAME_VISIBLE.test(name)) throw refuse('the test name has a control, format or invisible-only character', 'plain printable text, as the test runner reports the name');
  return { path: checkPathForm(id.slice(0, at)), name };
}

// The path in the copy: it must be there, as a plain file or folder, with no link along it.
export function checkPathInCopy(copyRoot, path) {
  const parts = path.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const rel = parts.slice(0, i).join('/');
    let info;
    try {
      info = lstatSync(join(copyRoot, rel));
    } catch {
      throw refuse(`${path} isn't in the project (or isn't committed or new; ignored files aren't copied)`);
    }
    if (info.isSymbolicLink()) throw refuse(`${rel} is a link`, 'pass the real file or folder');
    if (i < parts.length && !info.isDirectory()) throw refuse(`${rel} isn't a folder`);
    if (i === parts.length && !info.isDirectory() && !info.isFile()) throw refuse(`${path} is neither a file nor a folder`);
  }
}
