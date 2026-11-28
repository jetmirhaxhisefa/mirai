import { appendFileSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { trustFingerprint, verifyTrustRoot } from '../trust/verify.js';
import { matches } from '../util/glob.js';
import { containsToken, readTokenAt } from '../sign/token.js';
import { parseJsonStrict } from '../findings/schema.js';

// The hook (unit 13c; research/09 §7.6): Claude Code runs it before every file tool call an agent
// makes, outside the sandbox. The sandbox covers commands; the file tools are covered only by
// Claude Code's own rules, which match names. The hook looks at the real file on disk:
// - the path check: every path a call names, symlinks resolved and case ignored (as macOS disks
//   do), must be inside the run's roots, and not .git, .mirai, a write-denied path or a .env*
//   file (except the committed readable ones);
// - the inode check: no file that is the same file on disk as a protected one (a hard link,
//   13c's probe);
// - the secret check: no login token, in any encoding, and no known secret shape, in what a
//   write tool writes.
// For writes it is the gate: the bundle doesn't allow the write tools by its rules, so a call is
// refused unless the hook allows it (a hook that fails to run refuses too; 13c's probe). For
// reads Claude Code needs no permission inside the project, so the hook can only add refusals.
// The policy comes from the launch's read-only input folder, checked against its hash; the trust
// root the hook runs from is checked again on every call, by its fingerprint (unit 19a).

export const POLICY_SCHEMA = 'mirai-hook-policy/1';
export const READ_TOOLS = Object.freeze(['Read', 'Glob', 'Grep']);
export const WRITE_TOOLS = Object.freeze(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
export const HOOKED_TOOLS = Object.freeze([...READ_TOOLS, ...WRITE_TOOLS]);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// The policy for one launch: everything the hook decides by, in absolute paths.
// Unit 65b: `writeOnly` (the only files a write may name) and `web` ({ state, max_searches,
// deadline }: the research run's fetch gate), both only for a research launch.
export function hookPolicy({ checkout, readRoots, writeRoots, writeDenied, hooksPaths, readableEnv, protectedFiles, trust, tokenFile, secrets, writeOnly = null, web = null }) {
  const inodes = [];
  for (const p of protectedFiles) {
    try {
      const st = statSync(p);
      inodes.push([String(st.dev), String(st.ino), p]);
    } catch {
      // gone: nothing to protect
    }
  }
  return {
    schema: POLICY_SCHEMA, checkout, readRoots, writeRoots, writeDenied, hooksPaths, readableEnv, protectedInodes: inodes,
    trust, tokenFile, secrets: secrets.map((s) => ({ name: s.name, regex: s.regex })),
    ...(writeOnly ? { writeOnly } : {}), ...(web ? { web } : {}),
  };
}

export const policyText = (policy) => `${JSON.stringify(policy, null, 2)}\n`;

// The policy, read and checked against the hash the settings carry.
export function readPolicy(file, sha) {
  const text = readFileSync(file, 'utf8');
  if (sha256(text) !== sha) throw new Error('the hook policy changed since the launch');
  const policy = parseJsonStrict(text);
  if (policy.schema !== POLICY_SCHEMA) throw new Error('the hook policy isn\'t one this MIRAI reads');
  return policy;
}

const fold = (p) => (process.platform === 'darwin' ? p.normalize('NFC').toLowerCase() : p);
const within = (p, dir) => {
  const a = fold(p);
  const b = fold(dir);
  return a === b || a.startsWith(b === '/' ? '/' : `${b}${sep}`);
};

// A path as it really is on disk: symlinks resolved in the part that exists, the rest (a file
// about to be made) added back as written. Null for a symbolic link that points nowhere: writing
// through one would create its target wherever it points, and nothing here can say where that is
// safe (13c review: a dangling link to ~/Library/LaunchAgents).
export function realTarget(p) {
  let head = resolve(p);
  const rest = [];
  for (;;) {
    try {
      return join(realpathSync.native(head), ...rest.reverse());
    } catch {
      try {
        if (lstatSync(head).isSymbolicLink()) return null;
      } catch {
        // not there at all: a part of a new path
      }
      const parent = dirname(head);
      if (parent === head) return resolve(p);
      rest.push(basename(head));
      head = parent;
    }
  }
}

// Why a path a call names isn't one the hook will judge, or null. Claude Code reads paths its own
// way (it trims spaces and expands "~"), so anything that isn't already a plain absolute path is
// refused rather than guessed at (13c review); the tools ask for absolute paths anyway.
function notCanonical(p) {
  if (typeof p !== 'string' || p === '') return 'an empty path';
  if (p.includes('\0')) return 'a path with a NUL';
  if (p !== p.trim()) return `"${p}" starts or ends with a space`;
  if (p.startsWith('~')) return `"${p}" starts with ~`;
  if (!isAbsolute(p)) return `"${p}" isn't an absolute path`;
  if (/(^|\/)\.\.(\/|$)/.test(p)) return `${p} uses ".."`;
  return null;
}

// The paths a call names, exactly as given (checked by notCanonical). A Glob or Grep without a
// path searches the session's folder; Glob's pattern counts by its fixed leading part, and may
// not climb out with ".." or start with "~" anywhere in it.
export function callPaths(tool, input, cwd) {
  const out = [];
  if (['Read', 'Edit', 'Write', 'MultiEdit'].includes(tool)) out.push(input.file_path);
  if (tool === 'NotebookEdit') out.push(input.notebook_path);
  if (tool === 'Glob' || tool === 'Grep') {
    const base = input.path === undefined || input.path === '' ? cwd : input.path;
    out.push(base);
    if (tool === 'Glob' && typeof input.pattern === 'string') {
      const pattern = input.pattern;
      if (pattern.startsWith('~') || pattern !== pattern.trim() || /(^|\/)\.\.(\/|$)/.test(pattern)) out.push(`~${pattern}`);
      else {
        const fixed = pattern.split('/');
        const stop = fixed.findIndex((part) => /[*?[{]/.test(part));
        const lead = (stop < 0 ? fixed : fixed.slice(0, stop)).join('/');
        if (lead) out.push(isAbsolute(lead) ? lead : (typeof base === 'string' && isAbsolute(base) ? join(base, lead) : lead));
      }
    }
  }
  return out;
}

// What a write tool writes.
export function callContent(tool, input) {
  if (tool === 'Write') return [input.content];
  if (tool === 'Edit') return [input.new_string];
  if (tool === 'MultiEdit') return (input.edits ?? []).map((e) => e?.new_string);
  if (tool === 'NotebookEdit') return [input.new_source];
  return [];
}

// Why one path may not be used by this kind of call, or null. `given` is the path as named,
// `target` the real one: write-denied names count by either, so a write-denied folder that is
// itself a symlink elsewhere (.githooks -> scripts/hooks) is still refused.
function pathProblem(policy, target, write, given = target) {
  if (target === null) return `${given} is a symbolic link that points nowhere`;
  const roots = write ? policy.writeRoots : policy.readRoots;
  if (!roots.some((r) => within(target, r))) return `${target} is outside the project`;
  const parts = fold(target).split(sep);
  if (parts.includes('.git')) return `${target} is inside a .git folder`;
  const inCheckout = within(target, policy.checkout);
  const rel = inCheckout ? relative(policy.checkout, target).split(sep).join('/') : null;
  const name = basename(target);
  if (/^\.env/i.test(name) && !policy.readableEnv.some((p) => fold(p) === fold(target))) return `${target} is a .env file`;
  if (write) {
    const rels = [rel, within(given, policy.checkout) ? relative(policy.checkout, given).split(sep).join('/') : null].filter((r) => r !== null);
    for (const r of rels) {
      if (r === '.mirai' || fold(r).startsWith('.mirai/')) return `${target} is MIRAI's own`;
      if (policy.writeDenied.some((pat) => matches(pat, r))) return `${target} runs by itself when the project is opened or built`;
    }
    if (policy.hooksPaths.some((h) => within(target, h) || within(given, h))) return `${target} is in the project's git hooks folder`;
    if (policy.readableEnv.some((p) => fold(p) === fold(target))) return `${target} is a .env file`;
    if (policy.writeOnly && !policy.writeOnly.some((p) => fold(p) === fold(target))) return `${target} isn't this run's output (${policy.writeOnly.map((p) => basename(p)).join(', ')})`;
  }
  // The inode check: the same file on disk as a protected one, under any name (a hard link).
  for (const st of [() => lstatSync(target), () => statSync(target)]) {
    let info;
    try {
      info = st();
    } catch {
      continue;
    }
    const hit = policy.protectedInodes.find(([dev, ino]) => dev === String(info.dev) && ino === String(info.ino));
    if (hit) return `${target} is the same file as a protected one`;
  }
  return null;
}

// The decision for one call: { allow: true } or { allow: false, reason }. `token` is the login
// token (the hook reads it itself), or null when none is set; `tokenUnreadable` when its file
// couldn't be read: then writes are refused, never let through unchecked.
export function decide(policy, call, { token = null, tokenUnreadable = false, now = Date.now() } = {}) {
  const tool = call.tool_name;
  if (WEB_TOOLS.includes(tool)) return decideWeb(policy, call, { now });
  if (!HOOKED_TOOLS.includes(tool)) return { allow: false, reason: `${tool} isn't a tool this hook knows` };
  // A research launch's every call needs the hook's yes (no allow rules), so a timeout refuses.
  if (policy.web && now > policy.web.deadline) return { allow: false, reason: 'the research run is past its time' };
  const input = call.tool_input ?? {};
  const cwd = typeof call.cwd === 'string' && isAbsolute(call.cwd) ? call.cwd : policy.checkout;
  const write = WRITE_TOOLS.includes(tool);
  const paths = callPaths(tool, input, cwd);
  if (paths.length === 0) return { allow: false, reason: `the ${tool} call names no path` };
  for (const p of paths) {
    const odd = notCanonical(p);
    if (odd) return { allow: false, reason: `${odd}; use a plain absolute path` };
    const problem = pathProblem(policy, realTarget(p), write, p);
    if (problem) return { allow: false, reason: problem };
  }
  if (write) {
    if (tokenUnreadable) return { allow: false, reason: 'the login token couldn\'t be read, so what this writes can\'t be checked for it' };
    for (const text of callContent(tool, input)) {
      if (typeof text !== 'string') continue;
      if (token && containsToken(text, token)) return { allow: false, reason: 'the content holds the Claude login token' };
      for (const s of policy.secrets) {
        if (new RegExp(s.regex, 'u').test(text)) {
          return { allow: false, reason: `the content holds a secret (${s.name}); use a placeholder, or make test keys when the tests run` };
        }
      }
    }
  }
  return { allow: true, write, ...(policy.web ? { grant: true } : {}) };
}

// ---- The research run's fetch gate (unit 65b, decision 3.2) -------------------------------------

export const WEB_TOOLS = Object.freeze(['WebSearch', 'WebFetch']);
const URLS = 'urls.txt';
const EVIDENCE = 'evidence.jsonl';
const SEARCHES = 'searches';
const MAX_EVIDENCE = 256 * 1024;

// A URL as the gate compares it, or null for one it never allows: http(s) only, no user or
// password; the host lower-case, the default port and the fragment dropped, http and https the
// same (WebFetch upgrades http); the path as given and the query exactly as given.
export function gateUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 4096 || /\s/.test(raw)) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || !u.hostname) return null;
  const port = u.port && !((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) ? `:${u.port}` : '';
  return `https://${u.hostname.toLowerCase()}${port}${u.pathname}${u.search}`;
}

// The URLs one search returned, from Claude Code's tool_response (P0: { query, results: [{
// content: [{ title, url }] }] }); anything else gives none.
export function searchUrls(response) {
  let r = response;
  if (typeof r === 'string') {
    try {
      r = JSON.parse(r);
    } catch {
      return [];
    }
  }
  const out = [];
  for (const block of Array.isArray(r?.results) ? r.results : []) {
    for (const item of Array.isArray(block?.content) ? block.content : []) {
      const g = gateUrl(item?.url);
      if (g) out.push(g);
    }
  }
  return [...new Set(out)];
}

const listed = (state) => {
  try {
    return new Set(readFileSync(join(state, URLS), 'utf8').split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
};

// Before a web call: a search takes one of the cap's slots (a file made with O_EXCL, so two at
// once can't both take the last); a fetch must name a listed URL.
function decideWeb(policy, call, { now }) {
  const web = policy.web;
  if (!web) return { allow: false, reason: `${call.tool_name} isn't allowed in this launch` };
  if (now > web.deadline) return { allow: false, reason: 'the research run is past its time' };
  const input = call.tool_input ?? {};
  if (call.tool_name === 'WebSearch') {
    if (typeof input.query !== 'string' || !input.query.trim()) return { allow: false, reason: 'the search has no query' };
    mkdirSync(join(web.state, SEARCHES), { recursive: true, mode: 0o700 });
    for (let i = 0; i < web.max_searches; i++) {
      try {
        closeSync(openSync(join(web.state, SEARCHES, String(i)), 'wx', 0o600));
        return { allow: true, grant: true };
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }
    }
    return { allow: false, reason: `the run has used its ${web.max_searches} searches` };
  }
  const url = gateUrl(input.url);
  if (!url) return { allow: false, reason: 'the fetch names no plain http(s) URL' };
  if (!listed(web.state).has(url)) return { allow: false, reason: `${input.url} isn't a URL one of this run's searches returned` };
  return { allow: true, grant: true };
}

// After a web call: a search's URLs join the list; a fetch's returned text is kept as the run's
// evidence (decision 3.4). Nothing to answer: the call has run.
export function recordWeb(policy, call) {
  const web = policy.web;
  if (!web || !WEB_TOOLS.includes(call.tool_name)) return { recorded: false };
  if (call.tool_name === 'WebSearch') {
    const urls = searchUrls(call.tool_response);
    if (urls.length) appendFileSync(join(web.state, URLS), `${urls.join('\n')}\n`, { mode: 0o600 });
    return { recorded: true, urls: urls.length };
  }
  let r = call.tool_response;
  if (typeof r === 'string') {
    try {
      r = JSON.parse(r);
    } catch {
      r = { result: r };
    }
  }
  const text = typeof r?.result === 'string' ? r.result.slice(0, MAX_EVIDENCE) : '';
  const line = { url: gateUrl(call.tool_input?.url), code: Number.isInteger(r?.code) ? r.code : null, result: text };
  appendFileSync(join(web.state, EVIDENCE), `${JSON.stringify(line)}\n`, { mode: 0o600 });
  return { recorded: true };
}

// The run's evidence, for the research lint: [{ url, code, result }], in order.
export function readEvidence(state) {
  let text = '';
  try {
    text = readFileSync(join(state, EVIDENCE), 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

// The URLs the run's searches returned, for the research lint.
export const readListed = (state) => [...listed(state)];

// One hook call, end to end: check the trust root and the policy, read the token, decide. Any
// error is a refusal.
export function runHook({ policyFile, policySha, stdin }) {
  try {
    const policy = readPolicy(policyFile, policySha);
    // The hook can't vouch for its own code (it runs it); the sandbox's write deny on trust/ is
    // the guard for that. This check catches a change to the rest of the trust root.
    if (!policy.trust) return { allow: false, reason: 'the hook policy names no trust root' };
    // The launch hashed the whole trust root; here, its fingerprint (unit 19a: a call that takes
    // seconds can pass the hook's timeout, and a Read then goes ahead unchecked).
    if (policy.trust.fingerprint) {
      if (trustFingerprint(policy.trust.dir) !== policy.trust.fingerprint) return { allow: false, reason: 'the trust root changed since the launch started' };
    } else verifyTrustRoot(policy.trust);
    let call;
    try {
      call = JSON.parse(stdin);
    } catch {
      return { allow: false, reason: 'the hook got input it can\'t read' };
    }
    let token = null;
    let tokenUnreadable = false;
    try {
      token = policy.tokenFile ? readTokenAt(policy.tokenFile) : null;
    } catch {
      tokenUnreadable = true;
    }
    if (call?.hook_event_name === 'PostToolUse') return { post: true, ...recordWeb(policy, call) };
    return decide(policy, call, { token, tokenUnreadable });
  } catch (err) {
    return { allow: false, reason: `the hook refused because it failed: ${err.message}` };
  }
}

