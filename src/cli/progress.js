import { checkLine, progressLine } from '../agent/progress.js';

// What `mirai plan`, `build` and `fix` print while a step runs (unit 21e), on stderr: a line per
// tool call, at most one every `everyMs`; a "still working" line after `quietMs` with nothing new;
// each check and level as it starts and ends. Plain lines either way, so a log reads the same.
export function progressPrinter(io, { everyMs = 5_000, quietMs = 15_000, tickMs = 1_000, now = () => Date.now() } = {}) {
  const write = (line) => {
    try {
      io.stderr.write(`${line}\n`);
    } catch {
      // a display only
    }
  };
  let last = null;
  let lastPrinted = -Infinity;
  let lastSign = now();
  let startedAt = null;
  const onProgress = (p) => {
    // One "preparing" line per step: the step and its launch both say it (21e review).
    if (p.kind === 'preparing' && last?.kind === 'preparing') return;
    if (p.kind === 'started' || p.kind === 'preparing') startedAt = now();
    last = p;
    lastSign = now();
    // Tool lines are throttled; the start and the end always show.
    if (p.kind !== 'tool') write(progressLine(p));
    else if (now() - lastPrinted >= everyMs) {
      lastPrinted = now();
      write(progressLine(p));
    }
  };
  let check = null;
  const onCheck = (c) => {
    lastSign = now();
    check = c.state === 'running' ? { name: c.name, at: now() } : null;
    write(checkLine(c));
  };
  const timer = setInterval(() => {
    if (now() - lastSign < quietMs) return;
    // A check or level still running: said as such, with its time so far.
    if (check) {
      write(checkLine({ name: check.name, state: 'still running', seconds: (now() - check.at) / 1000 }));
      lastSign = now();
      return;
    }
    if (!last || last.kind === 'ended') return;
    const minutes = startedAt === null ? last.minutes : Math.round((now() - startedAt) / 600) / 100;
    write(progressLine({ ...last, kind: 'still', minutes, ...(last.kind === 'preparing' ? { stage: 'preparing' } : {}) }));
    lastSign = now();
  }, tickMs);
  timer.unref?.();
  return { onProgress, onCheck, stop: () => clearInterval(timer) };
}
