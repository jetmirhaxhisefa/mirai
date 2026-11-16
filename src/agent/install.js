import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { atomicWrite, ensurePrivateDir, readPrivateFile } from '../store/files.js';
import { blobAt, lsTree } from '../store/git.js';
import { lookupBranch } from '../store/branches.js';
import { readJournal, ticketFacts } from '../store/journal.js';
import { readTicketStatus } from '../store/tickets.js';
import { deriveTicketState } from '../status/derive.js';
import { TICKET_ID } from '../status/ticket-file.js';
import { dockerCall, dockerSetup } from '../tests/docker.js';
import { trustedFile } from '../trust/snapshot.js';
import { signObject, verifySigned } from '../sign/sign.js';
import { DEPENDENCY_KINDS, installData, parseDependency } from './dependency-rows.js';

export { DEPENDENCY_KINDS, installData, parseDependency };

// A declared dependency, installed after your approval (unit 30b; Jet, 2026-11-16: "I expect that
// MIRAI could add new dependencies but with me as a gate"). Agents never install. After the plan
// gate, before Kai's build, MIRAI:
// 1. updates the manifest and its lock for exactly the approved `<ecosystem>:<name>@<version>`
//    rows, in a scratch folder holding only those two files, in the service's own image, with
//    network and install scripts off (stack data: `[dependencies.install]`);
// 2. checks the lock: the approved versions exactly; no existing package's version changed; every
//    added package from the ecosystem's registry; at most `max_added` added; nothing else written.
//    Anything else parks the ticket (`deps-review`) and nothing is committed;
// 3. commits the two files on the ticket's branch as its own commit;
// 4. builds an image for the ticket only (`<image>:mirai-<ticket>`) from the integration branch's
//    own Dockerfile, with the ticket's manifest and lock, refusing a Dockerfile whose install line
//    doesn't turn install scripts off. The ticket's test runs use it (src/tests/run.js); the
//    record in the store says which. It goes when the ticket is done or dropped.

export const INSTALL_FILE = 'install.json';
export const DEFAULT_MAX_ADDED = 50;
const MANIFEST_MAX = 1024 * 1024;
const LOCK_MAX = 32 * 1024 * 1024;

export class InstallError extends MiraiError {
  constructor(message, { code = 'install', hint, exitCode = EXIT.BLOCKED } = {}) {
    super(message, exitCode);
    this.code = code;
    if (hint) this.hint = hint;
  }
}

// The plan's dependency rows, parsed. Throws on a row the lint would refuse (an old plan).
export function dependencyRows(declared, stacks) {
  return declared.filter((d) => DEPENDENCY_KINDS.includes(d.kind)).map((d) => {
    const p = parseDependency(d.item);
    if (p.problem) throw new InstallError(`the plan's dependency row "${d.item}": ${p.problem}`, { code: 'bad-dependency', hint: 'plan again; the plan names each package with its exact version' });
    if (!installData(stacks, p.ecosystem)) throw new InstallError(`MIRAI can't install ${p.ecosystem} packages (${d.item})`, { code: 'no-install-data', hint: 'add it on the integration branch yourself, with a new baseline (docs/agents.md)' });
    return { ...p, dev: d.kind === 'dev-dependency', item: `${p.ecosystem}:${p.name}@${p.version}${d.kind === 'dev-dependency' ? ' (dev)' : ''}` };
  });
}

const rowsKey = (rows) => rows.map((r) => r.item).sort().join('\n');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const recordPath = (store, ticket) => {
  if (!TICKET_ID.test(ticket ?? '')) throw new TypeError('not a ticket key');
  return join(store.dir, 'tickets', ticket, INSTALL_FILE);
};

// The ticket's install record, or null: { schema_version, rows, commit, base, images: { <trust
// root's image>: <ticket's image> }, added, at }.
export function readInstall(store, ticket) {
  try {
    const v = JSON.parse(String(readPrivateFile(recordPath(store, ticket), { optional: true, maxBytes: 1024 * 1024 }) ?? 'null'));
    return v && typeof v === 'object' && Array.isArray(v.rows) && v.images && typeof v.images === 'object' ? v : null;
  } catch {
    return null;
  }
}
function writeInstall(store, ticket, record) {
  ensurePrivateDir(join(store.dir, 'tickets', ticket));
  atomicWrite(recordPath(store, ticket), `${JSON.stringify(record, null, 2)}\n`);
}

// The ticket a work tree's branch belongs to, or null (the integration branch, a human branch).
export function ticketOfCheckout(store, env) {
  let branch = null;
  try {
    branch = execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: store.checkout, env: store.gitEnv ?? env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
  if (!branch || branch === store.branch) return null;
  const entries = lookupBranch(store, branch);
  const tickets = [...new Set(entries.map((e) => e.ticket))];
  return tickets.length === 1 ? tickets[0] : null;
}

// The images a test run for this checkout uses in place of the trust root's: {} unless the work
// tree is on a ticket's branch with an install record.
export function imagesForCheckout(store, env) {
  const ticket = ticketOfCheckout(store, env);
  if (!ticket) return { ticket: null, images: {} };
  const rec = readInstall(store, ticket);
  return { ticket, images: rec?.images ?? {} };
}

// The image name a ticket's build gets: the repository part of `ref` and `mirai-<ticket>`.
export function ticketImage(ref, ticket) {
  const slash = ref.lastIndexOf('/');
  const colon = ref.lastIndexOf(':');
  const repo = colon > slash ? ref.slice(0, colon) : ref;
  return `${repo.replace(/@sha256$/, '')}:mirai-${ticket.toLowerCase()}`;
}

// --- The lock check -------------------------------------------------------------------------

// { <name>: { version, source } } of a lock. npm: the lockfileVersion 2/3 `packages` map (nested
// copies count, by path); composer: `packages` and `packages-dev`.
export function lockEntries(text, format) {
  const v = JSON.parse(text);
  const out = new Map();
  if (format === 'npm') {
    if (!v || typeof v.packages !== 'object') throw new InstallError('the npm lock has no "packages" map (lockfileVersion 2 or 3 is needed)', { code: 'lock-format' });
    for (const [path, p] of Object.entries(v.packages)) {
      if (path === '' || !p || typeof p !== 'object') continue;
      out.set(path, { version: p.version ?? null, source: p.link ? 'link' : p.resolved ?? null, dev: p.dev === true });
    }
  } else {
    for (const key of ['packages', 'packages-dev']) {
      for (const p of v?.[key] ?? []) out.set(p.name, { version: String(p.version ?? '').replace(/^v/, ''), source: p['notification-url'] ?? p.dist?.url ?? p.source?.url ?? null, dev: key === 'packages-dev' });
    }
  }
  return out;
}

// The installed version of `name` in a lock's entries.
const installed = (entries, name, format) => (format === 'npm' ? entries.get(`node_modules/${name}`) : entries.get(name))?.version ?? null;

// What changed between two locks, against the approved rows: { added: [{ name, version }],
// problems: [text] }.
export function checkLock({ before, after, format, registry, rows, maxAdded = DEFAULT_MAX_ADDED }) {
  const b = before === null ? new Map() : lockEntries(before, format);
  const a = lockEntries(after, format);
  const problems = [];
  const added = [];
  for (const [name, was] of b) {
    const now = a.get(name);
    if (!now) problems.push(`${name} ${was.version} was removed`);
    else if (now.version !== was.version) problems.push(`${name} would change from ${was.version} to ${now.version}`);
  }
  for (const [name, now] of a) {
    if (b.has(name)) continue;
    added.push({ name: format === 'npm' ? name.replace(/^.*node_modules\//, '') : name, path: name, version: now.version });
    if (typeof now.source !== 'string' || !now.source.startsWith(registry)) problems.push(`${name} ${now.version} comes from ${now.source ?? 'nowhere MIRAI can read'}, not ${registry}`);
  }
  for (const r of rows) {
    const v = installed(a, r.name, format);
    if (v !== r.version) problems.push(`${r.name} is ${v ?? 'missing'} in the lock, not the approved ${r.version}`);
  }
  if (added.length > maxAdded) problems.push(`${added.length} packages would be added, more than [dependencies] max_added (${maxAdded})`);
  return { added, problems };
}

// The manifest pins each approved row exactly, and changes nothing but its dependency keys.
export function checkManifest({ before, after, fields, rows }) {
  const problems = [];
  const b = JSON.parse(before);
  const a = JSON.parse(after);
  for (const r of rows) {
    const where = fields.filter((f) => a[f] && typeof a[f] === 'object' && Object.hasOwn(a[f], r.name));
    if (!where.length) problems.push(`${r.name} isn't in the manifest`);
    else if (r.devField && !where.includes(r.devField) && r.dev) problems.push(`${r.name} is under ${where.join(', ')}, not ${r.devField}`);
    else if (where.some((f) => a[f][r.name] !== r.version)) problems.push(`${r.name} is pinned as ${JSON.stringify(a[where[0]][r.name])}, not exactly ${r.version}`);
  }
  const strip = (m) => JSON.stringify(Object.fromEntries(Object.entries(m).filter(([k]) => !fields.includes(k))));
  if (strip(a) !== strip(b)) problems.push('the manifest changed outside its dependency keys');
  for (const f of fields) {
    for (const [name, spec] of Object.entries(b[f] ?? {})) {
      if (a[f]?.[name] !== spec && !rows.some((r) => r.name === name)) problems.push(`${name} changed in the manifest (${JSON.stringify(spec)} → ${JSON.stringify(a[f]?.[name] ?? null)})`);
    }
  }
  return problems;
}

// --- Where the manifests are, and which service runs them -------------------------------------

// The one manifest of each ecosystem the rows name, at the integration commit: { <ecosystem>:
// path }. More than one (two package.json outside dependency folders) can't be chosen: refused.
export function manifestsFor({ root, env, base, rows, stacks }) {
  const out = {};
  const files = (lsTree(root, base, '.', env, { recursive: true }) ?? []).filter((e) => e.type === 'blob').map((e) => e.path);
  for (const eco of new Set(rows.map((r) => r.ecosystem))) {
    const { dep } = installData(stacks, eco);
    const found = files.filter((p) => posix.basename(p) === dep.file && !/(^|\/)(node_modules|vendor)\//.test(p) && !p.startsWith('.mirai/'));
    if (found.length !== 1) throw new InstallError(found.length ? `${eco}: the integration branch has ${found.length} ${dep.file} files (${found.slice(0, 4).join(', ')}), and a plan row doesn't say which` : `${eco}: the integration branch has no ${dep.file}`, { code: 'manifest-choice', hint: 'add the package on the integration branch yourself' });
    out[eco] = found[0];
  }
  return out;
}

// The resolved compose config of the trust root's files (`docker compose config`), with the trust
// root's tree as the project folder and the dummy env file.
async function composeConfig({ trust, config, setup, call }) {
  const files = (config.compose?.files ?? []).map((f) => {
    trustedFile(trust, f);
    return join(trust.dir, 'tree', f);
  });
  if (!files.length) throw new InstallError('this project has no [compose] files', { code: 'no-compose' });
  trustedFile(trust, config.compose.env_file);
  const args = ['compose', ...files.flatMap((f) => ['-f', f]), '-p', 'mirai-install', '--project-directory', join(trust.dir, 'tree'), '--env-file', join(trust.dir, 'tree', config.compose.env_file), 'config', '--format', 'json'];
  const r = await call(setup, args, { timeout: 60_000 });
  if (r.status !== 0) throw new InstallError(`docker compose config failed: ${r.stderr.trim().split('\n').pop() ?? ''}`, { code: 'compose-config' });
  return JSON.parse(r.stdout);
}

const inside = (child, parent) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep));
};

// The service whose bind mount holds the manifest's folder: its image runs the lock update.
export function serviceFor(resolved, treeDir, manifest) {
  const dir = join(treeDir, posix.dirname(manifest));
  const hits = Object.entries(resolved.services ?? {}).filter(([, s]) => (s.volumes ?? []).some((v) => v.type === 'bind' && typeof v.source === 'string' && inside(dir, v.source)));
  const named = hits.filter(([, s]) => typeof s.image === 'string' && s.image);
  if (!named.length) throw new InstallError(`no compose service with an image name mounts ${posix.dirname(manifest)}`, { code: 'no-service', hint: 'give the service that mounts it an image: name in the compose file' });
  return { name: named[0][0], image: named[0][1].image };
}

// The services whose image must be rebuilt for the ticket: a `build` whose Dockerfile copies a
// changed file (or the folder holding it, or everything). Each: { name, image, context, dockerfile,
// text }. A Dockerfile that can't be read is built too.
// `read(repoPath)`: a file of the integration commit as text, or null (the trust root's tree holds
// only MIRAI's files, so the Dockerfile comes from git).
export function servicesToBuild(resolved, treeDir, changed, read) {
  const out = [];
  for (const [name, s] of Object.entries(resolved.services ?? {})) {
    if (!s.build || typeof s.image !== 'string') continue;
    const context = s.build.context ?? treeDir;
    const dockerfile = resolve(context, s.build.dockerfile ?? 'Dockerfile');
    const text = inside(dockerfile, treeDir) ? read(relative(treeDir, dockerfile).split(sep).join('/')) : null;
    const rels = changed.map((p) => relative(context, join(treeDir, p)).split(sep).join('/'));
    const copies = text === null ? null : [...text.matchAll(/^\s*(?:COPY|ADD)\s+(?:--\S+\s+)*([^\n]+)$/gim)].map((m) => m[1].trim().split(/\s+/).slice(0, -1)).flat();
    const hit = copies === null || copies.some((src) => src === '.' || src === './' || rels.some((r) => r === src || r.startsWith(`${src.replace(/\/$/, '')}/`) || posix.basename(r) === src));
    if (hit) out.push({ name, image: s.image, context, dockerfile, text });
  }
  return out;
}

// A Dockerfile whose install line turns scripts off, for every ecosystem the rows name.
export function dockerfileProblems(text, installs) {
  if (text === null) return ['its Dockerfile can\'t be read'];
  const lines = text.split('\n');
  const problems = [];
  for (const { ecosystem, install } of installs) {
    const pats = install.image_install.map((p) => new RegExp(p));
    const word = install.command[0];
    const uses = lines.filter((l) => /^\s*RUN\b/i.test(l) && new RegExp(`\\b${word}\\s+(ci|install|update|require)\\b`).test(l));
    if (uses.length && !uses.every((l) => pats.some((p) => p.test(l)))) problems.push(`${ecosystem}: an install line doesn't turn install scripts off (${uses.find((l) => !pats.some((p) => p.test(l))).trim().slice(0, 120)})`);
    if (!uses.length) problems.push(`${ecosystem}: no ${word} install line, so the image wouldn't hold the package`);
  }
  return problems;
}

// --- The install ---------------------------------------------------------------------------

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}

// Whether the branch already has this exact install: the record names these rows and its commit is
// in HEAD's history.
function alreadyInstalled(store, ticket, rows) {
  const rec = readInstall(store, ticket);
  if (!rec || rowsKey(rec.rows.map((r) => ({ item: r }))) !== rowsKey(rows) || !rec.commit) return null;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', rec.commit, 'HEAD'], { cwd: store.checkout, env: store.gitEnv, stdio: 'ignore' });
    return rec;
  } catch {
    return null;
  }
}

// --- Your acceptance of a big or odd install (Jet, 2026-11-16, after 30b's real probe) ---------

export const PENDING_FILE = 'install-pending.json';
export const ACCEPTED_FILE = 'install-accepted.json';
export const acceptContext = (repoId) => `mirai/deps-accept/1:${repoId}`;

// What you accept: the rows, and each manifest's and lock's bytes after the update.
export function changeHash(rows, results) {
  const h = createHash('sha256');
  h.update(rowsKey(rows));
  for (const x of [...results].sort((a, b) => a.manifest.localeCompare(b.manifest))) {
    for (const part of [x.manifest, x.manifestAfter, x.lockPath, x.lockAfter]) {
      h.update('\0');
      h.update(part);
    }
  }
  return h.digest('hex');
}
const ticketFile = (store, ticket, name) => {
  if (!TICKET_ID.test(ticket ?? '')) throw new TypeError('not a ticket key');
  return join(store.dir, 'tickets', ticket, name);
};
function writePending(store, ticket, value) {
  ensurePrivateDir(join(store.dir, 'tickets', ticket));
  atomicWrite(ticketFile(store, ticket, PENDING_FILE), `${JSON.stringify(value, null, 2)}\n`);
}
export function readPending(store, ticket) {
  try {
    const v = JSON.parse(String(readPrivateFile(ticketFile(store, ticket, PENDING_FILE), { optional: true, maxBytes: 1024 * 1024 }) ?? 'null'));
    return v && typeof v.hash === 'string' && Array.isArray(v.problems) ? v : null;
  } catch {
    return null;
  }
}
// Your signed acceptance of the pending change (unpark --accept-deps).
export function writeAccepted(store, ticket, pending, signer, { now = () => new Date() } = {}) {
  const signed = signObject({ schema_version: 1, ticket, rows: pending.rows, hash: pending.hash, problems: pending.problems }, signer, { context: acceptContext(store.repoId), now });
  atomicWrite(ticketFile(store, ticket, ACCEPTED_FILE), `${JSON.stringify(signed, null, 2)}\n`);
  return signed;
}
// Whether you accepted exactly `hash` for the ticket, with your key (never the machine key).
export function acceptedChange(store, ticket, hash, keys) {
  if (!keys) return false;
  try {
    const v = JSON.parse(String(readPrivateFile(ticketFile(store, ticket, ACCEPTED_FILE), { optional: true, maxBytes: 1024 * 1024 }) ?? 'null'));
    if (!v || v.ticket !== ticket || v.hash !== hash) return false;
    return verifySigned(v, keys, { context: acceptContext(store.repoId), decision: true }).ok;
  } catch {
    return false;
  }
}

// The install step (spec item 2): returns { installed: false } when the plan has no dependency
// rows, { installed: true, record } when done (now or before), or { parked: why } for you.
// `commit(what, body)` makes MIRAI's commit on the ticket's branch (build.js passes commitStep);
// `say(line)` tells the run's output.
export async function installDependencies({ store, env, trust, config, registry, ticket, declared, commit, keys = null, say = () => {}, call = dockerCall, setup: givenSetup = null, now = () => new Date() }) {
  const rows = dependencyRows(declared, registry.stacks);
  if (!rows.length) return { installed: false };
  const done = alreadyInstalled(store, ticket, rows);
  if (done) {
    say(`dependencies: already installed (${done.rows.join(', ')}), image ${Object.values(done.images).join(', ') || 'none'}`);
    return { installed: true, record: done };
  }
  const setup = givenSetup ?? dockerSetup(env);
  const maxAdded = config.dependencies?.max_added ?? DEFAULT_MAX_ADDED;
  const manifests = manifestsFor({ root: store.checkout, env: store.gitEnv, base: trust.baseSha, rows, stacks: registry.stacks });
  const resolved = await composeConfig({ trust, config, setup, call });
  const treeDir = join(trust.dir, 'tree');
  const scratchRoot = join(store.dir, 'scratch');
  ensurePrivateDir(scratchRoot);
  const scratch = mkdtempSync(join(scratchRoot, 'install-'));
  const results = [];
  const allProblems = [];
  try {
    for (const [eco, manifest] of Object.entries(manifests)) {
      const { dep, install } = installData(registry.stacks, eco);
      const mine = rows.filter((r) => r.ecosystem === eco);
      const lockPath = posix.join(posix.dirname(manifest), install.lock);
      // The integration commit's files: never the work tree's.
      const manifestBefore = blobAt(store.checkout, trust.baseSha, manifest, store.gitEnv, { maxBytes: MANIFEST_MAX });
      const lockBefore = blobAt(store.checkout, trust.baseSha, lockPath, store.gitEnv, { maxBytes: LOCK_MAX });
      if (manifestBefore === null) throw new InstallError(`${manifest} isn't on the integration branch`, { code: 'manifest-choice' });
      const dir = join(scratch, eco);
      ensurePrivateDir(dir);
      writeFileSync(join(dir, dep.file), manifestBefore);
      if (lockBefore !== null) writeFileSync(join(dir, install.lock), lockBefore);
      const service = serviceFor(resolved, treeDir, manifest);
      say(`dependencies: ${eco}: updating ${lockPath} for ${mine.map((r) => r.item).join(', ')} (in ${service.image}, network on, install scripts off)`);
      // Runtime and dev packages are separate commands (npm --save-dev, composer --dev).
      for (const dev of [false, true]) {
        const group = mine.filter((r) => r.dev === dev);
        if (!group.length) continue;
        const args = ['run', '--rm', '--pull', 'never', '--network', 'bridge', '--label', `mirai.install=${store.repoId}`, '-v', `${dir}:/mirai-install`, '-w', '/mirai-install', '--entrypoint', install.command[0], service.image, ...install.command.slice(1), ...(dev ? install.dev : []), ...group.map((r) => install.package.replace('{name}', r.name).replace('{version}', r.version))];
        const r = await call(setup, args, { timeout: 10 * 60_000 });
        if (r.status !== 0) throw new InstallError(`${eco}: the lock update failed: ${r.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400)}`, { code: 'install-failed', hint: 'check the package names and versions; plan again if one is wrong' });
      }
      const written = listFiles(dir).filter((p) => p !== dep.file && p !== install.lock);
      const problems = written.length ? [`it wrote more than the manifest and its lock: ${written.slice(0, 5).join(', ')}`] : [];
      const manifestAfter = readFileSync(join(dir, dep.file));
      const lockAfter = existsSync(join(dir, install.lock)) ? readFileSync(join(dir, install.lock)) : null;
      if (lockAfter === null) problems.push(`no ${install.lock} was written`);
      problems.push(...checkManifest({ before: manifestBefore.toString('utf8'), after: manifestAfter.toString('utf8'), fields: dep.fields, rows: mine.map((r) => ({ ...r, devField: install.dev_field })) }));
      const lock = lockAfter === null ? { added: [], problems: [] } : checkLock({ before: lockBefore?.toString('utf8') ?? null, after: lockAfter.toString('utf8'), format: install.lock_format, registry: install.registry, rows: mine, maxAdded });
      problems.push(...lock.problems);
      allProblems.push(...problems);
      results.push({ eco, manifest, lockPath, manifestAfter, lockAfter, added: lock.added, install });
    }
    // A big or odd install waits for you (decision 4), unless you accepted exactly this change
    // (`mirai unpark <ticket> --accept-deps`, signed with your key): the same rows, the same files.
    if (allProblems.length) {
      const hash = changeHash(rows, results);
      if (!acceptedChange(store, ticket, hash, keys)) {
        writePending(store, ticket, { schema_version: 1, ticket, rows: rows.map((r) => r.item), hash, problems: allProblems, added: results.flatMap((x) => x.added.map((a) => `${x.eco}:${a.name}@${a.version}`)), at: now().toISOString() });
        return { parked: `the install of ${rows.map((r) => r.item).join(', ')} needs you: ${allProblems.slice(0, 8).join('; ')} (to accept exactly this: mirai unpark ${ticket} --accept-deps)`, problems: allProblems, code: 'deps-review' };
      }
      say(`dependencies: ${allProblems.length} change(s) you accepted (${allProblems.slice(0, 3).join('; ')})`);
    }
    // The per-ticket images' Dockerfiles first (spec item 3), so a refusal commits nothing.
    const changed = results.flatMap((x) => [x.manifest, x.lockPath]);
    const readBase = (p) => blobAt(store.checkout, trust.baseSha, p, store.gitEnv, { maxBytes: MANIFEST_MAX })?.toString('utf8') ?? null;
    const toBuild = servicesToBuild(resolved, treeDir, changed, readBase);
    const installs = results.map((x) => ({ ecosystem: x.eco, install: x.install }));
    for (const s of toBuild) {
      const problems = dockerfileProblems(s.text, installs);
      if (problems.length) throw new InstallError(`${s.name}'s Dockerfile can't build the ticket's image: ${problems.join('; ')}`, { code: 'dockerfile-scripts', hint: 'turn install scripts off on its install line (npm ci --ignore-scripts, composer install --no-scripts) on the integration branch' });
    }
    // The two files of each manifest into the work tree, then MIRAI's commit.
    for (const x of results) {
      writeFileSync(join(store.checkout, x.manifest), x.manifestAfter);
      writeFileSync(join(store.checkout, x.lockPath), x.lockAfter);
    }
    const added = results.flatMap((x) => x.added.map((a) => `${x.eco}:${a.name}@${a.version}`));
    const sha = commit(`add ${rows.map((r) => r.item).join(', ')}`, `Installed by MIRAI after the plan's approval (unit 30b). Added to the locks (${added.length}):\n${added.slice(0, 200).join('\n')}`);
    // The per-ticket images (spec item 3), from the integration commit's tree with the ticket's files.
    const context = join(scratch, 'context');
    ensurePrivateDir(context);
    execFileSync('sh', ['-c', 'git archive --format=tar "$1" | tar -x -C "$2"', 'sh', trust.baseSha, context], { cwd: store.checkout, env: store.gitEnv, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 1024 * 1024 });
    for (const x of results) {
      writeFileSync(join(context, x.manifest), x.manifestAfter);
      writeFileSync(join(context, x.lockPath), x.lockAfter);
    }
    const lockHash = sha256(Buffer.concat(results.map((x) => x.lockAfter)));
    const images = {};
    for (const s of toBuild) {
      const tag = ticketImage(s.image, ticket);
      const ctx = join(context, relative(treeDir, s.context));
      const file = join(context, relative(treeDir, s.dockerfile));
      say(`dependencies: building ${tag} for ${s.name} (the integration branch's Dockerfile, with ${ticket}'s ${changed.join(' and ')})`);
      const b = await call(setup, ['build', '-f', file, '-t', tag, '--label', `mirai.repo=${store.repoId}`, '--label', `mirai.ticket=${ticket}`, '--label', `mirai.install=${sha ?? ''}`, '--label', `mirai.lock-sha256=${lockHash}`, ctx], { timeout: 30 * 60_000, maxBuffer: 64 * 1024 * 1024 });
      if (b.status !== 0) throw new InstallError(`building ${tag} failed: ${b.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400)}`, { code: 'image-build', hint: 'run docker compose build on the integration branch to see whether its Dockerfile builds at all' });
      images[s.image] = tag;
    }
    const record = { schema_version: 1, ticket, rows: rows.map((r) => r.item), commit: sha, base: trust.baseSha, images, added, at: now().toISOString() };
    writeInstall(store, ticket, record);
    say(`dependencies: installed ${rows.map((r) => r.item).join(', ')} (${added.length} added to the locks); the ticket's test runs use ${Object.values(images).join(', ') || 'the integration images'}`);
    return { installed: true, record };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// --- Release (spec item 3, 18h's rule) --------------------------------------------------------

const FINAL = new Set(['done', 'dropped']);

// Removes the images and records of tickets that are done or dropped. Returns the tickets released.
export async function releaseInstalls({ store, env, keys = null, call = dockerCall, setup: givenSetup = null, readKeys }) {
  let names = [];
  try {
    names = readdirSync(join(store.dir, 'tickets')).filter((t) => TICKET_ID.test(t) && existsSync(join(store.dir, 'tickets', t, INSTALL_FILE)));
  } catch {
    return [];
  }
  if (!names.length) return [];
  let events;
  try {
    ({ events } = readJournal(store, { keys: keys ?? readKeys() }));
  } catch {
    return [];
  }
  const released = [];
  let setup = givenSetup;
  for (const t of names) {
    try {
      const status = readTicketStatus(store, t, { events })?.status ?? null;
      if (!FINAL.has(deriveTicketState(status, ticketFacts(events, t)).state)) continue;
      const rec = readInstall(store, t);
      setup ??= dockerSetup(env);
      for (const tag of Object.values(rec?.images ?? {})) await call(setup, ['image', 'rm', '-f', tag], { timeout: 60_000 });
      rmSync(join(store.dir, 'tickets', t, INSTALL_FILE), { force: true });
      released.push(t);
    } catch {
      // kept, and doctor lists it
    }
  }
  return released;
}

// The per-ticket images on this machine for this repo: [{ tag, ticket }].
export async function ticketImages({ store, env, call = dockerCall, setup: givenSetup = null }) {
  const setup = givenSetup ?? dockerSetup(env);
  const r = await call(setup, ['image', 'ls', '--filter', `label=mirai.repo=${store.repoId}`, '--format', '{{.Repository}}:{{.Tag}} {{.Label "mirai.ticket"}}'], { timeout: 60_000 });
  if (r.status !== 0) return null;
  return r.stdout.split('\n').filter(Boolean).map((l) => {
    const [tag, ticket] = l.split(' ');
    return { tag, ticket: ticket || null };
  });
}

// After a merge that added packages (spec item 4): the built services whose image holds another
// lock than the integration branch's, so the baseline would run without the new packages.
// [{ service, image, lock }]. Reads the lock out of the image (no network, its own entrypoint off).
export async function staleImages({ store, env, trust, config, registry, call = dockerCall, setup: givenSetup = null }) {
  const setup = givenSetup ?? dockerSetup(env);
  const resolved = await composeConfig({ trust, config, setup, call });
  const treeDir = join(trust.dir, 'tree');
  const locks = new Set(Object.values(registry.stacks ?? {}).flatMap((s) => (s.dependencies ?? []).map((d) => d.install?.lock).filter(Boolean)));
  const out = [];
  for (const [name, s] of Object.entries(resolved.services ?? {})) {
    if (!s.build || typeof s.image !== 'string') continue;
    const context = s.build.context ?? treeDir;
    const file = resolve(context, s.build.dockerfile ?? 'Dockerfile');
    const text = inside(file, treeDir) ? blobAt(store.checkout, trust.baseSha, relative(treeDir, file).split(sep).join('/'), store.gitEnv, { maxBytes: MANIFEST_MAX })?.toString('utf8') ?? null : null;
    if (text === null) continue;
    const wd = await call(setup, ['image', 'inspect', '--format', '{{.Config.WorkingDir}}', s.image], { timeout: 60_000 });
    if (wd.status !== 0) continue;
    for (const m of text.matchAll(/^\s*COPY\s+(?:--\S+\s+)*([^\n]+)$/gim)) {
      const parts = m[1].trim().split(/\s+/);
      const dest = parts.at(-1);
      for (const src of parts.slice(0, -1).filter((p) => locks.has(posix.basename(p)))) {
        const inImage = dest.endsWith('/') || dest === '.' ? posix.join(dest.startsWith('/') ? dest : posix.join(wd.stdout.trim() || '/', dest), posix.basename(src)) : (dest.startsWith('/') ? dest : posix.join(wd.stdout.trim() || '/', dest));
        const repoPath = relative(treeDir, join(context, src)).split(sep).join('/');
        const want = blobAt(store.checkout, trust.baseSha, repoPath, store.gitEnv, { maxBytes: LOCK_MAX });
        if (want === null) continue;
        const r = await call(setup, ['run', '--rm', '--pull', 'never', '--network', 'none', '--entrypoint', 'cat', s.image, inImage], { timeout: 60_000, maxBuffer: LOCK_MAX + 1024 });
        if (r.status !== 0) continue;
        if (sha256(Buffer.from(r.stdout, 'utf8')) !== sha256(want)) out.push({ service: name, image: s.image, lock: repoPath });
      }
    }
  }
  return out;
}

// Whether a lock path exists as a regular file in the work tree (used by the baseline's check).
export function isRegularFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}
