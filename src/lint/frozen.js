import { createHash } from 'node:crypto';

import { verifySigned } from '../sign/sign.js';
import { canonical } from '../sign/canonical.js';
import { readFrontmatter } from './frontmatter.js';
import { scanMarkdown } from './markdown.js';
import { tableIn, sameKey } from './checks.js';

// The frozen block and the plan approval (unit 08b, R2-M11, R3-M2, R3-C2).
// - The frozen block is the part of a plan you own once you approve it. It sits between two
//   marker lines, HTML comments that don't show when rendered:
//     <!-- frozen:start -->
//     ## Intent … ## Boundaries … ## Edge cases …
//     <!-- frozen:end -->
//   A marker counts only outside fenced blocks, indented at most three spaces, so a marker
//   quoted in a log or shown as code is just text.
// - Your plan approval signs `approvalHash`: the frozen block, the Declared changes rows, and
//   the frontmatter fields that change what is built or how it's proven (ticket, acs, risk,
//   tdd, tests, round). The agent-owned sections (code map, tasks, logs) may change; those
//   may not without a new approval. Unit 21 signs it at the plan gate and records it.
// - The signing context is "mirai/plan-approval/1:<repo-id>" (docs/signing.md), so a plan
//   approval can't pass for a document approval.

export const FROZEN_START = '<!-- frozen:start -->';
export const FROZEN_END = '<!-- frozen:end -->';
const MARKER = /^ {0,3}<!-- frozen:(start|end) -->[ \t]*$/;
const FENCE = /^ *(`{3,}|~{3,})/;

// Finds the block in a document's text. Returns { start, end, text } with the 1-based lines of
// the two markers and the text between them (CRLF read as LF), or { problem, line } when the
// markers are missing, repeated or out of order.
export function frozenBlock(documentText) {
  const lines = documentText.replace(/\r\n/g, '\n').split('\n');
  const starts = [];
  const ends = [];
  let fence = null;
  lines.forEach((l, i) => {
    const f = FENCE.exec(l);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^ *[`~]+[ \t]*$/.test(l)) fence = null;
      return;
    }
    if (f && !(f[1][0] === '`' && l.slice(l.indexOf(f[1]) + f[1].length).includes('`'))) {
      fence = f[1];
      return;
    }
    const m = MARKER.exec(l);
    if (m) (m[1] === 'start' ? starts : ends).push(i + 1);
  });
  if (starts.length === 0 || ends.length === 0) return { problem: 'missing', line: starts[0] ?? ends[0] ?? 1 };
  if (starts.length > 1 || ends.length > 1) return { problem: 'repeated', line: (starts.length > 1 ? starts : ends)[1] };
  if (ends[0] < starts[0]) return { problem: 'order', line: ends[0] };
  return { start: starts[0], end: ends[0], text: lines.slice(starts[0], ends[0] - 1).join('\n') };
}

const sha256 = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

// "sha256:<hex>" over the frozen block's text, or null when there's no well-formed block.
export function frozenBlockHash(documentText) {
  const block = frozenBlock(documentText);
  return block.problem ? null : sha256(block.text);
}

// The fields of a plan's frontmatter that the approval covers.
export const APPROVED_FIELDS = Object.freeze(['ticket', 'acs', 'risk', 'tdd', 'tests', 'round']);

// What your plan approval signs, or null when the plan can't be read or has no frozen block:
// the hash of canonical JSON over the frozen block, the Declared changes rows (kind, item, why)
// and the approved frontmatter fields.
export function approvalHash(documentText) {
  const block = frozenBlock(documentText);
  if (block.problem) return null;
  let fm;
  try {
    fm = readFrontmatter(documentText);
  } catch {
    return null;
  }
  if (!fm) return null;
  const scan = scanMarkdown(fm.body, { firstLine: fm.bodyLine });
  const declared = tableIn({ scan }, 'Declared changes');
  const rows = (declared?.rows ?? []).map((r) => [r.cells.kind ?? '', r.cells.item ?? '', r.cells.why ?? '']);
  const fields = Object.fromEntries(APPROVED_FIELDS.map((k) => [k, fm.value[k] ?? null]));
  return sha256(canonical({ frozen: block.text, declared: rows, fields }));
}

// Whether a signed plan approval ({ kind: "plan", ticket, approval_hash, signature }) still
// holds for the plan as it is now: the signature verifies for the context, it is for this
// plan's ticket, and the frozen block, the declared changes and the approved fields are
// unchanged.
export function verifyPlanApproval(approval, documentText, keys, { context }) {
  const v = verifySigned(approval, keys, { context });
  if (!v.ok) return v;
  if (approval.kind !== 'plan') return { ok: false, reason: 'not a plan approval' };
  let ticket = null;
  try {
    ticket = readFrontmatter(documentText)?.value.ticket ?? null;
  } catch {
    ticket = null;
  }
  if (!sameKey(approval.ticket, ticket)) return { ok: false, reason: "the approval is for another ticket's plan" };
  const now = approvalHash(documentText);
  if (now === null) return { ok: false, reason: 'the plan has no readable frozen block' };
  if (approval.approval_hash !== now) return { ok: false, reason: 'the plan changed after it was approved' };
  return v;
}
