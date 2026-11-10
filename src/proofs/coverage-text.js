import { plain } from '../status/text.js';

// The diff-coverage lines (unit 26b) for `gate record`, `gate check` and the push, from a gate
// proof's `diff_coverage` (or null: a proof minted before 26b). A warning whenever a counted line
// didn't run (Jet's decision 3); the numbers always. `files`: how many files to name (null: all
// the proof holds). Never a reason to refuse in Milestone A.
const pct = (a, b) => (b === 0 ? '100%' : `${Math.floor((a / b) * 100)}%`);

export function coverageLines(dc, { files = null, ticket = null, indent = '  ' } = {}) {
  if (!dc) return [`${indent}diff coverage: none in this proof (recorded before unit 26b)`];
  const t = dc.total;
  const gaps = dc.files.filter((f) => f.uncovered.length > 0);
  const out = [];
  if (gaps.length === 0 && t.changed > 0) out.push(`${indent}diff coverage: all ${t.measurable} changed lines that can run ran${t.changed > t.measurable ? ` (${t.changed} added)` : ''}`);
  else if (t.changed === 0) out.push(`${indent}diff coverage: no changed lines to measure`);
  else out.push(`${indent}warning: diff coverage ${t.covered} of ${t.measurable} changed lines ran (${pct(t.covered, t.measurable)}); no test ran these lines:`);
  const shown = files === null ? gaps : gaps.slice(0, files);
  for (const f of shown) out.push(`${indent}  ${plain(f.path).slice(0, 200)} ${f.uncovered.join(', ')}${f.why ? ` (${f.why === 'not-measured' ? 'no level measured this file' : plain(f.why)})` : ''}`);
  const hidden = (dc.uncovered_files ?? gaps.length) - shown.length;
  if (hidden > 0) out.push(`${indent}  and ${hidden} more file(s)${ticket ? `: mirai gate check ${ticket}` : ''}`);
  const outside = dc.apart.filter((a) => a.why === 'outside');
  if (outside.length && files === null) out.push(`${indent}not counted (no level's coverage_paths or baseline covers them): ${outside.slice(0, 20).map((a) => plain(a.path)).join(', ')}`);
  const binary = dc.apart.filter((a) => a.why !== 'outside');
  if (binary.length && files === null) out.push(`${indent}not counted (binary or too large): ${binary.slice(0, 20).map((a) => plain(a.path)).join(', ')}`);
  for (const [name, l] of Object.entries(dc.levels ?? {})) if (l.coverage !== 'ok') out.push(`${indent}${plain(name)}: no coverage from this run (${plain(l.coverage)}); its files count as not run`);
  if (dc.ignored?.length && files === null) out.push(`${indent}coverage_paths ignored on ${dc.ignored.map(plain).join(', ')}: its test adapter has no coverage`);
  return out;
}
