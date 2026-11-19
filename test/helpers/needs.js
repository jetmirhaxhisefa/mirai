import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { test } from 'node:test';

// Tests that need something CI's machines don't have (unit 30a): each is marked with what it
// needs and why, and skipped with that reason where it's missing, never hidden. What's there is
// detected, never read from an environment variable CI could set. On your Mac, with Docker
// running, nothing is skipped (P3); the build runner's `tests` job stays the full check.
//
//   const dockerTest = needsTest('docker', 'runs the sample image');
//   dockerTest('T5: …', async () => { … });
//
// MIRAI_LEFT_OUT names a file where each skipped test is recorded, one JSON line, for
// `node test/helpers/left-out.js <file>` to print at the end of the run.

const DETECT = {
  docker: () => ok('docker', ['info', '--format', '{{.ServerVersion}}']),
  cage: () => existsSync('/usr/bin/sandbox-exec'),
  claude: () => ok('claude', ['--version']),
  macos: () => process.platform === 'darwin',
};
export const NEEDS = Object.freeze(Object.keys(DETECT));

function ok(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore', timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

const seen = new Map();
export function has(need, detect = DETECT) {
  if (!Object.hasOwn(detect, need)) throw new TypeError(`unknown need ${JSON.stringify(need)}: one of ${Object.keys(detect).join(', ')}`);
  if (detect !== DETECT) return detect[need]();
  if (!seen.has(need)) seen.set(need, detect[need]());
  return seen.get(need);
}

// The skip reason for a test that needs `need`, or false when it can run here.
export function needs(need, reason, { detect = DETECT } = {}) {
  if (typeof reason !== 'string' || !reason.trim()) throw new TypeError('needs() takes a reason');
  return has(need, detect) ? false : `needs ${need}: ${reason}`;
}

// `test` for tests that need `need`; a skipped one is recorded in MIRAI_LEFT_OUT's file.
export function needsTest(need, reason, { detect = DETECT, env = process.env, file = callerFile(), register = test } = {}) {
  const skip = needs(need, reason, { detect });
  return (name, options, fn) => {
    if (typeof options === 'function') [options, fn] = [{}, options];
    if (skip && env.MIRAI_LEFT_OUT) appendFileSync(env.MIRAI_LEFT_OUT, `${JSON.stringify({ need, reason, file, test: name })}\n`);
    return register(name, skip ? { ...options, skip } : options, fn);
  };
}

function callerFile() {
  const line = new Error().stack.split('\n').find((l) => /\.test\.js/.test(l)) ?? '';
  const m = /(test\/[^:)]+\.test\.js)/.exec(line);
  return m ? m[1] : basename(line);
}

// The left-out list: grouped by what was missing.
export function leftOutText(lines) {
  const rows = lines.filter(Boolean).map((l) => JSON.parse(l));
  if (!rows.length) return 'left out: none\n';
  const by = new Map();
  for (const r of rows) by.set(r.need, [...(by.get(r.need) ?? []), r]);
  const out = [`left out (${rows.length}):`];
  for (const [need, rs] of [...by].sort()) {
    out.push(`  ${need} (${rs.length}):`);
    for (const r of rs) out.push(`    ${r.file}: ${r.test} (${r.reason})`);
  }
  return `${out.join('\n')}\n`;
}

export function readLeftOut(path) {
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [];
}
