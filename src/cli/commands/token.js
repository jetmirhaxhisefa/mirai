import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { readHidden, requireTty } from '../tty.js';
import { shown } from '../../status/text.js';
import { clearToken, readToken, RENEW_AFTER_DAYS, tokenFingerprint, tokenPath, tokenSetAt, writeToken } from '../../sign/token.js';

// mirai token set | status | clear (unit 13a; G5). The Claude login token for headless runs,
// kept outside every project. `set` and `clear` change what MIRAI's agents log in with, so they
// need a real terminal; the token is read without echo and never appears in any output. The
// terminal rule stops piped input and headless agents, not a process that opens a terminal
// (D-17's honest limit); 13b's denies on ~/.config/mirai are the real guard.
// It belongs to this machine, not to a repo, so it works anywhere (the launcher runs it itself).
export default {
  name: 'token',
  summary: 'Set, show or clear the Claude login token for headless runs',
  usage: 'mirai token <set|status|clear>',
  positionals: { min: 1, max: 1 },
  async run(args, io) {
    const [action] = args.positionals;
    if (!['set', 'status', 'clear'].includes(action)) throw new UsageError(`unknown action ${shown(action)}`, 'see: mirai token --help');

    if (action === 'status') {
      const token = readToken(io.env);
      if (token === null) {
        io.stdout.write('no token set\nmake one with claude setup-token, then: mirai token set\n');
        return EXIT.OK;
      }
      const setAt = tokenSetAt(io.env);
      const days = setAt ? Math.floor((Date.now() - setAt.getTime()) / 86_400_000) : null;
      io.stdout.write(`token set: ${tokenPath(io.env)}\nfingerprint: ${tokenFingerprint(token)}\n`);
      if (setAt) io.stdout.write(`set on: ${setAt.toISOString().slice(0, 10)} (${days} days ago)\n`);
      if (days !== null && days >= RENEW_AFTER_DAYS) io.stdout.write('renew it soon (setup tokens last a year): claude setup-token, then mirai token set\n');
      return EXIT.OK;
    }

    requireTty(io, `mirai token ${action}`);
    if (action === 'clear') {
      io.stdout.write(clearToken(io.env) ? 'token removed\n' : 'no token was set\n');
      return EXIT.OK;
    }
    const token = (await readHidden(io, 'paste the token from claude setup-token (it isn\'t shown): ')).trim();
    const fingerprint = writeToken(io.env, token);
    io.stdout.write(`token saved: ${tokenPath(io.env)}\nfingerprint: ${fingerprint}\n`);
    return EXIT.OK;
  },
};
