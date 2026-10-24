import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decide, globProblem, included, matches } from '../../src/util/glob.js';

test('T10: the glob matcher', () => {
  const cases = [
    // No "/": a name at any depth.
    ['*.lock', 'yarn.lock', true], ['*.lock', 'a/b/yarn.lock', true], ['eslint.config.*', 'web/eslint.config.js', true],
    ['package.json', 'packages/x/package.json', true], ['.env*', 'backend/.env.test', true], ['*', '.hidden', true],
    // A "/": anchored at the root; a leading "/" anchors a bare name.
    ['.github/workflows/**', '.github/workflows/ci.yml', true], ['.github/workflows/**', 'x/.github/workflows/ci.yml', false],
    ['/CODEOWNERS', 'CODEOWNERS', true], ['/CODEOWNERS', 'docs/CODEOWNERS', false], ['src/*.js', 'src/a/b.js', false],
    // "**".
    ['**/CLAUDE.md', 'CLAUDE.md', true], ['**/CLAUDE.md', 'packages/api/CLAUDE.md', true], ['a/**/b', 'a/b', true],
    ['a/**/b', 'a/x/y/b', true], ['.mirai/**', '.mirai/a/b', true], ['.mirai/**', '.mirai', true], ['.mirai/**', '.miraix', false], ['**', 'any/path/at/all', true],
    ['a**b', 'axxb', true], ['a**b', 'a/b', false],
    // "?", braces, a trailing "/", and specials matched as themselves.
    ['?.md', 'a.md', true], ['?.md', 'ab.md', false], ['vitest.config.{js,ts,mjs}', 'vitest.config.ts', true],
    ['vitest.config.{js,ts,mjs}', 'vitest.config.cjs', false], ['.vscode/', '.vscode/tasks.json', true], ['node_modules/', 'a/node_modules/x.js', true], ['/x/', 'a/x/y', false],
    // Case is ignored (macOS disks do); repeated ** are one.
    ['CLAUDE.md', 'pkg/Claude.md', true], ['**/.vscode/**', 'a/.VSCode/tasks.json', true], ['**/**/**/x', 'a/b/x', true], ['a+b(c).md', 'a+b(c).md', true],
    ['*compose*.yml', 'docker-compose.override.yml', true], ['*compose*.yml', 'deploy/compose.yml', true], ['Dockerfile*', 'api/Dockerfile.dev', true],
  ];
  for (const [pattern, path, expected] of cases) assert.equal(matches(pattern, path), expected, `${pattern} ${path}`);
  // In a list, "!" excludes and the last match wins.
  const code = ['**', '!docs/mirai/**', '!.mirai/**'];
  assert.equal(included(code, 'src/a.js'), true);
  assert.equal(included(code, 'docs/mirai/x.md'), false);
  assert.deepEqual(decide(['**', '!docs/**', 'docs/keep.md'], 'docs/keep.md'), { pattern: 'docs/keep.md', included: true });
  assert.equal(decide(['src/**'], 'lib/a.js'), null);
  // What a rule or a config can't use; and matching stays fast.
  assert.match(globProblem('*.[jt]s'), /\[ \]/);
  assert.match(globProblem('{src/*,lib}/x'), /inside \{ \}/);
  assert.match(globProblem('*a*a*a*a*a*a*a*a*a*b'), /more than 8 wildcards/);
  assert.equal(globProblem('.github/workflows/**'), null);
  const started = Date.now();
  matches('**/**/**/**/**/**/**/**/**/**/x', `${'a/'.repeat(28)}y`);
  matches('*a*a*a*a*a*a*a*b', 'a'.repeat(60));
  assert.ok(Date.now() - started < 1000, 'matching is fast');
});
