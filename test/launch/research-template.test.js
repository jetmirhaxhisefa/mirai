import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadRegistry } from '../../src/config/registry.js';
import { RESEARCH_TOOLS, renderStrict, researchTemplate, strictTemplate, webTemplate } from '../../src/launch/strict.js';
import { floorCheck } from '../../src/redteam/static.js';

// Unit 65b, T4: the research template, rendered.

const REPO = new URL('../../registry', import.meta.url).pathname;
const FACTS = {
  checkout: '/Users/dev/Projects/app', home: '/Users/dev', miraiHome: '/Users/dev/Library/Application Support/mirai',
  repoHome: '/Users/dev/Library/Application Support/mirai/app-0123456789ab', trustDir: '/Users/dev/Library/Application Support/mirai/app-0123456789ab/trust/abc',
  launchDir: '/Users/dev/Library/Application Support/mirai/app-0123456789ab/launches/L1', scratchDir: '/private/tmp/mirai-0a1b2c3d', envFiles: ['.env'], tracked: [],
  hooksPaths: [], userDirs: [], uid: 501, hookCommand: '"/usr/local/bin/node" "/x/hook.js" "/x/policy.json" abc',
};
const base = (mode = 'read-only') => strictTemplate({ registry: loadRegistry(REPO), config: {}, mode });

test('65b T4: the research template: its tools, Bash/Task/Agent denied, no MCP, its caps; only from the plain read-only template', () => {
  const t = researchTemplate(base(), { agent: 'mirai-design-research', maxSearches: 30, minutes: 20 });
  assert.equal(t.name, 'research');
  assert.equal(t.mode, 'read-only');
  assert.deepEqual(t.tools, [...RESEARCH_TOOLS]);
  for (const d of ['Bash', 'Task', 'Agent']) assert.ok(t.deny_tools.includes(d), d);
  for (const d of ['WebFetch', 'WebSearch']) assert.ok(!t.deny_tools.includes(d), d);
  assert.deepEqual(t.mcp, { tests: null, log: [] });
  assert.deepEqual(t.research, { max_searches: 30, minutes: 20 });
  assert.throws(() => researchTemplate(base('read-write'), { agent: 'x' }), /plain read-only/);
  assert.throws(() => researchTemplate(t, { agent: 'x' }), /plain read-only/);
  assert.throws(() => researchTemplate(base(), { agent: 'x', maxSearches: 0 }), /whole numbers/);
  assert.throws(() => researchTemplate(base(), { agent: 'x', minutes: 1.5 }), /whole numbers/);
});

test('65b T4: rendered: nothing allowed by rule; the checkout and trust root unreadable; the hook gates the file and web tools and records after the web ones; S4 passes', () => {
  const t = researchTemplate(base(), { agent: 'mirai-design-research' });
  const s = renderStrict(t, FACTS);
  assert.deepEqual(s.permissions.allow, []);
  for (const r of ['Read(//Users/dev/Projects/app)', 'Read(//Users/dev/Projects/app/**)', `Read(/${FACTS.trustDir}/**)`]) assert.ok(s.permissions.deny.includes(r), r);
  assert.ok(s.permissions.deny.includes('Bash'));
  for (const d of ['Task', 'Agent']) assert.ok(s.permissions.deny.includes(d));
  assert.ok(!s.permissions.deny.includes('WebFetch') && !s.permissions.deny.includes('WebSearch'));
  const fs = s.sandbox.filesystem;
  assert.ok(fs.denyRead.includes(FACTS.checkout));
  assert.ok(!fs.allowRead.includes(FACTS.checkout) && !fs.allowRead.includes(FACTS.trustDir));
  assert.deepEqual(fs.allowRead, [`${FACTS.launchDir}/input`, FACTS.scratchDir]);
  assert.ok(fs.denyWrite.includes(FACTS.checkout), 'read-only: the checkout is write-denied');
  assert.deepEqual(s.sandbox.network.allowedDomains, []);
  const pre = s.hooks.PreToolUse[0].matcher.split('|');
  for (const x of ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'WebFetch', 'WebSearch']) assert.ok(pre.includes(x), x);
  assert.deepEqual(s.hooks.PostToolUse[0].matcher.split('|').sort(), ['WebFetch', 'WebSearch']);
  const floor = { home: FACTS.home, repoHome: FACTS.repoHome, uid: 501, research: t.research };
  assert.deepEqual(floorCheck(s, floor), []);
});

test('65b T4: S4 catches a research template weakened: an allow rule, web tools without the hook, no recording, Bash allowed; and a research field where it doesn\'t belong', () => {
  const t = researchTemplate(base(), { agent: 'mirai-design-research' });
  const s = renderStrict(t, FACTS);
  const floor = { home: FACTS.home, repoHome: FACTS.repoHome, uid: 501, research: t.research };
  const has = (settings, re) => assert.ok(floorCheck(settings, floor).some((p) => re.test(p)), re.source);
  has({ ...s, permissions: { ...s.permissions, allow: ['WebFetch'] } }, /allows by rule/);
  has({ ...s, permissions: { ...s.permissions, allow: ['WebSearch'] } }, /opens web search|allows by rule/);
  has({ ...s, hooks: { ...s.hooks, PreToolUse: [{ ...s.hooks.PreToolUse[0], matcher: 'Read|Write' }] } }, /doesn't gate WebFetch/);
  has({ ...s, hooks: { PreToolUse: s.hooks.PreToolUse } }, /doesn't record after WebFetch/);
  has({ ...s, permissions: { ...s.permissions, deny: s.permissions.deny.filter((d) => d !== 'Bash') } }, /doesn't deny Bash/);
  // Without the research caps the same settings fail the floor: web tools undenied.
  assert.ok(floorCheck(s, { ...floor, research: null }).some((p) => /WebSearch tool isn't denied/.test(p)));
  assert.throws(() => renderStrict({ ...t, mode: 'read-write' }, FACTS), /research field/);
  assert.throws(() => renderStrict({ ...t, research: { max_searches: 999, minutes: 20 } }, FACTS), /research field/);
  const web = webTemplate(base('read-write'), { agent: 'mirai-architect', domains: ['npmjs.com'] });
  assert.throws(() => renderStrict({ ...web, research: t.research }, FACTS), /research field/);
});
