// The Markdown structure scanner (unit 07b). It finds what the lint rules need, with line and
// column: headings, fenced blocks, HTML comments, links, and each line's kind. It is not a
// renderer. Fenced blocks, HTML comments and code spans are opaque: headings, links and IDs
// inside them don't count.
//
// Known approximations, chosen to stay small and predictable:
// - indented code blocks (four spaces) are read as text, because list items use the same
//   indentation; a fence may be indented, for the same reason;
// - a code span ends on its own line;
// - link text can't contain brackets, and a reference definition's destination must be on
//   its line.
//
// Every pattern here runs in linear time on a line, and lines longer than LIMITS.lineLength
// aren't scanned (a problem), so no file can stall the lint.

export const LIMITS = Object.freeze({ lineLength: 10_000 });

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const FENCE_OPEN = /^( *)(`{3,}|~{3,})(.*)$/;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const LIST_ITEM = /^ *(?:[-*+]|[0-9]{1,9}[.)])(?:[ \t]|$)/;
const INLINE_LINK = /(!?)\[([^[\]\n]*)\]\(\s*(<[^<>\n]*>|[^\s()<>]+(?:\([^\s()]*\)[^\s()<>]*)*)?(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\)/g;
const REFERENCE_DEF = /^ {0,3}\[([^[\]\n]+)\]:[ \t]*(<[^<>\n]*>|\S+)[ \t]*(?:(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\))[ \t]*)?$/;
const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*)>/g;
const BARE_URL = /\bhttps?:\/\/[^\s<>()[\]"'`]+/gi;
const HTML_TAG = /<\/?[A-Za-z][^<>\n]*>/g;

// Scans `text` (a document body). `firstLine` is the file line of its first line.
// Returns { headings, lines, fences, links, problems }:
// - headings: { level, text, line, column };
// - lines: { line, kind, text } for every line; kind is blank | comment | heading | text |
//   fence (an opening, body or closing line); `text` has comments, code spans, link
//   destinations and HTML tags blanked with spaces, so columns stay right and IDs in them
//   don't count;
// - fences: { info, line, endLine, body: [{ line, text }] };
// - links: { target, line, column, kind: inline | image | reference | autolink | bare };
// - problems: { code, line, column, reason, hint }.
export function scanMarkdown(text, { firstLine = 1 } = {}) {
  const out = { headings: [], lines: [], fences: [], links: [], problems: [] };
  const raw = text.split('\n');
  if (raw.at(-1) === '') raw.pop();
  let fence = null;
  let inComment = false;
  // The paragraph the previous line belongs to: null, 'plain' or 'list'. Only a plain
  // paragraph can be underlined into a setext heading.
  let paragraph = null;

  raw.forEach((rawLine, i) => {
    const line = firstLine + i;
    const src = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (src.length > LIMITS.lineLength) {
      out.problems.push({ code: 'long-line', line, column: 1, reason: `the line is longer than ${LIMITS.lineLength} characters, so it isn't checked`, hint: 'break it into shorter lines' });
      out.lines.push({ line, kind: fence ? 'fence' : 'text', text: '' });
      return;
    }

    if (fence) {
      const close = /^( *)(`{3,}|~{3,})[ \t]*$/.exec(src);
      if (close && close[1].length <= fence.indent + 3 && close[2][0] === fence.char && close[2].length >= fence.length) {
        fence.block.endLine = line;
        fence = null;
      } else {
        fence.block.body.push({ line, text: src });
      }
      out.lines.push({ line, kind: 'fence', text: src });
      paragraph = null;
      return;
    }

    // HTML comments (possibly over several lines) and code spans, in one pass, so a `<!--`
    // inside a code span isn't a comment and a backtick inside a comment isn't code.
    const { visible, scan, open, hadComment } = blankInline(src, inComment);
    inComment = open;
    if (/^\s*$/.test(visible)) {
      out.lines.push({ line, kind: hadComment ? 'comment' : 'blank', text: scan });
      paragraph = null;
      return;
    }

    const opening = FENCE_OPEN.exec(visible);
    if (opening && !(opening[2][0] === '`' && opening[3].includes('`'))) {
      const block = { info: opening[3].trim().split(/\s+/)[0].toLowerCase(), line, endLine: null, body: [] };
      out.fences.push(block);
      fence = { char: opening[2][0], length: opening[2].length, indent: opening[1].length, block };
      out.lines.push({ line, kind: 'fence', text: src });
      paragraph = null;
      return;
    }

    const heading = HEADING.exec(scan);
    if (heading) {
      const level = heading[1].length;
      const at = scan.indexOf('#');
      let headingText = '';
      if (heading[2] !== undefined) {
        // The text comes from the visible line, so code spans keep their content; a closing
        // run of #s (after a space) and trailing spaces are not part of it.
        const start = at + level + (/^[ \t]+/.exec(scan.slice(at + level))?.[0].length ?? 0);
        headingText = visible.slice(start).replace(/[ \t]+$/, '').replace(/(^|[ \t])#+$/, '').replace(/[ \t]+$/, '');
      }
      if (headingText === '') {
        out.problems.push({ code: 'empty-heading', line, column: column(src, at), reason: 'a heading has no text' });
      }
      out.headings.push({ level, text: headingText, line, column: column(src, at) });
      out.lines.push({ line, kind: 'heading', text: collectLinks(scan, src, line, out.links) });
      paragraph = null;
      return;
    }

    if (paragraph === 'plain' && SETEXT.test(scan)) {
      out.problems.push({
        code: 'setext', line, column: column(src, scan.search(/\S/)),
        reason: 'an underlined (setext) heading',
        hint: 'use # headings; for a rule, put a blank line before ---',
      });
      out.lines.push({ line, kind: 'text', text: scan });
      paragraph = null;
      return;
    }

    const reference = REFERENCE_DEF.exec(scan);
    let idText;
    if (reference) {
      const start = scan.indexOf(reference[2], reference[0].indexOf(']:'));
      out.links.push({ target: unwrap(reference[2]), line, column: column(src, start), kind: 'reference' });
      idText = scan.slice(0, start) + ' '.repeat(reference[2].length) + scan.slice(start + reference[2].length);
    } else {
      idText = collectLinks(scan, src, line, out.links);
    }
    out.lines.push({ line, kind: 'text', text: idText });
    if (LIST_ITEM.test(scan)) paragraph = 'list';
    else if (/^ *[|>]/.test(scan) || /^ *</.test(scan)) paragraph = 'other';
    else paragraph ??= 'plain';
  });

  if (fence) {
    out.problems.push({ code: 'unclosed-fence', line: fence.block.line, column: 1, reason: "a fenced block isn't closed", hint: `close it with ${fence.char.repeat(fence.length)}` });
  }
  if (inComment) {
    const last = [...out.lines].reverse().find((l) => l.kind === 'comment');
    out.problems.push({ code: 'unclosed-comment', line: last?.line ?? firstLine, column: 1, reason: "an HTML comment isn't closed", hint: 'close it with -->' });
  }
  return out;
}

// Columns count characters, not UTF-16 units.
function column(src, index) {
  return [...src.slice(0, Math.max(index, 0))].length + 1;
}

// One left-to-right pass over a line: whichever starts first, a code span or `<!--`, wins.
// Returns `visible` (comments blanked), `scan` (comments and code-span contents blanked),
// `open` (the line ends inside a comment) and `hadComment`.
function blankInline(src, inComment) {
  let visible = '';
  let scan = '';
  let i = 0;
  let open = inComment;
  let hadComment = inComment;
  const blank = (n) => { visible += ' '.repeat(n); scan += ' '.repeat(n); };
  while (i < src.length) {
    if (open) {
      const end = src.indexOf('-->', i);
      const stop = end === -1 ? src.length : end + 3;
      blank(stop - i);
      i = stop;
      if (end !== -1) open = false;
      continue;
    }
    if (src.startsWith('<!--', i)) {
      open = true;
      hadComment = true;
      continue;
    }
    if (src[i] === '`') {
      let n = 0;
      while (src[i + n] === '`') n += 1;
      const run = '`'.repeat(n);
      let close = -1;
      for (let j = src.indexOf(run, i + n); j !== -1; j = src.indexOf(run, j + 1)) {
        if (src[j - 1] !== '`' && src[j + n] !== '`') { close = j; break; }
      }
      if (close === -1) {
        visible += run;
        scan += run;
        i += n;
        continue;
      }
      visible += src.slice(i, close + n);
      scan += run + ' '.repeat(close - i - n) + run;
      i = close + n;
      continue;
    }
    visible += src[i];
    scan += src[i];
    i += 1;
  }
  return { visible, scan, open, hadComment };
}

function unwrap(target) {
  return target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target;
}

// Collects the links on a scanned line and returns the line with link destinations,
// autolinks and HTML tags blanked, for the ID scan.
function collectLinks(scan, src, line, links) {
  const spans = [];
  for (const m of scan.matchAll(INLINE_LINK)) {
    if (m.index > 0 && scan[m.index - 1] === '\\') continue;
    const open = m.index + m[1].length + m[2].length + 2;
    if (m[3] === undefined) {
      links.push({ target: '', line, column: column(src, open), kind: m[1] ? 'image' : 'inline' });
      continue;
    }
    const at = scan.indexOf(m[3], open);
    links.push({ target: unwrap(m[3]), line, column: column(src, at), kind: m[1] ? 'image' : 'inline' });
    spans.push([open, m.index + m[0].length]);
  }
  for (const m of scan.matchAll(AUTOLINK)) {
    links.push({ target: m[1], line, column: column(src, m.index + 1), kind: 'autolink' });
    spans.push([m.index, m.index + m[0].length]);
  }
  let text = blankSpans(scan, spans);
  // Bare URLs: GitHub renders them as links, so they get the same credential check.
  for (const m of text.matchAll(BARE_URL)) {
    links.push({ target: m[0].replace(/[.,;:!?]+$/, ''), line, column: column(src, m.index), kind: 'bare' });
    spans.push([m.index, m.index + m[0].length]);
  }
  for (const m of text.matchAll(HTML_TAG)) spans.push([m.index, m.index + m[0].length]);
  text = blankSpans(scan, spans);
  return text;
}

function blankSpans(text, spans) {
  if (spans.length === 0) return text;
  const chars = [...text.split('')];
  for (const [a, b] of spans) for (let k = a; k < b; k++) chars[k] = ' ';
  return chars.join('');
}

// GitHub's heading anchors, approximated: inline marks are stripped (links keep their text,
// code keeps its content), then the text is lower-cased, punctuation is removed and spaces
// become "-". Repeats get -1, -2, …
export function headingSlugs(headings) {
  const seen = new Map();
  const slugs = new Set();
  for (const h of headings) {
    const plain = h.text
      .replace(/!?\[([^[\]]*)\]\([^()]*\)/g, '$1')
      .replace(/<[^<>]+>/g, '')
      .replace(/[`*]/g, '');
    const base = plain.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}
