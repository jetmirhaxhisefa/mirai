// The LLD's items (unit 63, Scope 7): its contracts (C-n) and schema changes (S-n), the IDs tickets
// cite in `uses`. Read from a parsed LLD: the first cell of each row of its Contracts and Schema
// changes tables.

export function lldItems(doc) {
  const out = new Set();
  const { headings, lines } = doc.scan;
  for (const name of ['Contracts', 'Schema changes']) {
    const h = headings.find((x) => x.level === 2 && x.text === name);
    if (!h) continue;
    const next = headings.find((x) => x.line > h.line && x.level <= 2);
    for (const l of lines) {
      if (l.line <= h.line || (next && l.line >= next.line) || l.kind !== 'text') continue;
      const m = /^ *\| *`?([CS]-[0-9]+)`? *\|/.exec(l.visible ?? l.text);
      if (m) out.add(m[1]);
    }
  }
  return out;
}

// The same, from an LLD's text without the parser (Rex's rule bases): the rows of its Contracts and
// Schema changes sections, outside code blocks.
export function lldItemIds(text) {
  const out = new Set();
  let inside = false;
  let fence = false;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (/^ {0,3}(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const h = /^ {0,3}##[ \t]+(.+?)[ \t#]*$/.exec(line);
    if (h) inside = h[1] === 'Contracts' || h[1] === 'Schema changes';
    else if (/^ {0,3}#[ \t]/.test(line)) inside = false;
    const m = inside && /^ *\| *`?([CS]-[0-9]+)`? *\|/.exec(line);
    if (m) out.add(m[1]);
  }
  return [...out];
}
