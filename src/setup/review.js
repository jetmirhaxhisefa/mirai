import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CONTEXT_DIR, contextKindOf } from '../lint/context.js';
import { contextApproval } from '../cli/commands/approve.js';
import { documentLine } from '../store/connectors/links.js';

// Stage 3's review (unit 39, decision 9): after setup writes or rewrites the context files, you're
// shown every one, what it is, its state, and its full path and link; then each in turn. For a file
// you approve (business.md, journeys.md, each conventions file), its `(open)` lines come first (36,
// decision 8), each asked as a question; its approval command is shown only once none is left.
// feature-map.md and each project file are checked against the code, not approved: you're asked
// "anything wrong or missing?". The stage isn't done while a file you approve is neither approved
// nor put off for later (`mirai setup defer`, a checklist line then).

const WHAT = Object.freeze({
  business: 'the business: who it\'s for, the problem, what matters, what\'s out',
  journeys: 'the critical journeys an end-to-end test keeps working',
  'feature-map': 'the screens and features, each with where it lives in the code',
  project: 'one service: its layout, stack, commands, test levels and instructions',
  conventions: 'one service\'s rules agents follow',
});

// An `(open)` line: a claim no source says yet.
const OPEN = /\(open\)\s*$/;

// Every context file with its review facts: [{ name, rel, abs, link, type, what, approved (whether
// you approve this kind), state, open: [{ line, text }] }].
export function contextFiles({ store, config = {}, events = null }) {
  let names = [];
  try {
    names = readdirSync(join(store.checkout, CONTEXT_DIR)).sort();
  } catch {
    names = [];
  }
  const out = [];
  for (const name of names) {
    const kind = contextKindOf(name);
    if (!kind) continue;
    const rel = `${CONTEXT_DIR}/${name}`;
    const abs = join(store.checkout, rel);
    let bytes = null;
    try {
      bytes = readFileSync(abs);
    } catch {
      bytes = null;
    }
    const text = bytes ? bytes.toString('utf8') : '';
    const open = text.split('\n').map((t, i) => ({ line: i + 1, text: t.trim() })).filter((l) => OPEN.test(l.text));
    let state;
    if (!kind.approved) state = 'checked against the code, not approved';
    else {
      const a = contextApproval(store, rel, bytes, events);
      state = a.approved ? 'approved' : a.stale ? 'changed since its approval' : 'not approved';
    }
    // The link: the host's, once the file is pushed with these bytes (38), else the file's own.
    const line = documentLine({ store, config, abs, rel, bytes, events });
    const host = line.includes('   ') ? line.slice(line.indexOf('   ') + 3) : null;
    out.push({ name, rel, abs, link: host ?? pathToFileURL(abs).href, type: kind.type, what: WHAT[kind.type], approved: kind.approved, state, open });
  }
  return out;
}

// The review's text: the list first (every file, its state, path and link), then each file in
// turn. `deferred`: the files you chose to come back to.
export function reviewText(files, { deferred = [] } = {}) {
  if (!files.length) return 'No context files yet: stage 3 writes them (.mirai/context/).\n';
  const out = ['The context files (review each one; links open the file):', ''];
  for (const f of files) {
    out.push(`- ${f.name}: ${f.what}`);
    out.push(`  state: ${f.state}${f.open.length ? `, ${f.open.length} (open) line${f.open.length === 1 ? '' : 's'}` : ''}${deferred.includes(f.rel) ? ', put off for later' : ''}`);
    out.push(`  ${f.abs}`);
    out.push(`  ${f.link}`);
  }
  out.push('', 'Then each file in turn:');
  files.forEach((f, i) => {
    const n = `${i + 1}.`;
    if (f.open.length) {
      out.push(`${n} ${f.name}: first its (open) line${f.open.length === 1 ? '' : 's'}, each a question for you (an answer goes in as a "you said" source):`);
      for (const o of f.open.slice(0, 20)) out.push(`   line ${o.line}: ${o.text.slice(0, 200)}`);
      out.push(`   ${f.approved ? 'its approval command comes once none is left' : 'then: anything wrong or missing?'}`);
    } else if (f.approved) {
      out.push(f.state === 'approved' ? `${n} ${f.name}: approved as it is` : `${n} ${f.name}: read it all, then in your terminal: mirai approve --file ${f.rel}   (or put it off: mirai setup defer ${f.rel})`);
    } else out.push(`${n} ${f.name}: checked against the code, not approved. Anything wrong or missing? Your correction is written in before the stage commit.`);
  });
  return `${out.join('\n')}\n`;
}

// What still keeps stage 3 from done: the files you approve that are neither approved nor put off.
export const contextGaps = (files, deferred = []) => files.filter((f) => f.approved && f.state !== 'approved' && !deferred.includes(f.rel));
