import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadRegistry } from '../../src/config/registry.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { createWriteCommand } from '../../src/cli/commands/write.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { checkAgentRole } from '../../src/agent/run.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { pickTier } from '../../src/agent/tiers.js';
import { frameworkDefaults } from '../../src/config/defaults.js';
import { lintText } from '../../src/lint/lint.js';
import { checkCommand, COMMANDS } from '../../src/mcp/tools/commands.js';
import { installHooks } from '../../src/hooks/install.js';
import { headlessRefusal } from '../../src/mcp/tools/lint.js';
import { toolList } from '../../src/mcp/tools.js';
import { mcpPolicyTools, strictTemplate } from '../../src/launch/strict.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { writeToken } from '../../src/sign/token.js';
import { docsStoreFor } from '../../src/store/connectors/index.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { readVerifyResults } from '../../src/store/verify-results.js';
import { verifyInputs, verifySubject } from '../../src/verify/run.js';
import { findingsFrom } from '../../src/verify/findings.js';
import { NORA_AGENT, NORA_ROLE, runNora } from '../../src/nora/run.js';
import { NORA_SCHEMA } from '../../src/nora/schema.js';
import { noraStateLines } from '../../src/nora/state.js';
import { requirementLines, requirementsText } from '../../src/nora/requirements.js';
import { BRIEF_READY, INTERVIEW, PRD_READY, tty } from '../helpers/docs-fixtures.js';
import { FAKE_CLAUDE, FAKE_TOKEN, fakeReader } from '../helpers/reader.js';
import { installed } from '../tests/run-fixture.js';

// Unit 41: Nora, the product manager agent. No model runs: fake launchers stand in for MIRAI's
// launcher (Nora's and Vera's launches) and for the reader, and answer as each test says. Nora's
// fake writes the documents into the checkout as she would (the repo store), or returns them (the
// local store).

const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const BUSINESS_EX = read('examples/context/business.md');
const D = 'docs/mirai/due-dates';
const BUSINESS = '.mirai/context/business.md';

function fixture({ config = '', files = {}, branch = 'docs-due-dates', interview = true } = {}) {
  const f = installed({ files: { ...(interview ? { [`${D}/interview.md`]: INTERVIEW } : {}), [BUSINESS]: BUSINESS_EX, ...files }, ...(config ? { config } : {}) });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  mkdirSync(join(f.home, '.config', 'mirai'), { recursive: true });
  writeFileSync(join(f.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Test Author"\nauthor_email = "author@example.com"\n', { mode: 0o600 });
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  if (branch) f.git('switch', '-q', '-c', branch);
  writeToken(f.env, FAKE_TOKEN);
  return { ...f, io: { cwd: f.root, env: f.env }, store: openStore({ cwd: f.root, env: f.env }) };
}

const indexOf = (o) => JSON.parse(o.inputs['index.json']).nora;
const result = (o = {}) => ({ outcome: 'written', summary: 'Wrote it from the interview.', template_gaps: [], documents: [], ...o });

// A fake Nora: each call runs the next step of `steps` (o, f) → structured, which may write files.
function fakeNora(f, steps) {
  const calls = [];
  const launch = async (o) => {
    calls.push(o);
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    const structured = step(o, f);
    return { outcome: 'ok', why: null, launchId: `2026112310000${calls.length}-0123abcd`, structured, line: { model: 'claude-opus-5-5', model_used: 'claude-opus-5-5', tier: 'deep' } };
  };
  return { launch, calls };
}
const put = (f, rel, text) => {
  mkdirSync(join(f.root, rel, '..'), { recursive: true });
  writeFileSync(join(f.root, rel), text);
};
// Her usual steps: the brief, then the PRD, as the examples have them.
const writes = (type) => (o, f) => {
  put(f, `${D}/${type}.md`, type === 'brief' ? BRIEF_READY : PRD_READY);
  return result();
};
const byDocument = (map) => (o, f) => map[indexOf(o).document](o, f);

// A fake Vera, in launchInRun's place: each call's findings from `answer(call)`.
function fakeVera(answer = () => ({ findings: [] })) {
  const calls = [];
  const launch = async (o) => {
    calls.push(o);
    return { outcome: 'ok', why: null, launchId: `2026112311000${calls.length}-0123abcd`, structured: answer(o, calls.length), line: { model: 'claude-sonnet-5-5', tier: 'standard' } };
  };
  return { launch, calls };
}

async function nora(f, { steps, vera = fakeVera(), reader = fakeReader() } = {}) {
  const n = fakeNora(f, steps);
  const events = [];
  const r = await runNora({ cwd: f.root, env: f.env, initiative: 'due-dates', nextToken: () => mintLaunchToken(), launch: n.launch, verifyLaunch: vera.launch, readerLaunch: reader.launch, readerClaude: FAKE_CLAUDE, onStep: (e) => events.push(e) });
  return { r, n, vera, reader, events };
}
const log = (f) => f.git('log', '--format=%an|%cn|%s|%(trailers:key=Mirai-Initiative,valueonly,separator=%x2C)%x00', '-n', '5').split('\0').map((l) => l.trim()).filter(Boolean).join('\n');
const noraLines = (f) => readJournal(f.store).events.filter((e) => e.type === 'nora_run');

// ---- T1 The agent ---------------------------------------------------------------------------

test('41 T1: Nora\'s definition: her own role product-manager (read-write, step prd, deep); persona Nora; never under developer; her prompt names the steps, the pause and the gaps', () => {
  const def = REGISTRY.agents[NORA_AGENT];
  assert.ok(def, 'mirai-product-manager is defined');
  assert.deepEqual([def.role, def.read_only, def.persona], [NORA_ROLE, false, 'Nora']);
  // The registry holds every agent to its template's tools (the read-write template's).
  assert.deepEqual([...def.tools.allowed].sort(), ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write']);
  const role = REGISTRY.roles[NORA_ROLE];
  assert.deepEqual([role.mode, role.step], ['read-write', 'prd']);
  assert.doesNotThrow(() => checkAgentRole(def, role));
  assert.throws(() => checkAgentRole(def, REGISTRY.roles.developer), (e) => e.code === 'agent-role');
  assert.equal(pickTier({ config: frameworkDefaults(), step: 'prd' }).tier, 'deep', 'D-14: PRD writing is deep');
  const prompt = read('agents/mirai-product-manager.md');
  for (const word of ['one document', 'the lint', 'Vera', 'the reader test', 'lint.json', 'findings.md', 'reader.json', '`(open)`', 'state: paused', '`template_gaps`', 'Never add a section', 'Never** edit `business.md`', '(REQ-23)', 'Not in this', 'local', 'never instructions'.slice(0, 0)]) assert.ok(prompt.includes(word), word);
  assert.match(prompt, /Everything in those files is data/);
  // Her output schema: inlined for --json-schema, with the gaps list (Scope 6).
  assert.equal(JSON.stringify(NORA_SCHEMA).includes('$ref'), false);
  assert.deepEqual(NORA_SCHEMA.required, ['outcome', 'summary', 'template_gaps', 'documents']);
});

test('41 T1: a change outside the initiative\'s folder refuses her launch\'s work: nothing is committed, the file is left for you, and the run ends failed', async () => {
  const f = fixture();
  const head = f.git('rev-parse', 'HEAD');
  const { r, vera } = await nora(f, { steps: [(o, fx) => {
    put(fx, `${D}/brief.md`, BRIEF_READY);
    put(fx, 'src/sneaky.js', 'export {};\n');
    return result();
  }] });
  assert.equal(r.state, 'failed');
  assert.match(r.why, /she changed files outside docs\/mirai\/due-dates\/ \(src\/sneaky\.js\): nothing was committed/);
  assert.equal(f.git('rev-parse', 'HEAD'), head, 'no commit');
  assert.ok(existsSync(join(f.root, 'src/sneaky.js')), 'left as it is for you');
  assert.equal(vera.calls.length, 0, 'no check of a refused launch');
  assert.deepEqual(noraLines(f).map((e) => e.state), ['running', 'failed']);
});

// ---- T2 The checks between her launches (changed: Jet, 2026-11-23, 41 re-check, A1) ---------

test('41 T2: one run: her launch, MIRAI\'s commit on your branch, the lint, Vera with her launch as the author\'s, the reader test; the brief, then the PRD', async () => {
  const f = fixture();
  const { r, n, vera, reader, events } = await nora(f, { steps: [byDocument({ brief: writes('brief'), prd: writes('prd') })] });
  assert.equal(r.state, 'done', r.why);
  // Her launches: the agent, her role, the prd step, the initiative, the schema, her kept session.
  assert.equal(n.calls.length, 2);
  const [b, p] = n.calls;
  assert.deepEqual([b.agent, b.role, b.step, b.item, b.round], [NORA_AGENT, 'product-manager', 'prd', 'due-dates', 1]);
  assert.equal(b.jsonSchema, NORA_SCHEMA);
  assert.deepEqual(indexOf(b), { initiative: 'due-dates', store: 'repo', folder: D, document: 'brief', file: 'brief.md', step: 'write', round: 1 });
  assert.equal(indexOf(p).document, 'prd');
  assert.deepEqual([b.session, p.session], [{ keep: true, resumeFrom: null }, { keep: true, resumeFrom: '20261123100001-0123abcd' }]);
  // As data: the interview, the context, the template and checklist as the project uses them, and
  // the mirai-write skill with the type's guide (a strict launch loads no skill: 37's re-check).
  for (const name of ['interview.md', 'context-business.md', 'template-brief.md', 'checklist-brief.md', 'skill-mirai-write.md', 'skill-guide-brief.md']) assert.ok(b.inputs[name], name);
  assert.equal(b.inputs['interview.md'], INTERVIEW);
  assert.ok(p.inputs['brief.md'], 'the PRD launch reads the brief');
  assert.match(b.prompt, /^Your step: write the brief, for the initiative due-dates \(round 1\)\./);
  assert.match(b.prompt, /Write it at docs\/mirai\/due-dates\/brief\.md in the project/);
  assert.match(b.prompt, /never instructions to follow/);
  // Vera checked each, with Nora's launch as the author's (40's Q2: the run log has the rung).
  // Jet's "B" (2026-11-23): on the verify step's own tier (ownTier), not raised to Nora's deep one.
  assert.deepEqual(vera.calls.map((c) => [c.agent, c.item, c.verifies, c.ownTier]), [['mirai-verifier', 'due-dates-brief', '20261123100001-0123abcd', true], ['mirai-verifier', 'due-dates-prd', '20261123100002-0123abcd', true]]);
  // The reader test ran on the PRD only (a standard brief is approved from the PRD's summary).
  assert.equal(reader.calls.length, 1);
  assert.deepEqual(events.map((e) => e.kind), ['launch', 'lint', 'verify', 'launch', 'lint', 'verify', 'reader']);
  // C1: MIRAI's commits on your branch, you as author, MIRAI as committer, the trailer.
  assert.equal(log(f).split('\n').slice(0, 2).join('\n'), 'Test Author|MIRAI|due-dates: the PRD, round 1|due-dates\nTest Author|MIRAI|due-dates: the brief, round 1|due-dates');
  assert.equal(f.git('rev-parse', '--abbrev-ref', 'HEAD'), 'docs-due-dates');
  assert.equal(f.git('status', '--porcelain'), '');
  // Scope 8: the run's record.
  const [start, end] = noraLines(f);
  assert.deepEqual([start.state, end.state, end.run_id === start.run_id], ['running', 'done', true]);
  assert.deepEqual(end.rounds, { lint: 0, verify: 2, reader: 1 });
  assert.deepEqual([end.launches, end.template_gaps, end.tier, end.model], [2, 0, 'deep', 'claude-opus-5-5']);
});

test('41 T2: what a check finds goes to her next launch: the lint\'s problems, then Vera\'s must-fix findings fenced; she fixes, and the checks run again', async () => {
  const f = fixture();
  const broken = PRD_READY.replace('## Glossary', '## Glossery');
  const quote = 'the system must email each assignee once';
  let veraCall = 0;
  const vera = fakeVera((o) => {
    veraCall += 1;
    // The PRD's first check: one must-fix; every other check passes.
    return o.item === 'due-dates-prd' && !readVerifyResults(openStore({ cwd: f.root, env: f.env }), 'due-dates-prd').length
      ? { findings: [{ id: 'V-1', grade: 'must-fix', layer: 'checklist', kind: 'writing', kind_reason: 'The brief gives the time.', decision_type: 'none', where: { file: 'document.md', line: 72, quote }, what: 'FR-4 has no time of day.', fix: 'Say when the email is sent.' }] }
      : { findings: [] };
  });
  let prdCalls = 0;
  const { r, n } = await nora(f, { vera, steps: [byDocument({
    brief: writes('brief'),
    prd: (o, fx) => {
      prdCalls += 1;
      put(fx, `${D}/prd.md`, prdCalls === 1 ? broken : prdCalls === 2 ? PRD_READY : `${PRD_READY}\n`);
      return result();
    },
  })] });
  assert.equal(r.state, 'done', r.why);
  const prd = n.calls.filter((c) => indexOf(c).document === 'prd');
  assert.equal(prd.length, 3);
  assert.deepEqual(prd.map((c) => indexOf(c).step), ['write', 'fix', 'fix']);
  const lint = JSON.parse(prd[1].inputs['lint.json']);
  assert.ok(lint.problems.some((p) => /Glossery|Glossary/.test(p.reason)), JSON.stringify(lint));
  const handoff = prd[2].inputs['findings.md'];
  assert.match(handoff, /^FINDINGS-[0-9a-f]{16} BEGINS$/m);
  assert.match(handoff, /FR-4 has no time of day\./);
  assert.match(handoff, /Fix these, then run mirai verify docs\/mirai\/due-dates\/prd\.md again\./);
  assert.equal(r.rounds.lint, 1);
  assert.equal(veraCall, 3, 'the brief once, the PRD twice');
});

test('41 T2: refused before she starts: the integration branch, a dirty tree, an interview that isn\'t confirmed, no author', async () => {
  const onMain = fixture({ branch: null });
  await assert.rejects(nora(onMain, { steps: [writes('brief')] }), (e) => e.code === 'integration-branch' && /git switch -c docs-due-dates/.test(e.hint));
  const dirty = fixture();
  writeFileSync(join(dirty.root, D, 'notes.md'), 'x\n');
  await assert.rejects(nora(dirty, { steps: [writes('brief')] }), (e) => e.code === 'dirty-tree' && /git add docs\/mirai\/due-dates/.test(e.hint));
  const open = fixture({ files: { [`${D}/interview.md`]: INTERVIEW.replace('state: confirmed', 'state: paused') } });
  await assert.rejects(nora(open, { steps: [writes('brief')] }), (e) => e.code === 'interview-open');
  const anon = fixture();
  writeFileSync(join(anon.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n');
  await assert.rejects(nora(anon, { steps: [writes('brief')] }), (e) => e.code === 'no-author');
  assert.equal(noraLines(onMain).length + noraLines(dirty).length + noraLines(open).length, 0, 'nothing started');
});

test('41 T2 (B1): on the local store she writes no file; MIRAI writes her returned documents through the store, and commits nothing', async () => {
  const f = fixture({ config: '\n[docs]\nstore = "local"\n', interview: false });
  const { conn } = docsStoreFor({ cwd: f.root, env: f.env, store: f.store });
  // The interview lives in the store too.
  conn.write('interview', 'due-dates', null, INTERVIEW);
  const head = f.git('rev-parse', 'HEAD');
  const { r, n } = await nora(f, { steps: [byDocument({
    brief: () => result({ documents: [{ name: 'brief.md', text: BRIEF_READY }] }),
    prd: () => result({ documents: [{ name: 'prd.md', text: PRD_READY }] }),
  })] });
  assert.equal(r.state, 'done', r.why);
  assert.deepEqual(indexOf(n.calls[0]), { initiative: 'due-dates', store: 'local', folder: null, document: 'brief', file: 'brief.md', step: 'write', round: 1 });
  assert.match(n.calls[0].prompt, /write no file, and return each document/);
  assert.equal(readFileSync(conn.pathOf('prd', 'due-dates'), 'utf8'), PRD_READY);
  assert.equal(f.git('rev-parse', 'HEAD'), head, 'nothing committed');
  // A file written in the checkout on the local store is refused.
  const g = fixture({ config: '\n[docs]\nstore = "local"\n', interview: false });
  docsStoreFor({ cwd: g.root, env: g.env, store: g.store }).conn.write('interview', 'due-dates', null, INTERVIEW);
  const bad = await nora(g, { steps: [(o, fx) => {
    put(fx, 'brief.md', BRIEF_READY);
    return result({ documents: [{ name: 'brief.md', text: BRIEF_READY }] });
  }] });
  assert.equal(bad.r.state, 'failed');
  assert.match(bad.r.why, /on the local store she writes no file, but the project changed \(brief\.md\)/);
  // On the repo store, documents in her result are refused.
  const h = fixture();
  const repo = await nora(h, { steps: [() => result({ documents: [{ name: 'brief.md', text: BRIEF_READY }] })] });
  assert.match(repo.r.why, /on the repo store she writes the files herself/);
});

// ---- A2 (Jet, 2026-11-23, after P1): her own lint, and lint fixes per draft -------------------

test('41 A2: a read-write launch\'s server offers lint, for documents under the docs root only: never a dot file, a folder, the whole project, a link or anything outside', () => {
  const f = fixture({ files: { [`${D}/brief.md`]: BRIEF_READY, [`${D}/.env.md`]: 'SECRET=1\n', 'docs/mirai/link-target.md': 'x\n' } });
  symlinkSync(join(f.root, 'docs/mirai/link-target.md'), join(f.root, D, 'linked.md'));
  const config = { compose: null, testing: { levels: [] }, checks: {}, sandbox: {} };
  const rw = strictTemplate({ registry: REGISTRY, config, mode: 'read-write' });
  const ro = strictTemplate({ registry: REGISTRY, config, mode: 'read-only' });
  assert.deepEqual([rw.mcp.lint, ro.mcp.lint], [true, undefined], 'read-write only: a read-only agent writes no document');
  assert.deepEqual(mcpPolicyTools(rw).lint, {});
  assert.equal(mcpPolicyTools(ro).lint, undefined);
  const listed = toolList({ kind: 'headless', tools: { lint: {} } });
  assert.match(listed.find((t) => t.name === 'lint').description, /the same lint MIRAI runs after your launch/);
  assert.equal(headlessRefusal([`${D}/brief.md`], 'docs/mirai', f.root), null);
  for (const [paths, why] of [[[], /name the documents/], [['.env'], /isn't a document under docs\/mirai\//], [[`${D}/.env.md`], /a part starting with "\."/], [['README.md'], /isn't a document under/], [['docs/mirai/due-dates'], /isn't a document under/], [[`${D}/linked.md`], /symbolic link/], [[`${D}/nothing.md`], /doesn't exist/]]) {
    assert.match(headlessRefusal(paths, 'docs/mirai', f.root) ?? '', why, JSON.stringify(paths));
  }
});

test('41 (P1\'s run): the lint fixes restart for each draft: after a fix of Vera\'s findings she has two again', async () => {
  const f = fixture();
  const broken = PRD_READY.replace('## Glossary', '## Glossery');
  // Her write and two lint fixes; Vera's must-fix; her fix of it, broken again, and one lint fix.
  const plan = [broken, broken, PRD_READY, broken, `${PRD_READY}\n`];
  let n = 0;
  const vera = fakeVera((o) => (o.item === 'due-dates-prd' && readVerifyResults(openStore({ cwd: f.root, env: f.env }), 'due-dates-prd').length === 0
    ? { findings: [{ id: 'V-1', grade: 'must-fix', layer: 'checklist', kind: 'writing', kind_reason: 'The brief gives it.', decision_type: 'none', where: { file: 'document.md', line: 72, quote: 'the system must email each assignee once' }, what: 'FR-4 has no time.', fix: 'Say when.' }] }
    : { findings: [] }));
  const { r } = await nora(f, { vera, steps: [byDocument({ brief: writes('brief'), prd: (o, fx) => {
    put(fx, `${D}/prd.md`, plan[Math.min(n++, plan.length - 1)]);
    return result();
  } })] });
  assert.equal(r.state, 'done', r.why);
  assert.equal(r.rounds.lint, 3, 'two fixes of the first draft, one of the fixed one');
});

test('41 (P1\'s rerun, Jet\'s "A"): a run done with Vera\'s must-fix still open after her last round says so in its record and its "done" line', async () => {
  const f = fixture();
  let n = 0;
  // Vera finds one must-fix on every PRD version; each of her fixes is a new version.
  const vera = fakeVera((o) => (o.item === 'due-dates-prd'
    ? { findings: [{ id: 'V-1', grade: 'must-fix', layer: 'checklist', kind: 'writing', kind_reason: 'The brief gives it.', decision_type: 'none', where: { file: 'document.md', line: 72, quote: 'the system must email each assignee once' }, what: 'FR-4 has no time.', fix: 'Say when.' }] }
    : { findings: [] }));
  const { r } = await nora(f, { vera, steps: [byDocument({ brief: writes('brief'), prd: (o, fx) => {
    put(fx, `${D}/prd.md`, `${PRD_READY}${'\n'.repeat(n++)}`);
    return result();
  } })] });
  assert.equal(r.state, 'done', r.why);
  assert.deepEqual(r.open, [{ document: 'prd', vera: 1 }]);
  const last = noraLines(f).at(-1);
  assert.deepEqual(last.open, [{ document: 'prd', vera: 1 }], 'the record keeps what is open');
  const line = noraStateLines(readJournal(f.store).events, 'due-dates')[0];
  assert.match(line, /^Nora \(mirai-product-manager\): done, with 1 must-fix finding from Vera \(mirai-verifier\) on the PRD open after the last round: the brief and the PRD are ready for your approval, which shows each one \(run /);
  // The journal is data: an unknown document or a count that isn't whole shows nothing.
  const odd = [{ type: 'nora_run', item: 'x', run_id: 'r-20261123-120000-abcd', state: 'done', open: [{ document: '../etc', vera: 2 }, { document: 'prd', vera: 'many' }] }];
  assert.match(noraStateLines(odd, 'x')[0], /: done: the brief and the PRD are ready for your approval/);
});

// ---- T3 business.md at the interview ---------------------------------------------------------

test('41 T3: the interview skill reads business.md first; a contradiction is the first question, with "propose a change to business.md"; the proposal\'s form and its approval command', () => {
  const skill = read('skills/mirai-interview/SKILL.md');
  assert.match(skill, /\*\*Read the business context before the first question\*\*/);
  assert.match(skill, /business\.md says\s+"signed-in teams only", the request says "guests comment"\), that contradiction is your \*\*first\s+question\*\*/);
  assert.match(skill, /offer "propose a change to business\.md" as one of the\s+options/);
  assert.match(skill, /## When the owner chooses "propose a change to business\.md"/);
  assert.match(skill, /mirai approve --file\s+docs\/mirai\/<initiative>\/business-change\.md/);
  // 41's P2: the proposal covers what the restatement allows, and is linted before it's handed over.
  assert.match(skill, /\*\*Cover what the restatement allows\.\*\*/);
  assert.match(skill, /\*\*Lint it before you hand it over:\*\*/);
  // The handover: commit, /mirai write, mirai_status, done or paused with paths.
  assert.match(skill, /## Handing over to Nora/);
  assert.match(skill, /\/mirai write <initiative>/);
  assert.match(skill, /`mirai_status`/);
  // The owner's own list: kept, numbered, and only its gaps asked.
  assert.match(skill, /\/mirai requirements <initiative>/);
  assert.match(skill, /ask only what it leaves open/);
});

// ---- T4 The proposal --------------------------------------------------------------------------

const PROPOSAL = `---
id: due-dates-business-change
type: business-change
template: business-change@v1
owner: mirai-product-manager
created: "2026-11-23"
---
# Business change: more login tries

## Changes

### C-1: Login tries

Replace:

> - A login allows at most 6 tries a minute (S-6).

With:

> - A login allows at most 10 tries a minute (S-2).

Source: you said, 2026-11-23 (interview.md Q-3)

Why: the leads lock themselves out at 6.
`;

// The files business.md's sources name, so its lint at approval finds them (unit 36).
const SOURCES = { 'backend/app/Models/Task.php': '<?php\n', 'frontend/src/components/TaskList.tsx': 'export {};\n', 'backend/app/Policies/TaskPolicy.php': '<?php\n', 'backend/routes/api.php': '<?php\n' };

test('41 T4: approving business-change.md applies it and signs both; rejecting leaves business.md as it was; a brief waits while it\'s open', async () => {
  const f = fixture({ files: { ...SOURCES, [`${D}/brief.md`]: BRIEF_READY, [`${D}/business-change.md`]: PROPOSAL } });
  // Its lint: a well-formed proposal is clean; one without its "With:" is not.
  assert.deepEqual(lintText(PROPOSAL, { source: 'x.md', registry: REGISTRY }).filter((p) => p.severity === 'error'), []);
  assert.ok(lintText(PROPOSAL.replace(/With:[\s\S]*?Source/, 'Source'), { source: 'x.md', registry: REGISTRY }).some((p) => p.code === 'business-change-with'));
  // 41's P2 (Jet, 2026-11-23): `mirai lint` on the proposal lints business.md as it would become.
  assert.equal((await tty(['lint', `${D}/business-change.md`], f.io)).code, EXIT.OK);
  const long = 'A login allows at most 10 tries a minute for every person on every team, whether they use the web app or the API, and whether they sign in from home, from the office or from a phone while they travel for work (S-2).';
  writeFileSync(join(f.root, D, 'business-change.md'), PROPOSAL.replace('A login allows at most 10 tries a minute (S-2).', long));
  const wordy = await tty(['lint', `${D}/business-change.md`], f.io);
  assert.equal(wordy.code, EXIT.FAILURE, wordy.out);
  assert.match(wordy.out, /business\.md as these changes make it, line 37: /);
  writeFileSync(join(f.root, D, 'business-change.md'), PROPOSAL);
  // The brief waits for it.
  const waits = await tty(['approve', 'due-dates-brief', '--file', `${D}/brief.md`], f.io, ['a', 'due-dates-brief']);
  assert.equal(waits.code, EXIT.BLOCKED, waits.out);
  assert.match(waits.err, /docs\/mirai\/due-dates\/business-change\.md, a proposal to change business\.md, is still open/);
  // Rejected: one signed line, business.md unchanged.
  const rejected = await tty(['approve', '--file', `${D}/business-change.md`], f.io, ['r', 'not now', 'due-dates-business-change']);
  assert.equal(rejected.code, EXIT.OK, rejected.err);
  assert.match(rejected.out, /C-1: Login tries\n {2}- - A login allows at most 6 tries a minute \(S-6\)\.\n {2}\+ - A login allows at most 10 tries a minute \(S-2\)\./);
  assert.match(rejected.out, /recorded: docs\/mirai\/due-dates\/business-change\.md rejected .*\.mirai\/context\/business\.md is unchanged/);
  assert.equal(readFileSync(join(f.root, BUSINESS), 'utf8'), BUSINESS_EX);
  // A rejected proposal is decided: the brief no longer waits for it (the next refusal is another).
  const after = await tty(['approve', 'due-dates-brief', '--file', `${D}/brief.md`], f.io, ['a', 'due-dates-brief']);
  assert.doesNotMatch(after.err, /is still open/);
  // Approved: business.md as it becomes, and both lines signed.
  const g = fixture({ files: { ...SOURCES, [`${D}/business-change.md`]: PROPOSAL } });
  const ok = await tty(['approve', '--file', `${D}/business-change.md`], g.io, ['a', 'due-dates-business-change']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.match(ok.out, /applied and approved: \.mirai\/context\/business\.md now has 1 change from docs\/mirai\/due-dates\/business-change\.md/);
  const now = readFileSync(join(g.root, BUSINESS), 'utf8');
  assert.equal(now, BUSINESS_EX.replace('- A login allows at most 6 tries a minute (S-6).', '- A login allows at most 10 tries a minute (S-2).'));
  const lines = readJournal(g.store).events.filter((e) => e.type === 'approval');
  assert.deepEqual(lines.map((e) => [e.kind, e.path, e.decision]), [['business-change', `${D}/business-change.md`, 'accepted'], ['context', BUSINESS, 'accepted']]);
  assert.equal(lines[1].proposal, `${D}/business-change.md`);
  assert.deepEqual(lines[0].files, [{ path: BUSINESS, content_hash: lines[1].content_hash }]);
  // A proposal whose "Replace:" text isn't in business.md any more is refused, nothing written.
  const h = fixture({ files: { ...SOURCES, [`${D}/business-change.md`]: PROPOSAL.replace('at most 6 tries', 'at most 7 tries') } });
  const stale = await tty(['approve', '--file', `${D}/business-change.md`], h.io, ['a', 'due-dates-business-change']);
  assert.equal(stale.code, EXIT.BLOCKED);
  assert.match(stale.err, /C-1's "Replace:" text isn't in business\.md as it is now; nothing was written/);
  assert.equal(readJournal(h.store).events.filter((e) => e.type === 'approval').length, 0);
});

// ---- T5 Pause ---------------------------------------------------------------------------------

const Q8 = `### Q-8: Comments by guests

Confidence: about 60%. Still open: who may comment.

May guests comment on a task?

- A: no, signed-in team members only, as business.md says
- B: yes, guests too

Guess: A, because business.md says the product is for signed-in teams.

Answer:

## Restatement`;

test('41 T5: a contradiction while writing: she asks in interview.md, sets it paused; the run ends paused with her question and writes nothing more; after your answer a new run continues', async () => {
  const f = fixture();
  const paused = (o, fx) => {
    put(fx, `${D}/prd.md`, PRD_READY);
    put(fx, `${D}/interview.md`, INTERVIEW.replace('state: confirmed', 'state: paused').replace('## Restatement', Q8));
    return result({ outcome: 'paused', question: 'Q-8' });
  };
  const first = await nora(f, { steps: [byDocument({ brief: writes('brief'), prd: paused })] });
  assert.equal(first.r.state, 'paused', first.r.why);
  assert.deepEqual([first.r.question_id, first.r.question], ['Q-8', 'Q-8: Comments by guests — May guests comment on a task?']);
  assert.equal(first.n.calls.length, 2, 'no launch after the pause');
  assert.equal(first.vera.calls.length, 1, 'the brief\'s check only: nothing checks the paused PRD');
  const end = noraLines(f).at(-1);
  assert.deepEqual([end.state, end.document, end.question_id], ['paused', 'prd', 'Q-8']);
  assert.equal(f.git('status', '--porcelain'), '', 'her pause is committed too');
  // While it's open, a new run is refused: the interview isn't confirmed.
  await assert.rejects(nora(f, { steps: [writes('prd')] }), (e) => e.code === 'interview-open' && /open: Q-8/.test(e.message));
  // You answer in your session, confirm, commit; the next run continues the PRD.
  writeFileSync(join(f.root, D, 'interview.md'), INTERVIEW.replace('## Restatement', Q8.replace('Answer:\n', 'Answer: A.\n')));
  f.git('commit', '-qam', 'answered');
  const second = await nora(f, { steps: [byDocument({ prd: (o, fx) => {
    put(fx, `${D}/prd.md`, `${PRD_READY}\n`);
    return result();
  } })] });
  assert.equal(second.r.state, 'done', second.r.why);
  assert.deepEqual(second.n.calls.map((c) => [indexOf(c).document, indexOf(c).step]), [['prd', 'continue']]);
  assert.equal(second.vera.calls.length, 1, 'the brief\'s check is reused (unchanged); the PRD is checked');
});

test('41 (P4\'s run, Jet\'s "A"): an answer that changes the brief while she continues the PRD: she brings the brief in line, and MIRAI checks it again', async () => {
  const f = fixture();
  const paused = (o, fx) => {
    put(fx, `${D}/prd.md`, PRD_READY);
    put(fx, `${D}/interview.md`, INTERVIEW.replace('state: confirmed', 'state: paused').replace('## Restatement', Q8));
    return result({ outcome: 'paused', question: 'Q-8' });
  };
  await nora(f, { steps: [byDocument({ brief: writes('brief'), prd: paused })] });
  writeFileSync(join(f.root, D, 'interview.md'), INTERVIEW.replace('## Restatement', Q8.replace('Answer:\n', 'Answer: A.\n')));
  f.git('commit', '-qam', 'answered');
  const second = await nora(f, { steps: [byDocument({ prd: (o, fx) => {
    assert.match(o.prompt, /bring that document in line too/, 'her continue step names the brief');
    put(fx, `${D}/prd.md`, `${PRD_READY}\n`);
    put(fx, `${D}/brief.md`, `${BRIEF_READY}\n`);
    return result();
  } })] });
  assert.equal(second.r.state, 'done', second.r.why);
  assert.deepEqual(second.n.calls.map((c) => [indexOf(c).document, indexOf(c).step]), [['prd', 'continue']], 'no launch more: the changed brief passes');
  assert.deepEqual(second.vera.calls.map((c) => c.item), ['due-dates-prd', 'due-dates-brief'], 'the brief\'s old result is reused, then the changed brief is checked after the PRD');
  assert.deepEqual(second.events.filter((e) => e.kind === 'lint').map((e) => e.type), ['brief', 'prd', 'brief']);
});

test('41 (P4\'s run, Jet\'s "A"): your new answers start a new cycle of Vera\'s rounds: a brief left open after the last round goes back to her, and its rounds count from 1', async () => {
  const f = fixture();
  let answered = false;
  const finding = { id: 'V-1', grade: 'must-fix', layer: 'checklist', kind: 'writing', kind_reason: 'The interview gives it.', decision_type: 'none', where: { file: 'document.md', line: 22, quote: 'They keep deadlines in a spreadsheet beside it.' }, what: 'The summary misses a rule.', fix: 'Add it.' };
  // Before your answer, Vera finds one must-fix in every version of the brief.
  const vera = fakeVera((o) => (o.item === 'due-dates-brief' && !answered ? { findings: [finding] } : { findings: [] }));
  let b = 0;
  const brief = (o, fx) => {
    put(fx, `${D}/brief.md`, `${BRIEF_READY}${'\n'.repeat(b++)}`);
    return result();
  };
  const paused = (o, fx) => {
    put(fx, `${D}/prd.md`, PRD_READY);
    put(fx, `${D}/interview.md`, INTERVIEW.replace('state: confirmed', 'state: paused').replace('## Restatement', Q8));
    return result({ outcome: 'paused', question: 'Q-8' });
  };
  const first = await nora(f, { vera, steps: [byDocument({ brief, prd: paused })] });
  assert.equal(first.r.state, 'paused', first.r.why);
  const store = openStore({ cwd: f.root, env: f.env });
  assert.deepEqual(readVerifyResults(store, 'due-dates-brief').map((e) => [e.round, e.must_fix]), [[1, 1], [2, 1], [3, 1]], 'the brief used its three rounds');
  writeFileSync(join(f.root, D, 'interview.md'), INTERVIEW.replace('## Restatement', Q8.replace('Answer:\n', 'Answer: A.\n')));
  f.git('commit', '-qam', 'answered');
  answered = true;
  const second = await nora(f, { vera, steps: [byDocument({ brief, prd: (o, fx) => {
    put(fx, `${D}/prd.md`, `${PRD_READY}\n`);
    return result();
  } })] });
  assert.equal(second.r.state, 'done', second.r.why);
  assert.equal(second.r.open, undefined, 'nothing left open');
  assert.deepEqual(second.n.calls.map((c) => [indexOf(c).document, indexOf(c).step]), [['brief', 'fix'], ['prd', 'continue']], 'the brief\'s open findings went back to her');
  const results = readVerifyResults(store, 'due-dates-brief');
  assert.deepEqual([results.at(-1).round, results.at(-1).must_fix], [1, 0], 'round 1 of the new cycle');
  assert.notEqual(results.at(-1).cycle, results[0].cycle);
});

test('41 T5: a pause her interview doesn\'t show is no pause: the run ends failed', async () => {
  const f = fixture();
  const { r } = await nora(f, { steps: [() => result({ outcome: 'paused', question: 'Q-9' })] });
  assert.equal(r.state, 'failed');
  assert.match(r.why, /she says she paused on Q-9, but interview\.md isn't paused/);
});

// ---- T6 Template gaps ---------------------------------------------------------------------------

test('41 T6: a gap she reports is one template_gap line; mirai show lists it; the template is unchanged', async () => {
  const f = fixture();
  const template = read('templates/prd.md');
  const gap = { type: 'prd', what: 'The legal review the launch needs', where: 'Assumptions (A-3)' };
  const { r } = await nora(f, { steps: [byDocument({ brief: writes('brief'), prd: (o, fx) => ({ ...writes('prd')(o, fx), template_gaps: [gap] }) })] });
  assert.equal(r.state, 'done', r.why);
  const gaps = readJournal(f.store).events.filter((e) => e.type === 'template_gap');
  assert.deepEqual(gaps.map((e) => [e.by, e.item, e.template, e.section, e.message]), [['script', 'due-dates', 'prd', 'Assumptions (A-3)', 'The legal review the launch needs']]);
  assert.equal(noraLines(f).at(-1).template_gaps, 1);
  const shown = await tty(['show', 'due-dates'], f.io);
  assert.match(shown.out, /template gaps: 1 \(the templates are unchanged; each went into an existing section\)\n {4}prd: The legal review the launch needs \(put in Assumptions \(A-3\)\)/);
  assert.equal(read('templates/prd.md'), template);
});

// ---- T7 Telling you ------------------------------------------------------------------------------

test('41 T7: mirai show <initiative> shows running, paused with her question, and done; mirai write ends with the same lines, then each document\'s path', async () => {
  const f = fixture();
  // While she runs (from inside her fake launch).
  let during = null;
  const steps = [byDocument({
    brief: (o, fx) => {
      put(fx, `${D}/brief.md`, BRIEF_READY);
      return result();
    },
    prd: (o, fx) => {
      put(fx, `${D}/prd.md`, PRD_READY);
      put(fx, `${D}/interview.md`, INTERVIEW.replace('state: confirmed', 'state: paused').replace('## Restatement', Q8));
      return result({ outcome: 'paused', question: 'Q-8' });
    },
  })];
  const n = fakeNora(f, steps);
  const first = n.launch;
  n.launch = async (o) => {
    during ??= (await tty(['show', 'due-dates'], f.io)).out;
    return first(o);
  };
  installHooks({ store: openStore(f.io), env: f.env, node: process.execPath, launcher: join(REGISTRY_DIR, '..', 'bin', 'launch.js') });
  const cmd = createWriteCommand({ launch: n.launch, verifyLaunch: fakeVera().launch, readerLaunch: fakeReader().launch, readerClaude: FAKE_CLAUDE });
  let out = '';
  const io = { cwd: f.root, env: f.env, stdin: { isTTY: true }, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: () => {} } };
  const code = await cmd.run({ positionals: ['due-dates'], values: {} }, io);
  assert.match(during, /Nora \(mirai-product-manager\): running \(run r-/);
  assert.equal(code, EXIT.NEEDS_HUMAN, out);
  // Her name in full the first time each output names her (38b), then the persona.
  const pausedLine = 'paused on the PRD, waiting for your answer to Q-8 in interview.md: Q-8: Comments by guests — May guests comment on a task?';
  assert.ok(out.includes(`\nNora: ${pausedLine}`), out);
  // (Her launch's progress line names her in full first; this fake launcher prints none.)
  assert.match(out, /^Nora: write the brief \(round 1\): handed over$/m);
  assert.match(out, /next: answer the question in your session/);
  const real = openStore(f.io).checkout;
  assert.ok(out.includes(join(real, D, 'prd.md')), 'the PRD\'s full path');
  const shown = await tty(['show', 'due-dates'], f.io);
  assert.ok(shown.out.includes(`  Nora (mirai-product-manager): ${pausedLine}`), shown.out);
  // Done: the same, from the journal.
  const events = [...readJournal(f.store).events, { type: 'nora_run', item: 'due-dates', run_id: 'r-20261123-120000-abcd', state: 'done', rounds: { lint: 0, verify: 2, reader: 1 }, launches: 2, template_gaps: 0, tier: 'deep', model: 'claude-opus-5-5' }];
  assert.match(noraStateLines(events, 'due-dates')[0], /^Nora \(mirai-product-manager\): done: the brief and the PRD are ready for your approval \(run r-20261123-120000-abcd; rounds: lint 0, Vera \(mirai-verifier\) 2, reader test 1; 2 launches; deep, claude-opus-5-5\)$/);
  // A run that started and never wrote its end, with no run going: said so.
  const lost = noraStateLines([{ type: 'nora_run', item: 'x', run_id: 'r-20261123-120000-abcd', state: 'running', ts: '2026-11-23T12:00:00Z' }], 'x', { runState: { state: 'finished', run_id: 'r-other' } });
  assert.match(lost[0], /stopped without its record/);
});

// ---- T8 The docs check and the session list -----------------------------------------------------

test('41 T8: /mirai write and /mirai requirements are on the session list; the docs name Nora, her role and the steps', () => {
  assert.deepEqual([COMMANDS.write.tty, COMMANDS.write.run, COMMANDS.write.argv({ initiative: 'due-dates' })], [true, true, ['write', 'due-dates']]);
  assert.deepEqual(checkCommand({ command: 'write', initiative: 'due-dates' }).args, { command: 'write', initiative: 'due-dates' });
  assert.ok(checkCommand({ command: 'write' }).refused);
  assert.deepEqual(COMMANDS.requirements.argv({ initiative: 'due-dates' }), ['requirements', 'due-dates']);
  const docs = (rel) => readFileSync(join(REGISTRY_DIR, '..', 'docs', rel), 'utf8');
  assert.match(docs('agents.md'), /\| Nora \| `mirai-product-manager` \| `product-manager` \|/);
  assert.match(docs('documents.md'), /## From request to approval/);
  for (const t of ['`requirements`', '`business-change`']) assert.ok(docs('documents.md').includes(`| ${t} |`), t);
});

// ---- T9 Your own requirements list ---------------------------------------------------------------

const REQS = requirementsText({ initiative: 'due-dates', created: '2026-11-23', source: 'pasted in the interview, 2026-11-23', lines: ['A lead can set a due date on a task.', 'Reminders by text message.', 'Assignees get one email when a day ends, 1 day before.'] });
const PRD_REQ = PRD_READY
  .replace('can set, change or remove its due date. (BR-1)', 'can set, change or remove its due date. (BR-1) (REQ-1)')
  .replace('listing their tasks due next day that aren\'t done. (BR-2)', 'listing their tasks due next day that aren\'t done. (BR-2) (REQ-3)')
  .replace('- Reminders by text message: the app holds no phone numbers (NG-2).', '- Reminders by text message: the app holds no phone numbers (NG-2) (REQ-2).');

test('41 T9: a pasted list becomes requirements.md with REQ-1…REQ-n; the PRD\'s lint fails an REQ-n the list doesn\'t define, and one no requirement carries', async () => {
  assert.deepEqual(requirementLines('- first line\n\n2. second line\n# heading\n* [ ] third'), ['first line', 'second line', 'third']);
  const f = fixture({ files: { [`${D}/requirements.md`]: '- A lead can set a due date on a task.\n- Reminders by text message.\n- Assignees get one email when a day ends, 1 day before.\n' } });
  const r = await tty(['requirements', 'due-dates'], f.io);
  assert.equal(r.code, EXIT.OK, r.out + r.err);
  assert.match(r.out, /^numbered: 3 requirements, REQ-1 to REQ-3$/m);
  const text = readFileSync(join(f.root, D, 'requirements.md'), 'utf8');
  assert.match(text, /^- REQ-1: A lead can set a due date on a task\.\n- REQ-2: Reminders by text message\.\n- REQ-3: Assignees get one email when a day ends, 1 day before\.$/m);
  assert.match(text, /^source: "pasted in the interview, \d{4}-\d{2}-\d{2}"$/m);
  // The PRD against it.
  const lint = (prd) => lintText(prd, { source: 'prd.md', registry: REGISTRY, linked: { 'brief.md': BRIEF_READY, 'requirements.md': REQS } }).filter((p) => p.severity === 'error');
  assert.deepEqual(lint(PRD_REQ), [], 'every line carried, or left out with its reason');
  const undefinedId = lint(PRD_REQ.replace('(REQ-3)', '(REQ-9)'));
  assert.ok(undefinedId.some((p) => p.code === 'prd-requirement-undefined' && /REQ-9 isn't a line of requirements\.md/.test(p.reason)), JSON.stringify(undefinedId));
  assert.ok(undefinedId.some((p) => p.code === 'prd-requirement-uncovered' && /REQ-3 of requirements\.md/.test(p.reason)));
  const dropped = lint(PRD_REQ.replace(' (REQ-2).', '.'));
  assert.ok(dropped.some((p) => p.code === 'prd-requirement-uncovered' && /REQ-2/.test(p.reason)), JSON.stringify(dropped));
});

test('41 T9: Vera gets the list as her fourth input; a line lost or changed is a must-fix whatever her grade; a line left out under "Not in this" with its reason is no finding', () => {
  const f = fixture({ files: { [`${D}/brief.md`]: BRIEF_READY, [`${D}/prd.md`]: PRD_REQ, [`${D}/requirements.md`]: REQS } });
  const s = verifySubject({ cwd: f.root, env: f.env, file: `${D}/prd.md` });
  const { inputs, files } = verifyInputs(s);
  assert.equal(inputs['upstream-requirements.md'], REQS);
  assert.match(JSON.parse(inputs['index.json']).files.find((x) => x.name === 'upstream-requirements.md').why, /every REQ-n is carried/);
  const finding = (o) => ({ id: 'V-1', grade: 'suggestion', layer: 'checklist', kind: 'writing', kind_reason: 'The list gives it.', decision_type: 'none', what: 'x.', fix: 'y.', ...o });
  // REQ-3's "1 day before" became "when a day ends": changed.
  const changed = finding({ where: { file: 'document.md', line: 72, quote: 'the system must email each assignee once' }, against: { file: 'upstream-requirements.md', line: 13, quote: 'REQ-3: Assignees get one email when a day ends, 1 day before.' } });
  // A line missing from the PRD: quoted at the top of the document.
  const missing = finding({ id: 'V-2', where: { file: 'document.md', line: 13, quote: 'Brief: [Tasks with due dates' }, against: { file: 'upstream-requirements.md', line: 11, quote: 'REQ-1: A lead can set a due date on a task.' } });
  // REQ-2 is left out on purpose, with its reason.
  const left = finding({ id: 'V-3', grade: 'must-fix', where: { file: 'document.md', line: 45, quote: 'Reminders by text message' }, against: { file: 'upstream-requirements.md', line: 12, quote: 'REQ-2: Reminders by text message.' } });
  const got = findingsFrom({ findings: [changed, missing, left] }, files);
  assert.deepEqual(got.findings.map((x) => [x.id, x.grade, x.layer, x.graded_by]), [['V-1', 'must-fix', 'checklist', 'a line of the owner\'s requirements list'], ['V-2', 'must-fix', 'checklist', 'a line of the owner\'s requirements list']]);
  assert.deepEqual(got.dropped.map((x) => [x.id, x.why]), [['V-3', 'REQ-2 is left out on purpose under "Not in this", with a reason']]);
});
