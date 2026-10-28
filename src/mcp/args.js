import { lstatSync } from 'node:fs';
import { join } from 'node:path';

import { TestRunError } from '../tests/docker.js';

// The argument rules for test runs (unit 14d; D-48, R3-M6, TL3-17): what `run_tests` and
// `mirai test --path` accept, checked before anything runs, and the path checked again against
// the copy, the tree that actually runs.
//
// A path is a file or folder only: it never starts with "-" or "/", has no space, quote, "$",
// ";", "|", backquote or newline, and no "." or ".." part. Test IDs with ":" (a runner's filter)
// wait for unit 16's adapters, which know each runner's escaping.

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
