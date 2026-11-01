import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError, StoreError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { RUNNING_VERSION } from '../install/lock.js';
import { loadSigner } from '../sign/signer.js';
import { readToken } from '../sign/token.js';
import { acquireLock } from '../store/files.js';
import { miraiHome, openStore } from '../store/home.js';
import { blobAt } from '../store/git.js';
import { snapshot } from '../trust/snapshot.js';
import { sessionCases, runsFor } from './cases-session.js';
import { macos } from './host.js';
import { binaryHash, canonical, frameworkHash, keyOf, resolveClaude } from './key.js';
import { ECHO_SERVER, realConfigMentions, realFolderFacts, removeFixture, runSessionCases, sessionState } from './session-run.js';
import { listResults, readResult, SESSIONS, writeResult } from './store.js';

// `mirai redteam run --sessions` (unit 18e): your own sessions' suite, its signed result and where
// it stands. Its own key: what can change what these cases find. Nothing a launch checks reads it,
// and the headless key doesn't include it (T4).
// `rules`: what the fixtures start from, the integration branch's own rule files (the render on
// top comes from the framework). Your work tree and your git-ignored file aren't tested, so neither
// makes a result stale; a run on a hostile branch tests the integration branch all the same.
export const SESSION_KEY_PARTS = Object.freeze(['claude_code', 'framework', 'rules', 'macos', 'node']);
const RESULT_SCHEMA_VERSION = 1;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function rulesHash(store, trust) {
  return sha256(['.claude/settings.json', '.mcp.json'].map((rel) => `${rel}:${blobAt(store.checkout, trust.baseSha, rel, store.gitEnv)?.toString('base64') ?? 'absent'}`).join('\n'));
}

export async function sessionKeyParts({ env, store, trust, claude = null }) {
  const c = resolveClaude(env, claude);
  return {
    claude_code: { version: c.version, sha256: await binaryHash(join(store.dir, 'redteam'), c.real) },
    framework: frameworkHash(trust),
    rules: rulesHash(store, trust),
    macos: macos(),
    node: process.version,
  };
}

export const changedSessionParts = (a, b) => SESSION_KEY_PARTS.filter((k) => canonical(a?.[k]) !== canonical(b?.[k]));

export function sessionEstimate(only = null) {
  const cases = sessionCases().filter((k) => !only || only.includes(k.id) || only.includes(k.group));
  const runs = cases.filter((k) => k.kind === 'model').reduce((n, k) => n + runsFor(k), 0);
  return { cases: cases.length, runs, minutes: Math.ceil((cases.reduce((n, k) => n + runsFor(k), 0) * 12) / 4 / 60) };
}

// A look-alike's rival: the echo server at your local scope, in the fixture's temporary config.
const addLocalEcho = (claude) => (fx) => {
  const entry = { type: 'stdio', command: '/usr/bin/env', args: ['-i', 'PATH=/usr/bin:/bin', process.execPath, ECHO_SERVER, 'LOCAL-marker'], env: {} };
  spawnSync(claude, ['mcp', 'add-json', 'mirai', JSON.stringify(entry), '--scope', 'local'], { cwd: fx.root, env: { ...fx.env, CLAUDE_CONFIG_DIR: fx.config }, timeout: 60_000 });
};

export async function runSessions({ cwd, env, storeEnv = env, consent = false, only = null, workers = 4, claude = null, signer = null, signal = null, onEvent = () => {}, now = () => new Date(), launch, caseList = sessionCases, runsOf = runsFor, parent = null }) {
  if (consent !== true) throw new UsageError('this uses your Claude subscription; it needs your yes', 'run it yourself: mirai redteam run --sessions');
  const store = openStore({ cwd, env: storeEnv });
  const trust = snapshot({ cwd, env: storeEnv });
  const sign = signer ?? loadSigner(storeEnv, store);
  const cases = caseList().filter((k) => !only || only.includes(k.id) || only.includes(k.group));
  if (only && !cases.length) throw new UsageError(`no case named ${only.join(', ')}`);
  const c = resolveClaude(env, claude);
  const token = cases.some((k) => k.kind === 'model') ? readToken(env) : null;
  if (cases.some((k) => k.kind === 'model') && !token) throw new StoreError('there is no Claude login token for agent runs', { code: 'no-token', exitCode: EXIT.NEEDS_HUMAN, hint: 'in your terminal: claude setup-token, then mirai token set' });
  // One red team at a time on this machine, of either kind.
  const lock = acquireLock(join(miraiHome(storeEnv), 'redteam-run.lock'), 'running the red team', { waitMs: 0 });
  let workdir = null;
  try {
    const realHome = realpathSync(env.HOME);
    workdir = realpathSync(mkdtempSync(join(parent ?? realHome, '.mirai-sessions-')));
    const startedAt = Date.now();
    const before = realFolderFacts(realHome);
    const parts = await sessionKeyParts({ env, store, trust, claude });
    const results = await runSessionCases({ cases, runsFor: runsOf, checkout: store.checkout, branch: store.branch, workdir, realHome, claude: c.real, token, workers, signal, onEvent, launch, addLocal: addLocalEcho(c.real) });
    const removed = removeFixture(workdir);
    const stops = [
      ...results.problems,
      ...(removed ? [] : ['the work folder couldn\'t be removed']),
      ...(realFolderFacts(realHome) !== before ? ['your real ~/.config/mirai changed during the run (names, sizes or times; contents never read)'] : []),
      ...(realConfigMentions(realHome, workdir) ? ['the work folder appears in your real Claude Code config'] : []),
      ...(signal?.aborted ? ['stopped by you'] : []),
    ];
    const stopped = stops.length ? stops.join('; ') : null;
    const result = {
      schema_version: RESULT_SCHEMA_VERSION, key: keyOf(parts), parts, state: sessionState(results, { stopped }), created_at: now().toISOString(), mirai_version: RUNNING_VERSION,
      trust: { base_sha: trust.baseSha, manifest_sha256: trust.manifestSha256 }, model: 'haiku', workers, duration_ms: Date.now() - startedAt, stopped, cases: [...results],
    };
    const partial = only !== null || signal?.aborted === true;
    const recorded = partial ? null : writeResult(store, result, sign, { now, kind: SESSIONS });
    return { result: recorded ?? result, recorded: recorded !== null, partial };
  } finally {
    if (workdir) removeFixture(workdir);
    lock.release();
  }
}

// { state: green | red | incomplete | stale | none, key, parts, result, changed }.
export async function sessionStatus({ cwd, env, claude = null }) {
  const store = openStore({ cwd, env });
  const trust = snapshot({ cwd, env });
  const parts = await sessionKeyParts({ env, store, trust, claude });
  const key = keyOf(parts);
  const result = readResult(store, key, { kind: SESSIONS });
  if (result) return { state: result.state, key, parts, result, changed: [] };
  for (const k of listResults(store, SESSIONS)) {
    try {
      const other = readResult(store, k, { kind: SESSIONS });
      if (other) return { state: 'stale', key, parts, result: other, changed: changedSessionParts(other.parts, parts) };
    } catch {
      // one that doesn't verify counts for nothing
    }
  }
  return { state: 'none', key, parts, result: null, changed: [] };
}
