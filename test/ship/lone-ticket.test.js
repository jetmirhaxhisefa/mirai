import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { hostFor, TOOLS_FILE } from '../../src/ship/host.js';
import { loneTicketFile, shipTicket } from '../../src/ship/ship.js';
import { readJournal } from '../../src/store/journal.js';
import { passed } from '../proofs/fixture.js';
import { tempDir } from '../tests/run-fixture.js';
import { needsTest } from '../helpers/needs.js';
import { fakeGh } from '../helpers/fake-hosts.js';

// Unit 38 T7 (Jet's decision 6): a lone ticket's own file rides with its code in the code merge
// request, and the proof still matches (the docs root is outside gate.code_paths); a code MR never
// carries an initiative's documents, which reach main through their docs merge request.

const launchTest = needsTest('macos', 'an agent launch: its scratch folder is macOS\'s /private/tmp (src/launch/strict.js; P01)');
const REMOTE = 'https://github.com/acme/app.git';

async function shippable() {
  const f = await passed();
  assert.equal((await f.record()).outcome, 'recorded');
  const bare = join(tempDir('host'), 'app.git');
  execFileSync('/usr/bin/git', ['init', '-q', '--bare', '-b', 'main', bare]);
  f.git('push', '-q', bare, 'main');
  const gh = fakeGh(bare);
  writeFileSync(join(f.store.dir, TOOLS_FILE), JSON.stringify({ schema_version: 1, github: gh.path }));
  const hostOf = (a) => ({ ...hostFor({ ...a, remoteUrl: REMOTE }), pushUrl: bare });
  const ship = () => shipTicket({ cwd: f.root, env: f.env, ticket: 'PMT-31', hostOf });
  const bareGit = (...a) => execFileSync('/usr/bin/git', ['--git-dir', bare, ...a]).toString().trim();
  return { ...f, bare, gh, ship, bareGit };
}

launchTest('38 T7: a lone ticket\'s own file rides in its code MR with the proof unchanged; an initiative\'s document on a code branch is refused', async () => {
  const f = await shippable();
  // PMT-31 lives in docs/mirai/tickets/: no initiative.
  const events = readJournal(f.store).events;
  assert.equal(loneTicketFile(events, 'PMT-31', 'docs/mirai'), 'docs/mirai/tickets/PMT-31.md');
  assert.equal(loneTicketFile([{ type: 'approval', by: 'human', kind: 'ticket', item: 'SAMPLE-51', decision: 'accepted', path: 'docs/mirai/due-dates/tickets/SAMPLE-51.md' }], 'SAMPLE-51', 'docs/mirai'), null);
  // The ticket's own file changes on its branch (the ticket's notes, say): the proof still matches,
  // and the MR carries the fix and the ticket file.
  const ticketPath = join(f.root, 'docs', 'mirai', 'tickets', 'PMT-31.md');
  writeFileSync(ticketPath, `${readFileSync(ticketPath, 'utf8')}\n## Notes\n\nFixed on its branch.\n`);
  f.git('add', '-A');
  f.git('commit', '-qm', 'PMT-31: the ticket file with its code', '-m', 'Mirai-Ticket: PMT-31');
  const head = f.git('rev-parse', 'HEAD');
  assert.equal(f.check(head).outcome, 'pass', 'the docs root is outside the code paths');
  const r = await f.ship();
  assert.equal(r.outcome, 'opened');
  const files = f.bareGit('diff', '--name-only', 'main', r.head).split('\n');
  assert.ok(files.includes('docs/mirai/tickets/PMT-31.md'), files.join(', '));
  assert.ok(files.includes('app/Team.php'), files.join(', '));

  // An initiative's document on the code branch: refused before anything is pushed.
  mkdirSync(join(f.root, 'docs', 'mirai', 'due-dates'), { recursive: true });
  writeFileSync(join(f.root, 'docs', 'mirai', 'due-dates', 'prd.md'), '# a PRD\n');
  f.git('add', '-A');
  f.git('commit', '-qm', 'PMT-31: a PRD on a code branch', '-m', 'Mirai-Ticket: PMT-31');
  assert.equal(f.check(f.git('rev-parse', 'HEAD')).outcome, 'pass');
  await assert.rejects(f.ship(), (err) => {
    assert.equal(err.code, 'docs-in-code-mr');
    assert.match(err.message, /changes 1 document under docs\/mirai\/ \(docs\/mirai\/due-dates\/prd\.md\): a ticket's code MR doesn't carry documents/);
    assert.match(err.hint, /mirai docs publish <initiative>/);
    return true;
  });
  assert.equal(f.bareGit('rev-parse', `refs/heads/${r.branch}`), r.head, 'nothing pushed');
});
