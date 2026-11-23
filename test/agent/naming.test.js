import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { agentNamer, fullName, personaOf } from '../../src/agent/names.js';
import { fullNameIn } from '../../src/agent/persona.js';
import { checkReviewAgent } from '../../src/agent/run.js';
import { findRole } from '../../src/agent/scope.js';
import { BUILD_ROLE } from '../../src/agent/build.js';
import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { loadCustomRoles, loadRegistry, RENAMED_ROLES } from '../../src/config/registry.js';
import { overlayHash, readOverlays } from '../../src/config/overlays.js';
import { renderRunReport } from '../../src/reports/render.js';
import { hostWords, longRef, shortRef, wordsFor, wordsOfHost } from '../../src/ship/words.js';
import { buildRunLine } from '../../src/store/run-log.js';
import { tempDir } from '../tests/run-fixture.js';
import { mkdirSync, writeFileSync } from 'node:fs';

// Unit 38b: naming. The role `author` is `developer`; an agent is "persona (id)" the first time a
// command names it, then its persona; output uses the host's word for a merge request.

const REGISTRY = loadRegistry(REGISTRY_DIR);
const files = (obj) => new Map(Object.entries(obj).map(([k, v]) => [k, Buffer.from(v)]));
const RENAMED = /the role "author" is now "developer" \(MIRAI 38b\): write role = "developer"/;

test('38b T1: the registry has the role developer and no author; Kai runs under it; the build step names it', () => {
  assert.ok(REGISTRY.roles.developer, 'developer is a role');
  assert.equal(Object.hasOwn(REGISTRY.roles, 'author'), false, 'author is gone');
  const dev = REGISTRY.roles.developer;
  assert.deepEqual([dev.mode, dev.step, dev.may_write.paths], ['read-write', 'build', ['**']], 'only the name changed');
  assert.equal(REGISTRY.agents['mirai-developer'].role, 'developer');
  assert.equal(BUILD_ROLE, 'developer');
  assert.equal(findRole(REGISTRY.roles, 'developer'), dev);
  assert.deepEqual(RENAMED_ROLES, { author: 'developer' });
});

test('38b T2: the old name is refused, never mapped: an agent overlay, a launch\'s role, a project role named author', () => {
  // An agent overlay with role = "author".
  const [o] = readOverlays(files({ 'agents/mirai-developer.toml': 'kind = "agent-overlay"\nschema_version = 1\nname = "mirai-developer"\nrole = "author"\n' }), REGISTRY);
  assert.match(o.problems.join('\n'), RENAMED);
  assert.ok(!o.result, 'not applied');
  // `mirai agent run --role author` and the broker's start_agent both find the role with findRole.
  assert.throws(() => findRole(REGISTRY.roles, 'author'), (e) => e.code === 'renamed-role' && RENAMED.test(e.message));
  // Even where an old copy still has it: the name is refused before it is looked up.
  assert.throws(() => findRole({ author: REGISTRY.roles.developer }, 'author'), (e) => e.code === 'renamed-role');
  // A project role can't take the old name.
  const dir = tempDir('custom');
  mkdirSync(join(dir, 'roles'), { recursive: true });
  writeFileSync(join(dir, 'roles', 'author.toml'), 'kind = "role"\nschema_version = 1\nname = "author"\ndescription = "x"\nmode = "read-write"\nstep = "build"\n\n[may_write]\npaths = ["docs/**"]\n');
  assert.throws(() => loadCustomRoles(dir, REGISTRY.roles), (e) => e.errors?.some((p) => p.code === 'renamed-role' && RENAMED.test(p.reason)));
});

test('38b T2: mirai agent run --role author is refused with the new name, before anything launches', async () => {
  const { main } = await import('../../src/cli/main.js');
  const { installed } = await import('../tests/run-fixture.js');
  const f = installed();
  writeFileSync(join(f.root, 'p.txt'), 'x\n');
  let err = '';
  const code = await main(['agent', 'run', '--role', 'author', '--prompt-file', 'p.txt'], { stdin: { isTTY: true }, stdout: { isTTY: true, write: () => {} }, stderr: { write: (s) => (err += s) }, env: f.env, cwd: f.root });
  assert.notEqual(code, 0);
  assert.match(err, RENAMED);
});

test('38b T3: a framework copy from before 38b (author and no developer) is told to refresh', () => {
  const old = { ...REGISTRY.roles };
  old.author = { ...old.developer, name: 'author' };
  delete old.developer;
  assert.throws(() => findRole(old, BUILD_ROLE), (e) => e.code === 'old-framework-copy' && /this project's MIRAI copy is from before unit 38b \(it has the role "author", now "developer"\): run mirai init --refresh, and commit it/.test(e.message));
  // A copy with neither is just an unknown role.
  const none = { ...REGISTRY.roles };
  delete none.developer;
  assert.throws(() => findRole(none, BUILD_ROLE), (e) => e.code === 'unknown-role');
  // An old copy's agents have no persona: the refusals name them by id.
  assert.equal(fullNameIn({ agents: { 'mirai-developer': { role: 'author' } } }, 'mirai-developer'), 'mirai-developer');
});

test('38b T4: old records still read: an agent_run line with role "author" validates, and the report still says Kai\'s build', () => {
  assert.doesNotThrow(() => buildRunLine('r-20261101-010203-abc1', 1, { item: 'PMT-31', event: 'agent_run', launch_id: 'l-1', agent: 'mirai-developer', role: 'author', step: 'build', round: 1, tier: 'standard', model: 'claude-sonnet-5-5', tokens_in: 1, tokens_out: 1, verdict: 'pass', turns: 3, minutes: 1, limit_share_source: 'unknown' }));
  const data = runData([{ kind: 'launch', earlier: true, text: 'Kai\'s plan', agent: 'mirai-developer', step: 'plan', turns: 1, tokens: 1, minutes: 1 }, { kind: 'launch', earlier: false, text: 'Kai\'s build', agent: 'mirai-developer', step: 'build', turns: 1, tokens: 1, minutes: 1 }]);
  const md = renderRunReport(data);
  assert.match(md, /^- Kai \(`mirai-developer`\)'s plan: /m, 'the first mention in full, the id in backticks');
  assert.match(md, /^- Kai's build: /m, 'then the persona');
  // A report from before 38b (no agent on its steps) reads as it did.
  const before = renderRunReport(runData([{ kind: 'launch', earlier: false, text: 'Kai\'s build', step: 'build', turns: 1, tokens: 1, minutes: 1 }]));
  assert.match(before, /^- Kai's build: /m);
  const text = renderRunReport(data, { format: 'text' });
  assert.match(text, /- Kai \(mirai-developer\)'s plan: /);
});

test('38b T5: 37\'s approvals hold: Rex\'s approved overlay (the sample app\'s) has the same hash as before the rename', () => {
  const toml = '# Unit 37\'s P2: Rex (the reviewer) gets Bash. A widening: the launch is refused until the red team passes with it.\nkind = "agent-overlay"\nschema_version = 1\nname = "mirai-reviewer"\n\n[tools]\nallowed = ["Read", "Grep", "Glob", "Bash"]\n';
  const [o] = readOverlays(files({ 'agents/mirai-reviewer.toml': toml }), REGISTRY);
  assert.deepEqual(o.problems, []);
  assert.equal(o.result.change, 'widening');
  // Computed on main before 38b (6a56e7a) from the same bytes: the approval line binds this hash.
  assert.equal(overlayHash(o), 'sha256:a0d673c4e06aece3c75bc992077508f6ae958fa61974b113591fff4159645e08');
  assert.equal(o.result.def.persona, 'Rex', 'the persona is MIRAI\'s, carried through');
});

test('38b T6: personas: every agent of MIRAI\'s has one; the namer says it in full once, then short; an id with none is its id; an overlay can\'t set it', () => {
  for (const [id, def] of Object.entries(REGISTRY.agents)) assert.match(def.persona ?? '', /^[A-Z][a-z]+$/, `${id} has a persona`);
  assert.deepEqual([personaOf('mirai-developer'), personaOf('mirai-reviewer'), personaOf('mirai-nobody')], ['Kai', 'Rex', null]);
  const who = agentNamer();
  assert.deepEqual([who('mirai-developer'), who('mirai-developer'), who('mirai-reviewer'), who('mirai-developer'), who('mirai-reviewer')], ['Kai (mirai-developer)', 'Kai', 'Rex (mirai-reviewer)', 'Kai', 'Rex']);
  assert.equal(agentNamer(null, { markdown: true })('mirai-developer'), 'Kai (`mirai-developer`)');
  assert.equal(who('mirai-project-own'), 'mirai-project-own');
  assert.equal(fullName('mirai-reviewer'), 'Rex (mirai-reviewer)');
  // The reviewer refusals: "persona (id)", from the trust root's registry.
  const reviewer = REGISTRY.roles.reviewer;
  assert.throws(() => checkReviewAgent({ agent: 'mirai-developer', role: reviewer, step: 'commit-message', registry: REGISTRY }), (e) => e.code === 'author-reviews' && /^Kai \(mirai-developer\) never runs under the reviewer role: who writes a change never reviews it/.test(e.message));
  assert.throws(() => checkReviewAgent({ agent: 'mirai-developer', role: reviewer, step: 'review', registry: REGISTRY }), (e) => /^only Rex \(mirai-reviewer\) reviews; Kai \(mirai-developer\) can't run the review step/.test(e.message));
  // An overlay that sets one is refused.
  const [o] = readOverlays(files({ 'agents/mirai-reviewer.toml': 'kind = "agent-overlay"\nschema_version = 1\nname = "mirai-reviewer"\npersona = "Max"\n' }), REGISTRY);
  assert.match(o.problems.join('\n'), /persona: an agent's persona is MIRAI's \(Rex\); an overlay can't change it/);
  // The registry refuses a persona that isn't one capitalised word.
  assert.throws(() => loadRegistryWith({ 'agents/mirai-developer.toml': (t) => t.replace('persona = "Kai"', 'persona = "kai the dev"') }), (e) => e.errors?.some((p) => /persona/.test(`${p.path} ${p.reason}`)));
});

test('38b T7: the host\'s word: GitHub says pull request and #16, GitLab merge request and !16; an unknown host keeps merge request', () => {
  const gh = hostWords('github');
  const gl = hostWords('gitlab');
  const none = hostWords(null);
  assert.deepEqual([gh.long, gh.short, gh.ref(16), gh.host], ['pull request', 'PR', '#16', 'github']);
  assert.deepEqual([gl.long, gl.short, gl.ref(16), gl.host], ['merge request', 'MR', '!16', 'gitlab']);
  assert.deepEqual([none.long, none.short, none.ref(16), none.host], ['merge request', 'MR', '!16', null]);
  assert.equal(hostWords('bitbucket').host, null);
  assert.equal(longRef(gh, 16), 'pull request #16');
  assert.equal(longRef(gl, 16), 'merge request !16');
  assert.equal(shortRef(gh, 16), 'PR #16');
  // From the config and the remote, with no CLI.
  assert.equal(wordsFor({ config: {}, remoteUrl: 'git@github.com:acme/app.git' }).host, 'github');
  assert.equal(wordsFor({ config: {}, remoteUrl: 'https://gitlab.com/acme/app.git' }).host, 'gitlab');
  assert.equal(wordsFor({ config: { git: { host: 'gitlab', host_url: 'https://git.example.com' } }, remoteUrl: 'https://git.example.com/a/b.git' }).host, 'gitlab');
  assert.equal(wordsFor({ config: {}, remoteUrl: null }).host, null, 'no remote');
  assert.equal(wordsFor({ config: {}, remoteUrl: 'https://git.example.com/a/b.git' }).host, null, 'a host MIRAI can\'t tell');
  // A host object carries its words; a stand-in without them gets its name's.
  assert.equal(wordsOfHost({ name: 'github' }).long, 'pull request');
  assert.equal(wordsOfHost(null).long, 'merge request');
  // The run report: the data's host's word.
  const steps = [{ kind: 'mr', earlier: false, text: 'PR #7 opened' }];
  const md = renderRunReport({ ...runData(steps), host: 'github', tickets: [{ ...runData(steps).tickets[0], mr: { state: 'open', url: 'https://github.com/acme/app/pull/7' } }] }, { format: 'text' });
  assert.match(md, /- PR open https:\/\/github\.com\/acme\/app\/pull\/7/);
});

// T8: no user-facing string in src/ says "merge request" or "MR" outside the words helper and
// GitLab's own host, and none says Kai or Rex outside the registry. Comments don't count; the
// agents' own prompts (they talk to the agent, not to you) and the lint's acronym list are named.
const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const ALLOWED_WORD_FILES = new Set(['ship/words.js', 'ship/gitlab.js', 'lint/words.js']);
const AGENT_PROMPTS = [/^Rex reviewed your change\. /, /Rex doesn\\'t answer it\.$/];
function jsFiles(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? jsFiles(p) : n.endsWith('.js') ? [p] : [];
  });
}
function strings(line) {
  const out = [];
  const re = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  let m;
  while ((m = re.exec(line))) out.push(m[0].slice(1, -1));
  return out;
}
test('38b T8: no stray word: "merge request" and "MR" only from the helper; no Kai, Rex or Vera in src outside the registry', () => {
  const found = [];
  for (const file of jsFiles(SRC)) {
    const rel = relative(SRC, file);
    readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
      const line = raw.trim();
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) return;
      const code = line.replace(/\s\/\/\s.*$/, '');
      for (const s of strings(code)) {
        if (!ALLOWED_WORD_FILES.has(rel) && /merge request|\bMRs?\b/.test(s)) found.push(`${rel}:${i + 1}: ${s.slice(0, 80)}`);
        // Unit 40: Vera's name comes from the registry too.
        if (/\b(Kai|Rex|Vera)\b/.test(s) && !AGENT_PROMPTS.some((p) => p.test(s))) found.push(`${rel}:${i + 1}: ${s.slice(0, 80)}`);
      }
    });
  }
  assert.deepEqual(found, []);
});

// ---- helpers ----

function runData(steps) {
  return {
    run: { id: 'r-20261122-010203-abc1', date: '2026-11-22', preset: 'supervised', state: 'finished' },
    done: [], parked: [], paused: [], followups: [], usage: [], inbox: [], template_gaps: [], known_failures: [], branch_warnings: [], clean_due: false,
    tickets: [{ ticket: 'PMT-31', title: 'Renaming a team hides its members', state: 'in-review', rounds: { used: 0, of: 3, replans: 0, replans_of: 1 }, steps, feedback: [] }],
    red_team: { state: 'green' },
  };
}

// MIRAI's registry copied, one file changed, loaded.
function loadRegistryWith(changes) {
  const dir = tempDir('registry');
  const copy = (from, to) => {
    for (const n of readdirSync(from)) {
      const s = join(from, n);
      const d = join(to, n);
      if (statSync(s).isDirectory()) {
        mkdirSync(d, { recursive: true });
        copy(s, d);
      } else writeFileSync(d, readFileSync(s));
    }
  };
  copy(REGISTRY_DIR, dir);
  for (const [rel, fn] of Object.entries(changes)) writeFileSync(join(dir, rel), fn(readFileSync(join(dir, rel), 'utf8')));
  return loadRegistry(dir);
}
