// Detects credentials in config values (unit 03b). Links and names are allowed in config;
// credentials never are. These functions answer yes or no and never return the value.

// Known token shapes, anywhere in a string, starting at a word boundary (so "task-…" is not
// read as "sk-…").
const TOKEN_SHAPES = new RegExp('(?<![A-Za-z0-9])(?:' + [
  'gh[pousr]_[A-Za-z0-9]{20,}', // GitHub tokens
  'github_pat_[A-Za-z0-9_]{20,}', // GitHub fine-grained tokens
  'glpat-[A-Za-z0-9_-]{20,}', // GitLab
  'sk-[A-Za-z0-9_-]{20,}', // OpenAI and Anthropic (sk-, sk-proj-, sk-ant-)
  'xox[a-z]-[A-Za-z0-9-]{10,}', // Slack
  'AKIA[0-9A-Z]{16}', // AWS access key IDs
  'AIza[0-9A-Za-z_-]{35}', // Google API keys
].join('|') + ')');

// Query or fragment parameter names that carry secrets (matched as substrings, any case).
export const SECRET_PARAM = /token|secret|signature|^sig$|^key$|api[-_]?key|access[-_]?key|private[-_]?key|passw|^pwd$|credential|^auth$|authorization|session/i;

export function hasTokenShape(value) {
  return TOKEN_SHAPES.test(value);
}

// True when a link carries a credential: a token shape, a user or password in the URL, or a
// secret-looking parameter in the query or the #fragment.
export function linkHasCredential(value) {
  if (hasTokenShape(value)) return true;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return true;
  const params = [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()];
  return params.some((name) => SECRET_PARAM.test(name));
}

// True when a git remote carries a credential. Only the conventional "git" user is allowed
// (ssh://git@host/…, git@host:owner/repo); https remotes may have no user at all.
export function remoteHasCredential(value) {
  if (hasTokenShape(value)) return true;
  // SCP-style remotes (user@host:path) have no "://"; the user part may hide a token.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    const scp = /^([^@/\s]+)@[^:\s/]+:/.exec(value);
    return scp ? scp[1] !== 'git' : false;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.password) return true;
  if (url.username && !(url.username === 'git' && /^(ssh|git\+ssh):$/.test(url.protocol))) return true;
  const params = [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()];
  return params.some((name) => SECRET_PARAM.test(name));
}

// Walks parsed data and returns the key paths of every string value or key name that has a
// token shape. Used on every config layer, so no field can carry a token.
export function findTokenShapes(value, path = '') {
  const found = [];
  const walk = (v, p) => {
    if (typeof v === 'string') {
      if (hasTokenShape(v)) found.push(p);
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${p}[${i}]`));
    } else if (v !== null && typeof v === 'object') {
      for (const [k, item] of Object.entries(v)) {
        const child = p ? `${p}.${k}` : k;
        if (hasTokenShape(k)) found.push(child);
        walk(item, child);
      }
    }
  };
  walk(value, path);
  return found;
}
