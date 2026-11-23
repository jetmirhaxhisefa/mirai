import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SCHEMA_DIR } from '../findings/verdicts.js';

// Vera's findings schema as Claude Code's --json-schema takes it (unit 40): the registry's file with
// its `$defs` inlined and its `$schema` and `$id` left out, as Rex's verdict is passed (24a). MIRAI
// checks the result against the file itself afterwards (src/verify/findings.js).
function inline(node, defs) {
  if (Array.isArray(node)) return node.map((n) => inline(n, defs));
  if (node === null || typeof node !== 'object') return node;
  if (typeof node.$ref === 'string') {
    const m = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(node.$ref);
    if (!m || !Object.hasOwn(defs, m[1])) throw new TypeError(`the verifier's findings schema refers to ${node.$ref}`);
    return inline(defs[m[1]], defs);
  }
  return Object.fromEntries(Object.entries(node).filter(([k]) => !['$schema', '$id', '$defs'].includes(k)).map(([k, v]) => [k, inline(v, defs)]));
}

export const VERIFY_SCHEMA = Object.freeze((() => {
  const file = JSON.parse(readFileSync(join(SCHEMA_DIR, 'verify-findings.json'), 'utf8'));
  return inline(file, file.$defs ?? {});
})());
