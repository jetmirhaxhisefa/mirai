import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { m1, m1Line } from '../../reports/m1.js';
import { renderRunReport } from '../../reports/render.js';
import { readSavedReport, runReportData, saveRunReport } from '../../reports/run-report.js';
import { hostFor } from '../../ship/host.js';
import { branchKeys } from '../../sign/keys.js';
import { remotes } from '../../store/git.js';
import { openStore } from '../../store/home.js';
import { readJournal } from '../../store/journal.js';
import { plain } from '../../status/text.js';
import { snapshot, trustedConfig } from '../../trust/snapshot.js';

// mirai report [<run-id>] [--json] [--m1] (unit 29a, Jet's decision 4; PM2-17): a run's report, the
// last one by default: its tickets with their whole paths, usage and limit share, the red team.
// Saved in <store>/reports/ when a run ends; one from before unit 29a is built and saved when
// asked. `--m1`: the acceptance rate over every merged or closed MR so far, reading a final head
// the journal doesn't have from the host. Read-only (bar saving the report), so /mirai report too.
const RUN_ID = /^r-\d{8}-\d{6}-[0-9a-f]{4}$/;

export default {
  name: 'report',
  summary: 'Print a run\'s report (the last run by default), or the M1 acceptance rate',
  usage: 'mirai report [<run-id>] [--json] | mirai report --m1',
  positionals: { min: 0, max: 1 },
  options: {
    json: { type: 'boolean', description: 'the report\'s data as JSON, for scripts' },
    m1: { type: 'boolean', description: 'the M1 acceptance rate: merged as is, edited, closed' },
  },
  async run(args, io) {
    const [runId] = args.positionals;
    if (runId !== undefined && !RUN_ID.test(runId)) throw new UsageError(`${plain(runId).slice(0, 40)} isn't a run id`, 'run ids look like r-20261114-124456-5474; mirai status names the last one');
    if (args.values.m1) {
      if (runId !== undefined) throw new UsageError('--m1 covers every MR, not one run', 'mirai report --m1');
      return m1Command(args, io);
    }
    const store = openStore({ cwd: io.cwd, env: io.env });
    let data = runId ? readSavedReport(store, runId) : null;
    if (!data) {
      data = await runReportData({ cwd: io.cwd, env: io.env, runId: runId ?? null });
      const saved = readSavedReport(store, data.run.id);
      if (saved) data = saved;
      else saveRunReport(store, data);
    }
    io.stdout.write(args.values.json ? `${JSON.stringify(data, null, 2)}\n` : renderRunReport(data, { format: 'text' }));
    return EXIT.OK;
  },
};

async function m1Command(args, io) {
  const store = openStore({ cwd: io.cwd, env: io.env });
  const config = trustedConfig(snapshot({ cwd: io.cwd, env: io.env }));
  let host = null;
  try {
    const h = hostFor({ config, remoteUrl: remotes(store.checkout, store.gitEnv).get('origin') ?? null, store, env: io.env, root: store.checkout });
    host = { name: h.name, pushUrl: h.pushUrl, helper: h.helper ?? null, ca: h.ca ?? null };
  } catch (err) {
    io.stderr.write(`note: the host can't be read (${plain(err.message)}); a final head not on record stays unknown\n`);
  }
  const events = readJournal(store, { keys: branchKeys(store.checkout, store.branch, store.gitEnv) }).events;
  const r = m1({ root: store.checkout, env: store.gitEnv, events, codePaths: config.gate?.code_paths ?? ['**'], integration: config.git?.integration_branch ?? store.branch, host });
  if (args.values.json) {
    io.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    return EXIT.OK;
  }
  const text = { 'as-is': 'merged as is', edited: 'edited before the merge', closed: 'closed without merge', unknown: 'unknown' };
  const lines = [m1Line(r.rate), ''];
  for (const row of r.rows) lines.push(`${row.ticket.padEnd(12)} ${text[row.class].padEnd(24)}${row.mr?.url ? ` ${plain(row.mr.url)}` : ''}${row.why ? `  (${plain(row.why)})` : ''}`);
  if (!r.rows.length) lines.push('no MR MIRAI opened has been merged or closed yet');
  io.stdout.write(`${lines.join('\n')}\n`);
  return EXIT.OK;
}
