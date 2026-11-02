#!/usr/bin/env node
import { runWorker } from '../src/agent/worker.js';

// A launch started from your session's MIRAI server (unit 19c), detached from it. Started by the
// server from the trust root with an empty environment:
//   env -i HOME=… PATH=… node <trust-root>/tree/.mirai/framework/bin/agent-worker.js <checkout> <request id> <claude>
// The one-time token comes on stdin. Everything it does, `mirai agent run` does: the same checks,
// the same cage. To stop it: kill <its pid> (agent_status shows it). The first signal ends the agent
// with a grace for cleanup; a second ends it at once, as Ctrl-C does for `mirai agent run`.
const [checkout, id, claude] = process.argv.slice(2);
const soft = new AbortController();
const hard = new AbortController();
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => (soft.signal.aborted ? hard.abort() : soft.abort()));
let token = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  if (token.length < 256) token += d;
});
process.stdin.on('end', () => {
  runWorker({ checkout, id, claude, token: token.trim(), env: { HOME: process.env.HOME, PATH: process.env.PATH }, signal: soft.signal, hardSignal: hard.signal }).then(
    () => process.exit(0),
    () => process.exit(1),
  );
});
