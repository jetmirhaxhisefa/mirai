#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { runChecks } from '../../src/doctor/checks.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { readSetup, STAGES } from '../../src/setup/state.js';
import { scanLedger, staysInPlace } from '../../src/setup/ledger.js';
import { contextFiles } from '../../src/setup/review.js';
import { loadRegistry } from '../../src/config/registry.js';
import { CUSTOM_DIR, overlayFilesIn, overlayState, readOverlays, verifyRecords } from '../../src/config/overlays.js';
import { branchKeys } from '../../src/sign/keys.js';
import { readLock } from '../../src/install/lock.js';
import { projectInputs, REGISTRY_DIR } from '../../src/install/render.js';
import { committedNotRendered } from '../../src/setup/pre-commit.js';
import { advisoryNow, expectedNow, toFix } from '../../src/setup/checklist.js';

// Unit 39's probes P1–P3: checks you run in the project's checkout, in your terminal, after your
// own steps in your Claude Code session. Each prints PASS or FAIL with why, and changes nothing
// (no approval, no commit, no store write). Your key, your session and your subscription are
// yours: these checks never use them.
//
// P1 (Thudos: a clone, never Thudos's main; on an integration branch as in the pilot):
//   1. in the clone, in a Claude Code session: /mirai setup, and go through all five stages;
//      stop once inside a stage (close the session), start a new one, /mirai setup again: it
//      must go on at the item or file where you stopped (you judge that, and note it);
//   2. node <mirai>/test/probes/setup-probes.js --check p1
//      every stage done with its commit; every ledger item decided; nothing kept or dropped is left
//      in its old place; every custom item approved; business.md, journeys.md and each conventions
//      file approved as they are; nothing under .claude/ that MIRAI didn't render; doctor no red.
//   What it can't see, and you judge: each item's researched summary was right, you were shown
//   every context file with its path and link after stage 3, asked each (open) line, and asked to
//   review the feature map and project files.
// P2 (a fresh throwaway project, mirai init done, no links, only a pasted description):
//   1. /mirai setup up to stage 3; give it only pasted text as the source;
//   2. node <mirai>/test/probes/setup-probes.js --check p2
//      business.md lints clean, and its Sources table lists only "you said" and the pasted text.
// P3 (after P1, in the same clone):
//   1. in a new session, ask: "make a skill that lists the open merge requests"; it must use
//      /mirai custom add (the rule in CLAUDE.md worked); approve and render it;
//   2. node <mirai>/test/probes/setup-probes.js --check p3 --skill <its name>
//   3. by hand: cp -R .mirai/custom/project-skills/<name> .claude/skills/handmade, edit its
//      SKILL.md's name to handmade, git add .claude/skills/handmade, git commit -m x:
//      PASS when the commit is refused and prints "mirai custom add .claude/skills/handmade";
//      then git restore --staged .claude/skills/handmade && rm -r .claude/skills/handmade.

const { values } = parseArgs({ options: { check: { type: 'string' }, skill: { type: 'string' } } });
const env = process.env;
const cwd = process.cwd();
const results = [];
const check = (name, ok, why) => results.push({ name, ok, why });

const store = openStore({ cwd, env });
const registry = loadRegistry(join(store.checkout, REGISTRY_DIR));
const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
const customItems = () => {
  const files = overlayFilesIn(join(store.checkout, CUSTOM_DIR));
  const records = verifyRecords(files, { keys, repoId: store.repoId });
  const events = readJournal(store).events;
  return readOverlays(files, registry).map((o) => ({ ...o, ...overlayState(o, events, records) }));
};

if (values.check === 'p1') {
  const s = readSetup(store);
  for (const st of STAGES) check(`stage ${st} done`, s.stages[st].state === 'done' && Boolean(s.stages[st].commit), `${s.stages[st].state}${s.stages[st].commit ? ` at ${s.stages[st].commit.slice(0, 12)}` : ''}`);
  const undecided = Object.entries(s.items).filter(([, it]) => !it.decision).map(([id]) => id);
  check('every ledger item decided', !undecided.length, undecided.slice(0, 5).join(', ') || `${Object.keys(s.items).length} items`);
  const unresearched = Object.entries(s.items).filter(([, it]) => !it.researched).map(([id]) => id);
  check('every item has a researched summary', !unresearched.length, unresearched.slice(0, 5).join(', ') || 'all');
  const here = new Set(scanLedger({ root: store.checkout, env: store.gitEnv, registry, lock: readLock(store.checkout)?.files ?? null }).map((r) => r.id));
  const left = Object.entries(s.items).filter(([id, it]) => ['skill', 'agent', 'command', 'hook', 'script', 'mcp'].includes(it.kind) && here.has(id) && !(it.decision === 'keep' && staysInPlace(id))).map(([id]) => id);
  check('nothing left in its old place', !left.length, left.slice(0, 5).join(', ') || 'none');
  const items = customItems();
  const bad = items.filter((o) => o.state !== 'approved').map((o) => `${o.path} (${o.state})`);
  check('every custom item approved as it is', !bad.length, bad.slice(0, 5).join(', ') || `${items.length} items`);
  const { config } = projectInputs(store.checkout);
  const ctx = contextFiles({ store, config }).filter((f) => f.approved);
  const notApproved = ctx.filter((f) => f.state !== 'approved').map((f) => `${f.name} (${f.state})`);
  check('business, journeys and conventions approved', ctx.some((f) => f.type === 'business') && ctx.some((f) => f.type === 'journeys') && !notApproved.length, notApproved.join(', ') || ctx.map((f) => f.name).join(', '));
  const stray = committedNotRendered({ root: store.checkout, env: store.gitEnv });
  check('nothing under .claude/ that MIRAI didn\'t render', !stray.length, stray.slice(0, 5).join(', ') || 'none');
  const doc = await runChecks({ cwd, env });
  // Green: nothing to fix; a yellow doctor expects until a named later unit is fine (F4).
  const red = toFix(doc).map((i) => `${i.id} ${i.state}`);
  const later = expectedNow(doc).map((i) => `${i.id} until unit ${i.expected_until}`);
  const notes = advisoryNow(doc).map((i) => `${i.id} (advisory)`);
  check('mirai doctor green', !red.length, red.join(', ') || `nothing to fix${later.length ? `; expected: ${later.join(', ')}` : ''}${notes.length ? `; ${notes.join(', ')}` : ''}`);
} else if (values.check === 'p2') {
  const text = readFileSync(join(store.checkout, '.mirai/context/business.md'), 'utf8');
  const { execFileSync } = await import('node:child_process');
  let lintOk = true;
  try {
    execFileSync(process.execPath, [new URL('../../bin/mirai.js', import.meta.url).pathname, 'lint', '.mirai/context/business.md'], { cwd, env, stdio: 'pipe' });
  } catch {
    lintOk = false;
  }
  check('business.md lints clean', lintOk, lintOk ? 'mirai lint: 0 problems' : 'run mirai lint .mirai/context/business.md');
  const sources = text.slice(text.indexOf('## Sources')).split('\n').filter((l) => /^\| *S-\d+/.test(l));
  const other = sources.filter((l) => !/you said|pasted/i.test(l));
  check('every source is "you said" or the pasted text', sources.length > 0 && !other.length, other.join(' / ') || `${sources.length} sources`);
} else if (values.check === 'p3') {
  if (!values.skill) throw new Error('give --skill <name>');
  const o = customItems().find((x) => x.kind === 'project-skill' && x.name === values.skill);
  check('the skill is a project skill in .mirai/custom/', Boolean(o), o ? o.path : 'not found');
  check('approved', o?.state === 'approved', o?.state ?? '-');
  const lock = readLock(store.checkout);
  check('rendered into .claude/skills/', lock?.files.get(`.claude/skills/${values.skill}/SKILL.md`)?.mark === 'rendered', 'the lock lists it');
} else {
  process.stderr.write('usage: node test/probes/setup-probes.js --check p1|p2|p3 [--skill <name>]\n');
  process.exit(2);
}
for (const r of results) process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.why}\n`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
