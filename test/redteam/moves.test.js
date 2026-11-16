import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runAgent } from '../../src/agent/run.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { claudeOf } from '../../src/proofs/record.js';
import { checkGap, gapNote, GAP_DAYS, moveAtStart, readMove, RETRY_MS } from '../../src/redteam/move.js';
import { pinnedEverywhere, readPin, releaseFinished } from '../../src/redteam/pin.js';
import { keepTested, pruneTested, readTested, stageTested, testedRoot } from '../../src/redteam/tested.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { loadSigner } from '../../src/sign/signer.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { readRunLog, runIds } from '../../src/store/run-log.js';
import { readTicketStatus, writeTicketStatus } from '../../src/store/tickets.js';
import { snapshot, trustedRegistry } from '../../src/trust/snapshot.js';
import { installed, tempDir } from '../tests/run-fixture.js';

// Unit 18h: one Claude Code per ticket, and moves between tickets. Stand-in binaries, no model.

const TOKEN = `sk-ant-oat01-${'Ag3_-k'.repeat(16)}`;
const INIT = '{"type":"system","subtype":"init","permissionMode":"dontAsk"}';
const RESULT = '{"type":"result","subtype":"success","is_error":false,"result":"done","num_turns":2,"usage":{"input_tokens":5,"output_tokens":6}}';
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const noInitProblems = () => [];

function repo() {
  const f = installed();
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  writeToken(f.env, TOKEN);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  return f;
}

// A stand-in claude of `version` (each version a different binary).
function claudeOf_(version) {
  const path = join(realpathSync(tempDir()), 'claude');
  writeFileSync(path, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${version} (Claude Code)"; exit 0; fi\necho '${INIT}'; echo '${RESULT}'\n`, { mode: 0o755 });
  return path;
}
async function keep(f, store, version) {
  const staged = await stageTested({ env: f.env, claude: { real: claudeOf_(version), version }, allowScript: true });
  keepTested({ env: f.env, store, staged, signer: loadSigner(f.env, store) });
  return staged;
}
const ticket = (f, store, id) => writeTicketStatus(store, { ticket: id, state: 'ready-for-dev', written_by: 'human' }, { expectSeq: null, signer: loadSigner(f.env, store) });

test('18h T1: a ticket\'s first launch pins the kept Claude Code; after a move its later launches still run it; the next ticket pins the new one; the log and the proof name it', async () => {
  const f = repo();
  const store = openStore({ cwd: f.root, env: f.env });
  const a = await keep(f, store, '2.1.330');
  ticket(f, store, 'T-1');
  ticket(f, store, 'T-2');
  const seen = [];
  const status = async (o) => {
    seen.push(o.claude);
    return green();
  };
  const launch = (item) => runAgent({ launchToken: mintLaunchToken(), cwd: f.root, env: f.env, role: 'author', prompt: 'do it', item, status, check: noInitProblems });
  assert.equal((await launch('T-1')).outcome, 'ok');
  assert.equal(readPin(store, 'T-1').sha256, a.sha256, 'pinned at its first launch');
  const b = await keep(f, store, '2.1.331');
  assert.equal(readTested(store).current.sha256, b.sha256, 'agents moved');
  assert.equal((await launch('T-1')).outcome, 'ok');
  assert.equal((await launch('T-2')).outcome, 'ok');
  assert.deepEqual(seen, [a.path, a.path, b.path], 'T-1 stays on its pin; T-2 starts on the new one');
  assert.equal(readPin(store, 'T-2').sha256, b.sha256);
  // A launch that isn't for a ticket (the usage probe's `run`) runs the kept one, and pins nothing.
  assert.equal((await launch('run')).outcome, 'ok');
  assert.equal(seen.at(-1), b.path);
  const lines = runIds(store).flatMap((id) => readRunLog(store, id).lines).filter((l) => l.event === 'agent_run');
  assert.deepEqual(lines.map((l) => [l.item, l.claude_code]), [['T-1', '2.1.330'], ['T-1', '2.1.330'], ['T-2', '2.1.331'], ['run', '2.1.331']]);
  assert.deepEqual(claudeOf(store, 'T-1'), { version: '2.1.330', sha256: a.sha256 }, 'the gate proof\'s claude_code');
});

test('18h T2: a pinned copy outlives two later moves; a pin that doesn\'t verify or a changed copy refuses; a dropped ticket\'s pin goes, then its copy', async () => {
  const { appendFileSync, chmodSync, writeFileSync: write } = await import('node:fs');
  const f = repo();
  const store = openStore({ cwd: f.root, env: f.env });
  const a = await keep(f, store, '2.1.330');
  ticket(f, store, 'T-1');
  const launch = () => runAgent({ launchToken: mintLaunchToken(), cwd: f.root, env: f.env, role: 'author', prompt: 'do it', item: 'T-1', status: green, check: noInitProblems });
  await launch();
  await keep(f, store, '2.1.331');
  await keep(f, store, '2.1.332');
  const later = Date.now() + 3_600_000;
  pruneTested(f.env, { now: later });
  assert.equal(existsSync(a.path), true, 'kept for its pin');
  assert.equal(pinnedEverywhere(f.env).has(a.sha256), true);
  // Dropped: released, and the copy can go.
  writeTicketStatus(store, { ticket: 'T-1', state: 'dropped', written_by: 'human' }, { expectSeq: readTicketStatusSeq(store, 'T-1'), signer: loadSigner(f.env, store) });
  assert.deepEqual(releaseFinished(store), ['T-1']);
  assert.equal(readPin(store, 'T-1'), null);
  pruneTested(f.env, { now: later });
  assert.equal(existsSync(a.path), false, 'pruned once released');
  // A pin that doesn't verify refuses; so does a changed pinned copy.
  ticket(f, store, 'T-3');
  await runAgent({ launchToken: mintLaunchToken(), cwd: f.root, env: f.env, role: 'author', prompt: 'do it', item: 'T-3', status: green, check: noInitProblems });
  const pin = readPin(store, 'T-3');
  chmodSync(join(testedRoot(f.env), pin.sha256), 0o700);
  chmodSync(pin.path, 0o700);
  appendFileSync(pin.path, '# changed\n');
  await assert.rejects(runAgent({ launchToken: mintLaunchToken(), cwd: f.root, env: f.env, role: 'author', prompt: 'do it', item: 'T-3', status: green, check: noInitProblems }), (e) => e.code === 'ticket-claude-changed');
  write(join(store.dir, 'tickets', 'T-3', 'claude-code.json'), '{"ticket":"T-3"}\n');
  await assert.rejects(runAgent({ launchToken: mintLaunchToken(), cwd: f.root, env: f.env, role: 'author', prompt: 'do it', item: 'T-3', status: green, check: noInitProblems }), (e) => e.code === 'ticket-claude-invalid');
});

const readTicketStatusSeq = (store, id) => readTicketStatus(store, id)?.status?.seq ?? null;

// The move at a ticket's start, with a stand-in red team.
async function moveRepo({ consent = null, installedVersion = '2.1.340' } = {}) {
  const f = repo();
  const store = openStore({ cwd: f.root, env: f.env });
  await keep(f, store, '2.1.330');
  // A newer one installed on PATH.
  const bin = realpathSync(tempDir('path'));
  writeFileSync(join(bin, 'claude'), claudeBody(installedVersion), { mode: 0o755 });
  const env = { ...f.env, PATH: `${bin}:${f.env.PATH}` };
  if (consent) {
    mkdirSync(join(f.env.HOME, '.config', 'mirai'), { recursive: true });
    writeFileSync(join(f.env.HOME, '.config', 'mirai', 'config.toml'), `[claude_code]\nmove = "${consent}"\n`);
  }
  ticket(f, store, 'T-1');
  const data = trustedRegistry(snapshot({ cwd: f.root, env })).adapters['claude-code'].strict.binary;
  const clean = () => ({ settings_keys: data.settings_keys, settings_objects: data.settings_objects, permission_keys: data.permission_keys, profile_rules: data.profile_rules });
  return { f, store, env, clean, data };
}
const claudeBody = (version) => `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${version} (Claude Code)"; exit 0; fi\nexit 0\n`;

test('18h T3: at a ticket\'s start: S1/S2 new → no red team; clean without consent → a hint, once; with consent → the red team, green moves; not green → the current one, no second try within a day', async () => {
  // S1/S2 new.
  let m = await moveRepo({ consent: 'auto' });
  let runs = 0;
  const run = async () => {
    runs++;
    return { kept: { ok: true, version: '2.1.340' }, result: { state: 'green' } };
  };
  const said = [];
  let r = await moveAtStart({ cwd: m.f.root, env: m.env, store: m.store, ticket: 'T-1', run, say: (c) => said.push(c), facts: () => ({ ...m.clean(), permission_keys: [...m.data.permission_keys, 'aNewKey'] }) });
  assert.equal(r.moved, false);
  assert.equal(runs, 0, 'no red team over something unread');
  assert.equal(readMove(m.store).gap.kind, 'unread');
  assert.match(said.map((c) => c.name).join('\n'), /S1 found something new/);
  // Clean, no consent: a hint, once.
  m = await moveRepo();
  said.length = 0;
  r = await moveAtStart({ cwd: m.f.root, env: m.env, store: m.store, ticket: 'T-1', run, say: (c) => said.push(c), facts: m.clean });
  await moveAtStart({ cwd: m.f.root, env: m.env, store: m.store, ticket: 'T-1', run, say: (c) => said.push(c), facts: m.clean });
  assert.equal(runs, 0);
  assert.equal(said.filter((c) => /move = "auto"/.test(c.name)).length, 1, 'told once');
  assert.equal(readMove(m.store).gap.kind, 'consent');
  // Consent, green: moved, the gap gone.
  m = await moveRepo({ consent: 'auto' });
  r = await moveAtStart({ cwd: m.f.root, env: m.env, store: m.store, ticket: 'T-1', run, facts: m.clean });
  assert.equal(r.moved, true);
  assert.equal(runs, 1);
  assert.equal(readMove(m.store).gap, null);
  // Consent, not green: the current one, and no second automatic try within a day.
  m = await moveRepo({ consent: 'auto' });
  let reds = 0;
  const redRun = async () => {
    reds++;
    return { kept: null, result: { state: 'incomplete', cases: [{ id: 'l-bg', outcome: 'inconclusive' }, { id: 'l-cd', outcome: 'fail', informational: true }] } };
  };
  const t0 = new Date('2026-12-01T10:00:00Z');
  r = await moveAtStart({ cwd: m.f.root, env: m.env, store: m.store, ticket: 'T-1', run: redRun, facts: m.clean, now: () => t0 });
  assert.equal(r.moved, false);
  assert.match(r.note, /incomplete \(l-bg\)/);
  await moveAtStart({ cwd: m.f.root, env: m.env, store: m.store, ticket: 'T-1', run: redRun, facts: m.clean, now: () => new Date(t0.getTime() + RETRY_MS - 60_000) });
  assert.equal(reds, 1, 'not again within a day');
  await moveAtStart({ cwd: m.f.root, env: m.env, store: m.store, ticket: 'T-1', run: redRun, facts: m.clean, now: () => new Date(t0.getTime() + RETRY_MS + 60_000) });
  assert.equal(reds, 2, 'again after a day');
  // An older one installed (a downgrade): never a move.
  const down = await moveRepo({ consent: 'auto', installedVersion: '2.1.320' });
  r = await moveAtStart({ cwd: down.f.root, env: down.env, store: down.store, ticket: 'T-1', run: redRun, facts: down.clean });
  assert.equal(reds, 2, 'no red team for an older version');
  assert.equal(readMove(down.store).gap, null);
  // A ticket with a pin never moves.
  writeFileSync(join(m.store.dir, 'tickets', 'T-1', 'claude-code.json'), '{}', { mode: 0o600 });
  await assert.rejects(moveAtStart({ cwd: m.f.root, env: m.env, store: m.store, ticket: 'T-1', run: redRun, facts: m.clean }), (e) => e.code === 'ticket-claude-invalid', 'a pin that doesn\'t verify is never read as none');
});

test('18h T4: the gap warns from its first day; on day 8 a ticket with no pin doesn\'t start, a pinned one does', async () => {
  const m = await moveRepo();
  const t0 = new Date('2026-12-01T10:00:00Z');
  await moveAtStart({ cwd: m.f.root, env: m.env, store: m.store, ticket: 'T-1', run: async () => assert.fail('no run without consent'), facts: m.clean, now: () => t0 });
  const day = (n) => () => new Date(t0.getTime() + n * 86_400_000);
  assert.match(gapNote(m.store, { now: day(1) }).line, /2\.1\.340 is installed.*new tickets stop starting in 6 day\(s\)/);
  assert.doesNotThrow(() => checkGap(m.store, 'T-1', { now: day(GAP_DAYS - 1) }));
  assert.throws(() => checkGap(m.store, 'T-1', { now: day(GAP_DAYS) }), (e) => e.code === 'claude-gap' && /doesn't start/.test(e.message));
  // A pinned ticket finishes.
  ticket(m.f, m.store, 'T-2');
  await runAgent({ launchToken: mintLaunchToken(), cwd: m.f.root, env: m.env, role: 'author', prompt: 'do it', item: 'T-2', status: green, check: noInitProblems });
  assert.ok(readPin(m.store, 'T-2'));
  assert.doesNotThrow(() => checkGap(m.store, 'T-2', { now: day(GAP_DAYS + 3) }));
});

test('18h T5: the newest green result of a pinned binary is never rotated out of the last 20; others are', async () => {
  const { keyOf } = await import('../../src/redteam/key.js');
  const { KEEP_RESULTS, listResults, RESULT_SCHEMA_VERSION, writeResult } = await import('../../src/redteam/store.js');
  const { utimesSync } = await import('node:fs');
  const f = repo();
  const store = openStore({ cwd: f.root, env: f.env });
  const signer = loadSigner(f.env, store);
  const pinned = 'a'.repeat(64);
  const parts = (sha, n) => ({ claude_code: { version: '1', sha256: sha }, bundles: {}, framework: `f${n}`, docker: 'd', git: 'g', macos: 'm', node: 'n', project_rules: 'r', host_controls: {}, compose: {} });
  const write = (sha, n, state = 'green') => {
    const p = parts(sha, n);
    writeResult(store, { schema_version: RESULT_SCHEMA_VERSION, key: keyOf(p), parts: p, state, created_at: `2026-11-01T10:00:${String(n).padStart(2, '0')}.000Z`, cases: [] }, signer);
    // Newest first is by the file's time: one second apart.
    utimesSync(join(store.dir, 'redteam', `${keyOf(p)}.json`), 1_700_000_000 + n, 1_700_000_000 + n);
    return keyOf(p);
  };
  mkdirSync(join(store.dir, 'tickets', 'T-1'), { recursive: true, mode: 0o700 });
  writeFileSync(join(store.dir, 'tickets', 'T-1', 'claude-code.json'), JSON.stringify({ sha256: pinned }), { mode: 0o600 });
  const kept = write(pinned, 0);
  const unpinned = write('b'.repeat(64), 1);
  for (let n = 2; n < KEEP_RESULTS + 3; n++) write('c'.repeat(64), n);
  const left = listResults(store);
  assert.equal(left.includes(kept), true, 'the pinned binary\'s green result stays');
  assert.equal(left.includes(unpinned), false, 'an unpinned one rotates out');
});

test('18h T6: [claude_code] move: "auto" or "off" in your global file only; status and doctor name what\'s waiting; --ticket is for run alone', async () => {
  const { checkConfig, readConfigFile } = await import('../../src/config/load.js');
  const { main } = await import('../../src/cli/main.js');
  const dir = tempDir('cfg');
  const layer = (name, kind, body) => {
    writeFileSync(join(dir, name), `schema_version = 1\n${body}`);
    return { kind, file: readConfigFile(join(dir, name), { trust: kind === 'project' ? 'project' : 'personal' }) };
  };
  const project = (extra = '') => layer('p.toml', 'project', `[git]\nintegration_branch = "main"\n${extra}`);
  assert.doesNotThrow(() => checkConfig([project(), layer('g.toml', 'personal-global', '[claude_code]\nmove = "auto"\n')]));
  assert.throws(() => checkConfig([project(), layer('g.toml', 'personal-global', '[claude_code]\nmove = "always"\n')]));
  assert.throws(() => checkConfig([project('[claude_code]\nmove = "auto"\n')]), (e) => JSON.stringify(e.errors ?? e.message).includes('claude_code'));
  // What's waiting, in status.
  const m = await moveRepo();
  await moveAtStart({ cwd: m.f.root, env: m.env, store: m.store, ticket: 'T-1', run: async () => assert.fail('no run'), facts: m.clean });
  const out = [];
  const io = { cwd: m.f.root, env: m.env, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => out.push(s) }, stdin: process.stdin };
  await main(['status'], io);
  assert.match(out.join(''), /warning: Claude Code 2\.1\.340 is installed; agents still run the one tested before.*next: mirai redteam run/);
  out.length = 0;
  const code = await main(['redteam', 'status', '--ticket', 'T-1'], io);
  assert.notEqual(code, 0);
  assert.match(out.join(''), /--ticket is for run/);
});
