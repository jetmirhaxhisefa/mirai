import { spawn } from 'node:child_process';
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
export async function checkDockerRunning(setup, call = dockerCall) {
  let isSocket = false;
  try {
    isSocket = lstatSync(setup.socket).isSocket() || lstatSync(setup.socket).isSymbolicLink();
  } catch {
    isSocket = false;
  }
  const r = isSocket ? await call(setup, ['version', '--format', '{{.Server.Version}}'], { timeout: 20_000 }) : null;
  if (!r || r.status !== 0 || !r.stdout.trim()) {
    throw new TestRunError('Docker Desktop isn\'t running', { code: 'docker-down', exitCode: EXIT.NEEDS_HUMAN, hint: 'start Docker Desktop, then run this again' });
  }
  return r.stdout.trim();
}

// One Docker call: no shell, the setup's environment only, output captured with a limit. Async
// (unit 14d), so an MCP server keeps answering while it runs. The client runs in its own process
// group, and the whole group is killed (SIGKILL) at `timeout`, when its output passes
// `maxBuffer`, or when `signal` aborts: `docker compose` runs as a child of the client, and a
// killed client alone leaves it running with the output pipes open (found by 14d's T8). Resolves
// { status, signal, timedOut, aborted, stdout, stderr }.
export function dockerCall(setup, args, { cwd = '/', timeout = 120_000, maxBuffer = 16 * 1024 * 1024, input, signal } = {}) {
  return new Promise((done) => {
    const out = { stdout: [], stderr: [], size: 0 };
    let timedOut = false;
    let aborted = false;
    let overflow = false;
    let spawnError = null;
    let finished = false;
    let grace = null;
    const child = spawn(setup.client, args, { cwd, env: setup.env, detached: true, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    const finish = (status, sig) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(grace);
      signal?.removeEventListener('abort', onAbort);
      const note = spawnError ? ` ${spawnError.message}` : overflow ? ' (output over the limit)' : '';
      done({
        status: spawnError ? null : status,
        signal: sig,
        timedOut,
        aborted,
        stdout: Buffer.concat(out.stdout).toString('utf8'),
        stderr: `${Buffer.concat(out.stderr).toString('utf8')}${note}`,
      });
    };
    const kill = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // gone
        }
      }
      // Whatever still holds the pipes, the call ends shortly after the kill.
      grace ??= setTimeout(() => finish(null, 'SIGKILL'), 2000);
    };
    const collect = (which) => (chunk) => {
      out.size += chunk.length;
      if (out.size > maxBuffer) {
        overflow = true;
        kill();
        return;
      }
      out[which].push(chunk);
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    if (input !== undefined) child.stdin.end(input);
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeout);
    function onAbort() {
      aborted = true;
      kill();
    }
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (err) => {
      spawnError = err;
      finish(null, null);
    });
    child.on('close', (status, sig) => finish(status, sig));
  });
}
