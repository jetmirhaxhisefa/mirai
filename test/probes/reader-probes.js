#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { init } from '../../src/install/init.js';
import { redact, runClaude } from '../../src/redteam/claude.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { keepTested, readTested, stageTested } from '../../src/redteam/tested.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { loadSigner } from '../../src/sign/signer.js';
import { readToken, writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { QUESTIONS, runReaderTest, summaryText } from '../../src/write/reader.js';

// Unit 34's P2: which model runs the reader test. Haiku (`light`) and Sonnet (`standard`) each run
// the real reader (runReaderTest, the path `mirai reader-test` takes: the kept Claude Code, no
// tools, the summary as data) over the same set:
// - the good summaries: the 31–33 examples (brief, PRD, epic) and the agent-written P2 documents;
// - the seeded bad ones: each good summary with exactly one thing removed: what is left out, the
//   decisions for you, or who it is for.
// Each model works in its own probe home (its own MIRAI store, its own kept copy of your PATH's
// Claude Code, your token copied in), so no result is reused across models and nothing touches
// your real store. Pass when at least one model fails every bad summary on the removed question
// and passes every good one. The default it recommends: light if Haiku does, else standard.
//   node test/probes/reader-probes.js --yes            (about 48 short runs: 24 Haiku, 24 Sonnet)
//   node test/probes/reader-probes.js --seeds-only     (no model: the set and its seeding, checked)

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
export const MODELS = Object.freeze([{ tier: 'light', name: 'Haiku' }, { tier: 'standard', name: 'Sonnet' }]);

// The good set. A brief on standard doesn't take the reader test (it's read through its PRD), so
// the probe puts the briefs on `full`: only the frontmatter changes, never the summary.
export const DOCUMENTS = Object.freeze([
  { key: 'example-brief', path: 'registry/examples/brief.md', full: true },
  { key: 'example-prd', path: 'registry/examples/prd.md' },
  { key: 'example-epic', path: 'registry/examples/epic.md' },
  { key: 'p2-brief', path: 'implementation/units/31-brief/p2-agent-brief.md', full: true },
  { key: 'p2-prd', path: 'implementation/units/32-prd/p2-agent-prd.md' },
  { key: 'p2-epic', path: 'implementation/units/33-epic/p2/epic-task-comments.md' },
]);

// Who a summary is for, as the six summaries name people: every one becomes "someone".
const PEOPLE = /\b(?:new team members?|team leads?|team members?|leads?|assignees?|owners?|viewers?|creators?|commenters?|authors?|people|persons?|users?|members|outsiders|everyone|anyone|others|the team(?:'s)?|team's)\b/gi;

// Words that still point at a person once the nouns are gone ("the person a task is assigned to",
// "anyone who can see a task").
const PERSON_HINT = /\b(?:assigned to|can see|who can|who has|their|they|them|someone)\b/i;
// A "What changes" bullet that states what stays out or unchanged: it cites a non-goal, or says
// something stays, isn't live, or works as today (P2's first run: "The chat tool stays in use for
// everything else (NG-1)" and "… stay as they are" told the reader what was left out).
const LEFT_OUT_HINT = /\(NG-[0-9]|\bNG-[0-9]|\bstays?\b|\bnot live\b|\bas (?:they do|it does) today\b|\bas today\b|\bunchanged\b/i;

// The seeds: each removes one thing from the summary, everywhere it is stated, and names the
// question that must then fail. P2's first run (2026-11-20) showed the first seeds left the
// left-out items and the audience stated elsewhere; these remove them there too.
export const SEEDS = Object.freeze([
  { key: 'no-left-out', question: 'left_out', what: 'what is left out ("Not in this" emptied, and the "What changes" bullets that say what stays out)', apply: (t) => dropBullets(emptyPart(t, 'Not in this'), 'What changes', LEFT_OUT_HINT) },
  { key: 'no-decision', question: 'decide', what: 'the decisions for you ("Decisions for you" emptied)', apply: (t) => emptyPart(t, 'Decisions for you') },
  { key: 'no-who', question: 'for_whom', what: 'who it is for ("Why" emptied, "What changes" bullets naming a person dropped, other people named "someone")', apply: (t) => inSummary(dropBullets(emptyPart(t, 'Why'), 'What changes', (l) => new RegExp(PEOPLE.source, 'i').test(l) || PERSON_HINT.test(l)), (s) => s.replace(PEOPLE, 'someone')) },
]);

// Drops the bullets of one part that match `test` (a regex or a function); the part keeps at least
// one bullet, or the seed would also remove what is built.
function dropBullets(text, part, test) {
  const match = (l) => {
    if (typeof test === 'function') return test(l);
    test.lastIndex = 0;
    return test.test(l);
  };
  return inSummary(text, (s) => {
    const lines = s.split('\n');
    const at = lines.indexOf(`### ${part}`);
    if (at < 0) throw new Error(`no "### ${part}"`);
    let next = lines.findIndex((l, i) => i > at && /^### /.test(l));
    if (next < 0) next = lines.length;
    const body = lines.slice(at + 1, next).filter((l) => !(/^\s*[-*] /.test(l) && match(l)));
    if (!body.some((l) => /^\s*[-*] /.test(l))) throw new Error(`"### ${part}" would have no bullet left`);
    return [...lines.slice(0, at + 1), ...body, ...lines.slice(next)].join('\n');
  });
}

// The summary's line range in a document: [start, end) of the lines after "## Summary for approval".
function summaryRange(lines) {
  const start = lines.findIndex((l) => l === '## Summary for approval');
  if (start < 0) throw new Error('no summary');
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return [start + 1, end];
}
function inSummary(text, fn) {
  const lines = text.split('\n');
  const [a, b] = summaryRange(lines);
  return [...lines.slice(0, a), ...fn(lines.slice(a, b).join('\n')).split('\n'), ...lines.slice(b)].join('\n');
}
// The part's heading stays; everything under it, up to the next part, goes.
function emptyPart(text, part) {
  return inSummary(text, (s) => {
    const lines = s.split('\n');
    const at = lines.indexOf(`### ${part}`);
    if (at < 0) throw new Error(`no "### ${part}"`);
    let next = lines.findIndex((l, i) => i > at && /^### /.test(l));
    if (next < 0) next = lines.length;
    return [...lines.slice(0, at + 1), '', ...lines.slice(next)].join('\n');
  });
}
const partBody = (summary, part) => {
  const m = new RegExp(`^### ${part}(?:\\n|$)([\\s\\S]*?)(?=^### |(?![\\s\\S]))`, 'm').exec(summary);
  return m ? m[1].trim() : null;
};

// The set: [{ name, doc, kind: 'good' | 'bad', seed, question, text, summary }], each seeded
// document checked: its summary changed, and what it removes is gone.
export function buildSet() {
  const out = [];
  for (const d of DOCUMENTS) {
    let text = readFileSync(join(ROOT, d.path), 'utf8');
    if (d.full) {
      if (!/^track: standard$/m.test(text)) throw new Error(`${d.path}: no "track: standard" to put on full`);
      text = text.replace(/^track: standard$/m, 'track: full');
    }
    const good = summaryText(text);
    if (!good) throw new Error(`${d.path} has no summary`);
    out.push({ name: d.key, doc: d.path, kind: 'good', seed: null, question: null, text, summary: good });
    for (const s of SEEDS) {
      const seeded = s.apply(text);
      const summary = summaryText(seeded);
      if (summary === good) throw new Error(`${d.key} ${s.key}: the seeding changed nothing`);
      if (s.question === 'left_out') {
        if (partBody(summary, 'Not in this') !== '') throw new Error(`${d.key} ${s.key}: "Not in this" isn't empty`);
        const left = (partBody(summary, 'What changes') ?? '').split('\n').filter((l) => LEFT_OUT_HINT.test(l));
        if (left.length) throw new Error(`${d.key} ${s.key}: "What changes" still says what stays out: ${left.join(' | ')}`);
      }
      if (s.question === 'decide' && partBody(summary, 'Decisions for you') !== '') throw new Error(`${d.key} ${s.key}: "Decisions for you" isn't empty`);
      if (s.question === 'for_whom') {
        if (partBody(summary, 'Why') !== '') throw new Error(`${d.key} ${s.key}: "Why" isn't empty`);
        const left = summary.match(PEOPLE);
        if (left) throw new Error(`${d.key} ${s.key}: people are still named: ${left.join(', ')}`);
        const hinted = (partBody(summary, 'What changes') ?? '').split('\n').filter((l) => PERSON_HINT.test(l));
        if (hinted.length) throw new Error(`${d.key} ${s.key}: "What changes" still points at a person: ${hinted.join(' | ')}`);
      }
      // Nothing outside the summary changed.
      if (seeded.replace(/## Summary for approval[\s\S]*?(?=\n## )/, '') !== text.replace(/## Summary for approval[\s\S]*?(?=\n## )/, '')) throw new Error(`${d.key} ${s.key}: the detail changed`);
      out.push({ name: `${d.key}/${s.key}`, doc: d.path, kind: 'bad', seed: s.what, question: s.question, text: seeded, summary });
    }
  }
  return out;
}

// One probe home per model: a repo with MIRAI installed, the model's tier for the reader-test
// step committed in the project config, a key, your token, and a kept copy of the Claude Code on
// your PATH (as a green red-team run keeps it), so the launch takes the kept-copy path.
export async function setupHome({ workdir, tier, claude, token }) {
  const root = join(workdir, 'repo');
  mkdirSync(root, { recursive: true });
  mkdirSync(join(workdir, 'home'), { recursive: true, mode: 0o700 });
  const home = realpathSync(join(workdir, 'home'));
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: root, env: gitEnv }).toString();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), '# reader probe\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USER: process.env.USER, LANG: 'C' };
  init({ cwd: root, env, branch: 'main' });
  appendFileSync(join(root, '.mirai', 'config.toml'), `\n[models.steps]\nreader-test = "${tier}"\n`);
  const key = createKeyPair(env);
  writePublicKeyFile(root, key.keyId, key.publicPem);
  git('add', '-A');
  git('commit', '-qm', `probe: MIRAI, a key, reader-test on ${tier}`);
  writeToken(env, token);
  let kept = null;
  if (claude) {
    const store = openStore({ cwd: root, env });
    const staged = await stageTested({ env, claude });
    keepTested({ env, store, staged, signer: loadSigner(env, store) });
    kept = readTested(store).current;
  }
  return { root, env, home, kept };
}

// The reader's launch, as runReaderTest makes it, with the stream kept for the probe's own report
// (the init event, the cost, stderr on a failure).
export function recordingLaunch(launch = runClaude) {
  const runs = [];
  const fn = async (bin, opts, o) => {
    const raw = await launch(bin, opts, o);
    let init = null;
    let result = null;
    for (const line of String(raw.stdout ?? '').split('\n')) {
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'system' && ev.subtype === 'init') init = ev;
        if (ev.type === 'result') result = ev;
      } catch {
        // not a JSON line
      }
    }
    runs.push({ raw, init, result, args: opts.args });
    return raw;
  };
  return { launch: fn, runs };
}

// One model over the whole set. Returns { tier, rows, cost, errors }.
export async function runModel({ home, tier, set, launch, log, token, claude = null, write = true }) {
  const rec = recordingLaunch(launch);
  const rows = [];
  let cost = 0;
  let costSeen = false;
  for (const item of set) {
    const file = `docs/mirai/p2/${item.name.replace('/', '--')}.md`;
    if (write) {
      mkdirSync(dirname(join(home.root, file)), { recursive: true });
      writeFileSync(join(home.root, file), item.text);
    }
    const before = rec.runs.length;
    let row;
    try {
      const r = await runReaderTest({ cwd: home.root, env: home.env, file, launch: rec.launch, ...(claude ? { claude } : {}) });
      row = { ...item, result: r.entry.result, failed: r.entry.failed, model: r.entry.model, reused: r.reused, answers: r.entry.answers };
    } catch (err) {
      const last = rec.runs.at(-1);
      const stderr = last ? redact(String(last.raw.stderr ?? ''), token).trim().slice(0, 400) : '';
      row = { ...item, result: 'error', failed: [], error: `${err.code ?? ''} ${err.message}${stderr ? ` | stderr: ${stderr}` : ''}`.trim() };
    }
    for (const run of rec.runs.slice(before)) {
      const c = run.result?.total_cost_usd;
      if (typeof c === 'number') {
        cost += c;
        costSeen = true;
      }
    }
    rows.push(row);
    log(`  ${tier.padEnd(8)} ${row.name.padEnd(28)} ${row.kind.padEnd(4)} ${row.result}${row.failed.length ? ` (${row.failed.join(', ')})` : ''}${row.error ? `: ${row.error}` : ''}`);
  }
  return { tier, rows, cost: costSeen ? cost : null, runs: rec.runs };
}

// Whether the model passed: every good summary passes, every bad one fails on its removed question.
export function judge(rows) {
  const misses = rows.filter((r) => (r.kind === 'good' ? r.result !== 'pass' : !(r.result === 'fail' && r.failed.includes(r.question))));
  return { ok: misses.length === 0, misses };
}

export function verdictOf(results) {
  const ok = Object.fromEntries(results.map((r) => [r.tier, judge(r.rows).ok]));
  const pass = Object.values(ok).some(Boolean);
  const recommended = ok.light ? 'light' : ok.standard ? 'standard' : null;
  return { pass, ok, recommended };
}

const label = (q) => QUESTIONS.find((x) => x.key === q)?.label ?? q;
// A reader's words on one line, shortened; never anything shaped like a token.
const clean = (t) => redact(String(t ?? ''), null).replace(/\s+/g, ' ').slice(0, 300);

export function table(result, log) {
  log(`\n${result.tier === 'light' ? 'Haiku (light)' : 'Sonnet (standard)'}${result.model ? `, ${result.model}` : ''}`);
  log('| Document | Good or bad (what was removed) | Result | Failed questions |');
  log('|---|---|---|---|');
  for (const r of result.rows) log(`| ${r.doc}${r.kind === 'bad' ? ` (${r.name.split('/')[1]})` : ''} | ${r.kind === 'good' ? 'good' : `bad: removed ${r.seed}`} | ${r.result}${r.error ? ` (${r.error.slice(0, 120)})` : ''} | ${r.failed.map(label).join(', ') || '—'} |`);
  const j = judge(result.rows);
  log(`${j.ok ? 'every bad summary caught, no good one failed' : `${j.misses.length} miss(es): ${j.misses.map((m) => `${m.name} (${m.kind}: ${m.result})`).join('; ')}`}; cost: ${result.cost === null ? 'not reported' : `$${result.cost.toFixed(4)}`}`);
  // What the reader said for each miss: a bad summary that passed shows its answer and quote for
  // the removed question; a good one that failed shows each failed question's answer, quote and why.
  for (const m of j.misses) {
    const qs = m.kind === 'bad' ? [m.question] : m.failed;
    for (const q of qs) {
      const a = m.answers?.[q];
      if (!a) {
        log(`  ${m.name}, ${label(q)}: no answer kept (${m.result}${m.error ? `: ${m.error.slice(0, 200)}` : ''})`);
        continue;
      }
      log(`  ${m.name}, ${label(q)}: answer ${JSON.stringify(clean(a.answer))}; quote ${JSON.stringify(clean(a.quote))}${a.why ? `; ${clean(a.why)}` : ''}`);
    }
  }
}

// The init check first (unit 34's open question): does the kept Claude Code accept `--tools ""`
// and start with no tools? One Haiku run on the first good summary; its result is kept, so the
// full pass reuses it.
async function initCheck({ home, set, token, log }) {
  const rec = recordingLaunch();
  const first = set[0];
  const file = `docs/mirai/p2/${first.name}.md`;
  mkdirSync(dirname(join(home.root, file)), { recursive: true });
  writeFileSync(join(home.root, file), first.text);
  try {
    const r = await runReaderTest({ cwd: home.root, env: home.env, file, launch: rec.launch });
    const run = rec.runs[0];
    log(`init check: PASS. The kept Claude Code ${home.kept?.version ?? ''} started the reader with tools ${JSON.stringify(run?.init?.tools ?? [])} on ${run?.init?.model ?? r.entry.model} (--tools "" accepted); its answer was read (${r.entry.result}).`);
    return true;
  } catch (err) {
    const run = rec.runs[0];
    log(`init check: FAILED (${err.code ?? 'error'}): ${err.message}`);
    if (run) {
      log(`  exit ${run.raw.exit}${run.raw.timedOut ? ', timed out' : ''}; init tools: ${run.init ? JSON.stringify(run.init.tools ?? null) : 'no init event'}`);
      log(`  stderr: ${redact(String(run.raw.stderr ?? ''), token).trim().slice(0, 800) || '(empty)'}`);
      log(`  args: ${run.args.filter((a, i) => run.args[i - 1] !== '-p').map((a) => JSON.stringify(a)).join(' ')}`);
    }
    log('  The reader can\'t run on this Claude Code as built: the model comparison was not run.');
    return false;
  }
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, 'seeds-only': { type: 'boolean' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  const set = buildSet();
  log(`the set: ${set.filter((s) => s.kind === 'good').length} good summaries and ${set.filter((s) => s.kind === 'bad').length} seeded bad ones (each seed checked)`);
  if (values['seeds-only']) {
    for (const s of set) log(`  ${s.name.padEnd(28)} ${s.kind}${s.seed ? `: removed ${s.seed}` : ''} (${s.summary.split(/\s+/).length} words)`);
    return 0;
  }
  if (!values.yes) {
    process.stderr.write('--yes: about 48 short runs on your Claude subscription (24 Haiku, 24 Sonnet); or --seeds-only, no model\n');
    return 2;
  }
  const token = readToken(process.env);
  if (!token) throw new Error('no Claude login token: mirai token set');
  const claude = resolveClaude(process.env);
  log(`Claude Code on your PATH: ${claude.version} (${claude.real.replace(process.env.HOME, '~')}); each probe home keeps its own copy of it`);
  const workdirs = [];
  try {
    const homes = [];
    for (const m of MODELS) {
      const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
      workdirs.push(workdir);
      homes.push({ ...m, home: await setupHome({ workdir, tier: m.tier, claude, token }) });
    }
    if (!(await initCheck({ home: homes[0].home, set, token, log }))) return 1;
    const results = await Promise.all(homes.map(async (h) => {
      const r = await runModel({ home: h.home, tier: h.tier, set, log, token });
      return { ...r, model: r.rows.find((x) => x.model)?.model ?? null };
    }));
    for (const r of results) table(r, log);
    const v = verdictOf(results);
    const total = results.every((r) => r.cost !== null) ? results.reduce((n, r) => n + r.cost, 0) : null;
    log(`\nverdict: ${v.pass ? 'PASS' : 'FAIL'} (Haiku ${v.ok.light ? 'clean' : 'missed some'}, Sonnet ${v.ok.standard ? 'clean' : 'missed some'})`);
    log(`recommended default for [models.steps] reader-test: ${v.recommended ?? 'none (neither model is clean)'}`);
    log(`run cost: ${total === null ? 'not reported by the stream' : `$${total.toFixed(4)}`}`);
    return v.pass ? 0 : 1;
  } finally {
    for (const w of workdirs) {
      spawnSync('/bin/chmod', ['-R', 'u+rwX', w]);
      rmSync(w, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
