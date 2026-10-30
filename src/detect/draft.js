import { checkConfig } from '../config/load.js';
import { parseToml } from '../config/toml.js';
import { ConfigError } from '../cli/errors.js';
import { escapeInvisible } from '../status/text.js';

// The draft config (unit 17a): a whole `.mirai/config.toml` built from the facts, each value
// with a comment saying where it came from, and each gap as a "# check:" comment. It's loaded
// through the config schema before it's written (a draft that doesn't validate is MIRAI's bug,
// and nothing is written). It never replaces your config: `differences` lists, key by key, what
// differs from it, and you copy what you want.

// Control and invisible characters (bidi marks, zero-width ones) escaped, so the draft reads as
// it is, in an editor or a terminal.
const str = (v) => `"${escapeInvisible(String(v).replace(/[\\"\x00-\x1f\x7f]/g, (c) => (c === '\\' || c === '"' ? `\\${c}` : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)))}"`;
const val = (v) => (Array.isArray(v) ? `[${v.map(val).join(', ')}]` : typeof v === 'boolean' ? String(v) : str(v));
// A comment's text on one line, with nothing that could end it.
const note = (text) => `# ${escapeInvisible(String(text).replace(/[\x00-\x1f\x7f]+/g, ' '))}`;

const RUN_KEYS = ['service', 'workdir', 'run'];
const pickRun = (x) => Object.fromEntries(RUN_KEYS.filter((k) => x[k] !== undefined).map((k) => [k, x[k]]));

// A level's and a check's entries in the config, from the facts.
export const levelEntry = (l) => ({ name: l.name, command: l.command, ...pickRun(l), adapter: l.adapter, ...(l.report_root ? { report_root: l.report_root } : {}) });
export const checkEntry = (c) => ({ command: c.command, ...pickRun(c) });

// Why one drafted entry doesn't fit the config schema (a value from the repo, such as a folder
// with a space as report_root), or null. Such an entry becomes a gap, never a failed run.
export function entryProblem(entry, kind) {
  const value = { schema_version: 1, git: { integration_branch: 'main' }, ...(kind === 'level' ? { testing: { levels: [entry] } } : { checks: { [entry.name]: checkEntry(entry) } }) };
  try {
    checkConfig([{ kind: 'project', file: { value, positions: new Map([['schema_version', { line: 1, column: 1, type: 'integer' }]]), source: 'draft' } }]);
    return null;
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    return (err.errors ?? [])[0]?.reason ?? err.message;
  }
}

// The draft's value: { git, gate?, compose?, workspace?, testing?, checks? }.
export function draftValue(facts, { integrationBranch }) {
  const v = { git: { integration_branch: integrationBranch } };
  if (facts.git.branches.pattern) v.git.branch_pattern = facts.git.branches.pattern;
  const packs = [...new Set(facts.stacks.map((s) => s.pack).filter(Boolean))].sort();
  if (packs.length) v.gate = { packs };
  if (facts.compose.state === 'ok') {
    v.compose = { files: [facts.compose.file], ...(facts.env_file ? { env_file: facts.env_file } : {}) };
    v.workspace = { worktree_safe: facts.worktree.reasons.length === 0 };
  }
  if (facts.levels.length) {
    v.testing = { levels: facts.levels.map(levelEntry) };
  }
  if (facts.checks.length) v.checks = Object.fromEntries(facts.checks.map((c) => [c.name, checkEntry(c)]));
  return v;
}

// The draft's text: `value` from draftValue, with the facts' sources and gaps as comments.
export function draftText(value, facts, { now }) {
  const out = [
    note(`A draft from mirai detect (unit 17a), ${now.toISOString()}, for ${facts.branch} at ${facts.base_sha.slice(0, 12)}.`),
    note('Nothing here is in use. mirai detect lists how it differs from .mirai/config.toml; copy what you want there.'),
  ];
  const gaps = (topic) => facts.gaps.filter((g) => g.topic === topic).map((g) => note(`check: ${g.text}`));
  out.push('schema_version = 1', '', '[git]', `integration_branch = ${val(value.git.integration_branch)}`);
  const b = facts.git.branches;
  if (value.git.branch_pattern) out.push(note(`from ${b.fitting} of ${b.branches} branches${b.keys.length ? `; ticket keys ${b.keys.map((k) => `${k.prefix}-<n>`).join(', ')}` : ''}`), `branch_pattern = ${val(value.git.branch_pattern)}`);
  out.push(...gaps('git'));
  if (value.gate) out.push('', '[gate]', note(`from ${facts.stacks.filter((s) => s.pack).map((s) => `${s.markers.slice(0, 3).join(', ')}${s.markers.length > 3 ? ', …' : ''} (${s.name})`).join('; ')}`), `packs = ${val(value.gate.packs)}`);
  out.push(...gaps('stacks'));
  if (value.compose) {
    out.push('', '[compose]', note(`from ${facts.compose.file}, resolved with an empty env file (your .env isn't read)`), `files = ${val(value.compose.files)}`);
    if (value.compose.env_file) out.push(`env_file = ${val(value.compose.env_file)}`);
  }
  out.push(...gaps('compose'));
  if (value.workspace) {
    out.push('', '[workspace]', ...(facts.worktree.reasons.length ? facts.worktree.reasons.map((r) => note(`false: ${r}`)) : [note('nothing binds the toolchain to this checkout')]), `worktree_safe = ${val(value.workspace.worktree_safe)}`);
  }
  for (const l of value.testing?.levels ?? []) {
    const f = facts.levels.find((x) => x.name === l.name);
    out.push('', note(`from ${f.marker} (${f.adapter}), in ${f.service}, which mounts ${f.mount}${f.others.length ? `; ${f.others.join(', ')} mount it too` : ''}`));
    if (f.suites) out.push(note(`suites in ${f.marker}: ${f.suites.join(', ')} (facts only: a level runs them all)`));
    out.push('[[testing.levels]]', ...Object.entries(l).map(([k, x]) => `${k} = ${val(x)}`));
  }
  out.push(...gaps('levels'));
  if (value.checks) {
    out.push('', '[checks]');
    for (const [name, c] of Object.entries(value.checks)) {
      const f = facts.checks.find((x) => x.name === name);
      out.push(note(`from ${f.source}, in ${f.service}`), `${name} = { ${Object.entries(c).map(([k, x]) => `${k} = ${val(x)}`).join(', ')} }`);
    }
  }
  out.push(...gaps('checks'));
  const rest = facts.gaps.filter((g) => !['git', 'stacks', 'compose', 'levels', 'checks'].includes(g.topic));
  if (rest.length) out.push('', ...rest.map((g) => note(`check: ${g.text}`)));
  return `${out.join('\n')}\n`;
}

// Loads the draft's text as a project config file; throws the config's own error when it doesn't
// validate.
export function checkDraft(text) {
  const { value, positions } = parseToml(text, { source: 'config.draft.toml', positions: true });
  return checkConfig([{ kind: 'project', file: { value, positions, source: 'config.draft.toml' } }]).config;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// What differs between the draft's value and your committed config file's own values (not its
// defaults; the integration branch's file, which is what runs):
// [{ key, draft, current }], `undefined` for a side that doesn't have the key. Levels and checks
// are compared by name.
export function differences(draft, current) {
  const out = [];
  const add = (key, a, b) => {
    if (!same(plain(a), plain(b))) out.push({ key, draft: plain(a), current: plain(b) });
  };
  add('git.branch_pattern', draft.git.branch_pattern, current.git?.branch_pattern);
  add('gate.packs', draft.gate?.packs, current.gate?.packs === undefined ? undefined : [...current.gate.packs].sort());
  add('compose.files', draft.compose?.files, current.compose?.files);
  add('compose.env_file', draft.compose?.env_file, current.compose?.env_file);
  add('workspace.worktree_safe', draft.workspace?.worktree_safe, current.workspace?.worktree_safe);
  const levels = (list) => new Map((list ?? []).map((l) => [l.name, l]));
  const dl = levels(draft.testing?.levels);
  const cl = levels(current.testing?.levels);
  const pick = (l) => (l === undefined ? undefined : Object.fromEntries(['command', ...RUN_KEYS, 'adapter', 'report_root'].filter((k) => l[k] !== undefined).map((k) => [k, l[k]])));
  for (const name of [...new Set([...dl.keys(), ...cl.keys()])]) add(`testing.levels.${name}`, pick(dl.get(name)), pick(cl.get(name)));
  const checks = (c) => (c === undefined ? undefined : Array.isArray(c) ? { command: c } : pick(c));
  for (const name of [...new Set([...Object.keys(draft.checks ?? {}), ...Object.keys(current.checks ?? {})])]) add(`checks.${name}`, checks(draft.checks?.[name]), checks(current.checks?.[name]));
  return out;
}
