import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { appendEvent, checkEvent, LOG_TYPES } from '../../store/journal.js';
import { atomicWrite, checkPrivateDir } from '../../store/files.js';
import { containsToken } from '../../sign/token.js';

// log_event(type, message, template?, section?) (unit 15a; D-53): an agent's note or template
// gap, written to the repo's journal as `by: "agent"` with the launch it came from, or, from your
// own session (unit 15b), as `by: "session"` with the registration's id. Only the journal's
// LOG_TYPES: the privileged types (approvals, status, gate results, records) aren't in the enum.
// The item is the launch's, from the policy, never the agent's. No git: the policy names the
// store outright.
//
// The text is the agent's, headed for your inbox and reports, so it's held to more than the
// journal's own rules: no control characters but newline and tab, no bidi or invisible-only text,
// and, as the hook does for written files, no login token and no known secret shape. At most
// `max_events` lines per launch (or, in your session, per UTC day), counted in the launch's (or
// the session's) folder, so a restarted server doesn't start again at 0, and taken under the
// journal lock with the line itself.

const TEXT_MAX = 200;
// How long a call waits for the journal lock: the server answers nothing while it waits, so not
// the CLI's 30 seconds.
export const LOCK_WAIT_MS = 2000;
// C0 and C1 controls but tab and newline, DEL, bidi embeddings, overrides and isolates, and lone
// surrogates.
const BAD_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
// Something visible: not only spaces, zero-width or other format characters.
const VISIBLE = /[^\s\p{Cf}\p{Zs}]/u;
const COUNT_FILE = 'log-events';

function textProblem(name, v, limit) {
  if (typeof v !== 'string' || v.length < 1 || v.length > limit) return `${name} must be text of 1 to ${limit} characters`;
  if (BAD_CHARS.test(v)) return `${name} has a control, bidi or broken character; plain text only (newlines and tabs are fine)`;
  if (!VISIBLE.test(v)) return `${name} must be text of 1 to ${limit} characters`;
  return null;
}

// Your session's day counts older than a week are removed.
function pruneDays(dir, today) {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  for (const name of readdirSync(dir)) {
    const m = /^log-events-(\d{4}-\d{2}-\d{2})$/.exec(name);
    if (m && m[1] < cutoff) rmSync(join(dir, name), { force: true });
  }
}

const refuse = (code, message) => ({ body: { outcome: 'refused', code, message }, isError: true });

function countSoFar(file) {
  try {
    const n = Number(readFileSync(file, 'utf8').trim());
    return Number.isInteger(n) && n >= 0 ? n : Infinity;
  } catch (err) {
    return err.code === 'ENOENT' ? 0 : Infinity;
  }
}

export default Object.freeze({
  name: 'log_event',
  description: (policy) => `Write a note, or a template gap (a section a MIRAI template is missing), to MIRAI's journal ${policy.kind === 'headless' ? 'for this run' : 'as your session\'s'}. Returns the line's number.`,
  exclusive: false,
  contexts: Object.freeze(['headless', 'interactive']),
  enabled: (policy) => Boolean(policy.tools.log_event),
  schema: (policy) => ({
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...policy.tools.log_event.types], description: 'note, or template_gap' },
      message: { type: 'string', minLength: 1, maxLength: policy.tools.log_event.max_message, description: 'what to record' },
      template: { type: 'string', minLength: 1, maxLength: TEXT_MAX, description: 'with template_gap: the template' },
      section: { type: 'string', minLength: 1, maxLength: TEXT_MAX, description: 'with template_gap: the missing section' },
    },
    required: ['type', 'message'],
    additionalProperties: false,
  }),
  check(args, policy) {
    const { types, max_message: max } = policy.tools.log_event;
    if (typeof args.type !== 'string' || !types.includes(args.type)) return { refused: `${JSON.stringify(args.type)} isn't a type agents may log; types: ${types.join(', ')}` };
    const bad = textProblem('message', args.message, max);
    if (bad) return { refused: bad };
    const gap = args.type === 'template_gap';
    for (const k of ['template', 'section']) {
      const problem = gap && textProblem(k, args[k], TEXT_MAX);
      if (problem) return { refused: `template_gap needs ${k}: ${problem}` };
      if (!gap && args[k] !== undefined) return { refused: `${k} is for template_gap` };
    }
    const event = { type: args.type, ...(gap ? { template: args.template, section: args.section } : {}), message: args.message };
    return { args: event };
  },
  async run(event, ctx) {
    const { policy } = ctx;
    const { max_events: max, secrets } = policy.tools.log_event;
    // An agent run's cap is per launch; your session's per registration and UTC day.
    const headless = policy.kind === 'headless';
    const today = (ctx.deps.now?.() ?? new Date()).toISOString().slice(0, 10);
    const counter = headless ? join(policy.launch_dir, COUNT_FILE) : join(policy.state_dir, `${COUNT_FILE}-${today}`);
    const full = () => refuse('log-full', headless ? `this run has logged ${max} events, the most it may` : `your sessions here have logged ${max} events today (UTC), the most they may`);
    if (countSoFar(counter) >= max) return full();
    // The secret check, as the hook does for what an agent writes: refused, never redacted.
    let token;
    try {
      token = ctx.token();
    } catch {
      return refuse('token-unreadable', 'the login token couldn\'t be read, so the text can\'t be checked for it');
    }
    for (const text of [event.message, event.template, event.section].filter((t) => t !== undefined)) {
      if (token && containsToken(text, token)) return refuse('secret', 'the text holds the Claude login token');
      const hit = secrets.find((s) => new RegExp(s.regex, 'u').test(text));
      if (hit) return refuse('secret', `the text holds a secret (${hit.name}); leave it out`);
    }
    const line = headless
      ? { ...event, by: 'agent', launch_id: policy.launch_id, ...(policy.item ? { item: policy.item } : {}) }
      : { ...event, by: 'session', registration_id: policy.registration_id };
    const store = { dir: policy.store.dir, repoId: policy.store.repo_id };
    try {
      checkEvent(line);
    } catch (err) {
      return refuse('bad-arguments', err instanceof RangeError ? 'the text is too long for one journal line (16 KB)' : ctx.clean(err.message));
    }
    let ok = false;
    try {
      ok = checkPrivateDir(store.dir);
    } catch {
      // not private: refused below
    }
    if (!ok) return { body: { outcome: 'env-fault', code: 'no-store', message: 'this repo\'s store is missing or not private' }, isError: true };
    let seq;
    try {
      // The count is checked again and taken under the journal lock, just before the line is
      // written, so two sessions (two servers) on one registration can't pass the cap together.
      seq = appendEvent(store, line, {
        lock: { waitMs: ctx.deps.lockWaitMs ?? LOCK_WAIT_MS },
        before: () => {
          const n = countSoFar(counter);
          if (n >= max) return false;
          atomicWrite(counter, `${n + 1}\n`);
          if (!headless) pruneDays(policy.state_dir, today);
          return true;
        },
      });
    } catch (err) {
      if (err.code === 'locked') return { body: { outcome: 'env-fault', code: 'journal-busy', message: 'MIRAI\'s journal is busy; try again in a moment' }, isError: true };
      return { body: { outcome: 'env-fault', code: err.code ?? 'error', message: ctx.clean(err.message) }, isError: true };
    }
    if (seq === null) return full();
    return { body: { logged: event.type, seq }, isError: false };
  },
});
