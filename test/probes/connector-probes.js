#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { BRIEF_READY, INTERVIEW, PRD_READY } from '../helpers/docs-fixtures.js';

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
// initiative (brief, PRD, epic, tickets) in docs/mirai/<initiative>/. First, the setup writes it
// into the work tree from MIRAI's registry/examples/ (the brief's Q-1 answered in the brief and the
// PRD, so the pair can be approved). It's NOT committed on main: publish takes the folder from the
// work tree, and the docs merge request is how it reaches main:
//   node <mirai>/test/probes/connector-probes.js --setup github|gitlab --initiative due-dates
//       writes docs/mirai/due-dates/ (brief, interview, prd, epic-due-dates, tickets/SAMPLE-51..57)
//       and prints the ids you approve: due-dates-prd (with its brief) and SAMPLE-50 (the epic)
//   mirai docs publish <initiative>
//   node <mirai>/test/probes/connector-probes.js --check published --initiative <initiative>
//       one merge request, and its diff holds only docs/mirai/<initiative>/
//   mirai approve <prd-id> --file docs/mirai/<initiative>/prd.md        (your key)
//   node <mirai>/test/probes/connector-probes.js --check refused --initiative <initiative>
//       mirai docs merge refuses before the ticket-set approval, naming it; nothing merged
//   mirai approve <epic-id> --file docs/mirai/<initiative>/epic-<…>.md  (your key)
//   sed -i '' 's/the nightly reminder/the midnight reminder/' docs/mirai/<initiative>/prd.md
//       (a word outside the summary: the reader test still holds), then mirai docs publish <initiative>
//   node <mirai>/test/probes/connector-probes.js --check stale --initiative <initiative>
//       mirai show says the PRD "changed since approval", and the merge refuses it
//   mirai approve <prd-id> --file docs/mirai/<initiative>/prd.md, then mirai docs publish <initiative>
//   mirai docs merge <initiative>     (it may say "waiting for": run it again when the checks pass)
//   node <mirai>/test/probes/connector-probes.js --check merged --initiative <initiative>
//       the merge request is merged, and the host's main has every document as published
// P3 (a lone bug ticket on the sample app, SAMPLE-60: "Pressing Add twice quickly adds the task
// twice", in frontend/src/components/AddTaskForm.tsx):
//   node <mirai>/test/probes/connector-probes.js --setup bug --ticket SAMPLE-60
//       writes docs/mirai/tickets/SAMPLE-60.md; you approve it and commit it on main (D-54: a
//       ticket is planned from the integration branch), then mirai run it to its MR
//   node <mirai>/test/probes/connector-probes.js --check lone --ticket SAMPLE-60
//       the code MR's diff holds the fix and no document but the ticket's own file (which is
//       already on main, so usually none); then mirai merge SAMPLE-60 (your key), and
//       --check lone-merged --ticket SAMPLE-60
// P4 (a throwaway project with [docs] store = "local" on its main):
//   node <mirai>/test/probes/connector-probes.js --setup local --initiative due-dates
//       writes the brief, its interview and the PRD through the local store (0700 folders)
//   then mirai reader-test and mirai approve the PRD by its full path (quoted: it has a space)
//   node <mirai>/test/probes/connector-probes.js --check local --initiative due-dates
//       git status shows nothing new, mirai show gives paths in MIRAI's store with the brief and
//       the PRD approved, and doctor says teammates can't see them

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
    results.push(ok(['brief', 'prd'].every((t) => new RegExp(`^ +${t}\\.md +${t} +\\S+ +approved +`, 'm').test(show.out)), 'the brief and the PRD show as approved'));
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
      const own = `${config.docs.root}/tickets/${ticket}.md`;
      log(`its diff: ${names.join(', ')}`);
      // D-54: a ticket is planned from main, so its own file is there already and usually isn't in
      // the diff; if the branch changed it, it may ride. No other document may.
      results.push(ok(docs.every((n) => n === own), `no document in it but the ticket's own file (${docs.length ? docs.join(', ') : 'none: the ticket file is on main already'})`));
      results.push(ok(names.some((n) => !n.startsWith(`${config.docs.root}/`)), 'and it holds the fix'));
    } else {
      const merged = events().filter((x) => x.type === 'mr_merged' && x.ticket === ticket).at(-1);
      results.push(ok(Boolean(merged), `mirai merge took it in as one change (${merged?.merge_sha ?? 'not merged'})`));
    }
    return results.every(Boolean);
  }
  throw new Error(`unknown check ${name}`);
}

// A small real bug in the sample app (P3): a lone ticket, no initiative.
export const BUG_TICKET = (key) => `---
id: ${key}
type: bug
template: bug@v1
repo: "."
risk: normal
size: S
verify: "In frontend/, npm test passes, including a test that a second click on Add while the first save runs adds nothing."
covers_fr: []
covers_ac: []
governed_by: []
after: []
files_likely: [frontend/src/components/AddTaskForm.tsx]
e2e: false
---
# Pressing Add twice quickly adds the task twice

## Description

A user types a task and clicks Add twice before the first save finishes. The list then shows the
task twice, and both copies are saved. The form should ignore a click while a save is running.

## Reproduction

1. The app, signed in, with the browser's network throttling set to "Slow 3G".
2. Type "Buy milk" into New task and click Add twice, quickly.
3. Actual: two "Buy milk" tasks. Expected: one.

## Cause hypothesis

The form calls its save on every submit, and nothing marks a save as running, so the Add button
stays enabled until the save returns.

## Acceptance criteria

- AC-${key}.1: A second click while saving adds nothing
  - Given a title typed into New task
  - When the user clicks Add twice before the first save returns
  - Then the task is saved once
- AC-${key}.2: Add works again after the save
  - Given a save that has returned, successfully or not
  - When the user clicks Add again
  - Then the form submits as before

## References

Not applicable — found by hand on the sample app.

## Notes

Not applicable — no notes.
`;

// --setup: what a probe needs, written in the checkout's work tree; never committed by this script.
// - github | gitlab (P1/P2): 33's example initiative in docs/mirai/<initiative>/, NOT committed
//   (publish takes the folder from the work tree);
// - bug (P3): a lone bug ticket in docs/mirai/tickets/<ticket>.md, which you approve and commit on
//   main (D-54: a ticket is planned from the integration branch);
// - local (P4): the brief, its interview and the PRD, written through the local store.
// A file or folder that's already there is refused.
function setup(mode, { cwd, env, initiative, ticket, log }) {
  if (!['github', 'gitlab', 'bug', 'local'].includes(mode)) throw new Error('--setup github|gitlab|bug|local');
  const store = openStore({ cwd, env });
  const { conn } = docsStoreFor({ cwd, env, store });
  const write = (abs, text) => {
    if (existsSync(abs)) throw new Error(`${abs} is already there: remove it (or use another checkout) first`);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, text);
    log(`wrote ${abs}`);
  };
  if (mode === 'bug') {
    if (!/^[A-Z][A-Z0-9]*-[0-9]+$/.test(ticket ?? '')) throw new Error('--setup bug --ticket <key>, such as SAMPLE-60');
    if (conn.kind !== 'repo') throw new Error(`the project's store is ${conn.name}; P3 needs the repo store`);
    const abs = conn.pathOf('bug', null, `${ticket}.md`);
    write(abs, BUG_TICKET(ticket));
    const rel = conn.relOf(abs);
    log(`\nnext: mirai lint ${rel}, mirai approve ${ticket} --file ${rel}, then commit it on main and push it (D-54)`);
    return true;
  }
  if (initiative !== 'due-dates') throw new Error('the example initiative is due-dates (its PRD and epic link each other by that folder)');
  if (mode === 'local') {
    if (conn.kind !== 'local') throw new Error(`the project's store is ${conn.name}: set [docs] store = "local" in .mirai/config.toml and commit it on main first`);
    // Through the store's own write: its folders are private (0700), as doctor checks.
    for (const [type, text] of [['brief', BRIEF_READY], ['interview', INTERVIEW], ['prd', PRD_READY]]) {
      if (existsSync(conn.pathOf(type, initiative))) throw new Error(`${conn.pathOf(type, initiative)} is already there: remove it first`);
      log(`wrote ${conn.write(type, initiative, null, text)}`);
    }
    log(`\nthe id you approve: due-dates-prd (one decision approves it with due-dates-brief), with --file ${conn.pathOf('prd', initiative)}`);
    return true;
  }
  const remote = execFileSync('/usr/bin/git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' }).trim();
  const on = /github\.com/.test(remote) ? 'github' : /gitlab/.test(remote) ? 'gitlab' : null;
  if (on && on !== mode) throw new Error(`the remote is on ${on}, not ${mode}: ${remote}`);
  if (!on) log(`note: the remote (${remote}) isn't on github.com or gitlab: fine for a dry run, not for the probe`);
  if (mode === 'gitlab' && !/glab-personal\/?$/.test(env.GLAB_CONFIG_DIR ?? '')) throw new Error('GitLab: run with GLAB_CONFIG_DIR=~/.config/glab-personal (your personal gitlab.com), never the work GitLab');
  if (conn.kind !== 'repo') throw new Error(`the project's store is ${conn.name}; P1/P2 need the repo store`);
  const dir = conn.dir(initiative);
  if (existsSync(dir)) throw new Error(`${dir} is already there: remove it (or use another checkout) first`);
  const ex = (rel) => readFileSync(join(REGISTRY_DIR, 'examples', rel), 'utf8');
  const files = { 'brief.md': BRIEF_READY, 'interview.md': INTERVIEW, 'prd.md': PRD_READY, 'epic-due-dates.md': ex('epic.md') };
  for (const f of readdirSync(join(REGISTRY_DIR, 'examples', 'tickets')).sort()) files[`tickets/${f}`] = ex(`tickets/${f}`);
  for (const [rel, text] of Object.entries(files)) write(join(dir, rel), text);
  const rel = `${conn.docsRoot}/${initiative}`;
  log(`\nnot committed, and don't commit it on main: mirai docs publish ${initiative} takes the folder from your work tree`);
  log('the ids you approve: due-dates-prd (one decision approves it with due-dates-brief) and SAMPLE-50 (the epic with its 7 tickets)');
  log(`next: mirai lint ${rel}   (0 problems), then mirai show ${initiative}`);
  return true;
}

async function cli() {
  const { values } = parseArgs({ options: { check: { type: 'string' }, setup: { type: 'string' }, initiative: { type: 'string' }, ticket: { type: 'string' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  if (values.setup) return setup(values.setup, { cwd: process.cwd(), env: process.env, initiative: values.initiative, ticket: values.ticket, log }) ? 0 : 1;
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
