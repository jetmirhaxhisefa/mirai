#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { agentFor, checkRedTeam, runAgent } from '../../src/agent/run.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { findRole, trustedRoles } from '../../src/agent/scope.js';
import { overlayHash } from '../../src/config/overlays.js';
import { canonicalSha256 } from '../../src/launch/strict.js';
import { redTeamStatus } from '../../src/redteam/run.js';
import { openStore } from '../../src/store/home.js';
import { agentOverlay } from '../../src/trust/overlays.js';
import { snapshot, trustedStrict } from '../../src/trust/snapshot.js';

// Unit 37's P2: a widened agent. On the sample app, an approved overlay gives the reviewer (Rex)
// Bash: .mirai/custom/agents/mirai-reviewer.toml on the integration branch, approved with your key.
// Pass when the launch is refused, the red team runs with the overlay through the build runner,
// and then the launch is allowed, with the result recorded against the overlay's hash.
//
// Run it in the sample app's checkout, in your terminal:
//   node <mirai>/test/probes/overlay-p2-probes.js --yes --phase before
//       the gate refuses Rex: no green red-team result covers the overlay (no model runs)
//   then the red team, through the build runner: mirai redteam run
//   node <mirai>/test/probes/overlay-p2-probes.js --yes --phase after
//       the result covers the overlay's template, its canonical hash includes the overlay's hash,
//       and the gate lets Rex launch (no model runs)
//   node <mirai>/test/probes/overlay-p2-probes.js --yes --phase after --launch
//       the same, then one real Rex launch (one short run on your subscription) whose init event
//       lists Bash

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, phase: { type: 'string' }, launch: { type: 'boolean' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  if (!values.yes || !['before', 'after'].includes(values.phase)) {
    process.stderr.write('--yes --phase before|after [--launch]: run in the sample app\'s checkout; --launch is one short Rex run on your Claude subscription\n');
    return 2;
  }
  const cwd = process.cwd();
  const env = process.env;
  const store = openStore({ cwd, env });
  const trust = snapshot({ cwd, env });
  const own = agentOverlay(trust, store, 'mirai-reviewer');
  if (!own) throw new Error('no .mirai/custom/agents/mirai-reviewer.toml on the integration branch: commit it there first');
  if (own.state !== 'approved') throw new Error(`the overlay is ${own.state}: mirai approve --file ${own.path}`);
  const r = own.overlay.result;
  log(`overlay: ${own.path} (${r.change}: ${r.why.join(', ')}), hash ${overlayHash(own.overlay)}`);
  if (r.change !== 'widening' || !r.def.tools.allowed.includes('Bash')) throw new Error('the overlay must give Rex Bash (a widening)');
  const role = findRole(trustedRoles(trust), 'reviewer');
  const agent = agentFor(trust, 'mirai-reviewer', role, trustedStrict(trust, role.mode), { store });
  log(`template: ${agent.template.name}, tools ${agent.template.tools.join(', ')}, canonical ${canonicalSha256(agent.template)}`);
  const status = await redTeamStatus({ cwd, env, trust, template: agent.template });
  let refused = null;
  try {
    checkRedTeam(status, store);
  } catch (err) {
    refused = err;
  }
  if (values.phase === 'before') {
    log(refused ? `P2 before: PASS, the launch is refused (${refused.message})` : 'P2 before: FAIL, the gate would let Rex launch with no red-team result for the overlay');
    return refused ? 0 : 1;
  }
  const cov = status.result?.templates?.[agent.template.name];
  const recorded = Boolean(cov?.tested && cov.bundle === canonicalSha256(agent.template));
  log(`result: ${status.result?.created_at ?? 'none'} (${status.state}); the overlay's template ${cov ? `ran ${cov.cases} case(s), tested ${cov.tested}` : 'isn\'t in it'}`);
  if (refused || !recorded) {
    log(`P2 after: FAIL, ${refused ? refused.message : 'the result doesn\'t cover the overlay\'s template'}`);
    return 1;
  }
  log('P2 after: the gate lets Rex launch, on a result recorded against the overlay\'s hash');
  if (!values.launch) return 0;
  const run = await runAgent({ launchToken: mintLaunchToken(), cwd, env, role: 'reviewer', agent: 'mirai-reviewer', prompt: 'Run `git status --short` with Bash, then say in one line what it printed. Change nothing.', maxTurns: 4 });
  log(`launch: ${run.outcome}${run.why ? ` (${run.why})` : ''}`);
  return run.outcome === 'ok' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  });
}
