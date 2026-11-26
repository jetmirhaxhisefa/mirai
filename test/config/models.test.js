import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { STEPS } from '../../src/config/defaults.js';
import { setKey } from '../../src/config/edit.js';
import { personalModels, personalWhy, withPersonalModels } from '../../src/config/personal-models.js';
import { pickTier } from '../../src/agent/tiers.js';
import { checkCommand, COMMANDS } from '../../src/mcp/tools/commands.js';
import { openStore } from '../../src/store/home.js';
import { snapshot, trustedConfig } from '../../src/trust/snapshot.js';
import { installed } from '../tests/run-fixture.js';

// Unit 45b: `mirai models`. No model runs: stand-ins answer for Claude Code's live list and for
// --check's tiny call.

async function run(f, argv, extra = {}) {
  let out = '';
  let err = '';
  const stdin = Readable.from(['\n']);
  const code = await main(argv, { stdin, stdout: { isTTY: false, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: f.env, cwd: f.root, ...extra });
  return { code, out, err };
}
const cfg = (f) => readFileSync(join(f.root, '.mirai', 'config.toml'), 'utf8');
const rowOf = (out, step) => out.split('\n').find((l) => l.startsWith(`${step} `)) ?? '';
const personalPath = (f) => join(openStore({ cwd: f.root, env: f.env }).dir, 'config.user.toml');

test('45b T1: the listing: every step with its agent, tier, model, tool and source; judgement steps must stay deep; a project override and your personal file name their source', async () => {
  const f = installed();
  const r = await run(f, ['models']);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /^step +agent +tier +model +tool +from$/m);
  for (const step of STEPS) assert.ok(rowOf(r.out, step), step);
  assert.equal(STEPS.length, 15);
  assert.match(rowOf(r.out, 'prd'), /Nora \(mirai-product-manager\) +deep +claude-opus-5-5 +Claude Code +default \(must stay deep\)$/);
  assert.match(rowOf(r.out, 'tickets'), /Tess \(mirai-ticket-planner\) +standard +claude-sonnet-5-5 +Claude Code +default$/);
  assert.match(rowOf(r.out, 'verify'), /Vera \(mirai-verifier\) +standard/);
  assert.match(rowOf(r.out, 'plan'), /Kai \(mirai-developer\)/);
  assert.match(rowOf(r.out, 'review-high-risk'), /Rex \(mirai-reviewer\) +deep .*must stay deep/);
  assert.match(rowOf(r.out, 'commit-message'), /MIRAI +light +claude-haiku-5-5/);
  assert.match(r.out, /^standard +claude-sonnet-5-5 +default$/m);
  assert.match(r.out, /one tier up for high risk or size L \(not for steps that are already deep\)/);
  // A project override, committed: its file and line.
  writeFileSync(join(f.root, '.mirai', 'config.toml'), `${cfg(f)}\n[models.steps]\nverify = "deep"\n`);
  f.git('commit', '-qam', 'verify deep');
  const o = await run(f, ['models']);
  assert.match(rowOf(o.out, 'verify'), /deep +claude-opus-5-5 +Claude Code +\.mirai\/config\.toml:\d+$/);
  // Your personal file: its source.
  writeFileSync(personalPath(f), 'schema_version = 1\n[models]\nstandard = "claude-sonnet-5-5"\n[models.steps]\nreview = "deep"\n', { mode: 0o600 });
  const p = await run(f, ['models']);
  assert.match(rowOf(p.out, 'review'), /deep .*your personal file$/);
  assert.match(p.out, /^standard +claude-sonnet-5-5 +your personal file$/m);
  const j = JSON.parse((await run(f, ['models', '--json'])).out);
  assert.equal(j.steps.length, 15);
  assert.equal(j.steps.find((s) => s.step === 'review').from, 'your personal file');
});

test('45b T2: a step\'s tier: set writes only that key (comments kept) and renders; the default removes it; a judgement step off deep and an unknown step are refused', async () => {
  const f = installed();
  writeFileSync(join(f.root, '.mirai', 'config.toml'), `${cfg(f)}\n# our models\n[models]\n# Sonnet for the standard tier\nstandard = "claude-sonnet-5-5"\n`);
  f.git('commit', '-qam', 'comments');
  const before = cfg(f);
  const r = await run(f, ['models', 'set', 'verify', 'deep']);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /set: models\.steps\.verify = deep in \.mirai\/config\.toml; rendered/);
  assert.match(r.out, /commit it: git add \.mirai && git commit -m "MIRAI models: verify deep"/);
  assert.match(r.out, /Launches use it once it's on main/);
  const after = cfg(f);
  assert.ok(after.startsWith(before.trimEnd()), 'everything before stays, comments too');
  assert.match(after, /\n\[models\.steps\]\nverify = "deep"\n$/);
  // Not committed by MIRAI; the listing says it isn't on main yet.
  assert.notEqual(f.git('status', '--porcelain').trim(), '');
  assert.match((await run(f, ['models'])).out, /isn't on main yet; launches use main's until it is merged/);
  f.git('add', '-A');
  f.git('commit', '-qm', 'models');
  // T5: committed, the trust snapshot accepts the rendered files and the lock.
  assert.equal(trustedConfig(snapshot({ cwd: f.root, env: f.env })).models.steps.verify, 'deep');
  // Back to the default: the key goes.
  const back = await run(f, ['models', 'set', 'verify', 'standard']);
  assert.equal(back.code, EXIT.OK, back.err);
  assert.doesNotMatch(cfg(f), /verify = /);
  f.git('add', '-A');
  f.git('commit', '-qm', 'models back');
  const prd = await run(f, ['models', 'set', 'prd', 'standard']);
  assert.equal(prd.code, EXIT.BLOCKED);
  assert.match(prd.err, /models\.steps\.prd must stay "deep": judgement steps are never run on a lower tier \(D-14\); nothing was written/);
  const nosuch = await run(f, ['models', 'set', 'nosuch', 'deep']);
  assert.equal(nosuch.code, EXIT.USAGE);
  assert.match(nosuch.err, /steps: prd, design, tickets/);
});

test('45b T3: a tier\'s model: set writes a full ID; off its family refused; an alias refused naming its full ID (Jet\'s "A"); an unknown name refused naming --check; --check proves or refuses with the tool\'s words', async () => {
  const f = installed();
  const ok = await run(f, ['models', 'set', 'deep', 'claude-fable-5-1']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.match(cfg(f), /\[models\]\ndeep = "claude-fable-5-1"/);
  f.git('add', '-A');
  f.git('commit', '-qm', 'fable');
  const family = await run(f, ['models', 'set', 'deep', 'claude-haiku-5-5']);
  assert.equal(family.code, EXIT.BLOCKED);
  assert.match(family.err, /isn't an Opus or Fable model, so it can't be the deep tier's model/);
  // An alias: refused, naming the full ID to use; `best` has no family word, so the tier's default.
  const alias = await run(f, ['models', 'set', 'standard', 'sonnet']);
  assert.equal(alias.code, EXIT.BLOCKED);
  assert.match(alias.err, /"?sonnet"? is an alias: it moves to the newest model of its kind, and a launch runs only the exact model it asks for; nothing was written/);
  assert.match(alias.err, /use its full ID: mirai models set standard claude-sonnet-5-5/);
  assert.match((await run(f, ['models', 'set', 'deep', 'best'])).err, /use a full ID, such as claude-opus-5-5/);
  assert.equal(f.git('status', '--porcelain').trim(), '');
  const unknown = await run(f, ['models', 'set', 'standard', 'claude-sonnet-9-9']);
  assert.equal(unknown.code, EXIT.BLOCKED);
  assert.match(unknown.err, /isn't a model MIRAI knows for Claude Code/);
  assert.match(unknown.err, /mirai models set standard claude-sonnet-9-9 --check/);
  const refused = await run(f, ['models', 'set', 'standard', 'claude-sonnet-9-9', '--check'], { modelCheck: () => ({ status: 1, stderr: 'API Error: model not found: claude-sonnet-9-9', stdout: '' }) });
  assert.equal(refused.code, EXIT.BLOCKED);
  assert.match(refused.err, /Claude Code refused claude-sonnet-9-9: API Error: model not found/);
  const proved = await run(f, ['models', 'set', 'standard', 'claude-sonnet-9-9', '--check'], { modelCheck: () => ({ status: 0, stderr: '', stdout: 'ok' }) });
  assert.equal(proved.code, EXIT.OK, proved.err);
  assert.match(proved.out, /checked: Claude Code answered with claude-sonnet-9-9/);
  // An alias in your personal file is refused at a launch too.
  const store = openStore({ cwd: f.root, env: f.env });
  writeFileSync(personalPath(f), 'schema_version = 1\n[models]\nstandard = "sonnet"\n', { mode: 0o600 });
  const { knownModel, shippedModels } = await import('../../src/agent/models.js');
  const list = shippedModels(join(f.root, '.mirai', 'framework', 'registry'));
  assert.throws(() => personalModels(store, { known: (m) => { const k = knownModel(list, m); return k.known && !k.alias; } }), /isn't a model MIRAI knows/);
});

test('45b T4: --mine writes your private personal file, the listing names it, your launches use it, a personal judgement step off deep is refused; the project config is unchanged', async () => {
  const f = installed();
  const before = cfg(f);
  const r = await run(f, ['models', 'set', 'standard', 'claude-sonnet-5-5', '--mine']);
  assert.equal(r.code, EXIT.OK, r.err);
  const s = await run(f, ['models', 'set', 'verify', 'deep', '--mine']);
  assert.equal(s.code, EXIT.OK, s.err);
  assert.match(s.out, /in your personal file .*config\.user\.toml.*the project config is unchanged/);
  assert.equal(statSync(personalPath(f)).mode & 0o777, 0o600);
  assert.equal(cfg(f), before);
  assert.equal(f.git('status', '--porcelain').trim(), '');
  assert.match(rowOf((await run(f, ['models'])).out, 'verify'), /deep +claude-opus-5-5 .*your personal file$/);
  // A launch of yours: the config it picks from, and the run line's words.
  const store = openStore({ cwd: f.root, env: f.env });
  const main = trustedConfig(snapshot({ cwd: f.root, env: f.env }));
  const { config, personal } = withPersonalModels(main, store);
  const picked = pickTier({ config, step: 'verify' });
  assert.equal(picked.tier, 'deep');
  assert.equal(personalWhy(personal, { step: 'verify', tier: 'deep', model: config.models.deep }), 'verify: deep from your personal file');
  // A project-only run is unchanged.
  assert.equal(pickTier({ config: main, step: 'verify' }).tier, 'standard');
  // A personal prd = "standard" is refused, by set and at a launch.
  const prd = await run(f, ['models', 'set', 'prd', 'standard', '--mine']);
  assert.equal(prd.code, EXIT.BLOCKED);
  writeFileSync(personalPath(f), 'schema_version = 1\n[models.steps]\nprd = "standard"\n', { mode: 0o600 });
  assert.throws(() => personalModels(store), /models\.steps\.prd must stay "deep"/);
  writeFileSync(personalPath(f), 'schema_version = 1\n[models]\nstandard = "claude-haiku-5-5"\n', { mode: 0o600 });
  assert.throws(() => personalModels(store), /isn't a Sonnet model/);
});

test('45b T6: refusals: a config with changes not committed, a config that doesn\'t parse, a key written in a form a line edit can\'t change: nothing written', async () => {
  const f = installed();
  writeFileSync(join(f.root, '.mirai', 'config.toml'), `${cfg(f)}\n# a change of yours\n`);
  const dirty = await run(f, ['models', 'set', 'verify', 'deep']);
  assert.equal(dirty.code, EXIT.BLOCKED);
  assert.match(dirty.err, /has changes not committed; nothing was written/);
  assert.throws(() => setKey('schema_version = 1\n[models\n', { table: 'models', key: 'deep', value: 'x' }), (e) => e.code === 'config-parse');
  // MIRAI's TOML has no dotted keys at all (src/config/TOML-SUBSET.md): such a file doesn't parse.
  assert.throws(() => setKey('schema_version = 1\nmodels.steps.verify = "deep"\n', { table: 'models.steps', key: 'verify', value: 'standard' }), (e) => e.code === 'config-parse');
  assert.throws(() => setKey('schema_version = 1\n[models]\nsteps = { verify = "deep" }\n', { table: 'models.steps', key: 'verify', value: 'standard' }), (e) => e.code === 'config-form');
});

test('45b T7: /mirai models and /mirai models set are on the session list; their arguments are checked', () => {
  assert.ok(COMMANDS.models && COMMANDS['models set']);
  assert.deepEqual(checkCommand({ command: 'models', json: true }).args, { command: 'models', json: true });
  assert.deepEqual(checkCommand({ command: 'models set', target: 'verify', value: 'deep', mine: true }).args, { command: 'models set', target: 'verify', value: 'deep', mine: true });
  assert.ok(checkCommand({ command: 'models set', target: 'verify; rm', value: 'deep' }).refused);
  assert.ok(checkCommand({ command: 'models set', target: 'verify' }).refused);
  assert.deepEqual(COMMANDS['models set'].argv({ target: 'standard', value: 'claude-sonnet-5-5', mine: true, check: true }), ['models', 'set', 'standard', 'claude-sonnet-5-5', '--mine', '--check']);
});
