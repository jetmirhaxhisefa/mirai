#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { exitCodeOf, formatError } from '../../src/cli/errors.js';
import { main } from '../../src/cli/main.js';
import { readFrontmatter } from '../../src/lint/frontmatter.js';
import { lldItemIds } from '../../src/lint/lld-items.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { readToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { appendEvent, readJournal } from '../../src/store/journal.js';
import { runTess } from '../../src/tess/run.js';
import { tessStateLines } from '../../src/tess/state.js';
import { runVerify } from '../../src/verify/run.js';
import { runsOf } from '../../src/verify/gate.js';
import { snapshot, trustedConfig } from '../../src/trust/snapshot.js';
import { runReaderTest } from '../../src/write/reader.js';
import { FAKE_CLAUDE, fakeReader } from '../helpers/reader.js';
import { passVera } from '../helpers/vera.js';
import { seedPrdChecks, tessHome } from './tess-probes.js';

// Unit 63's probes (spec "Probes (real)"), in one probe home:
// - P1 (Vera on Sonnet): the owner-only due dates on `full`, with 62's P1 HLD and ADR (approved
//   here with their checks seeded: 62's P1 ran them for real) and an LLD written in this session
//   (`--lld <file>`). The lint, Vera's real findings (printed for you to judge: about the shapes, not
//   the format), the approval (the HLD approved and saying `lld: required`).
// - P2 (Tess, real): she cuts the set from the PRD, the HLD, its ADR and the LLD; every ticket's
//   `uses` resolves and every LLD item is used (the ticket and epic lint).
//
//   node test/probes/lld-probes.js --yes --probe p1 --lld <file> [--home <dir>]
//   node test/probes/lld-probes.js --yes --probe p2 --home <dir>      (after P1 passed in that home)
//   node test/probes/lld-probes.js --yes --probe p1 --seeded --lld <file>   (P2's home: the LLD's Vera pass seeded)

const D = 'docs/mirai/due-dates';
const ADR_PATH = 'docs/decisions/ADR-0001-browser-time-zone.md';
const U62 = new URL('../../implementation/units/62-hld/p1/', import.meta.url).pathname;
const FIX = new URL('../fixtures/sample-due-dates/', import.meta.url).pathname;
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
const note = (home, message) => appendEvent(openStore({ cwd: home.root, env: home.env }), { type: 'note', by: 'script', message });
const idOf = (home, rel) => readFrontmatter(readFileSync(join(home.root, rel)))?.value?.id;

// The home: the owner-only documents on `full`, the PRD approved; 62's HLD and ADR approved.
async function setup(home, log) {
  for (const n of ['brief.md', 'interview.md']) writeFileSync(join(home.root, D, n), readFileSync(join(FIX, n)));
  writeFileSync(join(home.root, D, 'prd.md'), readFileSync(join(FIX, 'prd.md'), 'utf8').replace('track: standard', 'track: full'));
  writeFileSync(join(home.root, '.mirai/context/business.md'), readFileSync(join(FIX, 'business.md')));
  commit(home, 'probe: the owner-only due-dates documents, on full');
  await seedPrdChecks(home, `${D}/prd.md`);
  // On full the brief is approved on its own, before its PRD.
  const briefId = idOf(home, `${D}/brief.md`);
  const b = await term(home, ['approve', briefId, '--file', `${D}/brief.md`], ['a', briefId, 'n']);
  if (b.code !== 0) throw new Error(`the brief's approval: ${b.err.trim()}`);
  note(home, `probe --auto: ${briefId} approved with the probe home's key`);
  const prdId = idOf(home, `${D}/prd.md`);
  const a = await term(home, ['approve', prdId, '--file', `${D}/prd.md`], ['a', prdId, 'n']);
  if (a.code !== 0) throw new Error(`the PRD's approval: ${a.err.trim()}`);
  note(home, `probe --auto: ${prdId} approved with the probe home's key`);
  mkdirSync(join(home.root, 'docs/decisions'), { recursive: true });
  writeFileSync(join(home.root, ADR_PATH), readFileSync(join(U62, 'adr-final.md')));
  writeFileSync(join(home.root, D, 'hld.md'), readFileSync(join(U62, 'hld-final.md')));
  const idx = await term(home, ['adr', 'index'], []);
  if (idx.code !== 0) throw new Error(`mirai adr index: ${idx.err.trim()}`);
  commit(home, 'probe: 62\'s P1 HLD and ADR');
  const f = { root: home.root, env: home.env };
  passVera(f, ADR_PATH);
  passVera(f, `${D}/hld.md`);
  const r = fakeReader();
  await runReaderTest({ cwd: home.root, env: home.env, file: `${D}/hld.md`, launch: r.launch, claude: FAKE_CLAUDE });
  const hldId = idOf(home, `${D}/hld.md`);
  const h = await term(home, ['approve', hldId, '--file', `${D}/hld.md`], ['a', hldId, 'n']);
  if (h.code !== 0) throw new Error(`the HLD's approval: ${h.err.trim()}`);
  note(home, `probe --auto: ${hldId} approved with the probe home's key (with its ADR; checks seeded, 62's P1 ran them)`);
  log(h.out.split('\n').filter((l) => /^(approved|accepted):/.test(l)).join('\n'));
}

async function vera(home, file, log) {
  const r = await runVerify({ cwd: home.root, env: home.env, file, launchToken: mintLaunchToken(), launchOptions: { status: green } });
  const e = r.entry;
  log(`Vera on ${file}: ${e ? `round ${e.round}, ${e.result}, ${e.must_fix} must-fix, ${e.suggestions} suggestion(s), model ${e.model}` : r.outcome}`);
  for (const f of e?.findings ?? []) log(`  ${f.grade} ${f.kind}${f.decision_type ? `/${f.decision_type}` : ''} [${f.layer}] line ${f.where?.line}: ${f.what}`);
  return e;
}

export async function p1(home, log, { lldFile, resumed, seeded = false }) {
  const checks = {};
  if (!resumed) await setup(home, log);
  writeFileSync(join(home.root, D, 'lld.md'), readFileSync(lldFile));
  commit(home, 'probe: the LLD, written in the session');
  const lint = await term(home, ['lint', `${D}/lld.md`], []);
  log(lint.out.trim().split('\n').filter((l) => !/hint:|warning:/.test(l)).slice(-6).join('\n'));
  checks.lint = lint.code === 0;
  // --seeded (for P2's home): P1 proved this LLD through Vera's real rounds; seed her pass here.
  if (seeded) passVera({ root: home.root, env: home.env }, `${D}/lld.md`);
  const e = seeded ? { round: 1, findings: [] } : await vera(home, `${D}/lld.md`, log);
  checks.vera = Boolean(e);
  const runs = runsOf(trustedConfig(snapshot({ cwd: home.root, env: home.env })), 'verify');
  const open = e && e.round < runs ? (e.findings ?? []).filter((f) => f.grade === 'must-fix') : [];
  if (e && e.round >= runs && (e.findings ?? []).some((f) => f.grade === 'must-fix')) log(`past Vera's last round (${runs}): must-fix findings open; approved anyway, named in the signed line`);
  if (open.length) {
    log(`stopped: ${open.length} must-fix finding(s): fix the LLD, then run again with --home ${home.workdir}`);
    checks.approved = false;
    return checks;
  }
  const id = idOf(home, `${D}/lld.md`);
  const r = await term(home, ['approve', id, '--file', `${D}/lld.md`], ['a', id, 'n']);
  note(home, `probe --auto: ${id} approved with the probe home's key`);
  log(r.out.split('\n').filter((l) => /^(LLD|HLD|approved|published|tickets):/.test(l)).join('\n'));
  if (r.code !== 0) log(r.err.trim());
  const ev = readJournal(openStore({ cwd: home.root, env: home.env })).events.filter((x) => x.type === 'approval' && x.kind === 'lld');
  checks.approved = r.code === 0 && ev.length > 0;
  return checks;
}

export async function p2(home, log) {
  const checks = {};
  commit(home, 'probe: the work tree before Tess');
  const onStep = (e) => log(e.kind === 'launch' ? `Tess: ${e.step} (round ${e.round}): ${e.outcome}` : e.kind === 'render' ? `epic render: ${e.problem ?? `${e.changed ? 'rendered' : 'up to date'} from ${e.tickets} ticket(s)`}` : e.kind === 'lint' ? `lint: ${e.errors ? `${e.errors} problem(s)` : 'clean'}` : `Vera: round ${e.round}, ${e.must_fix} must-fix${e.reused ? ' (reused)' : ''}`);
  const r = await runTess({ cwd: home.root, env: home.env, initiative: 'due-dates', one: false, nextToken: () => mintLaunchToken(), launchOptions: { status: green }, onStep });
  for (const l of tessStateLines(readJournal(openStore({ cwd: home.root, env: home.env })).events, 'due-dates')) log(l);
  const dir = join(home.root, D, 'tickets');
  const items = new Set(lldItemIds(readFileSync(join(home.root, D, 'lld.md'), 'utf8')));
  const used = new Set();
  let unknown = 0;
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.md')).sort() : [];
  for (const n of files) {
    const v = readFrontmatter(readFileSync(join(dir, n)))?.value ?? {};
    const uses = Array.isArray(v.uses) ? v.uses : [];
    for (const u of uses) (items.has(u) ? used.add(u) : unknown++);
    log(`${n}: ${v.type} ${v.id}: uses [${uses.join(', ')}]`);
  }
  log(`LLD items: ${[...items].join(', ')}; used: ${[...used].join(', ') || 'none'}; unknown cited: ${unknown}`);
  log(`her run: ${r.state}${r.why ? `: ${r.why}` : ''}`);
  checks.runDone = r.state === 'done';
  checks.tickets = files.length > 0;
  checks.usesResolve = unknown === 0;
  checks.everyItemUsed = [...items].every((i) => used.has(i));
  const lint = await term(home, ['lint', D], []);
  log(lint.out.trim().split('\n').filter((l) => /error|uses|lld/.test(l)).slice(0, 10).join('\n') || 'lint: clean');
  checks.lint = lint.code === 0;
  log(`commits: ${r.commits.map((s) => s.slice(0, 12)).join(', ') || 'none'}`);
  return checks;
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, probe: { type: 'string' }, lld: { type: 'string' }, home: { type: 'string' }, seeded: { type: 'boolean' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  if (!values.yes || !['p1', 'p2'].includes(values.probe) || (values.probe === 'p1' && !values.lld) || (values.probe === 'p2' && !values.home)) {
    process.stderr.write('--yes --probe p1 --lld <file> [--home <dir>] | --yes --probe p2 --home <dir>\n');
    return 2;
  }
  const token = readToken(process.env);
  if (!token) throw new Error('no Claude login token: mirai token set');
  let home;
  const resumed = Boolean(values.home);
  if (resumed) {
    const workdir = realpathSync(values.home);
    home = { workdir, root: join(workdir, 'repo'), home: join(workdir, 'home'), env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(workdir, 'home'), USER: process.env.USER, LANG: 'C' } };
  } else {
    const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
    home = { ...(await tessHome({ workdir, key: 'p1', c: { initiative: 'due-dates' }, claude: resolveClaude(process.env), token })), workdir, home: join(workdir, 'home') };
  }
  log(`the probe home: ${home.workdir}${resumed ? ' (resumed)' : ''}`);
  let checks;
  try {
    checks = values.probe === 'p1' ? await p1(home, log, { lldFile: values.lld, resumed, seeded: Boolean(values.seeded) }) : await p2(home, log);
  } catch (err) {
    log(`stopped: ${formatError(err, process.env).trim()}`);
    checks = { ran: false };
  }
  const pass = Object.values(checks).every(Boolean);
  if (pass && values.probe === 'p2') {
    spawnSync('/bin/chmod', ['-R', 'u+rwX', home.workdir]);
    rmSync(home.workdir, { recursive: true, force: true });
    log('the home is deleted');
  } else log(`the home is kept: ${home.workdir}`);
  for (const [k, v] of Object.entries(checks)) log(`${v ? 'pass' : 'FAIL'}  ${k}`);
  log(`${values.probe}: ${pass ? 'PASS' : 'FAIL'}`);
  return pass ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(formatError(err, process.env));
    process.exit(exitCodeOf(err));
  });
}
