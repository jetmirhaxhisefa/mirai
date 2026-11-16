import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { acceptedChange, checkLock, checkManifest, readPending, writeAccepted, dependencyRows, dockerfileProblems, imagesForCheckout, installDependencies, parseDependency, readInstall, releaseInstalls, servicesToBuild, staleImages, ticketImage } from '../../src/agent/install.js';
import { runChecks } from '../../src/doctor/checks.js';
import { branchKeys, createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { loadSigner } from '../../src/sign/signer.js';
import { readTicketStatus, writeTicketStatus } from '../../src/store/tickets.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { loadRegistry } from '../../src/config/registry.js';
import { registerBranch } from '../../src/store/branches.js';
import { openStore } from '../../src/store/home.js';
import { snapshot, trustedConfig, trustedRegistry } from '../../src/trust/snapshot.js';
import { installed } from '../tests/run-fixture.js';

const stacks = loadRegistry(REGISTRY_DIR).stacks;
const REG = 'https://registry.npmjs.org/';
const npmLock = (pkgs) => JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'app' }, ...Object.fromEntries(Object.entries(pkgs).map(([k, v]) => [`node_modules/${k}`, { version: v[0], resolved: v[1] ?? `${REG}${k}/-/${k}-${v[0]}.tgz` }])) } });

test('T1: a dependency row names an exact version, for an ecosystem MIRAI installs', () => {
  assert.deepEqual(parseDependency('npm:@storybook/react-vite@10.2.16'), { ecosystem: 'npm', name: '@storybook/react-vite', version: '10.2.16' });
  assert.deepEqual(parseDependency('composer:spatie/laravel-permission@6.10.1'), { ecosystem: 'composer', name: 'spatie/laravel-permission', version: '6.10.1' });
  assert.equal(parseDependency('npm:a@1.2.3-beta.1').version, '1.2.3-beta.1');
  for (const bad of ['npm:a', 'npm:@scope/a', 'npm:a@^1.2', 'npm:a@~1.2.3', 'npm:a@latest', 'npm:a@1.x', 'npm:a@git+https://x/y', 'npm:a@file:../x', 'npm:A@1.0.0', 'a@1.0.0', 'npm:a@1.2']) {
    assert.ok(parseDependency(bad).problem, bad);
  }
  const rows = dependencyRows([{ kind: 'dependency', item: 'npm:a@1.0.0' }, { kind: 'dev-dependency', item: 'npm:b@2.0.0' }, { kind: 'protected-path', item: 'x' }], stacks);
  assert.deepEqual(rows.map((r) => [r.item, r.dev]), [['npm:a@1.0.0', false], ['npm:b@2.0.0 (dev)', true]]);
  assert.throws(() => dependencyRows([{ kind: 'dependency', item: 'pip:x@1.0.0' }], stacks), /can't install pip/);
  assert.throws(() => dependencyRows([{ kind: 'dependency', item: 'npm:x' }], stacks), /no version/);
});

test('T4: the lock check parks a changed version, an outside source, too many added; the manifest pins exactly', () => {
  const before = npmLock({ express: ['4.0.0'] });
  const rows = [{ name: 'left-pad', version: '1.3.0' }];
  const ok = checkLock({ before, after: npmLock({ express: ['4.0.0'], 'left-pad': ['1.3.0'] }), format: 'npm', registry: REG, rows });
  assert.deepEqual([ok.problems, ok.added.map((a) => a.name)], [[], ['left-pad']]);
  assert.match(checkLock({ before, after: npmLock({ express: ['4.1.0'], 'left-pad': ['1.3.0'] }), format: 'npm', registry: REG, rows }).problems.join(), /express would change from 4.0.0 to 4.1.0/);
  assert.match(checkLock({ before, after: npmLock({ 'left-pad': ['1.3.0'] }), format: 'npm', registry: REG, rows }).problems.join(), /express 4.0.0 was removed/);
  assert.match(checkLock({ before, after: npmLock({ express: ['4.0.0'], 'left-pad': ['1.3.0', 'https://evil.invalid/lp.tgz'] }), format: 'npm', registry: REG, rows }).problems.join(), /comes from https:\/\/evil.invalid/);
  assert.match(checkLock({ before, after: npmLock({ express: ['4.0.0'], 'left-pad': ['1.2.0'] }), format: 'npm', registry: REG, rows }).problems.join(), /1.2.0 in the lock, not the approved 1.3.0/);
  const many = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`p${i}`, ['1.0.0']]));
  assert.match(checkLock({ before, after: npmLock({ express: ['4.0.0'], 'left-pad': ['1.3.0'], ...many }), format: 'npm', registry: REG, rows, maxAdded: 3 }).problems.join(), /5 packages would be added, more than/);
  // Composer: Packagist's notification address is the registry.
  const cl = (pkgs) => JSON.stringify({ packages: pkgs.map(([n, v, u]) => ({ name: n, version: v, 'notification-url': u ?? 'https://packagist.org/downloads/' })) });
  assert.deepEqual(checkLock({ before: cl([['a/b', 'v1.0.0']]), after: cl([['a/b', 'v1.0.0'], ['c/d', 'v2.1.0']]), format: 'composer', registry: 'https://packagist.org/downloads/', rows: [{ name: 'c/d', version: '2.1.0' }] }).problems, []);
  assert.match(checkLock({ before: cl([]), after: cl([['c/d', '2.1.0', 'https://evil.invalid/']]), format: 'composer', registry: 'https://packagist.org/downloads/', rows: [{ name: 'c/d', version: '2.1.0' }] }).problems.join(), /evil/);
  // The manifest: exactly the version, and nothing else changed.
  const m0 = JSON.stringify({ name: 'app', dependencies: { express: '^4' } });
  const fields = ['dependencies', 'devDependencies'];
  assert.deepEqual(checkManifest({ before: m0, after: JSON.stringify({ name: 'app', dependencies: { express: '^4', 'left-pad': '1.3.0' } }), fields, rows }), []);
  assert.match(checkManifest({ before: m0, after: JSON.stringify({ name: 'app', dependencies: { express: '^4', 'left-pad': '^1.3.0' } }), fields, rows }).join(), /pinned as "\^1.3.0"/);
  assert.match(checkManifest({ before: m0, after: JSON.stringify({ name: 'app', dependencies: { express: '^5', 'left-pad': '1.3.0' } }), fields, rows }).join(), /express changed/);
  assert.match(checkManifest({ before: m0, after: JSON.stringify({ name: 'app', scripts: { x: 'y' }, dependencies: { express: '^4', 'left-pad': '1.3.0' } }), fields, rows }).join(), /outside its dependency keys/);
  assert.match(checkManifest({ before: m0, after: JSON.stringify({ name: 'app', dependencies: { express: '^4', 'left-pad': '1.3.0' } }), fields, rows: [{ ...rows[0], dev: true, devField: 'devDependencies' }] }).join(), /not devDependencies/);
});

test('T6: which services are rebuilt, the Dockerfile must install with scripts off, and the ticket\'s tag', () => {
  const dir = installed().root;
  writeFileSync(join(dir, 'Dockerfile.web'), 'FROM node:22-alpine\nCOPY web/package.json web/package-lock.json ./\nRUN npm ci --ignore-scripts\n');
  writeFileSync(join(dir, 'Dockerfile.api'), 'FROM php:8.4\nCOPY api/composer.json api/composer.lock ./\nRUN composer install --no-scripts\n');
  writeFileSync(join(dir, 'Dockerfile.all'), 'FROM node:22-alpine\nCOPY . .\nRUN npm install\n');
  const resolved = { services: {
    web: { image: 'acme/web:dev', build: { context: dir, dockerfile: 'Dockerfile.web' } },
    api: { image: 'acme/api:dev', build: { context: dir, dockerfile: 'Dockerfile.api' } },
    all: { image: 'acme/all:dev', build: { context: dir, dockerfile: 'Dockerfile.all' } },
    db: { image: 'mysql:8.4' },
  } };
  const built = servicesToBuild(resolved, dir, ['web/package.json', 'web/package-lock.json'], (p) => readFileSync(join(dir, p), 'utf8'));
  assert.deepEqual(built.map((s) => s.name), ['web', 'all']);
  const npm = [{ ecosystem: 'npm', install: stacks.node.dependencies[0].install }];
  assert.deepEqual(dockerfileProblems(built[0].text, npm), []);
  assert.match(dockerfileProblems(built[1].text, npm).join(), /doesn't turn install scripts off/);
  assert.match(dockerfileProblems('FROM node\n', npm).join(), /no npm install line/);
  assert.equal(ticketImage('hr-platform/frontend:dev', 'BKT-49'), 'hr-platform/frontend:mirai-bkt-49');
  assert.equal(ticketImage('localhost:5000/web', 'A-1'), 'localhost:5000/web:mirai-a-1');
});

// A stand-in Docker for the whole install: compose config, the lock update, the image build.
function fakeDocker({ lockAfter, manifestAfter, runStatus = 0, extraFile = null }) {
  const calls = [];
  const call = async (setup, args) => {
    calls.push(args);
    if (args[0] === 'compose') {
      const tree = args[args.indexOf('--project-directory') + 1];
      return { status: 0, stdout: JSON.stringify({ services: { web: { image: 'acme/web:dev', build: { context: tree, dockerfile: 'Dockerfile' }, volumes: [{ type: 'bind', source: tree, target: '/app' }] } } }), stderr: '' };
    }
    if (args[0] === 'run') {
      const dir = args[args.indexOf('-v') + 1].split(':')[0];
      writeFileSync(join(dir, 'package.json'), manifestAfter);
      writeFileSync(join(dir, 'package-lock.json'), lockAfter);
      if (extraFile) writeFileSync(join(dir, extraFile), 'x');
      return { status: runStatus, stdout: '', stderr: runStatus ? 'npm ERR! 404' : '' };
    }
    if (args[0] === 'build') return { status: 0, stdout: '', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { call, calls };
}

const MANIFEST = '{\n  "name": "app",\n  "dependencies": { "express": "^4" }\n}\n';
const AFTER = `${JSON.stringify({ name: 'app', dependencies: { express: '^4' }, devDependencies: { 'left-pad': '1.3.0' } }, null, 2)}\n`;

function repo({ dockerfile = 'FROM node:22-alpine\nCOPY package.json package-lock.json ./\nRUN npm ci --ignore-scripts\n', key = false } = {}) {
  const f = installed({ files: { 'package.json': MANIFEST, 'package-lock.json': npmLock({ express: ['4.0.0'] }), Dockerfile: dockerfile } });
  if (key) {
    const k = createKeyPair(f.env);
    writePublicKeyFile(f.root, k.keyId, k.publicPem);
    f.git('add', '-A');
    f.git('commit', '-qm', 'key');
  }
  const store = openStore({ cwd: f.root, env: f.env });
  const trust = snapshot({ cwd: f.root, env: f.env });
  f.git('switch', '-q', '-c', 'feature/PMT-31-x');
  registerBranch(store, { branch: 'feature/PMT-31-x', creation_sha: f.git('rev-parse', 'HEAD').trim(), ticket: 'PMT-31', base_sha: trust.baseSha });
  const commit = (what, body) => {
    f.git('add', '-A');
    f.git('commit', '-qm', `PMT-31: ${what}\n\n${body}\n\nMirai-Ticket: PMT-31`);
    return f.git('rev-parse', 'HEAD').trim();
  };
  return { f, store, trust, commit, base: { store, env: f.env, trust, config: trustedConfig(trust), registry: trustedRegistry(trust), ticket: 'PMT-31', commit, setup: {} } };
}
const DEV = [{ kind: 'dev-dependency', item: 'npm:left-pad@1.3.0' }];

test('T2: an approved npm row is installed and committed once; the ticket\'s image is built and its test runs use it', async () => {
  const { f, store, base } = repo();
  const d = fakeDocker({ manifestAfter: AFTER, lockAfter: npmLock({ express: ['4.0.0'], 'left-pad': ['1.3.0'] }) });
  const lines = [];
  const r = await installDependencies({ ...base, declared: DEV, call: d.call, say: (l) => lines.push(l) });
  assert.equal(r.installed, true);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'package.json'), 'utf8')).devDependencies, { 'left-pad': '1.3.0' });
  assert.match(f.git('log', '-1', '--format=%B'), /add npm:left-pad@1.3.0 \(dev\)[^]*npm:left-pad@1.3.0[^]*Mirai-Ticket: PMT-31/);
  const run = d.calls.find((a) => a[0] === 'run');
  assert.ok(run.includes('--ignore-scripts') && run.includes('--save-dev') && run.includes('left-pad@1.3.0') && run.includes('--network'));
  const build = d.calls.find((a) => a[0] === 'build');
  assert.ok(build.includes('acme/web:mirai-pmt-31') && build.includes('mirai.ticket=PMT-31'));
  assert.deepEqual(readInstall(store, 'PMT-31').images, { 'acme/web:dev': 'acme/web:mirai-pmt-31' });
  assert.deepEqual(imagesForCheckout(store, f.env), { ticket: 'PMT-31', images: { 'acme/web:dev': 'acme/web:mirai-pmt-31' } });
  assert.ok(lines.some((l) => /acme\/web:mirai-pmt-31/.test(l)));
  // Again: nothing installed twice.
  const head = f.git('rev-parse', 'HEAD');
  const again = await installDependencies({ ...base, declared: DEV, call: fakeDocker({ manifestAfter: AFTER, lockAfter: '{}' }).call });
  assert.equal(again.installed, true);
  assert.equal(f.git('rev-parse', 'HEAD'), head);
  // Another branch (the integration branch) uses the trust root's images.
  f.git('switch', '-q', 'main');
  assert.deepEqual(imagesForCheckout(store, f.env).images, {});
});

test('T4b: a big or odd install parks and commits nothing; a failed lock update or a Dockerfile with scripts on is refused', async () => {
  const { f, base } = repo();
  const head = f.git('rev-parse', 'HEAD');
  const changed = await installDependencies({ ...base, declared: DEV, call: fakeDocker({ manifestAfter: AFTER, lockAfter: npmLock({ express: ['4.9.0'], 'left-pad': ['1.3.0'] }) }).call });
  assert.match(changed.parked, /express would change/);
  assert.equal(changed.code, 'deps-review');
  const extra = await installDependencies({ ...base, declared: DEV, call: fakeDocker({ manifestAfter: AFTER, lockAfter: npmLock({ express: ['4.0.0'], 'left-pad': ['1.3.0'] }), extraFile: 'node_modules.tgz' }).call });
  assert.match(extra.parked, /wrote more than the manifest and its lock/);
  assert.equal(f.git('rev-parse', 'HEAD'), head);
  assert.equal(f.git('status', '--porcelain'), '');
  await assert.rejects(installDependencies({ ...base, declared: DEV, call: fakeDocker({ manifestAfter: AFTER, lockAfter: '{}', runStatus: 1 }).call }), /lock update failed/);
  // A Dockerfile on the integration branch that installs with scripts on: refused, nothing committed.
  const on = repo({ dockerfile: 'FROM node\nCOPY package.json package-lock.json ./\nRUN npm ci\n' });
  const onHead = on.f.git('rev-parse', 'HEAD');
  await assert.rejects(installDependencies({ ...on.base, declared: DEV, call: fakeDocker({ manifestAfter: AFTER, lockAfter: npmLock({ express: ['4.0.0'], 'left-pad': ['1.3.0'] }) }).call }), /doesn't turn install scripts off/);
  assert.equal(on.f.git('rev-parse', 'HEAD'), onHead);
  assert.equal(on.f.git('status', '--porcelain'), '');
  assert.ok(existsSync(join(on.f.root, 'package.json')));
});

test('T7: a done or dropped ticket\'s images and record go; doctor lists a leftover image', async () => {
  const { f, store } = repo();
  f.git('switch', '-q', 'main');
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  const signer = loadSigner(f.env, store);
  writeTicketStatus(store, { ticket: 'PMT-31', state: 'ready-for-dev', written_by: 'human' }, { expectSeq: null, signer });
  mkdirSync(join(store.dir, 'tickets', 'PMT-31'), { recursive: true });
  writeFileSync(join(store.dir, 'tickets', 'PMT-31', 'install.json'), JSON.stringify({ schema_version: 1, rows: ['npm:left-pad@1.3.0'], images: { 'acme/web:dev': 'acme/web:mirai-pmt-31' } }), { mode: 0o600 });
  const removed = [];
  const call = async (setup, args) => {
    if (args[0] === 'image' && args[1] === 'rm') removed.push(args.at(-1));
    return { status: 0, stdout: '', stderr: '' };
  };
  const readKeys = () => branchKeys(store.checkout, store.branch, store.gitEnv);
  assert.deepEqual(await releaseInstalls({ store, env: f.env, call, setup: {}, readKeys }), [], 'still in progress: kept');
  writeTicketStatus(store, { ticket: 'PMT-31', state: 'dropped', written_by: 'human' }, { expectSeq: readTicketStatus(store, 'PMT-31').status.seq, signer });
  assert.deepEqual(await releaseInstalls({ store, env: f.env, call, setup: {}, readKeys }), ['PMT-31']);
  assert.deepEqual(removed, ['acme/web:mirai-pmt-31']);
  assert.equal(readInstall(store, 'PMT-31'), null);
  // Doctor: an image whose ticket has no record any more is a leftover.
  const items = await runChecks({ cwd: f.root, env: f.env, redTeam: async () => ({ state: 'green', result: { created_at: '2026-11-14T10:00:00.000Z' }, parts: { claude_code: { version: '2.1.325' } } }), session: () => ({ state: 'current' }), images: async () => [{ tag: 'acme/web:mirai-pmt-31', ticket: 'PMT-31' }] });
  const ti = items.find((i) => i.id === 'ticket-images');
  assert.equal(ti.state, 'yellow');
  assert.match(ti.hint, /docker image rm acme\/web:mirai-pmt-31/);
});

test('T8: an image that holds another lock than the integration branch\'s is named, with the rebuild', async () => {
  const { store, base } = repo();
  const want = readFileSync(join(store.checkout, 'package-lock.json'), 'utf8');
  const docker = (inImage) => async (setup, args) => {
    if (args[0] === 'compose') {
      const tree = args[args.indexOf('--project-directory') + 1];
      return { status: 0, stdout: JSON.stringify({ services: { web: { image: 'acme/web:dev', build: { context: tree, dockerfile: 'Dockerfile' } } } }), stderr: '' };
    }
    if (args[0] === 'image' && args[1] === 'inspect') return { status: 0, stdout: '/app\n', stderr: '' };
    if (args[0] === 'run') {
      assert.ok(args.includes('/app/package-lock.json') && args.includes('none'));
      return { status: 0, stdout: inImage, stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  assert.deepEqual(await staleImages({ ...base, call: docker(want) }), []);
  assert.deepEqual(await staleImages({ ...base, call: docker('{"old": true}') }), [{ service: 'web', image: 'acme/web:dev', lock: 'package-lock.json' }]);
});

test('T9: a parked install shows what changed; your signed acceptance lets exactly that change through, anything else parks again', async () => {
  const { f, store, base } = repo({ key: true });
  const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
  const bumped = npmLock({ express: ['4.0.1'], 'left-pad': ['1.3.0'] });
  const first = await installDependencies({ ...base, keys, declared: DEV, call: fakeDocker({ manifestAfter: AFTER, lockAfter: bumped }).call });
  assert.match(first.parked, /express would change from 4.0.0 to 4.0.1[^]*mirai unpark PMT-31 --accept-deps/);
  const pending = readPending(store, 'PMT-31');
  assert.deepEqual(pending.rows, ['npm:left-pad@1.3.0 (dev)']);
  assert.equal(acceptedChange(store, 'PMT-31', pending.hash, keys), false);
  writeAccepted(store, 'PMT-31', pending, loadSigner(f.env, store));
  assert.equal(acceptedChange(store, 'PMT-31', pending.hash, keys), true);
  const same = await installDependencies({ ...base, keys, declared: DEV, call: fakeDocker({ manifestAfter: AFTER, lockAfter: bumped }).call });
  assert.equal(same.installed, true);
  assert.match(f.git('log', '-1', '--format=%s'), /add npm:left-pad@1.3.0/);
  // A different change (another bump) isn't the one you accepted.
  const { base: base2, store: store2 } = repo({ key: true });
  const keys2 = branchKeys(store2.checkout, store2.branch, store2.gitEnv);
  await installDependencies({ ...base2, keys: keys2, declared: DEV, call: fakeDocker({ manifestAfter: AFTER, lockAfter: bumped }).call });
  writeAccepted(store2, 'PMT-31', readPending(store2, 'PMT-31'), loadSigner(base2.env, store2));
  const other = await installDependencies({ ...base2, keys: keys2, declared: DEV, call: fakeDocker({ manifestAfter: AFTER, lockAfter: npmLock({ express: ['4.0.2'], 'left-pad': ['1.3.0'] }) }).call });
  assert.match(other.parked, /4.0.2/);
});
