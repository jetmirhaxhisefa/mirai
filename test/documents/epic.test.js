import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRegistry } from '../../src/config/registry.js';
import { loadConfig } from '../../src/config/load.js';
import { ConfigError } from '../../src/cli/errors.js';
import { REGISTRY_DIR, createLintCommand } from '../../src/cli/commands/lint.js';
import { createEpicCommand } from '../../src/cli/commands/epic.js';
import { lintText, parseDocument } from '../../src/lint/lint.js';
import { checkIds } from '../../src/lint/rules.js';
import { renderEpic, renderSections, ticketSet, GENERATED } from '../../src/lint/epic.js';
import { prdItems } from '../../src/lint/graph.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { epicApproval } from '../../src/cli/commands/approve.js';
import { checkCommand, COMMANDS } from '../../src/mcp/tools/commands.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { contentHash } from '../../src/sign/sign.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { installed } from '../tests/run-fixture.js';

// Unit 33: the epic and the ticket graph lint, read with the PRD and the tickets.
const REGISTRY = loadRegistry(REGISTRY_DIR);
const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const EPIC = read('examples/epic.md');
const PRD = read('examples/prd.md');
const BRIEF = read('examples/brief.md');
const TEMPLATE = read('templates/epic.md');
const DEF = REGISTRY.documentTypes.epic;
const TICKETS = Object.fromEntries(readdirSync(join(REGISTRY_DIR, 'examples', 'tickets')).sort().map((f) => [`tickets/${f}`, read(`examples/tickets/${f}`)]));
const T = (key) => `tickets/${key}.md`;

const lint = (text, { tickets = TICKETS, prd = PRD, ...o } = {}) => lintText(text, { source: 'docs/mirai/due-dates/epic-due-dates.md', registry: REGISTRY, project: { repos: ['.'] }, linked: prd === null ? {} : { 'prd.md': prd }, tickets, ...o });
const errors = (text, o) => lint(text, o).filter((p) => p.severity === 'error');
const warnings = (text, o) => lint(text, o).filter((p) => p.severity === 'warning');
const codes = (ps) => ps.map((p) => p.code);
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.replace(from, to);
};
const one = (text, code, re, o) => {
  const ps = errors(text, o).filter((p) => p.code === code);
  assert.equal(ps.length, 1, JSON.stringify(errors(text, o)));
  if (re) assert.match(`${ps[0].reason} | ${ps[0].hint ?? ''}`, re);
  return ps[0];
};
// The tickets with one file changed (or added, or removed with null).
const withTicket = (key, change, tickets = TICKETS) => {
  const out = { ...tickets };
  if (change === null) delete out[T(key)];
  else out[T(key)] = typeof change === 'function' ? change(tickets[T(key)]) : change;
  return out;
};
// The epic rendered again from these tickets, as `mirai epic render` would.
function rendered(text, tickets, prd = PRD) {
  const doc = parseDocument(text, 'epic.md');
  const p = parseDocument(prd, 'prd.md');
  const up = { doc: p, ids: checkIds(p, REGISTRY.documentTypes.prd, () => {}, null) };
  const all = Object.entries(tickets).map(([path, t]) => {
    const d = parseDocument(t, path);
    return { path, value: d.value, doc: d };
  });
  const set = ticketSet(doc, { readTickets: () => ({ status: 'ok', all }), registry: REGISTRY });
  return renderEpic(text, renderSections({ track: doc.value.track, tickets: set.tickets, items: prdItems(up) })).text;
}
// A seeded ticket set, the epic rendered from it: only the graph's problems are left.
const seeded = (tickets, { epic = EPIC } = {}) => ({ text: rendered(epic, tickets), tickets });
const graph = (s, code) => errors(s.text, { tickets: s.tickets }).filter((p) => p.code === code);

// A ticket like the example's, with its own key.
const ticket = (key, { epic = 'SAMPLE-50', size = 'S', after = [], fr = ['FR-1'], ac = ['AC-FR-1.1'], files = [] } = {}) => `---
id: ${key}
type: story
template: story@v1
repo: "."
risk: normal
size: ${size}
verify: "A person checks the change on the staging stack."
covers_fr: [${fr.join(', ')}]
covers_ac: [${ac.join(', ')}]
governed_by: []
after: [${after.join(', ')}]
epic: ${epic}
files_likely: [${files.join(', ')}]
e2e: false
---
# Another slice of the due-dates work

## Description

Another slice of the due-dates work, end to end.

## Acceptance criteria

- AC-${key}.1: The slice works
  - Given a task with a due date
  - When a person opens it
  - Then the slice shows

## Boundaries

Not applicable — nothing nearby changes.

## References

Not applicable — the PRD is enough.

## Notes

Not applicable — no notes.
`;

test('33 T1: the type, the template and the example: the example lints clean with its PRD and tickets; the template left as it is fails', () => {
  // The example: clean, no warning either, and so is each of its tickets.
  assert.deepEqual(lint(EPIC), []);
  for (const [path, text] of Object.entries(TICKETS)) {
    assert.deepEqual(lintText(text, { source: `docs/mirai/due-dates/${path}`, registry: REGISTRY, project: { repos: ['.'] } }), [], path);
  }
  // It covers every FR, NFR and AC of the example PRD (decision 2's coverage table lists each).
  const p = parseDocument(PRD, 'prd.md');
  const items = prdItems({ doc: p, ids: checkIds(p, REGISTRY.documentTypes.prd, () => {}, null) });
  assert.equal(items.length, 30);
  const coverage = EPIC.slice(EPIC.indexOf('## Coverage'), EPIC.indexOf('## Design decisions'));
  for (const i of items) assert.match(coverage, new RegExp(`^\\| ${i.id} \\| [^|]+ \\| SAMPLE-5[1-7]`, 'm'), i.id);
  assert.ok(items.some((i) => i.group === 'Failures') && items.some((i) => i.group === 'Unchanged behaviour'));
  // The template holds every section of the type in order; left as it is, it fails as leftover
  // text (and, with no tickets, on the graph and its generated parts).
  const h2 = TEMPLATE.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
  assert.deepEqual(h2, DEF.required_sections);
  const left = errors(TEMPLATE, { tickets: {}, prd: read('templates/prd.md') });
  assert.ok(codes(left).includes('template-text'), JSON.stringify(left));
  assert.ok(left.every((p) => /^template-text$|^graph-|^epic-generated$|^empty-section$/.test(p.code)), JSON.stringify(left.filter((p) => !/^template-text$|^graph-|^epic-generated$|^empty-section$/.test(p.code))));
  // No list lead-in an agent would copy (32's P2): every list in the template sits under a heading.
  const body = TEMPLATE.slice(TEMPLATE.indexOf('\n-->\n')).split('\n');
  body.forEach((l, i) => {
    if (!/^- /.test(l) || /^- /.test(body[i - 1])) return;
    const prev = body.slice(0, i).reverse().find((x) => x.trim() !== '' && !x.startsWith('<!--'));
    assert.match(prev, /^#{2,3} /, `a list at line ${i + 1} follows "${prev}"`);
  });
  // The checklist carries 32's P3 lessons.
  const checklist = read('templates/epic-checklist.md');
  assert.match(checklist, /^## What the set must not add/m);
  assert.match(checklist, /a BR in the brief asks for it/);
  assert.match(checklist, /sent back to\s+the PRD/);
});

// A repo with the example in docs/mirai/due-dates/, the epic's generated parts empty.
function repo({ epic = EPIC, tickets = TICKETS, files = {} } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mirai-33-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const dir = join(root, 'docs', 'mirai', 'due-dates');
  mkdirSync(join(dir, 'tickets'), { recursive: true });
  writeFileSync(join(dir, 'brief.md'), BRIEF);
  writeFileSync(join(dir, 'prd.md'), PRD);
  writeFileSync(join(dir, 'epic-due-dates.md'), epic);
  for (const [path, text] of Object.entries(tickets)) writeFileSync(join(dir, path), text);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  let out = '';
  let err = '';
  const io = { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: { PATH: process.env.PATH, HOME: root }, cwd: root };
  const run = async (...argv) => {
    out = '';
    err = '';
    const code = await main(argv, io, [createLintCommand(), createEpicCommand()]);
    return { code, out, err };
  };
  return { root, dir, run, at: (rel) => join(dir, rel) };
}
const EMPTIED = GENERATED.reduce((text, name) => text.replace(new RegExp(`(## ${name}\\n)[\\s\\S]*?(?=\\n## |$)`), '$1'), EPIC);

test('33 T2: mirai epic render writes the four generated sections exactly; a hand edit or a changed ticket is drift until rendered again', async () => {
  assert.ok(!EMPTIED.includes('| Key | Title |') && EMPTIED.includes('## Tickets\n'), EMPTIED.slice(-400));
  const r = repo({ epic: EMPTIED });
  const epicPath = r.at('epic-due-dates.md');
  const mode = statSync(epicPath).mode & 0o777;
  // Before rendering, each generated part fails the lint, naming the fix.
  const before = errors(EMPTIED).filter((p) => p.code === 'epic-generated');
  assert.deepEqual(before.map((p) => p.reason), GENERATED.map((n) => `"## ${n}" isn't the generated part`));
  assert.match(before[0].hint, /run: mirai epic render docs\/mirai\/due-dates\/epic-due-dates\.md/);
  const first = await r.run('epic', 'render', 'docs/mirai/due-dates/epic-due-dates.md');
  assert.equal(first.code, EXIT.OK, first.err);
  assert.equal(readFileSync(epicPath, 'utf8'), EPIC, 'the example\'s four sections, exactly');
  assert.equal(statSync(epicPath).mode & 0o777, mode, 'the file keeps its permissions');
  assert.match(first.out, /^SAMPLE-50: rendered Tickets, Dependencies, Coverage and Design decisions from 7 tickets and the PRD\n/);
  assert.equal(first.out.trim().split('\n').at(-1), epicPath, 'the last line is the epic\'s full path');
  assert.match((await r.run('epic', 'render', 'docs/mirai/due-dates/epic-due-dates.md')).out, /^SAMPLE-50: already up to date with its 7 tickets and the PRD\n/);
  assert.deepEqual((await r.run('lint')).out, '10 files, 0 problems, 0 warnings, 0 skipped\n');
  // A hand edit inside a generated part is drift.
  const edited = swap(EPIC, '| [SAMPLE-52](tickets/SAMPLE-52.md) | A due date in the past is refused | S |', '| [SAMPLE-52](tickets/SAMPLE-52.md) | A due date in the past is refused | M |');
  one(edited, 'epic-generated', /"## Tickets" doesn't match the ticket files and the PRD \(edited by hand, or a ticket changed since it was rendered\) \| run: mirai epic render/);
  // Text added outside the markers, inside a generated section, is drift too.
  one(swap(EPIC, '## Design decisions\n\n', '## Design decisions\n\nADR-9 is coming.\n\n'), 'epic-generated', /"## Design decisions" isn't the generated part/);
  // A ticket changed after rendering fails until it's rendered again.
  writeFileSync(r.at('tickets/SAMPLE-52.md'), swap(TICKETS[T('SAMPLE-52')], 'size: S', 'size: M'));
  const stale = await r.run('lint', '--json');
  assert.equal(stale.code, EXIT.FAILURE);
  assert.deepEqual(JSON.parse(stale.out).problems.map((p) => `${p.file} ${p.code} ${p.reason.slice(0, 18)}`), [
    'docs/mirai/due-dates/epic-due-dates.md epic-generated "## Tickets" doesn',
    'docs/mirai/due-dates/epic-due-dates.md epic-generated "## Dependencies" ',
  ]);
  assert.equal((await r.run('epic', 'render', 'docs/mirai/due-dates/epic-due-dates.md')).code, EXIT.OK);
  assert.equal((await r.run('lint')).code, EXIT.OK);
  assert.match(readFileSync(epicPath, 'utf8'), /\| \[SAMPLE-52\]\(tickets\/SAMPLE-52\.md\) \| A due date in the past is refused \| M \|/);
  // Everything outside the four sections is left as it was.
  const outside = (t) => t.slice(0, t.indexOf('## Tickets'));
  assert.equal(outside(readFileSync(epicPath, 'utf8')), outside(EPIC));
  // What render refuses: not an epic, no PRD line, a missing section.
  assert.match((await r.run('epic', 'render', 'docs/mirai/due-dates/prd.md')).err, /docs\/mirai\/due-dates\/prd\.md is a prd, not an epic/);
  writeFileSync(epicPath, swap(EPIC, 'PRD: [Tasks with due dates that people finish on time](prd.md)\n\n', ''));
  assert.match((await r.run('epic', 'render', 'docs/mirai/due-dates/epic-due-dates.md')).err, /has no "PRD:" line under its title/);
  writeFileSync(epicPath, EPIC.slice(0, EPIC.indexOf('## Design decisions')));
  const missing = await r.run('epic', 'render', 'docs/mirai/due-dates/epic-due-dates.md');
  assert.equal(missing.code, EXIT.USAGE);
  assert.match(missing.err, /has no "## Design decisions"/);
  // From your session too (21f): it writes the repo's docs only.
  assert.deepEqual(checkCommand({ command: 'epic render', file: 'docs/mirai/due-dates/epic-due-dates.md' }).args, { command: 'epic render', file: 'docs/mirai/due-dates/epic-due-dates.md' });
  assert.deepEqual(COMMANDS['epic render'].argv({ file: 'docs/x/epic-a.md' }), ['epic', 'render', 'docs/x/epic-a.md']);
  for (const bad of ['../epic.md', '/etc/epic.md', '-x.md', 'docs/epic.txt', 'a b.md']) assert.ok(checkCommand({ command: 'epic render', file: bad }).refused, bad);
  assert.ok(checkCommand({ command: 'epic render' }).refused);
  assert.ok(checkCommand({ command: 'status', file: 'docs/a.md' }).refused);
  // 32's /mirai show <initiative> --docs, which the session refused until now.
  assert.deepEqual(checkCommand({ command: 'show', ticket: 'due-dates', docs: true }).args, { command: 'show', ticket: 'due-dates', docs: true });
});

test('33 T3: the graph lint: each failure caught on a seeded set, naming the ticket and the fix', () => {
  // A cycle in after.
  const cycle = seeded(withTicket('SAMPLE-51', (t) => swap(t, 'after: []', 'after: [SAMPLE-54]')));
  assert.match(graph(cycle, 'graph-cycle').map((p) => `${p.reason} | ${p.hint}`).join('\n'), /^a cycle in after: SAMPLE-51 → SAMPLE-53 → SAMPLE-54 → SAMPLE-51 \| remove the after entry that isn't a real prerequisite/);
  // An after naming a ticket that doesn't exist.
  const unknown = seeded(withTicket('SAMPLE-52', (t) => swap(t, 'after: [SAMPLE-51]', 'after: [SAMPLE-51, SAMPLE-99]')));
  assert.match(graph(unknown, 'graph-after')[0].reason, /SAMPLE-52's after names SAMPLE-99, which isn't a ticket in tickets\//);
  // An uncovered Failures AC, and an uncovered Unchanged behaviour FR.
  const failures = seeded(withTicket('SAMPLE-54', (t) => swap(t, 'covers_ac: [AC-FR-7.1]', 'covers_ac: []')));
  assert.deepEqual(graph(failures, 'graph-coverage').map((p) => `${p.reason} | ${p.hint}`), ['AC-FR-7.1 (an AC of FR-7, Failures) isn\'t covered by any ticket | add AC-FR-7.1 to the covers_ac of the ticket that builds it, or add a ticket for it; never drop it to fit']);
  const unchanged = seeded(withTicket('SAMPLE-51', (t) => swap(t, 'covers_fr: [FR-1, FR-9]', 'covers_fr: [FR-1]')));
  assert.deepEqual(graph(unchanged, 'graph-coverage').map((p) => p.reason), ['FR-9 (Unchanged behaviour) isn\'t covered by any ticket']);
  const nfr = seeded(withTicket('SAMPLE-57', (t) => swap(t, 'covers_fr: [FR-2, NFR-1]', 'covers_fr: [FR-2]')));
  assert.deepEqual(graph(nfr, 'graph-coverage').map((p) => p.reason), ['NFR-1 (Non-functional) isn\'t covered by any ticket']);
  // A ticket covering an ID the PRD doesn't define.
  const extra = seeded(withTicket('SAMPLE-52', (t) => swap(t, 'covers_fr: [FR-6]', 'covers_fr: [FR-6, FR-12]')));
  assert.match(graph(extra, 'graph-unknown-id').map((p) => p.reason).join('\n'), /^SAMPLE-52 covers FR-12, which the PRD doesn't define$/);
  // An XL size.
  const xl = seeded(withTicket('SAMPLE-53', (t) => swap(t, 'size: L', 'size: XL')));
  assert.match(graph(xl, 'graph-size').map((p) => `${p.reason} | ${p.hint}`).join('\n'), /^SAMPLE-53 is size XL; a ticket is S, M or L \| split SAMPLE-53 into tickets of size L or smaller/);
  // A 21st ticket fails; a 16th warns.
  let many = TICKETS;
  for (let n = 58; n <= 71; n++) many = withTicket(`SAMPLE-${n}`, ticket(`SAMPLE-${n}`), many);
  const over = seeded(many);
  assert.equal(Object.keys(many).length, 21);
  assert.deepEqual(graph(over, 'graph-cap').map((p) => `${p.reason} | ${p.hint}`), ['the epic has 21 tickets; the cap is 20 | split the PRD into two, or move the work to the full track with several epics; never merge tickets to fit the cap']);
  let sixteen = TICKETS;
  for (let n = 58; n <= 66; n++) sixteen = withTicket(`SAMPLE-${n}`, ticket(`SAMPLE-${n}`), sixteen);
  const near = seeded(sixteen);
  assert.deepEqual(errors(near.text, { tickets: sixteen }), []);
  assert.deepEqual(warnings(near.text, { tickets: sixteen }).map((p) => p.reason), ['the epic has 16 tickets, close to the cap of 20']);
  // A sixth L ticket.
  let large = TICKETS;
  for (const k of ['SAMPLE-51', 'SAMPLE-54', 'SAMPLE-57']) large = withTicket(k, (t) => swap(t, 'size: M', 'size: L'), large);
  for (const k of ['SAMPLE-52', 'SAMPLE-55']) large = withTicket(k, (t) => swap(t, 'size: S', 'size: L'), large);
  assert.deepEqual(graph(seeded(large), 'graph-cap').map((p) => p.reason), ['the epic has 6 L tickets (SAMPLE-51, SAMPLE-52, SAMPLE-53, SAMPLE-54, SAMPLE-55, SAMPLE-57); the cap is 5']);
  // A third stacking level, and stacking across epics.
  const deep = seeded(withTicket('SAMPLE-57', (t) => swap(t, 'after: [SAMPLE-56]', 'after: [SAMPLE-56, SAMPLE-54]')));
  assert.deepEqual(graph(deep, 'graph-stacking').map((p) => `${p.reason} | ${p.hint}`), ['SAMPLE-57 stacks 3 levels deep (SAMPLE-51 → SAMPLE-53 → SAMPLE-54 → SAMPLE-57); stacking is at most 2 levels | let SAMPLE-57 wait only for what it really needs, or split the chain over two epics (design/01 §6)']);
  const across = seeded(withTicket('SAMPLE-80', ticket('SAMPLE-80', { epic: 'SAMPLE-79' }), withTicket('SAMPLE-52', (t) => swap(t, 'after: [SAMPLE-51]', 'after: [SAMPLE-51, SAMPLE-80]'))));
  assert.match(graph(across, 'graph-stacking').map((p) => p.reason).join('\n'), /^SAMPLE-52 waits for SAMPLE-80, which is in another epic \(SAMPLE-79\)$/);
  // A ticket with no AC, and one with no verify line.
  const noAc = seeded(withTicket('SAMPLE-52', (t) => t.replace(/- AC-SAMPLE-52\.(\d): /g, '- ')));
  assert.match(graph(noAc, 'graph-ac').map((p) => `${p.reason} | ${p.hint}`).join('\n'), /^SAMPLE-52 has no acceptance criterion \| add AC-SAMPLE-52\.1 under "## Acceptance criteria" in tickets\/SAMPLE-52\.md/);
  const noVerify = seeded(withTicket('SAMPLE-52', (t) => t.replace(/^verify: .*\n/m, '')));
  assert.match(graph(noVerify, 'graph-verify').map((p) => p.reason).join('\n'), /^SAMPLE-52 has no verify line$/);
  // A ticket that covers nothing of the PRD.
  const nothing = seeded(withTicket('SAMPLE-90', ticket('SAMPLE-90', { fr: [], ac: [] })));
  assert.match(graph(nothing, 'graph-unknown-id').map((p) => p.reason).join('\n'), /^SAMPLE-90 covers no PRD requirement$/);
  // Warn: the same file in two tickets with no after between them.
  const files = seeded(withTicket('SAMPLE-52', (t) => swap(t, 'files_likely: [app/Http/Requests/UpdateTaskDueDate.php', 'files_likely: [app/Mail/DueReminder.php, app/Http/Requests/UpdateTaskDueDate.php')));
  assert.deepEqual(errors(files.text, { tickets: files.tickets }), []);
  assert.deepEqual(warnings(files.text, { tickets: files.tickets }).map((p) => `${p.reason} | ${p.hint}`), [
    'SAMPLE-52 and SAMPLE-53 both list app/Mail/DueReminder.php in files_likely, with no after between them | if one must go first, add after: [SAMPLE-52] to SAMPLE-53; else check the two changes can\'t clash',
    'SAMPLE-52 and SAMPLE-54 both list app/Mail/DueReminder.php in files_likely, with no after between them | if one must go first, add after: [SAMPLE-52] to SAMPLE-54; else check the two changes can\'t clash',
  ]);
  // No ticket at all.
  assert.match(graph(seeded({}), 'graph-tickets')[0].reason, /no ticket names this epic: tickets\/ holds no file with epic: SAMPLE-50/);
});

test('33 T4: "Decisions for you" lists each ticket that needs your call, and the release mode when it is together', () => {
  const listed = '1. SAMPLE-53 is high risk and has an end-to-end test';
  // The example lists SAMPLE-53 (risk: high, e2e: true); without the item it fails.
  one(rendered(swap(EPIC, `${listed}: a fault in the nightly job would email every assignee. Options: keep both, or drop the end-to-end test. Recommendation: keep both; its plan then always comes to you.`, 'None — nothing here needs your call.'), TICKETS), 'epic-decision', /SAMPLE-53 is risk: high, e2e: true, but "Decisions for you" doesn't list it \| add an item naming SAMPLE-53 with a one-line reason/);
  // A risk: high ticket not listed.
  const high = seeded(withTicket('SAMPLE-55', (t) => swap(t, 'risk: normal', 'risk: high')));
  one(high.text, 'epic-decision', /^SAMPLE-55 is risk: high, but "Decisions for you" doesn't list it/, { tickets: high.tickets });
  // An e2e: true ticket not listed.
  const e2e = seeded(withTicket('SAMPLE-56', (t) => swap(t, 'e2e: false', 'e2e: true')));
  one(e2e.text, 'epic-decision', /^SAMPLE-56 is e2e: true, but/, { tickets: e2e.tickets });
  // A tdd or tests override not listed.
  const tdd = seeded(withTicket('SAMPLE-52', (t) => swap(t, 'e2e: false', 'e2e: false\ntdd: after\ntests: optional')));
  one(tdd.text, 'epic-decision', /^SAMPLE-52 is tdd: after, tests: optional, but/, { tickets: tdd.tickets });
  // Listed by its key, it passes.
  const asked = swap(tdd.text, `${listed}`, '1. SAMPLE-52 checks a date rule only, so its tests come after the code. Approve tdd: after?\n2. SAMPLE-53 is high risk and has an end-to-end test');
  assert.deepEqual(errors(asked, { tickets: tdd.tickets }), []);
  // release: together, without a decision item, fails; "## Release" must name it too.
  const together = swap(EPIC, 'release: per-ticket', 'release: together');
  const t = errors(together);
  assert.deepEqual(codes(t), ['epic-decision', 'epic-release'], JSON.stringify(t));
  assert.match(t[0].reason, /the release mode is together, but "Decisions for you" doesn't ask you/);
  assert.match(t[1].reason, /"## Release" doesn't name the epic's release mode, together/);
  const fixed = swap(swap(together, 'The release mode is `per-ticket`: each ticket goes live on its own once you merge it.', 'The release mode is `together`: the epic goes live as one piece.'),
    'Recommendation: keep both; its plan then always comes to you.\n', 'Recommendation: keep both; its plan then always comes to you.\n2. Release the epic together, not per ticket? Reminders and dates go live as one piece. Recommendation: together.\n');
  assert.deepEqual(errors(fixed), []);
});

test('33 T5: the link lines: no PRD line fails, full without Design fails, a broken Design link fails', async () => {
  // No PRD: line.
  one(swap(EPIC, 'PRD: [Tasks with due dates that people finish on time](prd.md)\n\n', ''), 'upstream-link', /the line under the title must link the prd: "PRD: \[<its title>\]\(prd\.md\)"/);
  // The PRD: line linking a brief.
  one(EPIC, 'upstream-link', /prd\.md is a brief, not a prd/, { prd: BRIEF });
  // full without Design:.
  const full = swap(EPIC, 'track: standard', 'track: full');
  one(full, 'upstream-link', /on the full track the epic links its design: add "Design: \[<its title>\]\(<file>\.md\)" under the PRD line/);
  const withDesign = swap(full, '(prd.md)\n', '(prd.md)\nDesign: [HLD](../../design/hld.md), [LLD for reminders](../../design/lld-reminders.md)\n');
  assert.deepEqual(errors(withDesign), []);
  // On standard, Design: is required once a ticket names an ADR.
  const adr = seeded(withTicket('SAMPLE-53', (t) => swap(t, 'governed_by: []', 'governed_by: [ADR-1]')));
  one(adr.text, 'upstream-link', /SAMPLE-53 names ADR-1 in governed_by, so the epic links its design/, { tickets: adr.tickets });
  assert.match(adr.text, /^- \[ADR-1\]\(adr\/ADR-1\.md\): governs SAMPLE-53\.$/m);
  // The link lines are in the type's order.
  one(swap(withDesign, 'PRD: [Tasks with due dates that people finish on time](prd.md)\nDesign: [HLD](../../design/hld.md), [LLD for reminders](../../design/lld-reminders.md)\n', 'Design: [HLD](../../design/hld.md)\nPRD: [Tasks with due dates that people finish on time](prd.md)\n'), 'upstream-link', /out of order/);
  // A broken Design: link fails through mirai lint; once the files exist, it's clean.
  const r = repo({ epic: withDesign, files: { 'docs/design/hld.md': '# HLD\n' } });
  const broken = await r.run('lint', '--json');
  assert.equal(broken.code, EXIT.FAILURE);
  const line = withDesign.split('\n').findIndex((l) => l.startsWith('Design: ')) + 1;
  assert.deepEqual(JSON.parse(broken.out).problems.map((p) => `${p.file}:${p.line} ${p.code}`), [`docs/mirai/due-dates/epic-due-dates.md:${line} missing-file`]);
  writeFileSync(join(r.root, 'docs', 'design', 'lld-reminders.md'), '# LLD\n');
  assert.equal((await r.run('lint')).code, EXIT.OK);
});

const MINIMAL = 'schema_version = 1\n[git]\nintegration_branch = "main"\n';
function configFiles({ project = MINIMAL, personal } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mirai-33-config-'));
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

test('33 T6: the caps from [docs.limits]: a project value moves each one; out of range is refused; a personal file can\'t set them', () => {
  const limits = (l) => ({ project: { repos: ['.'], limits: l } });
  one(EPIC, 'graph-cap', /^the epic has 7 tickets; the cap is 6/, limits({ epic_tickets: 6 }));
  assert.deepEqual(codes(warnings(EPIC, limits({ epic_tickets: 8 }))), ['graph-cap']);
  one(EPIC, 'graph-cap', /^the epic has 1 L tickets \(SAMPLE-53\); the cap is 0/, limits({ epic_l_tickets: 0 }));
  one(EPIC, 'writing-budget', /a epic's budget is 150/, limits({ epic_summary_words: 150 }));
  assert.deepEqual(codes(warnings(EPIC, limits({ epic_summary_warn_words: 150 }))), ['writing-budget']);
  // The defaults: 400 words fail, from 300 a warning (the example is under both).
  const extra = Array.from({ length: 20 }, () => '- Team leads get an overdue page for their own team (SAMPLE-57; FR-2).').join('\n');
  const long = swap(EPIC, '- Tasks without a date look and sort as they do today (SAMPLE-51; FR-9).\n', `- Tasks without a date look and sort as they do today (SAMPLE-51; FR-9).\n${extra}\n`);
  assert.match(errors(long).find((p) => p.code === 'writing-budget')?.reason ?? '', /a epic's budget is 400/);
  const some = swap(EPIC, '- Tasks without a date look and sort as they do today (SAMPLE-51; FR-9).\n', `- Tasks without a date look and sort as they do today (SAMPLE-51; FR-9).\n${extra.split('\n').slice(0, 7).join('\n')}\n`);
  assert.deepEqual(errors(some), []);
  assert.match(warnings(some).map((p) => p.reason).join('\n'), /close to the epic's budget of 400/);
  // The config: project values in range, refused out of range, never from a personal file.
  const { config } = loadConfig(configFiles({ project: `${MINIMAL}[docs.limits]\nepic_tickets = 12\nepic_l_tickets = 3\nepic_summary_words = 500\nepic_summary_warn_words = 350\n` }));
  assert.deepEqual(config.docs.limits, { epic_tickets: 12, epic_l_tickets: 3, epic_summary_words: 500, epic_summary_warn_words: 350 });
  for (const [key, value] of [['epic_tickets', 999], ['epic_tickets', 1], ['epic_l_tickets', 99], ['epic_summary_words', 50], ['epic_summary_warn_words', 5000]]) {
    assert.match(configProblems({ project: `${MINIMAL}[docs.limits]\n${key} = ${value}\n` }).join('\n'), new RegExp(key), `${key} = ${value}`);
  }
  assert.match(configProblems({ personal: 'schema_version = 1\n[docs.limits]\nepic_tickets = 40\n' }).join('\n'), /docs\.limits can't be set in a personal file|docs can't be set in a personal file/);
});

// The pair ready to approve (32's T7): the brief's Q-1 answered in both files.
const BRIEF_READY = swap(swap(BRIEF,
  '1. How should reminders reach people (Q-1)? Options: email only, or email and an in-app notice. Recommendation: email only, because the app has no notification system yet; an in-app notice would double the work.\n',
  'None — the reminder channel was settled in review: email only (BR-2).\n'),
  '- Q-1: How should reminders reach people: email only, or email and an in-app notice? The approver answers; it blocks the PRD\'s notification requirements.\n', '');
const PRD_READY = swap(swap(PRD,
  '1. How should reminders reach people (Q-1)? Options: email only, or email and an in-app notice. Recommendation: email only, because the app has no notification system yet; an in-app notice would double the work. This PRD is written for email only (A-1).\n',
  'None — the reminder channel was settled in review: email only (A-1).\n'),
  'the recommendation for the brief\'s Q-1.', 'as settled in review.');

async function tty(argv, { cwd, env }, answers) {
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd });
  return { code, out, err };
}

const D = 'docs/mirai/due-dates';
function setFixture() {
  const files = { [`${D}/brief.md`]: BRIEF_READY, [`${D}/prd.md`]: PRD_READY, [`${D}/epic-due-dates.md`]: EPIC };
  for (const [path, text] of Object.entries(TICKETS)) files[`${D}/${path}`] = text;
  const f = installed({ files });
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  return { ...f, io: { cwd: f.root, env: f.env }, at: (rel) => join(f.root, D, rel) };
}
const APPROVE_EPIC = ['approve', 'SAMPLE-50', '--file', `${D}/epic-due-dates.md`];
const APPROVE_PRD = ['approve', 'due-dates-prd', '--file', `${D}/prd.md`];
const ticketBytes = (f) => Object.keys(TICKETS).map((p) => ({ path: `${D}/${p}`, bytes: readFileSync(f.at(p)) }));

test('33 T7: approving the epic: one decision signs the epic and every ticket; a changed ticket makes it stale; a graph-lint error refuses it', async () => {
  assert.deepEqual(errors(EPIC, { prd: PRD_READY, approving: true }), []);
  const f = setFixture();
  const store = openStore({ cwd: f.root, env: f.env });
  const lines = () => readJournal(store).events.length;
  // A graph-lint error refuses it: the problem listed, nothing written.
  writeFileSync(f.at('tickets/SAMPLE-51.md'), swap(TICKETS[T('SAMPLE-51')], 'after: []', 'after: [SAMPLE-54]'));
  const before = lines();
  const cyclic = await tty(APPROVE_EPIC, f.io, ['a', 'SAMPLE-50']);
  assert.equal(cyclic.code, EXIT.BLOCKED, cyclic.out);
  assert.match(cyclic.err, /^docs\/mirai\/due-dates\/epic-due-dates\.md:[0-9]+: a cycle in after: SAMPLE-51 → SAMPLE-53 → SAMPLE-54 → SAMPLE-51/m);
  assert.match(cyclic.err, /can't be approved yet: [0-9]+ lint problems, listed above; nothing was written/);
  assert.equal(lines(), before);
  // A ticket's own lint problem refuses it too.
  writeFileSync(f.at('tickets/SAMPLE-51.md'), swap(TICKETS[T('SAMPLE-51')], 'repo: "."', 'repo: web'));
  const badTicket = await tty(APPROVE_EPIC, f.io, ['a', 'SAMPLE-50']);
  assert.equal(badTicket.code, EXIT.BLOCKED);
  assert.match(badTicket.err, /^docs\/mirai\/due-dates\/tickets\/SAMPLE-51\.md:[0-9]+: "repo" is not one of the repos in the config/m);
  writeFileSync(f.at('tickets/SAMPLE-51.md'), TICKETS[T('SAMPLE-51')]);
  // The PRD is approved first (as a full PRD waits for its brief).
  const early = await tty(APPROVE_EPIC, f.io, ['a', 'SAMPLE-50']);
  assert.equal(early.code, EXIT.BLOCKED, early.out);
  assert.match(early.err, /the PRD due-dates-prd isn't approved; its tickets are approved after it; nothing was written/);
  assert.match(early.err, /mirai approve due-dates-prd --file docs\/mirai\/due-dates\/prd\.md/);
  assert.equal(lines(), before);
  assert.equal((await tty(APPROVE_PRD, f.io, ['a', 'due-dates-prd'])).code, EXIT.OK);
  // One decision, one signed line over the epic and its seven tickets.
  const n = lines();
  const ok = await tty(APPROVE_EPIC, f.io, ['a', 'SAMPLE-50']);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.match(ok.out, /^epic: +SAMPLE-50\nfile: +docs\/mirai\/due-dates\/epic-due-dates\.md\nhash: +sha256:[0-9a-f]+\nprd: +due-dates-prd \(approved, as it is now\)\ntickets: 7, signed with the epic\n/);
  assert.match(ok.out, /^ {2}docs\/mirai\/due-dates\/tickets\/SAMPLE-53\.md {3}sha256:/m);
  assert.match(ok.out, new RegExp(`^${join(realpathSync(f.root), D, 'epic-due-dates.md').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.match(ok.out, /approved: the epic SAMPLE-50 and its 7 tickets, as they are now \(accepted; signed with k-[0-9a-f]+, seq [0-9]+\); a change to any of them needs a new approval/);
  assert.equal(lines(), n + 1);
  const e = readJournal(store).events.at(-1);
  assert.deepEqual([e.kind, e.item, e.path, e.content_hash, e.decision], ['epic', 'SAMPLE-50', `${D}/epic-due-dates.md`, contentHash(Buffer.from(EPIC)), 'accepted']);
  assert.deepEqual(e.files, Object.entries(TICKETS).map(([p, t]) => ({ path: `${D}/${p}`, content_hash: contentHash(Buffer.from(t)) })));
  assert.ok(e.signature);
  assert.equal(epicApproval(store, 'SAMPLE-50', Buffer.from(EPIC), ticketBytes(f)).approved, true);
  // A changed ticket makes the approval stale; so does a ticket joining the epic.
  writeFileSync(f.at('tickets/SAMPLE-55.md'), swap(TICKETS[T('SAMPLE-55')], 'size: S', 'size: M'));
  assert.deepEqual(epicApproval(store, 'SAMPLE-50', Buffer.from(EPIC), ticketBytes(f)), { approved: false, stale: true, seq: e.seq });
  writeFileSync(f.at('tickets/SAMPLE-55.md'), TICKETS[T('SAMPLE-55')]);
  assert.equal(epicApproval(store, 'SAMPLE-50', Buffer.from(EPIC), ticketBytes(f)).approved, true);
  assert.equal(epicApproval(store, 'SAMPLE-50', Buffer.from(EPIC), [...ticketBytes(f), { path: `${D}/tickets/SAMPLE-58.md`, bytes: Buffer.from('x') }]).stale, true);
  // A changed epic too.
  assert.equal(epicApproval(store, 'SAMPLE-50', Buffer.from(`${EPIC}\n`), ticketBytes(f)).stale, true);
});

test('33 T8: mirai show due-dates lists the brief, the PRD and the epic, each with its state and full path; the epic line gives its ticket count', async () => {
  const f = setFixture();
  const dir = join(realpathSync(f.root), 'docs', 'mirai', 'due-dates');
  const show = async () => tty(['show', 'due-dates'], f.io, []);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const first = await show();
  assert.equal(first.code, EXIT.OK, first.err);
  assert.match(first.out, /^due-dates {3}standard\n/);
  assert.match(first.out, new RegExp(`^  brief\\.md +brief +due-dates-brief +not approved +${esc(join(dir, 'brief.md'))}$`, 'm'));
  assert.match(first.out, new RegExp(`^  prd\\.md +prd +due-dates-prd +not approved +${esc(join(dir, 'prd.md'))}$`, 'm'));
  assert.match(first.out, new RegExp(`^  epic-due-dates\\.md +epic \\(7 tickets\\) +SAMPLE-50 +not approved +${esc(join(dir, 'epic-due-dates.md'))}$`, 'm'));
  assert.equal(first.out.split('\n').filter(Boolean).length, 4, 'the tickets are counted on the epic line, not listed');
  assert.equal((await tty(APPROVE_PRD, f.io, ['a', 'due-dates-prd'])).code, EXIT.OK);
  assert.equal((await tty(APPROVE_EPIC, f.io, ['a', 'SAMPLE-50'])).code, EXIT.OK);
  const after = await show();
  assert.match(after.out, /^ {2}prd\.md +prd +due-dates-prd +approved +\//m);
  assert.match(after.out, /^ {2}epic-due-dates\.md +epic \(7 tickets\) +SAMPLE-50 +approved +\//m);
  // A changed ticket shows on the epic's line.
  writeFileSync(f.at('tickets/SAMPLE-56.md'), swap(TICKETS[T('SAMPLE-56')], 'size: S', 'size: M'));
  assert.match((await show()).out, /^ {2}epic-due-dates\.md +epic \(7 tickets\) +SAMPLE-50 +changed since approval +\//m);
});
