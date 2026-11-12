import { createInterface } from 'node:readline';

import { EXIT } from './exit-codes.js';
import { readStatus, readWorkerRecord, REQUEST_ID } from '../agent/requests.js';
import { openStore } from '../store/home.js';
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

// A command your session's `/mirai` started (unit 21f) stands in for a terminal, for the commands
// that aren't gates only (plan, build, fix, the red team's run). It proves itself through the store:
// its request is running, claimed by this process's parent (the worker), for this very command.
// Agents can't write the store or run mirai; the gates never call this.
export function requireTtyOrSession(io, what, command) {
  if (io.stdin?.isTTY === true && io.stdout?.isTTY === true) return;
  if (fromSession(io, command)) return;
  requireTty(io, what);
}

// Where a command that isn't a gate came from (unit 28: the run stops before your key in a
// session): 'terminal' or 'session', or the terminal check's refusal.
export function viaOf(io, what, command) {
  if (io.stdin?.isTTY === true && io.stdout?.isTTY === true) return 'terminal';
  if (fromSession(io, command)) return 'session';
  requireTty(io, what);
  return 'terminal';
}

function fromSession(io, command) {
  const id = io.env?.MIRAI_SESSION_REQUEST;
  if (typeof id !== 'string' || !REQUEST_ID.test(id)) return false;
  try {
    const store = openStore({ cwd: io.cwd, env: io.env });
    const w = readWorkerRecord(store, id);
    const s = readStatus(store, id);
    return w?.pid === process.ppid && w.command === command && ['queued', 'running'].includes(s?.state);
  } catch {
    return false;
  }
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

// Reads one secret line without echoing it (unit 13a: the login token). On a real terminal the
// input is switched to raw mode, so nothing typed or pasted is shown (text pasted before the
// prompt appears is echoed by the terminal itself, before MIRAI runs). Ctrl-C or Ctrl-D stops
// with nothing written. Backspace works; the line ends at Enter. Raw mode is switched off before
// this returns or throws, and the stream is paused, not destroyed.
export function readHidden(io, question, { max = ANSWER_MAX } = {}) {
  io.stdout.write(question);
  const { stdin } = io;
  const raw = typeof stdin.setRawMode === 'function';
  if (raw) stdin.setRawMode(true);
  return new Promise((resolve, reject) => {
    let line = '';
    const finish = (err, value) => {
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      if (raw) stdin.setRawMode(false);
      stdin.pause();
      io.stdout.write('\n');
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n') return finish(null, line);
        if (ch === '\u0003' || ch === '\u0004') return finish(new MiraiError('stopped; nothing was written', EXIT.INTERRUPTED));
        if (ch === '\u007f' || ch === '\b') line = line.slice(0, -1);
        else line += ch;
        if (line.length > max) return finish(new MiraiError(`the answer is longer than ${max} characters; nothing was written`, EXIT.USAGE));
      }
      return undefined;
    };
    const onEnd = () => (line === '' ? finish(new MiraiError('no answer (the input closed); nothing was written', EXIT.INTERRUPTED)) : finish(null, line));
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.resume();
  });
}
