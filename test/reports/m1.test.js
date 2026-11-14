import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { classifyTicket, m1, m1Line, m1Rate } from '../../src/reports/m1.js';
import { tempDir } from '../tests/run-fixture.js';

// Unit 29a, decision 2: M1 compares the code (the proofs' code hash), not the commits. A real git
// repo; the MR's final head, MIRAI's last push and the merge commit are what the journal (or the
// host) would give.

const CODE = ['**', '!docs/**', '!.mirai/**'];
const ENV = { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

function repo() {
  const root = tempDir('m1');
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd: root, env: ENV }).toString().trim();
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const commit = (msg) => {
    git('add', '-A');
    git('commit', '-q', '-m', msg);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'main');
  put('app/a.php', 'one\ntwo\nthree\n');
  put('app/b.php', 'b1\n');
  put('docs/readme.md', 'docs\n');
  commit('base');
  return { root, git, put, commit };
}

// MIRAI's branch: one code change, pushed. Returns the pushed sha.
function miraiBranch(r, name = 'feature/T-1') {
  r.git('switch', '-q', '-c', name, 'main');
  r.put('app/a.php', 'one\nTWO\nthree\n');
  return r.commit('T-1: build');
}

const merge = (r, branch) => {
  r.git('switch', '-q', 'main');
  r.git('merge', '-q', '--no-ff', '-m', 'Merge pull request #1', branch);
  return r.git('rev-parse', 'HEAD');
};
const classify = (r, facts) => classifyTicket({ root: r.root, env: ENV, ticket: 'T-1', facts: { mr: 'merged', mergedInto: 'integration', number: 1, url: 'https://github.com/a/b/pull/1', ...facts }, codePaths: CODE, integration: 'main' });

test('29a M1: merged at MIRAI\'s push is as is; a hand code commit is edited; a docs-only commit is not', () => {
  const r = repo();
  const pushed = miraiBranch(r);
  assert.equal(classify(r, { lastPush: pushed, finalHead: pushed }).class, 'as-is');

  // A hand commit that changes code, then merged.
  r.put('app/b.php', 'b1\nby hand\n');
  const edited = r.commit('by hand');
  const m = merge(r, 'feature/T-1');
  assert.equal(classify(r, { lastPush: pushed, finalHead: edited, mergeSha: m }).class, 'edited');
  // The merge commit found on main when the host didn't name it.
  assert.equal(classify(r, { lastPush: pushed, finalHead: edited }).class, 'edited');

  // A docs-only hand commit (outside gate.code_paths) is still as is.
  const r2 = repo();
  const p2 = miraiBranch(r2);
  r2.put('docs/readme.md', 'docs\nmore\n');
  const docs = r2.commit('docs by hand');
  merge(r2, 'feature/T-1');
  assert.equal(classify(r2, { lastPush: p2, finalHead: docs }).class, 'as-is');
});

test('29a M1: a rebase onto a moved main, GitHub\'s "Update branch" and a squash keep the code: as is', () => {
  // Rebase: main moves (another file), the branch is rebased by hand, then merged.
  const r = repo();
  const pushed = miraiBranch(r);
  r.git('switch', '-q', 'main');
  r.put('app/b.php', 'b1\nmain moved\n');
  r.commit('main moves');
  r.git('switch', '-q', 'feature/T-1');
  r.git('rebase', '-q', 'main');
  const rebased = r.git('rev-parse', 'HEAD');
  assert.notEqual(rebased, pushed);
  merge(r, 'feature/T-1');
  assert.equal(classify(r, { lastPush: pushed, finalHead: rebased }).class, 'as-is');

  // Update branch: main merged into the branch, then the branch merged.
  const u = repo();
  const up = miraiBranch(u);
  u.git('switch', '-q', 'main');
  u.put('app/b.php', 'b1\nmain moved\n');
  u.commit('main moves');
  u.git('switch', '-q', 'feature/T-1');
  u.git('merge', '-q', '--no-ff', '-m', 'Merge branch main into feature/T-1', 'main');
  const updated = u.git('rev-parse', 'HEAD');
  merge(u, 'feature/T-1');
  assert.equal(classify(u, { lastPush: up, finalHead: updated }).class, 'as-is');

  // Squash: the host names the squash commit, which has one parent (main before).
  const q = repo();
  const qp = miraiBranch(q);
  q.git('switch', '-q', 'main');
  q.git('merge', '-q', '--squash', 'feature/T-1');
  q.git('commit', '-q', '-m', 'T-1 (#1)');
  const squash = q.git('rev-parse', 'HEAD');
  // The final head differs from the push only by a docs commit: still as is.
  q.git('switch', '-q', 'feature/T-1');
  q.put('docs/readme.md', 'docs\nnote\n');
  const head = q.commit('docs');
  assert.equal(classify(q, { lastPush: qp, finalHead: head, mergeSha: squash }).class, 'as-is');
  // Without the host's squash commit, there's no merge of the head on main: unknown, said why.
  const unknown = classify(q, { lastPush: qp, finalHead: head });
  assert.equal(unknown.class, 'unknown');
  assert.match(unknown.why, /no merge of [0-9a-f]{7} on main/);
});

test('29a M1: closed, unknown, epics, and the rate (unknown left out)', () => {
  const r = repo();
  const pushed = miraiBranch(r);
  const base = { root: r.root, env: ENV, ticket: 'T-1', codePaths: CODE, integration: 'main' };
  assert.equal(classifyTicket({ ...base, facts: { mr: 'closed', number: 1, url: 'https://github.com/a/b/pull/1' } }).class, 'closed');
  assert.equal(classifyTicket({ ...base, facts: { mr: 'open', lastPush: pushed } }), null);
  assert.equal(classifyTicket({ ...base, facts: { mr: 'none' } }), null);
  const noHead = classifyTicket({ ...base, facts: { mr: 'merged', mergedInto: 'integration', lastPush: pushed, number: 1 } });
  assert.deepEqual([noHead.class, /mirai report --m1/.test(noHead.why)], ['unknown', true]);
  assert.match(classifyTicket({ ...base, facts: { mr: 'merged', mergedInto: 'integration' } }).why, /no push of its own/);
  assert.match(classifyTicket({ ...base, facts: { mr: 'merged', mergedInto: 'epic', lastPush: pushed } }).why, /epic/);
  assert.match(classifyTicket({ ...base, facts: { mr: 'merged', mergedInto: 'integration', lastPush: pushed, finalHead: 'f'.repeat(40) } }).why, /isn't in this clone/);

  const rate = m1Rate([{ class: 'as-is' }, { class: 'as-is' }, { class: 'as-is' }, { class: 'edited' }, { class: 'closed' }, { class: 'unknown' }]);
  assert.deepEqual(rate, { merged: 4, asIs: 3, edited: 1, closed: 1, unknown: 1, rate: 0.75 });
  assert.equal(m1Line(rate), 'M1: 3 of 4 merged as is (75%) · 1 edited · 1 closed · 1 unknown');
  assert.equal(m1Line(m1Rate([])), 'M1: no merged or closed MR yet');

  // m1() over journal-shaped events: MIRAI's push, the MR opened, merged with its head.
  const events = [
    { seq: 1, type: 'pushed', ticket: 'T-1', branch: 'feature/T-1', sha: pushed, proofs: 'pass' },
    { seq: 2, type: 'mr_opened', ticket: 'T-1', head: pushed, target: 'main', number: 1, url: 'https://github.com/a/b/pull/1' },
    { seq: 3, type: 'mr_merged', ticket: 'T-1', target: 'integration', head: pushed },
    { seq: 4, type: 'mr_opened', ticket: 'T-2', head: pushed, target: 'main', number: 2, url: 'https://github.com/a/b/pull/2' },
    { seq: 5, type: 'mr_closed', ticket: 'T-2' },
  ];
  const all = m1({ root: r.root, env: ENV, events, codePaths: CODE, integration: 'main' });
  assert.deepEqual(all.rows.map((x) => [x.ticket, x.class, x.mr.url]), [['T-1', 'as-is', 'https://github.com/a/b/pull/1'], ['T-2', 'closed', 'https://github.com/a/b/pull/2']]);
  assert.equal(m1Line(all.rate), 'M1: 1 of 1 merged as is (100%) · 0 edited · 1 closed');
});
