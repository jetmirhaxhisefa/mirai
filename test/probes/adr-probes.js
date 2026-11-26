#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { adrSettings, indexPathOf, listAdrs, nextAdr, renderIndex, workTreeReader } from '../../src/adr/adr.js';
import { exitCodeOf, formatError } from '../../src/cli/errors.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { main } from '../../src/cli/main.js';
import { loadRegistry } from '../../src/config/registry.js';
import { adrFolderOf } from '../../src/detect/adr.js';
import { lintText, parseDocument, projectOf } from '../../src/lint/lint.js';
import { documentWords } from '../../src/lint/prd.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { readToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { appendEvent } from '../../src/store/journal.js';
import { traceInitiative } from '../../src/trace/initiative.js';
import { snapshot, trustedConfig } from '../../src/trust/snapshot.js';
import { runVerify } from '../../src/verify/run.js';
import { tessHome } from './tess-probes.js';

// Unit 61's probes (spec "Probes (real)").
// - P1 (about one Vera check, Sonnet): an ADR for the sample app's reminders (cron vs a queue),
//   written in the session with the mirai-write skill (`--adr <file>`), in a probe home of 42's.
//   MIRAI's gates on it: the lint (clean, under 600 words), Vera's real check (her findings are
//   printed for you to judge: about the decision, not the shape), your approval (with --auto, the
//   probe home's key, as 42's --auto does), the index, and `mirai trace` (its Confirmation link).
//   A must-fix writing finding stops it with the home kept: fix the ADR there, then run again with
//   --home <the home>.
// - P2 (no model): the local mirror thudos-setup, cloned: detection finds docs/decisions/ and
//   numbering adr-0001; the index lists its ADR-0001 as it is; the next ADR is adr-0002; its own
//   README.md is left alone (the index goes to index.md); nothing in the clone changes.

const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const git = (home, ...a) => spawnSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: home.root, env: { PATH: '/usr/bin:/bin', HOME: home.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, encoding: 'utf8' });

async function term(home, argv, answers = []) {
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: home.env, cwd: home.root });
  return { code, out, err };
}

export async function p1(home, log, { adr, auto }) {
  const checks = {};
  const slug = 'reminder-queue';
  const rel = `docs/decisions/ADR-0001-${slug}.md`;
  if (adr) {
    mkdirSync(join(home.root, 'docs/decisions'), { recursive: true });
    writeFileSync(join(home.root, rel), readFileSync(adr));
  }
  if (!existsSync(join(home.root, rel))) throw new Error(`no ADR at ${rel}: give the session's draft with --adr <file>`);
  const text = readFileSync(join(home.root, rel), 'utf8');
  const config = trustedConfig(snapshot({ cwd: home.root, env: home.env }));
  const registry = loadRegistry(REGISTRY_DIR);
  const prd = readFileSync(join(home.root, 'docs/mirai/due-dates/prd.md'), 'utf8');
  const problems = lintText(text, { source: rel, registry, project: projectOf(config), approving: true, linked: { '../mirai/due-dates/prd.md': prd }, adrRoot: home.root });
  for (const p of problems) log(`lint: ${p.severity} ${p.code} line ${p.line}: ${p.reason}`);
  const words = documentWords(parseDocument(text, rel), registry.documentTypes.adr);
  log(`lint: ${problems.length} problem(s); ${words} words`);
  checks.lint = problems.length === 0 && words <= 600;
  if (!checks.lint) return checks;
  git(home, 'add', '-A');
  git(home, 'commit', '-qm', 'probe: the ADR as written in the session', '--no-verify');
  const r = await runVerify({ cwd: home.root, env: home.env, file: rel, launchToken: mintLaunchToken(), launchOptions: { status: green } });
  const entry = r.entry;
  log(`Vera: ${entry ? `round ${entry.round}, ${entry.result}, ${entry.must_fix} must-fix, ${entry.suggestions} suggestion(s), model ${entry.model}` : r.outcome}`);
  for (const f of entry?.findings ?? []) log(`  ${f.grade} ${f.kind}${f.decision_type ? `/${f.decision_type}` : ''} [${f.layer}] line ${f.where?.line}: ${f.what}`);
  checks.vera = Boolean(entry);
  const writingOpen = (entry?.findings ?? []).filter((f) => f.grade === 'must-fix' && f.kind === 'writing');
  if (writingOpen.length) {
    log(`stopped: ${writingOpen.length} must-fix writing finding(s): fix ${join(home.root, rel)}, then run again with --home ${home.workdir}`);
    checks.approved = false;
    return checks;
  }
  if (!auto) {
    log(`approve it in Terminal: cd ${home.root} && mirai approve ADR-0001 --file ${rel}; then run again with --home ${home.workdir}`);
    checks.approved = false;
    return checks;
  }
  const a = await term(home, ['approve', 'ADR-0001', '--file', rel], ['a', 'ADR-0001']);
  log((a.out + a.err).trim().split('\n').map((l) => `approve: ${l}`).join('\n'));
  appendEvent(openStore({ cwd: home.root, env: home.env }), { type: 'note', by: 'script', message: 'probe --auto: ADR-0001 approved with the probe home\'s key, not yours' });
  checks.approved = a.code === 0 && /^status: accepted$/m.test(readFileSync(join(home.root, rel), 'utf8'));
  const s = adrSettings(config);
  const index = readFileSync(join(home.root, indexPathOf(workTreeReader(home.root), s)), 'utf8');
  log(`index: ${index.split('\n').find((l) => l.startsWith('| [ADR-0001]')) ?? '(no row)'}`);
  checks.indexed = /\| \[ADR-0001\]\(ADR-0001-reminder-queue\.md\) \|.*\| accepted \|/.test(index);
  const t = traceInitiative({ cwd: home.root, env: home.env, initiative: 'due-dates' });
  const links = t.links.filter((l) => l.from === 'ADR-0001');
  for (const l of links) log(`trace: ${l.state} ADR-0001 → ${l.to ?? l.what}`);
  checks.traced = links.length > 0 && links.every((l) => l.state === 'pass' || l.state === 'pending');
  return checks;
}

export function p2(log, { mirror }) {
  const checks = {};
  const dir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
  const clone = join(dir, 'thudos');
  try {
    const c = spawnSync('/usr/bin/git', ['clone', '-q', '--no-hardlinks', mirror, clone], { encoding: 'utf8' });
    if (c.status !== 0) throw new Error(`git clone: ${c.stderr}`);
    const files = spawnSync('/usr/bin/git', ['ls-files'], { cwd: clone, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
    const found = adrFolderOf(files);
    log(`detect: ${JSON.stringify(found)}`);
    checks.detected = found?.folder === 'docs/decisions' && found.numbering === 'adr-0001';
    const s = adrSettings({ adr: { folder: found?.folder, numbering: found?.numbering } });
    const reader = workTreeReader(clone);
    const before = Object.fromEntries(files.filter((f) => f.startsWith('docs/decisions/')).map((f) => [f, sha(readFileSync(join(clone, f)))]));
    const adrs = listAdrs(reader, s);
    for (const a of adrs) log(`ADR: ${a.id} "${a.title}" ${a.status} ${a.date ?? ''} (MIRAI's: ${a.mirai})`);
    checks.asIs = adrs.length >= 1 && adrs[0].id === 'adr-0001' && adrs[0].status === 'accepted' && !adrs[0].mirai;
    const next = nextAdr(adrs, s, 'probe-next');
    log(`next: ${next.path}`);
    checks.next = next.path === 'docs/decisions/adr-0002-probe-next.md';
    const indexPath = indexPathOf(reader, s);
    const index = renderIndex(adrs);
    log(`index: ${indexPath}\n${index}`);
    checks.index = indexPath === 'docs/decisions/index.md' && /\| \[adr-0001\]\(adr-0001-[^)]+\.md\) \| Local development reverse proxy and real domain names \| accepted \|/.test(index);
    const after = Object.fromEntries(Object.keys(before).map((f) => [f, sha(readFileSync(join(clone, f)))]));
    checks.unchanged = JSON.stringify(before) === JSON.stringify(after) && spawnSync('/usr/bin/git', ['status', '--porcelain'], { cwd: clone, encoding: 'utf8' }).stdout.trim() === '';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return checks;
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, probe: { type: 'string' }, adr: { type: 'string' }, auto: { type: 'boolean' }, home: { type: 'string' }, mirror: { type: 'string' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  if (!['p1', 'p2'].includes(values.probe) || !values.yes) {
    process.stderr.write('--probe p1 --yes --adr <file> [--auto] [--home <dir>]: P1 one Vera check (Sonnet) on a session-written ADR; --probe p2 --yes [--mirror <path>]: Thudos\'s ADR folder, no model\n');
    return 2;
  }
  let checks;
  if (values.probe === 'p2') {
    checks = p2(log, { mirror: values.mirror ?? join(process.env.HOME, 'Projects', 'thudos-setup') });
  } else {
    const token = readToken(process.env);
    if (!token) throw new Error('no Claude login token: mirai token set');
    let home;
    if (values.home) {
      const workdir = realpathSync(values.home);
      home = JSON.parse(readFileSync(join(workdir, 'probe-home.json'), 'utf8'));
    } else {
      const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
      home = { ...(await tessHome({ workdir, key: 'p1', c: { initiative: 'due-dates' }, claude: resolveClaude(process.env), token })), workdir, home: join(workdir, 'home') };
      writeFileSync(join(workdir, 'probe-home.json'), JSON.stringify(home));
    }
    log(`the probe home: ${home.workdir}`);
    try {
      checks = await p1(home, log, { adr: values.adr ?? null, auto: Boolean(values.auto) });
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
