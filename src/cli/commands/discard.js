import { readFileSync } from 'node:fs';

import { EXIT } from '../exit-codes.js';
import { MiraiError } from '../errors.js';
import { checkTicketArg, confirmByTyping } from '../human-move.js';
import { createPrompter, requireTty } from '../tty.js';
import { buildRecordPath } from '../../agent/build.js';
import { lastCheckpoint } from '../../agent/checkpoints.js';
import { plain } from '../../status/text.js';
import { atomicWrite } from '../../store/files.js';
import { commitOf, commitsSince, isAncestor, resetTo, symbolicBranch, workTreeChanges } from '../../store/git.js';
import { readTicketStatus } from '../../store/tickets.js';
import { withRun } from '../../agent/run.js';
import { openStore } from '../../store/home.js';
import { appendEvent } from '../../store/journal.js';
import { ignoredFingerprint, protectionRules } from '../../trust/protected.js';
import { snapshot, trustedConfig, trustedRegistry } from '../../trust/snapshot.js';

// mirai discard <ticket> (unit 22; design/01 §7 step 1, R-M6): throws the ticket's last step
// away. In a real terminal, with the ticket's key typed back, holding the run lock (never under a
// running build): the ticket's branch goes back to its last checkpoint, and new files git sees are
// removed. Ignored files are never deleted: the ones that changed under protected paths are listed
// for you. Only an in-progress ticket: a handed-over one (in-review) isn't yours to unwind here.
export default {
  name: 'discard',
  summary: 'Throw a ticket\'s last step away, back to its checkpoint',
  usage: 'mirai discard <ticket>',
  positionals: { min: 1, max: 1 },
  options: {},
  async run(args, io) {
    const [ticket] = args.positionals;
    checkTicketArg(ticket);
    requireTty(io, 'mirai discard');
    return await withRun({ cwd: io.cwd, env: io.env }, ({ store, tookOver }) => {
      // A crashed run was taken over: a process it left may still be writing (unit 22 re-review).
      if (tookOver) {
        io.stdout.write(`note: ${plain(tookOver)}\n`);
        if (/still working in your project/.test(tookOver)) throw new MiraiError('a process from an earlier run may still be writing to the project; stop it first', EXIT.BLOCKED);
      }
      return discard(ticket, io, store);
    });
  },
};

async function discard(ticket, io, store) {
  const state = readTicketStatus(store, ticket)?.status?.state ?? null;
  if (state !== 'in-progress') throw new MiraiError(`${ticket} is ${state ?? 'not started'}; only an in-progress ticket's step can be discarded`, EXIT.BLOCKED);
  let last = null;
  try {
    last = JSON.parse(readFileSync(buildRecordPath(store, ticket), 'utf8'));
  } catch {
    last = null;
  }
  // Uncommitted work goes first: with changes in the tree, the discard goes back to HEAD only, so
  // a committed step is never thrown away with them (a launch cut short adds no checkpoint: unit 22
  // re-review). A clean tree goes back to the last checkpoint.
  const dirty = workTreeChanges(store.checkout, store.gitEnv).length > 0;
  const last0 = lastCheckpoint(store, ticket, last?.creation_sha ?? null);
  const head = commitOf(store.checkout, 'HEAD', store.gitEnv);
  const cp = dirty ? { n: last0 ? `${last0.n}+` : 'HEAD', step: 'uncommitted work only', sha: head } : last0;
  if (!cp?.sha) throw new MiraiError(`${ticket} has no checkpoint to go back to`, EXIT.BLOCKED);
  const branch = symbolicBranch(store.checkout, 'HEAD', store.gitEnv);
  if (!last?.branch || branch !== last.branch) throw new MiraiError(`the checkout isn't on ${ticket}'s branch${last?.branch ? ` (${last.branch})` : ''}`, EXIT.BLOCKED);
  // The checkpoint must be in this branch's history: never a reset to another branch's commit.
  if (!isAncestor(store.checkout, cp.sha, 'HEAD', store.gitEnv)) throw new MiraiError(`the checkpoint ${cp.sha.slice(0, 12)} isn't in ${branch}'s history`, EXIT.BLOCKED);
  const commits = commitsSince(store.checkout, cp.sha, 'HEAD', store.gitEnv) ?? [];
  const changes = workTreeChanges(store.checkout, store.gitEnv);
  io.stdout.write(`ticket:     ${ticket} on ${branch}\ncheckpoint: ${cp.n} (${cp.step}), ${cp.sha.slice(0, 12)}\ngoes away:  ${commits.length} commit(s), ${changes.length} uncommitted change(s)${changes.length ? ` (such as ${plain(changes[0])})` : ''}\n`);
  const prompter = createPrompter(io);
  try {
    await confirmByTyping(prompter, ticket);
  } finally {
    prompter.close();
  }
  resetTo(store.checkout, cp.sha, store.gitEnv);
  // Ignored files under protected paths that differ from before the step: listed, never deleted.
  let ignored = [];
  try {
    const trust = snapshot({ cwd: io.cwd, env: io.env });
    const now = ignoredFingerprint({ root: store.checkout, env: store.gitEnv, rules: protectionRules(trustedRegistry(trust), trustedConfig(trust)) });
    const before = last.ignored_before ?? {};
    ignored = [...new Set([...Object.keys(now), ...Object.keys(before)])].filter((p) => now[p] !== before[p]).sort();
  } catch {
    ignored = [];
  }
  atomicWrite(buildRecordPath(store, ticket), `${JSON.stringify({ ...last, outcome: 'discarded', discarded_to: cp.sha, commit: null, fingerprint: null, checked_fingerprint: null, head: commitOf(store.checkout, 'HEAD', store.gitEnv) }, null, 2)}\n`);
  appendEvent(store, { type: 'note', by: 'script', item: ticket, message: `discarded the last step: ${branch} back to checkpoint ${cp.n} (${cp.sha.slice(0, 12)})` });
  io.stdout.write(`discarded: ${branch} is back at checkpoint ${cp.n}; ${ticket} stays in-progress\n`);
  if (ignored.length) io.stdout.write(`  ignored files under protected paths that changed, left as they are: ${ignored.slice(0, 20).map(plain).join(', ')}\n`);
  return EXIT.OK;
}
