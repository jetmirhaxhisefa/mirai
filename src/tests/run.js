import { randomBytes } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { EXIT } from '../cli/exit-codes.js';
import { catBlobs, lsTree } from '../store/git.js';
import { acquireLock, ensurePrivateDir } from '../store/files.js';
import { openStore } from '../store/home.js';
import { readToken } from '../sign/token.js';
import { snapshot, trustedConfig, trustedFile, trustedRegistry } from '../trust/snapshot.js';
import { checkAllowlist, nestedBinds, prescan, tighten } from './compose.js';
import { copyTree, removeCopy } from './copy.js';
import { checkDockerRunning, dockerCall, dockerSetup, TestRunError } from './docker.js';

// One test level or named check, run in the project's own containers (unit 14c; D-48, D-49):
// a copy of the project, compose files from the trust root, resolved once, tightened, checked
// against the allowlist, frozen, run as frozen on internal networks, with a hard timeout, and
// every container, network and volume removed afterwards. One run at a time per repo.
//
// Each run's folder is `<store>/tests/<id>/` (not runs/, which holds the run logs): tree/ (the
// copy) and binds/ (nested binds' own copies), both removed after; out/ (the output folder);
// compose.frozen.json; result.json, written for every run that got this far, whatever happened.
// The last KEEP_TEST_RUNS folders are kept.

export const OUTPUT_TAIL_BYTES = 64 * 1024;
export const DEFAULT_TIMEOUT_MINUTES = 15;
export const DEFAULT_OUTPUT = '/mirai/out';
export const KEEP_TEST_RUNS = 20;
export const OUT_LIMITS = Object.freeze({ files: 1000, bytes: 256 * 1024 ** 2, depth: 16 });

export const testRunId = (now = new Date()) => `t-${now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15).toLowerCase()}-${randomBytes(3).toString('hex')}`;

// The level or check named `name` in the trust root's config: { kind, name, service, command,
// workdir, timeoutMinutes, run }.
export function findTarget(config, name) {
  const level = (config.testing?.levels ?? []).find((l) => l.name === name);
  const check = config.checks?.[name];
  if (!level && check === undefined) {
    const known = [...(config.testing?.levels ?? []).map((l) => l.name), ...Object.keys(config.checks ?? {})];
    throw new TestRunError(`${name} isn't a test level or check of this project`, { code: 'unknown-test', exitCode: EXIT.USAGE, hint: known.length ? `configured: ${known.join(', ')}` : 'configure [testing] levels or [checks] in .mirai/config.toml' });
  }
  const t = level ?? (Array.isArray(check) ? { command: check } : check);
  if (!t.service) throw new TestRunError(`${name} has no service`, { code: 'no-service', hint: 'name the compose service it runs in (service = "app"); tests always run in the project\'s containers' });
  return { kind: level ? 'level' : 'check', name, service: t.service, command: t.command, workdir: t.workdir ?? null, timeoutMinutes: t.timeout_minutes ?? DEFAULT_TIMEOUT_MINUTES, run: t.run ?? 'exec' };
}

// Redacts the login token's exact value and every secret shape the trust root knows; terminal
// colour and cursor codes are removed first (noise to whoever reads it, and they can hide text).
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b[\]P^_][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
export function redact(text, { token, secrets = [] }) {
  const plain = text.replace(ESCAPES, '');
  let out = token ? plain.split(token).join('<redacted:login-token>') : plain;
  for (const s of secrets) out = out.replace(new RegExp(s.regex, 'g'), `<redacted:${s.name}>`);
  return out;
}

const tail = (text, max) => (Buffer.byteLength(text) <= max ? { text, truncated: false } : { text: Buffer.from(text).subarray(-max).toString('utf8'), truncated: true });

// The output folder's regular files, without following links, within OUT_LIMITS:
// { files: [{ path, size }], overCap }.
export function listOut(dir, limits = OUT_LIMITS) {
  const files = [];
  let bytes = 0;
  let overCap = false;
  const walk = (abs, rel, depth) => {
    if (depth > limits.depth) {
      overCap = true;
      return;
    }
    for (const name of readdirSync(abs).sort()) {
      if (files.length >= limits.files) {
        overCap = true;
        return;
      }
      const p = join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const info = lstatSync(p);
      if (info.isDirectory()) walk(p, r, depth + 1);
      else if (info.isFile()) {
        bytes += info.size;
        if (bytes > limits.bytes) {
          overCap = true;
          return;
        }
        files.push({ path: r, size: info.size });
      }
    }
  };
  walk(dir, '', 1);
  return { files, overCap };
}

// A nested bind's own copy (nestedBinds): the folder or file as the copy has it, links copied as
// links (the copy only holds links that point further down).
function copyPlain(from, to) {
  const info = lstatSync(from);
  if (info.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
  else if (info.isDirectory()) {
    mkdirSync(to, { mode: 0o700 });
    for (const name of readdirSync(from)) copyPlain(join(from, name), join(to, name));
  } else if (info.isFile()) copyFileSync(from, to);
}

const hostPath = (source) => (typeof source === 'string' && source.startsWith('/host_mnt/') ? source.slice('/host_mnt'.length) : source);
const ids = (r) => r.stdout.split(/\s+/).filter(Boolean);

// The project's containers and networks, checked after they start: each container's binds are
// exactly its service's binds in the frozen file (Docker Desktop may report /host_mnt + the Mac
// path), volumes are the project's, its host settings are the defaults, and every network is
// the project's and internal.
function inspectRun(setup, call, project, frozen, containerIds = null) {
  const list = containerIds ?? ids(call(setup, ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]));
  if (list.length === 0) return;
  const parse = (r, what) => {
    try {
      return JSON.parse(r.stdout);
    } catch {
      throw new TestRunError(`docker ${what} gave no readable answer`, { code: 'inspect' });
    }
  };
  const bad = (name, what) => {
    throw new TestRunError(`container ${name}: ${what}, which the frozen file doesn't have`, { code: 'inspect-mismatch', hint: 'stop: something changed the containers between the check and the run' });
  };
  for (const c of parse(call(setup, ['inspect', ...list]), 'inspect')) {
    const service = c.Config?.Labels?.['com.docker.compose.service'];
    if (!service || !frozen.services?.[service]) bad(c.Name, 'a service the frozen file doesn\'t name');
    const want = (frozen.services[service].volumes ?? []).filter((v) => v.type === 'bind').map((v) => v.source).sort();
    const h = c.HostConfig ?? {};
    if (h.Privileged) bad(c.Name, 'privileged mode');
    if ((h.CapAdd ?? []).length) bad(c.Name, 'added capabilities');
    if ((h.Devices ?? []).length) bad(c.Name, 'devices');
    for (const [k, mode] of [['PidMode', h.PidMode], ['IpcMode', h.IpcMode], ['UsernsMode', h.UsernsMode], ['UTSMode', h.UTSMode]]) {
      if (mode && !['', 'private', 'shareable'].includes(mode)) bad(c.Name, `${k} ${mode}`);
    }
    if ((h.SecurityOpt ?? []).length) bad(c.Name, 'security options');
    if (Object.keys(h.Sysctls ?? {}).length) bad(c.Name, 'sysctls');
    for (const net of Object.keys(c.NetworkSettings?.Networks ?? {})) if (!net.startsWith(`${project}_`)) bad(c.Name, `the network ${net}`);
    const got = (c.Mounts ?? []).filter((m) => m.Type === 'bind').map((m) => hostPath(m.Source)).sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) bad(c.Name, `the mounts ${got.join(', ') || '(none)'}`);
    for (const m of c.Mounts ?? []) {
      if (m.Type === 'volume' && !(m.Name?.startsWith(`${project}_`) || /^[0-9a-f]{64}$/.test(m.Name ?? ''))) bad(c.Name, `the volume ${m.Name}`);
      if (!['bind', 'volume', 'tmpfs'].includes(m.Type)) bad(c.Name, `a ${m.Type} mount`);
    }
  }
  const nets = ids(call(setup, ['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]));
  if (nets.length) {
    for (const n of parse(call(setup, ['network', 'inspect', ...nets]), 'network inspect')) {
      if (n.Internal !== true) bad(n.Name, 'a network with outside access');
    }
  }
}

// Force-removes the project's containers, then `down -v` (when the frozen file exists), then
// any network or volume of the project left (14a's P5: containers outlive a killed client, and a
// one-off keeps its network). Returns what's still there afterwards.
function cleanup(setup, call, compose, project) {
  const label = `label=com.docker.compose.project=${project}`;
  const containers = () => ids(call(setup, ['ps', '-aq', '--filter', label]));
  const running = containers();
  if (running.length) call(setup, ['rm', '-f', '-v', ...running]);
  if (compose) call(setup, [...compose, 'down', '-v', '--remove-orphans', '--timeout', '5']);
  for (const kind of ['network', 'volume']) {
    const found = ids(call(setup, [kind, 'ls', '-q', '--filter', label]));
    if (found.length) call(setup, [kind, 'rm', ...(kind === 'volume' ? ['-f'] : []), ...found]);
  }
  return [...containers(), ...['network', 'volume'].flatMap((kind) => ids(call(setup, [kind, 'ls', '-q', '--filter', label])))];
}

// Containers of this repo left by a run that didn't finish (a crash, a kill): removed with their
// projects before the next run, which holds the repo's test lock, so none of them is live.
function sweepStale(setup, call, repoId) {
  const r = call(setup, ['ps', '-a', '--filter', `label=mirai.repo=${repoId}`, '--format', '{{.Label "com.docker.compose.project"}}']);
  for (const project of new Set(ids(r))) if (/^mirai-[a-z0-9]+-t-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/.test(project)) cleanup(setup, call, null, project);
}

function pruneRuns(testsDir, keep) {
  const runs = readdirSync(testsDir).filter((n) => /^t-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/.test(n)).sort();
  for (const old of runs.slice(0, Math.max(0, runs.length - keep))) rmSync(join(testsDir, old), { recursive: true, force: true });
}

// Codes that mean a check refused the run; anything else that stops a run is an environment
// fault, never a failing test.
const REFUSED = new Set(['compose-refused', 'compose-prescan', 'copy-link', 'copy-hardlink', 'copy-type', 'copy-too-large', 'repo-nested', 'repo-config', 'repo-shape', 'repo-lfs', 'no-image', 'no-service', 'inspect-mismatch']);

// Runs one level or check. For tests and probes: `docker` ({ client, plugins, socket }) instead
// of Docker Desktop's, and `minuteMs` to shorten the timeout.
export function runTest({ cwd, env, name, path = null, now = () => new Date(), docker = {}, call = dockerCall, minuteMs = 60_000 }) {
  const store = openStore({ cwd, env });
  const trust = snapshot({ cwd, env });
  const config = trustedConfig(trust);
  const target = findTarget(config, name);
  const files = config.compose?.files ?? [];
  if (files.length === 0) throw new TestRunError('this project has no [compose] files', { code: 'no-compose', hint: 'name its compose file in .mirai/config.toml: [compose] files = ["docker-compose.yml"]' });
  if (!config.compose?.env_file) throw new TestRunError('this project has no [compose] env_file', { code: 'no-env-file', hint: 'commit a file of dummy values (such as .env.test) and name it: [compose] env_file = ".env.test"' });
  // The base commit's files, hashed against the manifest: what Compose reads is the integration branch's.
  const treeFile = (p, what) => {
    try {
      trustedFile(trust, p);
    } catch {
      throw new TestRunError(`${what} ${p} isn't on the integration branch as a file`, { code: 'no-compose', hint: 'commit it there (not as a link); test runs read compose files and the env file from the integration branch only' });
    }
    return join(trust.dir, 'tree', p);
  };
  const composeFiles = files.map((f) => {
    const file = treeFile(f, 'the compose file');
    prescan(trustedFile(trust, f).toString('utf8'), f);
    return file;
  });
  const envFile = treeFile(config.compose.env_file, 'the env file');

  const setup = dockerSetup(env, docker);
  const dockerVersion = checkDockerRunning(setup, call);
  const testsDir = join(store.dir, 'tests');
  ensurePrivateDir(testsDir);
  let lock;
  try {
    lock = acquireLock(join(store.dir, 'locks', 'tests.lock'), 'test run', { waitMs: 2000 });
  } catch {
    throw new TestRunError('another test run of this project is running', { code: 'test-busy', exitCode: EXIT.NEEDS_HUMAN, hint: 'wait for it to finish; test runs of one project run one at a time' });
  }
  try {
    sweepStale(setup, call, store.repoId);
    pruneRuns(testsDir, KEEP_TEST_RUNS - 1);
    return runLocked({ store, trust, config, target, name, path, now, setup, call, minuteMs, composeFiles, envFile, dockerVersion, testsDir, env });
  } finally {
    lock.release();
  }
}

function runLocked({ store, trust, config, target, name, path, now, setup, call, minuteMs, composeFiles, envFile, dockerVersion, testsDir, env }) {
  const id = testRunId(now());
  const dir = join(testsDir, id);
  ensurePrivateDir(dir);
  const outDir = join(dir, 'out');
  ensurePrivateDir(outDir);
  const copyDir = join(dir, 'tree');
  const bindsDir = join(dir, 'binds');
  const project = `mirai-${store.repoId.slice(0, 12).toLowerCase().replace(/[^a-z0-9]/g, '')}-${id}`;
  const started = Date.now();
  const secrets = Object.values(trustedRegistry(trust).secrets ?? {}).flatMap((d) => d.patterns);
  const clean = (text) => redact(text, { token: readToken(env), secrets });
  const result = {
    schema_version: 1, id, name, kind: target.kind, service: target.service, command: target.command, path, project, docker: dockerVersion,
    started_at: now().toISOString(), base_sha: trust.baseSha,
  };
  // The committed dummy env files the copy keeps, from the base commit's blobs (never the work
  // tree): the compose env file and readable_env.
  const keepPaths = [config.compose.env_file, ...(config.sandbox?.readable_env ?? [])];
  const keepEntries = keepPaths.flatMap((p) => (lsTree(store.checkout, trust.baseSha, p, env) ?? []).filter((e) => e.path === p && e.type === 'blob' && e.mode !== '120000'));
  const blobs = catBlobs(store.checkout, keepEntries.map((e) => e.sha), env, { maxBytes: 1024 * 1024 });
  const keep = new Map(keepEntries.filter((e) => blobs.get(e.sha)).map((e) => [e.path, blobs.get(e.sha)]));
  // The copy's real path once it exists, so every bind Compose resolves is a plain real path.
  let projectDir = copyDir;
  const compose = (frozen) => ['compose', '--progress', 'quiet', ...(frozen ? ['-f', frozen] : composeFiles.flatMap((f) => ['-f', f])), '-p', project, '--project-directory', projectDir, '--env-file', envFile];
  let base = null;
  let error = null;
  try {
    const copied = copyTree({ root: store.checkout, env, dest: copyDir, keep });
    const copyReal = realpathSync(copyDir);
    projectDir = copyReal;
    const outReal = realpathSync(outDir);
    result.tree = { files: copied.files, bytes: copied.bytes, hash: copied.treeHash, env_left_out: copied.left.length };

    const r = call(setup, [...compose(null), '--profile', '*', 'config', '--format', 'json'], { timeout: 60_000 });
    if (r.status !== 0) throw new TestRunError(`docker compose config failed: ${r.stderr.trim().split('\n').pop() ?? ''}`, { code: 'compose-config' });
    let resolved;
    try {
      resolved = JSON.parse(r.stdout);
    } catch {
      throw new TestRunError('docker compose config gave no readable JSON', { code: 'compose-config' });
    }
    const tightened = tighten(resolved, {
      project, labels: { 'mirai.test-run': id, 'mirai.repo': store.repoId }, output: { service: target.service, source: outReal, target: config.compose.output ?? DEFAULT_OUTPUT },
    });
    if (!tightened.services?.[target.service]) throw new TestRunError(`${name} runs in ${target.service}, which the compose files don't have`, { code: 'no-service' });
    const images = {};
    for (const s of Object.values(tightened.services)) {
      if (typeof s.image !== 'string' || s.image in images) continue;
      const i = call(setup, ['image', 'inspect', '--format', '{{.Id}}', s.image]);
      images[s.image] = i.status === 0 ? i.stdout.trim() : null;
    }
    const check = (isolated) => checkAllowlist(tightened, { project, copy: copyReal, out: outReal, imageOk: (ref) => Boolean(images[ref]), allow: config.compose.allow ?? [], isolated });
    check([]);
    // Binds another service could swap before this one starts get their own copy.
    const nested = nestedBinds(tightened);
    if (nested.length) mkdirSync(bindsDir, { mode: 0o700 });
    nested.forEach((b, i) => {
      const to = join(bindsDir, String(i), basename(b.source));
      mkdirSync(dirname(to), { mode: 0o700 });
      copyPlain(b.source, to);
      tightened.services[b.service].volumes[b.index].source = join(realpathSync(dirname(to)), basename(to));
    });
    if (nested.length) check([realpathSync(bindsDir)]);
    result.isolated_binds = nested.map((b) => `${b.service}: ${b.source.slice(copyReal.length + 1) || '.'}`);
    result.images = Object.fromEntries(Object.entries(tightened.services).map(([n, s]) => [n, images[s.image]]));
    const frozen = join(dir, 'compose.frozen.json');
    writeFileSync(frozen, `${JSON.stringify(tightened, null, 2)}\n`, { mode: 0o600, flag: 'wx' });

    base = compose(frozen);
    if (cleanup(setup, call, base, project).length) throw new TestRunError(`the test project ${project} can't be cleared`, { code: 'cleanup-failed' });
    const deadline = Date.now() + target.timeoutMinutes * minuteMs;
    const left = () => Math.max(Math.min(1000, minuteMs), deadline - Date.now());
    const cmd = [...target.command, ...(path ? ['--', path] : [])];
    const workdir = target.workdir ? ['-w', target.workdir] : [];
    // `exec`: the service and what it depends on are started and checked, then the command runs
    // in it. `oneoff`: what it depends on is started and checked, then the service is started
    // once in the background, checked, waited for, and its output read.
    const oneoff = target.run === 'oneoff';
    const startNow = oneoff ? Object.keys(tightened.services[target.service].depends_on ?? {}) : [target.service];
    let run = null;
    if (startNow.length) {
      const up = call(setup, [...base, 'up', '-d', '--wait', '--no-build', '--pull', 'never', ...startNow], { timeout: left() });
      if (up.timedOut) run = up;
      else if (up.status !== 0) {
        // The exited containers' last log lines say why.
        const exited = call(setup, ['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--filter', 'status=exited', '--format', '{{.ID}} {{.Label "com.docker.compose.service"}}']).stdout.trim().split('\n').filter(Boolean);
        const logs = exited.slice(0, 3).map((line) => {
          const [cid, svc] = line.split(' ');
          const l = call(setup, ['logs', '--tail', '15', cid], { timeout: 30_000 });
          return `--- ${svc} ---\n${l.stdout}${l.stderr}`.trim();
        }).join('\n');
        throw new TestRunError(`the services didn't start: ${up.stderr.trim().split('\n').slice(-3).join(' / ')}${logs ? `\n${logs}` : ''}`, { code: 'stack-down' });
      } else inspectRun(setup, call, project, tightened);
    }
    if (!run && oneoff) {
      const one = call(setup, [...base, 'run', '-d', '--no-deps', '--pull', 'never', ...workdir, target.service, ...cmd], { timeout: left() });
      const cid = ids(one).at(-1);
      if (one.timedOut) run = one;
      else if (one.status !== 0 || !cid) throw new TestRunError(`${target.service} didn't start: ${one.stderr.trim().split('\n').slice(-3).join(' / ')}`, { code: 'stack-down' });
      else {
        inspectRun(setup, call, project, tightened, [cid]);
        const waited = call(setup, ['wait', cid], { timeout: left() });
        const logs = call(setup, ['logs', cid], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
        run = { status: waited.timedOut ? null : Number.parseInt(waited.stdout.trim(), 10), timedOut: waited.timedOut, stdout: logs.stdout, stderr: logs.stderr };
      }
    } else if (!run) {
      run = call(setup, [...base, 'exec', '-T', ...workdir, target.service, ...cmd], { timeout: left(), maxBuffer: 64 * 1024 * 1024 });
    }
    const t = tail(clean(`${run.stdout}${run.stderr ? `${run.stdout && !run.stdout.endsWith('\n') ? '\n' : ''}${run.stderr}` : ''}`), OUTPUT_TAIL_BYTES);
    result.timed_out = run.timedOut;
    result.exit_code = run.timedOut ? null : run.status;
    result.outcome = run.timedOut ? 'timeout' : run.status === 0 ? 'pass' : 'fail';
    result.output = { tail: t.text, truncated: t.truncated };
  } catch (err) {
    error = err;
  } finally {
    try {
      const leftover = cleanup(setup, call, base, project);
      if (leftover.length && !error) {
        error = new TestRunError(`${leftover.length} container(s), network(s) or volume(s) of ${project} couldn't be removed`, { code: 'cleanup-failed', hint: `remove them yourself: docker ps -a --filter label=com.docker.compose.project=${project}` });
      }
    } finally {
      removeCopy(copyDir);
      removeCopy(bindsDir);
      result.duration_ms = Date.now() - started;
    }
  }
  if (error) {
    // Every run that got this far leaves a typed result (14c review): refused by a check, or an
    // environment fault (the stack, Docker, cleanup), never a failing test.
    result.outcome = REFUSED.has(error.code) ? 'refused' : 'env-fault';
    result.code = error.code ?? 'error';
    error.message = clean(String(error.message));
    result.message = error.message;
    if (result.outcome === 'env-fault') error.exitCode = EXIT.NEEDS_HUMAN;
  }
  const listed = listOut(outDir);
  result.out_files = listed.files;
  result.out_over_cap = listed.overCap;
  writeFileSync(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  if (error) {
    error.result = { ...result, dir };
    throw error;
  }
  return { ...result, dir };
}

// Removes a test run's folder.
export const removeTestRun = (dir) => rmSync(dir, { recursive: true, force: true });
