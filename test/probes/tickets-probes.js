#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { exitCodeOf, formatError } from '../../src/cli/errors.js';
import { main } from '../../src/cli/main.js';
import { readFrontmatter } from '../../src/lint/frontmatter.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { hostFor, TOOLS_FILE } from '../../src/ship/host.js';
import { readToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { appendEvent, readJournal } from '../../src/store/journal.js';
import { runTess } from '../../src/tess/run.js';
import { tessStateLines } from '../../src/tess/state.js';
import { ticketRows } from '../../src/tickets/set-screen.js';
import { runReaderTest } from '../../src/write/reader.js';
import { fakeGh } from '../helpers/fake-hosts.js';
import { tessHome } from './tess-probes.js';

// Unit 45's probe P1 (spec "Probes (real)"): from an approved PRD to a merged ticket set, on the
// sample app, with the real ticket planner (Tess, Sonnet), the real verifier and the real reader
// test. The docs MR's host is a stand-in GitHub over a local bare repo (test/helpers/fake-hosts.js;
// 38's probes proved the real hosts), so MIRAI's merge is checked without touching a real repo.
// --auto answers every screen as written below, the probe home's own key signing (test tooling
// only, never your key; a journal note says so after each answer):
//   1. the PRD's approval: a, then y to the offer (her run starts in this terminal);
//   2. the set's screen: t; drop one ticket that blocks nothing and whose IDs another ticket also
//      covers ("a duplicate"), split one ("split it in two: the main path first, the failure
//      handling second"); keep the release mode; nothing is signed, the notes go to Tess;
//   3. her run again (the step `notes`), the reader test on the epic, then the screen again: a.
// P1 passes when every step ran with one command or key, each decision is in `mirai show`, and the
// merged docs MR holds documents only.
// P2 (the quick ticket, two actions) waits for Jet's answer on the quick plan gate (test-results.md).

const C = { initiative: 'due-dates', what: 'a real PRD to a merged set' };
const REMOTE = 'https://github.com/acme/app.git';
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const gitEnvOf = (home) => ({ PATH: '/usr/bin:/bin', HOME: home.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
const git = (home, ...a) => spawnSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: home.root, env: gitEnvOf(home), encoding: 'utf8' });
const commit = (home, message) => {
  git(home, 'add', '-A');
  if (git(home, 'status', '--porcelain').stdout.trim()) git(home, 'commit', '-qm', message);
};
const D = `docs/mirai/${C.initiative}`;
const note = (home, message) => appendEvent(openStore({ cwd: home.root, env: home.env }), { type: 'note', by: 'script', message: `probe --auto: ${message}` });

// The stand-in host: a bare repo the home pushes to, and fake gh on MIRAI's tools list.
function withHost(home) {
  const bare = join(home.workdir, 'host.git');
  execFileSync('/usr/bin/git', ['init', '-q', '--bare', '-b', 'main', bare]);
  // No `origin` in the repo (the store's id comes from it, and the home's store exists already):
  // the stand-in host takes the remote's URL itself, as 38's lone-ticket test does.
  git(home, 'push', '-q', bare, 'main');
  const gh = fakeGh(bare);
  writeFileSync(join(openStore({ cwd: home.root, env: home.env }).dir, TOOLS_FILE), JSON.stringify({ schema_version: 1, github: gh.path }));
  const hostOf = (a) => {
    const h = hostFor({ ...a, remoteUrl: REMOTE });
    return Object.defineProperties({ ...h, pushUrl: bare }, { ca: { get: () => h.ca } });
  };
  return { bare, hostOf, bareGit: (...a) => execFileSync('/usr/bin/git', ['--git-dir', bare, ...a]).toString().trim() };
}

// `mirai …` in a stand-in terminal, with the answers given.
async function term(home, argv, answers, extra = {}) {
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: home.env, cwd: home.root, ...extra });
  return { code, out, err };
}

async function tessRun(home, log, fakes = {}) {
  commit(home, 'probe: the work tree before her run');
  const onStep = (e) => log(e.kind === 'launch' ? `Tess: ${e.step} (round ${e.round}): ${e.outcome}` : e.kind === 'render' ? `epic render: ${e.problem ?? `${e.changed ? 'rendered' : 'up to date'} from ${e.tickets} ticket(s)`}` : e.kind === 'lint' ? `lint: ${e.errors ? `${e.errors} problem(s)` : 'clean'}` : `Vera: round ${e.round}, ${e.must_fix} must-fix${e.reused ? ' (reused)' : ''}`);
  const r = await runTess({ cwd: home.root, env: home.env, initiative: C.initiative, nextToken: () => mintLaunchToken(), launchOptions: { status: green }, onStep, ...(fakes.launch ? { launch: fakes.launch } : {}), ...(fakes.verifyLaunch ? { verifyLaunch: fakes.verifyLaunch } : {}) });
  for (const l of tessStateLines(readJournal(openStore({ cwd: home.root, env: home.env })).events, C.initiative)) log(l);
  return r;
}

const epicFile = (home) => readdirSync(join(home.root, D)).find((n) => /^epic-.*\.md$/.test(n));
const rowsOf = (home) => {
  const dir = join(home.root, D, 'tickets');
  return ticketRows(readdirSync(dir).filter((n) => n.endsWith('.md')).map((n) => ({ path: `${D}/tickets/${n}`, bytes: readFileSync(join(dir, n)), id: n.slice(0, -3) })));
};
// A ticket to drop: it blocks nothing, and every ID it covers another ticket covers too.
export function dropCandidate(rows) {
  return rows.find((r) => !r.blocks.length && r.covers.length && r.covers.every((id) => rows.some((o) => o.key !== r.key && o.covers.includes(id)))) ?? null;
}
// The screen's answers for `picks` ({ key: [answers] }), every other ticket kept.
const screen = (rows, picks) => rows.flatMap((r) => picks[r.key] ?? ['']);

// `fakes` (the dry run only): stand-ins for her launches, Vera's and the reader's.
export async function p1(home, log, fakes = {}) {
  const host = withHost(home);
  const checks = {};
  const prdId = readFrontmatter(readFileSync(join(home.root, D, 'prd.md')))?.value?.id;
  // 1. The PRD's approval, and y to the offer: her run starts in this terminal.
  let tessEnd = null;
  const startTess = async () => {
    tessEnd = await tessRun(home, log, fakes);
    return tessEnd.state === 'done' ? 0 : 1;
  };
  const a = await term(home, ['approve', prdId, '--file', `${D}/prd.md`], ['a', prdId, 'y'], { startTess, hostOf: host.hostOf });
  note(home, `${prdId} approved with the probe home's key; y to the offer`);
  log(a.out.split('\n').filter((l) => /^(approved|published|tickets:)|Start Tess/.test(l)).join('\n'));
  checks.offer = /Start Tess \(mirai-ticket-planner\) on the ticket set now\? \[y\/N\]/.test(a.out) && tessEnd !== null;
  if (a.code !== 0 || tessEnd?.state !== 'done') return { checks, why: `her first run ended ${tessEnd?.state ?? 'not at all'}: ${tessEnd?.why ?? a.err.trim().slice(0, 300)}` };
  commit(home, 'probe: her set');
  const epic = `${D}/${epicFile(home)}`;
  const epicId = readFrontmatter(readFileSync(join(home.root, epic)))?.value?.id;
  // 2. The screen: drop one, split one; nothing signed.
  const reader = async () => {
    const r = await runReaderTest({ cwd: home.root, env: home.env, file: epic, ...(fakes.readerLaunch ? { launch: fakes.readerLaunch, claude: fakes.readerClaude } : {}) });
    log(`reader test on the epic: ${r?.entry?.result ?? r?.outcome ?? 'ran'}`);
  };
  await reader();
  let rows = rowsOf(home);
  const drop = dropCandidate(rows);
  const change = rows.find((r) => r.key !== drop?.key) ?? null;
  log(`the screen: ${rows.length} tickets; drop ${drop?.key ?? '(none possible without a gap)'}; split ${change?.key}`);
  const picks = { ...(drop ? { [drop.key]: ['d', 'a duplicate: another ticket covers the same IDs'] } : {}), [change.key]: ['c', 's', 'Split it in two: the main path first, the failure handling second.'] };
  const s1 = await term(home, ['approve', epicId, '--file', epic], ['t', ...screen(rows, picks), '', epicId], { hostOf: host.hostOf });
  note(home, `the set's screen answered (drop ${drop?.key ?? 'none'}, split ${change.key})`);
  log(s1.out.split('\n').filter((l) => /^(nothing was signed|your notes|next:|dropped)/.test(l)).join('\n'));
  checks.screen = s1.code === 0 && /nothing was signed/.test(s1.out) && existsSync(join(home.root, D, 'ticket-notes.md'));
  checks.drop = Boolean(drop) && !existsSync(join(home.root, D, 'tickets', `${drop.key}.md`));
  if (!checks.screen) return { checks, why: `the screen ended ${s1.code}: ${s1.err.trim().slice(0, 300)}` };
  // 3. Her run again from your notes, then the screen again: a.
  const again = await tessRun(home, log, fakes);
  checks.notesRun = again.state === 'done';
  if (!checks.notesRun) return { checks, why: `her notes run ended ${again.state}: ${again.why ?? ''}` };
  commit(home, 'probe: her set after your notes');
  await reader();
  rows = rowsOf(home);
  const main0 = host.bareGit('rev-parse', 'refs/heads/main');
  const s2 = await term(home, ['approve', epicId, '--file', epic], ['a', epicId], { hostOf: host.hostOf });
  note(home, `the set ${epicId} approved with the probe home's key`);
  log(s2.out.split('\n').filter((l) => /approved:|^(release|published|merged):/.test(l)).join('\n'));
  if (s2.code !== 0) log(s2.err.trim());
  checks.signed = s2.code === 0 && /approved: the epic /.test(s2.out);
  checks.merged = /^merged: .* \(documents only\)$/m.test(s2.out);
  const changed = checks.merged ? host.bareGit('diff', '--name-only', main0, 'refs/heads/main').split('\n').filter(Boolean) : [];
  checks.docsOnly = checks.merged && changed.every((p) => p.startsWith(`${D}/`));
  const show = await term(home, ['show', C.initiative], []);
  checks.shown = /your decision, round 1: .* to split: /.test(show.out) && (!drop || new RegExp(`${drop.key} dropped`).test(show.out)) && /release: .*, signed with the set/.test(show.out);
  log(show.out.split('\n').filter((l) => /ticket decisions|your decision|release:/.test(l)).join('\n'));
  return { checks, why: null };
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, auto: { type: 'boolean' }, probe: { type: 'string' }, keep: { type: 'boolean' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  if (values.probe !== 'p1') {
    process.stderr.write('--probe p1 --yes --auto (P2 waits for the quick plan gate answer)\n');
    return 2;
  }
  if (!values.yes || !values.auto) {
    process.stderr.write('--yes --auto: Tess\'s runs on your Claude subscription (Sonnet), Vera on each version (Sonnet) and two reader tests; the probe home\'s key signs\n');
    return 2;
  }
  const token = readToken(process.env);
  if (!token) throw new Error('no Claude login token: mirai token set');
  const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
  const home = { ...(await tessHome({ workdir, key: 'p1', c: C, claude: resolveClaude(process.env), token })), workdir, home: join(workdir, 'home') };
  log(`the probe home: ${workdir}`);
  let r;
  try {
    r = await p1(home, log);
  } catch (err) {
    r = { checks: {}, why: formatError(err).trim() };
  }
  log('');
  log('--- p1: for your review ---');
  for (const [k, v] of Object.entries(r.checks)) log(`${v ? 'pass' : 'FAIL'}  ${k}`);
  const pass = !r.why && ['offer', 'screen', 'drop', 'notesRun', 'signed', 'merged', 'docsOnly', 'shown'].every((k) => r.checks[k]);
  if (r.why) log(`stopped: ${r.why}`);
  log(`p1: ${pass ? 'PASS' : 'FAIL'}`);
  if (pass && !values.keep) {
    spawnSync('/bin/chmod', ['-R', 'u+rwX', workdir]);
    rmSync(workdir, { recursive: true, force: true });
    log('the home is deleted');
  } else log(`the home is kept: ${workdir}`);
  return pass ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(formatError(err));
    process.exit(exitCodeOf(err));
  });
}
