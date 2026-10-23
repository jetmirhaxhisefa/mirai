import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { closest } from '../../util/closest.js';
import { shown } from '../../status/text.js';
import { openStore } from '../../store/home.js';
import { STRING_MAX } from '../../store/files.js';
import { appendEvent, checkEvent, EVENT_TYPES } from '../../store/journal.js';

// mirai log <type> --message <text> [--item <id>] [--template <t> --section <s>] (unit 05b).
// Appends a journal line with `by: "unverified"`. Only the types in this list may be written:
// an allowlist, so any type added later is MIRAI's own until someone decides otherwise (D-17).
export const LOG_TYPES = Object.freeze(['note', 'template_gap']);
const ITEM = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

export default {
  name: 'log',
  summary: 'Add a note or a template gap to the journal',
  usage: 'mirai log <note|template_gap> --message <text> [--item <id>] [--template <t> --section <s>]',
  positionals: { min: 1, max: 1 },
  options: {
    message: { type: 'string', description: 'what to record' },
    item: { type: 'string', description: 'the ticket or document it is about' },
    template: { type: 'string', description: 'with template_gap: the template' },
    section: { type: 'string', description: 'with template_gap: the missing section' },
  },
  run(args, io) {
    const [type] = args.positionals;
    const { message, item, template, section } = args.values;
    if (!LOG_TYPES.includes(type)) {
      if (Object.hasOwn(EVENT_TYPES, type)) {
        throw new MiraiError(`${type} is written only by MIRAI itself (D-17)`, EXIT.BLOCKED);
      }
      const near = closest(type, LOG_TYPES);
      throw new UsageError(`unknown type ${shown(type)}`, near ? `did you mean "${near}"?` : `types: ${LOG_TYPES.join(', ')}`);
    }
    for (const [flag, value] of [['message', message], ['template', template], ['section', section]]) {
      if (value !== undefined && (!/\S/.test(value) || value.length > STRING_MAX)) {
        throw new UsageError(`--${flag} must be text of 1 to ${STRING_MAX} characters`, 'store bulky text as a file and reference it');
      }
    }
    if (message === undefined) throw new UsageError('--message is required', `see: mirai log --help`);
    if (item !== undefined && !ITEM.test(item)) throw new UsageError(`${shown(item)} is not a ticket or document id`, 'for example --item PROJ-12');
    if (type === 'template_gap' && (template === undefined || section === undefined)) {
      throw new UsageError('template_gap needs --template and --section', 'see: mirai log --help');
    }
    if (type === 'note' && (template !== undefined || section !== undefined)) {
      throw new UsageError('--template and --section are for template_gap', 'see: mirai log --help');
    }

    const fields = type === 'note' ? { message } : { template, section, message };
    const event = { type, by: 'unverified', ...(item ? { item } : {}), ...fields };
    try {
      checkEvent(event); // the whole line, in bytes too, before the store is touched
    } catch (err) {
      if (err instanceof RangeError) throw new UsageError('the text is too long for one journal line (16 KB)', 'store bulky text as a file and reference it');
      throw err;
    }
    const store = openStore({ cwd: io.cwd, env: io.env });
    const seq = appendEvent(store, event);
    io.stdout.write(`logged ${type} (seq ${seq})\n`);
    return EXIT.OK;
  },
};
