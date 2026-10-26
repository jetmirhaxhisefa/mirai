import { isAbsolute, join } from 'node:path';

import { StoreError } from '../cli/errors.js';

// The MIRAI home (unit 05a; D-47), in your user's Application Support, outside every project.
// Its own module (unit 14b) so the low-level store modules can use it without home.js's imports.
// `HOME` comes from the CLI's env, so tests use a temporary one. There is deliberately no
// MIRAI_HOME override: it would let MIRAI be pointed at a store someone else wrote.
export function miraiHome(env) {
  if (!env.HOME || !isAbsolute(env.HOME)) {
    throw new StoreError('HOME is not set to an absolute path', { code: 'no-home', hint: 'MIRAI keeps its store under ~/Library/Application Support/mirai' });
  }
  return join(env.HOME, 'Library', 'Application Support', 'mirai');
}
