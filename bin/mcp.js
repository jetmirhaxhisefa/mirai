#!/usr/bin/env node
import { PolicyError, readPolicy, serveStdio } from '../src/mcp/server.js';

// MIRAI's MCP server for headless agent runs (units 14d, 15a): run_tests, run_check and
// log_event (src/mcp/tools.js). Claude Code starts it from the launch's mcp.json, from the run's
// trust root, with an empty environment:
//   node <trust-root>/tree/.mirai/framework/bin/mcp.js <policy file> <policy sha256>
// Everything it needs is in the policy file; nothing comes from its environment.

const [policyFile, policySha] = process.argv.slice(2);
let policy;
try {
  policy = readPolicy(policyFile, policySha);
} catch (err) {
  process.stderr.write(`MIRAI's MCP server won't start: ${err instanceof PolicyError ? err.message : 'the policy file is broken'}\n`);
  process.exit(2);
}
// A signal ends the run under way the same way a closed stdin does: cancelled, then cleaned up.
const { end } = serveStdio({ policy });
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => end(0));
