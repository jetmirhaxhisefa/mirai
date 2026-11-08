import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { progressPrinter } from '../progress.js';
import { requireTty } from '../tty.js';
import { checkTicketArg } from '../human-move.js';
import { plain } from '../../status/text.js';
import { checkProofs } from '../../proofs/check.js';
import { recordProofs } from '../../proofs/record.js';
import { branchKeys } from '../../sign/keys.js';
import { openStore } from '../../store/home.js';
import { protectionRules } from '../../trust/protected.js';
import { snapshot, trustedConfig, trustedRegistry } from '../../trust/snapshot.js';

// mirai gate record <ticket> | mirai gate check <ticket> [--commit <sha>] (unit 25a; D-16).
// - `record` mints the ticket's signed proofs (review and gate) for its branch's HEAD and commits
//   them there: your terminal only (Jet's decision 7), after Rex's review passed; it runs every
//   named check and test level itself (decision 5), a few minutes.
// - `check` says whether a commit (HEAD by default) has a review proof and a gate proof for its
//   code, verified with the integration branch's public keys only: for you, and for unit 26's
//   pre-push hook and unit 54's CI.

const RECORD_EXIT = Object.freeze({ recorded: EXIT.OK, 'gate-failed': EXIT.FAILURE, 'cant-tell': EXIT.NEEDS_HUMAN, parked: EXIT.BLOCKED });
const CHECK_EXIT = Object.freeze({ pass: EXIT.OK, 'no-proof': EXIT.FAILURE, stale: EXIT.FAILURE, 'bad-record': EXIT.BLOCKED, 'nothing-to-prove': EXIT.FAILURE });
const SHA_ARG = /^[0-9a-f]{7,64}$/;

export default {
  name: 'gate',
  summary: 'Mint a ticket\'s signed proofs after its review, or check them',
  usage: 'mirai gate record <ticket> | mirai gate check <ticket> [--commit <sha>]',
  positionals: { min: 2, max: 2 },
  options: {
    commit: { type: 'string', description: 'with check: the commit to check (HEAD by default)' },
  },
  async run(args, io) {
    const [verb, ticket] = args.positionals;
    checkTicketArg(ticket);
    if (verb === 'record') {
      if (args.values.commit !== undefined) throw new UsageError('--commit goes with check');
      return await record(ticket, io);
    }
    if (verb === 'check') return check(ticket, args.values.commit ?? 'HEAD', io);
    throw new UsageError(`${plain(verb).slice(0, 40)} isn't a gate command`, 'mirai gate record <ticket>, or mirai gate check <ticket>');
  },
};

async function record(ticket, io) {
  requireTty(io, 'mirai gate record');
  const abort = new AbortController();
  const onInt = () => abort.abort();
  const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const sig of SIGNALS) process.on(sig, onInt);
  let progress = null;
  try {
    progress = progressPrinter(io, io.progressTiming ?? {});
    io.stderr.write(`minting ${ticket}'s proofs: every check and test level runs now…\n`);
    const r = await recordProofs({ cwd: io.cwd, env: io.env, ticket, signal: abort.signal, onCheck: progress.onCheck, ...(io.testRun ? { run: io.testRun } : {}) });
    io.stdout.write(`gate record ${ticket}: ${r.outcome}${r.why ? `: ${plain(r.why).slice(0, 400)}` : ''}\n`);
    for (const x of r.tests?.runs ?? []) io.stdout.write(`  ${plain(x.name)}: ${x.verdict}${x.outcome === 'fail' && x.verdict === 'pass' ? ' (only known failures)' : ''}\n`);
    if (r.outcome === 'recorded') {
      io.stdout.write(`  code ${r.hash.slice(7, 19)} (${r.files.length} files since ${r.base.slice(0, 12)}), review ${r.review}, gate attempt ${r.gate}\n`);
      for (const p of r.written) io.stdout.write(`  wrote ${plain(p)}\n`);
      io.stdout.write(`  committed ${r.commit.slice(0, 12)} on the ticket's branch; check it with: mirai gate check ${ticket}\n`);
    }
    if (r.outcome === 'gate-failed') io.stdout.write('  nothing was written: fix the failing tests (mirai fix), then review and record again\n');
    if (r.outcome === 'cant-tell') io.stdout.write('  nothing was written: MIRAI can\'t tell these from the baseline; look at them yourself\n');
    return RECORD_EXIT[r.outcome] ?? EXIT.FAILURE;
  } finally {
    progress?.stop();
    for (const sig of SIGNALS) process.removeListener(sig, onInt);
  }
}

function check(ticket, commit, io) {
  if (commit !== 'HEAD' && !SHA_ARG.test(commit)) throw new UsageError('--commit takes a commit id');
  const store = openStore({ cwd: io.cwd, env: io.env });
  const trust = snapshot({ cwd: io.cwd, env: io.env });
  // The integration branch's config and keys only: never the checked commit's own.
  const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
  const config = trustedConfig(trust);
  const r = checkProofs({ root: store.checkout, env: store.gitEnv, ticket, commit, integration: trust.baseSha, codePaths: config.gate?.code_paths, keys, repoId: store.repoId, rules: protectionRules(trustedRegistry(trust), config).rules, docsRoot: config.docs?.root });
  io.stdout.write(`gate check ${ticket} at ${r.commit.slice(0, 12)}: ${r.outcome}\n`);
  io.stdout.write(`  code ${r.hash.slice(7, 19)} (${r.files.length} files since ${r.base.slice(0, 12)})\n`);
  for (const k of ['review', 'gate']) {
    const m = r.matched[k];
    io.stdout.write(m ? `  ${k}: ${plain(m.path)}, signed by ${m.keyId}\n` : `  ${k}: none for this code\n`);
  }
  for (const b of r.bad) io.stdout.write(`  not a valid record: ${plain(b.path)} (${plain(b.reason)})\n`);
  if (r.outcome === 'stale') io.stdout.write(`  the proofs there are for other code (${r.others.map((o) => o.codeHash.slice(7, 19)).filter((v, i, a) => a.indexOf(v) === i).join(', ')}): review and record again\n`);
  if (r.outcome === 'no-proof') io.stdout.write(`  mint them: mirai gate record ${ticket}\n`);
  return CHECK_EXIT[r.outcome] ?? EXIT.FAILURE;
}
