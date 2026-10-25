// Path globs (unit 12), for the protected-path rules and the `[gate]` patterns. Paths are
// repo-relative with `/`. The forms, as `.gitignore` reads them:
// - a pattern with no `/` (other than a trailing one) matches a name at any depth: `*.lock`;
// - a pattern with a `/` (other than a trailing one) is anchored at the repo root:
//   `.github/workflows/**` (a leading `/` anchors too, and is dropped);
// - `*` matches within one path part, `?` one character in it, `**` as a whole part any number
//   of parts (`**/x`, `a/**`, `a/**/b`); `*` matches dotfiles too, as in git; a `**` inside a
//   part is a `*`;
// - `{a,b,c}` is one of its words (plain words only, no nesting);
// - a pattern ending in `/` or `/**` matches the folder and its contents;
// - matching ignores case (macOS disks do);
// - in a list, `!` excludes what an earlier pattern matched, and the last match wins.
// Any other character is matched as itself. Matching never backtracks exponentially: parts are
// matched with a memo, and each part with the two-pointer wildcard match.

const cache = new Map();

// Why a pattern written in a rule or a config can't be used, or null (unit 12): character
// classes and escapes aren't supported (so they're refused, not matched as text), a brace holds
// plain words only, and the number of wildcards is capped.
export const MAX_WILDCARDS = 8;
export function globProblem(pattern) {
  if (/[[\]\\]/.test(pattern)) return 'uses [ ] or \\, which path patterns here don\'t support';
  for (const m of pattern.matchAll(/\{([^}]*)\}/g)) if (/[*?/{]/.test(m[1])) return 'has a wildcard, a "/" or a "{" inside { }';
  if ((pattern.match(/\*+|\?/g) ?? []).length > MAX_WILDCARDS) return `has more than ${MAX_WILDCARDS} wildcards`;
  return null;
}

// `{a,b}` expanded into separate patterns (at most 256).
export function expand(pattern) {
  const m = /\{([^{}]*)\}/.exec(pattern);
  if (!m) return [pattern];
  const out = [];
  for (const word of m[1].split(',')) {
    for (const rest of expand(pattern.slice(0, m.index) + word + pattern.slice(m.index + m[0].length))) {
      out.push(rest);
      if (out.length > 256) return out;
    }
  }
  return out;
}

function compile(pattern) {
  if (cache.has(pattern)) return cache.get(pattern);
  const out = expand(pattern).map((one) => {
    let p = one.toLowerCase();
    const anchored = p.replace(/\/$/, '').includes('/');
    if (p.startsWith('/')) p = p.slice(1);
    if (p.endsWith('/')) p = `${p}**`;
    const parts = p.split('/').filter((x, i, all) => !(x === '**' && all[i - 1] === '**'));
    return anchored || parts[0] === '**' ? parts : ['**', ...parts];
  });
  cache.set(pattern, out);
  return out;
}

// One path part against one pattern part: `*` and `?`, two pointers, linear in practice.
function partMatches(pat, text) {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pat.length && (pat[p] === '?' || pat[p] === text[t])) { p++; t++; }
    else if (p < pat.length && pat[p] === '*') { star = p++; mark = t; }
    else if (star !== -1) { p = star + 1; t = ++mark; }
    else return false;
  }
  while (p < pat.length && pat[p] === '*') p++;
  return p === pat.length;
}

function partsMatch(parts, names) {
  const memo = new Map();
  const go = (i, j) => {
    const key = i * (names.length + 1) + j;
    if (memo.has(key)) return memo.get(key);
    let ok;
    if (i === parts.length) ok = j === names.length;
    else if (parts[i] === '**') ok = go(i + 1, j) || (j < names.length && go(i, j + 1));
    else ok = j < names.length && partMatches(parts[i].replace(/\*\*+/g, '*'), names[j]) && go(i + 1, j + 1);
    memo.set(key, ok);
    return ok;
  };
  return go(0, 0);
}

// Whether one pattern matches `path`.
export function matches(pattern, path) {
  const names = path.toLowerCase().split('/');
  return compile(pattern).some((parts) => partsMatch(parts, names));
}

// The last pattern in `patterns` that decides `path`: { pattern, included } or null. A `!`
// pattern excludes.
export function decide(patterns, path) {
  let found = null;
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!');
    if (matches(negated ? pattern.slice(1) : pattern, path)) found = { pattern, included: !negated };
  }
  return found;
}

export const included = (patterns, path) => decide(patterns, path)?.included === true;
