// A test run against the baseline's known failures (unit 21b; the rule in docs/test-baseline.md,
// for units 25, 26 and 54 too): "nothing new broke", never "everything is green".
// `result`: a test run's result (14c, 16a); `known`: knownFailures() for its level, or null.
// Returns { verdict: 'pass' | 'fail' | 'unknown', fresh: [ids or names], why }.
// - a run that passed is a pass, whatever the baseline;
// - an environment fault, a refusal or a timeout tells nothing: unknown;
// - no baseline for the level (null): unknown, never green;
// - a failing test ID is known only if the same ID is a known failure of the level; any other is
//   new, and one with no project path is known only as the level-wide `unmapped` kind;
// - a run that failed as a whole (it didn't load, ran nothing, or failed with no failing test) is
//   level-wide: known only as the same `kind`;
// - a level without test IDs (a named check, no adapter) that fails can't be compared when the
//   baseline knows it failing too (`no-ids`): unknown; when the baseline knew it passing: new.
export function againstBaseline(result, known) {
  if (result.outcome === 'pass') return { verdict: 'pass', fresh: [], why: null };
  if (result.outcome !== 'fail') return { verdict: 'unknown', fresh: [], why: `the run was ${result.outcome}${result.code ? ` (${result.code})` : ''}` };
  if (known === null) return { verdict: 'unknown', fresh: [], why: 'there\'s no baseline for it on this commit' };
  const levelWide = (kind) => known.some((k) => k.scope === 'level' && k.kind === kind);
  if (!Array.isArray(result.failing)) {
    if (levelWide('no-ids')) return { verdict: 'unknown', fresh: [], why: 'it failed at baseline too, with no test IDs to compare' };
    return { verdict: 'fail', fresh: ['(the whole run)'], why: 'it passed at baseline' };
  }
  if ((result.failing_total ?? result.failing.length) > result.failing.length) return { verdict: 'unknown', fresh: [], why: `more failing tests (${result.failing_total}) than MIRAI keeps` };
  // The whole level not loading, running nothing, or exiting non-zero with nothing failing is
  // reported as one entry with no test ID (results.js), as the baseline records it (record.js).
  // A failing case whose file isn't a project path has no ID either, only a name: `unmapped`.
  const whole = result.failing.filter((f) => (f.id === null || f.id === undefined) && ['load', 'not-found', 'error'].includes(f.kind) && f.name === undefined);
  const each = result.failing.filter((f) => !whole.includes(f));
  if (each.length === 0) {
    const kind = whole[0]?.kind ?? 'error';
    return levelWide(kind) ? { verdict: 'pass', fresh: [], why: `a known ${kind} failure` } : { verdict: 'fail', fresh: [`(the whole run: ${kind})`], why: `a ${kind} failure the baseline doesn't have` };
  }
  const ids = new Set(known.filter((k) => k.scope === 'test').map((k) => k.id));
  const unmappedKnown = levelWide('unmapped');
  const fresh = [
    ...whole.filter((f) => !levelWide(f.kind)).map((f) => `(the whole run: ${f.kind})`),
    ...each.filter((f) => (f.id === null || f.id === undefined ? !unmappedKnown : !ids.has(f.id))).map((f) => f.id ?? f.name ?? '(unnamed)'),
  ];
  return fresh.length ? { verdict: 'fail', fresh, why: `${fresh.length} new failing test(s)` } : { verdict: 'pass', fresh: [], why: 'only known failures' };
}
