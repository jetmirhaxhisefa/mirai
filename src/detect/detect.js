import { randomBytes } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { ConfigError, StoreError } from '../cli/errors.js';
import { loadCustomStacks } from '../config/registry.js';
import { parseToml } from '../config/toml.js';
import { parseLock, RUNNING_VERSION } from '../install/lock.js';
import { branchRefs, commitMessages, remotes } from '../store/git.js';
import { atomicWrite, ensurePrivateDir } from '../store/files.js';
import { openStore } from '../store/home.js';
import { snapshot, trustedConfig, trustedFile, trustedRegistry } from '../trust/snapshot.js';
import { trustedAdapters } from '../tests/adapters.js';
import { dockerCall } from '../tests/docker.js';
import { matches } from '../util/glob.js';
import { readCompose, worktreeReasons } from './compose.js';
import { checkDraft, differences, draftText, draftValue, entryProblem, levelEntry } from './draft.js';
import { branchPattern, commitFormat, g8 } from './git.js';
import { instructionFacts } from './instructions.js';
import { findLevels, serviceFor, uniqueName } from './levels.js';
import { commitRuleFiles, findStacks, stackChecks } from './stacks.js';
import { blobReader, readTree, shownDir } from './walk.js';

// Setup detection (unit 17a; design/01 §1 step 1, D-45, D-55): a script, no AI, that reads the
// integration branch's commit and writes a draft config for you to review. It never changes your
// config or the repo, and never runs the project's code: files are read from git objects, the
// compose file is resolved by Compose alone (no container), and git is MIRAI's pinned git.
//
// Each run's folder is `<store>/detect/<id>/`: facts.json (for unit 39's ledger) and
// config.draft.toml. The last KEEP_DETECT_RUNS are kept. The data it reads comes from the trust
// root: the stacks, the test adapters' [detect], the instruction flags and the protected-path
// packs, each with the project's own additions where those exist.

export const KEEP_DETECT_RUNS = 10;
export const FACTS_SCHEMA_VERSION = 1;
const ENV_TEST = '.env.test';

export const detectRunId = (now = new Date()) => `d-${now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15).toLowerCase()}-${randomBytes(3).toString('hex')}`;

function prune(dir, keep) {
  const runs = readdirSync(dir).filter((n) => /^d-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/.test(n)).sort();
  for (const old of runs.slice(0, Math.max(0, runs.length - keep))) rmSync(join(dir, old), { recursive: true, force: true });
}

// The paths of the task-runner and CI files the protected-path data names (a quality gate may
// run from them; they're code, so they're listed, never read).
function gateScripts(tree, protectedPaths) {
  const patterns = [
    ...(protectedPaths['task-runners']?.rules ?? []).flatMap((r) => r.paths),
    ...(protectedPaths.core?.rules ?? []).filter((r) => r.name === 'ci').flatMap((r) => r.paths),
  ];
  const out = [];
  for (const p of tree.files.keys()) if (patterns.some((g) => matches(g, p))) out.push(p);
  return out.sort();
}

// Runs detection. Returns { id, dir, facts, value, text, differences }. For tests: `docker`
// ({ client, plugins, socket }) and `call` stand in for Docker Desktop's.
export async function detect({ cwd, env, docker = {}, call = dockerCall, now = () => new Date() }) {
  const store = openStore({ cwd, env });
  const trust = snapshot({ cwd, env });
  const registry = trustedRegistry(trust);
  if (Object.keys(registry.stacks ?? {}).length === 0 || Object.keys(registry.instructionFlags ?? {}).length === 0) {
    throw new StoreError('the installed MIRAI has no detection data (registry/stacks/, registry/instruction-flags/)', { code: 'detect-no-data', hint: 'refresh it from MIRAI 17a or later: mirai init --refresh, then commit on the integration branch' });
  }
  let stacks;
  try {
    stacks = { ...registry.stacks, ...loadCustomStacks(join(trust.dir, 'tree', '.mirai', 'custom'), registry.stacks) };
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    const first = (err.errors ?? []).slice(0, 3).map((e) => `${e.source}:${e.line}: ${e.reason}`).join('; ');
    throw new StoreError(`${err.message}: ${first}`, { code: 'bad-stack', hint: 'fix it on the integration branch (see docs/setup-detection.md)' });
  }
  const adapters = trustedAdapters(trust);
  const config = trustedConfig(trust);
  const own = parseToml(trustedFile(trust, '.mirai/config.toml'), { source: '.mirai/config.toml' });
  const root = store.checkout;
  const tree = readTree(root, trust.baseSha, env);
  const reader = blobReader(root, tree, env);

  // The run's folder is made only once its files are ready, so a failed run leaves nothing (and
  // never pushes a good run out of the last KEEP_DETECT_RUNS).
  const detectDir = join(store.dir, 'detect');
  ensurePrivateDir(detectDir);
  const id = detectRunId(now());
  const dir = join(detectDir, id);
  const gaps = [];
  const gap = (topic, text) => gaps.push({ topic, text });

  const found = findStacks(tree, stacks);
  // A pack this MIRAI doesn't have isn't drafted (unit 12 would refuse it); it's a gap.
  for (const s of found) {
    if (!s.pack || registry.protectedPaths?.[s.pack]) continue;
    gap('stacks', `the ${s.name} stack names the pack ${s.pack}, which this MIRAI doesn't have`);
    s.pack_missing = s.pack;
    delete s.pack;
  }
  let compose;
  try {
    compose = await readCompose({ tree, reader, workDir: join(detectDir, `.work-${id}`), env, docker, call });
  } finally {
    rmSync(join(detectDir, `.work-${id}`), { recursive: true, force: true });
  }
  if (compose.state === 'none') gap('compose', `no compose file (${['compose.yaml', 'docker-compose.yml'].join(', ')}, …) at the top folder: levels and checks run in compose services`);
  else if (compose.state !== 'ok') gap('compose', compose.reason);
  if (compose.others.length) gap('compose', `${compose.others.join(', ')} ${compose.others.length === 1 ? 'is' : 'are'} there too; Compose reads ${compose.file}`);
  for (const o of compose.overrides) gap('compose', `${o}: Compose adds it to your daytime stack; test runs read only [compose] files`);
  const why = { home: 'your home folder', socket: 'the Docker socket', git: 'a .git folder', outside: 'a folder outside the repo' };
  for (const w of compose.warnings) gap('compose', `${w.service} mounts ${why[w.kind]} (${w.source} at ${w.target}${w.line ? `, line ${w.line}` : ''}); test runs refuse it, and agent-written tests would run there`);
  // The env file you named wins; else the usual name.
  const envFile = config.compose?.env_file && tree.files.has(config.compose.env_file) ? config.compose.env_file : tree.files.has(ENV_TEST) ? ENV_TEST : null;
  if (compose.state === 'ok' && !envFile) gap('compose', `no ${ENV_TEST} is committed: test runs need a file of dummy values (unit 39's checklist, item 4)`);

  const taken = new Set();
  const { levels: allLevels, gaps: levelGaps } = findLevels({ tree, reader, adapters, compose, taken });
  gaps.push(...levelGaps);
  // An entry with a value from the repo that the config can't hold (a folder name with a space as
  // report_root, say) is a gap, not a draft that fails to validate.
  const levels = allLevels.filter((l) => {
    const problem = entryProblem(levelEntry(l), 'level');
    if (problem) gap('levels', `${l.marker} (${l.adapter}): not drafted, since the config can't hold it: ${problem}`);
    return !problem;
  });
  const checks = [];
  for (const c of stackChecks(found, stacks, reader)) {
    const where = serviceFor(compose, c.dir);
    if (!where) {
      gap('checks', `${c.source}: no compose service mounts ${shownDir(c.dir)}, so the check ${c.name} isn't drafted`);
      continue;
    }
    if (checks.some((x) => x.service === where.service && JSON.stringify(x.command) === JSON.stringify(c.command))) continue;
    const check = { ...c, service: where.service, ...(where.workdir ? { workdir: where.workdir } : {}), ...(where.run ? { run: where.run } : {}) };
    const problem = entryProblem({ ...check, name: 'check' }, 'check');
    if (problem) {
      gap('checks', `${c.source}: not drafted, since the config can't hold it: ${problem}`);
      continue;
    }
    checks.push({ ...check, name: uniqueName(c.name, where.service, taken) });
  }
  const scripts = gateScripts(tree, registry.protectedPaths ?? {});
  if (scripts.length) gap('checks', `a quality gate may run from ${scripts.slice(0, 6).join(', ')}${scripts.length > 6 ? ', …' : ''}: not read (a script is code); name its steps as checks`);
  for (const n of tree.nested) gap('repos', `${n} is a nested repo or submodule: a candidate for [[repos]], not read`);

  const reasons = worktreeReasons(compose);
  // Git's own limits (a huge repo) leave a fact out, as a gap; they don't stop detection.
  const bounded = (what, fn, empty) => {
    try {
      return fn();
    } catch (err) {
      if (err.code !== 'git-output-too-large' && err.code !== 'git-timeout') throw err;
      gap('git', `${what} weren't read: ${err.message}`);
      return empty;
    }
  };
  const refs = bounded('the branch names', () => branchRefs(root, env), []);
  const branches = branchPattern(refs, { integration: trust.branch, remotes: [...remotes(root, env).keys()] });
  if (!branches.pattern) gap('git', `no branch pattern found (${branches.branches} branches${branches.shapes.length ? `; most common ${branches.shapes[0].template}, ${branches.shapes[0].count}` : ''}): MIRAI's default ${config.git.branch_pattern} stays; set yours`);
  const commits = commitFormat(bounded('the commit messages', () => commitMessages(root, trust.baseSha, env), []));
  const rules = commitRuleFiles(tree, stacks, reader);
  const g = g8({ rules, format: commits.format, trailer: config.git.trailer });
  if (g.state === 'check') gap('git', `G8: ${g.why}`);
  let lockFiles = null;
  try {
    lockFiles = parseLock(trustedFile(trust, '.mirai/mirai.lock').toString('utf8')).files;
  } catch {
    // No lock to compare with: every file is read.
  }
  const readMirai = (p) => {
    try {
      return trustedFile(trust, p);
    } catch {
      return null;
    }
  };
  const instructions = instructionFacts(tree, reader, registry.instructionFlags, lockFiles, readMirai);
  for (const p of instructions.missing_imports) gap('instructions', `${p} is imported by an instruction file but isn't a file on the integration branch`);
  if (instructions.links.length) gap('instructions', `${instructions.links.slice(0, 5).join(', ')}${instructions.links.length > 5 ? ', …' : ''}: instruction files that are links, never followed; check what they point at`);
  if (reader.capped) gap('tree', 'detection stopped reading files at its limit; some were left out');

  const facts = {
    schema_version: FACTS_SCHEMA_VERSION, id, created_at: now().toISOString(), branch: trust.branch, base_sha: trust.baseSha,
    // What produced it: the trust root's manifest (MIRAI's data) and the MIRAI that ran.
    trust_manifest_sha256: trust.manifestSha256 ?? null, mirai_version: RUNNING_VERSION,
    tree: { files: tree.files.size, links: tree.links, nested: tree.nested },
    stacks: found, compose, env_file: envFile, worktree: { safe: compose.state === 'ok' ? reasons.length === 0 : null, reasons },
    levels, checks, gate_scripts: scripts,
    git: { branches, commits, commit_rules: rules, g8: g },
    instructions, gaps,
  };
  const value = draftValue(facts, { integrationBranch: trust.branch });
  const text = draftText(value, facts, { now: now() });
  try {
    checkDraft(text);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    throw new StoreError(`MIRAI wrote a draft that doesn't validate (a bug): ${(err.errors ?? [])[0]?.reason ?? err.message}`, { code: 'draft-invalid' });
  }
  prune(detectDir, KEEP_DETECT_RUNS - 1);
  ensurePrivateDir(dir);
  atomicWrite(join(dir, 'facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
  atomicWrite(join(dir, 'config.draft.toml'), text);
  return { id, dir, facts, value, text, differences: differences(value, own) };
}
