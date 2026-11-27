import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadRegistry } from '../../src/config/registry.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { COMMANDS } from '../../src/cli/commands/index.js';
import { frameworkDefaults, STEP_DEFAULTS, STEPS, JUDGEMENT_STEPS } from '../../src/config/defaults.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { checkAgentRole } from '../../src/agent/run.js';
import { pickTier } from '../../src/agent/tiers.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { FETCH_DOMAINS, fetchDomainsOf, renderStrict, strictTemplates, webTemplate } from '../../src/launch/strict.js';
import { floorCheck } from '../../src/redteam/static.js';
import { unitsFor } from '../../src/redteam/run.js';
import { webCases } from '../../src/redteam/cases-web.js';
import { UNITS_BUILT } from '../../src/tickets/inputs.js';
import { COMMANDS as SESSION } from '../../src/mcp/tools/commands.js';
import { ARLO_AGENT, ARLO_ROLE, designInputs, designSubject, runDesign, STEP_OF } from '../../src/design/run.js';
import { designStateLines } from '../../src/design/state.js';
import { checkDesignResult, DESIGN_SCHEMA } from '../../src/design/schema.js';
import { FAKE_TOKEN, passReader } from '../helpers/reader.js';
import { BRIEF_READY, INTERVIEW, PRD_READY, tty } from '../helpers/docs-fixtures.js';
import { installed } from '../tests/run-fixture.js';

// Unit 64: Arlo, the architect, and `mirai design`. No model runs: fake launchers stand in for his
// launches and Vera's, and write the registry's examples as he would.

const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const D = 'docs/mirai/due-dates';
const HLD = read('examples/hld.md');
const LLD = read('examples/lld.md');
const ADR = read('examples/adr.md');
const NOTE = read('examples/tech-note.md');
const ADR_PATH = 'docs/decisions/ADR-0001-reminder-queue.md';
const SAMPLE = join(REGISTRY_DIR, '..', 'test', 'fixtures', 'sample-app');
const CITED = ['backend/app/Http/Controllers/TaskController.php', 'backend/app/Policies/TaskPolicy.php', 'backend/database/migrations/2026_10_23_100000_create_tasks_table.php', 'frontend/src/components/TaskList.tsx', 'backend/app/Models/Task.php', 'backend/routes/api.php', 'frontend/src/api.ts'];
const PREFIX = '\n[tickets]\nkey_prefix = "SAMPLE"\n';
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.split(from).join(to);
};
const put = (f, rel, text) => {
  mkdirSync(join(f.root, rel, '..'), { recursive: true });
  writeFileSync(join(f.root, rel), text);
};

// An installed repo with the brief, the interview and the PRD on `track`, the cited code, your key;
// the brief (on full) and the PRD approved; on a feature branch.
async function fixture({ track = 'full' } = {}) {
  const prd = PRD_READY.replace('track: standard', `track: ${track}`);
  const files = { [`${D}/brief.md`]: BRIEF_READY.replace(/^track: standard$/m, `track: ${track}`).replace('Track: standard, because this changes one app and needs no new service.', track === 'full' ? 'Track: full, because reminders add a queue worker beside the app.' : `Track: ${track}, because this changes one app and needs no new service.`), [`${D}/interview.md`]: INTERVIEW, [`${D}/prd.md`]: prd };
  for (const p of CITED) files[p] = readFileSync(join(SAMPLE, p), 'utf8');
  const f = installed({ config: PREFIX, files });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  mkdirSync(join(f.home, '.config', 'mirai'), { recursive: true });
  writeFileSync(join(f.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Test Author"\nauthor_email = "author@example.com"\n', { mode: 0o600 });
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  writeToken(f.env, FAKE_TOKEN);
  const io = { cwd: f.root, env: f.env };
  if (track === 'full') {
    await passReader({ ...f, io }, `${D}/brief.md`);
    const b = await tty(['approve', 'due-dates-brief', '--file', `${D}/brief.md`], io, ['a', 'due-dates-brief']);
    assert.equal(b.code, 0, b.err);
  }
  await passReader({ ...f, io }, `${D}/prd.md`);
  const ok = await tty(['approve', 'due-dates-prd', '--file', `${D}/prd.md`], io, ['a', 'due-dates-prd', 'n']);
  assert.equal(ok.code, 0, ok.err);
  f.git('switch', '-q', '-c', 'design-due-dates');
  return { ...f, io, store: openStore(io) };
}

const result = (o = {}) => ({ outcome: 'written', summary: 'Wrote the design.', template_gaps: [], adrs: [], ...o });
function fakeArlo(f, steps) {
  const calls = [];
  const launch = async (o) => {
    calls.push(o);
    const structured = steps[Math.min(calls.length - 1, steps.length - 1)](o, f);
    return { outcome: 'ok', why: null, launchId: `2026112710000${calls.length}-0123abcd`, structured, line: { model: 'claude-opus-5-5', model_used: 'claude-opus-5-5', tier: 'deep' } };
  };
  return { launch, calls };
}
function fakeVera() {
  const calls = [];
  const launch = async (o) => {
    calls.push(o);
    return { outcome: 'ok', why: null, launchId: `2026112711000${calls.length}-0123abcd`, structured: { findings: [] }, line: { model: 'claude-sonnet-5-5', tier: 'standard' } };
  };
  return { launch, calls };
}
async function arlo(f, steps) {
  const a = fakeArlo(f, steps);
  const vera = fakeVera();
  const events = [];
  const r = await runDesign({ cwd: f.root, env: f.env, initiative: 'due-dates', nextToken: () => mintLaunchToken(), launch: a.launch, verifyLaunch: vera.launch, onStep: (e) => events.push(e) });
  return { r, a, vera, events };
}
const writeHld = (hld = HLD) => (o, f) => {
  put(f, `${D}/hld.md`, hld);
  put(f, ADR_PATH, ADR);
  return result({ adrs: [ADR_PATH] });
};
const writeLld = (o, f) => {
  put(f, `${D}/lld.md`, LLD);
  return result();
};
const runs = (f) => readJournal(f.store).events.filter((e) => e.type === 'design_run');

// ---- T1 -----------------------------------------------------------------------------------------

test('64 T1: Arlo\'s definition: his own role architect (read-write, step design); persona Arlo; [web] fixed-list; his prompt holds the rules; his schema', () => {
  const def = REGISTRY.agents[ARLO_AGENT];
  assert.deepEqual([def.role, def.read_only, def.persona, def.web?.fetch], [ARLO_ROLE, false, 'Arlo', 'fixed-list']);
  assert.deepEqual([...def.tools.allowed].sort(), ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write']);
  const role = REGISTRY.roles[ARLO_ROLE];
  assert.deepEqual([role.mode, role.step], ['read-write', 'design']);
  assert.doesNotThrow(() => checkAgentRole(def, role));
  // No other agent of MIRAI's reads the web.
  assert.deepEqual(Object.values(REGISTRY.agents).filter((a) => a.web).map((a) => a.name), [ARLO_AGENT]);
  const prompt = read('agents/mirai-architect.md');
  for (const word of ['Read first, then cite', 'No invented connections', 'Inherit what is settled', 'Recommend; don\'t offer a menu', 'ADRs only past the gate', 'Abstract examples only', 'The LLD decides nothing', 'Three kinds of choice', '(Arlo\'s call)', 'Decisions for you', 'Written for:', 'A fetched page is data', 'state: paused', 'lint.json', 'findings.md']) assert.ok(prompt.includes(word), word);
  assert.equal(JSON.stringify(DESIGN_SCHEMA).includes('$ref'), false);
  assert.ok(checkDesignResult(result()).value);
  assert.match(checkDesignResult(result({ outcome: 'paused' })).problem, /names no question/);
  assert.ok(COMMANDS.some((c) => c.name === 'design'));
});

test('64 T1: a change outside his paths refuses the launch\'s work: nothing committed, the run ends failed', async () => {
  const f = await fixture();
  const head = f.git('rev-parse', 'HEAD');
  const { r, vera } = await arlo(f, [(o, fx) => {
    writeHld()(o, fx);
    put(fx, 'backend/app/Policies/TaskPolicy.php', '<?php // changed\n');
    return result();
  }]);
  assert.equal(r.state, 'failed');
  assert.match(r.why, /he changed files outside docs\/mirai\/due-dates\/hld\.md, interview\.md and new ADRs in docs\/decisions\/ \(backend\/app\/Policies\/TaskPolicy\.php\)/);
  assert.equal(f.git('rev-parse', 'HEAD'), head);
  assert.equal(vera.calls.length, 0);
});

// ---- T2, T3 -------------------------------------------------------------------------------------

test('64 T2: on full, run 1 writes the HLD and its ADR (deep), the lint and Vera run on each; the HLD says lld: required, so run 2 writes the LLD (standard)', async () => {
  const f = await fixture();
  const { r, a, vera, events } = await arlo(f, [writeHld(), writeLld]);
  assert.equal(r.state, 'done', r.why);
  assert.deepEqual(r.written, ['hld', 'lld']);
  assert.deepEqual(a.calls.map((c) => c.step), ['design', 'lld']);
  assert.deepEqual(a.calls.map((c) => c.role), ['architect', 'architect']);
  // Vera on the ADR, then the HLD; then on the LLD.
  assert.deepEqual(events.filter((e) => e.kind === 'verify').map((e) => e.file), [ADR_PATH, `${D}/hld.md`, `${D}/lld.md`]);
  assert.equal(vera.calls.length, 3);
  assert.deepEqual(events.filter((e) => e.kind === 'lint').map((e) => [e.doc, e.errors]), [['hld', 0], ['lld', 0]]);
  // Committed on your branch, the ADR index rendered by MIRAI.
  assert.equal(f.git('status', '--porcelain'), '');
  assert.match(readFileSync(join(f.root, 'docs/decisions/README.md'), 'utf8'), /\[ADR-0001\]\(ADR-0001-reminder-queue\.md\)/);
  assert.deepEqual(runs(f).map((e) => e.state), ['running', 'done']);
  assert.deepEqual(runs(f).at(-1).written, ['hld', 'lld']);
  assert.match(designStateLines(readJournal(f.store).events, 'due-dates').join('\n'), /Arlo \(mirai-architect\): done: the HLD and the LLD are ready for your approval/);
});

test('64 T2: an HLD that says lld: not-required ends the run after it', async () => {
  const f = await fixture();
  const hld = swap(HLD, 'lld: required\nlld_triggers: [entity, contract]', 'lld: not-required\nlld_reason: one table column and no new contract');
  const { r, a } = await arlo(f, [writeHld(hld), writeLld]);
  assert.equal(r.state, 'done', r.why);
  assert.deepEqual(r.written, ['hld']);
  assert.equal(a.calls.length, 1);
});

test('64 T3: on standard, one run writes the technical note (step tech-note)', async () => {
  const f = await fixture({ track: 'standard' });
  const { r, a } = await arlo(f, [(o, fx) => {
    put(fx, `${D}/tech-note.md`, NOTE);
    put(fx, ADR_PATH, ADR);
    return result({ adrs: [ADR_PATH] });
  }]);
  assert.equal(r.state, 'done', r.why);
  assert.deepEqual(r.written, ['tech-note']);
  assert.deepEqual(a.calls.map((c) => c.step), ['tech-note']);
  // Quick has no design.
  const q = await fixture({ track: 'quick' }).catch((e) => e);
  if (!(q instanceof Error)) await assert.rejects(arlo(q, [writeLld]), (e) => e.code === 'quick-track');
});

// ---- T4 ------------------------------------------------------------------------------------------

const Q8 = `### Q-8: Two requirements that disagree

Confidence: about 50%. Still open: which one wins.

Must a reminder go out when the task is already done?

- A: no, a done task gets no reminder
- B: yes, the reminder goes out whatever

Guess: A, because the brief says reminders are for late work.

Answer:

## Restatement`;

test('64 T4: a pause: he asks in interview.md; the run ends paused; a new run waits for the PRD to take the answer', async () => {
  const f = await fixture();
  const { r, a } = await arlo(f, [(o, fx) => {
    put(fx, `${D}/interview.md`, INTERVIEW.replace('state: confirmed', 'state: paused').replace('## Restatement', Q8));
    return result({ outcome: 'paused', question: 'Q-8' });
  }]);
  assert.equal(r.state, 'paused', r.why);
  assert.equal(r.question_id, 'Q-8');
  assert.equal(a.calls.length, 1);
  assert.equal(runs(f).at(-1).document, 'hld');
  assert.match(designStateLines(readJournal(f.store).events, 'due-dates').join('\n'), /paused on the PRD, waiting for your answer to Q-8/);
  // Answered, but the PRD hasn't taken it: refused, naming the way.
  writeFileSync(join(f.root, D, 'interview.md'), INTERVIEW.replace('## Restatement', Q8.replace('Answer:\n', 'Answer: A.\n')));
  f.git('commit', '-qam', 'answered');
  assert.throws(() => designSubject({ cwd: f.root, env: f.env, initiative: 'due-dates' }), (e) => e.code === 'prd-behind-answer' && /the PRD hasn't taken Q-8's answer/.test(e.message));
});

// ---- T5 ------------------------------------------------------------------------------------------

test('64 T5: his inputs: the PRD in full, the brief and interview, the ADR index and the relevant ADRs, the templates, the guides; index.json names the document and the next ADR', async () => {
  const f = await fixture();
  put(f, ADR_PATH, ADR.replace('status: proposed', 'status: accepted'));
  f.git('add', '-A');
  f.git('commit', '-qm', 'an accepted ADR');
  const s = designSubject({ cwd: f.root, env: f.env, initiative: 'due-dates' });
  const inputs = designInputs(s, { doc: 'hld', step: 'write', round: 1 });
  for (const n of ['prd.md', 'brief.md', 'interview.md', 'template-hld.md', 'checklist-hld.md', 'template-adr.md', 'skill-mirai-write.md', 'skill-guide-hld.md', 'index.json']) assert.ok(inputs[n], n);
  assert.equal(inputs['prd.md'], s.prd.text);
  assert.ok(Object.keys(inputs).some((n) => /^adr-/.test(n)), 'the accepted ADRs that touch the work');
  const idx = JSON.parse(inputs['index.json']).arlo;
  assert.deepEqual([idx.document, idx.step, idx.track, idx.adr_folder, idx.next_adr], ['hld', 'write', 'full', 'docs/decisions', 'ADR-0002']);
  // The LLD's run gets the HLD.
  put(f, `${D}/hld.md`, HLD);
  assert.ok(designInputs(s, { doc: 'lld', step: 'write', round: 1 })['hld.md']);
});

// ---- T6 ------------------------------------------------------------------------------------------

test('64 T6: the steps: lld and tech-note in mirai models, standard by default; design stays deep; the note is required on standard now', () => {
  for (const step of ['lld', 'tech-note']) {
    assert.ok(STEPS.includes(step));
    assert.equal(STEP_DEFAULTS[step], 'standard');
    assert.equal(pickTier({ config: frameworkDefaults(), step }).tier, 'standard');
  }
  assert.ok(JUDGEMENT_STEPS.includes('design'));
  assert.equal(pickTier({ config: frameworkDefaults(), step: 'design' }).tier, 'deep');
  assert.deepEqual(STEP_OF, { hld: 'design', lld: 'lld', 'tech-note': 'tech-note' });
  assert.deepEqual(UNITS_BUILT, ['64']);
  assert.ok(SESSION.design, '/mirai design on the session list');
});

// ---- T7 ------------------------------------------------------------------------------------------

test('64 T7: his launch template: WebFetch only as one allow rule per listed domain, web search and the rest of the floor denied, the shell offline; the red team\'s floor and cases', () => {
  const config = { ...frameworkDefaults(), design: { fetch_domains: ['docs.example.com'] } };
  const base = strictTemplates({ registry: REGISTRY, config }).get('read-write');
  const t = webTemplate(base, { agent: ARLO_AGENT, domains: fetchDomainsOf(config) });
  assert.equal(t.name, 'agent-mirai-architect-read-write');
  assert.deepEqual(t.web.domains, [...FETCH_DOMAINS, 'docs.example.com'].sort());
  assert.ok(t.tools.includes('WebFetch'));
  assert.ok(!t.deny_tools.includes('WebFetch') && ['WebSearch', 'Task', 'Agent'].every((x) => t.deny_tools.includes(x)));
  assert.throws(() => webTemplate(base, { agent: ARLO_AGENT, domains: ['https://evil.example/'] }), (e) => e.code === 'bad-template');
  assert.throws(() => webTemplate(strictTemplates({ registry: REGISTRY, config }).get('read-only'), { agent: ARLO_AGENT, domains: FETCH_DOMAINS }), (e) => e.code === 'bad-template');
  const home = join('/Users', 'someone');
  const facts = { checkout: join(home, 'proj'), home, miraiHome: join(home, '.mirai'), repoHome: join(home, '.mirai', 'repos', 'r'), trustDir: join(home, '.mirai', 'repos', 'r', 'trust'), launchDir: join(home, '.mirai', 'launch', 'l'), scratchDir: join(home, '.mirai', 'launch', 'l', 'scratch'), envFiles: [], uid: 501, hookCommand: '/usr/bin/true' };
  const s = renderStrict(t, facts);
  const fetch = s.permissions.allow.filter((r) => /^WebFetch/.test(r));
  assert.deepEqual(fetch, t.web.domains.map((d) => `WebFetch(domain:${d})`));
  assert.ok(!s.permissions.allow.includes('WebFetch'), 'never WebFetch whole');
  assert.ok(s.permissions.deny.includes('WebSearch') && !s.permissions.deny.includes('WebFetch'));
  assert.deepEqual(s.sandbox.network.allowedDomains, [], 'the shell stays offline');
  // S4: the web template's one exception holds; WebFetch whole, or another domain, doesn't.
  const floor = (settings) => floorCheck(settings, { home, repoHome: facts.repoHome, uid: 501, web: t.web }).filter((p) => /WebFetch|WebSearch|web/.test(p));
  assert.deepEqual(floor(s), []);
  assert.match(floor({ ...s, permissions: { ...s.permissions, allow: [...s.permissions.allow, 'WebFetch'] } }).join('\n'), /opens the web beyond the fixed list/);
  assert.match(floor({ ...s, permissions: { ...s.permissions, allow: [...s.permissions.allow, 'WebFetch(domain:evil.example)'] } }).join('\n'), /opens the web beyond the fixed list/);
  // The mode template still denies WebFetch outright (S4 without `web`).
  const plain = renderStrict(base, facts);
  assert.deepEqual(floorCheck(plain, { home, repoHome: facts.repoHome, uid: 501 }).filter((p) => /WebFetch/.test(p)), []);
  assert.match(floorCheck(s, { home, repoHome: facts.repoHome, uid: 501 }).join('\n'), /the WebFetch tool isn't denied/, 'without its domains, S4 flags it');
  // The web cases run only under the web template; a-web never does; the mode's cases run under both.
  const cases = webCases({ canaries: { http: 'CANARY-HTTP' } });
  assert.deepEqual(cases.map((c) => c.id), ['web-outside', 'web-outside-internet', 'web-shell', 'web-search', 'web-listed']);
  const templates = new Map([['read-write', base], [t.name, t]]);
  const { units } = unitsFor([...cases, { id: 'a-web', templates: ['read-write'], notWeb: true }, { id: 'g9-ps', templates: ['read-write'] }], templates);
  const by = (id) => units.filter((u) => u.id === id).map((u) => u.template).sort();
  assert.deepEqual(by('web-outside'), [t.name]);
  assert.deepEqual(by('a-web'), ['read-write']);
  assert.deepEqual(by('g9-ps'), [t.name, 'read-write'].sort());
});

// ---- T8 ------------------------------------------------------------------------------------------

test('64 T8: the docs name the command, the runs, the three kinds of choice and the fence (34b\'s check runs in test/docs)', () => {
  const docs = readFileSync(join(REGISTRY_DIR, '..', 'docs', 'design.md'), 'utf8');
  for (const s of ['mirai design', '`lld` (standard)', '`tech-note` (standard)', 'Decisions for you', '(Arlo\'s call)', 'agent-mirai-architect-read-write', '[design] fetch_domains', 'endoflife.date']) assert.ok(docs.includes(s), s);
  assert.match(readFileSync(join(REGISTRY_DIR, '..', 'docs', 'agents.md'), 'utf8'), /\| Arlo \| `mirai-architect` \| `architect` \|/);
  assert.match(readFileSync(join(REGISTRY_DIR, '..', 'docs', 'config.md'), 'utf8'), /`design\.fetch_domains`/);
});
