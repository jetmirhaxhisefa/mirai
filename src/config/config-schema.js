import { GATE_STAGES, NEVER_AUTO_STAGES, JUDGEMENT_STEPS, STEPS } from './defaults.js';
import { globProblem } from '../util/glob.js';
import { linkHasCredential, remoteHasCredential } from './credentials.js';
import { allowEntryProblem } from './git-repo-keys.js';
import { checkTicketTypes } from '../tickets/types.js';

// The config schema (unit 03b; the key list in design/07, "Config keys (unit 03b)").

// What each layer may set, as key paths. Personal settings never live in a shared repo
// (D-57); personal files can't change team policy. `*` allows every key below a table.
export const LAYER_KEYS = Object.freeze({
  project: ['schema_version', 'preset', 'git.integration_branch', 'git.host', 'git.host_url', 'git.branch_pattern', 'git.trailer', 'git.commit_format', 'git.committer_email', 'models.*', 'loop.*', 'testing.*', 'checks.*', 'compose.*', 'repos',
    'workspace.*', 'resources.*', 'gate.*', 'gates.*', 'retention.*', 'run.*', 'docs.*', 'sandbox.*', 'tickets.*', 'adr.*', 'design.*'],
  // Unit 45b (Jet's answer 2 "A"): your step tiers too, for your own launches.
  'personal-repo': ['schema_version', 'models.light', 'models.standard', 'models.deep', 'models.steps.*', 'run.stop_by', 'run.on_limit', 'run.max_wait_minutes'],
  'personal-global': ['schema_version', 'subscription.*', 'usage.*', 'git.allow_repo_config', 'git.author_name', 'git.author_email', 'tests.max_parallel', 'signing.unlock', 'claude_code.move'],
});

const NAME = /^[a-z][a-z0-9-]*$/;
// A git identity's parts: no angle brackets, newlines or control characters (they'd break the header).
// Git strips these from both ends of a name or email (its "crud": space . , : ; " ' \ and < >), so
// a value with one there would come back changed (unit 22 re-review): refused here instead.
export const GIT_NAME = /^(?![\s.,:;"'\\])[^<>\u0000-\u001f\u007f]{1,100}(?<![\s.,:;"'\\])$/;
export const GIT_EMAIL = /^(?![.,:;"'\\])[^<>\s@\u0000-\u001f\u007f]{1,64}@[^<>\s@\u0000-\u001f\u007f]{1,190}(?<![.,:;"'\\])$/;
const NAME_HINT = 'lowercase letters, digits and "-", starting with a letter';

// A git branch name (a subset of git check-ref-format): components don't start with "." or
// end with ".lock"; no "..", "//", "@{", a lone "@", control or special characters.
// A subscription plan name (D-57), shared by the global config, the run log and the usage ledger.
export const PLAN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const BRANCH = /^(?!\/)(?!-)(?!@$)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)(?!.*(?:^|\/)\.)(?!.*\.lock(?:\/|$))(?!.*[/.]$)[^\s~^:?*[\\\x00-\x1f\x7f]+$/;

function relativePath(value, path, report) {
  if (value === '' || value.startsWith('/') || value.includes('\\') || value.split('/').includes('..') || value.includes('\0')) {
    report(path, `${path} must be a relative path inside the repo`, 'no leading "/", no ".." and no "\\"', 'path');
  }
}

const relPath = { type: 'string', check: relativePath };
const argv = { type: 'array', items: { type: 'string', pattern: /\S/, patternHint: 'no empty arguments' }, minItems: 1 };
const globs = { type: 'array', items: { type: 'string', pattern: /\S/, patternHint: 'no empty patterns' } };
// Patterns that can only add paths (unit 12): no "!" exclusions, no "..".
const addedGlobs = {
  type: 'array',
  items: {
    type: 'string',
    pattern: /^(?!!)(?!.*(^|\/)\.\.(\/|$))\S{1,200}$/,
    patternHint: 'a path pattern without "!", ".." or spaces',
    check(value, path, report) {
      const problem = typeof value === 'string' ? globProblem(value) : null;
      if (problem) report(path, `${path} ${problem}`, undefined, 'pattern');
    },
  },
};

const NO_CREDENTIAL_HINT = 'keep links and names only; log in through the tool itself';

const resource = {
  type: 'table',
  fields: {
    name: { type: 'string' },
    url: {
      type: 'string',
      check(value, path, report) {
        if (linkHasCredential(value)) return report(path, `${path} looks like it contains a credential`, NO_CREDENTIAL_HINT, 'credential');
        if (!/^https?:\/\/[^\s/]+/.test(value)) report(path, `${path} must be an http(s) link`, undefined, 'pattern');
        return undefined;
      },
    },
  },
  required: ['url'],
};

// Where a level or check runs (unit 14c): the compose service, its working folder, a hard time
// limit, and `exec` into the running service or a `oneoff` container. A test run refuses a level
// or check without a service: everything runs in the project's containers (D-48).
const RUN_IN = {
  service: { type: 'string', pattern: /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, patternHint: 'a service name from the compose file' },
  workdir: { type: 'string', pattern: /^\/[^\\\0]*$/, patternHint: 'an absolute path inside the container, such as "/app"' },
  timeout_minutes: { type: 'integer', min: 1, max: 240 },
  run: { type: 'enum', values: ['exec', 'oneoff'] },
};

// What a test level is required for (D-44, D-48).
export const REQUIRED_FOR = Object.freeze(['all', 'logic', 'endpoint-changes', 'critical-journeys', 'interface-changes']);

const level = {
  type: 'table',
  fields: {
    name: { type: 'string', pattern: NAME, patternHint: NAME_HINT },
    repo: { type: 'string' },
    // The level's test adapter (unit 16a): a name from registry/test-adapters/ or the project's
    // .mirai/custom/test-adapters/, checked when the level runs.
    adapter: { type: 'string', pattern: NAME, patternHint: 'a test adapter\'s name, such as "phpunit"' },
    // With an adapter whose report names files relative to somewhere other than the service's
    // working folder (a runner's own test folder): that folder, as a project path.
    report_root: { type: 'string', pattern: /^(?![-/])(?!.*(^|\/)\.{1,2}(\/|$))[A-Za-z0-9_./@-]{1,512}$/, patternHint: 'a folder of the project, relative to its top, such as "e2e/tests"' },
    command: argv,
    purpose: { type: 'string' },
    required_for: { type: 'array', items: { type: 'enum', values: REQUIRED_FOR } },
    budget_minutes: { type: 'integer', min: 1 },
    // The files this level must measure (unit 26b, diff coverage): a changed file inside them
    // that no level's coverage lists counts as uncovered. Read from the integration branch's
    // config only. Without it, the files the level's baseline measured.
    coverage_paths: {
      ...globs,
      check(value, path, report) {
        if (!value.some((p) => !p.startsWith('!'))) report(path, `${path} needs at least one pattern that includes files`, 'for example "backend/app/**"', 'range');
      },
    },
    ...RUN_IN,
  },
  required: ['name', 'command'],
};

// A named check is a command (argv), or a table with the command and where and how long it runs.
const namedCheck = {
  type: 'choice',
  pick: (value) => (Array.isArray(value) ? argv : {
    type: 'table',
    fields: { command: argv, ...RUN_IN },
    required: ['command'],
  }),
};

const repo = {
  type: 'table',
  fields: {
    name: { type: 'string', pattern: /^(\.|[a-z][a-z0-9-]*)$/, patternHint: `"." or ${NAME_HINT}` },
    path: relPath,
    remote: {
      type: 'string',
      check(value, path, report) {
        if (remoteHasCredential(value)) report(path, `${path} looks like it contains a credential`, NO_CREDENTIAL_HINT, 'credential');
      },
    },
    start: argv,
    health: argv,
  },
  required: ['name', 'path'],
};

const tier = { type: 'enum', values: ['light', 'standard', 'deep'] };

export const CONFIG_SCHEMA = {
  type: 'table',
  fields: {
    preset: { type: 'enum', values: ['supervised', 'autonomous'] },
    git: {
      type: 'table',
      fields: {
        integration_branch: { type: 'string', pattern: BRANCH, patternHint: 'a git branch name such as "main"' },
        // Where the project's MRs live (unit 27a; Jet's decision 5): GitHub or GitLab, cloud or
        // self-hosted. `host_url` only for a self-hosted server: https, a host name and an optional
        // port, no path, no user or password.
        host: { type: 'enum', values: ['github', 'gitlab'] },
        host_url: { type: 'string', pattern: /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+(?::[1-9][0-9]{0,4})?$/, patternHint: 'https and a server name, such as "https://gitlab.example.com", with no path' },
        branch_pattern: {
          type: 'string',
          check(value, path, report) {
            if (!value.includes('{ticket}')) report(path, `${path} must contain {ticket}`, 'for example "feature/{ticket}-{slug}"', 'pattern');
          },
        },
        trailer: { type: 'string', pattern: /^[A-Za-z][A-Za-z0-9-]*$/, patternHint: 'a single word such as "Mirai-Ticket"' },
        // The subject format of MIRAI's commits (unit 22, G8): set it once where the project has a
        // commit-message rule MIRAI can't run.
        commit_format: { type: 'enum', values: ['plain', 'conventional'] },
        // Who MIRAI's commits credit (unit 22): you, from your personal global file; MIRAI commits.
        author_name: { type: 'string', pattern: GIT_NAME, patternHint: 'your name, as in your commits' },
        author_email: { type: 'string', pattern: GIT_EMAIL, patternHint: 'an email such as "you@example.com"' },
        committer_email: { type: 'string', pattern: GIT_EMAIL, patternHint: 'an email such as "mirai@example.com"' },
        // Repo config keys you trust on this machine beyond MIRAI's known ones (unit 14b;
        // src/config/git-repo-keys.js). Personal global file only.
        allow_repo_config: {
          type: 'array',
          items: {
            type: 'string',
            check(value, path, report) {
              const problem = allowEntryProblem(value);
              if (problem) report(path, `${path}: ${problem}`, 'keys that run code or redirect git can\'t be allowed (docs/agent-safety.md)', 'repo-config');
            },
          },
        },
      },
      required: ['integration_branch'],
      requiredHints: { integration_branch: 'add integration_branch = "main" under [git]' },
    },
    models: {
      type: 'table',
      fields: {
        light: { type: 'string' },
        standard: { type: 'string' },
        deep: { type: 'string' },
        // The verifier ladder's rung 2 (D-14, unit 19b): a different model of a comparable tier.
        alternates: { type: 'table', fields: { light: { type: 'string' }, standard: { type: 'string' }, deep: { type: 'string' } } },
        steps: {
          type: 'table',
          fields: Object.fromEntries(STEPS.map((step) => [step, tier])),
          check(value, path, report) {
            for (const step of JUDGEMENT_STEPS) {
              if (value[step] !== undefined && value[step] !== 'deep') {
                report(`${path}.${step}`, `${path}.${step} must stay "deep"`, 'judgement steps are never run on a lower tier (D-14)', 'judgement-tier');
              }
            }
          },
        },
      },
    },
    // New packages installed after your approval (unit 30b): the most a lock may add before it
    // parks for you (deps-review).
    dependencies: {
      type: 'table',
      fields: {
        max_added: { type: 'integer', min: 1, max: 1000 },
      },
    },
    // The loop guard's caps (unit 20; D-18). Turns, tokens and minutes stay unset until calibration.
    loop: {
      type: 'table',
      fields: {
        rounds: { type: 'integer', min: 1, max: 10 },
        rounds_high_risk: { type: 'integer', min: 1, max: 10 },
        breaker: { type: 'integer', min: 1, max: 20 },
        ticket_turns: { type: 'integer', min: 1 },
        ticket_tokens: { type: 'integer', min: 1 },
        ticket_minutes: { type: 'integer', min: 1 },
      },
    },
    testing: {
      type: 'table',
      fields: {
        tdd: { type: 'enum', values: ['auto', 'first', 'after'] },
        tests: { type: 'enum', values: ['required', 'optional'] },
        levels: { type: 'array', items: level, uniqueBy: 'name' },
        e2e_budget_minutes: { type: 'integer', min: 1 },
        // Where the E2E tests live (unit 12, D-44): only the QA agent may change them.
        e2e_paths: addedGlobs,
      },
    },
    checks: { type: 'table', map: namedCheck, keyPattern: NAME, keyHint: NAME_HINT },
    compose: {
      type: 'table',
      fields: {
        files: { type: 'array', items: relPath },
        env_file: relPath,
        // Unit 14c: extra service keys from a fixed safe list, and where the run's output folder
        // is mounted in the level's service.
        allow: { type: 'array', items: { type: 'enum', values: ['shm_size', 'ulimits', 'mem_limit', 'cpus', 'pids_limit'] } },
        output: { type: 'string', pattern: /^\/[^\\\0]*[^/]$/, patternHint: 'an absolute path inside the container, such as "/mirai/out"' },
      },
    },
    // What agents may read that the strict bundle would deny (unit 13b): `.env*` files that hold
    // no real secret, such as a committed `.env.example`. Every other `.env*` file is denied to
    // agents; [compose] env_file (the tests' dummy file) is always readable.
    sandbox: { type: 'table', fields: { readable_env: { type: 'array', items: relPath } } },
    repos: { type: 'array', items: repo, minItems: 1, uniqueBy: 'name' },
    workspace: {
      type: 'table',
      fields: {
        e2e: { type: 'enum', values: ['local', 'deployed', 'none'] },
        // Whether the toolchain works from a second checkout of the repo (D-24, R-C5): false when
        // the compose file fixes the project name, mounts the checkout or fixes host ports.
        // Recorded by setup detection (unit 17a); read once work runs in parallel.
        worktree_safe: { type: 'boolean' },
      },
    },
    resources: { type: 'table', map: resource, keyPattern: NAME, keyHint: NAME_HINT },
    gate: {
      type: 'table',
      fields: {
        code_paths: {
          ...globs,
          check(value, path, report) {
            if (!value.some((p) => !p.startsWith('!'))) report(path, `${path} needs at least one pattern that includes code`, 'for example "**"', 'range');
          },
        },
        risk: { type: 'table', fields: { high: globs } },
        // More protected paths for this project (unit 12); the built-in ones can't be removed.
        protected: addedGlobs,
        // The ecosystem packs of protected paths this project uses (unit 12), such as
        // ["php", "node"]; the core is always on.
        packs: { type: 'array', items: { type: 'string', pattern: NAME, patternHint: 'a pack name such as "node"' } },
      },
    },
    gates: {
      type: 'table',
      fields: Object.fromEntries(GATE_STAGES.map((stage) => [stage, { type: 'enum', values: ['human', 'auto'] }])),
      check(value, path, report) {
        for (const stage of NEVER_AUTO_STAGES) {
          if (value[stage] === 'auto') report(`${path}.${stage}`, `${path}.${stage} can never be automatic`, 'this decision always needs you (D-34)', 'never-auto');
        }
      },
    },
    // Where the repo's MIRAI documents live (<docs_root>, design/03; unit 07b).
    docs: {
      type: 'table',
      fields: {
        root: {
          type: 'string',
          // One spelling only, so the docs-root rules can't be switched off by writing the
          // same folder another way (./docs, docs//mirai, docs/./mirai, a trailing /).
          pattern: /^(?!\.{1,2}(?:\/|$))(?!.*\/\.{1,2}(?:\/|$))[^/\\\s][^/\\]*(?:\/[^/\\\s][^/\\]*)*$/,
          patternHint: 'a folder inside the repo, written like docs/mirai: no leading ./ or /, no .., no empty parts',
          check: relativePath,
        },
        // Where the project's documents are kept (unit 38, Jet's decision 4): `repo` (the default:
        // under the docs root, reaching the integration branch through one docs merge request per
        // initiative) or `local` (MIRAI's store on this Mac, never committed). Team policy, so the
        // project layer only (LAYER_KEYS: personal files can't set docs.*), read from the
        // integration branch like docs.root.
        store: { type: 'enum', values: ['repo', 'local'] },
        // The reader test before approval (unit 34, Scope 6): on unless the project turns it off,
        // for a project with no subscription to spare (not a quality switch). Team policy, so the
        // project layer only (LAYER_KEYS: personal files can't set docs.*).
        reader_test: { type: 'boolean' },
        // Vera before approval (unit 40, Scope 5): on unless the project turns it off; every
        // approval then says so. Team policy, so the project layer only.
        verify: { type: 'boolean' },
        // The author's fix rounds after the first check (unit 40, Jet's decision 2): Vera's, and
        // the reader test's (34 fixed it at 2 in the code). Ranged, so a cap can't be switched off
        // by setting it very high; project layer only.
        verify_fix_rounds: { type: 'integer', min: 0, max: 5 },
        reader_fix_rounds: { type: 'integer', min: 0, max: 5 },
        // Unit 44 (decision 6): past this many decision questions on one document version, the
        // author asks one question instead: reopen the brief's interview, or go on. Default 5 (the
        // code's); ranged; project layer only.
        max_decision_questions: { type: 'integer', min: 1, max: 20 },
        // Word caps and budgets (unit 32, Jet's decision 6): team policy, so the project layer
        // only (LAYER_KEYS). The registry's numbers are the defaults. Ranged, so a cap can't be
        // switched off by setting it very high.
        limits: {
          type: 'table',
          fields: {
            brief_summary_words: { type: 'integer', min: 100, max: 2000 },
            prd_summary_words: { type: 'integer', min: 100, max: 2000 },
            prd_full_summary_words: { type: 'integer', min: 100, max: 2000 },
            prd_lite_words: { type: 'integer', min: 500, max: 10000 },
            prd_full_words: { type: 'integer', min: 500, max: 10000 },
            // Unit 33 (Jet's decision 3): an epic's ticket caps and its summary budget. No
            // exception route: over a cap, the PRD is split or the work moves to `full`.
            epic_tickets: { type: 'integer', min: 2, max: 50 },
            epic_l_tickets: { type: 'integer', min: 0, max: 20 },
            epic_summary_words: { type: 'integer', min: 100, max: 2000 },
            epic_summary_warn_words: { type: 'integer', min: 100, max: 2000 },
            // Unit 36 (Jet's decision 3): business.md's cap and where it warns, the Sources table not
            // counted. About two pages by default (1,000 and 800).
            business_words: { type: 'integer', min: 300, max: 3000 },
            business_warn_words: { type: 'integer', min: 200, max: 3000 },
            // Unit 62b (decision 3): the technical note's cap; above it the feature belongs on full.
            tech_note_words: { type: 'integer', min: 300, max: 3000 },
            // Unit 62 (decision 4): the HLD's summary (fails above) and the whole HLD (warns above).
            hld_summary_words: { type: 'integer', min: 100, max: 2000 },
            hld_words: { type: 'integer', min: 1000, max: 15000 },
            // Unit 63 (Q4): the LLD's prose (tables and code blocks not counted): warns, then fails.
            lld_warn_words: { type: 'integer', min: 500, max: 10000 },
            lld_words: { type: 'integer', min: 1000, max: 15000 },
          },
        },
      },
    },
    retention: { type: 'table', fields: { days: { type: 'integer', min: 1, max: 3650 }, auto: { type: 'boolean' } } },
    // Unit 61 (Scope 6, D-20): where the project's ADRs live and how they are numbered: the first
    // number as the project writes it ("ADR-0001", "adr-0001", "0001"). `mirai detect` drafts both
    // from an ADR folder it finds.
    adr: {
      type: 'table',
      fields: {
        folder: { type: 'string', check: relativePath },
        numbering: { type: 'string', pattern: /^[A-Za-z]{0,8}-?0{0,5}1$/, patternHint: 'the first number as your ADRs write it, such as "ADR-0001", "adr-0001" or "0001"' },
      },
    },
    // Unit 64 (decision 3): the documentation sites the architect may fetch from, beside MIRAI's fixed
    // list of package sites (src/launch/strict.js, FETCH_DOMAINS): each a plain domain, or "*." and a
    // domain for its subdomains. Team policy, so the project layer only (LAYER_KEYS).
    design: {
      type: 'table',
      fields: {
        fetch_domains: { type: 'array', items: { type: 'string', pattern: /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, patternHint: 'a domain such as "docs.example.com", or "*.example.com" for its subdomains' } },
      },
    },
    // Unit 42: tickets. `key_prefix`, the ticket keys' prefix (PROJ in PROJ-12; the tracker's project
    // key once a tracker is connected, 38). `types` (Jet's decisions 6 and 7): the project's ticket
    // types, each with a name, what it's for, and the MIRAI behaviour it runs as; with none, Story,
    // Bug and Investigation. Team policy, so the project layer only (LAYER_KEYS).
    tickets: {
      type: 'table',
      fields: {
        key_prefix: { type: 'string', pattern: /^[A-Z][A-Z0-9]{0,9}$/, patternHint: 'capital letters and digits, starting with a letter, up to 10, such as "PROJ"' },
        types: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'table',
            fields: {
              name: { type: 'string', pattern: /^[A-Za-z][A-Za-z0-9 ._-]{0,39}$/, patternHint: 'a name such as "Tech Debt": letters, digits, spaces, ".", "_" and "-", up to 40' },
              description: { type: 'string' },
              runs_as: { type: 'string' },
              template: { type: 'string', pattern: NAME, patternHint: `the ticket type overlay's name (.mirai/custom/ticket-types/<name>.toml): ${NAME_HINT}` },
              checklist: { type: 'array', items: { type: 'string', pattern: /^[^\n\r]{1,300}$/, patternHint: 'one line' } },
              tracker_type: { type: 'string', pattern: /^[^\n\r]{1,60}$/, patternHint: 'the tracker\'s issue type, one line' },
            },
            required: ['name', 'runs_as'],
          },
          check: checkTicketTypes,
        },
        // Unit 45 (decision 2): the documents each track needs approved before the ticket planner
        // cuts (a document type's name). MIRAI's defaults always count (src/tickets/inputs.js); a
        // project may only add to them.
        inputs: {
          type: 'table',
          fields: {
            standard: { type: 'array', items: { type: 'string', pattern: NAME, patternHint: `a document type's name: ${NAME_HINT}` } },
            full: { type: 'array', items: { type: 'string', pattern: NAME, patternHint: `a document type's name: ${NAME_HINT}` } },
          },
        },
      },
    },
    run: {
      type: 'table',
      fields: {
        stop_by: { type: 'string', pattern: /^([01][0-9]|2[0-3]):[0-5][0-9]$/, patternHint: 'a 24-hour time as a string, for example "06:30"' },
        // Unit 28: at a 5-hour usage limit, wait for the reset or stop; and the longest wait.
        on_limit: { type: 'enum', values: ['wait', 'stop'] },
        max_wait_minutes: { type: 'integer', min: 1, max: 600 },
      },
    },
    // How many test runs may run at once across all your projects (unit 14d). Personal global
    // file only: it's about this machine.
    tests: { type: 'table', fields: { max_parallel: { type: 'integer', min: 1, max: 8 } } },
    subscription: {
      type: 'table',
      fields: { plan: { type: 'string', pattern: PLAN, patternHint: 'for example "max-20x" (at most 32 characters)' } },
    },
    // Unit 29b (Jet's decision 3): how long your key stays unlocked after you type its passphrase:
    // "each" (every decision asks), or a duration up to 30 days ("8h", "3d", "90m"). Your global
    // file only: a project or a branch never sets it.
    // Unit 18h (Jet's decision 2): your consent, once, to MIRAI moving agents to a newer Claude Code
    // at a ticket's start by running the red team on it (about 15 minutes, on your subscription).
    // "auto" or "off"; not set, MIRAI tells you once and doesn't move. Your global file only.
    claude_code: { type: 'table', fields: { move: { type: 'enum', values: ['auto', 'off'] } } },
    signing: {
      type: 'table',
      fields: { unlock: { type: 'string', pattern: /^(each|[1-9][0-9]{0,4}[mhd])$/, patternHint: '"each", or a duration such as "8h" or "3d" (at most 30 days)' } },
    },
    usage: {
      type: 'table',
      fields: {
        night_max: { type: 'integer', min: 0, max: 100 },
        week_max: { type: 'integer', min: 0, max: 100 },
        reserve: { type: 'integer', min: 0, max: 100 },
        // The next ticket's share until a run has measured one (unit 20).
        ticket_estimate: { type: 'integer', min: 0, max: 100 },
        // Unit 28: how old a usage reading may be before a run's short Haiku check refreshes it.
        stale_hours: { type: 'integer', min: 1, max: 168 },
      },
      check(value, path, report) {
        if (Number.isInteger(value.night_max) && Number.isInteger(value.week_max) && value.night_max > value.week_max) {
          report(`${path}.night_max`, `${path}.night_max must not be larger than ${path}.week_max`, undefined, 'range');
        }
      },
    },
  },
  required: ['git'],
  requiredHints: { git: 'add a [git] table with integration_branch = "main"' },
  check(config, path, report) {
    // A test level can name its repo only when that repo is listed.
    const names = new Set((config.repos ?? []).map((r) => r?.name));
    (config.testing?.levels ?? []).forEach((l, i) => {
      if (typeof l?.repo === 'string' && !names.has(l.repo)) {
        report(`testing.levels[${i}].repo`, `testing.levels[${i}].repo is not one of the repos`, 'use a name from [[repos]]', 'unknown-repo');
      }
    });
  },
};
