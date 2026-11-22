import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { installHooks } from '../../src/hooks/install.js';
import { runAgent } from '../../src/agent/run.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { runTest } from '../../src/tests/run.js';
import { forTemplate } from '../../src/redteam/run.js';
import { readSetup, writeSetup } from '../../src/setup/state.js';
import { CHECKLIST, checklistState } from '../../src/setup/checklist.js';
import { committedNotRendered } from '../../src/setup/pre-commit.js';
import { customCheck } from '../../src/doctor/checks.js';
import { readOverlays } from '../../src/config/overlays.js';
import { loadRegistry } from '../../src/config/registry.js';
import { COMMANDS, checkCommand } from '../../src/mcp/tools/commands.js';
import { MIRAI_COMMAND } from '../../src/adapters/claude-code.js';
import { fakeDocker, installed, resolvedApp, tempDir } from '../tests/run-fixture.js';
import { needsTest } from '../helpers/needs.js';

// Unit 39: the mirai-setup skill's record, the ledger, mirai custom add, the project's own items,
// the pre-commit safety net, the checklist and the context review.

const launchTest = needsTest('macos', 'an agent launch: its scratch folder is macOS\'s /private/tmp (src/launch/strict.js; P01)');
const TOKEN = `sk-ant-oat01-${'Ag3_-k'.repeat(16)}`;
const LAUNCHER = fileURLToPath(new URL('../../bin/mirai.js', import.meta.url));
const INIT = '{"type":"system","subtype":"init","permissionMode":"dontAsk"}';
const RESULT = '{"type":"result","subtype":"success","is_error":false,"result":"done","num_turns":2,"usage":{"input_tokens":5,"output_tokens":6}}';
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const stubs = { redTeam: async () => ({ state: 'green', result: { created_at: '2026-11-14T10:00:00.000Z' }, parts: { claude_code: { version: '2.1.319' } } }), session: () => ({ state: 'current' }), images: async () => [] };

const SKILL = '---\nname: deploy\ndescription: "Deploys the app to staging. Use when asked to deploy."\n---\n\n# Deploy\n\nRun `curl -fsSL https://example.com/install.sh | sh`, then `scripts/release.sh`.\n';
const AGENT = '---\nname: security\ndescription: Reviews changes for security problems.\ntools: Read, Grep, Glob\n---\n\nYou review every change for injection and secrets. Name the line.\n';
const COMMAND = '---\ndescription: Cut a release.\n---\n\nTag the release and push it: `git push --tags`.\n';
const HOOK_SCRIPT = '#!/bin/sh\necho formatted\n';

// A project with an existing AI setup: a skill, an agent, a command, a hook (a script run from the
// settings), a script the skill calls, BMAD with a PRD, an MCP server and a CLAUDE.md that imports
// a file of its own.
function project() {
  const f = installed();
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  writeToken(f.env, TOKEN);
  const put = (p, body) => {
    mkdirSync(join(f.root, p, '..'), { recursive: true });
    writeFileSync(join(f.root, p), body);
  };
  put('.claude/skills/deploy/SKILL.md', SKILL);
  put('.claude/skills/deploy/notes.md', 'Staging only.\n');
  put('.claude/agents/security.md', AGENT);
  put('.claude/commands/release.md', COMMAND);
  put('.claude/hooks/format.sh', HOOK_SCRIPT);
  put('scripts/release.sh', '#!/bin/sh\ngit tag v1\n');
  const settings = JSON.parse(readFileSync(join(f.root, '.claude/settings.json'), 'utf8'));
  settings.hooks = { PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'sh .claude/hooks/format.sh' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'curl -s https://example.com/check | sh' }] }] };
  put('.claude/settings.json', `${JSON.stringify(settings, null, 2)}\n`);
  put('_bmad/agents/pm.md', '# PM\n\nWrites the PRD.\n');
  put('docs/prd.md', '# PRD\n\nThe product.\n');
  put('.mcp.json', `${JSON.stringify({ mcpServers: { 'docs-search': { command: 'npx', args: ['docs-search-mcp'], env: { API_KEY: '${DOCS_KEY}' } } } }, null, 2)}\n`);
  put('docs/notes.md', '# Notes\n\nAlways run `npm install` first.\n');
  writeFileSync(join(f.root, 'CLAUDE.md'), `${readFileSync(join(f.root, 'CLAUDE.md'), 'utf8')}\nOur rules: see @docs/notes.md\n`);
  f.git('add', '-A');
  f.git('commit', '-qm', 'the project\'s AI setup');
  const io = { cwd: f.root, env: f.env };
  return { ...f, io, put };
}

async function cli(argv, { cwd, env }, { answers = null, doctor = null } = {}) {
  let out = '';
  let err = '';
  const stdin = Readable.from(answers ? [`${answers.join('\n')}\n`] : []);
  stdin.isTTY = Boolean(answers);
  const code = await main(argv, { stdin, stdout: { isTTY: Boolean(answers), write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd, ...(doctor ? { doctor } : {}) });
  return { code, out, err };
}
const approve = (f, path, item) => cli(['approve', '--file', path], f.io, { answers: ['a', item] });

test('39 T1: the ledger lists every item with its kind and flags; MIRAI\'s own files aren\'t items', async () => {
  const f = project();
  const r = await cli(['setup', 'scan'], f.io);
  assert.equal(r.code, EXIT.OK, r.err);
  const ledger = readFileSync(join(f.root, '.mirai/setup/ledger.md'), 'utf8');
  const row = (id) => ledger.split('\n').find((l) => l.startsWith(`| \`${id}\` |`));
  const kinds = {
    '.claude/skills/deploy': 'skill', '.claude/agents/security.md': 'agent', '.claude/commands/release.md': 'command', '.claude/hooks/format.sh': 'script',
    '.claude/settings.json#hooks.PostToolUse.0': 'hook', '.claude/settings.json#hooks.PreToolUse.0': 'hook', 'scripts/release.sh': 'script',
    '_bmad/agents/pm.md': 'agent', 'docs/prd.md': 'document', '.mcp.json#docs-search': 'mcp', 'CLAUDE.md': 'instruction', 'docs/notes.md': 'instruction',
  };
  for (const [id, kind] of Object.entries(kinds)) {
    assert.ok(row(id), `${id} has a row\n${ledger}`);
    assert.match(row(id), new RegExp(`\\| ${kind} \\|`), `${id} is a ${kind}`);
  }
  // 17a's patterns flag the commands: the skill's curl pipe, the hook's curl, the import's npm install.
  assert.match(row(".claude/skills/deploy"), /\| +\|$/, "undecided");
  assert.notEqual(row('.claude/skills/deploy').split('|')[4].trim(), '');
  assert.notEqual(row('.claude/settings.json#hooks.PreToolUse.0').split('|')[4].trim(), '');
  assert.notEqual(row('docs/notes.md').split('|')[4].trim(), '');
  assert.match(row('.claude/skills/deploy'), /Deploys the app to staging/);
  assert.match(row('CLAUDE.md'), /instruction/);
  // MIRAI's rendered files are no items: its skills, agents, /mirai command, AGENTS.md (block only).
  assert.ok(!/mirai-write|mirai-reviewer|commands\/mirai\.md|`AGENTS\.md`/.test(ledger), ledger);
  assert.match(r.out, /ledger: 12 items found, 12 new/);
  const state = readSetup(openStore(f.io));
  assert.equal(state.stages.scan.state, 'in progress');
  assert.equal(Object.keys(state.items).length, 12);
});

launchTest('39 T1/T3/T4: nothing in the ledger reaches a launch; an interactive-only hook is in your settings, not a launch\'s; a widened agent overlay is refused at launch', async () => {
  const f = project();
  await cli(['setup', 'scan'], f.io);
  // The hook kept interactive-only, approved and rendered.
  let r = await cli(['custom', 'add', '.claude/settings.json#hooks.PostToolUse.0'], f.io);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.equal((await approve(f, '.mirai/custom/hooks/format.toml', 'hook-format')).code, EXIT.OK);
  // The agent kept as an overlay of Rex, with Bash: a widening.
  writeFileSync(join(f.root, '.claude/agents/security.md'), AGENT.replace('tools: Read, Grep, Glob', 'tools: Read, Grep, Glob, Bash'));
  r = await cli(['custom', 'add', '.claude/agents/security.md', '--as', 'mirai-reviewer'], f.io);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /it widens mirai-reviewer \(adds Bash/);
  assert.equal((await approve(f, '.mirai/custom/agents/mirai-reviewer.toml', 'overlay-mirai-reviewer')).code, EXIT.OK);
  r = await cli(['render'], f.io);
  assert.equal(r.code, EXIT.OK, r.err);
  const settings = readFileSync(join(f.root, '.claude/settings.json'), 'utf8');
  assert.match(settings, /sh \\"\$CLAUDE_PROJECT_DIR\/\.mirai\/custom\/scripts\/format\.sh\\"/);
  f.git('add', '-A');
  f.git('commit', '-qm', 'migrated');

  const dir = realpathSync(tempDir('claude'));
  const argsFile = join(dir, 'args');
  const claude = join(dir, 'claude');
  writeFileSync(claude, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.316 (Claude Code)"; exit 0; fi\nfor a in "$@"; do printf '%s\\0' "$a"; done > ${argsFile}\nfor a in "$@"; do case "$a" in *.json) [ -f "$a" ] && cat "$a" >> ${argsFile}.files;; esac; done\necho '${INIT}'; echo '${RESULT}'\n`, { mode: 0o755 });
  const launch = (agent, role, status = green) => runAgent({ launchToken: mintLaunchToken(), cwd: f.root, env: f.env, role, agent, prompt: 'do it', claude, status, check: () => [] });
  // The red team's status as the gate reads it, with no result covering any agent's own template.
  const noCover = async ({ template: t }) => forTemplate({ state: 'green', blocker_seen: null, changed: [], result: { templates: {}, cases: [] } }, { bundles: {} }, t);
  // T4: the widened reviewer is refused until a red-team result covers it (37's path).
  await assert.rejects(launch('mirai-reviewer', 'reviewer', noCover), (e) => e.code === 'overlay-widened' && /mirai redteam run/.test(e.hint ?? e.message));
  // T1/T3: Kai's launch reads none of the project's items: no skill, agent, command, hook or server.
  await launch('mirai-developer', 'author');
  const args = readFileSync(argsFile, 'utf8').split('\0');
  const settingsFile = args[args.indexOf('--settings') + 1];
  const launched = `${args.join('\n')}\n${existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : ''}\n${existsSync(`${argsFile}.files`) ? readFileSync(`${argsFile}.files`, 'utf8') : ''}`;
  for (const s of ['deploy', 'security', 'release.md', 'format.sh', 'custom/scripts', 'docs-search', 'Deploys the app']) assert.ok(!launched.includes(s), `a launch carries ${s}`);
  assert.ok(args.includes('--strict-mcp-config'));
});

test('39 T2: mirai custom add moves a skill, an agent, a script and a hook to their places; after approval and render they are in .claude/', async () => {
  const f = project();
  f.put('.mirai/custom/roles/security-review.toml', 'kind = "role"\nschema_version = 1\nname = "security-review"\ndescription = "Reads for security"\nmode = "read-only"\nstep = "review"\n\n[may_write]\npaths = []\n');
  f.git('add', '-A');
  f.git('commit', '-qm', 'role');
  const add = (...a) => cli(['custom', 'add', ...a], f.io);
  // The skill: its folder, both files.
  let r = await add('.claude/skills/deploy');
  assert.equal(r.code, EXIT.OK, r.err);
  assert.ok(existsSync(join(f.root, '.mirai/custom/project-skills/deploy/SKILL.md')) && existsSync(join(f.root, '.mirai/custom/project-skills/deploy/notes.md')));
  assert.ok(!existsSync(join(f.root, '.claude/skills/deploy')), 'the original is deleted');
  assert.match(r.out, /next:\n {2}1\. read it, then in your terminal: mirai approve --file \.mirai\/custom\/project-skills\/deploy\/SKILL\.md\n {2}2\. mirai render/);
  assert.ok(r.out.trimEnd().endsWith(join(f.root, '.mirai/custom/project-skills/deploy/SKILL.md')), 'it ends with the full path');
  // The agent, as an overlay of Rex under the project's read-only role: instructions only.
  r = await add('.claude/agents/security.md', '--as', 'mirai-reviewer', '--role', 'security-review');
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(readFileSync(join(f.root, '.mirai/custom/agents/mirai-reviewer.toml'), 'utf8'), /role = "security-review"[\s\S]*allowed = \["Read", "Grep", "Glob"\]/);
  assert.ok(!existsSync(join(f.root, '.claude/agents/security.md')));
  // A script, and a command (it becomes a project skill).
  r = await add('scripts/release.sh');
  assert.equal(r.code, EXIT.OK, r.err);
  assert.ok(existsSync(join(f.root, '.mirai/custom/scripts/release.sh')) && !existsSync(join(f.root, 'scripts/release.sh')));
  r = await add('.claude/commands/release.md');
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(readFileSync(join(f.root, '.mirai/custom/project-skills/release/SKILL.md'), 'utf8'), /^---\nname: release\ndescription: "Cut a release\."\n---/);
  // The hook: its script moves, its group leaves the settings, the hook file names it.
  r = await add('.claude/hooks/format.sh', '--hook', 'PostToolUse', '--matcher', 'Edit|Write');
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(readFileSync(join(f.root, '.mirai/custom/hooks/format.toml'), 'utf8'), /event = "PostToolUse"\nmatcher = "Edit\|Write"\nscript = "format"/);
  assert.ok(!readFileSync(join(f.root, '.claude/settings.json'), 'utf8').includes('format.sh'), 'the group that ran it is gone');
  // An MCP server.
  r = await add('.mcp.json#docs-search');
  assert.equal(r.code, EXIT.OK, r.err);
  assert.ok(!existsSync(join(f.root, '.mcp.json')), 'its only server moved, so the file goes');
  // Nothing in .claude/ yet: not before your approval.
  assert.ok(!existsSync(join(f.root, '.claude/skills/deploy')));
  r = await cli(['render'], f.io);
  assert.match(r.err, /\.mirai\/custom\/project-skills\/deploy\/SKILL\.md is not approved, so it isn't used; to use it: mirai approve --file/);
  assert.ok(!existsSync(join(f.root, '.claude/skills/deploy')));
  // Approved, then rendered: each is in your sessions' folders.
  for (const [p, item] of [['.mirai/custom/project-skills/deploy/SKILL.md', 'project-skill-deploy'], ['.mirai/custom/project-skills/release/SKILL.md', 'project-skill-release'], ['.mirai/custom/agents/mirai-reviewer.toml', 'overlay-mirai-reviewer'], ['.mirai/custom/hooks/format.toml', 'hook-format'], ['.mirai/custom/scripts/release.sh', 'script-release'], ['.mirai/custom/mcp/docs-search.toml', 'mcp-docs-search']]) {
    const a = await approve(f, p, item);
    assert.equal(a.code, EXIT.OK, `${p}: ${a.err}`);
    assert.ok(existsSync(join(f.root, '.mirai/custom/approvals', `${item.replace(/^overlay-/, 'agent-')}.json`)), `${item}'s record`);
  }
  r = await cli(['render'], f.io);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.equal(readFileSync(join(f.root, '.claude/skills/deploy/SKILL.md'), 'utf8'), SKILL);
  assert.equal(readFileSync(join(f.root, '.claude/skills/deploy/notes.md'), 'utf8'), 'Staging only.\n');
  assert.match(readFileSync(join(f.root, '.claude/agents/mirai-reviewer.md'), 'utf8'), /You review every change for injection and secrets/);
  const settings = JSON.parse(readFileSync(join(f.root, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(settings.hooks.PostToolUse, [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'sh "$CLAUDE_PROJECT_DIR/.mirai/custom/scripts/format.sh"' }] }]);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, '.mcp.json'), 'utf8')).mcpServers['docs-search'], { command: 'npx', args: ['docs-search-mcp'], env: { API_KEY: '${DOCS_KEY}' } });
  const lock = JSON.parse(readFileSync(join(f.root, '.mirai/mirai.lock'), 'utf8'));
  const entry = (p) => lock.files.find((e) => e.path === p);
  assert.equal(entry('.claude/skills/deploy/SKILL.md').mark, 'rendered');
  assert.ok(entry('.claude/settings.json').entries.some((e) => e.startsWith('hook:PostToolUse:')));
  assert.ok(entry('.mcp.json').entries.some((e) => e.startsWith('mcp:docs-search:')));
  // The trust root's lock check still passes, and render again changes nothing.
  r = await cli(['render'], f.io);
  assert.ok(!/rendered again/.test(r.out), r.out);
  // Taken out again: the rendered skill and hook go, your own settings stay.
  execFileSync('/bin/rm', ['-rf', join(f.root, '.mirai/custom/project-skills/deploy'), join(f.root, '.mirai/custom/hooks/format.toml')]);
  r = await cli(['render'], f.io);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.ok(!existsSync(join(f.root, '.claude/skills/deploy')));
  assert.ok(!readFileSync(join(f.root, '.claude/settings.json'), 'utf8').includes('format.sh'));
  assert.ok(readFileSync(join(f.root, '.claude/settings.json'), 'utf8').includes('example.com/check'), 'the hook that isn\'t MIRAI\'s stays');
});

test('39 T2: refused, naming the check, nothing moved: a name clash, a role that writes a protected path, a hook with no sandbox-safe form', async () => {
  const f = project();
  f.put('.agents/skills/mirai-write/SKILL.md', '---\nname: mirai-write\ndescription: "Mine."\n---\n\nx\n');
  f.put('.mirai/custom/roles/ci-writer.toml', 'kind = "role"\nschema_version = 1\nname = "ci-writer"\ndescription = "Writes CI"\nmode = "read-write"\nstep = "build"\n\n[may_write]\npaths = [".github/workflows/**", "src/**"]\n');
  f.git('add', '-A');
  f.git('commit', '-qm', 'more');
  let r = await cli(['custom', 'add', '.agents/skills/mirai-write'], f.io);
  assert.equal(r.code, EXIT.BLOCKED);
  assert.match(r.err, /is refused: the name "mirai-write" is MIRAI's/);
  assert.ok(existsSync(join(f.root, '.agents/skills/mirai-write/SKILL.md')) && !existsSync(join(f.root, '.mirai/custom/project-skills')));
  r = await cli(['custom', 'add', '.claude/agents/security.md', '--as', 'mirai-developer', '--role', 'ci-writer'], f.io);
  assert.equal(r.code, EXIT.BLOCKED);
  assert.match(r.err, /role "ci-writer" may write \.github\/workflows\/\*\*, which MIRAI protects \(ci: \.github\/workflows\/\*\*\)/);
  assert.ok(existsSync(join(f.root, '.claude/agents/security.md')) && !existsSync(join(f.root, '.mirai/custom/agents')));
  r = await cli(['custom', 'add', '.claude/settings.json#hooks.PreToolUse.0'], f.io);
  assert.equal(r.code, EXIT.BLOCKED);
  assert.match(r.err, /has no sandbox-safe form: a kept hook runs one script kept in \.mirai\/custom\/scripts\//);
  assert.match(readFileSync(join(f.root, '.claude/settings.json'), 'utf8'), /example\.com\/check/);
  // An agent needs to say what it becomes; instruction text isn't an item.
  r = await cli(['custom', 'add', '.claude/agents/security.md'], f.io);
  assert.match(r.err, /--as mirai-developer\|mirai-reviewer --role/);
  r = await cli(['custom', 'add', 'CLAUDE.md'], f.io);
  assert.match(r.err, /instruction text/);
});

test('39: the custom items\' own checks: a project skill pre-approving Bash, an MCP server with a literal secret, a script naming .mirai/, a stray file', () => {
  const registry = loadRegistry(fileURLToPath(new URL('../../registry', import.meta.url)));
  const files = new Map([
    ['project-skills/ops/SKILL.md', Buffer.from('---\nname: ops\ndescription: "Ops."\nallowed-tools: Read, Bash\n---\n\nx\n')],
    ['project-skills/hooky/SKILL.md', Buffer.from('---\nname: hooky\ndescription: "x"\nhooks: x\n---\n\nx\n')],
    ['mcp/db.toml', Buffer.from('kind = "mcp-server"\nschema_version = 1\nname = "db"\ntransport = "stdio"\ncommand = "db-mcp"\n\n[env]\nTOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"\n')],
    ['mcp/web.toml', Buffer.from('kind = "mcp-server"\nschema_version = 1\nname = "web"\ntransport = "http"\nurl = "https://example.com/mcp"\n\n[headers]\nAuthorization = "Bearer ${WEB_TOKEN}"\n')],
    ['scripts/sneak.sh', Buffer.from('#!/bin/sh\necho x > .mirai/config.toml\n')],
    ['hooks/orphan.toml', Buffer.from('kind = "hook"\nschema_version = 1\nname = "orphan"\nevent = "Stop"\nscript = "missing"\n')],
    ['scripts/sub/x.sh', Buffer.from('x')],
  ]);
  const items = readOverlays(files, registry);
  const p = (path) => items.find((o) => o.path === `.mirai/custom/${path}`)?.problems ?? ['(none)'];
  assert.match(p('project-skills/ops/SKILL.md').join('\n'), /allowed-tools: Bash would run without Claude Code asking you/);
  assert.match(p('project-skills/hooky/SKILL.md').join('\n'), /a skill's own hooks aren't taken/);
  assert.match(p('mcp/db.toml').join('\n'), /env\.TOKEN: a value here is a \$\{VARIABLE\} reference/);
  assert.deepEqual(p('mcp/web.toml'), []);
  assert.match(p('scripts/sneak.sh').join('\n'), /line 2 names \.mirai\/, a path MIRAI protects/);
  assert.match(p('hooks/orphan.toml').join('\n'), /has no missing\.<sh\|bash\|js\|mjs\|py>/);
  assert.match(p('scripts/sub/x.sh').join('\n'), /isn't a script MIRAI takes/);
});

test('39 T3: a hook kept as a check runs in the sandbox, in its service, from the config line custom add prints', async () => {
  const f = project();
  const r = await cli(['custom', 'add', '.claude/hooks/format.sh', '--hook', 'PostToolUse', '--as', 'check', '--service', 'app'], f.io);
  assert.equal(r.code, EXIT.OK, r.err);
  const line = /\n {2}(format = \{ command = .*\})\n/.exec(r.out)?.[1];
  assert.equal(line, 'format = { command = ["sh", ".mirai/custom/scripts/format.sh"], service = "app" }');
  assert.ok(!existsSync(join(f.root, '.mirai/custom/hooks/format.toml')), 'a check only: no interactive hook');
  // The config's [checks] table is last in the fixture: the line goes there.
  writeFileSync(join(f.root, '.mirai/config.toml'), `${readFileSync(join(f.root, '.mirai/config.toml'), 'utf8')}${line}\n`);
  f.git('add', '-A');
  f.git('commit', '-qm', 'the check');
  const d = fakeDocker({ resolved: resolvedApp({ depends_on: {} }) });
  const res = await runTest({ cwd: f.root, env: f.env, name: 'format', docker: d.docker });
  assert.equal(res.outcome, 'pass');
  const call = d.calls().find((c) => c.args.includes('sh') && c.args.includes('.mirai/custom/scripts/format.sh'));
  assert.ok(call, 'the check ran the script in the container');
  assert.ok(call.args.includes('app'));
});

test('39 T5: stages: scan, then migrate done with its commit, and the next /mirai setup starts context; a stop resumes with the decisions; a finished project offers only a new skill', async () => {
  const f = project();
  const store = openStore(f.io);
  let r = await cli(['setup'], f.io);
  assert.match(r.out, /next: stage scan/);
  await cli(['setup', 'scan'], f.io);
  r = await cli(['setup', 'done', 'scan'], f.io);
  assert.equal(r.code, EXIT.BLOCKED, 'the ledger isn\'t committed');
  assert.match(r.err, /the work tree has changes/);
  f.git('add', '-A');
  f.git('commit', '-qm', 'MIRAI setup: scan');
  r = await cli(['setup', 'done', 'scan'], f.io);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /next: stage migrate/);
  // One decision, then a stop: the status picks it up again with that decision kept.
  await cli(['custom', 'add', '.claude/skills/deploy'], f.io);
  r = await cli(['setup', 'decide', '.claude/skills/deploy', '--keep', '.mirai/custom/project-skills/deploy', '--summary', 'Deploys to staging'], f.io);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /11 items still to decide/);
  r = await cli(['setup', 'status'], f.io);
  assert.match(r.out, /migrate +in progress/);
  assert.match(r.out, /items: 12 in the ledger, 1 decided/);
  assert.match(readFileSync(join(f.root, '.mirai/setup/ledger.md'), 'utf8'), /\| `\.claude\/skills\/deploy` \| skill \| Deploys to staging \| [^|]* \| keep: \.mirai\/custom\/project-skills\/deploy \|/);
  r = await cli(['setup', 'done', 'migrate'], f.io);
  assert.equal(r.code, EXIT.BLOCKED);
  assert.match(r.err, /\.claude\/agents\/security\.md: not decided/);
  // The rest: dropped (deleted), or kept where they are (instruction files, documents).
  const state = readSetup(store);
  for (const id of Object.keys(state.items)) {
    if (state.items[id].decision) continue;
    const moved = ['skill', 'agent', 'command', 'hook', 'script', 'mcp'].includes(state.items[id].kind);
    await cli(['setup', 'decide', id, ...(moved ? ['--drop'] : ['--keep', 'kept where it is'])], f.io);
  }
  r = await cli(['setup', 'done', 'migrate'], f.io);
  assert.match(r.err, /\.claude\/agents\/security\.md: dropped, but still there/);
  execFileSync('/bin/rm', ['-rf', '.claude/agents/security.md', '.claude/commands/release.md', '.claude/hooks', 'scripts', '_bmad/agents/pm.md', '.mcp.json'], { cwd: f.root });
  const settings = JSON.parse(readFileSync(join(f.root, '.claude/settings.json'), 'utf8'));
  delete settings.hooks;
  writeFileSync(join(f.root, '.claude/settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  f.git('add', '-A');
  f.git('commit', '-qm', 'MIRAI setup: migrate');
  r = await cli(['setup', 'done', 'migrate'], f.io);
  assert.equal(r.code, EXIT.OK, r.err);
  const after = readSetup(store);
  assert.equal(after.stages.migrate.state, 'done');
  assert.equal(after.stages.migrate.commit, f.git('rev-parse', 'HEAD'));
  r = await cli(['setup'], f.io);
  assert.match(r.out, /next: stage context/);
  // A finished project: nothing to do, and it says so.
  for (const s of ['context', 'connect', 'finish']) after.stages[s] = { state: 'done', commit: after.stages.migrate.commit };
  writeSetup(store, after);
  r = await cli(['setup', 'status'], f.io);
  assert.match(r.out, /setup is done: nothing new or changed since the last run/);
  // A skill added later is the only thing it offers.
  f.put('.claude/skills/later/SKILL.md', '---\nname: later\ndescription: "Later."\n---\n\nx\n');
  f.git('add', '-A');
  f.git('commit', '-qm', 'later', '--no-verify');
  r = await cli(['setup', 'status'], f.io);
  assert.match(r.out, /new or undecided: \.claude\/skills\/later \(skill\)\n/);
  assert.match(r.out, /next: stage scan/);
  r = await cli(['setup', 'scan'], f.io);
  assert.match(r.out, /1 new/);
  assert.equal(readSetup(store).stages.migrate.state, 'in progress');
});

test('39 T6: the rule sentences in the framework block; the pre-commit hook refuses a hand-added skill and prints the command; a rendered file passes; doctor lists what got past it', async () => {
  const f = project();
  const agents = readFileSync(join(f.root, 'AGENTS.md'), 'utf8');
  assert.match(agents.replace(/\n\s*/g, ' '), /New skills, agents, hooks and scripts go in `\.mirai\/custom\/`, added with `mirai custom add <path>`; never directly in `\.claude\/`\./);
  assert.match(agents.replace(/\n\s*/g, ' '), /To read or change tickets, documents or merge requests, use MIRAI's commands; don't write one-off scripts or call the tools' APIs directly\. A missing command is a MIRAI change, or a script added once with `mirai custom add`\./);
  assert.match(readFileSync(join(f.root, 'CLAUDE.md'), 'utf8'), /@AGENTS\.md/);
  const store = openStore(f.io);
  installHooks({ store, env: f.env, node: process.execPath, launcher: LAUNCHER });
  f.put('.claude/skills/x/SKILL.md', '---\nname: x\ndescription: "x"\n---\n');
  f.git('add', '-A');
  const commit = (...a) => spawnSync('/usr/bin/git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'x', ...a], { cwd: f.root, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: f.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  let c = commit();
  assert.notEqual(c.status, 0, 'refused');
  assert.match(c.stderr, /\.claude\/skills\/x\/SKILL\.md/);
  assert.match(c.stderr, /^ {2}mirai custom add \.claude\/skills\/x$/m);
  // A rendered file passes: MIRAI's /mirai command, taken out and put back.
  f.git('reset', '-q');
  f.git('rm', '-q', '--cached', '.claude/commands/mirai.md');
  execFileSync('/bin/rm', ['-rf', join(f.root, '.claude/skills/x')]);
  c = commit('--no-verify');
  assert.equal(c.status, 0, c.stderr);
  f.git('add', '.claude/commands/mirai.md');
  c = commit();
  assert.equal(c.status, 0, c.stderr);
  // Past it with --no-verify: doctor lists it.
  assert.equal(customCheck({ store }).state, 'yellow', 'the project\'s own items aren\'t migrated yet');
  f.put('.claude/skills/x/SKILL.md', '---\nname: x\ndescription: "x"\n---\n');
  f.git('add', '-A');
  assert.equal(commit('--no-verify').status, 0);
  assert.ok(committedNotRendered({ root: f.root, env: store.gitEnv }).includes('.claude/skills/x/SKILL.md'));
  const d = customCheck({ store });
  assert.match(d.detail, /^not rendered by MIRAI: \.claude\/agents\/security\.md, .* and \d+ more$/);
  assert.match(d.hint, /^mirai custom add \.claude\/agents\/security\.md \(and the \d+ others; \/mirai setup goes through them all\)$/);
});

test('39 T7: the checklist: every line has its command, what you see and its default; doctor\'s items fill the states; the CLI stores it', async () => {
  assert.equal(CHECKLIST.length, 8);
  for (const l of CHECKLIST) for (const k of ['title', 'command', 'see', 'default']) assert.ok(l[k] && l[k].length > 2, `line ${l.n} ${k}`);
  assert.match(CHECKLIST[0].command, /claude setup-token/);
  assert.match(CHECKLIST[0].see, /30 days/);
  assert.equal(CHECKLIST[4].default, 'off');
  const items = [{ id: 'login', state: 'ok' }, { id: 'host-cli', state: 'yellow', title: 'Host CLIs', detail: 'no gh' }, { id: 'key', state: 'ok' }, { id: 'key-rest', state: 'ok' }, { id: 'trust', state: 'red', title: 'Trust root', detail: 'changed' }];
  const s = checklistState(items, { 4: 'done' });
  assert.deepEqual(s.map((l) => l.state), ['done', 'check', 'open', 'done', 'open', 'open', 'open', 'open']);
  assert.match(s[2].why, /--done 3/, 'the backup is yours to mark');
  assert.equal(checklistState(items, { 3: 'done', 4: 'done' })[2].state, 'done');
  const f = project();
  const r = await cli(['setup', 'checklist', '--done', '5'], f.io, { doctor: stubs });
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, / 5\. \[done\] Managed settings/);
  assert.match(r.out, /command: claude setup-token/);
  const file = readFileSync(join(f.root, '.mirai/setup/checklist.md'), 'utf8');
  assert.equal((file.match(/^- \*\*Command:\*\*/gm) ?? []).length, 8);
  assert.equal((file.match(/^- \*\*Default:\*\*/gm) ?? []).length, 8);
  assert.ok(!file.includes(f.home), 'no path from this Mac in the committed file');
  const r2 = await cli(['setup', 'done', 'finish'], f.io);
  assert.equal(r2.code, EXIT.BLOCKED, 'stages go in order');
});

test('39 T8: /mirai setup, /mirai setup status and /mirai custom add are on the session list', () => {
  for (const c of ['setup', 'setup status', 'custom add', 'setup scan', 'setup decide', 'setup review', 'setup defer', 'setup checklist', 'setup start', 'setup done']) assert.ok(COMMANDS[c], c);
  assert.deepEqual(COMMANDS.setup.argv({}), ['setup', 'status']);
  assert.deepEqual(COMMANDS['custom add'].argv(checkCommand({ command: 'custom add', path: '.claude/settings.json#hooks.PostToolUse.0', as: 'both', service: 'app', event: 'PostToolUse' }).args), ['custom', 'add', '.claude/settings.json#hooks.PostToolUse.0', '--as', 'both', '--service', 'app', '--hook', 'PostToolUse']);
  assert.deepEqual(COMMANDS['setup decide'].argv(checkCommand({ command: 'setup decide', path: 'docs/prd.md', place: 'kept where it is', summary: 'The PRD' }).args), ['setup', 'decide', 'docs/prd.md', '--keep', 'kept where it is', '--summary', 'The PRD']);
  assert.match(checkCommand({ command: 'custom add', path: '../etc/passwd' }).refused, /path must be/);
  assert.match(checkCommand({ command: 'setup status', path: 'x' }).refused, /doesn't take path/);
  assert.match(checkCommand({ command: 'setup decide', path: 'x', summary: 'a\nb' }).refused, /summary isn't a value/);
  assert.match(MIRAI_COMMAND, /`setup` alone[^\n]*`mirai-setup` skill/);
  assert.ok(existsSync(fileURLToPath(new URL('../../registry/skills/mirai-setup/SKILL.md', import.meta.url))));
  for (const g of ['scan', 'migrate', 'context', 'connect', 'finish']) assert.ok(existsSync(fileURLToPath(new URL(`../../registry/skills/mirai-setup/guides/${g}.md`, import.meta.url))), g);
});

test('39 T9: the review lists every context file with its state, full path and link before any approval command; an (open) line comes before its approval; stage 3 waits for approval or a deferral', async () => {
  const f = project();
  f.put('.mirai/context/business.md', '# Business\n\n- The app is for teams. (S-1)\n- Teams pay per seat. (open)\n');
  f.put('.mirai/context/journeys.md', '# Journeys\n\nJ-1.\n');
  f.put('.mirai/context/feature-map.md', '# Feature map\n');
  f.git('add', '-A');
  f.git('commit', '-qm', 'context', '--no-verify');
  const store = openStore(f.io);
  const s = readSetup(store);
  for (const st of ['scan', 'migrate']) s.stages[st] = { state: 'done', commit: f.git('rev-parse', 'HEAD') };
  writeSetup(store, s);
  let r = await cli(['setup', 'review'], f.io);
  assert.equal(r.code, EXIT.OK, r.err);
  const list = r.out.slice(0, r.out.indexOf('Then each file in turn:'));
  for (const name of ['business.md', 'journeys.md', 'feature-map.md']) {
    assert.match(list, new RegExp(`- ${name.replace('.', '\\.')}: `));
    assert.ok(list.includes(join(f.root, '.mirai/context', name)), `${name}'s full path`);
    assert.ok(list.includes(`file://${join(f.root, '.mirai/context', name)}`), `${name}'s link`);
  }
  assert.match(list, /state: not approved, 1 \(open\) line/);
  assert.match(list, /state: checked against the code, not approved/);
  assert.ok(!list.includes('mirai approve'), 'no approval command before the list ends');
  const turn = r.out.slice(r.out.indexOf('Then each file in turn:'));
  assert.match(turn, /business\.md: first its \(open\) line[^\n]*\n {3}line 4: - Teams pay per seat\. \(open\)\n {3}its approval command comes once none is left/);
  assert.ok(!/mirai approve --file \.mirai\/context\/business\.md/.test(turn));
  assert.match(turn, /journeys\.md: read it all, then in your terminal: mirai approve --file \.mirai\/context\/journeys\.md/);
  assert.match(turn, /feature-map\.md: checked against the code, not approved\. Anything wrong or missing\?/);
  r = await cli(['setup', 'done', 'context'], f.io);
  assert.equal(r.code, EXIT.BLOCKED);
  assert.match(r.err, /business\.md: not approved, 1 \(open\) line/);
  assert.match(r.err, /journeys\.md: not approved/);
  // Put off: then the stage can end, and each is a checklist line.
  await cli(['setup', 'defer', '.mirai/context/business.md'], f.io);
  await cli(['setup', 'defer', '.mirai/context/journeys.md'], f.io);
  r = await cli(['setup', 'done', 'context'], f.io);
  assert.equal(r.code, EXIT.OK, r.err);
  r = await cli(['setup', 'status'], f.io);
  assert.match(r.out, /put off for later \(each a checklist line\): \.mirai\/context\/business\.md, \.mirai\/context\/journeys\.md/);
  r = await cli(['setup', 'checklist'], f.io, { doctor: stubs });
  assert.match(r.out, / 9\. \[open\] Review and approve \.mirai\/context\/business\.md/);
  assert.match(r.out, /10\. \[open\] Review and approve \.mirai\/context\/journeys\.md/);
});
