import { after } from 'node:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { init } from '../../src/install/init.js';

// The test executor's fixtures (units 14c, 16a), shared by test-run.test.js and
// test-adapters-run.test.js: temporary folders removed after the file's tests, a repo with MIRAI
// installed and compose inputs on main, and a fake docker that records every call.

const temps = [];
after(() => {
  for (const d of temps) {
    execFileSync('/bin/chmod', ['-R', 'u+rwX', d]);
    rmSync(d, { recursive: true, force: true });
  }
});
export const tempDir = (name) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `mirai-14c-${name}-`)));
  temps.push(d);
  return d;
};
export const gitIn = (cwd, home) => (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], {
  cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
}).toString().trim();

export const COMPOSE = 'services:\n  app:\n    image: nginx:1.27-alpine\n    ports:\n      - "127.0.0.1:8080:80"\n    volumes:\n      - ./:/w\n';
export const CONFIG = '\n[compose]\nfiles = ["compose.yml"]\nenv_file = ".env.test"\n\n[[testing.levels]]\nname = "unit"\ncommand = ["run-tests"]\nservice = "app"\n\n[checks]\nlint = { command = ["lint-it"], service = "app", workdir = "/w", run = "oneoff" }\nbare = ["no-service"]\n';

// A repo with MIRAI installed and the compose inputs committed on main.
export function installed({ compose = COMPOSE, config = CONFIG, files = {} } = {}) {
  const root = join(tempDir('repo'), 'r');
  mkdirSync(root);
  const home = tempDir('home');
  const git = gitIn(root, home);
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), '# r\n');
  writeFileSync(join(root, '.gitignore'), '.env\nbuild/\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  const env = { PATH: '/usr/bin:/bin', HOME: home };
  init({ cwd: root, env, branch: 'main' });
  const cfg = join(root, '.mirai', 'config.toml');
  chmodSync(cfg, 0o644);
  writeFileSync(cfg, `${readFileSync(cfg, 'utf8')}${config}`);
  writeFileSync(join(root, 'compose.yml'), compose);
  writeFileSync(join(root, '.env.test'), 'MODE=test\n');
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  git('add', '-A');
  git('commit', '-qm', 'compose');
  return { root, home, env, git };
}

// A fake docker: records each call (arguments, environment), answers the few calls a run makes.
// `resolved` is what `compose config` prints, with @PROJECT@ and @COPY@ filled in from the call.
// `report` (unit 16a): what the test command leaves in the output folder as junit.xml: its text,
// or { link } for a link to that path. `coverage` (unit 16b): { name, text } left in the output
// folder's coverage/ (name may climb out through a link, for the tests that check that).
export function fakeDocker({ resolved, execOut = 'ran\n', execCode = 0, execSleep = 0, ps = '', inspect = '[]', missingImage = null, upCode = 0, execPs = '', upPs = '', report = null, coverage = null } = {}) {
  const d = tempDir('docker');
  const socket = join(d, 'docker.sock');
  symlinkSync('/dev/null', socket);
  writeFileSync(join(d, 'resolved.json'), JSON.stringify(resolved ?? {}));
  writeFileSync(join(d, 'exec.out'), execOut);
  writeFileSync(join(d, 'inspect.json'), inspect);
  writeFileSync(join(d, 'ps.out'), ps);
  const leave = report === null ? ':' : typeof report === 'string'
    ? '/bin/cp "$d/report.xml" "$(/usr/bin/dirname "$(/bin/cat "$d/copy.path")")/out/junit.xml"'
    : `/bin/ln -s '${report.link}' "$(/usr/bin/dirname "$(/bin/cat "$d/copy.path")")/out/junit.xml"`;
  if (typeof report === 'string') writeFileSync(join(d, 'report.xml'), report);
  const out = '"$(/usr/bin/dirname "$(/bin/cat "$d/copy.path")")/out"';
  let leaveCoverage = ':';
  if (coverage) {
    writeFileSync(join(d, 'coverage.data'), coverage.text ?? '');
    leaveCoverage = coverage.swapDir
      ? `/bin/rm -rf ${out}/coverage; /bin/ln -s '${coverage.swapDir}' ${out}/coverage`
      : `/bin/mkdir -p ${out}/coverage; /bin/cp "$d/coverage.data" ${out}/coverage/'${coverage.name}'`;
  }
  const client = join(d, 'docker');
  writeFileSync(client, `#!/bin/sh
d='${d}'
n=$(/bin/ls "$d" | /usr/bin/grep -c '^call\\.[0-9]*$')
f="$d/call.$(printf %04d "$n")"
/usr/bin/env > "$f.env"
printf '%s\\n' "$@" > "$f.tmp" && /bin/mv "$f.tmp" "$f"
p=''; c=''; prev=''
for a in "$@"; do
  [ "$prev" = "-p" ] && p="$a"
  [ "$prev" = "--project-directory" ] && c="$a"
  prev="$a"
done
[ -n "$c" ] && printf '%s' "$c" > "$d/copy.path"
case " $* " in
  *" version "*) echo 29.6.2 ;;
  *" config --format json "*) /usr/bin/sed -e "s|@PROJECT@|$p|g" -e "s|@COPY@|$c|g" "$d/resolved.json" ;;
  *" image inspect "*) case " $* " in *" ${missingImage ?? '@none@'} "*) exit 1 ;; *) echo sha256:0123 ;; esac ;;
  *" exec "*) printf '%s' '${execPs}' > "$d/ps.out"; ${leave}; ${leaveCoverage}; /bin/cat "$d/exec.out"; echo "to-stderr" >&2; /bin/sleep ${execSleep}; exit ${execCode} ;;
  *" run -d "*) ${leave}; ${leaveCoverage}; echo oneoff1 ;;
  " wait "*) /bin/sleep ${execSleep}; echo ${execCode} ;;
  " logs oneoff1 ") /bin/cat "$d/exec.out"; echo "to-stderr" >&2 ;;
  *" up -d "*) printf '%s' '${upPs}' > "$d/ps.out"; [ ${upCode} -ne 0 ] && echo "container x-app-1 exited (1)" >&2; exit ${upCode} ;;
  *" status=exited "*) echo "c7 app" ;;
  *" logs --tail "*) echo "app says: backend/.env is missing ghp_${'a1B2'.repeat(9)}" ;;
  *" ps -aq "*) /bin/cat "$d/ps.out" ;;
  *" rm -f -v "*) : > "$d/ps.out" ;;
  *" network inspect "*) echo '[]' ;;
  *" inspect "*) cp=$(/bin/cat "$d/copy.path"); /usr/bin/sed -e "s|@COPY@|$cp|g" -e "s|@OUT@|$(/usr/bin/dirname "$cp")/out|g" "$d/inspect.json" ;;
esac
exit 0
`, { mode: 0o755 });
  const calls = () => readdirSync(d).filter((n) => /^call\.\d+$/.test(n)).sort().map((n) => ({
    args: readFileSync(join(d, n), 'utf8').split('\n').slice(0, -1),
    env: Object.fromEntries(readFileSync(join(d, `${n}.env`), 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])),
  }));
  return { docker: { client, plugins: '/nonexistent/plugins', socket }, calls };
}

// What `compose config --format json` gives for COMPOSE (shape as Compose 5.3.1 prints it).
export const resolvedApp = (extra = {}, top = {}) => ({
  name: '@PROJECT@',
  services: {
    app: {
      command: null, entrypoint: null, image: 'nginx:1.27-alpine', networks: { default: null },
      ports: [{ mode: 'ingress', host_ip: '127.0.0.1', target: 80, published: '8080', protocol: 'tcp' }],
      volumes: [{ type: 'bind', source: '@COPY@', target: '/w', bind: {} }],
      ...extra,
    },
  },
  networks: { default: { name: '@PROJECT@_default', ipam: {} } },
  ...top,
});
