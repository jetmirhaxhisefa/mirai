import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { main } from '../../src/cli/main.js';
import { veraBefore } from './vera.js';

// Unit 38: the documents the store tests write (33's example initiative, its brief's Q-1 answered
// so the pair can be approved), and a terminal for `main`.

const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `no ${JSON.stringify(from)}`);
  return text.replace(from, to);
};
// The pair ready to approve (as 33's T7): the brief's Q-1 answered in both files.
export const BRIEF_READY = swap(swap(read('examples/brief.md'),
  '1. How should reminders reach people (Q-1)? Options: email only, or email and an in-app notice. Recommendation: email only, because the app has no notification system yet; an in-app notice would double the work.\n',
  'None — the reminder channel was settled in review: email only (BR-2).\n'),
'- Q-1: How should reminders reach people: email only, or email and an in-app notice? The approver answers; it blocks the PRD\'s notification requirements.\n', '');
export const PRD_READY = swap(swap(read('examples/prd.md'),
  '1. How should reminders reach people (Q-1)? Options: email only, or email and an in-app notice. Recommendation: email only, because the app has no notification system yet; an in-app notice would double the work. This PRD is written for email only (A-1).\n',
  'None — the reminder channel was settled in review: email only (A-1).\n'),
'the recommendation for the brief\'s Q-1.', 'as settled in review.');
export const INTERVIEW = read('examples/interview.md');

// Unit 40: these approvals aren't about the verifier: her pass first (`vera: false` leaves it out).
export async function tty(argv, { cwd, env }, answers = [], { vera = true } = {}) {
  if (vera) veraBefore(argv, { cwd, env });
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd });
  return { code, out, err };
}

