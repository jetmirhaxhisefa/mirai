import { fullName } from '../agent/names.js';
import { plain } from '../status/text.js';

// The architect's state for an initiative (unit 64, Scope 2), from the journal only: the last
// `design_run` line. `mirai show <initiative>` prints these lines, and so does `mirai design` at its
// end, as Tess's (src/tess/state.js).

const AGENT = 'mirai-architect';
const WORD = { hld: 'the HLD', lld: 'the LLD', 'tech-note': 'the technical note' };

export function designStateOf(events, initiative, { runState = null } = {}) {
  const last = events.filter((e) => e.type === 'design_run' && e.item === initiative).at(-1) ?? null;
  if (!last) return { state: null };
  const lost = last.state === 'running' && runState !== null && !(runState?.state === 'running' && runState.run_id === last.run_id);
  return { state: lost ? 'lost' : last.state, last };
}

export function designStateLines(events, initiative, { who = (id) => fullName(id), runState = null } = {}) {
  const t = designStateOf(events, initiative, { runState });
  if (t.state === null) return [];
  const name = who(AGENT);
  const l = t.last;
  const what = (l.written ?? []).length ? l.written.map((d) => WORD[d] ?? d).join(' and ') : WORD[l.document] ?? 'the design';
  const again = `mirai design ${plain(initiative)}`;
  const record = [`run ${l.run_id}`, ...(l.rounds ? [`rounds: lint ${l.rounds.lint}, ${who('mirai-verifier')} ${l.rounds.verify}`] : []), ...(Number.isInteger(l.launches) ? [`${l.launches} launch${l.launches === 1 ? '' : 'es'}`] : []), ...(l.model ? [`${l.tier ? `${l.tier}, ` : ''}${plain(l.model)}`] : [])].join('; ');
  if (t.state === 'running') return [`${name}: running (run ${l.run_id}, since ${plain(String(l.ts ?? '').slice(0, 16))})`];
  if (t.state === 'lost') return [`${name}: his run ${l.run_id} stopped without its record; start him again: ${again}`];
  if (t.state === 'done') {
    const open = Number.isInteger(l.open?.vera) && l.open.vera > 0 ? l.open.vera : 0;
    return [open
      ? `${name}: done, with ${open} must-fix finding${open === 1 ? '' : 's'} from ${who('mirai-verifier')} on ${what} open after the last round: ready for your approval, which shows each one (${record})`
      : `${name}: done: ${what} ${(l.written ?? []).length > 1 ? 'are' : 'is'} ready for your approval (${record})`];
  }
  if (t.state === 'paused') return [`${name}: paused on the PRD, waiting for your answer to ${l.question_id} in interview.md: ${plain(l.question)} (${record})`];
  return [`${name}: stopped on ${WORD[l.document] ?? 'the design'}: ${plain(l.why ?? 'no reason recorded')} (${record})`];
}
