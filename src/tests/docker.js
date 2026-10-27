import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { atomicWrite, ensurePrivateDir } from '../store/files.js';
import { miraiHome } from '../store/mirai-home.js';

// How MIRAI calls Docker (unit 14c; research/11, "How MIRAI calls Docker"): Docker Desktop's
// own client by absolute path, never the `docker` on your PATH; an environment of four
// variables; MIRAI's own config folder, so nothing of your ~/.docker/config.json (credential
// helpers, proxies, contexts) is read.

const DESKTOP = '/Applications/Docker.app/Contents/Resources';
export const DOCKER = Object.freeze({ client: join(DESKTOP, 'bin', 'docker'), plugins: join(DESKTOP, 'cli-plugins') });

export class TestRunError extends MiraiError {
  constructor(message, { code, hint, exitCode = EXIT.BLOCKED } = {}) {
    super(message, exitCode);
    this.name = 'TestRunError';
    this.code = code;
    this.hint = hint;
  }
}

// `<mirai-home>/docker/`: config/config.json (only cliPluginsExtraDirs) and an empty home/.
export function dockerSetup(env, { client = DOCKER.client, plugins = DOCKER.plugins, socket: givenSocket = null } = {}) {
  if (!existsSync(client)) throw new TestRunError(`Docker Desktop's client isn't at ${client}`, { code: 'no-docker', hint: 'install Docker Desktop; MIRAI never uses the docker on your PATH' });
  const home = miraiHome(env);
  const dir = join(home, 'docker');
  ensurePrivateDir(home);
  ensurePrivateDir(dir);
  ensurePrivateDir(join(dir, 'config'));
  ensurePrivateDir(join(dir, 'home'));
  const config = `${JSON.stringify({ cliPluginsExtraDirs: [plugins] }, null, 2)}\n`;
  const file = join(dir, 'config', 'config.json');
  if (!existsSync(file) || readFileSync(file, 'utf8') !== config) atomicWrite(file, config);
  // Docker Desktop's socket in your home (the probes pass it in, since they run with a temporary HOME).
  const socket = givenSocket ?? join(env.HOME, '.docker', 'run', 'docker.sock');
  return {
    client,
    socket,
    env: Object.freeze({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: join(dir, 'home'), DOCKER_CONFIG: join(dir, 'config'), DOCKER_HOST: `unix://${socket}` }),
  };
}

// Whether Docker Desktop answers; a clear error when it doesn't.
export function checkDockerRunning(setup, call = dockerCall) {
  let isSocket = false;
  try {
    isSocket = lstatSync(setup.socket).isSocket() || lstatSync(setup.socket).isSymbolicLink();
  } catch {
    isSocket = false;
  }
  const r = isSocket ? call(setup, ['version', '--format', '{{.Server.Version}}'], { timeout: 20_000 }) : null;
  if (!r || r.status !== 0 || !r.stdout.trim()) {
    throw new TestRunError('Docker Desktop isn\'t running', { code: 'docker-down', exitCode: EXIT.NEEDS_HUMAN, hint: 'start Docker Desktop, then run this again' });
  }
  return r.stdout.trim();
}

// One Docker call: no shell, the setup's environment only, output captured with a limit.
export function dockerCall(setup, args, { cwd = '/', timeout = 120_000, maxBuffer = 16 * 1024 * 1024, input } = {}) {
  const r = spawnSync(setup.client, args, { cwd, env: setup.env, encoding: 'utf8', timeout, maxBuffer, input, killSignal: 'SIGKILL' });
  return {
    status: r.status,
    signal: r.signal,
    timedOut: r.error?.code === 'ETIMEDOUT',
    stdout: r.stdout ?? '',
    stderr: `${r.stderr ?? ''}${r.error && r.error.code !== 'ETIMEDOUT' ? ` ${r.error.message}` : ''}`,
  };
}
