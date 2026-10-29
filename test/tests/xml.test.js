import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseXml, XML_LIMITS } from '../../src/tests/xml.js';

// Unit 16a T1: the XML reader. What JUnit files use, and refused (as a malformed report)
// everything else. Pure: it reads only the bytes it's given.

const refused = (text, re, limits) => assert.throws(() => parseXml(text, limits), (e) => e.code === 'malformed' && re.test(e.message), `${JSON.stringify(text.slice(0, 60))} should be refused`);

test('16a T1: the XML reader: elements, attributes in either quote, text, CDATA, comments, entities and character references', () => {
  const root = parseXml(`<?xml version="1.0" encoding="UTF-8"?>
<!-- a comment -->
<a x="1" y='two &amp; &quot;3&quot;' z="&#65;&#x42;	tab\r\nline">
  <b>t &lt; u &gt; v &apos;w&apos;</b>
  <c><![CDATA[raw <x> & ]] stays]]>, then text</c>
  <?ignored processing instruction?>
  <d/><d />
</a>
`);
  assert.equal(root.name, 'a');
  assert.equal(Object.getPrototypeOf(root.attrs), null);
  assert.deepEqual({ ...root.attrs }, { x: '1', y: 'two & "3"', z: 'AB\ttab\nline' });
  assert.deepEqual(root.children.map((c) => c.name), ['b', 'c', 'd', 'd']);
  assert.equal(root.children[0].text, 't < u > v \'w\'');
  assert.equal(root.children[1].text, 'raw <x> & ]] stays, then text');
  // A byte-order mark, Buffer input, characters beyond the BMP.
  assert.equal(parseXml(Buffer.from('\ufeff<r n="\u{1F600}"/>')).attrs.n, '\u{1F600}');
  // A prototype-looking attribute stays an attribute.
  assert.equal(parseXml('<r __proto__="x" constructor="y"/>').attrs.__proto__, 'x');
});

test('16a T1: the reader refuses a DOCTYPE, any other entity, a foreign encoding, broken UTF-8, and anything not well formed', () => {
  refused('<!DOCTYPE r [<!ENTITY x "boom">]><r>&x;</r>', /DOCTYPE/);
  refused('<?xml version="1.0"?><!DOCTYPE r SYSTEM "file:///etc/passwd"><r/>', /DOCTYPE/);
  refused('<r>&x;</r>', /entity/);
  refused('<r a="&nbsp;"/>', /entity/);
  refused('<r>a & b</r>', /"&"/);
  refused('<r>&#0;</r>', /character/);
  refused('<r>&#xD800;</r>', /character/);
  refused('<r>\u0001</r>', /character/);
  refused('<?xml version="1.0" encoding="ISO-8859-1"?><r/>', /encoding/);
  assert.throws(() => parseXml(Buffer.from([0x3c, 0x72, 0x3e, 0xff, 0x3c, 0x2f, 0x72, 0x3e])), /UTF-8/);
  refused('<r><s></r>', /doesn't match/);
  refused('<r>', /isn't closed/);
  refused('<r></r><r/>', /second root/);
  refused('text<r/>', /outside the root/);
  refused('<r a="1" a="2"/>', /twice/);
  refused('<r a=1/>', /quoted/);
  refused('<r a="x<y"/>', /"<"/);
  refused('<r a="1"b="2"/>', /space/);
  refused('<r>a < b</r>', /name/);
  refused('<r><!-- a -- b --></r>', /--/);
  refused('<r><!ELEMENT r ANY></r>', /markup declaration/);
  refused('<r>]]></r>', /\]\]>/);
  refused('<r/><?xml version="1.0"?>', /declaration after/);
  refused('', /no root/);
  refused('<!-- only -->', /no root/);
});

test('16a T1: the limits: depth, size and element count', () => {
  const deep = (n) => `${'<a>'.repeat(n)}${'</a>'.repeat(n)}`;
  assert.equal(parseXml(deep(XML_LIMITS.depth)).name, 'a');
  refused(deep(XML_LIMITS.depth + 1), /levels deep/);
  refused(`<r>${'x'.repeat(100)}</r>`, /larger than/, { ...XML_LIMITS, bytes: 50 });
  refused(`<r>${'<c/>'.repeat(10)}</r>`, /elements/, { ...XML_LIMITS, elements: 5 });
  assert.equal(XML_LIMITS.bytes, 16 * 1024 * 1024);
});

test('16a T1: the reader never opens a file or runs anything', () => {
  const src = readFileSync(join(import.meta.dirname, '../../src/tests/xml.js'), 'utf8');
  assert.doesNotMatch(src, /^import /m);
  assert.doesNotMatch(src, /\brequire\(|\bimport\(|\beval\(|new Function|process\./);
});
