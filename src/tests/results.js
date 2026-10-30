import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';

import { readJunit } from './junit.js';
import { toProjectPath } from './paths.js';
import { XML_LIMITS } from './xml.js';

// What a level with a test adapter returns besides pass or fail (unit 16a): its report read, its
// cases mapped to test IDs (`<project path>::<name>`), and the failing ones classified:
//   assertion  a test's check failed
//   error      a test threw, or its runner reported an error
//   not-found  the file or test asked for ran nothing
//   load       the tests couldn't be loaded or compiled (the adapter's classify)
// A kind is the runner's word for it, never a judgement of the code.

export const REPORT_FILE = 'junit.xml';
// Failing tests kept, with their messages, in result.json (all of them are in cases.json).
export const STORED_FAILING = 1000;
export const MESSAGE_MAX = 300;

// A file the run left in its output folder: { bytes } or { missing } or { malformed }. A link
// (the file, or a folder on the way to it), a folder or anything but a regular file is malformed,
// and is never followed: the container wrote this folder. `what` names it in messages.
export const readReportFile = (outDir) => readOutFile(outDir, REPORT_FILE, XML_LIMITS.bytes, 'the report');
export function readOutFile(outDir, name, maxBytes, what) {
  const parts = name.split('/');
  for (let k = 1; k < parts.length; k++) {
    let info;
    try {
      info = lstatSync(join(outDir, ...parts.slice(0, k)));
    } catch (err) {
      if (err.code === 'ENOENT') return { missing: true };
      throw err;
    }
    if (!info.isDirectory()) return { malformed: `${parts.slice(0, k).join('/')} in the output folder isn't a folder` };
  }
  let fd;
  try {
    fd = openSync(join(outDir, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    if (err.code === 'ENOENT') return { missing: true };
    return { malformed: err.code === 'ELOOP' ? `${what} is a link` : `${what} can't be read (${err.code})` };
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) return { malformed: `${what} isn't a regular file` };
    if (info.size > maxBytes) return { malformed: `${what} is larger than ${maxBytes} bytes` };
    const bytes = Buffer.alloc(info.size);
    let at = 0;
    while (at < bytes.length) {
      const n = readSync(fd, bytes, at, bytes.length - at, at);
      if (n === 0) break;
      at += n;
    }
    return { bytes: bytes.subarray(0, at) };
  } finally {
    closeSync(fd);
  }
}

const under = (p, dir) => p === dir || p.startsWith(`${dir}/`);

// Terminal colour codes whose escape character a runner dropped when it wrote the report.
const COLOUR_LEFTOVER = /\[\d{1,3}(?:;\d{1,3})*m/g;

// The first line worth showing: the result's message attribute, or its text, without lines that
// only repeat the test's own name (classify.message_skip); uncut, before cleaning.
function firstLine(c, skip) {
  for (const source of [c.message, c.text]) {
    if (typeof source !== 'string') continue;
    const line = source.replace(COLOUR_LEFTOVER, '').split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '' && !skip.some((re) => re.test(l)));
    if (line) return line;
  }
  return null;
}

// At most MESSAGE_MAX characters, never splitting a character in two.
const cut = (text) => {
  const chars = Array.from(text);
  return chars.length > MESSAGE_MAX ? `${chars.slice(0, MESSAGE_MAX - 1).join('')}…` : text;
};

// assertion or error: by the result's type and first line when the adapter lists them, else a
// <failure> is an assertion and an <error> an error.
function kindOf(c, line, { types, messages }) {
  if (!types && !messages) return c.outcome === 'fail' ? 'assertion' : 'error';
  if (types && typeof c.type === 'string' && types.some((re) => re.test(c.type))) return 'assertion';
  if (messages && line !== null && messages.some((re) => re.test(line))) return 'assertion';
  return 'error';
}

const regexes = (list) => (list ?? []).map((r) => new RegExp(r, 'u'));

// The test fields of a result, from what the run left:
// - `report`: readReportFile's answer; `exitCode` and `output` (the cleaned tail): the run's;
// - `mounts` and `base`: the service's mounts and the folder relative report paths start from;
// - `asked`: null (the whole level), { path } or { path, name } (project paths);
// - `clean`: the run's redaction.
// Returns { report, report_problem?, tests, failing (all of them), cases (every case in scope:
// { id, outcome, kind? }), load, not_found }. The reply's caps are run_tests' (INLINE_FAILING).
export function testResults({ adapter, report: file, exitCode, output, mounts, base, asked = null, clean = (t) => t }) {
  const classify = adapter.classify ?? {};
  let parsed = null;
  let report;
  let problem = null;
  if (file.missing) report = 'missing';
  else if (file.malformed) [report, problem] = ['malformed', file.malformed];
  else {
    parsed = readJunit(file.bytes, { file: adapter.report.file });
    report = parsed.report;
    problem = parsed.reason ?? null;
  }
  const tests = { total: 0, passed: 0, failed: 0, errors: 0, skipped: 0, outside: 0 };
  const failing = [];
  const cases = [];
  const skip = regexes(classify.message_skip);
  const assertion = { types: classify.assertion_types ? regexes(classify.assertion_types) : null, messages: classify.assertion_messages ? regexes(classify.assertion_messages) : null };
  // The asked test's own cases: its name, or its name and one of the runner's variants (a data
  // set's " with data set …").
  const variant = adapter.report.variant;
  const isAsked = (name) => name === asked.name || (variant !== undefined && name.startsWith(`${asked.name}${variant}`));
  for (const c of parsed?.cases ?? []) {
    const path = toProjectPath(mounts, c.file, base);
    // A case named after its own file is the file failing to load: it's in scope for any test
    // of that file.
    const fileCase = Boolean(classify.file_cases_are_load) && c.file !== null && c.name === c.file;
    const inScope = !asked || (path !== null && (asked.name === undefined ? under(path, asked.path) : path === asked.path && (isAsked(c.name) || fileCase)));
    if (!inScope) {
      tests.outside++;
      continue;
    }
    tests.total++;
    tests[{ pass: 'passed', fail: 'failed', error: 'errors', skip: 'skipped' }[c.outcome]]++;
    const id = path === null ? null : clean(`${path}::${c.name}`);
    if (c.outcome === 'fail' || c.outcome === 'error') {
      const line = firstLine(c, skip);
      const kind = fileCase ? 'load' : kindOf(c, line, assertion);
      failing.push({ id, ...(path === null ? { name: clean(c.name) } : {}), outcome: c.outcome, kind, message: line === null ? null : cut(clean(line)) });
      cases.push({ id, ...(path === null ? { name: clean(c.name) } : {}), outcome: c.outcome, kind });
    } else cases.push({ id, ...(path === null ? { name: clean(c.name) } : {}), outcome: c.outcome });
  }
  const askedId = asked ? clean(asked.name === undefined ? asked.path : `${asked.path}::${asked.name}`) : null;
  // The output and exit code say "didn't load" only when no case it was asked for ran: a load
  // failure leaves an empty report in every runner probed (research/12 J3), and a line a test
  // printed mustn't turn a real failure into one.
  const ran = tests.total - tests.skipped;
  const loadLine = exitCode === 0 || ran > 0 ? null : regexes(classify.load_output).map((re) => output.split('\n').find((l) => re.test(l))).find(Boolean);
  const load = ran === 0 && exitCode !== 0 && exitCode !== null && (Boolean(loadLine) || (classify.load_exit_codes ?? []).includes(exitCode));
  // Nothing ran (none there, or all skipped: a runner whose name filter matched nothing may
  // exit 0), for a file, a test or the whole level: never a pass.
  const notFound = !load && report === 'ok' && ran === 0 && !failing.length;
  const what = asked === null ? 'at all' : asked.name === undefined ? 'in it' : 'by that name in that file';
  if (load) failing.unshift({ id: askedId, outcome: 'error', kind: 'load', message: loadLine ? cut(clean(loadLine.trim())) : `the runner exited with ${exitCode}, which the adapter says means the tests couldn't load` });
  if (notFound) failing.unshift({ id: askedId, outcome: 'error', kind: 'not-found', message: `the runner ran no test ${what}${tests.skipped ? ` (${tests.skipped} skipped)` : ''}` });
  // A run that failed with nothing failing in its report (a runner failing on warnings, say) is
  // still listed, so a failed run never reads as "no new failures".
  if (report === 'ok' && exitCode !== 0 && exitCode !== null && !failing.length) {
    failing.push({ id: askedId, outcome: 'error', kind: 'error', message: `the runner exited with ${exitCode} with no failing test in its report` });
  }
  return { report, ...(problem ? { report_problem: cut(clean(problem)) } : {}), tests, failing, cases, load, not_found: notFound };
}
