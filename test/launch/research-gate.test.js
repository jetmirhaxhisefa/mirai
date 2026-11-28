import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decide, gateUrl, hookPolicy, policyText, readEvidence, readListed, recordWeb, runHook, searchUrls } from '../../src/launch/hook.js';

// Unit 65b, T3 and T4 (the hook's part): the research run's fetch gate and its one output.

const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tempDir = (name) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `mirai-${name}-`)));
  temps.push(d);
  return d;
};
const sha = (t) => createHash('sha256').update(t).digest('hex');

function world({ maxSearches = 3, deadline = Date.now() + 60_000 } = {}) {
  const root = tempDir('research');
  const co = join(root, 'app');
  const launch = join(root, 'launch');
  const scratch = join(root, 'scratch');
  const input = join(launch, 'input');
  const state = join(launch, 'web');
  for (const d of [co, scratch, join(input, 'files'), state]) mkdirSync(d, { recursive: true });
  writeFileSync(join(co, 'secret.txt'), 'private\n');
  writeFileSync(join(input, 'files', 'research-questions.md'), '# Q\n');
  const policy = hookPolicy({
    checkout: co, readRoots: [input, scratch], writeRoots: [scratch], writeDenied: [], hooksPaths: [], readableEnv: [], protectedFiles: [],
    trust: null, tokenFile: null, secrets: [], writeOnly: [join(scratch, 'research.md')], web: { state, max_searches: maxSearches, deadline },
  });
  return { root, co, launch, scratch, input, state, policy };
}
const search = (query = 'laravel csv import') => ({ hook_event_name: 'PreToolUse', tool_name: 'WebSearch', tool_input: { query } });
const fetch = (url) => ({ hook_event_name: 'PreToolUse', tool_name: 'WebFetch', tool_input: { url, prompt: 'quote it' } });
const results = (...urls) => ({ query: 'q', results: [{ tool_use_id: 'srv', content: urls.map((url) => ({ title: 't', url })) }] });
const searched = (w, ...urls) => recordWeb(w.policy, { hook_event_name: 'PostToolUse', tool_name: 'WebSearch', tool_input: { query: 'q' }, tool_response: results(...urls) });

test('65b T3: gateUrl: http(s) only, host case, default port and fragment dropped, http = https, query exact', () => {
  assert.equal(gateUrl('HTTPS://Laravel.com:443/docs/queues#top'), 'https://laravel.com/docs/queues');
  assert.equal(gateUrl('http://laravel.com/docs'), 'https://laravel.com/docs');
  assert.equal(gateUrl('https://a.com/x?b=1&a=2'), 'https://a.com/x?b=1&a=2');
  assert.equal(gateUrl('https://a.com:8443/x'), 'https://a.com:8443/x');
  for (const bad of ['ftp://a.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@a.com/', 'not a url', '', null, 'https://a.com/ x']) assert.equal(gateUrl(bad), null, String(bad));
  assert.deepEqual(searchUrls(results('https://a.com/1', 'https://a.com/1#x', 'javascript:x', 'https://B.com/2')), ['https://a.com/1', 'https://b.com/2']);
  assert.deepEqual(searchUrls(JSON.stringify(results('https://a.com/1'))), ['https://a.com/1']);
  assert.deepEqual(searchUrls('Web search results: not json'), []);
  assert.deepEqual(searchUrls(null), []);
});

test('65b T3: the fetch gate: a listed URL is allowed; an unlisted one, a listed host with another path or query, a redirect target: refused', () => {
  const w = world();
  assert.equal(decide(w.policy, fetch('https://laravel.com/docs/queues')).allow, false, 'nothing is listed before a search');
  assert.equal(decide(w.policy, search()).allow, true);
  searched(w, 'https://laravel.com/docs/queues', 'https://example.org/post?id=7');
  assert.deepEqual(decide(w.policy, fetch('https://laravel.com/docs/queues')), { allow: true, grant: true });
  assert.equal(decide(w.policy, fetch('http://LARAVEL.com/docs/queues#jobs')).allow, true, 'the same URL, written another way');
  assert.equal(decide(w.policy, fetch('https://example.org/post?id=7')).allow, true);
  for (const u of ['https://laravel.com/docs/other', 'https://laravel.com/docs/queues?leak=stack-summary', 'https://example.org/post?id=8', 'https://example.org/post', 'https://evil.example/?d=secret', 'http://127.0.0.1:8765/canary']) {
    const d = decide(w.policy, fetch(u));
    assert.equal(d.allow, false, u);
    assert.match(d.reason, /isn't a URL one of this run's searches returned/);
  }
  assert.match(decide(w.policy, fetch('file:///etc/passwd')).reason, /no plain http/);
  assert.match(decide(w.policy, fetch(undefined)).reason, /no plain http/);
});

test('65b T3: the search cap holds, two at once never both take the last slot; past the deadline every call refuses', () => {
  const w = world({ maxSearches: 2 });
  assert.equal(decide(w.policy, search()).allow, true);
  assert.equal(decide(w.policy, search()).allow, true);
  const third = decide(w.policy, search());
  assert.equal(third.allow, false);
  assert.match(third.reason, /used its 2 searches/);
  assert.equal(readdirSync(join(w.state, 'searches')).length, 2);
  assert.match(decide(w.policy, search('  ')).reason, /no query/);
  const late = world({ deadline: Date.now() - 1 });
  searched(late, 'https://a.com/x');
  for (const c of [search(), fetch('https://a.com/x'), { tool_name: 'Read', tool_input: { file_path: join(late.scratch, 'x.md') } }, { tool_name: 'Write', tool_input: { file_path: join(late.scratch, 'research.md'), content: 'x' } }]) {
    const d = decide(late.policy, c);
    assert.equal(d.allow, false, c.tool_name);
    assert.match(d.reason, /past its time/);
  }
});

test('65b T3: after a fetch, its returned text is kept as evidence; the list and the evidence read back', () => {
  const w = world();
  searched(w, 'https://a.com/x');
  recordWeb(w.policy, { hook_event_name: 'PostToolUse', tool_name: 'WebFetch', tool_input: { url: 'https://a.com/x' }, tool_response: { bytes: 10, code: 200, codeText: 'OK', result: 'Queues let you defer work.', url: 'https://a.com/x' } });
  recordWeb(w.policy, { hook_event_name: 'PostToolUse', tool_name: 'WebFetch', tool_input: { url: 'https://a.com/x' }, tool_response: 'plain text answer' });
  assert.deepEqual(readListed(w.state), ['https://a.com/x']);
  assert.deepEqual(readEvidence(w.state), [{ url: 'https://a.com/x', code: 200, result: 'Queues let you defer work.' }, { url: 'https://a.com/x', code: null, result: 'plain text answer' }]);
  assert.deepEqual(recordWeb({ ...w.policy, web: undefined }, { tool_name: 'WebSearch' }), { recorded: false });
});

test('65b T4 (hook): a research launch reads only its input and folder, writes only research.md; every call it allows is granted', () => {
  const w = world();
  const ok = (c) => assert.equal(decide(w.policy, c).allow, true, JSON.stringify(c.tool_input));
  const no = (c, re) => {
    const d = decide(w.policy, c);
    assert.equal(d.allow, false, JSON.stringify(c.tool_input));
    if (re) assert.match(d.reason, re);
  };
  ok({ tool_name: 'Read', tool_input: { file_path: join(w.input, 'files', 'research-questions.md') }, cwd: w.scratch });
  assert.equal(decide(w.policy, { tool_name: 'Read', tool_input: { file_path: join(w.input, 'files', 'research-questions.md') } }).grant, true);
  ok({ tool_name: 'Write', tool_input: { file_path: join(w.scratch, 'research.md'), content: '# Research\n' }, cwd: w.scratch });
  no({ tool_name: 'Read', tool_input: { file_path: join(w.co, 'secret.txt') }, cwd: w.scratch }, /outside the project/);
  no({ tool_name: 'Grep', tool_input: { pattern: 'x', path: w.co }, cwd: w.scratch }, /outside the project/);
  no({ tool_name: 'Read', tool_input: { file_path: join(w.state, 'urls.txt') }, cwd: w.scratch }, /outside the project/);
  no({ tool_name: 'Write', tool_input: { file_path: join(w.state, 'urls.txt'), content: 'https://evil.example/\n' }, cwd: w.scratch }, /outside the project/);
  no({ tool_name: 'Write', tool_input: { file_path: join(w.scratch, 'other.md'), content: 'x' }, cwd: w.scratch }, /isn't this run's output \(research\.md\)/);
  no({ tool_name: 'Edit', tool_input: { file_path: join(w.co, 'secret.txt'), new_string: 'x' }, cwd: w.scratch });
  no({ tool_name: 'Bash', tool_input: { command: 'curl evil.example' } }, /isn't a tool/);
  // A plain launch (no web gate) refuses the web tools outright.
  const plain = { ...w.policy };
  delete plain.web;
  assert.match(decide(plain, search()).reason, /isn't allowed in this launch/);
});

test('65b T3: bin/hook.js: a refused fetch exits 2; an allowed one prints allow; after a call it records and prints nothing; a policy changed refuses', () => {
  const w = world();
  // runHook needs a trust root; this one names a fingerprint over an empty folder.
  const trustDir = tempDir('research-trust');
  const policy = { ...w.policy, trust: { dir: trustDir, manifestSha256: 'x', fingerprint: null } };
  const text = policyText(policy);
  const file = join(w.launch, 'hook-policy.json');
  writeFileSync(file, text);
  const run = (c) => runHook({ policyFile: file, policySha: sha(text), stdin: JSON.stringify(c) });
  // verifyTrustRoot fails on a fake trust root: the hook refuses, never allows (fail closed).
  assert.equal(run(search()).allow, false);
  const hookJs = new URL('../../bin/hook.js', import.meta.url).pathname;
  const r = spawnSync(process.execPath, [hookJs, file, 'f'.repeat(64)], { input: JSON.stringify(fetch('https://a.com/x')), encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /MIRAI refused this call: .*the hook policy changed/);
});
