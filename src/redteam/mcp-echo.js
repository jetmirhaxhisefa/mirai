#!/usr/bin/env node
import { createInterface } from 'node:readline';

// A tiny MCP server for unit 13a's probes (stdio, newline-delimited JSON-RPC, no dependencies).
// One tool, probe_echo, answers with the marker it was started with, so a probe can tell whether
// a headless run under --restricted can call an MCP tool (what units 14 and 15 rely on).

const marker = process.argv[2] ?? 'no-marker';
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  if (req.id === undefined) return; // a notification
  if (req.method === 'initialize') {
    send({ id: req.id, result: { protocolVersion: req.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'probe', version: '0.0.1' } } });
  } else if (req.method === 'tools/list') {
    send({ id: req.id, result: { tools: [{ name: 'probe_echo', description: 'Returns a fixed marker word.', inputSchema: { type: 'object', properties: {} } }] } });
  } else if (req.method === 'tools/call') {
    send({ id: req.id, result: { content: [{ type: 'text', text: marker }] } });
  } else {
    send({ id: req.id, error: { code: -32601, message: 'method not found' } });
  }
});
