import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { createPrompter, requireTty } from '../tty.js';
import { shown } from '../../status/text.js';
import { openStore } from '../../store/home.js';
import { snapshot, trustedStrict } from '../../trust/snapshot.js';
import { caseIndex } from '../../redteam/cases.js';
import { frameworkHash, templateNames } from '../../redteam/key.js';
import { DEFAULTS, redTeamStatus, runRedTeam } from '../../redteam/run.js';
import { NEXT, partsText, report, SESSION_NEXT, sessionReport } from '../../redteam/report.js';
import { listBlockers, listResults, readDecision, readResult, SESSIONS, writeDecision } from '../../redteam/store.js';
import { loadSigner } from '../../sign/signer.js';
import { PACKAGE_ROOT } from '../../install/parts.js';
import { runSessions, sessionEstimate, sessionStatus } from '../../redteam/sessions.js';

// mirai redteam run [--only <id,…>] | status | show [<key>] (unit 18a). `run` is yours alone: it
// needs a real terminal and your yes, since it uses your Claude subscription; agents can't run
// `mirai` at all. `status` says whether this machine's result is green for what's installed now
// (exit 0) or not (exit 5); `show` prints a stored result.

// About how long one case run takes (18a's probes: a median of 7 to 8 s), for the estimate.
const SECONDS_PER_RUN = 8;

// Direct cases run once with no model; adversarial ones take up to 20 turns (about 5 times a
// short run, R4 measures it); a container case or probe set (unit 18c) runs once, about a minute.
const NO_MODEL = { direct: 0, container: 8, probe: 8 };
function estimate(cases, templates, only) {
  let units = 0;
  let runs = 0;
  let weight = 0;
  for (const k of cases) {
    if (only && !only.includes(k.id)) continue;
    const n = k.templates.filter((t) => templates.includes(t)).length;
    units += n;
    if (k.kind in NO_MODEL) {
      weight += n * NO_MODEL[k.kind];
      continue;
    }
    runs += n * DEFAULTS.runs;
    weight += n * DEFAULTS.runs * (k.kind === 'adversarial' ? 5 : 1);
  }
  return { units, runs, minutes: Math.ceil((weight * SECONDS_PER_RUN) / DEFAULTS.workers / 60) };
}

export default {
  name: 'redteam',
  summary: 'Run the red-team checks that every unattended agent launch needs, or show where they stand',
  usage: 'mirai redteam run [--sessions] [--only <id,…>] | mirai redteam status [--sessions] | mirai redteam show [--sessions] [<key or blocker id>] | mirai redteam accept-blocker <id> --note <why>',
  positionals: { min: 1, max: 2 },
  options: {
    only: { type: 'string', description: 'run only these cases (comma-separated ids); a partial run is reported, never recorded' },
    note: { type: 'string', description: 'with accept-blocker: why you accept it' },
    sessions: { type: 'boolean', description: 'the cases for your own Claude Code sessions (they never gate a launch)' },
    kept: { type: 'boolean', description: 'with run: test the Claude Code agents run now (MIRAI\'s kept copy), not the newest installed' },
  },
  async run(args, io) {
    const [action, arg] = args.positionals;
    const only = args.values.only !== undefined ? args.values.only.split(',').map((s) => s.trim()).filter(Boolean) : null;
    if (action !== 'run' && only) throw new UsageError('--only is for run');
    if (args.values.sessions) return sessions(action, arg, only, io);
    if (action === 'accept-blocker') return acceptBlocker(arg, args.values.note, io);

    if (action === 'show') {
      const store = openStore({ cwd: io.cwd, env: io.env });
      const held = listBlockers(store).find((b) => b.id === arg);
      if (held?.result) {
        io.stdout.write(report(held.result));
        return EXIT.OK;
      }
      const keys = listResults(store);
      if (arg !== undefined && !/^[0-9a-f]{12,64}$/.test(arg)) throw new UsageError(`${shown(arg)} isn't a result key`, 'give at least 12 characters of one (mirai redteam status shows the current one)');
      const key = arg === undefined ? keys[0] : keys.find((k) => k.startsWith(arg));
      if (!key) {
        io.stdout.write(arg === undefined ? 'no red-team result here yet; run one with: mirai redteam run\n' : `no result ${arg}\n`);
        return EXIT.FAILURE;
      }
      io.stdout.write(report(readResult(store, key)));
      return EXIT.OK;
    }
    if (action === 'status') {
      if (arg !== undefined) throw new UsageError('status takes no argument');
      let s;
      try {
        s = await redTeamStatus({ cwd: io.cwd, env: io.env, installed: true, ...(io.docker ? { dockerVersion: io.docker.version } : {}), ...(io.claude ? { claude: io.claude } : {}) });
      } catch (err) {
        // The kept Claude Code is gone, changed, or its record doesn't verify (unit 18g): a state, said.
        if (!String(err.code ?? '').startsWith('tested-claude')) throw err;
        io.stdout.write(`red team: none for the Claude Code agents run\n\n${err.message}\n\nnext: ${err.hint}\n`);
        return EXIT.NEEDS_HUMAN;
      }
      const lines = [`red team: ${s.state}${s.result && s.state !== 'stale' ? ` (${s.result.created_at})` : ''}`, '', `this machine now (key ${s.key.slice(0, 16)}):`, ...partsText(s.parts)];
      // Which Claude Code agents run (unit 18g), and a newer one waiting.
      lines.push('', s.tested ? `agents run Claude Code ${s.parts.claude_code.version}: the binary the red team tested, kept by MIRAI` : `agents run your PATH's Claude Code ${s.parts.claude_code.version}: no green run has kept one yet (a green mirai redteam run does)`);
      if (s.installed) {
        const newer = versionAfter(s.installed.version, s.parts.claude_code.version);
        lines.push(`installed: Claude Code ${s.installed.version}${newer ? '' : ' (older)'}. MIRAI stays on ${s.parts.claude_code.version} until a red-team run on ${s.installed.version} is green${newer ? '' : ', or until you run it on a newer one'}; the checks below need no model, S3 and the cases need that run`);
        for (const c of s.installed.checks) lines.push(`  ${c.id} ${c.state}  ${c.note ?? ''}`);
      }
      if (s.state === 'stale') lines.push('', `changed since the last ${s.result.state === 'green' ? 'green ' : ''}result: ${s.changed.join(', ')}`);
      const accepted = s.blocker_seen ? readDecision(openStore({ cwd: io.cwd, env: io.env }), s.blocker_seen.id) : null;
      if (s.blocker_seen && !accepted) lines.push('', `launches are refused until you decide: read it (mirai redteam show ${s.blocker_seen.id}), then mirai redteam accept-blocker ${s.blocker_seen.id} --note <why>`);
      if (s.blocker_seen && s.state !== 'blocker') lines.push('', `a red-team run on this Claude Code and macOS found a blocker (${s.blocker_seen.created_at}): V1's condition was met once; see mirai redteam show ${s.blocker_seen.key.slice(0, 12)}`);
      // A refresh that changed MIRAI only outside the cage (unit 18f): the result still holds.
      if (s.state === 'green' && s.result?.framework_all) {
        try {
          if (frameworkHash(snapshot({ cwd: io.cwd, env: io.env }), { all: true }) !== s.result.framework_all) lines.push('', 'MIRAI changed since this result, but not the cage: this result still holds (docs/red-team.md)');
        } catch {
          // a note only
        }
      }
      lines.push('', `next: ${NEXT[s.state]}`, '');
      lines.push(await sessionLine(io), '');
      io.stdout.write(lines.join('\n'));
      return s.state === 'green' && (!s.blocker_seen || accepted) ? EXIT.OK : EXIT.NEEDS_HUMAN;
    }
    if (action !== 'run') throw new UsageError(`unknown action ${shown(action)}`, 'see: mirai redteam --help');
    if (arg !== undefined) throw new UsageError('run takes no argument; use --only <id,…>');

    requireTty(io, 'mirai redteam run');
    const trust = snapshot({ cwd: io.cwd, env: io.env });
    // A result speaks for the trust root's code, so that's the code that must run (18c's note).
    const differs = differsFromTrust(trust);
    if (differs) throw new UsageError(`this MIRAI isn't the trust root's copy (${shown(differs)} differs)`, 'run it through the launcher, from the integration branch\'s commit');
    const templates = templateNames(trust);
    for (const t of templates) trustedStrict(trust, t);
    const cases = caseIndex(trust);
    const unknown = (only ?? []).filter((id) => !cases.some((k) => k.id === id));
    if (unknown.length) throw new UsageError(`no case named ${unknown.map(shown).join(', ')}`, `the cases: ${cases.map((k) => k.id).join(', ')}`);
    const e = estimate(cases, templates, only);
    io.stdout.write([
      `The red team runs ${e.units} cases (${templates.join(', ')}): about ${e.runs} runs of Claude Code (${DEFAULTS.model}; the`,
      `adversarial ones on ${DEFAULTS.adversarialModel}), ${DEFAULTS.workers} at a time, roughly ${e.minutes} minutes. It uses your Claude subscription.`,
      'It works in clones of your integration branch under your home folder, with canary secrets, and a',
      'canary keychain item and git credential it removes afterwards. Your checkout isn\'t touched.',
      'Four cases try to reach Terminal or System Events (open, open -a, osascript): if macOS asks whether to allow that, answer no.',
      'It also runs each of your test levels and checks once in its containers (Docker Desktop must be running), with a',
      'script standing in for an agent\'s test code, and MIRAI\'s Docker and git probes.',
      '',
    ].join('\n'));
    const prompter = createPrompter(io);
    let answer;
    try {
      answer = await prompter.ask('Run it now? [y/N] ');
    } finally {
      prompter.close();
    }
    if (!/^y(es)?$/i.test(answer)) {
      io.stdout.write('nothing was run\n');
      return EXIT.OK;
    }
    const abort = new AbortController();
    const onInt = () => abort.abort();
    const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    for (const sig of SIGNALS) process.on(sig, onInt);
    try {
      const { result, recorded, partial, kept } = await runRedTeam({
        cwd: io.cwd, env: io.env, consent: true, only, kept: args.values.kept === true, signal: abort.signal,
        onEvent: (ev) => {
          if (ev.type === 'run') io.stderr.write(`${ev.id} (${ev.template}) run ${ev.n}: ${ev.outcome}\n`);
        },
      });
      io.stdout.write(report(result, { recorded, partial }));
      if (kept?.ok) io.stdout.write(`agents now run Claude Code ${kept.version}, the binary this run tested\n`);
      else if (kept) io.stdout.write(`green, but MIRAI couldn't keep the binary it tested (${kept.why}): agents stay on the one they ran before\n`);
      return result.state === 'green' && recorded && kept?.ok !== false ? EXIT.OK : EXIT.NEEDS_HUMAN;
    } finally {
      for (const sig of SIGNALS) process.removeListener(sig, onInt);
    }
  },
};

// Whether version a (x.y.z) comes after b.
function versionAfter(a, b) {
  const p = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// One line in the main status: your sessions' suite is its own command, so it's easy to forget.
async function sessionLine(io) {
  try {
    const s = await sessionStatus({ cwd: io.cwd, env: io.env, ...(io.claude ? { claude: io.claude } : {}) });
    const limits = s.result?.cases?.filter((k) => !k.controls && k.outcome === 'known-limit').length ?? 0;
    const said = s.state === 'green' ? `no promise broken, ${limits} known limits (mirai redteam show --sessions)` : s.state === 'red' || s.state === 'incomplete' ? s.state : `${s.state}; mirai redteam run --sessions`;
    return `your own sessions (never gates a launch): ${said}`;
  } catch {
    return 'your own sessions (never gates a launch): unknown';
  }
}

// Compares the running code with the trust root's framework copy: the first file that differs, or null.
function differsFromTrust(trust) {
  const prefix = 'tree/.mirai/framework/';
  const listed = (trust.manifest?.files ?? []).filter((f) => f.path.startsWith(prefix));
  if (!listed.length) return 'the trust root\'s framework';
  for (const f of listed) {
    let bytes;
    try {
      bytes = readFileSync(join(PACKAGE_ROOT, f.path.slice(prefix.length)));
    } catch {
      return f.path.slice(prefix.length);
    }
    if (createHash('sha256').update(bytes).digest('hex') !== f.sha256) return f.path.slice(prefix.length);
  }
  return null;
}

async function acceptBlocker(arg, note, io) {
  requireTty(io, 'mirai redteam accept-blocker');
  if (!/^[0-9a-f]{24}$/.test(arg ?? '')) throw new UsageError('name the blocker\'s id', 'mirai redteam status shows it');
  if (!note || !/\S/.test(note) || note.length > 500) throw new UsageError('--note says why you accept it, in one line');
  const store = openStore({ cwd: io.cwd, env: io.env });
  const blocker = listBlockers(store).find((b) => b.id === arg);
  if (!blocker) throw new UsageError(`${shown(arg)} isn't a blocker on record here`, 'see: mirai redteam status');
  writeDecision(store, blocker.id, note, loadSigner(io.env, store));
  io.stdout.write(`recorded, signed: you accept the blocker of ${blocker.created_at}. Launches may go ahead once a current result is green.\n`);
  return EXIT.OK;
}

async function sessions(action, arg, only, io) {
  if (action === 'show') {
    const store = openStore({ cwd: io.cwd, env: io.env });
    const keys = listResults(store, SESSIONS);
    if (arg !== undefined && !/^[0-9a-f]{12,64}$/.test(arg)) throw new UsageError(`${shown(arg)} isn't a result key`);
    const key = arg === undefined ? keys[0] : keys.find((k) => k.startsWith(arg));
    if (!key) {
      io.stdout.write(arg === undefined ? `no result here yet; ${SESSION_NEXT.none}\n` : `no result ${arg}\n`);
      return EXIT.FAILURE;
    }
    io.stdout.write(sessionReport(readResult(store, key, { kind: SESSIONS })));
    return EXIT.OK;
  }
  if (action === 'status') {
    if (arg !== undefined) throw new UsageError('status takes no argument');
    const s = await sessionStatus({ cwd: io.cwd, env: io.env, ...(io.claude ? { claude: io.claude } : {}) });
    io.stdout.write(`red team, your sessions: ${s.state}${s.result && s.state !== 'stale' ? ` (${s.result.created_at})` : ''}\n${s.state === 'stale' ? `changed: ${s.changed.join(', ')}\n` : ''}next: ${SESSION_NEXT[s.state]}\n`);
    return s.state === 'green' ? EXIT.OK : EXIT.NEEDS_HUMAN;
  }
  if (action !== 'run') throw new UsageError(`unknown action ${shown(action)}`, 'see: mirai redteam --help');
  if (arg !== undefined) throw new UsageError('run takes no argument; use --only <id,…>');
  requireTty(io, 'mirai redteam run --sessions');
  const e = sessionEstimate(only);
  if (only && !e.cases) throw new UsageError(`no case named ${only.map(shown).join(', ')}`);
  io.stdout.write([
    `This runs ${e.cases} cases about your own sessions: about ${e.runs} runs of Claude Code (haiku), roughly ${e.minutes} minutes. It uses your Claude subscription.`,
    'These runs have NO sandbox, some in bypass mode, as your user. Each is one exact command, on a clone under your home folder,',
    'with a fake home and a temporary Claude Code config; your real key and config aren\'t used. It never affects a launch.',
    '',
  ].join('\n'));
  const prompter = createPrompter(io);
  let answer;
  try {
    answer = await prompter.ask('Run it now? [y/N] ');
  } finally {
    prompter.close();
  }
  if (!/^y(es)?$/i.test(answer)) {
    io.stdout.write('nothing was run\n');
    return EXIT.OK;
  }
  const abort = new AbortController();
  const onInt = () => abort.abort();
  const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const sig of SIGNALS) process.on(sig, onInt);
  try {
    const { result, recorded, partial } = await runSessions({
      cwd: io.cwd, env: io.env, consent: true, only, signal: abort.signal,
      onEvent: (ev) => { if (ev.type === 'run') io.stderr.write(`${ev.id}: ${ev.run}\n`); },
    });
    io.stdout.write(sessionReport(result, { recorded, partial }));
    return result.state === 'green' && recorded ? EXIT.OK : EXIT.NEEDS_HUMAN;
  } finally {
    for (const sig of SIGNALS) process.removeListener(sig, onInt);
  }
}
