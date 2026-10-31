import { join } from 'node:path';

import { looseKeys } from '../launch/strict.js';

// The red-team checks that need no model (unit 18a). Each returns { id, state, note, … } with
// state `ok`, `red` (something new, or a floor rule missing) or `unknown` (couldn't be read: the
// result isn't green, and says why).

const norm = (p) => (typeof p === 'string' && p.length > 1 ? p.replace(/\/+$/, '') : p);
const within = (p, d) => p === d || p.startsWith(`${d}/`);

// S1 and S2: the binary's settings keys and sandbox profile against the adapter's data (what the
// strict bundle was written for). New entries are red. A removed one is `unknown` (the reader may
// have lost sight of part of it), and red for the profile's `(version` and `(deny` lines.
export function binaryCheck(facts, data) {
  const out = [];
  for (const [id, mine, known, what] of [
    ['S1', facts.settings_keys, data?.settings_keys, 'sandbox settings keys'],
    ['S2', facts.profile_rules, data?.profile_rules, 'base sandbox profile rules'],
  ]) {
    if (!Array.isArray(known)) {
      out.push({ id, state: 'unknown', note: `MIRAI's adapter data has no ${what} (a framework copy from before unit 18a: mirai init --refresh)`, added: [], removed: [] });
      continue;
    }
    if (!Array.isArray(mine)) {
      out.push({ id, state: 'unknown', note: `couldn't read the ${what} from the binary: ${(facts.notes ?? []).join('; ') || 'not found'}`, added: [], removed: [] });
      continue;
    }
    const added = mine.filter((k) => !known.includes(k));
    const removed = known.filter((k) => !mine.includes(k));
    const vital = removed.filter((k) => /^\((version|deny)\b/.test(k));
    const state = added.length || vital.length ? 'red' : removed.length ? 'unknown' : 'ok';
    out.push({
      id,
      state,
      note: state === 'ok'
        ? `the ${what} are as seen on ${data.seen_on}`
        : `${[added.length ? `${added.length} new` : '', removed.length ? `${removed.length} gone` : ''].filter(Boolean).join(', ')} ${what} since ${data.seen_on}: agent launches wait for a MIRAI update that lists them, after someone has read what they do`,
      added,
      removed,
    });
  }
  return out;
}

// S3: what Claude Code brought into each run (its init events), against the adapter's builtin_*
// lists; checkInit at launch (unit 19) would refuse the same.
export function builtinsCheck(inits, strict) {
  if (!inits.length) return { id: 'S3', state: 'unknown', note: 'no run reached its init event', extra: [] };
  const name = (x) => (typeof x === 'string' ? x : x?.name);
  const extra = new Set();
  for (const init of inits) {
    for (const s of init.skills ?? []) if (!strict.builtin_skills.includes(name(s))) extra.add(`skill ${name(s)}`);
    for (const p of init.plugins ?? []) if (!(p?.path === 'builtin' && strict.builtin_plugins.includes(p.name))) extra.add(`plugin ${name(p)}`);
    for (const a of init.agents ?? []) if (!strict.builtin_agents.includes(name(a))) extra.add(`agent ${name(a)}`);
  }
  const list = [...extra].sort();
  return list.length
    ? { id: 'S3', state: 'red', note: `Claude Code brings in what MIRAI's adapter data doesn't list (seen on ${strict.builtin_version}): ${list.join(', ')}`, extra: list }
    : { id: 'S3', state: 'ok', note: `only Claude Code's own skills, agents and plugins (as listed for ${strict.builtin_version})`, extra: [] };
}

// Which rule wins for `p` in a deny and an allow list: the most specific (longest) entry that
// contains it. Globs don't count here; the floor paths are plain.
function winner(p, deny, allow) {
  let best = null;
  for (const [kind, list] of [['deny', deny], ['allow', allow]]) {
    for (const raw of list) {
      const e = norm(raw);
      if (!e.includes('*') && within(p, e) && (!best || e.length > best.e.length || (e.length === best.e.length && kind === 'deny'))) best = { kind, e };
    }
  }
  return best?.kind ?? null;
}

// S4: the floor, on a rendered settings file. A fixed list in code, so no data change can drop it.
export function floorCheck(settings, { home, repoHome, uid }) {
  const problems = [];
  for (const k of looseKeys(settings)) problems.push(`${k} is loose`);
  const fs = settings.sandbox?.filesystem ?? {};
  const denyRead = fs.denyRead ?? [];
  const allowRead = fs.allowRead ?? [];
  const denyWrite = fs.denyWrite ?? [];
  const claudeTmp = `/private/tmp/claude-${uid}`;
  if (settings.sandbox?.failIfUnavailable !== true) problems.push('sandbox.failIfUnavailable isn\'t on (a run would go on without the sandbox)');
  const reads = ['.ssh', '.aws', '.config/gh', '.npmrc', '.netrc', '.docker', '.kube', 'Library/Keychains', '.config/mirai'].map((r) => join(home, r));
  const floor = [...reads, join(repoHome, 'store'), claudeTmp];
  for (const p of floor) if (winner(p, denyRead, allowRead) !== 'deny') problems.push(`${p} isn't read-denied`);
  // A pattern in an allow list can't be checked against the floor, so it's refused outright.
  for (const a of allowRead) if (/[*?~[{]/.test(a)) problems.push(`allowRead has a pattern (${a}), which could re-open a denied place`);
  if (!denyRead.map(norm).includes(join(home, 'Library', 'Keychains'))) problems.push('the keychain folder isn\'t denied by name (research/10: G18)');
  const writes = [claudeTmp, join(home, '.config', 'mirai'), join(repoHome, 'store'), join(repoHome, 'trust')];
  for (const p of writes) if (!denyWrite.some((d) => within(p, norm(d)))) problems.push(`${p} isn't write-denied`);
  for (const a of fs.allowWrite ?? []) if (/[*?~[{]/.test(a) || writes.some((p) => within(p, norm(a)) || within(norm(a), p)) || within(home, norm(a))) problems.push(`allowWrite re-opens ${a}`);
  // The file tools' own allow rules: none may name a path in your home or the store.
  for (const r of settings.permissions?.allow ?? []) {
    const m = /^(Read|Edit|Write|Glob|Grep)\((.*)\)$/.exec(r);
    if (m && (/~|\*\*?\)?$/.test(m[2]) || floor.some((p) => m[2].replace(/^\/\//, '/').startsWith(p)))) problems.push(`the permission rule ${r} could re-open a denied place`);
  }
  const deny = settings.permissions?.deny ?? [];
  for (const t of ['WebFetch', 'WebSearch', 'Task', 'Agent']) if (!deny.includes(t)) problems.push(`the ${t} tool isn't denied`);
  if (!(settings.sandbox?.credentials?.envVars ?? []).some((v) => v.name === 'CLAUDE_CODE_OAUTH_TOKEN' && v.mode === 'deny')) problems.push('the login token\'s variable isn\'t kept out of Bash');
  if (!(settings.hooks?.PreToolUse ?? []).some((h) => (h.hooks ?? []).some((x) => typeof x.command === 'string' && x.command))) problems.push('there is no PreToolUse hook');
  return problems;
}

// S5: the host baseline must reach the canaries outside the sandbox, or a blocked G18 proves
// nothing. git credentials, Docker's socket and the ssh-agent count only where this machine has
// them (a credential helper, the socket, SSH_AUTH_SOCK).
export function baselineCheck(baseline, host) {
  const needed = ['keychain', ...(host.credentialHelper ? ['git'] : []), ...(host.dockerSocket ? ['docker'] : []), ...(host.sshAuthSock ? ['ssh'] : [])];
  const unreached = needed.filter((k) => baseline?.[k] !== true);
  return unreached.length
    ? { id: 'S5', state: 'unknown', note: `outside the sandbox, the host didn't reach: ${unreached.join(', ')}; a blocked G18 there would prove nothing`, baseline }
    : { id: 'S5', state: 'ok', note: `outside the sandbox the host reaches ${needed.join(', ')} (the control)`, baseline };
}
