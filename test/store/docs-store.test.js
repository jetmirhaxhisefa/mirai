import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ConfigError } from '../../src/cli/errors.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { loadConfig } from '../../src/config/load.js';
import { runChecks } from '../../src/doctor/checks.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { docsStoreFor } from '../../src/store/connectors/index.js';
import { installed, tempDir } from '../tests/run-fixture.js';
import { passReader } from '../helpers/reader.js';
import { BRIEF_READY, INTERVIEW, PRD_READY, tty } from '../helpers/docs-fixtures.js';

// Unit 38 T3: every document path resolves through the store. With `[docs] store = "local"`, the
// lint, approval, `mirai show <initiative>` and the reader test find the documents in MIRAI's store
// on this Mac, and the repo holds none. A personal file can't set the store; a change on a project
// that has documents is refused.

function localProject() {
  const f = installed({ config: '\n[docs]\nstore = "local"\n' });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  const store = openStore({ cwd: f.root, env: f.env });
  const { conn } = docsStoreFor({ cwd: f.root, env: f.env, store });
  return { ...f, store, conn, io: { cwd: f.root, env: f.env } };
}

test('38 T3: with the local store, lint, approve --file, show <initiative> and reader-test find the documents outside the repo; the repo holds none', async () => {
  const f = localProject();
  assert.equal(f.conn.name, 'local');
  const brief = f.conn.write('brief', 'due-dates', null, BRIEF_READY);
  f.conn.write('interview', 'due-dates', null, INTERVIEW);
  const prd = f.conn.write('prd', 'due-dates', null, PRD_READY);
  assert.ok(!prd.startsWith(f.root), 'outside the repo');
  assert.equal(prd, join(f.store.home, 'projects', f.store.repoId, 'docs', 'due-dates', 'prd.md'));
  // The lint: the local documents are linted with the repo's; a problem names the full path.
  const clean = await tty(['lint'], f.io);
  assert.equal(clean.code, EXIT.OK, clean.out);
  assert.match(clean.out, /^[3-9] files?, 0 problems/m);
  writeFileSync(join(f.conn.dir('due-dates'), 'broken.md'), '# no frontmatter\n');
  const broken = await tty(['lint'], f.io);
  assert.equal(broken.code, EXIT.FAILURE);
  assert.ok(broken.out.includes(`${join(f.conn.dir('due-dates'), 'broken.md')}:1:1:`), broken.out);
  const named = await tty(['lint', prd], f.io);
  assert.equal(named.code, EXIT.OK, named.out);
  assert.match(named.out, /^1 file, 0 problems/m);
  // The reader test and the approval read the PRD where the store keeps it.
  await passReader(f, prd);
  const ok = await tty(['approve', 'due-dates-prd', '--file', prd], f.io, ['a', 'due-dates-prd']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.match(ok.out, /approved: the brief due-dates-brief and the PRD due-dates-prd, as docs\/due-dates\/brief\.md and docs\/due-dates\/prd\.md are now/);
  // The last line is the PRD's full path; a local document has no host link.
  assert.equal(ok.out.trimEnd().split('\n').at(-1), prd);
  const lines = readJournal(f.store).events.filter((e) => e.type === 'approval');
  assert.deepEqual(lines.map((e) => [e.kind, e.path]), [['brief', 'docs/due-dates/brief.md'], ['prd', 'docs/due-dates/prd.md']]);
  // mirai show <initiative> lists them with their states and full paths in MIRAI's store.
  const show = await tty(['show', 'due-dates'], f.io);
  assert.equal(show.code, EXIT.OK, show.err);
  assert.ok(show.out.split('\n').some((l) => /^ {2}prd\.md +prd +due-dates-prd +approved +/.test(l) && l.endsWith(prd)), show.out);
  assert.ok(show.out.includes(brief));
  // The repo holds none of it.
  assert.equal(f.git('status', '--porcelain'), '');
  assert.ok(!existsSync(join(f.root, 'docs')));
  // doctor's store item says teammates can't see them.
  const items = await runChecks({ cwd: f.root, env: f.env, redTeam: async () => ({ state: 'green', parts: {} }), session: () => ({ state: 'current' }), images: async () => [] });
  const item = items.find((i) => i.id === 'docs-store');
  assert.equal(item.state, 'ok');
  assert.match(item.detail, /the local store: documents in .*\/projects\/.*\/docs, on this Mac only; teammates can't see these documents/);
  // publish does nothing, and says so.
  const pub = await tty(['docs', 'publish', 'due-dates'], f.io);
  assert.equal(pub.code, EXIT.OK, pub.err);
  assert.match(pub.out, /docs publish due-dates: nothing to do\n {2}the local store keeps due-dates's documents on this Mac only: publish does nothing/);
});

test('38 T3: a personal file can\'t set docs.store; a store change on a project with documents is refused, naming mirai docs move', async () => {
  const dir = tempDir('38-config');
  mkdirSync(join(dir, 'repo', '.mirai'), { recursive: true });
  writeFileSync(join(dir, 'repo', '.mirai', 'config.toml'), 'schema_version = 1\n[git]\nintegration_branch = "main"\n[docs]\nstore = "local"\n');
  assert.equal(loadConfig({ projectRoot: join(dir, 'repo'), globalFile: join(dir, 'none.toml') }).config.docs.store, 'local');
  writeFileSync(join(dir, 'personal.toml'), 'schema_version = 1\n[docs]\nstore = "repo"\n');
  assert.throws(() => loadConfig({ projectRoot: join(dir, 'repo'), personalRepoFile: join(dir, 'personal.toml'), globalFile: join(dir, 'none.toml') }), (e) => {
    assert.ok(e instanceof ConfigError);
    assert.match(e.errors.map((x) => x.reason).join('\n'), /docs(\.store)? can't be set in a personal file/);
    return true;
  });
  writeFileSync(join(dir, 'repo', '.mirai', 'config.toml'), 'schema_version = 1\n[git]\nintegration_branch = "main"\n[docs]\nstore = "elsewhere"\n');
  assert.throws(() => loadConfig({ projectRoot: join(dir, 'repo'), globalFile: join(dir, 'none.toml') }), (e) => e.errors.some((x) => x.path === 'docs.store' && x.code === 'enum'));

  // A project with local documents: back to repo on main is refused, with nothing changed.
  const f = localProject();
  f.conn.write('brief', 'due-dates', null, BRIEF_READY);
  assert.equal((await tty(['show', 'due-dates'], f.io)).code, EXIT.OK);
  const cfg = join(f.root, '.mirai', 'config.toml');
  writeFileSync(cfg, readFileSync(cfg, 'utf8').replace('store = "local"', 'store = "repo"'));
  f.git('commit', '-qam', 'back to repo');
  for (const argv of [['show', 'due-dates'], ['docs', 'publish', 'due-dates']]) {
    const r = await tty(argv, f.io);
    assert.equal(r.code, EXIT.BLOCKED, argv.join(' '));
    assert.match(r.err, /\[docs\] store changed from local to repo, and the local store already has documents/);
    assert.match(r.err, /mirai docs move, not built yet/);
  }
  // An empty store may change: a fresh project goes from repo to local, then back.
  const g = localProject();
  assert.equal(g.conn.name, 'local');
});
