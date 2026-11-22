import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { plain, shown } from '../../status/text.js';
import { docsMerge, docsPublish } from '../../store/connectors/publish.js';
import { hostLink } from '../../store/connectors/links.js';
import { hostWords, longRef } from '../../ship/words.js';

// mirai docs publish <initiative> | mirai docs merge <initiative> (unit 38, Scope 4). The docs
// merge request of the repo store: publish commits the initiative's folder on docs/<initiative>,
// pushes it and opens (or updates) its one merge request; merge merges it once your signed
// approvals cover every document as it is there and the epic covers its tickets. Neither decides
// anything new (your signed approvals are the gate), so both run from your session too (/mirai docs
// publish, /mirai docs merge, 21f). With the local store, both say there is nothing to do.

const ACTIONS = new Set(['publish', 'merge']);

export default {
  name: 'docs',
  summary: `Publish an initiative's documents as one docs ${hostWords(null).long}, or merge it after your signed approvals`,
  usage: 'mirai docs <publish|merge> <initiative>',
  positionals: { min: 2, max: 2 },
  options: {},
  async run(args, io) {
    const [action, initiative] = args.positionals;
    if (!ACTIONS.has(action)) throw new UsageError(`unknown action ${shown(action)}`, 'run: mirai docs publish <initiative>, or mirai docs merge <initiative>');
    const hostOf = io.hostOf ? { hostOf: io.hostOf } : {};
    if (action === 'publish') {
      const r = await docsPublish({ cwd: io.cwd, env: io.env, initiative, ...hostOf });
      if (r.outcome === 'local') {
        io.stdout.write(`docs publish ${plain(initiative)}: nothing to do\n  ${plain(r.message)}\n`);
        return EXIT.OK;
      }
      io.stdout.write(`docs publish ${plain(initiative)}: ${r.outcome}\n`);
      io.stdout.write(`  ${r.pushed ? `pushed ${r.head.slice(0, 12)} to ${plain(r.branch)}` : `${plain(r.branch)} was already at ${r.head.slice(0, 12)} on the host`}\n`);
      io.stdout.write(`  ${longRef(r.words ?? hostWords(null), r.mr.number)}: ${plain(r.mr.url ?? '')}\n`);
      for (const f of r.files) io.stdout.write(`  ${plain(f.state).padEnd(22)}   ${plain(f.abs)}   ${hostLink({ config: r.config, remoteUrl: r.remoteUrl, branch: r.branch, path: f.path }) ?? ''}`.trimEnd() + '\n');
      io.stdout.write(`  MIRAI merges it after your signed approvals: mirai docs merge ${plain(initiative)}\n`);
      const folderLink = hostLink({ config: r.config, remoteUrl: r.remoteUrl, branch: r.branch, path: r.folder.slice(r.store.checkout.length + 1), folder: true });
      io.stdout.write(`${plain(r.folder)}${folderLink ? `   ${folderLink}` : ''}\n`);
      return EXIT.OK;
    }
    let r;
    try {
      r = await docsMerge({ cwd: io.cwd, env: io.env, initiative, ...hostOf, log: (line) => io.stderr.write(`${plain(line)}\n`) });
    } catch (err) {
      if (err instanceof MiraiError && err.gaps) for (const g of err.gaps) io.stderr.write(`${plain(g.path)}: ${plain(g.gap)}${g.hint ? `\n  ${plain(g.hint)}` : ''}\n`);
      throw err;
    }
    if (r.outcome === 'local') {
      io.stdout.write(`docs merge ${plain(initiative)}: nothing to do\n  ${plain(r.message)}\n`);
      return EXIT.OK;
    }
    if (r.outcome === 'already-merged') {
      io.stdout.write(`docs merge ${plain(initiative)}: already merged (${plain(r.mr.url ?? (r.words ?? hostWords(null)).ref(r.mr.number))})\n`);
      return EXIT.OK;
    }
    if (r.outcome === 'waiting') {
      io.stdout.write(`docs merge ${plain(initiative)}: every document is approved as it is, and the epic covers its tickets\n  waiting for: ${plain(r.waitingFor)}\n  the ${(r.words ?? hostWords(null)).long} stays open (${plain(r.mr.url ?? (r.words ?? hostWords(null)).ref(r.mr.number))}): run mirai docs merge ${plain(initiative)} again later\n`);
      return EXIT.BLOCKED;
    }
    io.stdout.write(`docs merge ${plain(initiative)}: merged ${plain(r.mr.url ?? (r.words ?? hostWords(null)).ref(r.mr.number))} at ${r.head.slice(0, 12)} as ${r.mergeSha.slice(0, 12)} into ${plain(r.integration)}\n`);
    for (const f of r.files) {
      const link = hostLink({ config: r.config, remoteUrl: r.remoteUrl, branch: r.integration, path: f.path });
      io.stdout.write(`  ${plain(f.abs)}${link ? `   ${link}` : ''}\n`);
    }
    const folderLink = hostLink({ config: r.config, remoteUrl: r.remoteUrl, branch: r.integration, path: r.folder.slice(r.store.checkout.length + 1), folder: true });
    io.stdout.write(`${plain(r.folder)}${folderLink ? `   ${folderLink}` : ''}\n`);
    return EXIT.OK;
  },
};
