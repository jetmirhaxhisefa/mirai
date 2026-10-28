#!/usr/bin/env node
import { appendFileSync, fstatSync, readdirSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';

// The MCP server for unit 14d's fact probes (M1–M6; stdio, newline-delimited JSON-RPC, no
// dependencies). It logs what Claude Code gives it to a JSONL file, names only, never values:
// its environment's names, its open file descriptors and their kinds, its working folder, the
// protocol version and capabilities asked for, every method with its time, and how it ends
// (stdin closed, a signal). Two tools:
// - probe_facts: answers with the marker, after checking that it reaches the Docker socket and
//   a canary file in the store (outside the sandbox, M4);
// - probe_sleep(seconds): waits, with a progress notification every 30 s when asked (M5, M6).
//
//   node mcp-facts-server.js <log-file> <marker> <docker-socket> <store-canary-file>

const [logFile, marker, socket, storeFile] = process.argv.slice(2);
const started = Date.now();
const log = (event, data = {}) => appendFileSync(logFile, `${JSON.stringify({ t: Date.now() - started, event, ...data })}\n`);
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

function fds() {
  const out = [];
  for (const name of readdirSync('/dev/fd')) {
    const fd = Number(name);
    try {
      const st = fstatSync(fd);
      out.push({ fd, kind: st.isFIFO() ? 'pipe' : st.isSocket() ? 'socket' : st.isCharacterDevice() ? 'char' : st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'other' });
    } catch {
      out.push({ fd, kind: 'closed' });
    }
  }
  return out;
}

log('start', { argc: process.argv.length, cwd: process.cwd(), envNames: Object.keys(process.env).sort(), fds: fds(), ppid: process.ppid });
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGPIPE']) {
  process.on(sig, () => {
    log('signal', { sig });
    process.exit(0);
  });
}
process.on('exit', (code) => log('exit', { code }));

const ping = () => new Promise((done) => {
  if (!socket) return done('no socket given');
  const s = connect(socket);
  let body = '';
  s.on('connect', () => s.write('GET /_ping HTTP/1.0\r\n\r\n'));
  s.on('data', (d) => (body += d));
  s.on('end', () => done(/\r\n\r\nOK/.test(body) ? 'ok' : 'answered, not OK'));
  s.on('error', (err) => done(`error ${err.code}`));
  setTimeout(() => {
    s.destroy();
    done('timeout');
  }, 5000);
});

const sleeping = new Map();
const input = createInterface({ input: process.stdin });
input.on('close', () => log('stdin-closed'));
input.on('line', async (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    log('bad-json');
    return;
  }
  log('method', { method: req.method, id: req.id ?? null, progressToken: req.params?._meta?.progressToken !== undefined });
  if (req.method === 'notifications/cancelled') {
    log('cancelled', { requestId: req.params?.requestId ?? null });
    sleeping.get(req.params?.requestId)?.();
    return;
  }
  if (req.id === undefined) return;
  if (req.method === 'initialize') {
    log('initialize', { protocolVersion: req.params?.protocolVersion ?? null, capabilities: req.params?.capabilities ?? null, clientInfo: req.params?.clientInfo ?? null });
    send({ id: req.id, result: { protocolVersion: req.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'probe', version: '0.0.1' } } });
  } else if (req.method === 'tools/list') {
    send({ id: req.id, result: { tools: [
      { name: 'probe_facts', description: 'Returns a fixed marker word.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'probe_sleep', description: 'Waits the given number of seconds, then returns.', inputSchema: { type: 'object', properties: { seconds: { type: 'integer', minimum: 1, maximum: 3600 } }, required: ['seconds'], additionalProperties: false } },
    ] } });
  } else if (req.method === 'tools/call' && req.params?.name === 'probe_facts') {
    let store;
    try {
      store = readFileSync(storeFile, 'utf8').includes('CANARY-') ? 'read' : 'read, no canary';
    } catch (err) {
      store = `error ${err.code}`;
    }
    const docker = await ping();
    log('facts', { docker, store });
    send({ id: req.id, result: { content: [{ type: 'text', text: `${marker} docker=${docker} store=${store}` }] } });
  } else if (req.method === 'tools/call' && req.params?.name === 'probe_sleep') {
    const seconds = Number(req.params?.arguments?.seconds ?? 1);
    const token = req.params?._meta?.progressToken;
    log('sleep-start', { seconds });
    const begun = Date.now();
    const progress = token === undefined ? null : setInterval(() => {
      const done = Math.round((Date.now() - begun) / 1000);
      send({ method: 'notifications/progress', params: { progressToken: token, progress: done, total: seconds, message: `waited ${done} s` } });
    }, 30_000);
    const finished = await new Promise((done) => {
      const timer = setTimeout(() => done(true), seconds * 1000);
      sleeping.set(req.id, () => {
        clearTimeout(timer);
        done(false);
      });
    });
    if (progress) clearInterval(progress);
    sleeping.delete(req.id);
    log('sleep-end', { finished, waited: Math.round((Date.now() - begun) / 1000) });
    if (finished) send({ id: req.id, result: { content: [{ type: 'text', text: `${marker} slept ${seconds}` }] } });
  } else {
    send({ id: req.id, error: { code: -32601, message: 'method not found' } });
  }
});
