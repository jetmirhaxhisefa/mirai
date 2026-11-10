import { reviewsOf } from '../agent/review.js';
import { readPlan } from '../agent/plan.js';
import { readFrontmatter } from '../lint/frontmatter.js';
import { CITES_CODE } from '../reports/render.js';
import { blobAt } from '../store/git.js';

// The MR description's data (unit 27a; Jet's decision 3), for renderMrDescription: never a
// finding object, only text written for the MR.
//   - title and why: the ticket file at the shipped commit (its # heading, the first paragraph of
//     its Description);
//   - what changed: the plan's Tasks, one line each (the checkbox dropped);
//   - review: the latest review's round, and its non-blocking findings' claims as one-line
//     follow-ups; one that names a file or a line is left out and counted (review detail stays
//     local, D-29);
//   - risk: the plan's (or the ticket's); links: the ticket file's path.
// Returns { data, title, leftOut }.

const MAX_FOLLOWUPS = 10;
const oneLine = (text, max) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// The lines under a `## name` heading, up to the next heading of level 1 or 2; fenced code skipped.
export function section(body, name) {
  const out = [];
  let inside = false;
  let fence = null;
  for (const line of body.split('\n')) {
    const f = /^(```+|~~~+)/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    if (/^#{1,2}\s/.test(line)) {
      inside = line.replace(/^##\s+/, '').trim() === name && line.startsWith('## ');
      continue;
    }
    if (inside && !/^\s*<!--.*-->\s*$/.test(line)) out.push(line);
  }
  return out;
}

const firstParagraph = (lines) => {
  const out = [];
  for (const l of lines) {
    if (l.trim() === '') {
      if (out.length) break;
      continue;
    }
    out.push(l.trim());
  }
  return out.join(' ');
};

export function describeTicket({ store, ticket, head, ticketPath }) {
  const bytes = blobAt(store.checkout, head, ticketPath, store.gitEnv, { maxBytes: 256 * 1024 });
  if (bytes === null) throw Object.assign(new Error(`${ticketPath} isn't in the shipped commit`), { code: 'no-ticket-file' });
  const fm = readFrontmatter(bytes);
  const body = fm ? fm.body : bytes.toString('utf8');
  const heading = body.split('\n').find((l) => /^#\s+\S/.test(l));
  const titleText = oneLine(heading ? heading.replace(/^#\s+/, '') : ticket, 200);
  const why = oneLine(firstParagraph(section(body, 'Description')) || titleText, 1000);

  const plan = readPlan(store, ticket) ?? '';
  const planFm = (() => {
    try {
      return readFrontmatter(plan);
    } catch {
      return null;
    }
  })();
  const tasks = section(planFm ? planFm.body : plan, 'Tasks')
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) => oneLine(l.replace(/^\s*[-*]\s+(\[[ xX]\]\s+)?/, ''), 300))
    .filter(Boolean)
    .slice(0, 30);
  const what = tasks.length ? tasks : ['See the commits on this branch.'];

  const review = reviewsOf(store, ticket).at(-1)?.record ?? {};
  const byId = new Map((review.findings ?? []).map((f) => [f.id, f]));
  const followups = [];
  let leftOut = 0;
  for (const id of review.followups ?? []) {
    const claim = oneLine(byId.get(id)?.claim, 200);
    if (!claim) continue;
    if (CITES_CODE.test(claim) || followups.length >= MAX_FOLLOWUPS) {
      leftOut++;
      continue;
    }
    followups.push(claim);
  }
  if (leftOut > 0 && followups.length < MAX_FOLLOWUPS) followups.push(`${leftOut} more note${leftOut === 1 ? '' : 's'} from the review stay local (they name files or lines).`);

  const risk = planFm?.value?.risk === 'high' || fm?.value?.risk === 'high' ? 'high' : 'normal';
  const data = {
    ticket: { id: ticket, title: titleText },
    why,
    what_changed: what,
    review: { rounds: Math.max(1, Number(review.loop_round ?? review.round ?? 1) || 1) },
    followups,
    risk: risk === 'high' ? { level: 'high', reason: 'the ticket or its plan is high risk' } : { level: 'normal' },
    links: [],
    files: [{ label: 'Ticket', path: ticketPath }],
  };
  return { data, title: `${ticket}: ${titleText}`.slice(0, 256), leftOut };
}
