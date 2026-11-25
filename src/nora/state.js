import { fullName } from '../agent/names.js';
import { plain } from '../status/text.js';
import { openQuestions } from '../lint/interview.js';
import { parseDocument } from '../lint/lint.js';

// Nora's state for an initiative (unit 41, Scope 6 and 7), from the journal only: the last
// `nora_run` line, and every `template_gap` line filed under the initiative. `mirai show
// <initiative>` prints these lines, and so does `mirai write` at its end, so your session tells you
// exactly what `mirai show` would (decision 4).

const AGENT = 'mirai-product-manager';

export function noraStateOf(events, initiative, { runState = null } = {}) {
  const runs = events.filter((e) => e.type === 'nora_run' && e.item === initiative);
  const last = runs.at(-1) ?? null;
  const gaps = events.filter((e) => e.type === 'template_gap' && e.item === initiative).map((e) => ({ template: e.template, section: e.section, message: e.message, at: e.ts ?? null }));
  if (!last) return { state: null, gaps };
  // A run whose start line is the last one, while no run of that id is going, ended without its
  // record (a crash, a reboot).
  const lost = last.state === 'running' && runState !== null && !(runState?.state === 'running' && runState.run_id === last.run_id);
  return { state: lost ? 'lost' : last.state, last, started: runs.findLast((e) => e.run_id === last.run_id && e.state === 'running')?.ts ?? null, gaps };
}

const DOC = { brief: 'the brief', prd: 'the PRD' };

// What a done run left open (its record's `open`), as "1 must-fix finding from Vera on the PRD".
// The journal is read as data: only known documents and whole counts are shown.
function openParts(open, who) {
  if (!Array.isArray(open)) return [];
  return open.filter((o) => o && Object.hasOwn(DOC, o.document)).map((o) => {
    const what = [
      ...(Number.isInteger(o.vera) && o.vera > 0 ? [`${o.vera} must-fix finding${o.vera === 1 ? '' : 's'} from ${who('mirai-verifier')}`] : []),
      ...(o.reader === true ? ['a reader test not passed'] : []),
    ];
    return what.length ? `${what.join(' and ')} on ${DOC[o.document]}` : null;
  }).filter(Boolean);
}

export function noraStateLines(events, initiative, { who = (id) => fullName(id), runState = null } = {}) {
  const n = noraStateOf(events, initiative, { runState });
  const name = who(AGENT);
  const out = [];
  const l = n.last;
  const record = l ? [`run ${l.run_id}`, ...(l.rounds ? [`rounds: lint ${l.rounds.lint}, ${who('mirai-verifier')} ${l.rounds.verify}, reader test ${l.rounds.reader}`] : []), ...(Number.isInteger(l.launches) ? [`${l.launches} launch${l.launches === 1 ? '' : 'es'}`] : []), ...(l.model ? [`${l.tier ? `${l.tier}, ` : ''}${plain(l.model)}`] : [])].join('; ') : '';
  if (n.state === null) out.push(`${name}: not started for this initiative (mirai write ${plain(initiative)} starts her)`);
  else if (n.state === 'running') out.push(`${name}: running (run ${l.run_id}, since ${plain(String(l.ts ?? '').slice(0, 16))})`);
  else if (n.state === 'lost') out.push(`${name}: her run ${l.run_id} stopped without its record (since ${plain(String(l.ts ?? '').slice(0, 16))}); start her again: mirai write ${plain(initiative)}`);
  else if (n.state === 'done') {
    const open = openParts(l.open, who);
    out.push(open.length
      ? `${name}: done, with ${open.join('; ')} open after the last round: the brief and the PRD are ready for your approval, which shows each one (${record})`
      : `${name}: done: the brief and the PRD are ready for your approval (${record})`);
  }
  else if (n.state === 'paused') out.push(`${name}: paused on ${DOC[l.document] ?? 'a document'}, waiting for your answer to ${l.question_id} in interview.md: ${plain(l.question)} (${record})`);
  else out.push(`${name}: stopped on ${DOC[l.document] ?? 'her run'}: ${plain(l.why ?? 'no reason recorded')} (${record})`);
  if (n.gaps.length) {
    out.push(`template gaps: ${n.gaps.length} (the templates are unchanged; each went into an existing section)`);
    for (const g of n.gaps) out.push(`  ${plain(g.template)}: ${plain(g.message)} (put in ${plain(g.section)})`);
  }
  return out;
}

// A document's "park" (unit 44, decision 2): no state of its own, an interview waiting for you.
// From interview.md as it is (its text): "waiting for you: 3 questions in interview.md (Q-7…Q-9)",
// or null when it isn't paused with an open question.
export function waitingLine(text) {
  let doc;
  try {
    doc = parseDocument(String(text ?? '').replace(/\r\n?/g, '\n'), 'interview.md');
  } catch {
    return null;
  }
  if (doc?.value?.state !== 'paused') return null;
  const open = openQuestions(doc);
  if (!open.length) return null;
  const span = open.length === 1 ? open[0] : `${open[0]}…${open.at(-1)}`;
  return `waiting for you: ${open.length} question${open.length === 1 ? '' : 's'} in interview.md (${span}): answer them in your session, then start the writer again`;
}
