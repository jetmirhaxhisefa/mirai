#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { init } from '../../src/install/init.js';
import { canonicalSha256 } from '../../src/launch/strict.js';
import { addArgs, sessionServer } from '../../src/mcp/session.js';
import { keyParts, keyOf, resolveClaude, templateNames } from '../../src/redteam/key.js';
import { RESULT_SCHEMA_VERSION, writeResult } from '../../src/redteam/store.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { loadSigner } from '../../src/sign/signer.js';
import { readToken, writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { snapshot, trustedStrict } from '../../src/trust/snapshot.js';
import { parseStream, redact } from '../../src/redteam/claude.js';

// Unit 19c's R1 and R2 (G30): a real Claude Code session calls start_agent on MIRAI's real server,
// the worker launches a real agent, the session exits, and agent_status's record shows the outcome.
// On a sample-app clone with a probe home. **The red-team gate is satisfied by a green result
// written here, signed with the probe's own key, for the clone's exact key**: a clone has no real
// one, and a full red team would take 20 minutes. Everything else is the real path.
//   node test/probes/broker-launch-probe.js --yes
if (!process.argv.includes('--yes')) {
  process.stderr.write('--yes: two Haiku runs (the session and the agent)\n');
  process.exit(2);
}
const realHome = realpathSync(process.env.HOME);
const work = realpathSync(mkdtempSync(join(realHome, '.mirai-probes-')));
const root = join(work, 'repo');
const home = join(work, 'home');
const config = join(home, '.claude-probe');
mkdirSync(config, { recursive: true, mode: 0o700 });
const log = (l) => process.stdout.write(`${l}\n`);
try {
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: root, env: gitEnv }).toString();
  execFileSync('/usr/bin/git', ['clone', '--quiet', '--no-local', join(realHome, 'Projects', 'mirai-sample-app'), root], { env: gitEnv });
  git('remote', 'remove', 'origin');
  const claude = resolveClaude(process.env);
  const env = { PATH: `${dirname(claude.path)}:/usr/bin:/bin`, HOME: realpathSync(home) };
  init({ cwd: root, env, refresh: true });
  const key = createKeyPair(env);
  writePublicKeyFile(root, key.keyId, key.publicPem);
  git('add', '-A');
  git('commit', '-qm', 'probe (unit 19c)');
  const token = readToken(process.env);
  writeToken(env, token);
  const store = openStore({ cwd: root, env });
  const trust = snapshot({ cwd: root, env });
  // The probe's green: computed as the worker will compute it (an empty environment).
  const workerEnv = { HOME: env.HOME, PATH: '/usr/bin:/bin' };
  const parts = await keyParts({ env: workerEnv, hostEnv: workerEnv, trust, store, claude: resolveClaude(workerEnv, claude.path) });
  const templates = Object.fromEntries(templateNames(trust).map((n) => [n, { bundle: canonicalSha256(trustedStrict(trust, n)), cases: 1, tested: true }]));
  writeResult(store, { schema_version: RESULT_SCHEMA_VERSION, key: keyOf(parts), parts, state: 'green', created_at: new Date().toISOString(), templates, cases: [], probe: 'unit 19c R1: a stand-in green' }, loadSigner(env, store));
  // MIRAI's server, registered as install does, in a temporary Claude Code config.
  const server = sessionServer({ store, trust, env });
  const cc = (args) => spawnSync(claude.real, args, { cwd: root, env: { ...env, CLAUDE_CONFIG_DIR: config }, encoding: 'utf8', timeout: 60_000 });
  log(`registered: exit ${cc(addArgs(server.entry)).status}; start_agent offered: ${Boolean(server.policy.tools.start_agent)}`);
  // Trusted, as yours would be; the registration lives in the same entry, so merged, not replaced.
  const cfg = JSON.parse(readFileSync(join(config, '.claude.json'), 'utf8'));
  cfg.projects ??= {};
  const key_ = realpathSync(root);
  cfg.projects[key_] = { ...(cfg.projects[key_] ?? {}), hasTrustDialogAccepted: true };
  writeFileSync(join(config, '.claude.json'), JSON.stringify(cfg));
  const prompt = 'Call the tool mcp__mirai__start_agent once, with role "reviewer", step "commit-message" and prompt "Reply with the single word PONG." Then reply with exactly the request id it returned.';
  const raw = await new Promise((done) => {
    const child = spawn(claude.real, ['-p', prompt, '--model', 'haiku', '--max-turns', '4', '--output-format', 'stream-json', '--verbose', '--allowedTools', 'mcp__mirai__start_agent'], { cwd: root, env: { ...env, CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '3' }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    child.stdio[3].end(token);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', (code) => done({ code, out }));
  });
  const p = parseStream(raw.out);
  const request = /q-\d{14}-[0-9a-f]{8}/.exec(raw.out)?.[0];
  log(`session: exit ${raw.code}; servers ${(p.init?.mcp_servers ?? []).map((m) => `${m.name}:${m.status}`).join(',')}; request ${request ?? 'none'}; said ${redact(String(p.result?.result ?? ''), token).slice(0, 120)}`);
  if (!request) throw new Error('no request id');
  // R2: the session has exited. The worker goes on, or it doesn't.
  const statusFile = join(store.dir, 'agent-requests', `${request}.status`);
  let s = null;
  for (let i = 0; i < 360; i++) {
    s = JSON.parse(readFileSync(statusFile, 'utf8'));
    if (s.state === 'done') break;
    await new Promise((d) => setTimeout(d, 1000));
  }
  log(`after the session ended: ${s.state}; outcome ${s.outcome ?? '-'}${s.why ? ` (${String(s.why).slice(0, 200)})` : ''}; model ${s.model ?? '-'}; reply ${String(s.reply_untrusted ?? '').slice(0, 80)}`);
  cc(['mcp', 'remove', 'mirai', '--scope', 'local']);
} finally {
  spawnSync('/bin/chmod', ['-R', 'u+rwX', work]);
  rmSync(work, { recursive: true, force: true });
}
