import { EXIT } from '../exit-codes.js';
import { escapeInvisible } from '../../status/text.js';
import { detect } from '../../detect/detect.js';

// mirai detect [--json] (unit 17a): setup detection. Reads the integration branch's commit and
// writes a draft config for you to review (src/detect/detect.js), then prints what it found, the
// gaps, and how the draft differs from your .mirai/config.toml. It never changes your config.

// Text from the repo with every control and invisible character escaped (nothing reaches the
// terminal as an escape sequence, or hides what you read); a value as JSON.
const plain = (text) => escapeInvisible(String(text).replace(/[\x00-\x1f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));
const argv = (a) => a.map(plain).join(' ');
const shown = (v) => (v === undefined ? '(none)' : escapeInvisible(JSON.stringify(v)));

export function report(r) {
  const f = r.facts;
  const out = [`detected on ${plain(f.branch)} at ${f.base_sha.slice(0, 12)}: ${f.tree.files} files`, ''];
  out.push(`stacks: ${f.stacks.length ? f.stacks.map((s) => `${s.name} (${s.markers.slice(0, 3).map(plain).join(', ')}${s.markers.length > 3 ? ', …' : ''})`).join('; ') : 'none found'}`);
  const c = f.compose;
  out.push(`compose: ${c.state === 'ok' ? `${plain(c.file)}, services ${Object.keys(c.services).map(plain).join(', ')}` : c.state === 'none' ? 'none found' : `${plain(c.file)} not read: ${plain(c.reason)}`}`);
  out.push(`levels:${f.levels.length ? '' : ' none found'}`);
  for (const l of f.levels) out.push(`  ${plain(l.name)}: ${argv(l.command)} in ${plain(l.service)}${l.workdir ? ` at ${plain(l.workdir)}` : ''}, adapter ${l.adapter}${l.report_root ? `, report_root ${plain(l.report_root)}` : ''} (${plain(l.marker)}${l.suites ? `; suites ${l.suites.map(plain).join(', ')}` : ''})`);
  out.push(`checks:${f.checks.length ? '' : ' none found'}`);
  for (const k of f.checks) out.push(`  ${plain(k.name)}: ${argv(k.command)} in ${plain(k.service)}${k.workdir ? ` at ${plain(k.workdir)}` : ''} (${plain(k.source)})`);
  if (f.worktree.safe !== null) out.push(`worktree_safe: ${f.worktree.safe}`, ...f.worktree.reasons.map((x) => `  ${plain(x)}`));
  const b = f.git.branches;
  out.push(`branch pattern: ${b.pattern ? `${plain(b.pattern)} (${b.fitting} of ${b.branches} branches)` : `none found (${b.branches} branches)`}`);
  out.push(`commits: ${f.git.commits.format} (${f.git.commits.commits} read; ${f.git.commits.conventional} Conventional Commits, ${f.git.commits.with_key} with a ticket key)`);
  out.push(`G8: ${f.git.g8.state === 'check' ? 'to check' : 'no rule in the repo'}: ${plain(f.git.g8.why)}`);
  const ins = f.instructions;
  const mirai = ins.files.filter((x) => x.state === 'mirai').length;
  out.push(`agent-instruction files: ${ins.files.length}${ins.more ? ` (and ${ins.more} more, not read)` : ''}${mirai ? `, ${mirai} rendered by MIRAI and unchanged` : ''}; ${ins.flags.length + ins.cut} commands flagged (hints for review, not a verdict: none flagged isn't "clean")`);
  const why = { 'too-large': 'over 256 KiB', binary: 'binary', 'read-limit': 'detection\'s read limit', link: 'a link, never followed' };
  for (const x of ins.files.filter((y) => why[y.state])) out.push(`  ${plain(x.path)}: not read (${why[x.state]})`);
  for (const x of ins.files.filter((y) => y.skipped_lines)) out.push(`  ${plain(x.path)}: ${x.skipped_lines} lines too long to read`);
  for (const x of ins.flags.slice(0, 50)) out.push(`  ${plain(x.path)}:${x.line} ${x.kind} (${x.pattern}): ${plain(x.text)}`);
  if (ins.flags.length + ins.cut > 50) out.push(`  … and ${ins.flags.length + ins.cut - 50} more in facts.json`);
  out.push('', `gaps: ${f.gaps.length || 'none'}`, ...f.gaps.map((g) => `  - ${plain(g.text)}`));
  out.push('', `differences from your committed .mirai/config.toml (on ${plain(f.branch)}): ${r.differences.length || 'none'}`);
  for (const d of r.differences) out.push(`  ${plain(d.key)}`, `    draft: ${shown(d.draft)}`, `    yours: ${shown(d.current)}`);
  out.push('', `draft: ${r.dir}/config.draft.toml`, `facts: ${r.dir}/facts.json`, 'Nothing here is in use: copy what you want into .mirai/config.toml.', '');
  return out.join('\n');
}

export default {
  name: 'detect',
  summary: 'Detect stacks, test levels and checks, and write a draft config to review',
  usage: 'mirai detect [--json]',
  positionals: { min: 0, max: 0 },
  options: {
    json: { type: 'boolean', description: 'print the facts and the differences as JSON' },
  },
  async run(args, io) {
    // `io.docker`: a test's stand-in for Docker Desktop (never set by the CLI itself).
    const r = await detect({ cwd: io.cwd, env: io.env, ...(io.docker ? { docker: io.docker } : {}) });
    // JSON escapes control characters itself; invisible ones (bidi marks) are escaped too.
    if (args.values.json) io.stdout.write(`${escapeInvisible(JSON.stringify({ facts: r.facts, differences: r.differences, draft: `${r.dir}/config.draft.toml` }, null, 2))}\n`);
    else io.stdout.write(report(r));
    return EXIT.OK;
  },
};
