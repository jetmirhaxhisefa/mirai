import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileSchema } from '../findings/schema.js';
import { checkQaVerdict } from '../findings/verdicts.js';
import { scanMarkdown } from '../lint/markdown.js';
import { linkHasCredential, hasTokenShape, tokenShapes } from '../config/credentials.js';
import { escapeInvisible } from '../status/text.js';

// The report renderers (unit 09b): the QA report and the run report (in the store), and the MR
// description (on the git host). A template's ## headings are its sections, in order; the
// renderer fills each from checked data, and refuses a template whose sections it doesn't know.
// The report templates are fixed: unit 37's overlays don't change them.
//
// Every value is untrusted text (from an agent, a ticket or a command). It's checked against an
// input schema, then made inert for Markdown and for the git host:
// - markup characters are backslash-escaped, and a line can't start a heading, quote, list or
//   a GitLab quick action (a leading "/");
// - anything a host turns into a link or a reference even when escaped (a URL, an email, an
//   @mention, #12, GH-12, !12, %milestone, ~label, a commit SHA, $math$, an :emoji: code) is
//   shown as a code span, which hosts never link (checked against GitHub's renderer in review).
// The MR description takes no finding objects (Q9, D-29), refuses a follow-up that cites a
// file or a line, and carries command output only as a redacted tail, within the host's size
// limit.

export const TEMPLATE_DIR = fileURLToPath(new URL('../../registry/templates/', import.meta.url));
export const HOSTS = Object.freeze({
  github: { budget: 60_000, ref: (n) => `#${n}` },
  gitlab: { budget: 500_000, ref: (n) => `!${n}` },
});
export const MR_MARKER = '<!-- mirai:mr-description@v1 -->';

export class ReportError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.name = 'ReportError';
    this.problems = problems;
  }
}

// ---- Making text inert --------------------------------------------------------------------

const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
const clean = (text) => escapeInvisible(String(text)).replace(CONTROLS, ' ').trim();

// Markup characters, escaped where they aren't part of a reference word.
const INLINE = /[\\`*_[\]<>|~&$@#!%]/g;
// A word a host would link or render, even when escaped.
const REFERENCE = new RegExp([
  '[A-Za-z][A-Za-z0-9+.-]{0,31}:\\/\\/', 'www\\.', '(?:mailto|xmpp|tel|sms|data|javascript):',
  '@', '#\\S', '\\bGH-\\d', '![0-9]', '%\\S', '~\\S', '&[#\\w]', '\\$', ':[A-Za-z0-9_+-]+:',
  '\\b(?=[0-9a-f]*\\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\\b',
].join('|'), 'i');

// A code span: the fence is longer than any run of backticks inside it. In a table cell,
// pipes are escaped (GFM splits cells on them, even inside code).
export function codeSpan(text, { cell = false } = {}) {
  let s = clean(text);
  if (cell) s = s.replace(/\|/g, '\\|');
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(longest + 1);
  const pad = s.startsWith('`') || s.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${s}${pad}${fence}`;
}

// One line of untrusted text, inert inside a paragraph, a list item or a table cell. `start`
// says whether it may begin a line; `cell` that it's in a table.
export function inline(text, { start = true, cell = false } = {}) {
  const words = clean(text).split(/(\s+)/);
  const out = words.map((w, i) => {
    if (i % 2 === 1 || w === '') return w;
    if (REFERENCE.test(w)) return codeSpan(w, { cell });
    let s = w.replace(INLINE, (c) => `\\${c}`);
    if (start && i === 0) s = s.replace(/^([>+=/-])/, '\\$1').replace(/^(\d+)([.)])/, '$1\\$2');
    return s;
  });
  return out.join('');
}

// Text for the terminal: no Markdown escaping, only control and invisible characters made
// visible, so nothing reaches the terminal raw.
export const plain = (text) => clean(text);

// Command output, made safe to post: terminal escapes stripped; token shapes, NAME=secret
// values and credentials in URLs masked; the repo root and home shown as <repo> and ~. A token
// shape that survives refuses the render (renderMrDescription).
const SECRET_NAME = /(?:pass(?:word|wd)?|secret|token|api[-_]?key|private[-_]?key|access[-_]?key|_key|auth|credential|session|cookie|signature)/i;
export function redact(text, { root, home } = {}) {
  let s = String(text).replace(/\r\n?/g, '\n').replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
  if (root) s = s.split(root).join('<repo>');
  if (home) s = s.split(home).join('~');
  s = s.replace(tokenShapes(), '<redacted>');
  s = s.replace(/\b([A-Za-z_][A-Za-z0-9_.-]{0,63})(\s*[=:]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"']+)/g, (m, name, sep, value) => (SECRET_NAME.test(name) ? `${name}${sep}<redacted>` : m));
  s = s.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1<redacted>@');
  return s;
}

// A fenced block for command output: redacted, its last `lines` lines, invisible and control
// characters shown escaped, and a fence that can't be closed from inside.
export function codeBlock(text, { lines = 20, ...where } = {}) {
  let s = redact(text, where);
  const all = s.split('\n');
  let cut = '';
  if (all.length > lines) {
    s = all.slice(-lines).join('\n');
    cut = `… (the first ${all.length - lines} lines are in the store)\n`;
  }
  s = escapeInvisible(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const longest = Math.max(0, ...(s.match(/`{3,}|~{3,}/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${cut}${fence}text\n${s}\n${fence}`;
}

const cellText = (text) => inline(text, { start: false, cell: true });
const table = (head, rows, cell = cellText) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
const list = (items) => items.map((x) => `- ${x}`).join('\n');
// A list item's text starts a block of its own, so it gets the line-start escapes too.
const item = (x) => inline(x);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---- Templates ----------------------------------------------------------------------------

const templates = new Map();
function templateOf(name) {
  if (!templates.has(name)) {
    const text = readFileSync(join(TEMPLATE_DIR, `${name}.md`), 'utf8');
    const headings = scanMarkdown(text).headings;
    const title = headings.find((h) => h.level === 1);
    const sections = headings.filter((h) => h.level === 2).map((h) => h.text);
    if (!title?.text.includes('{title}')) throw new ReportError(`the ${name} template's # title must hold {title}`);
    if (new Set(sections).size !== sections.length) throw new ReportError(`the ${name} template names a section twice`);
    templates.set(name, { title: title.text, sections });
  }
  return templates.get(name);
}

// Fills a template: `title` (already escaped for the format) replaces {title}; `sections` maps
// each ## heading to its body. `format: "text"` gives the terminal form: the same sections,
// with plain underlined headings.
function fill(name, title, sections, { format = 'markdown', head = [] } = {}) {
  const t = templateOf(name);
  const known = Object.keys(sections);
  const missing = t.sections.filter((s) => !known.includes(s));
  const extra = known.filter((s) => !t.sections.includes(s));
  if (missing.length || extra.length) throw new ReportError(`the ${name} template and its renderer disagree on sections`, [...missing, ...extra]);
  const titleText = t.title.replace('{title}', () => title);
  const out = format === 'text' ? [titleText, '='.repeat(Math.min([...titleText].length, 72))] : [...head, `# ${titleText}`];
  for (const s of t.sections) out.push('', format === 'text' ? `${s}\n${'-'.repeat([...s].length)}` : `## ${s}`, '', sections[s].trim());
  return `${out.join('\n')}\n`;
}

// ---- Input schemas ------------------------------------------------------------------------

const EX = '\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u2069\\ufeff';
const TEXT = `^[^${EX}]*[^\\s${EX}][^${EX}]*$`;
const text = (n) => ({ type: 'string', minLength: 1, maxLength: n, pattern: TEXT });
const id = { type: 'string', maxLength: 64, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' };
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties });
const arr = (items, max, min) => ({ type: 'array', maxItems: max, items, ...(min !== undefined ? { minItems: min } : {}) });
const count = (max) => ({ type: 'integer', minimum: 0, maximum: max });
const AC = { type: 'string', maxLength: 80, pattern: '^AC-[A-Za-z0-9][A-Za-z0-9._-]{0,63}?\\.[0-9]+$' };
// A link: an https URL with none of the excluded, markup, quote or backslash characters.
const url = { type: 'string', maxLength: 512, pattern: `^https://[^\\s${EX}<>()\\[\\]"'\`\\\\]+$` };
const repoPath = { type: 'string', maxLength: 512, pattern: '^(?!/)(?!(?:.*/)?\\.{1,2}(?:/|$))[A-Za-z0-9._/-]+$' };
const isoTime = { type: 'string', maxLength: 25, pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2})?(?:Z|[+-]\\d{2}:\\d{2})$' };

const MR_INPUT = compileSchema(obj({
  ticket: obj({ id, title: text(200) }),
  why: text(1000),
  what_changed: arr(text(300), 30, 1),
  review: obj({ rounds: { type: 'integer', minimum: 1, maximum: 20 } }),
  followups: arr(text(200), 10),
  qa: obj({
    acs: arr(obj({ ac: AC, result: { const: 'pass' }, tests: arr(text(256), 20) }), 200, 1),
    commands: arr(obj({ command: text(512), output: { type: 'string', maxLength: 1_000_000 } }), 10),
  }),
  risk: obj({ level: { enum: ['normal', 'high'] }, reason: text(300) }, ['level']),
  links: arr(obj({ label: text(80), url }), 20),
  files: arr(obj({ label: text(80), path: repoPath }), 20),
  stack: obj({ number: { type: 'integer', minimum: 1, maximum: 1e9 } }),
}, ['ticket', 'why', 'what_changed', 'review', 'followups', 'risk', 'links']));

const RUN_INPUT = compileSchema(obj({
  run: obj({ id: { type: 'string', maxLength: 32, pattern: '^r-\\d{8}-\\d{6}-[0-9a-f]{4}$' }, date: { type: 'string', maxLength: 10, pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, preset: { enum: ['supervised', 'autonomous'] }, state: { enum: ['finished', 'stopped', 'paused'] } }),
  done: arr(obj({ ticket: id, title: text(200), mr: url, stacked_on: id }, ['ticket', 'title', 'mr']), 200),
  parked: arr(obj({ ticket: id, reason: text(64), note: text(500) }), 200),
  paused: arr(obj({ reason: text(64), resets_at: isoTime }), 10),
  followups: arr(obj({ ticket: id, text: text(200) }), 500),
  usage: arr(obj({ ticket: id, turns: count(1e6), tokens: count(1e12), minutes: { type: 'number', minimum: 0, maximum: 1e6 }, cost_usd: { type: 'number', minimum: 0, maximum: 1e6 } }, ['ticket', 'turns', 'tokens', 'minutes']), 200),
  inbox: arr(obj({ kind: text(40), item: id, text: text(200) }), 200),
  template_gaps: arr(obj({ template: text(80), section: text(120), message: text(300) }), 100),
  known_failures: arr(text(256), 200),
  branch_warnings: arr(obj({ branch: text(200), files: arr(text(256), 50, 1) }), 100),
  clean_due: { type: 'boolean' },
}, ['run', 'done', 'parked', 'paused', 'followups', 'usage', 'inbox', 'template_gaps', 'known_failures', 'branch_warnings', 'clean_due']));

// Checks the data against its input schema, and refuses any text with a token shape before it
// is escaped (escaping can split a token's shape, so the rendered body alone isn't enough).
// `except`: keys whose text is redacted instead (command output and commands).
function checked(validate, data, what, { except = [] } = {}) {
  const problems = validate(data);
  if (problems.length) throw new ReportError(`the ${what} data is not valid`, problems);
  const walk = (v, path) => {
    if (typeof v === 'string') {
      if (hasTokenShape(v)) throw new ReportError(`the ${what} data holds a token`, [{ path, code: 'credential' }]);
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) if (!except.includes(k)) walk(x, `${path}/${k}`);
    }
  };
  walk(data, '');
}

// ---- The MR description -------------------------------------------------------------------

// A follow-up says what's worth knowing, never where: a file path or a "file:line" is review
// detail, which stays local (D-29).
const CITES_CODE = /\S+\.[A-Za-z0-9]{1,8}:\d+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]*\.[A-Za-z0-9]{1,8}\b/;

// `data`: { ticket: { id, title }, why, what_changed[], review: { rounds }, followups[],
// qa?: { acs: [{ ac, result: "pass", tests[] }], commands: [{ command, output }] }, risk: {
// level, reason? }, links: [{ label, url }], files?: [{ label, path }], stack?: { number } }.
// `options`: { host: "github" | "gitlab", root, home } (root and home for redaction).
// Unknown keys are refused, so a findings list can't be passed in.
export function renderMrDescription(data, { host = 'github', root, home } = {}) {
  checked(MR_INPUT, data, 'MR description', { except: ['command', 'output'] });
  const h = HOSTS[host];
  if (!h) throw new ReportError(`unknown host "${host}"`);
  if (data.risk.level === 'high' && !data.risk.reason) throw new ReportError('a high risk needs its reason', [{ path: '/risk/reason', code: 'required' }]);
  data.followups.forEach((f, i) => {
    if (CITES_CODE.test(f)) throw new ReportError('a follow-up cites a file or a line: review detail stays local', [{ path: `/followups/${i}`, code: 'cites-code' }]);
  });
  for (const [i, l] of data.links.entries()) {
    if (linkHasCredential(l.url)) throw new ReportError('a link looks like it contains a credential', [{ path: `/links/${i}/url`, code: 'credential' }]);
  }
  // Tries the full form first, then shorter ones, until the body fits the host's limit.
  for (const keep of [{ output: true, tests: true }, { output: false, tests: true }, { output: false, tests: false }]) {
    const body = mrBody(data, h, keep, { root, home });
    if (hasTokenShape(body)) throw new ReportError('the MR description would carry a token; redaction missed it', [{ path: '/', code: 'credential' }]);
    if (body.length <= h.budget) return body;
  }
  throw new ReportError(`the MR description is longer than ${h.budget} characters, even without command output and test names`);
}

function mrBody(data, h, keep, where) {
  const t = (x) => inline(x, { start: false });
  const review = [`Review: PASS after ${plural(data.review.rounds, 'round')} (MIRAI)`];
  if (data.followups.length) review.push('', 'Follow-ups worth knowing:', '', list(data.followups.map(item)));
  let qa = 'QA hasn\'t run for this ticket.';
  if (data.qa) {
    qa = table(['AC', 'Result', 'Tests'], data.qa.acs.map((a) => [a.ac, a.result, keep.tests ? (a.tests.join(', ') || '—') : 'in the store']));
    for (const c of data.qa.commands) qa += `\n\n${codeSpan(redact(c.command, where))}\n\n${keep.output ? codeBlock(c.output, where) : 'Output: in the store.'}`;
  }
  const links = data.links.map((l) => `[${t(l.label)}](${l.url})`);
  for (const f of data.files ?? []) links.push(`${t(f.label)}: ${codeSpan(f.path)}`);
  if (data.stack) links.push(`Stacked on ${h.ref(data.stack.number)}: do not merge until it's retargeted.`);
  return fill('mr-description', `${t(data.ticket.id)}: ${t(data.ticket.title)}`, {
    Why: inline(data.why),
    'What changed': list(data.what_changed.map(item)),
    Review: review.join('\n'),
    QA: qa,
    Risk: data.risk.level === 'high' ? `High: ${t(data.risk.reason)}` : 'Normal.',
    Links: links.length ? list(links) : 'None.',
  }, { head: [MR_MARKER] });
}

// ---- The QA report ------------------------------------------------------------------------

// `verdict`: a QA verdict, as text or as parseJsonStrict returned it; `ticket`, `round`.
export function renderQaReport({ ticket, round, verdict }) {
  const r = checkQaVerdict(verdict);
  if (!r.ok) throw new ReportError('the QA verdict is not valid', r.problems);
  const v = r.value;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(ticket ?? '') || !Number.isInteger(round) || round < 1) throw new ReportError('a QA report needs its ticket and round');
  const t = (x) => inline(x, { start: false });
  const evidence = (items) => items.map((e) => `${e.kind}: ${e.ref}`).join('; ') || '—';
  const issues = v.issues.map((x) => [
    `### ${t(x.id)}: ${t(x.title)}`, '',
    table(['Category', 'Severity', 'AC'], [[x.category, x.severity, x.ac ?? '—']]), '',
    inline(x.description), '',
    ...x.steps.map((step, k) => `${k + 1}. ${item(step)}`), '',
    `Evidence: ${t(evidence(x.evidence))}`,
  ].join('\n'));
  return fill('qa-report', `QA report: ${ticket}, round ${round}`, {
    Verdict: v.verdict === 'blocked' ? `Blocked: ${t(v.blocked_reason)}` : v.verdict === 'pass' ? 'Pass.' : 'Fail.',
    'Acceptance criteria': table(['AC', 'Result', 'Evidence'], v.acs.map((a) => [a.ac, a.result, evidence(a.evidence)])),
    Issues: issues.length ? issues.join('\n\n') : 'None.',
  });
}

// ---- The run report -----------------------------------------------------------------------

const none = (items, render) => (items.length ? render(items) : 'None.');
const number = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1));

// `options.format`: "markdown" (the stored file, every value escaped) or "text" (the terminal:
// no escapes, only control and invisible characters made visible).
export function renderRunReport(data, { format = 'markdown' } = {}) {
  checked(RUN_INPUT, data, 'run report');
  if (format !== 'markdown' && format !== 'text') throw new ReportError(`unknown format "${format}"`);
  for (const [i, d] of data.done.entries()) {
    if (linkHasCredential(d.mr)) throw new ReportError('an MR link looks like it contains a credential', [{ path: `/done/${i}/mr`, code: 'credential' }]);
  }
  const md = format === 'markdown';
  // Every bullet below begins with the ticket or a fixed word, so values never start a line.
  const t = md ? (x) => inline(x, { start: false }) : plain;
  const bullets = (items) => items.map((x) => `- ${x}`).join('\n');
  const totals = data.usage.reduce((s, u) => ({ turns: s.turns + u.turns, tokens: s.tokens + u.tokens, minutes: s.minutes + u.minutes, cost: s.cost + (u.cost_usd ?? 0) }), { turns: 0, tokens: 0, minutes: 0, cost: 0 });
  const costKnown = data.usage.every((u) => u.cost_usd !== undefined);
  const cost = (c) => (c === undefined ? 'unknown' : `$${c.toFixed(2)} (estimate)`);
  const usage = (u) => {
    const rows = [...u.map((x) => [x.ticket, number(x.turns), number(x.tokens), number(x.minutes), cost(x.cost_usd)]),
      ['Total', number(totals.turns), number(totals.tokens), number(totals.minutes), costKnown ? cost(totals.cost) : 'unknown']];
    if (md) return table(['Ticket', 'Turns', 'Tokens', 'Minutes', 'Cost'], rows);
    return rows.map((r) => `${plain(r[0]).padEnd(12)} ${r[1].padStart(8)} turns ${r[2].padStart(14)} tokens ${r[3].padStart(8)} min  ${r[4]}`).join('\n');
  };
  return fill('run-report', `Run ${data.run.id}, ${data.run.date}`, {
    Summary: `${plural(data.done.length, 'ticket')} done, ${data.parked.length} parked; the run ${data.run.state} (${data.run.preset}).`,
    'Branch warnings': none(data.branch_warnings, (w) => bullets(w.map((x) => `${t(x.branch)} touches files that run by themselves: ${x.files.map(t).join(', ')}. Read them on the host before you open the branch in your IDE.`))),
    // The MR link is checked by its pattern (https, no markup, quote or control characters) and
    // for credentials, so it's shown as it is, to stay clickable in a terminal.
    Done: none(data.done, (d) => bullets(d.map((x) => `${t(x.ticket)}: ${t(x.title)}, ${x.mr}${x.stacked_on ? ` (stacked on ${t(x.stacked_on)})` : ''}`))),
    Parked: none([...data.parked, ...data.paused], () => bullets([
      ...data.parked.map((p) => `${t(p.ticket)}: ${t(p.reason)}. ${t(p.note)}`),
      ...data.paused.map((p) => `Paused: ${t(p.reason)}, resets ${p.resets_at}`),
    ])),
    'Follow-ups': none(data.followups, (f) => bullets(f.map((x) => `${t(x.ticket)}: ${t(x.text)}`))),
    Usage: none(data.usage, usage),
    'Waiting for you': none(data.inbox, (i) => bullets(i.map((x) => `${t(x.kind)}: ${t(x.item)}, ${t(x.text)}`))),
    'Template gaps': none(data.template_gaps, (g) => bullets(g.map((x) => `${t(x.template)}, ${t(x.section)}: ${t(x.message)}`))),
    'Known test failures': none(data.known_failures, (k) => bullets(k.map(t))),
    Housekeeping: data.clean_due ? `Old files are due for ${md ? '`mirai clean`' : 'mirai clean'}.` : 'Nothing due.',
  }, { format });
}
