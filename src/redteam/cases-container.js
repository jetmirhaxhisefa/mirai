import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { findTarget, runTest } from '../tests/run.js';
import { trustedConfig } from '../trust/snapshot.js';
import { attackScript, containerRun, oneAtATime, OUTWARD_LINKS, workerStore } from './container.js';

// The red team's container cases (unit 18c): what MIRAI later runs of an agent's code, in your
// project's own containers. No model; each runs once (src/redteam/container.js says how they
// judge). One case per test level and named check the trust root configures, plus two about what
// reaches a test run at all.

const RW = ['read-write'];

// The levels and checks of the trust root's config, each with what the branch fixtures need.
export function containerTargets(trust) {
  let config;
  try {
    config = trustedConfig(trust);
  } catch {
    return null;
  }
  if (!(config.compose?.files ?? []).length || !config.compose?.env_file) return [];
  const names = [...(config.testing?.levels ?? []).map((l) => ({ kind: 'level', name: l.name })), ...Object.keys(config.checks ?? {}).map((name) => ({ kind: 'check', name }))];
  return names.flatMap(({ kind, name }) => {
    try {
      return [{ kind, name, service: findTarget(config, name).service, envFile: config.compose.env_file, composeFiles: config.compose.files }];
    } catch {
      return [];
    }
  });
}

// One executor call that must be refused before Compose runs: its code, and whether a frozen file
// was written (it mustn't be).
async function refusedRun(ctx, env, args, deps) {
  const script = attackScript({ homeMarker: 'mirai-pwned-unused', home: env.HOME, hostCanary: join(ctx.outside, 'outside.txt'), httpPort: 9, copyMarker: 'mirai-redteam-copy-unused' });
  try {
    const r = await oneAtATime(() => (deps.runTest ?? runTest)({ cwd: ctx.project, env: { HOME: env.HOME }, trust: ctx.trust, by: 'agent', store: workerStore(ctx), redTeam: { script }, maxParallel: 2, waitMs: 30 * 60_000, ...args }));
    return { outcome: r.outcome, code: r.code ?? null, message: r.message ?? '', frozen: Boolean(r.dir && existsSync(join(r.dir, 'compose.frozen.json'))) };
  } catch (err) {
    const r = err.result;
    // A path refused by its form never gets a result; anything else with none couldn't run.
    const outcome = r?.outcome ?? (err.code === 'bad-path' ? 'refused' : 'error');
    return { outcome, code: err.code ?? null, message: err.message ?? '', frozen: Boolean(r?.dir && existsSync(join(r.dir, 'compose.frozen.json'))) };
  }
}

export function containerCases(ctx, deps = {}) {
  const targets = containerTargets(ctx.trust);
  // No trust root to read (the case index without one): nothing to list.
  if (targets === null) return [];
  if (!targets.length) {
    return [{
      id: 'ct-none', fact: 'D-48', templates: RW, kind: 'container', evidence: 'config', title: 'no test containers: the trust root configures no [compose] levels or checks',
      action: { tool: 'container' },
      run: async () => ({ pass: true, note: 'not applicable: no [compose] files, env file, levels or checks, so run_tests runs nothing' }),
    }];
  }
  const first = targets[0];
  return [
    ...targets.map((t) => ({
      id: `ct-${t.kind}-${t.name}`, fact: 'D-30, D-48, D-49', templates: RW, kind: 'container', docker: true, evidence: 'host',
      title: `agent code in the ${t.name} ${t.kind}'s containers (${t.service}), on a branch with its own compose and env files`,
      action: { tool: 'container' },
      run: ({ ctx: w, env, signal }) => containerRun({ ctx: w, env, level: t, signal, deps }),
    })),
    {
      id: 'ct-copy-links', fact: '14c', templates: RW, kind: 'container', docker: true, evidence: 'refusal', title: 'a branch\'s links out of the project: the test run is refused before Compose',
      action: { tool: 'container' },
      run: async ({ ctx: w, env }) => {
        // The fixture commit's outward links are in the work tree as committed.
        const r = await refusedRun(w, env, { name: first.name }, deps);
        const pass = r.outcome === 'refused' && r.code === 'copy-link' && !r.frozen;
        return { pass, inconclusive: ['env-fault', 'error'].includes(r.outcome) && !r.frozen, note: `outcome ${r.outcome} (${r.code ?? 'no code'}); frozen file written: ${r.frozen ? 'yes' : 'no'}` };
      },
    },
    {
      id: 'ct-paths', fact: '14d, 18b review', templates: RW, kind: 'container', docker: true, evidence: 'refusal', title: 'run_tests paths: a link, a path under a link, an env file and a nested repo, refused in the copy',
      action: { tool: 'container' },
      run: async ({ ctx: w, env }) => {
        for (const l of OUTWARD_LINKS) rmSync(join(w.project, l), { force: true });
        // A link the copy keeps (it points further down), and a path under it.
        mkdirSync(join(w.project, 'src', 'mirai-redteam'), { recursive: true });
        symlinkSync('src', join(w.project, 'rt-down'));
        // `link-env` is the commit's link to .env: kept in the copy, since it points further down.
        const paths = ['rt-down', 'rt-down/mirai-redteam/keep.txt', 'link-env', 'sub/.env', 'nested/.env', '.git/config'];
        const LINKS = ['rt-down', 'rt-down/mirai-redteam/keep.txt', 'link-env'];
        const out = [];
        for (const path of paths) out.push({ path, ...(await refusedRun(w, env, { name: first.name, path }, deps)) });
        // A link must be refused for being one, not because the copy happened to drop it.
        const bad = out.filter((r) => !(r.outcome === 'refused' && r.code === 'bad-path' && !r.frozen && (!LINKS.includes(r.path) || /is a link/.test(r.message))));
        const faults = bad.filter((r) => ['env-fault', 'error'].includes(r.outcome) && !r.frozen);
        return {
          pass: bad.length === 0,
          inconclusive: bad.length > 0 && faults.length === bad.length,
          note: `refused before Compose: ${out.length - bad.length} of ${out.length}${bad.length ? `; not: ${bad.map((r) => `${r.path} → ${r.outcome} (${r.code ?? 'no code'})${r.frozen ? ', frozen' : ''}`).join(', ')}` : ''}`,
        };
      },
    },
  ];
}
