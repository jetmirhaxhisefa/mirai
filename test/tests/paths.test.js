import { test } from 'node:test';
import assert from 'node:assert/strict';

import { serviceMounts, toProjectPath, toServicePath } from '../../src/tests/paths.js';

// Unit 16a: project paths and the service's own, from the frozen compose file's binds (the
// sample app's shapes: backend/ at /var/www/html with a vendor volume over it; e2e/ at /e2e with
// an anonymous node_modules volume).

const COPY = '/store/tests/t-1/tree';
const app = { volumes: [
  { type: 'bind', source: `${COPY}/backend`, target: '/var/www/html' },
  { type: 'volume', source: 'p_backend_vendor', target: '/var/www/html/vendor' },
  { type: 'bind', source: '/store/tests/t-1/out', target: '/mirai/out' },
] };
const e2e = { volumes: [{ type: 'bind', source: `${COPY}/e2e`, target: '/e2e/' }, { type: 'volume', target: '/e2e/node_modules' }], tmpfs: ['/e2e/tmp:size=1m'] };
const root = { volumes: [{ type: 'bind', source: COPY, target: '/w' }, { type: 'bind', source: `${COPY}/sub`, target: '/s' }] };

test('16a: a project path becomes the service\'s path, through the bind that holds it most closely', () => {
  const m = serviceMounts(app, COPY);
  assert.equal(toServicePath(m, 'backend/tests/Unit/ATest.php', 'app'), '/var/www/html/tests/Unit/ATest.php');
  assert.equal(toServicePath(m, 'backend', 'app'), '/var/www/html');
  assert.equal(toServicePath(serviceMounts(e2e, COPY), 'e2e/tests/a.spec.ts', 'playwright'), '/e2e/tests/a.spec.ts');
  const r = serviceMounts(root, COPY);
  assert.equal(toServicePath(r, 'tests/x', 'app'), '/w/tests/x');
  assert.equal(toServicePath(r, 'sub/y', 'app'), '/s/y');
});

test('16a: refused when the service doesn\'t mount the path, or another mount hides it; a sibling folder\'s prefix isn\'t a match', () => {
  const m = serviceMounts(app, COPY);
  assert.throws(() => toServicePath(m, 'frontend/src/a.test.ts', 'app'), (e) => e.code === 'bad-path' && /isn't in what app mounts/.test(e.message) && /backend/.test(e.hint));
  assert.throws(() => toServicePath(m, 'backend/vendor/x.php', 'app'), (e) => e.code === 'bad-path' && /hidden/.test(e.message));
  assert.throws(() => toServicePath(m, 'backendx/a', 'app'), (e) => e.code === 'bad-path');
  assert.throws(() => toServicePath(serviceMounts(e2e, COPY), 'e2e/tmp/a', 'playwright'), /hidden/);
  // The output folder isn't a project bind.
  assert.throws(() => toServicePath(serviceMounts({ volumes: [app.volumes[2]] }, COPY), 'out/x', 'app'), (e) => /mounts nothing/.test(e.hint));
});

test('16a: a reported path maps back to the project, absolute or from a base; anything else is null', () => {
  const m = serviceMounts(app, COPY);
  assert.equal(toProjectPath(m, '/var/www/html/tests/Feature/KnownFailureSeedTest.php', null), 'backend/tests/Feature/KnownFailureSeedTest.php');
  assert.equal(toProjectPath(m, 'tests/Unit/A.php', '/var/www/html'), 'backend/tests/Unit/A.php');
  assert.equal(toProjectPath(serviceMounts(e2e, COPY), 'probe.spec.ts', '/e2e/tests'), 'e2e/tests/probe.spec.ts');
  assert.equal(toProjectPath(m, '/var/www/html/vendor/x.php', null), null);
  assert.equal(toProjectPath(m, '/etc/passwd', null), null);
  assert.equal(toProjectPath(m, 'a.php', null), null);
  assert.equal(toProjectPath(m, '/var/www/html/../../etc/passwd', null), null);
  assert.equal(toProjectPath(m, '../x', '/var/www/html'), null);
  assert.equal(toProjectPath(m, '', '/var/www/html'), null);
  assert.equal(toProjectPath(m, 42, '/var/www/html'), null);
  assert.equal(toProjectPath(serviceMounts(root, COPY), '/w/a/b', null), 'a/b');
});
