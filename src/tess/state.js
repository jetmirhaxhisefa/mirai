import { fullName } from '../agent/names.js';
import { plain } from '../status/text.js';

// The ticket planner's state for an initiative (unit 42, Scope 2 and 9), from the journal only: the
// last `tess_run` line. `mirai show <initiative>` prints these lines, and so does `mirai tickets` at
// its end, so your session tells you exactly what `mirai show` would (41's decision 4, reused).

const AGENT = 'mirai-ticket-planner';

export function tessStateOf(events, initiative, { runState = null } = {}) {
  const runs = events.filter((e) => e.type === 'tess_run' && e.item === initiative);
  const last = runs.at(-1) ?? null;
  if (!last) return { state: null };
  const lost = last.state === 'running' && runState !== null && !(runState?.state === 'running' && runState.run_id === last.run_id);
  return { state: lost ? 'lost' : last.state, last };
}

export function tessStateLines(events, initiative, { who = (id) => fullName(id), runState = null } = {}) {
  const t = tessStateOf(events, initiative, { runState });
  if (t.state === null) return [];
  const name = who(AGENT);
  const l = t.last;
  const one = l.mode === 'one' || l.mode === 'fix';
  const what = one ? `the ticket${typeof l.ticket === 'string' ? ` ${plain(l.ticket)}` : ''}` : 'the epic and its tickets';
  const again = l.mode === 'fix' ? `mirai tickets fix ${plain(initiative)}` : `mirai tickets ${plain(initiative)}${one ? ' --one' : ''}`;
  const record = [`run ${l.run_id}`, ...(l.rounds ? [`rounds: lint ${l.rounds.lint}, ${who('mirai-verifier')} ${l.rounds.verify}`] : []), ...(Number.isInteger(l.launches) ? [`${l.launches} launch${l.launches === 1 ? '' : 'es'}`] : []), ...(l.model ? [`${l.tier ? `${l.tier}, ` : ''}${plain(l.model)}`] : [])].join('; ');
  if (t.state === 'running') return [`${name}: running (run ${l.run_id}, since ${plain(String(l.ts ?? '').slice(0, 16))})`];
  if (t.state === 'lost') return [`${name}: her run ${l.run_id} stopped without its record; start her again: ${again}`];
  if (t.state === 'done') {
    const open = Number.isInteger(l.open?.vera) && l.open.vera > 0 ? l.open.vera : 0;
    return [open
      ? `${name}: done, with ${open} must-fix finding${open === 1 ? '' : 's'} from ${who('mirai-verifier')} on ${what} open after the last round: ready for your approval, which shows each one (${record})`
      : `${name}: done: ${what} ${one ? 'is' : 'are'} ready for your approval (${record})`];
  }
  if (t.state === 'paused') return [`${name}: paused on the PRD, waiting for your answer to ${l.question_id} in interview.md: ${plain(l.question)} (${record})`];
  return [`${name}: stopped on ${what}: ${plain(l.why ?? 'no reason recorded')} (${record})`];
}

// Unit 45 (Scope 4): your decisions at the ticket set's approval screens, from the journal: each drop
// and change with its reason, and the release mode the set was signed with. `mirai show` prints them
// after her state (design/13 §2, "Ticket decisions").
export function ticketDecisionLines(events, initiative) {
  const out = [];
  const decisions = events.filter((e) => e.type === 'ticket_decision' && e.item === initiative);
  const WORD = { drop: 'dropped', merge: 'to merge', split: 'to split', change: 'to change' };
  for (const d of decisions.slice(-20)) out.push(`  your decision, round ${d.round}: ${plain(d.ticket)} ${WORD[d.decision] ?? d.decision}: ${plain(d.reason)}`);
  if (decisions.length > 20) out.unshift(`  … ${decisions.length - 20} earlier`);
  const epics = new Set(decisions.map((d) => d.epic));
  const signed = events.filter((e) => e.type === 'approval' && e.by === 'human' && e.kind === 'epic' && e.decision !== 'rejected' && e.release_mode && (epics.has(e.item) || (e.path ?? '').split('/').at(-2) === initiative)).at(-1);
  if (signed) out.push(`  release: ${signed.release_mode}${signed.release_reason ? ` (you switched it: ${plain(signed.release_reason)})` : ''}, signed with the set (seq ${signed.seq})`);
  return out.length ? ['ticket decisions:', ...out] : [];
}
