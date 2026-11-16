import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { buildRecordPath } from '../agent/build.js';
import { planPath } from '../agent/plan.js';
import { reviewsOf } from '../agent/review.js';
import { readBaseline } from '../baseline/store.js';
import { tableIn } from '../lint/checks.js';
import { readFrontmatter } from '../lint/frontmatter.js';
import { scanMarkdown } from '../lint/markdown.js';
import { codeFiles } from '../proofs/hash.js';
import { claudeOf, tddEvidence } from '../proofs/record.js';
import { declaredChanges } from '../agent/plan.js';
import { checkProofs } from '../proofs/check.js';
import { hostFor } from '../ship/host.js';
import { branchKeys } from '../sign/keys.js';
import { commitOf, isAncestor, mergeBase, remotes, reviewPatch } from '../store/git.js';
import { readPrivateFile } from '../store/files.js';
import { openStore } from '../store/home.js';
import { readJournal, ticketFacts } from '../store/journal.js';
import { readRunLog, runIds } from '../store/run-log.js';
import { plain } from '../status/text.js';
import { protectionRules } from '../trust/protected.js';
import { snapshot, trustedConfig, trustedRegistry } from '../trust/snapshot.js';

// `mirai review-mr <ticket>` (unit 29d; D-34's update, 2026-11-14): one ticket's MR on one screen,
// so you can decide without the host's page: the files against the plan's Code map, the tests
// against the baseline, Rex's review and how deep it went, the proofs at the MR's head, the host's
// CI and whether it can merge, the diff. Reads only (the host is asked, nothing is written).

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

// The plan's Code map: [{ path, change }] (`add` | `change` | `read` | …), from its table.
export function codeMap(planText) {
  if (!planText) return [];
  let fm = null;
  try {
    fm = readFrontmatter(planText);
  } catch {
    fm = null;
  }
  const body = fm ? fm.body : planText;
  const t = tableIn({ scan: scanMarkdown(body, { firstLine: fm?.bodyLine ?? 1 }) }, 'Code map');
  return (t?.rows ?? []).map((r) => ({ path: (r.cells.path ?? '').trim(), change: (r.cells.change ?? '').trim().toLowerCase() })).filter((r) => r.path);
}

// What a launch did, from its run-log line and, while kept (the last 50), its stream: the model,
// minutes, tool counts and the files it read (paths only, never their contents).
export function launchDepth(store, launchId) {
  let line = null;
  for (const id of [...runIds(store)].reverse()) {
    try {
      line = readRunLog(store, id).lines.find((l) => l.event === 'agent_run' && l.launch_id === launchId) ?? null;
    } catch {
      line = null;
    }
    if (line) break;
  }
  const read = [];
  let searches = 0;
  const text = readPrivateFile(join(store.dir, 'agent-runs', `${launchId}.jsonl`), { optional: true, maxBytes: 32 * 1024 * 1024 });
  if (text !== null) {
    for (const raw of String(text).split('\n')) {
      let e;
      try {
        e = JSON.parse(raw);
      } catch {
        continue;
      }
      if (e?.type !== 'assistant') continue;
      for (const c of e.message?.content ?? []) {
        if (c?.type !== 'tool_use') continue;
        if (c.name === 'Read' && typeof c.input?.file_path === 'string') {
          const p = c.input.file_path;
          const inRepo = relative(store.checkout, p);
          const name = !inRepo.startsWith('..') && !inRepo.startsWith(sep) ? inRepo : /\/input\/(?:files\/)?(.+)$/.exec(p)?.[1] ? `input: ${/\/input\/(?:files\/)?(.+)$/.exec(p)[1]}` : 'a file outside the project';
          if (!read.includes(name)) read.push(name);
        }
        if (c.name === 'Grep' || c.name === 'Glob') searches++;
      }
    }
  }
  return {
    ...(line ? { model: line.model_used ?? line.model ?? null, minutes: line.minutes ?? null, turns: line.turns ?? null, tools: line.tool_calls ?? [] } : {}),
    kept: text !== null,
    read,
    searches,
  };
}

// The packet's data. `host` (optional): the host object, else hostFor. `withHost: false` skips it.
export function packetData({ cwd, env, ticket, host = null, hostOf = hostFor, withHost = true }) {
  const store = openStore({ cwd, env });
  const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
  const trust = snapshot({ cwd, env });
  const config = trustedConfig(trust);
  const codePaths = config.gate?.code_paths ?? ['**'];
  const facts = ticketFacts(readJournal(store, { keys }).events, ticket);
  const build = readJson(buildRecordPath(store, ticket));
  const branch = build?.branch ?? null;
  const planText = (() => {
    try {
      return readFileSync(planPath(store, ticket), 'utf8');
    } catch {
      return null;
    }
  })();
  const out = { ticket, branch, mr: facts.mr === 'none' ? null : { state: facts.mr, number: facts.number ?? null, url: facts.url ?? null }, pushed: facts.lastPush ?? facts.head ?? null };

  // The host: the MR's state, head, CI and whether it can merge.
  let live = null;
  let hostError = null;
  if (withHost && out.mr?.number) {
    try {
      const h = host ?? hostOf({ config, remoteUrl: remotes(store.checkout, store.gitEnv).get('origin') ?? null, store, env, root: store.checkout });
      h.checkAuth();
      live = h.mrState(out.mr.number);
    } catch (err) {
      hostError = String(err.message ?? err).slice(0, 300);
    }
  }
  out.host = live ? { state: live.state, head: live.head, mergeable: live.mergeable, why: live.why ?? null, ci: live.ci } : null;
  if (hostError) out.host_error = hostError;
  const head = live?.head ?? out.pushed;
  out.head = head;
  out.head_is_mirais = Boolean(head && out.pushed && head === out.pushed);

  // The files against the Code map, and the diff's size.
  out.files = [];
  out.diff = null;
  if (head && commitOf(store.checkout, head, store.gitEnv)) {
    // Merged, main holds the code: then the base its build started from.
    const mb = mergeBase(store.checkout, head, trust.baseSha, store.gitEnv);
    const base = (mb && mb !== head ? mb : null) ?? build?.base ?? null;
    if (base) {
      const map = codeMap(planText);
      for (const p of codeFiles(store.checkout, base, head, codePaths, store.gitEnv)) {
        const row = map.find((r) => r.path === p);
        out.files.push({ path: p, change: row?.change ?? null, flag: !row ? 'not in the plan\'s Code map' : row.change === 'read' ? 'the plan only reads it' : null });
      }
      // The diff over the code files only (MIRAI's records and docs left out, as in Files).
      const code = new Set(out.files.map((f) => f.path));
      const patch = reviewPatch(store.checkout, base, head, store.gitEnv).toString('utf8').split(/(?=^diff --git )/m)
        .filter((sec) => { const m = /^diff --git a\/(.+?) b\//.exec(sec); return m && code.has(m[1]); }).join('');
      let add = 0;
      let del = 0;
      for (const l of patch.split('\n')) {
        if (l.startsWith('+') && !l.startsWith('+++')) add++;
        if (l.startsWith('-') && !l.startsWith('---')) del++;
      }
      out.diff = { base, add, del, files: (patch.match(/^diff --git /gm) ?? []).length, patch };
    }
    // The proofs, as the push check and CI check them.
    // A merged head is on main already: its proofs did their job (checked at the push).
    const p = d_merged(live, facts) ? { outcome: 'merged' } : checkProofs({ root: store.checkout, env: store.gitEnv, ticket, commit: head, integration: trust.baseSha, codePaths, keys, repoId: store.repoId, rules: protectionRules(trustedRegistry(trust), config).rules, docsRoot: config.docs?.root });
    out.proofs = { outcome: p.outcome, ...(p.why ? { why: String(p.why).slice(0, 200) } : {}) };
  } else out.proofs = { outcome: head ? 'not-in-clone' : 'no-head' };

  // The tests, against the baseline.
  out.tests = (build?.tests?.runs ?? []).map((t) => ({ name: t.name, verdict: t.verdict }));
  // Unit 23: test-first as MIRAI saw it, and the existing tests the plan declared it changes.
  out.tdd = tddEvidence(build);
  // Unit 18h: the Claude Code the ticket ran on.
  out.claude_code = claudeOf(store, ticket);
  try {
    out.test_changes = declaredChanges(readFileSync(planPath(store, ticket), 'utf8')).filter((r) => r.kind === 'test-change').map((r) => ({ path: r.item, why: r.why }));
  } catch {
    out.test_changes = [];
  }
  let known = [];
  try {
    const b = build?.base ? readBaseline(store, build.base, { keys }) : null;
    for (const [level, v] of Object.entries(b?.levels ?? {})) for (const k of v.known_failures ?? []) known.push({ level, id: k.id, state: k.state });
  } catch {
    known = [];
  }
  out.known_failures = known;

  // Rex's last review of this head (or the last one), and how deep it went.
  const reviews = reviewsOf(store, ticket);
  const last = reviews.at(-1)?.record ?? null;
  out.review = last ? {
    n: reviews.at(-1).n, outcome: last.outcome ?? null, commit: last.commit ?? null,
    blocking: (last.findings ?? []).filter((f) => f.severity === 'blocking').length,
    // A follow-up is a finding's id (or an object): shown as the finding's claim.
    followups: (last.followups ?? []).map((f) => {
      const id = typeof f === 'string' ? f : f.id;
      const finding = (last.findings ?? []).find((x) => x.id === id);
      return (typeof f === 'object' && f.claim) || finding?.claim || id;
    }).filter(Boolean).map((x) => String(x).slice(0, 200)),
    depth: last.launch ? launchDepth(store, last.launch) : null,
  } : null;
  // Code changed after the review? The proofs commit after it changes no code.
  if (out.review?.commit && head && out.review.commit !== head && commitOf(store.checkout, out.review.commit, store.gitEnv) && commitOf(store.checkout, head, store.gitEnv)) {
    out.review.code_after = isAncestor(store.checkout, out.review.commit, head, store.gitEnv) ? codeFiles(store.checkout, out.review.commit, head, codePaths, store.gitEnv) : null;
  }
  return out;
}

const d_merged = (live, facts) => (live?.state ?? facts.mr) === 'merged';
const word = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The packet as text. `diff`: the whole diff after it.
export function packetText(d, { diff = false } = {}) {
  const out = [];
  const mr = d.mr ? `${d.mr.url ? 'MR' : 'MR'} ${d.mr.number ? `#${d.mr.number} ` : ''}${d.host?.state ?? d.mr.state}` : 'no MR yet';
  const proofs = d.proofs.outcome === 'pass' ? `proofs valid at its head ${d.head?.slice(0, 7)}` : d.proofs.outcome === 'merged' ? `merged at ${d.head?.slice(0, 7)}` : `proofs ${d.proofs.outcome}${d.proofs.why ? ` (${plain(d.proofs.why)})` : ''}`;
  const ci = d.host ? `CI: ${d.host.ci.state === 'none' ? 'none (local-only)' : d.host.ci.state}${d.host.ci.checks?.length && d.host.ci.state !== 'passed' ? ` (${d.host.ci.checks.filter((c) => c.state !== 'passed').map((c) => plain(c.name)).join(', ')})` : ''}` : `CI: unknown${d.host_error ? ` (${plain(d.host_error)})` : ''}`;
  out.push(`${d.ticket} · ${mr} · ${proofs} · ${ci}`);
  if (d.mr?.url) out.push(`  ${plain(d.mr.url)}`);
  if (d.host && !d.head_is_mirais) out.push(`  the MR's head ${d.head?.slice(0, 7)} isn't what MIRAI pushed (${d.pushed?.slice(0, 7) ?? 'nothing'}): someone pushed after MIRAI`);
  const row = (k, v) => out.push(`${k.padEnd(11)}${v}`);
  const flagged = d.files.filter((f) => f.flag);
  row('Files', `${word(d.files.length, 'code file')} changed${d.files.length ? (flagged.length ? `, ${flagged.length} outside the plan:` : ', all in the plan\'s Code map') : ''}`);
  for (const f of d.files) out.push(`  ${plain(f.path)}${f.change ? `: ${plain(f.change)}` : ''}${f.flag ? `  ← ${f.flag}` : ''}`);
  const known = d.known_failures.length ? ` · the baseline knows ${d.known_failures.map((k) => `${plain(k.id.split('::').at(-1))} (${k.state})`).join(', ')}` : '';
  row('Tests', d.tests.length ? `${d.tests.map((t) => `${plain(t.name)} ${t.verdict}`).join(', ')}${known}` : 'no build record');
  if (d.tdd) {
    const c = d.tdd.rows ?? {};
    const red = d.tdd.red;
    row('Test-first', `${c.red ?? 0} red, ${c.characterization ?? 0} characterization, ${c.after ?? 0} after${c.no_test ? `, ${c.no_test} no-test` : ''} · ${red ? `red confirmed at ${String(red.commit ?? '').slice(0, 7)}${red.rounds ? ` after ${word(red.rounds, 'red round')}` : ''}` : 'no red check (no red rows)'}`);
    for (const r of red?.rows ?? []) out.push(`  ${plain(r.test)}: ${r.kind === 'red' ? `failed first${r.message ? `: ${plain(r.message).slice(0, 160)}` : ''}` : 'passed on today\'s code'}`);
  }
  if (d.claude_code) out.push(`Claude Code ${plain(String(d.claude_code.version ?? 'unknown version'))}, every launch of this ticket (its pin)`);
  for (const t of d.test_changes ?? []) out.push(`  changes an existing test (declared): ${plain(t.path)}: ${plain(t.why)} (mirai review-mr ${d.ticket} --diff shows it)`);
  if (d.review) {
    const dp = d.review.depth;
    const depth = dp ? [dp.model ? `by ${plain(dp.model)}` : null, dp.minutes != null ? `${dp.minutes} min` : null, dp.kept ? `read ${word(dp.read.length, 'file')}${dp.read.length ? ` (${dp.read.slice(0, 6).map(plain).join(', ')}${dp.read.length > 6 ? ', …' : ''})` : ''}, ${word(dp.searches, 'search', 'searches')}` : 'what it read is no longer kept'].filter(Boolean).join(', ') : '';
    const onlyInputs = dp?.kept && dp.read.length && dp.read.every((r) => r.startsWith('input: '));
    row(`Review ${d.review.n}`, `${String(d.review.outcome ?? 'incomplete').toUpperCase()}${depth ? `, ${depth}` : ''} · ${word(d.review.blocking, 'blocking finding')}, ${word(d.review.followups.length, 'follow-up')}${d.review.code_after === null ? ` · reviewed ${d.review.commit.slice(0, 7)}, which isn't in the head's history` : d.review.code_after?.length ? ` · code changed after the review (${d.review.code_after.slice(0, 3).map(plain).join(', ')})` : ''}`);
    if (onlyInputs) out.push('  Rex read only its input (the diff and the plan), no file of the project');
    for (const f of d.review.followups) out.push(`  follow-up: ${plain(f)}`);
  } else row('Review', 'none yet');
  const merge = !d.host ? 'unknown (the host wasn\'t asked)' : d.host.state !== 'open' ? `the MR is ${d.host.state}` : d.host.mergeable === true ? 'the host can merge it' : d.host.mergeable === null ? 'the host is still working it out' : `the host can't merge it${d.host.why ? `: ${d.host.why}` : ''}`;
  row('Merge', `${merge}${d.host?.state === 'open' ? ` · M1 if you merge now: ${d.head_is_mirais ? 'as is' : 'edited, unless only docs changed'}` : ''}`);
  if (d.diff) row('Diff', `+${d.diff.add} −${d.diff.del} in ${word(d.diff.files, 'file')}${diff ? '' : ` (mirai review-mr ${d.ticket} --diff for all of it)`}`);
  if (diff && d.diff) out.push('', ...d.diff.patch.split('\n').map((l) => plain(l)));
  return `${out.join('\n')}\n`;
}
