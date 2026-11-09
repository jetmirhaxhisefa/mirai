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
import { loadSigner } from '../../src/sign/signer.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { protectionRules } from '../../src/trust/protected.js';
import { snapshot, trustedConfig, trustedRegistry } from '../../src/trust/snapshot.js';
import { installed, tempDir } from '../tests/run-fixture.js';

// A ticket Kai built and Rex passed, with a stand-in claude and test run (no model, no Docker):
// unit 25a's fixture, shared with unit 26a's push tests.

export const TOKEN = `sk-ant-oat01-${'Ag3_-k'.repeat(16)}`;
const INIT = '{"type":"system","subtype":"init","permissionMode":"dontAsk"}';
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const PLAN = readFileSync(join(REGISTRY_DIR, 'examples', 'plan.md'), 'utf8');
const CONFIG = '\n[[testing.levels]]\nname = "unit"\ncommand = ["run-tests"]\nservice = "app"\n\n[[testing.levels]]\nname = "feature"\ncommand = ["run-tests"]\nservice = "app"\n\n[compose]\nfiles = ["compose.yml"]\nenv_file = ".env.test"\n';
const doc = (fm, body) => `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${body}`;
const ticketDoc = doc({ id: 'PMT-31', type: 'story', template: 'story@v1', repo: '"."', risk: 'normal', size: 'M', verify: '"Rename a team on staging."', tdd: 'first' },
  '# Renaming a team hides its members\n\n## Acceptance criteria\n\n- AC-PMT-31.1: the members stay after a rename\n- AC-PMT-31.2: the old slug redirects\n');
const FILES = { 'docs/mirai/tickets/PMT-31.md': ticketDoc, 'package.json': '{\n  "name": "app",\n  "dependencies": { "express": "^4" }\n}\n', 'app/Team.php': '<?php\n// one\n// two\n' };
export const PASSED = { state: 'pass', known_failures: [], tests: { total: 3, skipped: 0 } };
export const passing = async ({ name }) => ({ outcome: 'pass', id: `t-${name}`, tests: { total: 3, passed: 3, failed: 0, errors: 0, skipped: 0 } });

export async function tty(argv, { cwd, env }, answers = []) {
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd, ...(argv[0] === 'gate' ? { testRun: passing } : {}) });
  return { code, out, err };
}

export function claudeWith(results, before = []) {
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
export const watch = (claude) => ({ claude: claude.path, status: green, check: () => [] });
export const done = { status: 'done', summary: 'Changed app/Team.php.', tests_run: ['unit: pass'], checks_run: [] };

// PMT-31 built by Kai and, unless `reviewed: false`, passed by Rex: in-review, on its branch.
export async function passed({ reviewed = true, baseline = { unit: PASSED, feature: PASSED } } = {}) {
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

