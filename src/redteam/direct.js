import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { finishLaunch, prepareLaunch } from '../launch/strict.js';
import { readJournal } from '../store/journal.js';

// The red team's direct cases (unit 18b): MIRAI's own components driven with no model. The model
// adds nothing to whether MIRAI's MCP server refuses a forged argument or its hook refuses a path,
// only runs and "inconclusive" results; each component keeps at least one model case too. Every
// component here is the real one from the clone's trust root, started the way a launch starts it.

const PROTOCOL = '2025-11-25';

// A launch prepared for `template` on a worker (with `inputs`, as for a model run), removed by `done()`. The launch folder holds the
// MCP config and policy, and the hook policy, exactly as for a model run.
export function prepared(ctx, template, env, inputs = {}) {
  const plan = prepareLaunch({ trust: ctx.trust, template, checkout: ctx.project, env, miraiHomeDir: ctx.miraiHome, probe: { home: env.HOME }, inputs });
  return { plan, done: () => finishLaunch(plan) };
}

// Talks to the launch's MCP server over stdio, as Claude Code would: the command and arguments
// from the launch's own mcp.json, with `env` as the environment Claude Code would give it (the
// server's own `env -i` must clear it). `calls`: [{ name, arguments }]. Returns { replies, stderr,
// exit }. `restart`: a second server for the same launch after these calls (the event count
// must carry over).
export async function callServer(plan, calls, { env = {}, timeoutMs = 20_000 } = {}) {
  const mcp = JSON.parse(readFileSync(join(plan.launchDir, 'input', 'mcp.json'), 'utf8')).mcpServers.mirai;
  const child = spawn(mcp.command, mcp.args, { env: { ...env, ...(mcp.env ?? {}) }, cwd: plan.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let stderr = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (stderr += d));
  const replies = () => out.split('\n').filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
  const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {} } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  calls.forEach((c, i) => send({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name: c.name, arguments: c.arguments } }));
  const deadline = Date.now() + timeoutMs;
  while (replies().filter((m) => m.id >= 1).length < calls.length && Date.now() < deadline && child.exitCode === null) await new Promise((done) => setTimeout(done, 25));
  child.stdin.end();
  const exit = await new Promise((done) => {
    if (child.exitCode !== null) done(child.exitCode);
    else child.on('close', (code) => done(code));
    setTimeout(() => child.kill('SIGKILL'), 5000).unref();
  });
  const byId = Object.fromEntries(replies().map((m) => [m.id, m]));
  return {
    replies: calls.map((c, i) => {
      const m = byId[i + 1];
      if (!m) return { missing: true };
      const text = m.result?.content?.[0]?.text ?? '';
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { error: m.error ?? null, isError: m.result?.isError === true, body, text };
    }),
    stderr,
    exit,
  };
}

// The store a launch's MCP server writes to, from the launch's own policy ({ dir, repo_id }, or
// null with no log_event); read while the launch folder is there.
export function launchStore(plan) {
  const p = join(plan.launchDir, 'input', 'mcp-policy.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).store ?? null : null;
}

// The journal lines a launch wrote (its launch id). A store with no journal yet has none; any other
// error is thrown, so a wrong lookup can't pass as "no lines" (probe R5 found that).
export function launchLines(store, launchId) {
  if (!store) throw new Error('the launch has no store');
  if (!existsSync(join(store.dir, 'journal.jsonl'))) return [];
  return readJournal({ dir: store.dir, repoId: store.repo_id }).events.filter((e) => e.launch_id === launchId);
}

// Runs MIRAI's hook for one tool call, as Claude Code runs it: the command in the launch's
// settings, through `/bin/sh -c`, with the call on stdin and `env` as Claude Code's environment.
// Returns { decision: 'deny' | 'allow' | 'none', exit, out, err, ms }.
export function callHook(plan, call, { env = {}, timeoutMs = 30_000 } = {}) {
  const settings = JSON.parse(readFileSync(join(plan.launchDir, 'input', 'settings.json'), 'utf8'));
  const command = settings.hooks.PreToolUse[0].hooks[0].command;
  const input = JSON.stringify({ session_id: 'redteam', transcript_path: '/dev/null', cwd: plan.cwd, hook_event_name: 'PreToolUse', ...call });
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn('/bin/sh', ['-c', command], { env, cwd: plan.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      let decision = 'none';
      if (code === 2) decision = 'deny';
      else {
        try {
          const d = JSON.parse(out).hookSpecificOutput?.permissionDecision;
          if (d === 'deny' || d === 'allow') decision = d;
        } catch {
          // no JSON: no decision
        }
      }
      done({ decision, exit: code, out, err, ms: Date.now() - started });
    });
    child.stdin.end(input);
  });
}
