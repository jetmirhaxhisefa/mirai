// Shows a value that came from a file or the run log in a message, safely: plain names as they
// are, anything else quoted with control characters escaped (so nothing can reach the
// terminal as an escape sequence). C1 controls, bidi overrides and zero-width characters are
// escaped too, so text can't hide or reorder what you read (unit 05a).
export function shown(value) {
  if (typeof value === 'string' && /^[A-Za-z0-9._@/-]{1,64}$/.test(value)) return value;
  if (typeof value === 'string') {
    return escapeInvisible(JSON.stringify(value.length > 64 ? `${value.slice(0, 64)}…` : value));
  }
  return `<${typeof value}>`;
}

// Escapes what JSON.stringify leaves raw but a terminal may act on or hide: C1 controls, the
// soft hyphen, bidi marks and overrides, zero-width characters, tag characters. The result is
// still valid JSON when the input was (characters above U+FFFF become a surrogate pair).
const INVISIBLE = /[\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff\u{e0000}-\u{e007f}]/gu;
const u4 = (n) => `\\u${n.toString(16).padStart(4, '0')}`;
export function escapeInvisible(text) {
  return text.replace(INVISIBLE, (c) => (c.length === 1 ? u4(c.charCodeAt(0)) : u4(c.charCodeAt(0)) + u4(c.charCodeAt(1))));
}
