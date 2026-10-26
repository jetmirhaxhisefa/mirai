// Which keys a repo's own git config may hold for MIRAI to run git on it (unit 14b; research/11,
// "Host git"). Three classes:
// - known: keys that run nothing under MIRAI's pinned git, including the ones the pins override;
// - never: keys that can run code or redirect git, which no pin stops; refused, and no opt-in;
// - unknown: everything else; refused unless `[git] allow_repo_config` in your personal config
//   names it.
// Git LFS keys are their own case (`lfs`): pinned git has no LFS filter, so an LFS repo is refused
// with its own message.
//
// Keys come as `git config --list` prints them: the section and the variable lowercased, a
// subsection (`remote.<name>.url`) as written.

const KNOWN_PLAIN = Object.freeze({
  core: ['repositoryformatversion', 'filemode', 'bare', 'logallrefupdates', 'ignorecase', 'precomposeunicode', 'symlinks', 'autocrlf', 'eol', 'safecrlf',
    'checkstat', 'trustctime', 'untrackedcache', 'commitgraph', 'multipackindex', 'compression',
    'sparsecheckout', 'sparsecheckoutcone', 'splitindex', 'preloadindex', 'longpaths',
    // overridden by the pins (src/store/git-pins.js)
    'hookspath', 'fsmonitor', 'sshcommand', 'pager', 'editor', 'askpass', 'excludesfile', 'attributesfile', 'quotepath'],
  extensions: ['objectformat', 'worktreeconfig'],
  init: ['defaultbranch'],
  push: ['default', 'autosetupremote', 'gpgsign', 'recursesubmodules'],
  fetch: ['prune', 'prunetags', 'recursesubmodules', 'writecommitgraph'],
  remote: ['pushdefault'],
  index: ['sparse'],
  feature: ['manyfiles'],
  merge: ['ff', 'conflictstyle', 'verifysignatures'],
  rebase: ['autostash', 'autosquash', 'updaterefs'],
  rerere: ['enabled'],
  commit: ['gpgsign'],
  tag: ['gpgsign'],
  log: ['showsignature'],
  http: ['proxy'],
  // overridden by the pins and the diff flags (--no-ext-diff)
  diff: ['external', 'noprefix', 'mnemonicprefix', 'relative', 'ignoresubmodules', 'renames', 'algorithm'],
});
// Sections known whole, with or without a subsection.
const KNOWN_SECTIONS = new Set(['branch', 'user', 'author', 'committer', 'pull', 'gc', 'alias', 'credential', 'gpg', 'color', 'status', 'maintenance', 'pack', 'gui']);
const KNOWN_REMOTE = new Set(['url', 'pushurl', 'fetch', 'tagopt', 'prune', 'prunetags', 'skipdefaultupdate', 'skipfetchall', 'gh-resolved']);

// Why each never key is refused, shown to you.
const RUNS = 'runs a program';
const NEVER_SECTIONS = Object.freeze({
  include: 'reads another config file, which MIRAI doesn\'t check',
  includeif: 'reads another config file, which MIRAI doesn\'t check',
  filter: `${RUNS} on your files (a filter)`,
  url: 'rewrites where git connects',
  protocol: 'allows git transports MIRAI keeps off',
  uploadpack: 'changes what a fetch runs',
  receive: 'changes what a push runs',
  submodule: 'MIRAI doesn\'t run git on repos with submodules',
});
const NEVER_CORE = Object.freeze({ worktree: 'moves the work tree elsewhere', gitproxy: RUNS, alternaterefscommand: RUNS });
const NEVER_REMOTE = new Set(['uploadpack', 'receivepack', 'proxy', 'proxyauthmethod', 'vcs', 'promisor', 'partialclonefilter']);

const SECTION_ONLY = /^[a-z0-9-]+$/;

// Splits a key into { section, sub, name }: section and name lowercased, sub null when absent.
export function splitKey(key) {
  const first = key.indexOf('.');
  const last = key.lastIndexOf('.');
  if (first <= 0 || last === key.length - 1) return null;
  return {
    section: key.slice(0, first).toLowerCase(),
    sub: first === last ? null : key.slice(first + 1, last),
    name: key.slice(last + 1).toLowerCase(),
  };
}

// { cls: 'known' | 'never' | 'unknown' | 'lfs', reason? } for one key and its value.
export function classifyRepoKey(key, value) {
  const k = splitKey(key);
  if (!k) return { cls: 'unknown' };
  const { section, sub, name } = k;
  if (section === 'lfs' || (section === 'filter' && sub?.toLowerCase() === 'lfs')) return { cls: 'lfs' };
  if (NEVER_SECTIONS[section]) return { cls: 'never', reason: NEVER_SECTIONS[section] };
  if (section === 'core' && !sub) {
    if (NEVER_CORE[name]) return { cls: 'never', reason: NEVER_CORE[name] };
    if (name === 'bare' && String(value).toLowerCase() !== 'false') return { cls: 'never', reason: 'MIRAI runs only in a checkout with a work tree' };
  }
  if (section === 'remote' && sub) {
    if (NEVER_REMOTE.has(name)) return { cls: 'never', reason: 'changes how git reaches the remote' };
    return KNOWN_REMOTE.has(name) ? { cls: 'known' } : { cls: 'unknown' };
  }
  // Run by `commit --trailer` and `interpret-trailers`, and when signing: unit 22 commits with a
  // trailer (14b review).
  if (section === 'trailer' && sub && (name === 'command' || name === 'cmd')) return { cls: 'never', reason: `${RUNS} when a commit gets a trailer` };
  if (section === 'gpg' && name === 'defaultkeycommand') return { cls: 'never', reason: `${RUNS} when signing` };
  if (section === 'merge' && sub && name === 'driver') return { cls: 'never', reason: `${RUNS} on a merge (a merge driver)` };
  if (section === 'diff' && sub) return { cls: 'never', reason: `${RUNS} on a diff (a diff driver or textconv)` };
  if (section === 'http' && sub) return { cls: 'never', reason: 'sets HTTP options for one URL, which outrank MIRAI\'s pins' };
  if (section === 'extensions' && name === 'partialclone') return { cls: 'never', reason: 'makes git fetch missing objects over the network' };
  if (KNOWN_SECTIONS.has(section)) return { cls: 'known' };
  if (!sub && KNOWN_PLAIN[section]?.includes(name)) return { cls: 'known' };
  return { cls: 'unknown' };
}

// An `allow_repo_config` entry: an exact key or `section.*`. Returns why it can't be allowed, or
// null. Entries that would allow a never key (or an LFS one) can't be opted in. What an opt-in
// allows is judged against MIRAI's git commands of today; a unit that adds a git command
// re-checks these lists (and probes it).
export function allowEntryProblem(entry) {
  if (entry.endsWith('.*')) {
    const section = entry.slice(0, -2).toLowerCase();
    if (!SECTION_ONLY.test(section)) return 'use an exact key or a section such as "difftool.*"';
    if (NEVER_SECTIONS[section] || section === 'lfs') return `${section}.* can never be allowed`;
    if (['core', 'remote', 'merge', 'diff', 'http', 'extensions', 'filter', 'trailer', 'gpg'].includes(section)) return `${section}.* is too wide: name the exact keys`;
    return null;
  }
  const k = splitKey(entry);
  if (!k || /\s/.test(entry)) return 'use an exact key or a section such as "difftool.*"';
  const c = classifyRepoKey(entry, 'false');
  if (c.cls === 'never' || c.cls === 'lfs') return `${entry} can never be allowed`;
  return null;
}

// Whether `allow` (checked entries) names this key.
export function allowedByEntry(key, allow) {
  const k = splitKey(key);
  if (!k) return false;
  const norm = `${k.section}.${k.sub === null ? '' : `${k.sub}.`}${k.name}`;
  return allow.some((e) => (e.endsWith('.*') ? k.section === e.slice(0, -2).toLowerCase() : (() => {
    const a = splitKey(e);
    return a !== null && `${a.section}.${a.sub === null ? '' : `${a.sub}.`}${a.name}` === norm;
  })()));
}
