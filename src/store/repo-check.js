import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { allowedByEntry, classifyRepoKey } from '../config/git-repo-keys.js';

// The repo check (unit 14b; research/11, "What this means for 14b"): what the pins can't switch
// off, refused before MIRAI's git runs on a checkout.
// - checkShape: `.git` is a real folder of this checkout, with nothing that sends git elsewhere
//   (lstat only, no git);
// - checkConfig: every key of the repo's own config is known, or allowed by you
//   (src/config/git-repo-keys.js); read with `git config --file`, which never follows includes;
// - checkLfs: an LFS repo is refused (pinned git has no LFS filter);
// - checkNested: no nested repo, since `add -A` runs its filters with its own config.
// The git calls come in as callbacks (`listConfig`, `attributeFiles`) from src/store/git.js, so
// this file has no git of its own.

// A key as shown to you: a URL in its subsection (`url.<base>.insteadOf`, `http.<url>.proxy`)
// can carry a credential, which is never printed (14b review).
export function shownKey(key) {
  return key.replace(/\/\/[^/]*@/g, '//<redacted>@').replace(/(^|\.)[^./@]*:[^/@]*@/g, '$1<redacted>@');
}

const refuse = (message, code, hint, path) => new StoreError(message, { code, hint, path, exitCode: EXIT.BLOCKED });

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    throw new StoreError(`${path}: can't be read (${err.code})`, { path, code: 'unreadable' });
  }
}

// Files that make git read objects or a repo from somewhere else.
const ELSEWHERE = Object.freeze({
  commondir: 'points git at another repo\'s files',
  'objects/info/alternates': 'reads objects from another folder',
  'objects/info/http-alternates': 'reads objects from a URL',
  'info/grafts': 'rewrites the history git sees',
});

export function checkShape(top) {
  const git = join(top, '.git');
  const g = lstatOrNull(git);
  if (!g) throw refuse(`${top} has no .git folder`, 'repo-shape', 'run MIRAI in the top folder of a git checkout', git);
  if (g.isFile()) throw gitFileError(git);
  if (!g.isDirectory()) throw refuse(`${git} is not a folder`, 'repo-shape', 'MIRAI runs only in a checkout whose .git is a real folder', git);
  const config = lstatOrNull(join(git, 'config'));
  if (!config?.isFile()) throw refuse(`${git}/config is not a file`, 'repo-shape', 'a symbolic link or a missing config is refused: MIRAI reads only the repo\'s own config', join(git, 'config'));
  for (const [rel, why] of Object.entries(ELSEWHERE)) {
    if (lstatOrNull(join(git, rel))) throw refuse(`.git/${rel} exists: it ${why}`, 'repo-shape', `MIRAI doesn't run git on such a repo; remove .git/${rel} if you didn't add it`, join(git, rel));
  }
  // The folders git reads code, objects and refs from must be real folders of this .git: a link
  // there reads them from elsewhere, like alternates (14b review).
  for (const rel of ['info', 'hooks', 'objects', 'objects/info', 'refs', 'refs/heads', 'refs/tags', 'HEAD', 'packed-refs', 'remotes', 'branches']) {
    if (lstatOrNull(join(git, rel))?.isSymbolicLink()) throw refuse(`.git/${rel} is a symbolic link`, 'repo-shape', 'MIRAI runs git only on a .git whose folders are its own', join(git, rel));
  }
  for (const sub of ['info', 'hooks']) noLinks(join(git, sub), `.git/${sub}`);
}

export const gitFileError = (path) => refuse(`${path} is a file, not a folder (a worktree, a submodule or a link to another repo)`, 'git-file',
  'MIRAI runs in the main checkout of a repo, whose .git is a folder', path);

function noLinks(dir, shown) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw new StoreError(`${dir}: can't be read (${err.code})`, { path: dir, code: 'unreadable' });
  }
  for (const name of names) {
    const info = lstatSync(join(dir, name));
    if (info.isSymbolicLink()) throw refuse(`${shown}/${name} is a symbolic link`, 'repo-shape', `MIRAI hashes ${shown} as files; replace the link with the file`, join(dir, name));
    if (info.isDirectory()) noLinks(join(dir, name), `${shown}/${name}`);
    else if (!info.isFile()) throw refuse(`${shown}/${name} is not a file`, 'repo-shape', undefined, join(dir, name));
  }
}

// What a config check depends on, so it runs again only when one of these changes.
export function configSignature(top) {
  return ['config', 'config.worktree', 'info/attributes'].map((rel) => {
    const s = lstatOrNull(join(top, '.git', rel));
    return s ? `${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}` : '-';
  }).join('|') + `|${lstatOrNull(join(top, '.lfsconfig')) ? 'lfsconfig' : '-'}`;
}

// `git config --file <f> --list --null` output: [[key, value]]; a key with no value (`[core]
// bare`) has value null.
export function parseConfigList(bytes) {
  return bytes.toString('utf8').split('\0').filter(Boolean).map((entry) => {
    const nl = entry.indexOf('\n');
    return nl === -1 ? [entry, null] : [entry.slice(0, nl), entry.slice(nl + 1)];
  });
}

// `listConfig(file)` returns parseConfigList's pairs for one config file. `allow`: your
// `[git] allow_repo_config` entries.
export function checkConfig(top, { listConfig, allow = [] }) {
  const files = ['.git/config'];
  const main = listConfig(join(top, '.git', 'config'));
  const pairs = main.map(([k, v]) => ({ file: '.git/config', key: k, value: v }));
  // Checked whenever it exists, whatever extensions.worktreeConfig says: git's own reading of
  // that switch (a bare key, any non-zero number) is wider than a list of words (14b review).
  const wt = join(top, '.git', 'config.worktree');
  if (lstatOrNull(wt)) {
    if (!lstatSync(wt).isFile()) throw refuse('.git/config.worktree is not a file', 'repo-shape', undefined, wt);
    files.push('.git/config.worktree');
    pairs.push(...listConfig(wt).map(([k, v]) => ({ file: '.git/config.worktree', key: k, value: v })));
  }
  const never = [];
  const unknown = [];
  let lfs = null;
  for (const p of pairs) {
    const c = classifyRepoKey(p.key, p.value === null ? 'true' : p.value);
    if (c.cls === 'lfs') lfs ??= `${p.file} sets ${p.key}`;
    else if (c.cls === 'never') never.push({ ...p, reason: c.reason });
    else if (c.cls === 'unknown' && !allowedByEntry(p.key, allow)) unknown.push(p);
  }
  // Key names only, never values: a value can hold a credential (a remote URL).
  if (never.length) {
    const [first] = never;
    const shown = shownKey(first.key);
    const more = never.length > 1 ? ` (and ${never.length - 1} more: ${never.slice(1).map((p) => shownKey(p.key)).join(', ')})` : '';
    const remove = shown === first.key ? `remove it (git config --file ${first.file} --unset-all ${first.key})` : `remove that section from ${first.file}`;
    throw refuse(`MIRAI won't run git on this repo: ${first.file} sets ${shown}, which ${first.reason}${more}`, 'repo-config',
      `your own git would run it too; if you didn't add it, ${remove}. It can't be allowed (docs/agent-safety.md, "MIRAI's own git")`, join(top, first.file));
  }
  if (lfs) throw lfsError(lfs);
  if (unknown.length) {
    const keys = [...new Set(unknown.map((p) => shownKey(p.key)))];
    throw refuse(`MIRAI won't run git on this repo: ${unknown[0].file} sets ${keys.join(', ')}, which MIRAI doesn't know`, 'repo-config',
      `if you trust ${keys.length === 1 ? 'it' : 'them'}, add ${keys.map((k) => `"${k}"`).join(', ')} to [git] allow_repo_config in ~/.config/mirai/config.toml (docs/agent-safety.md, "MIRAI's own git")`, join(top, unknown[0].file));
  }
}

const lfsError = (found) => refuse(`MIRAI doesn't run on Git LFS repos yet: ${found}`, 'repo-lfs',
  'MIRAI\'s git has no LFS filter, so every LFS file would look changed (docs/agent-safety.md, "MIRAI\'s own git")');

const LFS_ATTRIBUTE = /(^|\s)filter=lfs(\s|$)/m;
const MAX_ATTRIBUTES_BYTES = 1024 * 1024;

// `attributeFiles()` lists the committed `.gitattributes` paths (repo-relative).
export function checkLfs(top, { attributeFiles }) {
  if (lstatOrNull(join(top, '.lfsconfig'))) throw lfsError('the checkout has a .lfsconfig');
  const read = (abs) => {
    const s = lstatOrNull(abs);
    if (!s?.isFile() || s.size > MAX_ATTRIBUTES_BYTES) return '';
    return readFileSync(abs, 'utf8');
  };
  if (LFS_ATTRIBUTE.test(read(join(top, '.git', 'info', 'attributes')))) throw lfsError('.git/info/attributes names filter=lfs');
  for (const rel of attributeFiles()) {
    if (LFS_ATTRIBUTE.test(read(join(top, rel)))) throw lfsError(`${rel} names filter=lfs`);
  }
}

// `stage` is `git ls-files --stage -z` output; `others` the untracked names git listed (a nested
// repo shows as one name ending in "/"). Ignored nested repos (inside an ignored folder) never
// reach `add -A`, so they don't count.
export function checkNested(stage, others = []) {
  for (const line of stage.toString('utf8').split('\0')) {
    if (line.startsWith('160000 ')) return nestedError(line.slice(line.indexOf('\t') + 1), 'is a submodule or a committed nested repo');
  }
  const nested = others.find((n) => n.endsWith('/'));
  if (nested) return nestedError(nested.slice(0, -1), 'is a nested git repo');
  return undefined;
}

function nestedError(path, what) {
  throw refuse(`${path} ${what}`, 'repo-nested', 'MIRAI doesn\'t run git on repos with nested repos: git would run their own config when adding files. Remove it, or add it to .gitignore if it isn\'t part of the project');
}
