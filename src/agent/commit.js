import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { GIT_EMAIL, GIT_NAME } from '../config/config-schema.js';
import { globalConfigPath, readConfigFile } from '../config/load.js';
import { readPrivateFile } from '../store/files.js';
import { commitAll, workTreeChanges } from '../store/git.js';

// MIRAI's commits (unit 22; design/01 §7 step 1, §11; R2-M4). MIRAI alone commits on its
// branches, at fixed points, with pinned git: no hook runs, nothing signs, no config of yours is
// read. Every commit carries the trailer (`[git] trailer`, `Mirai-Ticket: <id>`), credits you as
// its author (your personal file's `[git] author_name` and `author_email`), and names MIRAI as its
// committer, which the push checks (05b's pushScope) and the key rule (06) look for. The subject is
// MIRAI's own words, never an agent's; Kai's summary goes in the body. Right after a commit the
// tree must be clean: anything that changed meanwhile is refused (19a: killing the group isn't
// enough).

export const COMMITTER_NAME = 'MIRAI';
export const COMMITTER_EMAIL = 'mirai@localhost';
const BODY_MAX = 4000;

const refuse = (message, code, hint) => Object.assign(new MiraiError(message, EXIT.BLOCKED), { code, hint });

// { author, committer }: you from your personal global file (no author: refused, never guessed);
// MIRAI as committer, with the project's `[git] committer_email` when a host needs a real address:
// a project fact, so every machine, CI and the push checks agree on it (unit 22 review).
export function identity(env, config = {}) {
  let git = {};
  try {
    git = readConfigFile(globalConfigPath(env.HOME), { trust: 'personal', optional: true })?.value?.git ?? {};
  } catch (err) {
    throw refuse(`your personal MIRAI config can't be read: ${String(err.message).slice(0, 200)}`, 'bad-identity');
  }
  const name = git.author_name;
  const email = git.author_email;
  if (typeof name !== 'string' || !GIT_NAME.test(name) || typeof email !== 'string' || !GIT_EMAIL.test(email)) {
    throw refuse('MIRAI\'s commits credit you, and your name and email aren\'t set', 'no-author', `add to ${globalConfigPath(env.HOME)}: [git] author_name = "Your Name" and author_email = "you@example.com"`);
  }
  const project = config.git?.committer_email;
  const committerEmail = typeof project === 'string' && GIT_EMAIL.test(project) ? project : COMMITTER_EMAIL;
  return { author: { name, email }, committer: { name: COMMITTER_NAME, email: committerEmail } };
}

// The project's commit facts from the newest `mirai detect` run (17a), or null.
function detectFacts(store) {
  let names;
  try {
    names = readdirSync(join(store.dir, 'detect')).filter((n) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(n) && !n.startsWith('.')).sort().reverse();
  } catch {
    return null;
  }
  for (const n of names) {
    try {
      return JSON.parse(String(readPrivateFile(join(store.dir, 'detect', n, 'facts.json'), { maxBytes: 8 * 1024 * 1024 }))).git ?? null;
    } catch {
      // a run without facts: the next older one
    }
  }
  return null;
}

// The subject format (G8): `[git] commit_format` when you set it; else Conventional Commits where
// 17a saw the history follow them; else plain. A committed commit-message rule MIRAI can't run
// (commitlint, a commit-msg hook) refuses until you set the format once.
export function commitFormat({ config, store }) {
  const set = config.git?.commit_format;
  if (set === 'plain' || set === 'conventional') return set;
  const facts = detectFacts(store);
  if ((facts?.commit_rules ?? []).length) {
    throw refuse(`the project has a commit-message rule MIRAI can't run (${facts.commit_rules.slice(0, 3).join(', ')})`, 'commit-format-unset', 'look at it, then set [git] commit_format = "plain" or "conventional" in .mirai/config.toml, and commit it');
  }
  return facts?.commits?.format === 'conventional' ? 'conventional' : 'plain';
}

export const subjectFor = ({ ticket, what, format }) => (format === 'conventional' ? `feat(${ticket}): ${what}` : `${ticket}: ${what}`);

// The whole message: subject, a body (an agent's text, cleaned: printable lines, capped), the trailer.
export function messageFor({ subject, body = '', trailer, ticket }) {
  const clean = String(body).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, BODY_MAX);
  return `${subject}\n\n${clean ? `${clean}\n\n` : ''}${trailer}: ${ticket}\n`;
}

// One commit at a commit point: the message, the identity, then the check that nothing changed
// after it. Returns the commit's id, or null when there's nothing to commit (a handover that
// changed nothing). `before()`: throws if the tree isn't what was checked (unit 22 review: what's
// committed is exactly what passed the checks); `ignored()`: the ignored files' fingerprint, taken
// again after the commit, which must not have changed.
export function commitStep({ store, env, config, ticket, what, body = '', before = () => {}, ignored = null }) {
  const who = identity(env, config);
  const format = commitFormat({ config, store });
  const trailer = config.git?.trailer ?? 'Mirai-Ticket';
  if (workTreeChanges(store.checkout, store.gitEnv).length === 0) return null;
  before();
  const ignoredBefore = ignored ? JSON.stringify(ignored()) : null;
  const sha = commitAll(store.checkout, store.gitEnv, { message: messageFor({ subject: subjectFor({ ticket, what, format }), body, trailer, ticket }), ...who });
  const after = workTreeChanges(store.checkout, store.gitEnv);
  if (after.length) throw refuse(`${after.length} file(s) changed right after MIRAI's commit (such as ${after[0]}): something is still writing to the project`, 'changed-after-commit', 'look for a process still working in the project; nothing was pushed');
  if (ignored && JSON.stringify(ignored()) !== ignoredBefore) throw refuse('ignored files under protected paths changed right after MIRAI\'s commit: something is still writing to the project', 'changed-after-commit', 'look for a process still working in the project; nothing was pushed');
  return sha;
}
