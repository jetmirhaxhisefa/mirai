// A small XML reader for test reports (unit 16a; D-48 item 5): no dependency, and only what
// JUnit files use. Elements, attributes (either quote), text, CDATA, comments, processing
// instructions (skipped) and the XML declaration; the five predefined entities and numeric
// character references. Refused, as a malformed report: a DOCTYPE (so no entity of the file's
// own, and nothing fetched or expanded), any other entity, an encoding other than UTF-8, bytes
// that aren't UTF-8, more than XML_LIMITS.depth levels, more than XML_LIMITS.bytes, more than
// XML_LIMITS.elements elements, and anything not well formed. It reads the bytes it's given and
// nothing else.

// Elements: four per test case at JUnit's case limit (src/tests/junit.js), so a hostile report is
// refused before it costs much memory.
export const XML_LIMITS = Object.freeze({ bytes: 16 * 1024 * 1024, depth: 64, elements: 400_000 });

export class XmlError extends Error {
  constructor(message, at) {
    super(at === undefined ? message : `${message} (at byte ${at})`);
    this.code = 'malformed';
  }
}

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
const SPACE = /[ \t\r\n]*/y;
const PREDEFINED = Object.freeze({ lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' });

// XML's Char production: no NUL or other C0 control but tab, newline and return; no surrogate
// or non-character code point.
const xmlChar = (c) => c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff);

function decodeEntities(text, at) {
  if (!text.includes('&')) return text;
  return text.replace(/&([^;&\s]{0,12});?/g, (whole, ref) => {
    if (!whole.endsWith(';')) throw new XmlError('an "&" that doesn\'t start an entity', at);
    if (Object.hasOwn(PREDEFINED, ref)) return PREDEFINED[ref];
    const m = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(ref);
    if (!m) throw new XmlError(`the entity &${ref.slice(0, 12)}; isn't one of XML's own`, at);
    const code = m[1] !== undefined ? Number.parseInt(m[1], 16) : Number.parseInt(m[2], 10);
    if (!xmlChar(code)) throw new XmlError(`&${ref}; isn't a character XML allows`, at);
    return String.fromCodePoint(code);
  });
}

// Parses `input` (a Buffer or string) into its root element: { name, attrs, children, text },
// where `attrs` has no prototype (values with their newlines), `children` are elements only, and
// `text` is the element's own text and CDATA, joined. Throws XmlError.
export function parseXml(input, limits = XML_LIMITS) {
  const bytes = typeof input === 'string' ? Buffer.byteLength(input) : input.length;
  if (bytes > limits.bytes) throw new XmlError(`the file is larger than ${limits.bytes} bytes`);
  let s;
  if (typeof input === 'string') s = input;
  else {
    try {
      s = new TextDecoder('utf-8', { fatal: true }).decode(input);
    } catch {
      throw new XmlError('the file isn\'t UTF-8');
    }
  }
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i);
    if (c > 0xffff) i++;
    if (!xmlChar(c)) throw new XmlError('a character XML doesn\'t allow', i);
  }
  let i = 0;
  let count = 0;
  let root = null;
  const stack = [];
  const space = () => {
    SPACE.lastIndex = i;
    SPACE.exec(s);
    i = SPACE.lastIndex;
  };
  const name = () => {
    NAME.lastIndex = i;
    const m = NAME.exec(s);
    if (!m) throw new XmlError('a name was expected', i);
    i = NAME.lastIndex;
    if (m[0].length > 200) throw new XmlError('a name longer than 200 characters', i);
    return m[0];
  };
  const until = (end, what) => {
    const j = s.indexOf(end, i);
    if (j < 0) throw new XmlError(`${what} that isn't closed`, i);
    const body = s.slice(i, j);
    i = j + end.length;
    return body;
  };
  const addText = (t) => {
    if (stack.length) stack.at(-1).text += t;
    else if (/[^ \t\r\n]/.test(t)) throw new XmlError('text outside the root element', i);
  };
  // The XML declaration, only at the very start.
  if (s.startsWith('<?xml') && /[ \t\r\n?]/.test(s[5] ?? '')) {
    const decl = until('?>', 'an XML declaration');
    const enc = /encoding\s*=\s*["']([^"']*)["']/.exec(decl);
    if (enc && !/^utf-?8$/i.test(enc[1])) throw new XmlError(`the file declares the encoding ${enc[1].slice(0, 20)}, not UTF-8`);
  }
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const textEnd = lt < 0 ? s.length : lt;
    if (textEnd > i) {
      const raw = s.slice(i, textEnd);
      if (raw.includes(']]>')) throw new XmlError('"]]>" in text', i);
      addText(decodeEntities(raw, i));
      i = textEnd;
    }
    if (lt < 0) break;
    if (s.startsWith('<!--', i)) {
      i += 4;
      const body = until('-->', 'a comment');
      if (body.includes('--')) throw new XmlError('"--" inside a comment', i);
    } else if (s.startsWith('<![CDATA[', i)) {
      i += 9;
      if (!stack.length) throw new XmlError('CDATA outside the root element', i);
      addText(until(']]>', 'a CDATA section'));
    } else if (s.startsWith('<!', i)) {
      throw new XmlError(/^<!DOCTYPE/i.test(s.slice(i, i + 9)) ? 'a DOCTYPE, which test reports never need' : 'a markup declaration', i);
    } else if (s.startsWith('<?', i)) {
      i += 2;
      if (/^xml[ \t\r\n?]/i.test(s.slice(i, i + 4))) throw new XmlError('an XML declaration after the start', i);
      until('?>', 'a processing instruction');
    } else if (s.startsWith('</', i)) {
      i += 2;
      const n = name();
      space();
      if (s[i] !== '>') throw new XmlError(`a closing tag ${n} that doesn't end with ">"`, i);
      i++;
      const open = stack.pop();
      if (!open || open.name !== n) throw new XmlError(`the closing tag ${n} doesn't match ${open ? open.name : 'any open tag'}`, i);
    } else {
      i++;
      if (root && !stack.length) throw new XmlError('a second root element', i);
      if (stack.length >= limits.depth) throw new XmlError(`more than ${limits.depth} levels deep`, i);
      if (++count > limits.elements) throw new XmlError(`more than ${limits.elements} elements`, i);
      const el = { name: name(), attrs: Object.create(null), children: [], text: '' };
      for (;;) {
        const before = i;
        space();
        if (s[i] === '>' || s.startsWith('/>', i)) break;
        if (i === before) throw new XmlError(`the tag ${el.name} needs a space before an attribute`, i);
        const a = name();
        space();
        if (s[i] !== '=') throw new XmlError(`the attribute ${a} has no value`, i);
        i++;
        space();
        const q = s[i];
        if (q !== '"' && q !== '\'') throw new XmlError(`the attribute ${a}'s value isn't quoted`, i);
        i++;
        const at = i;
        const raw = until(q, `the attribute ${a}'s value`);
        if (raw.includes('<')) throw new XmlError(`a "<" in the attribute ${a}`, at);
        if (Object.hasOwn(el.attrs, a)) throw new XmlError(`the attribute ${a} twice`, at);
        // Kept as written (XML would make each tab and newline a space): runners put multi-line
        // messages in attributes, and only their first line is shown.
        el.attrs[a] = decodeEntities(raw.replace(/\r\n?/g, '\n'), at);
      }
      if (stack.length) stack.at(-1).children.push(el);
      else root = el;
      if (s.startsWith('/>', i)) i += 2;
      else {
        i++;
        stack.push(el);
      }
    }
  }
  if (stack.length) throw new XmlError(`the tag ${stack.at(-1).name} isn't closed`);
  if (!root) throw new XmlError('no root element');
  return root;
}
