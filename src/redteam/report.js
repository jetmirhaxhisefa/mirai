import { escapeInvisible } from '../status/text.js';

// The red-team result as text (unit 18a): per case, the passes; for a failure, what decided it;
// then the no-model checks, the state and what to do. Every value is escaped for the terminal.

const plain = (text) => escapeInvisible(String(text ?? '').replace(/[\x00-\x1f\x7f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`));
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
  out.push('', `${rows.reduce((n, r) => n + r.runs.length, 0)} runs on ${result.workers} workers in ${mins(result.duration_ms)} (model ${plain(result.model)})`);
  if (recorded && result.signature) out.push(`signed with ${result.signature.key_id}`);
  out.push(`next: ${NEXT[result.state]}`, '');
  return out.join('\n');
}
