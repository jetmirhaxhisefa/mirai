import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { checkPathForm } from './args.js';
import { miraiHome } from '../store/mirai-home.js';
import { repoState } from '../store/repo-state.js';
import { readToken } from '../sign/token.js';
import { verifyTrustRoot } from '../trust/snapshot.js';
import { redact, runTest } from '../tests/run.js';

// MIRAI's MCP server for headless agent runs (unit 14d; D-48, D-53): exactly two tools,
// run_tests(level, path?) and run_check(name), over stdio (newline-delimited JSON-RPC 2.0, no
// dependencies). Claude Code starts it from the launch's mcp.json, outside the sandbox; its code
// comes from the trust root. Unit 15's broker grows out of it.
//
// It takes nothing from its environment or Claude Code: everything comes from the launch's
// policy file (read-only in the launch's input/, its hash on the command line). On every call:
// the trust root is hashed again (it must be the launch's), D-54's .git hash is compared with the
// launch's before the call, again once the run's turn comes (before any git call on the
// checkout) and after, and 14c's executor runs with that trust root, as the agent's run
// (`by: "agent"`, never signed). A changed .git or trust root stops the server: every later call
// is refused.

export const POLICY_SCHEMA = 'mirai-mcp-policy/1';
export const PROTOCOL_VERSIONS = Object.freeze(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
export const MAX_MESSAGE_BYTES = 1024 * 1024;
export const INLINE_TAIL_BYTES = 32 * 1024;
export const PROGRESS_MS = 60_000;
const SERVER_INFO = Object.freeze({ name: 'mirai', version: '0.1.0' });

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export class PolicyError extends Error {}

// Reads and checks the policy file against the hash it was started with.
export function readPolicy(file, hash) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    throw new PolicyError('the policy file can\'t be read');
  }
  if (!/^[0-9a-f]{64}$/.test(hash ?? '') || sha256(bytes) !== hash) throw new PolicyError('the policy file doesn\'t match its hash');
  const p = JSON.parse(bytes.toString('utf8'));
  const abs = (v) => typeof v === 'string' && isAbsolute(v);
  if (p.schema !== POLICY_SCHEMA || !abs(p.checkout) || !abs(p.trust_dir) || !abs(p.home) || !/^[0-9a-f]{64}$/.test(p.manifest_sha256 ?? '')
    || !/^[0-9a-f]{64}$/.test(p.repo_state ?? '') || !Array.isArray(p.levels) || !Array.isArray(p.checks)) {
    throw new PolicyError('the policy file isn\'t one this server reads');
  }
  if (p.docker_socket !== undefined && p.docker_socket !== null && !abs(p.docker_socket)) throw new PolicyError('the policy\'s docker socket isn\'t an absolute path');
  return p;
}

// The tools, with the policy's names as enums.
export function toolList(policy) {
  const tools = [];
  if (policy.levels.length) {
    tools.push({
      name: 'run_tests',
      description: 'Run one of the project\'s test levels in its own containers (a copy of the project, no network out), optionally for one file or folder. Returns the outcome, exit code and the end of the output.',
      inputSchema: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: [...policy.levels], description: 'the test level' },
          path: { type: 'string', maxLength: 512, pattern: '^[A-Za-z0-9_][A-Za-z0-9_./@-]*$', description: 'optional: one file or folder, relative to the project\'s top' },
        },
        required: ['level'],
        additionalProperties: false,
      },
    });
  }
  if (policy.checks.length) {
    tools.push({
      name: 'run_check',
      description: 'Run one of the project\'s named checks (such as lint) in its own containers, on a copy of the project. Returns the outcome, exit code and the end of the output.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', enum: [...policy.checks], description: 'the check' } },
        required: ['name'],
        additionalProperties: false,
      },
    });
  }
  return tools;
}

const text = (value, isError = false) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError });

// The arguments of a call, checked against the policy: { name, path } or a refusal message.
export function callArgs(policy, tool, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return { refused: 'the arguments must be an object' };
  const allowed = tool === 'run_tests' ? ['level', 'path'] : tool === 'run_check' ? ['name'] : null;
  if (!allowed) return { refused: `there is no tool ${tool}` };
  const extra = Object.keys(args).filter((k) => !allowed.includes(k));
  if (extra.length) return { refused: `${tool} takes no ${extra.join(', ')}` };
  const name = tool === 'run_tests' ? args.level : args.name;
  const list = tool === 'run_tests' ? policy.levels : policy.checks;
  if (typeof name !== 'string' || !list.includes(name)) return { refused: `${JSON.stringify(name)} isn't a configured ${tool === 'run_tests' ? 'test level' : 'check'}; configured: ${list.join(', ') || 'none'}` };
  if (args.path === undefined) return { name, path: null };
  if (typeof args.path !== 'string') return { refused: 'path must be a string' };
  try {
    return { name, path: checkPathForm(args.path) };
  } catch (err) {
    return { refused: err.message };
  }
}

// What an agent sees of a result: no store paths (agents can't read the store anyway).
export function inlineResult(r) {
  const tailText = r.output?.tail ?? '';
  const cut = Buffer.byteLength(tailText) > INLINE_TAIL_BYTES;
  return {
    id: r.id,
    outcome: r.outcome,
    ...(r.code ? { code: r.code } : {}),
    ...(r.message ? { message: r.message } : {}),
    exit_code: r.exit_code ?? null,
    duration_s: Math.round((r.duration_ms ?? 0) / 1000),
    [r.kind === 'check' ? 'check' : 'level']: r.name,
    path: r.path ?? null,
    output_tail: cut ? Buffer.from(tailText).subarray(-INLINE_TAIL_BYTES).toString('utf8') : tailText,
    output_truncated: cut || Boolean(r.output?.truncated),
    out_files: r.out_files ?? [],
    isolated_binds: r.isolated_binds ?? [],
    tree_hash: r.tree?.hash ?? null,
  };
}

// The server, without its transport: `handle(message)` for each parsed message; `send(msg)`
// writes one. `deps.runTest` and `deps.repoState` are for tests.
export function createServer({ policy, send, deps = {} }) {
  const run = deps.runTest ?? runTest;
  const state = deps.repoState ?? ((top) => repoState(top).hash);
  const env = Object.freeze({ HOME: policy.home });
  let stopped = null;
  let current = null; // { id, controller }

  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  // Error text an agent sees: the token redacted, and no paths into the MIRAI home (the store and
  // the trust root).
  const hidden = [[policy.trust_dir, '<trust root>'], [miraiHome(env), '<mirai home>']];
  const clean = (s) => {
    let out = String(s);
    for (const [path, name] of hidden) out = out.split(path).join(name);
    try {
      return redact(out, { token: readToken(env), secrets: [] });
    } catch {
      return out;
    }
  };
  const stop = (why) => {
    stopped ??= why;
    return text({ outcome: 'refused', code: 'repo-changed', message: why }, true);
  };
  // D-54's check: false when .git isn't as it was at the launch (or can't be read).
  const sameRepo = () => {
    try {
      return state(policy.checkout) === policy.repo_state;
    } catch {
      return false;
    }
  };

  async function call(id, params) {
    const tool = params?.name;
    if (tool !== 'run_tests' && tool !== 'run_check') return fail(id, -32602, `unknown tool ${String(tool).slice(0, 64)}`);
    if (stopped) return reply(id, text({ outcome: 'refused', code: 'stopped', message: `this server stopped: ${stopped}` }, true));
    if (current) return reply(id, text({ outcome: 'refused', code: 'busy', message: 'a test run of this session is still going; wait for its result' }, true));
    const args = callArgs(policy, tool, params.arguments ?? {});
    if (args.refused) return reply(id, text({ outcome: 'refused', code: 'bad-arguments', message: args.refused }, true));
    const controller = new AbortController();
    current = { id, controller };
    const token = params?._meta?.progressToken;
    const begun = Date.now();
    let note = `running ${args.name}`;
    const progress = token === undefined ? null : setInterval(() => {
      const minutes = Math.round((Date.now() - begun) / 60_000);
      send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: minutes, message: `${note}, ${minutes} min` } });
    }, deps.progressMs ?? PROGRESS_MS);
    controller.signal.addEventListener('abort', () => progress && clearInterval(progress), { once: true });
    let started = false;
    try {
      let trust;
      try {
        trust = verifyTrustRoot({ dir: policy.trust_dir, manifestSha256: policy.manifest_sha256 });
      } catch (err) {
        if (err.code === 'trust-tampered') {
          stopped = 'the trust root changed since the launch';
          return reply(id, text({ outcome: 'refused', code: 'trust-tampered', message: stopped }, true));
        }
        throw err;
      }
      if (!sameRepo()) return reply(id, stop('the repo\'s .git changed since the launch'));
      started = true;
      let r;
      try {
        r = await run({
          cwd: policy.checkout, env, name: args.name, path: args.path, trust, by: 'agent', signal: controller.signal, launchId: policy.launch_id ?? null,
          onWait: () => (note = `waiting for another test run, then ${args.name}`),
          // The run's turn: .git is checked again before the executor's first git call.
          onTurn: () => {
            note = `running ${args.name}`;
            if (!sameRepo()) {
              stopped ??= 'the repo\'s .git changed while the run waited';
              throw Object.assign(new Error(stopped), { code: 'repo-changed' });
            }
          },
          ...(policy.docker_socket ? { docker: { socket: policy.docker_socket } } : {}),
        });
      } catch (err) {
        if (!err.result) throw err;
        r = err.result;
      }
      if (!sameRepo()) return reply(id, stop('the repo\'s .git changed during a test run'));
      started = false;
      const out = inlineResult(r);
      return reply(id, text({ ...out, ...(out.message ? { message: clean(out.message) } : {}) }, !['pass', 'fail'].includes(r.outcome)));
    } catch (err) {
      if (err.code === 'repo-changed') return reply(id, stop(err.message));
      // The after check holds for every way a run ends.
      if (started && !sameRepo()) return reply(id, stop('the repo\'s .git changed during a test run'));
      const outcome = err.code === 'unknown-test' || err.code === 'bad-path' ? 'refused' : 'env-fault';
      return reply(id, text({ outcome, code: err.code ?? 'error', message: clean(err.message), ...(err.hint ? { hint: clean(err.hint) } : {}) }, true));
    } finally {
      if (progress) clearInterval(progress);
      current = null;
    }
  }

  function handle(msg) {
    if (msg === null || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      if (msg?.id !== undefined && msg?.method === undefined) return null; // a response to us: none expected
      return fail(msg?.id ?? null, -32600, 'invalid request');
    }
    const { id, method, params } = msg;
    if (method === 'notifications/cancelled') {
      if (current && params?.requestId === current.id) current.controller.abort();
      return null;
    }
    if (id === undefined) return null; // other notifications (initialized, …)
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion;
        return reply(id, { protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO });
      }
      case 'ping': return reply(id, {});
      case 'tools/list': return reply(id, { tools: toolList(policy) });
      case 'tools/call': return call(id, params);
      default: return fail(id, -32601, 'method not found');
    }
  }

  // Ends the run under way (stdin closed, a signal): its Docker call is killed, cleanup runs.
  function close() {
    current?.controller.abort();
    return current;
  }

  return { handle, close, get busy() {
    return current !== null;
  } };
}

// Serves on stdin/stdout. A message that isn't JSON, or a line over MAX_MESSAGE_BYTES (counted
// as it arrives, so nothing unbounded is buffered), ends the connection. When stdin closes, a run
// under way is cancelled and cleaned up before exit.
export function serveStdio({ policy, input = process.stdin, output = process.stdout, deps, exit = (code) => process.exit(code) }) {
  const pending = new Set();
  let ending = false;
  let gone = false;
  // Once Claude Code is gone (its end of the pipe closed), nothing more is written: a write would
  // fail with EPIPE, and an unhandled one would kill the server in the middle of cleaning up.
  output.on('error', () => (gone = true));
  const send = (msg) => {
    if (gone || ending || output.destroyed || output.writableEnded) return;
    output.write(`${JSON.stringify(msg)}\n`);
  };
  const server = createServer({ policy, send, deps });
  let buffered = [];
  let size = 0;
  const end = async (code) => {
    if (ending) return;
    ending = true;
    input.pause();
    server.close();
    await Promise.allSettled([...pending]);
    exit(code);
  };
  const line = (bytes) => {
    const textLine = bytes.toString('utf8').trim();
    if (textLine === '') return;
    let msg;
    try {
      msg = JSON.parse(textLine);
    } catch {
      end(1);
      return;
    }
    const p = Promise.resolve(server.handle(msg));
    pending.add(p);
    p.finally(() => pending.delete(p));
  };
  input.on('data', (chunk) => {
    let rest = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    while (!ending) {
      const nl = rest.indexOf(10);
      const part = nl < 0 ? rest : rest.subarray(0, nl);
      size += part.length;
      if (size > MAX_MESSAGE_BYTES) {
        end(1);
        return;
      }
      buffered.push(part);
      if (nl < 0) return;
      const whole = Buffer.concat(buffered);
      buffered = [];
      size = 0;
      line(whole);
      rest = rest.subarray(nl + 1);
    }
  });
  input.on('end', () => end(0));
  input.on('close', () => end(0));
  return { server, end };
}
