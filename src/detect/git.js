// The project's git conventions (unit 17a; design/01 §1 step 1): its branch pattern and commit
// format, from branch names and the last commits' messages read with the pinned git
// (src/store/git.js branchRefs, commitMessages), and G8 (whether the Mirai-Ticket trailer can
// meet a commit-message rule here). Never a hook, never a filter, never the project's tools.

// A ticket key as trackers write it: capital letters (and digits), a dash, a number.
const KEY = /^[A-Z][A-Z0-9]{1,9}-[0-9]{1,9}$/;
const KEY_IN = /\b[A-Z][A-Z0-9]{1,9}-[0-9]{1,9}\b/;
const BRANCH = /^(?:([A-Za-z0-9._-]{1,40}(?:\/[A-Za-z0-9._-]{1,40}){0,2})\/)?([A-Z][A-Z0-9]{1,9}-[0-9]{1,9})(?:([-_])([A-Za-z0-9][A-Za-z0-9._/-]*))?$/;
const CONVENTIONAL = /^[a-z]+(?:\([^()\r\n]{1,64}\))?!?: \S/;
const TRAILER = /^([A-Za-z][A-Za-z0-9-]{0,63}): \S/;
export const CONVENTIONS = Object.freeze({ minBranches: 5, branchShare: 0.6, minCommits: 10, commitShare: 0.8 });

// A branch's name without refs/heads/ or refs/remotes/<remote>/ (`remotes`: the remote names).
export function shortBranch(ref, remotes) {
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
  const rest = ref.slice('refs/remotes/'.length);
  const remote = [...remotes].sort((a, b) => b.length - a.length).find((r) => rest.startsWith(`${r}/`));
  return remote ? rest.slice(remote.length + 1) : rest.slice(rest.indexOf('/') + 1);
}

// The branch pattern: { pattern | null, branches, fitting, shapes: [{ template, count }], keys:
// [{ prefix, count }] }. A shape is the name with its key as {ticket}, the rest as {slug}, and up
// to three folders before the key kept as they are (`users/jet/{ticket}-{slug}`); one
// shape held by `branchShare` of the branches (at least `minBranches` of them, the integration
// branch left out) is the pattern.
export function branchPattern(refs, { integration, remotes = [] }) {
  const names = [...new Set(refs.map((r) => shortBranch(r, remotes)))].filter((n) => n !== integration && n !== '');
  const shapes = new Map();
  const keys = new Map();
  for (const n of names) {
    const m = BRANCH.exec(n);
    if (!m || !KEY.test(m[2])) continue;
    const template = `${m[1] ? `${m[1]}/` : ''}{ticket}${m[3] ? `${m[3]}{slug}` : ''}`;
    shapes.set(template, (shapes.get(template) ?? 0) + 1);
    const prefix = m[2].slice(0, m[2].indexOf('-'));
    keys.set(prefix, (keys.get(prefix) ?? 0) + 1);
  }
  const ranked = [...shapes].map(([template, count]) => ({ template, count })).sort((a, b) => b.count - a.count || a.template.localeCompare(b.template));
  const top = ranked[0];
  const enough = names.length >= CONVENTIONS.minBranches && top && top.count / names.length >= CONVENTIONS.branchShare;
  return {
    pattern: enough ? top.template : null,
    branches: names.length,
    fitting: top?.count ?? 0,
    shapes: ranked.slice(0, 5),
    keys: [...keys].map(([prefix, count]) => ({ prefix, count })).sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix)).slice(0, 5),
  };
}

// The commit format of `messages` (full messages, newest first): { commits, conventional,
// with_key, format: 'conventional' | 'ticket-key' | 'free' | 'unknown', trailers: [{ key, count }] }.
// A format holds when `commitShare` of at least `minCommits` commits follow it.
export function commitFormat(messages) {
  let conventional = 0;
  let withKey = 0;
  const trailers = new Map();
  for (const m of messages) {
    const text = m.replace(/\r\n/g, '\n').trim();
    const subject = text.split('\n', 1)[0];
    if (CONVENTIONAL.test(subject)) conventional++;
    if (KEY_IN.test(subject)) withKey++;
    const paragraphs = text.split(/\n[ \t]*\n/);
    if (paragraphs.length < 2) continue;
    const last = paragraphs.at(-1).split('\n');
    if (!last.every((l) => TRAILER.test(l))) continue;
    for (const l of last) {
      const key = TRAILER.exec(l)[1];
      const k = key.toLowerCase();
      const seen = trailers.get(k) ?? { key, count: 0 };
      seen.count++;
      trailers.set(k, seen);
    }
  }
  const n = messages.length;
  const holds = (count) => n >= CONVENTIONS.minCommits && count / n >= CONVENTIONS.commitShare;
  const format = n < CONVENTIONS.minCommits ? 'unknown' : holds(conventional) ? 'conventional' : holds(withKey) ? 'ticket-key' : 'free';
  return { commits: n, conventional, with_key: withKey, format, trailers: [...trailers.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, 10) };
}

// G8 for this project: { state: 'no-local-rule' | 'check', why }. Only committed files are seen:
// a rule the code host enforces (a ruleset, a push rule, a pre-receive hook) isn't, so even with
// no rule in the repo this is "none found here", never a pass; unit 22 settles G8 (and unit 39
// asks about the host). A rule is never run: it's the project's code.
export function g8({ rules, format, trailer = 'Mirai-Ticket' }) {
  const host = 'a rule on the code host (a ruleset, a push rule) isn\'t seen from here';
  if (rules.length) return { state: 'check', why: `a commit-message rule is committed (${rules.slice(0, 5).join(', ')}${rules.length > 5 ? ', …' : ''}): check that a "${trailer}: <id>" trailer passes it (unit 22)` };
  if (format === 'conventional' || format === 'ticket-key') return { state: 'check', why: `no rule is committed, but the commits follow a ${format === 'conventional' ? 'Conventional Commits' : 'ticket-key'} format: MIRAI's commits should too (unit 22); ${host}` };
  if (format === 'unknown') return { state: 'check', why: `too few commits to tell their format, and no rule is committed: check with whoever owns the repo (unit 22); ${host}` };
  return { state: 'no-local-rule', why: `no commit-message rule is committed, and the commits follow no strict format, so a "${trailer}: <id>" trailer meets everything in the repo; ${host}` };
}
