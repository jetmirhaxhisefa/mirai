// Shared by the TOML reader (unit 03a) and the frontmatter reader (unit 07a).

// Byte offset of the first invalid UTF-8 sequence, or -1. Rejects overlong forms,
// surrogates and code points above U+10FFFF, as TOML and YAML require.
export function firstInvalidUtf8(bytes) {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) { i += 1; continue; }
    let need;
    let min;
    if (b >= 0xc2 && b <= 0xdf) { need = 1; min = 0x80; }
    else if (b >= 0xe0 && b <= 0xef) { need = 2; min = 0x800; }
    else if (b >= 0xf0 && b <= 0xf4) { need = 3; min = 0x10000; }
    else return i;
    let cp = b & (0xff >> (need + 2));
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return i;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return i;
    i += need + 1;
  }
  return -1;
}
