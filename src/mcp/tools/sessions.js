import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { acquireLock, atomicWrite } from '../../store/files.js';
import { withSeq } from '../../store/journal.js';
import { newRunId } from '../../store/run.js';
import { RUN_ID } from '../../store/run-log.js';

// session_start and session_end (unit 19c; D-12, R-M3, PM2-3): a run id for your interactive
// authoring, so its work is logged like a run's. No run lock (19c, your choice): you're there, and
// authoring shouldn't block a launch you start from it. One open session per registration: the
// next start closes one left open, and says so: one open session per repo at a time, across all
// your windows and your terminal. The same for `mirai session start|end`. What's logged: a start and
// an end line in the run log; your notes keep their registration id, not the session's run id.

const SKILL = /^[a-z][a-z0-9-]{0,63}$/;
const ITEM = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const NOTE = /^[^\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]{1,500}$/;
const refuse = (code, message) => ({ body: { outcome: 'refused', code, message }, isError: true });

// The functions both the server and the CLI use. `store`: { dir, repoId }; `stateDir`: where the
// open session is kept.
export function startSession(store, stateDir, { skill, item = null }) {
  // One at a time: two windows starting together mustn't lose a session.
  const lock = acquireLock(join(stateDir, 'session.lock'), 'starting a session', { waitMs: 5000 });
  try {
    return startLocked(store, stateDir, { skill, item });
  } finally {
    lock.release();
  }
}

function startLocked(store, stateDir, { skill, item }) {
  const current = join(stateDir, 'session-current');
  const closed = endSession(store, stateDir, { id: null, note: 'closed when the next session started' });
  const runId = newRunId();
  withSeq(store, ({ take, runLine }) => runLine(runId, take(), { item: item ?? 'run', event: 'session_started', skill }));
  atomicWrite(current, `${JSON.stringify({ run_id: runId, item })}\n`);
  return { run_id: runId, ...(closed ? { closed: closed.run_id } : {}) };
}

export function endSession(store, stateDir, { id, note = null }) {
  const current = join(stateDir, 'session-current');
  let open;
  try {
    open = JSON.parse(readFileSync(current, 'utf8'));
  } catch {
    return null;
  }
  if (id !== null && open.run_id !== id) return { mismatch: open.run_id };
  withSeq(store, ({ take, runLine }) => runLine(open.run_id, take(), { item: open.item ?? 'run', event: 'session_ended', ...(note ? { note } : {}) }));
  rmSync(current, { force: true });
  return { run_id: open.run_id };
}

const storeOf = (policy) => ({ dir: policy.store.dir, repoId: policy.store.repo_id });

export const sessionStart = Object.freeze({
  name: 'session_start',
  description: 'Give this authoring session a MIRAI run id, so its work is logged like a run\'s: the skill, and optionally the ticket or document.',
  exclusive: false,
  contexts: Object.freeze(['interactive']),
  enabled: (policy) => Boolean(policy.tools.session_start),
  schema: () => ({ type: 'object', properties: { skill: { type: 'string', pattern: SKILL.source }, item: { type: 'string', pattern: ITEM.source } }, required: ['skill'], additionalProperties: false }),
  check(args) {
    if (typeof args.skill !== 'string' || !SKILL.test(args.skill)) return { refused: 'skill must be a skill name' };
    if (args.item !== undefined && (typeof args.item !== 'string' || !ITEM.test(args.item))) return { refused: 'item must be a ticket or document id' };
    return { args: { skill: args.skill, item: args.item ?? null } };
  },
  async run(args, ctx) {
    return { body: startSession(storeOf(ctx.policy), ctx.policy.state_dir, args), isError: false };
  },
});

export const sessionEnd = Object.freeze({
  name: 'session_end',
  description: 'End the session session_start began, with an optional one-line note.',
  exclusive: false,
  contexts: Object.freeze(['interactive']),
  enabled: (policy) => Boolean(policy.tools.session_end),
  schema: () => ({ type: 'object', properties: { id: { type: 'string', pattern: RUN_ID.source }, note: { type: 'string', maxLength: 500 } }, required: ['id'], additionalProperties: false }),
  check(args) {
    if (typeof args.id !== 'string' || !RUN_ID.test(args.id)) return { refused: 'id must be the run id session_start gave' };
    if (args.note !== undefined && (typeof args.note !== 'string' || !NOTE.test(args.note))) return { refused: 'note must be one line of plain text' };
    return { args: { id: args.id, note: args.note ?? null } };
  },
  async run(args, ctx) {
    const r = endSession(storeOf(ctx.policy), ctx.policy.state_dir, args);
    if (!r) return refuse('no-session', 'no session is open here');
    if (r.mismatch) return refuse('other-session', `the open session is ${r.mismatch}, not ${args.id}`);
    return { body: { ended: r.run_id }, isError: false };
  },
});
