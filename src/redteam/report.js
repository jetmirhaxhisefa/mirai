import { plain } from '../status/text.js';

// The red-team result as text (unit 18a): per case, the passes; for a failure, what decided it;
// then the no-model checks, the state and what to do. Every value is escaped for the terminal.

const mins = (ms) => `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;

export const NEXT = Object.freeze({
  green: 'headless launches may use this result (unit 19 checks it at every launch)',
  red: 'don\'t launch: each failure above is a gap to fix before an agent runs unattended',
  blocker: 'V1\'s condition: no headless run, and the decision on D7 (no container, no separate user) comes back to you',
  incomplete: 'not usable: run it again (mirai redteam run); inconclusive cases and unknown checks are listed above',
  stale: 'something changed since the last result (listed above): run it again (mirai redteam run)',
  none: 'there is no red-team result here yet: mirai redteam run',
});

export function partsText(parts) {
  return [
    `  Claude Code ${plain(parts.claude_code?.version)} (binary ${String(parts.claude_code?.sha256 ?? '').slice(0, 12)})`,
    `  bundles: ${Object.entries(parts.bundles ?? {}).map(([n, h]) => `${plain(n)} ${String(h).slice(0, 12)}`).join(', ') || 'none'}`,
    `  MIRAI framework ${String(parts.framework ?? '').slice(0, 12)}; Docker ${plain(parts.docker)}; ${plain(parts.git)}; macOS ${plain(parts.macos)}; Node ${plain(parts.node)}`,
  ];
}

export function report(result, { recorded = true, partial = false } = {}) {
  const out = [`red team: ${result.state.toUpperCase()}${partial ? ' (a partial run: reported, not recorded)' : ''}`, ''];
  out.push(`key ${result.key.slice(0, 16)}:`, ...partsText(result.parts), '');
  const rows = result.cases ?? [];
  const width = Math.max(10, ...rows.map((r) => `${r.id} (${r.template})`.length));
  for (const r of rows) {
    const passes = r.runs.filter((x) => x.outcome === 'pass').length;
    const label = `${r.id} (${r.template})`.padEnd(width);
    out.push(`  ${label}  ${r.outcome.padEnd(12)} ${passes}/${result.runs_per_case}${r.blocker ? '  [blocker]' : ''}`);
    if (r.outcome !== 'pass') {
      const last = r.runs.filter((x) => x.outcome !== 'pass').at(-1);
      if (last) out.push(`      ${plain(last.note)}`);
    }
  }
  if (result.skipped?.length) out.push(`  not run here (no such template in this trust root): ${result.skipped.map((s) => `${plain(s.id)} (${plain(s.template)})`).join(', ')}`);
  out.push('', 'without a model:');
  for (const s of result.checks ?? []) {
    out.push(`  ${s.id} ${s.state.padEnd(8)} ${plain(s.note)}`);
    for (const a of (s.added ?? []).slice(0, 20)) out.push(`      new: ${plain(a)}`);
  }
  if (result.stopped) out.push('', `stopped: ${plain(result.stopped)}`);
  // 18d review: passes where the permission rules, not the sandbox, stopped the command.
  const denied = rows.filter((r) => r.outcome === 'pass' && r.runs.some((x) => x.bash_denied)).map((r) => r.id);
  if (denied.length) out.push('', `Bash denied before it ran, so the sandbox wasn't what refused: ${denied.map(plain).join(', ')}`);
  out.push('', `${rows.reduce((n, r) => n + r.runs.length, 0)} runs on ${result.workers} workers in ${mins(result.duration_ms)} (model ${plain(result.model)})`);
  if (recorded && result.signature) out.push(`signed with ${result.signature.key_id}`);
  out.push(`next: ${NEXT[result.state]}`, '');
  return out.join('\n');
}

export const SESSION_NEXT = Object.freeze({
  green: 'no promise is broken; read the known limits above. This never gates a launch',
  red: 'a promise in docs/agent-safety.md doesn\'t hold: each failure above needs a fix, or a decision to change the promise',
  incomplete: 'not usable: run it again (mirai redteam run --sessions)',
  stale: 'something changed since the last result: run it again (mirai redteam run --sessions)',
  none: 'there is no result for your sessions here yet: mirai redteam run --sessions',
});

// Your sessions' result (unit 18e): what's promised and holds, what's known to get through, and
// what can't be shown by these runs.
export function sessionReport(result, { recorded = true, partial = false } = {}) {
  const rows = result.cases ?? [];
  const out = [`red team, your sessions: ${result.state.toUpperCase()}${partial ? ' (a partial run: reported, not recorded; a case without its control proves less)' : ''}`, ''];
  const section = (title, list) => {
    if (!list.length) return;
    out.push(`${title} (${list.length}):`);
    for (const r of list) {
      out.push(`  ${plain(r.id)}: ${plain(r.title)}`);
      if (r.outcome !== 'holds' && r.outcome !== 'known-limit') out.push(`      ${plain((r.runs.find((x) => x.run === 'through') ?? r.runs.at(-1))?.note ?? '')}`);
    }
    out.push('');
  };
  const ordinary = rows.filter((r) => !r.controls);
  section('FAILED, a promise doesn\'t hold', ordinary.filter((r) => r.outcome === 'failed'));
  section('inconclusive', rows.filter((r) => r.outcome === 'inconclusive' || r.outcome === 'not-run'));
  section('known limits: these get through', ordinary.filter((r) => r.outcome === 'known-limit'));
  const better = ordinary.filter((r) => r.outcome === 'holds' && r.expect === 'limit');
  section('refused today, though nothing promises it', better);
  out.push(`promises that hold: ${ordinary.filter((r) => r.outcome === 'holds' && r.expect === 'holds').length}; controls that behaved: ${rows.filter((r) => r.controls && r.outcome === 'known-limit').length}`, '');
  out.push('Not shown by these runs: exact commands on Haiku aren\'t an attacker (no creative attacks, on purpose: no sandbox here), and `claude -p` shows the rules, not what you\'d approve when asked.', '');
  if (result.stopped) out.push(`stopped: ${plain(result.stopped)}`, '');
  out.push(`${rows.reduce((n, r) => n + r.runs.length, 0)} runs in ${mins(result.duration_ms)} (Claude Code ${plain(result.parts?.claude_code?.version)})`);
  if (recorded && result.signature) out.push(`signed with ${result.signature.key_id}`);
  out.push(`next: ${SESSION_NEXT[result.state]}`, '');
  return out.join('\n');
}

// The run's last line (Jet, 2026-11-12): the verdict where the command ends, so a long run's
// result isn't only at the top of its output. Passed only when green, recorded, and (for the
// agents' run) the tested binary kept.
const SHORT = Object.freeze({ red: 'don\'t launch: fix each failure above', blocker: 'no headless run: the decision comes back to you (above)', incomplete: 'run it again', stale: 'run it again', none: 'run it' });

export function finalLine(state, { recorded = true, partial = false, kept = null, sessions = false } = {}) {
  const what = sessions ? 'RED TEAM (your sessions)' : 'RED TEAM';
  const label = `${String(state).toUpperCase()}${partial ? ' (a partial run)' : ''}`;
  let verdict;
  if (partial) verdict = 'NOT PASSED: a partial run is never recorded';
  else if (state !== 'green') verdict = `NOT PASSED: ${SHORT[state] ?? 'see above'}`;
  else if (!recorded) verdict = 'NOT PASSED: the result wasn\'t recorded';
  else if (kept && kept.ok === false) verdict = 'PASSED, but agents stay on the Claude Code they ran before (above)';
  else verdict = sessions ? 'PASSED: no promise is broken' : 'PASSED: headless launches may use this result';
  const line = `${what}: ${label}, ${verdict}`;
  const rule = '='.repeat(line.length);
  return `${rule}\n${line}\n${rule}\n`;
}
