// The hand checklist (unit 39, Scope 11; PM3-10, roadmap row 39): what only you can do, each line
// with the exact command, what you should see, and the default for every optional choice. Each
// line's state comes from `mirai doctor`'s items where one checks it, else from your own mark
// (`mirai setup checklist --done <n>`). Printed by `mirai setup checklist` and stored, with the
// states, in .mirai/setup/checklist.md.

export const CHECKLIST_FILE = '.mirai/setup/checklist.md';

// `doctor`: the doctor items that decide the line (all ok: done; one red: open; else: check);
// none means only your mark does.
export const CHECKLIST = Object.freeze([
  {
    n: 1, title: 'Your login token for agents, once per machine',
    command: 'claude setup-token   (then paste it into: mirai token set)',
    see: 'mirai token status says the token is set; doctor\'s Login item is ok. MIRAI keeps it in ~/.config/mirai/claude-token (yours only, denied to agents); doctor warns 30 days before the year it lasts runs out',
    default: 'no choice to make: agents can\'t run without it',
    doctor: ['login'],
  },
  {
    n: 2, title: 'The host push credentials MIRAI\'s orchestrator uses',
    command: 'gh auth login   (GitLab: GLAB_CONFIG_DIR=<your folder> glab auth login), then: mirai init --refresh',
    see: 'gh auth status (or glab auth status) says you\'re logged in; doctor\'s Host CLIs item names gh or glab',
    default: 'the host your origin remote is on; MIRAI uses its CLI\'s own login, never a token of its own',
    doctor: ['host-cli'],
  },
  {
    n: 3, title: 'Your signing key, protected, and its backup',
    command: 'mirai key new, then mirai key protect; commit .mirai/keys/<key-id>.pub by itself and merge it. Then keep a copy of the private key file (mirai key status shows where it is) in your password manager',
    see: 'doctor\'s Your key and Key at rest items are ok; the backup is yours to mark: mirai setup checklist --done 3',
    default: 'a passphrase-protected key and a machine key (mirai key new --machine); the backup isn\'t optional',
    doctor: ['key', 'key-rest'], mark: true,
  },
  {
    n: 4, title: '.env.test, the test stack\'s environment',
    command: 'create the file [compose] env_file names (default .env.test) with test-only values, never real secrets; it stays out of git',
    see: 'mirai baseline records the levels green; mirai setup checklist --done 4',
    default: 'only if the test stack needs variables; MIRAI never reads your real .env',
    doctor: [], mark: true,
  },
  {
    n: 5, title: 'Managed settings (locks the rules for every Claude Code session on this Mac)',
    command: 'skip it for now; to turn it on later, setup writes Claude Code\'s managed-settings.json for this Mac, with your admin password',
    see: 'nothing to see while it\'s off; mirai setup checklist --done 5 records your choice',
    default: 'off',
    doctor: [], mark: true,
  },
  {
    n: 6, title: 'The integration branch',
    command: 'git push -u origin <integration branch>   (mirai init named it; [git] integration_branch)',
    see: 'doctor\'s Trust root item is ok for its commit; agents start from it',
    default: 'main, or the branch you gave mirai init --branch (on a pilot: an integration branch of its own, never the project\'s main)',
    doctor: ['trust'],
  },
  {
    n: 7, title: 'CI required checks',
    command: 'in the host\'s branch settings, require your test levels\' CI jobs on the integration branch',
    see: 'the host shows them as required on the integration branch; mirai setup checklist --done 7',
    default: 'every test level the baseline records; until unit 54, your merge is the gate (doctor\'s Merge gate item says so)',
    doctor: [], mark: true,
  },
  {
    n: 8, title: 'mirai doctor until it\'s green',
    command: 'mirai doctor',
    see: 'no red item, and every yellow one is either fixed, one MIRAI expects until a later unit (today: Merge gate, local-only until unit 54), or advisory (a session server behind that still starts; no baseline yet at the head with one at an earlier commit; an old reading of your usage, which the next run refreshes); a yellow item names its fix on the line under it',
    default: 'no choice to make',
    doctor: ['*'],
  },
]);

// Doctor's items still to act on: every red and every yellow, except a yellow doctor marks as
// expected until a named later unit (`expected_until`; P1's F4: the Merge gate is local-only until
// unit 54, so "doctor green" could never be reached). The last line and P1's probe use it.
// Advisory yellows (F8, F10: `advisory: true`, a note doctor gives with its hint, not a fault) don't
// count either; they're listed apart.
const isExpected = (i) => i.state === 'yellow' && typeof i.expected_until === 'string' && i.expected_until;
const isAdvisory = (i) => i.state === 'yellow' && i.advisory === true && !isExpected(i);
export const toFix = (items) => (items ?? []).filter((i) => i.state === 'red' || (i.state === 'yellow' && !isExpected(i) && !isAdvisory(i)));
export const expectedNow = (items) => (items ?? []).filter(isExpected);
export const advisoryNow = (items) => (items ?? []).filter(isAdvisory);

// Each line with its state: `done`, `open` or `check` (doctor has a yellow item for it), and why.
// `items`: doctor's items ([{ id, state, detail, hint }]); `marks`: { <n>: 'done' } from setup.json.
export function checklistState(items, marks = {}) {
  const byId = new Map((items ?? []).map((i) => [i.id, i]));
  return CHECKLIST.map((l) => {
    const all = l.doctor.includes('*');
    const mine = all ? toFix(items).concat((items ?? []).filter((i) => i.state === 'ok')) : l.doctor.map((id) => byId.get(id)).filter(Boolean);
    const red = mine.filter((i) => i.state === 'red');
    const yellow = mine.filter((i) => i.state === 'yellow');
    let state;
    let why;
    if (!l.doctor.length) [state, why] = marks[l.n] === 'done' ? ['done', 'you marked it done'] : ['open', 'mark it once done: mirai setup checklist --done ' + l.n];
    else if (!(all ? (items ?? []).length : mine.length)) [state, why] = ['open', 'doctor didn\'t check it'];
    else if (red.length) [state, why] = ['open', `${red[0].title ?? red[0].id}: ${red[0].detail}`];
    else if (yellow.length) [state, why] = ['check', `${yellow[0].title ?? yellow[0].id}: ${yellow[0].detail}`];
    else {
      const later = all ? expectedNow(items) : [];
      const notes = all ? advisoryNow(items) : [];
      const parts = [
        ...(later.length ? [`expected until a later unit: ${later.map((i) => `${i.title ?? i.id} (unit ${i.expected_until})`).join(', ')}`] : []),
        ...(notes.length ? [`advisory: ${notes.map((i) => `${i.title ?? i.id} (${i.hint})`).join(', ')}`] : []),
      ];
      [state, why] = ['done', parts.length ? `doctor has nothing to fix; ${parts.join('; ')}` : 'doctor says ok'];
    }
    if (state === 'done' && l.mark && marks[l.n] !== 'done') [state, why] = ['open', `doctor says ok; the rest is yours to mark: mirai setup checklist --done ${l.n}`];
    return { ...l, state, why };
  });
}

// The stored file: committed, so it holds the states only, never doctor's details (paths on your
// Mac); `mirai setup checklist` prints those.
export function checklistText(lines) {
  const out = ['# Setup checklist: what you do by hand', '', 'From `mirai setup checklist` (unit 39). Each line\'s state comes from `mirai doctor`, or your mark.', ''];
  for (const l of lines) {
    out.push(`## ${l.n}. ${l.title}: ${l.state}`, '', `- **Command:** ${l.command}`, `- **You should see:** ${l.see}`, `- **Default:** ${l.default}`, `- **State:** ${l.state}`, '');
  }
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}
