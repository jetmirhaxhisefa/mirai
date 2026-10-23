import { createInterface } from 'node:readline';

import { EXIT } from './exit-codes.js';
import { MiraiError } from './errors.js';
import { escapeInvisible } from '../status/text.js';

const ANSWER_MAX = 2000;

// The real-terminal rule for human-only commands (unit 06; D-17): stdin and stdout must both be
// terminals. There is no flag to skip it. It stops headless agents and piped input, not a
// determined process that opens a terminal (the honest limit, D-17).
export function requireTty(io, what) {
  if (io.stdin?.isTTY === true && io.stdout?.isTTY === true) return;
  const err = new MiraiError(`${what} needs you, in a real terminal`, EXIT.NEEDS_HUMAN);
  err.hint = 'run it yourself in a terminal; it can\'t be piped or run by an agent';
  throw err;
}

// Asks questions one line at a time on io.stdin. Answers are trimmed; control, invisible and
// bidi characters are refused, so an answer can't carry an escape sequence or hidden text into
// the journal; a line longer than 2000 characters is refused.
export function createPrompter(io) {
  const rl = createInterface({ input: io.stdin, crlfDelay: Infinity, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  return {
    async ask(question) {
      io.stdout.write(question);
      const { value, done } = await lines.next();
      if (done) throw new MiraiError('no answer (the input closed); nothing was written', EXIT.INTERRUPTED);
      if (value.length > ANSWER_MAX) throw new MiraiError(`the answer is longer than ${ANSWER_MAX} characters; nothing was written`, EXIT.USAGE);
      const answer = value.trim();
      if (/[\u0000-\u001f]/.test(answer) || escapeInvisible(answer) !== answer) throw new MiraiError('the answer has control or invisible characters; nothing was written', EXIT.USAGE);
      return answer;
    },
    close() {
      rl.close();
    },
  };
}
