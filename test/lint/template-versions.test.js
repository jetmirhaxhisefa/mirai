import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRegistry } from '../../src/config/registry.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';

// Unit 37 (Jet's answer to Q5, "C", 2026-11-21): a document type's template text never changes
// without its template_version going up, since a project's replacement template was approved
// against a version and doctor compares. test/lint/template-versions.json holds each version's
// hash, every version kept; it's updated by hand, on purpose, when a template changes:
//   bump template_version in registry/document-types/<type>.toml, then add the new version's hash.
const MANIFEST = fileURLToPath(new URL('./template-versions.json', import.meta.url));

test('37: every document type\'s template text is the one its template_version recorded', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const registry = loadRegistry(REGISTRY_DIR);
  const problems = [];
  for (const [name, def] of Object.entries(registry.documentTypes)) {
    const hash = `sha256:${createHash('sha256').update(readFileSync(join(REGISTRY_DIR, def.template))).digest('hex')}`;
    const versions = manifest[name] ?? {};
    const v = String(def.template_version);
    if (!Object.hasOwn(versions, v)) problems.push(`${name}: version ${v} has no hash in test/lint/template-versions.json; add "${v}": "${hash}"`);
    else if (versions[v] !== hash) problems.push(`${name}: ${def.template} changed, but template_version is still ${v}; bump it in registry/document-types/${name}.toml and add the new version's hash`);
    for (const old of Object.keys(versions)) if (Number(old) > def.template_version) problems.push(`${name}: the manifest has version ${old}, newer than the type's ${v}`);
  }
  for (const name of Object.keys(manifest)) if (!Object.hasOwn(registry.documentTypes, name)) problems.push(`${name}: in the manifest, but no such type`);
  assert.deepEqual(problems, []);
});
