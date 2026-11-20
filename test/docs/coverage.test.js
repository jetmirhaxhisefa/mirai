import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { checkDocs, commandNames, configKeys, realInput, whoMaySet } from './coverage.js';

// Unit 34b: the docs check. Everything you can use is named in docs/, or is on
// docs/internal-list.toml with a reason. T1 runs on the real repo; T2 and T3 seed gaps in a fixture.

const LIST = '[[internal]]\nname = "mirai hook"\nkind = "command"\nreason = "called by git, not by you"\n';

// A small docs/ that passes: every command, session command, key, type and file is named.
function fixture() {
  return {
    files: ['README.md', 'run.md', 'config.md', 'documents.md', 'internal-list.toml'],
    pages: {
      'README.md': '# Docs\n\n- [run.md](run.md): runs.\n- [config.md](config.md): keys.\n- [documents.md](documents.md): documents.\n- [internal-list.toml](internal-list.toml): exceptions.\n',
      'run.md': '# `mirai run`\n\n```\nmirai run SAMPLE-1\nmirai redteam run\n```\n\nAccept one with `mirai redteam accept-blocker <id>`.\n\n## `/mirai` in your session\n\n```\n# a comment in a block isn't a heading\n/mirai run SAMPLE-1\n```\n\n- **Gates:** `redteam accept-blocker`.\n- **Not from a session:** `hook`.\n',
      'config.md': '# Config\n\n## [run]\n\n| Key | Who may set it | Default | What it does |\n|---|---|---|---|\n| `run.stop_by` | project, personal repo | none | When a run stops. |\n| `schema_version` | project | `1` | The format. |\n\n## [checks]\n\n| Key | Who may set it | Default | What it does |\n|---|---|---|---|\n| `checks.<name>` | project | none | A check. |\n| `checks.<name>.command` | project | none | Its command. |\n',
      'documents.md': '# Documents\n\n| Type | File |\n|---|---|\n| `brief` | `registry/document-types/brief.toml` |\n',
    },
    commands: [
      { name: 'run', usage: 'mirai run <ticket>' },
      { name: 'redteam', usage: 'mirai redteam run [--kept] | mirai redteam accept-blocker <id> --note <why>' },
      { name: 'hook', usage: 'mirai hook pre-push <remote> <url>' },
    ],
    session: { commands: ['run'], gates: ['redteam accept-blocker'], notFromSession: ['hook'] },
    schema: {
      type: 'table',
      fields: {
        run: { type: 'table', fields: { stop_by: { type: 'string' } } },
        checks: { type: 'table', map: { type: 'choice', pick: (v) => (Array.isArray(v) ? { type: 'array' } : { type: 'table', fields: { command: { type: 'array' } } }) } },
      },
    },
    layerKeys: { project: ['schema_version', 'run.*', 'checks.*'], 'personal-repo': ['run.stop_by'], 'personal-global': [] },
    types: [{ name: 'brief', file: 'registry/document-types/brief.toml' }],
    list: LIST,
  };
}

// The one problem a seeded gap gives.
function onlyProblem(input) {
  const problems = checkDocs(input);
  assert.equal(problems.length, 1, problems.join('\n'));
  return problems[0];
}

test('34b T1: the real docs/ name every command, /mirai command, config key, document type and file', async () => {
  const problems = checkDocs(await realInput());
  assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
});

test('34b T1: the fixture passes; subcommands come from usage strings; who may set a key comes from LAYER_KEYS', () => {
  assert.deepEqual(checkDocs(fixture()), []);
  assert.deepEqual(commandNames([{ name: 'redteam', usage: 'mirai redteam run [--kept] | mirai redteam accept-blocker <id> --note <why>' }]), ['mirai redteam', 'mirai redteam run', 'mirai redteam accept-blocker']);
  assert.deepEqual(commandNames([{ name: 'key', usage: 'mirai key <new|show> [<key-id>]' }]), ['mirai key', 'mirai key new', 'mirai key show']);
  assert.deepEqual(commandNames([{ name: 'approve', usage: 'mirai approve <ticket> --file <path> | mirai approve <ticket> --plan' }]), ['mirai approve']);
  assert.deepEqual(commandNames([{ name: 'unpark', usage: 'mirai unpark <ticket> --retry | --accept <id>' }]), ['mirai unpark']);
  const f = fixture();
  assert.deepEqual(configKeys(f.schema, f.layerKeys), ['run.stop_by', 'checks.<name>', 'checks.<name>.command', 'schema_version']);
  assert.equal(whoMaySet('run.stop_by', f.layerKeys), 'project, personal repo');
  assert.equal(whoMaySet('checks.<name>.command', f.layerKeys), 'project');
  assert.equal(whoMaySet('dependencies.max_added', f.layerKeys), 'none');
});

test('34b T2: a command no page names fails, naming it and where to add it', () => {
  const f = fixture();
  f.commands.push({ name: 'protected', usage: 'mirai protected [<base>..<head>]' });
  f.pages['run.md'] += '\nThe protected paths are listed below.\n';
  assert.equal(onlyProblem(f), 'mirai protected isn\'t named in docs/: add it to the page for its area (docs/run.md?) as `mirai protected`, or to docs/internal-list.toml with a reason');
});

test('34b T2: a subcommand missing from the docs fails; the parent alone isn\'t enough', () => {
  const f = fixture();
  f.commands[1].usage += ' | mirai redteam status';
  assert.match(onlyProblem(f), /^mirai redteam status isn't named in docs\/: add it .* or to docs\/internal-list\.toml with a reason$/);
});

test('34b T2: a mention counts only in a code span, a code block or a heading', () => {
  const f = fixture();
  f.pages['run.md'] = f.pages['run.md'].replace('`mirai redteam accept-blocker <id>`', 'mirai redteam accept-blocker');
  assert.match(onlyProblem(f), /^mirai redteam accept-blocker isn't named/);
});

test('34b T2: a /mirai command with no mention fails', () => {
  const f = fixture();
  f.session.commands.push('redteam run');
  assert.equal(onlyProblem(f), '/mirai redteam run isn\'t named in docs/: add `/mirai redteam run` to the session list in docs/agents.md ("`/mirai` in your Claude Code session") or to the page for its area');
});

test('34b T2: a gate or a command kept out of the session must be named in a /mirai section', () => {
  const f = fixture();
  f.session.gates.push('merge');
  f.pages['run.md'] = `# \`mirai merge\`\n\n${f.pages['run.md']}`;
  assert.match(onlyProblem(f), /^merge is a gate, but no `\/mirai` section in docs\/ names it: add `merge` to the gates/);
});

test('34b T2: a schema key with no row in docs/config.md fails', () => {
  const f = fixture();
  f.schema.fields.run.fields.on_limit = { type: 'enum', values: ['wait', 'stop'] };
  assert.equal(onlyProblem(f), 'config key `run.on_limit` has no row in docs/config.md: add one under its table ([run]) with who may set it, the default and what it does, or add it to docs/internal-list.toml with a reason');
});

test('34b T2: a row for a key the schema doesn\'t know fails', () => {
  const f = fixture();
  f.pages['config.md'] += '| `run.stop_at` | project | none | A typo. |\n';
  assert.match(onlyProblem(f), /^docs\/config\.md:\d+ has a row for `run\.stop_at`, which the config schema doesn't know: remove the row, or fix the key's name$/);
});

test('34b T2: a row with an empty column fails; so do a second row and a wrong "who may set it"', () => {
  const f = fixture();
  f.pages['config.md'] = f.pages['config.md'].replace('| none | When a run stops. |', '| none |  |');
  assert.match(onlyProblem(f), /^docs\/config\.md:\d+, row `run\.stop_by`: the "what it does" column is empty: fill it$/);
  const g = fixture();
  g.pages['config.md'] += '| `checks.<name>` | project | none | Again. |\n';
  assert.match(onlyProblem(g), /second row for `checks\.<name>`/);
  const h = fixture();
  h.pages['config.md'] = h.pages['config.md'].replace('| `run.stop_by` | project, personal repo |', '| `run.stop_by` | project |');
  assert.match(onlyProblem(h), /row `run\.stop_by`: "who may set it" says "project", but LAYER_KEYS says "project, personal repo": fix the row$/);
});

test('34b T2: a document type no page names fails; a page documents.md links counts', () => {
  const f = fixture();
  f.types.push({ name: 'story', file: 'registry/document-types/story.toml' });
  assert.equal(onlyProblem(f), 'document type `story` (registry/document-types/story.toml) isn\'t named in docs/documents.md or a page it links: add it to the document types table in docs/documents.md, or to docs/internal-list.toml with a reason');
  f.pages['documents.md'] += '\nTickets: see [run.md](run.md).\n';
  f.pages['run.md'] += '\nA `story` is a ticket.\n';
  assert.deepEqual(checkDocs(f), []);
});

test('34b T2: a docs/ file missing from docs/README.md fails', () => {
  const f = fixture();
  f.files.push('ship.md');
  f.pages['ship.md'] = '# Ship\n';
  assert.equal(onlyProblem(f), 'docs/ship.md isn\'t listed in docs/README.md: add a line with a link to it and what it covers');
});

test('34b T3: an internal-list entry without a reason fails, and so does one for something that no longer exists', () => {
  const f = fixture();
  f.list = LIST.replace('reason = "called by git, not by you"\n', '');
  assert.equal(onlyProblem(f), 'docs/internal-list.toml: entry "mirai hook" has no reason: add reason = "…" (why it isn\'t in docs/)');
  const g = fixture();
  g.list += '\n[[internal]]\nname = "mirai frobnicate"\nkind = "command"\nreason = "gone since unit 12"\n';
  assert.equal(onlyProblem(g), 'docs/internal-list.toml: entry "mirai frobnicate" (command) names something that no longer exists: remove the entry');
  const h = fixture();
  h.list += '\n[[internal]]\nname = "run.stop_at"\nkind = "key"\nreason = "a key that was renamed"\n';
  assert.match(onlyProblem(h), /entry "run\.stop_at" \(key\) names something that no longer exists/);
  const i = fixture();
  i.list += '\n[[internal]]\nname = "x"\nkind = "page"\nreason = "no such kind"\n';
  assert.match(onlyProblem(i), /entry "x" has kind "page": use one of command, key, type/);
  // Without its entry, `mirai hook` is a gap again.
  const j = fixture();
  j.list = '';
  assert.match(checkDocs(j).join('\n'), /mirai hook isn't named in docs\//);
});

test('34b T4: the check runs in under 2 seconds, with no git, network or Docker', async () => {
  const started = performance.now();
  checkDocs(await realInput());
  const ms = performance.now() - started;
  assert.ok(ms < 2000, `took ${Math.round(ms)} ms`);
  const source = readFileSync(new URL('./coverage.js', import.meta.url), 'utf8');
  for (const banned of ['child_process', 'node:net', 'node:http', 'node:https', 'node:dns', 'docker', 'spawn', 'exec(']) {
    assert.ok(!source.includes(banned), `coverage.js mentions ${banned}`);
  }
});
