#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { buildComposeFixture, removeComposeFixture, startServer, writeDockerConfig } from './compose-fixture.js';
import { dockerProbes, guardDockerProbe, writeCompose } from './compose-probes.js';

// Unit 14a: the Docker and Compose probes (G12, G19, G27, P5, how MIRAI calls Docker). Docker
// is called only through Docker Desktop's own client, by absolute path, with an allowlisted
// environment and MIRAI's own DOCKER_CONFIG. Only local images; nothing is pulled or built. Every
// compose project is mirai-probe-<run>-<n>, every container is labelled mirai.probe=<run>, and
// `down -v` runs before and after each probe; anything left with the label is removed at exit.
//
//   node test/probes/docker-probes.js --yes [--workdir <dir>] [--only id,id] [--keep] [--docker <path>]

const DESKTOP = '/Applications/Docker.app/Contents/Resources';
export const DESKTOP_DOCKER = join(DESKTOP, 'bin', 'docker');
export const DESKTOP_PLUGINS = join(DESKTOP, 'cli-plugins');

export function baseEnv(ctx) {
  return {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: ctx.root,
    DOCKER_CONFIG: ctx.dockerConfig,
    DOCKER_HOST: `unix://${ctx.realHome}/.docker/run/docker.sock`,
  };
}

function envFor(ctx, probe) {
  const env = { ...baseEnv(ctx), ...(probe.env?.(ctx) ?? {}) };
  if (probe.pathFirst) env.PATH = `${join(ctx.root, 'bin')}:${env.PATH}`;
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined));
}

function call(ctx, args, { env, cwd, timeout = 120_000, input } = {}) {
  const r = spawnSync(ctx.docker, args, { env: env ?? baseEnv(ctx), cwd: cwd ?? ctx.root, encoding: 'utf8', timeout, input, maxBuffer: 16 * 1024 * 1024 });
  return { exit: r.status ?? (r.signal ? `signal ${r.signal}` : r.error?.code ?? 'error'), out: r.stdout ?? '', stderr: `${r.stderr ?? ''}${r.error ? ` ${r.error.message}` : ''}` };
}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// The host files a mask must protect, by content: their hashes before and after a container ran.
function hostSnapshot(ctx) {
  const out = {};
  const walk = (rel) => {
    const abs = join(ctx.project, rel);
    const st = lstatSync(abs);
    if (st.isDirectory()) for (const n of readdirSync(abs).sort()) walk(`${rel}/${n}`);
    else out[rel] = createHash('sha256').update(st.isSymbolicLink() ? `link:${readlinkSync(abs)}` : readFileSync(abs)).digest('hex');
  };
  for (const rel of ['.git', '.env', 'sub/.env', 'sub/.git']) if (existsSync(join(ctx.project, rel))) walk(rel);
  return out;
}
const changedSince = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).slice(0, 8);

const markersNow = (ctx) => readdirSync(ctx.markers).sort();
const clearMarkers = (ctx) => { for (const n of readdirSync(ctx.markers)) rmSync(join(ctx.markers, n), { force: true }); };

const httpGet = (port) => new Promise((r) => {
  const req = get({ host: '127.0.0.1', port, path: '/', timeout: 5000 }, (res) => { res.resume(); r(true); });
  req.on('error', () => r(false));
  req.on('timeout', () => { req.destroy(); r(false); });
});

function containers(ctx, project, { all = true, service } = {}) {
  const filters = ['--filter', `label=com.docker.compose.project=${project}`, ...(service ? ['--filter', `label=com.docker.compose.service=${service}`] : [])];
  return call(ctx, ['ps', ...(all ? ['-a'] : []), ...filters, '--format', '{{.ID}} {{.Names}}']).out.split('\n').filter(Boolean).map((l) => l.split(' '));
}

const down = (ctx, project) => call(ctx, ['compose', '-p', project, 'down', '-v', '--remove-orphans', '-t', '1'], { timeout: 60_000 });

// Waits until `service` of `project` runs (or ~30 s pass).
function waitRunning(ctx, project, service) {
  for (let i = 0; i < 30; i += 1) {
    if (containers(ctx, project, { all: false, service }).length > 0) return true;
    spawnSync('/bin/sleep', ['1']);
  }
  return false;
}

export async function runDockerProbe(probe, ctx, n) {
  const project = `mirai-probe-${ctx.runId}-${n}`;
  ctx.projects.push(project);
  const env = envFor(ctx, probe);
  const r = { project, exit: null, out: '', stderr: '', json: null, markers: [], started: false, containers: [] };
  if (probe.kind === 'cli') {
    const args = typeof probe.cli === 'function' ? probe.cli(ctx) : probe.cli;
    Object.assign(r, call(ctx, args, { env, timeout: 60_000 }));
    return r;
  }
  const file = writeCompose(ctx, probe, ctx.runId);
  const fileArgs = probe.noFileFlag ? [] : ['-f', file, '--project-directory', ctx.project];
  const envFile = probe.noEnvFile ? [] : ['--env-file', join(ctx.trust, '.env.test')];
  const common = ['compose', '-p', project, ...fileArgs, ...envFile];
  const cwd = probe.noFileFlag ? ctx.project : ctx.root;
  const placed = probe.noFileFlag ? join(ctx.project, 'compose.yml') : null;
  if (placed) writeFileSync(placed, readFileSync(file));
  clearMarkers(ctx);
  try {
    if (probe.kind === 'config') {
      Object.assign(r, call(ctx, [...common, 'config', '--format', 'json'], { env, cwd, timeout: 60_000 }));
      r.json = parseJson(r.out);
      return r;
    }
    down(ctx, project);
    const before = probe.hostCheck ? hostSnapshot(ctx) : null;
    let runArgs = common;
    if (probe.kind === 'frozen') {
      const cfg = call(ctx, [...common, 'config', '--format', 'json'], { env, cwd });
      const frozen = join(ctx.root, 'frozen', `${probe.id}.json`);
      writeFileSync(frozen, cfg.out);
      r.frozenJson = parseJson(cfg.out);
      runArgs = ['compose', '-p', project, '-f', frozen, '--project-directory', ctx.project];
    }
    if (probe.kind === 'timeout') {
      const child = spawn(ctx.docker, [...common, 'run', '--rm', '-T', 'app', 'sleep', '120'], { env, cwd, stdio: 'ignore' });
      const running = waitRunning(ctx, project, 'app');
      child.kill(probe.signal);
      await new Promise((res) => setTimeout(res, 5000));
      r.started = running;
      const alive = containers(ctx, project, { all: false });
      r.survivors = alive.length;
      // They outlive the client, so `down` alone can't remove their network: force them first.
      if (alive.length) call(ctx, ['rm', '-f', ...alive.map(([id]) => id)]);
      return r;
    }
    const up = call(ctx, [...runArgs, 'up', '-d', '--no-build', '--pull', 'never', ...(probe.kind === 'up-raw' ? [] : ['--wait', '--wait-timeout', '60'])], { env, cwd, timeout: 120_000 });
    r.exit = up.exit;
    r.stderr = up.stderr;
    r.started = up.exit === 0;
    r.markers = markersNow(ctx);
    if (r.started && probe.waitFor) waitRunning(ctx, project, probe.waitFor);
    if (r.started && probe.script) {
      const script = typeof probe.script === 'function' ? probe.script(ctx) : probe.script;
      const ex = call(ctx, [...runArgs, 'exec', '-T', 'app', 'sh', '-c', script], { env, cwd, timeout: 120_000 });
      r.out = ex.out + ex.stderr;
    }
    if (r.started && probe.portCheck) {
      const p = call(ctx, [...runArgs, 'port', probe.portCheck.service, String(probe.portCheck.port)], { env, cwd });
      r.port = (/:(\d+)\s*$/.exec(p.out.trim()) ?? [])[1] ?? null;
      r.portReached = r.port ? await httpGet(Number(r.port)) : false;
    }
    const app = containers(ctx, project, { service: 'app' })[0];
    if (app) r.inspect = parseJson(call(ctx, ['inspect', app[0]]).out)?.[0] ?? null;
    r.containers = containers(ctx, project).map(([, name]) => name);
    if (before) r.hostChanged = changedSince(before, hostSnapshot(ctx));
    return r;
  } finally {
    if (placed) rmSync(placed, { force: true });
    if (probe.kind !== 'config') down(ctx, project);
  }
}

function sweep(ctx) {
  for (const project of ctx.projects) down(ctx, project);
  const left = call(ctx, ['ps', '-aq', '--filter', `label=mirai.probe=${ctx.runId}`]).out.split('\n').filter(Boolean);
  if (left.length) call(ctx, ['rm', '-f', ...left]);
  const nets = call(ctx, ['network', 'ls', '-q', '--filter', `name=mirai-probe-${ctx.runId}-`]).out.split('\n').filter(Boolean);
  if (nets.length) call(ctx, ['network', 'rm', ...nets]);
  return left.length + nets.length;
}

export async function runDockerProbes({ workdir, only = null, keep = false, probes: given = null, docker = DESKTOP_DOCKER, realHome = process.env.HOME, log = () => {} }) {
  const ctx = buildComposeFixture(workdir);
  Object.assign(ctx, { docker, realHome, runId: randomBytes(4).toString('hex'), projects: [] });
  writeDockerConfig(ctx, DESKTOP_PLUGINS);
  const server = await startServer({ body: ctx.canaries.http, hitsFile: join(ctx.root, 'out', 'server-hits') });
  ctx.serverPort = server.port;
  const version = parseJson(call(ctx, ['version', '--format', 'json']).out);
  const report = {
    docker, client: version?.Client?.Version ?? 'unknown', engine: version?.Server?.Version ?? 'unknown',
    compose: call(ctx, ['compose', 'version', '--short']).out.trim(), macos: spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout?.trim(),
    startedAt: new Date().toISOString(), runId: ctx.runId,
    conditions: 'Docker Desktop\'s client by absolute path; env PATH/HOME/DOCKER_CONFIG/DOCKER_HOST only; MIRAI\'s own DOCKER_CONFIG; local images, --pull never, no builds; compose files as JSON',
    results: [], leftOver: null,
  };
  try {
    let probes = given ? given(ctx) : dockerProbes(ctx);
    for (const p of probes) guardDockerProbe(p, ctx);
    if (only) probes = probes.filter((p) => only.includes(p.id));
    let n = 0;
    for (const probe of probes) {
      n += 1;
      log(`${probe.id} ...`);
      let res;
      try {
        res = await runDockerProbe(probe, ctx, n);
      } catch (err) {
        res = { exit: 'error', out: '', stderr: String(err.stack ?? err), markers: [], containers: [] };
      }
      let verdict;
      try {
        verdict = probe.check(res, ctx);
      } catch (err) {
        verdict = { pass: false, note: `check failed: ${err.message}` };
      }
      const outcome = verdict.pass === null ? 'fact' : verdict.pass ? 'pass' : 'FAIL';
      report.results.push({
        id: probe.id, fact: probe.fact, kind: probe.kind, title: probe.title, outcome, note: verdict.note, exit: res.exit,
        stderr: String(res.stderr ?? '').slice(0, 1500), out: String(res.out ?? '').slice(0, 3000),
        resolved: res.json ? JSON.stringify(res.json).slice(0, 3000) : null,
      });
      log(`${probe.id}: ${outcome}  ${verdict.note}`);
    }
    return report;
  } finally {
    report.leftOver = sweep(ctx);
    await server.close();
    writeFileSync(join(ctx.root, 'out', 'docker-results.json'), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(ctx.root, 'out', 'docker-results.md'), `${dockerMarkdown(report)}\n`);
    if (!keep) removeComposeFixture(ctx);
  }
}

function dockerMarkdown(report) {
  const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [
    '# Docker and Compose probes (unit 14a)',
    '',
    `Docker client ${report.client} (${report.docker}), engine ${report.engine}, Compose ${report.compose}, macOS ${report.macos}, ${report.startedAt}.`,
    `Conditions: ${report.conditions}. Containers and networks left after the run (then removed): ${report.leftOver}.`,
    '',
    '| Probe | Fact | Kind | Outcome | What was seen |',
    '|---|---|---|---|---|',
    ...report.results.map((r) => `| ${r.id} | ${r.fact} | ${r.kind} | **${r.outcome}** | ${cell(r.note)} |`),
  ].join('\n');
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, workdir: { type: 'string' }, only: { type: 'string' }, keep: { type: 'boolean' }, docker: { type: 'string' } } });
  if (!values.yes) {
    process.stderr.write('this starts short-lived containers from local images (nothing is pulled); add --yes to run\n');
    return 2;
  }
  const workdir = values.workdir ? resolve(values.workdir) : mkdtempSync(join(process.env.HOME, '.mirai-probes-'));
  const report = await runDockerProbes({ workdir, only: values.only?.split(',') ?? null, keep: values.keep === true, docker: values.docker ?? DESKTOP_DOCKER, log: (l) => process.stdout.write(`${l}\n`) });
  process.stdout.write(`\nreports: ${join(workdir, 'out')}\n`);
  return report.results.some((r) => r.outcome === 'FAIL') ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
