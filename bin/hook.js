#!/usr/bin/env node
import { runHook } from '../src/launch/hook.js';

// MIRAI's hook for agent runs (unit 13c). Claude Code runs it before every file tool call, from
// the run's trust root, with an empty environment:
//   env -i HOME=… PATH=… node <trust-root>/tree/.mirai/framework/bin/hook.js <policy file> <policy sha256>
// It reads the call as JSON on stdin.
// - A write it allows: it prints Claude Code's "allow" (the bundle allows the write tools only
//   this way, so a hook that fails to run refuses).
// - A read it allows: it prints nothing, so Claude Code's own checks still apply (an "allow"
//   would grant more than "no objection").
// - A refusal, or anything going wrong: exit 2 with the reason on stderr, which Claude Code
//   treats as a block.

const refuse = (reason) => {
  process.stderr.write(`MIRAI refused this call: ${reason}\n`);
  process.exitCode = 2;
};

let stdin = '';
let tooLarge = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  if (tooLarge) return;
  stdin += d;
  if (stdin.length > 8 * 1024 * 1024) tooLarge = true;
});
process.stdin.on('end', () => {
  if (tooLarge) return refuse('its input is too large');
  const [policyFile, policySha] = process.argv.slice(2);
  const d = policyFile && policySha ? runHook({ policyFile, policySha, stdin }) : { allow: false, reason: 'the hook was started without its policy' };
  if (!d.allow) return refuse(d.reason);
  if (d.write) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'MIRAI checked this call' } }));
  process.exitCode = 0;
  return undefined;
});
