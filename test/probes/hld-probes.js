#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { applyOverlays, readOverlays } from '../../src/config/overlays.js';
import { loadRegistry } from '../../src/config/registry.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { exitCodeOf, formatError } from '../../src/cli/errors.js';
import { main } from '../../src/cli/main.js';
import { readFrontmatter } from '../../src/lint/frontmatter.js';
import { lintText } from '../../src/lint/lint.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { readToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { appendEvent, readJournal } from '../../src/store/journal.js';
import { traceInitiative } from '../../src/trace/initiative.js';
import { runVerify } from '../../src/verify/run.js';
import { runsOf } from '../../src/verify/gate.js';
import { snapshot, trustedConfig } from '../../src/trust/snapshot.js';
import { runReaderTest } from '../../src/write/reader.js';
import { seedPrdChecks, tessHome } from './tess-probes.js';

// Unit 62's probes (spec "Probes (real)").
// - P1 (Vera on Sonnet twice, one reader test): an HLD for the sample app's owner-only due dates
//   (44's PRD, which fits the app), written in this session (`--hld <file>`), with the ADR its D-1
//   links (`--adr <file>`, 62b's P1 ADR). The lint, Vera's real checks (printed for you to judge:
//   about the design, not the shape), the reader test of its summary, the approval with the probe
//   home's key (its ADR accepted on the same screen), and `mirai trace` (FR → component links).
// - P2 (no model): the pilot's own HLD template (thudos-setup's history, 16 sections) as an
//   overlay with a rename map; a hand-written HLD in its names lints clean, the core's trace table
//   and Decisions found.

const D = 'docs/mirai/due-dates';
const ADR_PATH = 'docs/decisions/ADR-0001-browser-time-zone.md';
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const git = (home, ...a) => spawnSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: home.root, env: { PATH: '/usr/bin:/bin', HOME: home.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, encoding: 'utf8' });
const commit = (home, m) => {
  git(home, 'add', '-A');
  if (git(home, 'status', '--porcelain').stdout.trim()) git(home, 'commit', '-qm', m, '--no-verify');
};
async function term(home, argv, answers) {
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: home.env, cwd: home.root });
  return { code, out, err };
}
async function vera(home, file, log) {
  const r = await runVerify({ cwd: home.root, env: home.env, file, launchToken: mintLaunchToken(), launchOptions: { status: green } });
  const e = r.entry;
  log(`Vera on ${file}: ${e ? `round ${e.round}, ${e.result}, ${e.must_fix} must-fix, ${e.suggestions} suggestion(s), model ${e.model}` : r.outcome}`);
  for (const f of e?.findings ?? []) log(`  ${f.grade} ${f.kind}${f.decision_type ? `/${f.decision_type}` : ''} [${f.layer}] line ${f.where?.line}: ${f.what}`);
  return e;
}

export async function p1(home, log, { hldFile, adrFile, resumed = false }) {
  const checks = {};
  const prdId = readFrontmatter(readFileSync(join(home.root, D, 'prd.md')))?.value?.id;
  // A resumed home has its PRD approved, and Vera's earlier rounds: her next is incremental.
  if (!resumed) {
    const a = await term(home, ['approve', prdId, '--file', `${D}/prd.md`], ['a', prdId, 'n']);
    appendEvent(openStore({ cwd: home.root, env: home.env }), { type: 'note', by: 'script', message: `probe --auto: ${prdId} approved with the probe home's key` });
    if (a.code !== 0) throw new Error(`the PRD's approval: ${a.err.trim()}`);
  }
  mkdirSync(join(home.root, 'docs/decisions'), { recursive: true });
  writeFileSync(join(home.root, ADR_PATH), readFileSync(adrFile));
  writeFileSync(join(home.root, D, 'hld.md'), readFileSync(hldFile));
  const idx = await term(home, ['adr', 'index'], []);
  if (idx.code !== 0) throw new Error(`mirai adr index: ${idx.err.trim()}`);
  commit(home, 'probe: the HLD and its ADR, written in the session');
  const lint = await term(home, ['lint', `${D}/hld.md`, ADR_PATH], []);
  log(lint.out.trim().split('\n').filter((l) => !/hint:|warning:/.test(l)).slice(-6).join('\n'));
  checks.lint = lint.code === 0;
  const ve = [await vera(home, ADR_PATH, log), await vera(home, `${D}/hld.md`, log)];
  checks.vera = ve.every(Boolean);
  // Past Vera's last round, open findings don't stop you: you approve anyway, and the signed line
  // names them (44's rule). Before it, a writing must-fix goes back to the author.
  const runs = runsOf(trustedConfig(snapshot({ cwd: home.root, env: home.env })), 'verify');
  const open = ve.flatMap((e) => (e && e.round < runs ? (e.findings ?? []) : []).filter((f) => f.grade === 'must-fix' && f.kind === 'writing'));
  const lastOpen = ve.flatMap((e) => (e && e.round >= runs ? (e.findings ?? []) : []).filter((f) => f.grade === 'must-fix'));
  if (lastOpen.length) log(`past Vera's last round (${runs}): ${lastOpen.length} must-fix finding(s) open; approved anyway, named in the signed line`);
  if (open.length) {
    log(`stopped: ${open.length} must-fix writing finding(s): fix the HLD or the ADR, then run again with --home ${home.workdir}`);
    checks.approved = false;
    return checks;
  }
  const rt = await runReaderTest({ cwd: home.root, env: home.env, file: `${D}/hld.md` });
  log(`reader test of the summary: ${rt?.entry?.result ?? rt?.outcome ?? 'ran'}${rt?.entry?.model ? ` (${rt.entry.model})` : ''}`);
  checks.readerTest = Boolean(rt?.entry);
  const id = readFrontmatter(readFileSync(join(home.root, D, 'hld.md')))?.value?.id;
  const r = await term(home, ['approve', id, '--file', `${D}/hld.md`], ['a', id, 'n']);
  appendEvent(openStore({ cwd: home.root, env: home.env }), { type: 'note', by: 'script', message: `probe --auto: ${id} approved with the probe home's key (with its ADR)` });
  log(r.out.split('\n').filter((l) => /^(HLD|PRD|ADR|approved|accepted|index|published|reader test|tickets):/.test(l)).join('\n'));
  if (r.code !== 0) log(r.err.trim());
  const ev = readJournal(openStore({ cwd: home.root, env: home.env })).events.filter((e) => e.type === 'approval' && (e.kind === 'hld' || e.kind === 'adr'));
  checks.approved = r.code === 0 && ev.some((e) => e.kind === 'hld') && ev.some((e) => e.kind === 'adr' && e.decision === 'accepted');
  const t = traceInitiative({ cwd: home.root, env: home.env, initiative: 'due-dates' });
  const design = t.links.filter((l) => /^N?FR-/.test(l.from) && l.where?.endsWith('hld.md'));
  for (const l of design) log(`trace: ${l.state} ${l.from} → ${l.to ?? l.what}`);
  checks.traced = design.length > 0 && design.every((l) => l.state === 'pass');
  return checks;
}

// P2: the pilot's template, read from thudos-setup's history.
export function p2(log, { mirror }) {
  const checks = {};
  const sha = execFileSync('/usr/bin/git', ['log', '--all', '--format=%H', '-n', '1', '--', '.claude/templates/hld-template.md'], { cwd: mirror, encoding: 'utf8' }).trim();
  const pilot = execFileSync('/usr/bin/git', ['show', `${sha}^:.claude/templates/hld-template.md`], { cwd: mirror, encoding: 'utf8' });
  const names = [...pilot.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  log(`the pilot's template: ${names.length} sections: ${names.join(' · ')}`);
  checks.sixteen = names.length === 16;
  const map = {
    'Context and scope': 'Context and accepted requirements', 'Solution strategy': 'Architecture overview', 'Building blocks': 'Components and ownership',
    'Key flows': 'Request, event, and data flows', Data: 'Data model and invariants', 'Risks and rollout': 'Deployment, rollout, and rollback',
    'Failure modes': 'Failure modes and recovery', Observability: 'Observability and operations',
  };
  const mapped = new Set([...Object.values(map), 'Test strategy']);
  const extras = names.filter((n) => !mapped.has(n));
  log(`renamed onto the core: ${Object.keys(map).length}; kept as its own: ${extras.join(', ')}`);
  const after = { 'Interfaces and contracts': 'Key flows', 'Transaction and consistency model': 'Data', 'Security and privacy': 'Failure modes', 'Performance and scale assumptions': 'Failure modes', 'Migration and mixed-version compatibility': 'Data', 'Alternatives and trade-offs': 'Decisions', 'Risks, unknowns, and follow-up decisions': 'Risks and rollout' };
  const overlay = ['kind = "document-type-overlay"', 'schema_version = 1', 'name = "hld"', '',
    ...Object.entries(map).flatMap(([from, to]) => ['[[rename]]', `from = ${JSON.stringify(from)}`, `to = ${JSON.stringify(to)}`, '']),
    ...extras.flatMap((n) => ['[[add]]', `name = ${JSON.stringify(n)}`, `after = ${JSON.stringify(after[n] ?? 'Risks and rollout')}`, '']),
  ].join('\n');
  const fragment = extras.map((n) => `## ${n}\n\n<!-- done when: the project's own section is filled -->\nThe project's own section, filled for this design.\n`).join('\n');
  const REGISTRY = loadRegistry(REGISTRY_DIR);
  const fs = new Map([['document-types/hld.toml', Buffer.from(overlay)], ['templates/hld.md', Buffer.from(fragment)]]);
  const overlays = readOverlays(fs, REGISTRY);
  const problems = overlays.flatMap((o) => o.problems);
  for (const p of problems) log(`overlay: ${p.reason ?? JSON.stringify(p)}`);
  checks.overlay = problems.length === 0;
  const registry = applyOverlays(REGISTRY, fs, overlays.map((o) => ({ type: 'approval', by: 'human', kind: 'overlay', path: o.path, content_hash: o.hash, ...(o.bound.length ? { files: o.bound } : {}), decision: 'accepted', seq: 1 }))).registry;
  // A hand-written HLD in the pilot's names: the example, renamed, with the pilot's own sections.
  let text = readFileSync(join(REGISTRY_DIR, 'examples', 'hld.md'), 'utf8');
  for (const [from, to] of Object.entries(map)) text = text.replace(new RegExp(`^## ${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), `## ${to}`);
  const order = registry.documentTypes.hld.section_order ?? [];
  const body = (n) => `## ${n}\n\nWritten for the pilot: what this design holds here, in a sentence or two.\n`;
  for (const n of extras) {
    const i = order.indexOf(n);
    const shown = (x) => map[x] ?? x;
    const next = order.slice(i + 1).map(shown).find((x) => new RegExp(`^## ${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(text));
    text = next ? text.replace(new RegExp(`^## ${next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), `${body(n)}\n## ${next}`) : `${text}\n${body(n)}`;
  }
  const root = join(REGISTRY_DIR, '..', 'test', 'fixtures', 'sample-app');
  const prd = readFileSync(join(REGISTRY_DIR, 'examples', 'prd.md'), 'utf8');
  const adr = readFileSync(join(REGISTRY_DIR, 'examples', 'adr.md'), 'utf8');
  const lint = lintText(text, { source: `${D}/hld.md`, registry, linked: { 'prd.md': prd, '../../decisions/ADR-0001-reminder-queue.md': adr }, repo: root }).filter((p) => p.severity === 'error');
  for (const p of lint) log(`lint: ${p.code} line ${p.line}: ${p.reason}`);
  checks.lintClean = lint.length === 0;
  checks.coreFound = /^## Trace table$/m.test(text) && /^## Decisions$/m.test(text) && /^## Components and ownership$/m.test(text);
  log(`the HLD in the pilot's names: ${lint.length} lint error(s); the trace table and Decisions ${checks.coreFound ? 'found' : 'missing'}`);
  return checks;
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, probe: { type: 'string' }, hld: { type: 'string' }, adr: { type: 'string' }, mirror: { type: 'string' }, home: { type: 'string' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  if (!['p1', 'p2'].includes(values.probe) || !values.yes || (values.probe === 'p1' && (!values.hld || !values.adr))) {
    process.stderr.write('--probe p1 --yes --hld <file> --adr <file> (Vera twice, one reader test, Sonnet) | --probe p2 --yes [--mirror <thudos-setup>] (no model)\n');
    return 2;
  }
  let checks;
  if (values.probe === 'p2') checks = p2(log, { mirror: values.mirror ?? join(process.env.HOME, 'Projects', 'thudos-setup') });
  else {
    const token = readToken(process.env);
    if (!token) throw new Error('no Claude login token: mirai token set');
    let home;
    const resumed = Boolean(values.home);
    if (resumed) {
      // A kept home (setupHome's layout): the same store, so Vera's rounds go on.
      const workdir = realpathSync(values.home);
      home = { workdir, root: join(workdir, 'repo'), home: join(workdir, 'home'), env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(workdir, 'home'), USER: process.env.USER, LANG: 'C' } };
    } else {
      const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
      home = { ...(await tessHome({ workdir, key: 'p1', c: { initiative: 'due-dates' }, claude: resolveClaude(process.env), token })), workdir, home: join(workdir, 'home') };
      const FIX = new URL('../fixtures/sample-due-dates/', import.meta.url).pathname;
      for (const n of ['brief.md', 'interview.md', 'prd.md']) writeFileSync(join(home.root, D, n), readFileSync(join(FIX, n)));
      writeFileSync(join(home.root, '.mirai/context/business.md'), readFileSync(join(FIX, 'business.md')));
      commit(home, 'probe: the owner-only due-dates documents');
      await seedPrdChecks(home, `${D}/prd.md`);
    }
    log(`the probe home: ${home.workdir}${resumed ? ' (resumed)' : ''}`);
    try {
      checks = await p1(home, log, { hldFile: values.hld, adrFile: values.adr, resumed });
    } catch (err) {
      log(`stopped: ${formatError(err, process.env).trim()}`);
      checks = { ran: false };
    }
    const pass = Object.values(checks).every(Boolean);
    if (pass) {
      spawnSync('/bin/chmod', ['-R', 'u+rwX', home.workdir]);
      rmSync(home.workdir, { recursive: true, force: true });
      log('the home is deleted');
    } else log(`the home is kept: ${home.workdir}`);
  }
  for (const [k, v] of Object.entries(checks)) log(`${v ? 'pass' : 'FAIL'}  ${k}`);
  const pass = Object.values(checks).every(Boolean);
  log(`${values.probe}: ${pass ? 'PASS' : 'FAIL'}`);
  return pass ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(formatError(err, process.env));
    process.exit(exitCodeOf(err));
  });
}
