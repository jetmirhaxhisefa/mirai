import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { plain, shown } from '../../status/text.js';
import { openStore } from '../../store/home.js';
import { atomicWrite } from '../../store/files.js';
import { commitOf, lsTree, workTreeChanges } from '../../store/git.js';
import { loadRegistry } from '../../config/registry.js';
import { readLock } from '../../install/lock.js';
import { projectInputs, REGISTRY_DIR } from '../../install/render.js';
import { runChecks } from '../../doctor/checks.js';
import { LEDGER_FILE, ledgerText, scanLedger, staysInPlace } from '../../setup/ledger.js';
import { DECISIONS, STAGES, STAGE_TITLES, markStage, nextStage, readSetup, writeSetup } from '../../setup/state.js';
import { CHECKLIST, CHECKLIST_FILE, checklistState, checklistText } from '../../setup/checklist.js';
import { contextFiles, contextGaps, reviewText } from '../../setup/review.js';
import { AGENT_FOLDERS } from '../../setup/pre-commit.js';
import { CONTEXT_DIR, contextKindOf } from '../../lint/context.js';

// mirai setup … (unit 39, Scopes 2, 3, 5, 11 and 12): the record behind `/mirai setup`, the guided
// setup in your Claude Code session (the mirai-setup skill). The skill does the research and the
// talk; these commands keep the state in <store>/setup.json, write the ledger and the checklist,
// and say what's next. Stage commits and approvals stay yours: `mirai setup done <stage>` only
// records the commit you made.
//
//   mirai setup [status]            where setup stands, and what's next (resumes from it)
//   mirai setup scan                stage 1: the ledger of every AI item (.mirai/setup/ledger.md)
//   mirai setup decide <item> --keep <where> | --drop [--summary <text>]   stage 2's decision
//   mirai setup review              stage 3: every context file, its state, path and link
//   mirai setup defer <file>        stage 3: come back to a context file later (a checklist line)
//   mirai setup checklist [--done <n>]   stage 5: the hand checklist with doctor's states
//   mirai setup start <stage>       a stage is in progress (the skill says so as it starts one)
//   mirai setup done <stage>        a stage is done, at the commit you made

const SUBS = new Set(['status', 'scan', 'decide', 'review', 'defer', 'checklist', 'start', 'done']);
// The kinds stage 2 moves: one that is decided must be gone from its old place at the commit.
const MOVED_KINDS = new Set(['skill', 'agent', 'command', 'hook', 'script', 'mcp']);

function scanRows(store, env) {
  const registry = loadRegistry(join(store.checkout, REGISTRY_DIR));
  return scanLedger({ root: store.checkout, env: store.gitEnv ?? env, registry, lock: readLock(store.checkout)?.files ?? null });
}

// The rows the ledger shows: every item seen, decided or not, in id order.
const ledgerRows = (state) => Object.entries(state.items).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, it]) => ({ id, path: id, kind: it.kind, summary: it.summary ?? '', flags: it.flags ?? [] }));

function writeLedger(store, state) {
  const abs = join(store.checkout, LEDGER_FILE);
  mkdirSync(dirname(abs), { recursive: true });
  atomicWrite(abs, ledgerText(ledgerRows(state), state.items));
  return abs;
}

// Merges a scan into the record: new items added (undecided), known ones keep their decision.
function mergeScan(state, rows, now) {
  const fresh = [];
  for (const r of rows) {
    const it = state.items[r.id];
    if (!it) {
      state.items[r.id] = { kind: r.kind, summary: r.summary, flags: r.flags, first_seen: now };
      fresh.push(r.id);
    } else Object.assign(it, { kind: r.kind, flags: r.flags, ...(it.researched ? {} : { summary: r.summary }) });
  }
  return fresh;
}

// Where setup stands: { next, lines }. `rows`: a scan of HEAD now (new items show).
function statusLines(state, rows, stale = []) {
  const lines = [];
  for (const s of STAGES) {
    const st = state.stages[s];
    lines.push(`${s.padEnd(8)} ${st.state}${st.commit ? ` at ${st.commit.slice(0, 12)}` : ''}   (${STAGE_TITLES[s]})`);
  }
  const undecided = Object.entries(state.items).filter(([, it]) => !it.decision).map(([id, it]) => `${id} (${it.kind})`);
  const unseen = rows.filter((r) => !state.items[r.id]).map((r) => `${r.id} (${r.kind})`);
  const items = Object.keys(state.items).length;
  if (items) lines.push(`items: ${items} in the ledger, ${items - undecided.length} decided`);
  let next = nextStage(state);
  if (unseen.length || (undecided.length && state.stages.scan.state === 'done')) {
    // Decision 8: a second run does only what's new; a new item goes through stage 2.
    const all = [...unseen, ...undecided];
    lines.push(`new or undecided: ${all.slice(0, 10).join(', ')}${all.length > 10 ? `, and ${all.length - 10} more` : ''}`);
    if (next === null || STAGES.indexOf(next) > STAGES.indexOf('migrate')) next = unseen.length ? 'scan' : 'migrate';
  }
  for (const x of stale.slice(0, 10)) lines.push(`stale decision: ${x}`);
  if (state.deferred.length) lines.push(`put off for later (each a checklist line): ${state.deferred.join(', ')}`);
  const open = Object.entries(state.checklist ?? {}).filter(([, v]) => v !== 'done').map(([n]) => n);
  if (state.stages.finish.state === 'done' && open.length) lines.push(`checklist lines still open: ${open.join(', ')} (mirai setup checklist)`);
  return { next, lines, nothing: next === null && !open.length && !state.deferred.length };
}

const STEP = Object.freeze({
  scan: 'mirai setup scan, then review the ledger and commit it; then: mirai setup done scan',
  migrate: 'each undecided item, one at a time: research it, talk it through, then mirai custom add <item> (keep) or delete it (drop), and mirai setup decide <item> --keep <where> | --drop; then approve, render, commit the stage and: mirai setup done migrate',
  context: 'write the context files from your sources, then: mirai setup review; answer each (open) line and approve (or mirai setup defer); commit, then: mirai setup done context',
  connect: 'the host, the store ([docs] store) and CI; then commit and: mirai setup done connect',
  finish: 'mirai setup checklist, until every line is done; then: mirai setup done finish',
});

export default {
  name: 'setup',
  summary: 'The guided setup\'s record: where it stands, the ledger, decisions, the context review and the hand checklist (/mirai setup runs it in your session)',
  usage: 'mirai setup [status] | mirai setup scan | mirai setup decide <item> --keep <where> | --drop [--summary <text>] | mirai setup review | mirai setup defer <file> | mirai setup checklist [--done <n>] | mirai setup start <stage> | mirai setup done <stage>',
  positionals: { min: 0, max: 2 },
  options: {
    keep: { type: 'string', description: 'with decide: the repo path the kept item is at now (the path custom add printed, or its own where it may stay)' },
    note: { type: 'string', description: 'with decide: one line on what became of it (with --drop: "used as a source for conventions-app.md")' },
    drop: { type: 'boolean', description: 'with decide: the item is deleted, not kept' },
    summary: { type: 'string', description: 'with decide: what the item does, from your research (one line)' },
    done: { type: 'string', description: 'with checklist: mark line <n> done (the lines doctor can\'t check)' },
  },
  async run(args, io) {
    const [sub = 'status', arg] = args.positionals;
    if (!SUBS.has(sub)) throw new UsageError(`unknown setup step ${shown(sub)}`, 'see: mirai setup --help');
    const store = openStore({ cwd: io.cwd, env: io.env });
    const state = readSetup(store);
    const now = new Date().toISOString();
    const say = (s) => io.stdout.write(`${s}\n`);

    if (sub === 'status') {
      if (arg !== undefined) throw new UsageError('setup status takes no argument');
      const s = statusLines(state, scanRows(store, io.env), staleKeeps(store, state));
      for (const l of s.lines) say(plain(l));
      // F7: the Claude Code config this runs under (a session's, through MIRAI's server): every
      // terminal step for MIRAI carries it, so it touches the same config.
      if (io.env?.CLAUDE_CONFIG_DIR) say(`Claude Code config: CLAUDE_CONFIG_DIR=${plain(io.env.CLAUDE_CONFIG_DIR)} (write each terminal step as: CLAUDE_CONFIG_DIR=${plain(io.env.CLAUDE_CONFIG_DIR)} mirai …)`);
      if (s.nothing) {
        say('setup is done: nothing new or changed since the last run');
        return EXIT.OK;
      }
      if (s.next) say(`next: stage ${s.next}: ${STEP[s.next]}`);
      say('In your Claude Code session, /mirai setup goes on from here.');
      return EXIT.OK;
    }

    if (sub === 'scan') {
      const rows = scanRows(store, io.env);
      const fresh = mergeScan(state, rows, now);
      if (state.stages.scan.state === 'not started') markStage(state, 'scan', { state: 'in progress', at: now });
      // A new item after stage 2: migrate is open again (decision 8).
      if (fresh.length && state.stages.migrate.state === 'done') markStage(state, 'migrate', { state: 'in progress', at: now, again: true });
      writeSetup(store, state);
      const abs = writeLedger(store, state);
      say(`ledger: ${rows.length} item${rows.length === 1 ? '' : 's'} found, ${fresh.length} new`);
      for (const r of rows.slice(0, 60)) say(`  ${r.kind.padEnd(11)} ${plain(r.id)}${r.flags.length ? `   flagged: ${r.flags.join(', ')}` : ''}`);
      if (rows.length > 60) say(`  … and ${rows.length - 60} more (the ledger lists every one)`);
      say(state.stages.scan.state === 'done' ? 'next: stage migrate for the new items' : 'next: review the ledger, commit it, then: mirai setup done scan');
      say(plain(abs));
      return EXIT.OK;
    }

    if (sub === 'decide') {
      if (!arg) throw new UsageError('name the item, as the ledger lists it', 'mirai setup decide <item> --keep <where> | --drop');
      const it = state.items[arg];
      if (!it) throw new UsageError(`${shown(arg)} isn't in the ledger`, 'run: mirai setup scan');
      const keep = args.values.keep;
      if ((keep === undefined) === (args.values.drop !== true)) throw new UsageError('give --keep <where> or --drop, one of them');
      for (const [k, v] of [['keep', keep], ['summary', args.values.summary], ['note', args.values.note]]) {
        if (v !== undefined && (typeof v !== 'string' || !/^[^\n\r\0]{1,300}$/.test(v))) throw new UsageError(`--${k} is one line, at most 300 characters`);
      }
      // F5 (Jet, 2026-11-22, option 1): everything under .claude/, .cursor/ and .codex/ is MIRAI's
      // rendered output, so an item there that MIRAI didn't render can't be kept in place: it's
      // moved (into .mirai/custom/, or beside the repo root, as CLAUDE.local.md.example is) or dropped.
      if (keep !== undefined && underAgentFolder(arg, readLock(store.checkout)?.files ?? null) && keepsInPlace(arg, keep)) {
        throw new UsageError(`${shown(arg)} is under an agent folder, where only what MIRAI renders stays (mirai doctor and the pre-commit refuse anything else): it can't be kept in place`, `move it: mirai custom add ${arg} (a skill, agent, command, hook or script), or beside the repo root (git mv ${arg} <path outside .claude/, .cursor/, .codex/>) and decide --keep <that path>; or --drop`);
      }
      // F9 (Jet, 2026-11-22): a place is one repo path that's there now (HEAD or the work tree),
      // never a description; what became of an item otherwise is a drop with a note.
      if (keep !== undefined) {
        const target = keep.trim().replace(/^\.\//, '');
        const where = target.split('#')[0];
        if (!/^[^\s]+$/.test(target) || where.startsWith('/') || where.split('/').includes('..') || !(existsSync(join(store.checkout, where)) || inHead(store, where))) {
          const mine = customFor(store, arg);
          throw new UsageError(`--keep takes the repo path where the kept item is now; ${shown(keep)} isn't one that's there`, `${mine.length ? `under .mirai/custom/ for it: ${mine.join(', ')}; ` : ''}for an item used as a source or merged into another file: --drop --note "<what it became>"`);
        }
      }
      Object.assign(it, { decision: keep !== undefined ? DECISIONS[0] : DECISIONS[1], ...(keep !== undefined ? { place: keep } : { place: undefined }), decided_at: now });
      if (args.values.summary) Object.assign(it, { summary: args.values.summary, researched: true });
      if (args.values.note !== undefined) it.note = args.values.note;
      else delete it.note;
      if (state.stages.migrate.state === 'not started') markStage(state, 'migrate', { state: 'in progress', at: now });
      writeSetup(store, state);
      const abs = writeLedger(store, state);
      const left = Object.values(state.items).filter((x) => !x.decision).length;
      say(`${plain(arg)}: ${it.decision}${it.place ? ` (${plain(it.place)})` : ''}; ${left} item${left === 1 ? '' : 's'} still to decide`);
      say(plain(abs));
      return EXIT.OK;
    }

    if (sub === 'review') {
      const { config } = projectInputs(store.checkout);
      const files = contextFiles({ store, config });
      if (files.length && state.stages.context.state === 'not started') {
        markStage(state, 'context', { state: 'in progress', at: now });
        writeSetup(store, state);
      }
      for (const l of reviewText(files, { deferred: state.deferred }).replace(/\n$/, '').split('\n')) say(plain(l));
      return EXIT.OK;
    }

    if (sub === 'defer') {
      const rel = String(arg ?? '').replace(/^\.\//, '');
      const kind = rel.startsWith(`${CONTEXT_DIR}/`) ? contextKindOf(rel.slice(CONTEXT_DIR.length + 1)) : null;
      if (!kind?.approved) throw new UsageError('name a context file you approve: .mirai/context/business.md, journeys.md or conventions-<service>.md');
      if (!state.deferred.includes(rel)) state.deferred.push(rel);
      writeSetup(store, state);
      say(`${rel}: put off for later; it's a line on the checklist (mirai setup checklist), and mirai setup status names it`);
      return EXIT.OK;
    }

    if (sub === 'checklist') {
      // Your marks (the lines doctor can't check) and the states the last run found.
      state.marks ??= {};
      if (args.values.done !== undefined) {
        const n = Number(args.values.done);
        if (!CHECKLIST.some((l) => l.n === n)) throw new UsageError(`--done takes a line number, 1 to ${CHECKLIST.length}`);
        state.marks[n] = 'done';
      }
      const items = await runChecks({ cwd: io.cwd, env: io.env, ...(io.doctor ?? {}) });
      const { config } = projectInputs(store.checkout);
      const files = contextFiles({ store, config });
      const lines = [...checklistState(items, state.marks), ...deferredLines(files, state.deferred)];
      state.checklist = Object.fromEntries(lines.map((l) => [l.n, l.state]));
      if (state.stages.finish.state === 'not started') markStage(state, 'finish', { state: 'in progress', at: now });
      writeSetup(store, state);
      const abs = join(store.checkout, CHECKLIST_FILE);
      mkdirSync(dirname(abs), { recursive: true });
      atomicWrite(abs, checklistText(lines));
      for (const l of lines) {
        say(`${String(l.n).padStart(2)}. [${l.state}] ${l.title}`);
        say(`    command: ${plain(l.command)}`);
        say(`    you should see: ${plain(l.see)}`);
        say(`    default: ${plain(l.default)}`);
        if (l.state !== 'done') say(`    now: ${plain(l.why)}`);
      }
      say(plain(abs));
      return EXIT.OK;
    }

    // start / done <stage>
    if (!STAGES.includes(arg)) throw new UsageError(`name a stage: ${STAGES.join(', ')}`);
    if (sub === 'start') {
      if (state.stages[arg].state !== 'done') markStage(state, arg, { ...state.stages[arg], state: 'in progress', at: now });
      writeSetup(store, state);
      say(`${arg}: ${state.stages[arg].state}`);
      return EXIT.OK;
    }
    const before = STAGES.slice(0, STAGES.indexOf(arg)).filter((s) => state.stages[s].state !== 'done');
    if (before.length) throw new MiraiError(`stage ${before[0]} isn't done yet; stages go in order (${STAGES.join(', ')})`, EXIT.BLOCKED);
    // Finish reads doctor now, not the states the last `setup checklist` stored (P1's F4).
    const items = arg === 'finish' ? await runChecks({ cwd: io.cwd, env: io.env, ...(io.doctor ?? {}) }) : null;
    const gaps = stageGaps(arg, { store, state, env: io.env, items });
    if (gaps.length) {
      for (const g of gaps.slice(0, 20)) io.stderr.write(`  ${plain(g)}\n`);
      throw Object.assign(new MiraiError(`stage ${arg} isn't done: ${gaps.length} thing${gaps.length === 1 ? '' : 's'} left, listed above`, EXIT.BLOCKED), { hint: STEP[arg] });
    }
    if (workTreeChanges(store.checkout, store.gitEnv).length) {
      throw Object.assign(new MiraiError(`the work tree has changes: a stage is done at a commit, with everything in it`, EXIT.BLOCKED), { hint: 'review them, commit the stage (git add -A && git commit), then run this again' });
    }
    const commit = commitOf(store.checkout, 'HEAD', store.gitEnv);
    markStage(state, arg, { state: 'done', commit, at: now });
    writeSetup(store, state);
    const next = nextStage(state);
    say(`${arg}: done at ${commit.slice(0, 12)}`);
    say(next ? `next: stage ${next}: ${STEP[next]}` : 'setup is done; mirai setup status shows anything new later');
    return EXIT.OK;
  },
};

// The checklist lines for the context files you put off (decision 9): approved now, or open.
function deferredLines(files, deferred) {
  return deferred.map((rel, i) => {
    const f = files.find((x) => x.rel === rel);
    const done = f?.state === 'approved';
    return { n: CHECKLIST.length + 1 + i, title: `Review and approve ${rel} (put off at setup)`, command: `mirai approve --file ${rel}`, see: `approved: ${rel}; mirai setup review shows it approved`, default: 'no choice to make: agents read it only once it\'s approved', doctor: [], state: done ? 'done' : 'open', why: done ? 'approved as it is' : f ? f.state : 'the file isn\'t there' };
  });
}

// Whether `path` is in the commit you're on.
function inHead(store, path) {
  try {
    return (lsTree(store.checkout, 'HEAD', path, store.gitEnv) ?? []).length > 0;
  } catch {
    return false;
  }
}
// What .mirai/custom/ holds with the item's name (F9's hint).
function customFor(store, id) {
  const base = id.split('#')[0].split('/').filter(Boolean).pop()?.replace(/\.(md|toml|sh|bash|js|mjs|py|json)$/, '') ?? '';
  if (!base) return [];
  const out = [];
  const walk = (rel) => {
    let names;
    try {
      names = readdirSync(join(store.checkout, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const n of names) {
      const p = `${rel}/${n.name}`;
      if (n.name.startsWith(base) || n.name === base) out.push(p);
      if (n.isDirectory() && out.length < 10) walk(p);
    }
  };
  walk('.mirai/custom');
  return out.slice(0, 5);
}

// F5: whether an item's file is under an agent folder and isn't MIRAI's own rendered file (the
// settings file MIRAI merges into stays: its other content is the project's).
function underAgentFolder(id, lock) {
  const path = id.split('#')[0];
  if (!AGENT_FOLDERS.some((d) => path === d || path.startsWith(`${d}/`) || path.includes(`/${d}/`))) return false;
  const e = lock?.get(path);
  return !(e && e.mark === 'rendered');
}
// Whether a keep's place leaves the item where it is: the words "in place", its own path, or a
// path still under an agent folder.
function keepsInPlace(id, place) {
  if (/\bin place\b/i.test(place) || /\bwhere it is\b/i.test(place)) return true;
  const target = place.trim().split(/\s/)[0].replace(/^\.\//, '');
  if (target === id.split('#')[0]) return true;
  return !target.startsWith('.mirai/') && AGENT_FOLDERS.some((d) => target === d || target.startsWith(`${d}/`) || target.includes(`/${d}/`));
}

// F5: kept items whose file is gone and whose place isn't in the repo: the ledger says "keep" for
// something deleted; decide it again (--drop, or --keep <where it went>).
function staleKeeps(store, state) {
  const out = [];
  for (const [id, it] of Object.entries(state.items)) {
    if (it.decision !== 'keep') continue;
    const path = id.split('#')[0];
    if (existsSync(join(store.checkout, path))) continue;
    const target = String(it.place ?? '').trim().split(/\s/)[0].replace(/^\.\//, '');
    if (target && !/^in$/i.test(target) && existsSync(join(store.checkout, target))) continue;
    out.push(`${id}: the ledger says keep (${it.place ?? ''}), but neither it nor that place is in the repo; decide it again: mirai setup decide ${id} --drop (or --keep <where it went>)`);
  }
  return out;
}

// What still keeps a stage from done (beyond the commit).
function stageGaps(stage, { store, state, env, items = null }) {
  if (stage === 'scan') return Object.keys(state.items).length || state.stages.scan.state !== 'not started' ? [] : ['the ledger isn\'t written: mirai setup scan'];
  if (stage === 'migrate') {
    const rows = scanRows(store, env);
    const here = new Set(rows.map((r) => r.id));
    const out = [];
    for (const r of rows) if (!state.items[r.id]) out.push(`${r.id}: new since the scan (mirai setup scan, then decide it)`);
    for (const [id, it] of Object.entries(state.items)) {
      if (!it.decision) out.push(`${id}: not decided (mirai setup decide ${id} --keep <where> | --drop)`);
      else if (MOVED_KINDS.has(it.kind) && here.has(id) && !(it.decision === 'keep' && staysInPlace(id))) out.push(`${id}: ${it.decision === 'keep' ? 'kept, but still in its old place (mirai custom add ' + id + ')' : 'dropped, but still there (delete it)'}`);
    }
    out.push(...staleKeeps(store, state));
    return out;
  }
  if (stage === 'context') {
    const { config } = projectInputs(store.checkout);
    const files = contextFiles({ store, config });
    if (!files.length) return ['no context files in .mirai/context/ yet'];
    return contextGaps(files, state.deferred).map((f) => `${f.rel}: ${f.state}${f.open.length ? `, ${f.open.length} (open) line${f.open.length === 1 ? '' : 's'}` : ''} (approve it: mirai approve --file ${f.rel}; or put it off: mirai setup defer ${f.rel})`);
  }
  if (stage === 'finish') {
    const open = checklistState(items, state.marks ?? {}).filter((l) => l.state !== 'done').map((l) => `checklist line ${l.n} (${l.title}) isn't done: ${l.why}`);
    open.push(...staleKeeps(store, state));
    return open;
  }
  return [];
}
