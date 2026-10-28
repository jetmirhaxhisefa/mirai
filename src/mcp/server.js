import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { checkArgs, toolList, toolNamed, TOOLS } from './tools.js';
import { inlineResult, INLINE_TAIL_BYTES } from './tools/tests.js';
import { LOG_TYPES } from '../store/journal.js';
import { miraiHome } from '../store/mirai-home.js';
import { repoState } from '../store/repo-state.js';
import { readToken } from '../sign/token.js';
import { verifyTrustRoot } from '../trust/snapshot.js';
import { redact } from '../tests/run.js';

// MIRAI's MCP server (unit 14d; unit 15a's broker core; D-48, D-53), over stdio
// (newline-delimited JSON-RPC 2.0, no dependencies). Claude Code starts it from the launch's
// mcp.json, outside the sandbox; its code comes from the trust root. The tools are data
// (src/mcp/tools.js): this file is the protocol and what holds for every tool.
//
// It takes nothing from its environment or Claude Code: everything comes from the launch's
// policy file (read-only in the launch's input/, its hash on the command line). On every call
// the trust root is hashed again (it must be the launch's). A changed trust root, or a changed
// .git under a test tool (D-54), stops the server: every later call is refused.

export const POLICY_SCHEMA = 'mirai-mcp-policy/2';
export const PROTOCOL_VERSIONS = Object.freeze(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
export const MAX_MESSAGE_BYTES = 1024 * 1024;
export const PROGRESS_MS = 60_000;
const SERVER_INFO = Object.freeze({ name: 'mirai', version: '0.1.0' });
const HEX64 = /^[0-9a-f]{64}$/;
const LAUNCH_ID = /^[0-9]{14}-[0-9a-f]{8}$/;
const ITEM = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const REPO_ID = /^[a-z0-9][a-z0-9-]{0,40}-[0-9a-f]{12}$/;

export { inlineResult, INLINE_TAIL_BYTES, toolList, TOOLS };

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export class PolicyError extends Error {}

const names = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x !== '');
const count = (v, max) => Number.isInteger(v) && v >= 1 && v <= max;

// Reads and checks the policy file against the hash it was started with.
export function readPolicy(file, hash) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    throw new PolicyError('the policy file can\'t be read');
  }
  if (!HEX64.test(hash ?? '') || sha256(bytes) !== hash) throw new PolicyError('the policy file doesn\'t match its hash');
  return checkPolicy(JSON.parse(bytes.toString('utf8')));
}

// The policy's shape: { schema, kind, checkout, trust_dir, manifest_sha256, home, repo_state,
// launch_id, launch_dir, item (null or the launch's ticket or document), docker_socket?,
// store? ({ dir, repo_id }, with log_event), tools: { run_tests?: { levels }, run_check?:
// { checks }, log_event?: { types, max_events, max_message, secrets } } }. `kind` is the server's
// context: a tool is offered only in the contexts its entry names (D-53: headless runs never get
// start_agent, by the table, not only by whoever writes the policy).
export const KINDS = Object.freeze(['headless']);
export function checkPolicy(p) {
  const abs = (v) => typeof v === 'string' && isAbsolute(v);
  if (p?.schema === 'mirai-mcp-policy/1') throw new PolicyError('the policy is from an older MIRAI (mirai-mcp-policy/1); start the launch again');
  if (p?.schema !== POLICY_SCHEMA || !KINDS.includes(p.kind) || !abs(p.checkout) || !abs(p.trust_dir) || !abs(p.home) || !abs(p.launch_dir) || !HEX64.test(p.manifest_sha256 ?? '')
    || !HEX64.test(p.repo_state ?? '') || !LAUNCH_ID.test(p.launch_id ?? '') || !(p.item === null || ITEM.test(p.item ?? ''))
    || p.tools === null || typeof p.tools !== 'object' || Array.isArray(p.tools)) {
    throw new PolicyError('the policy file isn\'t one this server reads');
  }
  if (p.docker_socket !== undefined && p.docker_socket !== null && !abs(p.docker_socket)) throw new PolicyError('the policy\'s docker socket isn\'t an absolute path');
  const known = TOOLS.map((t) => t.name);
  const unknown = Object.keys(p.tools).filter((k) => !known.includes(k));
  if (unknown.length) throw new PolicyError(`the policy names tools this server doesn't have (${unknown.join(', ')})`);
  const outside = TOOLS.filter((t) => Object.hasOwn(p.tools, t.name) && !t.contexts.includes(p.kind)).map((t) => t.name);
  if (outside.length) throw new PolicyError(`the policy offers tools a ${p.kind} server never has (${outside.join(', ')})`);
  const { run_tests: rt, run_check: rc, log_event: le } = p.tools;
  if (rt !== undefined && !names(rt?.levels)) throw new PolicyError('the policy\'s run_tests needs its levels');
  if (rc !== undefined && !names(rc?.checks)) throw new PolicyError('the policy\'s run_check needs its checks');
  if (le !== undefined) {
    if (!names(le?.types) || le.types.some((t) => !LOG_TYPES.includes(t)) || !count(le.max_events, 1000) || !count(le.max_message, 4096)) {
      throw new PolicyError('the policy\'s log_event needs types agents may log and its caps');
    }
    const regex = (r) => {
      try {
        return typeof r === 'string' && Boolean(new RegExp(r, 'u'));
      } catch {
        return false;
      }
    };
    if (!Array.isArray(le.secrets) || !le.secrets.every((x) => typeof x?.name === 'string' && regex(x.regex))) throw new PolicyError('the policy\'s log_event needs the secret shapes');
    if (!abs(p.store?.dir) || !REPO_ID.test(p.store?.repo_id ?? '')) throw new PolicyError('the policy\'s log_event needs the store');
  }
  return p;
}

const text = (value, isError = false) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError });

// The arguments of a call, checked against the policy: the tool's checked arguments, or
// `{ refused }`.
export function callArgs(policy, name, args) {
  const tool = toolNamed(policy, name);
  if (!tool) return { refused: `there is no tool ${name}` };
  const r = checkArgs(policy, tool, args);
  return r.refused ? r : r.args;
}

// The server, without its transport: `handle(message)` for each parsed message; `send(msg)`
// writes one. `deps.runTest` and `deps.repoState` are for tests.
export function createServer({ policy, send, deps = {} }) {
  const state = deps.repoState ?? ((top) => repoState(top).hash);
  const env = Object.freeze({ HOME: policy.home });
  let stopped = null;
  let current = null; // the exclusive call under way: { id, controller }

  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  // Error text an agent sees: the token redacted, and no paths into the MIRAI home (the store and
  // the trust root).
  const hidden = [[policy.trust_dir, '<trust root>'], [policy.store?.dir, '<store>'], [policy.launch_dir, '<launch>'], [miraiHome(env), '<mirai home>']].filter(([p]) => p);
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
    return { body: { outcome: 'refused', code: 'repo-changed', message: why }, isError: true };
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
    const tool = toolNamed(policy, params?.name);
    if (!tool) return fail(id, -32602, `unknown tool ${String(params?.name).slice(0, 64)}`);
    if (stopped) return reply(id, text({ outcome: 'refused', code: 'stopped', message: `this server stopped: ${stopped}` }, true));
    if (tool.exclusive && current) return reply(id, text({ outcome: 'refused', code: 'busy', message: 'a test run of this session is still going; wait for its result' }, true));
    const checked = checkArgs(policy, tool, params.arguments ?? {});
    if (checked.refused) return reply(id, text({ outcome: 'refused', code: 'bad-arguments', message: checked.refused }, true));
    const controller = tool.exclusive ? new AbortController() : null;
    if (controller) current = { id, controller };
    const token = params?._meta?.progressToken;
    const begun = Date.now();
    let note = `running ${checked.args.name ?? tool.name}`;
    const progress = !controller || token === undefined ? null : setInterval(() => {
      const minutes = Math.round((Date.now() - begun) / 60_000);
      send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: minutes, message: `${note}, ${minutes} min` } });
    }, deps.progressMs ?? PROGRESS_MS);
    controller?.signal.addEventListener('abort', () => progress && clearInterval(progress), { once: true });
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
      const ctx = {
        policy, env, trust, deps, clean, sameRepo, stop, signal: controller?.signal ?? null,
        note: (n) => (note = n),
        token: () => readToken(env),
      };
      const out = await tool.run(checked.args, ctx);
      return reply(id, text(out.body, out.isError));
    } catch (err) {
      return reply(id, text({ outcome: 'env-fault', code: err.code ?? 'error', message: clean(err.message) }, true));
    } finally {
      if (progress) clearInterval(progress);
      if (controller) current = null;
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
