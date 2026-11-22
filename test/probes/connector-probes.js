#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { runChecks } from '../../src/doctor/checks.js';
import { hostFor } from '../../src/ship/host.js';
import { contentHash } from '../../src/sign/sign.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { docsStoreFor } from '../../src/store/connectors/index.js';
import { docsMerge } from '../../src/store/connectors/publish.js';
import { snapshot, trustedConfig } from '../../src/trust/snapshot.js';

// Unit 38's probes P1–P4: checks you run between your own steps, in the project's checkout, in
// your terminal. Each check reads what MIRAI and the host did and prints PASS or FAIL with why. The
// steps that need your key (mirai approve) and the pushes (mirai docs publish) are yours; the
// checks never approve or sign anything. A check that merges says so.
//
// GitLab: only your personal gitlab.com, never the work GitLab. Every command, yours and these
// checks, runs with GLAB_CONFIG_DIR=~/.config/glab-personal; the checks refuse to run on a GitLab
// project without it.
//
// P1 (GitLab, the sample app's GitLab copy) and P2 (GitHub, the sample app from 27a), 33's example
// initiative (brief, PRD, epic, tickets) in docs/mirai/<initiative>/:
//   mirai docs publish <initiative>
//   node <mirai>/test/probes/connector-probes.js --check published --initiative <initiative>
//       one merge request, and its diff holds only docs/mirai/<initiative>/
//   mirai approve <prd-id> --file docs/mirai/<initiative>/prd.md        (your key)
//   node <mirai>/test/probes/connector-probes.js --check refused --initiative <initiative>
//       mirai docs merge refuses before the ticket-set approval, naming it; nothing merged
//   mirai approve <epic-id> --file docs/mirai/<initiative>/epic-<…>.md  (your key)
//   (edit the PRD: one word) then mirai docs publish <initiative>
//   node <mirai>/test/probes/connector-probes.js --check stale --initiative <initiative>
//       mirai show says the PRD "changed since approval", and the merge refuses it
//   mirai approve <prd-id> --file docs/mirai/<initiative>/prd.md, then mirai docs publish <initiative>
//   mirai docs merge <initiative>     (it may say "waiting for": run it again when the checks pass)
//   node <mirai>/test/probes/connector-probes.js --check merged --initiative <initiative>
//       the merge request is merged, and the host's main has every document as published
// P3 (a lone bug ticket on the sample app): after mirai ship <ticket> and before mirai merge:
//   node <mirai>/test/probes/connector-probes.js --check lone --ticket <ticket>
//       the code MR's diff holds the fix and the ticket's own file, and nothing else under the
//       docs root; then mirai merge <ticket> (your key), and --check lone-merged --ticket <ticket>
// P4 (a throwaway project with [docs] store = "local" on its main, a brief and PRD written there
// and approved with your key):
//   node <mirai>/test/probes/connector-probes.js --check local --initiative <initiative>
//       git status shows nothing new, mirai show gives paths in MIRAI's store, and doctor says
//       teammates can't see them

const MIRAI = fileURLToPath(new URL('../../bin/launch.js', import.meta.url));

function context(cwd, env) {
  const store = openStore({ cwd, env });
  const config = trustedConfig(snapshot({ cwd, env }));
  const remote = execFileSync('/usr/bin/git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' }).trim();
  if (/gitlab/.test(remote) && !/glab-personal\/?$/.test(env.GLAB_CONFIG_DIR ?? '')) throw new Error('a GitLab project: run with GLAB_CONFIG_DIR=~/.config/glab-personal (your personal gitlab.com), never the work GitLab');
  return { store, config, remote };
}
const mirai = (cwd, env, ...args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [MIRAI, ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};
const git = (cwd, ...args) => execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8' }).trim();

async function check(name, { cwd, env, initiative, ticket, log }) {
  const ok = (cond, what) => {
    log(`${cond ? 'PASS' : 'FAIL'}: ${what}`);
    return cond;
  };
  const results = [];
  if (name === 'local') {
    const store = openStore({ cwd, env });
    const { conn } = docsStoreFor({ cwd, env, store });
    results.push(ok(conn.name === 'local', `the store is ${conn.name}`));
    results.push(ok(git(cwd, 'status', '--porcelain') === '', 'git status shows nothing new'));
    const show = mirai(cwd, env, 'show', initiative);
    log(show.out.trimEnd());
    results.push(ok(show.code === 0 && show.out.includes(conn.dir(initiative)), `mirai show gives paths in ${conn.dir(initiative)}`));
    const items = await runChecks({ cwd, env });
    const item = items.find((i) => i.id === 'docs-store');
    results.push(ok(/teammates can't see these documents/.test(item?.detail ?? ''), `doctor: ${item?.detail}`));
    return results.every(Boolean);
  }
  const { store, config } = context(cwd, env);
  const folder = `${config.docs.root}/${initiative ?? ''}`;
  const events = () => readJournal(store).events;
  if (name === 'published') {
    const e = events().filter((x) => x.type === 'docs_published' && x.item === initiative).at(-1);
    results.push(ok(Boolean(e), `docs_published for ${initiative}: ${e?.url ?? 'none'}`));
    if (!e) return false;
    const base = git(cwd, 'merge-base', `${config.git.integration_branch}`, e.head);
    const names = git(cwd, 'diff', '--name-only', base, e.head).split('\n').filter(Boolean);
    results.push(ok(names.length > 0 && names.every((n) => n.startsWith(`${folder}/`)), `its diff holds only ${folder}/ (${names.length} files)`));
    const host = hostFor({ config, remoteUrl: git(cwd, 'remote', 'get-url', 'origin'), store, env, root: store.checkout });
    const mr = host.findMr(e.branch);
    results.push(ok(mr?.number === e.number && mr.state === 'open', `one open merge request: ${mr?.url}`));
    return results.every(Boolean);
  }
  if (name === 'refused' || name === 'stale') {
    if (name === 'stale') {
      const show = mirai(cwd, env, 'show', initiative);
      log(show.out.trimEnd());
      results.push(ok(/prd\.md .*changed since approval/.test(show.out), 'mirai show: the PRD is "changed since approval"'));
    }
    const before = events().filter((x) => x.type === 'docs_merged').length;
    let gaps = null;
    try {
      await docsMerge({ cwd, env, initiative });
    } catch (err) {
      gaps = err.gaps ?? null;
      log(`refused: ${err.message}`);
      for (const g of gaps ?? []) log(`  ${g.path}: ${g.gap}`);
    }
    const text = (gaps ?? []).map((g) => g.gap).join('\n');
    results.push(ok(name === 'refused' ? /no ticket-set approval/.test(text) : /changed after its approval/.test(text), name === 'refused' ? 'the merge refuses, naming the ticket-set approval' : 'the merge refuses the changed PRD'));
    results.push(ok(events().filter((x) => x.type === 'docs_merged').length === before, 'nothing merged'));
    return results.every(Boolean);
  }
  if (name === 'merged') {
    const e = events().filter((x) => x.type === 'docs_merged' && x.item === initiative).at(-1);
    results.push(ok(Boolean(e), `docs_merged: ${e?.merge_sha ?? 'none'}`));
    const p = events().filter((x) => x.type === 'docs_published' && x.item === initiative).at(-1);
    git(cwd, 'fetch', '-q', 'origin', config.git.integration_branch);
    for (const f of p?.files ?? []) {
      let same = false;
      try {
        same = contentHash(execFileSync('/usr/bin/git', ['show', `origin/${config.git.integration_branch}:${f.path}`], { cwd })) === f.content_hash;
      } catch {
        same = false;
      }
      results.push(ok(same, `the host's ${config.git.integration_branch} has ${f.path} as published`));
    }
    return results.every(Boolean);
  }
  if (name === 'lone' || name === 'lone-merged') {
    const opened = events().filter((x) => x.type === 'mr_opened' && x.ticket === ticket).at(-1);
    results.push(ok(Boolean(opened), `${ticket}'s MR: ${opened?.url ?? 'none'}`));
    if (name === 'lone') {
      const pushed = events().filter((x) => x.type === 'pushed' && x.ticket === ticket).at(-1);
      const base = git(cwd, 'merge-base', config.git.integration_branch, pushed.sha);
      const names = git(cwd, 'diff', '--name-only', base, pushed.sha).split('\n').filter(Boolean);
      const docs = names.filter((n) => n.startsWith(`${config.docs.root}/`));
      log(`its diff: ${names.join(', ')}`);
      results.push(ok(docs.length === 1 && docs[0] === `${config.docs.root}/tickets/${ticket}.md`, 'the only document in it is the ticket\'s own file'));
      results.push(ok(names.length > docs.length, 'and it holds the fix'));
    } else {
      const merged = events().filter((x) => x.type === 'mr_merged' && x.ticket === ticket).at(-1);
      results.push(ok(Boolean(merged), `mirai merge took it in as one change (${merged?.merge_sha ?? 'not merged'})`));
    }
    return results.every(Boolean);
  }
  throw new Error(`unknown check ${name}`);
}

async function cli() {
  const { values } = parseArgs({ options: { check: { type: 'string' }, initiative: { type: 'string' }, ticket: { type: 'string' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  const needs = { published: 'initiative', refused: 'initiative', stale: 'initiative', merged: 'initiative', local: 'initiative', lone: 'ticket', 'lone-merged': 'ticket' };
  if (!needs[values.check] || !values[needs[values.check]]) {
    process.stderr.write(`--check ${Object.keys(needs).join('|')} with --initiative <name> or --ticket <key>: see the comment at the top of ${join('test', 'probes', 'connector-probes.js')}\n`);
    return 2;
  }
  const passed = await check(values.check, { cwd: process.cwd(), env: process.env, initiative: values.initiative, ticket: values.ticket, log });
  log(passed ? 'probe check: PASS' : 'probe check: FAIL');
  return passed ? 0 : 1;
}

cli().then((code) => process.exit(code), (err) => {
  process.stderr.write(`${err.stack ?? err}\n`);
  process.exit(1);
});
