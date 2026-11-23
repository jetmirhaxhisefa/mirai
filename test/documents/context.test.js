import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRegistry } from '../../src/config/registry.js';
import { loadConfig } from '../../src/config/load.js';
import { ConfigError } from '../../src/cli/errors.js';
import { REGISTRY_DIR, createLintCommand } from '../../src/cli/commands/lint.js';
import { lintText, parseDocument } from '../../src/lint/lint.js';
import { documentWords } from '../../src/lint/prd.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { contextCheck } from '../../src/doctor/checks.js';
import { CONFIG, installed } from '../tests/run-fixture.js';
import { veraBefore } from '../helpers/vera.js';

// Unit 36: the five context files: their templates, examples, lints, approval, show and doctor.
const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
// The sample app's files the examples are checked against: a copy, so the tests don't depend on
// a checkout of mirai-sample-app.
const FIXTURE = fileURLToPath(new URL('../fixtures/sample-app/', import.meta.url));
const NAMES = ['business', 'journeys', 'feature-map', 'project-frontend', 'project-backend', 'conventions-frontend', 'conventions-backend'];
const EX = Object.fromEntries(NAMES.map((n) => [n, read(`examples/context/${n}.md`)]));
// The sample app's named checks, as its README lists them (setup writes them into [checks]).
const CHECKS = { 'composer-validate': ['composer', 'validate', '--no-interaction'], format: ['vendor/bin/pint', '--test'], lint: ['npm', 'run', 'lint'], types: ['npx', 'tsc', '--noEmit'], build: ['npm', 'run', 'build'] };

const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.replace(from, to);
};
const lint = (text, file, o = {}) => lintText(text, { source: `.mirai/context/${file}.md`, registry: REGISTRY, project: { repos: ['.'], checks: CHECKS, ...(o.project ?? {}) }, repo: FIXTURE, linked: { 'feature-map.md': EX['feature-map'] }, ...(o.lint ?? {}) });
const errors = (text, file, o) => lint(text, file, o).filter((p) => p.severity === 'error');
const warnings = (text, file, o) => lint(text, file, o).filter((p) => p.severity === 'warning');
const codes = (ps) => ps.map((p) => p.code);
const one = (ps, code, re) => {
  const hit = ps.filter((p) => p.code === code);
  assert.equal(hit.length, 1, JSON.stringify(ps));
  if (re) assert.match(`${hit[0].reason} | ${hit[0].hint ?? ''}`, re);
  return hit[0];
};

test('36 T1: each type: the template fails as leftover text only; the example lints clean against the sample app\'s code, with no warning; the checklist exists', () => {
  const types = { business: 'business', journeys: 'journeys', 'feature-map': 'feature-map', project: 'project-frontend', conventions: 'conventions-frontend' };
  for (const [type, example] of Object.entries(types)) {
    const def = REGISTRY.documentTypes[type];
    assert.ok(def, type);
    assert.ok(!def.lint_checks.includes('summary'), `${type}: approved as a whole file, with no summary (decision 1)`);
    const left = lintText(read(def.template), { source: `docs/${type}.md`, registry: REGISTRY, project: { repos: ['.'] } });
    assert.ok(left.length > 0 && left.every((p) => p.code === 'template-text'), `${type}: ${JSON.stringify(left.filter((p) => p.code !== 'template-text'))}`);
    assert.ok(read(def.checklist).startsWith('# '), type);
    assert.equal(parseDocument(EX[example], example).value.type, type);
  }
  for (const n of NAMES) assert.deepEqual(lint(EX[n], n), [], n);
  // The business cap is the type's: 1,000 words, warning past 800, the Sources table not counted.
  const def = REGISTRY.documentTypes.business;
  assert.deepEqual([def.document_words, def.document_warn_words, def.uncounted_sections], [1000, 800, ['Sources']]);
});

// Bullets of `n` words each (sentences of five words), each citing S-1, added to the glossary.
const padded = (text, extra) => {
  const sentence = 'Tasks stay in one list.';
  const bullets = [];
  let words = 0;
  while (words < extra) {
    bullets.push(`- ${Array(4).fill(sentence).join(' ')} (S-1).`);
    words += 21;
  }
  return swap(text, '\n## Constraints', `${bullets.join('\n')}\n\n## Constraints`);
};
const wordsOf = (text) => documentWords(parseDocument(text, 'b'), REGISTRY.documentTypes.business);

test('36 T2: business: a claim with no source, an unknown source, an unused one, a "you said" with no date, and the word cap', () => {
  const B = EX.business;
  one(errors(swap(B, '- English only, for now (S-2).', '- English only, for now.'), 'business'), 'business-source', /^this bullet has no source: "English only, for now\." \| end it with the ID of its source/);
  one(errors(swap(B, '- People log in with the app\'s own account (S-1). There\'s no single sign-on (S-2).', '\nPeople log in with the app\'s own account (S-1).'), 'business'), 'business-claim', /a claim that isn't a bullet/);
  const s9 = swap(B, 'at most 6 tries a minute (S-6).', 'at most 6 tries a minute (S-9).');
  one(errors(s9, 'business'), 'business-source', /^S-9 isn't in the Sources table \| add a row for S-9/);
  one(warnings(s9, 'business'), 'business-source', /^S-6 isn't cited anywhere/);
  const unused = swap(B, '| S-6 | The API\'s routes | `backend/routes/api.php` | 2026-11-20 |', '| S-6 | The API\'s routes | `backend/routes/api.php` | 2026-11-20 |\n| S-7 | The pitch deck | https://example.com/deck | 2026-11-19 |');
  assert.deepEqual(errors(unused, 'business'), []);
  one(warnings(unused, 'business'), 'business-source', /^S-7 isn't cited anywhere/);
  one(errors(swap(B, '| you said | 2026-11-20 |', '| you said | |'), 'business'), 'business-sources', /^S-2 has no date for when you said it \| write the day you said it/);
  one(errors(swap(B, '| you said | 2026-11-20 |', '| the owner | 2026-11-20 |'), 'business'), 'business-sources', /^S-2 has no link, file or "you said"/);
  one(errors(swap(B, '`backend/app/Policies/TaskPolicy.php`', '`backend/app/Policies/Gone.php`'), 'business'), 'business-sources', /S-5's file backend\/app\/Policies\/Gone\.php doesn't exist/);
  // Decision 8 (P2 on Thudos): a claim no source says yet ends with (open), not with a source that
  // doesn't say it. While writing, a warning that names it as a question; at approval, a failure.
  const open = swap(B, '- English only, for now (S-2).', '- Languages: not known yet (open).');
  assert.deepEqual(codes(errors(open, 'business')), []);
  one(warnings(open, 'business'), 'business-open', /^no source says this yet: "Languages: not known yet \(open\)\." \| ask the person, and write their answer with a "you said" source/);
  one(errors(open, 'business', { lint: { approving: true } }), 'business-open', /^an open line can't be approved: .* \| answer it/);
  // (open) in the middle of a claim isn't a marker: the bullet still needs its source.
  one(errors(swap(B, '- English only, for now (S-2).', '- English only (open) for now.'), 'business'), 'business-source', /if no source says it, end it with \(open\)/);
  // 850 words warns, 1,050 fails; the Sources table isn't counted.
  const base = wordsOf(B);
  const at850 = padded(B, 850 - base);
  assert.ok(wordsOf(at850) > 800 && wordsOf(at850) <= 1000, String(wordsOf(at850)));
  assert.deepEqual(errors(at850, 'business'), []);
  one(warnings(at850, 'business'), 'business-length', /^business\.md has \d+ words, past 800 \(the cap is 1000\)/);
  const at1050 = padded(B, 1050 - base);
  assert.ok(wordsOf(at1050) > 1000, String(wordsOf(at1050)));
  one(errors(at1050, 'business'), 'business-length', /^business\.md has \d+ words; the cap is 1000, the Sources table not counted/);
  const longSources = swap(at850, '| S-1 | The app\'s README |', `| S-1 | The app's README, ${Array(60).fill('a page about the app').join(', ')} |`);
  assert.ok(longSources.length > at850.length + 1000);
  assert.deepEqual(codes(errors(longSources, 'business')), [], 'the Sources table isn\'t counted');
  // [docs.limits] business_words = 1200 moves the cap.
  assert.deepEqual(errors(at1050, 'business', { project: { limits: { business_words: 1200 } } }), []);
  one(errors(at850, 'business', { project: { limits: { business_words: 820, business_warn_words: 700 } } }), 'business-length', /the cap is 820/);
  // The config: project layer, in range.
  const { config } = loadConfig(configFiles({ project: `${MINIMAL}[docs.limits]\nbusiness_words = 1200\nbusiness_warn_words = 900\n` }));
  assert.deepEqual(config.docs.limits, { business_words: 1200, business_warn_words: 900 });
  for (const [key, value] of [['business_words', 99999], ['business_words', 10], ['business_warn_words', 5]]) {
    assert.match(configProblems({ project: `${MINIMAL}[docs.limits]\n${key} = ${value}\n` }).join('\n'), new RegExp(key), `${key} = ${value}`);
  }
  assert.match(configProblems({ personal: 'schema_version = 1\n[docs.limits]\nbusiness_words = 1200\n' }).join('\n'), /docs\.limits can't be set in a personal file|docs can't be set in a personal file/);
});

test('36 T3: journeys: no J-n, a gap, no "Why critical:", an E2E file that isn\'t there, and an unknown screen', () => {
  const J = EX.journeys;
  one(errors(swap(J, '### J-2: Add a task and mark it done', '### Add a task and mark it done'), 'journeys'), 'journeys-id', /^the journey "Add a task and mark it done" has no J-n ID \| name it ### J-2: Add a task and mark it done/);
  one(errors(swap(J, '### J-2:', '### J-3:'), 'journeys'), 'journeys-id', /^J-3 should be J-2: journeys run J-1, J-2, J-3 … with no gap/);
  one(errors(swap(J, '### J-2:', '### J-1:'), 'journeys'), 'journeys-id', /^J-1 is used twice/);
  one(errors(swap(J, 'Why critical: when it breaks, nobody can use the app, and every team stops at once (S-1).\n\n', ''), 'journeys'), 'journeys-why', /^J-1 has no "Why critical:" line/);
  one(errors(swap(J, 'every team stops at once (S-1).', 'every team stops at once.'), 'journeys'), 'journeys-source', /^J-1's "Why critical:" line has no source/);
  // Decision 8: a "Why critical:" line no source says yet ends with (open).
  const jOpen = swap(J, 'every team stops at once (S-1).', 'every team stops at once (open).');
  assert.deepEqual(codes(errors(jOpen, 'journeys')), []);
  one(warnings(jOpen, 'journeys'), 'journeys-open', /^no source says this yet: "J-1: /);
  one(errors(jOpen, 'journeys', { lint: { approving: true } }), 'journeys-open', /^an open line can't be approved/);
  one(errors(swap(J, '1. On **Tasks**, type a title in "New task", then choose "Add".\n2. The task shows at the top of the list, not done.\n3. Tick its box. It shows as done once the API confirms.\n', ''), 'journeys'), 'journeys-steps', /^J-2 has no steps/);
  const gone = swap(J, 'E2E test: `e2e/tests/smoke.spec.ts`', 'E2E test: `e2e/tests/login.spec.ts`');
  one(errors(gone, 'journeys'), 'journeys-e2e', /^J-1's E2E test e2e\/tests\/login\.spec\.ts doesn't exist \| correct the path.*or write "none yet"/);
  assert.deepEqual(lint(swap(J, 'E2E test: `e2e/tests/smoke.spec.ts`', 'E2E test: none yet'), 'journeys'), []);
  one(errors(swap(J, 'E2E test: `e2e/tests/smoke.spec.ts`\n\n### J-2', '### J-2'), 'journeys'), 'journeys-e2e', /^J-1 has no "E2E test:" line/);
  const sign = swap(J, 'On **Log in**', 'On **Sign in**');
  assert.deepEqual(errors(sign, 'journeys'), []);
  one(warnings(sign, 'journeys'), 'journeys-screen', /^J-1's step names the screen "Sign in", which isn't in the feature map/);
  // The roadmap's done-when: a journey with no ID is flagged by mirai lint's rules, not only here.
  one(errors(swap(J, '### J-1: Log in', '### Log in'), 'journeys', { lint: { repo: null } }), 'journeys-id', /has no J-n ID/);
});

test('36 T4: feature map and project: a handle not in the code, a route not in it, a path that isn\'t there, npm run nope; the examples pass against the sample app\'s fixture copy', async () => {
  const F = EX['feature-map'];
  one(errors(swap(F, 'data-testid="login-form"', 'data-testid="signin-form"'), 'feature-map'), 'feature-map-handle', /^data-testid="signin-form" isn't in the code under frontend\/src/);
  one(errors(swap(F, '`button "Add"`', '`button "Remove"`'), 'feature-map'), 'feature-map-handle', /button "Remove" isn't in the code/);
  one(errors(swap(F, '`button "Add"`', '`knob "Add"`'), 'feature-map'), 'feature-map-handle', /"knob" in "knob "Add"" isn't an ARIA role/);
  // A handle is found only as a whole (36's review): a one-letter test id or a name inside a longer word isn't enough.
  one(errors(swap(F, 'data-testid="login-form"', 'data-testid="e"'), 'feature-map'), 'feature-map-handle', /^data-testid="e" isn't in the code/);
  one(errors(swap(F, 'data-testid="login-form"', 'data-testid="login"'), 'feature-map'), 'feature-map-handle', /^data-testid="login" isn't in the code/);
  one(errors(swap(F, '`button "Add"`', '`button "A"`'), 'feature-map'), 'feature-map-handle', /button "A" isn't in the code/);
  const route = swap(F, '| Tasks | `/` |', '| Tasks | `/settings` |');
  assert.deepEqual(errors(route, 'feature-map'), []);
  one(warnings(route, 'feature-map'), 'feature-map-route', /^the route \/settings isn't in the code under frontend\/src \| a route built at run time/);
  assert.deepEqual(lint(F, 'feature-map'), []);
  const P = EX['project-frontend'];
  one(errors(swap(P, '`frontend/src/api.ts`', '`frontend/src/client.ts`'), 'project-frontend'), 'project-path', /^frontend\/src\/client\.ts doesn't exist/);
  one(errors(swap(P, 'npm run coverage', 'npm run nope'), 'project-frontend'), 'project-command', /^"docker compose exec frontend npm run nope": frontend\/package\.json has no script "nope" \| its scripts are: dev, build, lint, test, coverage/);
  one(errors(swap(P, 'root: frontend', 'root: web'), 'project-frontend'), 'project-path', /the service's folder web doesn't exist/);
  one(errors(swap(EX['project-backend'], '`docker/php/Dockerfile`', '`docker/php8/Dockerfile`'), 'project-backend'), 'project-path', /docker\/php8\/Dockerfile doesn't exist/);
  // A host name isn't a path (36's P2 on Thudos): `api.example.test` and `.example.test` aren't checked as files.
  assert.deepEqual(errors(swap(EX['project-backend'], '`docker/php/Dockerfile`', '`docker/php/Dockerfile`, at `api.example.test` and `.example.test`'), 'project-backend').filter((p) => p.code === 'project-path'), []);
  // The file's name follows its service.
  one(errors(P, 'project-web'), 'context-name', /a project file in \.mirai\/context\/ is named project-frontend\.md/);
  // Through mirai lint, in a copy of the sample app: the seven examples in .mirai/context/ lint
  // clean against its code, agents-local.md beside them is left alone, and a broken one fails.
  const repo = sampleRepo();
  const clean = await lintRepo(repo);
  assert.equal(clean.code, EXIT.OK, JSON.stringify(clean.result.problems));
  assert.equal(clean.result.files, 7);
  assert.deepEqual(clean.result.problems, []);
  writeFileSync(join(repo, '.mirai/context/project-frontend.md'), swap(P, 'npm run coverage', 'npm run nope'));
  writeFileSync(join(repo, '.mirai/context/feature-map.md'), swap(F, 'data-testid="login-form"', 'data-testid="signin-form"'));
  const broken = await lintRepo(repo);
  assert.equal(broken.code, EXIT.FAILURE);
  assert.deepEqual(broken.result.problems.map((p) => `${p.file} ${p.code}`), ['.mirai/context/feature-map.md feature-map-handle', '.mirai/context/project-frontend.md project-command']);
  rmSync(repo, { recursive: true, force: true });
});

test('36 T5: conventions: an untagged rule, a check the config doesn\'t name, a judgment rule with no example, a rule that repeats a check', () => {
  const C = EX['conventions-frontend'];
  one(errors(swap(C, '- The types check with no error (enforced by types).', '- The types check with no error.'), 'conventions-frontend'), 'conventions-tag', /^this rule has no tag: "The types check with no error\." \| end it with \(enforced by <check>\)/);
  one(errors(swap(C, '(enforced by types)', '(enforced by eslint-x)'), 'conventions-frontend'), 'conventions-check', /^"eslint-x" isn't a named check in the config \| the named checks are: composer-validate, format, lint, types, build/);
  const noExample = swap(C, '  Example: "The task could not be saved. Try again."\n', '');
  assert.deepEqual(errors(noExample, 'conventions-frontend'), []);
  one(warnings(noExample, 'conventions-frontend'), 'conventions-example', /^this judgment rule has no example: "A message to the user is a full sentence/);
  const repeat = `${C}- Run tsc before you push a change (judgment).\n  Example: \`npx tsc --noEmit\` in \`frontend/\`.\n`;
  one(warnings(repeat, 'conventions-frontend'), 'conventions-repeat', /^this rule repeats the check "types" \(npx tsc --noEmit\) as prose \| .*\(enforced by types\)/);
  // Without the project's code and config (a template or an example where it lives), the named
  // check isn't looked up.
  assert.deepEqual(lintText(swap(C, '(enforced by types)', '(enforced by eslint-x)'), { source: 'registry/examples/context/conventions-frontend.md', registry: REGISTRY, project: { repos: ['.'] } }), []);
});

// ---- Through the CLI -----------------------------------------------------------------------

const filesIn = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p)] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
};
const contextFiles = (names = NAMES) => Object.fromEntries(names.map((n) => [`.mirai/context/${n}.md`, EX[n]]));

// A git repo holding the sample app's fixture copy, its config's named checks, and the examples.
function sampleRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mirai-36-')));
  cpSync(FIXTURE, root, { recursive: true });
  mkdirSync(join(root, '.mirai/context'), { recursive: true });
  writeFileSync(join(root, '.mirai/config.toml'), `${MINIMAL}[checks]\n${Object.entries(CHECKS).map(([n, c]) => `${n} = ${JSON.stringify(c)}`).join('\n')}\n`);
  for (const [p, t] of Object.entries(contextFiles())) writeFileSync(join(root, p), t);
  writeFileSync(join(root, '.mirai/context/agents-local.md'), '# This project\'s own instructions\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}
async function lintRepo(root) {
  let out = '';
  const io = { stdout: { write: (s) => (out += s) }, stderr: { write: () => {} }, env: { PATH: process.env.PATH, HOME: root }, cwd: root };
  const code = await main(['lint', '--json'], io, [createLintCommand()]);
  return { code, result: JSON.parse(out) };
}

// Unit 40: these approvals aren't about the verifier; her pass for the file as it is now first
// (test/documents/verify.test.js tests the gate itself).
async function tty(argv, { cwd, env }, answers, { vera = true } = {}) {
  if (vera) veraBefore(argv, { cwd, env });
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd });
  return { code, out, err };
}

// MIRAI installed in a repo holding the sample app's fixture copy and `context` files, with a
// committed signing key.
function fixture(context = contextFiles()) {
  const f = installed({ config: `${CONFIG}${Object.entries(CHECKS).filter(([n]) => n !== 'lint').map(([n, c]) => `${n} = ${JSON.stringify(c)}`).join('\n')}\n`, files: { ...filesIn(FIXTURE), ...context } });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  return { ...f, io: { cwd: f.root, env: f.env } };
}
const approvals = (f) => readJournal(openStore(f.io)).events.filter((e) => e.type === 'approval');
const BUSINESS = '.mirai/context/business.md';

test('36 T6: approval through the CLI: a business.md with a lint problem is refused; a clean one writes one kind: context line; a change makes it stale; the feature map is refused; show context lists every file', async () => {
  const f = fixture();
  const path = join(f.root, BUSINESS);
  writeFileSync(path, swap(EX.business, '- English only, for now (S-2).', '- English only, for now.'));
  const refused = await tty(['approve', '--file', BUSINESS], f.io, ['a', 'sample-app-business']);
  assert.equal(refused.code, EXIT.BLOCKED, refused.out + refused.err);
  assert.match(refused.err, /^\.mirai\/context\/business\.md:\d+: this bullet has no source: "English only, for now\." \(end it with/m);
  assert.match(refused.err, /can't be approved yet: 1 lint problem, listed above; nothing was written/);
  assert.doesNotMatch(refused.out, /accepted as is/);
  assert.deepEqual(approvals(f), []);
  // Clean: one signed line, kind context, with the file's type.
  writeFileSync(path, EX.business);
  const ok = await tty(['approve', '--file', BUSINESS], f.io, ['a', 'sample-app-business']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.match(ok.out, /^context: business\.md \(business, sample-app-business\)\nfile: {4}\.mirai\/context\/business\.md\nhash: {4}sha256:[0-9a-f]{64}\n/);
  assert.match(ok.out, /you approve the whole file/);
  assert.match(ok.out, /approved: \.mirai\/context\/business\.md, as it is now \(accepted; signed with k-[0-9a-f]+, seq \d+\); a change to it needs a new approval/);
  const [line] = approvals(f);
  assert.deepEqual(approvals(f).length, 1);
  assert.deepEqual([line.kind, line.file_type, line.item, line.path, line.decision], ['context', 'business', 'sample-app-business', BUSINESS, 'accepted']);
  assert.ok(line.signature);
  // The id given with it must be the file's.
  const wrongId = await tty(['approve', 'other-id', '--file', BUSINESS], f.io, ['a']);
  assert.equal(wrongId.code, EXIT.USAGE);
  // The feature map and a project file are refused, with the reason.
  for (const file of ['.mirai/context/feature-map.md', '.mirai/context/project-frontend.md']) {
    const r = await tty(['approve', '--file', file], f.io, ['a']);
    assert.equal(r.code, EXIT.BLOCKED, r.err);
    assert.match(r.err, /isn't approved: it's checked against the code \((its handles and routes|its paths and commands)\), so mirai lint is its check; nothing was written/);
  }
  // Journeys and conventions are approved the same way.
  const j = await tty(['approve', '--file', '.mirai/context/journeys.md'], f.io, ['a', 'sample-app-journeys']);
  assert.equal(j.code, EXIT.OK, j.err);
  assert.equal(approvals(f).length, 2);
  // A change makes business.md stale; mirai show context lists every file with its state and path.
  writeFileSync(path, `${EX.business.replace('- English only, for now (S-2).', '- English and German (S-2).')}`);
  const shown = await tty(['show', 'context'], f.io, []);
  assert.equal(shown.code, EXIT.OK, shown.err);
  const dir = join(realpathSync(f.root), '.mirai/context');
  const row = (file, type, state) => new RegExp(`^  ${file.replace('.', '\\.')} +${type} +\\S+ +${state} +${join(dir, file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm');
  assert.match(shown.out, new RegExp(`^context   ${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.match(shown.out, row('business.md', 'business', 'changed since approval'));
  assert.match(shown.out, row('journeys.md', 'journeys', 'approved'));
  assert.match(shown.out, row('feature-map.md', 'feature-map', 'checked, not approved'));
  assert.match(shown.out, row('project-backend.md', 'project', 'checked, not approved'));
  assert.match(shown.out, row('project-frontend.md', 'project', 'checked, not approved'));
  assert.match(shown.out, row('conventions-backend.md', 'conventions', 'not approved'));
  assert.match(shown.out, row('conventions-frontend.md', 'conventions', 'not approved'));
  assert.equal(shown.out.trim().split('\n').length, 8);
  // A kind with no file yet shows as missing.
  const empty = fixture({});
  const none = await tty(['show', 'context'], empty.io, []);
  assert.match(none.out, /^ {2}business\.md +business +— +missing +\//m);
  assert.match(none.out, /^ {2}project-\{service\}\.md +project +— +missing +\//m);
});

test('36 T7: mirai doctor: business.md approved 200 days ago is yellow; a stale context approval shows', async () => {
  const f = fixture(contextFiles(['business', 'journeys', 'feature-map']));
  const store = openStore(f.io);
  const check = (days) => {
    const { events } = readJournal(store);
    const ts = Date.parse(events.filter((e) => e.type === 'approval').at(-1)?.ts ?? new Date().toISOString());
    return contextCheck({ store, events, now: () => new Date(ts + days * 86_400_000) });
  };
  const before = check(0);
  assert.equal(before.state, 'yellow');
  assert.match(before.detail, /business\.md isn't approved; journeys\.md isn't approved/);
  assert.match(before.hint, /mirai approve --file \.mirai\/context\/business\.md/);
  assert.equal((await tty(['approve', '--file', BUSINESS], f.io, ['a', 'sample-app-business'])).code, EXIT.OK);
  assert.equal((await tty(['approve', '--file', '.mirai/context/journeys.md'], f.io, ['a', 'sample-app-journeys'])).code, EXIT.OK);
  assert.deepEqual([check(10).state, check(10).detail], ['ok', '2 approved context files, each as it is now']);
  const old = check(200);
  assert.equal(old.state, 'yellow');
  assert.match(old.detail, /^business\.md was last approved 200 days ago \(\d{4}-\d{2}-\d{2}\), more than 180$/);
  assert.match(old.hint, /update it, then: mirai approve --file \.mirai\/context\/business\.md/);
  // A changed journeys.md: its approval is stale.
  writeFileSync(join(f.root, '.mirai/context/journeys.md'), EX.journeys.replace('every team stops at once', 'every team stops'));
  const stale = check(10);
  assert.equal(stale.state, 'yellow');
  assert.equal(stale.detail, 'journeys.md changed since its approval');
  assert.match(stale.hint, /mirai approve --file \.mirai\/context\/journeys\.md/);
});

const MINIMAL = 'schema_version = 1\n[git]\nintegration_branch = "main"\n';
function configFiles({ project = MINIMAL, personal } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mirai-36-config-'));
  mkdirSync(join(dir, 'repo', '.mirai'), { recursive: true });
  writeFileSync(join(dir, 'repo', '.mirai', 'config.toml'), project);
  const files = { projectRoot: join(dir, 'repo'), globalFile: join(dir, 'home', '.config', 'mirai', 'config.toml') };
  if (personal !== undefined) {
    files.personalRepoFile = join(dir, 'config.user.toml');
    writeFileSync(files.personalRepoFile, personal);
  }
  return files;
}
function configProblems(o) {
  try {
    loadConfig(configFiles(o));
  } catch (err) {
    assert.ok(err instanceof ConfigError, String(err));
    return (err.errors ?? [{ reason: err.reason }]).map((e) => `${e.reason} ${e.hint ?? ''}`);
  }
  return assert.fail('expected config problems');
}
