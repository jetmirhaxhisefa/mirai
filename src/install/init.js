import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { PROJECT_CONFIG, readConfigFile, checkConfig } from '../config/load.js';
import { BRANCH } from '../config/config-schema.js';
import { topLevel, isShallow, refExists, remotes, symbolicBranch, ignoredPaths } from '../store/git.js';
import { createStore, openStore } from '../store/home.js';
import { LOCK_FILE, checkLock, frameworkDigest, lockText, newer, readLock, sha256, filesUnder } from './lock.js';
import { LOCAL_FILE, applyPlan, renderPlan, undoAll } from './render.js';

// `mirai init` (unit 10; D-02, D-03, D-37). Copies MIRAI into a project, writes the lock, renders
// MIRAI's block in AGENTS.md, and creates the store in the MIRAI home. It refuses before
// writing anything when the repo isn't ready; it stages its files and moves them into place, and
// undoes what it did when a later step fails. It writes nothing under .git/, never commits and
// never uses the network.

// MIRAI's own package root, and what of it is the framework: its runtime and registry, so hooks
// and CI can run the copy without npx (D-03, D-15). A vendored licence added later must be
// listed here too.
export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const FRAMEWORK_PARTS = Object.freeze(['bin', 'src', 'registry', 'package.json', 'LICENSE']);
const FRAMEWORK_DIR = '.mirai/framework';
const CONFIG_FILE = PROJECT_CONFIG.split('\\').join('/');

// MIRAI's own git rules for .mirai/: nothing in it is ignored (a rule elsewhere such as `*.lock`
// can't drop a MIRAI file), and its bytes are kept as they are (no line-ending conversion, so the
// hashes in the lock hold on every machine). A rule that ignores .mirai/ itself can't be undone
// from inside it, so `init` checks with git and refuses.
const GIT_RULES = Object.freeze({
  '.mirai/.gitignore': '# Written by mirai init: nothing in .mirai/ is ignored.\n!*\n',
  '.mirai/.gitattributes': '# Written by mirai init: .mirai/ files are kept byte for byte.\n* -text\n',
});

export class InitError extends MiraiError {
  constructor(message, { code, hint, exitCode = EXIT.BLOCKED } = {}) {
    super(message, exitCode);
    this.name = 'InitError';
    this.code = code;
    this.hint = hint;
  }
}

const LOCAL_STUB = `# This project's own instructions for AI tools

<!-- Written by mirai init; it's yours to edit. Its text is added to MIRAI's block in
AGENTS.md when you run mirai render. Keep it short: conventions an agent can't find in the
code, and what it must never do here. -->
`;

// Installs MIRAI into the repo around `cwd`. `branch`: the integration branch (else the one an
// existing config names, else the remote's default branch). `refresh`: an installed repo gets
// the running MIRAI's framework copy, and everything rendered again (unit 11); refused when a
// framework file was changed. `packageRoot`: the MIRAI to install (this one; tests pass
// another). Returns what it did, for the command to print.
export function init({ cwd, env, branch: wanted, refresh = false, now = () => new Date(), packageRoot = PACKAGE_ROOT }) {
  const root = checkRepo(cwd, env, { refresh });
  const oldLock = refresh ? readLock(root) : null;
  const configPath = join(root, PROJECT_CONFIG);
  const kept = existsSync(configPath) ? readFileSync(configPath) : null;
  if (refresh && kept === null) throw new InitError(`${CONFIG_FILE} is missing`, { code: 'no-config', hint: 'restore it from git, then run mirai init --refresh again' });
  const keptConfig = kept === null ? null : loadProjectConfig(root, configPath);
  const { branch, from: branchFrom } = integrationBranch(root, env, wanted, keptConfig);
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  // A refresh never goes back to an older MIRAI: documents written for newer templates would
  // stop passing lint.
  if (oldLock && newer(oldLock.miraiVersion, pkg.version)) {
    throw new InitError(`the installed MIRAI (${oldLock.miraiVersion}) is newer than this one (${pkg.version})`, { code: 'downgrade', hint: `run mirai init --refresh with MIRAI ${oldLock.miraiVersion} or later` });
  }
  const source = existsSync(join(packageRoot, '.git')) ? 'local' : `v${pkg.version}`;

  const undo = []; // what to undo, newest last
  const stage = join(root, '.mirai', `.init-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    if (!existsSync(join(root, '.mirai'))) {
      mkdirSync(join(root, '.mirai'));
      undo.push(() => rmSync(join(root, '.mirai'), { recursive: true, force: true }));
    }
    mkdirSync(stage);
    undo.push(() => rmSync(stage, { recursive: true, force: true }));

    // 1. The framework copy and MIRAI's git rules, staged.
    const files = [];
    for (const part of FRAMEWORK_PARTS) copyTree(join(packageRoot, part), join(stage, 'framework', part));
    for (const rel of filesUnder(stage, 'framework')) {
      files.push({ path: `.mirai/${rel}`, mark: 'framework', sha256: sha256(readFileSync(join(stage, rel))) });
    }
    for (const [path, text] of Object.entries(GIT_RULES)) {
      writeNew(join(stage, path.slice('.mirai/'.length)), text);
      files.push({ path, mark: 'framework', sha256: sha256(text) });
    }

    // 2. The config: yours when it exists (checked above), else a minimal one.
    let configBytes = kept;
    let config = keptConfig;
    if (kept === null) {
      configBytes = Buffer.from(`schema_version = 1\n\n[git]\nintegration_branch = ${tomlString(branch)}\n`, 'utf8');
      writeNew(join(stage, 'config.toml'), configBytes);
      config = loadProjectConfig(root, join(stage, 'config.toml'));
      if (config.git.integration_branch !== branch) {
        throw new InitError(`the config MIRAI wrote names "${config.git.integration_branch}", not "${branch}"`, { code: 'config-mismatch', exitCode: EXIT.FAILURE });
      }
    }
    files.push({ path: CONFIG_FILE, mark: 'project' });

    // 3. Your own instructions file, if absent.
    const localPath = join(root, LOCAL_FILE);
    const local = existsSync(localPath) ? readFileSync(localPath) : Buffer.from(LOCAL_STUB, 'utf8');
    if (!existsSync(localPath)) writeNew(join(stage, 'agents-local.md'), local);
    files.push({ path: LOCAL_FILE, mark: 'project' });

    // 4. The rendered files (AGENTS.md, CLAUDE.md, .claude/), planned from the staged framework
    // copy, as `mirai render` does from the installed one.
    const plan = renderPlan({ root, registryDir: join(stage, 'framework', 'registry'), config, configBytes, local, lock: oldLock });
    files.push(...plan.entries);

    // 5. The lock, staged last.
    writeNew(join(stage, 'mirai.lock'), lockText({ miraiVersion: pkg.version, source, bundles: plan.bundles, files }));

    // Into place: the framework, the git rules, the config, the context stub, the rendered
    // files; then a check that git sees them all; then the store, and the lock last, so an
    // install either has it or didn't happen.
    const wrote = [FRAMEWORK_DIR];
    if (refresh) swapAside(join(root, FRAMEWORK_DIR), join(stage, 'old-framework'), undo);
    move(join(stage, 'framework'), join(root, FRAMEWORK_DIR), undo);
    for (const [path, text] of Object.entries(GIT_RULES)) {
      if (existsSync(join(root, path))) {
        if (readFileSync(join(root, path), 'utf8') === text) continue;
        swapAside(join(root, path), join(stage, `old${path.slice('.mirai/'.length)}`), undo);
      }
      move(join(stage, path.slice('.mirai/'.length)), join(root, path), undo);
      wrote.push(path);
    }
    if (kept === null) { move(join(stage, 'config.toml'), configPath, undo); wrote.push(CONFIG_FILE); }
    if (existsSync(join(stage, 'agents-local.md'))) {
      wrote.push(LOCAL_FILE);
      if (!existsSync(dirname(localPath))) {
        mkdirSync(dirname(localPath), { recursive: true });
        undo.push(() => rmSync(dirname(localPath), { recursive: true, force: true }));
      }
      move(join(stage, 'agents-local.md'), localPath, undo);
    }
    applyPlan(root, plan, undo);
    wrote.push(...plan.files.filter((f) => f.changed).map((f) => f.path), ...plan.removes.map((r) => `${r.path} (removed)`), LOCK_FILE);

    const ignored = ignoredPaths(root, [...files.map((f) => f.path), LOCK_FILE], env);
    if (ignored.length) {
      throw new InitError(`git ignores MIRAI's files (${ignored.slice(0, 3).join(', ')}${ignored.length > 3 ? ', …' : ''})`, { code: 'ignored', hint: 'remove the rule that ignores them (for example `.mirai/` in .gitignore), then run mirai init again' });
    }

    // An existing store is reused; openStore refuses one set up for another integration branch.
    let store = openStore({ cwd: root, env, optional: true });
    if (store === null) {
      store = createStore({ cwd: root, env, now });
      const made = store.repoHome;
      undo.push(() => rmSync(made, { recursive: true, force: true }));
    }
    if (refresh) swapAside(join(root, LOCK_FILE), join(stage, 'old.lock'), undo);
    move(join(stage, 'mirai.lock'), join(root, LOCK_FILE), undo);
    rmSync(stage, { recursive: true, force: true });
    const edited = plan.files.filter((f) => f.edited).map((f) => `${f.path}: MIRAI's part had been edited by hand; it is rendered again`);
    return {
      root, branch, branchFrom, version: pkg.version, previous: oldLock?.miraiVersion, sameCopy: oldLock ? oldLock.frameworkSha256 === frameworkDigest(files) : undefined, source, store: store.repoHome, files: files.length, wrote,
      warnings: [...plan.warnings, ...edited],
    };
  } catch (err) {
    // Every step is undone, even when one of them fails; the first error is the one reported.
    undoAll(undo, err);
    throw err;
  }
}

// Moves an existing file or folder out of the way (into the stage), so a failure can put it
// back.
function swapAside(path, aside, undo) {
  renameSync(path, aside);
  undo.push(() => {
    rmSync(path, { recursive: true, force: true });
    renameSync(aside, path);
  });
}

function loadProjectConfig(root, path) {
  return checkConfig([{ kind: 'project', file: readConfigFile(path, { trust: 'project', source: CONFIG_FILE, within: root }) }]).config;
}

// A TOML basic string.
function tomlString(value) {
  return `"${value.replace(/[\\"\x00-\x1f\x7f]/g, (c) => (c === '\\' || c === '"' ? `\\${c}` : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`))}"`;
}

// The repo's top folder, after the checks that must pass before anything is written.
function checkRepo(cwd, env, { refresh = false } = {}) {
  const top = topLevel(cwd, env);
  if (!top) throw new InitError('this folder is not inside a git repository', { code: 'not-git', hint: 'run mirai init in the repo' });
  const root = realpathSync(top);
  if (!refExists(root, 'HEAD', env)) throw new InitError('this repository has no commit yet', { code: 'no-commit', hint: 'make the first commit, then run mirai init' });
  if (isShallow(root, env)) throw new InitError('this is a shallow clone, so its first commit is unknown', { code: 'shallow', hint: 'run: git fetch --unshallow' });
  for (const rel of ['.mirai', '.mirai/context', FRAMEWORK_DIR, LOCK_FILE, CONFIG_FILE, LOCAL_FILE, ...Object.keys(GIT_RULES)]) {
    let info;
    try {
      info = lstatSync(join(root, rel));
    } catch {
      continue;
    }
    if (info.isSymbolicLink()) throw new InitError(`${rel} is a symbolic link`, { code: 'symlink', hint: 'MIRAI writes only real files and folders' });
  }
  if (refresh) {
    if (!existsSync(join(root, LOCK_FILE))) throw new InitError('MIRAI is not installed here, so there is nothing to refresh', { code: 'not-installed', hint: 'run: mirai init' });
    // The copy is replaced as a whole, so it must be MIRAI's as listed: an edit would be lost.
    const lock = readLock(root);
    const check = checkLock(root);
    const edits = [...check.changed, ...check.missing].filter((p) => lock.files.get(p)?.mark === 'framework').concat(check.added);
    if (edits.length) {
      throw new InitError(`the framework copy was changed (${edits.slice(0, 3).join(', ')}${edits.length > 3 ? ', …' : ''}), and a refresh would lose that`, { code: 'framework-changed', hint: 'restore those files from git (git checkout -- .mirai), or move your change into .mirai/custom/ once unit 37 exists' });
    }
    return root;
  }
  if (existsSync(join(root, LOCK_FILE))) throw new InitError('MIRAI is already installed here', { code: 'installed', hint: 'to apply a changed config or agents-local.md, run: mirai render; to get this MIRAI\'s framework copy, run: mirai init --refresh' });
  if (existsSync(join(root, FRAMEWORK_DIR))) throw new InitError(`${FRAMEWORK_DIR} exists without a lock`, { code: 'stray-framework', hint: 'remove it, or restore its mirai.lock' });
  for (const [path, text] of Object.entries(GIT_RULES)) {
    if (existsSync(join(root, path)) && readFileSync(join(root, path), 'utf8') !== text) {
      throw new InitError(`${path} exists and isn't MIRAI's`, { code: 'git-rules', hint: 'move its rules elsewhere and remove it; MIRAI writes its own' });
    }
  }
  return root;
}

// The integration branch and where it came from: --branch, else the one an existing config
// names, else the remote's default branch (origin, or the only remote). Never just the current
// branch: a feature branch must not become the trust anchor by accident. It must exist here or
// on the remote, and be a branch name the config accepts.
function integrationBranch(root, env, wanted, config) {
  const all = remotes(root, env);
  const remote = all.has('origin') ? 'origin' : all.size === 1 ? [...all.keys()][0] : null;
  const named = config?.git.integration_branch;
  if (wanted !== undefined && named !== undefined && wanted !== named) {
    throw new InitError(`${CONFIG_FILE} names "${named}" as the integration branch, not "${wanted}"`, { code: 'branch-mismatch', hint: 'drop --branch, or fix the config' });
  }
  let branch = wanted ?? named;
  let from = wanted !== undefined ? '--branch' : named !== undefined ? CONFIG_FILE : null;
  if (branch === undefined && remote) {
    branch = symbolicBranch(root, `refs/remotes/${remote}/HEAD`, env) ?? undefined;
    if (branch !== undefined) from = `${remote}/HEAD`;
  }
  if (branch === undefined) throw new InitError('the integration branch can\'t be found (no --branch, and no remote default branch)', { code: 'no-branch', hint: 'name it: mirai init --branch main' });
  if (!BRANCH.test(branch)) throw new InitError('the integration branch is not a valid branch name', { code: 'bad-branch', exitCode: EXIT.USAGE });
  if (!refExists(root, `refs/heads/${branch}`, env) && !(remote && refExists(root, `refs/remotes/${remote}/${branch}`, env))) {
    throw new InitError(`there is no branch "${branch}" here${remote ? ` or on ${remote}` : ''}`, { code: 'no-branch', hint: 'name an existing branch with --branch' });
  }
  return { branch, from };
}

// Copies a file or folder tree (regular files only; a symbolic link in MIRAI's package is an
// error), with ordinary permissions, keeping only the executable bit.
function copyTree(from, to) {
  const info = lstatSync(from);
  if (info.isSymbolicLink()) throw new InitError(`${from} is a symbolic link in MIRAI's package`, { code: 'package-symlink', exitCode: EXIT.FAILURE });
  if (info.isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from).sort()) copyTree(join(from, name), join(to, name));
    return;
  }
  if (!info.isFile()) return;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  chmodSync(to, info.mode & 0o111 ? 0o755 : 0o644);
}

function writeNew(path, data) {
  writeFileSync(path, data, { flag: 'wx', mode: 0o644 });
}

// Moves a staged file or folder into place, refusing to replace anything.
function move(from, to, undo) {
  if (existsSync(to)) throw new InitError(`${to} appeared while MIRAI was installing`, { code: 'conflict', exitCode: EXIT.FAILURE });
  renameSync(from, to);
  undo.push(() => rmSync(to, { recursive: true, force: true }));
}
