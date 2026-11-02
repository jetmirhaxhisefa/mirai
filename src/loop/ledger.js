
import { join } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { globalConfigPath, readConfigFile } from '../config/load.js';
import { appendLine, readJsonLines, withLock } from '../store/files.js';
import { ensureGlobal, globalPaths, usageSince } from '../store/global.js';

// Your usage of the subscription, measured (unit 20; D-57). Claude Code puts a rate_limit_event in
// every stream: each window's `utilization` (0 to 1, in hundredths), when it resets, and its
// status (19a's first real run: seven_day 0.11, allowed). Undocumented, so it's read defensively:
// a stream without it means "unknown", never "nothing used".
//
// Readings go in the global folder beside the usage ledger, from every repo; a launch's measured
// share goes in the ledger. The check before each ticket is usageCheck's, below.

export const USAGE_DEFAULTS = Object.freeze({ night_max: 15, week_max: 60, reserve: 40, ticket_estimate: 2 });
const WINDOW = /^[a-z_]{1,32}$/;
const readingsFile = (env) => join(globalPaths(env).dir, 'usage-readings.jsonl');

// The readings in a stream's text: [{ window, utilization, resets_at, status }].
export function rateLimits(stdout) {
  const out = [];
  for (const line of String(stdout).split('\n')) {
    if (!line.includes('rate_limit_event')) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const info = ev?.type === 'rate_limit_event' ? ev.rate_limit_info : null;
    if (!info || typeof info !== 'object') continue;
    for (const [window, w] of Object.entries(info.unifiedWindows ?? {})) {
      if (!WINDOW.test(window) || typeof w?.utilization !== 'number' || w.utilization < 0 || w.utilization > 1.5) continue;
      out.push({ window, utilization: w.utilization, resets_at: Number.isFinite(w.resetsAt) ? w.resetsAt : null, status: typeof w.status === 'string' ? w.status.slice(0, 32) : null });
    }
    // The event's own status covers the window it names (a five-hour limit hit, say).
    if (typeof info.status === 'string' && info.status !== 'allowed' && WINDOW.test(info.rateLimitType ?? '')) {
      out.push({ window: info.rateLimitType, utilization: null, resets_at: Number.isFinite(info.resetsAt) ? info.resetsAt : null, status: info.status.slice(0, 32) });
    }
  }
  return out;
}

export function recordReadings(env, readings, { repoId, runId, now = () => new Date() }) {
  if (!readings.length) return;
  const g = ensureGlobal(env);
  withLock(g.ledgerLock, 'ledger', () => {
    for (const r of readings) appendLine(readingsFile(env), `${JSON.stringify({ ts: now().toISOString(), repo_id: repoId, run_id: runId, ...r })}\n`);
  });
}

export function readReadings(env) {
  return readJsonLines(readingsFile(env), { optional: true }).entries.map(({ value }) => value)
    .filter((v) => typeof v?.ts === 'string' && WINDOW.test(v.window ?? '') && (v.utilization === null || typeof v.utilization === 'number'));
}

// The latest weekly reading, or null.
export function latestWeekly(env, { before = null } = {}) {
  const all = readReadings(env).filter((r) => r.window === 'seven_day' && typeof r.utilization === 'number' && (!before || Date.parse(r.ts) <= before.getTime()));
  return all.at(-1) ?? null;
}

// A usage limit in these readings: the first window Claude Code `rejected`, or null. A warning
// (`allowed_warning`, as the SDK's type has it) is no limit: the projection covers it.
export const usageLimit = (readings) => readings.find((r) => r.status === 'rejected') ?? null;

// A reading still describes now: its window hasn't reset, and it's recent.
export const FRESH_MS = 12 * 3600_000;
export const freshReading = (r, now = Date.now()) => Boolean(r) && (!r.resets_at || r.resets_at * 1000 > now) && now - Date.parse(r.ts) < FRESH_MS;

// Your caps, from ~/.config/mirai/config.toml (D-57), with the defaults. A file that's there but
// can't be read gives { error }: your caps are never swapped for the defaults without a word.
export function usageCaps(env) {
  try {
    const file = readConfigFile(globalConfigPath(env.HOME), { trust: 'personal', optional: true });
    return { ...USAGE_DEFAULTS, ...(file?.value?.usage ?? {}) };
  } catch (err) {
    return { error: String(err.message).slice(0, 200) };
  }
}

// Before every ticket: { go, cap?, why?, warn?, numbers }. What each number is:
// - `night`: MIRAI's measured use in the last 12 hours, all runs and repos (the ledger), so a
//   resume or a second run doesn't start it again at 0;
// - `week`: MIRAI's measured use since the weekly window began (the ledger);
// - `used`: the latest weekly reading, whatever used it, if it's fresh (its window hasn't reset,
//   at most 12 hours old); the reserve is checked against it;
// - `next`: the largest ticket so far tonight, or `ticket_estimate`.
// Anything it can't tell refuses an unattended run, and warns in your terminal.
export function usageCheck({ env, largest = 0, unattended = true, caps = usageCaps(env), now = Date.now() }) {
  const unknown = (why) => (unattended ? { go: false, cap: 'unknown', why, numbers: {} } : { go: true, warn: `${why}, so the caps weren't checked`, numbers: {} });
  if (caps.error) return unknown(`your usage caps can't be read (${caps.error})`);
  const latest = latestWeekly(env);
  if (!freshReading(latest, now)) {
    // Readings come only from launches, so an old one needs a tiny launch to refresh it (D-18's probe,
    // unit 28): `probe` says so.
    const r = unknown(latest ? 'the last reading of your usage is out of date' : 'there\'s no reading of your usage yet');
    return { ...r, ...(r.go ? {} : { cap: latest ? 'stale' : 'unknown' }), probe: true };
  }
  const used = Math.round(latest.utilization * 100);
  const night = usageSince(env, new Date(now - FRESH_MS));
  const weekStart = latest.resets_at ? new Date((latest.resets_at - 7 * 86_400) * 1000) : new Date(now - 7 * 86_400_000);
  const week = usageSince(env, weekStart);
  const next = Math.max(largest, caps.ticket_estimate);
  const numbers = { used, night, week, next, night_max: caps.night_max, week_max: caps.week_max, reserve: caps.reserve };
  const over = [
    night + next > caps.night_max && ['night_max', `MIRAI's ${night}% in the last 12 hours with about ${next}% for the next ticket would pass night_max ${caps.night_max}%`],
    week + next > caps.week_max && ['week_max', `MIRAI's ${week}% this week with about ${next}% more would pass week_max ${caps.week_max}%`],
    100 - used - next < caps.reserve && ['reserve', `${100 - used}% of the week is left; the next ticket would take it under the reserve of ${caps.reserve}%`],
  ].find(Boolean);
  return over ? { go: false, cap: over[0], why: over[1], numbers } : { go: true, numbers };
}

// For a refusal: a MiraiError naming the cap.
export const usageStop = (check) => Object.assign(new MiraiError(`no new ticket: ${check.why}`, EXIT.NEEDS_HUMAN), { code: `usage-${check.cap}` });
