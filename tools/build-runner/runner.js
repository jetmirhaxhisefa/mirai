import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { realpathSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';

import { scrubbedEnv, sampleEnv } from './env.js';
import { JOBS, Refused, parseRequest, selectCases } from './requests.js';

// The build runner's work (unit 29e; design/10): one request at a time, from the request folder
// to the result folder. Everything outside this process is reached through `deps`, so the tests
// can stand in for git, Node and the clock.

const MINUTES = { tests: 30, probes: 30, baseline: 30, 'redteam-cases': 60, 'redteam-full': 120, 'redteam-session': 90, 'sample-run': 120 };
const LOG_MAX = 8 * 1024 * 1024;
const SUMMARY_LINES = 25;

export function runnerPaths(env) {
  // No space anywhere in the path: MIRAI's own tests run inside `work/`, and a space breaks
  // some of them (file URLs, split paths; seen 2026-11-18 under "Application Support").
  const base = join(env.HOME, '.mirai-build');
  return { base, requests: join(base, 'requests'), results: join(base, 'results'), work: join(base, 'work'), probeCache: join(base, 'probe-cache'), log: join(base, 'runner.log') };
}

export function ensureFolders(paths) {
  for (const d of [paths.base, paths.requests, paths.results, paths.work, paths.probeCache]) mkdirSync(d, { recursive: true, mode: 0o700 });
}

// git, synchronously: { status, stdout, stderr }.
export function git(cwd, args, env) {
  const r = spawnSync('git', args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? String(r.error ?? '') };
}

// The runner refuses to start anywhere but MIRAI's own repo (design/10 §3).
export function checkMiraiRepo(dir, env, { gitFn = git } = {}) {
  let name = null;
  try {
    name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name;
  } catch {
    name = null;
  }
  const origin = gitFn(dir, ['remote', 'get-url', 'origin'], env).stdout.trim();
  if (name !== 'mirai' || !/[:/]jetmirhaxhisefa\/mirai(\.git)?$/.test(origin)) {
    return `the build runner runs only in MIRAI's own repo (here: package ${JSON.stringify(name)}, origin ${JSON.stringify(origin || null)})`;
  }
  return null;
}

// The commit must be on a branch of origin, after a fetch: { branch, diff }.
export function checkCommit(repo, commit, env, { gitFn = git } = {}) {
  const f = gitFn(repo, ['fetch', '--quiet', '--prune', 'origin'], env);
  if (f.status !== 0) throw new Error(`git fetch failed: ${f.stderr.trim().slice(0, 300)}`);
  const c = gitFn(repo, ['branch', '-r', '--contains', commit, '--format=%(refname:short)'], env);
  const branches = c.status === 0 ? c.stdout.split('\n').map((s) => s.trim()).filter((b) => b && b !== 'origin/HEAD' && b !== 'origin') : [];
  if (!branches.length) throw new Refused(`the commit ${commit.slice(0, 12)} isn't on any branch of origin (push it first)`);
  const branch = (branches.find((b) => b !== 'origin/main') ?? branches[0]).replace(/^origin\//, '');
  const d = gitFn(repo, ['diff', '--shortstat', `origin/main...${commit}`], env);
  return { branch, diff: d.stdout.trim() || 'no change against main' };
}

// A clean checkout of exactly that commit, with its own .git (MIRAI's tests expect a git working
// copy), cloned from your local MIRAI repo: no network, no credentials.
export function exportCommit(repo, commit, dir, env) {
  mkdirSync(dirname(dir), { recursive: true });
  const clone = spawnSync('git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', repo, dir], { env, encoding: 'utf8', timeout: 300_000 });
  if (clone.status !== 0) throw new Error(`git clone failed: ${String(clone.stderr).slice(0, 300)}`);
  const co = spawnSync('git', ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', commit], { cwd: dir, env, encoding: 'utf8', timeout: 300_000 });
  if (co.status !== 0) throw new Error(`git checkout failed: ${String(co.stderr).slice(0, 300)}`);
}

// The sample app's checkout must be on main, clean, and level with origin/main. Never reset.
export function sampleReady(sample, env, { gitFn = git } = {}) {
  const branch = gitFn(sample, ['branch', '--show-current'], env).stdout.trim();
  if (branch !== 'main') return `the sample app's checkout is on ${JSON.stringify(branch)}, not main`;
  const dirty = gitFn(sample, ['status', '--porcelain'], env).stdout.trim();
  if (dirty) return `the sample app's checkout has uncommitted changes (${dirty.split('\n').length} paths)`;
  gitFn(sample, ['fetch', '--quiet', 'origin', 'main'], env);
  const ahead = gitFn(sample, ['rev-list', '--count', 'origin/main..main'], env).stdout.trim();
  if (ahead !== '0') return `the sample app's main has ${ahead} commit(s) origin doesn't`;
  const behind = gitFn(sample, ['rev-list', '--count', 'main..origin/main'], env).stdout.trim();
  if (behind !== '0') return `the sample app's main is ${behind} commit(s) behind origin (pull it)`;
  return null;
}

export const TRAILER = 'MIRAI-Build-Commit';
export const carries = (sample, commit, env, { gitFn = git } = {}) => gitFn(sample, ['log', '-1', '--format=%B'], env).stdout.includes(`${TRAILER}: ${commit}`);

// Runs a command, streaming into the job's log: { status, signal, tail }.
export function runLogged(cmd, args, { cwd, env, log, input = null, minutes }) {
  return new Promise((resolve) => {
    const out = createWriteStream(log, { flags: 'a' });
    let written = 0;
    let tail = '';
    const take = (chunk) => {
      const text = chunk.toString('utf8');
      tail = `${tail}${text}`.slice(-16_000);
      if (written < LOG_MAX) {
        out.write(text.slice(0, LOG_MAX - written));
        written += text.length;
      }
    };
    out.write(`$ ${[cmd, ...args].join(' ')}\n`);
    const child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (err) => take(Buffer.from(`\n(the command didn't start: ${err.message})\n`)));
    if (input !== null) child.stdin.write(input);
    child.stdin.end();
    const timer = setTimeout(() => {
      take(Buffer.from(`\n(stopped after ${minutes} minutes)\n`));
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // gone
      }
    }, minutes * 60_000);
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      out.end(`\n(exit ${status ?? signal})\n`);
      resolve({ status: status ?? 1, signal, tail });
    });
  });
}

// The `tests` job's sandbox (spec decision 5, P1): your real home is closed to it, apart from the
// job's own folder and the Node it runs on; the rest of the system stays as it is. A changed HOME
// alone wouldn't stop a test reading your files by their full path. (Checked 2026-11-18: macOS
// refuses /bin/ps, a setuid program, inside any sandbox, even "(allow default)".)
const sbString = (p) => `"${String(p).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
export function sandboxProfile({ home, open, readOnly = [] }) {
  return [
    '(version 1)',
    '(allow default)',
    `(deny file-read* file-write* (subpath ${sbString(home)}))`,
    ...open.map((p) => `(allow file-read* file-write* (subpath ${sbString(p)}))`),
    ...readOnly.map((p) => `(allow file-read* (subpath ${sbString(p)}))`),
    '(allow file-read-metadata)',
    // macOS never runs a setuid program inside a sandbox, and MIRAI reads process start times
    // with /bin/ps: only it starts outside the sandbox. It lists processes; it reads no files.
    '(allow process-exec (literal "/bin/ps") (with no-sandbox))',
  ].join('');
}

export function sandboxed(command, jobDir, alsoOpen = []) {
  const home = realpathSync(userInfo().homedir);
  const nodeDir = dirname(dirname(realpathSync(process.execPath)));
  const profile = sandboxProfile({ home, open: [realpathSync(jobDir), ...alsoOpen], readOnly: [nodeDir] });
  return { ...command, cmd: '/usr/bin/sandbox-exec', args: ['-p', profile, command.cmd, ...command.args] };
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// The tool versions a probe's result is stored under (design/10 §2.4).
export function toolVersions(env) {
  const v = (cmd, args) => {
    const r = spawnSync(cmd, args, { env, encoding: 'utf8', timeout: 30_000 });
    return r.status === 0 ? String(r.stdout).trim().split('\n')[0] : `unavailable (${cmd})`;
  };
  return { claude: v('claude', ['--version']), docker: v('docker', ['version', '--format', '{{.Server.Version}}']), git: v('git', ['--version']), node: process.version };
}

export const probeKey = (fileText, versions) => sha256(`mirai-probe-cache/1\n${sha256(fileText)}\n${JSON.stringify(versions)}`).slice(0, 32);

// What a request that didn't parse asked for, where it's safe to show: an id and a commit in their
// own shapes only.
function rawFields(text) {
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    return {};
  }
  const pick = (v, re) => (typeof v === 'string' && re.test(v) ? v : undefined);
  return { id: pick(r?.id, /^[a-z0-9][a-z0-9.-]{0,63}$/), commit: pick(r?.commit, /^[0-9a-f]{40}$/) };
}

function summaryOf(tail) {
  return tail.split(/\r?\n/).filter((l) => l.trim()).slice(-SUMMARY_LINES).join('\n');
}

// The commands each job runs. `ctx`: { exportDir, sample, cases, runnerId, scriptPath }.
export function jobCommand(job, arg, ctx) {
  const node = process.execPath;
  const launch = join(ctx.exportDir, 'bin', 'launch.js');
  switch (job) {
    case 'tests': return { cmd: node, args: ['--test', 'test/**/*.test.js'], cwd: ctx.exportDir };
    case 'probes': return { cmd: node, args: [join('test', 'probes', arg)], cwd: ctx.exportDir };
    case 'baseline': return { cmd: node, args: [launch, 'baseline'], cwd: ctx.sample };
    case 'redteam-cases': return { cmd: node, args: [launch, 'redteam', 'run', '--only', selectCases(arg, ctx.cases).join(',')], cwd: ctx.sample, input: 'y\n' };
    case 'redteam-full': return { cmd: node, args: [launch, 'redteam', 'run'], cwd: ctx.sample, input: 'y\n' };
    case 'redteam-session': return { cmd: node, args: [launch, 'redteam', 'run', '--sessions'], cwd: ctx.sample, input: 'y\n' };
    case 'sample-run': return { cmd: node, args: [ctx.scriptPath], cwd: ctx.sample };
    default: throw new Refused(`unknown job ${job}`);
  }
}

export class Runner {
  constructor({ env, repo, sample, runnerId, paths = runnerPaths(env), say = (l) => process.stdout.write(`${l}\n`), now = () => new Date(), deps = {} }) {
    Object.assign(this, { env, repo, sample, runnerId, paths, say, now });
    this.gitFn = deps.git ?? git;
    this.run = deps.runLogged ?? runLogged;
    this.export = deps.exportCommit ?? exportCommit;
    this.versions = deps.toolVersions ?? toolVersions;
    this.sandbox = deps.sandboxed ?? null;
  }

  logLine(fields) {
    const line = `${this.now().toISOString()} ${fields.join(' | ')}`;
    appendFileSync(this.paths.log, `${line}\n`);
    this.say(line);
  }

  writeResult(id, result) {
    writeFileSync(join(this.paths.results, `${id}.json`), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  }

  // The oldest request file, or null.
  next() {
    const names = readdirSync(this.paths.requests).filter((n) => n.endsWith('.json'));
    if (!names.length) return null;
    const dated = names.map((n) => ({ n, t: statSync(join(this.paths.requests, n), { throwIfNoEntry: false })?.mtimeMs ?? 0 })).sort((a, b) => a.t - b.t || a.n.localeCompare(b.n));
    return dated[0].n;
  }

  // Takes one request file and runs it to its result. Returns the result.
  async handle(name) {
    const from = join(this.paths.requests, name);
    const taken = join(this.paths.work, `${name}.taken`);
    try {
      renameSync(from, taken);
    } catch {
      return null;
    }
    const text = readFileSync(taken, 'utf8').slice(0, 64 * 1024);
    rmSync(taken, { force: true });
    const fallbackId = name.replace(/\.json$/, '').replace(/[^a-z0-9.-]/g, '-').slice(0, 64) || 'request';
    const started = this.now();
    let req = null;
    let result;
    try {
      req = parseRequest(text);
      result = await this.execute(req, started);
    } catch (err) {
      const refused = err.refused === true;
      // A refused request is still logged by what it asked for, shown safely.
      const raw = req ?? rawFields(text);
      result = { id: raw.id ?? fallbackId, job: req?.job ?? null, arg: raw.arg ?? null, commit: raw.commit ?? null, branch: null, state: refused ? 'refused' : 'error', started: started.toISOString(), minutes: 0, summary: String(err.message).slice(0, 2000), log: null };
    }
    this.writeResult(result.id, result);
    this.logLine([result.id, result.job ?? '-', result.commit ? result.commit.slice(0, 12) : '-', result.branch ?? '-', result.diff ?? '-', `${result.state}${result.state === 'refused' || result.state === 'error' ? `: ${result.summary.split('\n')[0].slice(0, 160)}` : ''}`]);
    return result;
  }

  async execute(req, started) {
    const { branch, diff } = checkCommit(this.repo, req.commit, this.env, { gitFn: this.gitFn });
    const jobDir = join(this.paths.work, req.id);
    rmSync(jobDir, { recursive: true, force: true });
    const exportDir = join(jobDir, 'mirai');
    this.export(this.repo, req.commit, exportDir, this.env);
    const log = join(this.paths.results, `${req.id}.log`);
    rmSync(log, { force: true });
    const base = { id: req.id, job: req.job, arg: req.arg, commit: req.commit, branch, diff, started: started.toISOString(), log };
    this.writeResult(req.id, { ...base, state: 'running' });
    this.logLine([req.id, req.job, req.commit.slice(0, 12), branch, diff, 'started']);
    const ctx = { exportDir, sample: this.sample, runnerId: this.runnerId };
    let env;
    if (JOBS[req.job].where === 'export') {
      if (req.job === 'probes') {
        const file = join(exportDir, 'test', 'probes', req.arg);
        if (!existsSync(file)) throw new Refused(`no probe file test/probes/${req.arg} in that commit`);
        const key = probeKey(readFileSync(file, 'utf8'), this.versions(sampleEnv(this.env)));
        const cached = join(this.paths.probeCache, `${key}.json`);
        if (existsSync(cached)) {
          const stored = JSON.parse(readFileSync(cached, 'utf8'));
          return { ...base, state: stored.state, reused: stored.started, minutes: 0, summary: stored.summary };
        }
        env = sampleEnv(this.env);
        const r = await this.finish(req, base, log, jobCommand('probes', req.arg, ctx), env, started);
        if (r.state === 'pass' || r.state === 'fail') writeFileSync(cached, `${JSON.stringify({ state: r.state, started: r.started, summary: r.summary })}\n`, { mode: 0o600 });
        return r;
      }
      const home = join(jobDir, 'home');
      mkdirSync(home, { recursive: true, mode: 0o700 });
      // The temp folder in macOS's usual place, not under ~/.mirai-build: some tests make Unix
      // sockets under it (104 characters at most) or expect /private/var/folders.
      const tmp = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'mirai-build-')));
      env = scrubbedEnv(this.env, { home, tmp });
      try {
        return await this.finish(req, base, log, (this.sandbox ?? sandboxed)(jobCommand(req.job, req.arg, ctx), jobDir, [tmp]), env, started);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
    // Sample-app jobs: the checkout must be ready, then the refresh step, then the job.
    const notReady = sampleReady(this.sample, this.env, { gitFn: this.gitFn });
    if (notReady) throw new Refused(`${notReady}; the runner never resets it`);
    env = sampleEnv(this.env, { MIRAI_BUILD_RUNNER: this.runnerId });
    const refreshed = await this.refresh(req, branch, exportDir, log, env);
    if (refreshed) return { ...base, state: 'error', minutes: this.minutesSince(started), summary: refreshed };
    if (req.job === 'redteam-cases') ctx.cases = this.caseList(exportDir);
    if (req.job === 'sample-run') ctx.scriptPath = this.mainScript(req.arg, jobDir);
    return this.finish(req, base, log, jobCommand(req.job, req.arg, ctx), env, started);
  }

  minutesSince(started) {
    return Math.round((this.now() - started) / 6000) / 10;
  }

  async finish(req, base, log, command, env, started) {
    const r = await this.run(command.cmd, command.args, { cwd: command.cwd, env, log, input: command.input ?? null, minutes: MINUTES[req.job] });
    return { ...base, state: r.status === 0 ? 'pass' : 'fail', minutes: this.minutesSince(started), summary: summaryOf(r.tail) };
  }

  // The red team's case list, from the requested commit's own code, in a scrubbed child.
  caseList(exportDir) {
    const tmp = join(exportDir, '..', 'tmp-cases');
    mkdirSync(tmp, { recursive: true });
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', "const m = await import('./src/redteam/cases.js'); process.stdout.write(JSON.stringify(m.caseIndex().map(({ id, fact }) => ({ id, fact }))));"], { cwd: exportDir, env: scrubbedEnv(this.env, { home: tmp, tmp }), encoding: 'utf8', timeout: 60_000 });
    if (r.status !== 0) throw new Error(`the red team's case list didn't load: ${String(r.stderr).slice(0, 300)}`);
    return JSON.parse(r.stdout);
  }

  // sample-run's script, as it is on MIRAI's main (design/10 §2.2): one you approved.
  mainScript(name, jobDir) {
    const r = this.gitFn(this.repo, ['show', `origin/main:tools/runs/${name}`], this.env);
    if (r.status !== 0) throw new Refused(`tools/runs/${name} isn't on MIRAI's main (a unit's run script is added in its spec PR)`);
    const path = join(jobDir, `run-${name}`);
    writeFileSync(path, r.stdout, { mode: 0o600 });
    return path;
  }

  // The refresh step (spec In 4): the requested commit's MIRAI on the sample app's main, committed,
  // pushed by the runner itself, and its baseline. Returns null, or why it failed.
  async refresh(req, branch, exportDir, log, jobEnv) {
    if (carries(this.sample, req.commit, this.env, { gitFn: this.gitFn })) return null;
    const node = process.execPath;
    const init = await this.run(node, [join(exportDir, 'bin', 'mirai.js'), 'init', '--refresh'], { cwd: this.sample, env: jobEnv, log, minutes: 10 });
    if (init.status !== 0) return `the refresh failed: ${summaryOf(init.tail)}`;
    const add = this.gitFn(this.sample, ['add', '-A'], this.env);
    if (add.status !== 0) return `git add failed: ${add.stderr.slice(0, 300)}`;
    const message = `MIRAI refresh: ${branch} at ${req.commit.slice(0, 12)} (build runner)\n\n${TRAILER}: ${req.commit}\n`;
    const commit = this.gitFn(this.sample, ['commit', '--quiet', '--allow-empty', '-m', message], this.env);
    if (commit.status !== 0) return `git commit failed: ${commit.stderr.slice(0, 300)}`;
    const push = this.gitFn(this.sample, ['push', '--quiet', 'origin', 'main'], this.env);
    if (push.status !== 0) return `git push failed: ${push.stderr.slice(0, 300)}`;
    const base = await this.run(node, [join(exportDir, 'bin', 'launch.js'), 'baseline'], { cwd: this.sample, env: jobEnv, log, minutes: MINUTES.baseline });
    if (base.status !== 0 && req.job !== 'baseline') return `the baseline after the refresh failed: ${summaryOf(base.tail)}`;
    return null;
  }
}
