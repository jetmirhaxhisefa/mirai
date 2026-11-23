import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { readApprovedFile } from '../human-move.js';
import { plain } from '../../status/text.js';
import { contentHash } from '../../sign/sign.js';
import { lintText, parseDocument, projectOf } from '../../lint/lint.js';
import { checkInitiative } from '../../store/connectors/common.js';
import { docsStoreFor } from '../../store/connectors/index.js';
import { documentLine } from '../../store/connectors/links.js';
import { openStore } from '../../store/home.js';
import { snapshot, trustedConfig } from '../../trust/snapshot.js';
import { effectiveRegistry } from '../../trust/overlays.js';
import { requirementLines, requirementsText } from '../../nora/requirements.js';
import { fullName } from '../../agent/names.js';

// mirai requirements <initiative> [--from <file>] (unit 41, Scope 9; Jet's decision 6): your own
// list of requirements, kept as requirements.md in the initiative's folder, each line word for
// word with its ID (REQ-1, REQ-2 …). Two ways:
// - you pasted the list in your session, which saved it as requirements.md as you gave it: this
//   numbers it in place ("pasted in the interview, <date>");
// - you have it in a file in the repo: --from <file> copies its lines, and requirements.md names the
//   file and its hash as its source.
// A requirements.md that's already numbered is only linted. It writes one file and signs nothing,
// so it runs from your session too (/mirai requirements <initiative>).

export default {
  name: 'requirements',
  summary: 'Keep your own requirements list for an initiative, each line numbered REQ-1, REQ-2 …',
  usage: 'mirai requirements <initiative> [--from <file>]',
  positionals: { min: 1, max: 1 },
  options: {
    from: { type: 'string', description: 'a file in the repo holding the list, one requirement per line' },
  },
  async run(args, io, { now = () => new Date() } = {}) {
    const [initiative] = args.positionals;
    checkInitiative(initiative);
    const store = openStore({ cwd: io.cwd, env: io.env });
    const { conn, config } = docsStoreFor({ cwd: io.cwd, env: io.env, store });
    const trust = snapshot({ cwd: io.cwd, env: io.env });
    const registry = effectiveRegistry(trust, store);
    const abs = conn.pathOf('requirements', initiative);
    const shown = plain(conn.relOf(abs) ?? abs);
    const date = now().toISOString().slice(0, 10);
    let current = null;
    try {
      current = readApprovedFile(conn.base, conn.base, abs).bytes.toString('utf8');
    } catch {
      current = null;
    }
    let numbered = false;
    try {
      numbered = current !== null && parseDocument(current, 'requirements.md').value?.type === 'requirements';
    } catch {
      numbered = false;
    }
    let text = null;
    if (args.values.from !== undefined) {
      if (numbered) throw new UsageError(`${shown} is already numbered; nothing was written`, 'remove it first if this file replaces it');
      const src = readApprovedFile(store.checkout, io.cwd, args.values.from);
      const lines = requirementLines(src.bytes.toString('utf8'));
      if (!lines.length) throw new UsageError(`${plain(src.path)} has no lines to number`, 'one requirement per line');
      text = requirementsText({ initiative, lines, source: `${src.path} (${contentHash(src.bytes)}), ${date}`, created: date });
    } else if (!numbered) {
      if (current === null) throw new UsageError(`there's no list to number: ${shown} isn't there`, `save the pasted list there, one requirement per line, or give a file: mirai requirements ${initiative} --from <file>`);
      const lines = requirementLines(current);
      if (!lines.length) throw new UsageError(`${shown} has no lines to number`, 'one requirement per line');
      text = requirementsText({ initiative, lines, source: `pasted in the interview, ${date}`, created: date });
    }
    if (text !== null) conn.write('requirements', initiative, 'requirements.md', Buffer.from(text, 'utf8'));
    const final = text ?? current;
    const problems = lintText(final, { source: conn.relOf(abs) ?? abs, registry, project: projectOf(trustedConfig(trust)) }).filter((p) => p.severity === 'error');
    const count = (final.match(/^- REQ-[0-9]+:/gm) ?? []).length;
    io.stdout.write(`${text !== null ? 'numbered' : 'already numbered'}: ${count} requirement${count === 1 ? '' : 's'}, REQ-1 to REQ-${count}${problems.length ? `; ${problems.length} lint problem${problems.length === 1 ? '' : 's'}, such as line ${problems[0].line}: ${plain(problems[0].reason)}` : ''}\n`);
    if (text !== null && conn.kind === 'repo') io.stdout.write(`commit it with the interview: ${fullName('mirai-product-manager')} starts only on a clean tree\n`);
    io.stdout.write(`${documentLine({ store, config, conn, abs, rel: conn.relOf(abs) ?? abs, bytes: Buffer.from(final, 'utf8') })}\n`);
    return problems.length ? EXIT.FAILURE : EXIT.OK;
  },
};
