import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileSchema, parseJsonStrict, isStrictValue } from './schema.js';

// Checking structured output (unit 09a). An agent's final JSON is untrusted (R2-C1): it's parsed
// strictly, validated against its schema in registry/schemas/, then checked for the rules a
// schema can't say (a pass can't carry a blocking finding; ids are unique; a QA pass has
// evidence for every AC). Each check returns { ok: true, value } or { ok: false, problems }.
// The input is the captured text, or a value parseJsonStrict returned; an object from
// JSON.parse is refused, so the strict parse can't be skipped.
// The orchestrator decides from triage (findings.js), never from a verdict's own word.

export const SCHEMA_DIR = fileURLToPath(new URL('../../registry/schemas/', import.meta.url));
export const SCHEMAS = Object.freeze(['review-verdict', 'finding-replies', 'finding-check', 'qa-verdict', 'gate-result']);

const STORE_REF = /^(?!\/)(?!(?:.*\/)?\.{1,2}(?:\/|$))[A-Za-z0-9._/-]{1,256}$/;

const compiled = new Map();
export function schemaOf(name) {
  if (!SCHEMAS.includes(name)) throw new TypeError(`unknown schema "${name}"`);
  if (!compiled.has(name)) {
    const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, `${name}.json`), 'utf8'));
    compiled.set(name, compileSchema(schema));
  }
  return compiled.get(name);
}

// Parses (when given text) and validates against a schema; then runs `rules` on a valid value.
function check(name, input, rules) {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = parseJsonStrict(input);
    } catch (err) {
      return { ok: false, problems: [{ path: '/', code: 'json', reason: err.message }] };
    }
  } else if (!isStrictValue(input)) {
    return { ok: false, problems: [{ path: '/', code: 'json', reason: 'pass the captured text, or what parseJsonStrict returned' }] };
  }
  const problems = schemaOf(name)(value);
  if (problems.length === 0 && rules) rules(value, (path, code, reason) => problems.push({ path, code, reason }));
  return problems.length ? { ok: false, problems } : { ok: true, value };
}

function unique(items, key, path, add) {
  const seen = new Set();
  items.forEach((item, i) => {
    if (seen.has(item[key])) add(`${path}/${i}/${key}`, 'duplicate', `${path}/${i}/${key} repeats an earlier one`);
    seen.add(item[key]);
  });
}

export function checkReviewVerdict(input) {
  return check('review-verdict', input, (v, add) => {
    unique(v.findings, 'id', '/findings', add);
    v.findings.forEach((f, i) => {
      if (v.verdict === 'pass' && f.severity === 'blocking') add(`/findings/${i}/severity`, 'pass-with-blocking', 'a pass can\'t carry a blocking finding');
      if (f.prior === f.id) add(`/findings/${i}/prior`, 'invalid', 'a finding can\'t carry itself over');
    });
  });
}

// `findingIds`: the blocking findings the replies answer, when known.
export function checkReplies(input, { findingIds } = {}) {
  return check('finding-replies', input, (v, add) => {
    unique(v.replies, 'id', '/replies', add);
    v.replies.forEach((r, i) => {
      if (r.outcome === 'disputed' && r.reason === undefined) add(`/replies/${i}/reason`, 'required', 'a dispute needs its one-sentence reason');
      if (r.outcome === 'fixed' && r.reason !== undefined) add(`/replies/${i}/reason`, 'invalid', 'a reason is only for a dispute');
      if (findingIds && !findingIds.includes(r.id)) add(`/replies/${i}/id`, 'unknown-finding', 'the reply is for a finding that wasn\'t raised');
    });
    for (const id of findingIds ?? []) {
      if (!v.replies.some((r) => r.id === id)) add('/replies', 'missing-reply', 'a blocking finding has no reply');
    }
  });
}

// `findingIds`: the blocking findings that were sent for checking, when known.
export function checkFindingCheck(input, { findingIds } = {}) {
  return check('finding-check', input, (v, add) => {
    unique(v.checks, 'id', '/checks', add);
    v.checks.forEach((c, i) => {
      if (findingIds && !findingIds.includes(c.id)) add(`/checks/${i}/id`, 'unknown-finding', 'the check is for a finding that wasn\'t sent');
    });
    for (const id of findingIds ?? []) {
      if (!v.checks.some((c) => c.id === id)) add('/checks', 'missing-check', 'a finding sent for checking has no verdict');
    }
  });
}

// `acs`: the plan's ACs, when known; every one must be reported. `evidenceRefs`: the
// references run_tests returned to this launch, when known; evidence must be one of them.
export function checkQaVerdict(input, { acs, evidenceRefs } = {}) {
  return check('qa-verdict', input, (v, add) => {
    unique(v.acs, 'ac', '/acs', add);
    unique(v.issues, 'id', '/issues', add);
    const evidence = (list, path) => list.forEach((e, k) => {
      if (e.kind !== 'test' && !STORE_REF.test(e.ref)) add(`${path}/${k}/ref`, 'pattern', 'a screenshot or output is a store reference');
      if (evidenceRefs && !evidenceRefs.includes(e.ref)) add(`${path}/${k}/ref`, 'unknown-evidence', 'not evidence run_tests returned to this launch');
    });
    v.acs.forEach((a, i) => {
      evidence(a.evidence, `/acs/${i}/evidence`);
      if (a.result === 'pass' && a.evidence.length === 0) add(`/acs/${i}/evidence`, 'no-evidence', 'a passed AC needs evidence');
      if (v.verdict === 'pass' && a.result !== 'pass') add(`/acs/${i}/result`, 'pass-with-failure', 'a QA pass needs every AC to pass');
      if (acs && !acs.includes(a.ac)) add(`/acs/${i}/ac`, 'unknown-ac', 'not one of the plan\'s ACs');
    });
    v.issues.forEach((x, i) => {
      evidence(x.evidence, `/issues/${i}/evidence`);
      if (x.ac !== undefined && !v.acs.some((a) => a.ac === x.ac)) add(`/issues/${i}/ac`, 'unknown-ac', 'the issue names an AC the verdict doesn\'t report');
    });
    for (const ac of acs ?? []) {
      if (!v.acs.some((a) => a.ac === ac)) add('/acs', 'missing-ac', 'one of the plan\'s ACs is not reported');
    }
    const serious = v.issues.some((x) => x.severity === 'critical' || x.severity === 'high');
    if (v.verdict === 'pass' && serious) add('/issues', 'pass-with-blocking', 'a QA pass can\'t carry a critical or high issue');
    if (v.verdict === 'fail' && !v.acs.some((a) => a.result === 'fail') && v.issues.length === 0) add('/verdict', 'fail-without-cause', 'a fail needs a failed AC or an issue');
    if (v.verdict === 'blocked' && v.blocked_reason === undefined) add('/blocked_reason', 'required', 'say why testing couldn\'t happen');
    if (v.verdict !== 'blocked' && v.blocked_reason !== undefined) add('/blocked_reason', 'invalid', 'a reason is only for blocked');
  });
}

export function checkGateResult(input) {
  return check('gate-result', input, (v, add) => {
    unique(v.checks, 'name', '/checks', add);
    const known = new Set(v.known_failures);
    v.failures.forEach((f, i) => {
      const c = v.checks.find((x) => x.name === f.check);
      if (!c) add(`/failures/${i}/check`, 'unknown-check', 'the failure names a check that didn\'t run');
      if (f.known !== known.has(f.signature)) add(`/failures/${i}/known`, 'invalid', 'known must say whether the signature is in known_failures');
      if (c && c.result === 'pass' && !f.known) add(`/failures/${i}`, 'pass-with-failure', 'a passed check can\'t have a new failure');
    });
    v.checks.forEach((c, i) => {
      if (c.result === 'fail' && !v.failures.some((f) => f.check === c.name)) add(`/checks/${i}/result`, 'fail-without-cause', 'a failed check lists its failures');
    });
  });
}
