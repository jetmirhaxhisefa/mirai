import { usageCheck } from '../loop/ledger.js';
import { readRunState, writeHeartbeat, writeRunState } from '../store/run.js';

// A usage limit inside `mirai run` (unit 28, decision 5; D-18): a 5-hour limit pauses the run and it
// continues by itself after the reset; a weekly limit stops it. Every limit is your config's:
// `run.on_limit` ("wait" | "stop"), `run.max_wait_minutes` (300), `run.stop_by` ("HH:MM", local).
// The cut launch's round was given back by the loop guard (unit 20); the same step runs again.

export const MAX_WAIT_DEFAULT = 300;
// After the reset, a minute's grace: the limit lifts on the server's clock, not ours.
export const RESET_GRACE_MS = 60_000;
const BEAT_MS = 30_000;

const defaultSleep = (ms, signal) => new Promise((done) => {
  const t = setTimeout(done, ms);
  signal?.addEventListener?.('abort', () => {
    clearTimeout(t);
    done();
  }, { once: true });
});

// The next local clock time "HH:MM" after `from` (a Date), as a Date.
export function nextClock(hhmm, from) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const at = new Date(from.getTime());
  at.setHours(h, m, 0, 0);
  if (at.getTime() <= from.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

const local = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const span = (ms) => {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};

// Decides and, when it's a wait, waits. Returns { stop } or { resumed: true }.
export async function waitForReset({ store, runId, ticket, step, line, config, signal = null, now = () => new Date(), sleep = defaultSleep, say = () => {}, env = null }) {
  const window = line?.limit_window ?? null;
  const resetsAt = line?.resets_at ? Date.parse(line.resets_at) : NaN;
  const resume = 'continue: mirai resume';
  const until = Number.isFinite(resetsAt) ? ` (it resets at ${local(new Date(resetsAt))})` : '';
  if (window !== 'five_hour') return { stop: { kind: 'limit', why: `your ${window === 'seven_day' ? 'weekly' : 'usage'} limit was reached${until}`, next: `after the reset: ${resume}` } };
  if ((config.run?.on_limit ?? 'wait') === 'stop') return { stop: { kind: 'limit', why: `your 5-hour usage limit was reached${until}; run.on_limit is "stop"`, next: `after the reset: ${resume}` } };
  if (!Number.isFinite(resetsAt)) return { stop: { kind: 'limit', why: 'your 5-hour usage limit was reached, and Claude Code didn\'t say when it resets', next: resume } };
  const t0 = now();
  const wake = resetsAt + RESET_GRACE_MS;
  const waitMs = wake - t0.getTime();
  const maxMin = config.run?.max_wait_minutes ?? MAX_WAIT_DEFAULT;
  if (waitMs > maxMin * 60_000) return { stop: { kind: 'limit', why: `your 5-hour usage limit resets in ${span(waitMs)}${until}, longer than run.max_wait_minutes (${maxMin})`, next: `after the reset: ${resume}` } };
  if (config.run?.stop_by) {
    const by = nextClock(config.run.stop_by, t0);
    if (wake > by.getTime()) return { stop: { kind: 'limit', why: `your 5-hour usage limit resets after run.stop_by (${config.run.stop_by})${until}`, next: `after the reset: ${resume}` } };
  }
  writeRunState(store, 'paused', { ticket, step });
  say({ type: 'paused', until: new Date(resetsAt).toISOString(), line: `paused: usage limit until ${local(new Date(resetsAt))} (in ${span(waitMs)}). Ctrl-C stops; mirai resume continues later` });
  // The wait, in short sleeps: the heartbeat stays fresh, so `mirai status` shows a live, paused run.
  while (now().getTime() < wake) {
    if (signal?.aborted) {
      writeRunState(store, 'stopped', { ticket, step });
      return { stop: { kind: 'interrupted', why: 'stopped by you while paused for the usage limit', next: `after ${local(new Date(resetsAt))}: ${resume}`, already: true } };
    }
    try {
      writeHeartbeat(store, { runId, ticket, step, progress: `paused: usage limit until ${local(new Date(resetsAt))}` });
    } catch {
      // a status detail
    }
    await sleep(Math.min(BEAT_MS, Math.max(0, wake - now().getTime())), signal);
  }
  if (readRunState(store)?.state === 'paused') writeRunState(store, 'running', { ticket, step });
  // The caps again before going on: the window reset, the week may not have.
  if (env) {
    const u = usageCheck({ env, unattended: false });
    if (!u.go) return { stop: { kind: 'limit', why: u.why ?? 'your usage caps', next: resume } };
  }
  say({ type: 'resumed', line: `the usage limit reset: ${step} again` });
  return { resumed: true };
}
