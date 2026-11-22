import { remotes } from '../store/git.js';
import { snapshot, trustedConfig } from '../trust/snapshot.js';
import { hostConfig } from './host.js';

// The host's word for a merge request (unit 38b; Jet's decision 3, 2026-11-22): GitHub says "pull
// request" and #16, GitLab "merge request" and !16. One helper decides, so no other output names
// the thing itself. When MIRAI can't tell the host (no remote, the local store), it keeps the
// word it always used: "merge request".
//
// Contracts keep their names whatever the host: the command `mirai review-mr`, error codes
// (`no-mr`, `mr-merged`), journal events (`mr_opened`), JSON keys (`mr`), the step `mr-description`.

const WORDS = Object.freeze({
  github: Object.freeze({ host: 'github', long: 'pull request', short: 'PR', ref: (n) => `#${n}` }),
  gitlab: Object.freeze({ host: 'gitlab', long: 'merge request', short: 'MR', ref: (n) => `!${n}` }),
});
// The host can't be told: GitLab's words, no host.
const UNKNOWN = Object.freeze({ ...WORDS.gitlab, host: null });

// { host, long, short, ref(n) } for `name` ('github', 'gitlab'); any other name, null included,
// gets GitLab's words and `host: null`.
export const hostWords = (name) => (typeof name === 'string' && Object.hasOwn(WORDS, name) ? WORDS[name] : UNKNOWN);

// The project's words: the host hostConfig names from the config and the remote, without its CLI.
export function wordsFor({ config = {}, remoteUrl = null } = {}) {
  if (!remoteUrl) return hostWords(null);
  try {
    return hostWords(hostConfig(config ?? {}, remoteUrl).name);
  } catch {
    return hostWords(null);
  }
}

// "pull request #16", "merge request !16".
export const longRef = (words, n) => `${words.long} ${words.ref(n)}`;
// "PR #16", "MR !16".
export const shortRef = (words, n) => `${words.short} ${words.ref(n)}`;

// A host object's words (githubHost, gitlabHost carry theirs; a stand-in host in a test may not).
export const wordsOfHost = (host) => host?.words ?? hostWords(host?.name ?? null);

// The words of the project a store is for, from the integration branch's config and the origin
// remote; GitLab's ("merge request") when either can't be read.
export function projectWords({ cwd, env, store, now }) {
  try {
    return wordsFor({ config: trustedConfig(snapshot({ cwd, env, ...(now ? { now } : {}) })), remoteUrl: remotes(store.checkout, store.gitEnv).get('origin') ?? null });
  } catch {
    return hostWords(null);
  }
}
