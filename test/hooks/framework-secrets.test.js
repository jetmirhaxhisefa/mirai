import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRegistry } from '../../src/config/registry.js';

// MIRAI's own framework files never trip MIRAI's secret scan (found 2026-11-15: the 29b refresh's
// push was blocked by keys.js holding a key header in a pattern). init copies src/, bin/ and
// registry/ into every project, and the pre-push hook scans what a push adds with these patterns.

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...files(p));
    else if (s.isFile()) out.push(p);
  }
  return out;
}

test('MIRAI\'s framework files hold nothing its own secret patterns match', () => {
  const registry = loadRegistry(join(ROOT, 'registry'));
  const patterns = Object.values(registry.secrets ?? {}).flatMap((d) => d.patterns).map((p) => ({ name: p.name, re: new RegExp(p.regex, 'u') }));
  assert.ok(patterns.some((p) => p.name === 'private-key'), 'the patterns are read');
  const hits = [];
  for (const dir of ['src', 'bin', 'registry']) {
    for (const f of files(join(ROOT, dir))) {
      const text = readFileSync(f, 'utf8');
      for (const p of patterns) if (p.re.test(text)) hits.push(`${relative(ROOT, f)}: ${p.name}`);
    }
  }
  assert.deepEqual(hits, []);
});
