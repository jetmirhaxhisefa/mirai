import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync, chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main } from '../../src/cli/main.js';
import { StoreError } from '../../src/cli/errors.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { createStore, normalizeRemote, openStore, repoIdentity } from '../../src/store/home.js';
import { acquireLock, atomicWrite } from '../../src/store/files.js';
import { formatError } from '../../src/cli/errors.js';
import { appendEvent, EVENT_TYPES, readJournal, ticketFacts, withSeq } from '../../src/store/journal.js';
import { readTicketStatus, writeTicketStatus } from '../../src/store/tickets.js';
import { deriveTicketState } from '../../src/status/derive.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_CONFIG = join(HERE, '..', 'config', 'fixtures', 'sample-app-config.toml');

// ---- Helpers: a temporary HOME and temporary git repos; nothing touches your real home. ----

const tmp = (prefix) => mkdtempSync(join(tmpdir(), `mirai-${prefix}-`));

function git(cwd, args, home) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

// A repo with a project config and one commit on main. `config`: 'minimal' or 'sample'.
function makeRepo({ home, remote, config = 'minimal', commit = true, name = 'repo' } = {}) {
  const dir = join(tmp('repo'), name);
  mkdirSync(join(dir, '.mirai'), { recursive: true });
  git(dir, ['init', '-q', '-b', 'main'], home);
  if (config === 'sample') copyFileSync(SAMPLE_CONFIG, join(dir, '.mirai', 'config.toml'));
  else writeFileSync(join(dir, '.mirai', 'config.toml'), 'schema_version = 1\n\n[git]\nintegration_branch = "main"\n');
  // Unique content, so two test repos made in the same second never share a first commit.
  writeFileSync(join(dir, 'README.md'), `# ${name}\n${Math.random()}\n`);
  if (remote) git(dir, ['remote', 'add', 'origin', remote], home);
  if (commit) {
    git(dir, ['add', '.'], home);
    git(dir, ['commit', '-q', '-m', 'first'], home);
  }
  return dir;
}

function setup(options = {}) {
  const home = tmp('home');
  const env = { HOME: home, PATH: process.env.PATH };
  const repo = makeRepo({ home, ...options });
  return { home, env, repo };
}

// Every file in the work tree (outside .git) with its size and content, to prove MIRAI wrote
// nothing into the project.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[p] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

function unchanged(repo, fn) {
  const before = snapshot(repo);
  const result = fn();
  assert.deepEqual(snapshot(repo), before, 'MIRAI wrote into the project');
  return result;
}

async function unchangedAsync(repo, fn) {
  const before = snapshot(repo);
  const result = await fn();
  assert.deepEqual(snapshot(repo), before, 'MIRAI wrote into the project');
  return result;
}

function refused(fn, code) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof StoreError, `expected a StoreError, got ${err?.name}: ${err?.message}`);
    if (code) assert.equal(err.code, code, err.message);
    return err;
  }
  return assert.fail('expected a StoreError');
}

async function cli(argv, { cwd, env }) {
  let out = '';
  let err = '';
  const io = { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd };
  const code = await main(argv, io);
  return { code, out, err };
}

const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;
const mode = (p) => statSync(p).mode & 0o777;

// ---- Tests --------------------------------------------------------------------------------

test('T1: the repo id: stable across moves and remote spellings, tied to the first commit, refuses what it cannot know', () => {
  const { env, repo, home } = setup({ remote: 'git@github.com:Owner/Repo.git' });
  const first = repoIdentity({ cwd: repo, env });
  assert.match(first.repoId, /^repo-[0-9a-f]{12}$/);

  // The spellings of one remote are one remote (GitHub ignores case; port 22 is ssh's own).
  for (const url of ['git@github.com:Owner/Repo.git', 'ssh://git@GitHub.com:22/Owner/Repo', 'https://github.com/owner/repo/']) {
    assert.equal(normalizeRemote(url), 'github.com/owner/repo', url);
    git(repo, ['remote', 'set-url', 'origin', url], home);
    assert.equal(repoIdentity({ cwd: repo, env }).repoId, first.repoId, url);
  }

  // Moving the checkout keeps the id; it's found from a subfolder too.
  const moved = join(dirname(repo), 'moved');
  renameSync(repo, moved);
  mkdirSync(join(moved, 'src'));
  assert.equal(repoIdentity({ cwd: join(moved, 'src'), env }).repoId, first.repoId);

  // An orphan branch (gh-pages) doesn't change it, even when checked out.
  git(moved, ['checkout', '-q', '--orphan', 'gh-pages'], home);
  git(moved, ['commit', '-q', '--allow-empty', '-m', 'pages'], home);
  assert.equal(repoIdentity({ cwd: moved, env }).repoId, first.repoId);

  // Another first commit with the same remote is another repo.
  const other = makeRepo({ home, remote: 'git@github.com:Owner/Repo.git', name: 'repo' });
  assert.notEqual(repoIdentity({ cwd: other, env }).repoId, first.repoId);

  // Refused: an empty repo, a shallow clone, two remotes without origin.
  refused(() => repoIdentity({ cwd: makeRepo({ home, commit: false }), env }), 'no-commits');
  const source = makeRepo({ home });
  git(source, ['commit', '-q', '--allow-empty', '-m', 'second'], home);
  const shallow = join(tmp('shallow'), 'clone');
  git(dirname(shallow), ['clone', '-q', '--depth', '1', `file://${source}`, shallow], home);
  refused(() => repoIdentity({ cwd: shallow, env }), 'shallow');
  const two = makeRepo({ home });
  git(two, ['remote', 'add', 'upstream', 'https://github.com/a/b'], home);
  git(two, ['remote', 'add', 'fork', 'https://github.com/c/b'], home);
  refused(() => repoIdentity({ cwd: two, env }), 'remotes');

  // A remote with a login in it: the credential never reaches store.json.
  const token = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
  const withLogin = setup({ remote: `https://jet:${token}@github.com/o/r.git` });
  const store = createStore({ cwd: withLogin.repo, env: withLogin.env });
  const meta = readFileSync(join(store.repoHome, 'store.json'), 'utf8');
  assert.equal(store.meta.remote, 'github.com/o/r');
  assert.ok(!meta.includes(token) && !meta.includes('jet:'), 'no credential in store.json');
  refused(() => normalizeRemote(`https://github.com/${token}/r`), 'credential');

  // Local and relative remotes are kept as written; a broken %-escape is a clear error.
  assert.equal(normalizeRemote('../upstream.git'), 'local:../upstream');
  assert.equal(normalizeRemote('/srv/git/app.git'), 'local:/srv/git/app');
  assert.equal(normalizeRemote('gitlab.example.com:Team/App'), 'gitlab.example.com/Team/App');
  refused(() => normalizeRemote('https://github.com/o/r%zz'), 'bad-remote');

  // Without a remote, renaming the checkout folder keeps the id (the name never comes from it).
  const local = makeRepo({ home, name: 'app' });
  const localId = repoIdentity({ cwd: local, env }).repoId;
  assert.match(localId, /^local-[0-9a-f]{12}$/);
  const renamed = join(dirname(local), 'app-renamed');
  renameSync(local, renamed);
  assert.equal(repoIdentity({ cwd: renamed, env }).repoId, localId);

  // The integration branch only on the remote: its remote-tracking branch gives the roots.
  const tracking = join(tmp('tracking'), 'c');
  git(dirname(tracking), ['clone', '-q', source, tracking], home);
  git(tracking, ['checkout', '-q', '-b', 'work'], home);
  git(tracking, ['branch', '-q', '-D', 'main'], home);
  const sourceRoots = repoIdentity({ cwd: source, env }).roots;
  assert.deepEqual(repoIdentity({ cwd: tracking, env }).roots, sourceRoots);
});

test('T1b: a store under another id for this checkout is refused, never replaced by a fresh one', () => {
  const { env, repo, home } = setup({ remote: 'https://github.com/acme/app' });
  const store = createStore({ cwd: repo, env });
  writeTicketStatus(store, { ticket: 'T-1', state: 'ready-for-dev' });

  // A branch edits the integration branch to an orphan branch with other roots.
  git(repo, ['checkout', '-q', '--orphan', 'evil'], home);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'evil'], home);
  git(repo, ['checkout', '-q', 'main'], home);
  const configFile = join(repo, '.mirai', 'config.toml');
  const original = readFileSync(configFile, 'utf8');
  writeFileSync(configFile, original.replace('"main"', '"evil"'));
  const err = refused(() => openStore({ cwd: repo, env }), 'identity-changed');
  assert.equal(err.exitCode, EXIT.BLOCKED);
  assert.match(err.hint, /mirai doctor/);
  assert.match(err.hint, /don't run mirai init/);
  refused(() => createStore({ cwd: repo, env }), 'identity-changed');
  refused(() => openStore({ cwd: repo, env, optional: true }), 'identity-changed');
  writeFileSync(configFile, original);

  // The remote renamed: the same checkout path finds the old store.
  git(repo, ['remote', 'set-url', 'origin', 'https://github.com/acme/app-renamed'], home);
  refused(() => openStore({ cwd: repo, env }), 'identity-changed');
  git(repo, ['remote', 'set-url', 'origin', 'https://github.com/acme/app'], home);
  assert.equal(openStore({ cwd: repo, env }).repoId, store.repoId);

  // A fork checked out elsewhere shares the roots but is its own repo.
  const fork = join(tmp('fork'), 'app');
  git(dirname(fork), ['clone', '-q', repo, fork], home);
  git(fork, ['remote', 'set-url', 'origin', 'https://github.com/someone/app'], home);
  assert.notEqual(createStore({ cwd: fork, env }).repoId, store.repoId);
});

test('T2: the store lives outside the work tree; a HOME inside the checkout is refused before anything is created', () => {
  const { env, repo } = setup();
  const store = unchanged(repo, () => createStore({ cwd: repo, env }));
  assert.ok(!store.dir.startsWith(store.checkout + sep));
  assert.ok(store.dir.includes(join('Library', 'Application Support', 'mirai', store.repoId)));

  const inside = { HOME: join(repo, 'home'), PATH: process.env.PATH };
  unchanged(repo, () => refused(() => createStore({ cwd: repo, env: inside }), 'inside-work-tree'));
  assert.ok(!existsSync(join(repo, 'home')), 'nothing was created inside the project');
});

test('T3: permissions: symlinked or shared folders and readable files are refused; new files are 0600', () => {
  const { env, repo } = setup();
  const store = createStore({ cwd: repo, env });
  writeTicketStatus(store, { ticket: 'T-1', state: 'ready-for-dev' });
  for (const f of ['seq', 'journal.jsonl', join('tickets', 'T-1', 'status.json')]) assert.equal(mode(join(store.dir, f)), 0o600, f);
  assert.equal(mode(join(store.repoHome, 'store.json')), 0o600);
  for (const d of [store.home, store.repoHome, store.dir, join(store.dir, 'tickets', 'T-1')]) assert.equal(mode(d), 0o700, d);

  chmodSync(store.dir, 0o750);
  const err = refused(() => openStore({ cwd: repo, env }), 'mode');
  assert.match(err.hint, /chmod 700/);
  chmodSync(store.dir, 0o700);

  const status = join(store.dir, 'tickets', 'T-1', 'status.json');
  chmodSync(status, 0o644);
  assert.match(refused(() => readTicketStatus(store, 'T-1'), 'mode').hint, /chmod 600/);
  chmodSync(status, 0o600);

  // The store folder swapped for a symbolic link to a private folder elsewhere.
  const elsewhere = tmp('elsewhere');
  renameSync(store.dir, join(elsewhere, 'store'));
  symlinkSync(join(elsewhere, 'store'), store.dir);
  refused(() => openStore({ cwd: repo, env }), 'symlink');
});

test('T4: a second checkout of the same repo is refused; a moved checkout updates the path and logs it', () => {
  const remote = 'https://github.com/o/r';
  const { env, repo, home } = setup({ remote });
  createStore({ cwd: repo, env });
  const clone = join(tmp('clone'), 'r');
  git(dirname(clone), ['clone', '-q', repo, clone], home);
  git(clone, ['remote', 'set-url', 'origin', remote], home);
  const err = refused(() => openStore({ cwd: clone, env }), 'second-checkout');
  const real = realpathSync(repo);
  assert.ok(err.message.includes(real));

  rmSync(clone, { recursive: true });
  const moved = join(dirname(repo), 'moved');
  renameSync(repo, moved);
  mkdirSync(repo); // an unrelated folder now at the old path: still a move, not a second checkout
  const store = openStore({ cwd: moved, env });
  const realMoved = realpathSync(moved);
  assert.equal(store.checkout, realMoved);
  const { events } = readJournal(store);
  assert.deepEqual(events.map((e) => [e.type, e.from, e.to]), [['checkout_moved', real, realMoved]]);
  assert.equal(openStore({ cwd: moved, env }).checkout, realMoved, 'no second event on the next open');
  assert.equal(readJournal(store).events.length, 1);
});

test('T5: concurrent appends: 8 processes × 25 lines, none lost or merged, seq unique and in file order', async () => {
  // Each event flushes two files to disk (about 40 ms on macOS, where fsync is a full flush),
  // so 8 × 25 keeps the run short while all 8 writers still overlap.
  const PER_WORKER = 25;
  const { env, repo, home } = setup();
  const store = createStore({ cwd: repo, env });
  const worker = join(HERE, 'fixtures', 'append-worker.mjs');
  const runs = Array.from({ length: 8 }, (_, w) => new Promise((resolve) => {
    const child = spawn(process.execPath, [worker, repo, home, `w${w}`, String(PER_WORKER)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('exit', (code) => resolve({ code, err }));
  }));
  for (const r of await Promise.all(runs)) assert.equal(r.code, 0, r.err);

  const { events, torn } = readJournal(store); // also checks seq increases line by line
  assert.equal(torn, 0);
  const total = 8 * PER_WORKER;
  assert.equal(events.length, total);
  assert.deepEqual(events.map((e) => e.seq), Array.from({ length: total }, (_, i) => i + 1));
  const messages = new Set(events.map((e) => e.message));
  for (let w = 0; w < 8; w += 1) for (let i = 0; i < PER_WORKER; i += 1) assert.ok(messages.has(`w${w}:${i}`), `w${w}:${i}`);
  // The writers really overlapped: the journal switches writer far more often than 7 times.
  const switches = events.filter((e, i) => i > 0 && e.message.split(':')[0] !== events[i - 1].message.split(':')[0]).length;
  assert.ok(switches > 20, `only ${switches} switches between writers`);
  assert.equal(readFileSync(join(store.dir, 'seq'), 'utf8'), `${total}\n`);
});

test('T6: a torn last line is skipped and counted, then cut off by the next append; a broken middle line fails closed', () => {
  const { env, repo } = setup();
  const store = createStore({ cwd: repo, env });
  const journal = join(store.dir, 'journal.jsonl');
  appendEvent(store, { type: 'note', by: 'script', message: 'one' });
  // A crash mid-write: the number 2 was taken, the line never finished.
  atomicWrite(join(store.dir, 'seq'), '2\n');
  appendFileSync(journal, '{"schema_version":1,"seq":2,"ts":"2026-10');
  assert.deepEqual(readJournal(store).torn, 1);
  assert.equal(readJournal(store).events.length, 1);

  appendEvent(store, { type: 'note', by: 'script', message: 'two' });
  const after = readJournal(store);
  assert.equal(after.torn, 0);
  assert.deepEqual(after.events.map((e) => e.message), ['one', 'two']);
  assert.equal(after.events[1].seq, 3, 'the torn line\'s number stays a gap');
  assert.ok(readFileSync(journal, 'utf8').split('\n').every((l) => l === '' || l.startsWith('{"schema_version":1,"seq":')));
  assert.equal(readFileSync(`${journal}.torn`, 'utf8'), '{"schema_version":1,"seq":2,"ts":"2026-10\n', 'the fragment is kept for doctor');
  assert.equal(mode(`${journal}.torn`), 0o600);

  const lines = readFileSync(journal, 'utf8').split('\n');
  writeFileSync(journal, [lines[0], 'not json', lines[1], ''].join('\n'));
  const err = refused(() => readJournal(store), 'corrupt-line');
  assert.equal(err.line, 2);
  assert.match(err.hint, /mirai doctor/);
});

test('T7: the counter: a gap after a crash is allowed; a counter behind the journal is refused', () => {
  const { env, repo } = setup();
  const store = createStore({ cwd: repo, env });
  appendEvent(store, { type: 'note', by: 'script', message: 'a' });
  atomicWrite(join(store.dir, 'seq'), '5\n'); // numbers 2–5 taken, then a crash
  assert.equal(appendEvent(store, { type: 'note', by: 'script', message: 'b' }), 6);
  assert.deepEqual(readJournal(store).events.map((e) => e.seq), [1, 6]);

  atomicWrite(join(store.dir, 'seq'), '1\n');
  refused(() => openStore({ cwd: repo, env }), 'counter-behind');
});

test('T8: locks: a live holder blocks; a dead holder is broken once and logged; breakers at once leave one holder', async () => {
  const { env, repo } = setup();
  const store = createStore({ cwd: repo, env });
  const lock = join(store.dir, 'locks', 'journal.lock');

  writeFileSync(lock, JSON.stringify({ pid: process.pid, host: hostname(), purpose: 'journal', started_at: new Date().toISOString() }), { mode: 0o600 });
  assert.equal(refused(() => acquireLock(lock, 'test', { waitMs: 50 }), 'locked').exitCode, EXIT.BLOCKED);

  const dead = deadPid();
  writeFileSync(lock, JSON.stringify({ pid: dead, host: hostname(), purpose: 'journal', started_at: new Date().toISOString() }), { mode: 0o600 });
  appendEvent(store, { type: 'note', by: 'script', message: 'after the crash' });
  assert.deepEqual(readJournal(store).events.map((e) => [e.type, e.pid ?? e.message]), [['lock_broken', dead], ['note', 'after the crash']]);
  assert.ok(!existsSync(lock), 'released');

  // Six processes start against one stale lock and take it 30 times each.
  const shared = join(tmp('locks'), 'x.lock');
  writeFileSync(shared, JSON.stringify({ pid: deadPid(), host: hostname(), purpose: 'x', started_at: new Date().toISOString() }), { mode: 0o600 });
  const marker = `${shared}.inside`;
  const worker = join(HERE, 'fixtures', 'lock-worker.mjs');
  const runs = Array.from({ length: 6 }, () => new Promise((resolve) => {
    const child = spawn(process.execPath, [worker, shared, marker, '30'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('exit', (code) => resolve({ code, out, err }));
  }));
  const results = await Promise.all(runs);
  for (const r of results) {
    assert.equal(r.code, 0, r.err);
    assert.ok(!r.out.includes('violation'), 'two holders at once');
  }
  assert.equal(results.reduce((n, r) => n + r.out.split('\n').filter((l) => l === 'broken').length, 0), 1, 'the stale lock was broken exactly once');
  assert.ok(!existsSync(shared) && !existsSync(`${shared}.break`));

  // Locks aren't re-entrant: taking the journal lock inside withSeq fails at once, not in 30 s.
  const started = Date.now();
  assert.throws(() => withSeq(store, () => appendEvent(store, { type: 'note', by: 'script', message: 'inner' })), /not re-entrant/);
  assert.ok(Date.now() - started < 1000);
});

test('T9: status files: round trip with the journal seq; a bad ticket key never becomes a path; the migration hook', () => {
  const { env, repo } = setup();
  const store = createStore({ cwd: repo, env });
  const seq = unchanged(repo, () => writeTicketStatus(store, { ticket: 'T-12', state: 'blocked', park_reason: 'cap', note: 'rounds used up' }));
  const { status, migratedFrom } = readTicketStatus(store, 'T-12');
  assert.equal(status.seq, seq);
  assert.equal(migratedFrom, null);
  assert.deepEqual([status.state, status.park_reason, status.note, status.written_by], ['blocked', 'cap', 'rounds used up', 'script']);
  const [event] = readJournal(store).events;
  assert.deepEqual([event.type, event.seq, event.ticket, event.state, event.park_reason], ['status_written', seq, 'T-12', 'blocked', 'cap']);
  assert.equal(readTicketStatus(store, 'T-99'), null);

  for (const bad of ['../T-1', 'a/b', '.hidden', '']) {
    assert.throws(() => writeTicketStatus(store, { ticket: bad, state: 'draft' }), TypeError, bad);
  }
  assert.deepEqual(readdirSync(join(store.dir, 'tickets')), ['T-12']);
  assert.throws(() => writeTicketStatus(store, { ticket: 'T-1', state: 'ready-for-dev', written_by: 'human' }), /by must be script/);

  // Compare-and-swap: a write based on an old read is refused.
  const stale = refused(() => writeTicketStatus(store, { ticket: 'T-12', state: 'in-progress' }, { expectSeq: seq - 1 }), 'stale-write');
  assert.equal(stale.exitCode, EXIT.BLOCKED);
  const next = writeTicketStatus(store, { ticket: 'T-12', state: 'blocked', park_reason: 'cap', note: 'rounds used up' }, { expectSeq: seq });
  assert.ok(next > seq);
  refused(() => writeTicketStatus(store, { ticket: 'T-7', state: 'draft' }, { expectSeq: 3 }), 'stale-write');

  // macOS ignores case in folder names: proj-12 would land in PROJ-12's folder.
  writeTicketStatus(store, { ticket: 'PROJ-12', state: 'draft' });
  refused(() => writeTicketStatus(store, { ticket: 'proj-12', state: 'draft' }), 'case-clash');
  assert.equal(readTicketStatus(store, 'proj-12'), null);
  assert.equal(readTicketStatus(store, 'PROJ-12').status.ticket, 'PROJ-12');

  // A write that would leave the ticket unreadable with the journal's facts is refused.
  appendEvent(store, { type: 'mr_opened', by: 'script', ticket: 'T-20', head: 'b'.repeat(40), target: 'main' });
  assert.throws(() => writeTicketStatus(store, { ticket: 'T-20', state: 'ready-for-dev' }), /can't be written while its MR is open/);
  assert.equal(readTicketStatus(store, 'T-20'), null);

  // A ticket folder swapped for a symbolic link is refused on read, too.
  const outside = tmp('outside');
  mkdirSync(join(outside, 'T-30'), { mode: 0o700 });
  symlinkSync(join(outside, 'T-30'), join(store.dir, 'tickets', 'T-30'));
  refused(() => readTicketStatus(store, 'T-30'), 'symlink');
  rmSync(join(store.dir, 'tickets', 'T-30'));

  // A file from an older schema (version 0 here) is migrated in memory, not rewritten.
  const file = join(store.dir, 'tickets', 'T-12', 'status.json');
  const old = { schema_version: 0, ticket: 'T-12', status: 'in-progress', seq: 9, written_at: '2026-10-23T22:14:05Z', written_by: 'script' };
  atomicWrite(file, JSON.stringify(old));
  const migrations = { 0: ({ status: state, ...rest }) => ({ ...rest, state }) };
  const read = readTicketStatus(store, 'T-12', { migrations });
  assert.deepEqual([read.status.state, read.status.schema_version, read.migratedFrom], ['in-progress', 1, 0]);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).schema_version, 0, 'not rewritten');
  refused(() => readTicketStatus(store, 'T-12'), 'no-migration');
  assert.deepEqual(readdirSync(join(store.dir, 'tickets')).sort(), ['PROJ-12', 'T-12']);
});

test('T10: facts from the journal: merged beats blocked, a closed MR waits for you, a later status takes over an open MR', () => {
  const { env, repo } = setup();
  const store = createStore({ cwd: repo, env });
  const sha = 'a'.repeat(40);
  const effective = (t) => {
    const { events } = readJournal(store);
    return deriveTicketState(readTicketStatus(store, t)?.status ?? null, ticketFacts(events, t));
  };

  writeTicketStatus(store, { ticket: 'T-1', state: 'blocked', park_reason: 'environment' });
  appendEvent(store, { type: 'mr_merged', by: 'script', ticket: 'T-1', target: 'integration' });
  writeTicketStatus(store, { ticket: 'T-1', state: 'blocked', park_reason: 'cap' });
  assert.deepEqual([effective('T-1').state, effective('T-1').source], ['done', 'derived']);

  appendEvent(store, { type: 'mr_opened', by: 'script', ticket: 'T-2', head: sha, target: 'main' });
  appendEvent(store, { type: 'mr_closed', by: 'script', ticket: 'T-2' });
  assert.equal(effective('T-2').state, 'built');
  assert.match(effective('T-2').why, /waiting for your decision/);

  writeTicketStatus(store, { ticket: 'T-3', state: 'in-progress' });
  appendEvent(store, { type: 'pushed', by: 'script', ticket: 'T-3', branch: 'feature/T-3-x', sha });
  appendEvent(store, { type: 'mr_opened', by: 'script', ticket: 'T-3', head: sha, target: 'main' });
  assert.deepEqual([effective('T-3').state, effective('T-3').why], ['in-progress', 'MR open, but no valid proofs at its head']);
  writeTicketStatus(store, { ticket: 'T-3', state: 'in-review' });
  assert.deepEqual([effective('T-3').state, effective('T-3').why], ['in-review', 'written after the latest push']);

  appendEvent(store, { type: 'mr_merged', by: 'script', ticket: 'T-4', target: 'epic', epic: 'E-1' });
  assert.equal(effective('T-4').state, 'integrated');
  appendEvent(store, { type: 'epic_merged', by: 'script', epic: 'E-2' });
  assert.equal(effective('T-4').state, 'integrated', 'another epic merging changes nothing');
  appendEvent(store, { type: 'epic_merged', by: 'script', epic: 'E-1' });
  assert.deepEqual([effective('T-4').state, effective('T-4').why], ['done', 'its epic branch is merged']);
  assert.throws(() => appendEvent(store, { type: 'mr_merged', by: 'script', ticket: 'T-8', target: 'epic' }), /needs epic/);

  // pushSeq is the latest push; an MR opened with no logged push counts its opening.
  appendEvent(store, { type: 'mr_opened', by: 'script', ticket: 'T-6', head: sha, target: 'main' });
  const opened = ticketFacts(readJournal(store).events, 'T-6');
  assert.deepEqual([opened.mr, opened.head], ['open', sha]);
  assert.equal(opened.pushSeq, readJournal(store).events.at(-1).seq);

  // A merge wins over a later close, and integration wins over the epic.
  appendEvent(store, { type: 'mr_merged', by: 'script', ticket: 'T-6', target: 'epic', epic: 'E-9' });
  appendEvent(store, { type: 'mr_merged', by: 'script', ticket: 'T-6', target: 'integration' });
  appendEvent(store, { type: 'mr_closed', by: 'script', ticket: 'T-6' });
  assert.equal(effective('T-6').state, 'done');

  // On read, a privileged event must be MIRAI's own, and `human` waits for signatures (unit 06).
  const journal = join(store.dir, 'journal.jsonl');
  const good = readFileSync(journal, 'utf8');
  const forged = { schema_version: 1, seq: 999, ts: new Date().toISOString(), type: 'mr_merged', by: 'unverified', ticket: 'T-2', target: 'integration' };
  for (const line of [forged, { ...forged, by: 'human' }]) {
    writeFileSync(journal, `${good}${JSON.stringify(line)}\n`);
    refused(() => readJournal(store), 'corrupt-line');
  }
  writeFileSync(journal, `${good}${JSON.stringify({ ...forged, type: 'from_the_future', by: 'script' })}\n`);
  assert.match(refused(() => readJournal(store), 'unknown-event').hint, /newer MIRAI/);
  writeFileSync(journal, good);

  assert.deepEqual(Object.keys(EVENT_TYPES), [
    'status_written', 'pushed', 'mr_opened', 'mr_merged', 'mr_closed', 'epic_merged', 'branch_registered',
    'branch_cleared', 'checkout_moved', 'lock_broken', 'note', 'template_gap',
  ]);
  assert.deepEqual(Object.keys(EVENT_TYPES).filter((t) => !EVENT_TYPES[t].privileged), ['note', 'template_gap']);
  assert.throws(() => appendEvent(store, { type: 'note', by: 'human', message: 'x' }), /by must be one of/);
  assert.throws(() => appendEvent(store, { type: 'mr_closed', by: 'unverified', ticket: 'T-5' }), /written only by MIRAI itself/);
  assert.throws(() => appendEvent(store, { type: 'mr_merged', by: 'script', ticket: 'T-5', target: 'main' }), /target must be one of/);
});

test('T16: mirai status: no store, not a repo, the ticket list, one ticket, --json, hostile text shown safely', async () => {
  const { env, repo } = setup();
  let r = await cli(['status'], { cwd: repo, env });
  assert.equal(r.code, EXIT.CONFIG);
  assert.match(r.err, /MIRAI isn't set up for this repo\nset it up with: mirai init/);
  r = await cli(['status'], { cwd: tmp('plain'), env });
  assert.equal(r.code, EXIT.CONFIG);
  assert.match(r.err, /not inside a git repository/);

  const store = createStore({ cwd: repo, env });
  r = await cli(['status'], { cwd: repo, env });
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out, /no tickets yet/);

  const hostile = 'ok\u001b[2J\u009b31m‮gnp.exe​';
  writeTicketStatus(store, { ticket: 'T-13', state: 'blocked', park_reason: 'cap', note: hostile });
  writeTicketStatus(store, { ticket: 'T-12', state: 'in-progress' });
  appendEvent(store, { type: 'mr_merged', by: 'script', ticket: 'T-9', target: 'integration' });
  r = await unchangedAsync(repo, () => cli(['status'], { cwd: repo, env }));
  assert.equal(r.code, EXIT.OK, r.err);
  const rows = r.out.split('\n').filter((l) => /^T-/.test(l));
  assert.equal(rows.length, 3);
  assert.match(rows[0], /^T-12\s+in-progress\s+written\s+seq 2$/);
  assert.match(rows[1], /^T-13\s+blocked \(cap\)\s+written\s+seq 1\s+"ok\\u001b\[2J\\u009b31m\\u202egnp\.exe\\u200b"$/);
  assert.match(rows[2], /^T-9\s+done\s+derived\s+merged into the integration branch$/);
  assert.ok(!/[\u001b\u009b‮​]/.test(r.out), 'no raw control characters reach the terminal');

  r = await cli(['status', 'T-9'], { cwd: repo, env });
  assert.match(r.out, /\nseq 3 {2}\S+ {2}mr_merged {2}target=integration\n/);

  r = await cli(['status', '--json'], { cwd: repo, env });
  const data = JSON.parse(r.out);
  assert.equal(data.repo_id, store.repoId);
  assert.deepEqual(data.tickets.map((t) => [t.ticket, t.state, t.source]), [['T-12', 'in-progress', 'written'], ['T-13', 'blocked', 'written'], ['T-9', 'done', 'derived']]);
  assert.equal(data.tickets[1].note, hostile);

  r = await cli(['status', '../x'], { cwd: repo, env });
  assert.equal(r.code, EXIT.USAGE);
  r = await cli(['status', 'T-404'], { cwd: repo, env });
  assert.equal(r.code, EXIT.USAGE);
  assert.match(r.err, /no ticket T-404 in this repo's store/);

  // A ticket the journal knows but with no status file says so.
  appendEvent(store, { type: 'pushed', by: 'script', ticket: 'T-50', branch: 'feature/T-50-x', sha: 'c'.repeat(40) });
  r = await cli(['status'], { cwd: repo, env });
  assert.match(r.out, /\nT-50\s+draft\s+written\s+no status file yet\n/);

  // Error messages escape control characters from paths and names.
  const shownErr = formatError(new StoreError('at /tmp/a\u001b[2Jb\u202e', { hint: 'x\u0007' }), {});
  assert.ok(!/[\u0007\u001b\u202e]/.test(shownErr));
  assert.match(shownErr, /\\u001b\[2J/);
});

test('T17: mirai config check reads store/config.user.toml once the store exists; MIRAI writes nothing into the project', async () => {
  const { env, repo } = setup({ config: 'sample' });
  let r = await cli(['config', 'check'], { cwd: repo, env });
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /deep = claude-opus-5-5 \(default\)/);

  const store = unchanged(repo, () => createStore({ cwd: repo, env }));
  atomicWrite(join(store.dir, 'config.user.toml'), '[models]\ndeep = "claude-sonnet-5-5"\n');
  r = await unchangedAsync(repo, () => cli(['config', 'check'], { cwd: repo, env }));
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /deep = claude-sonnet-5-5 \(.*config\.user\.toml:2\)/);
  assert.match(r.out, /warning: the deep tier uses claude-sonnet-5-5/);

  // The personal file gets the store's checks: a symbolic link to it is refused.
  const real = join(tmp('dotfiles'), 'config.user.toml');
  writeFileSync(real, '[models]\ndeep = "claude-haiku-5-5"\n', { mode: 0o600 });
  rmSync(join(store.dir, 'config.user.toml'));
  symlinkSync(real, join(store.dir, 'config.user.toml'));
  r = await cli(['config', 'check'], { cwd: repo, env });
  assert.equal(r.code, EXIT.CONFIG);
  assert.match(r.err, /is a symbolic link/);
  rmSync(join(store.dir, 'config.user.toml'));

  // A repo with a relative remote and no store still checks its config.
  const rel = setup({ config: 'sample', remote: '../upstream.git' });
  r = await cli(['config', 'check'], { cwd: rel.repo, env: rel.env });
  assert.equal(r.code, EXIT.OK, r.err);

  // A shallow CI clone still checks its config: there is no personal file there.
  const shallow = join(tmp('ci'), 'clone');
  git(dirname(shallow), ['clone', '-q', '--depth', '1', `file://${repo}`, shallow], env.HOME);
  r = await cli(['config', 'check'], { cwd: shallow, env });
  assert.equal(r.code, EXIT.OK, r.err);

  // A store that exists but fails its checks is an error, not silently skipped.
  chmodSync(store.dir, 0o755);
  r = await cli(['config', 'check'], { cwd: repo, env });
  assert.equal(r.code, EXIT.CONFIG);
  assert.match(r.err, /can be used by other users/);
  chmodSync(store.dir, 0o700);
  assert.ok(lstatSync(join(repo, '.mirai')).isDirectory());
});
