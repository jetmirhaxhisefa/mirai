#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { main } from '../../src/cli/main.js';
import { init } from '../../src/install/init.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { readToken, writeToken } from '../../src/sign/token.js';
import { redact } from '../../src/redteam/claude.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { QUESTIONS, runReaderTest, summaryText } from '../../src/write/reader.js';
import { loadRegistry } from '../../src/config/registry.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { projectOverlays } from '../../src/trust/overlays.js';
import { parseDocument, readTicketFolder } from '../../src/lint/lint.js';
import { aliased, checkIds, linkLinesOf } from '../../src/lint/rules.js';
import { renderSections, ticketSet } from '../../src/lint/epic.js';
import { prdItems } from '../../src/lint/graph.js';
import { recordingLaunch } from './reader-probes.js';

// Unit 37's P1: a company-style PRD on the sample app. A scratch project (the sample app's fixture
// copy, MIRAI from this checkout, a probe home with its own key and store) whose PRD type has an
// approved overlay: "Data privacy" and "Security sign-off" added, both required, and "Summary for
// approval" renamed "Executive summary". A fresh agent writes the PRD from 31's P2 brief; then:
//   node test/probes/overlay-p1-probes.js --setup <dir>        builds the project and its kit
//   node test/probes/overlay-p1-probes.js --reader [<dir>] --yes   the reader test on the PRD, with
//                                                              the overlay (one Sonnet run)
//   node test/probes/overlay-p1-probes.js --epic [<dir>]       the lint with the graph lint on an
//                                                              epic and tickets beside the PRD,
//                                                              and the coverage
// With no <dir>: $MIRAI_P1_DIR, else the folder the last --setup wrote to
// ~/.mirai-probes/u37-p1-dir. The build runner passes only --yes, so it runs the two wrappers,
// overlay-p1-reader-probes.js and overlay-p1-epic-probes.js, which use that folder.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const FIXTURE = join(ROOT, 'test', 'fixtures', 'sample-app');
const BRIEF = join(ROOT, 'implementation', 'units', '31-brief', 'p2-agent-brief.md');
export const INITIATIVE = 'docs/mirai/task-comments';
export const PRD_PATH = `${INITIATIVE}/prd.md`;
const OVERLAY = `kind = "document-type-overlay"
schema_version = 1
name = "prd"

# The company's PRD (unit 37's P1): two sections of its own, and its name for the summary.
[[add]]
name = "Data privacy"
after = "User journeys"

[[add]]
name = "Security sign-off"
after = "Glossary"

[[rename]]
from = "Summary for approval"
to = "Executive summary"
`;
const FRAGMENTS = `## Data privacy

<!-- Which personal data the feature reads, stores or sends, why, who can see it, and how long it is
kept. Name each kind of data and the requirement (FR, NFR) that touches it. If the feature touches
no personal data, write: Not applicable — <why>. -->
The personal data this feature reads, stores or sends, who can see it, and how long it is kept.

## Security sign-off

<!-- Who must sign off the security review before release, what they check, and its state: the
reviewer's role, the date, and "pending" or "signed". -->
The reviewer who signs off the feature's security, what they check, and the state of the review.
`;

const pointer = (home) => join(home, '.mirai-probes', 'u37-p1-dir');

// The probe's folder: the one given, $MIRAI_P1_DIR, or the last --setup's.
export function probeDir(given = null, env = process.env) {
  if (given) return resolve(given);
  if (env.MIRAI_P1_DIR) return resolve(env.MIRAI_P1_DIR);
  try {
    return readFileSync(pointer(env.HOME), 'utf8').trim();
  } catch {
    throw new Error(`no probe folder: name it, set MIRAI_P1_DIR, or run --setup first (it writes ${pointer(env.HOME)})`);
  }
}

// The project's environment: the probe home, this Node first on PATH.
const projectEnv = (dir) => ({ PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(dir, 'home'), USER: process.env.USER ?? 'probe', LANG: 'C' });

// A MIRAI command in the project, as from a terminal (answers on stdin).
async function mirai(argv, dir, answers = []) {
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: projectEnv(dir), cwd: join(dir, 'repo') });
  return { code, out, err };
}

function copyTree(from, to) {
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) {
      mkdirSync(dst, { recursive: true });
      copyTree(src, dst);
    } else cpSync(src, dst);
  }
}

// The lint command, as you run it from <dir>: this checkout's MIRAI, in the project's framework copy.
export const lintCommand = (dir) => `cd ${dir}/repo && HOME=${dir}/home ${process.execPath} .mirai/framework/bin/mirai.js lint ${INITIATIVE}/`;

async function setup(dir, log) {
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} isn't empty: give a new folder`);
  for (const d of ['repo', 'kit']) mkdirSync(join(dir, d), { recursive: true });
  mkdirSync(join(dir, 'home'), { recursive: true, mode: 0o700 });
  dir = realpathSync(dir);
  const repo = join(dir, 'repo');
  const env = projectEnv(dir);
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: env.HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: repo, env: gitEnv }).toString();
  const put = (rel, text) => {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), text);
  };

  // The sample app's fixture copy, then MIRAI from this checkout, a probe key, committed.
  git('init', '-q', '-b', 'main');
  copyTree(FIXTURE, repo);
  writeFileSync(join(repo, '.gitignore'), '.env\nnode_modules/\nvendor/\n');
  git('add', '-A');
  git('commit', '-qm', 'the sample app (fixture copy)');
  init({ cwd: repo, env, branch: 'main' });
  const key = createKeyPair(env);
  writePublicKeyFile(repo, key.keyId, key.publicPem);
  git('add', '-A');
  git('commit', '-qm', 'MIRAI and a probe key');

  // The PRD overlay, on main, approved through the CLI with the probe key; its record committed.
  put('.mirai/custom/document-types/prd.toml', OVERLAY);
  put('.mirai/custom/templates/prd.md', FRAGMENTS);
  git('add', '-A');
  git('commit', '-qm', 'the company PRD overlay');
  const approved = await mirai(['approve', '--file', '.mirai/custom/document-types/prd.toml'], dir, ['a', 'overlay-prd']);
  if (approved.code !== 0) throw new Error(`the overlay's approval failed (exit ${approved.code}): ${approved.err}${approved.out}`);
  git('add', '-A');
  git('commit', '-qm', 'the PRD overlay\'s approval record');

  // 31's P2 brief, the PRD's upstream.
  put(`${INITIATIVE}/brief.md`, readFileSync(BRIEF, 'utf8'));
  git('add', '-A');
  git('commit', '-qm', '31\'s P2 brief');

  // The kit: the template as the overlay renders it, the checklist, mirai-write and its PRD guide.
  const shown = await mirai(['show', 'template', 'prd'], dir);
  if (shown.code !== 0 || shown.err) throw new Error(`mirai show template prd: ${shown.err}`);
  writeFileSync(join(dir, 'kit', 'prd-template.md'), shown.out);
  const fw = join(repo, '.mirai', 'framework', 'registry');
  cpSync(join(fw, 'templates', 'prd-checklist.md'), join(dir, 'kit', 'prd-checklist.md'));
  cpSync(join(fw, 'skills', 'mirai-write', 'SKILL.md'), join(dir, 'kit', 'mirai-write-SKILL.md'));
  cpSync(join(fw, 'skills', 'mirai-write', 'guides', 'prd.md'), join(dir, 'kit', 'mirai-write-prd-guide.md'));
  for (const want of ['## Executive summary', '## Data privacy', '## Security sign-off']) {
    if (!shown.out.split('\n').includes(want)) throw new Error(`the rendered template has no "${want}"`);
  }
  if (shown.out.split('\n').includes('## Summary for approval')) throw new Error('the rendered template still has "## Summary for approval"');

  // The lint command works: on the template itself, only leftover template text and what follows
  // from the template's placeholder ids. The file is taken away again for the agent.
  put(PRD_PATH, shown.out);
  const lint = spawnSync('/bin/sh', ['-c', lintCommand(dir)], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  rmSync(join(repo, PRD_PATH));
  const codes = {};
  for (const m of (lint.stdout ?? '').matchAll(/^[^:\n]+prd\.md:\d+:\d+: (?!warning)(.*)$/gm)) codes[m[1].slice(0, 60)] = (codes[m[1].slice(0, 60)] ?? 0) + 1;

  try {
    mkdirSync(dirname(pointer(process.env.HOME)), { recursive: true });
    writeFileSync(pointer(process.env.HOME), `${dir}\n`);
  } catch (err) {
    log(`note: couldn't write ${pointer(process.env.HOME)} (${err.code}): pass the folder, or set MIRAI_P1_DIR`);
  }
  log(`project:      ${repo}`);
  log(`probe home:   ${env.HOME}`);
  log(`kit:          ${join(dir, 'kit')}/ (prd-template.md, prd-checklist.md, mirai-write-SKILL.md, mirai-write-prd-guide.md)`);
  log(`brief:        ${join(repo, INITIATIVE, 'brief.md')}`);
  log(`write the PRD: ${join(repo, PRD_PATH)}`);
  log(`lint:         ${lintCommand(dir)}`);
  log(`the lint on the template: exit ${lint.status}; last line: ${(lint.stdout ?? '').trim().split('\n').at(-1)}`);
  return 0;
}

async function reader(dir, log) {
  const env = projectEnv(dir);
  const token = readToken(process.env);
  if (!token) throw new Error('no Claude login token: mirai token set');
  writeToken(env, token);
  const claude = resolveClaude(process.env);
  const text = readFileSync(join(dir, 'repo', PRD_PATH), 'utf8');
  const summary = summaryText(text, { 'Summary for approval': 'Executive summary' });
  if (!summary) throw new Error(`${PRD_PATH} has no "## Executive summary" the reader could get`);
  log(`the summary the reader gets: ${summary.split('\n').length} lines, from "## Executive summary"`);
  const rec = recordingLaunch();
  const r = await runReaderTest({ cwd: join(dir, 'repo'), env, file: PRD_PATH, launch: rec.launch, claude: claude.real });
  log(`P1 reader test on ${PRD_PATH}: ${r.entry.result.toUpperCase()}${r.reused ? ' (recorded before, no run)' : ''} (round ${r.entry.round ?? 1}, model ${r.entry.model})`);
  const clean = (t) => redact(String(t ?? ''), token).replace(/\s+/g, ' ').slice(0, 300);
  for (const q of QUESTIONS) {
    const a = r.entry.answers?.[q.key];
    log(`- ${q.label}: ${r.entry.failed.includes(q.key) ? 'FAIL' : 'ok'}; answer ${JSON.stringify(clean(a?.answer))}; quote ${JSON.stringify(clean(a?.quote))}${a?.why ? `; ${clean(a.why)}` : ''}`);
  }
  const cost = rec.runs.map((x) => x.result?.total_cost_usd).filter((c) => typeof c === 'number').reduce((n, c) => n + c, 0);
  log(`run cost: $${cost.toFixed(4)}`);
  return r.entry.result === 'pass' ? 0 : 1;
}

async function epic(dir, log) {
  const repo = join(dir, 'repo');
  const folder = join(repo, INITIATIVE);
  const epics = readdirSync(folder).filter((n) => /^epic-.+\.md$/.test(n));
  if (epics.length !== 1) throw new Error(`${INITIATIVE}/ holds ${epics.length} epic files (epic-<slug>.md); write one, with its tickets in tickets/`);
  // The lint, with the graph lint (an epic is linted with its tickets and its PRD), as you run it.
  const lint = spawnSync('/bin/sh', ['-c', lintCommand(dir)], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  log(lint.stdout.trim());
  if (lint.stderr.trim()) log(lint.stderr.trim());
  // The coverage, as mirai epic render would write it, with the overlay applied.
  const env = projectEnv(dir);
  const { registry } = projectOverlays({ cwd: repo, env, registry: loadRegistry(REGISTRY_DIR), checkout: repo });
  const text = readFileSync(join(folder, epics[0]), 'utf8');
  const doc = parseDocument(text, `${INITIATIVE}/${epics[0]}`);
  const def = registry.documentTypes.epic;
  const prdLine = linkLinesOf(doc.scan, def).find((l) => l.link.type === 'prd');
  if (!prdLine) throw new Error(`${epics[0]} has no "PRD:" line under its title`);
  const prdDef = registry.documentTypes.prd;
  const prd = aliased(parseDocument(readFileSync(join(folder, prdLine.targets[0]), 'utf8'), prdLine.targets[0]), prdDef);
  const up = { doc: prd, ids: checkIds(prd, prdDef, () => {}, null) };
  const set = ticketSet(doc, { readTickets: () => readTicketFolder(folder, { root: repo }), registry });
  const sections = renderSections({ track: doc.value.track, tickets: set.tickets, items: prdItems(up) });
  log(`\nP1 coverage of ${PRD_PATH} by ${epics[0]} and its ${set.tickets.length} ticket(s):`);
  log((sections.get('Coverage') ?? []).join('\n'));
  log(`\nthe lint: exit ${lint.status}`);
  return lint.status === 0 ? 0 : 1;
}

export async function cli(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, options: { setup: { type: 'string' }, reader: { type: 'boolean' }, epic: { type: 'boolean' }, yes: { type: 'boolean' } }, allowPositionals: true });
  const log = (l) => process.stdout.write(`${l}\n`);
  if (values.setup) return setup(resolve(values.setup), log);
  if (values.reader) {
    if (!values.yes) {
      process.stderr.write('--reader --yes: one Sonnet run on your Claude subscription\n');
      return 2;
    }
    return reader(probeDir(positionals[0]), log);
  }
  if (values.epic) return epic(probeDir(positionals[0]), log);
  process.stderr.write('--setup <dir> | --reader [<dir>] --yes | --epic [<dir>]\n');
  return 2;
}

export const run = (argv) => cli(argv).then((code) => process.exit(code), (err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(2);
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(process.argv.slice(2));
