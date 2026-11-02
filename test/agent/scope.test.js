import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { changedPaths, checkIgnoredCheckable, findRole, ignoredState, scopeViolations, trustedRoles } from '../../src/agent/scope.js';
import { runAgent } from '../../src/agent/run.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { writeToken } from '../../src/sign/token.js';

import { snapshot } from '../../src/trust/snapshot.js';
import { installed, tempDir } from '../tests/run-fixture.js';

// Unit 19b: what a run may have changed. No model: a stand-in claude, and the real check.

const TOKEN = `sk-ant-oat01-${'Ag3_-k'.repeat(16)}`;
const INIT = '{"type":"system","subtype":"init","permissionMode":"dontAsk"}';
const RESULT = '{"type":"result","subtype":"success","is_error":false,"result":"done","num_turns":1}';

function repo() {
  const f = installed();
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  writeToken(f.env, TOKEN);
  writeFileSync(join(f.root, '.gitignore'), `${require_('.gitignore', f)}node_modules/\n`);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  return f;
}
function require_(name, f) {
  try {
    return `${String(f.git('show', `HEAD:${name}`)).trimEnd()}\n`;
  } catch {
    return '';
  }
}
function claudeWith(body) {
  const path = join(tempDir(), 'claude');
  writeFileSync(path, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.316 (Claude Code)"; exit 0; fi\n${body}\necho '${INIT}'; echo '${RESULT}'\n`, { mode: 0o755 });
  return path;
}
const run = (f, role, body) => runAgent({ cwd: f.root, env: f.env, role, prompt: 'x', claude: claudeWith(body), status: async () => ({ state: 'green', blocker_seen: null, changed: [] }), check: () => [] });

test('T1: a reviewer that changes a tracked, a new or an ignored file is refused, each named; nothing is undone', async () => {
  const f = repo();
  const tracked = await run(f, 'reviewer', 'echo changed >> README.md');
  assert.equal(tracked.outcome, 'refused');
  assert.match(tracked.why, /reviewer role may not change them.*README\.md/);
  assert.equal(tracked.line.scope_violations, 1);
  f.git('checkout', '-q', '--', 'README.md');
  const fresh = await run(f, 'reviewer', 'echo x > new-file.txt');
  assert.match(fresh.why, /new-file\.txt/);
  assert.equal(String(f.git('status', '--porcelain')).includes('new-file.txt'), true, 'left where it is');
  f.git('clean', '-qfd');
  const ignored = await run(f, 'reviewer', 'mkdir -p node_modules/.bin; echo x > node_modules/.bin/tool');
  assert.equal(ignored.outcome, 'refused');
  assert.match(ignored.why, /node_modules/);
});

test('T2: an author inside its scope is ok, but not in ignored files; a project role can\'t widen the core ones', async () => {
  const f = repo();
  const ok = await run(f, 'author', 'echo x > src-new.txt');
  assert.equal(ok.outcome, 'ok');
  f.git('add', '-A');
  f.git('commit', '-qm', 'the author\'s change');
  const planted = await run(f, 'author', 'mkdir -p node_modules/.bin; echo y > node_modules/.bin/b1-tool');
  assert.equal(planted.outcome, 'refused', 'an ignored file, which runs later, needs the role to allow it');
  assert.match(planted.why, /node_modules\/\.bin\/b1-tool/);
  await assert.rejects(run(f, 'author', 'true'), (e) => e.code === 'ignored-pending', 'the planted file refuses the next launch');
  rmSync(join(f.root, 'node_modules', '.bin', 'b1-tool'));
  assert.equal((await run(f, 'author', 'true')).outcome, 'ok', 'and once it\'s gone, the next goes');
  assert.equal(ok.line.role, 'author');
  assert.equal(ok.line.step, 'build');
  // A project's own role named like a core one is refused, so it can't loosen it.
  const g = installed({ files: { '.mirai/custom/roles/reviewer.toml': 'kind = "role"\nschema_version = 1\nname = "reviewer"\ndescription = "x"\nmode = "read-write"\nstep = "review"\n\n[may_write]\npaths = ["**"]\n' } });
  assert.throws(() => trustedRoles(snapshot({ cwd: g.root, env: g.env })), (e) => e.code === 'bad-role');
  const h = installed({ files: { '.mirai/custom/roles/docs-writer.toml': 'kind = "role"\nschema_version = 1\nname = "docs-writer"\ndescription = "Writes docs"\nmode = "read-write"\nstep = "build"\n\n[may_write]\npaths = ["docs/**"]\n' } });
  const roles = trustedRoles(snapshot({ cwd: h.root, env: h.env }));
  assert.deepEqual(findRole(roles, 'docs-writer').may_write.paths, ['docs/**']);
  assert.throws(() => findRole(roles, 'nobody'), (e) => e.code === 'unknown-role');
  // `!` excludes, as everywhere; a broken glob is refused.
  assert.equal(scopeViolations({ root: h.root, env: h.env, role: { name: 'x', may_write: { paths: ['src/**', '!src/gen/**'] } }, before: { state: {}, over: false } }).violations.length, 0);
  const k = installed({ files: { '.mirai/custom/roles/bad.toml': 'kind = "role"\nschema_version = 1\nname = "bad"\ndescription = "x"\nmode = "read-write"\nstep = "build"\n\n[may_write]\npaths = ["src/[x"]\n' } });
  assert.throws(() => trustedRoles(snapshot({ cwd: k.root, env: k.env })), (e) => e.code === 'bad-role');
});

test('review: past the budget is not ok; an exclusion is honoured; hidden tracked files refuse; a rename\'s odd original is a path', async () => {
  const f = repo();
  mkdirSync(join(f.root, 'src', 'gen'), { recursive: true });
  const role = { name: 'p', may_write: { paths: ['src/**', '!src/gen/**'] } };
  writeFileSync(join(f.root, 'src', 'gen', 'x.js'), 'x');
  assert.deepEqual(scopeViolations({ root: f.root, env: f.env, role, before: { state: {}, over: false } }).violations, ['src/gen/x.js']);
  rmSync(join(f.root, 'src'), { recursive: true });
  assert.equal(scopeViolations({ root: f.root, env: f.env, role, before: { state: {}, over: true } }).partial, true);
  assert.deepEqual(changedPaths(['2 R. N... 100644 100644 100644 a b R100 new.txt', '? allowed.txt', '? real.txt']), ['new.txt', '? allowed.txt', 'real.txt']);
  f.git('update-index', '--assume-unchanged', 'README.md');
  await assert.rejects(run(f, 'reviewer', 'true'), (e) => e.code === 'hidden-files');
  f.git('update-index', '--no-assume-unchanged', 'README.md');
  assert.throws(() => checkIgnoredCheckable({ state: {}, over: true }), (e) => e.code === 'too-many-ignored');
  assert.throws(() => checkIgnoredCheckable({ state: { 'x/y': 'unreadable:1' }, over: false }), (e) => e.code === 'unreadable-ignored');
  mkdirSync(join(f.root, 'node_modules'), { recursive: true });
  writeFileSync(join(f.root, 'node_modules', '__proto__'), 'x');
  const s = ignoredState(f.root, f.env);
  assert.ok(Object.keys(s.state).includes('node_modules/__proto__'), 'a file named __proto__ is a file');
});

test('T3: renames, odd names and links can\'t hide a change', () => {
  assert.deepEqual(changedPaths(['1 .M N... 100644 100644 100644 a b x y.txt', '2 R. N... 100644 100644 100644 a b R100 new name.txt', 'old.txt', '? un tracked.txt']), ['x y.txt', 'new name.txt', 'old.txt', 'un tracked.txt']);
  const f = repo();
  const before = ignoredState(f.root, f.env);
  mkdirSync(join(f.root, 'node_modules'), { recursive: true });
  writeFileSync(join(f.root, 'node_modules', '\u001b[2Jx'), 'x');
  const role = { name: 'reviewer', may_write: { paths: [] } };
  const out = scopeViolations({ root: f.root, env: f.env, role, before });
  assert.ok(out.violations.some((p) => p.startsWith('node_modules')), JSON.stringify(out));
});

test('T6: the log line carries role, step, tier, reason, rung and model; a verifier of the same model is rung 3; a role only in the work tree counts for nothing', async () => {
  const f = repo();
  const author = await run(f, 'author', 'true');
  const verify = await runAgent({ cwd: f.root, env: f.env, role: 'verifier', verifies: author.launchId, prompt: 'x', claude: claudeWith('true'), status: async () => ({ state: 'green', blocker_seen: null, changed: [] }), check: () => [] });
  assert.equal(verify.outcome, 'ok');
  assert.equal(verify.line.step, 'verify');
  assert.equal(verify.line.rung, 3, 'no different model configured');
  assert.equal(verify.line.model, author.line.model);
  assert.match(verify.line.tier_reason, /verify: standard/);
  await assert.rejects(runAgent({ cwd: f.root, env: f.env, role: 'verifier', verifies: '20990101000000-deadbeef', prompt: 'x', claude: claudeWith('true'), status: async () => ({ state: 'green', blocker_seen: null, changed: [] }), check: () => [] }), (e) => e.code === 'unknown-launch');
  const high = await runAgent({ cwd: f.root, env: f.env, role: 'reviewer', risk: 'high', prompt: 'x', claude: claudeWith('true'), status: async () => ({ state: 'green', blocker_seen: null, changed: [] }), check: () => [] });
  assert.equal(high.line.tier, 'deep', 'a high-risk review is deep');
  assert.equal(high.line.step, 'review-high-risk');
  await assert.rejects(runAgent({ cwd: f.root, env: f.env, role: 'author', verifies: author.launchId, prompt: 'x', claude: claudeWith('true'), status: async () => ({ state: 'green', blocker_seen: null, changed: [] }), check: () => [] }), /changes it/);
  // A role added on a branch, not on the integration branch, isn't known.
  mkdirSync(join(f.root, '.mirai', 'custom', 'roles'), { recursive: true });
  writeFileSync(join(f.root, '.mirai', 'custom', 'roles', 'anything.toml'), 'kind = "role"\nschema_version = 1\nname = "anything"\ndescription = "x"\nmode = "read-write"\nstep = "build"\n\n[may_write]\npaths = ["**"]\n');
  f.git('checkout', '-q', '-b', 'side');
  f.git('add', '-A');
  f.git('commit', '-qm', 'a role on a branch');
  await assert.rejects(runAgent({ cwd: f.root, env: f.env, role: 'anything', prompt: 'x', claude: claudeWith('true'), status: async () => ({ state: 'green', blocker_seen: null, changed: [] }), check: () => [] }), (e) => e.code === 'unknown-role');
});
