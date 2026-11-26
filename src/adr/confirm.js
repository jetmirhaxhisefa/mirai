// An ADR's Confirmation (unit 61, Scope 4), read with no file access: trace's documents scope
// (which MIRAI's MCP server reaches) imports only this.

// ---- Confirmation (Scope 4) ---------------------------------------------------------------------

// The Confirmation section's lines: [{ form: 'check' | 'test' | 'review', what, line }]; a line in
// none of the three forms is { form: null, text, line }.
export function confirmationsOf(scan) {
  const h = scan.headings.find((x) => x.level === 2 && x.text === 'Confirmation');
  if (!h) return [];
  const next = scan.headings.find((x) => x.line > h.line && x.level <= 2);
  const out = [];
  for (const l of scan.lines) {
    if (l.line <= h.line || (next && l.line >= next.line) || l.kind !== 'text') continue;
    const t = (l.visible ?? l.text).trim().replace(/^[-*+][ \t]+/, '');
    if (!t) continue;
    const m = /^(check|test|review):[ \t]*(.+)$/i.exec(t.replace(/`/g, ''));
    out.push(m ? { form: m[1].toLowerCase(), what: m[2].trim(), line: l.line } : { form: null, text: t, line: l.line });
  }
  return out;
}

// A test name's ADR prefix (43's naming): "test_adr_0007_…", "ADR-0007 …", "adr0007".
export function testNamesAdr(name, id) {
  const digits = /([0-9]{1,6})$/.exec(id)?.[1];
  if (!digits) return false;
  const n = String(Number(digits));
  return new RegExp(`(?:^|[^A-Za-z0-9])adr[ _-]?0*${n}(?![0-9])`, 'i').test(String(name));
}


export const testsFor = (names, id) => names.filter((n) => testNamesAdr(n, id));
