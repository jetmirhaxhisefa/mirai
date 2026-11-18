// The build runner's requests (unit 29e; design/10 §2.2): a job from a fixed list, a commit pushed
// on a branch of MIRAI's GitHub repo, and only the argument that job declares. Everything else is
// refused, and the refusal is logged.

export const JOBS = Object.freeze({
  tests: { arg: 'none', where: 'export' },
  probes: { arg: 'probe-file', where: 'export' },
  baseline: { arg: 'none', where: 'sample' },
  'redteam-cases': { arg: 'fact-or-ids', where: 'sample' },
  'redteam-full': { arg: 'none', where: 'sample' },
  'redteam-session': { arg: 'none', where: 'sample' },
  'sample-run': { arg: 'run-script', where: 'sample' },
});

const ID = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const COMMIT = /^[0-9a-f]{40}$/;
// An argument is a name, never a path or a flag: letters, digits, spaces and - _ . , only, no "..".
const ARG = /^[A-Za-z0-9][A-Za-z0-9 _.,-]{0,199}$/;
const PROBE_FILE = /^[a-z0-9][a-z0-9-]*-probes?\.js$/;
const RUN_SCRIPT = /^[a-z0-9][a-z0-9-]*\.js$/;
const FIELDS = new Set(['id', 'job', 'commit', 'arg']);

export class Refused extends Error {
  constructor(why) {
    super(why);
    this.refused = true;
  }
}

// The request's shape, before anything is looked up: { id, job, commit, arg }.
export function parseRequest(text) {
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    throw new Refused('the request isn\'t JSON');
  }
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Refused('the request isn\'t an object');
  const extra = Object.keys(r).filter((k) => !FIELDS.has(k));
  if (extra.length) throw new Refused(`unknown fields: ${extra.join(', ')}`);
  if (typeof r.id !== 'string' || !ID.test(r.id)) throw new Refused('the id must be lowercase letters, digits, dots and dashes (at most 64)');
  if (typeof r.job !== 'string' || !Object.hasOwn(JOBS, r.job)) throw new Refused(`unknown job ${JSON.stringify(String(r.job).slice(0, 40))}; the jobs: ${Object.keys(JOBS).join(', ')}`);
  if (typeof r.commit !== 'string' || !COMMIT.test(r.commit)) throw new Refused('the commit must be a full 40-character hash');
  const spec = JOBS[r.job];
  if (spec.arg === 'none') {
    if (r.arg !== undefined) throw new Refused(`${r.job} takes no argument`);
    return { id: r.id, job: r.job, commit: r.commit, arg: null };
  }
  if (typeof r.arg !== 'string' || !ARG.test(r.arg) || r.arg.includes('..')) throw new Refused(`${r.job} needs one argument: a name, never a path or a flag`);
  if (spec.arg === 'probe-file' && !PROBE_FILE.test(r.arg)) throw new Refused('probes takes a file name from test/probes/, such as git-probes.js');
  if (spec.arg === 'run-script' && !RUN_SCRIPT.test(r.arg)) throw new Refused('sample-run takes a script name from tools/runs/, such as r1-sample.js');
  return { id: r.id, job: r.job, commit: r.commit, arg: r.arg };
}

// The red team's cases for one fact, or the named case ids. `cases` is the red team's own index
// ({ id, fact }). A fact matches as one of the comma-separated parts of a case's fact.
export function selectCases(arg, cases) {
  const ids = arg.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length && ids.every((id) => cases.some((c) => c.id === id))) return ids;
  const fact = arg.trim();
  const byFact = cases.filter((c) => String(c.fact ?? '').split(',').map((s) => s.trim()).includes(fact)).map((c) => c.id);
  if (byFact.length) return byFact;
  const facts = [...new Set(cases.flatMap((c) => String(c.fact ?? '').split(',').map((s) => s.trim())))].filter(Boolean).sort();
  throw new Refused(`no case has the fact or id ${JSON.stringify(arg)}; the facts: ${facts.join(', ')}`);
}
