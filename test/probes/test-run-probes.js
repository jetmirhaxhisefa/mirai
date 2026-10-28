#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { init } from '../../src/install/init.js';
import { runTest } from '../../src/tests/run.js';
import { DOCKER } from '../../src/tests/docker.js';
import { startServer } from './compose-fixture.js';

// Unit 14c: MIRAI's own test runs (src/tests/run.js) against Docker Desktop, on a throwaway
// fixture repo under your home folder with MIRAI installed and a temporary MIRAI home. Each
// scenario commits its compose file and config on main (the trust root reads them from there),
// changes the work tree, runs one level, and checks the result. Local images only
// (nginx:1.27-alpine, never pulled); canaries only; every container, network and volume of a run
// is checked gone afterwards.
//
//   node test/probes/test-run-probes.js --yes [--workdir <dir>] [--only id,id] [--keep]

export const LOCAL_IMAGES = Object.freeze(['nginx:1.27-alpine']);
const IMG = 'nginx:1.27-alpine';
const HEALTH = { test: ['CMD', 'wget', '-qO-', 'http://127.0.0.1/'], interval: '2s', retries: 20 };
const CANARY = 'mirai-canary-14c-0f3e9a';

const app = (extra = {}) => ({ image: IMG, volumes: ['./:/w'], healthcheck: HEALTH, ...extra });
const level = (name, command, extra = {}) => ({ name, command, service: 'app', ...extra });
const sh = (script) => ['sh', '-c', script];

// Each scenario: compose (written as JSON, which is YAML), levels, extra files, then what's
// expected: `outcome` of the run, `refused` (an error code), or a `check` on the result.
export function scenarios() {
  return [
    {
      id: 'c1-exec', title: 'exec in a running service: the work tree as it is, no .git, no real .env, the dummy env file\'s values, the output folder',
      compose: { services: { app: app({ ports: ['127.0.0.1:18081:80'], environment: { MODE: '${MODE:-daytime}' } }) } },
      levels: [level('t', sh('cat /w/marker.txt; echo "mode=$MODE"; ls -a /w; for p in /w/.git /w/.env /w/sub/.ENV; do test -e $p && echo "SEEN $p"; done; cat /w/.env.test; echo junit > /mirai/out/junit.xml'))],
      work: { 'marker.txt': 'work-tree-change\n', '.env': `SECRET=${CANARY}\n`, 'sub/.ENV': `SECRET=${CANARY}\n` },
      check: (r) => r.outcome === 'pass' && r.output.tail.includes('work-tree-change') && r.output.tail.includes('mode=test') && !r.output.tail.includes('SEEN')
        && !r.output.tail.includes(CANARY) && r.out_files.some((f) => f.path === 'junit.xml'),
    },
    { id: 'c2-fail', title: 'a failing command is a failing test, with its exit code', compose: { services: { app: app() } }, levels: [level('t', sh('echo failing; exit 3'))], check: (r) => r.outcome === 'fail' && r.exit_code === 3 },
    {
      id: 'c3-path', title: '--path goes after --', compose: { services: { app: app() } }, levels: [level('t', ['sh', '-c', 'echo "args:$*"', 'sh'])], path: 'tests/a_b.php', files: { 'tests/a_b.php': '' },
      check: (r) => r.outcome === 'pass' && r.output.tail.includes('args:-- tests/a_b.php'),
    },
    {
      id: 'c4-oneoff', title: 'a one-off service with a profile, after its dependency is healthy; the peer answers by name',
      compose: { services: { app: app(), runner: { image: IMG, profiles: ['e2e'], depends_on: { app: { condition: 'service_healthy' } }, volumes: ['./:/w'] } } },
      levels: [{ name: 't', service: 'runner', run: 'oneoff', command: sh('wget -qO- http://app/ | head -c 40 && echo; echo peer-ok') }],
      check: (r) => r.outcome === 'pass' && r.output.tail.includes('peer-ok'),
    },
    {
      id: 'c5-no-internet', title: 'a test can\'t reach the internet or resolve names',
      compose: { services: { app: app() } },
      levels: [level('t', sh('if nc -z -w 5 1.1.1.1 443 2>/dev/null; then echo LEAK-IP; exit 1; fi; if nslookup example.com >/dev/null 2>&1; then echo LEAK-DNS; exit 1; fi; echo blocked'))],
      check: (r) => r.outcome === 'pass' && r.output.tail.includes('blocked'),
    },
    {
      id: 'c6-override', title: 'a committed compose.override.yml is never loaded',
      compose: { services: { app: app() } }, files: { 'compose.override.yml': `services:\n  app:\n    privileged: true\n    environment:\n      LEAK: ${CANARY}\n` },
      levels: [level('t', sh('echo "leak=$LEAK"'))],
      check: (r) => r.outcome === 'pass' && !r.output.tail.includes(CANARY),
    },
    { id: 'c7-host-mount', title: 'a host mount is refused', compose: { services: { app: app({ volumes: ['./:/w', '/Users:/host'] }) } }, levels: [level('t', sh('true'))], refused: 'compose-refused' },
    { id: 'c8-git-mount', title: 'a .git mount is refused', compose: { services: { app: app({ volumes: ['./:/w', './.git:/g'] }) } }, levels: [level('t', sh('true'))], refused: 'compose-refused' },
    { id: 'c9-env-mount', title: 'a real .env mount is refused', compose: { services: { app: app({ volumes: ['./:/w', './.env:/w2/.env'] }) } }, levels: [level('t', sh('true'))], work: { '.env': `SECRET=${CANARY}\n` }, refused: 'compose-refused' },
    { id: 'c10-socket', title: 'the Docker socket is refused', compose: { services: { app: app({ volumes: ['./:/w', '/var/run/docker.sock:/var/run/docker.sock'] }) } }, levels: [level('t', sh('true'))], refused: 'compose-refused' },
    { id: 'c11-privileged', title: 'privileged mode is refused', compose: { services: { app: app({ privileged: true }) } }, levels: [level('t', sh('true'))], refused: 'compose-refused' },
    { id: 'c12-network-host', title: 'the host network is refused', compose: { services: { app: { image: IMG, network_mode: 'host' } } }, levels: [level('t', sh('true'))], refused: 'compose-refused' },
    { id: 'c13-env-file-key', title: 'env_file in the compose file is refused before Compose reads it', compose: { services: { app: app({ env_file: ['.env'] }) } }, levels: [level('t', sh('true'))], refused: 'compose-prescan' },
    { id: 'c14-safe-key', title: 'shm_size without [compose] allow is refused', compose: { services: { app: app({ shm_size: '256m' }) } }, levels: [level('t', sh('true'))], refused: 'compose-refused' },
    { id: 'c15-safe-key-allowed', title: 'shm_size with [compose] allow runs', compose: { services: { app: app({ shm_size: '256m' }) } }, allow: ['shm_size'], levels: [level('t', sh('df -h /dev/shm | tail -1'))], outcome: 'pass' },
    { id: 'c16-digest', title: 'an image by digest, never pulled', compose: { services: { app: app({ image: '<digest>' }) } }, levels: [level('t', sh('echo digest-ok'))], outcome: 'pass' },
    { id: 'c17-unknown', title: 'an unknown level is refused, listing the configured ones', compose: { services: { app: app() } }, levels: [level('t', sh('true'))], run: 'nope', refused: 'unknown-test' },
    { id: 'c18-link-out', title: 'a link out of the project stops the run', compose: { services: { app: app() } }, levels: [level('t', sh('true'))], links: { 'etc-link': '/etc' }, refused: 'copy-link' },
    { id: 'c19-missing-image', title: 'an image that isn\'t local is refused, never pulled', compose: { services: { app: app({ image: 'mirai-probe/never-built:1' }) } }, levels: [level('t', sh('true'))], refused: 'no-image' },
    {
      // 14c review (Tech Lead H2), probed: a running service swaps a folder another service mounts
      // for an absolute link to a canary folder outside the project (Docker Desktop follows
      // absolute links as mount sources). The later service must see its own copy.
      id: 'c21-nested-swap', title: 'a running service can\'t swap a folder another service mounts for a link outside',
      compose: {
        services: {
          app: app({ command: ['sh', '-c', 'rm -rf /w/sub && ln -s "$OUT" /w/sub && echo swapped > /w/swap.log && exec nginx -g "daemon off;"'], environment: { OUT: '${OUT}' } }),
          web: { image: IMG, depends_on: { app: { condition: 'service_healthy' } }, volumes: ['./sub:/s:ro'], healthcheck: HEALTH },
        },
      },
      files: { 'sub/canary.txt': 'inside-copy\n' }, envTest: (x) => `MODE=test\nOUT=${x.outside}\n`,
      levels: [{ name: 't', service: 'web', command: sh('cat /s/canary.txt; ls /s') }],
      check: (r, x) => r.outcome === 'pass' && r.output.tail.includes('inside-copy') && !r.output.tail.includes(x.outsideCanary) && r.isolated_binds?.includes('web: sub'),
    },
    {
      // 14c review (Tech Lead L7): the host, by Docker Desktop's own names, from the internal network.
      id: 'c22-no-host', title: 'a test can\'t reach a server on your Mac through host.docker.internal or gateway.docker.internal',
      compose: { services: { app: app() } },
      levels: [level('t', sh('for h in host.docker.internal gateway.docker.internal; do if wget -q -T 4 -O- "http://$h:@PORT@/" 2>/dev/null | grep -q canary; then echo "LEAK $h"; exit 1; fi; done; echo blocked'))],
      check: (r) => r.outcome === 'pass' && r.output.tail.includes('blocked'),
    },
    {
      id: 'c20-timeout', title: 'a hard timeout: an environment fault, and every container gone', compose: { services: { app: app() } },
      levels: [level('t', sh('sleep 600'), { timeout_minutes: 1 })], check: (r) => r.outcome === 'timeout' && r.timed_out === true && r.exit_code === null,
    },
  ];
}

// A scenario that would run (not one expected to be refused) mounts only the fixture and names
// only local images (14a's canaries-only rule).
export function guardScenario(s) {
  if (s.refused) return;
  for (const svc of Object.values(s.compose.services)) {
    if (svc.image !== '<digest>' && !LOCAL_IMAGES.includes(svc.image)) throw new Error(`${s.id}: ${svc.image} isn't a local probe image`);
    for (const v of svc.volumes ?? []) if (!String(v).startsWith('./')) throw new Error(`${s.id}: ${v} is outside the fixture`);
  }
}

const toml = (v) => JSON.stringify(v);
function configText(s) {
  const levels = s.levels.map((l) => ['[[testing.levels]]', ...Object.entries(l).map(([k, v]) => `${k} = ${toml(v)}`)].join('\n')).join('\n\n');
  return `\n[compose]\nfiles = ["compose.yml"]\nenv_file = ".env.test"\n${s.allow ? `allow = ${toml(s.allow)}\n` : ''}\n${levels}\n`;
}

export async function runTestProbes({ workdir, only = null, keep = false, socket = join(process.env.HOME, '.docker', 'run', 'docker.sock'), log = () => {} }) {
  mkdirSync(workdir, { recursive: true });
  const root = join(workdir, 'repo');
  const home = join(workdir, 'home');
  mkdirSync(root, { recursive: true });
  mkdirSync(home, { recursive: true });
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: root, env: gitEnv }).toString();
  const docker = (...a) => spawnSync(DOCKER.client, a, { env: { PATH: '/usr/bin:/bin', HOME: home, DOCKER_HOST: `unix://${socket}` }, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), '# probe fixture (unit 14c)\n');
  writeFileSync(join(root, '.gitignore'), '.env\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  const env = { PATH: '/usr/bin:/bin', HOME: home };
  init({ cwd: root, env, branch: 'main' });
  const cfgPath = join(root, '.mirai', 'config.toml');
  chmodSync(cfgPath, 0o644);
  const baseConfig = readFileSync(cfgPath, 'utf8');
  writeFileSync(join(root, '.env.test'), 'MODE=test\n');
  git('add', '-A');
  git('commit', '-qm', 'install MIRAI');
  const digest = docker('image', 'inspect', '--format', '{{index .RepoDigests 0}}', IMG).stdout.trim();
  // Canaries outside the project: a folder (c21) and a server on 127.0.0.1 (c22).
  const x = { outside: join(workdir, 'outside'), outsideCanary: `${CANARY}-outside` };
  mkdirSync(x.outside, { recursive: true });
  writeFileSync(join(x.outside, 'canary.txt'), `${x.outsideCanary}\n`);
  mkdirSync(join(workdir, 'out'), { recursive: true });
  const server = await startServer({ body: `canary ${CANARY}`, hitsFile: join(workdir, 'out', 'server-hits') });
  x.port = server.port;
  const report = { docker: docker('version', '--format', '{{.Server.Version}}').stdout.trim(), startedAt: new Date().toISOString(), results: [] };
  try {
    let list = scenarios();
    if (only) list = list.filter((s) => only.includes(s.id));
    for (const s of list) {
      guardScenario(s);
      const compose = structuredClone(s.compose);
      for (const svc of Object.values(compose.services)) if (svc.image === '<digest>') svc.image = digest;
      const levels = s.levels.map((l) => ({ ...l, command: l.command.map((a) => a.replaceAll('@PORT@', String(x.port))) }));
      writeFileSync(cfgPath, `${baseConfig}${configText({ ...s, levels })}`);
      writeFileSync(join(root, '.env.test'), s.envTest ? s.envTest(x) : 'MODE=test\n');
      writeFileSync(join(root, 'compose.yml'), `${JSON.stringify(compose, null, 2)}\n`);
      for (const [p, body] of Object.entries(s.files ?? {})) {
        mkdirSync(join(root, p, '..'), { recursive: true });
        writeFileSync(join(root, p), body);
      }
      git('add', '-A');
      git('commit', '-qm', `scenario ${s.id}`, '--allow-empty');
      for (const [p, body] of Object.entries(s.work ?? {})) {
        mkdirSync(join(root, p, '..'), { recursive: true });
        writeFileSync(join(root, p), body);
      }
      for (const [p, target] of Object.entries(s.links ?? {})) symlinkSync(target, join(root, p));
      let r = null;
      let error = null;
      try {
        r = await runTest({ cwd: root, env, name: s.run ?? s.levels[0].name, path: s.path ?? null, docker: { socket } });
      } catch (err) {
        error = { code: err.code, message: err.message };
      }
      const leftovers = ['ps', 'network', 'volume'].flatMap((k) => docker(...(k === 'ps' ? ['ps', '-aq'] : [k, 'ls', '-q']), '--filter', 'label=mirai.repo').stdout.split(/\s+/).filter(Boolean));
      const leftoversByName = r ? ['network', 'volume'].flatMap((k) => docker(k, 'ls', '-q', '--filter', `name=${r.project}`).stdout.split(/\s+/).filter(Boolean)) : [];
      let pass;
      if (s.refused) pass = error?.code === s.refused;
      else if (error) pass = false;
      else pass = s.check ? s.check(r, x) : r.outcome === s.outcome;
      pass = pass && leftovers.length === 0 && leftoversByName.length === 0;
      const res = {
        id: s.id, title: s.title, outcome: pass ? 'pass' : 'FAIL',
        result: r ? { outcome: r.outcome, exit_code: r.exit_code, project: r.project, tail: r.output.tail.slice(-600), out_files: r.out_files, tree: r.tree, isolated_binds: r.isolated_binds } : null,
        error, leftovers: [...leftovers, ...leftoversByName],
      };
      report.results.push(res);
      log(`${s.id}: ${res.outcome} (${error ? `refused: ${error.code}` : `${r.outcome}, exit ${r.exit_code}`})${res.leftovers.length ? ` LEFTOVERS ${res.leftovers.length}` : ''}`);
      for (const p of [...Object.keys(s.work ?? {}), ...Object.keys(s.links ?? {})]) rmSync(join(root, p), { force: true });
      for (const p of Object.keys(s.files ?? {})) {
        rmSync(join(root, p), { force: true });
        git('rm', '-q', '--cached', '--ignore-unmatch', p);
      }
    }
    const projects = report.results.map((res) => res.result?.project).filter(Boolean);
    report.distinctProjects = new Set(projects).size === projects.length;
    report.outsideUnchanged = readFileSync(join(x.outside, 'canary.txt'), 'utf8') === `${x.outsideCanary}\n` && readdirSync(x.outside).length === 1;
    report.serverHits = readFileSync(join(workdir, 'out', 'server-hits'), 'utf8').split('\n').filter(Boolean).length;
    return report;
  } finally {
    await server.close();
    mkdirSync(join(workdir, 'out'), { recursive: true });
    writeFileSync(join(workdir, 'out', 'test-run-results.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (!keep) {
      // The trust root is read-only on purpose; open it up to remove it.
      spawnSync('/bin/chmod', ['-R', 'u+rwX', root, home]);
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(join(workdir, 'outside'), { recursive: true, force: true });
    }
  }
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, workdir: { type: 'string' }, only: { type: 'string' }, keep: { type: 'boolean' } } });
  if (!values.yes) {
    process.stderr.write('this runs local containers (nginx:1.27-alpine) on a throwaway fixture under your home folder; add --yes to run\n');
    return 2;
  }
  const workdir = values.workdir ? resolve(values.workdir) : mkdtempSync(join(process.env.HOME, '.mirai-probes-'));
  const report = await runTestProbes({ workdir, only: values.only?.split(',') ?? null, keep: values.keep === true, log: (l) => process.stdout.write(`${l}\n`) });
  process.stdout.write(`\ndistinct projects: ${report.distinctProjects}; outside folder unchanged: ${report.outsideUnchanged}; host server hits: ${report.serverHits}\nreport: ${join(workdir, 'out', 'test-run-results.json')}\n`);
  return report.results.some((r) => r.outcome === 'FAIL') || !report.distinctProjects || !report.outsideUnchanged || report.serverHits > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
