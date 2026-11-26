#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { planPath, runPlan } from '../../src/agent/plan.js';
import { planTechNote } from '../../src/agent/tech-note.js';
import { exitCodeOf, formatError } from '../../src/cli/errors.js';
import { main } from '../../src/cli/main.js';
import { readFrontmatter } from '../../src/lint/frontmatter.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { hostFor, TOOLS_FILE } from '../../src/ship/host.js';
import { readToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { appendEvent, readJournal } from '../../src/store/journal.js';
import { runTess } from '../../src/tess/run.js';
import { runVerify } from '../../src/verify/run.js';
import { runReaderTest } from '../../src/write/reader.js';
import { fakeGh } from '../helpers/fake-hosts.js';
import { seedPrdChecks, tessHome } from './tess-probes.js';

// Unit 62b's probes (spec "Probes (real)"), in a probe home of 42's (the sample app, MIRAI, a key,
// your token), the red-team gate stubbed green, every approval signed with the probe home's key.
// - P1 (Vera on Sonnet, twice): the technical note for the due-dates PRD, written in this session
//   (`--note <file>`), with the ADR its D-4 links (`--adr <file>`, 61's P1 draft), proposed. The
//   lint, Vera's real checks of both (her findings printed for you to judge: about the content, not
//   the format), then the note's approval, which accepts its ADR on the same screen.
// - P2 (P1, then Tess and Kai on Sonnet): y to the offer after the note's approval; Tess cuts the
//   set from the PRD and the note; the set signed; Kai plans its first ticket. Pass when the tickets
//   split along the note's components, Kai's plan relies on the note's decisions, and a departure
//   seeded into his plan is flagged at the plan gate (the gate's screen, answered r).

const D = 'docs/mirai/due-dates';
const ADR_PATH = process.env.PROBE_ADR_PATH ?? "docs/decisions/ADR-0001-reminder-queue.md";
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const gitEnvOf = (home) => ({ PATH: '/usr/bin:/bin', HOME: home.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
const git = (home, ...a) => spawnSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: home.root, env: gitEnvOf(home), encoding: 'utf8' });
const commit = (home, message) => {
  git(home, 'add', '-A');
  if (git(home, 'status', '--porcelain').stdout.trim()) git(home, 'commit', '-qm', message, '--no-verify');
};
const note = (home, message) => appendEvent(openStore({ cwd: home.root, env: home.env }), { type: 'note', by: 'script', message: `probe --auto: ${message}` });

function withHost(home) {
  const bare = join(home.workdir, 'host.git');
  execFileSync('/usr/bin/git', ['init', '-q', '--bare', '-b', 'main', bare]);
  git(home, 'push', '-q', bare, 'main');
  const gh = fakeGh(bare);
  writeFileSync(join(openStore({ cwd: home.root, env: home.env }).dir, TOOLS_FILE), JSON.stringify({ schema_version: 1, github: gh.path }));
  return (a) => {
    const h = hostFor({ ...a, remoteUrl: 'https://github.com/acme/app.git' });
    return Object.defineProperties({ ...h, pushUrl: bare }, { ca: { get: () => h.ca } });
  };
}

async function term(home, argv, answers, extra = {}) {
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: home.env, cwd: home.root, ...extra });
  return { code, out, err };
}

async function vera(home, file, log) {
  const r = await runVerify({ cwd: home.root, env: home.env, file, launchToken: mintLaunchToken(), launchOptions: { status: green } });
  const e = r.entry;
  log(`Vera on ${file}: ${e ? `round ${e.round}, ${e.result}, ${e.must_fix} must-fix, ${e.suggestions} suggestion(s), model ${e.model}` : r.outcome}`);
  for (const f of e?.findings ?? []) log(`  ${f.grade} ${f.kind}${f.decision_type ? `/${f.decision_type}` : ''} [${f.layer}] line ${f.where?.line}: ${f.what}`);
  return e;
}

// The note's Components touched: the paths it cites.
const componentsOf = (text) => {
  const m = /^## +Components touched[ \t]*\n([^]*?)(?=^## )/m.exec(text);
  return [...(m ? m[1] : '').matchAll(/^- `([^`]+)`/gm)].map((x) => x[1]);
};

export async function p1(home, log, { noteFile, adrFile, startTess = null, hostOf }) {
  const checks = {};
  const prdId = readFrontmatter(readFileSync(join(home.root, D, 'prd.md')))?.value?.id;
  const a = await term(home, ['approve', prdId, '--file', `${D}/prd.md`], ['a', prdId, 'n'], { hostOf });
  note(home, `${prdId} approved with the probe home's key`);
  if (a.code !== 0) throw new Error(`the PRD's approval: ${a.err.trim()}`);
  if (adrFile) {
    mkdirSync(join(home.root, 'docs/decisions'), { recursive: true });
    writeFileSync(join(home.root, ADR_PATH), readFileSync(adrFile));
  }
  writeFileSync(join(home.root, D, 'tech-note.md'), readFileSync(noteFile));
  // The ADR folder's index, as `mirai adr new` and every approval keep it.
  if (adrFile) {
    const idx = await term(home, ['adr', 'index'], []);
    if (idx.code !== 0) throw new Error(`mirai adr index: ${idx.err.trim()}`);
  }
  commit(home, 'probe: the technical note and its ADR, written in the session');
  const lint = await term(home, ['lint', `${D}/tech-note.md`, ...(adrFile ? [ADR_PATH] : [])], []);
  log(lint.out.trim().split('\n').slice(-8).join('\n'));
  checks.lint = lint.code === 0;
  const words = readFileSync(join(home.root, D, 'tech-note.md'), 'utf8');
  log(`the note: ${words.split(/\s+/).length} raw words`);
  const ve = [...(adrFile ? [await vera(home, ADR_PATH, log)] : []), await vera(home, `${D}/tech-note.md`, log)];
  checks.vera = ve.every(Boolean);
  const open = ve.flatMap((e) => (e?.findings ?? []).filter((f) => f.grade === 'must-fix' && f.kind === 'writing'));
  if (open.length) {
    log(`stopped: ${open.length} must-fix writing finding(s): fix the note or the ADR in ${home.root}, then run again with --home ${home.workdir}`);
    checks.approved = false;
    return checks;
  }
  const noteId = readFrontmatter(readFileSync(join(home.root, D, 'tech-note.md')))?.value?.id;
  const r = await term(home, ['approve', noteId, '--file', `${D}/tech-note.md`], ['a', noteId, startTess ? 'y' : 'n'], { hostOf, ...(startTess ? { startTess } : {}) });
  note(home, `${noteId} approved with the probe home's key (with its ADR)`);
  log(r.out.split('\n').filter((l) => /^(technical note|PRD|ADR|approved|accepted|index|published|tickets):|Start Tess/.test(l)).join('\n'));
  if (r.code !== 0) log(r.err.trim());
  const ev = readJournal(openStore({ cwd: home.root, env: home.env })).events.filter((e) => e.type === 'approval' && (e.kind === 'tech-note' || e.kind === 'adr'));
  checks.approved = r.code === 0 && ev.some((e) => e.kind === 'tech-note' && e.decision === 'accepted') && (!adrFile || ev.some((e) => e.kind === 'adr' && e.decision === 'accepted'));
  if (adrFile) checks.adrAccepted = /^status: accepted$/m.test(readFileSync(join(home.root, ADR_PATH), 'utf8'));
  return checks;
}

export async function p2(home, log, o) {
  const tessLog = [];
  let tessEnd = null;
  const startTess = async () => {
    commit(home, 'probe: before her run');
    tessEnd = await runTess({ cwd: home.root, env: home.env, initiative: 'due-dates', nextToken: () => mintLaunchToken(), launchOptions: { status: green }, onStep: (e) => tessLog.push(`Tess: ${e.kind} ${e.step ?? ''} ${e.outcome ?? ''}`) });
    return tessEnd.state === 'done' ? 0 : 1;
  };
  const checks = await p1(home, log, { ...o, startTess });
  for (const l of tessLog) log(l);
  checks.tess = tessEnd?.state === 'done';
  if (!checks.tess) {
    log(`Tess ended ${tessEnd?.state ?? 'not at all'}: ${tessEnd?.why ?? ''}`);
    return checks;
  }
  commit(home, 'probe: her set');
  // The tickets along the note's components: each ticket names one, and most of them are named.
  const noteText = readFileSync(join(home.root, D, 'tech-note.md'), 'utf8');
  const comps = componentsOf(noteText);
  const dir = join(home.root, D, 'tickets');
  const tickets = readdirSync(dir).filter((n) => n.endsWith('.md')).sort().map((n) => ({ key: n.slice(0, -3), text: readFileSync(join(dir, n), 'utf8') }));
  const named = new Set();
  for (const t of tickets) {
    const own = comps.filter((c) => t.text.includes(c) || t.text.includes(c.split('/').at(-1)));
    for (const c of own) named.add(c);
    log(`ticket ${t.key}: ${own.length ? own.map((c) => c.split('/').at(-1)).join(', ') : '(names no component of the note)'}`);
  }
  checks.split = tickets.every((t) => comps.some((c) => t.text.includes(c) || t.text.includes(c.split('/').at(-1)))) && named.size >= Math.ceil(comps.length * 0.6);
  log(`components named by the tickets: ${named.size} of ${comps.length}`);
  // The set signed (reader test first), on main for Kai.
  const epic = readdirSync(join(home.root, D)).find((n) => /^epic-.*\.md$/.test(n));
  const epicId = readFrontmatter(readFileSync(join(home.root, D, epic)))?.value?.id;
  const rt = await runReaderTest({ cwd: home.root, env: home.env, file: `${D}/${epic}` });
  log(`reader test on the epic: ${rt?.entry?.result ?? rt?.outcome ?? 'ran'}`);
  const s = await term(home, ['approve', epicId, '--file', `${D}/${epic}`], ['a', epicId], { hostOf: o.hostOf });
  note(home, `the set ${epicId} approved with the probe home's key`);
  log(s.out.split('\n').filter((l) => /approved:/.test(l)).join('\n'));
  if (s.code !== 0) {
    log(s.err.trim());
    checks.signed = false;
    return checks;
  }
  checks.signed = true;
  const branch = git(home, 'branch', '--show-current').stdout.trim();
  git(home, 'switch', '-q', 'main');
  git(home, 'merge', '-q', '--no-edit', branch);
  return { ...checks, ...(await planPart(home, log, { first: /^\| *1 *\| *([A-Z]+-[0-9]+)/m.exec(readFileSync(join(home.root, D, epic), 'utf8'))?.[1] ?? tickets[0].key })) };
}

// Kai's part, on main with the set merged: the ticket approved (with the probe key), his plan, then
// a departure seeded into it and the plan gate's screen (answered r).
export async function planPart(home, log, { first }) {
  const checks = {};
  const ticketPath = `${D}/tickets/${first}.md`;
  const t = await term(home, ['approve', first, '--file', ticketPath], ['a', first]);
  note(home, `${first} approved with the probe home's key`);
  log(t.out.split('\n').filter((l) => /^approved/.test(l)).join('\n') || t.err.trim());
  if (t.code !== 0) return { ...checks, ticket: false };
  const plan = await runPlan({ cwd: home.root, env: home.env, ticket: first, launchTokens: [mintLaunchToken(), mintLaunchToken()], launchOptions: { status: green } });
  log(`Kai's plan of ${first}: ${plan.outcome}${plan.why ? `: ${plan.why}` : ''}; gate ${plan.gate?.gate ?? '-'}`);
  const store = openStore({ cwd: home.root, env: home.env });
  let text = '';
  try {
    text = readFileSync(planPath(store, first), 'utf8');
  } catch {
    text = '';
  }
  const p = planTechNote(text);
  log(`his plan's Technical note: ${p ? `relies on ${p.reliesOn.join(', ') || 'nothing'}; departs from ${p.departs.map((d) => d.d).join(', ') || 'nothing'}` : '(no section)'}`);
  checks.planCites = plan.outcome === 'waiting' && Boolean(p?.reliesOn.length);
  // A departure seeded into his plan is flagged at the gate (answered r: the plan goes back).
  if (text) {
    const seeded = /^## +Technical note[ \t]*\n/m.test(text)
      ? text.replace(/^(## +Technical note[ \t]*\n)/m, '$1\nDeparts from D-3: the probe seeds this departure to see the gate flag it.\n')
      : text.replace(/^## +Implementation log/m, '## Technical note\n\nDeparts from D-3: the probe seeds this departure to see the gate flag it.\n\n## Implementation log');
    writeFileSync(planPath(store, first), seeded);
    const g = await term(home, ['approve', first, '--plan'], ['r', 'the probe sends it back', first]);
    log(g.out.split('\n').filter((l) => /^(technical note|flag|accept the departure|why you|recorded)/.test(l)).join('\n'));
    checks.flagged = /^flag \(plan-departs-tech-note\): the plan departs from the technical note's D-3/m.test(g.out) && /it departs from the technical note \(D-3\)/.test(g.out);
  } else checks.flagged = false;
  return checks;
}

// The environment of a probe home of 42's (setupHome's), from its folder.
const homeAt = (workdir) => ({ workdir, root: join(workdir, 'repo'), home: join(workdir, 'home'), env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(workdir, 'home'), USER: process.env.USER, LANG: 'C' } });

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, probe: { type: 'string' }, note: { type: 'string' }, adr: { type: 'string' }, own: { type: 'boolean' }, home: { type: 'string' }, resume: { type: 'string' }, ticket: { type: 'string' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  // --resume <home> --ticket <KEY>: Kai's part only, in a kept home whose set is signed and merged.
  if (values.resume) {
    const home = homeAt(realpathSync(values.resume));
    let checks;
    try {
      checks = await planPart(home, log, { first: values.ticket });
    } catch (err) {
      log(`stopped: ${formatError(err, process.env).trim()}`);
      checks = { ran: false };
    }
    for (const [k, v] of Object.entries(checks)) log(`${v ? 'pass' : 'FAIL'}  ${k}`);
    const ok = Object.values(checks).every(Boolean);
    log(`plan part: ${ok ? 'PASS' : 'FAIL'}; the home is kept: ${home.workdir}`);
    return ok ? 0 : 1;
  }
  if (!['p1', 'p2'].includes(values.probe) || !values.yes || !values.note) {
    process.stderr.write('--probe p1|p2 --yes --note <file> [--adr <file>] [--own]: P1 Vera (Sonnet) and the approval; P2 then Tess and Kai (Sonnet). --own: the owner-only due-dates PRD (test/fixtures/sample-due-dates), which fits the sample app\n');
    return 2;
  }
  const token = readToken(process.env);
  if (!token) throw new Error('no Claude login token: mirai token set');
  const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
  const home = { ...(await tessHome({ workdir, key: values.probe, c: { initiative: 'due-dates' }, claude: resolveClaude(process.env), token })), workdir, home: join(workdir, 'home') };
  log(`the probe home: ${workdir}`);
  // --own: 44's owner-only documents (no teams, no email), which fit the sample app as it is. Their
  // checks are seeded as the home's own PRD's are (Vera's pass, a stand-in reader test).
  if (values.own) {
    const FIX = join(new URL('../fixtures/sample-due-dates/', import.meta.url).pathname);
    for (const n of ['brief.md', 'interview.md', 'prd.md']) writeFileSync(join(home.root, D, n), readFileSync(join(FIX, n)));
    writeFileSync(join(home.root, '.mirai/context/business.md'), readFileSync(join(FIX, 'business.md')));
    commit(home, 'probe: the owner-only due-dates documents');
    await seedPrdChecks(home, `${D}/prd.md`);
  }
  // The host is made on main, before her branch's work.
  git(home, 'switch', '-q', 'main');
  const hostOf = withHost(home);
  git(home, 'switch', '-q', '-');
  let checks;
  try {
    checks = await (values.probe === 'p1' ? p1 : p2)(home, log, { noteFile: values.note, adrFile: values.adr ?? null, hostOf });
  } catch (err) {
    log(`stopped: ${formatError(err, process.env).trim()}`);
    checks = { ran: false };
  }
  for (const [k, v] of Object.entries(checks)) log(`${v ? 'pass' : 'FAIL'}  ${k}`);
  const pass = Object.values(checks).every(Boolean);
  log(`${values.probe}: ${pass ? 'PASS' : 'FAIL'}`);
  if (pass) {
    spawnSync('/bin/chmod', ['-R', 'u+rwX', workdir]);
    rmSync(workdir, { recursive: true, force: true });
    log('the home is deleted');
  } else log(`the home is kept: ${workdir}`);
  return pass ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(formatError(err, process.env));
    process.exit(exitCodeOf(err));
  });
}
