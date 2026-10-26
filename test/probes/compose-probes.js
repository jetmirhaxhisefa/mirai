import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { DIFF_FLAGS } from '../../src/store/git-pins.js';
import { fixtureGit, put } from './compose-fixture.js';

// Unit 14a's probe lists as data. Docker probes: a compose file (an object, written as JSON), how
// it's run, and what counts as a pass. Git probes: one hostile key planted in a fixture repo,
// MIRAI's git commands run with and without the pins, and what counts as the key having fired.
// research/11 records the results.

export const IMAGE = 'nginx:1.27-alpine';
export const LOCAL_IMAGES = Object.freeze([IMAGE]);
const svc = (more = {}) => ({ image: IMAGE, command: ['sleep', '300'], ...more });

// Keys that may only appear in probes that run `config` (nothing starts).
export const RISKY_KEYS = Object.freeze([
  'privileged', 'cap_add', 'devices', 'network_mode', 'pid', 'ipc', 'security_opt', 'userns_mode', 'sysctls', 'build', 'configs',
  'secrets', 'develop', 'post_start', 'runtime', 'gpus', 'cgroup_parent', 'logging', 'cgroup', 'uts', 'provider', 'extends',
  'include', 'models', 'device_cgroup_rules', 'external_links', 'links', 'volumes_from', 'driver_opts', 'external', 'storage_opt',
]);

// What `config --format json` turns each risky key into: one probe per key, nothing started.
function showProbes(ctx) {
  const o = join(ctx.root, 'outside');
  const shows = [
    ['privileged', { privileged: true }],
    ['cap_add', { cap_add: ['SYS_ADMIN'] }],
    ['devices', { devices: ['/dev/null:/dev/probe'] }],
    ['network_mode-host', { network_mode: 'host' }],
    ['pid-host', { pid: 'host' }],
    ['ipc-host', { ipc: 'host' }],
    ['uts-host', { uts: 'host' }],
    ['cgroup-host', { cgroup: 'host' }],
    ['security_opt', { security_opt: ['seccomp:unconfined'] }],
    ['userns_mode', { userns_mode: 'host' }],
    ['sysctls', { sysctls: { 'net.ipv4.ip_forward': '1' } }],
    ['extra_hosts', { extra_hosts: ['probe:127.0.0.1'] }],
    ['dns', { dns: ['1.1.1.1'] }],
    ['ports', { ports: ['127.0.0.1:18999:80'] }],
    ['build', { build: { context: '.' } }],
    ['env_file', { env_file: [join(ctx.trust, '.env.test')] }],
    ['bind-outside', { volumes: [`${o}:/o`] }],
    ['develop', { develop: { watch: [{ action: 'sync', path: './app', target: '/app' }] } }],
    ['post_start', { post_start: [{ command: ['echo', 'x'] }] }],
    ['runtime', { runtime: 'runc' }],
    ['gpus', { gpus: 'all' }],
    ['cgroup_parent', { cgroup_parent: 'probe' }],
    ['logging', { logging: { driver: 'syslog' } }],
    ['device_cgroup_rules', { device_cgroup_rules: ['c 1:3 mr'] }],
    ['volumes_from', { volumes_from: ['other'] }, { other: svc() }],
    ['links', { links: ['other'] }, { other: svc() }],
    ['storage_opt', { storage_opt: { size: '1G' } }],
    ['user-root', { user: '0:0' }],
    ['tmpfs', { tmpfs: ['/scratch'] }],
    ['read_only', { read_only: true }],
    ['init', { init: true }],
    ['volume-one-letter', { volumes: ['v:/x'] }],
  ];
  const top = [
    ['configs-file', { configs: ['c1'] }, { configs: { c1: { file: join(o, 'secret.txt') } } }],
    ['secrets-file', { secrets: ['s1'] }, { secrets: { s1: { file: join(o, 'secret.txt') } } }],
    ['volume-driver-bind', { volumes: ['vol:/x'] }, { volumes: { vol: { driver: 'local', driver_opts: { type: 'none', o: 'bind', device: o } } } }],
    ['volume-name', { volumes: ['vol:/x'] }, { volumes: { vol: { name: 'mirai-probe-shared' } } }],
    ['volume-external', { volumes: ['vol:/x'] }, { volumes: { vol: { external: true } } }],
    ['network-external', { networks: ['n'] }, { networks: { n: { external: true } } }],
    ['models', { models: ['m'] }, { models: { m: { model: 'ai/mirai-probe' } } }],
  ];
  const probes = [];
  for (const [key, patch, extra] of shows) {
    probes.push({ id: `g12-show-${key}`, fact: 'G12', kind: 'config', risky: true, title: `config shows: ${key}`, compose: { services: { app: svc(patch), ...(extra ?? {}) } }, check: showCheck(key) });
  }
  for (const [key, patch, topLevel] of top) {
    probes.push({ id: `g12-show-${key}`, fact: 'G12', kind: 'config', risky: true, title: `config shows: ${key}`, compose: { services: { app: svc(patch) }, ...topLevel }, check: showCheck(key) });
  }
  return probes;
}

// Where a key ended up in the resolved file: a fact for 14b's allowlist. Shown: the service's
// keys beyond the plain ones every probe has, and the top-level keys beyond the default network.
const PLAIN = ['command', 'entrypoint', 'image', 'labels', 'networks'];
const showCheck = () => (r) => {
  if (r.exit !== 0) return { pass: null, note: `config refused it: ${firstLine(r.stderr)}` };
  const json = r.json;
  if (!json) return { pass: null, note: 'no JSON' };
  const app = json.services?.app ?? {};
  const keys = Object.keys(app).filter((k) => !PLAIN.includes(k)).sort();
  const nets = app.networks && Object.keys(app.networks).join(',') !== 'default' ? [`networks=${short(app.networks)}`] : [];
  const top = Object.entries(json).filter(([k, v]) => !['name', 'services'].includes(k) && !(k === 'networks' && Object.keys(v).join(',') === 'default'));
  return { pass: null, note: `app: ${[...keys.map((k) => `${k}=${short(app[k])}`), ...nets].join(' ') || 'nothing beyond the plain keys'}; top: ${top.map(([k, v]) => `${k}=${short(v)}`).join(' ') || 'none'}` };
};

const short = (v) => JSON.stringify(v).slice(0, 160);
const firstLine = (s) => String(s ?? '').trim().split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 300) ?? '';
const yes = (b) => (b ? 'yes' : 'no');

// The container's view through the masks: reads, writes, deletes and unmounts, then the links.
const MASK_SCRIPT = [
  'echo "#ls"; ls -la /w/.git 2>&1 | head -5',
  'echo "#read"; cat /w/.git/CANARY /w/.git/config /w/.env /w/sub/.env /w/sub/.git 2>&1',
  'echo "#links"; cat /w/link-git/CANARY /w/link-env /w/link-env-abs 2>&1',
  'echo "#write"; echo x >> /w/.git/config 2>&1; echo x > /w/.git/hooks-probe 2>&1; echo y >> /w/.env 2>&1; echo y >> /w/sub/.env 2>&1; echo y >> /w/sub/.git 2>&1',
  'echo "#rm"; rm -rf /w/.git/* 2>&1; rm -f /w/.env /w/sub/.env /w/sub/.git 2>&1',
  'echo "#umount"; umount /w/.git 2>&1; umount /w/.env 2>&1; umount /w/sub/.env 2>&1',
  // The host's disk ignores case (14a review): another case of a masked name is a different
  // path to Linux, which the shared folder may hand to macOS, landing on the real file.
  'echo "#case"; cat /w/.ENV /w/.Env /w/.GIT/CANARY /w/.Git/config /w/SUB/.env /w/sub/.ENV /w/Sub/.GIT 2>&1; ls -a /w | grep -i "^\\.env$\\|^\\.git$" 2>&1',
  'echo "#case-write"; echo z >> /w/.ENV 2>&1; echo z >> /w/.GIT/config 2>&1; echo z >> /w/SUB/.env 2>&1; echo z > /w/.Git/hooks-probe 2>&1',
  'echo "#after"; cat /w/.git/CANARY /w/.env /w/sub/.env 2>&1',
  'echo "#mounts"; grep " /w" /proc/mounts | cut -d" " -f2,3,4 2>&1',
  'echo "#end"',
].join('; ');

const NET_SCRIPT = (port) => [
  'echo "#dns-out"; nslookup example.com 2>&1 | tail -n 4',
  'echo "#ip-out"; nc -z -w 5 1.1.1.1 443 2>&1 && echo OPEN',
  `echo "#host"; wget -T 5 -qO- http://host.docker.internal:${port}/ 2>&1 | head -c 200; echo`,
  `echo "#gateway-name"; wget -T 5 -qO- http://gateway.docker.internal:${port}/ 2>&1 | head -c 200; echo`,
  `echo "#gw"; GW=$(ip route | awk '/default/{print $3}'); echo "gw=$GW"; if [ -n "$GW" ]; then wget -T 5 -qO- http://$GW:${port}/ 2>&1 | head -c 200; fi; echo`,
  'echo "#peer"; wget -T 5 -qO- http://peer/ 2>&1 | grep -o "Welcome to nginx" | head -1',
  'echo "#proxy"; env | grep -i _proxy | cut -d= -f1',
  'echo "#end"',
].join('; ');

// The part of the output between "#name" and the next "#".
export function section(text, name) {
  const m = new RegExp(`^#${name}\\n([\\s\\S]*?)(?=^#[a-z-]+$|(?![\\s\\S]))`, 'm').exec(text);
  return m ? m[1].replace(/\n$/, '') : '';
}

const resolvedAddress = (text) => /Address(?: \d+)?:\s*(?!127\.)(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]+:[0-9a-f:]+)(?!#)\s*$/m.test(text.replace(/^.*#53.*$/gm, ''));

export function dockerProbes(ctx) {
  const P = ctx.project;
  const c = ctx.canaries;
  const masks = (git) => [
    { type: 'bind', source: P, target: '/w' },
    git,
    { type: 'bind', source: join(ctx.trust, 'empty'), target: '/w/.env', read_only: true },
    { type: 'bind', source: '/dev/null', target: '/w/sub/.env', read_only: true },
    { type: 'bind', source: join(ctx.trust, 'empty'), target: '/w/sub/.git', read_only: true },
  ];
  const maskCheck = (r) => {
    const seen = [c.git, c.env, c.subEnv, c.subGit].filter((v) => r.out.includes(v));
    const changed = r.hostChanged ?? [];
    return { pass: r.started && r.out.includes('#end') && seen.length === 0 && changed.length === 0, note: `started: ${yes(r.started)}; ran to the end: ${yes(r.out.includes('#end'))}; canaries seen: ${seen.length}; case variants: ${section(r.out, 'case').trim().replace(/\n/g, ' | ').slice(0, 200)}; host files changed: ${changed.join(', ') || 'none'}; mounts: ${section(r.out, 'mounts').trim().replace(/\n/g, ' | ').slice(0, 300)}` };
  };
  return [
    // ---- G12: what reaches the resolved file ----
    {
      id: 'g12-override', fact: 'G12', kind: 'config', title: '-f with --project-directory: compose.override.yml next to it isn\'t loaded',
      compose: { services: { app: svc() } },
      check: (r) => ({ pass: r.exit === 0 && !r.out.includes(c.override) && !('override-canary' in (r.json?.services ?? {})), note: `override loaded: ${yes(r.out.includes(c.override))}` }),
    },
    {
      id: 'g12-override-control', fact: 'G12', kind: 'config', title: 'control: no -f, no --env-file, run in the project folder',
      compose: { services: { app: svc() } }, noFileFlag: true, noEnvFile: true,
      check: (r) => ({ pass: null, note: `exit ${r.exit}; override loaded: ${yes(r.out.includes(c.override))}; the project .env's COMPOSE_FILE loaded evil.json: ${yes('evil-canary' in (r.json?.services ?? {}))}; app present: ${yes('app' in (r.json?.services ?? {}))}; dbg/name: ${r.json?.name} ${firstLine(r.stderr)}` }),
    },
    {
      id: 'g12-override-shown', fact: 'G12', kind: 'config', title: 'control: no -f, --env-file <trust>, run in the project folder (the override does load)',
      compose: { services: { app: svc() } }, noFileFlag: true,
      check: (r) => ({ pass: null, note: `exit ${r.exit}; override loaded: ${yes('override-canary' in (r.json?.services ?? {}))} (expected yes: the g12-override pass can fail); ${firstLine(r.stderr)}` }),
    },
    {
      id: 'g12-dotenv', fact: 'G12', kind: 'config', title: 'a project .env with COMPOSE_FILE/PROFILES/PROJECT_NAME and a value, with --env-file <trust>',
      compose: { services: { app: svc({ environment: { Y: '${PROBE_VAR:-unset}', X: '${CANARY_SECRET:-none}' } }), dbg: svc({ profiles: ['dbg'] }) } },
      check: (r) => {
        const s = r.json?.services ?? {};
        const env = s.app?.environment ?? {};
        const leaks = [
          'evil-canary' in s && 'COMPOSE_FILE', 'dbg' in s && 'COMPOSE_PROFILES', r.json?.name !== r.project && `COMPOSE_PROJECT_NAME (${r.json?.name})`,
          env.Y === 'from-dotenv' && 'PROBE_VAR', r.out.includes(c.env) && 'the canary',
        ].filter(Boolean);
        return { pass: r.exit === 0 && leaks.length === 0 && env.Y === 'from-trust-env', note: `Y=${env.Y}; leaked from .env: ${leaks.join(', ') || 'nothing'}` };
      },
    },
    {
      id: 'g12-dotenv-control', fact: 'G12', kind: 'config', title: 'control: the same without --env-file',
      compose: { services: { app: svc({ environment: { Y: '${PROBE_VAR:-unset}', X: '${CANARY_SECRET:-none}' } }), dbg: svc({ profiles: ['dbg'] }) } }, noEnvFile: true,
      check: (r) => {
        const s = r.json?.services ?? {};
        return { pass: null, note: `exit ${r.exit}; Y=${s.app?.environment?.Y}; canary inlined: ${yes(r.out.includes(c.env))}; evil: ${yes('evil-canary' in s)}; dbg: ${yes('dbg' in s)}; name: ${r.json?.name}` };
      },
    },
    {
      id: 'g12-callerenv', fact: 'G12', kind: 'config', title: 'COMPOSE_* set by the caller (what MIRAI must clear)',
      compose: { services: { app: svc(), dbg: svc({ profiles: ['dbg'] }) } },
      env: (x) => ({ COMPOSE_FILE: join(x.project, 'evil.json'), COMPOSE_PROFILES: 'dbg', COMPOSE_PROJECT_NAME: 'mirai-probe-from-env', COMPOSE_ENV_FILES: join(x.project, '.env') }),
      check: (r) => {
        const s = r.json?.services ?? {};
        return { pass: null, note: `exit ${r.exit}; evil (COMPOSE_FILE): ${yes('evil-canary' in s)}; dbg (COMPOSE_PROFILES): ${yes('dbg' in s)}; name: ${r.json?.name}; canary (COMPOSE_ENV_FILES): ${yes(r.out.includes(c.env))}` };
      },
    },
    ...showProbes(ctx),
    // ---- G12: host-side actions before any container ----
    {
      id: 'g12-include-local', fact: 'G12', kind: 'config', risky: true, title: 'include: a local file',
      compose: { include: ['included.json'], services: { app: svc() } },
      check: (r) => ({ pass: null, note: `exit ${r.exit}; included service in the result: ${yes('included-svc' in (r.json?.services ?? {}))}; include key kept: ${yes('include' in (r.json ?? {}))}` }),
    },
    {
      id: 'g12-extends-local', fact: 'G12', kind: 'config', risky: true, title: 'extends: file: a local file',
      compose: { services: { app: svc({ extends: { file: 'base.json', service: 'basesvc' } }) } },
      check: (r) => ({ pass: null, note: `exit ${r.exit}; merged: ${yes(r.json?.services?.app?.environment?.FROM_BASE === 'yes')}; extends kept: ${yes('extends' in (r.json?.services?.app ?? {}))}` }),
    },
    ...[
      ['oci', 'oci://mirai-probe.invalid/x:1'],
      ['git-ssh', 'git@mirai-probe.invalid:x/y.git'],
      ['git-https', 'https://mirai-probe.invalid/x/y.git#main'],
    ].map(([k, url]) => ({
      id: `g12-include-remote-${k}`, fact: 'G12', kind: 'config', risky: true, title: `include: a remote ${k} file (an unreachable name)`,
      compose: { include: [url], services: { app: svc() } }, pathFirst: true,
      check: (r) => {
        const ran = r.markers;
        return { pass: ran.length === 0, note: `exit ${r.exit}; host programs run: ${ran.join(', ') || 'none'}; ${firstLine(r.stderr)}` };
      },
    })),
    {
      id: 'g12-provider-config', fact: 'G12', kind: 'config', risky: true, title: 'provider: service, config only',
      compose: { services: { app: svc(), ai: { provider: { type: 'mirai-probe', options: { a: 'b' } } } } }, pathFirst: true,
      check: (r) => ({ pass: r.markers.length === 0, note: `exit ${r.exit}; plugin ran on the host: ${yes(r.markers.length > 0)}; ${firstLine(r.stderr)}` }),
    },
    {
      id: 'g12-provider-up', fact: 'G12', kind: 'up-raw', risky: true, title: 'provider: service, up (runs the plugin on the host?)',
      compose: { services: { ai: { provider: { type: 'mirai-probe', options: { a: 'b' } } } } }, pathFirst: true,
      check: (r) => ({ pass: null, note: `exit ${r.exit}; plugin ran on the host: ${yes(r.markers.length > 0)} (${r.markers.join(', ')}); ${firstLine(r.stderr)}` }),
    },
    // ---- G27: the frozen file ----
    {
      id: 'g27-frozen', fact: 'G27', kind: 'frozen', title: 'config --format json, then up -f <frozen> unchanged; docker inspect matches',
      compose: { services: { app: svc({ volumes: ['./app:/w/app'], environment: { Y: '${PROBE_VAR}', Z: 'a$$b' }, networks: ['inner'] }) }, networks: { inner: { internal: true } } },
      check: (r) => {
        const env = r.inspect?.Config?.Env ?? [];
        const mounts = (r.inspect?.Mounts ?? []).map((m) => `${m.Type}:${m.Source}->${m.Destination}`);
        const nets = Object.keys(r.inspect?.NetworkSettings?.Networks ?? {});
        const relative = (r.frozenJson?.services?.app?.volumes ?? []).some((v) => !isAbsolute(v.source ?? '/'));
        const ok = r.started && env.includes('Y=from-trust-env') && env.includes('Z=a$b') && mounts.some((m) => m.endsWith('->/w/app'))
          && nets.length === 1 && !r.containers.some((n) => n.includes('evil')) && !r.out.includes(c.env);
        return { pass: ok, note: `started: ${yes(r.started)}; env Y/Z: ${env.filter((e) => /^[YZ]=/.test(e)).join(' ')}; mounts: ${mounts.join(' ')}; networks: ${nets.join(',')}; relative path in frozen: ${yes(relative)}; containers: ${r.containers.join(',')}` };
      },
    },
    // ---- G27: masks ----
    {
      id: 'g27-mask-volume', fact: 'G27', kind: 'up', title: '.git masked by an anonymous volume, each .env and sub/.git by a read-only bind of an empty file or /dev/null',
      compose: { services: { app: svc({ volumes: masks({ type: 'volume', target: '/w/.git' }) }) } }, script: MASK_SCRIPT, hostCheck: true, check: maskCheck,
    },
    {
      id: 'g27-mask-tmpfs', fact: 'G27', kind: 'up', title: '.git masked by a tmpfs, the files as above',
      compose: { services: { app: svc({ volumes: masks({ type: 'tmpfs', target: '/w/.git' }) }) } }, script: MASK_SCRIPT, hostCheck: true, check: maskCheck,
    },
    {
      id: 'g27-mask-file-volume', fact: 'G27', kind: 'up', title: 'a volume over a file (.env): accepted?',
      compose: { services: { app: svc({ volumes: [{ type: 'bind', source: P, target: '/w' }, { type: 'volume', target: '/w/.env' }] }) } }, script: 'cat /w/.env 2>&1; echo "#end"', hostCheck: true,
      check: (r) => ({ pass: null, note: `started: ${yes(r.started)}; canary seen: ${yes(r.out.includes(c.env))}; ${firstLine(r.stderr)}` }),
    },
    {
      id: 'g27-mask-file-tmpfs', fact: 'G27', kind: 'up', title: 'a tmpfs over a file (.env): accepted?',
      compose: { services: { app: svc({ volumes: [{ type: 'bind', source: P, target: '/w' }, { type: 'tmpfs', target: '/w/.env' }] }) } }, script: 'cat /w/.env 2>&1; echo "#end"', hostCheck: true,
      check: (r) => ({ pass: null, note: `started: ${yes(r.started)}; canary seen: ${yes(r.out.includes(c.env))}; ${firstLine(r.stderr)}` }),
    },
    {
      id: 'g27-unmasked-nested', fact: 'G27', kind: 'up', title: 'control: .git and .env masked, sub/.env and sub/.git not',
      compose: { services: { app: svc({ volumes: masks({ type: 'volume', target: '/w/.git' }).slice(0, 3) }) } }, script: 'cat /w/sub/.env /w/sub/.git 2>&1; echo "#end"', hostCheck: true,
      check: (r) => ({ pass: null, note: `sub/.env seen: ${yes(r.out.includes(c.subEnv))}; sub/.git seen: ${yes(r.out.includes(c.subGit))} (expected yes: every nested one needs its mask)` }),
    },
    // ---- G19: the internal network ----
    {
      id: 'g19-internal', fact: 'G19', kind: 'up', title: 'internal network: no outside DNS or address, no host, the peer service answers, no proxy variables',
      compose: { services: { app: svc({ networks: ['inner'] }), peer: { image: IMAGE, networks: ['inner'] } }, networks: { inner: { internal: true } } },
      script: (x) => NET_SCRIPT(x.serverPort), waitFor: 'peer',
      check: (r) => {
        const dns = resolvedAddress(section(r.out, 'dns-out'));
        const host = r.out.includes(c.http);
        const ip = /OPEN/.test(section(r.out, 'ip-out'));
        const peer = section(r.out, 'peer').includes('Welcome to nginx');
        const proxy = section(r.out, 'proxy').trim();
        return { pass: r.started && r.out.includes('#end') && !dns && !host && !ip && peer && proxy === '', note: `outside DNS: ${yes(dns)}; outside IP: ${yes(ip)}; host reached: ${yes(host)}; peer: ${yes(peer)}; proxy vars: ${proxy.replace(/\n/g, ',') || 'none'}; gw: ${section(r.out, 'gw').trim().split('\n')[0]}` };
      },
    },
    {
      id: 'g19-control', fact: 'G19', kind: 'up', title: 'control: the same on a normal network',
      compose: { services: { app: svc({ networks: ['outer'] }), peer: { image: IMAGE, networks: ['outer'] } }, networks: { outer: {} } },
      script: (x) => NET_SCRIPT(x.serverPort), waitFor: 'peer',
      check: (r) => ({ pass: null, note: `outside DNS: ${yes(resolvedAddress(section(r.out, 'dns-out')))}; outside IP: ${yes(/OPEN/.test(section(r.out, 'ip-out')))}; host reached: ${yes(r.out.includes(c.http))}; peer: ${yes(section(r.out, 'peer').includes('Welcome'))}; proxy vars: ${section(r.out, 'proxy').trim().replace(/\n/g, ',') || 'none'}` }),
    },
    {
      id: 'g19-ports-internal', fact: 'G19', kind: 'up', risky: false, title: 'a published port on an internal network: reachable from the host?',
      compose: { services: { app: svc({ networks: ['inner'] }), peer: { image: IMAGE, networks: ['inner'], ports: ['127.0.0.1::80'] } }, networks: { inner: { internal: true } } },
      script: 'echo "#end"', waitFor: 'peer', portCheck: { service: 'peer', port: 80 },
      check: (r) => ({ pass: null, note: `host port: ${r.port ?? 'none'}; reachable from the host: ${yes(r.portReached)}` }),
    },
    // ---- How MIRAI calls Docker ----
    {
      id: 'docker-own-config', fact: 'docker', kind: 'cli', title: 'Compose works with MIRAI\'s DOCKER_CONFIG and DOCKER_HOST set (nothing from ~/.docker)',
      cli: ['compose', 'version'], check: (r) => ({ pass: r.exit === 0, note: `exit ${r.exit}; ${firstLine(r.out)} ${firstLine(r.stderr)}` }),
    },
    {
      id: 'docker-no-host', fact: 'docker', kind: 'cli', title: 'the same without DOCKER_HOST (no context to fall back on)',
      cli: ['compose', 'ls'], env: () => ({ DOCKER_HOST: undefined }),
      check: (r) => ({ pass: null, note: `exit ${r.exit}; ${firstLine(r.stderr) || firstLine(r.out)}` }),
    },
    {
      id: 'docker-proxy-own', fact: 'docker', kind: 'cli', title: 'proxy variables in a container started with MIRAI\'s config (names only)',
      cli: (x) => ['run', '--rm', '--pull', 'never', '--label', `mirai.probe=${x.runId}`, IMAGE, 'sh', '-c', 'env | grep -i _proxy | cut -d= -f1; echo "#end"'],
      check: (r) => ({ pass: !/_proxy/i.test(r.out.replace('#end', '')), note: `proxy variables: ${r.out.replace('#end', '').trim().replace(/\n/g, ',') || 'none'}` }),
    },
    {
      id: 'docker-proxy-yours', fact: 'docker', kind: 'cli', title: 'the same with your own Docker config (names only, nothing read from the file)',
      cli: (x) => ['run', '--rm', '--pull', 'never', '--label', `mirai.probe=${x.runId}`, IMAGE, 'sh', '-c', 'env | grep -i _proxy | cut -d= -f1; echo "#end"'],
      env: (x) => ({ DOCKER_CONFIG: undefined, HOME: x.realHome }),
      check: (r) => ({ pass: null, note: `proxy variables: ${r.out.replace('#end', '').trim().replace(/\n/g, ',') || 'none'}` }),
    },
    // ---- P5: a timeout ----
    ...['SIGTERM', 'SIGKILL'].map((signal) => ({
      id: `p5-kill-${signal.toLowerCase()}`, fact: 'P5', kind: 'timeout', signal, title: `${signal} to the Compose client during a run: does the container survive?`,
      compose: { services: { app: svc() } },
      check: (r) => ({ pass: null, note: `containers still running after ${signal}: ${r.survivors}` }),
    })),
  ];
}

// ---------------------------------------------------------------------------------------------
// git

// MIRAI's git commands, as it runs (or will run) them. `pinned` adds MIRAI's diff flags.
export const GIT_STEPS = Object.freeze([
  ['rev-parse', () => ['rev-parse', '--show-toplevel']],
  ['rev-list', () => ['rev-list', '--max-parents=0', 'HEAD', '--']],
  ['ls-tree', () => ['--literal-pathspecs', 'ls-tree', '-z', '-r', 'HEAD^{tree}', '--', '.']],
  ['cat-file', () => ['cat-file', '--batch'], 'HEAD:a.txt\n'],
  ['check-ignore', () => ['check-ignore', '--stdin', '-z'], 'new.txt\0'],
  ['ls-files', () => ['ls-files', '-z', '--cached', '--others', '--exclude-standard']],
  ['diff-names', (pinned) => ['diff', '--name-only', '-z', '--no-renames', ...(pinned ? DIFF_FLAGS : []), 'HEAD', '--']],
  ['status', () => ['status', '--porcelain']],
  ['diff', (pinned) => ['diff', ...(pinned ? DIFF_FLAGS : []), 'HEAD']],
  ['add', () => ['add', '-A']],
  ['commit', () => ['commit', '-q', '-m', 'probe']],
  ['merge', () => ['merge', '-q', '--no-edit', 'side']],
  ['switch-new', () => ['switch', '-q', '-c', 'probe-branch']],
  ['switch-back', () => ['switch', '-q', 'main']],
  ['log', () => ['log', '-2']],
  ['push', (pinned, push) => ['push', '-q', push, 'HEAD:refs/heads/probe']],
]);

const HOOKS = ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'post-checkout', 'post-merge', 'pre-merge-commit', 'pre-push', 'reference-transaction', 'post-index-change', 'pre-auto-gc', 'post-rewrite'];

const cfg = (d, key, value) => fixtureGit(d.repo, ['config', '--file', join(d.repo, '.git', 'config'), key, value]);
const hooksIn = (folder, payload) => {
  mkdirSync(folder, { recursive: true });
  for (const h of HOOKS) put(folder, h, readFileSync(payload, 'utf8'), 0o755);
};
const attrs = (d, text) => put(d.repo, '.gitattributes', text);

// Each probe: plant(d, x) puts one hostile key in place; `hit(d, run)` says whether it fired
// (default: the payload left a mark); `expect: 'neutralised'` for the keys MIRAI pins.
export function gitProbes(x) {
  const fileUrl = (d) => `file://${join(d.dir, 'remote.git')}`;
  const http401 = () => `http://127.0.0.1:${x.authPort}/x.git`;
  return [
    { id: 'g15-hookspath', fact: 'G15', expect: 'neutralised', title: 'core.hooksPath to a folder of hooks in the work tree', plant: (d) => { hooksIn(join(d.repo, 'evilhooks'), d.payload); cfg(d, 'core.hooksPath', 'evilhooks'); } },
    { id: 'g15-hooks', fact: 'G15', expect: 'neutralised', title: 'plain .git/hooks/*', plant: (d) => hooksIn(join(d.repo, '.git', 'hooks'), d.payload) },
    { id: 'g15-fsmonitor', fact: 'G15', expect: 'neutralised', title: 'core.fsmonitor as a program', plant: (d) => cfg(d, 'core.fsmonitor', d.payload) },
    {
      id: 'g15-fsmonitor-worktree', fact: 'G15', expect: 'neutralised', title: 'core.fsmonitor in .git/config.worktree (extensions.worktreeConfig)',
      plant: (d) => { cfg(d, 'core.repositoryformatversion', '1'); cfg(d, 'extensions.worktreeConfig', 'true'); put(d.repo, '.git/config.worktree', `[core]\n\tfsmonitor = ${d.payload}\n`); },
    },
    { id: 'g23-filter', fact: 'G23', title: 'filter.<x>.clean/smudge with .gitattributes', plant: (d) => { cfg(d, 'filter.evil.clean', d.filter); cfg(d, 'filter.evil.smudge', d.filter); attrs(d, '*.txt filter=evil\n'); } },
    { id: 'g23-filter-process', fact: 'G23', title: 'filter.<x>.process with .gitattributes', plant: (d) => { cfg(d, 'filter.evil.process', d.payload); attrs(d, '*.txt filter=evil\n'); } },
    { id: 'g23-filter-info', fact: 'G23', title: 'a filter named in .git/info/attributes', plant: (d) => { cfg(d, 'filter.evil.clean', d.filter); cfg(d, 'filter.evil.smudge', d.filter); put(d.repo, '.git/info/attributes', '*.txt filter=evil\n'); } },
    { id: 'g23-diff-external', fact: 'G23', expect: 'neutralised', title: 'diff.external', plant: (d) => cfg(d, 'diff.external', d.payload) },
    { id: 'g23-textconv', fact: 'G23', title: 'diff.<x>.textconv with .gitattributes', plant: (d) => { cfg(d, 'diff.evil.textconv', d.payload); attrs(d, '*.txt diff=evil\n'); } },
    { id: 'g23-diff-command', fact: 'G23', title: 'diff.<x>.command with .gitattributes', plant: (d) => { cfg(d, 'diff.evil.command', d.payload); attrs(d, '*.txt diff=evil\n'); } },
    { id: 'g23-merge-driver', fact: 'G23', title: 'merge.<x>.driver with .gitattributes', plant: (d) => { cfg(d, 'merge.evil.driver', `${d.payload} %O %A %B`); attrs(d, 'a.txt merge=evil\n'); } },
    { id: 'g23-pager', fact: 'G23', title: 'core.pager (no terminal)', plant: (d) => cfg(d, 'core.pager', d.payload) },
    { id: 'g23-editor', fact: 'G23', title: 'core.editor and sequence.editor', plant: (d) => { cfg(d, 'core.editor', d.payload); cfg(d, 'sequence.editor', d.payload); } },
    { id: 'g23-sshcommand', fact: 'G23', expect: 'neutralised', title: 'core.sshCommand, pushing to an ssh:// URL (ssh allowed for this probe)', allowProto: ['ssh'], push: () => 'ssh://127.0.0.1:1/x.git', plant: (d) => cfg(d, 'core.sshCommand', d.payload) },
    { id: 'g23-credential', fact: 'G23', expect: 'neutralised', title: 'credential.helper, pushing to a server that asks for a login (http allowed for this probe)', allowProto: ['http'], push: http401, plant: (d) => cfg(d, 'credential.helper', `!${d.payload}`) },
    { id: 'g23-credential-url', fact: 'G23', title: 'credential.<url>.helper (URL-scoped)', allowProto: ['http'], push: http401, plant: (d) => cfg(d, `credential.http://127.0.0.1:${x.authPort}.helper`, `!${d.payload}`) },
    { id: 'g23-askpass', fact: 'G23', expect: 'neutralised', title: 'core.askPass, pushing to a server that asks for a login', allowProto: ['http'], push: http401, plant: (d) => cfg(d, 'core.askPass', d.payload) },
    { id: 'g23-gpg', fact: 'G23', expect: 'neutralised', title: 'gpg.program with commit.gpgSign', plant: (d) => { cfg(d, 'gpg.program', d.payload); cfg(d, 'commit.gpgSign', 'true'); } },
    {
      id: 'g23-include', fact: 'G23', title: 'include.path to a file in .git (a filter and fsmonitor in it)',
      plant: (d) => { put(d.repo, '.git/evil.cfg', `[filter "evil"]\n\tclean = ${d.filter}\n\tsmudge = ${d.filter}\n[core]\n\tfsmonitor = ${d.payload}\n`); cfg(d, 'include.path', 'evil.cfg'); attrs(d, '*.txt filter=evil\n'); },
    },
    {
      id: 'g23-includeif', fact: 'G23', title: 'includeIf.gitdir: to a file in .git (a filter in it)',
      plant: (d) => { put(d.repo, '.git/evil.cfg', `[filter "evil"]\n\tclean = ${d.filter}\n\tsmudge = ${d.filter}\n`); cfg(d, 'includeIf.gitdir:**/repo/.git.path', join(d.repo, '.git', 'evil.cfg')); attrs(d, '*.txt filter=evil\n'); },
    },
    { id: 'g23-ext', fact: 'G23', expect: 'neutralised', title: 'protocol.ext.allow=always and an ext:: push URL', push: (d) => `ext::${d.payload} %S`, plant: (d) => cfg(d, 'protocol.ext.allow', 'always') },
    {
      id: 'g23-receivepack', fact: 'G23', title: 'remote.<x>.receivepack: MIRAI pushes to an explicit URL, the control to the remote\'s name (the URL stops it, not a pin)',
      controlPush: () => 'origin', plant: (d) => { cfg(d, 'remote.origin.url', join(d.dir, 'remote.git')); cfg(d, 'remote.origin.receivepack', d.payload); },
    },
    {
      id: 'g23-receivepack-origin', fact: 'G23', title: 'remote.<x>.receivepack, both pushing to the remote\'s name',
      push: () => 'origin', plant: (d) => { cfg(d, 'remote.origin.url', join(d.dir, 'remote.git')); cfg(d, 'remote.origin.receivepack', d.payload); },
    },
    {
      id: 'g23-insteadof', fact: 'G23', title: 'url.<x>.insteadOf sends the push elsewhere',
      plant: (d) => cfg(d, `url.file://${join(d.dir, 'evil.git')}.insteadOf`, fileUrl(d)),
      hit: (d) => fixtureGit(join(d.dir, 'evil.git'), ['for-each-ref']) !== '',
    },
    {
      id: 'g23-http-proxy', fact: 'G23', expect: 'neutralised', title: 'http.proxy sends an http push through another server', allowProto: ['http'], push: http401,
      plant: (d) => cfg(d, 'http.proxy', `http://127.0.0.1:${x.server.port}`),
      before: () => x.server.reset(), hit: () => x.server.hits > 0,
    },
    {
      id: 'g23-gpg-ssh-verify', fact: 'G23', expect: 'neutralised', title: 'gpg.ssh.program run to verify an ssh-signed commit on merge and log (merge.verifySignatures, log.showSignature)',
      plant: (d) => {
        cfg(d, 'merge.verifySignatures', 'true');
        cfg(d, 'log.showSignature', 'true');
        cfg(d, 'gpg.ssh.program', d.payload);
        cfg(d, 'gpg.ssh.allowedSignersFile', '/dev/null');
        // The side branch's tip, re-made with an ssh signature block (its content doesn't matter:
        // the verifier is run to judge it).
        const body = fixtureGit(d.repo, ['cat-file', 'commit', 'side']);
        const sig = 'gpgsig -----BEGIN SSH SIGNATURE-----\n U1NIU0lHAAAAAQ==\n -----END SSH SIGNATURE-----';
        const signed = body.replace(/^(committer .*)$/m, `$1\n${sig}`);
        const sha = fixtureGit(d.repo, ['hash-object', '-t', 'commit', '-w', '--stdin'], { input: `${signed}\n` });
        fixtureGit(d.repo, ['update-ref', 'refs/heads/side', sha]);
      },
    },
    {
      id: 'g23-http-proxy-url', fact: 'G23', title: 'a URL-scoped http.<url>.proxy sends an http push through another server', allowProto: ['http'], push: http401,
      plant: (d) => cfg(d, `http.http://127.0.0.1:${x.authPort}.proxy`, `http://127.0.0.1:${x.server.port}`),
      before: () => x.server.reset(), hit: () => x.server.hits > 0,
    },
    {
      id: 'g23-gitfile', fact: 'G23', title: 'a .git file pointing at another repo (GIT_DIR=<top>/.git still follows it)',
      plant: (d) => {
        renameSync(join(d.repo, '.git'), join(d.dir, 'other.git'));
        put(d.repo, '.git', `gitdir: ${join(d.dir, 'other.git')}\n`);
      },
      hit: (d, run) => run(['rev-parse', '--absolute-git-dir']).stdout.trim() !== join(d.repo, '.git'),
    },
    {
      id: 'g23-commondir', fact: 'G23', title: '.git/commondir sends config, refs and objects to another folder (a filter in its config)',
      plant: (d) => {
        cpSync(join(d.repo, '.git'), join(d.dir, 'common.git'), { recursive: true });
        fixtureGit(d.dir, ['config', '--file', join(d.dir, 'common.git', 'config'), 'filter.evil.clean', d.filter]);
        put(d.repo, '.git/commondir', `${join(d.dir, 'common.git')}\n`);
        attrs(d, '*.txt filter=evil\n');
      },
    },
    {
      id: 'g23-nested-repo', fact: 'G23', title: 'a nested repo committed as a gitlink, with a filter in its own config and a stat-dirty file (diff.ignoreSubmodules stops status and diff; add -A still runs it)',
      plant: (d) => {
        const sub = join(d.repo, 'sub');
        mkdirSync(sub);
        fixtureGit(sub, ['init', '-q', '-b', 'main']);
        put(sub, 'n.txt', 'nested\n');
        put(sub, '.gitattributes', '*.txt filter=evil\n');
        fixtureGit(sub, ['add', '-A']);
        fixtureGit(sub, ['commit', '-q', '-m', 'nested']);
        fixtureGit(sub, ['config', 'filter.evil.clean', d.filter]);
        fixtureGit(d.repo, ['add', 'sub']);
        fixtureGit(d.repo, ['commit', '-q', '-m', 'gitlink']);
        // Stat-dirty, same content: git must hash it again, through the nested repo's filter.
        utimesSync(join(sub, 'n.txt'), new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
      },
    },
    {
      id: 'g23-hide-untracked', fact: 'G23', expect: 'neutralised', title: 'status.showUntrackedFiles=no hides a new file from status',
      plant: (d) => cfg(d, 'status.showUntrackedFiles', 'no'), hit: (d, run, steps) => !steps.status.includes('new.txt'),
    },
    {
      id: 'g23-diff-shape', fact: 'G23', expect: 'neutralised', title: 'color.ui=always and diff.noprefix change the diff MIRAI reads',
      plant: (d) => { cfg(d, 'color.ui', 'always'); cfg(d, 'diff.noprefix', 'true'); },
      hit: (d, run, steps) => steps.diff.includes('\x1b[') || !steps.diff.includes('--- a/'),
    },
    {
      id: 'g23-worktree', fact: 'G23', expect: 'neutralised', title: 'core.worktree to another folder (pinned: GIT_DIR and GIT_WORK_TREE named)',
      plant: (d) => cfg(d, 'core.worktree', join(d.dir, 'elsewhere')), hit: (d) => existsSync(join(d.dir, 'elsewhere', 'a.txt')),
    },
    {
      id: 'g23-alternates', fact: 'G23', title: 'objects/info/alternates to an outside object store',
      plant: (d) => {
        fixtureGit(d.dir, ['init', '-q', '--bare', 'alt.git']);
        d.altBlob = fixtureGit(join(d.dir, 'alt.git'), ['hash-object', '-w', '--stdin'], { input: 'alt-canary\n' });
        put(d.repo, '.git/objects/info/alternates', `${join(d.dir, 'alt.git', 'objects')}\n`);
      },
      hit: (d, run) => run(['cat-file', '-e', d.altBlob]).status === 0,
    },
    {
      id: 'g23-info-exclude', fact: 'G23', title: '.git/info/exclude hides a new file from MIRAI\'s file list',
      plant: (d) => put(d.repo, '.git/info/exclude', 'new.txt\n'), hit: (d, run, steps) => !steps['ls-files'].includes('new.txt'),
    },
    {
      id: 'g23-excludesfile', fact: 'G23', expect: 'neutralised', title: 'core.excludesFile in the repo config hides a new file',
      plant: (d) => { put(d.dir, 'ex', 'new.txt\n'); cfg(d, 'core.excludesFile', join(d.dir, 'ex')); }, hit: (d, run, steps) => !steps['ls-files'].includes('new.txt'),
    },
    {
      id: 'g23-nosystem', fact: 'G23', expect: 'neutralised', title: 'a system config (GIT_CONFIG_SYSTEM set) with fsmonitor: GIT_CONFIG_NOSYSTEM wins?',
      plant: (d) => put(d.dir, 'sys', `[core]\n\tfsmonitor = ${d.payload}\n`),
      controlEnv: (d) => ({ GIT_CONFIG_NOSYSTEM: undefined, GIT_CONFIG_SYSTEM: join(d.dir, 'sys') }), pinnedEnv: (d) => ({ GIT_CONFIG_SYSTEM: join(d.dir, 'sys') }),
    },
    {
      id: 'g23-global', fact: 'G23', expect: 'neutralised', title: 'a global config with fsmonitor (yours): replaced by MIRAI\'s',
      plant: (d) => put(d.dir, 'glob', `[core]\n\tfsmonitor = ${d.payload}\n`), controlEnv: (d) => ({ GIT_CONFIG_GLOBAL: join(d.dir, 'glob') }),
    },
  ].map((p) => ({ push: fileUrl, ...p }));
}

// What a git probe's work tree gets before MIRAI's commands run: a change to a tracked file (so
// add, diff and the merge have work) and a new file.
export function workChanges(d) {
  put(d.repo, 'a.txt', 'one\ntwo\nthree\nfour\nFIVE\n');
  put(d.repo, 'new.txt', 'new\n');
}

export const markText = (d) => (existsSync(d.marks) ? readFileSync(d.marks, 'utf8') : '');

// The paths a Docker probe mounts or names on the host, for the canaries-only guard.
export function hostPaths(compose, base) {
  const out = [];
  const abs = (p) => resolve(base, p);
  for (const s of Object.values(compose.services ?? {})) {
    for (const v of s.volumes ?? []) {
      if (typeof v === 'string') {
        const src = v.split(':')[0];
        if (src.startsWith('~')) out.push(src);
        else if (src.startsWith('/') || src.startsWith('.')) out.push(abs(src));
      } else if (v.type === 'bind') out.push(abs(v.source));
    }
    for (const f of s.env_file ?? []) out.push(abs(typeof f === 'string' ? f : f.path));
    for (const dev of s.devices ?? []) out.push(resolve(typeof dev === 'string' ? dev.split(':')[0] : String(dev?.source)));
  }
  for (const kind of ['configs', 'secrets']) for (const v of Object.values(compose[kind] ?? {})) if (v.file) out.push(abs(v.file));
  for (const v of Object.values(compose.volumes ?? {})) if (v?.driver_opts?.device) out.push(abs(v.driver_opts.device));
  for (const f of compose.include ?? []) {
    const path = typeof f === 'string' ? f : f?.path;
    for (const one of [path].flat()) if (typeof one === 'string' && !/^[a-z]+:\/\/|^git@/.test(one)) out.push(abs(one));
  }
  for (const s of Object.values(compose.services ?? {})) if (s.extends?.file) out.push(abs(s.extends.file));
  return out;
}

// Refuses a Docker probe that could touch anything real: every host path inside the fixture
// (or /dev/null), only local images, no Docker socket, and risky keys only in config probes.
export function guardDockerProbe(probe, ctx) {
  if (probe.kind === 'cli') {
    // A plain docker call: no host path, no image but the local one, no socket.
    const args = typeof probe.cli === 'function' ? probe.cli({ ...ctx, runId: 'guard' }) : probe.cli;
    for (const a of args) {
      if (/docker\.sock|^[/~]/.test(a) || (a.includes(':') && !a.startsWith('mirai.probe=') && !LOCAL_IMAGES.includes(a))) throw new Error(`${probe.id}: argument ${a} isn't allowed in a cli probe`);
    }
    return;
  }
  if (!probe.compose) return;
  const text = JSON.stringify(probe.compose);
  if (/docker\.sock/.test(text)) throw new Error(`${probe.id}: names the Docker socket`);
  for (const p of hostPaths(probe.compose, ctx.project)) {
    if (p !== '/dev/null' && !p.startsWith(`${ctx.root}/`)) throw new Error(`${probe.id}: names ${p}, outside the fixture`);
  }
  for (const s of Object.values(probe.compose.services ?? {})) {
    if (s.image !== undefined && !LOCAL_IMAGES.includes(s.image)) throw new Error(`${probe.id}: image ${s.image} isn't one of the local images`);
    if (s.image === undefined && !s.provider) throw new Error(`${probe.id}: a service without an image`);
  }
  if (probe.kind !== 'config' && probe.kind !== 'up-raw') {
    const keys = new Set();
    const walk = (v) => {
      if (v && typeof v === 'object') for (const [k, w] of Object.entries(v)) { keys.add(k); walk(w); }
    };
    walk(probe.compose);
    const bad = RISKY_KEYS.filter((k) => keys.has(k));
    if (bad.length) throw new Error(`${probe.id}: ${bad.join(', ')} only in a config probe`);
  }
  if (probe.kind === 'up-raw' && Object.values(probe.compose.services).some((s) => s.image)) throw new Error(`${probe.id}: up-raw is for provider services only`);
}

export function writeCompose(ctx, probe, runId) {
  const compose = JSON.parse(JSON.stringify(probe.compose));
  for (const s of Object.values(compose.services ?? {})) {
    if (!s.provider) s.labels = { ...(s.labels ?? {}), 'mirai.probe': runId };
  }
  const file = join(ctx.root, 'compose', `${probe.id}.json`);
  writeFileSync(file, `${JSON.stringify(compose, null, 2)}\n`);
  return file;
}
