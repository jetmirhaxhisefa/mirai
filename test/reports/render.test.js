import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderMrDescription, renderQaReport, renderRunReport, inline, codeSpan, codeBlock, redact, ReportError, TEMPLATE_DIR, MR_MARKER, HOSTS } from '../../src/reports/render.js';
import { scanMarkdown } from '../../src/lint/markdown.js';

// What a Markdown reader would see as structure (MIRAI's scanner, an approximation of GFM):
// headings and links.
function structure(md) {
  const scan = scanMarkdown(md);
  return { headings: scan.headings.map((h) => `${h.level} ${h.text}`), links: scan.links.map((l) => l.target) };
}
const h2 = (name) => scanMarkdown(readFileSync(join(TEMPLATE_DIR, `${name}.md`), 'utf8')).headings.filter((h) => h.level === 2).map((h) => h.text);
// The text outside code spans: what a host's reference filters see.
const outsideCode = (md) => md.replace(/(`+)[\s\S]*?\1/g, ' ');

const MR = () => ({
  ticket: { id: 'PMT-31', title: 'Renaming a team hides its members' },
  why: 'Renaming a team left its members on the old slug, so the team page showed none.',
  what_changed: ['Members are looked up by team id.', 'Old slugs redirect to the new one.'],
  review: { rounds: 2 },
  followups: ['The slug history table could be pruned after a year.'],
  qa: {
    acs: [{ ac: 'AC-PMT-31.1', result: 'pass', tests: ['TeamRenameTest::test_members_stay'] }, { ac: 'AC-PMT-31.2', result: 'pass', tests: ['TeamRenameTest::test_old_slug_redirects'] }],
    commands: [{ command: 'php artisan test --filter=TeamRename', output: 'PASS  Tests\\Feature\\TeamRenameTest\n  ✓ members stay\n  ✓ old slug redirects\n\nTests:  2 passed' }],
  },
  risk: { level: 'normal' },
  links: [{ label: 'PMT-31', url: 'https://tracker.example/browse/PMT-31' }],
  files: [{ label: 'ADR-3', path: 'docs/mirai/adr/ADR-3.md' }],
});

test('T6: a rendered MR description holds no findings, counts rounds, and lets no value inject structure', () => {
  const md = renderMrDescription(MR());
  assert.ok(md.startsWith(`${MR_MARKER}\n# PMT-31: Renaming a team hides its members\n`));
  assert.deepEqual(structure(md).headings, ['1 PMT-31: Renaming a team hides its members', ...h2('mr-description').map((s) => `2 ${s}`)]);
  assert.match(md, /^Review: PASS after 2 rounds \(MIRAI\)$/m);
  assert.match(renderMrDescription({ ...MR(), review: { rounds: 1 } }), /^Review: PASS after 1 round \(MIRAI\)$/m);
  assert.match(md, /\| AC-PMT-31\.1 \| pass \| TeamRenameTest::test\\_members\\_stay \|/);
  // Links come only from checked https URLs; repo files are shown as code, not as relative links.
  assert.deepEqual(structure(md).links, ['https://tracker.example/browse/PMT-31']);
  assert.match(md, /^- ADR-3: `docs\/mirai\/adr\/ADR-3\.md`$/m);

  // No findings by construction: no field takes them, and a follow-up can't cite a file or line.
  const findings = [{ id: 'F1', severity: 'blocking', file: 'app/Actions/RenameTeam.php', line: 42, claim: 'The members are looked up by the old slug.' }];
  assert.throws(() => renderMrDescription({ ...MR(), findings }), (err) => err instanceof ReportError && err.problems.some((p) => p.code === 'unknown-key'));
  assert.throws(() => renderMrDescription({ ...MR(), review: { rounds: 2, findings } }), ReportError);
  for (const f of ['app/Actions/RenameTeam.php:42 RenameTeam::handle: looked up by the old slug.', 'See RenameTeam.php:42.', 'The bug is in app/Actions/RenameTeam.php.']) {
    assert.throws(() => renderMrDescription({ ...MR(), followups: [f] }), (err) => err.problems?.[0]?.code === 'cites-code', f);
  }

  // Hostile values: no heading, link, mention, issue or commit reference, email, math, emoji,
  // GitLab reference or quick action survives outside code.
  const bad = MR();
  bad.why = '/merge';
  bad.what_changed = ['# Approved', '1. not a list', '> quoted', '| a | b |', '***', '/approve now', '    indented code'];
  bad.followups = ['Ping @octocat and @org/team about #1, GH-1 and octocat/Hello-World#1', 'Mail a@b.example, mailto:x@y.example or _https://evil.example', '1https://evil.example www.evil.example $x^2$ $$y$$ :shipit:',
    'Commit 0123456789abcdef0123456789abcdef01234567, !12, %v1.0, %"Release 1", ~bug, &3 and <img src=x onerror=alert(1)>'];
  bad.ticket.title = '[x](https://evil.example) $\'b';
  const out = renderMrDescription(bad);
  assert.deepEqual(structure(out).headings.slice(1), h2('mr-description').map((x) => `2 ${x}`));
  assert.deepEqual(structure(out).links.filter((l) => /evil/.test(l)), []);
  assert.match(out, /^\\\/merge$/m); // a quick action can't start a line
  assert.match(out, /^- \\\/approve now$/m);
  assert.match(out, /^- indented code$/m); // values are trimmed
  const plainText = outsideCode(out);
  for (const raw of [/@octocat/, /@org/, /#1\b/, /GH-1/, /a@b/, /mailto/, /https?:\/\/evil/, /www\.evil/, /\$x/, /\$\$/, /:shipit:/, /0123456789abcdef/, /!12/, /%v1/, /%"/, /~bug/, /&3/, /(?<!\\)<img/]) {
    assert.doesNotMatch(plainText, raw, String(raw));
  }
  assert.match(out, /`@octocat`/);
  assert.match(out, /`\$'b`/); // `$'` stays as written in the title
  // A newline can't even get in: the schema refuses it.
  assert.throws(() => renderMrDescription({ ...MR(), why: 'line one\n# Approved' }), ReportError);

  // Command output: fenced, its tail only, redacted; a token left over refuses the render.
  const out2 = renderMrDescription({ ...MR(), qa: { ...MR().qa, commands: [{ command: 'DB_PASSWORD=hunter2 php artisan test', output: 'a\n```\n# Approved\n\u001b[31mred\u001b[0m\u001b]8;;https://evil.example\u0007link\u001b]8;;\u0007\u0007\nAPP_KEY=base64:abc\nAWS AKIAABCDEFGHIJKLMNOP\nhttps://u:p@internal.corp/x\n/Users/jet/work/app/tests/A.php\n/Users/jet/.ssh' }] } }, { root: '/Users/jet/work/app', home: '/Users/jet' });
  assert.deepEqual(structure(out2).headings.filter((x) => x.includes('Approved')), []);
  for (const raw of ['\u001b', '\u0007', 'hunter2', 'base64:abc', 'AKIAABCDEFGHIJKLMNOP', 'u:p@', '/Users/jet']) assert.ok(!out2.includes(raw), raw);
  assert.match(out2, /APP_KEY=<redacted>/);
  assert.match(out2, /<repo>\/tests\/A\.php/);
  assert.match(out2, /~\/\.ssh/);
  const tail = renderMrDescription({ ...MR(), qa: { ...MR().qa, commands: [{ command: 'x', output: Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n') }] } });
  assert.match(tail, /the first 30 lines are in the store/);
  assert.match(tail, /line 49/);
  assert.doesNotMatch(tail, /line 29\n/);
  // A token in a command is redacted; one anywhere else refuses the render.
  const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  assert.ok(!renderMrDescription({ ...MR(), qa: { ...MR().qa, commands: [{ command: `echo ${token}`, output: '' }] } }).includes(token));
  assert.throws(() => renderMrDescription({ ...MR(), why: `Rotated ${token} today.` }), (err) => err.problems?.[0]?.code === 'credential');
  assert.throws(() => renderMrDescription({ ...MR(), followups: [`Use ${token}`] }), (err) => err.problems?.[0]?.code === 'credential');

  // The body fits the host's limit: output is dropped first, then test names.
  const big = { ...MR(), qa: { acs: Array.from({ length: 200 }, (_, i) => ({ ac: `AC-PMT-31.${i}`, result: 'pass', tests: Array.from({ length: 5 }, (_, k) => `T${i}::test_${'x'.repeat(200)}${k}`) })), commands: Array.from({ length: 10 }, () => ({ command: 'x', output: 'y'.repeat(1000).concat('\n').repeat(20) })) } };
  const fitted = renderMrDescription(big);
  assert.ok(fitted.length <= HOSTS.github.budget, `${fitted.length}`);
  assert.match(fitted, /Output: in the store\./);
  assert.match(fitted, /\| in the store \|/); // GitHub: test names dropped too
  const gitlab = renderMrDescription(big, { host: 'gitlab' });
  assert.ok(gitlab.length <= HOSTS.gitlab.budget && gitlab.length > fitted.length);
  assert.doesNotMatch(gitlab, /Output: in the store/); // GitLab: everything fits

  // The host decides the stack reference; QA rows must be passes; high risk needs its reason.
  assert.match(renderMrDescription({ ...MR(), stack: { number: 12 } }), /Stacked on #12: do not merge until it's retargeted\./);
  assert.match(renderMrDescription({ ...MR(), stack: { number: 12 } }, { host: 'gitlab' }), /Stacked on !12:/);
  assert.throws(() => renderMrDescription(MR(), { host: 'bitbucket' }), ReportError);
  assert.throws(() => renderMrDescription({ ...MR(), qa: { ...MR().qa, acs: [{ ac: 'AC-PMT-31.1', result: 'fail', tests: [] }] } }), ReportError);
  const { qa: _qa, ...noQa } = MR();
  assert.match(renderMrDescription(noQa), /QA hasn't run for this ticket\./);
  assert.match(renderMrDescription({ ...MR(), risk: { level: 'high', reason: 'Touches the login flow.' } }), /^High: Touches the login flow\.$/m);
  assert.throws(() => renderMrDescription({ ...MR(), risk: { level: 'high' } }), ReportError);
  for (const url of ['javascript:alert(1)', 'http://plain.example', 'https://x.example/a)(b', 'https://x.example/<s>', 'https://x.example/\u001bc', 'https://x.example/\u202e', 'https://x.example/\\', 'docs/a.md']) {
    assert.throws(() => renderMrDescription({ ...MR(), links: [{ label: 'x', url }] }), ReportError, JSON.stringify(url));
  }
  assert.throws(() => renderMrDescription({ ...MR(), links: [{ label: 'x', url: 'https://u:ghp_abcdefghijklmnopqrstuvwxyz0123456789@h.example' }] }), ReportError);
});

const RUN = () => ({
  run: { id: 'r-20261024-010203-abc1', date: '2026-10-24', preset: 'supervised', state: 'finished' },
  done: [{ ticket: 'PMT-31', title: 'Renaming a team hides its members', mr: 'https://git.example/mr/7' }, { ticket: 'PMT-32', title: 'Slug history', mr: 'https://git.example/mr/8', stacked_on: 'PMT-31' }],
  parked: [{ ticket: 'PMT-40', reason: 'repeat', note: 'The same test failed twice; the plan needs another look.' }],
  paused: [{ reason: 'usage-limit', resets_at: '2026-10-24T05:00+02:00' }],
  followups: [{ ticket: 'PMT-31', text: 'Prune the slug history after a year.' }],
  usage: [{ ticket: 'PMT-31', turns: 41, tokens: 1830000, minutes: 22.5, cost_usd: 3.1 }, { ticket: 'PMT-32', turns: 12, tokens: 400000, minutes: 6, cost_usd: 0.9 }],
  inbox: [{ kind: 'dispute', item: 'PMT-40', text: 'The developer disputes F2.' }],
  template_gaps: [{ template: 'story@v1', section: 'Data migration', message: 'No place for a backfill plan.' }],
  known_failures: ['LegacyTest::test_flaky_clock'],
  branch_warnings: [{ branch: 'feature/PMT-32-slug-history', files: ['.vscode/tasks.json', 'package.json'] }],
  clean_due: true,
});

test('T7: the QA and run reports render their template\'s sections from checked data, escaped', () => {
  const verdict = JSON.stringify({
    verdict: 'fail',
    acs: [{ ac: 'AC-PMT-31.1', result: 'pass', evidence: [{ kind: 'test', ref: 'tests/Feature/TeamRenameTest.php::test_members_stay' }] }, { ac: 'AC-PMT-31.2', result: 'fail', evidence: [{ kind: 'screenshot', ref: 'tickets/PMT-31/qa/r1/404.png' }] }],
    issues: [{ id: 'I1', title: 'The old slug gives a 404 <b>', category: 'functional', severity: 'high', ac: 'AC-PMT-31.2', description: 'Opening the old slug shows a 404.', steps: ['Rename Platform to Platform Core', 'Open /teams/platform'], evidence: [{ kind: 'screenshot', ref: 'tickets/PMT-31/qa/r1/404.png' }] }],
  });
  const qa = renderQaReport({ ticket: 'PMT-31', round: 1, verdict });
  assert.deepEqual(structure(qa).headings, ['1 QA report: PMT-31, round 1', ...h2('qa-report').map((s) => `2 ${s}`), '3 I1: The old slug gives a 404 \\<b\\>']);
  assert.match(qa, /^Fail\.$/m);
  assert.match(qa, /^1\. Rename Platform to Platform Core$/m);
  assert.match(qa, /^2\. Open \/teams\/platform$/m);
  assert.throws(() => renderQaReport({ ticket: 'PMT-31', round: 1, verdict: '{"verdict": "pass"}' }), ReportError);
  assert.throws(() => renderQaReport({ ticket: '../x', round: 1, verdict }), ReportError);
  const blocked = JSON.stringify({ verdict: 'blocked', blocked_reason: "The app didn't answer.", acs: [{ ac: 'AC-PMT-31.1', result: 'not-run', evidence: [] }], issues: [] });
  assert.match(renderQaReport({ ticket: 'PMT-31', round: 2, verdict: blocked }), /^Blocked: The app didn't answer\.$/m);

  const report = renderRunReport(RUN());
  assert.deepEqual(structure(report).headings, ['1 Run r-20261024-010203-abc1, 2026-10-24', ...h2('run-report').map((s) => `2 ${s}`)]);
  assert.equal(h2('run-report')[1], 'Branch warnings'); // first after the summary (D-54)
  assert.match(report, /^2 tickets done, 1 parked; the run finished \(supervised\)\.$/m);
  assert.match(report, /\| Total \| 53 \| 2,230,000 \| 28\.5 \| `\$4\.00` \(estimate\) \|/);
  assert.match(report, /\| PMT-31 \| 41 \| 1,830,000 \| 22\.5 \|/);
  assert.match(report, /^- PMT-31: Renaming a team hides its members, https:\/\/git\.example\/mr\/7$/m);
  assert.match(report, /Paused: usage-limit, resets 2026-10-24T05:00\+02:00/);
  assert.match(report, /due for `mirai clean`/);
  // Unknown cost stays unknown; empty sections say None.
  const quiet = renderRunReport({ ...RUN(), done: [], parked: [], paused: [], followups: [], inbox: [], template_gaps: [], known_failures: [], branch_warnings: [], clean_due: false, usage: [{ ticket: 'PMT-31', turns: 1, tokens: 10, minutes: 1 }] });
  assert.match(quiet, /\| Total \| 1 \| 10 \| 1 \| unknown \|/);
  assert.equal((quiet.match(/^None\.$/gm) ?? []).length, 7); // warnings, done, parked, follow-ups, inbox, gaps, failures
  assert.throws(() => renderRunReport({ ...RUN(), extra: 1 }), ReportError);
  assert.throws(() => renderRunReport({ ...RUN(), parked: [{ ticket: 'PMT-40', reason: 'x', note: '# heading\nnext' }] }), ReportError);
  // MR links: no control or bidi characters, no credentials; times are ISO; no NaN.
  for (const mr of ['https://x.example/\u001bc\u0007', 'https://x.example/\u202e', 'https://u:ghp_abcdefghijklmnopqrstuvwxyz0123456789@h.example/mr/1']) {
    assert.throws(() => renderRunReport({ ...RUN(), done: [{ ticket: 'PMT-31', title: 'x', mr }] }), ReportError, JSON.stringify(mr));
  }
  assert.throws(() => renderRunReport({ ...RUN(), paused: [{ reason: 'x', resets_at: 'soon' }] }), ReportError);
  assert.throws(() => renderRunReport({ ...RUN(), usage: [{ ticket: 'PMT-31', turns: 1, tokens: 1, minutes: Number.NaN, cost_usd: Number.NaN }] }), ReportError);

  // The terminal form: the same sections, no Markdown escapes, controls made visible.
  const text = renderRunReport({ ...RUN(), followups: [{ ticket: 'PMT_31', text: 'Fix https://x.example/a_b and *stars*' }] }, { format: 'text' });
  assert.match(text, /^Run r-20261024-010203-abc1, 2026-10-24\n=+\n/);
  assert.match(text, /^Branch warnings\n-+$/m);
  assert.match(text, /^- PMT_31: Fix https:\/\/x\.example\/a_b and \*stars\*$/m);
  assert.match(text, /^Total\s+53 turns\s+2,230,000 tokens\s+28\.5 min {2}\$4\.00 \(estimate\)$/m);
  assert.throws(() => renderRunReport(RUN(), { format: 'html' }), ReportError);
});

test('T7b: the escaping helpers', () => {
  assert.equal(inline('a*b_c'), 'a\\*b\\_c');
  assert.equal(inline('1) x'), '1\\) x');
  assert.equal(inline('= x'), '\\= x');
  assert.equal(inline('/merge'), '\\/merge');
  assert.equal(inline('/merge', { start: false }), '/merge');
  assert.equal(inline('see @a'), 'see `@a`');
  assert.equal(inline('a|b @c|d', { cell: true }), 'a\\|b `@c\\|d`');
  assert.equal(codeSpan('a `b` c'), '``a `b` c``');
  assert.equal(codeSpan('`x'), '`` `x ``');
  assert.match(codeBlock('````\nx'), /^`````text\n/);
  assert.match(inline('a\u202eb'), /\\u202e/);
  assert.equal(redact('TOKEN=abc password: "x y" name=ok'), 'TOKEN=<redacted> password: <redacted> name=ok');
});
