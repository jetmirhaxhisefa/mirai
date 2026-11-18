#!/usr/bin/env node
// The build runner (unit 29e; design/10): a development tool for building MIRAI itself, never
// installed into a project (tools/ is outside package.json's files). Start it once in a real
// terminal, in MIRAI's repo, and leave it running:
//
//   caffeinate -i node tools/build-runner.js
//
// It runs the fixed jobs a building session asks for (requests in
// ~/Library/Application Support/mirai-build/requests/), one at a time, in your name, until you stop
// it with Ctrl-C. docs/build-runner.md says what it can and can't do.

import { createInterface } from 'node:readline';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { newRunnerId, removeRunnerRecord, writeRunnerRecord, RUNNER_COMMANDS } from '../src/cli/runner-proof.js';
import { openStore } from '../src/store/home.js';
import { Runner, checkMiraiRepo, ensureFolders, runnerPaths } from './build-runner/runner.js';

const repo = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
const env = { ...process.env };
const sample = env.MIRAI_BUILD_SAMPLE ?? join(env.HOME ?? homedir(), 'Projects', 'mirai-sample-app');
const out = (s) => process.stdout.write(`${s}\n`);
const fail = (s) => {
  process.stderr.write(`build runner: ${s}\n`);
  process.exit(1);
};

if (!(process.stdin.isTTY && process.stdout.isTTY)) fail('start it yourself, in a real terminal: it runs jobs in your name');
const wrong = checkMiraiRepo(process.cwd(), env) ?? checkMiraiRepo(repo, env);
if (wrong) fail(wrong);
if (realpathSync(process.cwd()) !== repo) fail(`start it from MIRAI's repo folder (${repo})`);
if (!existsSync(sample)) fail(`no sample app at ${sample} (set MIRAI_BUILD_SAMPLE)`);
let store;
try {
  store = openStore({ cwd: sample, env });
} catch (err) {
  fail(`the sample app's MIRAI store didn't open: ${err.message}`);
}

const paths = runnerPaths(env);
ensureFolders(paths);
out([
  'MIRAI build runner (unit 29e)',
  '',
  `It takes requests from ${paths.requests}`,
  `and writes results to ${paths.results}, one job at a time.`,
  'Jobs: tests, probes, baseline, redteam-cases, redteam-full, redteam-session, sample-run.',
  `A job runs a commit pushed on a branch of MIRAI's GitHub repo. Sample-app jobs refresh ${sample}'s main`,
  'with that commit\'s MIRAI, commit and push it, record its baseline, then run; red-team jobs use your Claude',
  'subscription. Results on the sample app are for building MIRAI only.',
  'Your gates (approvals, keys, merges) are never run by it. Ctrl-C stops it and ends its permission.',
  '',
].join('\n'));

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await new Promise((resolve) => rl.question('Run the fixed jobs in your name until you stop it? [y/N] ', resolve));
rl.close();
if (!/^y(es)?$/i.test(answer.trim())) {
  out('nothing was started');
  process.exit(0);
}

const runnerId = newRunnerId();
writeRunnerRecord(store, { id: runnerId, pid: process.pid, commands: [...RUNNER_COMMANDS] });
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  removeRunnerRecord(store, runnerId);
  out('\nbuild runner stopped; its permission ended');
  process.exit(0);
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, stop);
process.on('exit', () => removeRunnerRecord(store, runnerId));

const runner = new Runner({ env, repo, sample, runnerId, paths });
out(`started (${runnerId}); waiting for requests`);
for (;;) {
  const name = runner.next();
  if (name) {
    try {
      await runner.handle(name);
    } catch (err) {
      out(`a request failed outside its job: ${err.message}`);
    }
  } else {
    await new Promise((r) => setTimeout(r, 3000));
  }
}
