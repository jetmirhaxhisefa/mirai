// The environments a build-runner job gets (unit 29e; design/10 §3).

// Never passed to any job: agents, credentials and tokens.
const CREDENTIALS = [
  /^SSH_AUTH_SOCK$/, /^SSH_AGENT_PID$/, /^SSH_ASKPASS$/, /^GIT_ASKPASS$/, /^GIT_CREDENTIAL/, /^GIT_SSH/,
  /^GH_/, /^GITHUB_/, /^GLAB_/, /^GITLAB_/, /^CI_JOB_TOKEN$/,
  /^CLAUDE_CODE_OAUTH_TOKEN/, /^ANTHROPIC_/, /^CLAUDE_CONFIG_DIR$/,
  /^NPM_TOKEN$/, /^NODE_AUTH_TOKEN$/, /^AWS_/, /^GOOGLE_/, /^GCLOUD_/, /^CLOUDSDK_/, /^AZURE_/,
  /TOKEN/i, /SECRET/i, /PASSWORD/i, /PASSPHRASE/i, /API_KEY/i,
  /^MIRAI_SESSION_REQUEST$/, /^MIRAI_BUILD_RUNNER$/,
];

const isCredential = (name) => CREDENTIALS.some((re) => re.test(name));

// `tests` and `probes`: nothing of yours but PATH and the locale; a home and a temp folder of
// their own.
export function scrubbedEnv(env, { home, tmp }) {
  const out = { HOME: home, TMPDIR: tmp, PATH: env.PATH ?? '/usr/bin:/bin' };
  for (const k of ['LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'USER', 'LOGNAME', 'SHELL']) if (env[k] !== undefined) out[k] = env[k];
  return out;
}

// Sample-app jobs: your home (your real store and keys, Jet's decision 2), without any credential
// variable. Only the runner itself pushes, in the refresh step before the job starts.
// The red team keeps SSH_AUTH_SOCK: it tests your real host, and its control (S5) must reach your
// SSH agent from outside the cage to prove a case inside can't (its G18 cases). The variable
// hides nothing anyway: MIRAI finds the agent's socket through launchd without it.
export function sampleEnv(env, extra = {}, { keepSshAgent = false } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!isCredential(k) || (keepSshAgent && k === 'SSH_AUTH_SOCK')) out[k] = v;
  return { ...out, ...extra };
}
