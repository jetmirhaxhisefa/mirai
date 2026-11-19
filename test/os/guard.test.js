import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Unit 30a T4: a system check belongs in src/os/ (D-63). The ones from before 30a are listed
// here with their count; P01 (design/11) moves them and empties the list. The list only shrinks:
// a count that falls must be lowered here, and one that rises fails.
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const CHECK = /process\.platform|\bos\.platform\(|\bplatform\(\)|["'`]darwin["'`]|Application Support|sandbox-exec|\/Users\/|\/private\/(?:tmp|var)\b/g;

export const BEFORE_30A = Object.freeze({
  'src/adapters/claude-code.js': 1,
  'src/cli/commands/sandbox.js': 2,
  'src/launch/hook.js': 2,
  'src/launch/strict.js': 22,
  'src/redteam/cases-agent.js': 2,
  'src/redteam/cases.js': 4,
  'src/redteam/guard.js': 1,
  'src/redteam/host.js': 1,
  'src/redteam/static.js': 1,
  'src/redteam/workspace.js': 2,
  'src/ship/gitlab.js': 3,
  'src/sign/denies.js': 2,
  'src/store/home.js': 1,
  'src/store/mirai-home.js': 2,
});

// The system checks in one file's text, outside comment lines: [{ line, text }].
export function checksIn(text) {
  const found = [];
  text.split('\n').forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
    for (const m of l.matchAll(CHECK)) found.push({ line: i + 1, text: m[0] });
  });
  return found;
}

// What's wrong with a tree's checks against the list: [message].
export function guardProblems(files, list = BEFORE_30A) {
  const problems = [];
  const counts = {};
  for (const [path, text] of Object.entries(files)) {
    if (path.startsWith('src/os/')) continue;
    const found = checksIn(text);
    if (found.length) counts[path] = found;
  }
  for (const [path, found] of Object.entries(counts)) {
    const allowed = list[path] ?? 0;
    if (found.length > allowed) problems.push(`${path}: ${found.length} system check(s), ${allowed} allowed; ask src/os/ instead (first: line ${found[0].line}, ${found[0].text})`);
  }
  for (const [path, allowed] of Object.entries(list)) {
    const n = counts[path]?.length ?? 0;
    if (n < allowed) problems.push(`${path}: ${n} system check(s) now, the list says ${allowed}: lower it in test/os/guard.test.js (the list only shrinks)`);
  }
  return problems;
}

function srcFiles(dir = join(ROOT, 'src')) {
  const out = {};
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) Object.assign(out, srcFiles(p));
    else if (p.endsWith('.js')) out[relative(ROOT, p)] = readFileSync(p, 'utf8');
  }
  return out;
}

test('30a T4: no system check outside src/os/ beyond the list from before 30a', () => {
  assert.deepEqual(guardProblems(srcFiles()), []);
});

test('30a T4: a new check outside src/os/ fails with its file and line; inside it passes; a gone entry fails', () => {
  const added = guardProblems({ 'src/x.js': 'const a = 1;\nif (process.platform === "darwin") a();\n' }, {});
  assert.equal(added.length, 1);
  assert.match(added[0], /^src\/x\.js: 2 system check\(s\), 0 allowed; .*line 2, process\.platform/);
  assert.deepEqual(guardProblems({ 'src/os/index.js': 'process.platform' }, {}), []);
  assert.deepEqual(guardProblems({ 'src/x.js': '// Library/Application Support in a comment\n' }, {}), []);
  const gone = guardProblems({ 'src/y.js': 'nothing here' }, { 'src/y.js': 1 });
  assert.match(gone[0], /the list only shrinks/);
});
