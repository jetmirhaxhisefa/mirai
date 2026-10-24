import { createHash } from 'node:crypto';

// The findings logic (unit 09a, R-M7; loop rules L1, L2 and L4 in design/01 §9).
// - A fingerprint says "the same finding" across rounds: file + symbol + basis, never the line,
//   which moves with every edit.
// - A failure signature says "the same test failure", with what changes between runs (times,
//   ids, paths, line numbers) taken out, and the values that tell results apart kept.
// - Triage decides which findings block: a blocking finding is downgraded when it can't be
//   checked (no file and line, no symbol, a basis that doesn't resolve), when it's outside
//   the ticket's diff (pre-existing), when a later round raises it new outside the delta
//   (frozen, L2), or when the per-finding check doesn't confirm it (high risk).
// The orchestrator decides from triage's `blocking`, never from the verdict's own word; the
// loop guard (unit 20) compares fingerprints and signatures across rounds.

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// Paths are compared as canonical POSIX paths, Unicode NFC. The review schema already refuses
// "." and ".." parts and empty ones; this also covers paths given by other callers.
export function canonicalPath(file) {
  return String(file ?? '').normalize('NFC').replace(/\\/g, '/').split('/').filter((p) => p !== '' && p !== '.').join('/');
}
const canonicalSymbol = (symbol) => String(symbol ?? '').normalize('NFC').trim().replace(/\s*\(\s*\)$/, '');

// A repro's command text is not part of the fingerprint (rewording it would dodge L4): a repro
// basis counts as one kind.
export function findingFingerprint(finding) {
  const basis = !finding.basis ? '' : finding.basis.kind === 'repro' ? 'repro' : `${finding.basis.kind}:${finding.basis.ref}`;
  return sha256(`${canonicalPath(finding.file)}\0${canonicalSymbol(finding.symbol)}\0${basis}`);
}

// The basis as the run log stores it (05b's `basis_ref`): "kind:ref", or for a reference that
// doesn't fit the log's shape (a repro command), "kind:" and a short hash of it.
const LOG_REF = /^[A-Za-z0-9][A-Za-z0-9._/#:@-]{0,255}$/;
export function basisForLog(basis) {
  const plain = `${basis.kind}:${basis.ref}`;
  return LOG_REF.test(plain) ? plain : `${basis.kind}:sha256-${sha256(basis.ref).slice(0, 16)}`;
}

// What changes between two runs of the same failure, taken out in this order. Plain numbers
// stay: "expected 4, got 0" and "expected 0, got 4" are different failures.
const NORMALIZE = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>'],
  [/\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b/g, '<time>'],
  [/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds|m|min|minutes)\b/g, '<duration>'],
  [/\b0x[0-9a-f]+\b/gi, '<hex>'],
  [/\b(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{7,}\b|\b[0-9a-f]{12,}\b/gi, '<hex>'],
  [/(?<![\w<>])(?:[A-Za-z]:)?(?:\/[^\s/:'"()[\]]+){2,}/g, '<path>'],
  [/:\d+(?::\d+)?\b/g, ':<line>'],
  [/\s+/g, ' '],
];

// `root`, when given, is replaced first (at a path boundary), so paths inside the repo keep
// their repo part and only paths outside it become <path>.
export function failureSignature({ test, message }, { root } = {}) {
  let text = String(message ?? '');
  if (root) {
    const base = root.replace(/\/+$/, '');
    text = text.replace(new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=/|$|[\\s:'"])`, 'g'), '<root>');
  }
  for (const [re, to] of NORMALIZE) text = text.replace(re, to);
  return sha256(`${String(test ?? '').trim()}\0${text.trim()}`);
}

// Whether a basis resolves for this ticket. `ctx`: { acs, adrs, rules }, each a list of IDs:
// the plan's acs; the ticket's governed_by and any ADRs known; the project's convention rule
// IDs (none until the context units, so a rule can't block yet). A repro can't block until
// repros are run (a later, sandboxed unit). Returns { ok, reason, code }.
export function resolveBasis(basis, ctx = {}) {
  if (!basis || typeof basis.ref !== 'string') return { ok: false, code: 'no-basis', reason: 'no basis' };
  const has = (list) => (list ?? []).includes(basis.ref);
  switch (basis.kind) {
    case 'ac': return has(ctx.acs) ? { ok: true } : { ok: false, code: 'unresolved-basis', reason: 'the AC is not one of the plan\'s ACs' };
    case 'adr': return has(ctx.adrs) ? { ok: true } : { ok: false, code: 'unresolved-basis', reason: 'the ADR is not one the ticket is governed by' };
    case 'rule': return has(ctx.rules) ? { ok: true } : { ok: false, code: 'unresolved-basis', reason: 'the rule is not one of the project\'s convention rules' };
    case 'repro': return { ok: false, code: 'repro-not-run', reason: 'a repro can\'t block until MIRAI runs repros' };
    default: return { ok: false, code: 'unresolved-basis', reason: 'unknown basis kind' };
  }
}

// Line sets keyed by canonical path: from a Map or a plain object, with Sets or arrays.
function lineIndex(lines) {
  if (!lines) return null;
  const entries = lines instanceof Map ? [...lines] : Object.entries(lines);
  return new Map(entries.map(([file, set]) => [canonicalPath(file), new Set(set)]));
}

// Triage a checked review verdict (L1, L2). `ctx`:
// - resolveBasis's lists: acs, adrs, rules;
// - `changedLines`: the ticket's whole diff since its baseline, in new-file line numbers plus
//   the line next to each deletion (unit 24 builds it); a finding outside it is pre-existing;
// - from round 2: `round`, `priorBlocking` (the earlier round's blocking ids) and `delta` (the
//   lines changed since that round); a finding that doesn't carry one over (`prior`) is new,
//   and a new one stands only if it's blocking and inside the delta (frozen otherwise);
// - on high-risk tickets: `confirmations`, from the finding check (id -> high | medium | low |
//   false | maybe-false); a blocking finding not confirmed (or not checked) is downgraded.
// Returns the findings with `fingerprint`, final `severity`, `downgraded` and
// `downgrade_reason`; the ids that block; the follow-ups (everything else); and the groups of
// ids that share a fingerprint in this verdict.
export function triage(verdict, ctx = {}) {
  const changed = lineIndex(ctx.changedLines);
  const delta = lineIndex(ctx.delta);
  const later = Number.isInteger(ctx.round) && ctx.round >= 2;
  const prior = new Set(ctx.priorBlocking ?? []);
  const confirmations = ctx.confirmations ? new Map(ctx.confirmations instanceof Map ? ctx.confirmations : Object.entries(ctx.confirmations)) : null;
  const findings = verdict.findings.map((f) => {
    const out = { ...f, fingerprint: findingFingerprint(f), downgraded: false };
    const file = canonicalPath(f.file);
    const carried = later && typeof f.prior === 'string' && prior.has(f.prior);
    let reason = null;
    if (later && !carried && !(f.severity === 'blocking' && delta?.get(file)?.has(f.line))) {
      reason = 'frozen';
    } else if (f.severity === 'blocking') {
      if (typeof f.file !== 'string' || !Number.isInteger(f.line)) reason = 'no-citation';
      else if (typeof f.symbol !== 'string' || f.symbol.trim() === '') reason = 'no-symbol';
      else {
        const basis = resolveBasis(f.basis, ctx);
        if (!basis.ok) reason = basis.code;
        else if (changed && !changed.get(file)?.has(f.line)) reason = 'pre-existing';
        else if (confirmations && !['high', 'medium', 'low'].includes(confirmations.get(f.id))) reason = 'unconfirmed';
      }
    }
    if (reason) Object.assign(out, { severity: f.severity === 'blocking' ? 'should-fix' : f.severity, downgraded: f.severity === 'blocking', downgrade_reason: reason });
    return out;
  });
  const byPrint = new Map();
  for (const f of findings) byPrint.set(f.fingerprint, [...(byPrint.get(f.fingerprint) ?? []), f.id]);
  return {
    findings,
    blocking: findings.filter((f) => f.severity === 'blocking').map((f) => f.id),
    followups: findings.filter((f) => f.severity !== 'blocking').map((f) => f.id),
    duplicates: [...byPrint.values()].filter((ids) => ids.length > 1),
  };
}
