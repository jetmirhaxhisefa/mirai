import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

// What a Claude Code binary allows, read from the binary without running it (unit 18a, probe
// R1): the keys its settings schema takes under `sandbox`, and the rule lines of the base macOS
// sandbox profile it writes for every sandboxed command. A native build carries a readable copy
// of its JavaScript; both are found there by an anchor:
// - the profile: from the array that starts with the string "(version 1)" to the end of the
//   function that holds it; every string in that stretch that starts with "(" (after spaces) is a
//   rule line, including the ones it pushes later or only on a condition (18a review: reading only
//   the array missed about half of them);
// - the settings keys: from the object that starts `{allowedDomains:` (the network settings) to
//   the end of the object that holds `failIfUnavailable:` (the sandbox settings), every object key,
//   quoted or not. Nesting isn't kept: a new key shows as a new name, but a new nested key with a
//   name already listed (`enabled`, `mode`) doesn't.
// Each anchor must be found exactly once, or the facts are `null` ("unknown"), never a guess.
// R1 read 2.1.300 to 2.1.314 this way: the same result twice from one binary, and the one change
// in that range (`allowNestedUserNamespaces`, new in 2.1.310) seen.

const CHUNK = 64 << 20;
const PROFILE_ANCHOR = '["(version 1)",';
const KEYS_ANCHOR = '{allowedDomains:';
const KEYS_END = 'failIfUnavailable:';
const WINDOW = 400_000;

function findAll(fd, size, pattern) {
  const pat = Buffer.from(pattern, 'latin1');
  const hits = new Set();
  const buf = Buffer.alloc(CHUNK + pat.length);
  for (let pos = 0; pos < size; pos += CHUNK) {
    const n = readSync(fd, buf, 0, Math.min(CHUNK + pat.length, size - pos), pos);
    const view = buf.subarray(0, n);
    for (let i = view.indexOf(pat); i !== -1; i = view.indexOf(pat, i + 1)) hits.add(pos + i);
  }
  return [...hits];
}

function readAt(fd, at, len) {
  const b = Buffer.alloc(len);
  const n = readSync(fd, b, 0, len, at);
  return b.subarray(0, n).toString('latin1');
}

// A string-aware scan of minified JavaScript: strings (quoted and template, with `${…}` parts
// skipped), identifiers and punctuation, comments and regex literals skipped. With `stop`, it
// ends where the bracket depth falls below where it started (`tokens.end`).
export function scan(src, { stop = true } = {}) {
  const out = [];
  let depth = 0;
  let i = 0;
  let prev = '(';
  const skipString = (j, q) => {
    j++;
    while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
    return j + 1;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') {
          s += src[j + 1] ?? '';
          j += 2;
        } else s += src[j++];
      }
      out.push({ kind: 'str', text: s });
      i = j + 1;
      prev = 'str';
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== '`') {
        if (src[j] === '\\') {
          s += src[j + 1] ?? '';
          j += 2;
        } else if (src[j] === '$' && src[j + 1] === '{') {
          let d = 1;
          j += 2;
          while (j < src.length && d > 0) {
            if (src[j] === '{') d++;
            else if (src[j] === '}') d--;
            if (src[j] === '"' || src[j] === "'") j = skipString(j, src[j]);
            else j++;
          }
          s += '${}';
        } else s += src[j++];
      }
      out.push({ kind: 'str', text: s });
      i = j + 1;
      prev = 'str';
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? src.length : e + 2;
      continue;
    }
    if (c === '/' && /[(,=:[!&|?{};]/.test(prev)) {
      let j = i + 1;
      let cls = false;
      while (j < src.length && (src[j] !== '/' || cls)) {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        j++;
      }
      i = j + 1;
      while (/[a-z]/.test(src[i] ?? '')) i++;
      prev = 'regex';
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      out.push({ kind: 'ident', text: word });
      prev = word === 'return' ? '(' : 'ident';
      i = j;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if ('{(['.includes(c)) depth++;
    if ('})]'.includes(c)) {
      depth--;
      if (depth < 0 && stop) {
        out.end = i;
        return out;
      }
    }
    out.push({ kind: 'punct', text: c });
    prev = c;
    i++;
  }
  out.end = i;
  return out;
}

// The profile's rule lines from the text that starts at the anchor's "[", to the end of the
// function around it.
export function profileRules(src) {
  const toks = scan(src);
  return [...new Set(toks.filter((t) => t.kind === 'str' && /^\s*\(/.test(t.text)).map((t) => t.text.trim()))].sort();
}

// The settings keys from the text that starts at `{allowedDomains:`; null when the sandbox
// object isn't in it.
export function settingsKeys(src) {
  const f = src.indexOf(KEYS_END);
  if (f < 0) return null;
  const end = f + scan(src.slice(f)).end;
  const toks = scan(src.slice(0, end + 1), { stop: false });
  const keys = new Set();
  for (let k = 1; k < toks.length - 1; k++) {
    if ((toks[k].kind === 'ident' || toks[k].kind === 'str') && toks[k + 1].text === ':' && (toks[k - 1].text === '{' || toks[k - 1].text === ',')) keys.add(toks[k].text);
  }
  return [...keys].sort();
}

// { settings_keys, profile_rules, notes }: each a sorted list, or null when its anchor wasn't
// found exactly once (the note says why).
export function readBinaryFacts(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const notes = [];
    const profileHits = findAll(fd, size, PROFILE_ANCHOR);
    let profile = null;
    if (profileHits.length === 1) profile = profileRules(readAt(fd, profileHits[0], WINDOW));
    else notes.push(`the sandbox profile's anchor was found ${profileHits.length} times, not once`);
    const keyHits = findAll(fd, size, KEYS_ANCHOR).map((at) => settingsKeys(readAt(fd, at, WINDOW))).filter(Boolean);
    let keys = null;
    if (keyHits.length === 1) keys = keyHits[0];
    else notes.push(`the settings schema's anchor was found ${keyHits.length} times, not once`);
    if (profile && profile.length === 0) {
      profile = null;
      notes.push('the sandbox profile had no rule lines');
    }
    return { settings_keys: keys, profile_rules: profile, notes };
  } finally {
    closeSync(fd);
  }
}
