import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';

// MIRAI's block in AGENTS.md (unit 10; 03 "Shared instructions", D-37). AGENTS.md is read by
// every AI tool; MIRAI owns only the part between its two markers, rendered from the framework
// template plus your `.mirai/context/agents-local.md`. Every byte outside the block stays as it
// was, line endings included. The block goes first, since some tools read only the start of
// the file (Codex, the first 32 KiB). Unit 11 uses the same block for CLAUDE.md.
// A marker counts only on a line of its own, at column 0, outside a code fence, so an example in
// your own text is never taken for MIRAI's block.

export const BLOCK_BEGIN = '<!-- mirai:begin -->';
export const BLOCK_END = '<!-- mirai:end -->';
export const BLOCK_MAX_BYTES = 8 * 1024;
export const AGENTS_WARN_BYTES = 32 * 1024;

export class BlockError extends MiraiError {
  constructor(message, { code = 'agents-block', hint } = {}) {
    super(message, EXIT.BLOCKED);
    this.name = 'BlockError';
    this.code = code;
    this.hint = hint;
  }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// The lines of a text with their offsets: [{ start, end, text }], `end` excluding the line break.
function lineSpans(text) {
  const out = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    const end = nl === -1 ? text.length : nl;
    out.push({ start, end: end > start && text[end - 1] === '\r' ? end - 1 : end, next: nl === -1 ? text.length : nl + 1 });
    if (nl === -1) break;
    start = nl + 1;
  }
  return out.map((l) => ({ ...l, text: text.slice(l.start, l.end) }));
}

// The markers' line spans, outside fences: { begins, ends }.
function markers(text) {
  const begins = [];
  const ends = [];
  let fence = null;
  for (const l of lineSpans(text)) {
    const f = FENCE.exec(l.text);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(l.text)) fence = null;
      continue;
    }
    if (f) { fence = f[1]; continue; }
    if (l.text === BLOCK_BEGIN) begins.push(l);
    if (l.text === BLOCK_END) ends.push(l);
  }
  return { begins, ends };
}

function located(text, file = 'AGENTS.md') {
  const { begins, ends } = markers(text);
  if (begins.length === 0 && ends.length === 0) return null;
  if (begins.length !== 1 || ends.length !== 1 || ends[0].start < begins[0].start) {
    throw new BlockError(`${file} has a broken MIRAI block (its markers are missing, repeated or out of order)`, { hint: 'leave one <!-- mirai:begin --> and one <!-- mirai:end --> line, or remove both' });
  }
  return { begin: begins[0], end: ends[0] };
}

// The block's text between the markers, with CRLF read as LF, or null when there is none.
export function blockOf(text, { file } = {}) {
  const at = located(text, file);
  return at === null ? null : text.slice(at.begin.next, at.end.start).replace(/\r\n/g, '\n').replace(/\n$/, '');
}

// The block's text: the framework template, then your own instructions; at most
// BLOCK_MAX_BYTES.
export function renderBlock(template, local, { file = 'AGENTS.md' } = {}) {
  const parts = [template.trim()];
  if (local && local.trim()) parts.push('', local.trim());
  const body = parts.join('\n');
  if (Buffer.byteLength(body, 'utf8') > BLOCK_MAX_BYTES) {
    throw new BlockError(`the MIRAI block in ${file} would be larger than ${BLOCK_MAX_BYTES} bytes`, { code: 'block-too-large', hint: 'shorten .mirai/context/agents-local.md' });
  }
  return body;
}

// Your instructions as they go into the block: the file's title line (a first non-blank line
// starting "# ") and HTML comments outside code fences are left out; everything else is kept.
export function localInstructions(text) {
  const out = [];
  let fence = null;
  let inComment = false;
  let titleSeen = false;
  for (const { text: line } of lineSpans(text)) {
    const f = FENCE.exec(line);
    if (fence) {
      out.push(line);
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) fence = null;
      continue;
    }
    if (!inComment && f) { fence = f[1]; out.push(line); titleSeen = true; continue; }
    let kept = '';
    let rest = line;
    while (rest.length) {
      if (inComment) {
        const e = rest.indexOf('-->');
        if (e === -1) { rest = ''; break; }
        rest = rest.slice(e + 3);
        inComment = false;
      } else {
        const s = rest.indexOf('<!--');
        if (s === -1) { kept += rest; break; }
        kept += rest.slice(0, s);
        rest = rest.slice(s + 4);
        inComment = true;
      }
    }
    if (!titleSeen && kept.trim() !== '') {
      titleSeen = true;
      if (/^# /.test(kept)) continue;
    }
    if (kept.trim() !== '' || line.trim() === '') out.push(kept);
  }
  return out.join('\n').trim();
}

// A file with the block put in place: replaced where it was, else added first (after a
// byte-order mark, if any); a new file holds only the block. Bytes outside the block are kept as
// they are, and the block uses the file's own line ending.
export function withBlock(existing, body, { file = 'AGENTS.md' } = {}) {
  const eol = existing && /\r\n/.test(existing) && !/(^|[^\r])\n/.test(existing) ? '\r\n' : '\n';
  const block = [BLOCK_BEGIN, ...body.split('\n'), BLOCK_END].join(eol);
  if (existing === null || existing.trim() === '' || existing === '\uFEFF') return `${block}${eol}`;
  const at = located(existing, file);
  if (at !== null) return `${existing.slice(0, at.begin.start)}${block}${existing.slice(at.end.end)}`;
  const bom = existing.startsWith('\uFEFF') ? '\uFEFF' : '';
  return `${bom}${block}${eol}${eol}${existing.slice(bom.length)}`;
}
