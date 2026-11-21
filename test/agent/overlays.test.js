import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runAgent } from '../../src/agent/run.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { forTemplate, unitsFor } from '../../src/redteam/run.js';
import { widenedCases } from '../../src/redteam/cases-widened.js';
import { canonicalSha256 } from '../../src/launch/strict.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { writeToken } from '../../src/sign/token.js';
import { overlayHash, readOverlays } from '../../src/config/overlays.js';
import { trustOverlayFiles, widenedTemplates } from '../../src/trust/overlays.js';
import { snapshot, trustedRegistry, trustedStrict } from '../../src/trust/snapshot.js';
import { openStore } from '../../src/store/home.js';
import { agentTemplate } from '../../src/launch/strict.js';
import { installed, tempDir } from '../tests/run-fixture.js';
import { needsTest } from '../helpers/needs.js';

// Unit 37 T5: agent overlays at the launch, with a stand-in claude and no model.
const launchTest = needsTest('macos', 'an agent launch: its scratch folder is macOS\'s /private/tmp (src/launch/strict.js; P01)');
const TOKEN = `sk-ant-oat01-${'Ag3_-k'.repeat(16)}`;
const INIT = '{"type":"system","subtype":"init","permissionMode":"dontAsk"}';
const RESULT = '{"type":"result","subtype":"success","is_error":false,"result":"done","num_turns":2,"usage":{"input_tokens":5,"output_tokens":6}}';
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const OVERLAY = (extra = '') => `kind = "agent-overlay"\nschema_version = 1\nname = "mirai-reviewer"\n${extra}`;
const TEXT = 'Always name the AC each finding is about, and quote the line.\n';

function repo() {
  const f = installed();
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  writeToken(f.env, TOKEN);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  const io = { cwd: f.root, env: f.env };
  // Commits the overlay's files on main, and approves it with your key.
  const overlay = async (toml, md = null, { approve = true } = {}) => {
    mkdirSync(join(f.root, '.mirai/custom/agents'), { recursive: true });
    writeFileSync(join(f.root, '.mirai/custom/agents/mirai-reviewer.toml'), toml);
    if (md !== null) writeFileSync(join(f.root, '.mirai/custom/agents/mirai-reviewer.md'), md);
    f.git('add', '-A');
    f.git('commit', '-qm', 'overlay');
    if (approve) await approveIt();
  };
  // Approves it, renders your sessions' copy of Rex (the trust root checks the lock's bundle
  // against it) and commits both with the approval record, as the approval's output says.
  const approveIt = async () => {
    assert.equal((await tty(['approve', '--file', '.mirai/custom/agents/mirai-reviewer.toml'], io, ['a', 'overlay-mirai-reviewer'])).code, EXIT.OK);
    const rendered = await tty(['render'], io, []);
    assert.equal(rendered.code, EXIT.OK, rendered.err);
    f.git('add', '-A');
    f.git('commit', '-qm', 'approval record');
  };
  return { ...f, io, overlay, approveIt };
}

async function tty(argv, { cwd, env }, answers) {
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd });
  return { code, out, err };
}

// A stand-in claude that keeps its arguments, one per line, then says it ran.
function recorder() {
  const dir = realpathSync(tempDir('claude'));
  const args = join(dir, 'args');
  const path = join(dir, 'claude');
  writeFileSync(path, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.316 (Claude Code)"; exit 0; fi\nfor a in "$@"; do printf '%s\\0' "$a"; done > ${args}\necho '${INIT}'; echo '${RESULT}'\n`, { mode: 0o755 });
  const seen = () => readFileSync(args, 'utf8').split('\0').slice(0, -1);
  return { path, seen };
}
const after = (args, flag) => args[args.indexOf(flag) + 1];
const review = (f, claude, status = green) => runAgent({ launchToken: mintLaunchToken(), cwd: f.root, env: f.env, role: 'reviewer', agent: 'mirai-reviewer', prompt: 'review it', claude: claude.path, status, check: () => [] });

// What the widened cases read from a red-team worker (none of it is touched here).
const CTX = { project: '/w/project', repoHome: '/w/home', httpUrl: 'http://127.0.0.1:9/', canaries: { http: 'C-http', env: 'C-env', envLocal: 'C-l', subEnv: 'C-s', realEnv: 'C-r', nestedEnv: 'C-n', store: 'C-store' } };

test('37 Q4: the red team\'s widened cases are picked from the overlay\'s widened tools, and run only under that agent\'s template', () => {
  const base = { name: 'read-only', mode: 'read-only', tools: ['Glob', 'Grep', 'Read'], deny_tools: ['Task'] };
  const rw = { name: 'read-write', mode: 'read-write', tools: ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'], deny_tools: ['Task'] };
  const mode = { id: 'm-mode', templates: ['read-only'] };
  const cases = [mode, ...widenedCases(CTX)];
  const at = (templates) => unitsFor(cases, templates).units.map((u) => `${u.template} ${u.id}`).sort();
  const overlay = { path: '.mirai/custom/agents/mirai-reviewer.toml', hash: `sha256:${'a'.repeat(64)}` };
  // No widened agent: the mode's case only, and the widened ones aren't listed as skipped.
  const plain = new Map([['read-only', base], ['read-write', rw]]);
  assert.deepEqual(at(plain), ['read-only m-mode']);
  assert.deepEqual(unitsFor(cases, plain).skipped, []);
  // A narrowing template (fewer tools): nothing widened, no widened case.
  const narrow = agentTemplate(base, { agent: 'mirai-reviewer', tools: ['Read'], overlay });
  assert.deepEqual(narrow.overlay.widened, []);
  assert.deepEqual(at(new Map([['read-only', base], [narrow.name, narrow]])), ['agent-mirai-reviewer-read-only m-mode', 'read-only m-mode']);
  // Bash: the three Bash cases, under its template only.
  const bash = agentTemplate(base, { agent: 'mirai-reviewer', tools: ['Read', 'Grep', 'Glob', 'Bash'], overlay });
  assert.deepEqual(bash.overlay.widened, ['Bash']);
  assert.deepEqual(at(new Map([['read-only', base], [bash.name, bash]])), ['agent-mirai-reviewer-read-only m-mode', 'agent-mirai-reviewer-read-only x-bash-checkout', 'agent-mirai-reviewer-read-only x-bash-network', 'agent-mirai-reviewer-read-only x-bash-secrets', 'read-only m-mode']);
  // Write and Edit for a read-only agent: the protected-path cases.
  const write = agentTemplate(base, { agent: 'mirai-reviewer', tools: ['Read', 'Write', 'Edit'], overlay });
  assert.deepEqual(at(new Map([[write.name, write]])), ['agent-mirai-reviewer-read-only m-mode', 'agent-mirai-reviewer-read-only x-edit-protected', 'agent-mirai-reviewer-read-only x-write-protected']);
  // The widened tools are part of the canonical hash's input (the template's overlay field).
  assert.notDeepEqual(bash.overlay, write.overlay);
});

launchTest('37 T5: an instruction-only overlay launches with its text in the prompt; a narrowing one launches; a widening one is refused until a red-team result covers its hash, then launches', async () => {
  const f = repo();
  const c = recorder();

  // Unapproved: the launch is refused, never run on MIRAI's definition instead.
  await f.overlay(OVERLAY(), TEXT, { approve: false });
  await assert.rejects(review(f, c), (e) => e.code === 'overlay-not-approved' && /mirai-reviewer's overlay \.mirai\/custom\/agents\/mirai-reviewer\.toml is not approved/.test(e.message) && /mirai approve --file \.mirai\/custom\/agents\/mirai-reviewer\.toml/.test(e.hint));

  // Instruction-only, approved: launches with the added text at the end of Rex's prompt, his tools as they are.
  await f.approveIt();
  const r1 = await review(f, c);
  assert.equal(r1.outcome, 'ok', r1.why);
  const def = JSON.parse(after(c.seen(), '--agents'))['mirai-reviewer'];
  assert.ok(def.prompt.endsWith(`\n\n${TEXT}`), def.prompt.slice(-200));
  assert.equal(after(c.seen(), '--tools'), 'Glob,Grep,Read');
  // An instruction-only overlay adds no template, so no widened case, to the red team.
  const modes = (t) => new Map(['read-write', 'read-only'].map((m) => [m, trustedStrict(t, m)]));
  const t1 = snapshot(f.io);
  assert.equal(widenedTemplates(t1, openStore(f.io), modes(t1)).size, 0);

  // Narrowing (no Glob): launches at once on the mode's green result, with fewer tools.
  await f.overlay(OVERLAY('[tools]\nallowed = ["Read", "Grep"]\n'));
  const asked = [];
  const r2 = await review(f, c, async ({ template }) => {
    asked.push(template.name);
    return green();
  });
  assert.equal(r2.outcome, 'ok', r2.why);
  assert.equal(after(c.seen(), '--tools'), 'Grep,Read');
  assert.deepEqual(asked, ['read-only'], 'a narrowed agent stands on its mode\'s result');

  // Widening (Bash): refused until a result covers this overlay's own template, then launches.
  await f.overlay(OVERLAY('[tools]\nallowed = ["Read", "Grep", "Glob", "Bash"]\n'));
  const trust = snapshot(f.io);
  const [o] = readOverlays(trustOverlayFiles(trust), trustedRegistry(trust));
  // The red team gets Rex's own template, and the cases made for Bash run under it.
  const widened = widenedTemplates(trust, openStore(f.io), modes(trust));
  assert.deepEqual([...widened.keys()], ['agent-mirai-reviewer-read-only']);
  const ids = unitsFor(widenedCases(CTX), widened).units.map((u) => u.id);
  assert.deepEqual(ids, ['x-bash-checkout', 'x-bash-network', 'x-bash-secrets']);
  let result = { templates: {}, cases: [] };
  let template = null;
  const status = async ({ template: t }) => {
    template = t;
    return forTemplate({ state: 'green', blocker_seen: null, changed: [], result }, { bundles: {} }, t);
  };
  await assert.rejects(review(f, c, status), (e) => e.code === 'overlay-widened' && /mirai-reviewer's overlay widens it \(adds Bash\), and no green red-team result covers it/.test(e.message) && /mirai redteam run/.test(e.hint));
  assert.equal(template.name, 'agent-mirai-reviewer-read-only');
  assert.deepEqual(template.overlay, { path: '.mirai/custom/agents/mirai-reviewer.toml', hash: overlayHash(o), widened: ['Bash'] });
  assert.deepEqual(template.tools, ['Bash', 'Glob', 'Grep', 'Read']);
  assert.equal(template.mode, 'read-only', 'the reviewer\'s mode still write-denies the checkout');
  // A result for another overlay (another hash) doesn't cover it.
  const other = { ...template, overlay: { ...template.overlay, hash: `sha256:${'0'.repeat(64)}` } };
  result = { templates: { [template.name]: { bundle: canonicalSha256(other), cases: 1, tested: true } }, cases: [{ id: 'x', template: template.name, outcome: 'pass' }] };
  await assert.rejects(review(f, c, status), (e) => e.code === 'overlay-widened');
  // A result covering its hash where a case made for Bash failed: the gate stays closed.
  const cases = (failing = null) => [{ id: 'c-instructions-review', template: template.name, outcome: 'pass' }, ...ids.map((id) => ({ id, template: template.name, outcome: id === failing ? 'fail' : 'pass' }))];
  result = { templates: { [template.name]: { bundle: canonicalSha256(template), cases: 4, tested: false } }, cases: cases('x-bash-network') };
  await assert.rejects(review(f, c, status), (e) => e.code === 'overlay-widened');
  // The fake red-team result covering its hash, every case passed: the launch goes ahead, with Bash.
  result = { templates: { [template.name]: { bundle: canonicalSha256(template), cases: 4, tested: true } }, cases: cases() };
  const r3 = await review(f, c, status);
  assert.equal(r3.outcome, 'ok', r3.why);
  assert.equal(after(c.seen(), '--tools'), 'Bash,Glob,Grep,Read');
  assert.deepEqual(JSON.parse(after(c.seen(), '--agents'))['mirai-reviewer'].tools.filter((t) => !t.startsWith('mcp__')), ['Bash', 'Glob', 'Grep', 'Read']);
});
