import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadRegistry } from '../../src/config/registry.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { CUSTOM_DIR, applyOverlays, overlayFilesIn, overlayRecord, overlayRecordContext, readOverlays, recordPathOf, recordText } from '../../src/config/overlays.js';
import { lintText } from '../../src/lint/lint.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { createKeyPair, loadSigningKey, writePublicKeyFile } from '../../src/sign/keys.js';
import { contentHash, signObject } from '../../src/sign/sign.js';
import { loadSigner } from '../../src/sign/signer.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { readLock } from '../../src/install/lock.js';
import { snapshot } from '../../src/trust/snapshot.js';
import { overlaysCheck } from '../../src/doctor/checks.js';
import { createServer } from '../../src/mcp/server.js';
import { sessionServer } from '../../src/mcp/session.js';
import { installed, tempDir } from '../tests/run-fixture.js';

// Unit 37's fixing round (Jet's answers, 2026-11-21): the approval as a signed record committed
// beside the overlays (Q3), overlays in your own sessions' files (Q1, Q2), doctor on a changed
// template under the same version (Q5), and the gaps the first round named (epic render with a
// renamed section, CRLF files, the session lint tool).
const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const BRIEF = read('examples/brief.md');
const INTERVIEW = read('examples/interview.md');
const EPIC = read('examples/epic.md');
const PRD = read('examples/prd.md');
const TICKETS = Object.fromEntries(readdirSync(join(REGISTRY_DIR, 'examples', 'tickets')).sort().map((f) => [`tickets/${f}`, read(`examples/tickets/${f}`)]));
const HEAD = (type) => `kind = "document-type-overlay"\nschema_version = 1\nname = "${type}"\n`;
const BRIEF_OVERLAY = `${HEAD('brief')}\n[[add]]\nname = "Data privacy"\nafter = "Problem"\n`;
const BRIEF_FRAGMENT = '## Data privacy\n\n<!-- done when: each kind of personal data is named, with who may see it -->\nWhat personal data the feature reads or keeps, and who may see it.\n';
const D = 'docs/mirai/due-dates';
const BRIEF_PATH = `${D}/brief.md`;
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.split(from).join(to);
};

async function run(argv, { cwd, env }, answers = []) {
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd });
  return { code, out, err };
}

// A repo with MIRAI installed, a committed key, `docs` and the overlay files `custom` committed.
function fixture(docs = {}, custom = {}) {
  const f = installed({ files: { ...docs, ...Object.fromEntries(Object.entries(custom).map(([k, v]) => [`${CUSTOM_DIR}/${k}`, v])) } });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  const at = (rel) => join(f.root, rel);
  const put = (rel, text) => {
    mkdirSync(join(at(rel), '..'), { recursive: true });
    writeFileSync(at(rel), text);
  };
  const commit = (m = 'change') => {
    f.git('add', '-A');
    f.git('commit', '-qm', m);
  };
  return { ...f, io: { cwd: f.root, env: f.env }, at, put, commit };
}

// The overlay at `path` as the work tree has it, and a record for it signed with `signer` (your
// committed key by default): written beside it, as mirai approve writes one.
function writeRecord(f, path, { signer = null, edit = (r) => r } = {}) {
  const store = openStore(f.io);
  const registry = loadRegistry(join(f.root, '.mirai/framework/registry'));
  const o = readOverlays(overlayFilesIn(f.at(CUSTOM_DIR)), registry).find((x) => x.path === path);
  const record = edit(signObject(overlayRecord(o, { decision: 'accepted' }), signer ?? loadSigner(f.env, store), { context: overlayRecordContext(store.repoId) }));
  f.put(recordPathOf(o), recordText(record));
  return recordPathOf(o);
}

// A clone of the fixture with no MIRAI store: a teammate before mirai join, or CI.
function freshClone(f) {
  const dir = join(tempDir('clone'), 'c');
  execFileSync('/usr/bin/git', ['clone', '-q', f.root, dir], { env: { PATH: '/usr/bin:/bin', HOME: f.home } });
  execFileSync('/usr/bin/git', ['remote', 'remove', 'origin'], { cwd: dir });
  return { root: dir, io: { cwd: dir, env: { PATH: '/usr/bin:/bin', HOME: tempDir('teammate') } } };
}

test('37 Q3: a committed approval record travels with the repo: a fresh checkout with no store applies the overlay; a tampered record, a changed overlay and an unknown key are skipped with their line', async () => {
  const f = fixture({ [BRIEF_PATH]: BRIEF, [`${D}/interview.md`]: INTERVIEW }, { 'document-types/brief.toml': BRIEF_OVERLAY, 'templates/brief.md': BRIEF_FRAGMENT });
  // mirai approve writes the record beside the overlays, and says to commit it.
  const ok = await run(['approve', '--file', '.mirai/custom/document-types/brief.toml'], f.io, ['a', 'overlay-brief']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.match(ok.out, /^record: {2}\.mirai\/custom\/approvals\/document-type-brief\.json: commit it with the overlay$/m);
  const rec = JSON.parse(readFileSync(f.at('.mirai/custom/approvals/document-type-brief.json'), 'utf8'));
  const [o] = readOverlays(overlayFilesIn(f.at(CUSTOM_DIR)), REGISTRY).filter((x) => x.kind === 'document-type');
  assert.deepEqual([rec.schema, rec.path, rec.content_hash, rec.decision], ['mirai-overlay-approval/1', '.mirai/custom/document-types/brief.toml', contentHash(Buffer.from(BRIEF_OVERLAY)), 'accepted']);
  assert.match(rec.hash, /^sha256:[0-9a-f]{64}$/);
  assert.ok(rec.signature?.key_id, 'signed with your key');
  assert.equal(o.path, rec.path);
  f.commit('approval record');

  // A teammate's checkout, no store: the overlay applies (the brief must have "Data privacy").
  const c = freshClone(f);
  const there = await run(['lint', BRIEF_PATH], c.io);
  assert.equal(there.code, EXIT.FAILURE, there.out + there.err);
  assert.equal(there.err, '');
  assert.match(there.out, /Data privacy/);

  // A tampered record (its hash edited): not approved, for everyone, journal or not.
  const recFile = '.mirai/custom/approvals/document-type-brief.json';
  f.put(recFile, recordText({ ...rec, hash: `sha256:${'1'.repeat(64)}` }));
  f.commit('tampered');
  const tampered = await run(['lint', BRIEF_PATH], f.io);
  assert.equal(tampered.code, EXIT.OK, tampered.out);
  assert.equal(tampered.err, 'note: .mirai/custom/document-types/brief.toml is not approved (its approval record doesn\'t verify: the signature does not match), so MIRAI\'s brief type is used; to use it: mirai approve --file .mirai/custom/document-types/brief.toml\n');

  // A valid record, then the overlay changed on main: changed since its approval.
  writeRecord(f, '.mirai/custom/document-types/brief.toml');
  f.commit('record again');
  assert.equal((await run(['lint', BRIEF_PATH], f.io)).err, '');
  f.put('.mirai/custom/templates/brief.md', BRIEF_FRAGMENT.replace('who may see it', 'who may read it'));
  f.commit('changed');
  const changed = await run(['lint', BRIEF_PATH], freshClone(f).io);
  assert.match(changed.err, /^note: \.mirai\/custom\/document-types\/brief\.toml is changed since its approval, so MIRAI's brief type is used/);

  // A record signed by a key that isn't committed: refused.
  const other = { PATH: '/usr/bin:/bin', HOME: tempDir('other') };
  createKeyPair(other);
  writeRecord(f, '.mirai/custom/document-types/brief.toml', { signer: loadSigningKey(other) });
  f.commit('a stranger\'s record');
  const unknown = await run(['lint', BRIEF_PATH], freshClone(f).io);
  assert.match(unknown.err, /is not approved \(its approval record doesn't verify: key k-[0-9a-f]{16} is not on the integration branch\)/);
});

// An agent and a skill overlay, instructions only.
const REX = 'kind = "agent-overlay"\nschema_version = 1\nname = "mirai-reviewer"\n';
const REX_TEXT = 'Name the AC each finding is about.\n';
const SKILL = 'kind = "skill-overlay"\nschema_version = 1\nname = "mirai-write"\n[instructions]\nmode = "append"\n';
const SKILL_TEXT = 'Use the company glossary\'s terms.\n';

test('37 Q1/Q2: mirai render writes approved agent and skill overlays into your sessions\' files; an unapproved or changed one renders MIRAI\'s own, with its line', async () => {
  const f = fixture({}, { 'agents/mirai-reviewer.toml': REX, 'agents/mirai-reviewer.md': REX_TEXT, 'skills/mirai-write/overlay.toml': SKILL, 'skills/mirai-write/overlay.md': SKILL_TEXT });
  const agentFile = f.at('.claude/agents/mirai-reviewer.md');
  const skillFile = f.at('.claude/skills/mirai-write/SKILL.md');
  const plain = { agent: readFileSync(agentFile, 'utf8'), skill: readFileSync(skillFile, 'utf8') };
  // Not approved: MIRAI's own files, and one line for each.
  const before = await run(['render'], f.io);
  assert.equal(before.code, EXIT.OK, before.err);
  assert.match(before.err, /^note: \.mirai\/custom\/agents\/mirai-reviewer\.toml is not approved, so MIRAI's mirai-reviewer is used; to use it: mirai approve --file \.mirai\/custom\/agents\/mirai-reviewer\.toml$/m);
  assert.match(before.err, /^note: \.mirai\/custom\/skills\/mirai-write\/overlay\.toml is not approved, so MIRAI's mirai-write skill is used/m);
  assert.equal(readFileSync(agentFile, 'utf8'), plain.agent);
  assert.equal(readFileSync(skillFile, 'utf8'), plain.skill);

  // Approved (records written): the overlays are rendered, listed in the lock with their files.
  assert.equal((await run(['approve', '--file', '.mirai/custom/agents/mirai-reviewer.toml'], f.io, ['a', 'overlay-mirai-reviewer'])).code, EXIT.OK);
  const skillOk = await run(['approve', '--file', '.mirai/custom/skills/mirai-write/overlay.toml'], f.io, ['a', 'overlay-mirai-write']);
  assert.equal(skillOk.code, EXIT.OK, skillOk.err);
  assert.match(skillOk.out, /^next:\n {2}1\. mirai render {7}\(your sessions' copy of mirai-write, from the approved overlay\)\n {2}2\. git add \.mirai\/custom\/skills\/mirai-write\/overlay\.toml \.mirai\/custom\/skills\/mirai-write\/overlay\.md \.mirai\/custom\/approvals\/skill-mirai-write\.json \.claude\/ \.mirai\/mirai\.lock\n {2}3\. git commit, then merge it into main/m);
  // Approved but not rendered yet: doctor's Overlays item names the files and mirai render.
  const notRendered = overlaysCheck({ store: openStore(f.io), trust: snapshot(f.io), events: readJournal(openStore(f.io)).events, env: f.env });
  assert.equal(notRendered.state, 'yellow');
  assert.match(notRendered.detail, /your sessions' files \.claude\/agents\/mirai-reviewer\.md, \.claude\/skills\/mirai-write\/SKILL\.md aren't what the approved overlays render/);
  assert.match(notRendered.hint, /^mirai render, then commit/);
  const after = await run(['render'], f.io);
  assert.equal(after.code, EXIT.OK, after.err);
  assert.equal(after.err, '');
  assert.ok(readFileSync(agentFile, 'utf8').endsWith(`\n\n${REX_TEXT}`), readFileSync(agentFile, 'utf8').slice(-200));
  assert.ok(readFileSync(skillFile, 'utf8').endsWith(`\n\n${SKILL_TEXT}`));
  const lock = readLock(f.root);
  assert.ok(lock.files.get('.claude/agents/mirai-reviewer.md').from.some((x) => x.path === '.mirai/custom/agents/mirai-reviewer.md'));
  assert.ok(lock.files.get('.claude/skills/mirai-write/SKILL.md').from.some((x) => x.path === '.mirai/custom/skills/mirai-write/overlay.toml'));
  // Committed, the trust root accepts it: the lock's bundle is MIRAI's own (its headless plugin
  // folder), and your sessions' files are listed one by one.
  f.commit('overlays rendered');
  const trust = snapshot(f.io);
  assert.doesNotMatch(overlaysCheck({ store: openStore(f.io), trust, events: readJournal(openStore(f.io)).events, env: f.env }).detail, /aren't what/, 'rendered: nothing to say');
  assert.equal(trust.manifest.bundles['claude-code'], lock.bundles['claude-code']);

  // Changed after approval: MIRAI's own skill again, with its line.
  f.put('.mirai/custom/skills/mirai-write/overlay.md', 'Use the glossary.\n');
  const changed = await run(['render'], f.io);
  assert.equal(changed.code, EXIT.OK, changed.err);
  assert.match(changed.err, /^note: \.mirai\/custom\/skills\/mirai-write\/overlay\.toml is changed since its approval, so MIRAI's mirai-write skill is used/m);
  assert.equal(readFileSync(skillFile, 'utf8'), plain.skill);
  assert.ok(readFileSync(agentFile, 'utf8').endsWith(REX_TEXT), 'the agent overlay is still approved');
});

const REPLACE = `${HEAD('prd')}replace = true\n`;

test('37 Q5: doctor warns when MIRAI\'s template text changed under the same version', () => {
  const f = fixture({}, { 'document-types/prd.toml': REPLACE, 'templates/prd.md': read('templates/prd.md').replace(/\n+$/, '\n\n## Security sign-off\n\nWho signed off, and when.\n') });
  const store = openStore(f.io);
  const trust = snapshot(f.io);
  const [o] = readOverlays(overlayFilesIn(f.at(CUSTOM_DIR)), REGISTRY);
  assert.deepEqual(o.problems, []);
  const line = { type: 'approval', by: 'human', kind: 'overlay', path: o.path, content_hash: o.hash, files: o.bound, decision: 'accepted', seq: 1, template_version: 1 };
  assert.doesNotMatch(overlaysCheck({ store, trust, events: [{ ...line, template_hash: o.result.coreTemplate.hash }] }).detail, /template/);
  const moved = overlaysCheck({ store, trust, events: [{ ...line, template_hash: `sha256:${'2'.repeat(64)}` }] });
  assert.equal(moved.state, 'yellow');
  assert.match(moved.detail, /MIRAI's prd template text changed since your replacement \.mirai\/custom\/document-types\/prd\.toml was approved \(version 1 both times\)/);
});

const EPIC_OVERLAY = `${HEAD('epic')}\n[[rename]]\nfrom = "Tickets"\nto = "Work items"\n`;
const GENERATED_TICKETS = /(## Tickets\n)[\s\S]*?(?=\n## )/;

test('37 gaps: mirai epic render with a renamed generated section, in an LF and a CRLF file; a CRLF document with renamed sections lints clean', async () => {
  const docs = { [`${D}/brief.md`]: BRIEF, [`${D}/interview.md`]: INTERVIEW, [`${D}/prd.md`]: PRD };
  for (const [p, text] of Object.entries(TICKETS)) docs[`${D}/${p}`] = text;
  const f = fixture(docs, { 'document-types/epic.toml': EPIC_OVERLAY });
  writeRecord(f, '.mirai/custom/document-types/epic.toml');
  const renamed = swap(EPIC, '## Tickets\n', '## Work items\n');
  const emptied = renamed.replace(/(## Work items\n)[\s\S]*?(?=\n## )/, '$1');
  for (const eol of ['\n', '\r\n']) {
    f.put(`${D}/epic-due-dates.md`, emptied.split('\n').join(eol));
    f.commit(`epic ${JSON.stringify(eol)}`);
    const r = await run(['epic', 'render', `${D}/epic-due-dates.md`], f.io);
    assert.equal(r.code, EXIT.OK, r.err + r.out);
    assert.equal(r.err, '');
    assert.equal(readFileSync(f.at(`${D}/epic-due-dates.md`), 'utf8'), renamed.split('\n').join(eol), `the generated section under the project's name (${JSON.stringify(eol)})`);
  }
  // Without the overlay's approval, the render looks for MIRAI's name.
  const g = fixture(docs, { 'document-types/epic.toml': EPIC_OVERLAY });
  g.put(`${D}/epic-due-dates.md`, emptied);
  g.commit('epic');
  const skipped = await run(['epic', 'render', `${D}/epic-due-dates.md`], g.io);
  assert.equal(skipped.code, EXIT.USAGE);
  assert.match(skipped.err, /is not approved, so MIRAI's epic type is used/);
  assert.match(skipped.err, /has no "## Tickets"/);
  // A CRLF PRD under renamed names lints clean, as its LF form does.
  const prd = files({ 'document-types/prd.toml': `${HEAD('prd')}\n[[rename]]\nfrom = "Summary for approval"\nto = "Executive summary"\n` });
  const reg = applyOverlays(REGISTRY, prd, readOverlays(prd, REGISTRY).map((o) => ({ type: 'approval', by: 'human', kind: 'overlay', path: o.path, content_hash: o.hash, decision: 'accepted', seq: 1 }))).registry;
  const text = swap(PRD, '## Summary for approval', '## Executive summary');
  const lint = (t) => lintText(t, { source: `${D}/prd.md`, registry: reg, project: { repos: ['.'] }, linked: { 'brief.md': BRIEF } }).filter((p) => p.severity === 'error');
  assert.deepEqual(lint(text), []);
  assert.deepEqual(lint(text.split('\n').join('\r\n')), []);
});
const files = (obj) => new Map(Object.entries(obj).map(([k, v]) => [k, Buffer.from(v)]));

test('37 gaps: MIRAI\'s lint tool in your session, from a real registration, applies an approved overlay from the trust root', async () => {
  const f = fixture({ [BRIEF_PATH]: BRIEF, [`${D}/interview.md`]: INTERVIEW }, { 'document-types/brief.toml': BRIEF_OVERLAY, 'templates/brief.md': BRIEF_FRAGMENT });
  const call = async (store) => {
    const { policy } = sessionServer({ store, trust: snapshot(f.io), env: f.env });
    let reply;
    const done = new Promise((r) => { reply = r; });
    const server = createServer({ policy, send: (m) => m.id !== undefined && reply(m), deps: {} });
    server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lint', arguments: { paths: [BRIEF_PATH] } } });
    const m = await done;
    return JSON.parse(m.result.content[0].text);
  };
  const store = openStore(f.io);
  const before = await call(store);
  assert.equal(before.outcome, 'pass', JSON.stringify(before));
  assert.match(before.overlays_skipped[0], /brief\.toml is not approved/);
  writeRecord(f, '.mirai/custom/document-types/brief.toml');
  f.commit('record');
  const after = await call(store);
  assert.equal(after.outcome, 'fail', JSON.stringify(after));
  assert.ok(after.problems.some((p) => /Data privacy/.test(p.reason)), JSON.stringify(after.problems));
  assert.equal(after.overlays_skipped, undefined);
  assert.ok(readJournal(store).events.every((e) => e.kind !== 'overlay'), 'the record alone approved it');
  assert.ok(realpathSync(f.root));
});
