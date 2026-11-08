import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runBuild } from '../../src/agent/build.js';
import { runPlan } from '../../src/agent/plan.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { runReview } from '../../src/agent/review.js';
import { writeBaseline } from '../../src/baseline/store.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { checkProofs } from '../../src/proofs/check.js';
import { recordProofs } from '../../src/proofs/record.js';
import { createKeyPair, writePublicKeyFile, branchKeys } from '../../src/sign/keys.js';
import { generateKeyPairSync } from 'node:crypto';
import { loadSigner } from '../../src/sign/signer.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { readTicketStatus } from '../../src/store/tickets.js';
import { protectionRules } from '../../src/trust/protected.js';
import { snapshot, trustedConfig, trustedRegistry } from '../../src/trust/snapshot.js';
import { signProof } from '../../src/proofs/records.js';
import { installed, tempDir } from '../tests/run-fixture.js';

// Unit 25a: `mirai gate record` and `mirai gate check`, with a stand-in claude and test run (no
// model, no Docker), on a ticket Kai built and Rex passed.

const TOKEN = `sk-ant-oat01-${'Ag3_-k'.repeat(16)}`;
const INIT = '{"type":"system","subtype":"init","permissionMode":"dontAsk"}';
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const PLAN = readFileSync(join(REGISTRY_DIR, 'examples', 'plan.md'), 'utf8');
const CONFIG = '\n[[testing.levels]]\nname = "unit"\ncommand = ["run-tests"]\nservice = "app"\n\n[[testing.levels]]\nname = "feature"\ncommand = ["run-tests"]\nservice = "app"\n\n[compose]\nfiles = ["compose.yml"]\nenv_file = ".env.test"\n';
const doc = (fm, body) => `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${body}`;
const ticketDoc = doc({ id: 'PMT-31', type: 'story', template: 'story@v1', repo: '"."', risk: 'normal', size: 'M', verify: '"Rename a team on staging."', tdd: 'first' },
  '# Renaming a team hides its members\n\n## Acceptance criteria\n\n- AC-PMT-31.1: the members stay after a rename\n- AC-PMT-31.2: the old slug redirects\n');
const FILES = { 'docs/mirai/tickets/PMT-31.md': ticketDoc, 'package.json': '{\n  "name": "app",\n  "dependencies": { "express": "^4" }\n}\n', 'app/Team.php': '<?php\n// one\n// two\n' };
const PASSED = { state: 'pass', known_failures: [], tests: { total: 3, skipped: 0 } };
const passing = async ({ name }) => ({ outcome: 'pass', id: `t-${name}`, tests: { total: 3, passed: 3, failed: 0, errors: 0, skipped: 0 } });

async function tty(argv, { cwd, env }, answers = []) {
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd, ...(argv[0] === 'gate' ? { testRun: passing } : {}) });
  return { code, out, err };
}

function claudeWith(results, before = []) {
  const dir = realpathSync(tempDir('claude'));
  results.forEach((r, i) => {
    writeFileSync(join(dir, `r${i}.json`), `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 3, usage: { input_tokens: 5, output_tokens: 6 }, result: 'done', structured_output: r })}\n`);
    writeFileSync(join(dir, `b${i}.sh`), `${before[i] ?? ':'}\n`);
  });
  writeFileSync(join(dir, 'n'), '0');
  const path = join(dir, 'claude');
  writeFileSync(path, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2.1.316 (Claude Code)"; exit 0; fi
n=$(cat ${dir}/n); echo $((n+1)) > ${dir}/n
. ${dir}/b$n.sh
echo '${INIT}'; cat ${dir}/r$n.json
`, { mode: 0o755 });
  return { path };
}
const watch = (claude) => ({ claude: claude.path, status: green, check: () => [] });
const done = { status: 'done', summary: 'Changed app/Team.php.', tests_run: ['unit: pass'], checks_run: [] };

// PMT-31 built by Kai and, unless `reviewed: false`, passed by Rex: in-review, on its branch.
async function passed({ reviewed = true, baseline = { unit: PASSED, feature: PASSED } } = {}) {
  const f = installed({ config: CONFIG, files: FILES });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  writeToken(f.env, TOKEN);
  writeFileSync(join(f.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Test Author"\nauthor_email = "author@example.com"\n', { mode: 0o600 });
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  const io = { cwd: f.root, env: f.env };
  assert.equal((await tty(['approve', 'PMT-31', '--file', 'docs/mirai/tickets/PMT-31.md'], io, ['a', 'PMT-31'])).code, EXIT.OK);
  const p = await runPlan({ cwd: f.root, env: f.env, ticket: 'PMT-31', launchTokens: [mintLaunchToken(), mintLaunchToken()], launchOptions: watch(claudeWith([{ plan: PLAN }])) });
  assert.equal(p.outcome, 'waiting', JSON.stringify(p.problems));
  assert.equal((await tty(['approve', 'PMT-31', '--plan'], io, ['a', 'PMT-31'])).code, EXIT.OK);
  const store = openStore(io);
  writeBaseline(store, { schema_version: 1, sha: snapshot(io).baseSha, levels: baseline }, loadSigner(f.env, store));
  const claude = claudeWith([done, { verdict: 'pass', findings: [] }], ['printf "// renamed\\n" >> app/Team.php']);
  const b = await runBuild({ cwd: f.root, env: f.env, ticket: 'PMT-31', launchToken: mintLaunchToken(), launchOptions: watch(claude), testRun: passing });
  assert.equal(b.outcome, 'handed-over', b.why);
  if (reviewed) {
    const r = await runReview({ cwd: f.root, env: f.env, ticket: 'PMT-31', launchToken: mintLaunchToken(), launchOptions: watch(claude) });
    assert.equal(r.outcome, 'pass', r.why);
  }
  const check = (commit = 'HEAD', keys = branchKeys(store.checkout, store.branch, store.gitEnv)) => {
    const trust = snapshot(io);
    const config = trustedConfig(trust);
    return checkProofs({ root: store.checkout, env: store.gitEnv, ticket: 'PMT-31', commit, integration: trust.baseSha, codePaths: config.gate.code_paths, keys, repoId: store.repoId, rules: protectionRules(trustedRegistry(trust), config).rules, docsRoot: config.docs.root });
  };
  return { ...f, io, store, check, record: (o = {}) => recordProofs({ cwd: f.root, env: f.env, ticket: 'PMT-31', run: passing, ...o }) };
}

test('25a: gate record mints a review and a gate proof for HEAD, signed, in one commit of only them; gate check passes with the public keys', async () => {
  const f = await passed();
  const before = f.git('rev-parse', 'HEAD');
  const r = await f.record();
  assert.equal(r.outcome, 'recorded', r.why);
  assert.equal(r.written.length, 2);
  assert.match(r.written[0], /^\.mirai\/records\/PMT-31\/review-r1-[0-9a-f]{12}\.json$/);
  assert.match(r.written[1], /^\.mirai\/records\/PMT-31\/gate-r1-[0-9a-f]{12}\.json$/);
  assert.equal(f.git('rev-parse', 'HEAD^'), before);
  assert.deepEqual(f.git('diff', '--name-only', 'HEAD^', 'HEAD').split('\n').sort(), [...r.written].sort());
  assert.match(f.git('log', '-1', '--format=%s%n%b%n%cn'), /PMT-31: proofs[\s\S]*Mirai-Ticket: PMT-31[\s\S]*MIRAI/);
  const review = JSON.parse(readFileSync(join(f.root, r.written[0]), 'utf8'));
  assert.equal(review.kind, 'review');
  assert.equal(review.code_hash, r.hash);
  assert.equal(review.trace, 'n/a');
  assert.equal(review.findings, undefined, 'a proof holds no findings (Q9)');
  assert.ok(review.signature.key_id);
  const gate = JSON.parse(readFileSync(join(f.root, r.written[1]), 'utf8'));
  assert.deepEqual(gate.levels.map((l) => l.name), ['unit', 'feature']);
  assert.equal(gate.baseline.sha, r.base);
  assert.match(gate.baseline.digest, /^sha256:/);
  // The proofs' commit changes no code, so HEAD (and the commit before) both check.
  const c = f.check();
  assert.equal(c.outcome, 'pass', JSON.stringify(c.bad));
  assert.equal(c.matched.review.path, r.written[0]);
  assert.equal(f.check(before).outcome, 'no-proof', 'the commit before has no proof files yet');
  // Through the CLI too.
  const cli = await tty(['gate', 'check', 'PMT-31'], f.io);
  assert.equal(cli.code, EXIT.OK, cli.out + cli.err);
  assert.match(cli.out, /: pass/);
  // A second record is a new gate attempt; the review proof of this round is kept as it was.
  const again = await f.record();
  assert.equal(again.outcome, 'recorded', again.why);
  assert.deepEqual(again.written.map((p) => p.split('/').pop().split('-').slice(0, 2).join('-')), ['gate-r2']);
});

test('25a: no proof without Rex\'s pass for the same code: before the review, and after a code change', async () => {
  const f = await passed({ reviewed: false });
  await assert.rejects(f.record(), (e) => e.code === 'no-review');
  const g = await passed();
  writeFileSync(join(g.root, 'app/Team.php'), '<?php\n// one\n// two\n// renamed again\n');
  g.git('commit', '-qam', 'by hand');
  await assert.rejects(g.record(), (e) => e.code === 'review-stale');
});

test('25a: gate check fails after any code change once proofs exist (stale), and on anything else in the records folder', async () => {
  const f = await passed();
  assert.equal((await f.record()).outcome, 'recorded');
  writeFileSync(join(f.root, 'app/Team.php'), '<?php\n// one\n// two\n// renamed \n');
  f.git('commit', '-qam', 'whitespace');
  assert.equal(f.check().outcome, 'stale');
  f.git('reset', '-q', '--hard', 'HEAD^');
  // A stray file, a hand-edited proof, a proof by a key not on the integration branch.
  writeFileSync(join(f.root, '.mirai/records/PMT-31/notes.json'), '{}\n');
  f.git('add', '-A');
  f.git('commit', '-qm', 'stray');
  const stray = f.check();
  assert.equal(stray.outcome, 'bad-record');
  assert.match(stray.bad[0].path, /notes\.json$/);
  f.git('reset', '-q', '--hard', 'HEAD^');
  const name = f.git('ls-files', '.mirai/records/PMT-31').split('\n').find((p) => p.includes('/gate-'));
  const edited = JSON.parse(readFileSync(join(f.root, name), 'utf8'));
  edited.levels[0].verdict = 'pass ';
  writeFileSync(join(f.root, name), `${JSON.stringify(edited, null, 2)}\n`);
  f.git('commit', '-qam', 'edit');
  assert.equal(f.check().outcome, 'bad-record');
  f.git('reset', '-q', '--hard', 'HEAD^');
  const { privateKey } = generateKeyPairSync('ed25519');
  const forged = signProof({ ...edited, signature: undefined, levels: edited.levels }, { privateKey, keyId: 'k-0123456789abcdef' }, { repoId: f.store.repoId });
  writeFileSync(join(f.root, name), `${JSON.stringify(forged, null, 2)}\n`);
  f.git('commit', '-qam', 'forged');
  const v = f.check();
  assert.equal(v.outcome, 'bad-record');
  assert.match(v.bad[0].reason, /not on the integration branch/);
});

test('25a: gate record judges the gate against the merge-base\'s baseline: a new failing test fails it; a known one is listed; a missing level refuses', async () => {
  const f = await passed({ baseline: { unit: { state: 'fail', known_failures: [{ id: 'tests/a.php::old', scope: 'test', kind: 'error', state: 'failing', runs: 10, failed: 10 }], tests: { total: 3, skipped: 0 } }, feature: PASSED } });
  const failing = (ids) => async ({ name }) => (name === 'unit' ? { outcome: 'fail', id: 't-unit', exit_code: 1, failing: ids.map((id) => ({ id, kind: 'error', message: 'x' })), failing_total: ids.length, tests: { total: 3, passed: 3 - ids.length, failed: ids.length, errors: 0, skipped: 0 } } : passing({ name }));
  const bad = await f.record({ run: failing(['tests/a.php::old', 'tests/a.php::new']) });
  assert.equal(bad.outcome, 'gate-failed');
  assert.match(bad.why, /tests\/a\.php::new/);
  assert.equal(f.git('ls-files', '.mirai/records/PMT-31').split('\n').filter((p) => p.includes('/gate-')).length, 0, 'nothing written');
  const ok = await f.record({ run: failing(['tests/a.php::old']) });
  assert.equal(ok.outcome, 'recorded', ok.why);
  const gate = JSON.parse(readFileSync(join(f.root, ok.written.find((p) => p.includes('/gate-'))), 'utf8'));
  assert.deepEqual(gate.levels[0].known, [{ id: 'tests/a.php::old', scope: 'test', kind: 'error' }]);
  // The build itself refuses a baseline without a level, so it's taken away after the review.
  const g = await passed();
  writeBaseline(g.store, { schema_version: 1, sha: snapshot(g.io).baseSha, levels: { unit: PASSED } }, loadSigner(g.env, g.store));
  await assert.rejects(g.record(), (e) => e.code === 'no-baseline');
});

test('25a: gate record refuses a dirty tree and another branch; unattended it parks (sign-proofs); the CLI needs a terminal', async () => {
  const f = await passed();
  writeFileSync(join(f.root, 'scratch.txt'), 'x\n');
  await assert.rejects(f.record(), (e) => e.code === 'dirty');
  f.git('clean', '-qfd');
  const branch = f.git('branch', '--show-current');
  f.git('switch', '-q', 'main');
  await assert.rejects(f.record(), (e) => e.code === 'wrong-branch');
  f.git('switch', '-q', branch);
  const piped = await main(['gate', 'record', 'PMT-31'], { stdin: { isTTY: false }, stdout: { write: () => {} }, stderr: { write: () => {} }, env: f.env, cwd: f.root });
  assert.equal(piped, EXIT.NEEDS_HUMAN);
  const night = await f.record({ unattended: true });
  assert.equal(night.outcome, 'parked');
  const s = readTicketStatus(f.store, 'PMT-31').status;
  assert.equal(s.state, 'blocked');
  assert.equal(s.park_reason, 'sign-proofs');
});

test('25a: a gate.code_paths that leaves a protected path out of the hash is refused by record and check', async () => {
  const { codePathsHide } = await import('../../src/proofs/hash.js');
  const rules = [{ name: 'tool', paths: ['**/.claude/**', 'CLAUDE.md', 'package.json'] }, { name: 'mirai', paths: ['.mirai/**'] }];
  assert.deepEqual(codePathsHide(['**', '!docs/mirai/**', '!.mirai/**'], rules, 'docs/mirai'), []);
  assert.deepEqual(codePathsHide(['**', '!.claude/**'], rules, 'docs/mirai').map((h) => h.path), ['.claude/x']);
  assert.deepEqual(codePathsHide(['**', '!**/*.json'], rules, 'docs/mirai').map((h) => h.path), ['package.json', 'sub/package.json']);
  const f = await passed();
  writeFileSync(join(f.root, '.mirai/config.toml'), `${readFileSync(join(f.root, '.mirai/config.toml'), 'utf8')}\n[gate]\ncode_paths = ["**", "!.mirai/**", "!docs/mirai/**", "!.claude/**"]\n`);
  const branch = f.git('branch', '--show-current');
  f.git('stash', '-q');
  f.git('switch', '-q', 'main');
  f.git('stash', 'pop', '-q');
  f.git('commit', '-qam', 'hide .claude');
  f.git('switch', '-q', branch);
  await assert.rejects(f.record(), (e) => e.code === 'code-paths-hide');
  assert.throws(() => f.check(), (e) => e.code === 'code-paths-hide');
});
