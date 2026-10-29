import { parseXml, XmlError } from './xml.js';

// JUnit XML, as test runners write it (unit 16a; D-48 item 5): nested <testsuites> and
// <testsuite>, and <testcase> with <failure>, <error> or <skipped> (system-out and system-err
// are ignored). Each case becomes { file, name, outcome, type, text, message }, the file and
// name as the report has them (the adapter's `id` says which attributes hold them); src/tests/
// results.js maps them to test IDs and kinds.

export const JUNIT_LIMITS = Object.freeze({ cases: 100_000 });

const OUTCOME_OF = Object.freeze({ error: 'error', failure: 'fail', skipped: 'skip' });
const ORDER = Object.freeze(['error', 'fail', 'skip']);

// The cases of a parsed report. Throws XmlError when it isn't JUnit.
export function junitCases(root, { file: fileAttr = 'file', limits = JUNIT_LIMITS } = {}) {
  if (root.name !== 'testsuites' && root.name !== 'testsuite') throw new XmlError(`the root element is <${root.name.slice(0, 40)}>, not <testsuites> or <testsuite>`);
  const cases = [];
  const walk = (el, inherited) => {
    for (const c of el.children) {
      if (c.name === 'testsuite' || c.name === 'testsuites') walk(c, c.attrs.file ?? inherited);
      else if (c.name === 'testcase') {
        if (cases.length >= limits.cases) throw new XmlError(`more than ${limits.cases} test cases`);
        // A test with an empty title is still a test; one without a name attribute isn't JUnit.
        if (typeof c.attrs.name !== 'string') throw new XmlError('a <testcase> without a name');
        // The worst of what the case holds: an error, a failure, then a skip.
        let worst = null;
        for (const r of c.children) {
          const o = OUTCOME_OF[r.name];
          if (o && (worst === null || ORDER.indexOf(o) < ORDER.indexOf(worst.outcome))) worst = { outcome: o, el: r };
        }
        const file = fileAttr === 'classname' ? c.attrs.classname : c.attrs.file ?? inherited;
        const result = worst?.el;
        cases.push({
          file: typeof file === 'string' && file !== '' ? file : null,
          name: c.attrs.name === '' ? '(unnamed)' : c.attrs.name,
          outcome: worst?.outcome ?? 'pass',
          type: result?.attrs.type ?? null,
          message: result?.attrs.message ?? null,
          text: result?.text ?? null,
        });
      }
    }
  };
  walk({ children: [root] }, null);
  return cases;
}

// Reads a report's bytes: { report: 'ok', cases } or { report: 'malformed', reason }.
export function readJunit(bytes, options) {
  try {
    return { report: 'ok', cases: junitCases(parseXml(bytes), options) };
  } catch (err) {
    if (err instanceof XmlError) return { report: 'malformed', reason: err.message };
    throw err;
  }
}
