#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { runFix } from '../../src/agent/fix.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { runReview } from '../../src/agent/review.js';
import { readTicketStatus } from '../../src/store/tickets.js';
import { seeded, setup, showReview } from './review-probes.js';

// Unit 24b's probes, as 24a's (a sample-app clone, a probe home, your token copied in, the red-team
// gate stubbed green, Docker Desktop running), on 24a's seed with the plan marked `risk: high`.
// - r1 (Opus, about 6 runs): the five lenses and the check. What we learn: each lens's structured
//   verdict, the merge, what the check confirms or drops, time and tokens per lens.
// - r3 (Opus and Sonnet, about 8 runs): r1, then Kai's fix round, then the combined round 2 on deep.
//   node test/probes/review-high-probes.js --yes --probe r1|r3 [--app <sample app>]

const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const opts = (ctx) => ({ claude: ctx.claude, status: green });

async function r1(ctx) {
  const s = await seeded(ctx, { risk: 'high' });
  if (!s.ok) return null;
  const r = await runReview({ cwd: ctx.root, env: ctx.env, ticket: 'SAMPLE-1', nextToken: () => mintLaunchToken(), launchOptions: opts(ctx) });
  showReview(ctx.log, s.store, r, s.canary, 'r1-review');
  return { ...s, r };
}

async function r3(ctx) {
  const got = await r1(ctx);
  if (got?.r.outcome !== 'changes') {
    ctx.log('r3: no blocking finding to fix; stopped');
    return;
  }
  const f = await runFix({ cwd: ctx.root, env: ctx.env, ticket: 'SAMPLE-1', nextToken: () => mintLaunchToken(), launchOptions: opts(ctx) });
  ctx.log(`r3-fix: ${f.outcome}${f.why ? ` (${String(f.why).slice(0, 300)})` : ''}`);
  for (const x of f.rounds) ctx.log(`  round ${x.round}: ${x.outcome}; replies ${JSON.stringify(x.replies ?? [])}`);
  if (f.outcome !== 'handed-over') return;
  const r = await runReview({ cwd: ctx.root, env: ctx.env, ticket: 'SAMPLE-1', nextToken: () => mintLaunchToken(), launchOptions: opts(ctx) });
  showReview(ctx.log, got.store, r, got.canary, 'r3-review-round-2');
  ctx.log(`r3-ticket: ${readTicketStatus(got.store, 'SAMPLE-1').status.state}`);
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, probe: { type: 'string' }, app: { type: 'string' } } });
  const probe = { r1, r3 }[values.probe];
  if (!values.yes || !probe) {
    process.stderr.write('--probe r1|r3 and --yes: it uses your Claude subscription (Opus: r1 about six runs, r3 about eight) and Docker\n');
    return 2;
  }
  const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
  const log = (l) => process.stdout.write(`${l}\n`);
  try {
    const ctx = setup({ app: resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app')), workdir });
    await probe({ ...ctx, log, workdir });
  } finally {
    spawnSync('/bin/chmod', ['-R', 'u+rwX', workdir]);
    rmSync(workdir, { recursive: true, force: true });
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
